// 時系列での入力: 行動を1つずつ追加していく。追加のたびに盤面・判明情報・能力の絞り込みへ反映する。
import {dex, speciesName, moveName, statsOf, itemName, abilityName} from './dex.js';
import {currentSpecies} from './calc.js';
import {clone, other, buildOf, condOf, sendOut, megaEvolve, applyMoveEffects, applyBoosts, setHP, turnNumber, UNDO_DEPTH, defaultAbilityResolver, setWeather, setTerrain, setSideFlag, setFieldFlag, WEATHER_JA, TERRAIN_JA} from './battle.js';
import {boardContext} from './board.js';
import {inferFromTaken, inferFromDealt, applyInference, inferable} from './infer-dmg.js';
import {inferSpeeds} from './infer.js';

export const openTurn = b => { const t = b.turns[b.turns.length - 1]; return t && t.open ? t : null; };

function ensureTurn(b) {
  let t = openTurn(b);
  if (!t) {
    t = {n: b.turns.length + 1, acts: [], orderKnown: true, note: '', auto: [], open: true, before: clone({state: b.state, pick: b.pick, opp: b.opp})};
    b.turns.push(t);
    for (let i = 0; i < b.turns.length - UNDO_DEPTH; i++) delete b.turns[i].before;
  }
  return t;
}

// ターンを締める: 行動順から素早さを絞り込み、ターン終了時の特性を処理する
export function endTurn(b, usage) {
  const t = openTurn(b);
  if (!t) return [];
  const log = [];
  const res = boardContext(b, usage).strictAbility;
  if (t.before && t.acts.filter(a => a.type === 'move').length >= 2) {
    try {
      const sim = clone(b);
      sim.state = clone(t.before.state); sim.pick = clone(t.before.pick);
      sim.opp.forEach((o, i) => { if (t.before.opp[i]) { o.item = o.item || ''; } });
      const before = sim.opp.map(o => JSON.stringify(o.speOk || null));
      log.push(...inferSpeeds(sim, {acts: t.acts}, {resolveAbility: res}));
      sim.opp.forEach((o, i) => { if (JSON.stringify(o.speOk || null) !== before[i] && b.opp[i]) { b.opp[i].speOk = o.speOk; b.opp[i].scarfLikely = o.scarfLikely; } });
    } catch { /* 絞り込めなくても記録は続ける */ }
  }
  const entered = new Set(t.acts.filter(a => a.toSp).map(a => `${a.side}${a.to}`));
  for (const side of ['me', 'opp']) for (const i of b.state.sides[side].active) {
    if (i == null || condOf(b, side, i).fainted || entered.has(`${side}${i}`)) continue;
    if (res(b, side, i) === 'speedboost') applyBoosts(b, side, i, {spe: 1}, {log, resolveAbility: () => ''});
  }
  t.open = false;
  t.auto.push(...log);
  b.updatedAt = Date.now();
  return log;
}

/**
 * 行動を1つ追加する。
 * input: {side, mon?, type: 'move'|'switch', move, to, mega, crit, miss, protect, target?: {side, mon}, hpAfter?: 対象の残りHP(%)}
 * 戻り値: 反映内容のログ
 */
