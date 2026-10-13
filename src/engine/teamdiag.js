// 構築診断: タイプ相性から見た受け (半減で受けられるか) と攻め (弱点を突けるか)
import {dex, TYPES, typeEffect} from './dex.js';
import {megaFormeFor} from './dex.js';

// 受ける側の特性によるタイプ相性の変化 (倍率をかける。0 は無効)
const DEF_ABILITY = {
  levitate: {Ground: 0}, eartheater: {Ground: 0},
  flashfire: {Fire: 0}, wellbakedbody: {Fire: 0},
  waterabsorb: {Water: 0}, stormdrain: {Water: 0}, dryskin: {Water: 0, Fire: 1.25},
  voltabsorb: {Electric: 0}, lightningrod: {Electric: 0}, motordrive: {Electric: 0},
  sapsipper: {Grass: 0},
  thickfat: {Fire: 0.5, Ice: 0.5}, heatproof: {Fire: 0.5}, waterbubble: {Fire: 0.5},
  purifyingsalt: {Ghost: 0.5}, fluffy: {Fire: 2},
};
// 弱点のダメージを下げる特性 (弱点ではあるが、表示で添える)
const FILTER = new Set(['filter', 'solidrock', 'prismarmor']);
// 技のタイプを変える特性 (ノーマル技が別のタイプになる)
const ATE = {aerilate: 'Flying', pixilate: 'Fairy', refrigerate: 'Ice', galvanize: 'Electric', dragonize: 'Dragon'};

/** 実際に戦うときの姿 (メガストーンを持っていればメガシンカ後) */
export function battleForm(build) {
  if (build.__types) return {sid: build.species, types: build.__types, ability: '', mega: false};
  const mega = megaFormeFor(build.species, build.item);
  const sid = mega || build.species;
  const s = dex.species[sid];
  return {sid, types: s?.t || [], ability: s?.mega ? s.ab[0] : build.ability || s?.ab?.[0] || '', mega: !!mega};
}

/** 受ける倍率 (特性込み)。ふうせん もじめん無効として扱う */
export function defMultiplier(atkType, types, ability, item) {
  let m = typeEffect(atkType, types);
  const a = DEF_ABILITY[ability];
  if (a && a[atkType] != null) m *= a[atkType];
  if (item === 'airballoon' && atkType === 'Ground') m = 0;
  return m;
}

/** 攻撃技の実際のタイプと、相手のタイプへの倍率 */
function moveEffect(moveId, atkAbility, defTypes, defAbility) {
  const mv = dex.moves[moveId];
  if (!mv || mv.c === 'Z' || !mv.bp) return null;
  let type = mv.t;
  if (atkAbility === 'normalize') type = 'Normal';
  else if (type === 'Normal' && ATE[atkAbility]) type = ATE[atkAbility];
  if (atkAbility === 'liquidvoice' && mv.fl?.includes('sound')) type = 'Water';
  let m;
  if (moveId === 'freezedry') m = typeEffect('Ice', defTypes.filter(t => t !== 'Water')) * (defTypes.includes('Water') ? 2 : 1);
  else if (moveId === 'flyingpress') m = typeEffect('Fighting', defTypes) * typeEffect('Flying', defTypes);
  else if (moveId === 'thousandarrows' && defTypes.includes('Flying')) m = typeEffect('Ground', defTypes.filter(t => t !== 'Flying'));
  else m = typeEffect(type, defTypes);
  // きもったま・しんがん: ノーマル・かくとうがゴーストに当たる
  if (m === 0 && (atkAbility === 'scrappy' || atkAbility === 'mindseye') && (type === 'Normal' || type === 'Fighting') && defTypes.includes('Ghost')) m = typeEffect(type, defTypes.filter(t => t !== 'Ghost'));
  // かたやぶり等は受ける側の特性を無視する
  const ignore = ['moldbreaker', 'teravolt', 'turboblaze', 'myceliummight'].includes(atkAbility);
  if (!ignore && defAbility) {
    const a = DEF_ABILITY[defAbility];
    if (a && a[type] != null) m *= a[type];
  }
  return {type, m};
}

/**
 * 受けの診断: タイプごとに、だれがどれだけで受けるか
 * 戻り値: {rows: [{type, mult: [各ポケモンの倍率], best, weak: 弱点の数}], notResisted: [半減以下で受けられないタイプ]}
 */
