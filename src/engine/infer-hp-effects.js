// 行動前後の実測HPから能力値を逆算する。推定値でHPを変更する処理とは独立。
import {dex, speciesName, statsOf, statValue, boostMul} from './dex.js';
import {currentSpecies} from './calc.js';
import {buildOf, condOf, defaultAbilityResolver, activeItem} from './battle.js';
import {applyStatConstraint, applyHpConstraint, inferable, inferFromDealt, applyInference} from './infer-dmg.js';
import {boardContext} from './board.js';
import effects from '../generated/move-effects.json' with {type: 'json'};

const display = (h, max) => h <= 0 ? 0 : Math.max(1, Math.floor(h * 100 / max));
const halfDown = x => Math.ceil(x - 0.5);
const same = (a, b) => a?.side === b?.side && a?.mon === b?.mon;
const condition = (b, t) => condOf(b, t.side, t.mon);
const maximum = (b, t, sp = 0) => {
  const bd = buildOf(b, t.side, t.mon), c = condition(b, t);
  return statsOf(currentSpecies(bd, c), t.side === 'me' ? bd.sp : [sp, 0, 0, 0, 0, 0], t.side === 'me' ? bd.nature : 'Serious')[0];
};
function realHP(b, t, pct, max) {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return [];
  if (t.side === 'me') return [Math.round(pct * max / 100)];
  if (Math.abs(pct - Math.round(pct)) < 1e-9) pct = Math.round(pct);
  if (!Number.isInteger(pct)) return []; // 推定値の小数%を表示の実測と混ぜない
  const out = [];
  for (let h = 0; h <= max; h++) if (display(h, max) === pct) out.push(h);
  return out;
}
function observation(input, t, actor, target) {
  const h = input.observedHp?.find(x => same(x, t));
  if (h && Number.isFinite(h.hpAfter)) return h.hpAfter;
  if (same(t, actor) && Number.isFinite(input.atkHpAfter)) return input.atkHpAfter;
  if (same(t, target) && !input.hpUnknown && Number.isFinite(input.hpAfter)) return input.hpAfter;
  return null;
}
function roots(b, t) {
  const c = condition(b, t), bd = buildOf(b, t.side, t.mon), item = activeItem(b, t.side, t.mon);
  if (item === 'bigroot') return [5324 / 4096];
  if (t.side === 'opp' && !bd.item && !c.itemGone && !b.state.field.magicRoom && defaultAbilityResolver(b, t.side, t.mon) !== 'klutz') return [1, 5324 / 4096];
  return [1];
}
function usable(b, t) {
  const c = condition(b, t);
  return c && !c.fainted && !c.hpUnknown && !c.transformed && !c.tricked;
}
function saveHP(b, idx, accepted, why, log) {
  if (accepted.every(Boolean)) return true;
  const o = b.opp[idx];
  if (!accepted.some(Boolean)) { log.push(`${why}: 入力したHPでは説明できず、絞り込みを保存していません`); return false; }
  const msg = applyHpConstraint(o, sp => accepted[sp]);
  const mask = o.statOk?.hp;
  const sid = currentSpecies(o, condOf(b, 'opp', idx));
  const values = mask ? [...mask].flatMap((v, sp) => v === '1' ? [statValue(dex.species[sid].bs[0], sp, 1, true)] : []) : [];
  const range = values.length ? `（最大HP ${values[0] === values.at(-1) ? `${values[0]} 確定` : `${values[0]}〜${values.at(-1)}`}）` : '';
  log.push(`${why}: ${msg}${msg.includes('保存していません') ? '' : range}`);
  return !msg.includes('保存していません');
}

