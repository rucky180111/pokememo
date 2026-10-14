// 対戦フェーズ: 盤面 (入力もここで完結、play.jsx) と、右の ダメージ・傾向・ログ。ターン終了は右下 (スマホは盤面の下)
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, abilityName, moveName, STAT_JA, STAT_KEYS} from '../engine/dex.js';
import {BOOST_KEYS, currentSpecies, currentAbility} from '../engine/calc.js';
import {condOf} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {estimateStats, scenarioBuild} from '../engine/estimate.js';
import {Seg, Toggle, TypeChip, Empty, cx, fmtPct, rate} from './common.jsx';
import {OppSheet, dmgClass, LogTab} from './battle.jsx';
import {MonEditor} from './teams.jsx';
import {DmgBar} from './board.jsx';
import {PredictTab} from './analysis.jsx';
import {PlayBoard, TurnBar} from './play.jsx';
import {dispOf} from '../engine/flow.js';

const alive = (battle, side) => battle.state.sides[side].active.filter(i => i != null && !condOf(battle, side, i)?.fainted);

export function Arena({battle, ctx, mut, usage, toast, wide, onDelete}) {
  const [pane, setPane] = useState('center');
  const [sheet, setSheet] = useState(null);
  const p = {battle, ctx, mut, usage, toast, setSheet, onDelete};
  return (
    <div class={cx('arena', wide && 'wide')}>
      {!wide && <div class="arena-tabs"><Seg value={pane} options={[['center', '盤面'], ['right', 'ダメージ・ログ']]} onChange={setPane} /></div>}
      {(wide || pane === 'center') && (
        <div class="ar-center">
          <PlayBoard {...p} />
          {!wide && <TurnBar {...p} />}
        </div>
      )}
      {(wide || pane === 'right') && (
        <div class="ar-right-col">
          <RightPane {...p} />
          {wide && <TurnBar {...p} />}
        </div>
      )}
      {sheet && sheet.side === 'opp' && battle.opp[sheet.idx] && <OppSheet battle={battle} idx={sheet.idx} ctx={ctx} mut={mut} usage={usage} onClose={() => setSheet(null)} />}
      {sheet && sheet.side === 'me' && battle.my[sheet.idx] && (
        <MonEditor title="この対戦での自分の型" usage={usage} build={battle.my[sheet.idx]}
          onSave={bd => { mut(b => { b.my[sheet.idx] = bd; }); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

// ---- 右: ダメージ表・統計 ----
function RightPane(props) {
  const [tab, setTab] = useState('dmg');
  return (
    <div class="ar-right">
      <Seg value={tab} options={[['dmg', 'ダメージ'], ['stat', '傾向'], ['log', 'ログ・メモ']]} onChange={setTab} />
      {tab === 'dmg' && <DamagePane {...props} />}
      {tab === 'stat' && <PredictTab battle={props.battle} ctx={props.ctx} />}
      {tab === 'log' && <LogTab battle={props.battle} mut={props.mut} onDelete={props.onDelete} ctx={props.ctx} usage={props.usage} toast={props.toast} />}
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

/** 相手の能力表 (中央の盤面と同じもの)。相手の詳細シートでも使う */
export function OppStatTable({battle, idx}) {
  const opp = battle.opp[idx];
  const raw = condOf(battle, 'opp', idx) || {boosts: {}};
  const sid = currentSpecies(opp, raw);
  const s = dex.species[sid];
  const est = useMemo(() => estimateStats(opp, sid), [opp, sid]);
  if (!s || !est) return null;
  const rg = e => (e[0] === e[1] ? `${e[0]}` : `${e[0]}〜${e[1]}`);
  const mods = new Set();
  for (const r of est.rows) if (r.known && r.byMod) for (const m of Object.keys(r.byMod)) mods.add(Number(m));
  const all = [[1, '能力Pt 補正なし'], [1.1, '能力Pt 補正↑'], [0.9, '能力Pt 補正↓']].filter(([m]) => mods.has(m));
  const estRows = all.length ? all : [[1, '能力Pt']];
  const fmtVal = r => (r.valLo === r.valHi ? `${r.valLo}` : `${r.valLo}〜${r.valHi}`);
  return (
    <table class="mp-table">
      <thead><tr><th></th>{STAT_JA.map(l => <th>{l}</th>)}</tr></thead>
      <tbody>
        <tr><th>種族値</th>{s.bs.map(v => <td class="num">{v}</td>)}</tr>
        {estRows.map(([mod, label]) => (
          <tr class="est" key={mod}><th>{label}</th>
            {est.rows.map(r => {
              if (!r.known) return <td></td>;
              if (r.key === 'hp') return <td class="num known">{mod === estRows[0][0] ? rg([r.spLo, r.spHi]) : ''}</td>;
              const e = r.byMod?.[mod];
              return <td class={cx('num', e && 'known')}>{e ? rg(e) : '×'}</td>;
            })}
          </tr>
        ))}
        <tr><th>能力上昇</th><td></td>{BOOST_KEYS.map(k => { const v = raw.boosts?.[k] || 0; return <td class={cx('num rankv', v > 0 && 'pos', v < 0 && 'neg')}>{v > 0 ? `+${v}` : v}</td>; })}</tr>
        <tr class="real"><th>実数値</th>
          {STAT_KEYS.map((k, i) => {
            const st = raw.boosts?.[k] || 0;
            const r = est.rows[i];
            const base = fmtVal(r);
            if (!st) return <td class={cx('num', r.known && 'known')}>{base}</td>;
            const up = v => Math.floor(st > 0 ? (v * (2 + st)) / 2 : (v * 2) / (2 - st));
            return <td class={cx('num', r.known && 'known', st > 0 ? 'pos' : 'neg')}>{fmtVal({valLo: up(r.valLo), valHi: up(r.valHi)})}<small>({base})</small></td>;
          })}
        </tr>
      </tbody>
    </table>
  );
}
