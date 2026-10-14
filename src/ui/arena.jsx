// 対戦フェーズ: 左 = 時系列とターン入力 / 中央 = 相手と自分の盤面 / 右 = ダメージ表・統計
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf, STAT_JA, STAT_KEYS} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies, currentAbility, finalSpeed} from '../engine/calc.js';
import {condOf, turnNumber} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {speedOutlook} from '../engine/assume.js';
import {estimateStats, scenarioBuild} from '../engine/estimate.js';
import {Seg, Toggle, TypeChip, Sprite, Empty, Confirm, cx, fmtPct, rate} from './common.jsx';
import {OppSheet, dmgClass, LogTab} from './battle.jsx';
import {MonEditor} from './teams.jsx';
import {DmgBar} from './board.jsx';
import {revealIllusion} from '../engine/flow.js';
import {PredictTab} from './analysis.jsx';
import {Timeline, MegaButtons} from './turn.jsx';
import {dispOf} from '../engine/flow.js';

const SIDE_JA = {me: '自分', opp: '相手'};
const FLAGS = [['reflect', 'リフレクター'], ['lightScreen', 'ひかりのかべ'], ['auroraVeil', 'オーロラベール'], ['tailwind', 'おいかぜ'], ['sr', 'ステルスロック']];
const alive = (battle, side) => battle.state.sides[side].active.filter(i => i != null && !condOf(battle, side, i)?.fainted);

