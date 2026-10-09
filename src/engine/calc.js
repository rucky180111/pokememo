// ダメージ計算・素早さ計算。計算式そのものは @smogon/calc のチャンピオンズ用実装に任せ、
// ここではアプリのデータ (構築・盤面の状態) を計算機の入力に変換し、結果を日本語表示用に整える。
import calcPkg from '@smogon/calc';
import utilPkg from '@smogon/calc/dist/mechanics/util.js';
import {dex, STAT_KEYS, clampSP, typeEffect} from './dex.js';

const {calculate, Generations, Pokemon, Move, Field} = calcPkg;
const {getFinalSpeed} = utilPkg;
export const gen = Generations.get(0); // 0 = Pokémon Champions

export const BOOST_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'];
export const emptyBoosts = () => ({atk: 0, def: 0, spa: 0, spd: 0, spe: 0});
export const newCond = () => ({hp: 100, status: '', boosts: emptyBoosts(), forme: null, itemGone: false, abilityOn: false, fainted: false});

export const WEATHERS = [['', 'なし'], ['Sun', 'はれ'], ['Rain', 'あめ'], ['Sand', 'すなあらし'], ['Snow', 'ゆき']];
export const TERRAINS = [['', 'なし'], ['Electric', 'エレキ'], ['Grassy', 'グラス'], ['Misty', 'ミスト'], ['Psychic', 'サイコ']];
export const STATUSES = [['', 'なし'], ['brn', 'やけど'], ['par', 'まひ'], ['psn', 'どく'], ['tox', 'もうどく'], ['slp', 'ねむり'], ['frz', 'こおり']];

// 現在の姿 (メガ・フォルム込み) の種族ID
export const currentSpecies = (build, cond) => (cond?.forme && dex.species[cond.forme] ? cond.forme : build.species);

// 現在の姿での特性。メガシンカ中はメガ側の特性に置き換わる。
export function currentAbility(build, cond) {
  const sid = currentSpecies(build, cond);
  const s = dex.species[sid];
  if (!s) return '';
  if (s.mega) return s.ab[0] || '';
  return build.ability || s.ab[0] || '';
}

export function toCalcPokemon(build, cond = newCond(), extra = {}) {
  const sid = currentSpecies(build, cond);
  const s = dex.species[sid];
  if (!s) throw new Error(`unknown species: ${sid}`);
  const evs = {};
  STAT_KEYS.forEach((k, i) => { evs[k] = clampSP(build.sp?.[i]); });
  const ability = currentAbility(build, cond);
  const itemId = cond.itemGone ? '' : build.item;
  const boosts = {};
  for (const k of BOOST_KEYS) boosts[k] = Math.max(-6, Math.min(6, cond.boosts?.[k] || 0));
  const p = new Pokemon(gen, s.n, {
    item: dex.items[itemId]?.n,
    ability: dex.abilities[ability]?.n,
    nature: dex.natures[build.nature] ? build.nature : 'Serious',
    evs, boosts,
    status: cond.status || '',
    toxicCounter: cond.status === 'tox' ? Math.max(1, cond.toxicCounter || 1) : 0,
    abilityOn: !!cond.abilityOn,
    alliesFainted: extra.alliesFainted || 0,
  });
  const max = p.maxHP();
  const pct = cond.hp == null ? 100 : Math.max(0, Math.min(100, cond.hp));
  p.originalCurHP = pct >= 100 ? max : Math.max(1, Math.min(max, Math.round((max * pct) / 100)));
  return p;
}

const sideFlags = (s = {}) => ({
  isReflect: !!s.reflect, isLightScreen: !!s.lightScreen, isAuroraVeil: !!s.auroraVeil,
  isTailwind: !!s.tailwind, isSR: !!s.sr, spikes: Math.max(0, Math.min(3, s.spikes || 0)),
});

