// 選出フェーズ: 相手6体を入れて、その場で「誰を出すか」を決める
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, moveName, typeEffect, statsOf, megaFormeFor} from '../engine/dex.js';
import {newOpp, sendOut, activeCount, pickCount} from '../engine/battle.js';
import {leadRate} from '../engine/assume.js';
import {oppSpeciesStats, similarTeams, leadsOf, matchupMatrix} from '../engine/predict.js';
import {useApp, Picker, TypeChip, Sprite, cx, rate} from './common.jsx';
import {MonEditor} from './teams.jsx';
import {OppSheet} from './battle.jsx';

// 素早さの目安 (最速・準速・無振り・最遅)。スカーフはかっこで
const speLine = sid => {
  const v = (nat, sp) => statsOf(sid, [0, 0, 0, 0, 0, sp], nat)[5];
  return [['最速', v('Timid', 32), true], ['準速', v('Hardy', 32), true], ['無振り', v('Hardy', 0)], ['最遅', v('Brave', 0)]];
};
const mySpe = m => {
  if (!dex.species[m.species]) return null;
  const base = statsOf(m.species, m.sp, m.nature)[5];
  const mega = megaFormeFor(m.species, m.item);
  return {base, mega: mega ? statsOf(mega, m.sp, m.nature)[5] : null};
};

