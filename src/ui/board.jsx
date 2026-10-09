// 盤面 (仮想のゲーム状況) の表示と編集、ターンの記録
import {useEffect, useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies, currentAbility, turnOrder, emptyBoosts} from '../engine/calc.js';
import {sendOut, megaEvolve, megaTarget, setHP, setWeather, setTerrain, setSideFlag, setFieldFlag, turnNumber, undoTurn, buildOf, condOf, other, PIVOT_MOVES} from '../engine/battle.js';
import {commitTurnInfer} from '../engine/infer.js';
import {useApp, Sheet, Picker, Seg, Toggle, Stepper, MonName, TypeChip, Empty, cx} from './common.jsx';
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
      <Side side="opp" battle={battle} ctx={ctx} mut={mut} onOpen={setSheet} />
      <div class="turnbar">
        <span class="tag">ターン {turnNumber(battle)}</span>
        <button class="btn primary grow" onClick={() => setTurn(true)} disabled={!hasOpp}>このターンの行動を記録</button>
        <button class="btn" disabled={!battle.turns.length || !battle.turns[battle.turns.length - 1].before}
          onClick={() => { mut(b => { undoTurn(b); }); toast('直前のターンを取り消しました'); }}>戻す</button>
      </div>
      <Side side="me" battle={battle} ctx={ctx} mut={mut} onOpen={setSheet} />

      {turn && <TurnSheet battle={battle} ctx={ctx} mut={mut} toast={toast} onClose={() => setTurn(false)} />}
      {sheet && sheet.side === 'opp' && battle.opp[sheet.idx] && <OppSheet battle={battle} idx={sheet.idx} ctx={ctx} mut={mut} usage={usage} onClose={() => setSheet(null)} />}
      {sheet && sheet.side === 'me' && battle.my[sheet.idx] && (
        <MonEditor title="この対戦での自分の型" usage={usage} build={battle.my[sheet.idx]}
          onSave={bd => { mut(b => { b.my[sheet.idx] = bd; }); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

function Side({side, battle, ctx, mut, onOpen}) {
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
          return (
            <button class={cx('benchmon', c.fainted && 'fainted', picked && 'picked')} disabled={false}
              onClick={() => (emptySlot >= 0 && !c.fainted ? doSend(emptySlot, i) : onOpen({side, idx: i}))}
              title={emptySlot >= 0 ? '場に出す' : '情報を編集'}>
              <span class="nm">{speciesName(currentSpecies(build, c))}</span>
              <span class="num">{c.fainted ? 'ひんし' : `${Math.round(c.hp)}%`}{c.status ? ` ${STATUS_JA[c.status]}` : ''}</span>
            </button>
          );
        })}
      </div>
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
      <div class="mc-sub">
        <span>{abilityName(ability)}{side === 'opp' && view?.abilityGuess && !s.mega ? '?' : ''}</span>
        <span class={cx(rawCond.itemGone && 'strike')}>{itemName(build.item) || '持ち物なし'}{side === 'opp' && view?.itemGuess ? '?' : ''}</span>
        <span class="num dim">{stats.join('-')}</span>
      </div>
      <HPControl hp={rawCond.hp} maxHP={side === 'me' ? maxHP : null} onSet={v => mut(b => { setHP(b, side, idx, v); })} />
      <div class="mc-row">
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
        <Toggle small on={open || anyBoost} onChange={() => setOpen(o => !o)}>ランク{anyBoost ? ` ${BOOST_KEYS.filter(k => rawCond.boosts[k]).map(k => `${BOOST_JA[k]}${rawCond.boosts[k] > 0 ? '+' : ''}${rawCond.boosts[k]}`).join(' ')}` : ''}</Toggle>
      </div>
      {open && (
        <div class="mc-boosts">
          {BOOST_KEYS.map(k => <Stepper signed label={BOOST_JA[k]} value={rawCond.boosts[k] || 0} onChange={v => set(c => { c.boosts[k] = v; })} />)}
          <button class="btn ghost sm" onClick={() => set(c => { c.boosts = emptyBoosts(); })}>リセット</button>
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

function HPControl({hp, maxHP, onSet}) {
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