// ctx: {format, field, atkSide, defSide, helpingHand, friendGuard, battery, powerSpot, steelySpirit, fairyAura, hazards}
export function toCalcField(ctx = {}) {
  const f = ctx.field || {};
  const atk = sideFlags(ctx.atkSide);
  const def = sideFlags(ctx.defSide);
  // 設置技のダメージは「交代で出てくる相手」への計算でのみ加味する
  if (!ctx.hazards) { def.isSR = false; def.spikes = 0; }
  atk.isSR = false; atk.spikes = 0;
  atk.isHelpingHand = !!ctx.helpingHand;
  atk.isBattery = !!ctx.battery;
  atk.isPowerSpot = !!ctx.powerSpot;
  atk.isSteelySpirit = !!ctx.steelySpirit;
  def.isFriendGuard = !!ctx.friendGuard;
  return new Field({
    gameType: ctx.format === 'double' ? 'Doubles' : 'Singles',
    weather: f.weather || undefined,
    terrain: f.terrain || undefined,
    isGravity: !!f.gravity,
    isMagicRoom: !!f.magicRoom,
    isWonderRoom: !!f.wonderRoom,
    isFairyAura: !!ctx.fairyAura,
    attackerSide: atk,
    defenderSide: def,
  });
}

// 連続技の既定ヒット数 (計算機の既定に合わせる: スキルリンクなら最大、それ以外の2〜5回技は3回)
export function defaultHits(moveId, abilityId) {
  const mh = dex.moves[moveId]?.mh;
  if (!mh) return 1;
  if (typeof mh === 'number') return mh;
  return abilityId === 'skilllink' ? mh[1] : mh[0] === 2 && mh[1] === 5 ? 3 : mh[1];
}
export function hitRange(moveId) {
  const mh = dex.moves[moveId]?.mh;
  if (!mh) return null;
  return typeof mh === 'number' ? [mh, mh] : mh;
}

function flatten(d) {
  if (typeof d === 'number') return [d];
  if (Array.isArray(d) && Array.isArray(d[0])) return null; // 親子愛など (ヒットごとの配列)
  return d;
}

export function koLabel(n, chance) {
  if (!n) return '';
  if (chance == null || chance >= 1) return `確定${n}発`;
  if (chance <= 0) return '';
  const pct = chance * 100;
  const txt = pct >= 99.95 ? '99.9' : pct < 0.1 ? '0.1' : pct.toFixed(1);
  return `乱数${n}発 (${txt}%)`;
}

/**
 * ダメージ計算。
 * attacker / defender: {build, cond}
 * opts: {crit, hits, singleTarget (ダブルで範囲技が1体にしか当たらない), ...ctx}
 */
export function calcDamage(attacker, defender, moveId, opts = {}) {
  const mv = dex.moves[moveId];
  if (!mv) return {ok: false, moveId, error: 'unknown move'};
  if (mv.c === 'Z') return {ok: true, moveId, status: true, min: 0, max: 0, minPct: 0, maxPct: 0, koText: '', n: 0};
  try {
    const atk = toCalcPokemon(attacker.build, attacker.cond, {alliesFainted: opts.atkAlliesFainted});
    const def = toCalcPokemon(defender.build, defender.cond, {alliesFainted: opts.defAlliesFainted});
    const field = toCalcField(opts);
    const moveOpts = {isCrit: !!opts.crit, ability: atk.ability, item: atk.item};
    if (opts.hits) moveOpts.hits = opts.hits;
    if (opts.singleTarget && mv.sp) moveOpts.overrides = {target: 'normal'};
    const move = new Move(gen, mv.n, moveOpts);
    const result = calculate(gen, atk, def, move, field);
    const [min, max] = result.range();
    const maxHP = def.maxHP();
    const curHP = def.curHP();
    let n = 0, chance = null;
    if (max > 0) {
      try {
        const ko = result.kochance(false);
        n = ko.n || 0;
        chance = ko.chance == null ? null : ko.chance;
      } catch { /* 下の概算に任せる */ }
      if (!n) n = Math.ceil(curHP / max);
    }
    const guaranteed = chance == null ? (min > 0 ? Math.ceil(curHP / min) === n : false) : chance >= 1;
    let koText = '';
    if (max > 0) {
      if (chance != null) koText = koLabel(n, chance);
      if (!koText) {
        const nMin = Math.ceil(curHP / max), nMax = min > 0 ? Math.ceil(curHP / min) : Infinity;
        koText = nMin === nMax ? `確定${nMin}発` : `${nMin}〜${Number.isFinite(nMax) ? nMax : '∞'}発`;
      }
    }
    const moveType = result.rawDesc?.moveType || result.move?.type || mv.t;
    let eff = typeEffect(moveType, def.types);
    if (moveId === 'freezedry' && def.types.includes('Water')) eff = typeEffect('Ice', def.types.filter(t => t !== 'Water')) * 2;
    if (moveId === 'flyingpress') eff = typeEffect('Fighting', def.types) * typeEffect('Flying', def.types);
    if (max === 0) eff = eff === 0 ? 0 : eff;
    let desc = '';
    try { desc = max > 0 ? result.desc() : ''; } catch { desc = ''; }
    return {
      ok: true, moveId, status: false,
      min, max,
      minPct: (min / maxHP) * 100, maxPct: (max / maxHP) * 100,
      rolls: flatten(result.damage),
      n, chance, guaranteed, koText,
      immune: max === 0,
      eff, moveType,
      defHP: curHP, defMaxHP: maxHP,
      atkSpecies: atk.name, defSpecies: def.name,
      hits: move.hits,
      desc,
    };
  } catch (e) {
    return {ok: false, moveId, error: String(e?.message || e)};
  }
}

