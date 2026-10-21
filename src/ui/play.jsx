// 対戦の盤面 (入力もここで完結する)
//   相手の枠 / 場の状態 / 自分の枠。枠の中: 名前・持ち物・特性・HP・能力表・技 (PP)・場の状態、右上に交代。
//   技を押す → 残りHPを入力して記録。見逃したHPは不明のまま記録できる。
//   先に記録したほうが先に動いた扱い。両方が動いたら右端のターン終了。
//   分かっていること (自分の持ち物・特性、判明した相手の持ち物・特性) は聞き直さずに自動で反映する。
import {useEffect, useLayoutEffect, useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf, STAT_JA, STAT_KEYS} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies, currentAbility, typesOf, disguiseIntact, defaultHits} from '../engine/calc.js';
import {condOf, buildOf, other, turnNumber, PIVOT_MOVES, faintedCount, pickCount, defaultAbilityResolver} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {damageRange} from '../engine/damage-range.js';
import {revealIllusion, addAct, addEvent, openTurn, residualCandidates, expiryCandidates, finishTurn, editAct, reopenLastTurn, canReplay, replay, dispOf, ppLeft, sideDone, FORCE_MOVES, EJECT_JA, RECOIL, HALF_RECOIL, DRAIN} from '../engine/flow.js';
import {speedOutlook} from '../engine/assume.js';
import {finalSpeed} from '../engine/calc.js';
import {Picker, Sheet, Seg, Toggle, TypeChip, Sprite, Confirm, cx, fmtPct, rate} from './common.jsx';
import {OppStatTable} from './arena.jsx';
import {BoostRow} from './boostrow.jsx';
import {StepRange} from './step-range.jsx';
import {MegaButtons, EventForm, STATUS_MOVE, STATUS_OPTS, consumable} from './turn.jsx';

const SIDE_JA = {me: '自分', opp: '相手'};
const FLAGS = [['reflect', 'リフレクター'], ['lightScreen', 'ひかりのかべ'], ['auroraVeil', 'オーロラベール'], ['tailwind', 'おいかぜ'], ['sr', 'ステルスロック'], ['stickyWeb', 'ねばねばネット']];
const ST_JA = Object.fromEntries(STATUSES);
const living = (b, side) => b.state.sides[side].active.filter(i => i != null && !condOf(b, side, i)?.fainted);
const maxHPOf = (b, mon) => { const bd = b.my[mon]; return statsOf(currentSpecies(bd, condOf(b, 'me', mon)), bd.sp, bd.nature)[0]; };
const nameOf = (b, side, i) => speciesName(currentSpecies(buildOf(b, side, i), condOf(b, side, i)));
// 交代先の候補: 自分は選出した3体 (未選出なら全員)、相手は6体
const benchOf = (b, side) => {
  const sd = b.state.sides[side];
  const list = side === 'me' ? b.my : b.opp;
  const n = pickCount(b.format);
  return list.map((_, i) => i).filter(i => !sd.active.includes(i) && (side === 'opp' || !b.pick.me.length || b.pick.me.includes(i) || b.pick.me.length < n));
};

/** ダメージの予想: 相手が受ける側なら耐久の 想定/無振り/全振り、相手が攻める側なら火力の 想定/無振り/全振り */
function predictAll(ctx, side, mon, tgt, move, crit) {
  if (!tgt || !dex.moves[move]) return null;
  const range = damageRange(ctx, side, mon, tgt.mon, move, {crit});
  return {base: range, min: range?.lowResult || range, max: range?.highResult || range};
}

// 攻撃した側のHPの変化で、確実に起きるもの (分かっている持ち物・特性・技の効果)
function sureSelfFx(battle, side, mon, tgt, move, tgtHpAfter) {
  const m = dex.moves[move];
  if (!m || m.c === 'Z' || !tgt || tgt.side === side) return [];
  const out = [];
  const ab = buildOf(battle, side, mon), ac = condOf(battle, side, mon);
  const tb = buildOf(battle, tgt.side, tgt.mon), tc = condOf(battle, tgt.side, tgt.mon);
  // 特性は「分かっているもの」だけ使う (相手の未判明の特性は推測しない)
  const known = (s0, bd, c) => (s0 === 'me' || bd.ability || dex.species[currentSpecies(bd, c)]?.mega ? currentAbility(bd, c) : '');
  const aab = known(side, ab, ac), tab = known(tgt.side, tb, tc);
  const guard = aab === 'magicguard';
  const sheer = aab === 'sheerforce' && (m.sec?.length || 0) > 0;
  if (!ac.itemGone && ab.item === 'lifeorb' && !guard && !sheer) out.push('lifeorb');
  if (HALF_RECOIL.has(move) ? !guard : RECOIL[move] && !guard && aab !== 'rockhead') out.push('recoil');
  if (DRAIN[move]) out.push(tab === 'liquidooze' ? 'ooze' : 'drain');
  if (!ac.itemGone && ab.item === 'shellbell' && !sheer) out.push('shellbell');
  if (m.fl?.includes('contact') && aab !== 'longreach') {
    if (!tc.itemGone && tb.item === 'rockyhelmet' && !guard) out.push('helmet');
    if ((tab === 'roughskin' || tab === 'ironbarbs') && !guard) out.push('roughskin');
    if (tab === 'aftermath' && tgtHpAfter != null && tgtHpAfter <= 0 && !guard) out.push('aftermath');
  }
  if (tab === 'innardsout' && tgtHpAfter != null && tgtHpAfter <= 0 && !guard) out.push('innards');
  return out;
}

// 場に出たポケモンの設置技のダメージを自動で反映 (計算どおり)
function autoHazards(b, usage) {
  for (const side of ['me', 'opp']) for (const i of b.state.sides[side].active) {
    const c = i != null ? condOf(b, side, i) : null;
    if (c?.hazard && !c.fainted) addEvent(b, {kind: 'hazard', side, mon: i}, usage);
  }
}

export function PlayBoard({battle, ctx, mut, usage, toast, setSheet}) {
  // いま入力中の行動 (1つだけ)
  const [act, setAct] = useState(null);
  // メガシンカの確認中 ({'me0': 'garchompmega'})。数値だけメガの姿で見せ、行動を記録するときに一緒に記録する
  const [megaPrev, setMegaPrev] = useState({});
  const turn = turnNumber(battle);
  useLayoutEffect(() => { setAct(null); setMegaPrev({}); }, [turn]);
  const prevKeys = Object.keys(megaPrev).filter(k => megaPrev[k]);
  const vctx = useMemo(() => {
    if (!prevKeys.length) return ctx;
    const cond = (s, i) => { const c = ctx.cond(s, i); const fm = megaPrev[`${s}${i}`]; return fm && c && !c.fainted ? {...c, forme: fm} : c; };
    const v = {...ctx, cond};
    v.ability = (s, i) => { const bd = v.build(s, i); return bd ? currentAbility(bd, cond(s, i)) : ''; };
    return v;
  }, [ctx, JSON.stringify(megaPrev)]);
  // 盤面が変わって (メガシンカ済み・交代・ひんし) 確認の意味がなくなったら消す
  useEffect(() => {
    const stale = prevKeys.filter(k => { const side = k.startsWith('opp') ? 'opp' : 'me'; const i = Number(k.slice(side.length)); const c = condOf(battle, side, i); return !c || c.fainted || dex.species[c.forme]?.mega || battle.state.sides[side].megaUsed || !battle.state.sides[side].active.includes(i); });
    if (stale.length) setMegaPrev(m => { const n = {...m}; for (const k of stale) delete n[k]; return n; });
  }, [battle]);
  const commit = (fn, okMsg) => {
    let log = [];
    const mk = act && act.kind === 'move' ? `${act.side}${act.mon}` : null;
    const fm = mk ? megaPrev[mk] : null;
    mut(b => { log = fn(b, fm) || []; autoHazards(b, usage); });
    if (mk && fm) setMegaPrev(m => ({...m, [mk]: null}));
    setAct(null);
    const last = log.filter(Boolean).slice(-1)[0];
    toast(last || okMsg || '記録しました');
  };
  // 技を選んでいるときのダメージ予想 (相手のHPバーと右側の両方で使う)
  // 配分候補全体と両端の配分をまとめて計算し、選んでいるものをHPバーに出す
  const preds = useMemo(() => {
    if (act?.kind !== 'move' || !act.tgt || dex.moves[act.move]?.c === 'Z') return null;
    return predictAll(vctx, act.side, act.mon, act.tgt, act.move, act.crit);
  }, [vctx, act?.kind, act?.side, act?.mon, act?.move, act?.crit, act?.tgt?.mon]);
  const pred = preds ? preds[act.scen] : null;
  const p = {battle, ctx: vctx, mut, usage, toast, act, setAct, commit, setSheet, pred, preds, megaPrev, setMegaPrev};
  const sideMons = side => {
    const a = battle.state.sides[side].active;
    return a.length ? a.map((i, slot) => ({i, slot})) : [{i: null, slot: 0}];
  };
  return (
    <div class="play">
      {sideMons('opp').map(({i, slot}) => <Panel key={`opp${slot}`} side="opp" mon={i} slot={slot} {...p} />)}
      {sideMons('me').map(({i, slot}) => <Panel key={`me${slot}`} side="me" mon={i} slot={slot} {...p} />)}
    </div>
  );
}