function strengthSap(b, before, a, input, actor, target, log) {
  const reflected = defaultAbilityResolver(before, target.side, target.mon) === 'magicbounce';
  if (a.bounced && !reflected) return; // 未判明の特性の見込みは確定情報に使わない
  const beneficiary = reflected ? target : actor, attackHolder = reflected ? actor : target;
  const attackCond = condition(before, attackHolder);
  if (!usable(before, beneficiary) || !attackCond || attackCond.fainted || attackCond.transformed || attackCond.tricked) return;
  if ((condition(before, beneficiary).healBlock || 0) >= b.turns.at(-1)?.n) return;
  const stage = condition(before, attackHolder).boosts.atk || 0;
  if (stage <= -6) return;
  const after = observation(input, beneficiary, actor, target);
  if (after == null) return;
  const ab = defaultAbilityResolver(before, attackHolder.side, attackHolder.mon);
  const bd = buildOf(before, attackHolder.side, attackHolder.mon);
  const abs = ab ? [ab] : dex.species[currentSpecies(bd, condition(before, attackHolder))].ab;
  const ooze = [...new Set(abs.map(x => x === 'liquidooze'))];
  const matches = (attack, max) => {
    const prior = realHP(before, beneficiary, condition(before, beneficiary).hp, max);
    const observed = realHP(before, beneficiary, after, max);
    for (const root of roots(before, beneficiary)) {
      const amount = Math.max(1, halfDown(Math.floor(attack * boostMul(stage)) * root));
      for (const h of prior) for (const poison of ooze) {
        const h1 = poison ? (defaultAbilityResolver(before, beneficiary.side, beneficiary.mon) === 'magicguard' ? h : Math.max(0, h - amount)) : Math.min(max, h + amount);
        if (observed.includes(h1)) return true;
      }
    }
    return false;
  };
  const why = `ちからをすいとるの${after === 100 ? '回復量の下限' : after === 0 ? 'ダメージの下限' : 'HP変化'}`;
  if (attackHolder.side === 'opp' && beneficiary.side === 'me') {
    const o = b.opp[attackHolder.mon], sid = currentSpecies(o, condition(before, attackHolder));
    const max = maximum(before, beneficiary);
    const msg = applyStatConstraint(o, sid, 'atk', attack => matches(attack, max));
    if (msg) log.push(`${why}: 相手の${speciesName(o.species)} ${msg}`);
  } else if (attackHolder.side === 'me' && beneficiary.side === 'opp') {
    const user = buildOf(before, 'me', attackHolder.mon);
    const atk = statsOf(currentSpecies(user, condition(before, attackHolder)), user.sp, user.nature)[1];
    saveHP(b, beneficiary.mon, Array.from({length: 33}, (_, sp) => matches(atk, maximum(before, beneficiary, sp))), why, log);
  }
}

function painSplit(b, before, input, actor, target, log) {
  const mine = actor.side === 'me' ? actor : target, opp = actor.side === 'opp' ? actor : target;
  if (mine.side !== 'me' || opp.side !== 'opp' || !usable(before, mine) || !usable(before, opp)) return;
  const afterMine = observation(input, mine, actor, target), afterOpp = observation(input, opp, actor, target);
  if (afterMine == null && afterOpp == null) return;
  const maxMine = maximum(before, mine), hpMine = realHP(before, mine, condition(before, mine).hp, maxMine)[0];
  const accepted = Array.from({length: 33}, (_, sp) => {
    const maxOpp = maximum(before, opp, sp);
    return realHP(before, opp, condition(before, opp).hp, maxOpp).some(h => {
      const average = Math.floor((h + hpMine) / 2);
      return (afterMine == null || realHP(before, mine, afterMine, maxMine).includes(Math.min(maxMine, average)))
        && (afterOpp == null || realHP(before, opp, afterOpp, maxOpp).includes(Math.min(maxOpp, average)));
    });
  });
  saveHP(b, opp.mon, accepted, 'いたみわけのHP変化', log);
}

