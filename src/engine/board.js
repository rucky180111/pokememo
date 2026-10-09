// 盤面の状態から、ダメージ表・素早さ比較など「いま知りたい情報」をまとめて計算する。
import {dex} from './dex.js';
import {calcDamage, finalSpeed, currentSpecies, currentAbility, defaultHits, newCond, movePriority} from './calc.js';
import {oppView, oppCond, speedOutlook} from './assume.js';
import {buildOf, condOf, other, faintedCount, defaultAbilityResolver} from './battle.js';

const WEATHER_ABILITY = {drizzle: 'Rain', drought: 'Sun', sandstream: 'Sand', snowwarning: 'Snow'};
const TERRAIN_ABILITY = {electricsurge: 'Electric', grassysurge: 'Grassy', psychicsurge: 'Psychic', mistysurge: 'Misty'};
const NO_INTIMIDATE = new Set(['clearbody', 'whitesmoke', 'hypercutter', 'innerfocus', 'owntempo', 'oblivious', 'scrappy', 'mirrorarmor']);

/**
 * 盤面計算の共通コンテキスト。
 * usage: その対戦形式の使用率データ (なければ null)
 */
export function boardContext(b, usage) {
  const megaBlocked = b.state.sides.opp.megaUsed || b.state.mons.opp.some(c => c.forme && dex.species[c.forme]?.mega);
  const views = b.opp.map((o, i) => {
    const c = b.state.mons.opp[i] || newCond();
    const selfMega = c.forme && dex.species[c.forme]?.mega;
    return oppView(o, usage, {megaBlocked: megaBlocked && !selfMega});
  });
  const build = (side, i) => (side === 'me' ? b.my[i] : views[i]?.build);
  const cond = (side, i) => (side === 'me' ? b.state.mons.me[i] : oppCond(b.state.mons.opp[i], views[i]));
  // 計算用: 相手の未判明の特性は推定値を使う
  const ability = (side, i) => {
    const bd = build(side, i);
    return bd ? currentAbility(bd, cond(side, i)) : '';
  };
  // 盤面への自動反映用: 推定は使用率が十分高いときだけ使う
  const strictAbility = (bb, side, i) => {
    if (side === 'me') return defaultAbilityResolver(bb, side, i);
    const known = defaultAbilityResolver(bb, side, i);
    if (known) return known;
    const v = views[i];
    const top = v?.abilities?.[0];
    return top && top[1] >= 0.6 ? top[0] : '';
  };
  return {b, usage, views, build, cond, ability, strictAbility, megaBlocked};
}

const aliveActives = (b, side) => b.state.sides[side].active.filter(i => i != null && !condOf(b, side, i)?.fainted);

function intimidateDelta(ab) {
  if (NO_INTIMIDATE.has(ab)) return {};
  if (ab === 'contrary' || ab === 'guarddog' || ab === 'defiant') return {atk: 1};
  if (ab === 'competitive') return {atk: -1, spa: 2};
  if (ab === 'rattled') return {atk: -1, spe: 1};
  return {atk: -1};
}
const addBoosts = (cond, d) => {
  const boosts = {...cond.boosts};
  for (const [k, v] of Object.entries(d)) boosts[k] = Math.max(-6, Math.min(6, (boosts[k] || 0) + v));
  return {...cond, boosts};
};

/**
 * atkSide の atkIdx が、相手側の全ポケモン (場 + 控え) に与えるダメージの表。
 * opts: {crit, hits: {moveId: n}, helpingHand}
 */
