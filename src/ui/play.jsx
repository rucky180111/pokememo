// 対戦の盤面 (入力もここで完結する)
//   相手の枠 / 場の状態 / 自分の枠。枠の中: 名前・持ち物・特性・HP・能力表・技 (PP)・場の状態、右上に交代。
//   技を押す → 右側にダメージの予想 (相手のHPバーに予想が出る) → 確定 → HPバーを実際の値に合わせて記録。
//   先に記録したほうが先に動いた扱い。両方が動いたら (右下の) ターン終了。
//   分かっていること (自分の持ち物・特性、判明した相手の持ち物・特性) は聞き直さずに自動で反映する。
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf, STAT_JA, STAT_KEYS} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies, currentAbility, typesOf} from '../engine/calc.js';
import {condOf, buildOf, other, turnNumber, PIVOT_MOVES, faintedCount, pickCount} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {scenarioBuild} from '../engine/estimate.js';
import {revealIllusion, addAct, addEvent, openTurn, residualCandidates, expiryCandidates, finishTurn, editAct, canReplay, replay, dispOf, ppLeft, sideDone, FORCE_MOVES, RECOIL, HALF_RECOIL, DRAIN} from '../engine/flow.js';
import {speedOutlook} from '../engine/assume.js';
import {finalSpeed} from '../engine/calc.js';
import {Picker, Sheet, Seg, Toggle, TypeChip, Sprite, Confirm, cx, fmtPct, rate} from './common.jsx';
import {OppStatTable} from './arena.jsx';
import {MegaButtons, EventForm, STATUS_MOVE, STATUS_OPTS, consumable} from './turn.jsx';

const SIDE_JA = {me: '自分', opp: '相手'};
// HPを合わせる段階で、HPバーの横からも記録できるようにする
const saveRef = {current: null};
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
function predict(battle, ctx, side, mon, tgt, move, scen, crit) {
  if (!tgt || !dex.moves[move]) return null;
  let c = ctx;
  const oppIdx = side === 'opp' ? mon : tgt.mon;
  const opp = battle.opp[oppIdx];
  if (scen !== 'base' && opp) {
    const base = ctx.build('opp', oppIdx);
    const sid = currentSpecies(base, ctx.cond('opp', oppIdx));
    const kind = side === 'me' ? (scen === 'min' ? 'bulkMin' : 'bulkMax') : (scen === 'min' ? 'powMin' : 'powMax');
    c = {...ctx, build: (s, i) => (s === 'opp' && i === oppIdx ? scenarioBuild(opp, base, sid, kind, dex.moves[move].c) : ctx.build(s, i))};
  }
  return attackTable(c, side, mon, {crit, only: {def: tgt.mon, move}})?.targets[0]?.results[move] || null;
}

// 攻撃した側のHPの変化で、確実に起きるもの (分かっている持ち物・特性・技の効果)
function sureSelfFx(battle, side, mon, tgt, move) {
  const m = dex.moves[move];
  if (!m || m.c === 'Z' || !tgt || tgt.side === side) return [];
  const out = [];
  const ab = buildOf(battle, side, mon), ac = condOf(battle, side, mon);
  const tb = buildOf(battle, tgt.side, tgt.mon), tc = condOf(battle, tgt.side, tgt.mon);
  if (!ac.itemGone && ab.item === 'lifeorb') out.push('lifeorb');
  if (RECOIL[move] || HALF_RECOIL.has(move)) out.push('recoil');
  if (DRAIN[move]) out.push('drain');
  if (m.fl?.includes('contact')) {
    if (!tc.itemGone && tb.item === 'rockyhelmet') out.push('helmet');
    const tab = currentAbility(tb, tc);
    if ((tgt.side === 'me' || tb.ability) && (tab === 'roughskin' || tab === 'ironbarbs')) out.push('roughskin');
  }
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
  const commit = (fn, okMsg) => {
    let log = [];
    mut(b => { log = fn(b) || []; autoHazards(b, usage); });
    setAct(null);
    const last = log.filter(Boolean).slice(-1)[0];
    toast(last || okMsg || '記録しました');
  };
  // 技を選んでいるときのダメージ予想 (相手のHPバーと右側の両方で使う)
  const pred = useMemo(() => {
    if (act?.kind !== 'move' || !act.tgt || dex.moves[act.move]?.c === 'Z') return null;
    return predict(battle, ctx, act.side, act.mon, act.tgt, act.move, act.scen, act.crit);
  }, [ctx, act?.kind, act?.side, act?.mon, act?.move, act?.scen, act?.crit, act?.tgt?.mon]);
  const p = {battle, ctx, mut, usage, toast, act, setAct, commit, setSheet, pred};
  const sideMons = side => {
    const a = battle.state.sides[side].active;
    return a.length ? a.map((i, slot) => ({i, slot})) : [{i: null, slot: 0}];
  };
  return (
    <div class="play">
      {sideMons('opp').map(({i, slot}) => <Panel key={`opp${slot}`} side="opp" mon={i} slot={slot} {...p} />)}
      <FieldBar battle={battle} />
      {sideMons('me').map(({i, slot}) => <Panel key={`me${slot}`} side="me" mon={i} slot={slot} {...p} />)}
    </div>
  );
}

