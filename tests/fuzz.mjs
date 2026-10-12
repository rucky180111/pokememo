// 公式シミュレーター (Pokémon Showdown) で実際に対戦を回し、そのログを「几帳面なユーザーの入力」としてアプリに流し込む総当たり検査。
// 使い方: PS=/path/to/pokemon-showdown(ビルド済み) node tests/fuzz.mjs [対戦数] [乱数の種]
// 検査すること:
//   1. どんな対戦でもアプリが例外を出さない
//   2. ダメージからの推定が、相手の本当の配分を候補から外さない (健全性)
//   3. 行動順からの素早さ推定が、相手の本当の素早さを候補から外さない
//   4. 技の自動反映 (ランク・天候・壁など) が実際の対戦結果と合っているか
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {dex, toID, natureMod, STAT_KEYS} from '../src/engine/dex.js';
import {newBattle, newTeam, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {addAct, endTurn, residualCandidates, finishTurn, replay} from '../src/engine/flow.js';
import {clone} from '../src/engine/battle.js';
import {boardContext, attackTable} from '../src/engine/board.js';
import {comboOf, parseSpread} from '../src/engine/assume.js';
import {estimateStats} from '../src/engine/estimate.js';

const require = createRequire(import.meta.url);
const PS = process.env.PS || '/home/claude/ps';
const {Battle, Dex} = require(`${PS}/dist/sim`);
const N = Number(process.argv[2]) || 100;
let seed = Number(process.argv[3]) || 1;
const FORMAT = 'gen9championsbssregmc';
const usage = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const weighted = pairs => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = rnd() * tot; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[pairs.length - 1]?.[0]; };
const psDex = Dex.mod('champions');
// 図鑑データの突き合わせ: 優先度・威力・タイプ・分類が公式シミュレーターと一致するか
{
  const bad = [];
  for (const [id, m] of Object.entries(dex.moves)) {
    const pm = psDex.moves.get(id);
    if (!pm.exists) { bad.push(`${id}: シミュレーターに無い`); continue; }
    if ((m.pr || 0) !== pm.priority) bad.push(`${m.j}: 優先度 ${m.pr || 0} ≠ ${pm.priority}`);
    if (m.t !== pm.type) bad.push(`${m.j}: タイプ ${m.t} ≠ ${pm.type}`);
    if ({P: 'Physical', S: 'Special', Z: 'Status'}[m.c] !== pm.category) bad.push(`${m.j}: 分類`);
    if ((m.bp || 0) !== pm.basePower && !(pm.basePowerCallback)) bad.push(`${m.j}: 威力 ${m.bp} ≠ ${pm.basePower}`);
  }
  for (const [id, sp] of Object.entries(dex.species)) {
    const ps = psDex.species.get(sp.n);
    if (!ps.exists) { bad.push(`${sp.j}: シミュレーターに無い`); continue; }
    const bs = ps.baseStats;
    if (id !== 'aegislashboth' && [bs.hp, bs.atk, bs.def, bs.spa, bs.spd, bs.spe].join() !== sp.bs.join()) bad.push(`${sp.j}: 種族値`);
    if (id !== 'aegislashboth' && ps.types.join() !== sp.t.join()) bad.push(`${sp.j}: タイプ`);
  }
  console.log(`図鑑データの不一致: ${bad.length}`); console.log(bad.slice(0, 30).join('\n'));
}

// 姿が勝手に変わる・化けるポケモンは「ユーザーに見えるもの」と中身がずれるので除外
const EXCLUDE = /^(zoroark|ditto|mimikyu|aegislash|palafin|morpeko|castform|meowstic)/;
const pool = Object.entries(usage.pokemon).filter(([id, d]) => !EXCLUDE.test(id) && d.u > 0.004 && d.mv.length >= 4 && d.sp.length).map(([id, d]) => [id, d.u]);

