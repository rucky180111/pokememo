// 選出ルール: 構築ごとに「相手の6体にこれがいたら、この3体をこの順で出す」を優先順位つきで持つ。
// 上から順に調べ、最初に当てはまった行を使う。
//
// 条件の書き方 (1行=1ルール):
//   ルカリオ                       … ルカリオがいる
//   ルカリオ+エースバーン           … 両方いる (+ は「かつ」)
//   ルカリオ+ヒスイヌメルゴン|エースバーン … ルカリオがいて、ヌメルゴン(ヒスイ)かエースバーンのどちらかがいる (| は「または」、+ より先にまとまる)
//   ゲンガー-フラエッテ             … ゲンガーがいて、フラエッテはいない (- は「いない」)
//   2体以上:ドヒドイデ|エアームド|ブラッキー … 並べたうちの2体以上がいる
//   ゴーストタイプ                  … ゴーストタイプがいる (「〇〇タイプ」でタイプ指定)
//   エースバーン / グソクムシャ+ガブリアス … / で区切ると「どちらかの条件を満たす」
//   * (または空)                     … どれにも当てはまらないとき (既定)
// 一括入力の1行:  条件 => 先発, 2体目, 3体目 # メモ (勝率など)
import {dex, TYPE_JA, baseSpeciesId} from './dex.js';

const norm = s => String(s || '').normalize('NFKC').replace(/[\s　・]/g, '').replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).toLowerCase();

// 種族名の索引: 正式名 (例: ヌメルゴン(ヒスイ)) に加えて、かっこを外した名前 (ヌメルゴン)・地方名を前に置いた名前 (ヒスイヌメルゴン) でも引ける。
// かっこを外した名前は同名の種族と姿をまとめて指す (フラエッテ → フラエッテ と フラエッテ(えいえん))
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = new Map();
  const add = (k, id) => { const n = norm(k); if (!n) return; if (!INDEX.has(n)) INDEX.set(n, new Set()); INDEX.get(n).add(id); };
  for (const [id, s] of Object.entries(dex.species)) {
    if (!s.j) continue;
    if (s.mega) { add(s.j, s.mega); continue; } // メガ〇〇 と書かれても元の種族
    add(s.j, id);
    const m = /^(.+?)[(（](.+?)[)）]$/.exec(s.j);
    if (m) { add(m[2] + m[1], id); add(m[1] + m[2], id); add(m[1], id); }
  }
  return INDEX;
}
const TYPE_BY_JA = Object.fromEntries(Object.entries(TYPE_JA).map(([en, ja]) => [norm(ja), en]));

// 名前 → 種族IDの一覧 (見つからなければ空)
export function resolveAll(name) { return [...(index().get(norm(name)) || [])]; }
// 名前 → 代表の種族ID (正式名と完全に一致するものを優先)
export function resolveSpecies(name) {
  const ids = resolveAll(name);
  if (!ids.length) return null;
  return ids.find(id => norm(dex.species[id]?.j) === norm(name)) || ids[0];
}

// 条件の文字列 → 構文木。読めなかった名前は errors に入れる
export function parseCond(text) {
  const errors = [];
  const src = String(text || '').trim();
  if (!src || src === '*' || src === '＊' || /^(既定|その他|どれにも)/.test(src)) return {any: true, alts: [], errors};
  const atom = raw => {
    const s = raw.trim();
    const t = /^(.+?)タイプ$/.exec(s);
    if (t && TYPE_BY_JA[norm(t[1])]) return {type: TYPE_BY_JA[norm(t[1])], name: s};
    const ids = resolveAll(s);
    if (!ids.length) { errors.push(`「${s}」が見つかりません`); return null; }
    return {species: ids, show: resolveSpecies(s), name: s};
  };
  const alts = src.split(/\s*(?:\/|／|\bor\b)\s*/).filter(Boolean).map(clause => {
    const terms = [];
    // + と - で区切る (- は直後の項を否定)。名前の中の - (ポリゴン-Z など) は無いので単純に区切る
    const parts = clause.split(/(?=[+＋\-－])/).map(x => x.trim()).filter(Boolean);
    for (let p of parts) {
      let neg = false;
      if (/^[+＋]/.test(p)) p = p.slice(1).trim();
      if (/^[\-－]/.test(p)) { neg = true; p = p.slice(1).trim(); }
      let min = 1;
      const c = /^(\d+)\s*体以上\s*[:：]\s*(.+)$/.exec(p);
      if (c) { min = Number(c[1]); p = c[2]; }
      const any = p.split(/[|｜]/).map(atom).filter(Boolean);
      if (any.length) terms.push({neg, min, any});
    }
    return terms;
  }).filter(t => t.length);
  return {any: false, alts, errors};
}