function FieldBar({battle}) {
  const f = battle.state.field;
  const W = Object.fromEntries(WEATHERS), T = Object.fromEntries(TERRAINS);
  const now = turnNumber(battle);
  const age = k => (f[k] && f.since?.[k] != null ? <small class="muted"> {Math.max(1, now - f.since[k] + 1)}T目</small> : null);
  return (
    <div class="pl-field">
      <span class="tag strong">ターン {now}</span>
      <span>天候 <b class={cx(f.weather && 'on')}>{W[f.weather || '']}</b>{age('weather')}</span>
      <span>フィールド <b class={cx(f.terrain && 'on')}>{T[f.terrain || '']}</b>{age('terrain')}</span>
      {f.trickRoom && <span class="tag accent">トリックルーム{age('trickRoom')}</span>}
      {f.gravity && <span class="tag accent">じゅうりょく</span>}
    </div>
  );
}

// ---- 1体ぶんの枠 ----
function Panel({side, mon, slot, battle, ctx, mut, usage, toast, act, setAct, commit, setSheet, pred}) {
  const sd = battle.state.sides[side];
  const bench = benchOf(battle, side);
  const live = bench.filter(i => !condOf(battle, side, i)?.fainted);
  const empty = mon == null;
  const fainted = !empty && condOf(battle, side, mon)?.fainted;
  const needSend = (empty || fainted) && live.length > 0;
  const done = sideDone(battle, side);
  const mine = act && act.side === side && (act.mon === mon || act.kind === 'send');
  const swapMode = (mine && (act.kind === 'switch' || act.kind === 'send')) || needSend;
  const pickBench = i => {
    if (needSend) { setAct({side, kind: 'send', slot, to: i}); return; }
    if (mine && act.kind === 'switch') { setAct({...act, to: i}); return; }
    if (mine && act.kind === 'move' && act.stage === 'hp' && PIVOT_MOVES.has(act.move)) { setAct({...act, to: act.to === i ? null : i}); return; }
    setSheet({side, idx: i});
  };
  const targeted = act && act.kind === 'move' && act.tgt && act.tgt.side === side && act.tgt.mon === mon ? {...act, r: pred} : null;
  return (
    <section class={cx('pl', side, fainted && 'fainted', mine && 'acting')}>
      <div class="pl-main">
        {empty ? <div class="pl-empty">{needSend ? (side === 'me' ? '先発を右上から選んでください' : '相手の先発を右上から選んでください') : '場にいません'}</div>
          : <MonView side={side} mon={mon} battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} act={act} setAct={setAct} targeted={targeted} done={done} setSheet={setSheet} />}
      </div>
      <div class="pl-side">
        <div class="pl-bench">
          <button class={cx('pl-swap', (swapMode || (mine && act.kind === 'switch')) && 'on')} disabled={empty || fainted || (done && !needSend)}
            title="交代" onClick={() => (mine && act.kind === 'switch' ? setAct(null) : setAct({side, mon, kind: 'switch', to: null}))}>⇄</button>
          {bench.map(i => {
            const c = condOf(battle, side, i);
            const sel = mine && act.to === i;
            const can = !c?.fainted && (swapMode || (mine && act.kind === 'move' && act.stage === 'hp' && PIVOT_MOVES.has(act.move)));
            return (
              <button class={cx('pl-bmon', c?.fainted && 'out', sel && 'on', can && 'can', side === 'opp' && !battle.pick.opp.includes(i) && 'unseen')} onClick={() => !c?.fainted && pickBench(i)} title={nameOf(battle, side, i)}>
                <Sprite id={c?.forme || buildOf(battle, side, i).species} size={40} />
                <i class="pl-bhp" style={{width: `${c?.fainted ? 0 : c?.hp ?? 100}%`}} />
              </button>
            );
          })}
        </div>
        <ActionArea side={side} mon={mon} slot={slot} battle={battle} ctx={ctx} usage={usage} act={mine ? act : null} setAct={setAct} commit={commit} needSend={needSend} done={done} pred={pred} />
      </div>
    </section>
  );
}

