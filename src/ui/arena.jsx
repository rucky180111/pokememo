// 対戦フェーズ: 左 = 時系列とターン入力 / 中央 = 相手と自分の盤面 / 右 = ダメージ表・統計
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf, STAT_JA, STAT_KEYS} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies, currentAbility, finalSpeed} from '../engine/calc.js';
import {sendOut, megaEvolve, megaTarget, setHP, setWeather, setTerrain, setSideFlag, setFieldFlag, undoTurn, buildOf, condOf, other, turnNumber} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {speedOutlook} from '../engine/assume.js';
import {addAct, endTurn, openTurn, actLine} from '../engine/flow.js';
import {estimateStats, scenarioBuild} from '../engine/estimate.js';
import {Picker, Seg, Toggle, TypeChip, Empty, cx, fmtPct, rate} from './common.jsx';
import {OppSheet, dmgClass} from './battle.jsx';
import {MonEditor} from './teams.jsx';
import {HPControl, DmgBar} from './board.jsx';
import {PredictTab} from './analysis.jsx';

const SIDE_JA = {me: '自分', opp: '相手'};
const FLAGS = [['reflect', 'リフレクター'], ['lightScreen', 'ひかりのかべ'], ['auroraVeil', 'オーロラベール'], ['tailwind', 'おいかぜ'], ['sr', 'ステルスロック']];
const alive = (battle, side) => battle.state.sides[side].active.filter(i => i != null && !condOf(battle, side, i)?.fainted);

