// 図鑑データ(日本語名つき)と使用率スナップショットを生成する。
// 入力: raw/ 以下の PokeAPI CSV・Pokémon Showdown データ・Smogon 使用率、@smogon/calc のチャンピオンズ用データ
// 出力: src/generated/dex.json, docs/usage-single.json, docs/usage-double.json
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {slimUsage} from '../src/engine/usage-slim.js';

const require = createRequire(import.meta.url);
const calc = require('@smogon/calc');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = f => path.join(root, 'raw', f);
const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const gen = calc.Generations.get(0);

function csv(file) {
  const text = fs.readFileSync(raw(file), 'utf8');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// 英語名 → 日本語名 の対応表 (言語ID 9=英語, 11=日本語(漢字かな), 1=かな)
function nameMap(file, idCol) {
  const en = {}, ja = {}, kana = {};
  for (const r of csv(file)) {
    if (r.local_language_id === '9') en[r[idCol]] = r.name;
    else if (r.local_language_id === '11') ja[r[idCol]] = r.name;
    else if (r.local_language_id === '1') kana[r[idCol]] = r.name;
  }
  const out = {};
  for (const id in en) {
    const j = ja[id] || kana[id];
    if (j) out[toID(en[id])] = j;
  }
  return out;
}

const speciesJa = nameMap('papi_pokemon_species_names.csv', 'pokemon_species_id');
const moveJa = nameMap('papi_move_names.csv', 'move_id');
const abilityJa = nameMap('papi_ability_names.csv', 'ability_id');
const itemJa = nameMap('papi_item_names.csv', 'item_id');

const manual = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'names-ja-manual.json'), 'utf8'));
Object.assign(moveJa, manual.moves);
Object.assign(abilityJa, manual.abilities);
Object.assign(itemJa, manual.items);

// Showdown の TS データを評価する (関数を含まないオブジェクトリテラルのみ)
function loadTsObject(file) {
  let src = fs.readFileSync(raw(file), 'utf8');
  src = src.replace(/^export const \w+:[^=]+=/m, 'return ');
  return new Function(src)();
}
const sdDex = loadTsObject('sd_data_pokedex.ts');
const learnsets = loadTsObject('dl_champions_learnsets.ts');

// 技の命中率など (関数を含むので正規表現で拾う)
function moveProps(file, into) {
  const src = fs.readFileSync(raw(file), 'utf8');
  const re = /\n\t(\w+): \{\n([\s\S]*?)\n\t\},/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[2];
    const o = into[m[1]] || (into[m[1]] = {});
    const acc = /\n\t\taccuracy: (true|\d+)/.exec('\n' + body);
    if (acc) o.acc = acc[1] === 'true' ? 0 : Number(acc[1]);
    const tg = /\n\t\ttarget: "(\w+)"/.exec('\n' + body);
    if (tg) o.tg = tg[1];
    const fl = /\n\t\tflags: \{([^}]*)\}/.exec('\n' + body);
    if (fl) o.fl = fl[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean);
    const mh = /\n\t\tmultihit: (\[\d+, \d+\]|\d+)/.exec('\n' + body);
    if (mh) o.mh = JSON.parse(mh[1]);
  }
  return into;
}
const sdMoves = moveProps('dl_champions_moves.ts', moveProps('sd_data_moves.ts', {}));

const FORM_SUFFIX = {
  Alola: 'アローラ', Galar: 'ガラル', Hisui: 'ヒスイ', Paldea: 'パルデア',
};
const SPECIES_MANUAL = manual.species;

