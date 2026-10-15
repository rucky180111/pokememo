// 相手の能力ポイントの推定: 絞り込めた範囲と、まだ分からない残りポイントを使った最良/最悪ケース
import {dex, statValue, STAT_KEYS, SP_TOTAL, natureMod} from './dex.js';
import {SPE_COMBOS, comboMod, comboSP} from './assume.js';
import {natureOf} from './infer-dmg.js';

// 能力ごとに許される「補正×SP」の集合を取り出す (絞り込みが無ければ null)
function allowed(opp, stat) {
  const k = opp.statOk || {};
  if (stat === 'atk' || stat === 'spa') return k[stat] || null;
  if (stat === 'def' || stat === 'spd') {
    const m = k[stat];
    if (!m) return null;
    let out = '';
    for (let c = 0; c < SPE_COMBOS; c++) { let ok = false; for (let h = 0; h <= 32 && !ok; h++) ok = m[h * SPE_COMBOS + c] === '1'; out += ok ? '1' : '0'; }
    return out;
  }
  if (stat === 'spe') {
    const p = opp.speOk?.plain, s = opp.speOk?.scarf;
    if (p && s) return [...p].map((v, i) => v === '1' || s[i] === '1' ? '1' : '0').join('');
    return p || s || null;
  }
  return null;
}
function hpAllowed(opp) {
  const k = opp.statOk || {};
  let lo = 0, hi = 32, known = false;
  if (k.hp) { known = true; lo = k.hp.indexOf('1'); hi = k.hp.lastIndexOf('1'); if (lo < 0) { lo = 0; hi = 32; known = false; } }
  for (const stat of ['def', 'spd']) {
    const m = k[stat];
    if (!m) continue;
    known = true;
    let l = 33, h2 = -1;
    for (let h = 0; h <= 32; h++) if (m.slice(h * SPE_COMBOS, (h + 1) * SPE_COMBOS).includes('1')) { l = Math.min(l, h); h2 = Math.max(h2, h); }
    if (h2 >= 0) { lo = Math.max(lo, l); hi = Math.min(hi, h2); }
  }
  if (lo > hi) { lo = 0; hi = 32; known = false; }
  return {lo, hi, known};
}

/**
 * 耐久 (HP と ぼうぎょ/とくぼう) の「いちばん効率のいい振り方」。
 * 与えたダメージからは HP と防御側の組み合わせが何通りも残るので、
 * 観測に合う組み合わせのうち、使う能力ポイントの合計が最小のものを想定する。
 * 戻り値: {h, def: {mod, sp} | null, spd: {mod, sp} | null, alt: {def: {補正: sp}, spd: {...}}} / 観測がなければ null
 */
export function efficientBulk(opp) {
  const k = opp.statOk || {};
  if (!k.def && !k.spd) return null;
  // minSp[stat][h][modIndex] = その HP と補正で観測に合う最小の SP (なければ -1)
  const table = stat => {
    const m = k[stat];
    if (!m) return null;
    const out = [];
    for (let h = 0; h <= 32; h++) {
      const row = [-1, -1, -1];
      for (let c = 0; c < SPE_COMBOS; c++) if (m[h * SPE_COMBOS + c] === '1') { const mi = Math.floor(c / 33); if (row[mi] < 0) row[mi] = comboSP(c); }
      out.push(row);
    }
    return out;
  };
  const D = table('def'), S = table('spd');
  const MODS = [0.9, 1, 1.1];
  const opts = (t, h) => (t ? [0, 1, 2].filter(i => t[h][i] >= 0).map(i => ({mi: i, sp: t[h][i]})) : [{mi: 1, sp: 0, none: true}]);
  let best = null;
  for (let h = 0; h <= 32; h++) {
    if (k.hp && k.hp[h] !== '1') continue;
    for (const d of opts(D, h)) for (const s2 of opts(S, h)) {
      if (d.mi === s2.mi && d.mi !== 1 && !d.none && !s2.none) continue; // 1つの性格で両方に同じ向きの補正はかからない
      // 補正なしで説明がつくならそちらを優先 (同点のとき)
      const cost = h + d.sp + s2.sp + (d.mi !== 1 ? 0.25 : 0) + (s2.mi !== 1 ? 0.25 : 0);
      if (!best || cost < best.cost) best = {cost, h, d, s: s2};
    }
  }
  if (!best) return null;
  const alt = (t) => (t ? Object.fromEntries([0, 1, 2].filter(i => t[best.h][i] >= 0).map(i => [MODS[i], t[best.h][i]])) : null);
  return {h: best.h, def: D ? {mod: MODS[best.d.mi], sp: best.d.sp} : null, spd: S ? {mod: MODS[best.s.mi], sp: best.s.sp} : null, alt: {def: alt(D), spd: alt(S)}};
}

/**
 * 6能力それぞれの推定。
 * 戻り値: [{key, base, spLo, spHi, valLo, valHi, modLo, modHi, known}] と remain (未確定の残りポイント)
 */