export function defenseReport(team) {
  const forms = team.map(b => ({b, f: battleForm(b)}));
  const rows = TYPES.map(type => {
    const mult = forms.map(({b, f}) => defMultiplier(type, f.types, f.ability, b.item));
    return {type, mult, best: Math.min(...mult), weak: mult.filter(x => x > 1).length, filter: forms.map(({f}) => FILTER.has(f.ability))};
  });
  return {forms, rows, notResisted: rows.filter(r => r.best > 0.5).map(r => r.type)};
}

/** 構築の攻撃技 (使い手つき) */
function attackers(team) {
  const out = [];
  for (const b of team) {
    const f = battleForm(b);
    for (const m of b.moves || []) if (dex.moves[m] && dex.moves[m].c !== 'Z' && dex.moves[m].bp) out.push({sp: b.species, move: m, ability: f.ability});
  }
  return out;
}

/** ゲームにいるタイプの組み合わせ (単タイプも含む) と、その例のポケモン */
export function existingTypeCombos() {
  const map = new Map();
  for (const [id, s] of Object.entries(dex.species)) {
    if (id === 'aegislashboth') continue;
    const key = [...s.t].sort().join('/');
    if (!map.has(key)) map.set(key, {types: [...s.t].sort(), examples: []});
    const e = map.get(key);
    if (e.examples.length < 3 && !e.examples.some(x => dex.species[x].j === s.j)) e.examples.push(id);
  }
  return [...map.values()];
}

/**
 * 攻めの診断: 全部の組み合わせ (タイプのみ) に対して、弱点を突ける技があるか
 * 戻り値: {combos: [{types, examples, best: {m, sp, move, type}}], notHit: [弱点を突けない組み合わせ]}
 */
export function offenseReport(team) {
  const atk = attackers(team);
  const combos = existingTypeCombos().map(c => {
    let best = {m: -1};
    for (const a of atk) { const e = moveEffect(a.move, a.ability, c.types, ''); if (e && e.m > best.m) best = {m: e.m, sp: a.sp, move: a.move, type: e.type}; }
    return {...c, best};
  });
  combos.sort((a, b) => a.best.m - b.best.m || a.types.length - b.types.length);
  return {combos, notHit: combos.filter(c => c.best.m < 2), moves: atk.length};
}

/**
 * 使用率上位のポケモンに弱点を突けるか (相手のいちばん多い特性込み)
 * usage: 使用率データ。メガは別の項目として数える
 */
export function topReport(team, usage, n = 30) {
  const atk = attackers(team);
  const list = Object.entries(usage?.pokemon || {}).filter(([id]) => dex.species[id]).sort((a, b) => (b[1].u || 0) - (a[1].u || 0)).slice(0, n);
  return list.map(([id, d], i) => {
    const s = dex.species[id];
    const ability = s.mega ? s.ab[0] : (d.ab?.[0]?.[0] || s.ab[0] || '');
    const item = (d.it?.[0]?.[1] || 0) >= 0.5 ? d.it[0][0] : '';
    let best = {m: -1};
    for (const a of atk) {
      const e = moveEffect(a.move, a.ability, s.t, ability);
      if (!e) continue;
      let m = e.m;
      if (item === 'airballoon' && e.type === 'Ground') m = 0;
      if (m > best.m) best = {m, sp: a.sp, move: a.move, type: e.type};
    }
    return {rank: i + 1, id, u: d.u, ability, item, types: s.t, best};
  });
}

// ---- おすすめ (構築に足すと穴が埋まるタイプ・ポケモン) ----

// タイプごとの代表の攻撃技 (タイプ一致技として使う)
let repMove = null;
function repMoveOf(type) {
  if (!repMove) {
    repMove = {};
    for (const [id, m] of Object.entries(dex.moves)) {
      if (m.c === 'Z' || !m.bp || m.bp < 60 || ['freezedry', 'flyingpress', 'thousandarrows'].includes(id)) continue;
      if (!repMove[m.t] || m.bp > dex.moves[repMove[m.t]].bp) repMove[m.t] = id;
    }
  }
  return repMove[type];
}

