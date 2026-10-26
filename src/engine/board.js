// 盤面の状態から、ダメージ表・素早さ比較など「いま知りたい情報」をまとめて計算する。
import {dex} from './dex.js';
import {calcDamage, finalSpeed, currentSpecies, currentAbility, defaultHits, newCond, movePriority, grounded} from './calc.js';
import {oppView, oppCond, speedOutlook} from './assume.js';
import {condOf, buildOf, other, faintedCount, totalFainted, defaultAbilityResolver} from './battle.js';
import {fitBuild} from './estimate.js';

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
    // 同じ持ち物は1つのパーティに1つだけ: ほかの相手で判明した持ち物は候補から外す
    const takenItems = new Set(b.opp.filter((x, j) => j !== i && x.item).map(x => x.item));
    const v = oppView(o, usage, {megaBlocked: megaBlocked && !selfMega, takenItems});
    if (v && (o.statOk || o.speOk)) {
      // 観測 (ダメージ・行動順) がある能力は、その範囲に合わせる
      if (o.scarfLikely && !o.item) v.build.item = 'choicescarf';
      v.build = fitBuild(o, v.build, c.forme || o.species);
      v.fitted = true;
    }
    return v;
  });
  const ownBuild = (side, i) => (side === 'me' ? b.my[i] : views[i]?.build);
  // へんしん中 (メタモン): 相手の姿・能力・技・特性で、HP だけ自分のもの。持ち物は自分のまま
  const build = (side, i) => {
    const own = ownBuild(side, i);
    const t = b.state.mons[side]?.[i]?.transformed;
    if (!own || !t) return own;
    const tb = ownBuild(t.side, t.mon), tc = b.state.mons[t.side]?.[t.mon];
    if (!tb || !tc || tc.transformed) return own;
    const sid = currentSpecies(tb, tc);
    return {...tb, species: sid, item: own.item, hpBase: dex.species[own.species]?.bs[0], sp: [own.sp?.[0] || 0, ...(tb.sp || [0, 0, 0, 0, 0, 0]).slice(1)],
      ability: currentAbility(tb, tc), moves: tb.moves || [], transformedFrom: own.species};
  };
  const cond0 = (side, i) => (side === 'me' ? b.state.mons.me[i] : oppCond(b.state.mons.opp[i], views[i]));
  // ぎたい: フィールドに合わせてタイプが変わる
  const MIMIC = {Electric: 'Electric', Grassy: 'Grass', Misty: 'Fairy', Psychic: 'Psychic'};
  const cond = (side, i) => {
    const c = cond0(side, i);
    const tr = b.state.field.terrain;
    if (!c || !tr || !MIMIC[tr] || defaultAbilityResolver(b, side, i) !== 'mimicry') return c;
    return {...c, types: [MIMIC[tr]]};
  };
  // 計算用: 相手の未判明の特性は推定値を使う
  const ability = (side, i) => {
    const bd = build(side, i);
    return bd ? currentAbility(bd, cond(side, i)) : '';
  };
  // 計算上の想定と記録を分ける。使用率が高くても未判明の特性で盤面を変えない。
  const strictAbility = defaultAbilityResolver;
  return {b, usage, views, build, cond, ability, strictAbility, megaBlocked};
}

/**
 * 対戦の流れで威力・ダメージが変わる技 (計算機が盤面の履歴を知らないもの) の補正。
 * 戻り値: {bp: 威力の上書き, hits, takenPct: 攻撃側が受けたダメージ (HP割合)・mult: 倍率 (カウンター等), note}
 */
