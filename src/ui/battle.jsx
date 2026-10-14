// 対戦画面: 見せ合い・盤面・ダメージ・素早さ・予測・ログ
import {useEffect, useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName} from '../engine/dex.js';
import {clone, normalizeBattle, newOpp, describeAct} from '../engine/battle.js';
import {boardContext} from '../engine/board.js';
import {spreadLabel, PRESETS, SPE_COMBOS, speFromCombo} from '../engine/assume.js';
import {useApp, Sheet, Picker, Seg, TypeChip, Empty, Confirm, cx, rate} from './common.jsx';
import {MonEditor} from './teams.jsx';
import {SelectTab} from './select.jsx';
import {Arena, OppStatTable} from './arena.jsx';
import {spreadFits} from '../engine/infer-dmg.js';
import {DamageTab} from './analysis.jsx';
import {BattleLog} from './turn.jsx';

const TABS = [['setup', '① 選出'], ['board', '② 対戦'], ['dmg', '③ ダメージ計算']];
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
  // 同じ操作の中で続けて書き換えても前の変更を失わないよう、保存済みの最新から複製する
  const mut = fn => {
    const b = clone(store.battle(id) || battle);
    const out = fn(b);
    normalizeBattle(b);
    store.saveBattle(b);
    return out;
  };
  const props = {battle, ctx, mut, usage, setTab, toast, onDelete: () => setConfirm(true)};
  const body = t => {
    switch (t) {
      case 'setup': return <SelectTab {...props} />;
      case 'board': return <Arena {...props} wide={wide} />;
      case 'dmg': return <DamageTab {...props} />;
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
        </div>
        {battle.kind !== 'sim' && <Seg small value={battle.result} options={RESULT_OPTS} onChange={v => mut(b => { b.result = v; })} />}
      </div>
      <div class="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button role="tab" aria-selected={tab === k} class={cx(tab === k && 'on')} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div class="battle-body">{body(tab)}</div>
      {confirm && <Confirm title="対戦を削除" message="この対戦の記録を削除します。元に戻せません。" okLabel="削除する" danger
        onOk={async () => { await store.deleteBattle(battle.id); nav('#/battles'); }} onClose={() => setConfirm(false)} />}
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
  // 持ち物の率は、通常の姿とメガの使用率で重みづけ済み (メガストーンが 100% にならない)
  const allItemRank = itemRank;
  const usedInLog = battle.pick.opp.includes(idx) || battle.state.sides.opp.active.includes(idx) || battle.turns.some(t => t.acts.some(a => (a.side === 'opp' && (a.mon === idx || a.to === idx)) || (a.target?.side === 'opp' && a.target.mon === idx)));
  return (
    <Sheet title={`相手の${speciesName(o.species)}`} onClose={onClose} wide>
      <div class="editor">
        <div class="os-info">
          <div class="os-row"><span class="os-lb">持ち物</span>
            <button class="input as-btn" onClick={() => setPick('item')}>{o.item ? itemName(o.item) : <span class="muted">不明</span>}</button>
          </div>
          <div class="os-row"><span class="os-lb">特性</span>
            {dex.species[battle.state.mons.opp[idx]?.forme]?.mega
              ? <b>{abilityName(dex.species[battle.state.mons.opp[idx].forme].ab[0])}</b>
              : <Seg wrap value={o.ability || ''} options={[['', '不明'], ...s.ab.map(a => [a, abilityName(a)])]} onChange={val => set(x => { x.ability = val; })} />}
          </div>
        </div>
        <div class="scroll-x"><OppStatTable battle={battle} idx={idx} /></div>
        <div class="field"><span>技</span>
          <div class="moves4">
            {[0, 1, 2, 3].map(i => {
              const m = o.moves[i];
              return m
                ? <button class="chip" onClick={() => set(x => { x.moves = x.moves.filter(y => y !== m); })} title="押すと外します"><TypeChip type={dex.moves[m]?.t} small /><span class="mv-nm">{moveName(m)}</span><span class="muted"> ×</span></button>
                : <button class="chip empty" onClick={() => setPick('move')}>—</button>;
            })}
          </div>
        </div>
        {v && (
          <div class="field"><span>技の採用率 (押すと判明した技に入れます)</span>
            <div class="os-rates">
              {v.moves.slice(0, 12).map(m => (
                <button class={cx('os-rate', m.known && 'known')} disabled={m.known || o.moves.length >= 4} onClick={() => set(x => { if (x.moves.length < 4 && !x.moves.includes(m.id)) x.moves.push(m.id); })}>
                  <span class={cx('mv-bar', `t-${dex.moves[m.id]?.t}`)} /><span class="mv-nm">{moveName(m.id)}</span><b class="num">{m.rate != null ? rate(m.rate) : ''}</b>
                </button>
              ))}
            </div>
          </div>
        )}
        {megas.length > 0 && <p class="hint">メガシンカ: {battle.state.mons.opp[idx]?.forme ? 'メガシンカ済み (メガの種族値で計算)' : `まだしていないので通常の姿で計算${ctx.megaBlocked ? ' (相手は別のポケモンがメガシンカ済み)' : v ? ` ・ 使用率上のメガ率 ${rate(v.megaP)}` : ''}`}。メガシンカしたら、盤面の名前の横の「メガ」ボタンを押してください。</p>}

        <div class="field"><span>能力振りの採用率 (参考。ダメージ計算で、まだ絞り込めていない能力の仮の値に使います。上の能力表の絞り込みには使いません) <em class="guess">{v ? `${spreadLabel(v.build.nature, v.build.sp)} (${v.spreadSource}${v.spreadRate != null ? ` ${rate(v.spreadRate, 1)}` : ''})` : ''}</em></span>
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
            <p class="hint">{Object.keys(o.statOk).map(k => ({atk: 'こうげき', spa: 'とくこう', def: 'HP・ぼうぎょ', spd: 'HP・とくぼう'}[k])).join('、')} を観測から絞り込み済み。
              <button class="btn ghost sm" onClick={() => set(x => { x.statOk = null; })}>絞り込みをリセット</button></p>
          </div>
        )}
        <label class="field"><span>メモ</span><textarea class="input" rows={2} value={o.note || ''} onChange={e => set(x => { x.note = e.currentTarget.value; })} /></label>
        <div class="btnrow">
          <button class="btn" onClick={() => setPick('species')}>ポケモンを変更</button>
          {/* 対戦の記録に出てきたポケモンを外すと、記録の番号がずれて壊れるので外せない */}
          {!usedInLog && <button class="btn danger" onClick={() => { mut(b => {
            b.opp.splice(idx, 1); b.state.mons.opp.splice(idx, 1);
            const fix = i => (i === idx ? null : i > idx ? i - 1 : i);
            b.pick.opp = b.pick.opp.map(fix).filter(i => i != null);
            b.state.sides.opp.active = b.state.sides.opp.active.map(i => (i == null ? null : fix(i)));
          }); onClose(); }}>パーティから外す</button>}
        </div>
        {usedInLog && <p class="hint">対戦の記録に出てきたポケモンなのでパーティから外せません。見間違いなら「ポケモンを変更」で直せます。</p>}
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
  const sid = battle.state.mons.opp[idx].forme || o.species;
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
export function LogTab({battle, mut, onDelete, ctx, usage, toast}) {
  return (
    <div class="page-in">
      {ctx ? <BattleLog battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} notes /> : (
        <ol class="log">
          {battle.turns.map((t, ti) => (
            <li key={t.n}>
              <div class="log-head"><strong>ターン {t.n}</strong></div>
              {t.acts.map(a => <div class={cx('log-act', a.side)}>{describeAct(battle, a)}</div>)}
              <input class="input log-note" placeholder="このターンのメモ" value={t.note || ''} onChange={e => mut(b => { b.turns[ti].note = e.currentTarget.value; })} />
            </li>
          ))}
        </ol>
      )}
      <label class="field"><span>対戦のメモ (反省点・気づき)</span>
        <textarea class="input" rows={5} value={battle.memo} onChange={e => mut(b => { b.memo = e.currentTarget.value; })} />
      </label>
      <div class="field"><span>種類</span>
        <Seg value={battle.kind} options={[['battle', '実際の対戦 (統計に含める)'], ['sim', '仮想盤面 (統計に含めない)']]} onChange={v => mut(b => { b.kind = v; })} />
      </div>
      <div class="btnrow pad-s"><button class="btn danger" onClick={onDelete}>この対戦を削除</button></div>
    </div>
  );
}
