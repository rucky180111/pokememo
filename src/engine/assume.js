// 相手のポケモンの「見えていない情報」を、判明済みの情報と使用率データから推定する。
import {dex, megaFormeFor, natureMod, STAT_KEYS, statValue} from './dex.js';
import {toCalcPokemon, gen, toCalcField, newCond, currentSpecies} from './calc.js';
import utilPkg from '@smogon/calc/dist/mechanics/util.js';

const {getFinalSpeed} = utilPkg;

export const PRESETS = {
  none: {label: '無振り', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0]},
  as: {label: 'AS (ようき)', nature: 'Jolly', sp: [2, 32, 0, 0, 0, 32]},
  cs: {label: 'CS (おくびょう)', nature: 'Timid', sp: [2, 0, 0, 32, 0, 32]},
  ha: {label: 'HA (いじっぱり)', nature: 'Adamant', sp: [32, 32, 0, 0, 2, 0]},
  hc: {label: 'HC (ひかえめ)', nature: 'Modest', sp: [32, 0, 0, 32, 2, 0]},
  hb: {label: 'HB特化', nature: 'Bold', sp: [32, 0, 32, 0, 2, 0]},
  hd: {label: 'HD特化', nature: 'Calm', sp: [32, 0, 2, 0, 32, 0]},
};