function speciesJaName(name) {
  const id = toID(name);
  if (SPECIES_MANUAL[id]) return SPECIES_MANUAL[id];
  const sp = gen.species.get(id);
  const baseName = name.split('-')[0];
  if (speciesJa[id]) return speciesJa[id];
  const parts = name.split('-');
  // 名前自体にハイフンを含む種族 (Kommo-o など)
  for (let n = parts.length; n >= 1; n--) {
    const head = parts.slice(0, n).join('-');
    const j = speciesJa[toID(head)];
    if (!j) continue;
    const rest = parts.slice(n);
    if (!rest.length) return j;
    if (rest[0] === 'Mega') return 'メガ' + j + (rest[1] ? rest[1] : '');
    if (FORM_SUFFIX[rest[0]]) return `${j}(${FORM_SUFFIX[rest[0]]}${rest[1] ? '・' + rest[1] : ''})`;
    return `${j}(${rest.join('-')})`;
  }
  return null;
}

const missing = {species: [], moves: [], abilities: [], items: []};

// 特性一覧: Showdown 図鑑 (全特性) を優先し、計算機側の既定特性を先頭にする
function abilitiesOf(sp) {
  const sd = sdDex[sp.id];
  const list = [];
  const push = a => { if (a && !list.includes(a)) list.push(a); };
  push(sp.abilities?.[0]);
  if (sd?.abilities) for (const k of ['0', '1', 'H', 'S']) push(sd.abilities[k]);
  return list.filter(a => gen.abilities.get(toID(a)));
}

const megaOf = {}; // メガ後の種族ID → {base, stone}
for (const [stone, map] of Object.entries(calc.MEGA_STONES)) {
  for (const [base, mega] of Object.entries(map)) {
    if (gen.species.get(toID(mega)) && gen.items.get(toID(stone))) megaOf[toID(mega)] = {base: toID(base), stone: toID(stone)};
  }
}

// 戦闘中だけの姿 (構築画面の候補から外す)
const BATTLE_FORMS = {aegislashshield: ['aegislashblade', 'aegislashboth'], mimikyu: ['mimikyubusted'], morpeko: ['morpekohangry'],
  palafin: ['palafinhero'], castform: ['castformsunny', 'castformrainy', 'castformsnowy']};
const BATTLE_ONLY = new Set(['aegislashblade', 'aegislashboth', 'mimikyubusted', 'morpekohangry', 'palafinhero',
  'castformrainy', 'castformsnowy', 'castformsunny']);

const species = {};
for (const sp of gen.species) {
  const j = speciesJaName(sp.name);
  if (!j) missing.species.push(sp.name);
  const bs = sp.baseStats;
  const o = {
    n: sp.name, j: j || sp.name, t: sp.types,
    bs: [bs.hp, bs.atk, bs.def, bs.spa, bs.spd, bs.spe],
    ab: abilitiesOf(sp).map(toID), w: sp.weightkg,
  };
  if (megaOf[sp.id]) { o.mega = megaOf[sp.id].base; o.stone = megaOf[sp.id].stone; }
  if (BATTLE_ONLY.has(sp.id)) o.bo = 1;
  species[sp.id] = o;
}
for (const [b, fs2] of Object.entries(BATTLE_FORMS)) if (species[b]) species[b].forms = fs2.filter(f => species[f]);
// 基本種 → メガシンカ先
for (const [mid, m] of Object.entries(megaOf)) {
  if (!species[m.base]) continue;
  (species[m.base].megas ||= []).push(mid);
}

const TARGET_SPREAD = new Set(['allAdjacent', 'allAdjacentFoes']);
const moves = {};
for (const mv of gen.moves) {
  if (mv.id === 'noprobs' || mv.name === '(No Move)') continue;
  const j = moveJa[mv.id];
  if (!j) missing.moves.push(mv.name);
  const p = sdMoves[mv.id] || {};
  const cat = mv.category || 'Status';
  const o = {n: mv.name, j: j || mv.name, t: mv.type, c: cat[0] === 'P' ? 'P' : cat[0] === 'S' && cat !== 'Status' ? 'S' : 'Z', bp: mv.basePower || 0};
  if (mv.priority) o.pr = mv.priority;
  if (p.acc) o.acc = p.acc;
  const tg = mv.target || p.tg;
  if (tg && tg !== 'normal') o.tg = tg;
  if (TARGET_SPREAD.has(tg)) o.sp = 1;
  if (mv.multihit) o.mh = mv.multihit; else if (p.mh) o.mh = p.mh;
  const fl = [];
  if (mv.flags?.contact) fl.push('contact');
  for (const f of ['sound', 'punch', 'bite', 'slicing', 'bullet', 'pulse', 'wind']) if (mv.flags?.[f] || p.fl?.includes(f)) fl.push(f);
  if (p.fl?.includes('protect') === false && cat !== 'Status') fl.push('noprotect');
  if (fl.length) o.fl = fl;
  moves[mv.id] = o;
}

