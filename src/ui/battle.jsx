// 対戦画面: 見せ合い・盤面・ダメージ・素早さ・予測・ログ
import {useEffect, useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName} from '../engine/dex.js';
import {clone, normalizeBattle, newOpp, sendOut, activeCount, pickCount, undoTurn, describeAct, turnNumber} from '../engine/battle.js';
import {boardContext, attackTable} from '../engine/board.js';
import {oppSpeciesStats, similarTeams, leadsOf, pct} from '../engine/predict.js';
import {spreadLabel, PRESETS, SPE_COMBOS, speFromCombo, leadRate} from '../engine/assume.js';
import {useApp, Sheet, Picker, Seg, MonName, TypeChip, Empty, Confirm, cx, rate, fmtPct} from './common.jsx';
import {MonEditor, FORMAT_OPTS, buildSummary} from './teams.jsx';
import {BoardTab} from './board.jsx';
import {SelectTab} from './select.jsx';
import {spreadFits} from '../engine/infer-dmg.js';
import {DamageTab, SpeedTab, PredictTab} from './analysis.jsx';

const TABS = [['setup', '① 選出'], ['board', '② 対戦'], ['dmg', 'ダメージ表'], ['speed', '素早さ'], ['predict', '予測'], ['log', 'ログ']];
const RESULT_OPTS = [['', '未決'], ['win', '勝ち'], ['lose', '負け'], ['draw', '引分']];

function useWide() {
  const q = '(min-width: 980px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setWide(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return wide;
}

