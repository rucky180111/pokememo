// 盤面 (仮想のゲーム状況) の表示と編集、ターンの記録
import {useEffect, useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies, currentAbility, turnOrder, emptyBoosts} from '../engine/calc.js';
import {sendOut, megaEvolve, megaTarget, setHP, setWeather, setTerrain, setSideFlag, setFieldFlag, turnNumber, undoTurn, buildOf, condOf, other, PIVOT_MOVES} from '../engine/battle.js';
import {commitTurnInfer} from '../engine/infer.js';
import {attackTable, speedTable} from '../engine/board.js';
import {dmgClass} from './battle.jsx';
import {useApp, Sheet, Picker, Seg, Toggle, Stepper, MonName, TypeChip, Empty, cx, fmtPct, rate} from './common.jsx';
import {OppSheet} from './battle.jsx';
import {MonEditor} from './teams.jsx';

const BOOST_JA = {atk: 'A', def: 'B', spa: 'C', spd: 'D', spe: 'S'};
const SIDE_JA = {me: '自分', opp: '相手'};
const STATUS_JA = Object.fromEntries(STATUSES);
const FLAGS = [['reflect', 'リフレクター', '5〜8'], ['lightScreen', 'ひかりのかべ', '5〜8'], ['auroraVeil', 'オーロラベール', '5〜8'], ['tailwind', 'おいかぜ', 4], ['sr', 'ステルスロック']];

function since(b, obj, key, max) {
  const t = obj.since?.[key];
  if (!t || !max) return '';
  const n = turnNumber(b) - t + 1;
  return ` ${n}/${max}T`;
}