export function moveState(b, atkSide, atkIdx, defSide, defIdx, moveId) {
  const t = b.turns?.[b.turns.length - 1]?.open ? b.turns[b.turns.length - 1] : null;
  const n = t ? t.n : (b.turns?.length || 0) + 1;
  const ac = condOf(b, atkSide, atkIdx) || {}, dc = condOf(b, defSide, defIdx) || {};
  const acts = t ? t.acts.filter(a => a.type === 'move') : [];
  const hitBy = (from, to) => acts.filter(a => a.side === from.side && a.mon === from.mon && a.dmgPct > 0 && (a.target ? a.target.side === to.side && a.target.mon === to.mon : true));
  const me = {side: atkSide, mon: atkIdx}, foe = {side: defSide, mon: defIdx};
  switch (moveId) {
    case 'lastrespects': { const k = totalFainted(b, atkSide); return k ? {bp: 50 + 50 * k, note: `倒れた回数${k}`} : null; }
    case 'ragefist': { const k = ac.timesAttacked || 0; return k ? {bp: Math.min(350, 50 + 50 * k), note: `攻撃を受けた回数${k}`} : null; }
    case 'stompingtantrum': case 'temperflare': return ac.lastResult && ac.lastResult.n === n - 1 && ac.lastResult.failed ? {bp: 150, note: '前のターンに失敗'} : null;
    case 'avalanche': return hitBy(foe, me).length ? {bp: 120, note: '先に攻撃を受けた'} : null;
    case 'assurance': return acts.some(a => a.dmgPct > 0 && a.target?.side === defSide && a.target?.mon === defIdx) ? {bp: 120, note: 'このターンにダメージを受けた相手'} : null;
    case 'payback': {
      if (!t) return null;
      const entered = t.acts.some(a => (a.side === defSide && (a.to === defIdx || (a.kind === 'send' && a.mon === defIdx))) || (a.forceTo === defIdx && a.side !== defSide));
      const moved = acts.some(a => a.side === defSide && a.mon === defIdx);
      return {bp: moved && !entered ? 100 : 50, note: moved && !entered ? '相手が先に動いた' : ''};
    }
    case 'beatup': {
      const list = (atkSide === 'me' ? (b.pick.me.length ? b.pick.me : b.my.map((_, i) => i)) : b.pick.opp.length ? b.pick.opp : [atkIdx]);
      const ok = list.filter(i => { const c = condOf(b, atkSide, i); return c && !c.fainted && (!c.status || i === atkIdx); });
      const bps = ok.map(i => 5 + Math.floor(dex.species[buildOf(b, atkSide, i).species].bs[1] / 10));
      return bps.length ? {bp: Math.round(bps.reduce((x, y) => x + y, 0) / bps.length), hits: bps.length, note: `${bps.length}回`} : null;
    }
    case 'counter': case 'mirrorcoat': case 'metalburst': case 'comeuppance': {
      const cat = moveId === 'counter' ? 'P' : moveId === 'mirrorcoat' ? 'S' : null;
      const h = hitBy(foe, me).filter(a => !cat || dex.moves[a.move]?.c === cat).pop();
      return {takenPct: h ? h.dmgPct : 0, mult: moveId === 'counter' || moveId === 'mirrorcoat' ? 2 : 1.5, note: h ? '受けたダメージから' : '先に攻撃を受けていないので失敗'};
    }
    default: return null;
  }
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
    const guess = all.filter(m => !m.known && m.rate >= 0.04 && (opts.includeStatus || dex.moves[m.id]?.c !== 'Z')).slice(0, Math.max(0, (opts.includeStatus ? 10 : 8) - known.length));
    moves = known.length >= 4 ? known : known.concat(guess);
  }

  const allies = aliveActives(b, atkSide).filter(i => i !== atkIdx);
  const allyAb = allies.map(i => ctx.ability(atkSide, i));
  const anyActiveAb = [...aliveActives(b, 'me').map(i => ctx.ability('me', i)), ...aliveActives(b, 'opp').map(i => ctx.ability('opp', i))];
  const defList = (defSide === 'me' ? b.my : b.opp).map((_, i) => i).filter(i => (opts.includeFainted || !condOf(b, defSide, i)?.fainted) && ctx.build(defSide, i));
  const defActives = st.sides[defSide].active;
  defList.sort((x, y) => (defActives.includes(y) ? 1 : 0) - (defActives.includes(x) ? 1 : 0) || x - y);

  if (opts.only) { defList.splice(0, defList.length, ...defList.filter(i => i === opts.only.def)); if (opts.only.move) { moves = moves.filter(m => m.id === opts.only.move); if (!moves.length && dex.moves[opts.only.move]) moves = [{id: opts.only.move, known: false, rate: 0}]; } }
  const targets = defList.map(di => {
    const active = defActives.includes(di);
    const dBuild = ctx.build(defSide, di);
    const dCond = ctx.cond(defSide, di);
    const dAbility = ctx.ability(defSide, di);
    let aCond = aCond0;
    let field = st.field;
    const notes = [];
    // はりこみ: このターンに交代で出てきた相手 (控えへの計算は「交代で出てくる」想定) には威力2倍
    if (aAbility === 'stakeout') {
      const tt = b.turns?.[b.turns.length - 1];
      const enteredNow = tt?.open && tt.acts.some(a => a.side === defSide && a.type !== 'event' && a.to === di); // 死に出しは対象外
      if (!active || enteredNow) aCond = {...aCond, abilityOn: true};
    }
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
      const ms = moveState(b, atkSide, atkIdx, defSide, di, m.id);
      results[m.id] = calcDamage({build: aBuild, cond: aCond}, {build: dBuild, cond: dCond}, m.id, {
        bp: ms?.bp, takenPct: ms?.takenPct, takenMult: ms?.mult, stateNote: ms?.note,
        format: b.format, field,
        atkSide: st.sides[atkSide], defSide: st.sides[defSide],
        hazards: !active,
        crit: !!opts.crit,
        hits: opts.hits?.[m.id] ?? ms?.hits,
        singleTarget: b.format === 'double' && targetCount <= 1,
        helpingHand: !!opts.helpingHand && b.format === 'double',
        friendGuard: defAllies.some(i => ctx.ability(defSide, i) === 'friendguard'),
        battery: allyAb.includes('battery'), powerSpot: allyAb.includes('powerspot'), steelySpirit: allyAb.includes('steelyspirit'),
        fairyAura: anyActiveAb.includes('fairyaura') || aAbility === 'fairyaura' || dAbility === 'fairyaura',
        // そうだいしょう: 場に出た時点の倒れた味方の数 (控えは今の数)
        atkAlliesFainted: atkActive && aCond0.entryFainted != null ? aCond0.entryFainted : totalFainted(b, atkSide),
        defAlliesFainted: active && dCond.entryFainted != null ? dCond.entryFainted : totalFainted(b, defSide),
      });
    }
    let best = null;
    for (const m of moves) { const r = results[m.id]; if (r?.ok && !r.status && (!best || r.maxPct > best.maxPct)) best = r; }
    return {side: defSide, idx: di, active, species: currentSpecies(dBuild, dCond), results, best, notes};
  });

  return {
    side: atkSide, idx: atkIdx, active: atkActive,
    species: currentSpecies(aBuild, aCond0), ability: aAbility,
    moves: moves.map(m => ({...m, hits: opts.hits?.[m.id] || defaultHits(m.id, aAbility), priority: movePriority(m.id, aAbility, {hpFull: (aCond0.hp ?? 100) >= 100, grassyTerrain: st.field.terrain === 'Grassy' && grounded({build: aBuild, cond: aCond0}, {field: st.field})})})),
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
