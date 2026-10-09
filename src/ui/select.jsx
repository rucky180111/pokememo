// 選出フェーズ: 相手6体を入れて、その場で「誰を出すか」を決める
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, moveName} from '../engine/dex.js';
import {newOpp, sendOut, activeCount, pickCount} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {finalSpeed, newCond} from '../engine/calc.js';
import {oppCond, leadRate} from '../engine/assume.js';
import {oppSpeciesStats, similarTeams, leadsOf} from '../engine/predict.js';
import {useApp, Picker, Seg, TypeChip, cx, rate, fmtPct} from './common.jsx';
import {MonEditor, FORMAT_OPTS} from './teams.jsx';
import {OppSheet, dmgClass} from './battle.jsx';

export function SelectTab({battle, ctx, mut, usage, setTab, toast}) {
  const {store} = useApp();
  const [pick, setPick] = useState(false);
  const [oppEdit, setOppEdit] = useState(null);
  const [myEdit, setMyEdit] = useState(null);
  const [info, setInfo] = useState(false);
  const nLead = activeCount(battle.format), nPick = pickCount(battle.format);
  const others = useMemo(() => store.battles().filter(b => b.id !== battle.id), [store.version, battle.id]);
  const usageRank = useMemo(() => (usage?.pokemon ? Object.fromEntries(Object.entries(usage.pokemon).map(([k, v]) => [k, v.u])) : null), [usage]);
  const data = useMemo(() => ({
    give: battle.my.map((_, i) => attackTable(ctx, 'me', i)),
    take: battle.opp.map((_, i) => attackTable(ctx, 'opp', i)),
  }), [ctx]);
  const sim = useMemo(() => similarTeams(others, battle.opp.map(o => o.species), {format: battle.format}), [others, battle.opp, battle.format]);

  // 相手の初手予想: 使用率の初手率を6体で正規化し、自分の記録があれば併記
  const leads = useMemo(() => {
    const rows = battle.opp.map((o, i) => ({i, o, r: leadRate(ctx.views[i], battle.format), st: oppSpeciesStats(others, o.species, {format: battle.format})}));
    const total = rows.reduce((a, x) => a + x.r, 0);
    return rows.map(x => ({...x, p: total ? (x.r / total) * nLead : 0})).sort((a, b) => b.p - a.p);
  }, [ctx, others]);

  const spd = (side, i) => {
    const build = ctx.build(side, i);
    if (!build) return 0;
    const cond = side === 'me' ? newCond() : oppCond(newCond(), ctx.views[i]);
    return finalSpeed({build, cond}, {format: battle.format});
  };
  const cell = (mi, oi) => {
    const g = data.give[mi]?.targets.find(t => t.idx === oi)?.best;
    const t = data.take[oi]?.targets.find(t2 => t2.idx === mi)?.best;
    const ms = spd('me', mi), os = spd('opp', oi);
    return {g, t, first: ms > os ? 'me' : ms < os ? 'opp' : 'tie'};
  };
  // 有利 = 先に倒せる見込み (確定数が少ない。同数なら先手側)
  const verdict = c => {
    const gn = c.g && !c.g.immune ? c.g.n || 9 : 99, tn = c.t && !c.t.immune ? c.t.n || 9 : 99;
    if (gn < tn || (gn === tn && gn < 99 && c.first === 'me')) return 'win';
    if (tn < gn || (gn === tn && tn < 99 && c.first === 'opp')) return 'lose';
    return 'even';
  };
  const togglePick = i => mut(b => {
    const list = b.pick.me;
    const at = list.indexOf(i);
    if (at >= 0) { list.splice(at, 1); b.state.sides.me.active = b.state.sides.me.active.map(x => (x === i ? null : x)); }
    else if (list.length < nPick) list.push(i);
  });
  const start = () => {
    if (battle.pick.me.length < nLead) { toast(`初手の${nLead}体をタップで選んでください`); return; }
    mut(b => { leadsOf(b, 'me').forEach((mi, slot) => { if (b.state.sides.me.active[slot] == null) sendOut(b, 'me', slot, mi, {resolveAbility: ctx.strictAbility}); }); });
    setTab('board');
  };
  const started = battle.state.sides.me.active.some(x => x != null);
  return (
    <div class="page-in select">
      <div class="sel-head">
        <h3>相手のパーティ <span class="muted">{battle.opp.length}/6</span></h3>
        <button class="btn ghost sm" onClick={() => setInfo(v => !v)}>{info ? '対戦情報をたたむ' : '対戦情報 (名前・ルール)'}</button>
      </div>
      {info && (
        <div class="form">
          <label class="field grow"><span>相手の名前</span><input class="input" value={battle.oppName} onChange={e => mut(b => { b.oppName = e.currentTarget.value; })} /></label>
          <label class="field"><span>日付</span><input class="input" type="date" value={battle.date} onChange={e => mut(b => { b.date = e.currentTarget.value; })} /></label>
          <div class="field"><span>ルール</span><Seg value={battle.format} options={FORMAT_OPTS} onChange={v => mut(b => { b.format = v; })} /></div>
        </div>
      )}
      <div class="opp-grid">
        {[0, 1, 2, 3, 4, 5].map(i => {
          const o = battle.opp[i];
          if (!o) return <button class="opp-tile empty" onClick={() => setPick(true)}>{i === battle.opp.length ? '＋ 追加' : ''}</button>;
          const v = ctx.views[i];
          const s = dex.species[v?.megaForme || o.species];
          return (
            <button class="opp-tile" onClick={() => setOppEdit(i)}>
              <span class="nm">{speciesName(o.species)}</span>
              <span class="types">{s.t.map(t => <TypeChip type={t} small />)}</span>
              <span class="sub">{v?.megaForme ? 'メガ想定' : itemName(v?.build.item) || '持ち物?'}{v?.itemGuess && !v?.megaForme ? '?' : ''}</span>
            </button>
          );
        })}
      </div>

      {battle.opp.length > 0 && (
        <div class="box">
          <h4>相手の初手予想 <span class="muted">使用率ベース{sim.n ? `・似た並びとの対戦 ${sim.n}戦` : ''}</span></h4>
          <div class="chips">
            {leads.slice(0, 6).map(x => (
              <span class={cx('chip', x.p >= 0.25 && 'on')}>{speciesName(x.o.species)} <b class="num">{rate(Math.min(1, x.p))}</b>
                {x.st.seen > 0 && <span class="rate">自分の記録 {x.st.lead}/{x.st.seen}</span>}
                {sim.lead[x.o.species] ? <span class="rate">似た並び {sim.lead[x.o.species]}/{sim.n}</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      <div class="sel-head">
        <h3>自分の選出 <span class="muted">{battle.pick.me.length}/{nPick}・タップした順。先頭{nLead}体が初手</span></h3>
      </div>
      {battle.opp.length > 0 && battle.my.length > 0 && (
        <p class="legend"><span class="lg v-win">有利</span><span class="lg v-lose">不利</span><span class="muted">各マス: 上 = 自分の最大打点 / 下 = 相手の最大打点。「先」は素早さで上を取れる相手。相手は推定型です。</span></p>
      )}
      <div class="scroll-x">
        <table class="sel-table">
          <thead>
            <tr><th></th>{battle.opp.map(o => <th>{speciesName(o.species)}</th>)}</tr>
          </thead>
          <tbody>
            {battle.my.map((m, mi) => {
              const order = battle.pick.me.indexOf(mi);
              const cells = battle.opp.map((_, oi) => cell(mi, oi));
              const wins = cells.filter(c => verdict(c) === 'win').length, loses = cells.filter(c => verdict(c) === 'lose').length;
              return (
                <tr class={cx(order >= 0 && 'picked')}>
                  <th>
                    <button class={cx('sel-mon', order >= 0 && 'on', order >= 0 && order < nLead && 'lead')} onClick={() => togglePick(mi)} aria-pressed={order >= 0}>
                      <span class="no">{order >= 0 ? order + 1 : ''}</span>
                      <span class="nm">{speciesName(m.species)}</span>
                      {battle.opp.length > 0 && <span class="wl"><b class="w">有利{wins}</b> <b class="l">不利{loses}</b></span>}
                    </button>
                  </th>
                  {cells.map(c => (
                    <td class={`v-${verdict(c)}`}>
                      <span class={cx('mx', dmgClass(c.g))}>{c.g ? (c.g.immune ? '無効' : `${fmtPct(c.g.maxPct)}%`) : '—'}{c.first === 'me' && <i>先</i>}</span>
                      <span class={cx('mx', dmgClass(c.t))}>{c.t ? (c.t.immune ? '無効' : `${fmtPct(c.t.maxPct)}%`) : '—'}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="btnrow pad-s">
        {battle.my.map((m, i) => <button class="btn ghost sm" onClick={() => setMyEdit(i)}>{speciesName(m.species)}の型</button>)}
        {battle.my.length < 6 && <button class="btn ghost sm" onClick={() => setMyEdit({add: true})}>＋ 自分のポケモン</button>}
      </div>

      <div class="turnbar">
        <button class="btn primary grow" onClick={start}>{started ? '対戦フェーズへ' : `この選出で対戦開始 (${battle.pick.me.length}/${nPick})`}</button>
      </div>

      {pick && <Picker kind="species" title={`相手のポケモン (${battle.opp.length + 1}体目)`} rank={usageRank} onClose={() => setPick(false)}
        filter={id => !dex.species[id].mega && !dex.species[id].bo && !battle.opp.some(o => o.species === id)}
        onPick={sid => { mut(b => { if (b.opp.length < 6) b.opp.push(newOpp(sid)); }); if (battle.opp.length >= 5) setPick(false); }} />}
      {oppEdit != null && battle.opp[oppEdit] && <OppSheet battle={battle} idx={oppEdit} ctx={ctx} mut={mut} usage={usage} onClose={() => setOppEdit(null)} />}
      {myEdit != null && (
        <MonEditor title="この対戦での自分の型" usage={usage} isNew={!!myEdit.add}
          build={myEdit.add ? {species: '', item: '', ability: '', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: ''} : battle.my[myEdit]}
          onSave={bd => { mut(b => { if (myEdit.add) b.my.push(bd); else b.my[myEdit] = bd; }); setMyEdit(null); }} onClose={() => setMyEdit(null)} />
      )}
    </div>
  );
}
void moveName;