export function Arena({battle, ctx, mut, usage, toast, wide, onDelete}) {
  const [pane, setPane] = useState('center');
  const [sheet, setSheet] = useState(null);
  const p = {battle, ctx, mut, usage, toast, setSheet, onDelete};
  return (
    <div class={cx('arena', wide && 'wide')}>
      {!wide && <div class="arena-tabs"><Seg value={pane} options={[['left', 'ターン入力'], ['center', '盤面'], ['right', 'ダメージ・傾向']]} onChange={setPane} /></div>}
      {(wide || pane === 'left') && <Timeline {...p} />}
      {(wide || pane === 'center') && (
        <div class="ar-center">
          <PartyStrip battle={battle} onOpen={i => setSheet({side: 'opp', idx: i})} />
          <SidePanels side="opp" {...p} />
          <FieldRow battle={battle} />
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

// ---- 中央: 盤面 ----
// 相手のパーティ6体。まだ出てきていないポケモンは暗く、場に出て選出が分かったら明るくする
function PartyStrip({battle, onOpen}) {
  if (!battle.opp.length) return null;
  const seen = battle.pick.opp || [];
  const active = battle.state.sides.opp.active;
  const n = battle.format === 'double' ? 4 : 3;
  return (
    <div class="party-strip">
      <span class="ps-lb">相手の選出 <b class="num">{Math.min(seen.length, n)}/{n}</b></span>
      <div class="ps-mons">
        {battle.opp.map((o, i) => {
          const c = condOf(battle, 'opp', i);
          const st = active.includes(i) ? 'active' : c?.fainted ? 'fainted' : seen.includes(i) ? 'seen' : 'unseen';
          return (
            <button class={cx('ps-mon', st)} onClick={() => onOpen(i)} title={speciesName(o.species)}>
              <Sprite id={c?.forme || o.species} size={48} />
              <span class="ps-nm">{speciesName(o.species)}</span>
              {st !== 'unseen' && <span class="ps-hp"><i style={{width: `${c?.hp ?? 100}%`}} /></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FieldRow({battle}) {
  const f = battle.state.field;
  const W = Object.fromEntries(WEATHERS), T = Object.fromEntries(TERRAINS);
  const now = turnNumber(battle);
  const el = k => (f[k] && f.since?.[k] != null ? <small class="muted"> {Math.max(1, now - f.since[k] + 1)}ターン目</small> : null);
  return (
    <div class="ar-field">
      <span>天候 <b class={cx(f.weather && 'on')}>{W[f.weather || '']}</b>{el('weather')}</span>
      <span>フィールド <b class={cx(f.terrain && 'on')}>{T[f.terrain || '']}</b>{el('terrain')}</span>
      {f.trickRoom && <span class="tag accent">トリックルーム{el('trickRoom')}</span>}
      {f.gravity && <span class="tag accent">じゅうりょく</span>}
      <span class="tag">ターン {turnNumber(battle)}</span>
    </div>
  );
}

function SidePanels({side, battle, ...rest}) {
  const act = battle.state.sides[side].active.filter(i => i != null);
  if (!act.length) return <div class={cx('mon-panel', side, 'empty')}><Empty>{side === 'opp' ? '相手のポケモンが場にいません。左の入力欄の「相手が場に出す」から選んでください。' : '自分のポケモンが場にいません。左の入力欄を「自分」にして出してください。'}</Empty></div>;
  return <>{act.map(i => <MonPanel key={`${side}${i}`} side={side} idx={i} battle={battle} {...rest} />)}</>;
}

function MonPanel({side, idx, battle, ctx, mut, usage, setSheet, toast}) {
  const build = ctx.build(side, idx);
  const raw = condOf(battle, side, idx);
  const cond = ctx.cond(side, idx);
  const sid = currentSpecies(build, cond);
  const s = dex.species[sid];
  const view = side === 'opp' ? ctx.views[idx] : null;
  const opp = side === 'opp' ? battle.opp[idx] : null;
  const sd = battle.state.sides[side];
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
  const isMega = !!dex.species[raw.forme]?.mega;
  // へんしん中 (メタモン) / イリュージョンの可能性 (相手のパーティにゾロアークがいる)
  const transformed = raw.transformed;
  const zoro = side === 'opp' ? battle.opp.map((o, i) => ({o, i})).find(x => /^zoroark/.test(x.o.species) && x.i !== idx && !condOf(battle, 'opp', x.i)?.fainted) : null;
  const [askZoro, setAskZoro] = useState(false);
  const reveal = () => {
    setAskZoro(false);
    let n = -1;
    mut(b => { n = revealIllusion(b, usage, zoro.i); });
    toast?.(n >= 0 ? `ゾロアークに付け替えました (${n}件)` : '最初の盤面が残っていないため付け替えできません');
  };
  const moves = side === 'me' ? (build.moves || []) : (opp.moves || []);
  // 補正なしで説明がつくならその範囲を、つかなければ補正あり(↑)/下降(↓)の範囲を出す
  const rg = e => (e[0] === e[1] ? `${e[0]}` : `${e[0]}〜${e[1]}`);
  // 推定能力Pt の段: 推定済みの能力に出てくる性格補正のパターンぶんだけ出す
  const estRows = (() => {
    if (!est) return [];
    const mods = new Set();
    for (const r of est.rows) if (r.known && r.byMod) for (const m of Object.keys(r.byMod)) mods.add(Number(m));
    const all = [[1, '能力Pt 補正なし'], [1.1, '能力Pt 補正↑'], [0.9, '能力Pt 補正↓']].filter(([m]) => mods.has(m));
    return all.length ? all : [[1, '能力Pt']];
  })();
  const fmtVal = r => (r.valLo === r.valHi ? `${r.valLo}` : `${r.valLo}〜${r.valHi}`);
  const tr = battle.state.field.trickRoom;
  return (
    <section class={cx('mon-panel', side, raw.fainted && 'fainted')}>
      <div class="mp-head">
        <span class={cx('side-tag', side)}>{SIDE_JA[side]}</span>
        <Sprite id={sid} size={44} />
        <button class="mp-name" onClick={() => setSheet({side, idx})}>{s.j}</button>
        <MegaButtons battle={battle} side={side} mon={idx} mut={mut} usage={usage} />
        {transformed && <span class="tag accent">へんしん中 ({speciesName((side === 'opp' ? battle.opp : battle.my)[idx].species)})</span>}
        {zoro && !transformed && <button class="btn ghost sm" onClick={() => setAskZoro(true)} title="イリュージョンの正体がゾロアークだったとき">正体は{speciesName(zoro.o.species)}</button>}
        <span class="types">{s.t.map(t => <TypeChip type={t} />)}</span>
      </div>
      <div class="mp-info">
        <span class="mi"><span class="mi-lb">持ち物</span>
          <b class={cx(raw.itemGone && 'strike', side === 'opp' && !opp.item && 'guess')}>{side === 'opp' ? (opp.item ? itemName(opp.item) : `${itemName(view?.build.item) || '不明'}?`) : itemName(build.item) || 'なし'}</b>{raw.itemGone ? <small class="muted"> (消費)</small> : null}
        </span>
        <span class="mi"><span class="mi-lb">特性</span>
          {side === 'me' || opp.ability || s.mega || !view?.abilityGuess
            ? <b>{abilityName(currentAbility(build, cond))}</b>
            : <span class="ab-cands">{(view.abilities || []).map(([a, r]) => <span class="ab-cand">{abilityName(a)}{r > 0 ? <small> {Math.round(r * 100)}%</small> : null}</span>)}</span>}
          {side === 'opp' && (opp.ability || s.mega) ? <small class="tag sm">確定</small> : null}
        </span>
      </div>
      <div class="mp-hp">
        <div class="hpbar"><div class={cx('hpfill', raw.hp > 50 ? 'g' : raw.hp > 20 ? 'y' : 'r')} style={{width: `${raw.hp}%`}} /></div>
        <b class="num">{raw.fainted ? 'ひんし' : maxHP ? `${Math.round((maxHP * raw.hp) / 100)}/${maxHP}` : `${dispOf(raw.hp)}%`}</b>
      </div>
      {transformed && <p class="hint">HP 以外の能力・タイプ・特性・技・ランク変化は、へんしんした相手と同じです (ダメージ計算もその前提)。持ち物と HP は元のポケモンのまま。この間の行動は推定に使いません。</p>}
      <div class="mp-body" style={transformed ? {display: 'none'} : undefined}>
        <table class="mp-table">
          <thead><tr><th></th>{STAT_JA.map(l => <th>{l}</th>)}</tr></thead>
          <tbody>
            <tr><th>種族値</th>{s.bs.map(v => <td class="num">{v}</td>)}</tr>
            {side === 'me' && <tr class="est"><th>能力Pt</th>{build.sp.map(v => <td class="num">{v}</td>)}</tr>}
            {side === 'opp' && estRows.map(([mod, label]) => (
              <tr class="est" key={mod}>
                <th title="H・B・D は与えたダメージ、A・C は受けたダメージ、S は行動順から推定">{label}</th>
                {est.rows.map(r => {
                  // 推定できていない能力は空欄。性格補正のパターンごとに段を分ける
                  if (!r.known) return <td></td>;
                  if (r.key === 'hp') return <td class="num known">{mod === estRows[0][0] ? rg([r.spLo, r.spHi]) : ''}</td>;
                  const e = r.byMod?.[mod];
                  return <td class={cx('num', e && 'known')}>{e ? rg(e) : '×'}</td>;
                })}
              </tr>
            ))}
            <tr><th>能力上昇</th><td></td>
              {BOOST_KEYS.map(k => {
                const v = raw.boosts[k] || 0;
                return <td class={cx('num rankv', v > 0 && 'pos', v < 0 && 'neg')}>{v > 0 ? `+${v}` : v}</td>;
              })}
            </tr>
            <tr class="real"><th>実数値</th>
              {STAT_KEYS.map((k, i) => {
                const st = raw.boosts[k] || 0;
                const r = side === 'opp' ? est.rows[i] : {valLo: myStats[i], valHi: myStats[i]};
                const base = fmtVal(r);
                // 能力上昇があれば補正後の値を出し、元の値をかっこで添える
                if (!st) return <td class={cx('num', r.known && 'known')}>{base}</td>;
                const up = v => Math.floor(st > 0 ? (v * (2 + st)) / 2 : (v * 2) / (2 - st));
                return <td class={cx('num', r.known && 'known', st > 0 ? 'pos' : 'neg')}>{fmtVal({valLo: up(r.valLo), valHi: up(r.valHi)})}<small>({base})</small></td>;
              })}
            </tr>
          </tbody>
        </table>
        {side === 'opp' && <div class="mp-speed">
          <div class="cap">素早さ{tr ? ' (トリル中)' : ''}</div>
          <ol>
            {speeds.rows.map(r => <li class={cx('num', r.mine && 'mine', !r.ok && 'ruled', r.scarf && 'scarf', !r.mine && speeds.mine != null && (r.v > speeds.mine ? 'fast' : r.v < speeds.mine ? 'slow' : 'tie'))}><span>{r.label}</span><b>{r.v}</b></li>)}
          </ol>
        </div>}
      </div>
      {side === 'opp' && <p class="hint mp-remain">H・B・D = 与えたダメージ、A・C = 受けたダメージ、S = 行動順 から推定 (空欄は未推定、× はその性格補正では説明がつかない)。H・B・D は観測に合う中で使うポイントが最小の振り方です。未確定の残り能力Pt: <b class="num">{est.remain}</b> / 66{speeds.o?.pFaster != null ? ` ・ 先手率 自分 ${rate(speeds.o.pSlower)}` : ''}</p>}
      <div class="mp-lower">
        <div class="mp-moves">
          {[0, 1, 2, 3].map(i => {
            const m = moves[i];
            if (m) return <span class="mv-btn mv-show"><span class={cx('mv-bar', `t-${dex.moves[m]?.t}`)} /><span class="mv-nm">{moveName(m)}</span></span>;
            return <span class="mv-box empty">{side === 'opp' ? '未判明' : '—'}</span>;
          })}
        </div>
        <div class="mp-state">
          <div class="cap">場の状態</div>
          {raw.status && <span class="tag bad">{Object.fromEntries(STATUSES)[raw.status]}</span>}
                    {FLAGS.filter(([k]) => sd[k]).map(([, l]) => <span class="tag accent">{l}</span>)}
          {sd.spikes > 0 && <span class="tag accent">まきびし×{sd.spikes}</span>}
          {!raw.status && !isMega && !FLAGS.some(([k]) => sd[k]) && !sd.spikes && <span class="muted">なし</span>}
        </div>
      </div>
      {askZoro && <Confirm title="イリュージョンの正体" message={`いま場にいる${speciesName(battle.opp[idx].species)}は、${speciesName(zoro.o.species)}のイリュージョンでしたか？ 化けていた間の記録 (技・ダメージ・HP) を${speciesName(zoro.o.species)}に付け替えて入れ直します。${speciesName(battle.opp[idx].species)}は選出の最後のポケモンとして記録します。`} okLabel="付け替える" onOk={reveal} onClose={() => setAskZoro(false)} />}
    </section>
  );
}

// ---- 右: ダメージ表・統計 ----
function RightPane(props) {
  const [tab, setTab] = useState('dmg');
  return (
    <div class="ar-right">
      <Seg value={tab} options={[['dmg', 'ダメージ'], ['stat', '傾向'], ['log', 'メモ']]} onChange={setTab} />
      {tab === 'dmg' && <DamagePane {...props} />}
      {tab === 'stat' && <PredictTab battle={props.battle} ctx={props.ctx} />}
      {tab === 'log' && <LogTab battle={props.battle} mut={props.mut} onDelete={props.onDelete} />}
    </div>
  );
}

// 条件で発動する特性 (計算機の「発動中」に対応するもの)
const COND_AB = new Set(['flashfire', 'protosynthesis', 'quarkdrive', 'unburden', 'slowstart', 'plus', 'minus', 'stakeout']);
// HP が満タンのときだけ効く特性 (満タンでなければ自動で無効)
const FULLHP_AB = new Set(['multiscale', 'shadowshield', 'sturdy']);

// 特性を計算に入れるか: on = 入れる / off = 入れない / active = 発動中 (条件つき特性)
function AbilityCtl({label, ability, cands, pick, setPick, mode, setMode}) {
  if (!ability && !cands?.length) return null;
  const opts = [['on', '入れる'], ['off', '入れない']];
  if (COND_AB.has(ability)) opts.push(['active', '発動中']);
  return (
    <div class="dp-ab">
      <span class="dp-ab-lb">{label}</span>
      {cands && cands.length > 1
        ? <select class="input sm" value={pick || ability} onChange={e => setPick(e.currentTarget.value)}>{cands.map(([a, r]) => <option value={a}>{abilityName(a)}{r != null && r < 1 ? ` ${Math.round(r * 100)}%` : ''}</option>)}</select>
        : <b>{abilityName(ability)}</b>}
      <Seg small value={mode} options={opts} onChange={setMode} />
      {FULLHP_AB.has(ability) && mode === 'on' && <small class="muted">HP満タンのときだけ有効</small>}
    </div>
  );
}

function DamagePane({battle, ctx}) {
  const [oSel, setOSel] = useState(null);
  const [mSel, setMSel] = useState(null);
  const [crit, setCrit] = useState(false);
  // 特性の上書き (ポケモンを切り替えたら元に戻す)
  const [oAb, setOAb] = useState({key: null, pick: null, mode: 'on'});
  const [mAb, setMAb] = useState({key: null, mode: 'on'});
  const livingOpp = battle.opp.map((_, i) => i).filter(i => !condOf(battle, 'opp', i)?.fainted);
  const livingMe = battle.my.map((_, i) => i).filter(i => !condOf(battle, 'me', i)?.fainted && (!battle.pick.me.length || battle.pick.me.includes(i)));
  const oi = oSel != null && livingOpp.includes(oSel) ? oSel : alive(battle, 'opp')[0] ?? livingOpp[0];
  const mi = mSel != null && livingMe.includes(mSel) ? mSel : alive(battle, 'me')[0] ?? livingMe[0];
  const oKey = `${oi}`, mKey = `${mi}`;
  const oState = oAb.key === oKey ? oAb : {key: oKey, pick: null, mode: 'on'};
  const mState = mAb.key === mKey ? mAb : {key: mKey, mode: 'on'};
  const oCands = oi != null ? (ctx.views[oi]?.abilities || []) : [];
  const oDefault = oi != null ? currentAbility(ctx.build('opp', oi), ctx.cond('opp', oi)) : '';
  const oAbility = oState.pick || oDefault;
  const mAbility = mi != null ? currentAbility(ctx.build('me', mi), ctx.cond('me', mi)) : '';
  const data = useMemo(() => {
    if (oi == null || mi == null) return null;
    const opp = battle.opp[oi];
    // 特性の上書きを入れた盤面
    const abFor = (side, i, bd) => {
      if (!bd) return bd;
      if (side === 'opp' && i === oi) return oState.mode === 'off' ? {...bd, abilityOverride: ''} : oState.pick ? {...bd, abilityOverride: oState.pick} : bd;
      if (side === 'me' && i === mi) return mState.mode === 'off' ? {...bd, abilityOverride: ''} : bd;
      return bd;
    };
    const cond = (side, i) => {
      const c = ctx.cond(side, i);
      if ((side === 'opp' && i === oi && oState.mode === 'active') || (side === 'me' && i === mi && mState.mode === 'active')) return {...c, abilityOn: true};
      return c;
    };
    const actx = {...ctx, cond, build: (side, i) => abFor(side, i, ctx.build(side, i))};
    actx.ability = (side, i) => { const bd = actx.build(side, i); return bd ? currentAbility(bd, actx.cond(side, i)) : ''; };
    const base = actx.build('opp', oi);
    const sid = currentSpecies(base, actx.cond('opp', oi));
    const alt = (kind, cat) => ({...actx, build: (side, i) => (side === 'opp' && i === oi ? abFor('opp', oi, scenarioBuild(opp, base, sid, kind, cat)) : actx.build(side, i))});
    const one = (c, side, idx, def, move) => attackTable(c, side, idx, {crit, only: {def, move}})?.targets[0]?.results[move];
    const give = (battle.my[mi].moves || []).filter(m => dex.moves[m]).map(m => {
      const cat = dex.moves[m].c;
      return {id: m, lo: one(alt('bulkMax', cat), 'me', mi, oi, m), hi: one(alt('bulkMin', cat), 'me', mi, oi, m)};
    });
    const cand = attackTable(actx, 'opp', oi, {crit, only: {def: mi}})?.moves || [];
    const take = cand.map(m => {
      const cat = dex.moves[m.id].c;
      return {...m, lo: one(alt('powMin', cat), 'opp', oi, mi, m.id), hi: one(alt('powMax', cat), 'opp', oi, mi, m.id)};
    });
    return {give, take};
  }, [ctx, oi, mi, crit, oState.pick, oState.mode, mState.mode]);
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
      <AbilityCtl label="相手の特性" ability={oAbility} cands={battle.opp[oi]?.ability ? null : oCands} pick={oState.pick} setPick={v => setOAb({...oState, pick: v})} mode={oState.mode} setMode={v => setOAb({...oState, mode: v})} />
      <AbilityCtl label="自分の特性" ability={mAbility} mode={mState.mode} setMode={v => setMAb({...mState, mode: v})} />
      <h4 class="me">自分 → 相手 <span class="muted">残り{dispOf(oHP)}%</span></h4>
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
