// 行動順の観測から、相手の素早さ (性格補正×SP、スカーフの有無) を絞り込む。
import {dex, speciesName} from './dex.js';
import {finalSpeed, movePriority, currentSpecies} from './calc.js';
import {effSpeed, SPE_COMBOS, speFromCombo} from './assume.js';
import {clone, buildOf, condOf, megaEvolve, sendOut, commitTurn, SPEED_CHANGING, defaultAbilityResolver} from './battle.js';

const SPEED_ABILITIES = new Set(['chlorophyll', 'swiftswim', 'sandrush', 'slushrush', 'surgesurfer', 'unburden', 'quickfeet']);
const ORDER_ABILITIES = new Set(['quickdraw', 'stall', 'prankster', 'galewings']);
const ALL = '1'.repeat(SPE_COMBOS);
const NONE = '0'.repeat(SPE_COMBOS);

function rangeText(speciesId, mask) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < SPE_COMBOS; i++) if (mask[i] === '1') { const v = speFromCombo(speciesId, i); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return Number.isFinite(lo) ? (lo === hi ? `${lo}` : `${lo}〜${hi}`) : null;
}

/**
 * draft.acts の並び (= 実際の行動順) から相手の素早さを絞り込み、b.opp[i].speOk を更新する。
 * 戻り値: ログ (日本語)
 */
export function inferSpeeds(b, draft, opts = {}) {
  const log = [];
  const acts = (draft.acts || []).filter(a => a.type !== 'event');
  const res = opts.resolveAbility || defaultAbilityResolver;
  // 行動順が決まる時点の盤面: 交代とメガシンカを済ませた状態
  const sim = clone(b);
  for (const a of acts) {
    if (a.type === 'switch' && a.to != null) {
      const slot = sim.state.sides[a.side].active.indexOf(a.mon);
      if (slot >= 0) sendOut(sim, a.side, slot, a.to, {resolveAbility: res});
    }
  }
  for (const a of acts) if (a.type === 'move' && a.mega) megaEvolve(sim, a.side, a.mon, null, {resolveAbility: res});

  const field = sim.state.field;
  const movers = acts.map((a, idx) => ({a, idx})).filter(x => x.a.type === 'move' && x.a.move && dex.moves[x.a.move] && !x.a.flags?.cant);
  const speedChangeBefore = idx => acts.some((a, j) => j < idx && a.type === 'move' && SPEED_CHANGING.has(a.move) && !a.flags?.cant && !a.flags?.miss);

  for (const o of movers.filter(x => x.a.side === 'opp')) {
    const oi = o.a.mon;
    const ob = buildOf(sim, 'opp', oi), oc = condOf(sim, 'opp', oi);
    const target = buildOf(b, 'opp', oi);
    if (!ob || !oc || !target) continue;
    const sid = currentSpecies(ob, oc);
    const s = dex.species[sid];
    const abilityKnown = !!ob.ability || s.ab.length === 1 || !!s.mega;
    const possible = abilityKnown ? [res(sim, 'opp', oi)] : s.ab;
    if (!abilityKnown && possible.some(x => SPEED_ABILITIES.has(x) || ORDER_ABILITIES.has(x))) continue;
    if (possible.some(x => x === 'quickdraw' || x === 'stall')) continue;
    const oAb = abilityKnown ? possible[0] : '';
    const itemKnown = !!ob.item || oc.itemGone;
    const scarfBranches = s.mega ? [false] : itemKnown ? [!oc.itemGone && ob.item === 'choicescarf'] : [false, true];
    if (itemKnown && !oc.itemGone && ob.item === 'quickclaw') continue;

    let plain = target.speOk?.plain ?? ALL, scarf = target.speOk?.scarf ?? ALL;
    if (!scarfBranches.includes(true)) scarf = NONE;
    if (!scarfBranches.includes(false)) plain = NONE;
    let used = false;

    for (const m of movers.filter(x => x.a.side === 'me')) {
      const mb = buildOf(sim, 'me', m.a.mon), mc = condOf(sim, 'me', m.a.mon);
      if (!mb || !mc) continue;
      const first = Math.min(m.idx, o.idx);
      if (speedChangeBefore(first)) continue;
      const myAb = res(sim, 'me', m.a.mon);
      if (myAb === 'quickdraw' || myAb === 'stall' || (!mc.itemGone && mb.item === 'quickclaw')) continue;
      const grassy = field.terrain === 'Grassy';
      const pm = movePriority(m.a.move, myAb, {hpFull: mc.hp >= 100, grassyTerrain: grassy});
      const po = movePriority(o.a.move, oAb, {hpFull: oc.hp >= 100, grassyTerrain: grassy});
      if (pm !== po) continue;
      const my = finalSpeed({build: mb, cond: mc}, {format: sim.format, field, side: sim.state.sides.me});
      const oppFirst = o.idx < m.idx;
      const tr = !!field.trickRoom;
      const consistent = e => (oppFirst !== tr ? e >= my : e <= my);
      const filt = (mask, isScarf) => {
        let out = '';
        const calcBuild = {...ob, ability: oAb || ob.ability};
        for (let i = 0; i < SPE_COMBOS; i++) {
          if (mask[i] !== '1') { out += '0'; continue; }
          const e = effSpeed(calcBuild, oc, speFromCombo(sid, i), {scarf: isScarf, field, side: sim.state.sides.opp, format: sim.format});
          out += consistent(e) ? '1' : '0';
        }
        return out;
      };
      plain = filt(plain, false);
      scarf = filt(scarf, true);
      used = true;
    }
    if (!used) continue;
    const name = speciesName(ob.species);
    if (!plain.includes('1') && !scarf.includes('1')) {
      log.push(`相手の${name}: 行動順がこれまでの情報と矛盾するため、素早さの絞り込みは見送り`);
      continue;
    }
    target.speOk = {plain, scarf};
    const rp = rangeText(sid, plain), rs = rangeText(sid, scarf);
    if (!rp && rs) {
      target.scarfLikely = true;
      log.push(`相手の${name}: こだわりスカーフでないと説明がつかない行動順 (スカーフ時の実数値 ${rs})`);
    } else if (rp) {
      log.push(`相手の${name}の素早さ: 実数値 ${rp}${rs && !itemKnown ? ` (スカーフなら ${rs})` : ''}`);
    }
  }
  return log;
}

// 行動順の推定つきでターンを確定する
export function commitTurnInfer(b, draft, opts = {}) {
  // 取り消しで素早さの絞り込みも戻せるよう、推定の前にスナップショットを取る
  const before = clone({state: b.state, pick: b.pick, opp: b.opp});
  let pre = [];
  if (draft.orderKnown) {
    try { pre = inferSpeeds(b, draft, opts); } catch (e) { pre = [`素早さの推定に失敗: ${e.message}`]; }
  }
  commitTurn(b, draft, {...opts, before});
  const t = b.turns[b.turns.length - 1];
  t.auto = [...pre, ...t.auto];
  return t.auto;
}
