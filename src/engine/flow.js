// 時系列での入力: 行動を1つずつ追加していく。追加のたびに盤面・判明情報・能力の絞り込みへ反映する。
import {dex, speciesName, moveName, statsOf, itemName, abilityName} from './dex.js';
import {currentSpecies, currentAbility, finalSpeed} from './calc.js';
import {clone, other, buildOf, condOf, sendOut, megaEvolve, applyMoveEffects, applyBoosts, setHP, turnNumber, UNDO_DEPTH, defaultAbilityResolver, setWeather, setTerrain, setSideFlag, setFieldFlag, WEATHER_JA, TERRAIN_JA, WEATHER_ABILITY, TERRAIN_ABILITY} from './battle.js';
import {boardContext} from './board.js';
import {inferFromTaken, inferFromDealt, applyInference, inferable, applyHpConstraint} from './infer-dmg.js';
import {inferSpeeds} from './infer.js';

export const openTurn = b => { const t = b.turns[b.turns.length - 1]; return t && t.open ? t : null; };

function ensureTurn(b) {
  let t = openTurn(b);
  if (!t) {
    // あとから入力を直せるよう、最初のターンの前の状態を残しておく (全ターンをここから再生する)
    if (!b.turns.length && !b.start) b.start = clone({state: b.state, pick: b.pick, opp: b.opp});
    t = {n: b.turns.length + 1, acts: [], orderKnown: true, note: '', auto: [], open: true, before: clone({state: b.state, pick: b.pick, opp: b.opp})};
    b.turns.push(t);
    for (let i = 0; i < b.turns.length - UNDO_DEPTH; i++) delete b.turns[i].before;
  }
  return t;
}