export function attackTable(ctx, atkSide, atkIdx, opts = {}) {
  const {b} = ctx;
  const defSide = other(atkSide);
  const aBuild = ctx.build(atkSide, atkIdx);
  if (!aBuild || !dex.species[aBuild.species]) return null;
  const aCond0 = ctx.cond(atkSide, atkIdx);
  const aAbility = ctx.ability(atkSide, atkIdx);
  const st = b.state;
  const atkActive = st.sides[atkSide].active.includes(atkIdx);

  // 技の一覧
  let moves;
  if (atkSide === 'me') moves = (aBuild.moves || []).filter(m => dex.moves[m]).map(id => ({id, known: true, rate: 1}));
  else {
    const all = ctx.views[atkIdx]?.moves || [];
    const known = all.filter(m => m.known);
    const guess = all.filter(m => !m.known && m.rate >= 0.04 && dex.moves[m.id]?.c !== 'Z').slice(0, Math.max(0, 8 - known.length));
    moves = known.length >= 4 ? known : known.concat(guess);
  }

  const allies = aliveActives(b, atkSide).filter(i => i !== atkIdx);
  const allyAb = allies.map(i => ctx.ability(atkSide, i));
  const anyActiveAb = [...aliveActives(b, 'me').map(i => ctx.ability('me', i)), ...aliveActives(b, 'opp').map(i => ctx.ability('opp', i))];
  const defList = (defSide === 'me' ? b.my : b.opp).map((_, i) => i).filter(i => !condOf(b, defSide, i)?.fainted && ctx.build(defSide, i));
  const defActives = st.sides[defSide].active;
  defList.sort((x, y) => (defActives.includes(y) ? 1 : 0) - (defActives.includes(x) ? 1 : 0) || x - y);

  if (opts.only) { defList.splice(0, defList.length, ...defList.filter(i => i === opts.only.def)); moves = moves.filter(m => m.id === opts.only.move); if (!moves.length && dex.moves[opts.only.move]) moves = [{id: opts.only.move, known: false, rate: 0}]; }
  const targets = defList.map(di => {
    const active = defActives.includes(di);
    const dBuild = ctx.build(defSide, di);
    const dCond = ctx.cond(defSide, di);
    const dAbility = ctx.ability(defSide, di);
    let aCond = aCond0;
    let field = st.field;
    const notes = [];
    if (!active) {
      // 交代で出てくる相手: 登場時の特性を加味する
      if (dAbility === 'intimidate' && atkActive) {
        const d = intimidateDelta(aAbility);
        if (Object.keys(d).length) { aCond = addBoosts(aCond, d); notes.push('いかく込み'); }
      }
      if (WEATHER_ABILITY[dAbility] && field.weather !== WEATHER_ABILITY[dAbility]) { field = {...field, weather: WEATHER_ABILITY[dAbility]}; notes.push('天候変化込み'); }
      if (TERRAIN_ABILITY[dAbility] && field.terrain !== TERRAIN_ABILITY[dAbility]) { field = {...field, terrain: TERRAIN_ABILITY[dAbility]}; notes.push('フィールド変化込み'); }
      const ds = st.sides[defSide];
      if (ds.sr || ds.spikes) notes.push('設置技込み');
    }
    const defAllies = aliveActives(b, defSide).filter(i => i !== di);
    const foeCount = active ? aliveActives(b, defSide).length : Math.max(1, aliveActives(b, defSide).length);
    const results = {};
    for (const m of moves) {
      const mv = dex.moves[m.id];
      const targetCount = mv.tg === 'allAdjacent' ? foeCount + allies.length : foeCount;
      results[m.id] = calcDamage({build: aBuild, cond: aCond}, {build: dBuild, cond: dCond}, m.id, {
        format: b.format, field,
        atkSide: st.sides[atkSide], defSide: st.sides[defSide],
        hazards: !active,
        crit: !!opts.crit,
        hits: opts.hits?.[m.id],
        singleTarget: b.format === 'double' && targetCount <= 1,
        helpingHand: !!opts.helpingHand && b.format === 'double',
        friendGuard: defAllies.some(i => ctx.ability(defSide, i) === 'friendguard'),
        battery: allyAb.includes('battery'), powerSpot: allyAb.includes('powerspot'), steelySpirit: allyAb.includes('steelyspirit'),
        fairyAura: anyActiveAb.includes('fairyaura') || aAbility === 'fairyaura' || dAbility === 'fairyaura',
        atkAlliesFainted: faintedCount(b, atkSide), defAlliesFainted: faintedCount(b, defSide),
      });
    }
    let best = null;
    for (const m of moves) { const r = results[m.id]; if (r?.ok && !r.status && (!best || r.maxPct > best.maxPct)) best = r; }
    return {side: defSide, idx: di, active, species: currentSpecies(dBuild, dCond), results, best, notes};
  });

  return {
    side: atkSide, idx: atkIdx, active: atkActive,
    species: currentSpecies(aBuild, aCond0), ability: aAbility,
    moves: moves.map(m => ({...m, hits: opts.hits?.[m.id] || defaultHits(m.id, aAbility), priority: movePriority(m.id, aAbility, {hpFull: (aCond0.hp ?? 100) >= 100, grassyTerrain: st.field.terrain === 'Grassy'})})),
    targets,
  };
}

// 自分の monIdx と、場にいる相手それぞれとの素早さ比較
export function speedTable(ctx, myIdx) {
  const {b} = ctx;
  const build = b.my[myIdx];
  if (!build || !dex.species[build.species]) return null;
  const cond = b.state.mons.me[myIdx];
  const st = b.state;
  const my = finalSpeed({build, cond}, {format: b.format, field: st.field, side: st.sides.me});
  const rows = [];
  const oppIdx = aliveActives(b, 'opp');
  const list = oppIdx.length ? oppIdx : [];
  for (const oi of list) {
    const v = ctx.views[oi];
    if (!v) continue;
    rows.push({idx: oi, outlook: speedOutlook(b.opp[oi], v, st.mons.opp[oi], ctx.usage, my, {format: b.format, field: st.field, side: st.sides.opp})});
  }
  return {my, rows, trickRoom: !!st.field.trickRoom};
}

// 見せ合い時点での相手6体の素早さ早見 (自分の6体と並べる)
export function speedLine(ctx) {
  const {b} = ctx;
  const st = b.state;
  const out = [];
  b.my.forEach((build, i) => {
    if (!dex.species[build.species] || st.mons.me[i].fainted) return;
    out.push({side: 'me', idx: i, species: currentSpecies(build, st.mons.me[i]), speed: finalSpeed({build, cond: st.mons.me[i]}, {format: b.format, field: st.field, side: st.sides.me})});
  });
  b.opp.forEach((o, i) => {
    const v = ctx.views[i];
    if (!v || st.mons.opp[i].fainted) return;
    const ol = speedOutlook(o, v, st.mons.opp[i], ctx.usage, null, {format: b.format, field: st.field, side: st.sides.opp});
    out.push({side: 'opp', idx: i, species: ol.speciesId, bench: ol.bench, range: ol.range, canScarf: ol.canScarf, pScarf: ol.pScarf,
      assumed: finalSpeed({build: v.build, cond: oppCond(st.mons.opp[i], v)}, {format: b.format, field: st.field, side: st.sides.opp})});
  });
  return out;
}