export function FieldBar({battle, mut, usage}) {
  const f = battle.state.field;
  const W = Object.fromEntries(WEATHERS), T = Object.fromEntries(TERRAINS);
  const now = turnNumber(battle);
  const age = k => (f[k] && f.since?.[k] != null ? <small class="muted"> {Math.max(1, now - f.since[k] + 1)}T目</small> : null);
  const change = (key, value) => {
    if (f[key] !== value) mut?.(b => addEvent(b, {kind:'field',side:'me',key,value}, usage));
  };
  return (
    <div class="pl-field">
      <span class="tag strong">{now}ターン目</span>
      <div class="field-editor">
        <label class="field-weather field-select">{({Rain:'☔', Sun:'☀', Sand:'◌', Snow:'❄'})[f.weather] || ''} 天候 <b class={cx(f.weather && 'on')}>{W[f.weather || '']}</b>{age('weather')}<span aria-hidden="true">▾</span>
          <select aria-label="天候を変更" value={f.weather || ''} disabled={!mut} onChange={e => change('weather',e.currentTarget.value)}>{WEATHERS.map(([id,label]) => <option value={id}>{label}</option>)}</select>
        </label>
        {mut && f.weather && <button class="field-clear" aria-label="天候を解除" onClick={() => change('weather','')}>×</button>}
      </div>
      <div class="field-editor">
        <label class="field-terrain field-select">{({Grassy:'🌿', Electric:'⚡', Psychic:'🔮', Misty:'☁'})[f.terrain] || ''} フィールド <b class={cx(f.terrain && 'on')}>{f.terrain ? `${T[f.terrain]}フィールド` : 'なし'}</b>{age('terrain')}<span aria-hidden="true">▾</span>
          <select aria-label="フィールドを変更" value={f.terrain || ''} disabled={!mut} onChange={e => change('terrain',e.currentTarget.value)}>{TERRAINS.map(([id,label]) => <option value={id}>{id ? `${label}フィールド` : label}</option>)}</select>
        </label>
        {mut && f.terrain && <button class="field-clear" aria-label="フィールドを解除" onClick={() => change('terrain','')}>×</button>}
      </div>
      {f.trickRoom && <span class="tag accent">トリックルーム{age('trickRoom')}</span>}
      {f.gravity && <span class="tag accent">じゅうりょく</span>}
      {f.magicRoom && <span class="tag accent">マジックルーム</span>}
      {f.wonderRoom && <span class="tag accent">ワンダールーム</span>}
    </div>
  );
}

// ---- 1体ぶんの枠 ----
function Panel({side, mon, slot, battle, ctx, mut, usage, toast, act, setAct, commit, setSheet, pred, preds, megaPrev, setMegaPrev}) {
  const sd = battle.state.sides[side];
  const bench = benchOf(battle, side);
  const live = bench.filter(i => !condOf(battle, side, i)?.fainted);
  const empty = mon == null;
  const fainted = !empty && condOf(battle, side, mon)?.fainted;
  // 倒れたあとの交代は「次のターンのはじめ」に出す (ターン終了時のすなあらし・たべのこし等は出てきたポケモンには入らない)
  const t = openTurn(battle);
  const midTurn = !!t && t.acts.some(a => a.type !== 'event');
  const waitEnd = fainted && midTurn && live.length > 0;
  const needSend = (empty || (fainted && !midTurn)) && live.length > 0;
  const done = sideDone(battle, side);
  const mine = act && act.side === side && (act.mon === mon || act.kind === 'send');
  const swapMode = (mine && (act.kind === 'switch' || act.kind === 'send')) || needSend;
  const pickBench = i => {
    if (needSend) { setAct({side, kind: 'send', slot, to: i}); return; }
    if (mine && act.kind === 'switch') { setAct({...act, to: i}); return; }
    if (mine && act.kind === 'move' && PIVOT_MOVES.has(act.move)) { setAct({...act, to: act.to === i ? null : i}); return; }
    setSheet({side, idx: i});
  };
  const targeted = act && act.kind === 'move' && act.tgt && act.tgt.side === side && act.tgt.mon === mon ? {...act, r: pred} : null;
  const benchControls = (
    <div class="pl-bench">
          <button class={cx('pl-swap', (swapMode || (mine && act.kind === 'switch')) && 'on')} disabled={empty || fainted || (done && !needSend)}
            title="交代" onClick={() => (mine && act.kind === 'switch' ? setAct(null) : setAct({side, mon, kind: 'switch', to: null}))}>⇄</button>
          {bench.map(i => {
            const c = condOf(battle, side, i);
            const sel = mine && act.to === i;
            const can = !c?.fainted && (swapMode || (mine && act.kind === 'move' && PIVOT_MOVES.has(act.move)));
            return (
              <button class={cx('pl-bmon', c?.fainted && 'out', sel && 'on', can && 'can', side === 'opp' && !battle.pick.opp.includes(i) && 'unseen')} onClick={() => !c?.fainted && pickBench(i)} title={nameOf(battle, side, i)}>
                <Sprite id={c?.forme || buildOf(battle, side, i).species} size={28} />
                <i class="pl-bhp" style={{width: `${c?.fainted ? 0 : c?.hp ?? 100}%`}} />
              </button>
            );
          })}
        </div>
  );
  const actionArea = extra => <ActionArea {...extra} side={side} mon={mon} slot={slot} battle={battle} ctx={ctx} usage={usage} act={mine ? act : null} setAct={setAct} commit={commit} needSend={needSend} waitEnd={waitEnd} done={done} pred={pred} preds={preds} />;
  return (
    <section class={cx('pl', side, fainted && 'fainted', mine && 'acting')}>
      <div class="pl-main">
        {empty ? <><div class="pl-head"><span class="pl-empty">{needSend ? (side === 'me' ? '先発を選択' : '相手の先発を選択') : '場にいません'}</span>{benchControls}</div>{actionArea()}</>
          : <MonView side={side} mon={mon} battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} act={act} setAct={setAct} targeted={targeted} done={done} setSheet={setSheet}
            benchControls={benchControls} actionArea={actionArea}
            megaPrev={megaPrev[`${side}${mon}`] || null} setMegaPrev={fm => setMegaPrev(m => ({...m, [`${side}${mon}`]: fm}))} />}
      </div>
    </section>
  );
}