// 当てはまる相手の頭数 (同じ1体が複数の名前に当たっても1体と数える。メガの姿は元の種族としても見る)
const countHits = (any, mons) => mons.filter(o => {
  const ids = [o, baseSpeciesId(o)];
  const types = dex.species[o]?.t || [];
  return any.some(a => (a.type ? types.includes(a.type) : a.species.some(id => ids.includes(id))));
}).length;
// 相手の種族ID一覧が条件を満たすか
export function condMatches(cond, oppSpecies) {
  if (cond.any) return true;
  const mons = [...new Set(oppSpecies.filter(Boolean))];
  return cond.alts.some(terms => terms.every(t => {
    const n = countHits(t.any, mons);
    return t.neg ? n === 0 : n >= t.min;
  }));
}

// rules: [{cond: '条件の文字列', pick: [種族ID...], note}]。最初に当てはまったものを返す
export function matchRule(rules, oppSpecies) {
  if (!rules?.length || !oppSpecies?.filter(Boolean).length) return null;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const c = parseCond(r.cond);
    if (c.errors.length && !c.alts.length && !c.any) continue;
    if (condMatches(c, oppSpecies)) return {index: i, rule: r};
  }
  return null;
}

// ルールの選出 (種族ID) → 自分の手持ちの番号。同じ種族が2体いれば先の方から
export function pickIndexes(pick, myMons) {
  const used = new Set();
  const out = [];
  for (const sid of pick || []) {
    const i = myMons.findIndex((m, k) => !used.has(k) && m && (m.species === sid || baseSpeciesId(m.species) === baseSpeciesId(sid)));
    if (i >= 0) { used.add(i); out.push(i); }
  }
  return out;
}

// 構築の中から名前でポケモンを探す。正式名・メガの名前のほか、先頭の一部 (ガブ → ガブリアス、ガブZ → メガガブリアスZ) でも引ける
export function teamSpecies(name, teamMons) {
  const q = norm(name);
  if (!q) return null;
  const namesOf = t => {
    const s = dex.species[t.species];
    const out = [s?.j];
    for (const f of s?.megas || []) if (dex.species[f]?.stone === t.item) out.push(dex.species[f].j, dex.species[f].j.replace(/^メガ/, ''));
    return out.filter(Boolean).map(norm);
  };
  const exact = teamMons.find(t => namesOf(t).includes(q));
  if (exact) return exact.species;
  const ids = resolveAll(name);
  const byId = teamMons.find(t => ids.includes(t.species) || ids.includes(baseSpeciesId(t.species)));
  if (byId) return byId.species;
  // 略称: 「ガブZ」= ガブ…Z のように、先頭と末尾が合う名前 / 先頭が合う名前がひとつだけ
  const loose = teamMons.filter(t => namesOf(t).some(n => n.startsWith(q) || (q.length >= 2 && n.startsWith(q.slice(0, -1).replace(/^メガ/, '')) && n.endsWith(q.slice(-1)))));
  return loose.length === 1 ? loose[0].species : null;
}

// 一括入力: 1行 = 「条件 => ポケモン, ポケモン, ポケモン # メモ」。teamMons の名前で選出を引く
export function parseRulesText(text, teamMons) {
  const rules = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((line, n) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('//')) return;
    const [body, ...memo] = raw.split(/\s*[#＃]\s*/);
    const m = /^(.*?)\s*(?:=>|＝＞|→)\s*(.+)$/.exec(body);
    if (!m) { errors.push(`${n + 1}行目: 「=>」で条件と選出を区切ってください`); return; }
    const cond = m[1].trim() || '*';
    const pc = parseCond(cond);
    pc.errors.forEach(e => errors.push(`${n + 1}行目: ${e}`));
    const pick = [];
    for (const nm of m[2].split(/\s*(?:,|、|，|→|->)\s*/).filter(Boolean)) {
      const sid = teamSpecies(nm, teamMons);
      if (!sid) errors.push(`${n + 1}行目: 「${nm}」は構築にいません`);
      else pick.push(sid);
    }
    rules.push({cond, pick, note: memo.join(' # ').trim()});
  });
  return {rules, errors};
}

// ルール一覧 → 一括入力の文字列 (書き出し用)
export function rulesToText(rules) {
  const nm = id => dex.species[id]?.j || id;
  return (rules || []).map(r => `${r.cond || '*'} => ${(r.pick || []).map(nm).join(', ')}${r.note ? ` # ${r.note}` : ''}`).join('\n');
}
