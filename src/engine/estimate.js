// 相手の能力ポイントの推定: 絞り込めた範囲と、まだ分からない残りポイントを使った最良/最悪ケース
import {dex, statValue, STAT_KEYS, SP_TOTAL} from './dex.js';
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
  if (stat === 'spe') { const p = opp.speOk?.plain; return p && p.includes('1') ? p : opp.speOk?.scarf || null; }
  return null;
}
function hpAllowed(opp) {
  const k = opp.statOk || {};
  let lo = 0, hi = 32, known = false;
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
    for (let c = 0; c < SPE_COMBOS; c++) {
      if (m && m[c] !== '1') continue;
      const sp = comboSP(c), mod = comboMod(c), v = statValue(base, sp, mod, false);
      spLo = Math.min(spLo, sp); spHi = Math.max(spHi, sp); valLo = Math.min(valLo, v); valHi = Math.max(valHi, v); modLo = Math.min(modLo, mod); modHi = Math.max(modHi, mod);
    }
    if (spHi < 0) return {key, base, spLo: 0, spHi: 32, valLo: statValue(base, 0, 0.9, false), valHi: statValue(base, 32, 1.1, false), modLo: 0.9, modHi: 1.1, known: false};
    return {key, base, spLo, spHi, valLo, valHi, modLo, modHi, known: !!m};
  });
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