export function parseSpread(key) {
  const m = /^(\w+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(key || '');
  if (!m) return null;
  return {nature: m[1], sp: m.slice(2).map(Number)};
}
export const spreadLabel = (nature, sp) => {
  const names = ['H', 'A', 'B', 'C', 'D', 'S'];
  const parts = sp.map((v, i) => (v ? `${names[i]}${v}` : '')).filter(Boolean);
  return `${dex.natures[nature]?.j || nature} ${parts.join(' ') || '無振り'}`;
};

// 使用率データ上の候補 (通常の姿 + 各メガ)。w は使用率。
export function usageEntries(usage, speciesId) {
  const out = [];
  const s = dex.species[speciesId];
  if (!usage?.pokemon || !s) return out;
  for (const id of [speciesId, ...(s.megas || [])]) {
    const d = usage.pokemon[id];
    if (d) out.push({id, w: d.u || 0, d});
  }
  return out;
}

// メガシンカして出てくる見込み {forme, p}
export function megaLikelihood(usage, speciesId) {
  const entries = usageEntries(usage, speciesId);
  const total = entries.reduce((a, e) => a + e.w, 0);
  const megas = entries.filter(e => e.id !== speciesId).sort((a, b) => b.w - a.w);
  if (!megas.length || !total) return {forme: megas[0]?.id || null, p: 0};
  return {forme: megas[0].id, p: megas.reduce((a, e) => a + e.w, 0) / total};
}

/**
 * 相手1体の推定結果。
 * opp: {species, item, ability, moves, assume}
 * ctx: {megaBlocked: 他の相手がすでにメガシンカ済み, itemGone}
 */
export function oppView(opp, usage, ctx = {}) {
  const s = dex.species[opp.species];
  if (!s) return null;
  const entries = usageEntries(usage, opp.species);
  const baseEntry = entries.find(e => e.id === opp.species)?.d || null;
  const itemKnown = !!opp.item;
  let megaForme = null, megaP = 0, megaWhy = '';
  if (itemKnown) {
    megaForme = megaFormeFor(opp.species, opp.item);
    megaP = megaForme ? 1 : 0;
    if (megaForme) megaWhy = '持ち物確定';
  } else if (opp.megaSeen && s.megas?.length) {
    megaForme = megaLikelihood(usage, opp.species).forme || s.megas[0];
    megaP = 1;
    megaWhy = 'メガシンカ確認';
  } else if (!ctx.megaBlocked && s.megas?.length) {
    const ml = megaLikelihood(usage, opp.species);
    megaP = ml.p;
    if (ml.p >= 0.5) { megaForme = ml.forme; megaWhy = `使用率 ${(ml.p * 100).toFixed(0)}%`; }
  }
  const variantId = megaForme || opp.species;
  const variant = entries.find(e => e.id === variantId)?.d || baseEntry || entries[0]?.d || null;

  // 配分
  let nature = 'Serious', sp = [0, 0, 0, 0, 0, 0], spreadSource = '無振り (データなし)', spreadRate = null;
  const spreads = (variant?.sp || []).map(([k, r]) => ({...parseSpread(k), rate: r})).filter(x => x.sp);
  const as = opp.assume || {kind: 'usage', idx: 0};
  if (as.kind === 'custom' && as.sp) {
    nature = as.nature || 'Serious'; sp = as.sp; spreadSource = '手入力';
  } else if (as.kind === 'preset' && PRESETS[as.key]) {
    ({nature, sp} = PRESETS[as.key]);
    if (as.key === 'hb' && s.bs[1] > s.bs[3]) nature = 'Impish';
    if (as.key === 'hd' && s.bs[1] > s.bs[3]) nature = 'Careful';
    spreadSource = PRESETS[as.key].label;
  } else if (spreads.length) {
    const pick = spreads[Math.min(as.idx || 0, spreads.length - 1)];
    nature = pick.nature; sp = pick.sp; spreadRate = pick.rate;
    spreadSource = `使用率${Math.min(as.idx || 0, spreads.length - 1) + 1}位`;
  }

  // 持ち物
  let item = opp.item || '', itemGuess = false;
  if (!itemKnown) {
    itemGuess = true;
    if (megaForme) item = dex.species[megaForme]?.stone || '';
    else {
      const cands = (baseEntry?.it || []).filter(([id]) => !(ctx.megaBlocked && dex.items[id]?.ms));
      item = cands[0]?.[0] || '';
    }
  }
  // 特性
  let ability = opp.ability || '', abilityGuess = false;
  if (!ability) {
    if (s.ab.length === 1) ability = s.ab[0];
    else { abilityGuess = true; ability = baseEntry?.ab?.[0]?.[0] || s.ab[0] || ''; }
  }

  // 技の候補: 判明済み → 使用率
  const moves = [];
  for (const m of opp.moves || []) if (dex.moves[m]) moves.push({id: m, known: true, rate: 1});
  if (moves.length < 4) {
    const seen = new Set(moves.map(m => m.id));
    const pool = new Map();
    for (const e of entries) {
      const weight = megaForme ? (e.id === megaForme ? 1 : 0) : (e.id === opp.species ? 1 : 0);
      if (!weight) continue;
      for (const [id, r] of e.d.mv || []) pool.set(id, Math.max(pool.get(id) || 0, r));
    }
    if (!pool.size) for (const e of entries) for (const [id, r] of e.d.mv || []) pool.set(id, Math.max(pool.get(id) || 0, r));
    for (const [id, r] of [...pool.entries()].sort((a, b) => b[1] - a[1])) if (!seen.has(id)) moves.push({id, known: false, rate: r});
  }

  return {
    build: {species: opp.species, item, ability, nature, sp, moves: moves.map(m => m.id)},
    megaForme, megaP, megaWhy,
    itemKnown, itemGuess, abilityGuess,
    spreadSource, spreadRate, spreads,
    moves,
    items: megaForme && !itemKnown ? [[dex.species[megaForme]?.stone, 1]] : (baseEntry?.it || []),
    abilities: baseEntry?.ab || [],
    usage: variant?.u ?? null,
    // 通常の姿とメガの集計を合算した値 (使用率 = パーティ採用率、lead = 全初手に占める割合)
    usageAll: entries.reduce((a, e) => a + (e.d.u || 0), 0),
    leadShare: entries.reduce((a, e) => a + (e.d.l || 0), 0),
    hasData: !!variant,
  };
}

// 推定を踏まえた、計算に使う cond (メガ想定を反映)
export function oppCond(cond, view) {
  const c = cond || newCond();
  if (c.forme || !view?.megaForme) return c;
  return {...c, forme: view.megaForme};
}

// ---- 素早さ ----
// 素早さの「性格補正 × SP」の組み合わせ番号 (0..98): 補正 [0.9, 1, 1.1] × SP 0..32
export const SPE_COMBOS = 99;
export const comboOf = (mod, sp) => (mod < 1 ? 0 : mod > 1 ? 2 : 1) * 33 + sp;
export const comboMod = c => [0.9, 1, 1.1][Math.floor(c / 33)];
export const comboSP = c => c % 33;
export const speFromCombo = (speciesId, c) => statValue(dex.species[speciesId].bs[5], comboSP(c), comboMod(c), false);

// 補正込みの素早さ: 実数値 raw を持つポケモンが、いまの状態・場でどれだけの速さになるか
export function effSpeed(build, cond, raw, {scarf, field, side, format} = {}) {
  const b2 = {...build, item: scarf === true ? 'choicescarf' : scarf === false ? (build.item === 'choicescarf' ? '' : build.item) : build.item};
  const p = toCalcPokemon(b2, cond);
  p.rawStats.spe = raw;
  p.stats.spe = raw;
  return getFinalSpeed(gen, p, toCalcField({format, field}), {isTailwind: !!side?.tailwind});
}

const BENCH = [['最速', 1.1, 32], ['準速', 1, 32], ['無振り', 1, 0], ['最遅', 0.9, 0]];

/**
 * 相手の素早さの見立て。
 * 戻り値: {bench: [{label, raw, eff, scarfEff}], dist: [{eff, p, scarf}], pFaster, pTie, pSlower (自分より), range}
 */
export function speedOutlook(opp, view, cond, usage, mySpeed, ctx = {}) {
  const c = oppCond(cond, view);
  const sid = currentSpecies(view.build, c);
  const base = dex.species[sid].bs[5];
  const itemKnown = view.itemKnown || c.itemGone;
  const canScarf = !itemKnown && !dex.species[sid].mega;
  const isScarf = itemKnown && !c.itemGone && opp.item === 'choicescarf';
  const calcBuild = {...view.build, item: itemKnown ? (c.itemGone ? '' : opp.item) : view.build.item};
  const eff = (raw, scarf) => effSpeed(calcBuild, c, raw, {scarf, field: ctx.field, side: ctx.side, format: ctx.format});
  const allowed = (combo, scarf) => {
    const mask = scarf ? opp.speOk?.scarf : opp.speOk?.plain;
    return !mask || mask[combo] === '1';
  };
  const bench = BENCH.map(([label, mod, sp]) => {
    const raw = statValue(base, sp, mod, false);
    const combo = comboOf(mod, sp);
    return {label, raw, eff: eff(raw, isScarf), scarfEff: canScarf ? eff(raw, true) : null, ok: allowed(combo, isScarf), okScarf: canScarf && allowed(combo, true)};
  });

  // 分布 (使用率の配分 × スカーフ率)
  const pScarf = canScarf ? ((view.items || []).find(([id]) => id === 'choicescarf')?.[1] || 0) : 0;
  const dist = [];
  let spreads = view.spreads || [];
  if (opp.assume?.kind === 'custom' || opp.assume?.kind === 'preset') spreads = [{nature: view.build.nature, sp: view.build.sp, rate: 1}];
  for (const sp of spreads) {
    const mod = natureMod(sp.nature, 'spe');
    const combo = comboOf(mod, sp.sp[5]);
    const raw = statValue(base, sp.sp[5], mod, false);
    if (canScarf) {
      if (pScarf < 1 && allowed(combo, false)) dist.push({eff: eff(raw, false), p: sp.rate * (1 - pScarf), scarf: false});
      if (pScarf > 0 && allowed(combo, true)) dist.push({eff: eff(raw, true), p: sp.rate * pScarf, scarf: true});
    } else if (allowed(combo, isScarf)) dist.push({eff: eff(raw, isScarf), p: sp.rate, scarf: isScarf});
  }
  const total = dist.reduce((a, d) => a + d.p, 0);
  let pFaster = null, pTie = null, pSlower = null;
  if (total > 0 && mySpeed != null) {
    const tr = !!ctx.field?.trickRoom;
    let f = 0, t = 0, sl = 0;
    for (const d of dist) {
      if (d.eff === mySpeed) t += d.p;
      else if ((d.eff > mySpeed) !== tr) f += d.p;
      else sl += d.p;
    }
    pFaster = f / total; pTie = t / total; pSlower = sl / total;
  }

  // 行動順の観測から絞り込んだ実数値の範囲
  let range = null;
  if (opp.speOk) {
    const collect = mask => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < SPE_COMBOS; i++) if (mask[i] === '1') { const v = speFromCombo(sid, i); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return Number.isFinite(lo) ? [lo, hi] : null;
    };
    range = {plain: opp.speOk.plain ? collect(opp.speOk.plain) : null, scarf: opp.speOk.scarf ? collect(opp.speOk.scarf) : null};
  }
  return {bench, dist, pFaster, pTie, pSlower, range, canScarf, pScarf, base, speciesId: sid, coverage: total};
}

export {STAT_KEYS};

// パーティにいるときに初手で出てくる率。集計の初手率は「全初手に占める割合」(合計1) なので、
// 採用率で割り、ダブルは初手が2体なので2倍する。
export function leadRate(v, format) {
  const u = v?.usageAll ?? v?.u ?? 0, l = v?.leadShare ?? v?.l ?? 0;
  if (!u) return 0;
  return Math.min(1, (l * (format === 'double' ? 2 : 1)) / u);
}
