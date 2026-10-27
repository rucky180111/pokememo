// 選出フェーズ: 相手6体を入れて、その場で「誰を出すか」を決める
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, moveName, typeEffect, statsOf, megaFormeFor, selectionSpeciesId} from '../engine/dex.js';
import {newOpp, sendOut, activeCount, pickCount} from '../engine/battle.js';
import {leadRate} from '../engine/assume.js';
import {oppSpeciesStats, similarTeams, leadsOf, matchupMatrix} from '../engine/predict.js';
import {useApp, Picker, TypeChip, Sprite, cx, rate} from './common.jsx';
import {MonEditor} from './teams.jsx';
import {OppSheet} from './battle.jsx';
import {SelectionAssessmentHint} from './selection-assessment.jsx';
import {PickRuleHint} from './pickrules.jsx';

const previewName = id => speciesName(selectionSpeciesId(id));
const PreviewSprite = props => <Sprite {...props} id={selectionSpeciesId(props.id)} />;

// 素早さの目安 (最速・準速・無振り・最遅)。スカーフはかっこで
const speLine = sid => {
  const v = (nat, sp) => statsOf(selectionSpeciesId(sid), [0, 0, 0, 0, 0, sp], nat)[5];
  return [['最速', v('Timid', 32), true], ['準速', v('Hardy', 32), true], ['無振り', v('Hardy', 0)], ['最遅', v('Brave', 0)]];
};
const mySpe = m => {
  if (!dex.species[m.species]) return null;
  const base = statsOf(selectionSpeciesId(m.species), m.sp, m.nature)[5];
  const mega = megaFormeFor(selectionSpeciesId(m.species), m.item);
  return {base, mega: mega ? statsOf(mega, m.sp, m.nature)[5] : null};
};

