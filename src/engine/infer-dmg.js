// 実際に受けた/与えたダメージから、相手の能力ポイントと性格補正を絞り込む。
// 結果は「性格補正×SP」の可否 (99通り) や「HPのSP × 防御側の補正×SP」の可否 (33×99通り) として相手に保存する。
import {dex, statValue, natureMod, STAT_KEYS} from './dex.js';
import {attackTable} from './board.js';
import {SPE_COMBOS, comboMod, comboSP, comboOf, parseSpread} from './assume.js';

const ALL = n => '1'.repeat(n);
const and = (a, b) => { let o = ''; for (let i = 0; i < a.length; i++) o += a[i] === '1' && b[i] === '1' ? '1' : '0'; return o; };
// その能力だけに補正がかかる性格 (ほかの能力は今回の計算に関係しないものを選ぶ)
const NATURE_FOR = {
  atk: {up: 'Adamant', down: 'Modest'}, spa: {up: 'Modest', down: 'Adamant'},
  def: {up: 'Bold', down: 'Hasty'}, spd: {up: 'Calm', down: 'Naive'},
};
export const natureOf = (stat, mod) => (mod > 1 ? NATURE_FOR[stat].up : mod < 1 ? NATURE_FOR[stat].down : 'Serious');
const withBuild = (ctx, oppIdx, alt) => ({...ctx, build: (side, i) => (side === 'opp' && i === oppIdx ? alt : ctx.build(side, i))});

// 技がどの能力で計算されるか (特殊な参照をする技は対象外)
const UNSUPPORTED = new Set(['foulplay', 'bodypress', 'psyshock', 'psystrike', 'secretsword', 'photongeyser', 'shellsidearm', 'seismictoss', 'nightshade', 'superfang', 'ruination', 'naturesmadness', 'endeavor', 'finalgambit', 'counter', 'mirrorcoat', 'metalburst', 'comeuppance', 'dragonrage', 'sonicboom', 'fissure', 'horndrill', 'guillotine', 'sheercold']);
export function inferable(moveId) {
  const mv = dex.moves[moveId];
  return !!mv && mv.c !== 'Z' && !UNSUPPORTED.has(moveId);
}

/**
 * 相手の攻撃で自分が受けたダメージ (HPの実数) から、相手の攻撃/特攻を絞り込む。
 * 戻り値: {stat, mask, count, range: [実数値の下限, 上限]} / 絞り込めないとき null
 */
export function inferFromTaken(ctx, oppIdx, myIdx, moveId, damage, opts = {}) {
  if (!inferable(moveId) || !(damage > 0)) return null;
  const stat = dex.moves[moveId].c === 'P' ? 'atk' : 'spa';
  const si = STAT_KEYS.indexOf(stat);
  const base = ctx.build('opp', oppIdx);
  const tol = opts.tol || 0;
  // 持ち物が未判明なら「推定の持ち物」「持ち物の補正なし」のどちらかで説明がつけば候補に残す
  const items = opts.itemUnknown ? [...new Set([base.item, ''])] : [base.item];
  let mask = '';
  for (let c = 0; c < SPE_COMBOS; c++) {
    const mod = comboMod(c), sp = comboSP(c);
    const spArr = [0, 0, 0, 0, 0, 0]; spArr[si] = sp;
    let ok = false;
    for (const item of items) {
      const alt = {...base, item, nature: natureOf(stat, mod), sp: spArr};
      const r = attackTable(withBuild(ctx, oppIdx, alt), 'opp', oppIdx, {...opts, only: {def: myIdx, move: moveId}})?.targets[0]?.results[moveId];
      if (r?.ok && damage + tol >= r.min && damage - tol <= r.max) { ok = true; break; }
    }
    mask += ok ? '1' : '0';
  }
  return summarize(ctx, oppIdx, stat, mask);
}

function summarize(ctx, oppIdx, stat, mask) {
  const cond = ctx.cond('opp', oppIdx);
  const sid = cond.forme && dex.species[cond.forme] ? cond.forme : ctx.build('opp', oppIdx).species;
  const b = dex.species[sid].bs[STAT_KEYS.indexOf(stat)];
  let lo = Infinity, hi = -Infinity, count = 0;
  for (let c = 0; c < SPE_COMBOS; c++) if (mask[c] === '1') { const v = statValue(b, comboSP(c), comboMod(c), false); lo = Math.min(lo, v); hi = Math.max(hi, v); count++; }
  return {stat, mask, count, range: count ? [lo, hi] : null};
}