function MonView({side, mon, battle, ctx, mut, usage, toast, act, setAct, targeted, done, setSheet, megaPrev, setMegaPrev, benchControls, actionArea}) {
  const sd = battle.state.sides[side];
  const build = ctx.build(side, mon);
  const raw0 = condOf(battle, side, mon);
  const raw = megaPrev && !raw0.fainted ? {...raw0, forme: megaPrev} : raw0;
  const sid = currentSpecies(build, raw);
  const s = dex.species[sid];
  const opp = side === 'opp' ? battle.opp[mon] : null;
  const view = side === 'opp' ? ctx.views[mon] : null;
  const [pick, setPick] = useState(null);
  const myMax = side === 'me' ? maxHPOf(battle, mon) : null;
  const moves = side === 'me' ? (build.moves || []) : (opp.moves || []);
  const isMega = !!dex.species[raw0.forme]?.mega;
  const selMove = m => {
    if (raw.fainted || done) return;
    const foes = living(battle, other(side));
    const tgt = foes.length ? {side: other(side), mon: foes[0]} : null;
    const mv = dex.moves[m];
    const ally = living(battle, side).find(i => i !== mon);
    const target = mv?.tg === 'adjacentAlly' ? (ally != null ? {side, mon: ally} : null) : mv?.c === 'Z' && ['self', 'allySide', 'all', 'allies', 'foeSide'].includes(mv.tg) ? (mv.tg === 'foeSide' ? tgt : null) : tgt;
    setAct({side, mon, kind: 'move', move: m, tgt: target, scen: 'base', crit: false, stage: mv && mv.c !== 'Z' && target ? 'hp' : 'pick', hp: null, secFx: [], inflict: STATUS_MOVE[m] || ''});
  };
  const suggestions = side === 'opp' && !raw.fainted && !done && moves.length < 4 && <div class="pl-suggestions"><span class="muted">未判明の技候補</span><div class="chips">{(view?.moves || []).filter(m => !m.known && !moves.includes(m.id)).slice(0, 4 - moves.length).map(m => <button class="chip" onClick={() => selMove(m.id)}>{moveName(m.id)} <small>推定</small></button>)}</div></div>;
  const setOpp = fn => mut(b => { fn(b.opp[mon]); if (canReplay(b)) replay(b, usage); });
  const abil = currentAbility(build, raw);
  const setBoosts = set => { let log = []; mut(b => { log = addEvent(b, {kind: 'boosts', side, mon, set}, usage); }); toast(log[0] || '記録しました'); };
  // イリュージョン: 相手のパーティにゾロアークがいれば、化けていた可能性
  const zoro = side === 'opp' ? battle.opp.map((o, i) => ({o, i})).find(x => /^zoroark/.test(x.o.species) && x.i !== mon && !condOf(battle, 'opp', x.i)?.fainted) : null;
  const [askZoro, setAskZoro] = useState(false);
  const reveal = () => { setAskZoro(false); let n = -1; mut(b => { n = revealIllusion(b, usage, zoro.i); }); toast(n >= 0 ? `ゾロアークに付け替えました (${n}件)` : '最初の盤面が残っていないため付け替えできません'); };
  const actualSpecies = dex.species[currentSpecies(build, raw0)];
  return (
    <>
      <div class="pl-head"><div class="pl-title">
        <span class="pl-owner">{SIDE_JA[side]}</span><Sprite id={sid} size={32} />
        <button class="pl-name" onClick={() => setSheet({side, idx: mon})}>{s.j}</button>
        {raw.transformed && <span class="tag accent">へんしん中</span>}
        {zoro && !raw.transformed && <button class="btn ghost sm" onClick={() => setAskZoro(true)} title="イリュージョンの正体がゾロアークだったとき">正体は{speciesName(zoro.o.species)}</button>}
      </div>{benchControls}<div class="pl-form-controls">
        <MegaButtons battle={battle} side={side} mon={mon} mut={mut} usage={usage} preview={megaPrev} setPreview={setMegaPrev} />
        <span class="types">{typesOf(build, raw).map(t => <TypeChip type={t} small />)}</span>
      </div></div>
      {askZoro && <Confirm title="イリュージョンの正体" message={`いま場にいる${speciesName(battle.opp[mon].species)}は、${speciesName(zoro.o.species)}のイリュージョンでしたか？ 化けていた間の記録を${speciesName(zoro.o.species)}に付け替えて入れ直します。${speciesName(battle.opp[mon].species)}は選出の最後のポケモンとして記録します。`} okLabel="付け替える" onOk={reveal} onClose={() => setAskZoro(false)} />}
      <div class="pl-info">
        {side === 'opp'
          ? <button class={cx('pl-dd', !opp.item && 'unk', raw.itemGone && 'gone')} onClick={() => setPick('item')}>{opp.item ? itemName(opp.item) : `持ち物 ${itemName(view?.build.item) ? `(${itemName(view.build.item)}?)` : '不明'}`} ▾</button>
          : <span class={cx('pl-dd static', raw.itemGone && 'gone')}>{itemName(build.item) || '持ち物なし'}</span>}
        {opp?.item && !raw.itemGone && consumable(opp.item) && <button class="chip sm" onClick={() => { mut(b => { addEvent(b, {kind: 'item', side, mon, item: opp.item, consumed: true}, usage); }); toast(`${itemName(opp.item)}を使った`); }}>使った</button>}
        {side === 'me' && build.item && !raw.itemGone && consumable(build.item) && <button class="chip sm" onClick={() => { mut(b => { addEvent(b, {kind: 'item', side, mon, item: build.item, consumed: true}, usage); }); toast(`${itemName(build.item)}を使った`); }}>使った</button>}
        {side === 'opp'
          ? <select class={cx('pl-dd',!opp.ability && !actualSpecies.mega && 'unk')} aria-label="相手の特性" value={actualSpecies.mega ? actualSpecies.ab[0] : opp.ability || ''} disabled={!!actualSpecies.mega} title={actualSpecies.mega ? 'メガシンカ後の特性は固定です' : '発動を確認した特性を選択。不明にも戻せます'} onChange={e => { const ability = e.currentTarget.value; mut(b => addEvent(b, {kind: 'ability', side, mon, ability, activate: !!ability}, usage)); }}>
              {!actualSpecies.mega && <option value="">特性 不明（選択）</option>}
              {[...new Set([...actualSpecies.ab,opp.ability].filter(Boolean))].map(a => <option value={a}>{abilityName(a)}{actualSpecies.mega ? '（メガ・固定）' : ''}</option>)}
            </select>
          : <span class="pl-dd static">{abilityName(abil) || '特性なし'}</span>}
        {raw.types?.length ? <span class="tag accent">タイプ変化</span> : null}
        {raw.disguiseBroken && <span class="tag">ばけのかわ はがれた</span>}
      </div>
      <HpBar side={side} mon={mon} battle={battle} raw={raw} max={myMax} targeted={targeted} mut={mut} usage={usage} />
      <div class="pl-conditions">
        <select aria-label={`${SIDE_JA[side]}の状態異常`} class="input sm" value={raw.status || ''} onChange={e => mut(b => addEvent(b,{kind:'status',side,mon,status:e.currentTarget.value},usage))}>
          <option value="">状態異常なし</option>{STATUS_OPTS.map(([id,label]) => <option value={id}>{label}</option>)}
        </select>
        {FLAGS.slice(0,3).map(([key,label]) => <button class={cx('chip sm',sd[key] && 'on')} aria-pressed={!!sd[key]} title={label} onClick={() => mut(b => addEvent(b,{kind:'side',side,key,value:!sd[key]},usage))}>{label}</button>)}
      </div>
      <div class="pl-body">
        <div class="scroll-x">{side === 'opp' ? <OppStatTable battle={battle} idx={mon} forme={megaPrev} onBoosts={raw.fainted ? null : setBoosts} /> : <MyStatTable build={build} raw={raw} sid={sid} onBoosts={raw.fainted ? null : setBoosts} />}</div>
        {side === 'opp' && <details class="pl-speed-detail"><summary>素早さの比較</summary><SpeedBox battle={battle} ctx={ctx} usage={usage} mon={mon} raw={raw} /></details>}
      </div>
      <div class="pl-lower"><div class="pl-move-column">
        <div class="pl-moves">
          {[0, 1, 2, 3].map(k => {
            const m = moves[k];
            if (!m || !dex.moves[m]) return <button class="pl-mv empty" disabled={side === 'me' || raw.fainted || done} onClick={() => setPick('move')}>{side === 'opp' && !done ? '— (技を選ぶ)' : '—'}</button>;
            const pp = ppLeft(battle, side, mon, m);
            const on = act && act.side === side && act.mon === mon && act.kind === 'move' && act.move === m;
            return (
              <button class={cx('pl-mv', on && 'on', pp && pp.left === 0 && 'nopp')} disabled={raw.fainted || done} onClick={() => (on ? setAct(null) : selMove(m))}>
                <span class={cx('mv-bar', `t-${dex.moves[m].t}`)} /><span class="mv-nm">{moveName(m)}</span>
                {pp && <span class="pl-pp num">{pp.left}/{pp.max}</span>}
              </button>
            );
          })}
        </div>

      </div><div class="pl-action-column">{actionArea({suggestions})}</div></div>
      <SideState battle={battle} side={side} raw={raw} isMega={isMega} abil={side === 'me' || buildOf(battle, side, mon).ability ? abil : ''} />
      {pick === 'item' && <Picker kind="items" title="相手の持ち物" allowClear clearLabel="不明に戻す" rank={view?.items?.length ? Object.fromEntries(view.items) : null} onClose={() => setPick(null)}
        filter={id => !dex.items[id].ms || !!dex.items[id].ms[opp.species]}
        onPick={id => { setOpp(o => { o.item = id || ''; }); setPick(null); }} />}
      {pick === 'move' && <Picker kind="moves" title="相手の技" rank={view ? Object.fromEntries(view.moves.filter(m => !m.known).map(m => [m.id, m.rate])) : null} prefer={dex.learn[opp?.species]} preferLabel="覚えない技も表示" onClose={() => setPick(null)}
        onPick={id => { setPick(null); if (id) selMove(id); }} />}
    </>
  );
}