export function BoardTab({battle, ctx, mut, usage, toast, setTab}) {
  const [turn, setTurn] = useState(false);
  const [sheet, setSheet] = useState(null); // {side, idx}
  const f = battle.state.field;
  const hasOpp = battle.opp.length > 0;
  const [sel, setSel] = useState({me: null, opp: null, first: ''});
  const aliveAct = side => battle.state.sides[side].active.filter(i => i != null && !condOf(battle, side, i)?.fainted);
  const myAct = aliveAct('me'), oppAct = aliveAct('opp');
  // シングルで両者が場にいるときは、盤面のタップだけで1ターンを記録できる
  const quick = battle.format === 'single' && myAct.length === 1 && oppAct.length === 1;
  const info = useMemo(() => benchInfo(battle, ctx, myAct, oppAct), [ctx]);
  const label = (side, a) => (!a ? '未選択' : a.type === 'switch' ? `${speciesName(buildOf(battle, side, a.to)?.species)}に交代` : moveName(a.move));
  const record = () => {
    if (!sel.me && !sel.opp) { toast('自分か相手の行動をタップで選んでください'); return; }
    const mk = (side, mon, a) => (a ? {side, mon, type: a.type, move: a.move || '', to: a.to ?? null, mega: !!a.mega, target: null, flags: {}} : null);
    const A = mk('me', myAct[0], sel.me), O = mk('opp', oppAct[0], sel.opp);
    let acts = [A, O].filter(Boolean);
    if (A && O) {
      let order = sel.first;
      if (!order) {
        const key = (side, mon, a) => ({build: ctx.build(side, mon), cond: ctx.cond(side, mon), moveId: a.type === 'switch' ? null : a.move, side: battle.state.sides[side]});
        const o = turnOrder(key('me', A.mon, A), key('opp', O.mon, O), {format: battle.format, field: battle.state.field});
        order = o === 'b' ? 'opp' : 'me';
      }
      acts = order === 'opp' ? [O, A] : [A, O];
    }
    // HPの仮入力: 計算値の中央を引いておく (あとでスライダーで直す)
    const est = [];
    if (A?.type === 'move') { const tgt = O?.type === 'switch' ? O.to : oppAct[0]; const r = info.give?.targets.find(t => t.idx === tgt)?.results[A.move]; if (r?.ok && !r.status && !r.immune) est.push(['opp', tgt, (r.minPct + r.maxPct) / 2]); }
    if (O?.type === 'move') { const tgt = A?.type === 'switch' ? A.to : myAct[0]; const r = info.take?.targets.find(t => t.idx === tgt)?.results[O.move]; if (r?.ok && !r.status && !r.immune) est.push(['me', tgt, (r.minPct + r.maxPct) / 2]); }
    mut(b => {
      commitTurnInfer(b, {acts, orderKnown: !!sel.first && A?.type === 'move' && O?.type === 'move', note: ''}, {resolveAbility: ctx.strictAbility});
      for (const [side, i, d] of est) { const c = condOf(b, side, i); if (c && !c.fainted) setHP(b, side, i, Math.max(0, Math.round(c.hp - d))); }
    });
    setSel({me: null, opp: null, first: ''});
    toast(est.length ? 'ターンを記録しました。HPは計算値で仮入力したので、ずれていたら直してください' : 'ターンを記録しました');
  };
  return (
    <div class="board">
      <div class="fieldbar">
        <div class="fb-row">
          <label class="fb-lb">天候{since(battle, f, 'weather', '5〜8')}
            <select class="input sm" value={f.weather} onChange={e => mut(b => { setWeather(b, e.currentTarget.value); })}>{WEATHERS.map(([v, l]) => <option value={v}>{l}</option>)}</select>
          </label>
          <label class="fb-lb">フィールド{since(battle, f, 'terrain', '5〜8')}
            <select class="input sm" value={f.terrain} onChange={e => mut(b => { setTerrain(b, e.currentTarget.value); })}>{TERRAINS.map(([v, l]) => <option value={v}>{l}</option>)}</select>
          </label>
          <Toggle small on={f.trickRoom} onChange={v => mut(b => { setFieldFlag(b, 'trickRoom', v); })}>トリル{since(battle, f, 'trickRoom', 5)}</Toggle>
          <Toggle small on={f.gravity} onChange={v => mut(b => { setFieldFlag(b, 'gravity', v); })}>重力{since(battle, f, 'gravity', 5)}</Toggle>
        </div>
      </div>

      {!hasOpp && <Empty>「見せ合い」で相手のポケモンを登録すると、ここに盤面が出ます。</Empty>}
      <Side side="opp" battle={battle} ctx={ctx} mut={mut} onOpen={setSheet} quick={quick} sel={sel} setSel={setSel} info={info} />
      {hasOpp && <Matchup battle={battle} ctx={ctx} quick={quick} sel={sel} setSel={setSel} />}
      <Side side="me" battle={battle} ctx={ctx} mut={mut} onOpen={setSheet} quick={quick} sel={sel} setSel={setSel} info={info} />
      <div class="turnbar col">
        {quick && (
          <div class="qb-sum">
            <span class="side-tag me">自分</span><b class={cx(!sel.me && 'muted')}>{label('me', sel.me)}</b>
            <span class="side-tag opp">相手</span><b class={cx(!sel.opp && 'muted')}>{label('opp', sel.opp)}</b>
            {sel.me?.type === 'move' && megaTarget(battle, 'me', myAct[0]) && !battle.state.sides.me.megaUsed && <Toggle small on={!!sel.me.mega} onChange={v => setSel({...sel, me: {...sel.me, mega: v}})}>メガ</Toggle>}
            {sel.opp?.type === 'move' && megaTarget(battle, 'opp', oppAct[0]) && !battle.state.sides.opp.megaUsed && <Toggle small on={!!sel.opp.mega} onChange={v => setSel({...sel, opp: {...sel.opp, mega: v}})}>相手メガ</Toggle>}
            {sel.me?.type === 'move' && sel.opp?.type === 'move' && <Seg small value={sel.first} options={[['', '順番は記録しない'], ['me', '自分が先'], ['opp', '相手が先']]} onChange={v => setSel({...sel, first: v})} />}
          </div>
        )}
        <div class="qb-row">
          <span class="tag">ターン {turnNumber(battle)}</span>
          {quick
            ? <button class="btn primary grow" onClick={record}>このターンを記録</button>
            : <button class="btn primary grow" onClick={() => setTurn(true)} disabled={!hasOpp || (!myAct.length && !oppAct.length)}>このターンの行動を記録</button>}
          {quick && <button class="btn" onClick={() => setTurn(true)}>詳しく</button>}
          <button class="btn" disabled={!battle.turns.length || !battle.turns[battle.turns.length - 1].before}
            onClick={() => { mut(b => { undoTurn(b); }); setSel({me: null, opp: null, first: ''}); toast('直前のターンを取り消しました'); }}>戻す</button>
        </div>
      </div>

      {turn && <TurnSheet battle={battle} ctx={ctx} mut={mut} toast={toast} onClose={() => setTurn(false)} />}
      {sheet && sheet.side === 'opp' && battle.opp[sheet.idx] && <OppSheet battle={battle} idx={sheet.idx} ctx={ctx} mut={mut} usage={usage} onClose={() => setSheet(null)} />}
      {sheet && sheet.side === 'me' && battle.my[sheet.idx] && (
        <MonEditor title="この対戦での自分の型" usage={usage} build={battle.my[sheet.idx]}
          onSave={bd => { mut(b => { b.my[sheet.idx] = bd; }); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

// 控えの判断材料: 自分の場の技が相手の各ポケモンにどれだけ入るか / 相手の場の技が自分の各ポケモンにどれだけ入るか
function benchInfo(battle, ctx, myAct, oppAct) {
  const give = myAct.length ? attackTable(ctx, 'me', myAct[0]) : null;
  const take = oppAct.length ? attackTable(ctx, 'opp', oppAct[0]) : null;
  // 自分の控えが相手の場に撃てる最大打点
  const out = {};
  if (oppAct.length) battle.my.forEach((_, i) => { if (!myAct.includes(i) && !condOf(battle, 'me', i)?.fainted) out[i] = attackTable(ctx, 'me', i)?.targets.find(t => t.idx === oppAct[0])?.best || null; });
  return {give, take, out};
}

// 残りHPに対するダメージの帯: 濃い部分 = 最大ダメージ後も残るHP、薄い部分 = 乱数の幅
export function DmgBar({r, hp}) {
  if (!r?.ok || r.status) return <span class="dbar none" />;
  const lo = Math.max(0, hp - r.maxPct), hi = Math.max(0, hp - r.minPct);
  return (
    <span class="dbar" aria-hidden="true">
      <span class="d-left" style={{width: `${lo}%`}} />
      <span class="d-roll" style={{width: `${hi - lo}%`}} />
      <span class={cx('d-dmg', dmgClass(r))} style={{width: `${Math.max(0, hp - hi)}%`}} />
    </span>
  );
}

// いまの対面の要点: 先手・自分の技・相手の技
function Matchup({battle, ctx, quick, sel, setSel}) {
  const alive = side => battle.state.sides[side].active.filter(i => i != null && !condOf(battle, side, i)?.fainted);
  const mine = alive('me'), opps = alive('opp');
  const data = useMemo(() => mine.map(mi => ({mi, give: attackTable(ctx, 'me', mi), spd: speedTable(ctx, mi)})), [ctx]);
  const take = useMemo(() => opps.map(oi => ({oi, t: attackTable(ctx, 'opp', oi, {includeStatus: !!quick})})), [ctx, quick]);
  if (!mine.length || !opps.length) return null;
  const tr = battle.state.field.trickRoom;
  const line = (label, r, hp, extra, side, moveId) => {
    const on = quick && sel[side]?.type === 'move' && sel[side].move === moveId;
    const Tag = quick ? 'button' : 'div';
    return (
    <Tag class={cx('mu-row', quick && 'tap', on && 'on')} aria-pressed={quick ? on : undefined} onClick={quick ? () => setSel({...sel, [side]: on ? null : {type: 'move', move: moveId}}) : undefined}>
      <span class="mu-mv">{label}{extra}</span>
      <DmgBar r={r} hp={hp} />
      <span class={cx('mu-val num', dmgClass(r))}>{!r?.ok ? '—' : r.status ? '変化' : r.immune ? '無効' : `${fmtPct(r.minPct)}–${fmtPct(r.maxPct)}%`}</span>
      <span class="mu-ko">{r?.ok && !r.status && !r.immune ? r.koText : ''}</span>
    </Tag>
    );
  };
  return (
    <section class="matchup">
      {data.map(({mi, give, spd}) => opps.map(oi => {
        const row = spd?.rows.find(x => x.idx === oi)?.outlook;
        const tgt = give?.targets.find(t => t.idx === oi);
        const back = take.find(x => x.oi === oi)?.t;
        const backT = back?.targets.find(t => t.idx === mi);
        const oppMoves = (back?.moves || []).filter(m => backT?.results[m.id]?.ok && (quick || !backT.results[m.id].status))
          .sort((a, b2) => (b2.known - a.known) || (backT.results[b2.id].maxPct - backT.results[a.id].maxPct) || (b2.rate - a.rate)).slice(0, quick ? 10 : 4);
        const oHP = ctx.cond('opp', oi).hp, mHP = ctx.cond('me', mi).hp;
        const assumed = row ? row.dist.length ? null : null : null;
        void assumed;
        return (
          <div class="mu" key={`${mi}-${oi}`}>
            <div class="mu-head">
              <strong>{speciesName(give.species)}</strong><span class="muted"> vs </span><strong>{speciesName(tgt?.species || battle.opp[oi].species)}</strong>
              {row && <span class="mu-spd">
                S <b class="num">{spd.my}</b> : <span class="num">{row.bench[3].eff}〜{row.bench[0].eff}</span>
                {row.pFaster != null && <span class={cx('tag', row.pSlower >= 0.995 ? 'res-win' : row.pFaster >= 0.995 ? 'res-lose' : '')}>{tr ? 'トリル ' : ''}先手 {rate(row.pSlower)}</span>}
              </span>}
            </div>
            <div class="mu-cap me">自分の技 → 相手 (残り{Math.round(oHP)}%){quick && <span class="muted"> タップで選択</span>}</div>
            {(give?.moves || []).map(m => line(moveName(m.id), tgt?.results[m.id], oHP, m.priority > 0 ? <span class="tag sm">先制</span> : null, 'me', m.id))}
            <div class="mu-cap opp">相手の技 → 自分 (残り{Math.round(mHP)}%){quick && <span class="muted"> 相手が使った技をタップ</span>}</div>
            {oppMoves.map(m => line(moveName(m.id), backT.results[m.id], mHP, m.known ? <span class="tag sm">確定</span> : <span class="rate"> {rate(m.rate)}</span>, 'opp', m.id))}
            {!oppMoves.length && <div class="muted mu-row">候補技なし</div>}
          </div>
        );
      }))}
    </section>
  );
}

function Side({side, battle, ctx, mut, onOpen, quick, sel, setSel, info}) {
  const s = battle.state.sides[side];
  const list = side === 'me' ? battle.my : battle.opp;
  const [sendSlot, setSendSlot] = useState(null);
  const [showFlags, setShowFlags] = useState(false);
  const flag = (key, label, max) => (
    <Toggle small on={s[key]} onChange={v => mut(b => { setSideFlag(b, side, key, v); })}>{label}{since(battle, s, key, max)}</Toggle>
  );
  const bench = list.map((_, i) => i).filter(i => !s.active.includes(i));
  const doSend = (slot, i) => { mut(b => { sendOut(b, side, slot, i, {resolveAbility: ctx.strictAbility}); }); setSendSlot(null); };
  const emptySlot = s.active.findIndex(x => x == null || condOf(battle, side, x)?.fainted);
  return (
    <section class={cx('side', side)}>
      <div class="side-head">
        <h3>{SIDE_JA[side]}</h3>
        <div class="side-sum">
          {FLAGS.filter(([k]) => s[k]).map(([k, label, max]) => <span class="tag accent">{label}{since(battle, s, k, max)}</span>)}
          {s.spikes > 0 && <span class="tag accent">まきびし×{s.spikes}</span>}
          <Toggle small on={showFlags} onChange={setShowFlags}>壁・設置技</Toggle>
        </div>
      </div>
      {showFlags && (
        <div class="side-flags">
          {FLAGS.map(([k, label, max]) => flag(k, label, max))}
          <Stepper label="まきびし" value={s.spikes} min={0} max={3} onChange={v => mut(b => { b.state.sides[side].spikes = v; })} />
        </div>
      )}
      <div class={cx('actives', battle.format)}>
        {s.active.map((idx, slot) => (
          idx == null
            ? <button class="moncard empty" onClick={() => setSendSlot(slot)}>＋ ポケモンを出す</button>
            : <MonCard key={`${side}${idx}`} side={side} idx={idx} slot={slot} battle={battle} ctx={ctx} mut={mut} onOpen={onOpen} onSwap={() => setSendSlot(slot)} />
        ))}
      </div>
      <div class="bench">
        {bench.map(i => {
          const c = condOf(battle, side, i);
          const build = side === 'me' ? battle.my[i] : battle.opp[i];
          const picked = battle.pick[side].includes(i);
          if (side === 'me' && battle.pick.me.length && !picked) return null; // 選出していない自分のポケモンは出さない
          const on = quick && sel[side]?.type === 'switch' && sel[side].to === i;
          // 自分の控え: 出したときに受ける最大ダメージ と 撃てる最大打点 / 相手の控え: いまの自分の技の最大打点
          const taken = side === 'me' ? info?.take?.targets.find(t => t.idx === i)?.best : null;
          const dealt = side === 'me' ? info?.out?.[i] : info?.give?.targets.find(t => t.idx === i)?.best;
          const pc = r => (!r ? '—' : r.immune ? '無効' : `${fmtPct(r.maxPct)}%`);
          const tap = () => {
            if (c.fainted) return;
            if (emptySlot >= 0) doSend(emptySlot, i);
            else if (quick) setSel({...sel, [side]: on ? null : {type: 'switch', to: i}});
            else onOpen({side, idx: i});
          };
          return (
            <button class={cx('benchmon', c.fainted && 'fainted', (picked || side === 'opp') && 'picked', on && 'on')} onClick={tap} aria-pressed={quick ? on : undefined}>
              <span class="nm">{speciesName(currentSpecies(build, c))}</span>
              <span class="num">{c.fainted ? 'ひんし' : `${Math.round(c.hp)}%`}{c.status ? ` ${STATUS_JA[c.status]}` : ''}</span>
              {!c.fainted && side === 'me' && (taken || dealt) && <span class="bi"><i class={cx(dmgClass(taken))}>被{pc(taken)}</i><i class={cx(dmgClass(dealt))}>与{pc(dealt)}</i></span>}
              {!c.fainted && side === 'opp' && dealt && <span class="bi"><i class={cx(dmgClass(dealt))}>与{pc(dealt)}</i></span>}
            </button>
          );
        })}
      </div>
      {emptySlot >= 0 && bench.some(i => !condOf(battle, side, i)?.fainted) && (
        <p class="hint next">{side === 'me' ? '次に出すポケモンをタップ (被 = 出したときに受ける最大ダメージ、与 = 撃てる最大打点)' : '相手が出してきたポケモンをタップ'}</p>
      )}
      {quick && emptySlot < 0 && <p class="hint next">{side === 'me' ? '控えをタップ = 交代を選ぶ' : '控えをタップ = 相手が交代した'}</p>}
      {sendSlot != null && (
        <Sheet title={`${SIDE_JA[side]}: 場に出すポケモン`} onClose={() => setSendSlot(null)}>
          <p class="hint">盤面を直接書き換えます (ターンの記録には残りません)。交代として記録したいときは「このターンの行動を記録」を使ってください。ひんし後の繰り出しはここから。</p>
          <div class="picker-list">
            {list.map((m, i) => {
              const c = condOf(battle, side, i);
              if (s.active.includes(i) && s.active[sendSlot] !== i) return null;
              if (s.active[sendSlot] === i) return null;
              return <button class="row" disabled={c.fainted} onClick={() => doSend(sendSlot, i)}><MonName id={m.species} /><span class="row-sub num">{c.fainted ? 'ひんし' : `${Math.round(c.hp)}%`}</span></button>;
            })}
            {s.active[sendSlot] != null && <button class="row" onClick={() => { mut(b => { sendOut(b, side, sendSlot, null); }); setSendSlot(null); }}><span class="muted">この枠を空にする</span></button>}
          </div>
        </Sheet>
      )}
    </section>
  );
}

function MonCard({side, idx, slot, battle, ctx, mut, onOpen, onSwap}) {
  const [open, setOpen] = useState(false);
  const build = ctx.build(side, idx);
  const rawCond = condOf(battle, side, idx);
  const cond = ctx.cond(side, idx);
  const view = side === 'opp' ? ctx.views[idx] : null;
  const sid = currentSpecies(build, cond);
  const s = dex.species[sid];
  const base = dex.species[build.species];
  const ability = currentAbility(build, cond);
  const stats = statsOf(sid, build.sp, build.nature);
  const maxHP = stats[0];
  const set = fn => mut(b => fn(condOf(b, side, idx), b));
  const sd = battle.state.sides[side];
  const isMega = !!dex.species[rawCond.forme]?.mega;
  const megaOptions = side === 'me' ? [megaTarget(battle, side, idx)].filter(Boolean)
    : (battle.opp[idx].item ? [megaTarget(battle, side, idx)].filter(Boolean) : (base.megas || []));
  const canMega = megaOptions.length > 0 && (isMega || !sd.megaUsed);
  const anyBoost = BOOST_KEYS.some(k => rawCond.boosts[k]);
  const guessMega = side === 'opp' && !rawCond.forme && view?.megaForme;
  return (
    <div class={cx('moncard', rawCond.fainted && 'fainted')}>
      <div class="mc-top">
        <button class="mc-name" onClick={() => onOpen({side, idx})}>
          <span class="nm">{s.j}</span>
          {s.t.map(t => <TypeChip type={t} small />)}
          {guessMega && <span class="tag accent">メガ想定</span>}
        </button>
        <button class="btn ghost sm" onClick={onSwap}>入替</button>
      </div>
      <button class="mc-sub" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span>{abilityName(ability)}{side === 'opp' && view?.abilityGuess && !s.mega ? '?' : ''}</span>
        <span class={cx(rawCond.itemGone && 'strike')}>{itemName(build.item) || '持ち物なし'}{side === 'opp' && view?.itemGuess ? '?' : ''}</span>
        {rawCond.status && <span class="tag bad">{STATUS_JA[rawCond.status]}</span>}
        {anyBoost && <span class="tag accent">{BOOST_KEYS.filter(k => rawCond.boosts[k]).map(k => `${BOOST_JA[k]}${rawCond.boosts[k] > 0 ? '+' : ''}${rawCond.boosts[k]}`).join(' ')}</span>}
        {isMega && <span class="tag accent">メガ</span>}
        <span class="mc-more">{open ? 'たたむ ▲' : '状態・ランク ▼'}</span>
      </button>
      <HPControl hp={rawCond.hp} maxHP={side === 'me' ? maxHP : null} onSet={v => mut(b => { setHP(b, side, idx, v); })} />
      {open && <div class="mc-row">
        <select class="input sm" value={rawCond.status} aria-label="状態異常" onChange={e => set(c => { c.status = e.currentTarget.value; c.toxicCounter = 1; })}>
          {STATUSES.map(([v, l]) => <option value={v}>{v ? l : '状態異常なし'}</option>)}
        </select>
        {canMega && megaOptions.map(m => (
          <Toggle small on={rawCond.forme === m} onChange={v => mut(b => {
            const c = condOf(b, side, idx);
            if (v) megaEvolve(b, side, idx, m, {resolveAbility: ctx.strictAbility});
            else { c.forme = null; b.state.sides[side].megaUsed = false; }
          })}>{megaOptions.length > 1 ? speciesName(m) : 'メガシンカ'}</Toggle>
        ))}
        {(base.forms || []).length > 0 && (
          <Seg small wrap value={rawCond.forme || build.species} options={[build.species, ...base.forms].map(f => [f, speciesName(f).replace(/^.*\(|\)$/g, '') || '通常'])}
            onChange={v => set(c => { c.forme = v === build.species ? null : v; })} />
        )}
      </div>}
      {open && (
        <div class="mc-boosts">
          {BOOST_KEYS.map(k => <Stepper signed label={BOOST_JA[k]} value={rawCond.boosts[k] || 0} onChange={v => set(c => { c.boosts[k] = v; })} />)}
          <button class="btn ghost sm" onClick={() => set(c => { c.boosts = emptyBoosts(); })}>リセット</button>
          <span class="num dim">実数値 {stats.join('-')}</span>
          <Toggle small on={rawCond.itemGone} onChange={v => set(c => { c.itemGone = v; })}>持ち物なし (消費・はたき)</Toggle>
          {['flashfire', 'stakeout', 'unburden', 'plus', 'minus', 'electromorphosis', 'analytic'].includes(ability) && (
            <Toggle small on={rawCond.abilityOn} onChange={v => set(c => { c.abilityOn = v; })}>{abilityName(ability)} 発動中</Toggle>
          )}
          {rawCond.status === 'tox' && <Stepper label="もうどく経過" value={rawCond.toxicCounter || 1} min={1} max={15} onChange={v => set(c => { c.toxicCounter = v; })} />}
        </div>
      )}
    </div>
  );
}

export function HPControl({hp, maxHP, onSet}) {
  const [v, setV] = useState(hp);
  useEffect(() => setV(hp), [hp]);
  const cur = maxHP ? Math.round((maxHP * v) / 100) : null;
  const color = v > 50 ? 'g' : v > 20 ? 'y' : 'r';
  return (
    <div class="hp">
      <div class="hpbar"><div class={cx('hpfill', color)} style={{width: `${v}%`}} /></div>
      <input type="range" min={0} max={100} step={1} value={Math.round(v)} aria-label="残りHP (%)"
        onInput={e => setV(Number(e.currentTarget.value))} onChange={e => onSet(Number(e.currentTarget.value))} />
      <span class="hp-num num">
        {maxHP ? (
          <input class="input sm num" type="number" inputMode="numeric" min={0} max={maxHP} value={cur} aria-label="残りHP"
            onChange={e => { const n = Math.max(0, Math.min(maxHP, Number(e.currentTarget.value) || 0)); onSet((n / maxHP) * 100); }} />
        ) : null}
        {maxHP ? `/${maxHP}` : `${Math.round(v)}%`}
      </span>
      <button class="btn ghost sm" onClick={() => onSet(v <= 0 ? 100 : 0)}>{v <= 0 ? '復活' : 'ひんし'}</button>
    </div>
  );
}

// ---- ターンの記録 ----
function TurnSheet({battle, ctx, mut, toast, onClose}) {
  const double = battle.format === 'double';
  // 場にいるポケモンごとの行動の下書き
  const initial = useMemo(() => {
    const rows = [];
    for (const side of ['me', 'opp']) {
      for (const idx of battle.state.sides[side].active) {
        if (idx == null || condOf(battle, side, idx)?.fainted) continue;
        rows.push({side, mon: idx, type: '', move: '', to: null, mega: false, target: null, flags: {}});
      }
    }
    return rows;
  }, []);
  const [rows, setRows] = useState(initial);
  const [orderKnown, setOrderKnown] = useState(false);
  const [manual, setManual] = useState(false);
  const [note, setNote] = useState('');
  const [pick, setPick] = useState(null);
  const upd = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? {...r, ...patch} : r)));

  // 行動順の予測で並べ替える (手で並べ替えたあとは触らない)
  const sorted = useMemo(() => {
    if (manual) return rows;
    const key = r => ({build: ctx.build(r.side, r.mon), cond: megaCond(battle, ctx, r), moveId: r.type === 'switch' ? null : r.move || undefined, side: battle.state.sides[r.side]});
    const acted = rows.filter(r => r.type);
    const idle = rows.filter(r => !r.type);
    acted.sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka.moveId === undefined || kb.moveId === undefined) return 0;
      const o = turnOrder(ka, kb, {format: battle.format, field: battle.state.field});
      return o === 'a' ? -1 : o === 'b' ? 1 : 0;
    });
    return acted.concat(idle);
  }, [rows, manual]);
  const move = (i, d) => {
    const list = sorted.slice();
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setRows(list); setManual(true); setOrderKnown(true);
  };
  const commit = () => {
    const acts = sorted.filter(r => r.type === 'switch' ? r.to != null : r.type === 'move');
    if (!acts.length && !note) { toast('行動が1つも選ばれていません'); return; }
    const auto = mut(b => commitTurnInfer(b, {acts, orderKnown, note}, {resolveAbility: ctx.strictAbility}));
    toast(auto?.length ? `ターンを記録しました (自動反映 ${auto.length}件)` : 'ターンを記録しました');
    onClose();
  };
  const idxOf = r => rows.indexOf(r);
  return (
    <Sheet title={`ターン ${turnNumber(battle)} の行動`} onClose={onClose} wide actions={<button class="btn primary" onClick={commit}>記録する</button>}>
      <p class="hint">上から行動した順です。予測で並べていますが、実際と違うときは ↑↓ で直してください (直すと相手の素早さを絞り込みます)。HP の増減は記録後に盤面で調整します。</p>
      <div class="turn-rows">
        {sorted.map((r, si) => {
          const i = idxOf(r);
          const build = ctx.build(r.side, r.mon);
          const cond = condOf(battle, r.side, r.mon);
          const view = r.side === 'opp' ? ctx.views[r.mon] : null;
          const moves = r.side === 'me' ? (build.moves || []).map(id => ({id, known: true})) : (view?.moves || []).slice(0, 8);
          const sd = battle.state.sides[r.side];
          const megaOk = megaTarget(battle, r.side, r.mon) && !sd.megaUsed && !dex.species[cond.forme]?.mega && !rows.some(x => x !== r && x.side === r.side && x.mega);
          const bench = (r.side === 'me' ? battle.my : battle.opp).map((_, k) => k).filter(k => !sd.active.includes(k) && !condOf(battle, r.side, k)?.fainted);
          const foes = battle.state.sides[other(r.side)].active.filter(k => k != null && !condOf(battle, other(r.side), k)?.fainted);
          const allies = sd.active.filter(k => k != null && k !== r.mon && !condOf(battle, r.side, k)?.fainted);
          const mv = dex.moves[r.move];
          const needTarget = double && r.type === 'move' && mv && !mv.sp && !['self', 'allySide', 'foeSide', 'all', 'allyTeam', 'allies'].includes(mv.tg) && (foes.length + allies.length > 1);
          const pivot = r.type === 'move' && PIVOT_MOVES.has(r.move);
          return (
            <div class={cx('turn-row', r.side, r.type && 'set')} key={`${r.side}${r.mon}`}>
              <div class="tr-head">
                <span class={cx('side-tag', r.side)}>{SIDE_JA[r.side]}</span>
                <strong>{speciesName(currentSpecies(build, cond))}</strong>
                <span class="grow" />
                {r.type && <button class="btn ghost sm" onClick={() => upd(i, {type: '', move: '', to: null, mega: false, target: null, flags: {}})}>取消</button>}
                <button class="btn ghost sm" onClick={() => move(si, -1)} disabled={si === 0} aria-label="先に行動">↑</button>
                <button class="btn ghost sm" onClick={() => move(si, 1)} disabled={si === sorted.length - 1} aria-label="後に行動">↓</button>
              </div>
              <div class="chips">
                {moves.map(m => (
                  <button class={cx('chip', r.type === 'move' && r.move === m.id && 'on', !m.known && 'ghost')} onClick={() => upd(i, {type: 'move', move: m.id, to: null})}>
                    <TypeChip type={dex.moves[m.id]?.t} small />{moveName(m.id)}{!m.known && m.rate != null ? <span class="rate">{(m.rate * 100).toFixed(0)}%</span> : null}
                  </button>
                ))}
                <button class="chip add" onClick={() => setPick({row: i, kind: 'move'})}>ほかの技…</button>
              </div>
              <div class="chips">
                <span class="muted">交代:</span>
                {bench.map(k => (
                  <button class={cx('chip', r.type === 'switch' && r.to === k && 'on')} onClick={() => upd(i, {type: 'switch', to: k, move: '', mega: false})}>{speciesName(buildOf(battle, r.side, k).species)}</button>
                ))}
                {!bench.length && <span class="muted">控えなし</span>}
              </div>
              {r.type === 'move' && (
                <div class="chips">
                  {megaOk && <Toggle small on={r.mega} onChange={v => upd(i, {mega: v})}>メガシンカ</Toggle>}
                  {needTarget && <>
                    <span class="muted">対象:</span>
                    {foes.map(k => <button class={cx('chip', r.target?.side === other(r.side) && r.target.mon === k && 'on')} onClick={() => upd(i, {target: {side: other(r.side), mon: k}})}>{speciesName(buildOf(battle, other(r.side), k).species)}</button>)}
                    {allies.map(k => <button class={cx('chip', r.target?.side === r.side && r.target.mon === k && 'on')} onClick={() => upd(i, {target: {side: r.side, mon: k}})}>味方 {speciesName(buildOf(battle, r.side, k).species)}</button>)}
                  </>}
                  {[['crit', '急所'], ['miss', '外れ'], ['protect', 'まもられた'], ['cant', '行動不能']].map(([k, label]) => (
                    <Toggle small on={!!r.flags[k]} onChange={v => upd(i, {flags: {...r.flags, [k]: v}})}>{label}</Toggle>
                  ))}
                </div>
              )}
              {pivot && (
                <div class="chips">
                  <span class="muted">技のあとの交代先:</span>
                  {bench.map(k => <button class={cx('chip', r.to === k && 'on')} onClick={() => upd(i, {to: r.to === k ? null : k})}>{speciesName(buildOf(battle, r.side, k).species)}</button>)}
                </div>
              )}
            </div>
          );
        })}
        {!sorted.length && <Empty>場にポケモンがいません。先に盤面でポケモンを出してください。</Empty>}
      </div>
      <label class="check pad-s"><input type="checkbox" checked={orderKnown} onChange={e => setOrderKnown(e.currentTarget.checked)} />この並びは実際の行動順 (相手の素早さの絞り込みに使う)</label>
      <label class="field"><span>このターンのメモ</span><input class="input" value={note} onInput={e => setNote(e.currentTarget.value)} /></label>
      {pick && <Picker kind="moves" title="使った技" onClose={() => setPick(null)}
        prefer={dex.learn[buildOf(battle, rows[pick.row].side, rows[pick.row].mon).species]} preferLabel="覚えない技も表示"
        onPick={id => { upd(pick.row, {type: 'move', move: id, to: null}); setPick(null); }} />}
    </Sheet>
  );
}

// 行動順の予測用: このターンにメガシンカするなら、その姿の素早さで比べる
function megaCond(battle, ctx, r) {
  const c = ctx.cond(r.side, r.mon);
  if (!r.mega) return c;
  const m = megaTarget(battle, r.side, r.mon);
  return m ? {...c, forme: m} : c;
}