// ターンを締める: 行動順から素早さを絞り込み、ターン終了時の特性を処理する
export function endTurn(b, usage, opts = {}) {
  const t = openTurn(b);
  if (!t) return [];
  const log = [];
  const res = boardContext(b, usage).strictAbility;
  if (!opts.noOrder && !t.noOrder && t.before && t.acts.filter(a => a.type === 'move').length >= 2) {
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
  // おいかぜ (4ターン) とトリックルーム (5ターン) は延長できないので自動で終了させる
  for (const side of ['me', 'opp']) {
    const sd = b.state.sides[side];
    if (sd.tailwind && sd.since?.tailwind != null && t.n - sd.since.tailwind + 1 >= 4) { setSideFlag(b, side, 'tailwind', false); log.push(`${side === 'me' ? '自分' : '相手'}のおいかぜが終了 (4ターン)`); }
  }
  if (b.state.field.trickRoom && b.state.field.since?.trickRoom != null && t.n - b.state.field.since.trickRoom + 1 >= 5) { setFieldFlag(b, 'trickRoom', false); log.push('トリックルームが終了 (5ターン)'); }
  // 天候・フィールド・トリックルームの残りターンの目安
  const f = b.state.field;
  for (const [key, label, base, ext] of [['weather', '天候', 5, 8], ['terrain', 'フィールド', 5, 8]]) {
    if (!f[key] || f.since?.[key] == null) continue;
    const n = t.n - f.since[key] + 1;
    void n; void base; void ext; void label;
  }
  // ターン終了時の処理の順番 (先に処理されたほうが速い) から素早さを絞り込む
  if (opts.resFirst === 'me' || opts.resFirst === 'opp') {
    try {
      const fm = (sd) => b.state.sides[sd].active.find(i => i != null && !condOf(b, sd, i)?.fainted);
      const first = opts.resFirst, second = other(first);
      if (fm(first) != null && fm(second) != null) {
        const sim = clone(b);
        const acts = [{type: 'move', side: first, mon: fm(first), move: 'tackle', flags: {}}, {type: 'move', side: second, mon: fm(second), move: 'tackle', flags: {}}];
        const before = sim.opp.map(o => JSON.stringify(o.speOk || null));
        log.push(...inferSpeeds(sim, {acts}, {resolveAbility: res}).map(x => `ターン終了時の処理の順番から ${x}`));
        sim.opp.forEach((o, i) => { if (JSON.stringify(o.speOk || null) !== before[i] && b.opp[i]) { b.opp[i].speOk = o.speOk; b.opp[i].scarfLikely = o.scarfLikely; } });
      }
    } catch { /* 絞り込めなくても続ける */ }
  }
  // やどりぎのタネで吸い取った量 (自分の回復量) から、相手の最大HP → HPの能力ポイントが分かる
  for (const h of opts.hpFacts || []) {
    const o = b.opp[h.opp];
    if (o && h.steps) { const m = inferHpFromDisplay(b, h.opp, h.d0, h.d1, h.steps); if (m) log.push(m); continue; }
    if (!o || !(h.drain > 0)) continue;
    const base = dex.species[currentSpecies(o, condOf(b, 'opp', h.opp))]?.bs[0];
    if (base == null) continue;
    log.push(`相手の${speciesName(o.species)}: やどりぎのタネの回復量 ${h.drain} から ${applyHpConstraint(o, sp => Math.floor(statsOf(currentSpecies(o, condOf(b, 'opp', h.opp)), [sp, 0, 0, 0, 0, 0], 'Serious')[0] / 8) === h.drain)}`);
  }
  // 5ターン目 (延長なら8ターン目) の天候・フィールド・壁: 終わったかどうか → 延長する持ち物の判定
  for (const x of opts.expiry || []) log.push(...applyExpiry(b, x));
  for (const sd of ['me', 'opp']) for (const c of b.state.mons[sd]) if (c) c.hazard = false;
  t.open = false;
  t.end = {noOrder: !!(opts.noOrder || t.noOrder), resFirst: opts.resFirst || undefined, hpFacts: opts.hpFacts?.length ? opts.hpFacts : undefined, expiry: opts.expiry?.length ? opts.expiry : undefined};
  t.auto.push(...log);
  b.updatedAt = Date.now();
  return log;
}

// ダメージからの逆算が当てにならない状況 (理由の文を返す)
function unsafeForInference(b, t, side, mon, tgt, move, res, crit) {
  const ac = condOf(b, side, mon), tc = condOf(b, tgt.side, tgt.mon);
  if (ac?.tricked || tc?.tricked) return '持ち物が入れ替わっている';
  if (ac?.transformed || tc?.transformed) return 'へんしんしている';
  if (tc?.glaive) return 'きょけんとつげきの直後で受けるダメージが2倍になっている';
  if (t.acts.some(x => x.type === 'move' && x.move === 'roost' && x.side === tgt.side && x.mon === tgt.mon && !x.flags?.miss && !x.flags?.cant)) return 'はねやすめでタイプが変わっている';
  if (crit && dex.moves[move]?.mh) return '連続技の急所は1発ごとに決まる';
  const ab = buildOf(b, side, mon);
  const sp = dex.species[currentSpecies(ab, ac)];
  const known = res(b, side, mon);
  const abs = known ? [known] : (sp?.ab || []);
  if (abs.includes('analytic')) return 'アナライズの補正が行動順で変わる';
  if (dex.moves[move]?.t === 'Electric' && (abs.includes('electromorphosis') || abs.includes('windpower') || (ab.moves || []).includes('charge'))) return 'じゅうでん状態かどうかで威力が変わる';
  return '';
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
  if (t && !input.sameTurn && t.acts.some(a => a.type !== 'event' && a.side === side && (a.mon === mon || a.to === mon))) { endTurn(b, usage); t = null; }
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
    condOf(b, side, mon).glaive = false;
    sendOut(b, side, slot, a.to, {log, resolveAbility: res});
  } else {
    if (a.mega) { megaEvolve(b, side, mon, input.megaForme || null, {log, resolveAbility: res}); ctx = boardContext(b, usage); }
    // へんしん中に使った技は相手からコピーした技なので、判明した技には入れない
    if (side === 'opp' && !condOf(b, side, mon)?.transformed && dex.moves[a.move] && !build.moves.includes(a.move) && build.moves.length < 4) build.moves.push(a.move);
    const foe = other(side);
    const tgt = a.target || (() => { const f = b.state.sides[foe].active.filter(i => i != null && !condOf(b, foe, i)?.fainted); return f.length === 1 ? {side: foe, mon: f[0]} : null; })();
    const failed = a.flags.miss || a.flags.protect || a.flags.cant;
    // 持ち物の発動: 攻撃側 (いのちのたま等) と受ける側 (タスキ・オボン・半減実など)
    const atkItem = input.atkItem?.item, defItem = tgt ? input.defItem?.item : null;
    if (atkItem && side === 'opp') build.item = atkItem;
    if (defItem && tgt.side === 'opp') buildOf(b, 'opp', tgt.mon).item = defItem;
    if (atkItem || defItem) ctx = boardContext(b, usage);
    // きあいのタスキ・がんじょう・こらえる等で「本来は倒れるダメージを耐えた」
    const sash = defItem === 'focussash' || !!input.endured;
    const heal = defItem === 'sitrusberry' ? 25 : defItem === 'oranberry' ? null : 0;
    let hp = input.hpAfter;
    if (sash && !failed && tgt) hp = tgt.side === 'me' ? 100 / statsOf(currentSpecies(buildOf(b, 'me', tgt.mon), condOf(b, 'me', tgt.mon)), buildOf(b, 'me', tgt.mon).sp, buildOf(b, 'me', tgt.mon).nature)[0] : 1;
    if (input.hits) a.hits = input.hits;
    if (atkItem) a.atkItem = atkItem;
    if (defItem) a.defItem = defItem;
    // 入れたHPが「たべのこし等でターン終了時に回復したあと」の値なら、回復分を引いて攻撃直後のHPに戻す
    // (回復はターン終了の処理で改めて足すので、HPの流れが正しくなる)
    if (!failed && tgt && hp != null && Number.isFinite(hp) && hp > 0 && input.healedBy?.length) {
      let sub = 0;
      for (const key of input.healedBy) {
        const fr = residualFrac(b, tgt.side, tgt.mon, key);
        if (fr <= 0) continue;
        if (tgt.side === 'me') { const tb0 = buildOf(b, 'me', tgt.mon); const mx = statsOf(currentSpecies(tb0, condOf(b, 'me', tgt.mon)), tb0.sp, tb0.nature)[0]; sub += (Math.max(1, Math.floor(mx * fr)) / mx) * 100; }
        else sub += fr * 100;
        if (tgt.side === 'opp' && RESIDUAL_ITEM[key] && !buildOf(b, 'opp', tgt.mon).item) buildOf(b, 'opp', tgt.mon).item = RESIDUAL_ITEM[key];
      }
      hp = Math.max(0.1, hp - sub);
      a.healedBy = [...input.healedBy];
      log.push(`入力したHPから${input.healedBy.map(k => RESIDUAL_JA[k].replace(/で回復$/, '')).join('・')}の回復分を引いて計算`);
    }
    if (!failed && tgt && hp != null && Number.isFinite(hp)) {
      a.hpAfter = Math.max(0, Math.min(100, hp));
      const tc = condOf(b, tgt.side, tgt.mon);
      const before = tc.hp;
      // ダメージから相手の能力を絞り込む (自分↔相手の技のみ)
      if (tgt.side !== side && a.hpAfter <= 0 && dex.moves[a.move]?.c !== 'Z') log.push('倒した/倒された場合は、ダメージからの推定はできません');
      // 回復実が発動していたら、回復前のHPに戻してからダメージを逆算する
      let healPct = heal;
      if (heal && tgt.side === 'me') { const tb0 = buildOf(b, 'me', tgt.mon); const mx = statsOf(currentSpecies(tb0, tc), tb0.sp, tb0.nature)[0]; healPct = (Math.floor(mx / 4) / mx) * 100; }
      const hitAfter = heal ? Math.max(0.1, a.hpAfter - healPct) : a.hpAfter;
      if (heal === null) log.push('オレンのみの回復量は割合に直せないため、このダメージからの推定は見送り');
      const unsafe = tgt.side !== side ? unsafeForInference(b, t, side, mon, tgt, a.move, res, a.flags.crit) : '';
      if (unsafe && tgt.side !== side && inferable(a.move) && a.hpAfter > 0) log.push(`${unsafe}ため、このダメージからの推定は見送り`);
      if (!unsafe && tgt.side !== side && inferable(a.move) && heal !== null && a.hpAfter > 0 && (sash || before > hitAfter)) {
        try {
          const oppIdx = side === 'opp' ? mon : tgt.mon, myIdx = side === 'opp' ? tgt.mon : mon;
          // 逆算は「いま盤面にある姿」で行う (メガシンカの想定は使わない)
          const ictx = {...ctx, cond: (sd, i) => b.state.mons[sd][i]};
          ictx.ability = (sd, i) => { const bd = ictx.build(sd, i); return bd ? currentAbility(bd, ictx.cond(sd, i)) : ''; };
          // きあいのタスキで耐えた = 満タンから倒れるだけのダメージが入っていた (下限だけ分かる)
          const os = dex.species[b.opp[oppIdx].species];
          const iopt = {crit: a.flags.crit, itemUnknown: !b.opp[oppIdx].item, abilityUnknown: !b.opp[oppIdx].ability && os.ab.length > 1, atLeast: sash, ...(heal && side === 'me' ? {tol: 2} : {}),
            hits: input.hits ? {[a.move]: input.hits} : undefined};
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
    if (tgt && !a.target && tgt.side !== side) a.target = tgt;
    condOf(b, side, mon).glaive = !failed && a.move === 'glaiverush';
    // やどりぎのタネ: くさタイプ以外に当たると、交代するまで毎ターン 1/8 減る
    if (!failed && tgt && a.move === 'leechseed' && !dex.species[currentSpecies(buildOf(b, tgt.side, tgt.mon), condOf(b, tgt.side, tgt.mon))]?.t.includes('Grass')) condOf(b, tgt.side, tgt.mon).seeded = true;
    // サイコノイズ: 当たった相手は2ターンの間 回復できない (たべのこし等も発動しない)
    if (!failed && tgt && a.move === 'psychicnoise' && !condOf(b, tgt.side, tgt.mon).fainted) { condOf(b, tgt.side, tgt.mon).healBlock = t.n + 1; log.push(`${tgt.side === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, tgt.side, tgt.mon).species)}は2ターン回復できない`); }
    if (!failed) applyMoveEffects(b, {...a, target: tgt}, {log, resolveAbility: res});
    if (!failed && tgt && (a.move === 'trick' || a.move === 'switcheroo')) {
      // 持ち物が入れ替わると、以後の持ち物は確定できない
      condOf(b, side, mon).tricked = true; condOf(b, tgt.side, tgt.mon).tricked = true;
      log.push('持ち物が入れ替わったため、この2体は以後の推定 (ダメージ・行動順) の対象から外します');
    }
    // 確率で起きる追加効果のうち、実際に起きたもの (ダメージのあとに確認した結果)
    if (!failed && tgt && input.secFx?.length) {
      a.secFx = input.secFx;
      const tc3 = condOf(b, tgt.side, tgt.mon);
      for (const e of input.secFx) {
        if (e.bo && !tc3.fainted) applyBoosts(b, tgt.side, tgt.mon, e.bo, {log, fromOpp: true, resolveAbility: res});
        if (e.sb) applyBoosts(b, side, mon, e.sb, {log, resolveAbility: res});
        if (e.st && !tc3.fainted && !tc3.status) { tc3.status = e.st; tc3.toxicCounter = 1; log.push(`${tgt.side === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, tgt.side, tgt.mon).species)}は${STATUS_JA[e.st]}になった`); }
        if (e.vo === 'flinch') log.push('ひるんだ');
        if (e.vo === 'confusion') log.push('こんらんした');
      }
    }
    const hpBeforeHit = tgt ? condOf(b, tgt.side, tgt.mon).hp : null;
    if (a.hpAfter != null && tgt) setHP(b, tgt.side, tgt.mon, a.hpAfter);
    // 被弾時の特性は「判明している特性」だけで反映する (使用率からの推測で能力ランクを動かさない)
    if (!failed && tgt && tgt.side !== side) onHitEffects(b, {side, mon, move: a.move, crit: a.flags.crit, tgt, before: hpBeforeHit, defItem}, defaultAbilityResolver, log);
    // 攻撃した側のHPの変化 (いのちのたま・反動・ゴツゴツメット・さめはだ・吸収)
    if (!failed && tgt && tgt.side !== side && input.selfFx?.length) attackerHpEffects(b, {side, mon, tgt, move: a.move, fx: input.selfFx, hpAfter: input.atkHpAfter, tgtBefore: hpBeforeHit, a}, log);
    // 追加効果・変化技で相手が状態異常になった
    if (!failed && tgt && input.inflict && !condOf(b, tgt.side, tgt.mon).fainted) {
      const tc2 = condOf(b, tgt.side, tgt.mon);
      tc2.status = input.inflict; tc2.toxicCounter = 1; a.inflict = input.inflict;
      log.push(`${tgt.side === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, tgt.side, tgt.mon).species)}は${STATUS_JA[input.inflict]}になった`);
    }
    if (!failed && defItem && input.defItem.consumed !== false && tgt) condOf(b, tgt.side, tgt.mon).itemGone = true;
    if (atkItem && input.atkItem.consumed) condOf(b, side, mon).itemGone = true;
    if (a.to != null && !failed) {
      const s2 = b.state.sides[side].active.indexOf(mon);
      if (s2 >= 0) {
        a.toSp = buildOf(b, side, a.to)?.species;
        // バトンタッチはランク変化を引き継ぐ
        const passed = a.move === 'batonpass' ? {...condOf(b, side, mon).boosts} : null;
        sendOut(b, side, s2, a.to, {log, resolveAbility: res});
        if (passed && Object.values(passed).some(Boolean)) { condOf(b, side, a.to).boosts = passed; log.push('バトンタッチ: ランク変化を引き継ぎ'); }
      }
    }
  }
  if (input.hpUnknown) a.hpUnknown = true;
  a.auto = log;
  a.in = inputCopy(input);
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
  const needMon = ['item', 'hp', 'status', 'boost', 'ability', 'mega', 'faint', 'residual', 'hazard'].includes(ev.kind);
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
  else if (ev.kind === 'residual') {
    const r = residualDelta(b, side, mon, ev.key);
    if (!r) return [];
    const was = cond.hp;
    setHP(b, side, mon, cond.hp + r.pct);
    if (ev.key === 'tox') cond.toxicCounter = Math.min(15, (cond.toxicCounter || 1) + 1);
    if (side === 'opp' && RESIDUAL_ITEM[ev.key] && !build.item) build.item = RESIDUAL_ITEM[ev.key];
    text = `${RESIDUAL_JA[ev.key]} ${r.pct > 0 ? '+' : ''}${side === 'me' ? `${r.hp}` : `${Math.round(r.pct * 10) / 10}%`}${cond.fainted && was > 0 ? ' → ひんし' : ''}`;
  } else if (ev.kind === 'hazard') {
    cond.hazard = false;
    if (ev.none) {
      text = '設置技のダメージを受けなかった';
      if (side === 'opp' && !build.item && (b.state.sides.opp.sr || hazardDamage(b, side, mon)?.pct)) { build.item = 'heavydutyboots'; text += ' (あつぞこブーツ)'; }
    } else {
      const d = hazardDamage(b, side, mon);
      const hp = ev.hpAfter ?? (d ? Math.max(0, cond.hp - d.pct) : cond.hp);
      // 相手: 表示の % (切り捨て) から最大HPを絞り込む
      if (side === 'opp' && ev.hpAfter != null && d && Number.isInteger(cond.hp)) {
        const msg = inferHpFromDisplay(b, mon, cond.hp, Math.round(ev.hpAfter), [{k: 'hazard', frac: d.pct / 100}]);
        if (msg) log.push(msg);
      }
      setHP(b, side, mon, hp);
      text = `設置技のダメージ → HP ${side === 'me' ? `${Math.round((hp * maxHPOf(b, side, mon)) / 100)}` : `${Math.round(hp)}%`}`;
    }
  } else if (ev.kind === 'send') {
    const slot = ev.slot ?? b.state.sides[side].active.findIndex(x => x == null || condOf(b, side, x)?.fainted);
    if (slot < 0 || ev.to == null) return ['出す場所がありません'];
    // 同時に場に出たか (対戦の最初・同じタイミングの死に出し): まだ誰も行動していないターンで、
    // 相手側も最初から場にいる / このターンに出てきた
    const others = t.acts.filter(x => x.type !== 'event');
    const simul = !others.length && (b.turns.length === 1 || t.acts.some(x => x.kind === 'send' && x.side === other(side)));
    sendOut(b, side, slot, ev.to, {log, resolveAbility: res});
    if (simul) log.push(...simultaneousEntry(b, usage, side, ev.to, res));
    text = '場に出た';
    t.acts.push({side, mon: ev.to, type: 'event', kind: 'send', text, sp: buildOf(b, side, ev.to).species, auto: log, flags: {}, in: inputCopy({...ev, slot})});
    b.updatedAt = Date.now();
    return [text, ...log];
  }
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
  t.acts.push({side, mon: needMon ? mon : null, type: 'event', kind: ev.kind, text, sp: needMon ? build.species : null, auto: log, flags: {}, in: inputCopy({...ev, mon: needMon ? mon : ev.mon})});
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
  if (a.type === 'move' && !a.move) return f.cant ? '行動できず' : '(技不明)';
  return `${moveName(a.move)}${a.hpUnknown ? ' HP?' : ''}${a.inflict ? ` ${STATUS_JA[a.inflict]}` : ''}${a.secFx?.length ? ' 追加効果' : ''}${a.hpAfter != null ? ` ${dispOf(a.hpAfter)}%` : ''}${tags ? ` ${tags}` : ''}${items ? ` (${items})` : ''}${a.toSp ? ` → ${speciesName(a.toSp)}` : ''}`;
}
export {turnNumber, defaultAbilityResolver};

// 入力の控え (再生用)。sameTurn は再生時に付け直す
function inputCopy(input) {
  const c = clone(input || {});
  delete c.sameTurn;
  return c;
}

// 古い記録 (入力の控えがない行動) から入力を組み立てる
function legacyInput(a) {
  if (a.type === 'event') return null;
  const f = a.flags || {};
  return {side: a.side, mon: a.mon, type: a.type, move: a.move, to: a.to, mega: a.mega, crit: f.crit, miss: f.miss, protect: f.protect, cant: f.cant,
    target: a.target, hpAfter: a.hpAfter, hits: a.hits, defItem: a.defItem ? {item: a.defItem} : null, atkItem: a.atkItem ? {item: a.atkItem} : null};
}

// 入力をあとから直せるか (最初の状態が残っていて、すべての出来事に入力の控えがある)
export function canReplay(b) {
  if (!(b.start || b.turns[0]?.before)) return false;
  return b.turns.every(t => t.acts.every(a => a.in || a.type !== 'event'));
}

/**
 * 最初の状態から全ターンを入れ直す。行動を直した・消したときに使う。
 * 相手の判明情報のうち、行動から分かったもの (技・持ち物・能力の絞り込み) は作り直し、
 * 手で入れた情報 (行動に出てこない技・持ち物・特性) は残す。
 */
export function replay(b, usage, opts = {}) {
  const start = b.start || b.turns[0]?.before;
  if (!start) return false;
  const old = b.turns;
  const fromActs = new Set();
  for (const t of old) for (const a of t.acts) if (a.side === 'opp' && a.type === 'move') fromActs.add(a.move);
  for (const m of opts.fromActs || []) fromActs.add(m);
  const prev = clone(b.opp);
  b.start = clone(start);
  b.state = clone(start.state);
  b.pick = clone(start.pick);
  b.opp.forEach((o, i) => {
    const s0 = start.opp?.[i];
    if (!s0 || s0.species !== o.species) return;
    // 特性は対戦を通して変わらないので、分かっていれば最初から入れて再生する (登場時の特性の処理が正しくなる)
    Object.assign(o, {item: s0.item || '', ability: prev[i]?.species === o.species && prev[i].ability ? prev[i].ability : s0.ability || '', moves: [...(s0.moves || [])], statOk: s0.statOk ?? null, speOk: s0.speOk ?? null, scarfLikely: !!s0.scarfLikely, megaSeen: !!s0.megaSeen});
  });
  b.turns = [];
  for (const t of old) {
    for (const a of t.acts) {
      const inp = a.in || legacyInput(a);
      if (!inp) continue;
      if (a.type === 'event') addEvent(b, inp, usage);
      else addAct(b, {...inp, sameTurn: true}, usage);
    }
    const nt = ensureTurn(b);
    nt.note = t.note || '';
    if (t.noOrder) nt.noOrder = true;
    if (!t.open) endTurn(b, usage, t.end || {});
  }
  // イリュージョンで分かった「選出の最後」を、選出の並びの最後に入れる
  if (b.illusionLast != null && b.opp[b.illusionLast]) {
    b.pick.opp = [...b.pick.opp.filter(i => i !== b.illusionLast), b.illusionLast];
  }
  b.opp.forEach((o, i) => {
    const p = prev[i];
    if (!p || p.species !== o.species) return;
    if (!o.item && p.item && !p.megaSeen) o.item = p.item;
    if (!o.ability && p.ability) o.ability = p.ability;
    for (const m of p.moves || []) if (!fromActs.has(m) && !o.moves.includes(m) && o.moves.length < 4) o.moves.push(m);
    o.assume = p.assume; o.note = p.note;
  });
  b.updatedAt = Date.now();
  return true;
}

/** ti ターン目の ai 番目の行動を input に置き換える (null で削除)。置き換え後、全体を入れ直す。 */
export function editAct(b, ti, ai, input, usage) {
  const t = b.turns[ti];
  if (!t || !t.acts[ai] || !canReplay(b)) return false;
  const was = t.acts[ai];
  const fromActs = was.side === 'opp' && was.type === 'move' ? [was.move] : [];
  if (input == null) t.acts.splice(ai, 1);
  else t.acts[ai] = {...t.acts[ai], in: inputCopy(input)};
  // 空になった入力途中のターンは消す
  if (!t.acts.length && t.open) b.turns.splice(ti, 1);
  return replay(b, usage, {fromActs});
}

/**
 * イリュージョン (ゾロアーク) の正体が分かった: いま場にいる相手 (化けていた姿) を、最後に場に出たところから
 * ゾロアーク (zIdx) に置き換えて、全体を入れ直す。化けていた間のダメージなどはゾロアークの記録になる。
 * 戻り値: 置き換えた行動の数 (入れ直せないときは -1)
 */
export function revealIllusion(b, usage, zIdx) {
  if (!canReplay(b)) return -1;
  const x = b.state.sides.opp.active.find(i => i != null && !condOf(b, 'opp', i)?.fainted);
  if (x == null || x === zIdx || !b.opp[zIdx]) return -1;
  // x が最後に場に出た行動を探す (なければ初手)
  let from = null;
  b.turns.forEach((t, ti) => t.acts.forEach((a, ai) => {
    const inp = a.in || {};
    const enters = a.side === 'opp' && ((a.type === 'switch' && (inp.to ?? a.to) === x) || (a.kind === 'send' && inp.to === x) || (a.type === 'move' && (inp.to ?? a.to) === x));
    if (enters) from = {ti, ai};
  }));
  let n = 0;
  const swap = v => (v === x ? zIdx : v);
  const rewrite = (a, entering) => {
    if (!a.in) return;
    const inp = a.in;
    if (entering) { inp.to = zIdx; n++; return; }
    if (a.side === 'opp' && inp.mon === x) { inp.mon = zIdx; n++; }
    if (a.side === 'opp' && a.type !== 'event' && inp.mon == null && a.mon === x) { inp.mon = zIdx; n++; }
    if (inp.target?.side === 'opp' && inp.target.mon === x) { inp.target = {...inp.target, mon: zIdx}; n++; }
  };
  if (!from) {
    // 初手から化けていた: 最初の盤面の先頭を入れ替える
    const st = b.start || b.turns[0]?.before;
    if (!st) return -1;
    st.state.sides.opp.active = st.state.sides.opp.active.map(swap);
    st.pick.opp = [...new Set(st.pick.opp.map(swap))];
    b.turns.forEach(t => t.acts.forEach(a => rewrite(a, false)));
  } else {
    b.turns.forEach((t, ti) => t.acts.forEach((a, ai) => {
      if (ti < from.ti || (ti === from.ti && ai < from.ai)) return;
      rewrite(a, ti === from.ti && ai === from.ai);
    }));
  }
  // 化けていた姿のポケモンの技・推定は、ゾロアークの行動から来たものなので消す
  b.opp[x].moves = [];
  b.opp[x].statOk = null; b.opp[x].speOk = null;
  if (b.start?.opp?.[x]) { b.start.opp[x].moves = []; b.start.opp[x].statOk = null; b.start.opp[x].speOk = null; }
  // イリュージョンは「選出の最後のポケモン」に化けるので、化けられていたポケモンは選出の最後 (確定)
  b.illusionLast = x;
  replay(b, usage, {fromActs: []});
  b.opp[zIdx].illusionSeen = true;
  return n;
}

/** 入力途中のターンを、ターン終了前に戻す (閉じたターンを開き直す) */
export function reopenLastTurn(b, usage) {
  const t = b.turns[b.turns.length - 1];
  if (!t || t.open || !canReplay(b)) return false;
  t.open = true;
  delete t.end;
  return replay(b, usage);
}

// ---- ターン終了時の処理 (たべのこし・定数ダメージなど) ----
const RESIDUAL_JA = {sand: 'すなあらしのダメージ', grassy: 'グラスフィールドで回復', leftovers: 'たべのこしで回復', blacksludge: 'くろいヘドロ', psn: 'どくのダメージ', tox: 'もうどくのダメージ',
  brn: 'やけどのダメージ', leechseed: 'やどりぎのタネ', leechheal: 'やどりぎのタネで回復', poisonheal: 'ポイズンヒールで回復', raindish: 'あめうけざらで回復', dryskin: 'かんそうはだ', solarpower: 'サンパワーのダメージ', icebody: 'アイスボディで回復'};
const RESIDUAL_ITEM = {leftovers: 'leftovers', blacksludge: 'blacksludge'};
export {RESIDUAL_JA};

function residualFrac(b, side, mon, key) {
  const build = buildOf(b, side, mon), cond = condOf(b, side, mon);
  const types = dex.species[currentSpecies(build, cond)]?.t || [];
  const w = b.state.field.weather;
  switch (key) {
    case 'sand': return -1 / 16;
    case 'grassy': case 'leftovers': case 'raindish': case 'icebody': return 1 / 16;
    case 'blacksludge': return types.includes('Poison') ? 1 / 16 : -1 / 8;
    case 'psn': return -1 / 8;
    case 'tox': return -Math.min(15, cond.toxicCounter || 1) / 16;
    case 'brn': return -1 / 16;
    case 'leechseed': return -1 / 8;
    case 'poisonheal': return 1 / 8;
    case 'dryskin': return w === 'Rain' ? 1 / 8 : -1 / 8;
    case 'solarpower': return -1 / 8;
    default: return 0;
  }
}

// 1回分の変化量 {pct: HP割合の変化, hp: 自分なら実数の変化}。満タンで回復しないときは null
// 最大HPの実数 (相手は能力ポイントが分からないので HP に 16 振った見込みで近似)
const maxHPOf = (b, side, mon) => {
  const bd = buildOf(b, side, mon), c = condOf(b, side, mon);
  return statsOf(currentSpecies(bd, c), side === 'me' ? bd.sp : [16, 0, 0, 0, 0, 0], side === 'me' ? bd.nature : 'Serious')[0];
};
function residualDelta(b, side, mon, key, hpNow) {
  const cond = condOf(b, side, mon), build = buildOf(b, side, mon);
  const cur = hpNow ?? cond?.hp;
  if (!cond || cond.fainted || cur <= 0) return null;
  if (key === 'leechheal') {
    // やどりぎのタネを植えた相手から吸い取った分だけ回復する
    const fs = other(side), fm = b.state.sides[fs].active.find(i => i != null && condOf(b, fs, i)?.seeded && !condOf(b, fs, i)?.fainted);
    if (fm == null || cur >= 100) return null;
    const drain = Math.max(1, Math.floor(maxHPOf(b, fs, fm) / 8));
    const myMax = maxHPOf(b, side, mon);
    if (side === 'me') { const now = Math.round((cur * myMax) / 100); const d = Math.min(myMax - now, drain); return {pct: (d / myMax) * 100, hp: d}; }
    return {pct: Math.min(100 - cur, (drain / myMax) * 100)};
  }
  const f = residualFrac(b, side, mon, key);
  if (!f || (f > 0 && cur >= 100)) return null;
  if (side === 'me') {
    const max = statsOf(currentSpecies(build, cond), build.sp, build.nature)[0];
    const now = Math.round((cur * max) / 100);
    // もうどくは「最大HPの1/16 (切り捨て) × 段階」
    let d = key === 'tox' ? -Math.max(1, Math.floor(max / 16)) * Math.min(15, cond.toxicCounter || 1) : Math.max(1, Math.floor(max * Math.abs(f))) * Math.sign(f);
    d = Math.max(-now, Math.min(max - now, d));
    return {pct: (d / max) * 100, hp: d};
  }
  return {pct: Math.max(-cur, Math.min(100 - cur, f * 100))};
}

/**
 * いまの盤面で、ターン終了時に起きそうな処理の候補。
 * checked: 確実に起きる (持ち物・特性・状態が判明している) もの。false は「起きたら選ぶ」候補。
 */
export function residualCandidates(b, usage) {
  const ctx = boardContext(b, usage);
  const out = [];
  const w = b.state.field.weather, terrain = b.state.field.terrain;
  for (const side of ['me', 'opp']) {
    for (const mon of b.state.sides[side].active) {
      if (mon == null) continue;
      const build = buildOf(b, side, mon), cond = condOf(b, side, mon);
      if (!build || !cond || cond.fainted) continue;
      const types = dex.species[currentSpecies(build, cond)]?.t || [];
      const known = ctx.strictAbility(b, side, mon);
      const abs = known ? [known] : side === 'opp' ? (dex.species[currentSpecies(build, cond)]?.ab || []) : [];
      const sure = ab => known === ab;
      const maybe = ab => abs.includes(ab);
      if (maybe('magicguard') && sure('magicguard')) { /* 定数ダメージを受けない */ }
      const itemKnown = side === 'me' || !!build.item;
      const item = cond.itemGone ? '' : side === 'me' ? build.item : build.item;
      const itemRates = side === 'opp' && !build.item ? Object.fromEntries(ctx.views[mon]?.items || []) : {};
      const already = new Set((openTurn(b)?.acts || []).filter(x => x.target?.side === side && x.target?.mon === mon).flatMap(x => x.healedBy || []));
      // 処理は順番に起きる (例: すなあらしで減ってから たべのこしで回復) ので、確実なものはHPを進めながら候補を作る
      // HPを「わからない」で飛ばした攻撃を受けていたら、満タンでない前提で候補を出す
      const unknownHit = (openTurn(b)?.acts || []).some(x => x.hpUnknown && x.target?.side === side && x.target?.mon === mon);
      let simHp = unknownHit ? 50 : cond.hp;
      const blocked = (cond.healBlock || 0) >= (openTurn(b)?.n ?? turnNumber(b));
      const push = (key, checked) => {
        const r = residualDelta(b, side, mon, key, simHp);
        if (!r || (blocked && r.pct > 0)) return;
        const ch = checked || already.has(key);
        out.push({side, mon, key, label: RESIDUAL_JA[key], pct: r.pct, hp: r.hp, checked: ch, unknown: unknownHit});
        if (ch) simHp = Math.max(0, Math.min(100, simHp + r.pct));
      };
      const noIndirect = sure('magicguard');
      if (w === 'Sand' && !noIndirect && !types.some(t => ['Rock', 'Ground', 'Steel'].includes(t)) && item !== 'safetygoggles' && !['sandveil', 'sandrush', 'sandforce', 'overcoat'].some(sure))
        push('sand', !['sandveil', 'sandrush', 'sandforce', 'overcoat', 'magicguard'].some(maybe));
      if (terrain === 'Grassy' && !types.includes('Flying') && !sure('levitate') && item !== 'airballoon') push('grassy', !maybe('levitate'));
      if (!cond.itemGone) {
        if (itemKnown) { if (item === 'leftovers') push('leftovers', true); if (item === 'blacksludge') push('blacksludge', true); }
        else {
          if ((itemRates.leftovers || 0) > 0) push('leftovers', false);
          if ((itemRates.blacksludge || 0) > 0) push('blacksludge', false);
        }
      }
      if ((cond.status === 'psn' || cond.status === 'tox') && maybe('poisonheal')) push('poisonheal', sure('poisonheal'));
      if (cond.status === 'psn' && !noIndirect && !sure('poisonheal')) push('psn', !maybe('poisonheal') && !maybe('magicguard'));
      if (cond.status === 'tox' && !noIndirect && !sure('poisonheal')) push('tox', !maybe('poisonheal') && !maybe('magicguard'));
      if (cond.status === 'brn' && !noIndirect) push('brn', !maybe('magicguard'));
      if (cond.seeded && !noIndirect) push('leechseed', !maybe('magicguard'));
      { const fs = other(side); if (b.state.sides[fs].active.some(i => i != null && condOf(b, fs, i)?.seeded && !condOf(b, fs, i)?.fainted)) push('leechheal', true); }
      if (w === 'Rain' && maybe('raindish')) push('raindish', sure('raindish'));
      if ((w === 'Rain' || w === 'Sun') && maybe('dryskin')) push('dryskin', sure('dryskin'));
      if (w === 'Sun' && maybe('solarpower')) push('solarpower', sure('solarpower'));
      if (w === 'Snow' && maybe('icebody')) push('icebody', sure('icebody'));
    }
  }
  return out;
}

/** ターンを締める: 選んだターン終了時の処理を記録してから endTurn */
/**
 * ターンを締める。
 * residual: 選んだターン終了時の処理 / finalHp: {'me0': 割合} ターン終了後のHP (分かったもの)
 * resFirst: 先に処理されたのはどちらか / expiry: [{key, ended, n}] 5ターン目のものが終わったか
 */
export function finishTurn(b, usage, {residual = [], noOrder = false, finalHp = {}, resFirst, expiry = []} = {}) {
  let t = ensureTurn(b);
  const log = [];
  // 「わからない」で飛ばした攻撃のHPを、ターン終了後のHPから逆算して入れ直す
  let changed = false;
  for (const [k, val] of Object.entries(finalHp)) {
    if (val == null || !Number.isFinite(val)) continue;
    const side = k.startsWith('me') ? 'me' : 'opp', mon = Number(k.replace(/^(me|opp)/, ''));
    const act = [...t.acts].reverse().find(a => a.type === 'move' && a.in?.hpUnknown && a.target?.side === side && a.target?.mon === mon);
    if (!act) continue;
    let h = val;
    for (const r of [...residual].reverse()) if (r.side === side && r.mon === mon) { const d = residualDelta(b, side, mon, r.key, Math.max(1, h)); if (d) h -= d.pct; }
    act.in = {...act.in, hpAfter: Math.max(0.1, Math.min(100, h)), exact: side === 'me'};
    delete act.in.hpUnknown;
    changed = true;
  }
  if (changed && canReplay(b)) { replay(b, usage); t = ensureTurn(b); }
  // やどりぎのタネの回復量 (自分が回復した実数) を控える
  const hpFacts = [];
  const leech = residual.find(r => r.side === 'me' && r.key === 'leechheal');
  if (leech && finalHp[`me${leech.mon}`] != null) {
    const bd = buildOf(b, 'me', leech.mon), c = condOf(b, 'me', leech.mon);
    const max = statsOf(currentSpecies(bd, c), bd.sp, bd.nature)[0];
    let hpReal = Math.round((c.hp * max) / 100);
    for (const r of residual) if (r.side === 'me' && r.mon === leech.mon && r.key !== 'leechheal') { const d = residualDelta(b, 'me', leech.mon, r.key, (hpReal / max) * 100); if (d) hpReal += d.hp; }
    const fin = Math.round((finalHp[`me${leech.mon}`] * max) / 100);
    const drain = fin - hpReal;
    const seeded = b.state.sides.opp.active.find(i => i != null && condOf(b, 'opp', i)?.seeded);
    if (drain > 0 && fin < max && seeded != null) hpFacts.push({opp: seeded, drain});
  }
  // 相手: ターン終了時の処理の前後の表示 (%) から最大HPを絞り込む
  for (const [k, val] of Object.entries(finalHp)) {
    if (!k.startsWith('opp') || val == null) continue;
    const mon = Number(k.slice(3));
    const c = condOf(b, 'opp', mon);
    const steps = residual.filter(r => r.side === 'opp' && r.mon === mon).map(r => stepOf(b, 'opp', mon, r.key));
    if (!c || c.fainted || !steps.length || steps.some(x => !x) || !Number.isInteger(c.hp)) continue;
    hpFacts.push({opp: mon, d0: c.hp, d1: Math.round(val), steps});
  }
  for (const r of residual) log.push(...addEvent(b, {kind: 'residual', side: r.side, mon: r.mon, key: r.key}, usage));
  // 入力されたターン終了後のHPと計算が合わなければ、入力のほうに合わせる
  for (const [k, val] of Object.entries(finalHp)) {
    if (val == null || !Number.isFinite(val)) continue;
    const side = k.startsWith('me') ? 'me' : 'opp', mon = Number(k.replace(/^(me|opp)/, ''));
    const c = condOf(b, side, mon);
    // 相手は表示 (整数%) をそのまま正とする (次の推定で表示の値が要るため)
    if (c && !c.fainted && (side === 'me' ? Math.abs(c.hp - val) > 0.7 : Math.abs(c.hp - val) > 1e-6)) log.push(...addEvent(b, {kind: 'hp', side, mon, hpAfter: val, note: 'ターン終了後に確認'}, usage));
  }
  log.push(...endTurn(b, usage, {noOrder, resFirst, hpFacts, expiry}));
  return log;
}

/**
 * 両者が同時に場に出たとき、特性は素早さの速い順に発動する。
 * 天候・フィールドは「後に発動した = 遅いほう」が残るので、先に出した側が遅ければ上書きし直す。
 * 相手の素早さは推定の型で比べる (同速は不確定として記録だけ残す)。
 */
function simultaneousEntry(b, usage, side, mon, res) {
  const log = [];
  const os = other(side);
  const om = b.state.sides[os].active.find(i => i != null && !condOf(b, os, i)?.fainted);
  if (om == null) return log;
  const abThis = res(b, side, mon), abOther = res(b, os, om);
  const kinds = [[WEATHER_ABILITY, setWeather, WEATHER_JA, '天候'], [TERRAIN_ABILITY, setTerrain, TERRAIN_JA, 'フィールド']];
  if (!kinds.some(([map]) => map[abThis] && map[abOther] && map[abThis] !== map[abOther])) return log;
  const ctx = boardContext(b, usage);
  const spd = (sd, i) => finalSpeed({build: ctx.build(sd, i), cond: condOf(b, sd, i)}, {format: b.format, field: b.state.field, side: b.state.sides[sd]});
  const sThis = spd(side, mon), sOther = spd(os, om);
  for (const [map, setter, ja, label] of kinds) {
    if (!map[abThis] || !map[abOther] || map[abThis] === map[abOther]) continue;
    if (sThis === sOther) { log.push(`同時に場に出た: 素早さが同じ見込みのため、${label}はどちらが残るか不確定 (違っていたら「その他の変化」で直してください)`); continue; }
    // いま出した側のほうが速い → 先に発動して、遅い側 (先に出してあった側) の特性で上書きされる
    if (sThis > sOther) {
      setter(b, map[abOther], {side: os, mon: om});
      log.push(`同時に場に出た: 遅い${os === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, os, om).species)}の${abilityName(abOther)}があとから発動し、${label}は${ja[map[abOther]]}`);
    } else log.push(`同時に場に出た: 遅い${side === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, side, mon).species)}の${abilityName(abThis)}があとから発動し、${label}は${ja[map[abThis]]}`);
  }
  return log;
}

// 攻撃を受けたときに必ず起きる特性・持ち物の効果 (ランク変化・天候・フィールド)
const HIT_ITEM_BOOST = {weaknesspolicy: {atk: 2, spa: 2}, cellbattery: {atk: 1}, absorbbulb: {spa: 1}, luminousmoss: {spd: 1}, snowball: {atk: 1}, keeberry: {def: 1}, marangaberry: {spd: 1}};
function onHitEffects(b, {side, mon, move, crit, tgt, before, defItem}, res, log) {
  const mv = dex.moves[move];
  if (!mv || mv.c === 'Z') return;
  const tc = condOf(b, tgt.side, tgt.mon);
  const who = `${tgt.side === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, tgt.side, tgt.mon).species)}`;
  const boost = (d, why) => { const l = []; applyBoosts(b, tgt.side, tgt.mon, d, {log: l, resolveAbility: () => ''}); if (l.length) log.push(`${why}: ${l.join('、')}`); };
  if (defItem && HIT_ITEM_BOOST[defItem] && !tc.fainted) boost(HIT_ITEM_BOOST[defItem], itemName(defItem));
  if (tc.fainted) {
    // 倒したとき: じしんかじょう等
    const ab = res(b, side, mon);
    const ko = {moxie: {atk: 1}, chillingneigh: {atk: 1}, grimneigh: {spa: 1}}[ab];
    if (ko) { const l = []; applyBoosts(b, side, mon, ko, {log: l, resolveAbility: () => ''}); if (l.length) log.push(`${abilityName(ab)}: ${l.join('、')}`); }
    return;
  }
  const ab = res(b, tgt.side, tgt.mon);
  if (!ab) return;
  const name = `${who}の${abilityName(ab)}`;
  const t = mv.t;
  if (ab === 'stamina') boost({def: 1}, name);
  else if (ab === 'weakarmor' && mv.c === 'P') boost({def: -1, spe: 2}, name);
  else if (ab === 'justified' && t === 'Dark') boost({atk: 1}, name);
  else if (ab === 'steamengine' && (t === 'Fire' || t === 'Water')) boost({spe: 6}, name);
  else if (ab === 'watercompaction' && t === 'Water') boost({def: 2}, name);
  else if (ab === 'rattled' && ['Bug', 'Ghost', 'Dark'].includes(t)) boost({spe: 1}, name);
  else if (ab === 'thermalexchange' && t === 'Fire') boost({atk: 1}, name);
  else if (ab === 'angerpoint' && crit) boost({atk: 12}, name);
  else if (ab === 'berserk' && before > 50 && tc.hp <= 50) boost({spa: 1}, name);
  else if (ab === 'seedsower' && setTerrain(b, 'Grassy')) log.push(`${name}: グラスフィールドに`);
  else if (ab === 'sandspit' && setWeather(b, 'Sand')) log.push(`${name}: 天候がすなあらしに`);
  else if (ab === 'cottondown') { const l = []; applyBoosts(b, side, mon, {spe: -1}, {log: l, fromOpp: true, resolveAbility: res}); if (l.length) log.push(`${name}: ${l.join('、')}`); }
}

// ---- 5ターン目の天候・フィールド・壁 ----
const EXTENDER = {weather: {Rain: 'damprock', Sun: 'heatrock', Sand: 'smoothrock', Snow: 'icyrock'}, terrain: 'terrainextender', screen: 'lightclay'};
const SCREEN_JA = {reflect: 'リフレクター', lightScreen: 'ひかりのかべ', auroraVeil: 'オーロラベール'};

/** ターン終了時に「終わったか」を聞く候補。経過が5ターン目・8ターン目のもの */
export function expiryCandidates(b) {
  const t = openTurn(b);
  if (!t) return [];
  const out = [];
  const f = b.state.field;
  const age = since => (since == null ? 0 : t.n - since + 1);
  const who = by => (by ? `${by.side === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, by.side, by.mon)?.species)}` : '');
  if (f.weather && [5, 8].includes(age(f.since?.weather))) out.push({key: 'weather', label: `天候 (${WEATHER_JA[f.weather]})`, n: age(f.since.weather), by: f.by?.weather, byName: who(f.by?.weather)});
  if (f.terrain && [5, 8].includes(age(f.since?.terrain))) out.push({key: 'terrain', label: TERRAIN_JA[f.terrain], n: age(f.since.terrain), by: f.by?.terrain, byName: who(f.by?.terrain)});
  for (const side of ['me', 'opp']) {
    const sd = b.state.sides[side];
    for (const k of Object.keys(SCREEN_JA)) if (sd[k] && [5, 8].includes(age(sd.since?.[k]))) out.push({key: `${side}.${k}`, label: `${side === 'me' ? '自分' : '相手'}の${SCREEN_JA[k]}`, n: age(sd.since[k]), by: sd.by?.[k], byName: who(sd.by?.[k])});
  }
  return out;
}

function applyExpiry(b, x) {
  const log = [];
  const f = b.state.field;
  let by, item, label;
  if (x.key === 'weather') { by = f.by?.weather; item = EXTENDER.weather[f.weather]; label = `天候 (${WEATHER_JA[f.weather] || ''})`; if (x.ended) setWeather(b, ''); }
  else if (x.key === 'terrain') { by = f.by?.terrain; item = EXTENDER.terrain; label = TERRAIN_JA[f.terrain] || 'フィールド'; if (x.ended) setTerrain(b, ''); }
  else {
    const [side, k] = x.key.split('.');
    by = b.state.sides[side].by?.[k]; item = EXTENDER.screen; label = SCREEN_JA[k];
    if (x.ended) setSideFlag(b, side, k, false);
  }
  if (x.ended) { log.push(`${label}が終わった`); return log; }
  // 5ターンで終わらなかった → 起こしたポケモンは延長する持ち物を持っている
  log.push(`${label}が5ターンで終わらなかった`);
  if (by && x.n === 5 && item) {
    const bd = buildOf(b, by.side, by.mon);
    if (by.side === 'opp' && bd && !bd.item) { bd.item = item; log.push(`相手の${speciesName(bd.species)}の持ち物は${itemName(item)}`); }
  }
  return log;
}

/** 場に出たときの設置技のダメージ {pct, hp(自分の実数), parts: ['ステルスロック', ...]} / 受けないなら null */
export function hazardDamage(b, side, mon) {
  const sd = b.state.sides[side];
  const bd = buildOf(b, side, mon), c = condOf(b, side, mon);
  if (!bd || !c || c.fainted) return null;
  const types = dex.species[currentSpecies(bd, c)]?.t || [];
  const ab = defaultAbilityResolver(b, side, mon);
  if (ab === 'magicguard') return null;
  let frac = 0;
  const parts = [];
  if (sd.sr) {
    let eff = 1;
    for (const ty of types) eff *= {Fire: 2, Ice: 2, Flying: 2, Bug: 2, Fighting: 0.5, Ground: 0.5, Steel: 0.5}[ty] || 1;
    frac += eff / 8; parts.push('ステルスロック');
  }
  const grounded = !types.includes('Flying') && ab !== 'levitate' && !(bd.item === 'airballoon' && !c.itemGone);
  if (sd.spikes && grounded) { frac += [0, 1 / 8, 1 / 6, 1 / 4][Math.min(3, sd.spikes)]; parts.push(`まきびし${sd.spikes}`); }
  if (!frac) return null;
  if (side === 'me') { const max = maxHPOf(b, side, mon); const d = Math.floor(max * frac); return {pct: (d / max) * 100, hp: d, parts}; }
  return {pct: frac * 100, parts};
}

// ---- 相手のHP表示 (整数%・切り捨て) からHPの実数値を絞り込む ----
// ゲームの表示は「HP割合の小数点以下切り捨て」。ただし 0% より大きく 1% 未満は 1% と表示される。
export const dispPct = (hp, max) => (hp <= 0 ? 0 : Math.max(1, Math.floor((100 * hp) / max)));
export const dispOf = pct => (pct <= 0 ? 0 : pct < 1 ? 1 : Math.floor(pct + 1e-9));

// 最大HP max のとき、1回の処理で HP がどう変わるか (ダメージは切り捨てで最低1、回復も切り捨てで最低1)
function stepHp(step, h, max) {
  const dmg = n => Math.max(1, Math.floor(n));
  switch (step.k) {
    case 'sand': case 'brn': return h - dmg(max / 16);
    case 'psn': case 'leechseed': case 'solarpower': return h - dmg(max / 8);
    case 'tox': return h - Math.max(1, Math.floor(max / 16)) * (step.n || 1);
    case 'leftovers': case 'grassy': case 'raindish': case 'icebody': return Math.min(max, h + dmg(max / 16));
    case 'poisonheal': return Math.min(max, h + dmg(max / 8));
    case 'blacksludge': return step.poison ? Math.min(max, h + dmg(max / 16)) : h - dmg(max / 8);
    case 'dryskin': return step.rain ? Math.min(max, h + dmg(max / 8)) : h - dmg(max / 8);
    case 'leechheal': return Math.min(max, h + (step.amount || 0));
    case 'hazard': return h - dmg(max * step.frac);
    case 'frac': return h - dmg(max * step.f);
    case 'fixed': return Math.min(max, h + step.amount);
    case 'halfround': return h - Math.round(max / 2);
    default: return h;
  }
}

/**
 * 表示が d0% → d1% になったこと (間の処理は steps) から、相手のHPの能力ポイントを絞り込む。
 * d0 は表示どおりの整数 (満タンは100 = HPが最大値ちょうど) であること。
 */
export function inferHpFromDisplay(b, oppIdx, d0, d1, steps) {
  const o = b.opp[oppIdx];
  if (!o || !steps.length || !Number.isInteger(d0) || !Number.isInteger(d1)) return '';
  const sid = currentSpecies(o, condOf(b, 'opp', oppIdx));
  const ok = sp => {
    const max = statsOf(sid, [sp, 0, 0, 0, 0, 0], 'Serious')[0];
    // 1% 表示は 0%より大きく2%未満 (1%未満も1%と表示される)
    const lo = d0 === 100 ? max : d0 === 1 ? 1 : Math.max(1, Math.ceil((d0 * max) / 100));
    const hi = d0 === 100 ? max : Math.min(max, Math.ceil(((d0 + 1) * max) / 100) - 1);
    for (let h = lo; h <= hi; h++) {
      if (dispPct(h, max) !== d0) continue;
      let h2 = h;
      for (const st of steps) h2 = Math.max(0, stepHp(st, h2, max));
      if (dispPct(h2, max) === d1) return true;
    }
    return false;
  };
  // どのHPでも説明がつく (情報がない) ときは何もしない
  let n = 0;
  for (let sp = 0; sp <= 32; sp++) if (ok(sp)) n++;
  if (n === 33) return '';
  if (n === 0) return `相手の${speciesName(o.species)}: HPの表示 ${d0}% → ${d1}% に合うHPがありません (入力を確認してください)`;
  return `相手の${speciesName(o.species)}: HPの表示 ${d0}% → ${d1}% から ${applyHpConstraint(o, ok)}`;
}

// 処理の種類 → HP計算の手順 (盤面の状態から必要な値を添える)
function stepOf(b, side, mon, key) {
  const bd = buildOf(b, side, mon), c = condOf(b, side, mon);
  const types = dex.species[currentSpecies(bd, c)]?.t || [];
  const st = {k: key};
  if (key === 'tox') st.n = Math.min(15, c.toxicCounter || 1);
  if (key === 'blacksludge') st.poison = types.includes('Poison');
  if (key === 'dryskin') st.rain = b.state.field.weather === 'Rain';
  if (key === 'leechheal') {
    const fs = other(side), fm = b.state.sides[fs].active.find(i => i != null && condOf(b, fs, i)?.seeded);
    if (fs === 'me' && fm != null) st.amount = Math.max(1, Math.floor(maxHPOf(b, 'me', fm) / 8));
    else return null; // 吸い取った量が分からない
  }
  return st;
}

// ---- 攻撃した側のHPの変化 ----
// 反動 (与えたダメージ × 割合 の四捨五入、最低1) / 吸収 (与えたダメージ × 割合 の四捨五入)
export const RECOIL = {bravebird: [33, 100], doubleedge: [33, 100], flareblitz: [33, 100], headsmash: [1, 2], lightofruin: [1, 2], volttackle: [33, 100], wavecrash: [33, 100], wildcharge: [1, 4], woodhammer: [33, 100], takedown: [1, 4], submission: [1, 4], headcharge: [1, 4]};
export const HALF_RECOIL = new Set(['steelbeam', 'mindblown', 'chloroblast']);
export const DRAIN = {bitterblade: [1, 2], drainpunch: [1, 2], drainingkiss: [3, 4], gigadrain: [1, 2], hornleech: [1, 2], leechlife: [1, 2], matchagotcha: [1, 2], paraboliccharge: [1, 2]};
export const SELF_FX_JA = {lifeorb: 'いのちのたまの反動', recoil: '反動ダメージ', drain: '吸収で回復', helmet: 'ゴツゴツメット', roughskin: 'さめはだ・てつのトゲ', shellbell: 'かいがらのすず'};

function attackerHpEffects(b, {side, mon, tgt, move, fx, hpAfter, tgtBefore, a}, log) {
  const ab = condOf(b, side, mon), abd = buildOf(b, side, mon);
  const tb = buildOf(b, tgt.side, tgt.mon), tc = condOf(b, tgt.side, tgt.mon);
  // 判明したこと
  if (side === 'opp' && fx.includes('lifeorb') && !abd.item) abd.item = 'lifeorb';
  if (tgt.side === 'opp' && fx.includes('helmet') && !tb.item) tb.item = 'rockyhelmet';
  if (tgt.side === 'opp' && fx.includes('roughskin') && !tb.ability) { const s0 = dex.species[tb.species]?.ab || []; tb.ability = s0.includes('roughskin') ? 'roughskin' : s0.includes('ironbarbs') ? 'ironbarbs' : tb.ability; }
  // 与えたダメージの実数 (受けたのが自分なら正確に分かる)
  const dealtReal = tgt.side === 'me' && tgtBefore != null ? Math.round(((tgtBefore - tc.hp) / 100) * maxHPOf(b, 'me', tgt.mon)) : null;
  const steps = [];
  if (fx.includes('drain') && DRAIN[move]) steps.push(dealtReal != null ? {k: 'fixed', amount: Math.round((dealtReal * DRAIN[move][0]) / DRAIN[move][1])} : null);
  if (fx.includes('helmet')) steps.push({k: 'frac', f: 1 / 6});
  if (fx.includes('roughskin')) steps.push({k: 'frac', f: 1 / 8});
  if (fx.includes('recoil')) steps.push(HALF_RECOIL.has(move) ? {k: 'halfround'} : RECOIL[move] && dealtReal != null ? {k: 'fixed', amount: -Math.max(1, Math.round((dealtReal * RECOIL[move][0]) / RECOIL[move][1]))} : null);
  if (fx.includes('lifeorb')) steps.push({k: 'frac', f: 1 / 10});
  const before = ab.hp;
  if (hpAfter != null) {
    // 相手が攻撃した: 表示の変化から最大HPを絞り込む
    if (side === 'opp' && steps.every(Boolean) && Number.isInteger(before)) { const m = inferHpFromDisplay(b, mon, before, Math.round(hpAfter), steps); if (m) log.push(m); }
    // 自分が攻撃した: 反動・吸収の実数から、相手に与えたダメージの実数 → 相手の最大HPを絞り込む
    // (満タンまで回復した・倒れた場合は量が頭打ちになるので使わない)
    if (side === 'me' && tgt.side === 'opp' && hpAfter < 100 - 1e-9 && hpAfter > 0 && (fx.includes('recoil') || fx.includes('drain')) && Number.isInteger(tgtBefore) && Number.isInteger(tc.hp)) {
      const max = maxHPOf(b, 'me', mon);
      let change = Math.round((hpAfter / 100) * max) - Math.round((before / 100) * max);
      if (fx.includes('lifeorb')) change += Math.max(1, Math.floor(max / 10));
      if (fx.includes('helmet')) change += Math.max(1, Math.floor(max / 6));
      if (fx.includes('roughskin')) change += Math.max(1, Math.floor(max / 8));
      const ratio = fx.includes('recoil') ? RECOIL[move] : DRAIN[move];
      const amount = Math.abs(change);
      if (ratio && amount > 0 && !(fx.includes('recoil') && fx.includes('drain'))) {
        const o = b.opp[tgt.mon];
        const sid = currentSpecies(o, tc);
        const d0 = tgtBefore, d1 = tc.hp;
        const okSP = sp => {
          const tmax = statsOf(sid, [sp, 0, 0, 0, 0, 0], 'Serious')[0];
          const lo = d0 === 100 ? tmax : d0 === 1 ? 1 : Math.ceil((d0 * tmax) / 100);
          const hi = d0 === 100 ? tmax : Math.min(tmax, Math.ceil(((d0 + 1) * tmax) / 100) - 1);
          for (let h = lo; h <= hi; h++) for (let dm = 1; dm <= h; dm++) {
            const r = Math.round((dm * ratio[0]) / ratio[1]);
            if ((fx.includes('recoil') ? Math.max(1, r) : r) !== amount) continue;
            if (dispPct(h - dm, tmax) === d1) return true;
          }
          return false;
        };
        let n = 0;
        for (let sp = 0; sp <= 32; sp++) if (okSP(sp)) n++;
        if (n > 0 && n < 33) log.push(`相手の${speciesName(o.species)}: ${SELF_FX_JA[fx.includes('recoil') ? 'recoil' : 'drain']}の量 ${amount} から ${applyHpConstraint(o, okSP)}`);
      }
    }
    setHP(b, side, mon, hpAfter);
  } else {
    // HPを入れなかった: 分かる範囲で計算する (相手の最大HPは見込み)
    const max = maxHPOf(b, side, mon);
    let h = Math.round((before / 100) * max);
    for (const st of steps) if (st) h = Math.max(0, stepHp(st, h, max));
    setHP(b, side, mon, (h / max) * 100);
  }
  a.selfFx = fx;
  log.push(`${side === 'me' ? '自分' : '相手'}の${speciesName(abd.species)}: ${fx.map(k => SELF_FX_JA[k]).join('・')}`);
}