function MyStatTable({build, raw, sid, onBoosts}) {
  const s = dex.species[sid];
  const st = statsOf(sid, build.sp, build.nature);
  return (
    <table class="mp-table">
      <thead><tr><th></th>{STAT_JA.map(l => <th>{l}</th>)}</tr></thead>
      <tbody>
        <tr><th>種族値</th>{s.bs.map(v => <td class="num">{v}</td>)}</tr>
        <tr class="est"><th>能力Pt</th>{build.sp.map(v => <td class="num">{v}</td>)}</tr>
        <BoostRow boosts={raw.boosts} onSave={onBoosts} />
        <tr class="real"><th>実数値</th>
          {STAT_KEYS.map((k, i) => {
            const b = raw.boosts?.[k] || 0;
            if (!b || i === 0) return <td class="num">{st[i]}</td>;
            const v = Math.floor(b > 0 ? (st[i] * (2 + b)) / 2 : (st[i] * 2) / (2 - b));
            return <td class={cx('num', b > 0 ? 'pos' : 'neg')}>{v}<small>({st[i]})</small></td>;
          })}
        </tr>
      </tbody>
    </table>
  );
}

function SpeedBox({battle, ctx, usage, mon, raw}) {
  const o = useMemo(() => {
    const me = living(battle, 'me')[0];
    const spd = {format: battle.format, field: battle.state.field};
    const mine = me != null ? finalSpeed({build: battle.my[me], cond: ctx.cond('me', me)}, {...spd, side: battle.state.sides.me}) : null;
    const out = speedOutlook(battle.opp[mon], ctx.views[mon], raw, usage, mine, {...spd, side: battle.state.sides.opp});
    const rows = [];
    for (const b of out.bench) { rows.push({label: b.label, v: b.eff, ok: b.ok}); if (out.canScarf) rows.push({label: `${b.label}+スカーフ`, v: b.scarfEff, ok: b.okScarf, scarf: true}); }
    if (mine != null) rows.push({label: '自分', v: mine, ok: true, mine: true});
    rows.sort((a, b) => b.v - a.v || (a.mine ? 1 : -1));
    return {rows, mine};
  }, [ctx]);
  return (
    <div class="mp-speed">
      <div class="cap">素早さ{battle.state.field.trickRoom ? ' (トリル中)' : ''}</div>
      <ol>{o.rows.map(r => <li class={cx('num', r.mine && 'mine', !r.ok && 'ruled', r.scarf && 'scarf', !r.mine && o.mine != null && (r.v > o.mine ? 'fast' : r.v < o.mine ? 'slow' : 'tie'))}><span>{r.label}</span><b>{r.v}</b></li>)}</ol>
    </div>
  );
}

// ねむり・こおりの残り (チャンピオンズ: ねむりは2回目の行動で1/3・3回目で必ず起きる、ねむるは3回目、こおりは毎回25%・3回目で必ず溶ける)
function statusNote(c, ab) {
  if (c.status !== 'slp' && c.status !== 'frz') return '';
  const n = String(c.statusKey || '').startsWith(c.status) ? c.statusCant || 0 : 0;
  if (c.status === 'frz') return n >= 2 ? ' (次は必ず溶ける)' : ' (25%で溶ける)';
  // はやおき: 眠りの経過が2倍
  if (ab === 'earlybird') { if (c.statusKey === 'slpRest') return n >= 1 ? ' (次は起きる)' : ' (あと1回眠る)'; return n === 0 ? ' (次は1/3で起きる)' : ' (次は必ず起きる)'; }
  if (c.statusKey === 'slpRest') return n >= 2 ? ' (次は起きる)' : ` (あと${2 - n}回眠る)`;
  return n === 0 ? ' (次は眠ったまま)' : n === 1 ? ' (次は1/3で起きる)' : ' (次は必ず起きる)';
}

function SideState({battle, side, raw, isMega, abil}) {
  const sd = battle.state.sides[side];
  const tags = [];
  if (raw.status) tags.push(<span class="tag bad">{ST_JA[raw.status]}{statusNote(raw, abil)}</span>);
  for (const [k, l] of FLAGS) if (sd[k]) tags.push(<span class="tag accent">{l}</span>);
  if (sd.spikes > 0) tags.push(<span class="tag accent">まきびし×{sd.spikes}</span>);
  if (sd.tspikes > 0) tags.push(<span class="tag accent">どくびし×{sd.tspikes}</span>);
  if (sd.wish) tags.push(<span class="tag">ねがいごと</span>);
  if (sd.healingWish) tags.push(<span class="tag">いやしのねがい</span>);
  if (raw.bound) tags.push(<span class="tag bad">しめつけ</span>);
  if (raw.syrup) tags.push(<span class="tag bad">みずあめ</span>);
  if (raw.octolock) tags.push(<span class="tag bad">たこがため</span>);
  if (raw.salted) tags.push(<span class="tag bad">しおづけ</span>);
  if (raw.perish != null) tags.push(<span class="tag bad">ほろび {Math.min(3, raw.perish)}</span>);
  if (raw.destinyBond) tags.push(<span class="tag">みちづれ</span>);
  if (raw.aquaRing) tags.push(<span class="tag">アクアリング</span>);
  if (raw.ingrain) tags.push(<span class="tag">ねをはる</span>);
  if (raw.abilityChanged != null) tags.push(<span class="tag accent">特性: {raw.abilityChanged ? abilityName(raw.abilityChanged) : 'なし'}</span>);
  if (raw.seeded) tags.push(<span class="tag">やどりぎ</span>);
  if (raw.drowsy) tags.push(<span class="tag bad" title="次のターンの終わりに眠る (交代で消える)">ねむけ</span>);
  if (raw.status === 'tox') tags.push(<span class="tag muted">もうどく {raw.toxicCounter || 1}/16</span>);
  if ((raw.healBlock || 0) >= turnNumber(battle)) tags.push(<span class="tag bad" title="回復技・たべのこし・吸収・オボンなどで回復できない">かいふくふうじ (〜{raw.healBlock}ターン目)</span>);
  if (isMega) tags.push(<span class="tag accent">メガシンカ済み</span>);
  if (sd.megaUsed && !isMega) tags.push(<span class="tag">メガシンカ使用済み</span>);
  if (!tags.length) return null;
  return (
    <div class="pl-state">
      <span class="cap">状態</span>
      {tags}
    </div>
  );
}

// HPバー: 予想ダメージの帯を重ね、確定後はつまんで実際の値に合わせる
function HpBar({side, mon, battle, raw, max, targeted, mut, usage}) {
  const hp = raw.fainted ? 0 : raw.hp;
  const [fix, setFix] = useState(null); // HPの直接修正
  const color = v => (v > 50 ? 'g' : v > 20 ? 'y' : 'r');
  const label = v => (max ? `${Math.round((max * v) / 100)}/${max}` : `${dispOf(v)}%`);
  const r = targeted?.r;
  if (fix != null) {
    const v = fix;
    return (
      <div class="pl-hp edit">
        <StepRange value={max ? Math.round(max * v / 100) : Math.round(v)} max={max || 100} label="現在のHP" onChange={n => setFix(max ? n / max * 100 : n)} />
        <b class="num">{label(v)}</b>
        <button class="btn sm primary" onClick={() => { mut(b => addEvent(b, {kind: 'hp', side, mon, hpAfter: v}, usage)); setFix(null); }}>直す</button>
        <button class="btn sm ghost" onClick={() => setFix(null)}>取消</button>
      </div>
    );
  }
  const lo = r?.ok && !r.status ? Math.max(0, hp - r.maxPct) : null;
  const hi = r?.ok && !r.status ? Math.max(0, hp - r.minPct) : null;
  return (
    <div class="pl-hp" onClick={() => !targeted && !raw.fainted && setFix(hp)} title="押すとHPを直せます">
      <div class="hpbar">
        <div class={cx('hpfill', color(lo != null ? hi : hp))} style={{width: `${lo != null ? hi : hp}%`}} />
        {lo != null && <div class="hp-pred" style={{left: `${lo}%`, width: `${Math.max(0.6, hp - lo)}%`}} />}
        {lo != null && hi !== lo && <div class="hp-range" style={{left: `${lo}%`, width: `${hi - lo}%`}} />}
      </div>
      <b class="num">{raw.hpUnknown && <span class="tag">HP未確認 </span>}{raw.fainted ? 'ひんし' : lo != null ? `${label(hp)} → ${max ? `${Math.round((max * lo) / 100)}〜${Math.round((max * hi) / 100)}` : `${dispOf(lo)}〜${dispOf(hi)}%`}` : label(hp)}</b>
    </div>
  );
}