export function Arena({battle, ctx, mut, usage, toast, wide}) {
  const [pane, setPane] = useState('center');
  const [sheet, setSheet] = useState(null);
  const p = {battle, ctx, mut, usage, toast, setSheet};
  return (
    <div class={cx('arena', wide && 'wide')}>
      {!wide && <div class="arena-tabs"><Seg value={pane} options={[['left', '入力・時系列'], ['center', '盤面'], ['right', 'ダメージ表']]} onChange={setPane} /></div>}
      {(wide || pane === 'left') && <Timeline {...p} />}
      {(wide || pane === 'center') && (
        <div class="ar-center">
          <SidePanels side="opp" {...p} />
          <FieldRow battle={battle} mut={mut} />
          <SidePanels side="me" {...p} />
        </div>
      )}
      {(wide || pane === 'right') && <RightPane {...p} />}
      {sheet && sheet.side === 'opp' && battle.opp[sheet.idx] && <OppSheet battle={battle} idx={sheet.idx} ctx={ctx} mut={mut} usage={usage} onClose={() => setSheet(null)} />}
      {sheet && sheet.side === 'me' && battle.my[sheet.idx] && (
        <MonEditor title="この対戦での自分の型" usage={usage} build={battle.my[sheet.idx]}
          onSave={bd => { mut(b => { b.my[sheet.idx] = bd; }); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

// ---- 左: 時系列とターン入力 ----
function Timeline({battle, ctx, mut, usage, toast}) {
  const [side, setSide] = useState('opp');
  const [act, setAct] = useState(null); // {type, move, to}
  const [hp, setHp] = useState('');
  const [flags, setFlags] = useState({});
  const [actor, setActor] = useState(null);
  const [target, setTarget] = useState(null);
  const [pick, setPick] = useState(false);
  const act0 = alive(battle, side);
  const mon = actor != null && act0.includes(actor) ? actor : act0[0];
  const foes = alive(battle, other(side));
  const double = battle.format === 'double';
  const sd = battle.state.sides[side];
  const list = side === 'me' ? battle.my : battle.opp;
  const bench = list.map((_, i) => i).filter(i => !sd.active.includes(i) && !condOf(battle, side, i)?.fainted && (side === 'opp' || !battle.pick.me.length || battle.pick.me.includes(i)));
  const emptySlot = sd.active.findIndex(x => x == null || condOf(battle, side, x)?.fainted);
  const moves = mon == null ? [] : side === 'me' ? (battle.my[mon].moves || []).map(id => ({id, known: true})) : (ctx.views[mon]?.moves || []).slice(0, 10);
  const mv = act?.type === 'move' ? dex.moves[act.move] : null;
  const tgt = target && foes.includes(target.mon) ? target : foes.length ? {side: other(side), mon: foes[0]} : null;
  const needHP = mv && mv.c !== 'Z' && tgt;
  const canMega = mon != null && megaTarget(battle, side, mon) && !sd.megaUsed && !dex.species[condOf(battle, side, mon).forme]?.mega;
  const reset = () => { setAct(null); setHp(''); setFlags({}); setTarget(null); };
  const add = () => {
    if (!act) { toast('技か交代先を選んでください'); return; }
    const log = mut(b => addAct(b, {side, mon, ...act, mega: !!flags.mega, crit: !!flags.crit, miss: !!flags.miss, protect: !!flags.protect,
      target: double ? tgt : null, hpAfter: needHP && hp !== '' && !flags.miss && !flags.protect ? Number(hp) : null}, usage));
    if (log?.length) toast(log[log.length - 1]);
    reset();
    setSide(other(side));
  };
  const send = i => { mut(b => { sendOut(b, side, emptySlot, i, {resolveAbility: ctx.strictAbility}); }); };
  const open = openTurn(battle);
  return (
    <div class="ar-left">
      <h3>時系列</h3>
      <div class="tl">
        {!battle.turns.length && <p class="muted">下の入力欄から、動いた順に1つずつ追加します。追加した順が行動順として扱われ、相手の素早さの絞り込みに使われます。</p>}
        {battle.turns.map(t => (
          <div class="tl-turn" key={t.n}>
            <div class="tl-n">— ターン {t.n} —</div>
            {t.acts.map(a => (
              <div class={cx('tl-act', a.side)}>
                <span class="tl-who">{SIDE_JA[a.side]}{double ? ` ${speciesName(a.sp)}` : ''}</span>
                <span class="tl-body">{actLine(battle, a)}</span>
                {(a.auto || []).map(x => <span class="tl-auto">{x}</span>)}
              </div>
            ))}
            {(t.auto || []).filter(x => !t.acts.some(a => (a.auto || []).includes(x))).map(x => <div class="tl-auto">{x}</div>)}
          </div>
        ))}
      </div>
      <div class="composer">
        <div class="cp-head">
          <strong>ターン {open ? open.n : battle.turns.length + 1} の入力</strong>
          <Seg small value={side} options={[['opp', '相手'], ['me', '自分']]} onChange={v => { setSide(v); reset(); setActor(null); }} />
        </div>
        {emptySlot >= 0 && bench.length > 0 && (
          <div class="chips"><span class="muted">{SIDE_JA[side]}が場に出す:</span>
            {bench.map(i => <button class="chip add" onClick={() => send(i)}>{speciesName(list[i].species)}</button>)}
          </div>
        )}
        {mon != null && <>
          {act0.length > 1 && <div class="chips"><span class="muted">行動:</span>{act0.map(i => <button class={cx('chip', mon === i && 'on')} onClick={() => { setActor(i); reset(); }}>{speciesName(list[i].species)}</button>)}</div>}
          <div class="chips">
            {moves.map(m => (
              <button class={cx('chip', act?.move === m.id && 'on', !m.known && 'ghost')} onClick={() => setAct({type: 'move', move: m.id})}>
                {moveName(m.id)}{!m.known && m.rate != null ? <span class="rate">{(m.rate * 100).toFixed(0)}%</span> : null}
              </button>
            ))}
            <button class="chip add" onClick={() => setPick(true)}>ほかの技…</button>
          </div>
          {bench.length > 0 && emptySlot < 0 && (
            <div class="chips"><span class="muted">交代:</span>
              {bench.map(i => <button class={cx('chip', act?.type === 'switch' && act.to === i && 'on')} onClick={() => setAct({type: 'switch', to: i})}>{speciesName(list[i].species)}</button>)}
            </div>
          )}
          {act?.type === 'move' && (
            <div class="chips">
              {double && foes.length > 1 && mv && !mv.sp && foes.map(i => <button class={cx('chip', tgt?.mon === i && 'on')} onClick={() => setTarget({side: other(side), mon: i})}>→ {speciesName(buildOf(battle, other(side), i).species)}</button>)}
              {needHP && (
                <label class="cp-hp">{speciesName(buildOf(battle, tgt.side, tgt.mon).species)}の残りHP
                  <input class="input sm num" type="number" inputMode="decimal" min={0} max={100} value={hp} placeholder={`${Math.round(condOf(battle, tgt.side, tgt.mon).hp)}`} onInput={e => setHp(e.currentTarget.value)} />%
                </label>
              )}
              {[['crit', '急所'], ['miss', '外れ'], ['protect', 'まもる']].map(([k, l]) => <Toggle small on={!!flags[k]} onChange={v => setFlags({...flags, [k]: v})}>{l}</Toggle>)}
              {canMega && <Toggle small on={!!flags.mega} onChange={v => setFlags({...flags, mega: v})}>メガシンカ</Toggle>}
            </div>
          )}
        </>}
        {mon == null && emptySlot < 0 && <p class="muted">場にポケモンがいません。</p>}
        <div class="btnrow">
          <button class="btn primary grow" onClick={add} disabled={!act}>追加</button>
          <button class="btn" disabled={!open} onClick={() => { mut(b => { endTurn(b, usage); }); }}>ターン終了</button>
          <button class="btn" disabled={!battle.turns.length || !battle.turns[battle.turns.length - 1].before} onClick={() => { mut(b => { undoTurn(b); }); toast('直前のターンを取り消しました'); }}>戻す</button>
        </div>
      </div>
      {pick && mon != null && <Picker kind="moves" title="使った技" onClose={() => setPick(false)} prefer={dex.learn[list[mon].species]} preferLabel="覚えない技も表示"
        onPick={id => { setAct({type: 'move', move: id}); setPick(false); }} />}
    </div>
  );
}

// ---- 中央: 盤面 ----
function FieldRow({battle, mut}) {
  const f = battle.state.field;
  return (
    <div class="ar-field">
      <label>天候 <select class="input sm" value={f.weather} onChange={e => mut(b => { setWeather(b, e.currentTarget.value); })}>{WEATHERS.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>
      <label>フィールド <select class="input sm" value={f.terrain} onChange={e => mut(b => { setTerrain(b, e.currentTarget.value); })}>{TERRAINS.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>
      <Toggle small on={f.trickRoom} onChange={v => mut(b => { setFieldFlag(b, 'trickRoom', v); })}>トリックルーム</Toggle>
      <Toggle small on={f.gravity} onChange={v => mut(b => { setFieldFlag(b, 'gravity', v); })}>じゅうりょく</Toggle>
      <span class="tag">ターン {turnNumber(battle)}</span>
    </div>
  );
}

function SidePanels({side, battle, ...rest}) {
  const act = battle.state.sides[side].active.filter(i => i != null);
  if (!act.length) return <div class={cx('mon-panel', side, 'empty')}><Empty>{side === 'opp' ? '相手のポケモンが場にいません。左の入力欄の「相手が場に出す」から選んでください。' : '自分のポケモンが場にいません。左の入力欄を「自分」にして出してください。'}</Empty></div>;
  return <>{act.map(i => <MonPanel key={`${side}${i}`} side={side} idx={i} battle={battle} {...rest} />)}</>;
}

function MonPanel({side, idx, battle, ctx, mut, usage, setSheet}) {
  const [pickItem, setPickItem] = useState(false);
  const [pickMove, setPickMove] = useState(false);
  const build = ctx.build(side, idx);
  const raw = condOf(battle, side, idx);
  const cond = ctx.cond(side, idx);
  const sid = currentSpecies(build, cond);
  const s = dex.species[sid];
  const view = side === 'opp' ? ctx.views[idx] : null;
  const opp = side === 'opp' ? battle.opp[idx] : null;
  const sd = battle.state.sides[side];
  const set = fn => mut(b => fn(condOf(b, side, idx), b));
  const est = useMemo(() => (opp ? estimateStats(opp, sid) : null), [opp, sid]);
  const myStats = side === 'me' ? statsOf(sid, build.sp, build.nature) : null;
  const maxHP = myStats ? myStats[0] : null;
  const spdCtx = {format: battle.format, field: battle.state.field};
  // 素早さの一覧 (下降 → 最速)。相手はスカーフの有無で2系統
  const speeds = useMemo(() => {
    const myIdx = alive(battle, 'me')[0];
    const mine = myIdx != null ? finalSpeed({build: battle.my[myIdx], cond: battle.state.mons.me[myIdx]}, {...spdCtx, side: battle.state.sides.me}) : null;
    if (side === 'me') return {mine: finalSpeed({build, cond: raw}, {...spdCtx, side: sd}), rows: []};
    const o = speedOutlook(opp, view, raw, usage, mine, {...spdCtx, side: sd});
    const rows = [];
    for (const b of o.bench) {
      rows.push({label: b.label, v: b.eff, ok: b.ok});
      if (o.canScarf) rows.push({label: `${b.label}+スカーフ`, v: b.scarfEff, ok: b.okScarf, scarf: true});
    }
    if (mine != null) rows.push({label: '自分', v: mine, ok: true, mine: true});
    rows.sort((a, b) => b.v - a.v || (a.mine ? 1 : -1));
    return {mine, rows, o};
  }, [ctx]);
  const megaOptions = side === 'me' ? [megaTarget(battle, side, idx)].filter(Boolean) : (opp.item ? [megaTarget(battle, side, idx)].filter(Boolean) : (dex.species[build.species].megas || []));
  const isMega = !!dex.species[raw.forme]?.mega;
  const moves = side === 'me' ? (build.moves || []) : (opp.moves || []);
  const fmtSp = r => (r.spLo === r.spHi ? `${r.spLo}` : `${r.spLo}〜${r.spHi}`);
  const fmtVal = r => (r.valLo === r.valHi ? `${r.valLo}` : `${r.valLo}〜${r.valHi}`);
  const tr = battle.state.field.trickRoom;
  return (
    <section class={cx('mon-panel', side, raw.fainted && 'fainted')}>
      <div class="mp-head">
        <span class={cx('side-tag', side)}>{SIDE_JA[side]}</span>
        <button class="mp-name" onClick={() => setSheet({side, idx})}>{s.j}</button>
        <span class="types">{s.t.map(t => <TypeChip type={t} />)}</span>
        {side === 'opp'
          ? <button class="input sm as-btn mp-item" onClick={() => setPickItem(true)}>{opp.item ? itemName(opp.item) : `${itemName(view?.build.item) || '持ち物'}?`} ▾</button>
          : <span class={cx('mp-item-txt', raw.itemGone && 'strike')}>{itemName(build.item) || '持ち物なし'}</span>}
        <span class="muted mp-ab">{abilityName(currentAbility(build, cond))}{side === 'opp' && view?.abilityGuess && !s.mega ? '?' : ''}</span>
      </div>
      <HPControl hp={raw.hp} maxHP={maxHP} onSet={v => mut(b => { setHP(b, side, idx, v); })} />
      <div class="mp-body">
        <table class="mp-table">
          <thead><tr><th></th>{STAT_JA.map(l => <th>{l}</th>)}</tr></thead>
          <tbody>
            <tr><th>種族値</th>{s.bs.map(v => <td class="num">{v}</td>)}</tr>
            <tr class="est"><th>{side === 'opp' ? '推定能力Pt' : '能力Pt'}</th>
              {side === 'opp' ? est.rows.map(r => <td class={cx('num', r.known && 'known')}>{fmtSp(r)}</td>) : build.sp.map(v => <td class="num">{v}</td>)}
            </tr>
            <tr><th>能力上昇</th><td></td>
              {BOOST_KEYS.map(k => {
                const v = raw.boosts[k] || 0;
                return (
                  <td class="rank">
                    <button onClick={() => set(c => { c.boosts[k] = Math.min(6, v + 1); })} aria-label={`${k} を上げる`}>＋</button>
                    <b class={cx('num', v > 0 && 'pos', v < 0 && 'neg')}>{v > 0 ? `+${v}` : v}</b>
                    <button onClick={() => set(c => { c.boosts[k] = Math.max(-6, v - 1); })} aria-label={`${k} を下げる`}>−</button>
                  </td>
                );
              })}
            </tr>
            <tr class="real"><th>実数値</th>
              {side === 'opp' ? est.rows.map(r => <td class={cx('num', r.known && 'known')}>{fmtVal(r)}</td>) : myStats.map(v => <td class="num">{v}</td>)}
            </tr>
          </tbody>
        </table>
        <div class="mp-speed">
          <div class="cap">素早さ{tr ? ' (トリル中)' : ''}</div>
          {side === 'me' ? <div class="spd-me num">{speeds.mine}</div> : (
            <ol>
              {speeds.rows.map(r => <li class={cx('num', r.mine && 'mine', !r.ok && 'ruled', r.scarf && 'scarf', !r.mine && speeds.mine != null && (r.v > speeds.mine ? 'fast' : r.v < speeds.mine ? 'slow' : 'tie'))}><span>{r.label}</span><b>{r.v}</b></li>)}
            </ol>
          )}
        </div>
      </div>
      {side === 'opp' && <p class="hint mp-remain">未確定の残り能力Pt: <b class="num">{est.remain}</b> / 66{speeds.o?.pFaster != null ? ` ・ 先手率 自分 ${rate(speeds.o.pSlower)}` : ''}</p>}
      <div class="mp-lower">
        <div class="mp-moves">
          {[0, 1, 2, 3].map(i => {
            const m = moves[i];
            if (m) return <span class="mv-box"><TypeChip type={dex.moves[m]?.t} small />{moveName(m)}</span>;
            return side === 'opp' ? <button class="mv-box empty" onClick={() => setPickMove(true)}>＋ わざ</button> : <span class="mv-box empty">—</span>;
          })}
        </div>
        <div class="mp-state">
          <div class="cap">場の状態</div>
          <select class="input sm" value={raw.status} aria-label="状態異常" onChange={e => set(c => { c.status = e.currentTarget.value; c.toxicCounter = 1; })}>
            {STATUSES.map(([v, l]) => <option value={v}>{v ? l : '状態異常なし'}</option>)}
          </select>
          {megaOptions.length > 0 && (isMega || !sd.megaUsed) && megaOptions.map(m => (
            <Toggle small on={raw.forme === m} onChange={v => mut(b => { const c = condOf(b, side, idx); if (v) megaEvolve(b, side, idx, m, {resolveAbility: ctx.strictAbility}); else { c.forme = null; b.state.sides[side].megaUsed = false; } })}>{megaOptions.length > 1 ? speciesName(m) : 'メガシンカ'}</Toggle>
          ))}
          <Toggle small on={raw.itemGone} onChange={v => set(c => { c.itemGone = v; })}>持ち物なし</Toggle>
          {FLAGS.map(([k, l]) => <Toggle small on={sd[k]} onChange={v => mut(b => { setSideFlag(b, side, k, v); })}>{l}</Toggle>)}
        </div>
      </div>
      {pickItem && <Picker kind="items" title="相手の持ち物" allowClear clearLabel="不明に戻す" rank={view?.items?.length ? Object.fromEntries(view.items) : null} onClose={() => setPickItem(false)}
        filter={id => !dex.items[id].ms || !!dex.items[id].ms[opp.species]} onPick={id => { mut(b => { b.opp[idx].item = id; }); setPickItem(false); }} />}
      {pickMove && <Picker kind="moves" title="判明した技" prefer={dex.learn[opp.species]} preferLabel="覚えない技も表示" rank={view ? Object.fromEntries(view.moves.filter(m => !m.known).map(m => [m.id, m.rate])) : null} onClose={() => setPickMove(false)}
        onPick={id => { mut(b => { const o = b.opp[idx]; if (!o.moves.includes(id) && o.moves.length < 4) o.moves.push(id); }); setPickMove(false); }} />}
    </section>
  );
}

// ---- 右: ダメージ表・統計 ----
function RightPane(props) {
  const [tab, setTab] = useState('dmg');
  return (
    <div class="ar-right">
      <Seg value={tab} options={[['dmg', 'ダメージ表'], ['stat', '統計']]} onChange={setTab} />
      {tab === 'dmg' ? <DamagePane {...props} /> : <PredictTab battle={props.battle} ctx={props.ctx} />}
    </div>
  );
}

function DamagePane({battle, ctx}) {
  const [oSel, setOSel] = useState(null);
  const [mSel, setMSel] = useState(null);
  const [crit, setCrit] = useState(false);
  const livingOpp = battle.opp.map((_, i) => i).filter(i => !condOf(battle, 'opp', i)?.fainted);
  const livingMe = battle.my.map((_, i) => i).filter(i => !condOf(battle, 'me', i)?.fainted && (!battle.pick.me.length || battle.pick.me.includes(i)));
  const oi = oSel != null && livingOpp.includes(oSel) ? oSel : alive(battle, 'opp')[0] ?? livingOpp[0];
  const mi = mSel != null && livingMe.includes(mSel) ? mSel : alive(battle, 'me')[0] ?? livingMe[0];
  const data = useMemo(() => {
    if (oi == null || mi == null) return null;
    const opp = battle.opp[oi];
    const base = ctx.build('opp', oi);
    const sid = currentSpecies(base, ctx.cond('opp', oi));
    const alt = (kind, cat) => ({...ctx, build: (side, i) => (side === 'opp' && i === oi ? scenarioBuild(opp, base, sid, kind, cat) : ctx.build(side, i))});
    const one = (c, side, idx, def, move) => attackTable(c, side, idx, {crit, only: {def, move}})?.targets[0]?.results[move];
    const give = (battle.my[mi].moves || []).filter(m => dex.moves[m]).map(m => {
      const cat = dex.moves[m].c;
      return {id: m, lo: one(alt('bulkMax', cat), 'me', mi, oi, m), hi: one(alt('bulkMin', cat), 'me', mi, oi, m)};
    });
    const cand = attackTable(ctx, 'opp', oi, {crit, only: {def: mi}})?.moves || [];
    const take = cand.map(m => {
      const cat = dex.moves[m.id].c;
      return {...m, lo: one(alt('powMin', cat), 'opp', oi, mi, m.id), hi: one(alt('powMax', cat), 'opp', oi, mi, m.id)};
    });
    return {give, take};
  }, [ctx, oi, mi, crit]);
  if (!data) return <Empty>自分と相手のポケモンを登録すると表示されます。</Empty>;
  const oHP = ctx.cond('opp', oi).hp, mHP = ctx.cond('me', mi).hp;
  const txt = r => (!r?.ok ? '—' : r.status ? '変化' : r.immune ? '無効' : `${fmtPct(r.minPct)}–${fmtPct(r.maxPct)}%`);
  const row = (label, r, hp) => (
    <div class="dp-bar">
      <span class="dp-lb">{label}</span>
      <DmgBar r={r} hp={hp} />
      <span class={cx('dp-val num', dmgClass(r))}>{txt(r)}</span>
      <span class="dp-ko">{r?.ok && !r.status && !r.immune ? r.koText : ''}</span>
    </div>
  );
  return (
    <div class="dp">
      <div class="dp-sel">
        <label>相手 <select class="input sm" value={oi} onChange={e => setOSel(Number(e.currentTarget.value))}>{livingOpp.map(i => <option value={i}>{speciesName(battle.opp[i].species)}{battle.state.sides.opp.active.includes(i) ? ' (場)' : ''}</option>)}</select></label>
        <label>自分 <select class="input sm" value={mi} onChange={e => setMSel(Number(e.currentTarget.value))}>{livingMe.map(i => <option value={i}>{speciesName(battle.my[i].species)}{battle.state.sides.me.active.includes(i) ? ' (場)' : ''}</option>)}</select></label>
        <Toggle small on={crit} onChange={setCrit}>急所</Toggle>
      </div>
      <h4 class="me">自分 → 相手 <span class="muted">残り{Math.round(oHP)}%</span></h4>
      {data.give.map(m => (
        <div class="dp-move">
          <div class="dp-name"><TypeChip type={dex.moves[m.id].t} small />{moveName(m.id)}</div>
          {dex.moves[m.id].c === 'Z' ? <div class="muted dp-bar">変化技</div> : <>
            {row('耐久無振り', m.hi, oHP)}
            {row('耐久全振り', m.lo, oHP)}
          </>}
        </div>
      ))}
      {!data.give.length && <p class="muted">技が登録されていません。</p>}
      <h4 class="opp">相手 → 自分 <span class="muted">残り{Math.round(mHP)}%</span></h4>
      {data.take.map(m => (
        <div class="dp-move">
          <div class="dp-name"><TypeChip type={dex.moves[m.id].t} small />{moveName(m.id)}{m.known ? <span class="tag sm">確定</span> : <span class="rate"> {rate(m.rate)}</span>}</div>
          {dex.moves[m.id].c === 'Z' ? <div class="muted dp-bar">変化技</div> : <>
            {row('火力無振り', m.lo, mHP)}
            {row('火力全振り', m.hi, mHP)}
          </>}
        </div>
      ))}
      {!data.take.length && <p class="muted">相手の技候補がありません。</p>}
      <p class="hint">「無振り」は確定している最小の配分、「全振り」は未確定の残り能力Ptをその能力 (耐久はHPと防御/特防) に回して補正もかけた場合です。相手の持ち物・特性は盤面の内容で計算します。</p>
    </div>
  );
}