function makeTeam() {
  const sets = [], usedBase = new Set(), usedItems = new Set();
  let megas = 0;
  while (sets.length < 6) {
    const id = weighted(pool);
    const s = dex.species[id];
    const base = s.mega || id;
    const baseName = dex.species[base].n.split('-')[0];
    if (usedBase.has(baseName)) continue;
    if (s.mega && megas >= 2) continue;
    const d = usage.pokemon[id];
    let item = '';
    if (s.mega) item = s.stone;
    else { const c = d.it.filter(([x]) => x && !dex.items[x].ms && !usedItems.has(x)); item = c.length ? weighted(c) : ''; }
    if (item && usedItems.has(item)) continue;
    const baseD = usage.pokemon[base];
    const abC = (s.mega ? baseD?.ab : d.ab) || [];
    const ability = abC.length && dex.species[base].ab.includes(abC[0][0]) ? weighted(abC.filter(([a]) => dex.species[base].ab.includes(a))) : dex.species[base].ab[0];
    const spr = parseSpread(weighted(d.sp));
    const moves = [];
    const mvC = d.mv.filter(([m]) => psDex.moves.get(m).exists);
    for (let guard = 0; moves.length < 4 && guard < 50; guard++) { const m = weighted(mvC); if (!moves.includes(m)) moves.push(m); }
    if (moves.length < 1) continue;
    usedBase.add(baseName); if (item) usedItems.add(item); if (s.mega) megas++;
    sets.push({species: base, item, ability, nature: spr.nature, sp: spr.sp, moves, megaForme: s.mega ? id : null});
  }
  return sets;
}
const toPS = sets => sets.map((s, i) => ({name: `M${i}`, species: dex.species[s.species].n, item: s.item ? dex.items[s.item].n : '', ability: dex.abilities[s.ability].n,
  moves: s.moves.map(m => dex.moves[m].n), nature: s.nature, evs: Object.fromEntries(STAT_KEYS.map((k, i) => [k, s.sp[i]])), ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31}, level: 50, gender: ''}));

function choose(battle, sid) {
  const side = battle[sid];
  const req = side.activeRequest;
  if (!req || req.wait) return null;
  if (req.teamPreview) { const o = [1, 2, 3, 4, 5, 6].sort(() => rnd() - 0.5).slice(0, 3); return `team ${o.join('')}`; }
  const bench = req.side.pokemon.map((p, i) => ({p, i})).filter(x => !x.p.active && !x.p.condition.endsWith(' fnt'));
  if (req.forceSwitch) return bench.length ? `switch ${pick(bench).i + 1}` : 'pass';
  const a = req.active[0];
  const moves = a.moves.map((m, i) => ({m, i})).filter(x => !x.m.disabled);
  if (bench.length && !a.trapped && rnd() < 0.12) return `switch ${pick(bench).i + 1}`;
  if (!moves.length) return 'default';
  return `move ${pick(moves).i + 1}${a.canMegaEvo && rnd() < 0.7 ? ' mega' : ''}`;
}

const WEATHER = {RainDance: 'Rain', SunnyDay: 'Sun', Sandstorm: 'Sand', Snowscape: 'Snow', Snow: 'Snow', none: ''};
const SIDEKEY = {reflect: 'reflect', lightscreen: 'lightScreen', auroraveil: 'auroraVeil', tailwind: 'tailwind', stealthrock: 'sr'};
const DEBUG = process.env.DEBUG ? process.env.DEBUG.split(':').map(Number) : null;
const stats = {resMissing: {}, resFalse: {}, resHp: [], resOk: 0, replayBad: [], battles: 0, turns: 0, acts: 0, infer: 0, unsound: [], unexplained: [], speedUnsound: [], crashes: [], mismatch: {}, checked: {}, tableCalls: 0};
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