const abilities = {};
for (const a of gen.abilities) {
  if (a.name === '(No Ability)') continue;
  const j = abilityJa[a.id];
  if (!j) missing.abilities.push(a.name);
  abilities[a.id] = {n: a.name, j: j || a.name};
}

const items = {};
for (const it of gen.items) {
  const j = itemJa[it.id];
  if (!j) missing.items.push(it.name);
  const o = {n: it.name, j: j || it.name};
  if (it.megaStone) o.ms = Object.fromEntries(Object.entries(it.megaStone).map(([b, m]) => [toID(b), toID(m)]));
  items[it.id] = o;
}

// 習得技: フォルムは基本種の技を引き継ぐ
const learn = {};
function learnsetIds(id) {
  const ls = learnsets[id]?.learnset;
  return ls ? Object.keys(ls).filter(m => moves[m]) : null;
}
for (const id of Object.keys(species)) {
  const sd = sdDex[id];
  let ids = learnsetIds(id);
  const baseId = sd?.baseSpecies ? toID(sd.baseSpecies) : null;
  const chain = [id, sd?.changesFrom && toID(sd.changesFrom), baseId, species[id].mega, toID(species[id].n.split('-')[0])].filter(Boolean);
  for (const c of chain) { if (ids?.length) break; ids = learnsetIds(c); }
  if (ids?.length) learn[id] = ids.sort();
}
const noLearn = Object.keys(species).filter(id => !learn[id]);

const natures = {};
const NATURE_JA = manual.natures;
for (const n of gen.natures) natures[n.name] = {j: NATURE_JA[n.name] || n.name, p: n.plus === n.minus ? null : n.plus, m: n.plus === n.minus ? null : n.minus};

const dex = {species, moves, abilities, items, learn, natures, built: new Date().toISOString().slice(0, 10), calcVersion: require('@smogon/calc/package.json').version};
fs.mkdirSync(path.join(root, 'src', 'generated'), {recursive: true});
fs.writeFileSync(path.join(root, 'src', 'generated', 'dex.json'), JSON.stringify(dex));

// 使用率スナップショット
fs.mkdirSync(path.join(root, 'docs'), {recursive: true});
const stamp = fs.existsSync(raw('stats_month.txt')) ? fs.readFileSync(raw('stats_month.txt'), 'utf8').trim() : '';
for (const [key, file] of [['single', 'stats_gen9championsbattlestadiumsingles.json'], ['double', 'stats_gen9championsvgc2026.json']]) {
  const slim = slimUsage(JSON.parse(fs.readFileSync(raw(file), 'utf8')), dex);
  slim.month = stamp;
  slim.source = file.replace(/^stats_|\.json$/g, '');
  const out = path.join(root, 'docs', `usage-${key}.json`);
  fs.writeFileSync(out, JSON.stringify(slim));
  console.log(key, Object.keys(slim.pokemon).length, 'pokemon', (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
}

console.log('species', Object.keys(species).length, 'moves', Object.keys(moves).length, 'abilities', Object.keys(abilities).length, 'items', Object.keys(items).length);
console.log('learnset無し:', noLearn.join(', ') || 'なし');
for (const k in missing) console.log(`日本語名なし ${k} (${missing[k].length}):`, missing[k].join(', '));