function MonView({side, mon, battle, ctx, mut, usage, toast, act, setAct, targeted, done, setSheet}) {
  const build = ctx.build(side, mon);
  const raw = condOf(battle, side, mon);
  const sid = currentSpecies(build, raw);
  const s = dex.species[sid];
  const opp = side === 'opp' ? battle.opp[mon] : null;
  const view = side === 'opp' ? ctx.views[mon] : null;
  const [pick, setPick] = useState(null);
  const myMax = side === 'me' ? maxHPOf(battle, mon) : null;
  const moves = side === 'me' ? (build.moves || []) : (opp.moves || []);
  const isMega = !!dex.species[raw.forme]?.mega;
  const selMove = m => {
    if (raw.fainted || done) return;
    const foes = living(battle, other(side));
    const tgt = foes.length ? {side: other(side), mon: foes[0]} : null;
    const mv = dex.moves[m];
    setAct({side, mon, kind: 'move', move: m, tgt: mv?.c === 'Z' && (mv.tg === 'self' || mv.tg === 'allySide' || mv.tg === 'all' || mv.tg === 'foeSide') ? (mv.tg === 'foeSide' ? tgt : null) : tgt, scen: 'base', crit: false, stage: 'pick', hp: null, secFx: [], inflict: STATUS_MOVE[m] || ''});
  };
  const setOpp = fn => mut(b => { fn(b.opp[mon]); if (canReplay(b)) replay(b, usage); });
  const abil = currentAbility(build, raw);
  // イリュージョン: 相手のパーティにゾロアークがいれば、化けていた可能性
  const zoro = side === 'opp' ? battle.opp.map((o, i) => ({o, i})).find(x => /^zoroark/.test(x.o.species) && x.i !== mon && !condOf(battle, 'opp', x.i)?.fainted) : null;
  const [askZoro, setAskZoro] = useState(false);
  const reveal = () => { setAskZoro(false); let n = -1; mut(b => { n = revealIllusion(b, usage, zoro.i); }); toast(n >= 0 ? `ゾロアークに付け替えました (${n}件)` : '最初の盤面が残っていないため付け替えできません'); };
  const abCands = side === 'opp' && !opp.ability && !s.mega ? (view?.abilities || []) : null;
  return (
    <>
      <div class="pl-head">
        <Sprite id={sid} size={44} />
        <button class="pl-name" onClick={() => setSheet({side, idx: mon})}>{s.j}</button>
        <span class="types">{typesOf(build, raw).map(t => <TypeChip type={t} small />)}</span>
        {raw.status && <span class="tag bad">{ST_JA[raw.status]}</span>}
        <MegaButtons battle={battle} side={side} mon={mon} mut={mut} usage={usage} />
        {raw.transformed && <span class="tag accent">へんしん中</span>}
        {zoro && !raw.transformed && <button class="btn ghost sm" onClick={() => setAskZoro(true)} title="イリュージョンの正体がゾロアークだったとき">正体は{speciesName(zoro.o.species)}</button>}
      </div>
      {askZoro && <Confirm title="イリュージョンの正体" message={`いま場にいる${speciesName(battle.opp[mon].species)}は、${speciesName(zoro.o.species)}のイリュージョンでしたか？ 化けていた間の記録を${speciesName(zoro.o.species)}に付け替えて入れ直します。${speciesName(battle.opp[mon].species)}は選出の最後のポケモンとして記録します。`} okLabel="付け替える" onOk={reveal} onClose={() => setAskZoro(false)} />}
      <div class="pl-info">
        {side === 'opp'
          ? <button class={cx('pl-dd', !opp.item && 'unk', raw.itemGone && 'gone')} onClick={() => setPick('item')}>{opp.item ? itemName(opp.item) : `持ち物 ${itemName(view?.build.item) ? `(${itemName(view.build.item)}?)` : '不明'}`} ▾</button>
          : <span class={cx('pl-dd static', raw.itemGone && 'gone')}>{itemName(build.item) || '持ち物なし'}</span>}
        {opp?.item && !raw.itemGone && consumable(opp.item) && <button class="chip sm" onClick={() => { mut(b => { addEvent(b, {kind: 'item', side, mon, item: opp.item, consumed: true}, usage); }); toast(`${itemName(opp.item)}を使った`); }}>使った</button>}
        {side === 'me' && build.item && !raw.itemGone && consumable(build.item) && <button class="chip sm" onClick={() => { mut(b => { addEvent(b, {kind: 'item', side, mon, item: build.item, consumed: true}, usage); }); toast(`${itemName(build.item)}を使った`); }}>使った</button>}
        {abCands
          ? <select class="pl-dd unk" value="" onChange={e => setOpp(o => { o.ability = e.currentTarget.value; })}>
              <option value="">特性 {abCands.map(([a, r]) => `${abilityName(a)}${r ? ` ${Math.round(r * 100)}%` : ''}`).join(' / ')}</option>
              {s.ab.map(a => <option value={a}>{abilityName(a)}</option>)}
            </select>
          : <span class="pl-dd static" onClick={() => side === 'opp' && !s.mega && setOpp(o => { o.ability = ''; })} title={side === 'opp' && !s.mega ? '押すと不明に戻す' : ''}>{abilityName(abil) || '特性なし'}</span>}
        {raw.types?.length ? <span class="tag accent">タイプ変化</span> : null}
        {raw.disguiseBroken && <span class="tag">ばけのかわ はがれた</span>}
      </div>
      <HpBar side={side} mon={mon} battle={battle} raw={raw} max={myMax} targeted={targeted} setAct={setAct} mut={mut} usage={usage} />
      <div class="pl-body">
        <div class="scroll-x">{side === 'opp' ? <OppStatTable battle={battle} idx={mon} /> : <MyStatTable build={build} raw={raw} sid={sid} />}</div>
        {side === 'opp' && <SpeedBox battle={battle} ctx={ctx} usage={usage} mon={mon} raw={raw} />}
      </div>
      <div class="pl-lower">
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
        <SideState battle={battle} side={side} raw={raw} isMega={isMega} />
      </div>
      {pick === 'item' && <Picker kind="items" title="相手の持ち物" allowClear clearLabel="不明に戻す" rank={view?.items?.length ? Object.fromEntries(view.items) : null} onClose={() => setPick(null)}
        filter={id => !dex.items[id].ms || !!dex.items[id].ms[opp.species]}
        onPick={id => { setOpp(o => { o.item = id || ''; }); setPick(null); }} />}
      {pick === 'move' && <Picker kind="moves" title="相手の技" rank={view ? Object.fromEntries(view.moves.filter(m => !m.known).map(m => [m.id, m.rate])) : null} prefer={dex.learn[opp?.species]} preferLabel="覚えない技も表示" onClose={() => setPick(null)}
        onPick={id => { setPick(null); if (id) selMove(id); }} />}
    </>
  );
}