export function SelectTab({battle, ctx, mut, usage, setTab, toast}) {
  const {store} = useApp();
  const [pick, setPick] = useState(false);
  const [oppEdit, setOppEdit] = useState(null);
  const [myEdit, setMyEdit] = useState(null);
  const [info, setInfo] = useState(false);
  const nLead = activeCount(battle.format), nPick = pickCount(battle.format);
  const others = useMemo(() => store.battles().filter(b => b.id !== battle.id), [store.version, battle.id]);
  const usageRank = useMemo(() => (usage?.pokemon ? Object.fromEntries(Object.entries(usage.pokemon).map(([k, v]) => [k, v.u])) : null), [usage]);
  // 自分の記録: 相手のポケモンごとの 選出率・勝率・初手率 と、自分×相手 の 選出率・勝率
  const colStats = useMemo(() => battle.opp.map(o => oppSpeciesStats(others, o.species, {format: battle.format})), [others, battle.opp, battle.format]);
  const mx = useMemo(() => matchupMatrix(others, battle.my.map(m => m.species), battle.opp.map(o => o.species), {format: battle.format}), [others, battle.my, battle.opp, battle.format]);
  const pr = (a, b) => (b ? rate(a / b) : '-');
  const sim = useMemo(() => similarTeams(others, battle.opp.map(o => o.species), {format: battle.format}), [others, battle.opp, battle.format]);

  // 相手の初手予想: 使用率の初手率を6体で正規化し、自分の記録があれば併記
  const leads = useMemo(() => {
    const rows = battle.opp.map((o, i) => ({i, o, r: leadRate(ctx.views[i], battle.format), st: oppSpeciesStats(others, o.species, {format: battle.format})}));
    const total = rows.reduce((a, x) => a + x.r, 0);
    return rows.map(x => ({...x, p: total ? (x.r / total) * nLead : 0})).sort((a, b) => b.p - a.p);
  }, [ctx, others]);

  // タイプの打点: 自分の攻撃技で弱点を突けるタイプ / 相手から弱点を突かれるタイプ (相手はタイプ一致 + 判明・推定の技)
  const typeHits = (moves, defTypes) => {
    const best = {};
    for (const m of moves) {
      const mv = dex.moves[m];
      if (!mv || mv.c === 'Z' || !mv.bp) continue;
      const e = typeEffect(mv.t, defTypes);
      if (e >= 2) best[mv.t] = Math.max(best[mv.t] || 0, e);
    }
    return Object.entries(best).sort((a, b) => b[1] - a[1]);
  };
  const myHits = (mi, oi) => typeHits(battle.my[mi].moves || [], dex.species[battle.opp[oi].species]?.t || []);
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
        <button class="btn ghost sm" onClick={() => setInfo(v => !v)}>{info ? '対戦情報をたたむ' : '対戦情報 (相手の名前・日付)'}</button>
      </div>
      {info && (
        <div class="form">
          <label class="field grow"><span>相手の名前</span><input class="input" value={battle.oppName} onChange={e => mut(b => { b.oppName = e.currentTarget.value; })} /></label>
          <label class="field"><span>日付</span><input class="input" type="date" value={battle.date} onChange={e => mut(b => { b.date = e.currentTarget.value; })} /></label>
        </div>
      )}
      <div class="opp-grid">
        {[0, 1, 2, 3, 4, 5].map(i => {
          const o = battle.opp[i];
          if (!o) return <button class="opp-tile empty" onClick={() => setPick(true)}>{i === battle.opp.length ? '＋ 追加' : ''}</button>;
          const v = ctx.views[i];
          const s = dex.species[o.species];
          return (
            <button class="opp-tile" onClick={() => setOppEdit(i)}>
              <Sprite id={o.species} size={48} />
              <span class="nm">{speciesName(o.species)}</span>
              <span class="types">{s.t.map(t => <TypeChip type={t} small />)}</span>
              <span class="sub">{itemName(v?.build.item) || '持ち物?'}{v?.itemGuess ? '?' : ''}{v?.megaP > 0.05 ? ` (メガ${rate(v.megaP)})` : ''}</span>
            </button>
          );
        })}
      </div>

      {battle.opp.length > 0 && (
        <div class="box">
          <h4>相手の初手予想 <span class="muted">使用率ベース{sim.n ? `・似た並びとの対戦 ${sim.n}戦` : ''}</span></h4>
          <div class="chips">
            {leads.slice(0, 6).map(x => (
              <span class={cx('chip', x.p >= 0.25 && 'on')}><Sprite id={x.o.species} size={28} />{speciesName(x.o.species)} <b class="num">{rate(Math.min(1, x.p))}</b>
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
        <p class="hint sel-legend">
          各マス: 自分の技で弱点を突ける相手のタイプ。選出率・勝率 = 自分の過去の対戦 (同じルール) で、その相手がいたときに自分がそのポケモンを選出した率と、選出したときの勝率。
        </p>
      )}
      <div class="scroll-x">
        <table class="sel-table">
          <thead>
            <tr class="sel-oppnames"><th></th>{battle.opp.map(o => (
              <th>
                <div class="so-head">
                  <div class="so-mon"><Sprite id={o.species} size={44} /><span>{speciesName(o.species)}</span></div>
                  {dex.species[o.species] && <dl class="so-spe">{speLine(o.species).map(([l, v, sc]) => <><dt>{l}</dt><dd class="num">{v}{sc ? <small> ({Math.floor(v * 1.5)})</small> : null}</dd></>)}</dl>}
                </div>
              </th>
            ))}</tr>
            <tr class="rec"><th class="rec-l">選出率</th>{colStats.map(c => <td class={cx('num', c.seen && c.picked / c.seen >= 0.6 && 'hi')} title={`見せ合い ${c.seen}回中 ${c.picked}回選出`}>{pr(c.picked, c.seen)}</td>)}</tr>
            <tr class="rec"><th class="rec-l">勝率</th>{colStats.map(c => <td class="num" title={`相手が選出した対戦 ${c.pickedWin}勝${c.pickedLose}敗`}>{pr(c.pickedWin, c.pickedWin + c.pickedLose)}</td>)}</tr>
            <tr class="rec"><th class="rec-l">初手率</th>{colStats.map(c => <td class={cx('num', c.picked && c.lead / c.picked >= 0.6 && 'hi')} title={`選出 ${c.picked}回中 初手 ${c.lead}回`}>{pr(c.lead, c.picked)}</td>)}</tr>
          </thead>
          <tbody>
            {battle.my.map((m, mi) => {
              const order = battle.pick.me.indexOf(mi);
              return (
                <tr class={cx(order >= 0 && 'picked')}>
                  <th>
                    <button class={cx('sel-mon', order >= 0 && 'on', order >= 0 && order < nLead && 'lead')} onClick={() => togglePick(mi)} aria-pressed={order >= 0}>
                      <span class="no">{order >= 0 ? order + 1 : ''}</span>
                      <Sprite id={m.species} size={40} class="sm-sprite" />
                      <span class="nm">{speciesName(m.species)}</span>
                      {mySpe(m) && <span class="sm-spe num">S:{mySpe(m).base}{mySpe(m).mega && mySpe(m).mega !== mySpe(m).base ? ` (メガ ${mySpe(m).mega})` : ''}</span>}
                      {mx.row[m.species]?.n > 0 && <span class="rec-s">選出率 {pr(mx.row[m.species].picked, mx.row[m.species].n)}<br />勝率 {pr(mx.row[m.species].win, mx.row[m.species].win + mx.row[m.species].lose)}</span>}
                    </button>
                  </th>
                  {battle.opp.map((_, oi) => {
                    const r = mx.cell[m.species]?.[battle.opp[oi].species];
                    const mine = myHits(mi, oi);
                    const wr = r && r.win + r.lose > 0 ? r.win / (r.win + r.lose) : null;
                    return (
                      <td class="sel-cell">
                        <div class="cx-types">
                          {mine.map(([t]) => <TypeChip type={t} />)}
                        </div>
                        <div class="cx-rec" title={r?.n ? `この相手がいた ${r.n}戦: 選出 ${r.picked}回 (${r.win}勝${r.lose}敗)` : '記録なし'}>
                          <span>選出率 <b>{r?.n ? pr(r.picked, r.n) : '-'}</b></span>
                          <span>勝率 <b class={cx(wr != null && (wr >= 0.6 ? 'good' : wr <= 0.4 ? 'bad' : ''))}>{wr != null ? rate(wr) : '-'}</b></span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="btnrow pad-s">
        {battle.my.map((m, i) => <button class="btn ghost sm" onClick={() => setMyEdit(i)}><Sprite id={m.species} size={28} />{speciesName(m.species)}の型</button>)}
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