export function SelectTab({battle, ctx, mut, usage, setTab, toast}) {
  const {store} = useApp();
  const liveTeam=store.team(battle.teamId);
  const assessmentTeam={...liveTeam,selectionAssessment:battle.selectionAssessment || liveTeam?.selectionAssessment};
  const [pick, setPick] = useState(null); // 相手のパーティを選ぶパネル (開くときは最初に選ぶ枠の番号)
  const [oppEdit, setOppEdit] = useState(null);
  const [myEdit, setMyEdit] = useState(null);
  const [info, setInfo] = useState(false);
  const nLead = activeCount(battle.format), nPick = pickCount(battle.format);
  const others = useMemo(() => store.battles().filter(b => b.id !== battle.id), [store.version, battle.id]);
  const usageRank = useMemo(() => {
    if (!usage?.pokemon) return null;
    const rank = {};
    for (const [id, v] of Object.entries(usage.pokemon)) {
      const base = selectionSpeciesId(id);
      rank[base] = Math.min(1, (rank[base] || 0) + (v.u || 0));
    }
    return rank;
  }, [usage]);
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
  const myHits = (mi, oi) => typeHits(battle.my[mi].moves || [], dex.species[selectionSpeciesId(battle.opp[oi].species)]?.t || []);
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
        {battle.opp.length > 0 && <button class="btn ghost sm" onClick={() => setPick(0)}>まとめて選び直す</button>}
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
          if (!o) return <button class="opp-tile empty" onClick={() => setPick(i)}>{i === battle.opp.length ? '＋ 追加' : ''}</button>;
          const v = ctx.views[i];
          const s = dex.species[selectionSpeciesId(o.species)];
          return (
            <button class="opp-tile" onClick={() => setOppEdit(i)}>
              <PreviewSprite id={o.species} size={48} />
              <span class="nm">{previewName(o.species)}</span>
              <span class="types">{s.t.map(t => <TypeChip type={t} small />)}</span>
              <span class="sub">{itemName(v?.build.item) || '持ち物?'}{v?.itemGuess ? '?' : ''}{v?.megaP > 0.05 ? ` (メガ${rate(v.megaP)})` : ''}</span>
            </button>
          );
        })}
      </div>

      {battle.opp.length > 0 && !assessmentTeam.selectionAssessment && (
        <div class="box">
          <h4>相手の初手予想 <span class="muted">使用率ベース{sim.n ? `・似た並びとの対戦 ${sim.n}戦` : ''}</span></h4>
          <div class="chips">
            {leads.slice(0, 6).map(x => (
              <span class={cx('chip', x.p >= 0.25 && 'on')}><PreviewSprite id={x.o.species} size={28} />{previewName(x.o.species)} <b class="num">{rate(Math.min(1, x.p))}</b>
                {x.st.seen > 0 && <span class="rate">自分の記録 {x.st.lead}/{x.st.seen}</span>}
                {sim.lead[x.o.species] ? <span class="rate">似た並び {sim.lead[x.o.species]}/{sim.n}</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      {assessmentTeam.selectionAssessment ? <SelectionAssessmentHint team={assessmentTeam} battle={battle} started={battle.turns.length>0 || ['me','opp'].some(side=>battle.state.sides[side].active.some(x=>x!=null))} onApply={(idx,record) => mut(b => { b.pick.me = idx.slice(0,nPick); b.selectionAssessment=structuredClone(assessmentTeam.selectionAssessment); b.selectionRecommendation=record; })} /> : <PickRuleHint team={battle.teamId ? store.team(battle.teamId) : null} battle={battle} started={battle.state.sides.me.active.some(x => x != null)}
        onApply={idx => mut(b => { b.pick.me = idx.slice(0, nPick); })} />}

      <div class="sel-head">
        <h3>自分の選出 <span class="muted">{battle.pick.me.length}/{nPick}・タップした順。先頭{nLead}体が初手</span></h3>
      </div>
      {battle.opp.length > 0 && battle.my.length > 0 && (
        <p class="hint sel-legend">
          マス: 弱点を突けるタイプ / 選出率・勝率は過去の対戦から
        </p>
      )}
      <div class="scroll-x">
        <table class="sel-table">
          <thead>
            <tr class="sel-oppnames"><th></th>{battle.opp.map(o => (
              <th>
                <div class="so-head">
                  <div class="so-mon"><PreviewSprite id={o.species} size={44} /><span>{previewName(o.species)}</span></div>
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
                      <PreviewSprite id={m.species} size={40} class="sm-sprite" />
                      <span class="nm">{previewName(m.species)}</span>
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
        {battle.my.map((m, i) => <button class="btn ghost sm" onClick={() => setMyEdit(i)}><PreviewSprite id={m.species} size={28} />{previewName(m.species)}の型</button>)}
        {battle.my.length < 6 && <button class="btn ghost sm" onClick={() => setMyEdit({add: true})}>＋ 自分のポケモン</button>}
      </div>

      <div class="turnbar">
        <button class="btn primary grow" onClick={start}>{started ? '対戦フェーズへ' : `この選出で対戦開始 (${battle.pick.me.length}/${nPick})`}</button>
      </div>

      {pick != null && <PartyPicker battle={battle} rank={usageRank} start={pick} onClose={() => setPick(null)}
        onDone={list => { mut(b => {
          list.forEach((sid, i) => {
            if (!sid) return;
            if (!b.opp[i]) b.opp.push(newOpp(sid));
            else if (selectionSpeciesId(b.opp[i].species) !== sid) b.opp[i] = {...newOpp(sid)};
          });
        }); setPick(null); }} />}
      {oppEdit != null && battle.opp[oppEdit] && <OppSheet battle={battle} idx={oppEdit} preview ctx={ctx} mut={mut} usage={usage} onClose={() => setOppEdit(null)} />}
      {myEdit != null && (
        <MonEditor title="この対戦での自分の型" usage={usage} isNew={!!myEdit.add}
          build={myEdit.add ? {species: '', item: '', ability: '', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: ''} : battle.my[myEdit]}
          onSave={bd => { mut(b => { if (myEdit.add) b.my.push(bd); else b.my[myEdit] = bd; }); setMyEdit(null); }} onClose={() => setMyEdit(null)} />
      )}
    </div>
  );
}
void moveName;

// 相手の6体をまとめて入れる: 上の6つの枠に順に入り、枠を押すとそこを選び直せる。確定で決める
function PartyPicker({battle, rank, start, onClose, onDone}) {
  const [list, setList] = useState(() => [0, 1, 2, 3, 4, 5].map(i => selectionSpeciesId(battle.opp[i]?.species || '')));
  const firstEmpty = l => { const k = l.findIndex(x => !x); return k < 0 ? null : k; };
  const [slot, setSlot] = useState(() => start ?? firstEmpty(list) ?? 0);
  const pickOne = sid => {
    const next = list.slice();
    next[slot ?? 0] = sid;
    setList(next);
    const k = next.findIndex((x, i) => !x && i > (slot ?? 0));
    setSlot(k >= 0 ? k : firstEmpty(next));
  };
  const n = list.filter(Boolean).length;
  const header = (
    <>
      <div class="party-slots">
        {list.map((sid, i) => (
          <button class={cx('party-slot', sid && 'filled', slot === i && 'on')} onClick={() => setSlot(i)}>
            {sid ? <><PreviewSprite id={sid} size={40} /><span class="nm">{previewName(sid)}</span></> : <span class="muted">{i + 1}</span>}
          </button>
        ))}
      </div>
      <p class="party-hint">{slot == null ? '6体そろいました。枠を押すと選び直せます。' : `${slot + 1}番目を選んでいます。枠を押すとそこを選び直せます。`}</p>
    </>
  );
  return <Picker kind="species" title={`相手のパーティ (${n}/6)`} rank={rank} filter={id => !dex.species[id].mega && !dex.species[id].bo} onClose={onClose} onPick={pickOne} header={header}
    actions={<button class="btn primary" disabled={!n} onClick={() => onDone(list)}>確定</button>} />;
}