function runOne(n) {
  const t1 = makeTeam(), t2 = makeTeam();
  const battle = new Battle({formatid: FORMAT, seed: [n + 1, seed & 0xffff, 7, 11]});
  battle.setPlayer('p1', {name: 'A', team: toPS(t1)});
  battle.setPlayer('p2', {name: 'B', team: toPS(t2)});
  const sets = {p1: t1, p2: t2};
  const idxOf = (sid, ident) => Number(ident.split(': M')[1]);
  const sideOf = sid => (sid === 'p1' ? 'me' : 'opp');

  // アプリ側
  const team = newTeam('single');
  team.mons = t1.map(s => ({species: s.species, item: s.item, ability: s.ability, nature: s.nature, sp: s.sp.slice(), moves: s.moves.slice(), note: ''}));
  const b = newBattle({team});
  for (const s of t2) b.opp.push(newOpp(s.species));
  normalizeBattle(b);

  // ログから組み立てる「実際の盤面」
  const mk = () => ({hp: 100, status: '', boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}, itemGone: false, forme: null, fainted: false, abilityOn: false});
  const T = {me: {active: null, mons: t1.map(mk), megaUsed: false, flags: {}}, opp: {active: null, mons: t2.map(mk), megaUsed: false, flags: {}}, field: {weather: '', terrain: '', trickRoom: false, gravity: false}, taint: false, cause: {}, cur: ''};
  const hpOf = str => { if (/fnt/.test(str)) return 0; const [a, m] = str.split(' ')[0].split('/').map(Number); return (a / m) * 100; };
  // 相手のHPは割合 (整数%) でしか見えない
  const seen = (side, pct) => (side === 'opp' ? (pct <= 0 ? 0 : Math.max(1, Math.round(pct))) : pct);

  function sync(report) {
    // まず両者の繰り出しをアプリに反映 (登場時の特性はアプリに任せる) → そのあと実際の盤面と比べる
    for (const side of ['me', 'opp']) { const ts = T[side], as = b.state.sides[side]; if (ts.active != null && as.active[0] !== ts.active) sendOut(b, side, 0, ts.active, {resolveAbility: boardContext(b, usage).strictAbility}); }
    for (const side of ['me', 'opp']) {
      const ts = T[side], as = b.state.sides[side];
      ts.mons.forEach((m, i) => {
        const c = b.state.mons[side][i];
        if (report && i === ts.active && !m.fainted) {
          for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) { bump(stats.checked, `rank:${k}`); if ((c.boosts[k] || 0) !== m.boosts[k]) { bump(stats.mismatch, `ランク ${k}: ${m.cause?.[k] || '?'}`); if (process.env.MM && (m.cause?.[k] || '?').includes(process.env.MM) && (stats.mmShown = (stats.mmShown || 0) + 1) <= 4) console.log('MM', side, dex.species[sets[side === 'me' ? 'p1' : 'p2'][i].species].j, k, 'app', c.boosts[k], 'truth', m.boosts[k], `対戦${n} T${battle.turn}`, dex.abilities[sets[side === 'me' ? 'p1' : 'p2'][i].ability].j); } }
        }
        c.hp = seen(side, m.hp); c.fainted = m.fainted; c.status = m.status; c.boosts = {...m.boosts}; c.itemGone = m.itemGone; c.forme = m.forme; c.abilityOn = m.abilityOn;
      });
      if (report) for (const k of ['reflect', 'lightScreen', 'auroraVeil', 'tailwind', 'sr']) { bump(stats.checked, `side:${k}`); if (!!as[k] !== !!ts.flags[k]) bump(stats.mismatch, `場 ${k}: ${T.cause[k] || report}`); }
      if (report) { bump(stats.checked, 'spikes'); if ((as.spikes || 0) !== (ts.flags.spikes || 0)) bump(stats.mismatch, `まきびし: ${report}`); }
      for (const k of ['reflect', 'lightScreen', 'auroraVeil', 'tailwind', 'sr']) as[k] = !!ts.flags[k];
      as.spikes = ts.flags.spikes || 0; as.megaUsed = ts.megaUsed;
    }
    if (report) for (const k of ['weather', 'terrain', 'trickRoom', 'gravity']) { bump(stats.checked, `field:${k}`); if ((b.state.field[k] || '') !== (T.field[k] || '') && !!b.state.field[k] !== !!T.field[k] || (typeof T.field[k] === 'string' && (b.state.field[k] || '') !== T.field[k])) bump(stats.mismatch, `${k}: ${T.cause[k] || report}`); }
    Object.assign(b.state.field, T.field);
  }

  const RES_FROM = [[/item: Leftovers/, 'leftovers'], [/item: Black Sludge/, 'blacksludge'], [/\[from\] (psn|tox)/, 'psn'], [/\[from\] brn/, 'brn'], [/\[from\] Sandstorm/, 'sand'], [/\[from\] Grassy Terrain/, 'grassy'],
    [/ability: Poison Heal/, 'poisonheal'], [/ability: Rain Dish/, 'raindish'], [/ability: Dry Skin/, 'dryskin'], [/ability: Solar Power/, 'solarpower'], [/ability: Ice Body/, 'icebody'], [/\[from\] Leech Seed/, 'leechseed']];
  let lastSeedDmg = null;
  let resSeen = [];
  function apply(line) {
    if (lastSeedDmg && /^\|-heal\|.*\[silent\]/.test(line)) {
      const q = line.split('|'); const sd = sideOf(q[2].slice(0, 2)), mi = idxOf(q[2].slice(0, 2), q[2]);
      resSeen.push({side: sd, mon: mi, key: 'leechheal', hp: hpOf(q[3]), prev: T[sd].mons[mi].hp});
    }
    lastSeedDmg = /\[from\] Leech Seed/.test(line);
    if (/^\|-(heal|damage)\|/.test(line)) {
      const q = line.split('|');
      for (const [re, key] of RES_FROM) if (re.test(line)) {
        const sd = sideOf(q[2].slice(0, 2)), mi = idxOf(q[2].slice(0, 2), q[2]);
        const k2 = key === 'psn' && T[sd].mons[mi].status === 'tox' ? 'tox' : key;
        resSeen.push({side: sd, mon: mi, key: k2, hp: hpOf(q[3]), prev: T[sd].mons[mi].hp});
      }
    }
    const p = line.split('|');
    const kind = p[1];
    const who = p[2] && /^p[12]a?: /.test(p[2]) ? {sid: p[2].slice(0, 2), side: sideOf(p[2].slice(0, 2))} : null;
    const i = who ? idxOf(who.sid, p[2]) : -1;
    const m = who && i >= 0 ? T[who.side].mons[i] : null;
    const from = line.includes('[from]');
    // 特性が画面に出たら、ユーザーも相手の特性を知る
    const ab = /\[from\] ability: ([^|]+)/.exec(line);
    if (ab) { const of = /\[of\] (p[12])a: ([^|]+)/.exec(line); const sid = of ? of[1] : who?.sid; const ii = of ? Number(of[2].slice(1)) : i; if (sid === 'p2' && ii >= 0 && dex.abilities[toID(ab[1])] && !dex.species[T.opp.mons[ii].forme]?.mega) b.opp[ii].ability = toID(ab[1]); }
    if (kind === '-ability' && who?.sid === 'p2' && i >= 0 && dex.abilities[toID(p[3])] && !dex.species[m.forme]?.mega) b.opp[i].ability = toID(p[3]);
    const why = (/\[from\] ([^|]+)/.exec(line)?.[1]) || (kind === 'switch' || kind === 'drag' ? '登場時' : T.cur ? `技 ${T.cur}` : '?');
    if (m && /^-(un)?boost$|^-setboost$/.test(kind)) (m.cause ||= {})[p[3]] = `${kind === '-unboost' ? '↓' : '↑'} ${why}`;
    if (kind === '-weather' && !line.includes('[upkeep]')) T.cause.weather = why;
    if (kind === '-fieldstart' || kind === '-fieldend') { T.cause.terrain = T.cause.trickRoom = T.cause.gravity = why; }
    if (kind === '-sidestart' || kind === '-sideend') T.cause[SIDEKEY[toID(p[3].replace('move: ', ''))]] = `${kind === '-sideend' ? '終了 ' : ''}${why}`;
    if (kind === '-swapsideconditions') { const x = T.me.flags; T.me.flags = T.opp.flags; T.opp.flags = x; }
    switch (kind) {
      case 'switch': case 'drag': case 'replace': {
        const ts = T[who.side];
        if (ts.active != null) { const old = ts.mons[ts.active]; if (line.includes('[from] Baton Pass') && ts.active !== i) m.boosts = {...old.boosts}; old.boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}; old.abilityOn = false; }
        ts.active = i; m.hp = hpOf(p[4]); m.fainted = m.hp <= 0;
        if (!b.pick[who.side].includes(i)) b.pick[who.side].push(i);
        break;
      }
      case '-damage': case '-heal': case '-sethp': if (m) { m.hp = hpOf(p[3]); if (m.hp <= 0) m.fainted = true; } break;
      case 'faint': if (m) { m.hp = 0; m.fainted = true; m.status = ''; } break;
      case '-status': if (m) m.status = p[3]; break;
      case '-curestatus': if (m) m.status = ''; break;
      case '-boost': if (m) m.boosts[p[3]] = Math.min(6, (m.boosts[p[3]] || 0) + Number(p[4])); break;
      case '-unboost': if (m) m.boosts[p[3]] = Math.max(-6, (m.boosts[p[3]] || 0) - Number(p[4])); break;
      case '-setboost': if (m) m.boosts[p[3]] = Number(p[4]); break;
      case '-clearboost': case '-clearallboost': if (kind === '-clearallboost') { for (const s of ['me', 'opp']) for (const x of T[s].mons) x.boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}; } else if (m) m.boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}; break;
      case '-clearnegativeboost': if (m) for (const k in m.boosts) if (m.boosts[k] < 0) m.boosts[k] = 0; break;
      case '-invertboost': if (m) for (const k in m.boosts) m.boosts[k] = -m.boosts[k]; break;
      case '-copyboost': case '-swapboost': case '-transform': case '-item': case '-formechange': T.taint = true; break;
      case '-weather': if (!line.includes('[upkeep]')) T.field.weather = WEATHER[p[2]] ?? T.field.weather; break;
      case '-fieldstart': { const id = toID(p[2].replace('move: ', '')); if (id.endsWith('terrain')) T.field.terrain = {electricterrain: 'Electric', grassyterrain: 'Grassy', mistyterrain: 'Misty', psychicterrain: 'Psychic'}[id] || ''; else if (id === 'trickroom') T.field.trickRoom = true; else if (id === 'gravity') T.field.gravity = true; else T.taint = true; break; }
      case '-fieldend': { const id = toID(p[2].replace('move: ', '')); if (id.endsWith('terrain')) T.field.terrain = ''; else if (id === 'trickroom') T.field.trickRoom = false; else if (id === 'gravity') T.field.gravity = false; break; }
      case '-sidestart': case '-sideend': {
        const side = sideOf(p[2].slice(0, 2)); const id = toID(p[3].replace('move: ', ''));
        if (id === 'spikes') T[side].flags.spikes = kind === '-sidestart' ? Math.min(3, (T[side].flags.spikes || 0) + 1) : 0;
        else if (SIDEKEY[id]) T[side].flags[SIDEKEY[id]] = kind === '-sidestart';
        break;
      }
      case '-enditem': if (m) { m.itemGone = true; if (who.sid === 'p2') b.opp[i].item = toID(p[3]); } break;
      case '-mega': case 'detailschange': if (m && kind === 'detailschange') { const f = toID(p[3].split(',')[0]); if (dex.species[f]?.mega) { m.forme = f; T[who.side].megaUsed = true; if (who.sid === 'p2') { b.opp[i].megaSeen = true; b.opp[i].item = dex.species[f].stone; } } else T.taint = true; } break;
      case '-start': if (m && /Flash Fire/.test(line)) m.abilityOn = true; if (/Substitute|typechange|Disable|Encore|perish/i.test(line) && /typechange/.test(line)) T.taint = true; break;
      default: break;
    }
  }

  const truthOK = (oi, stat) => {
    const real = t2[oi], k = b.opp[oi].statOk?.[stat];
    if (!k) return true;
    const c = comboOf(natureMod(real.nature, stat), real.sp[STAT_KEYS.indexOf(stat)]);
    return (stat === 'atk' || stat === 'spa' ? k[c] : k[real.sp[0] * 99 + c]) === '1';
  };

  function handleMove(lines, start) {
    const p = lines[start].split('|');
    const sid = p[2].slice(0, 2), side = sideOf(sid), foe = side === 'me' ? 'opp' : 'me';
    const moveId = toID(p[3]);
    const called = lines[start].includes('[from]');
    T.cur = dex.moves[moveId]?.j || p[3];
    const mon = idxOf(sid, p[2]);
    sync(lastMove);
    const tgtIdx = T[foe].active;
    const before = tgtIdx != null ? T[foe].mons[tgtIdx].hp : null;
    const wasTaint = T.taint;
    let end = start + 1;
    const flags = {}; let hits = 0, lastHp = null, defItem = '', endured = false, weird = called, mega = false, sub = false, healed = false;
    const foeTag = `${foe === 'me' ? 'p1' : 'p2'}a: `;
    for (; end < lines.length; end++) {
      const l = lines[end];
      if (l === '|' || l === '|upkeep' || /^\|(move|switch|drag|upkeep|turn|win|tie|cant)\|/.test(l)) break;
      const q = l.split('|');
      const onFoe = q[2]?.startsWith(foeTag);
      if (q[1] === '-crit' && onFoe) flags.crit = true;
      if (q[1] === '-miss' || q[1] === '-immune' || q[1] === '-fail' || q[1] === '-notarget') flags.miss = true;
      if (q[1] === '-activate' && /Protect|Spiky Shield|Baneful Bunker|King's Shield|Detect|Silk Trap|Burning Bulwark|Obstruct|Max Guard/.test(l)) flags.protect = true;
      if (q[1] === '-activate' && /Substitute/.test(l)) sub = true;
      if (q[1] === '-end' && /Substitute/.test(l)) sub = true;
      if ((q[1] === '-activate' || q[1] === '-ability') && onFoe && /Sturdy|Endure|Focus Band/.test(l)) endured = true;
      if (q[1] === '-activate' && /Disguise|Ice Face/.test(l)) weird = true;
      if (q[1] === '-damage' && onFoe && !l.includes('[from]')) { hits++; lastHp = hpOf(q[3]); }
      if (q[1] === '-enditem' && onFoe) {
        const it = toID(q[3]);
        if (l.includes('[from] move')) { /* はたきおとす等で失っただけ */ }
        else if (it === 'focussash') defItem = 'focussash';
        else if (l.includes('[weaken]')) defItem = it;
        else if (it === 'sitrusberry' && l.includes('[eat]')) defItem = 'sitrusberry';
        else if (/berry$/.test(it) && l.includes('[eat]')) healed = true; // ほかの実 (回復量が割合で出せない等)
      }
      if (q[1] === '-heal' && onFoe) { if (/Sitrus Berry/.test(l)) lastHp = hpOf(q[3]); else healed = true; }
      if (q[1] === '-hitcount') hits = Number(q[3]) || hits;
      apply(l);
    }
    if (!dex.moves[moveId]) return end; // アプリに無い技 (わるあがき等)
    // 直前に detailschange (メガシンカ) があったか
    for (let j = start - 1; j >= 0 && j > start - 6; j--) { if (/^\|-mega\|/.test(lines[j]) && lines[j].split('|')[2] === p[2]) mega = true; if (/^\|(move|turn)\|/.test(lines[j])) break; }
    const visible = lastHp != null && !sub && !weird && !healed && !wasTaint && !T.taint && tgtIdx != null && T[foe].active === tgtIdx;
    const input = {side, mon, type: 'move', move: moveId, crit: !!flags.crit, miss: !!flags.miss, protect: !!flags.protect, sameTurn: true,
      hits: hits > 1 ? hits : undefined, defItem: defItem ? {item: defItem} : null, endured,
      exact: foe === 'me', hpAfter: visible ? seen(foe, lastHp) : null};
    const oi = side === 'opp' ? mon : tgtIdx;
    const prev = oi != null ? JSON.stringify(b.opp[oi].statOk || null) : null;
    stats.acts++;
    if (called) { lastMove = dex.moves[moveId].j; return end; } // 特性や技で呼び出された技は、行動としては記録しない
    const log = addAct(b, input, usage);
    if (DEBUG && DEBUG[0] === n && DEBUG[1] === battle.turn) console.log('ACT', JSON.stringify(input), '\n  log:', log.join(' / '), '\n  truth opp:', oi != null ? JSON.stringify(t2[oi]) : '', '\n  my:', JSON.stringify(t1[side === 'me' ? mon : tgtIdx]), '\n  board:', JSON.stringify({f: b.state.field, me: b.state.mons.me[T.me.active], opp: b.state.mons.opp[T.opp.active], sides: [b.state.sides.me, b.state.sides.opp]}));
    lastMove = dex.moves[moveId].j;
    if (oi != null && visible) {
      const text = log.join(' / ');
      const info = () => `${dex.species[sets[sid][mon].species].j}(${dex.items[sets[sid][mon].item]?.j || 'なし'}/${dex.abilities[sets[sid][mon].ability].j}) の ${dex.moves[moveId].j} → ${dex.species[sets[foe === 'me' ? 'p1' : 'p2'][tgtIdx].species].j}(${dex.items[sets[foe === 'me' ? 'p1' : 'p2'][tgtIdx].item]?.j || 'なし'}/${dex.abilities[sets[foe === 'me' ? 'p1' : 'p2'][tgtIdx].ability].j}) ${Math.round(before)}%→${Math.round(lastHp)}%${flags.crit ? ' 急所' : ''}${hits > 1 ? ` ${hits}回` : ''}${defItem ? ` ${defItem}` : ''}${endured ? ' 耐えた' : ''} 天候:${T.field.weather || '-'} [対戦${n} T${battle.turn}]`;
      if (/実数値|HPの能力ポイント/.test(text)) {
        stats.infer++;
        for (const st of ['atk', 'spa', 'def', 'spd']) if (!truthOK(oi, st)) { stats.unsound.push(`${st}: ${info()}`); b.opp[oi].statOk = JSON.parse(prev); break; }
      } else if (/説明がつきません|矛盾/.test(text)) stats.unexplained.push(info());
    }
    return end;
  }

  let lastMove = '';
  let pos = 0, guard = 0, noOrder = false;
  const pump = () => {
    const raw = battle.log.slice(pos); pos = battle.log.length;
    const lines = [];
    for (let i = 0; i < raw.length; i++) { if (raw[i].startsWith('|split|')) { lines.push(raw[i + 1]); i += 2; } else lines.push(raw[i]); }
    for (let i = 0; i < lines.length;) {
      const l = lines[i];
      if (DEBUG && DEBUG[0] === n && (battle.turn === DEBUG[1] || battle.turn === DEBUG[1] + 1)) console.log('   ', l);
      if (/Quick Claw|Quick Draw|Custap/.test(l)) noOrder = true;
      if (l.startsWith('|move|')) { const j = handleMove(lines, i); if (DEBUG && DEBUG[0] === n && process.env.RAW) console.log(lines.slice(i + 1, j).map(x => '      ' + x).join('\n')); i = j; continue; }
      apply(l);
      if (l.startsWith('|upkeep')) { T.cur = 'ターン終了時'; T.afterUpkeep = true; }
      if (T.afterUpkeep && /^\|(switch|drag)\|/.test(l)) (T.lateIn ||= new Set()).add(`${sideOf(l.split('|')[2].slice(0, 2))}${idxOf(l.split('|')[2].slice(0, 2), l.split('|')[2])}`);
      if (l.startsWith('|turn|')) {
        const firstTurn = l === '|turn|1';
        // ターン終了時の処理: 実際の「処理前」のHPにそろえてから、アプリの候補と実際に起きたことを比べ、起きたものを選んで締める
        sync(lastMove); lastMove = '';
        const firstOf = new Map();
        for (const r of resSeen) { const k = `${r.side}${r.mon}`; if (!firstOf.has(k)) firstOf.set(k, r); }
        for (const r of firstOf.values()) { const c = b.state.mons[r.side][r.mon]; c.hp = seen(r.side, r.prev); c.fainted = c.hp <= 0; }
        let cands = [];
        try { cands = residualCandidates(b, usage); } catch (e) { stats.crashes.push(`residual 対戦${n}: ${e.message}`); }
        const pick = [];
        const nm = (sd, mi) => `${dex.species[sets[sd === 'me' ? 'p1' : 'p2'][mi].species].j}/${dex.abilities[sets[sd === 'me' ? 'p1' : 'p2'][mi].ability]?.j}/${dex.items[sets[sd === 'me' ? 'p1' : 'p2'][mi].item]?.j || 'なし'}`;
        for (const r of resSeen) {
          const c = cands.find(x => x.side === r.side && x.mon === r.mon && x.key === r.key);
          if (!c) { bump(stats.resMissing, `${r.key} (${nm(r.side, r.mon)})`); if (process.env.RM) console.log('RM', r.key, nm(r.side, r.mon), 'appItem=' + (r.side === 'opp' ? b.opp[r.mon].item : b.my[r.mon].item), `対戦${n} T${battle.turn}`, JSON.stringify(b.state.mons[r.side][r.mon]).slice(0, 160), b.state.field.weather, b.state.field.terrain); continue; }
          if (!pick.includes(c)) pick.push(c);
        }
        for (const c of cands) if (!firstTurn && c.checked && !T.lateIn?.has(`${c.side}${c.mon}`) && !resSeen.some(r => r.side === c.side && r.mon === c.mon && r.key === c.key)) { bump(stats.resFalse, `${c.key} (${nm(c.side, c.mon)})`); if (process.env.RF) console.log('RF', c.key, nm(c.side, c.mon), `対戦${n} T${battle.turn}`, b.state.mons[c.side][c.mon].hp, T[c.side].mons[c.mon].hp); }
        try { finishTurn(b, usage, {residual: pick, noOrder}); } catch (e) { stats.crashes.push(`finishTurn 対戦${n}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
        for (const r of resSeen) {
          const last = resSeen.filter(x => x.side === r.side && x.mon === r.mon).pop();
          if (last !== r) continue;
          const app = b.state.mons[r.side][r.mon].hp;
          const tol = r.side === 'me' ? 1.2 : 1.6;
          if (pick.some(c => c.side === r.side && c.mon === r.mon) && Math.abs(app - r.hp) > tol + (resSeen.filter(x => x.side === r.side && x.mon === r.mon).length > 1 ? 1 : 0)) stats.resHp.push(`${r.side} ${dex.species[sets[r.side === 'me' ? 'p1' : 'p2'][r.mon].species].j} ${resSeen.filter(x => x.side === r.side && x.mon === r.mon).map(x => x.key).join('+')}: アプリ ${app.toFixed(1)}% / 実際 ${r.hp.toFixed(1)}% [対戦${n} T${battle.turn}]`);
          else stats.resOk++;
        }
        resSeen = []; T.afterUpkeep = false; T.lateIn = null;
        sync(false);
        noOrder = false; stats.turns++;
        // 素早さ推定の健全性
        t2.forEach((real, oi) => {
          const k = b.opp[oi].speOk; if (!k) return;
          const c = comboOf(natureMod(real.nature, 'spe'), real.sp[5]);
          const scarf = real.item === 'choicescarf' && !b.opp[oi].speOk.merged;
          if ((scarf ? k.scarf : k.plain)[c] !== '1') { const lt = b.turns[b.turns.length - 1]; stats.speedUnsound.push(`${lt.acts.map(a => `${a.side}:${a.type === 'move' ? a.move : 'sw'}${a.flags?.miss ? '(miss)' : ''}`).join(' → ')} | 自分 ${lt.acts.find(a => a.side === 'me')?.sp} TR:${lt.before?.state.field.trickRoom} | ${dex.species[real.species].j} (${real.nature} S${real.sp[5]} ${dex.items[real.item]?.j || 'なし'}/${dex.abilities[real.ability].j}) [対戦${n} T${battle.turn}]`); b.opp[oi].speOk = null; b.opp[oi].scarfLikely = false; }
        });
        // 画面が使う計算をひととおり呼んで、例外が出ないことを確かめる
        const ctx = boardContext(b, usage);
        for (const side of ['me', 'opp']) for (const idx of b.state.sides[side].active) if (idx != null) { attackTable(ctx, side, idx, {includeStatus: true}); stats.tableCalls++; }
        b.opp.forEach((o, oi) => estimateStats(o, b.state.mons.opp[oi].forme || o.species));
      }
      i++;
    }
  };
  pump();
  while (!battle.ended && guard++ < 400 && battle.turn < 80) {
    for (const sid of ['p1', 'p2']) {
      const c = choose(battle, sid);
      if (c) { try { if (!battle.choose(sid, c)) battle.choose(sid, 'default'); } catch { battle.choose(sid, 'default'); } }
    }
    pump();
  }
  // 入れ直し (記録の修正時の処理) が例外なく動き、2回やっても同じ結果になるか
  try {
    const r1 = clone(b); replay(r1, usage); const r2 = clone(r1); replay(r2, usage);
    const key = x => JSON.stringify({m: x.state.mons, f: x.state.field, s: x.state.sides, o: x.opp.map(o => [o.item, o.ability, o.moves, o.statOk, o.speOk])});
    if (key(r1) !== key(r2)) stats.replayBad.push(`対戦${n}: 2回の入れ直しで結果が違う`);
  } catch (e) { stats.replayBad.push(`対戦${n}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
  stats.battles++;
}

for (let n = 0; n < N; n++) {
  try { runOne(n); } catch (e) { stats.crashes.push(`対戦${n}: ${e.stack.split('\n').slice(0, 4).join(' | ')}`); }
}
const top = (o, k = 25) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, v]) => `  ${v}件  ${x}`).join('\n');
console.log(`対戦 ${stats.battles} / ターン ${stats.turns} / 行動 ${stats.acts} / ダメージからの推定 ${stats.infer} / 盤面計算 ${stats.tableCalls}`);
console.log(`例外: ${stats.crashes.length}`); console.log(stats.crashes.slice(0, 8).join('\n'));
console.log(`推定が本当の配分を外した: ${stats.unsound.length}`); console.log(stats.unsound.slice(0, 25).join('\n'));
console.log(`説明がつかなかった: ${stats.unexplained.length}`); console.log(stats.unexplained.slice(0, 25).join('\n'));
console.log(`素早さ推定が本当の値を外した: ${stats.speedUnsound.length}`); console.log(stats.speedUnsound.slice(0, 15).join('\n'));
console.log(`ターン終了時の処理: HPが合った ${stats.resOk} / ずれた ${stats.resHp.length}`); console.log(stats.resHp.slice(0, 12).join('\n'));
console.log('ターン終了時の処理で候補に出なかったもの:'); console.log(top(stats.resMissing, 15));
console.log('確実として出したのに起きなかったもの:'); console.log(top(stats.resFalse, 15));
console.log(`入れ直しの不具合: ${stats.replayBad.length}`); console.log(stats.replayBad.slice(0, 8).join('\n'));
console.log('自動反映のずれ (多い順):'); console.log(top(stats.mismatch));
process.exit(stats.crashes.length ? 1 : 0);