export function addAct(b, input, usage) {
  const side = input.side;
  const mon = input.mon ?? b.state.sides[side].active.find(i => i != null && !condOf(b, side, i)?.fainted);
  if (mon == null) return ['場にポケモンがいません'];
  // 同じポケモンが同じターンに2回目の行動 → 前のターンを締めて次のターンへ
  let t = openTurn(b);
  if (t && t.acts.some(a => a.type !== 'event' && a.side === side && (a.mon === mon || a.to === mon))) { endTurn(b, usage); t = null; }
  t = ensureTurn(b);
  const log = [];
  let ctx = boardContext(b, usage);
  const res = ctx.strictAbility;
  const build = buildOf(b, side, mon);
  const a = {side, mon, type: input.type, move: input.move || '', to: input.to ?? null, mega: !!input.mega, target: input.target || null,
    flags: {crit: !!input.crit, miss: !!input.miss, protect: !!input.protect, cant: !!input.cant},
    sp: build.species, vs: b.state.sides[other(side)].active.filter(i => i != null).map(i => buildOf(b, other(side), i)?.species).filter(Boolean)};
  const slot = b.state.sides[side].active.indexOf(mon);
  if (a.type === 'switch') {
    if (a.to == null || slot < 0) return ['交代先がありません'];
    a.toSp = buildOf(b, side, a.to)?.species;
    sendOut(b, side, slot, a.to, {log, resolveAbility: res});
  } else {
    if (a.mega) { megaEvolve(b, side, mon, null, {log, resolveAbility: res}); ctx = boardContext(b, usage); }
    if (side === 'opp' && dex.moves[a.move] && !build.moves.includes(a.move) && build.moves.length < 4) build.moves.push(a.move);
    const foe = other(side);
    const tgt = a.target || (() => { const f = b.state.sides[foe].active.filter(i => i != null && !condOf(b, foe, i)?.fainted); return f.length === 1 ? {side: foe, mon: f[0]} : null; })();
    const failed = a.flags.miss || a.flags.protect || a.flags.cant;
    // 持ち物の発動: 攻撃側 (いのちのたま等) と受ける側 (タスキ・オボン・半減実など)
    const atkItem = input.atkItem?.item, defItem = tgt ? input.defItem?.item : null;
    if (atkItem && side === 'opp') build.item = atkItem;
    if (defItem && tgt.side === 'opp') buildOf(b, 'opp', tgt.mon).item = defItem;
    if (atkItem || defItem) ctx = boardContext(b, usage);
    const sash = defItem === 'focussash';
    const heal = defItem === 'sitrusberry' ? 25 : defItem === 'oranberry' ? null : 0;
    let hp = input.hpAfter;
    if (sash && !failed && tgt) hp = tgt.side === 'me' ? 100 / statsOf(currentSpecies(buildOf(b, 'me', tgt.mon), condOf(b, 'me', tgt.mon)), buildOf(b, 'me', tgt.mon).sp, buildOf(b, 'me', tgt.mon).nature)[0] : 1;
    if (atkItem) a.atkItem = atkItem;
    if (defItem) a.defItem = defItem;
    if (!failed && tgt && hp != null && Number.isFinite(hp)) {
      a.hpAfter = Math.max(0, Math.min(100, hp));
      const tc = condOf(b, tgt.side, tgt.mon);
      const before = tc.hp;
      // ダメージから相手の能力を絞り込む (自分↔相手の技のみ)
      if (tgt.side !== side && a.hpAfter <= 0 && dex.moves[a.move]?.c !== 'Z') log.push('倒した/倒された場合は、ダメージからの推定はできません');
      // 回復実が発動していたら、回復前のHPに戻してからダメージを逆算する
      const hitAfter = heal ? Math.max(0.1, a.hpAfter - heal) : a.hpAfter;
      if (heal === null) log.push('オレンのみの回復量は割合に直せないため、このダメージからの推定は見送り');
      if (tgt.side !== side && inferable(a.move) && heal !== null && a.hpAfter > 0 && (sash || before > hitAfter)) {
        try {
          const oppIdx = side === 'opp' ? mon : tgt.mon, myIdx = side === 'opp' ? tgt.mon : mon;
          // 逆算は「いま盤面にある姿」で行う (メガシンカの想定は使わない)
          const ictx = {...ctx, cond: (sd, i) => b.state.mons[sd][i]};
          // きあいのタスキで耐えた = 満タンから倒れるだけのダメージが入っていた (下限だけ分かる)
          const iopt = {crit: a.flags.crit, itemUnknown: !b.opp[oppIdx].item, atLeast: sash};
          let r;
          if (side === 'opp') {
            const tb = buildOf(b, 'me', myIdx);
            const maxHP = statsOf(currentSpecies(tb, tc), tb.sp, tb.nature)[0];
            r = inferFromTaken(ictx, oppIdx, myIdx, a.move, sash ? maxHP : ((before - hitAfter) / 100) * maxHP, {...iopt, tol: input.exact ? 0.5 : maxHP * 0.006 + 0.5});
          } else r = inferFromDealt(ictx, myIdx, oppIdx, a.move, sash ? 100 : before, sash ? 0 : hitAfter, iopt);
          if (r) log.push(`相手の${speciesName(b.opp[oppIdx].species)}: ${applyInference(b.opp[oppIdx], ctx.views[oppIdx], r)}`);
          else log.push('この技はダメージからの推定に対応していません');
        } catch { /* 絞り込めなくても記録は続ける */ }
      }
      a.target = tgt;
    }
    if (!failed) applyMoveEffects(b, {...a, target: tgt}, {log, resolveAbility: res});
    if (a.hpAfter != null && tgt) setHP(b, tgt.side, tgt.mon, a.hpAfter);
    if (!failed && defItem && input.defItem.consumed !== false && tgt) condOf(b, tgt.side, tgt.mon).itemGone = true;
    if (atkItem && input.atkItem.consumed) condOf(b, side, mon).itemGone = true;
    if (a.to != null && !failed) {
      const s2 = b.state.sides[side].active.indexOf(mon);
      if (s2 >= 0) { a.toSp = buildOf(b, side, a.to)?.species; sendOut(b, side, s2, a.to, {log, resolveAbility: res}); }
    }
  }
  a.auto = log;
  t.acts.push(a);
  b.updatedAt = Date.now();
  return log;
}