function MyStatTable({build, raw, sid}) {
  const s = dex.species[sid];
  const st = statsOf(sid, build.sp, build.nature);
  return (
    <table class="mp-table">
      <thead><tr><th></th>{STAT_JA.map(l => <th>{l}</th>)}</tr></thead>
      <tbody>
        <tr><th>種族値</th>{s.bs.map(v => <td class="num">{v}</td>)}</tr>
        <tr class="est"><th>能力Pt</th>{build.sp.map(v => <td class="num">{v}</td>)}</tr>
        <tr><th>能力上昇</th><td></td>{BOOST_KEYS.map(k => { const v = raw.boosts?.[k] || 0; return <td class={cx('num rankv', v > 0 && 'pos', v < 0 && 'neg')}>{v > 0 ? `+${v}` : v}</td>; })}</tr>
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
    const mine = me != null ? finalSpeed({build: battle.my[me], cond: condOf(battle, 'me', me)}, {...spd, side: battle.state.sides.me}) : null;
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

function SideState({battle, side, raw, isMega}) {
  const sd = battle.state.sides[side];
  const tags = [];
  if (raw.status) tags.push(<span class="tag bad">{ST_JA[raw.status]}</span>);
  for (const [k, l] of FLAGS) if (sd[k]) tags.push(<span class="tag accent">{l}</span>);
  if (sd.spikes > 0) tags.push(<span class="tag accent">まきびし×{sd.spikes}</span>);
  if (raw.seeded) tags.push(<span class="tag">やどりぎ</span>);
  if (raw.healBlock) tags.push(<span class="tag">かいふくふうじ</span>);
  if (isMega) tags.push(<span class="tag accent">メガシンカ済み</span>);
  if (sd.megaUsed && !isMega) tags.push(<span class="tag">メガシンカ使用済み</span>);
  return (
    <div class="pl-state">
      <div class="cap">{SIDE_JA[side]}・場の状態</div>
      {tags.length ? tags : <span class="muted">なし</span>}
    </div>
  );
}

// HPバー: 予想ダメージの帯を重ね、確定後はつまんで実際の値に合わせる
function HpBar({side, mon, battle, raw, max, targeted, setAct, mut, usage}) {
  const hp = raw.fainted ? 0 : raw.hp;
  const [fix, setFix] = useState(null); // HPの直接修正
  const color = v => (v > 50 ? 'g' : v > 20 ? 'y' : 'r');
  const label = v => (max ? `${Math.round((max * v) / 100)}/${max}` : `${dispOf(v)}%`);
  const r = targeted?.r;
  const editRef = useRef(null);
  const editing = targeted && targeted.stage === 'hp';
  useEffect(() => { if (editing && editRef.current) editRef.current.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }, [editing]);
  if (editing) {
    const v = targeted.hp ?? hp;
    const toPct = x => (max ? (Number(x) / max) * 100 : Number(x));
    return (
      <div class="pl-hp edit" ref={editRef}>
        <input type="range" min={0} max={max || 100} step={1} value={max ? Math.round((max * v) / 100) : Math.round(v)} onInput={e => setAct(a => ({...a, hp: toPct(e.currentTarget.value)}))} aria-label="受けたあとのHP" />
        <input class="input num sm" type="number" inputMode="numeric" min={0} max={max || 100} value={max ? Math.round((max * v) / 100) : Math.round(v)} onInput={e => setAct(a => ({...a, hp: toPct(e.currentTarget.value)}))} />
        <b class="num">{max ? `/${max}` : '%'}</b>
        <button class="btn sm primary" onClick={() => saveRef.current?.()}>記録</button>
      </div>
    );
  }
  if (fix != null) {
    const v = fix;
    return (
      <div class="pl-hp edit">
        <input type="range" min={0} max={max || 100} value={max ? Math.round((max * v) / 100) : Math.round(v)} onInput={e => setFix(max ? (Number(e.currentTarget.value) / max) * 100 : Number(e.currentTarget.value))} aria-label="HPを直す" />
        <b class="num">{label(v)}</b>
        <button class="btn sm primary" onClick={() => { mut(b => addEvent(b, {kind: 'hp', side, mon, hpAfter: v}, usage)); setFix(null); }}>直す</button>
        <button class="btn sm ghost" onClick={() => setFix(null)}>やめる</button>
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
      <b class="num">{raw.fainted ? 'ひんし' : lo != null ? `${label(hp)} → ${max ? `${Math.round((max * lo) / 100)}〜${Math.round((max * hi) / 100)}` : `${dispOf(lo)}〜${dispOf(hi)}%`}` : label(hp)}</b>
    </div>
  );
}

// ---- 右側: 行動の入力 (予想 → 確定 → HP) ----
function ActionArea({side, mon, slot, battle, ctx, usage, act, setAct, commit, needSend, done, pred}) {
  if (needSend && (!act || act.kind !== 'send')) return <div class="pl-act hint-box">{side === 'me' ? '次に出すポケモンを上から選んでください' : '相手が出したポケモンを上から選んでください'}</div>;
  if (act?.kind === 'send') {
    return (
      <div class="pl-act">
        <p><b>{nameOf(battle, side, act.to)}</b> を場に出す</p>
        <div class="btnrow"><button class="btn ghost" onClick={() => setAct(null)}>やめる</button>
          <button class="btn primary grow" onClick={() => commit(b => addEvent(b, {kind: 'send', side, to: act.to}, usage))}>確定</button></div>
      </div>
    );
  }
  if (act?.kind === 'switch') {
    return (
      <div class="pl-act">
        <p>{act.to == null ? '交代先を上から選んでください' : <><b>{nameOf(battle, side, act.to)}</b> に交代</>}</p>
        <div class="btnrow"><button class="btn ghost" onClick={() => setAct(null)}>やめる</button>
          <button class="btn primary grow" disabled={act.to == null} onClick={() => commit(b => addAct(b, {side, mon, type: 'switch', to: act.to, sameTurn: true}, usage))}>確定</button></div>
      </div>
    );
  }
  if (act?.kind === 'move') return <MoveAction side={side} mon={mon} battle={battle} usage={usage} act={act} setAct={setAct} commit={commit} r={pred} />;
  if (mon == null) return null;
  return <div class={cx('pl-act hint-box', done && 'done')}>{done ? 'このターンは行動済み' : '技を押すとダメージの予想が出ます。交代は ⇄'}</div>;
}

function MoveAction({side, mon, battle, usage, act, setAct, commit, r}) {
  const mv = dex.moves[act.move];
  const tgt = act.tgt;
  const damaging = mv && mv.c !== 'Z';
  const foes = living(battle, other(side));
  const tgtHp = tgt ? (condOf(battle, tgt.side, tgt.mon)?.hp ?? 100) : 100;
  const mid = r?.ok && !r.status ? Math.max(0, tgtHp - (r.minPct + r.maxPct) / 2) : tgtHp;
  const set = patch => setAct(a => ({...a, ...patch}));
  const base = {side, mon, type: 'move', move: act.move, crit: act.crit, sameTurn: true, target: battle.format === 'double' ? tgt : null};
  const record = extra => commit(b => addAct(b, {...base, ...extra}, usage));
  const fail = k => record({[k]: true});
  // 確定: ダメージ技はHPを合わせる段階へ、変化技はそのまま記録
  const confirm = () => {
    if (!damaging || !tgt) { record({inflict: act.inflict || '', to: PIVOT_MOVES.has(act.move) ? act.to : null}); return; }
    set({stage: 'hp', hp: mid});
  };
  const tb = tgt ? buildOf(battle, tgt.side, tgt.mon) : null, tc = tgt ? condOf(battle, tgt.side, tgt.mon) : null;
  const tItem = tc && !tc.itemGone ? tb.item : '';
  const save = () => {
    const hp = Math.max(0, Math.min(100, act.hp ?? mid));
    const extra = {hpAfter: hp, secFx: act.secFx.length ? act.secFx : undefined, inflict: act.inflict || '', selfFx: sureSelfFx(battle, side, mon, tgt, act.move), exact: tgt.side === 'me'};
    if (act.defItem) extra.defItem = {item: act.defItem, consumed: consumable(act.defItem)};
    if (act.defItem === 'focussash') { extra.endured = true; delete extra.hpAfter; }
    if (PIVOT_MOVES.has(act.move)) extra.to = act.to;
    if (FORCE_MOVES.has(act.move)) extra.forceTo = act.forceTo;
    record(extra);
  };
  const fbench = FORCE_MOVES.has(act.move) && tgt ? benchOf(battle, tgt.side).filter(i => !condOf(battle, tgt.side, i)?.fainted) : [];
  // とんぼがえり等で交代先、ドラゴンテール等で出てきたポケモンが必要なら、選ぶまで記録しない
  const pivotBench = PIVOT_MOVES.has(act.move) ? benchOf(battle, side).filter(i => !condOf(battle, side, i)?.fainted) : [];
  const willFaint = (act.hp ?? mid) <= 0;
  const needTo = pivotBench.length > 0 && act.to == null;
  const needForce = FORCE_MOVES.has(act.move) && !willFaint && fbench.length > 0 && act.forceTo == null;
  const blocked = act.stage === 'hp' && (needTo || needForce);
  saveRef.current = act.stage === 'hp' && !blocked ? save : null;
  const sec = (mv?.sec || []).flatMap(e => {
    const out = [];
    if (e.st) for (const st of [].concat(e.st)) out.push({e: {st}, label: STATUS_OPTS.find(x => x[0] === st)?.[1] || st});
    if (e.bo) out.push({e: {bo: e.bo}, label: `相手の${Object.entries(e.bo).map(([k, v]) => `${k.toUpperCase()}${v > 0 ? '+' : ''}${v}`).join(' ')}`});
    if (e.sb) out.push({e: {sb: e.sb}, label: `自分の${Object.entries(e.sb).map(([k, v]) => `${k.toUpperCase()}${v > 0 ? '+' : ''}${v}`).join(' ')}`});
    if (e.vo === 'flinch') out.push({e: {vo: 'flinch'}, label: 'ひるみ'});
    return out;
  });
  const secOn = x => act.secFx.some(y => JSON.stringify(y) === JSON.stringify(x.e));
  const scenLabels = side === 'me' ? [['base', '想定'], ['min', '耐久無振り'], ['max', '耐久全振り']] : [['base', '想定'], ['min', '火力無振り'], ['max', '火力全振り']];
  return (
    <div class="pl-act move">
      <div class="pa-h"><span class={cx('mv-bar inline', `t-${mv?.t}`)} /><b>{moveName(act.move)}</b>
        {battle.format === 'double' && foes.length > 1 && <span class="chips">{foes.map(i => <button class={cx('chip sm', tgt?.mon === i && 'on')} onClick={() => set({tgt: {side: other(side), mon: i}})}>{nameOf(battle, other(side), i)}</button>)}</span>}
      </div>
      {act.stage === 'pick' && <>
        {damaging && tgt && <>
          {battle.opp.length > 0 && <Seg small value={act.scen} options={scenLabels} onChange={v => set({scen: v})} />}
          <div class="pa-dmg">
            {!r?.ok ? <span class="muted">計算できません</span> : r.immune ? <b>効果なし</b> : <><b class="num">{fmtPct(r.minPct)}〜{fmtPct(r.maxPct)}%</b> <span class="muted">{r.koText}</span></>}
          </div>
        </>}
        {!damaging && <p class="muted">変化技{act.inflict ? ` (${STATUS_OPTS.find(x => x[0] === act.inflict)?.[1]})` : ''}</p>}
        <div class="chips">
          {damaging && <Toggle small on={act.crit} onChange={v => set({crit: v})}>急所</Toggle>}
          <button class="chip sm" onClick={() => fail('miss')}>外れた</button>
          <button class="chip sm" onClick={() => fail('protect')}>まもられた</button>
          <button class="chip sm" onClick={() => fail('cant')}>行動できず</button>
        </div>
        {!damaging && PIVOT_MOVES.has(act.move) && <p class="hint">交代先は上のアイコンで選べます{act.to != null ? ` (${nameOf(battle, side, act.to)})` : ''}</p>}
        <div class="btnrow"><button class="btn ghost" onClick={() => setAct(null)}>やめる</button><button class="btn primary grow" disabled={!damaging && needTo} onClick={confirm}>確定</button></div>
      </>}
      {act.stage === 'hp' && <>
        <p class="hint">{tgt.side === 'me' ? '自分' : '相手'}のHPバーを、実際の値に合わせてください。</p>
        {sec.length > 0 && <div class="chips"><span class="muted">追加効果:</span>{sec.map(x => <button class={cx('chip sm', secOn(x) && 'on')} onClick={() => set({secFx: secOn(x) ? act.secFx.filter(y => JSON.stringify(y) !== JSON.stringify(x.e)) : [...act.secFx, x.e]})}>{x.label}</button>)}</div>}
        {tItem && consumable(tItem) && <div class="chips"><button class={cx('chip sm', act.defItem === tItem && 'on')} onClick={() => set({defItem: act.defItem === tItem ? '' : tItem})}>{itemName(tItem)}が発動</button></div>}
        {tgt.side === 'opp' && !tb.item && <div class="chips"><span class="muted">発動:</span>{['focussash', 'sitrusberry'].map(it => <button class={cx('chip sm', act.defItem === it && 'on')} onClick={() => set({defItem: act.defItem === it ? '' : it})}>{itemName(it)}</button>)}</div>}
        {PIVOT_MOVES.has(act.move) && <p class="hint">交代先は上のアイコンで選べます{act.to != null ? ` (${nameOf(battle, side, act.to)})` : ''}</p>}
        {fbench.length > 0 && <div class="chips"><span class="muted">引きずり出された:</span>{fbench.map(i => <button class={cx('chip sm', act.forceTo === i && 'on')} onClick={() => set({forceTo: act.forceTo === i ? null : i})}>{nameOf(battle, tgt.side, i)}</button>)}</div>}
        {blocked && <p class="hint warn">{needTo ? '交代先を上のアイコンから選んでください' : '引きずり出されたポケモンを選んでください'}</p>}
        <div class="btnrow"><button class="btn ghost" onClick={() => set({stage: 'pick'})}>戻る</button><button class="btn primary grow" disabled={blocked} onClick={save}>記録</button></div>
      </>}
    </div>
  );
}

// ---- ターン終了 (右下) ----
export function TurnBar({battle, ctx, mut, usage, toast}) {
  const t = openTurn(battle);
  const doneMe = sideDone(battle, 'me'), doneOpp = sideDone(battle, 'opp');
  const cands = useMemo(() => (t ? residualCandidates(battle, usage) : []), [battle]);
  const expiries = useMemo(() => (t ? expiryCandidates(battle) : []), [battle]);
  const [maybe, setMaybe] = useState({});
  const [exp, setExp] = useState({});
  const [ev, setEv] = useState(false);
  const [keep, setKeep] = useState(false);
  const lostSide = ['opp', 'me'].find(side => faintedCount(battle, side) >= pickCount(battle.format));
  const sure = cands.filter(c => c.checked);
  const unsure = cands.filter(c => !c.checked);
  const keyOf = c => `${c.side}${c.mon}${c.key}`;
  const end = () => {
    let log = [];
    mut(b => { log = finishTurn(b, usage, {residual: [...sure, ...unsure.filter(c => maybe[keyOf(c)])], expiry: expiries.filter(x => exp[x.key] != null).map(x => ({key: x.key, ended: exp[x.key], n: x.n}))}) || []; });
    setMaybe({}); setExp({});
    toast(log.length ? log[log.length - 1] : 'ターンを終えました');
  };
  const undo = () => {
    const ti = battle.turns.length - 1;
    const tt = battle.turns[ti];
    if (!tt?.acts.length) return;
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
        <span class={cx('tb-side me', doneMe && 'ok')}>自分 {doneMe ? '✓' : '…'}</span>
        <span class={cx('tb-side opp', doneOpp && 'ok')}>相手 {doneOpp ? '✓' : '…'}</span>
        {lastActs > 0 && <button class="btn ghost sm" onClick={undo}>1つ戻す</button>}
        <button class="btn ghost sm" onClick={() => setEv(true)}>その他の変化…</button>
      </div>
      {sure.length > 0 && <div class="tb-auto">ターン終了時: {sure.map(c => `${SIDE_JA[c.side]}${c.label}`).join('・')}</div>}
      {unsure.length > 0 && <div class="chips tb-maybe"><span class="muted">起きた?</span>{unsure.map(c => <button class={cx('chip sm', maybe[keyOf(c)] && 'on')} onClick={() => setMaybe({...maybe, [keyOf(c)]: !maybe[keyOf(c)]})}>{SIDE_JA[c.side]} {c.label}</button>)}</div>}
      {expiries.map(x => (
        <div class="tb-exp"><span>{x.label} 終わった?</span><Seg small value={exp[x.key] == null ? '' : exp[x.key] ? 'y' : 'n'} options={[['', '—'], ['y', '終わった'], ['n', '続く']]} onChange={v => setExp({...exp, [x.key]: v === '' ? null : v === 'y'})} /></div>
      ))}
      <button class="btn primary tb-end" disabled={!t || !doneMe || !doneOpp} onClick={end}>ターン終了</button>
      {ev && <Sheet title="その他の変化" onClose={() => setEv(false)} wide><EventForm battle={battle} mut={mut} usage={usage} toast={m => { toast(m); setEv(false); }} /></Sheet>}
    </div>
  );
}