// 回復・接触ダメージ等が同時にある場合は、順序の違いで起こりうる幅を残す。
function resultRange(h, max, amounts) {
  const heal = amounts.filter(n => n > 0), hurt = amounts.filter(n => n < 0);
  const simulate = steps => { let now = h; for (const n of steps) { now = Math.max(0, Math.min(max, now + n)); if (!now) break; } return now; };
  const ends = [simulate([...heal, ...hurt]), simulate([...hurt, ...heal])];
  return [Math.min(...ends), Math.max(...ends)];
}
function effectsRange(b, actor, move, fx, damage, root, max, h) {
  const amounts = [];
  const ratio = effects[move]?.drain, recoil = effects[move]?.recoil;
  const drained = ratio ? Math.max(1, halfDown(Math.round(damage * ratio[0] / ratio[1]) * root)) : 0;
  for (const k of fx) {
    if (k === 'drain' && ratio) amounts.push(drained);
    else if (k === 'ooze' && ratio) amounts.push(-drained);
    else if (k === 'recoil' && recoil) amounts.push(-Math.max(1, Math.round(damage * recoil[0] / recoil[1])));
    else if (k === 'recoil' && ['steelbeam', 'mindblown', 'chloroblast'].includes(move)) amounts.push(-Math.round(max / 2));
    else if (k === 'shellbell') amounts.push(Math.max(1, Math.floor(damage / 8)));
    else if (k === 'innards') amounts.push(-damage);
    else if ({lifeorb: 10, helmet: 6, roughskin: 8, aftermath: 4}[k]) amounts.push(-Math.max(1, Math.floor(max / {lifeorb: 10, helmet: 6, roughskin: 8, aftermath: 4}[k])));
    else return null;
  }
  return resultRange(h, max, amounts);
}
function selfEffects(b, before, a, input, actor, target, usage, log) {
  const fx = a.selfFx || input.selfFx || [];
  if (!fx.length || !usable(before, actor)) return;
  const afterActor = observation(input, actor, actor, target);
  if (afterActor == null) return;
  const fixed = fx.every(k => ['lifeorb', 'helmet', 'roughskin', 'aftermath'].includes(k) || (k === 'recoil' && ['steelbeam', 'mindblown', 'chloroblast'].includes(a.move)));
  if (fixed && actor.side === 'opp') {
    const accepted = Array.from({length: 33}, (_, sp) => {
      const max = maximum(before, actor, sp), ends = realHP(before, actor, afterActor, max);
      return realHP(before, actor, condition(before, actor).hp, max).some(h => {
        const range = effectsRange(before, actor, a.move, fx, 0, 1, max, h);
        return range && ends.some(end => end >= range[0] && end <= range[1]);
      });
    });
    saveHP(b, actor.mon, accepted, '固定割合のHP変化', log);
    return;
  }
  if (fixed || !usable(before, target) || a.hitHpAfter != null || a.disguiseHit || input.endured || input.defItem || input.atkItem?.consumed) return;
  if (dex.moves[a.move]?.sp || dex.moves[a.move]?.mh || input.hits > 1) return; // 複数対象・連続技は効果の丸めや発動回数が異なる
  const afterTarget = observation(input, target, actor, target);
  if (afterActor == null || afterTarget == null) return;
  const opp = actor.side === 'opp' ? actor : target;
  if (actor.side === target.side) return;
  const sourceAb = defaultAbilityResolver(before, actor.side, actor.mon);
  if (sourceAb === 'magicguard' && fx.some(k => ['ooze', 'recoil', 'helmet', 'roughskin', 'lifeorb', 'aftermath', 'innards'].includes(k))) return;
  if (sourceAb === 'rockhead' && fx.includes('recoil') && effects[a.move]?.recoil) return;
  const possible = dex.species[currentSpecies(buildOf(before, actor.side, actor.mon), condition(before, actor))]?.ab || [];
  if (!sourceAb && possible.some(ab => ['magicguard', 'rockhead'].includes(ab))) return;
  const amounts = new Set();
  const accepted = Array.from({length: 33}, (_, sp) => {
    const srcMax = maximum(before, actor, sp), tgtMax = maximum(before, target, sp);
    const starts = realHP(before, actor, condition(before, actor).hp, srcMax);
    const ends = realHP(before, actor, afterActor, srcMax);
    if (!starts.length || !ends.length) return false;
    let ok = false;
    for (const t0 of realHP(before, target, condition(before, target).hp, tgtMax)) for (const t1 of realHP(before, target, afterTarget, tgtMax)) {
      const damage = t0 - t1;
      if (damage <= 0) continue;
      for (const root of roots(before, actor)) for (const h of starts) {
        const range = effectsRange(before, actor, a.move, fx, damage, root, srcMax, h);
        if (range && ends.some(end => end >= range[0] && end <= range[1])) { ok = true; amounts.add(damage); }
      }
    }
    return ok;
  });
  const why = `${fx.map(k => ({drain: '吸収', ooze: 'ヘドロえき', recoil: '反動', shellbell: 'かいがらのすず', innards: 'とびだすなかみ'}[k])).filter(Boolean).join('・')}のHP変化${afterActor === 100 || afterActor === 0 ? '（上限・下限を考慮）' : ''}`;
  if (!saveHP(b, opp.mon, accepted, why, log)) return;
  // 実数ダメージも分かるので、HP割合だけの場合より耐久をさらに絞り込める。
  if (actor.side === 'me' && amounts.size && inferable(a.move) && !input.pierce && !condition(before, target).disguiseBroken && !condition(b, target).disguiseBroken) {
    const damageRange = [Math.min(...amounts), Math.max(...amounts)];
    const ctx = boardContext(before, usage), o = b.opp[opp.mon], s = dex.species[currentSpecies(o, condition(before, opp))];
    const result = inferFromDealt(ctx, actor.mon, target.mon, a.move, condition(before, target).hp, afterTarget, {damageRange, atLeast: afterTarget === 0, crit: a.flags.crit, itemUnknown: !o.item, abilityUnknown: !o.ability && s.ab.length > 1, tol: 1});
    if (result?.count) log.push(`${why}からダメージ実数 ${damageRange[0]}〜${damageRange[1]}: ${applyInference(o, null, result)}`);
  }
}

export function inferHpEffects(b, beforeState, a, input, usage, log) {
  if (a.type !== 'move' || a.flags.miss || a.flags.cant || a.flags.protect || a.effectFailed || a.moveImmune || !a.target) return;
  const before = {...b, state: beforeState}, actor = {side: a.side, mon: a.mon}, target = a.target;
  // きのみなど、ここで扱っていない即時回復を実測差分に混ぜない。
  if ([actor, target].some(t => /berry$/.test(buildOf(before, t.side, t.mon)?.item || '') && !condition(before, t)?.itemGone && condition(b, t)?.itemGone)) return;
  if (a.move === 'strengthsap') strengthSap(b, before, a, input, actor, target, log);
  else if (a.move === 'painsplit') painSplit(b, before, input, actor, target, log);
  else selfEffects(b, before, a, input, actor, target, usage, log);
}