// ---- 行動の入力 (技 → HP・結果 → 記録) ----
function ActionArea({side, mon, slot, battle, ctx, usage, act, setAct, commit, needSend, waitEnd, done, pred, preds, suggestions}) {
  if (waitEnd) return <div class="pl-act hint-box">ターン終了後に交代</div>;
  if (needSend && (!act || act.kind !== 'send')) return <div class="pl-act hint-box">次のポケモンを選択</div>;
  if (act?.kind === 'send') {
    return (
      <div class="pl-act">
        <p><b>{nameOf(battle, side, act.to)}</b> を場に出す</p>
        <div class="btnrow"><button class="btn ghost" onClick={() => setAct(null)}>取消</button>
          <button class="btn primary grow" onClick={() => commit(b => addEvent(b, {kind: 'send', side, to: act.to}, usage))}>確定</button></div>
      </div>
    );
  }
  if (act?.kind === 'switch') {
    return (
      <div class="pl-act">
        <p>{act.to == null ? '交代先を上から選んでください' : <><b>{nameOf(battle, side, act.to)}</b> に交代</>}</p>
        <div class="btnrow"><button class="btn ghost" onClick={() => setAct(null)}>取消</button>
          <button class="btn primary grow" disabled={act.to == null} onClick={() => commit(b => addAct(b, {side, mon, type: 'switch', to: act.to, sameTurn: true}, usage))}>確定</button></div>
      </div>
    );
  }
  if (act?.kind === 'move') return <MoveAction side={side} mon={mon} battle={battle} ctx={ctx} usage={usage} act={act} setAct={setAct} commit={commit} r={pred} preds={preds} />;
  if (mon == null) return null;
  return done ? <div class="pl-act hint-box done">行動済み</div> : <div class="pl-act hint-box"><span>技または交代を選んで記録</span><button class="btn sm cant-direct" onClick={() => commit(b => addAct(b, {side, mon, type: 'move', cant: true, sameTurn: true}, usage))}>行動不能（技不明）</button>{suggestions}</div>;
}

