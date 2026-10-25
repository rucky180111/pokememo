import {dex, SP_MAX, SP_TOTAL} from './dex.js';
import {newTeam, newBuild} from './battle.js';

const norm = s => String(s).normalize('NFKC').trim().toLowerCase().replace(/[\s・･_（）()'-]/g, '').replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
const aliases = {
  team: ['構築','構築名','パーティ','パーティ名','team','teamname'],
  species: ['ポケモン','ポケモン名','species','pokemon'],
  item: ['持ち物','もちもの','item'], ability: ['特性','とくせい','ability'], nature: ['性格','せいかく','nature'],
  hp: ['H','HP'], atk: ['A','atk'], def: ['B','def'], spa: ['C','spa'], spd: ['D','spd'], spe: ['S','spe'],
  move1: ['技1','わざ1','move1'], move2: ['技2','わざ2','move2'], move3: ['技3','わざ3','move3'], move4: ['技4','わざ4','move4'],
  note: ['メモ','note'],
};
const headers = new Map(Object.entries(aliases).flatMap(([k, a]) => a.map(v => [norm(v), k])));
const indexes = {};
function resolve(kind, value) {
  if (!indexes[kind]) {
    const map = new Map();
    for (const [id, d] of Object.entries(dex[kind])) for (const name of [id, d.j, d.n].filter(Boolean)) {
      const key = norm(name), ids = map.get(key) || new Set(); ids.add(id); map.set(key, ids);
    }
    indexes[kind] = map;
  }
  const ids = indexes[kind].get(norm(value));
  return ids?.size === 1 ? [...ids][0] : null;
}

// RFC 4180の引用符・セル内改行と、表計算からコピーしたタブ区切りを扱う。
export function readTable(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = text.split('\n')[0];
  const separator = first.includes('\t') ? '\t' : ',';
  const rows = []; let cells = [], value = '', quoted = false, closed = false, line = 1, start = 1;
  const cell = () => { cells.push(value); value = ''; closed = false; };
  const row = () => { cell(); if (cells.some(x => x.trim())) rows.push({cells, line: start}); cells = []; start = line + 1; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else { value += c; if (c === '\n') line++; }
    } else if (c === separator) cell();
    else if (c === '\n') { row(); line++; }
    else if (c === '"' && !value && !closed) quoted = true;
    else if (c === '"' || (closed && c.trim())) throw new Error(`${line}行目: 引用符の位置を確認してください`);
    else if (!closed) value += c;
  }
  if (quoted) throw new Error(`${start}行目: 引用符が閉じていません`);
  row();
  return rows;
}

export function parseTeamCSV(text) {
  const errors = [], teams = [];
  let rows;
  try { rows = readTable(text); } catch (e) { return {teams, errors: [e.message]}; }
  if (!rows.length) return {teams, errors: ['見出しとポケモンの行を入力してください']};
  const cols = rows[0].cells.map(x => headers.get(norm(x)));
  rows[0].cells.forEach((x, i) => { if (!cols[i]) errors.push(`見出し「${x}」は使えません。テンプレートの見出しを使ってください`); });
  if (!cols.includes('species')) errors.push('「ポケモン」列が必要です');
  if (new Set(cols).size !== cols.length) errors.push('同じ列が重複しています');
  if (errors.length) return {teams, errors};
  const grouped = new Map(); let lastName = 'CSVから追加';
  for (const row of rows.slice(1)) {
    const fail = msg => errors.push(`${row.line}行目: ${msg}`);
    if (row.cells.length !== cols.length) { fail(`列数が見出しと異なります（${cols.length}列必要、${row.cells.length}列あります）`); continue; }
    const d = Object.fromEntries(cols.map((k, i) => [k, row.cells[i].trim()]));
    const name = d.team || lastName; lastName = name;
    let team = grouped.get(name);
    if (!team) { team = newTeam('single'); team.name = name; grouped.set(name, team); teams.push(team); }
    const species = resolve('species', d.species);
    if (!species) { fail(`ポケモン「${d.species}」が見つかりません。フォルム名まで入力してください`); continue; }
    const b = newBuild(species);
    for (const [key, kind, label] of [['item','items','持ち物'],['ability','abilities','特性'],['nature','natures','性格']]) {
      if (!d[key]) continue;
      const id = resolve(kind, d[key]);
      if (!id) fail(`${label}「${d[key]}」が見つかりません`); else b[key] = id;
    }
    if (b.ability && !dex.species[species].ab.includes(b.ability)) fail(`${d.species}は特性「${d.ability}」を持てません`);
    for (const [i, key] of ['hp','atk','def','spa','spd','spe'].entries()) {
      if (!d[key]) continue;
      const v = Number(d[key].normalize('NFKC'));
      if (!Number.isInteger(v) || v < 0 || v > SP_MAX) fail(`${['H','A','B','C','D','S'][i]}は0〜${SP_MAX}の整数で入力してください`);
      else b.sp[i] = v;
    }
    if (b.sp.reduce((a, v) => a + v, 0) > SP_TOTAL) fail(`能力Ptの合計は${SP_TOTAL}以下にしてください`);
    for (let i = 1; i <= 4; i++) {
      if (!d[`move${i}`]) continue;
      const id = resolve('moves', d[`move${i}`]);
      if (!id) fail(`技「${d[`move${i}`]}」が見つかりません`);
      else if (b.moves.includes(id)) fail(`技「${d[`move${i}`]}」が重複しています`);
      else b.moves.push(id);
    }
    b.note = d.note || ''; team.mons.push(b);
    if (team.mons.length > 6) fail(`「${name}」は6体までです。別パーティは構築名を変えてください`);
  }
  if (!rows.slice(1).length) errors.push('ポケモンを1体以上入力してください');
  return {teams, errors};
}

export const TEAM_CSV_TEMPLATE = '構築名,ポケモン,持ち物,特性,性格,H,A,B,C,D,S,技1,技2,技3,技4,メモ\r\nサンプル構築,ガブリアス,きあいのタスキ,さめはだ,ようき,2,32,0,0,0,32,じしん,ドラゴンクロー,つるぎのまい,がんせきふうじ,先発候補\r\nサンプル構築,カイリュー,たべのこし,マルチスケイル,いじっぱり,32,32,0,0,0,2,しんそく,じしん,りゅうのまい,はねやすめ,\r\n';