export function estimateStats(opp, speciesId) {
  const s = dex.species[speciesId];
  const rows = STAT_KEYS.map((key, i) => {
    const base = s.bs[i];
    if (key === 'hp') {
      const h = hpAllowed(opp);
      return {key, base, spLo: h.lo, spHi: h.hi, valLo: statValue(base, h.lo, 1, true), valHi: statValue(base, h.hi, 1, true), modLo: 1, modHi: 1, known: h.known};
    }
    const m = allowed(opp, key);
    let spLo = 33, spHi = -1, valLo = Infinity, valHi = -Infinity, modLo = 2, modHi = 0;
    const byMod = {};
    for (let c = 0; c < SPE_COMBOS; c++) {
      if (m && m[c] !== '1') continue;
      const sp = comboSP(c), mod = comboMod(c), v = statValue(base, sp, mod, false);
      const e = (byMod[mod] ||= [33, -1]); e[0] = Math.min(e[0], sp); e[1] = Math.max(e[1], sp);
      spLo = Math.min(spLo, sp); spHi = Math.max(spHi, sp); valLo = Math.min(valLo, v); valHi = Math.max(valHi, v); modLo = Math.min(modLo, mod); modHi = Math.max(modHi, mod);
    }
    if (spHi < 0) return {key, base, spLo: 0, spHi: 32, valLo: statValue(base, 0, 0.9, false), valHi: statValue(base, 32, 1.1, false), modLo: 0.9, modHi: 1.1, known: false};
    return {key, base, spLo, spHi, valLo, valHi, modLo, modHi, known: !!m, byMod: m ? byMod : null};
  });
  // 耐久は効率のいい振り方に寄せる
  const eff = efficientBulk(opp);
  if (eff) {
    const set = (r, sp, mod) => { r.spLo = r.spHi = sp; r.modLo = r.modHi = mod; r.valLo = r.valHi = statValue(r.base, sp, mod, r.key === 'hp'); r.eff = true; };
    set(rows[0], eff.h, 1);
    for (const key of ['def', 'spd']) {
      if (!eff[key]) continue;
      const r = rows[STAT_KEYS.indexOf(key)];
      set(r, eff[key].sp, eff[key].mod);
      r.byMod = Object.fromEntries(Object.entries(eff.alt[key]).map(([m, sp]) => [m, [sp, sp]]));
    }
  }
  const used = rows.reduce((a, r) => a + r.spLo, 0);
  const remain = Math.max(0, SP_TOTAL - used);
  for (const r of rows) r.spHi = Math.min(r.spHi, r.spLo + remain);
  return {rows, remain, used};
}

/**
 * 計算用の配分を作る。
 * kind: 'bulkMin' | 'bulkMax' (cat: 'P' 物理を受ける / 'S' 特殊を受ける), 'powMin' | 'powMax' (cat: 'P' / 'S')
 * 無振り側は「確定している最小値」、全振り側は「残りポイントをそこへ全部回した場合」。
 */
export function scenarioBuild(opp, baseBuild, speciesId, kind, cat) {
  const {rows, remain} = estimateStats(opp, speciesId);
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  const sp = rows.map(r => r.spLo);
  const idx = k => STAT_KEYS.indexOf(k);
  const max = kind.endsWith('Max');
  const stat = kind.startsWith('bulk') ? (cat === 'P' ? 'def' : 'spd') : (cat === 'P' ? 'atk' : 'spa');
  let left = remain;
  if (max) {
    if (kind === 'bulkMax') { const add = Math.min(by.hp.spHi - by.hp.spLo, left); sp[0] += add; left -= add; }
    const add2 = Math.min(by[stat].spHi - by[stat].spLo, left); sp[idx(stat)] += add2;
  }
  const r = by[stat];
  const mod = max ? r.modHi : (r.known ? r.modLo : 1);
  return {...baseBuild, nature: natureOf(stat, mod), sp};
}

/**
 * 計算に使う相手の配分を、観測結果に合わせて能力ごとに補正する。
 * 観測のない能力は元の値のまま。観測のある能力は、許される範囲のうち元の値にいちばん近いところへ寄せる。
 * (使用率の型を丸ごと選び直すことはしない)
 */
export function fitBuild(opp, build, speciesId) {
  if (!opp.statOk && !opp.speOk) return build;
  const sp = build.sp.slice();
  const need = {}; // 能力ごとに必要な性格補正
  const eff = efficientBulk(opp);
  if (eff) {
    sp[0] = eff.h;
    for (const key of ['def', 'spd']) if (eff[key]) { sp[STAT_KEYS.indexOf(key)] = eff[key].sp; if (eff[key].mod !== natureMod(build.nature, key)) need[key] = eff[key].mod; }
  }
  for (const stat of ['atk', 'def', 'spa', 'spd', 'spe']) {
    if (eff && eff[stat]) continue;
    const m = allowed(opp, stat);
    if (!m) continue;
    const i = STAT_KEYS.indexOf(stat);
    const curMod = natureMod(build.nature, stat);
    let best = null;
    for (let c = 0; c < SPE_COMBOS; c++) {
      if (m[c] !== '1') continue;
      const cost = Math.abs(comboSP(c) - sp[i]) + (comboMod(c) === curMod ? 0 : 12);
      if (!best || cost < best.cost) best = {cost, c};
    }
    if (!best) continue;
    sp[i] = comboSP(best.c);
    if (comboMod(best.c) !== curMod) need[stat] = comboMod(best.c);
  }
  let nature = build.nature;
  if (Object.keys(need).length) {
    const cur = dex.natures[build.nature] || {};
    // 補正なしが必要な能力に、元の性格の補正が残らないようにする
    let up = Object.keys(need).find(k => need[k] > 1) || (need[cur.p] !== undefined ? null : cur.p) || null;
    let down = Object.keys(need).find(k => need[k] < 1) || (need[cur.m] !== undefined ? null : cur.m) || null;
    if (up && !down) down = ['atk', 'spa', 'def', 'spd', 'spe'].find(k => k !== up && !(need[k] >= 1) && !opp.statOk?.[k]) || null;
    if (down && !up) up = ['atk', 'spa', 'def', 'spd', 'spe'].find(k => k !== down && !need[k] && !opp.statOk?.[k]) || null;
    nature = (up && down && Object.keys(dex.natures).find(n => dex.natures[n].p === up && dex.natures[n].m === down)) || 'Serious';
  }
  return {...build, nature, sp};
}