/** 構築の穴の大きさ (小さいほどよい) と、その内訳 */
export function teamScore(team, usage, n = 100) {
  const d = defenseReport(team), o = offenseReport(team), t = topReport(team, usage, n);
  const topMiss = t.filter(x => x.best.m < 2);
  const stack = d.rows.filter(r => r.weak >= 3).map(r => r.type);
  const score = 3 * d.notResisted.length + 2 * stack.length + o.notHit.length + 1.5 * topMiss.length;
  return {score, notResisted: d.notResisted, stack, notHit: o.notHit, topMiss};
}

function diffText(base, next) {
  const gain = [], loss = [];
  const fixedRes = base.notResisted.filter(x => !next.notResisted.includes(x));
  const newRes = next.notResisted.filter(x => !base.notResisted.includes(x));
  const key = c => c.types.join('/');
  const fixedHit = base.notHit.filter(c => !next.notHit.some(x => key(x) === key(c)));
  const newHit = next.notHit.filter(c => !base.notHit.some(x => key(x) === key(c)));
  const fixedTop = base.topMiss.filter(c => !next.topMiss.some(x => x.id === c.id));
  const newTop = next.topMiss.filter(c => !base.topMiss.some(x => x.id === c.id));
  const fixedStack = base.stack.filter(x => !next.stack.includes(x));
  const newStack = next.stack.filter(x => !base.stack.includes(x));
  return {fixedRes, newRes, fixedHit, newHit, fixedTop, newTop, fixedStack, newStack};
}

/**
 * おすすめのタイプ (複合を含む、ゲームにいる組み合わせだけ)
 * replace: 入れ替える枠の番号 (-1 なら足すだけ = 7体目として評価)
 */
export function recommendTypes(team, usage, {replace = -1, n = 100, limit = 10} = {}) {
  const rest = team.filter((_, i) => i !== replace);
  const base = teamScore(rest, usage, n);
  const top = topIds(usage, n);
  const out = existingTypeCombos().map(c => {
    const moves = c.types.map(repMoveOf).filter(Boolean);
    const sid = c.examples[0];
    const fake = {species: sid, ability: '__none', item: '', moves, __types: c.types};
    const next = teamScore([...rest, fake], usage, n);
    const ex = top.filter(id => [...dex.species[id].t].sort().join('/') === c.types.join('/'));
    return {types: c.types, score: next.score, gain: base.score - next.score, examples: ex.length ? ex : c.examples, inTop: ex.length > 0, diff: diffText(base, next)};
  });
  out.sort((a, b) => b.gain - a.gain || b.inTop - a.inTop);
  return {base, list: out.slice(0, limit)};
}

function topIds(usage, n) {
  return Object.entries(usage?.pokemon || {}).filter(([id]) => dex.species[id]).sort((a, b) => (b[1].u || 0) - (a[1].u || 0)).slice(0, n).map(([id]) => id);
}

/** 使用率データからそのポケモンのよくある型 (特性・持ち物・技) */
export function commonBuild(id, usage) {
  const d = usage?.pokemon?.[id] || {};
  const s = dex.species[id];
  const moves = (d.mv || []).map(([m]) => m).filter(m => dex.moves[m]).slice(0, 4);
  if (s.mega) return {species: s.mega, item: s.stone, ability: '', moves};
  return {species: id, item: d.it?.[0]?.[0] || '', ability: d.ab?.[0]?.[0] || s.ab[0], moves};
}

/** 使用率上位からのおすすめのポケモン (よくある型で入れたときに穴がどれだけ埋まるか) */
export function recommendMons(team, usage, {replace = -1, n = 100, pool = 100, limit = 12, mega = true} = {}) {
  const rest = team.filter((_, i) => i !== replace);
  const base = teamScore(rest, usage, n);
  const have = new Set(rest.map(b => dex.species[b.species]?.j));
  const out = [];
  for (const id of topIds(usage, pool)) {
    const s = dex.species[id];
    if (have.has(s.j) || have.has(dex.species[s.mega || '']?.j)) continue;
    if (!mega && s.mega) continue;
    const b = commonBuild(id, usage);
    const next = teamScore([...rest, b], usage, n);
    out.push({id, build: b, score: next.score, gain: base.score - next.score, diff: diffText(base, next)});
  }
  out.sort((a, b) => b.gain - a.gain);
  return {base, list: out.slice(0, limit)};
}

/** 構築にメガストーンを持つポケモンが何体いるか (メガシンカは1試合に1体だけ) */
export const megaCount = team => team.filter(b => megaFormeFor(b.species, b.item)).length;