// 場の補正込みの素早さ実数値 (こだわりスカーフ・おいかぜ・まひ・天候特性・ランク込み)
export function finalSpeed(mon, ctx = {}) {
  const p = toCalcPokemon(mon.build, mon.cond);
  const field = toCalcField({format: ctx.format, field: ctx.field});
  return getFinalSpeed(gen, p, field, {isTailwind: !!ctx.side?.tailwind});
}

// 技の優先度 (特性による変化込み)。grassyglide はグラスフィールドかつ接地時のみ +1 (接地は呼び出し側で判断)。
export function movePriority(moveId, abilityId, {hpFull = true, grassyTerrain = false} = {}) {
  const mv = dex.moves[moveId];
  if (!mv) return 0;
  let p = mv.pr || 0;
  if (abilityId === 'prankster' && mv.c === 'Z') p += 1;
  if (abilityId === 'galewings' && mv.t === 'Flying' && hpFull) p += 1;
  if (moveId === 'grassyglide' && grassyTerrain) p += 1;
  return p;
}

/**
 * 行動順の予測。a, b: {build, cond, moveId|null (null=交代), side}
 * 戻り値: 'a' | 'b' | 'tie'
 */
export function turnOrder(a, b, ctx = {}) {
  const pri = x => (x.moveId == null ? 99 : movePriority(x.moveId, currentAbility(x.build, x.cond), {
    hpFull: (x.cond?.hp ?? 100) >= 100, grassyTerrain: ctx.field?.terrain === 'Grassy',
  }));
  const pa = pri(a), pb = pri(b);
  if (pa !== pb) return pa > pb ? 'a' : 'b';
  const sa = finalSpeed(a, {format: ctx.format, field: ctx.field, side: a.side});
  const sb = finalSpeed(b, {format: ctx.format, field: ctx.field, side: b.side});
  if (sa === sb) return 'tie';
  const aFirst = ctx.field?.trickRoom ? sa < sb : sa > sb;
  return aFirst ? 'a' : 'b';
}

// 計算機と同じ乱数16段階で、ダメージ割合を1つの式から直接求めた基準値 (テストでの独立検証用)
export function referenceDamage({level = 50, power, atk, def, stab = 1, eff = 1, spread = false}) {
  const base = Math.floor(Math.floor((Math.floor((2 * level) / 5 + 2) * power * atk) / def) / 50) + 2;
  const roundHalfDown = x => (x % 1 > 0.5 ? Math.ceil(x) : Math.floor(x));
  const out = [];
  for (let r = 85; r <= 100; r++) {
    let d = spread ? roundHalfDown((base * 3072) / 4096) : base;
    d = Math.floor((d * r) / 100);
    if (stab !== 1) d = roundHalfDown((d * Math.round(stab * 4096)) / 4096);
    d = Math.floor(d * eff);
    out.push(Math.max(1, d));
  }
  return out;
}