function ObservedHP({battle, target, value, onChange, when = '行動後HP', compact = false}) {
  const max = target.side === 'me' ? maxHPOf(battle, target.mon) : 100;
  const label = `${SIDE_JA[target.side]} ${nameOf(battle, target.side, target.mon)}の${when}`;
  const number = value == null ? null : Math.round(value * max / 100);
  const change = n => onChange(n == null ? null : target.side === 'me' ? Math.max(0, Math.min(max, n)) / max * 100 : Math.max(0, Math.min(100, n)));
  return <div class="pa-hp">
    <label>{compact ? when : label}<input class="input num" aria-label={label} type="number" inputMode="numeric" min={0} max={max} step={1} placeholder="未入力" value={number ?? ''} onInput={e => change(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} /></label>
    <span>{target.side === 'me' ? `/${max}` : '%'}</span>
    <button class="btn sm" aria-label={`${label}を1減らす`} disabled={number == null || number <= 0} onClick={() => change(number - 1)}>−</button>
    <button class="btn sm" aria-label={`${label}を1増やす`} disabled={number == null || number >= max} onClick={() => change(number + 1)}>＋</button>
  </div>;
}

function MoveAction({side, mon, battle, ctx, usage, act, setAct, commit, r, preds}) {
  const mv = dex.moves[act.move];
  const tgt = act.tgt;
  const damaging = mv && mv.c !== 'Z' && !(act.move === 'pollenpuff' && tgt?.side === side);
  const foes = living(battle, other(side));
  const targetOptions = mv?.tg === 'adjacentAlly' ? living(battle, side).filter(i => i !== mon).map(mon => ({side, mon}))
    : ['healpulse', 'decorate', 'pollenpuff'].includes(act.move) ? ['me', 'opp'].flatMap(s => living(battle, s).filter(i => s !== side || i !== mon).map(mon => ({side: s, mon})))
    : foes.map(mon => ({side: other(side), mon}));
  const tgtHp = tgt ? (condOf(battle, tgt.side, tgt.mon)?.hp ?? 100) : 100;
  const tgtMax = tgt?.side === 'me' ? maxHPOf(battle, tgt.mon) : null;
  const set = patch => setAct(a => ({...a, ...patch}));
  const base = {side, mon, type: 'move', move: act.move, crit: act.crit, sameTurn: true, target: battle.format === 'double' ? tgt : null};
  const disguiseOnly = damaging && tgt && !r?.immune && disguiseIntact(buildOf(battle,tgt.side,tgt.mon),condOf(battle,tgt.side,tgt.mon)) &&
    defaultHits(act.move,currentAbility(ctx.build(side,mon),ctx.cond(side,mon))) === 1 &&
    !['moldbreaker','teravolt','turboblaze','myceliummight'].includes(currentAbility(ctx.build(side,mon),ctx.cond(side,mon))) &&
    !['sunsteelstrike','moongeistbeam','photongeyser'].includes(act.move);
  const variableFx = damaging && sureSelfFx(battle, side, mon, tgt, act.move, act.hp).some(k => ['drain', 'ooze', 'shellbell', 'innards'].includes(k) || (k === 'recoil' && !HALF_RECOIL.has(act.move)));
  const reflected = act.move === 'strengthsap' && tgt && defaultAbilityResolver(battle, tgt.side, tgt.mon) === 'magicbounce';
  const hpTargets = act.move === 'painsplit' ? [{side, mon}, ...(tgt ? [tgt] : [])] : act.move === 'strengthsap' ? [reflected ? tgt : {side, mon}] : variableFx ? [{side, mon}] : [];
  const hpKey = t => `${t.side}${t.mon}`;
  const observedHp = hpTargets.filter(t => act.resultHp?.[hpKey(t)] != null).map(t => ({...t, hpAfter: act.resultHp[hpKey(t)]}));
  const missingResultHp = hpTargets.some(t => act.resultHp?.[hpKey(t)] == null);
  const record = extra => {
    const observed = extra.miss || extra.cant || extra.protect ? [] : observedHp;
    commit((b, forme) => addAct(b, {...base, ...extra, ...(forme ? {mega: true, megaForme: forme} : {}), ...(observed.length ? {observedHp: observed} : {})}, usage));
  };
  const hpInputs = hpTargets.map(t => <ObservedHP key={hpKey(t)} battle={battle} target={t} compact={hpTargets.length === 1 && t.side === side && t.mon === mon} value={act.resultHp?.[hpKey(t)]} onChange={value => set({resultHp: {...act.resultHp, [hpKey(t)]: value}})} />);
  // ふかしのこぶし・かんつうドリル: 接触技はまもるを貫いて 1/4 のダメージ (チャンピオンズ)
  const pierceable = damaging && tgt && mv.fl?.includes('contact') && ['unseenfist', 'piercingdrill'].includes(currentAbility(buildOf(battle, side, mon), condOf(battle, side, mon)));
  const fail = k => {
    if (k === 'protect' && pierceable) { set({stage: 'hp', pierce: true, hp: null}); return; }
    record({[k]: true});
  };
  // 変化技は結果を記録。攻撃技は選択直後からHPを入力できる。
  const confirm = () => {
    if (!damaging || !tgt) { record({inflict: act.inflict || '', to: PIVOT_MOVES.has(act.move) ? act.to : null, revive: act.move === 'revivalblessing' ? act.revive : undefined}); return; }
    set({stage: 'hp', hp: null});
  };
  const tb = tgt ? buildOf(battle, tgt.side, tgt.mon) : null, tc = tgt ? condOf(battle, tgt.side, tgt.mon) : null;
  const tItem = tc && !tc.itemGone ? tb.item : '';
  const save = () => {
    const hp = act.hp == null ? null : Math.max(0, Math.min(100, act.hp));
    const extra = {hpAfter: act.afterResidual ? undefined : hp ?? undefined, hpUnknown: act.afterResidual || hp == null || undefined, ...(act.afterResidual && hp != null ? {endHp: {...tgt, hpAfter: hp}} : {}), pierce: act.pierce || undefined, secFx: act.secFx.length ? act.secFx : undefined, inflict: act.inflict || '', selfFx: hp == null || act.afterResidual ? [] : sureSelfFx(battle, side, mon, tgt, act.move, hp), exact: tgt.side === 'me'};
    const ownHp = observedHp.find(h => h.side === side && h.mon === mon);
    if (ownHp) extra.atkHpAfter = ownHp.hpAfter;
    if ((hp == null || act.afterResidual) && sureSelfFx(battle, side, mon, tgt, act.move, null).length) extra.selfHpUnknown = true;
    if (act.defItem) extra.defItem = {item: act.defItem, consumed: consumable(act.defItem)};
    if (act.defItem === 'focussash') { extra.endured = true; delete extra.hpAfter; delete extra.hpUnknown; }
    if (PIVOT_MOVES.has(act.move)) extra.to = act.to;
    if (FORCE_MOVES.has(act.move)) extra.forceTo = act.forceTo;
    if (act.eject?.to != null) extra.eject = act.eject;
    if (act.cst) { extra.contactStatus = act.cst.st; extra.contactAbility = act.cst.ab; }
    record(extra);
  };
  // 当たったあとの交代 (だっしゅつボタン・ききかいひ・にげごし / レッドカード) と、接触で受ける状態異常
  const tAbs = tgt ? (tgt.side === 'me' || tb.ability ? [currentAbility(tb, tc)] : dex.species[currentSpecies(tb, tc)]?.ab || []) : [];
  // 相手の持ち物が分からないときは、使用率に出てくる持ち物だけ候補にする
  const tItemMaybe = it => tgt && !tc.itemGone && (tb.item === it || (tgt.side === 'opp' && !tb.item && (ctx.views[tgt.mon]?.items || []).some(([id]) => id === it)));
  const ejects = damaging && tgt ? [
    tItemMaybe('ejectbutton') && ['ejectbutton', 'tgt'], tAbs.includes('emergencyexit') && ['emergencyexit', 'tgt'], tAbs.includes('wimpout') && ['wimpout', 'tgt'],
    tItemMaybe('redcard') && ['redcard', 'atk'],
  ].filter(Boolean) : [];
  const ejSide = act.eject ? (act.eject.who === 'atk' ? side : tgt.side) : null;
  const ejBench = ejSide ? benchOf(battle, ejSide).filter(i => !condOf(battle, ejSide, i)?.fainted) : [];
  const CONTACT_ST = {static: [['par', 'まひ']], flamebody: [['brn', 'やけど']], poisonpoint: [['psn', 'どく']], effectspore: [['psn', 'どく'], ['par', 'まひ'], ['slp', 'ねむり']]};
  const cst = damaging && tgt && mv.fl?.includes('contact') && !condOf(battle, side, mon).status ? tAbs.flatMap(ab => (CONTACT_ST[ab] || []).map(([st, l]) => ({ab, st, l}))) : [];
  const fbench = FORCE_MOVES.has(act.move) && tgt ? benchOf(battle, tgt.side).filter(i => !condOf(battle, tgt.side, i)?.fainted) : [];
  // とんぼがえり等で交代先、ドラゴンテール等で出てきたポケモンが必要なら、選ぶまで記録しない
  const pivotBench = PIVOT_MOVES.has(act.move) ? benchOf(battle, side).filter(i => !condOf(battle, side, i)?.fainted) : [];
  const willFaint = act.hp === 0;
  const dead = act.move === 'revivalblessing' ? benchOf(battle, side).filter(i => condOf(battle, side, i)?.fainted) : [];
  const needTo = pivotBench.length > 0 && act.to == null;
  const needForce = FORCE_MOVES.has(act.move) && !willFaint && fbench.length > 0 && act.forceTo == null;
  const blocked = act.stage === 'hp' && (needTo || needForce || (act.eject && act.eject.to == null));
  const sec = (mv?.sec || []).flatMap(e => {
    const out = [];
    if (e.st) for (const st of [].concat(e.st)) out.push({e: {st}, label: STATUS_OPTS.find(x => x[0] === st)?.[1] || st});
    if (e.bo) out.push({e: {bo: e.bo}, label: `相手の${Object.entries(e.bo).map(([k, v]) => `${k.toUpperCase()}${v > 0 ? '+' : ''}${v}`).join(' ')}`});
    if (e.sb) out.push({e: {sb: e.sb}, label: `自分の${Object.entries(e.sb).map(([k, v]) => `${k.toUpperCase()}${v > 0 ? '+' : ''}${v}`).join(' ')}`});
    if (e.vo === 'flinch') out.push({e: {vo: 'flinch'}, label: 'ひるみ'});
    return out;
  });
  const secOn = x => act.secFx.some(y => JSON.stringify(y) === JSON.stringify(x.e));
  const scenLabels = [['base', preds?.base?.rangeMode === 'assumed' ? '想定配分' : '候補全体'], ['min', '最小側の配分'], ['max', '最大側の配分']];
  const selectedOutcome = outcome(r, tgtHp, tgtMax);
  return (
    <div class="pl-act move">
      <div class="pa-h"><span class={cx('mv-bar inline', `t-${mv?.t}`)} /><b>{moveName(act.move)}</b><button class="btn ghost sm pa-cancel" onClick={() => setAct(null)}>取消</button>
        {battle.format === 'double' && targetOptions.length > 1 && !['self', 'allies', 'allySide', 'all', 'foeSide'].includes(mv?.tg) && <span class="chips">{targetOptions.map(t => <button class={cx('chip sm', tgt?.side === t.side && tgt?.mon === t.mon && 'on')} onClick={() => { if (tgt?.side !== t.side || tgt?.mon !== t.mon) set({tgt: t, resultHp: {}, stage: mv?.c === 'Z' || (act.move === 'pollenpuff' && t.side === side) ? 'pick' : 'hp', hp: null, defItem: '', forceTo: null, eject: null, cst: null, secFx: []}); }}>{targetOptions.some(x => x.side === side) && `${t.side === 'me' ? '自分' : '相手'} `}{nameOf(battle, t.side, t.mon)}</button>)}</span>}
      </div>
      {damaging && tgt && <>
        <details class="pa-predictions">
          <summary>予測 {selectedOutcome ? `残り ${selectedOutcome.to}` : '計算できません'} <small>詳細</small></summary>
          <div class="pa-rows">
          {scenLabels.map(([k, label]) => {
            const x = preds?.[k];
            const o = outcome(x, tgtHp, tgtMax);
            return (
              <button class={cx('pa-row', act.scen === k && 'on', o?.ko)} onClick={() => set({scen: k})}>
                <span class="pa-lb">{label}</span>
                {!x?.ok ? <span class="muted">計算できません</span> : x.immune ? <b>効果なし</b> : <>
                  <span class="pa-after num">{o.from} → <b>{o.to}</b></span>
                  <span class="pa-sub"><span class={cx('pa-ko', o.ko)}>{o.koLabel}</span><small class="muted num">{fmtPct(x.minPct)}〜{fmtPct(x.maxPct)}%</small></span>
                </>}
              </button>
            );
          })}
          </div>
        </details>
      </>}
      {!damaging && <p class="muted">{act.move === 'pollenpuff' ? '味方のHPを半分回復' : '変化技'}{act.inflict ? ` (${STATUS_OPTS.find(x => x[0] === act.inflict)?.[1]})` : ''}</p>}
      {damaging && tgt && <Toggle small on={!!act.afterResidual} onChange={v => set({afterResidual: v})}>回復・定数ダメージ後のHP</Toggle>}
      <div class="chips pa-outcomes">
        {damaging && <Toggle small on={act.crit} onChange={v => set({crit: v})}>急所</Toggle>}
        <button class="chip sm" onClick={() => fail('miss')}>外し</button>

        <button class="chip sm" onClick={() => fail('cant')}>行動不能</button>
        <button class="chip sm" onClick={() => fail('protect')}>まもられた</button>
      </div>
      {act.move === 'revivalblessing' && (dead.length
        ? <div class="chips"><span class="muted">復活:</span>{dead.map(i => <button class={cx('chip sm', act.revive === i && 'on')} onClick={() => set({revive: act.revive === i ? null : i})}>{nameOf(battle, side, i)}</button>)}</div>
        : <p class="muted">ひんしのポケモンがいません</p>)}
      {!damaging && PIVOT_MOVES.has(act.move) && <p class="hint">交代先: {act.to != null ? nameOf(battle, side, act.to) : '上から選択'}</p>}
      {act.stage === 'pick' && hpInputs}
      {act.stage === 'pick' && <div class="btnrow">{hpTargets.length > 0 && <button class="btn" onClick={confirm}>HP不明で記録</button>}<button class="btn primary grow" disabled={missingResultHp || (!damaging && needTo) || (act.move === 'revivalblessing' && dead.length > 0 && act.revive == null)} onClick={confirm}>記録</button></div>}
      {act.stage === 'hp' && disguiseOnly && <div class="disguise-record">
        <p>ばけのかわで防がれた場合は、残りHPの入力は不要です。</p>
        <button class="btn primary" disabled={needTo} onClick={() => record({to:act.to,forceTo:act.forceTo,selfFx:sureSelfFx(battle,side,mon,tgt,act.move,null).filter(k => ['lifeorb','helmet','roughskin'].includes(k) || k === 'recoil' && HALF_RECOIL.has(act.move))})}>ばけのかわを記録</button>
        <small class="muted">皮がはがれた状態とHPの減少を反映します。</small>
        <button class="btn ghost sm" onClick={() => set({manualDisguiseHp:!act.manualDisguiseHp})}>{act.manualDisguiseHp ? 'HP入力を閉じる' : '実際のHPを指定する'}</button>
      </div>}
      {act.stage === 'hp' && (!disguiseOnly || act.manualDisguiseHp) && <>
        <div class="pa-hp"><label>残りHP<input class="input num" type="number" inputMode="numeric" min={0} max={tgtMax || 100} placeholder="未入力" aria-label="残りHP" value={act.hp == null ? '' : tgtMax ? Math.round(tgtMax * act.hp / 100) : act.hp} onInput={e => { const v = e.currentTarget.value; set({hp: v === '' ? null : Math.max(0, Math.min(100, tgtMax ? Number(v) / tgtMax * 100 : Number(v)))}); }} /></label><span>{tgtMax ? `/${tgtMax}` : '%'}</span><button class="btn sm" onClick={() => set({hp: 0})}>ひんし</button></div>
        <StepRange value={tgtMax ? Math.round(tgtMax * (act.hp ?? tgtHp) / 100) : Math.round(act.hp ?? tgtHp)} max={tgtMax || 100} label="残りHPの調整" onChange={n => set({hp: tgtMax ? n / tgtMax * 100 : n})} />
        {hpInputs}
        {act.hp == null && <span class="hint pa-unknown">残りHPを入力、または不明で記録</span>}
        {act.pierce && <p class="hint">まもるを貫通 (1/4)</p>}
        {sec.length > 0 && <div class="chips"><span class="muted">追加効果:</span>{sec.map(x => <button class={cx('chip sm', secOn(x) && 'on')} onClick={() => set({secFx: secOn(x) ? act.secFx.filter(y => JSON.stringify(y) !== JSON.stringify(x.e)) : [...act.secFx, x.e]})}>{x.label}</button>)}</div>}
        {tItem && consumable(tItem) && !((tc.healBlock || 0) >= turnNumber(battle) && /berry$/.test(tItem) && tItem !== 'lumberry') && <div class="chips"><button class={cx('chip sm', act.defItem === tItem && 'on')} onClick={() => set({defItem: act.defItem === tItem ? '' : tItem})}>{itemName(tItem)}が発動</button></div>}
        {tgt.side === 'opp' && !tb.item && <div class="chips"><span class="muted">発動:</span>{['focussash', 'sitrusberry'].filter(it => it !== 'sitrusberry' || !((tc.healBlock || 0) >= turnNumber(battle))).map(it => <button class={cx('chip sm', act.defItem === it && 'on')} onClick={() => set({defItem: act.defItem === it ? '' : it})}>{itemName(it)}</button>)}</div>}
        {PIVOT_MOVES.has(act.move) && <p class="hint">交代先: {act.to != null ? nameOf(battle, side, act.to) : '上から選択'}</p>}
        {fbench.length > 0 && <div class="chips"><span class="muted">引きずり出された:</span>{fbench.map(i => <button class={cx('chip sm', act.forceTo === i && 'on')} onClick={() => set({forceTo: act.forceTo === i ? null : i})}>{nameOf(battle, tgt.side, i)}</button>)}</div>}
        {ejects.length > 0 && <div class="chips"><span class="muted">交代:</span>{ejects.map(([k, who]) => <button class={cx('chip sm', act.eject?.reason === k && 'on')} onClick={() => set({eject: act.eject?.reason === k ? null : {reason: k, who, to: null}})}>{EJECT_JA[k]}</button>)}</div>}
        {act.eject && <div class="chips"><span class="muted">出てきた:</span>{ejBench.map(i => <button class={cx('chip sm', act.eject.to === i && 'on')} onClick={() => set({eject: {...act.eject, to: i}})}>{nameOf(battle, ejSide, i)}</button>)}</div>}
        {cst.length > 0 && <div class="chips"><span class="muted">接触:</span>{cst.map(x => <button class={cx('chip sm', act.cst?.st === x.st && act.cst?.ab === x.ab && 'on')} onClick={() => set({cst: act.cst?.st === x.st && act.cst?.ab === x.ab ? null : x})}>{abilityName(x.ab)}で{x.l}</button>)}</div>}
        {blocked && <p class="hint warn">{needTo ? '交代先を選択' : '出てきたポケモンを選択'}</p>}
        <div class="btnrow"><button class="btn" disabled={blocked} onClick={save}>HP不明で記録</button><button class="btn primary grow" disabled={blocked || missingResultHp || (act.hp == null && act.defItem !== 'focussash')} onClick={() => save()}>記録</button></div>
      </>}
    </div>
  );
}

/** 予想の結果: 今のHP → 残りの範囲、ひんしにできるか */
export function outcome(r, hp, max) {
  if (!r?.ok || r.status || r.immune) return null;
  const lo = Math.max(0, hp - r.maxPct), hi = Math.max(0, hp - r.minPct);
  const show = v => (max ? `${Math.round((max * v) / 100)}` : `${dispOf(v)}%`);
  const cur = r.defHP || 0;
  const rolls = (r.rolls || []).filter(Number.isFinite);
  let ko = '', koLabel;
  if (cur > 0 && (r.rangeMode === 'candidates' ? r.minPct >= hp : r.min >= cur)) { ko = 'sure'; koLabel = '確定でひんし'; }
  else if (cur > 0 && (r.rangeMode === 'candidates' ? r.maxPct >= hp : r.max >= cur)) {
    const p = rolls.length === 16 ? rolls.filter(x => x >= cur).length / 16 : null; // 連続技は1発ずつの乱数なので割合は出さない
    ko = 'maybe'; koLabel = r.rangeMode === 'candidates' ? '配分・乱数によってひんし' : `乱数でひんし${p != null ? ` (${Math.round(p * 1000) / 10}%)` : ''}`;
  } else koLabel = r.koText || '';
  return {from: max ? `${Math.round((max * hp) / 100)}` : `${dispOf(hp)}%`, to: lo === hi ? show(lo) : `${show(lo)}〜${show(hi)}`, ko, koLabel};
}

// ---- ターン終了 (右下) ----
export function TurnBar({battle, ctx, mut, usage, toast, focusSide}) {
  const t = openTurn(battle);
  const doneMe = sideDone(battle, 'me'), doneOpp = sideDone(battle, 'opp');
  const cands = useMemo(() => (t ? residualCandidates(battle, usage) : []), [battle]);
  const expiries = useMemo(() => (t ? expiryCandidates(battle) : []), [battle]);
  const [maybe, setMaybe] = useState({});
  const [exp, setExp] = useState({});
  const [ev, setEv] = useState(false);
  const [keep, setKeep] = useState(false);
  const [skip, setSkip] = useState(false);
  const [resOrder, setResOrder] = useState({key: '', value: ''});
  const [stepHpInput, setStepHpInput] = useState({key: '', values: {}});
  const endHpKey = `${battle.id}:${t?.n ?? ''}`;
  const [endHpInput, setEndHpInput] = useState({key: '', values: {}});
  const endHp = endHpInput.key === endHpKey ? endHpInput.values : {};
  const changeEndHp = (key, value) => setEndHpInput(s => ({key: endHpKey, values: {...(s.key === endHpKey ? s.values : {}), [key]: value}}));
  const lostSide = ['opp', 'me'].find(side => faintedCount(battle, side) >= pickCount(battle.format));
  const sure = cands.filter(c => c.checked);
  const unsure = cands.filter(c => !c.checked);
  const hpMons = ['me', 'opp'].flatMap(side => battle.state.sides[side].active.filter(mon => mon != null && !condOf(battle, side, mon)?.fainted).map(mon => ({side, mon})));
  const sharedEffects = [...new Set(cands.filter(c => c.side === 'me').map(c => c.key))].filter(key => cands.some(c => c.side === 'opp' && c.key === key) && ['grassy', 'sand', 'leftovers', 'blacksludge', 'psn', 'tox', 'brn'].includes(key));
  const orderValue = resOrder.key === endHpKey ? resOrder.value : '';
  const orderParts = orderValue.split(':');
  const orderAllowed = battle.format === 'single' && sharedEffects.includes(orderParts[0]);
  const keyOf = c => `${c.side}${c.mon}${c.key}`;
  const end = (incomplete = false) => {
    let log = [];
    const finalHp = {...Object.fromEntries((t?.acts || []).filter(a => a.in?.endHp).map(a => [`${a.in.endHp.side}${a.in.endHp.mon}`, a.in.endHp.hpAfter])), ...Object.fromEntries(Object.entries(endHp).filter(([, value]) => value != null))};
    mut(b => { log = finishTurn(b, usage, {incomplete, noOrder: incomplete, finalHp, resFirst: orderAllowed ? orderParts[1] : undefined, residual: [...sure, ...unsure.filter(c => maybe[keyOf(c)])].map(c => ({...c, hpAfter: stepHpInput.key === endHpKey && stepHpInput.values[keyOf(c)] !== '' ? stepHpInput.values[keyOf(c)] : undefined})), expiry: expiries.filter(x => exp[x.key] != null).map(x => ({key: x.key, ended: exp[x.key], n: x.n}))}) || []; });
    setMaybe({}); setExp({}); setSkip(false);
    toast(log.length ? log[log.length - 1] : 'ターンを終えました');
  };
  // 1つ戻す: ターンを終えた直後なら「ターン終了」を取り消して、そのターンの入力に戻る。
  // そうでなければ最後の記録を消す (次の記録は戻ったターンに入る)
  const undo = () => {
    const ti = battle.turns.length - 1;
    const tt = battle.turns[ti];
    if (!tt) return;
    if (!tt.open) { mut(b => { reopenLastTurn(b, usage); }); toast(`ターン${tt.n}の終了を取り消しました`); return; }
    if (!tt.acts.length) return;
    mut(b => { editAct(b, ti, tt.acts.length - 1, null, usage); });
    toast('最後の記録を取り消しました');
  };
  const lastActs = (t || battle.turns[battle.turns.length - 1])?.acts.length;
  if (lostSide && !keep) {
    const res = lostSide === 'opp' ? 'win' : 'lose';
    return (
      <div class={cx('turnbar game-over', res)}>
        <b class="go-title">{lostSide === 'opp' ? '勝ち！' : '負け'}</b>
        {t && t.acts.length > 0 && <button class="btn primary" onClick={() => { mut(b => { finishTurn(b, usage); if (b.kind !== 'sim') b.result = res; }); }}>最後のターンを確定</button>}
        {!t && battle.kind !== 'sim' && battle.result !== res && <button class="btn primary" onClick={() => mut(b => { b.result = res; })}>結果を「{res === 'win' ? '勝ち' : '負け'}」にする</button>}
        <button class="btn ghost sm" onClick={() => setKeep(true)}>記録を続ける</button>
      </div>
    );
  }
  return (
    <div class="turnbar">
      <div class="tb-status">
        <button class={cx('tb-side me', doneMe && 'ok')} onClick={() => focusSide?.('me')} title="自分の盤面へ移動" aria-label="自分の盤面へ">自分 {doneMe ? '✓' : '…'}</button>
        <button class={cx('tb-side opp', doneOpp && 'ok')} onClick={() => focusSide?.('opp')} title="相手の盤面へ移動" aria-label="相手の盤面へ">相手 {doneOpp ? '✓' : '…'}</button>
        {lastActs > 0 && <button class="btn ghost sm" onClick={undo}>1つ戻す</button>}
        <button class="btn ghost sm" onClick={() => setEv(true)}>その他の変化…</button>
      </div>
      {sure.length > 0 && <div class="tb-auto">ターン終了時: {sure.map(c => `${SIDE_JA[c.side]}${c.label}`).join('・')}</div>}
      {(t?.acts || []).filter(a => a.in?.endHp).map(a => <p class="hint tb-staged-hp">{SIDE_JA[a.in.endHp.side]}の終了後HP {Math.round(a.in.endHp.hpAfter)}% を使用</p>)}
      {t && <details class="tb-hp-inputs"><summary>終了後HPを入力・推定</summary><p class="hint">回復・定数ダメージが終わった後のHP。見逃した攻撃も条件が合えば逆算します。</p>{hpMons.map(c => <ObservedHP key={`${c.side}${c.mon}`} battle={battle} target={c} when="ターン終了後HP" value={endHp[`${c.side}${c.mon}`]} onChange={value => changeEndHp(`${c.side}${c.mon}`, value)} />)}</details>}
      {t && battle.format === 'single' && sharedEffects.length > 0 && <label class="field tb-order"><span>同じ処理の順番 → 素早さ推定</span><select class="input" aria-label="終了時の処理順" value={orderAllowed ? orderValue : ''} onChange={e => setResOrder({key: endHpKey, value: e.currentTarget.value})}><option value="">未確認</option>{sharedEffects.flatMap(key => ['me', 'opp'].map(side => <option value={`${key}:${side}`}>{cands.find(c => c.key === key).label}：{SIDE_JA[side]}が先</option>))}</select><small class="hint">異なる種類の処理の前後は比較しません。同速の可能性も残します。</small></label>}
      {t && cands.some(c => c.side === 'opp' && !c.manualHP) && <details class="tb-step-hp"><summary>途中の相手HP → 能力Pt推定</summary><p class="hint">各処理の直後に見えた整数%だけ入力。回復とダメージが相殺されても、途中の変化から最大HPを絞れます。</p>{cands.filter(c => c.side === 'opp' && !c.manualHP && (c.checked || maybe[keyOf(c)])).map(c => <label class="field"><span>{c.label}の直後（%）</span><input type="number" class="input" min="0" max="100" step="1" inputMode="numeric" value={stepHpInput.key === endHpKey ? stepHpInput.values[keyOf(c)] ?? '' : ''} onInput={e => {const v=e.currentTarget.value; setStepHpInput(s => ({key:endHpKey, values:{...(s.key === endHpKey ? s.values : {}), [keyOf(c)]: v === '' ? '' : Math.max(0, Math.min(100, Math.round(Number(v))))}}));}} /></label>)}</details>}
      {unsure.length > 0 && <div class="chips tb-maybe"><span class="muted">起きた?</span>{unsure.map(c => <button class={cx('chip sm', maybe[keyOf(c)] && 'on')} onClick={() => setMaybe({...maybe, [keyOf(c)]: !maybe[keyOf(c)]})}>{SIDE_JA[c.side]} {c.label}</button>)}</div>}
      {expiries.map(x => (
        <div class="tb-exp"><span>{x.label} 終わった?</span><Seg small value={exp[x.key] == null ? '' : exp[x.key] ? 'y' : 'n'} options={[['', '—'], ['y', '終わった'], ['n', '続く']]} onChange={v => setExp({...exp, [x.key]: v === '' ? null : v === 'y'})} /></div>
      ))}
      <button class="btn primary tb-end" disabled={!t || !doneMe || !doneOpp} onClick={() => end()}>ターン終了</button>
      {(!t || !doneMe || !doneOpp) && <button class="btn tb-skip" onClick={() => setSkip(true)}>未入力のまま次へ</button>}
      {skip && <Confirm title="未入力のまま次のターンへ" message="未記録の行動や入力途中の内容は保存されません。このターンは未入力ありとして残し、行動順からの推定は行いません。" okLabel="次のターンへ" onOk={() => end(true)} onClose={() => setSkip(false)} />}
      {ev && <Sheet title="その他の変化" onClose={() => setEv(false)} wide><EventForm battle={battle} mut={mut} usage={usage} toast={m => { toast(m); setEv(false); }} /></Sheet>}
    </div>
  );
}