export function BattleScreen({id}) {
  const {store, nav, toast} = useApp();
  const battle = store.battle(id);
  const wide = useWide();
  const [tab, setTab] = useState(() => (battle && battle.opp.length && battle.pick.me.length ? 'board' : 'setup'));
  const [confirm, setConfirm] = useState(false);
  const usage = battle ? store.state.usage[battle.format] : null;
  const ctx = useMemo(() => (battle ? boardContext(battle, usage) : null), [battle, usage]);
  if (!battle) return <div class="page"><Empty>この対戦は見つかりません。</Empty><button class="btn" onClick={() => nav('#/battles')}>対戦一覧へ</button></div>;

  // 対戦データを書き換えて保存する。fn には編集用のコピーが渡る。
  const mut = fn => {
    const b = clone(battle);
    const out = fn(b);
    normalizeBattle(b);
    store.saveBattle(b);
    return out;
  };
  const props = {battle, ctx, mut, usage, setTab, toast};
  const right = tab === 'board' && wide ? 'dmg' : tab;
  const body = t => {
    switch (t) {
      case 'setup': return <SelectTab {...props} />;
      case 'board': return <BoardTab {...props} />;
      case 'dmg': return <DamageTab {...props} />;
      case 'speed': return <SpeedTab {...props} />;
      case 'predict': return <PredictTab {...props} />;
      case 'log': return <LogTab {...props} onDelete={() => setConfirm(true)} />;
      default: return null;
    }
  };
  return (
    <div class="battle">
      <div class="battle-head">
        <button class="btn ghost" onClick={() => nav('#/battles')} aria-label="対戦一覧へ">‹</button>
        <div class="battle-title">
          <strong>{battle.teamName || '構築なし'}</strong>
          <span class="muted"> vs {battle.oppName || '相手'}</span>
          {battle.kind === 'sim' && <span class="tag accent">仮想盤面</span>}
          <span class="tag">{battle.format === 'double' ? 'ダブル' : 'シングル'}</span>
          <span class="tag">ターン {turnNumber(battle)}</span>
        </div>
        {battle.kind !== 'sim' && <Seg small value={battle.result} options={RESULT_OPTS} onChange={v => mut(b => { b.result = v; })} />}
      </div>
      <div class="tabs" role="tablist">
        {TABS.filter(([k]) => !(wide && k === 'board')).map(([k, label]) => (
          <button role="tab" aria-selected={right === k} class={cx(right === k && 'on')} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {wide ? (
        <div class="battle-cols">
          <div class="col-board"><BoardTab {...props} /></div>
          <div class="col-side">{body(right)}</div>
        </div>
      ) : <div class="battle-body">{body(tab)}</div>}
      {confirm && <Confirm title="対戦を削除" message="この対戦の記録を削除します。元に戻せません。" okLabel="削除する" danger
        onOk={async () => { await store.deleteBattle(battle.id); nav('#/battles'); }} onClose={() => setConfirm(false)} />}
    </div>
  );
}

// ---- 見せ合い ----
function SetupTab({battle, ctx, mut, usage, setTab, toast}) {
  const {store} = useApp();
  const [pick, setPick] = useState(null);
  const [oppEdit, setOppEdit] = useState(null);
  const [myEdit, setMyEdit] = useState(null);
  const [matrix, setMatrix] = useState(false);
  const battles = store.battles();
  const nLead = activeCount(battle.format), nPick = pickCount(battle.format);
  const sim = useMemo(() => similarTeams(battles.filter(b => b.id !== battle.id), battle.opp.map(o => o.species), {format: battle.format}), [battles, battle.opp, battle.format]);
  const usageRank = useMemo(() => (usage?.pokemon ? Object.fromEntries(Object.entries(usage.pokemon).map(([k, v]) => [k, v.u])) : null), [usage]);

  const togglePick = (side, i) => mut(b => {
    const list = b.pick[side];
    const at = list.indexOf(i);
    if (at >= 0) {
      list.splice(at, 1);
      const s = b.state.sides[side];
      s.active = s.active.map(x => (x === i ? null : x));
    } else if (side === 'opp' || list.length < nPick) list.push(i);
  });
  const start = () => {
    if (!battle.pick.me.length) { toast('自分の選出をタップで選んでください'); return; }
    mut(b => {
      for (const side of ['me', 'opp']) {
        leadsOf(b, side).forEach((mi, slot) => { if (b.state.sides[side].active[slot] == null) sendOut(b, side, slot, mi, {resolveAbility: ctx.strictAbility}); });
      }
    });
    setTab('board');
  };
  const leadShown = battle.state.sides.me.active.some(x => x != null);
  return (
    <div class="page-in">
      <div class="form">
        <label class="field grow"><span>相手の名前 (任意)</span><input class="input" value={battle.oppName} onChange={e => mut(b => { b.oppName = e.currentTarget.value; })} /></label>
        <label class="field"><span>日付</span><input class="input" type="date" value={battle.date} onChange={e => mut(b => { b.date = e.currentTarget.value; })} /></label>
        <div class="field"><span>ルール</span><Seg value={battle.format} options={FORMAT_OPTS} onChange={v => mut(b => { b.format = v; })} /></div>
      </div>

      <h3>相手のパーティ <span class="muted">タップで情報を入力 / 番号は選出された順</span></h3>
      <div class="party">
        {battle.opp.map((o, i) => {
          const v = ctx.views[i];
          const st = oppSpeciesStats(battles.filter(b => b.id !== battle.id), o.species, {format: battle.format});
          const order = battle.pick.opp.indexOf(i);
          return (
            <div class={cx('party-row', order >= 0 && 'picked')} key={i}>
              <button class={cx('pick-no', order >= 0 && 'on', order >= 0 && order < nLead && 'lead')} onClick={() => togglePick('opp', i)} aria-label="選出された">{order >= 0 ? order + 1 : '・'}</button>
              <button class="party-main" onClick={() => setOppEdit(i)}>
                <MonName id={o.species} />
                <span class="party-sub">
                  {v && <span>{v.megaForme ? `${speciesName(v.megaForme)}想定` : ''} {itemName(v.build.item) || '持ち物?'}{v.itemGuess ? '?' : ''} / {abilityName(v.build.ability)}{v.abilityGuess ? '?' : ''} / {spreadLabel(v.build.nature, v.build.sp)}</span>}
                </span>
                <span class="party-sub">
                  {v?.hasData && <span class="stat-pill">採用率 {rate(v.usageAll || 0, 1)}・初手率 {rate(leadRate(v, battle.format))}</span>}
                  {st.seen > 0 && <span class="stat-pill mine">自分の記録 {st.seen}戦: 選出 {st.picked}・初手 {st.lead}</span>}
                </span>
              </button>
            </div>
          );
        })}
        {battle.opp.length < 6 && <button class="card add" onClick={() => setPick({side: 'opp'})}>＋ 相手のポケモンを追加 ({battle.opp.length}/6)</button>}
      </div>
      {sim.n > 0 && (
        <div class="box">
          <h4>似た並びとの過去の対戦 {sim.n}戦 ({sim.win}勝 {sim.lose}敗)</h4>
          <div class="chips">
            {battle.opp.filter(o => sim.picked[o.species]).sort((a, b) => sim.picked[b.species] - sim.picked[a.species]).map(o => (
              <span class="chip">{speciesName(o.species)} 選出 {sim.picked[o.species]}/{sim.n}{sim.lead[o.species] ? ` (初手 ${sim.lead[o.species]})` : ''}</span>
            ))}
          </div>
        </div>
      )}

      <h3>自分の選出 <span class="muted">タップした順に選出。先頭{nLead}体が初手 ({battle.pick.me.length}/{nPick})</span></h3>
      <div class="party">
        {battle.my.map((m, i) => {
          const order = battle.pick.me.indexOf(i);
          return (
            <div class={cx('party-row', order >= 0 && 'picked')} key={i}>
              <button class={cx('pick-no', order >= 0 && 'on', order >= 0 && order < nLead && 'lead')} onClick={() => togglePick('me', i)} aria-label="選出する">{order >= 0 ? order + 1 : '・'}</button>
              <button class="party-main" onClick={() => setMyEdit(i)}>
                <MonName id={m.species} />
                <span class="party-sub">{itemName(m.item) || '持ち物なし'} / {abilityName(m.ability)} / {buildSummary(m)}</span>
                <span class="party-sub">{(m.moves || []).map(moveName).join('・')}</span>
              </button>
            </div>
          );
        })}
        {battle.my.length < 6 && <button class="card add" onClick={() => setPick({side: 'me'})}>＋ 自分のポケモンを追加 ({battle.my.length}/6)</button>}
      </div>
      <div class="btnrow pad-s">
        <button class="btn" onClick={() => setMatrix(m => !m)}>{matrix ? '相性表を閉じる' : '6×6 相性表を見る'}</button>
        <button class="btn primary" onClick={start}>{leadShown ? '盤面へ' : '初手を場に出して開始'}</button>
      </div>
      {matrix && <Matrix battle={battle} ctx={ctx} />}

      {pick && <Picker kind="species" title={pick.side === 'opp' ? '相手のポケモン' : '自分のポケモン'} rank={usageRank} onClose={() => setPick(null)}
        filter={id => !dex.species[id].mega && !dex.species[id].bo}
        onPick={sid => {
          if (pick.side === 'opp') { mut(b => { b.opp.push(newOpp(sid)); }); if (battle.opp.length >= 5) setPick(null); }
          else { setPick(null); setMyEdit({add: sid}); }
        }} />}
      {oppEdit != null && battle.opp[oppEdit] && <OppSheet battle={battle} idx={oppEdit} ctx={ctx} mut={mut} usage={usage} onClose={() => setOppEdit(null)} />}
      {myEdit != null && (
        <MonEditor title="この対戦での自分の型" usage={usage} isNew={myEdit.add != null}
          build={myEdit.add != null ? {species: myEdit.add, item: '', ability: dex.species[myEdit.add].ab[0], nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: ''} : battle.my[myEdit]}
          onSave={bd => { mut(b => { if (myEdit.add != null) b.my.push(bd); else b.my[myEdit] = bd; }); setMyEdit(null); }} onClose={() => setMyEdit(null)} />
      )}
    </div>
  );
}

// 6×6 の相性表: 自分の最大打点 (与) と相手の最大打点 (被)
function Matrix({battle, ctx}) {
  const data = useMemo(() => {
    const give = battle.my.map((_, i) => attackTable(ctx, 'me', i));
    const take = battle.opp.map((_, i) => attackTable(ctx, 'opp', i));
    return {give, take};
  }, [ctx]);
  if (!battle.opp.length || !battle.my.length) return <Empty>自分と相手のポケモンを登録すると表示されます。</Empty>;
  const cell = r => (r ? <span class={cx('mx', dmgClass(r))}>{r.immune ? '無効' : `${fmtPct(r.maxPct)}%`}</span> : <span class="mx none">—</span>);
  return (
    <div class="box">
      <h4>相性表 <span class="muted">上段: 自分→相手の最大打点 / 下段: 相手→自分の最大打点 (相手は推定型・候補技)</span></h4>
      <div class="scroll-x">
        <table class="matrix">
          <thead><tr><th></th>{battle.opp.map(o => <th>{speciesName(o.species)}</th>)}</tr></thead>
          <tbody>
            {battle.my.map((m, i) => (
              <tr>
                <th>{speciesName(m.species)}</th>
                {battle.opp.map((_, j) => {
                  const g = data.give[i]?.targets.find(t => t.idx === j)?.best;
                  const t = data.take[j]?.targets.find(t2 => t2.idx === i)?.best;
                  return <td><div class="mx-pair">{cell(g)}{cell(t)}</div></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function dmgClass(r) {
  if (!r || !r.ok || r.status) return 'none';
  if (r.immune) return 'immune';
  if (r.n === 1 && r.guaranteed) return 'ko1';
  if (r.n === 1) return 'ko1r';
  if (r.n === 2) return 'ko2';
  if (r.n === 3) return 'ko3';
  return 'low';
}

// ---- 相手1体の情報 ----
export function OppSheet({battle, idx, ctx, mut, usage, onClose}) {
  const [pick, setPick] = useState(null);
  const [custom, setCustom] = useState(false);
  const o = battle.opp[idx];
  const v = ctx.views[idx];
  const s = dex.species[o.species];
  if (!o || !s) return null;
  const set = fn => mut(b => fn(b.opp[idx], b));
  const as = o.assume || {kind: 'usage', idx: 0};
  const moveRank = v ? Object.fromEntries(v.moves.filter(m => !m.known).map(m => [m.id, m.rate])) : null;
  const itemRank = v?.items?.length ? Object.fromEntries(v.items) : null;
  const megas = s.megas || [];
  const megaItems = megas.map(m => dex.species[m].stone);
  const allItemRank = useMemo(() => {
    const r = {...(itemRank || {})};
    for (const e of megas) { const d = usage?.pokemon?.[e]; if (d) r[dex.species[e].stone] = Math.max(r[dex.species[e].stone] || 0, d.u / Math.max(d.u, usage.pokemon[o.species]?.u || 0.0001)); }
    return Object.keys(r).length ? r : null;
  }, [usage, o.species]);
  return (
    <Sheet title={`相手の${speciesName(o.species)}`} onClose={onClose} wide>
      <div class="editor">
        <p class="hint">判明したことだけ入力してください。未入力の部分は使用率データから推定します (「?」付きが推定)。</p>
        <div class="form">
          <div class="field grow"><span>持ち物 {v?.itemGuess && <em class="guess">推定: {itemName(v.build.item) || 'なし'}</em>}</span>
            <button class="input as-btn" onClick={() => setPick('item')}>{o.item ? itemName(o.item) : <span class="muted">不明</span>}</button>
          </div>
          <div class="field grow"><span>特性 {v?.abilityGuess && <em class="guess">推定: {abilityName(v.build.ability)}</em>}</span>
            <Seg wrap value={o.ability || ''} options={[['', '不明'], ...s.ab.map(a => [a, abilityName(a)])]} onChange={val => set(x => { x.ability = val; })} />
          </div>
        </div>
        {megas.length > 0 && <p class="hint">メガシンカの見込み: {v?.megaForme ? `${speciesName(v.megaForme)} として計算 (${v.megaWhy})` : `通常の姿で計算${ctx.megaBlocked ? ' (相手は別のポケモンがメガシンカ済み)' : v ? ` (メガ使用率 ${rate(v.megaP)})` : ''}`}。メガストーン ({megaItems.map(itemName).join(' / ')}) を持ち物に入れると確定します。</p>}

        <div class="field"><span>判明した技 ({o.moves.length}/4)</span>
          <div class="chips">
            {o.moves.map(m => <button class="chip del" onClick={() => set(x => { x.moves = x.moves.filter(y => y !== m); })}><TypeChip type={dex.moves[m]?.t} small />{moveName(m)} ×</button>)}
            {o.moves.length < 4 && <button class="chip add" onClick={() => setPick('move')}>＋ 技を追加</button>}
          </div>
          {v && o.moves.length < 4 && (
            <div class="chips">
              {v.moves.filter(m => !m.known).slice(0, 10).map(m => (
                <button class="chip ghost" onClick={() => set(x => { if (x.moves.length < 4) x.moves.push(m.id); })}>{moveName(m.id)} <span class="rate">{rate(m.rate)}</span></button>
              ))}
            </div>
          )}
        </div>

        <div class="field"><span>計算に使う配分 <em class="guess">{v ? `${spreadLabel(v.build.nature, v.build.sp)} (${v.spreadSource}${v.spreadRate != null ? ` ${rate(v.spreadRate, 1)}` : ''})` : ''}</em></span>
          <div class="chips">
            {(v?.spreads || []).slice(0, 6).map((sp, i) => (
              <button class={cx('chip', as.kind === 'usage' && (as.idx || 0) === i && 'on')} onClick={() => set(x => { x.assume = {kind: 'usage', idx: i}; })}>
                {o.statOk && !spreadFits(o, sp.nature, sp.sp) ? '✕ ' : ''}{i + 1}位 {spreadLabel(sp.nature, sp.sp)} <span class="rate">{rate(sp.rate, 1)}</span>
              </button>
            ))}
            {!(v?.spreads || []).length && <span class="muted">このポケモンの使用率データがありません。下の型から選んでください。</span>}
          </div>
          <div class="chips">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button class={cx('chip', as.kind === 'preset' && as.key === k && 'on')} onClick={() => set(x => { x.assume = {kind: 'preset', key: k}; })}>{p.label}</button>
            ))}
            <button class={cx('chip', as.kind === 'custom' && 'on')} onClick={() => setCustom(true)}>手入力…</button>
          </div>
        </div>

        {o.speOk && (
          <div class="field"><span>行動順から絞り込んだ素早さ</span>
            <p class="hint">
              {speedRangeText(o, v, battle, idx)}
              <button class="btn ghost sm" onClick={() => set(x => { x.speOk = null; x.scarfLikely = false; })}>絞り込みをリセット</button>
            </p>
          </div>
        )}
        {o.statOk && (
          <div class="field"><span>ダメージから絞り込んだ能力</span>
            <p class="hint">{Object.keys(o.statOk).map(k => ({atk: 'こうげき', spa: 'とくこう', def: 'HP・ぼうぎょ', spd: 'HP・とくぼう'}[k])).join('、')} を絞り込み済み。合わない配分は下の候補に ✕ が付きます。
              <button class="btn ghost sm" onClick={() => set(x => { x.statOk = null; })}>絞り込みをリセット</button></p>
          </div>
        )}
        <label class="field"><span>メモ</span><textarea class="input" rows={2} value={o.note || ''} onChange={e => set(x => { x.note = e.currentTarget.value; })} /></label>
        <div class="btnrow">
          <button class="btn" onClick={() => setPick('species')}>ポケモンを変更</button>
          <button class="btn danger" onClick={() => { mut(b => {
            b.opp.splice(idx, 1); b.state.mons.opp.splice(idx, 1);
            const fix = i => (i === idx ? null : i > idx ? i - 1 : i);
            b.pick.opp = b.pick.opp.map(fix).filter(i => i != null);
            b.state.sides.opp.active = b.state.sides.opp.active.map(i => (i == null ? null : fix(i)));
          }); onClose(); }}>パーティから外す</button>
        </div>
      </div>
      {pick === 'item' && <Picker kind="items" title="相手の持ち物" allowClear clearLabel="不明に戻す" rank={allItemRank} onClose={() => setPick(null)}
        filter={id => !dex.items[id].ms || !!dex.items[id].ms[o.species]}
        onPick={id => { set(x => { x.item = id; }); setPick(null); }} />}
      {pick === 'move' && <Picker kind="moves" title="判明した技" rank={moveRank} prefer={dex.learn[o.species]} preferLabel="覚えない技も表示" onClose={() => setPick(null)}
        onPick={id => { set(x => { if (!x.moves.includes(id) && x.moves.length < 4) x.moves.push(id); }); setPick(null); }} />}
      {pick === 'species' && <Picker kind="species" title="ポケモンを変更" onClose={() => setPick(null)} filter={id => !dex.species[id].mega && !dex.species[id].bo}
        onPick={id => { set((x, b) => { Object.assign(x, newOpp(id), {note: x.note}); b.state.mons.opp[idx].forme = null; }); setPick(null); }} />}
      {custom && <MonEditor title="相手の配分を手入力" lockSpecies usage={usage}
        build={{species: o.species, item: v?.build.item || '', ability: v?.build.ability || s.ab[0], nature: v?.build.nature || 'Serious', sp: (v?.build.sp || [0, 0, 0, 0, 0, 0]).slice(), moves: o.moves.slice(), note: ''}}
        onSave={bd => { set(x => { x.assume = {kind: 'custom', nature: bd.nature, sp: bd.sp}; x.moves = bd.moves.slice(0, 4); if (bd.item !== (v?.build.item || '')) x.item = bd.item; if (bd.ability !== v?.build.ability) x.ability = bd.ability; }); setCustom(false); }}
        onClose={() => setCustom(false)} />}
    </Sheet>
  );
}

function speedRangeText(o, v, battle, idx) {
  const txt = [];
  const sid = battle.state.mons.opp[idx].forme || v?.megaForme || o.species;
  for (const [key, label] of [['plain', 'スカーフなし'], ['scarf', 'スカーフあり']]) {
    const mask = o.speOk?.[key];
    if (!mask) continue;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < SPE_COMBOS; i++) if (mask[i] === '1') { const val = speFromCombo(sid, i); lo = Math.min(lo, val); hi = Math.max(hi, val); }
    txt.push(Number.isFinite(lo) ? `${label}: 実数値 ${lo}〜${hi}` : `${label}: ありえない`);
  }
  return `${speciesName(sid)} ${txt.join(' / ')} `;
}

// ---- ログ ----
function LogTab({battle, mut, onDelete, toast}) {
  return (
    <div class="page-in">
      <div class="btnrow">
        <button class="btn" disabled={!battle.turns.length || !battle.turns[battle.turns.length - 1].before}
          onClick={() => { mut(b => { undoTurn(b); }); toast('直前のターンを取り消しました'); }}>直前のターンを取り消す</button>
      </div>
      {!battle.turns.length && <Empty>まだターンの記録がありません。盤面の「ターンを記録」から入力します。</Empty>}
      <ol class="log">
        {battle.turns.map((t, ti) => (
          <li key={t.n}>
            <div class="log-head"><strong>ターン {t.n}</strong>{t.orderKnown && <span class="tag">行動順あり</span>}</div>
            {t.acts.map(a => <div class={cx('log-act', a.side)}>{describeAct(battle, a)}</div>)}
            {(t.auto || []).map(x => <div class="log-auto">{x}</div>)}
            <input class="input log-note" placeholder="このターンのメモ" value={t.note || ''} onChange={e => mut(b => { b.turns[ti].note = e.currentTarget.value; })} />
          </li>
        ))}
      </ol>
      <label class="field"><span>対戦メモ (反省点・気づき)</span>
        <textarea class="input" rows={5} value={battle.memo} onChange={e => mut(b => { b.memo = e.currentTarget.value; })} />
      </label>
      <div class="field"><span>種類</span>
        <Seg value={battle.kind} options={[['battle', '実際の対戦 (統計に含める)'], ['sim', '仮想盤面 (統計に含めない)']]} onChange={v => mut(b => { b.kind = v; })} />
      </div>
      <div class="btnrow pad-s"><button class="btn danger" onClick={onDelete}>この対戦を削除</button></div>
    </div>
  );
}