const STATUS_JA = {'': '状態異常が回復', brn: 'やけど', par: 'まひ', psn: 'どく', tox: 'もうどく', slp: 'ねむり', frz: 'こおり'};
const STAT_JA = {atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ'};
const FLAG_JA = {reflect: 'リフレクター', lightScreen: 'ひかりのかべ', auroraVeil: 'オーロラベール', tailwind: 'おいかぜ', sr: 'ステルスロック', trickRoom: 'トリックルーム', gravity: 'じゅうりょく'};

/**
 * 行動以外の出来事を追加する (持ち物の発動・HPの変化・状態異常・ランク・場の変化など)。
 * ev: {side, mon?, kind, ...}
 *   kind 'item': {item, consumed, hpAfter?}  持ち物が判明/発動。オボンのみは hpAfter 省略で +25%
 *   kind 'hp': {hpAfter}   kind 'status': {status}   kind 'boost': {stat, delta}
 *   kind 'ability': {ability}   kind 'mega'   kind 'faint'
 *   kind 'field': {key: 'weather'|'terrain'|'trickRoom'|'gravity', value}
 *   kind 'side': {key: 'reflect'|..., value}  kind 'spikes': {value}
 */
export function addEvent(b, ev, usage) {
  const t = ensureTurn(b);
  const side = ev.side;
  const mon = ev.mon ?? b.state.sides[side].active.find(i => i != null);
  const build = mon != null ? buildOf(b, side, mon) : null;
  const cond = mon != null ? condOf(b, side, mon) : null;
  const who = build ? speciesName(build.species) : '';
  const res = boardContext(b, usage).strictAbility;
  const log = [];
  let text = '';
  const needMon = ['item', 'hp', 'status', 'boost', 'ability', 'mega', 'faint'].includes(ev.kind);
  if (needMon && !cond) return ['場にポケモンがいません'];
  if (ev.kind === 'item') {
    if (side === 'opp' && ev.item) build.item = ev.item;
    if (ev.consumed) cond.itemGone = true;
    let hp = ev.hpAfter;
    if (hp == null && ev.consumed && ev.item === 'sitrusberry') hp = Math.min(100, cond.hp + 25);
    if (hp != null) setHP(b, side, mon, hp);
    text = `${itemName(ev.item) || '持ち物'} ${ev.consumed ? '発動・消費' : '判明'}${hp != null ? ` → HP ${Math.round(hp)}%` : ''}`;
  } else if (ev.kind === 'hp') { setHP(b, side, mon, ev.hpAfter); text = `HP → ${Math.round(ev.hpAfter)}%${ev.note ? ` (${ev.note})` : ''}`; }
  else if (ev.kind === 'faint') { setHP(b, side, mon, 0); text = 'ひんし'; }
  else if (ev.kind === 'status') { cond.status = ev.status || ''; cond.toxicCounter = 1; text = STATUS_JA[ev.status || '']; }
  else if (ev.kind === 'boost') { applyBoosts(b, side, mon, {[ev.stat]: ev.delta}, {log: [], resolveAbility: () => ''}); text = `${STAT_JA[ev.stat]} ${ev.delta > 0 ? '+' : ''}${ev.delta} (→${cond.boosts[ev.stat] > 0 ? '+' : ''}${cond.boosts[ev.stat]})`; }
  else if (ev.kind === 'ability') { if (side === 'opp') build.ability = ev.ability; text = `特性 ${abilityName(ev.ability)} 判明`; }
  else if (ev.kind === 'mega') { megaEvolve(b, side, mon, ev.forme || null, {log, resolveAbility: res}); text = 'メガシンカ'; }
  else if (ev.kind === 'field') {
    if (ev.key === 'weather') { setWeather(b, ev.value); text = ev.value ? `天候: ${WEATHER_JA[ev.value]}` : '天候が元に戻った'; }
    else if (ev.key === 'terrain') { setTerrain(b, ev.value); text = ev.value ? TERRAIN_JA[ev.value] : 'フィールドが消えた'; }
    else { setFieldFlag(b, ev.key, !!ev.value); text = `${FLAG_JA[ev.key]} ${ev.value ? '発動' : '終了'}`; }
  } else if (ev.kind === 'side') { setSideFlag(b, side, ev.key, !!ev.value); text = `${FLAG_JA[ev.key]} ${ev.value ? '' : '終了'}`.trim(); }
  else if (ev.kind === 'spikes') { b.state.sides[side].spikes = Math.max(0, Math.min(3, ev.value)); text = `まきびし ${b.state.sides[side].spikes}層`; }
  else return [];
  t.acts.push({side, mon: needMon ? mon : null, type: 'event', kind: ev.kind, text, sp: needMon ? build.species : null, auto: log, flags: {}});
  b.updatedAt = Date.now();
  return [text, ...log];
}

// 時系列に出す1行
export function actLine(b, a) {
  if (a.type === 'event') return a.text;
  if (a.type === 'switch') return `交代 ${speciesName(a.toSp)}`;
  const f = a.flags || {};
  const tags = [a.mega && 'メガ', f.crit && '急所', f.miss && '外れ', f.protect && 'まもる', f.cant && '行動不能'].filter(Boolean).join('・');
  const items = [a.atkItem && `${itemName(a.atkItem)}`, a.defItem && `相手側 ${itemName(a.defItem)} 発動`].filter(Boolean).join('・');
  return `${moveName(a.move)}${a.hpAfter != null ? ` ${a.hpAfter > 0 && a.hpAfter < 1 ? 1 : Math.round(a.hpAfter)}%` : ''}${tags ? ` ${tags}` : ''}${items ? ` (${items})` : ''}${a.toSp ? ` → ${speciesName(a.toSp)}` : ''}`;
}
export {turnNumber, defaultAbilityResolver};