/**
 * 自分の攻撃で相手のHPが before% → after% になったことから、相手のHPと防御/特防を絞り込む。
 * 相手のHPは割合でしか見えないので ±tol% の幅で判定する。
 * 戻り値: {stat, mask (33×99), count, hpRange, defRange}
 */
export function inferFromDealt(ctx, myIdx, oppIdx, moveId, before, after, opts = {}) {
  if (!inferable(moveId) || !(before > after) || after <= 0) return null;
  const tol = opts.tol ?? 1;
  const stat = dex.moves[moveId].c === 'P' ? 'def' : 'spd';
  const si = STAT_KEYS.indexOf(stat);
  const base = ctx.build('opp', oppIdx);
  const cond = ctx.cond('opp', oppIdx);
  const sid = cond.forme && dex.species[cond.forme] ? cond.forme : base.species;
  const bs = dex.species[sid].bs;
  const byVal = new Map();
  const items = opts.itemUnknown ? [...new Set([base.item, ''])] : [base.item];
  const rolls = c => {
    const mod = comboMod(c), sp = comboSP(c);
    const val = statValue(bs[si], sp, mod, false);
    if (!byVal.has(val)) {
      const spArr = [0, 0, 0, 0, 0, 0]; spArr[si] = sp;
      let lo = Infinity, hi = -Infinity;
      for (const item of items) {
        const alt = {...base, item, nature: natureOf(stat, mod), sp: spArr};
        const r = attackTable(withBuild(ctx, oppIdx, alt), 'me', myIdx, {...opts, only: {def: oppIdx, move: moveId}})?.targets[0]?.results[moveId];
        if (r?.ok) { lo = Math.min(lo, r.min); hi = Math.max(hi, r.max); }
      }
      byVal.set(val, Number.isFinite(lo) ? [lo, hi] : null);
    }
    return byVal.get(val);
  };
  const lost = before - after;
  let mask = '', count = 0, hLo = 99, hHi = -1, dLo = Infinity, dHi = -Infinity;
  for (let h = 0; h <= 32; h++) {
    const maxHP = statValue(bs[0], h, 1, true);
    for (let c = 0; c < SPE_COMBOS; c++) {
      const r = rolls(c);
      const ok = !!r && (r[1] / maxHP) * 100 >= lost - tol && (r[0] / maxHP) * 100 <= lost + tol;
      mask += ok ? '1' : '0';
      if (ok) { count++; hLo = Math.min(hLo, h); hHi = Math.max(hHi, h); const v = statValue(bs[si], comboSP(c), comboMod(c), false); dLo = Math.min(dLo, v); dHi = Math.max(dHi, v); }
    }
  }
  return {stat, mask, count, hpRange: count ? [hLo, hHi] : null, defRange: count ? [dLo, dHi] : null};
}

// 配分 (性格 + SP) が、これまでの絞り込みと矛盾しないか
export function spreadFits(opp, nature, sp) {
  const k = opp.statOk || {};
  for (const stat of ['atk', 'spa']) {
    if (k[stat] && k[stat][comboOf(natureMod(nature, stat), sp[STAT_KEYS.indexOf(stat)])] !== '1') return false;
  }
  for (const stat of ['def', 'spd']) {
    if (k[stat] && k[stat][sp[0] * SPE_COMBOS + comboOf(natureMod(nature, stat), sp[STAT_KEYS.indexOf(stat)])] !== '1') return false;
  }
  return true;
}

/**
 * 絞り込み結果を相手に保存し、いまの想定配分が矛盾するなら合う配分へ切り替える。
 * view: 保存前の oppView。戻り値: 日本語の説明
 */
export function applyInference(opp, view, res) {
  if (!res) return '';
  const names = {atk: 'こうげき', spa: 'とくこう', def: 'ぼうぎょ', spd: 'とくぼう'};
  if (!res.count) return `この条件では説明がつきません (急所・持ち物・ランク・天候などの設定を確認してください)。絞り込みは保存していません。`;
  opp.statOk ||= {};
  const prev = opp.statOk[res.stat];
  const merged = prev ? and(prev, res.mask) : res.mask;
  if (!merged.includes('1')) return `これまでの絞り込みと矛盾します。保存していません (相手の情報から絞り込みをリセットできます)。`;
  opp.statOk[res.stat] = merged;
  const msg = res.range ? `${names[res.stat]}の実数値は ${res.range[0]}〜${res.range[1]}` : `HPの能力ポイント ${res.hpRange[0]}〜${res.hpRange[1]}・${names[res.stat]}の実数値 ${res.defRange[0]}〜${res.defRange[1]}`;
  return `${msg}。`;
}
export {parseSpread, ALL};
