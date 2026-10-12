// 対戦フェーズの左側: 時系列とターンの入力。
// 入力の流れ: ① 自分の行動を選ぶ (相手の選択待ちの間に) → ② 動いた順に1体ずつ記録 → ③ ターン終了時の処理を確認して締める。
// 記録した行動はあとから時系列をタップして直せる (最初の状態から全ターンを入れ直す)。
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies} from '../engine/calc.js';
import {megaTarget, buildOf, condOf, other, PIVOT_MOVES} from '../engine/battle.js';
import {addAct, addEvent, openTurn, actLine, canReplay, editAct, reopenLastTurn, residualCandidates, finishTurn} from '../engine/flow.js';
import {Picker, Sheet, Seg, Toggle, TypeChip, cx} from './common.jsx';

const SIDE_JA = {me: '自分', opp: '相手'};
const FLAGS = [['reflect', 'リフレクター'], ['lightScreen', 'ひかりのかべ'], ['auroraVeil', 'オーロラベール'], ['tailwind', 'おいかぜ'], ['sr', 'ステルスロック']];
const STATUS_OPTS = [['brn', 'やけど'], ['par', 'まひ'], ['psn', 'どく'], ['tox', 'もうどく'], ['slp', 'ねむり'], ['frz', 'こおり']];
// 変化技で必ず入る状態異常 (無効だったら外す)
const STATUS_MOVE = {willowisp: 'brn', thunderwave: 'par', glare: 'par', stunspore: 'par', nuzzle: 'par', toxic: 'tox', poisonpowder: 'psn', toxicthread: 'psn', spore: 'slp', sleeppowder: 'slp', hypnosis: 'slp', sing: 'slp', darkvoid: 'slp', lovelykiss: 'slp', grasswhistle: 'slp'};
// 発動すると無くなる持ち物
const CONSUMED = new Set(['focussash', 'whiteherb', 'powerherb', 'airballoon', 'weaknesspolicy', 'mentalherb', 'redcard', 'ejectbutton', 'ejectpack', 'throatspray', 'boosterenergy', 'roomservice', 'adrenalineorb', 'absorbbulb', 'cellbattery', 'luminousmoss', 'snowball', 'normalgem', 'covertcloak']);
const consumable = id => /berry$/.test(id || '') || /gem$/.test(id || '') || CONSUMED.has(id);
const OUTCOMES = [['hit', '当たった'], ['miss', '外れた'], ['protect', 'まもられた'], ['cant', '行動できず']];

const alive = (b, side) => b.state.sides[side].active.filter(i => i != null && !condOf(b, side, i)?.fainted);
const maxHPOf = (b, mon) => { const bd = b.my[mon]; return statsOf(currentSpecies(bd, condOf(b, 'me', mon)), bd.sp, bd.nature)[0]; };
const benchOf = (b, side) => {
  const sd = b.state.sides[side];
  const list = side === 'me' ? b.my : b.opp;
  return list.map((_, i) => i).filter(i => !sd.active.includes(i) && !condOf(b, side, i)?.fainted && (side === 'opp' || !b.pick.me.length || b.pick.me.includes(i) || b.pick.me.length < (b.format === 'double' ? 4 : 3)));
};
const monName = (b, side, i) => speciesName(currentSpecies(buildOf(b, side, i), condOf(b, side, i)));
const canMegaNow = (b, side, mon) => !!megaTarget(b, side, mon) && !b.state.sides[side].megaUsed && !dex.species[condOf(b, side, mon)?.forme]?.mega;

// 自分の行動予定 (ターンをまたいで画面を切り替えても残す)
const plans = new Map();

export function Timeline({battle, ctx, mut, usage, toast}) {
  const [edit, setEdit] = useState(null); // {ti, ai}
  const tlRef = useRef(null);
  const nActs = battle.turns.reduce((a, t) => a + t.acts.length, 0);
  useEffect(() => { const el = tlRef.current; if (el) el.scrollTop = el.scrollHeight; }, [nActs, battle.turns.length]);
  const editable = canReplay(battle);
  const double = battle.format === 'double';
  return (
    <div class="ar-left">
      <h3>時系列 {editable && battle.turns.length > 0 && <small class="muted">(タップで修正)</small>}</h3>
      <div class="tl" ref={tlRef}>
        {!battle.turns.length && <p class="muted">下の入力欄で、まず自分の行動を選び、そのあと動いた順に記録します。記録した順が行動順として扱われ、相手の素早さの絞り込みに使われます。</p>}
        {battle.turns.map((t, ti) => (
          <div class="tl-turn" key={t.n}>
            <div class="tl-n">— ターン {t.n}{t.open ? ' (入力中)' : ''} —</div>
            {t.acts.map((a, ai) => (
              <button class={cx('tl-act', a.side, a.type === 'event' && 'ev', a.kind === 'residual' && 'res')} disabled={!editable} onClick={() => setEdit({ti, ai})}>
                <span class="tl-who">{SIDE_JA[a.side] || '場'}{(double || a.type === 'event') && a.sp ? ` ${speciesName(a.sp)}` : ''}</span>
                <span class="tl-body">{actLine(battle, a)}</span>
                {(a.auto || []).map(x => <span class="tl-auto">{x}</span>)}
              </button>
            ))}
            {(t.auto || []).filter(x => !t.acts.some(a => (a.auto || []).includes(x))).map(x => <div class="tl-auto">{x}</div>)}
            {!t.open && ti === battle.turns.length - 1 && editable && (
              <button class="btn ghost sm tl-reopen" onClick={() => { mut(b => { reopenLastTurn(b, usage); }); toast('ターン終了を取り消しました。行動を追加できます'); }}>このターンに行動を追加する</button>
            )}
          </div>
        ))}
        {!editable && battle.turns.length > 0 && <p class="hint">この対戦は以前の形式で記録されているため、過去の行動は直せません。</p>}
      </div>
      <Composer battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} />
      {edit && <EditSheet battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} {...edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// ---- 入力欄 ----
function Composer({battle, ctx, mut, usage, toast}) {
  const [mode, setMode] = useState('flow');
  const [actor, setActor] = useState(null); // {side, mon}
  const [ending, setEnding] = useState(false);
  const open = openTurn(battle);
  const turnNo = open ? open.n : battle.turns.length + 1;
  const planKey = `${battle.id}:${turnNo}`;
  const [plan, setPlanState] = useState(() => plans.get(planKey) || {});
  useEffect(() => { setPlanState(plans.get(planKey) || {}); setActor(null); setEnding(false); }, [planKey]);
  const setPlan = p => { plans.set(planKey, p); setPlanState(p); };

  const acted = (side, mon) => !!open?.acts.some(a => a.type !== 'event' && a.side === side && (a.mon === mon || a.to === mon));
  const actors = ['me', 'opp'].flatMap(side => alive(battle, side).map(mon => ({side, mon, done: acted(side, mon)})));
  const remaining = actors.filter(a => !a.done);
  const allDone = actors.length > 0 && !remaining.length && !!open;
  // 場が空いている (ひんし・初手前) → 出すポケモンを選ぶ
  const needSend = ['me', 'opp'].filter(side => {
    const sd = battle.state.sides[side];
    return sd.active.some(x => x == null || condOf(battle, side, x)?.fainted) && benchOf(battle, side).length > 0;
  });

  const record = (input, label) => {
    const log = mut(b => addAct(b, {...input, sameTurn: true}, usage));
    toast(log?.length ? log[log.length - 1] : `${label}を記録しました`);
    setActor(null);
  };

  return (
    <div class="composer">
      <div class="cp-head">
        <strong>ターン {turnNo}</strong>
        <Seg small value={mode} options={[['flow', '行動'], ['ev', 'その他の出来事']]} onChange={v => { setMode(v); setActor(null); }} />
      </div>

      {needSend.map(side => (
        <div class="tc-box warn">
          <div class="tc-h">{SIDE_JA[side]}が場に出すポケモン</div>
          <div class="chips">
            {benchOf(battle, side).map(i => <button class="chip add" onClick={() => { mut(b => addEvent(b, {kind: 'send', side, to: i}, usage)); }}>{speciesName(buildOf(battle, side, i).species)}</button>)}
          </div>
        </div>
      ))}

      {mode === 'ev' && <EventForm battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} />}

      {mode === 'flow' && !ending && <>
        {/* ① 自分の行動を決める */}
        <div class="tc-box">
          <div class="tc-h"><span class="tc-no">1</span>自分の行動 <small class="muted">相手の選択を待つ間に</small></div>
          {alive(battle, 'me').filter(m => !acted('me', m)).map(m => (
            <PlanRow key={m} battle={battle} mon={m} plan={plan[m]} onChange={p => setPlan({...plan, [m]: p})} />
          ))}
          {!alive(battle, 'me').length && <p class="muted">自分のポケモンが場にいません。</p>}
        </div>

        {/* ② 動いた順に記録 */}
        <div class="tc-box">
          <div class="tc-h"><span class="tc-no">2</span>{open?.acts.some(a => a.type !== 'event') ? '次に動いたのは?' : '先に動いたのは?'}</div>
          <div class="actor-row">
            {remaining.filter(a => !actor || (actor.side === a.side && actor.mon === a.mon)).map(a => {
              const p = a.side === 'me' ? plan[a.mon] : null;
              return (
                <button class={cx('actor-btn', a.side, actor?.side === a.side && actor?.mon === a.mon && 'on')} onClick={() => setActor({side: a.side, mon: a.mon})}>
                  <span class="ab-side">{SIDE_JA[a.side]}</span>
                  <span class="ab-name">{monName(battle, a.side, a.mon)}</span>
                  <span class="ab-sub">{p ? (p.type === 'switch' ? `交代→${speciesName(buildOf(battle, 'me', p.to).species)}` : moveName(p.move)) : a.side === 'opp' ? '技・交代を入力' : '未選択'}</span>
                </button>
              );
            })}
            {!remaining.length && actors.length > 0 && <p class="muted">全員の行動を記録しました。</p>}
          </div>
          {actor && remaining.some(a => a.side === actor.side && a.mon === actor.mon) && (
            <ActForm key={`${actor.side}${actor.mon}${turnNo}`} battle={battle} ctx={ctx} usage={usage} side={actor.side} mon={actor.mon}
              init={actor.side === 'me' ? plan[actor.mon] : null}
              onCancel={() => setActor(null)}
              onSubmit={inp => record(inp, monName(battle, actor.side, actor.mon))} />
          )}
        </div>

        {/* ③ ターン終了 */}
        <div class="btnrow tc-end">
          <button class={cx('btn grow', allDone ? 'primary' : '')} disabled={!open} onClick={() => setEnding(true)}>
            <span class="tc-no inv">3</span>ターン終了へ{!allDone && remaining.length > 0 && <small class="muted">&nbsp;(未記録 {remaining.length}体)</small>}
          </button>
        </div>
      </>}

      {mode === 'flow' && ending && open && (
        <EndTurn battle={battle} usage={usage} onBack={() => setEnding(false)}
          onDone={(residual, noOrder) => {
            const log = mut(b => finishTurn(b, usage, {residual, noOrder}));
            setEnding(false);
            toast(log?.length ? log[log.length - 1] : 'ターンを終了しました');
          }} />
      )}
    </div>
  );
}

// ① 自分の行動予定
function PlanRow({battle, mon, plan, onChange}) {
  const build = battle.my[mon];
  const double = battle.format === 'double';
  const foes = alive(battle, 'opp');
  const bench = benchOf(battle, 'me');
  const mv = plan?.type === 'move' ? dex.moves[plan.move] : null;
  return (
    <div class="plan">
      {double && <div class="plan-who">{monName(battle, 'me', mon)}</div>}
      <div class="move-grid">
        {(build.moves || []).filter(m => dex.moves[m]).map(m => (
          <button class={cx('mv-btn', plan?.type === 'move' && plan.move === m && 'on')} onClick={() => onChange(plan?.move === m ? null : {...plan, type: 'move', move: m})}>
            <span class={cx('mv-bar', `t-${dex.moves[m].t}`)} /><span class="mv-nm">{moveName(m)}</span>
          </button>
        ))}
      </div>
      <div class="chips">
        {bench.length > 0 && <span class="muted">交代:</span>}
        {bench.map(i => <button class={cx('chip', plan?.type === 'switch' && plan.to === i && 'on')} onClick={() => onChange({type: 'switch', to: i})}>{speciesName(battle.my[i].species)}</button>)}
        {canMegaNow(battle, 'me', mon) && <Toggle small on={!!plan?.mega} onChange={v => onChange({...(plan || {}), mega: v})}>メガシンカ</Toggle>}
      </div>
      {double && mv && !mv.sp && foes.length > 1 && (
        <div class="chips"><span class="muted">対象:</span>{foes.map(i => <button class={cx('chip', plan?.target?.mon === i && 'on')} onClick={() => onChange({...plan, target: {side: 'opp', mon: i}})}>{monName(battle, 'opp', i)}</button>)}</div>
      )}
    </div>
  );
}

// 1体ぶんの行動の入力 (新規・修正で共用)
export function ActForm({battle, ctx, usage, side, mon, init, onSubmit, onCancel, submitLabel = '記録する', onDelete}) {
  const foeSide = other(side);
  const double = battle.format === 'double';
  const foes = alive(battle, foeSide);
  const fromInit = () => {
    const i = init || {};
    const t = i.target || null;
    let hp = '';
    if (i.hpAfter != null) {
      const ts = t?.side || foeSide;
      const tm = t?.mon ?? foes[0];
      hp = ts === 'me' && tm != null ? String(Math.round((i.hpAfter * maxHPOf(battle, tm)) / 100)) : String(Math.round(i.hpAfter * 10) / 10);
    }
    return {type: i.type || null, move: i.move || '', to: i.to ?? null, target: t, mega: !!i.mega,
      outcome: i.cant ? 'cant' : i.miss ? 'miss' : i.protect ? 'protect' : 'hit', hp, crit: !!i.crit, hits: i.hits || 0,
      defItem: i.defItem?.item || '', atkItem: i.atkItem?.item || '', endured: !!i.endured, inflict: i.inflict || ''};
  };
  const [f, setF] = useState(fromInit);
  const [pick, setPick] = useState(null);
  const set = patch => setF(prev => ({...prev, ...patch}));
  const build = buildOf(battle, side, mon);
  const mv = f.type === 'move' && f.move ? dex.moves[f.move] : null;
  const tgt = f.target && (foes.includes(f.target.mon) || init) ? f.target : foes.length ? {side: foeSide, mon: foes[0]} : null;
  const hit = f.outcome === 'hit';
  const damaging = mv && mv.c !== 'Z';
  const tgtMax = tgt?.side === 'me' ? maxHPOf(battle, tgt.mon) : null;
  const tgtNow = tgt ? condOf(battle, tgt.side, tgt.mon)?.hp ?? 100 : 100;
  const bench = benchOf(battle, side);
  const pivot = mv && PIVOT_MOVES.has(f.move) && hit;
  const moves = side === 'me'
    ? (build.moves || []).filter(m => dex.moves[m]).map(id => ({id, known: true}))
    : (ctx.views[mon]?.moves || []).slice(0, 10);
  if (f.move && !moves.some(m => m.id === f.move)) moves.push({id: f.move, known: false});
  const chooseMove = id => set({type: 'move', move: id, inflict: STATUS_MOVE[id] || '', hits: 0});

  const submit = () => {
    if (!f.type) return;
    const input = {side, mon, type: f.type};
    if (f.type === 'switch') { input.to = f.to; onSubmit(input); return; }
    let hpAfter = null;
    if (hit && damaging && f.hp !== '' && !f.endured && f.defItem !== 'focussash') hpAfter = tgtMax ? (Number(f.hp) / tgtMax) * 100 : Number(f.hp);
    Object.assign(input, {
      move: f.move, mega: f.mega, crit: hit && f.crit, miss: f.outcome === 'miss', protect: f.outcome === 'protect', cant: f.outcome === 'cant',
      exact: !!tgtMax, endured: hit && f.endured, hits: hit && f.hits ? f.hits : undefined,
      defItem: hit && f.defItem ? {item: f.defItem, consumed: consumable(f.defItem)} : null,
      atkItem: f.atkItem ? {item: f.atkItem, consumed: consumable(f.atkItem)} : null,
      target: double ? tgt : null, hpAfter, inflict: hit && f.inflict ? f.inflict : '',
      to: pivot && f.to != null ? f.to : null,
    });
    onSubmit(input);
  };
  const ready = f.type === 'switch' ? f.to != null : f.type === 'move' && (!!f.move || f.outcome === 'cant');

  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView?.({block: 'nearest'}); }, []);
  return (
    <div class={cx('actform', side)} ref={ref}>
      <div class="af-h">{SIDE_JA[side]}の{monName(battle, side, mon)}の行動{onCancel && !onDelete && <button class="btn ghost sm" onClick={onCancel}>選び直す</button>}</div>
      <div class="move-grid">
        {moves.map(m => (
          <button class={cx('mv-btn', f.type === 'move' && f.move === m.id && 'on', !m.known && 'guess')} onClick={() => chooseMove(m.id)}>
            <span class={cx('mv-bar', `t-${dex.moves[m.id]?.t}`)} /><span class="mv-nm">{moveName(m.id)}</span>
            {!m.known && m.rate ? <small class="rate">{Math.round(m.rate * 100)}%</small> : null}
          </button>
        ))}
        <button class="mv-btn add" onClick={() => setPick('move')}>ほかの技…</button>
      </div>
      {bench.length > 0 && (
        <div class="chips"><span class="muted">交代:</span>
          {bench.map(i => <button class={cx('chip', f.type === 'switch' && f.to === i && 'on')} onClick={() => set({type: 'switch', to: i, move: ''})}>{speciesName(buildOf(battle, side, i).species)}</button>)}
        </div>
      )}
      {f.type === 'move' && <>
        <div class="af-row">
          <Seg small value={f.outcome} options={OUTCOMES} onChange={v => set({outcome: v})} />
          {canMegaNow(battle, side, mon) && <Toggle small on={f.mega} onChange={v => set({mega: v})}>メガシンカ</Toggle>}
        </div>
        {double && mv && !mv.sp && foes.length > 1 && (
          <div class="chips"><span class="muted">対象:</span>{foes.map(i => <button class={cx('chip', tgt?.mon === i && 'on')} onClick={() => set({target: {side: foeSide, mon: i}})}>{monName(battle, foeSide, i)}</button>)}</div>
        )}
        {hit && damaging && tgt && (
          <div class="af-dmg">
            <label class="af-hp">
              <span>{monName(battle, tgt.side, tgt.mon)}の残りHP</span>
              {f.endured || f.defItem === 'focussash' ? <b class="num">1{tgtMax ? '' : '%'} (耐えた)</b> : <>
                <input class="input num" type="number" inputMode="decimal" min={0} max={tgtMax || 100} value={f.hp}
                  placeholder={String(Math.round(tgtMax ? (tgtNow * tgtMax) / 100 : tgtNow))} onInput={e => set({hp: e.currentTarget.value})} />
                <span class="muted">{tgtMax ? `/ ${tgtMax}` : '%'}</span>
                <button class="chip" onClick={() => set({hp: '0'})}>ひんし</button>
              </>}
            </label>
            {!tgtMax && <p class="hint">相手のHPはゲーム画面のバーの割合 (%) を入れます。自分のHPは実数値です。</p>}
            <div class="chips">
              <Toggle small on={f.crit} onChange={v => set({crit: v})}>急所</Toggle>
              {Array.isArray(mv.mh) && <><span class="muted">回数:</span>{Array.from({length: mv.mh[1] - mv.mh[0] + 1}, (_, k) => mv.mh[0] + k).map(n => <button class={cx('chip', f.hits === n && 'on')} onClick={() => set({hits: f.hits === n ? 0 : n})}>{n}</button>)}</>}
            </div>
            <div class="chips">
              <span class="muted">受けた側:</span>
              <button class={cx('chip', f.defItem === 'focussash' && 'on')} onClick={() => set({defItem: f.defItem === 'focussash' ? '' : 'focussash'})}>タスキで耐えた</button>
              <button class={cx('chip', f.endured && 'on')} onClick={() => set({endured: !f.endured})}>がんじょう・こらえる</button>
              <button class={cx('chip', f.defItem === 'sitrusberry' && 'on')} onClick={() => set({defItem: f.defItem === 'sitrusberry' ? '' : 'sitrusberry'})}>オボンで回復</button>
              <button class={cx('chip', f.defItem && !['focussash', 'sitrusberry'].includes(f.defItem) ? 'on' : 'add')} onClick={() => (f.defItem && !['focussash', 'sitrusberry'].includes(f.defItem) ? set({defItem: ''}) : setPick('def'))}>{f.defItem && !['focussash', 'sitrusberry'].includes(f.defItem) ? `${itemName(f.defItem)} 発動` : 'ほかの持ち物…'}</button>
            </div>
            {f.defItem === 'sitrusberry' && <p class="hint">残りHPには、オボンで回復したあとの値を入れてください。</p>}
          </div>
        )}
        {hit && mv && tgt && (
          <div class="chips"><span class="muted">相手が:</span>
            {STATUS_OPTS.map(([k, l]) => <button class={cx('chip', f.inflict === k && 'on')} onClick={() => set({inflict: f.inflict === k ? '' : k})}>{l}</button>)}
          </div>
        )}
        <div class="chips">
          <span class="muted">攻撃側の持ち物:</span>
          <button class={cx('chip', f.atkItem ? 'on' : 'add')} onClick={() => (f.atkItem ? set({atkItem: ''}) : setPick('atk'))}>{f.atkItem ? itemName(f.atkItem) : '判明したら選ぶ…'}</button>
        </div>
        {pivot && bench.length > 0 && (
          <div class="chips pivot"><span class="muted">交代先:</span>
            {bench.map(i => <button class={cx('chip', f.to === i && 'on')} onClick={() => set({to: f.to === i ? null : i})}>{speciesName(buildOf(battle, side, i).species)}</button>)}
          </div>
        )}
      </>}
      <div class="btnrow">
        {onCancel && <button class="btn" onClick={onCancel}>やめる</button>}
        {onDelete && <button class="btn danger" onClick={onDelete}>削除</button>}
        <button class="btn primary grow" disabled={!ready} onClick={submit}>{submitLabel}</button>
      </div>
      {pick === 'move' && <Picker kind="moves" title="使った技" onClose={() => setPick(null)} prefer={dex.learn[build.species]} preferLabel="覚えない技も表示"
        onPick={id => { chooseMove(id); setPick(null); }} />}
      {(pick === 'def' || pick === 'atk') && <Picker kind="items" title="持ち物" onClose={() => setPick(null)} filter={id => !dex.items[id].ms}
        onPick={id => { set(pick === 'def' ? {defItem: id} : {atkItem: id}); setPick(null); }} />}
    </div>
  );
}

// ③ ターン終了時の処理
function EndTurn({battle, usage, onBack, onDone}) {
  const cands = useMemo(() => residualCandidates(battle, usage), [battle]);
  const keyOf = c => `${c.side}${c.mon}${c.key}`;
  const [on, setOn] = useState(() => new Set(cands.filter(c => c.checked).map(keyOf)));
  const [noOrder, setNoOrder] = useState(false);
  const toggle = k => setOn(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const fmt = c => (c.side === 'me' ? `${c.hp > 0 ? '+' : ''}${c.hp}` : `${c.pct > 0 ? '+' : ''}${Math.round(c.pct * 10) / 10}%`);
  return (
    <div class="tc-box">
      <div class="tc-h"><span class="tc-no">3</span>ターン終了時の処理</div>
      {cands.length ? (
        <ul class="res-list">
          {cands.map(c => (
            <li><label>
              <input type="checkbox" checked={on.has(keyOf(c))} onChange={() => toggle(keyOf(c))} />
              <span class={cx('side-tag', c.side)}>{SIDE_JA[c.side]}</span>
              <b>{monName(battle, c.side, c.mon)}</b> {c.label} <span class={cx('num', c.pct < 0 ? 'neg' : 'pos')}>{fmt(c)}</span>
              {!c.checked && <small class="muted"> (起きていたら)</small>}
            </label></li>
          ))}
        </ul>
      ) : <p class="muted">自動で処理するものはありません。</p>}
      <p class="hint">チェックした処理をHPに反映します。ほかに起きたこと (やどりぎ・ゴツゴツメットなど) は「その他の出来事」から入れてください。</p>
      <label class="check"><input type="checkbox" checked={noOrder} onChange={e => setNoOrder(e.currentTarget.checked)} />このターンの行動順は素早さの推定に使わない (せんせいのツメ・クイックドロウなど)</label>
      <div class="btnrow">
        <button class="btn" onClick={onBack}>戻る</button>
        <button class="btn primary grow" onClick={() => onDone(cands.filter(c => on.has(keyOf(c))), noOrder)}>ターンを終える</button>
      </div>
    </div>
  );
}

// 記録した行動・出来事の修正
function EditSheet({battle, ctx, mut, usage, toast, ti, ai, onClose}) {
  const t = battle.turns[ti];
  const a = t?.acts[ai];
  if (!a) return null;
  const save = input => { mut(b => { editAct(b, ti, ai, input, usage); }); toast('修正して、そのあとのターンを入れ直しました'); onClose(); };
  const del = () => { mut(b => { editAct(b, ti, ai, null, usage); }); toast('削除して、そのあとのターンを入れ直しました'); onClose(); };
  // 修正は「その行動の直前の盤面」で入力したいが、選択肢 (控え・技) は今の盤面で十分なので今の盤面を使う
  return (
    <Sheet title={`ターン ${t.n} の記録を直す`} onClose={onClose} wide>
      {a.type === 'event' ? (
        <div class="pad">
          <p><b>{SIDE_JA[a.side] || ''} {a.sp ? speciesName(a.sp) : ''}</b> {a.text}</p>
          <p class="hint">出来事は削除して、入れ直してください。</p>
          <div class="btnrow"><button class="btn" onClick={onClose}>閉じる</button><button class="btn danger" onClick={del}>削除</button></div>
        </div>
      ) : (
        <ActForm battle={battle} ctx={ctx} usage={usage} side={a.side} mon={a.mon} init={a.in || {type: a.type, move: a.move, to: a.to, target: a.target, hpAfter: a.hpAfter, ...a.flags}}
          submitLabel="この内容で直す" onSubmit={save} onDelete={del} onCancel={onClose} />
      )}
    </Sheet>
  );
}

// その他の出来事 (持ち物・HP・状態異常・ランク・特性・場の変化など)
function EventForm({battle, mut, usage, toast}) {
  const [side, setSide] = useState('opp');
  const [actor, setActor] = useState(null);
  const [ev, setEv] = useState({kind: 'item'});
  const [pick, setPick] = useState(false);
  const act0 = alive(battle, side);
  const mon = actor != null && act0.includes(actor) ? actor : act0[0];
  const list = side === 'me' ? battle.my : battle.opp;
  const sd = battle.state.sides[side];
  const evMax = side === 'me' && mon != null ? maxHPOf(battle, mon) : null;
  const toPct = v => (evMax ? (Number(v) / evMax) * 100 : Number(v));
  const addEv = extra => {
    const e = {...ev, ...extra, side, mon};
    if (e.hp !== undefined && e.hp !== '') e.hpAfter = toPct(e.hp);
    delete e.hp;
    const log = mut(b => addEvent(b, e, usage));
    if (log?.length) toast(log[0]);
    setEv({kind: ev.kind});
  };
  return (
    <div class="ev tc-box">
      <div class="chips"><Seg small value={side} options={[['opp', '相手'], ['me', '自分']]} onChange={v => { setSide(v); setActor(null); }} />
        {act0.length > 1 && act0.map(i => <button class={cx('chip', mon === i && 'on')} onClick={() => setActor(i)}>{monName(battle, side, i)}</button>)}
      </div>
      {mon == null ? <p class="muted">場にポケモンがいません。</p> : <>
        <div class="chips">
          {[['item', '持ち物'], ['hp', 'HPの変化'], ['status', '状態異常'], ['boost', 'ランク'], ['ability', '特性'], ['faint', 'ひんし'], ['field', '天候・場'], ['side', '壁・設置技']].map(([k, l]) => <button class={cx('chip', ev.kind === k && 'on')} onClick={() => setEv({kind: k})}>{l}</button>)}
        </div>
        <p class="hint">{SIDE_JA[side]}の{monName(battle, side, mon)}{ev.kind === 'field' ? ' (場全体)' : ev.kind === 'side' ? '側の場' : ''}</p>
        {ev.kind === 'item' && <div class="chips">
          <button class="chip add" onClick={() => setPick(true)}>{ev.item ? itemName(ev.item) : '持ち物をえらぶ…'}</button>
          {[['sitrusberry', 'オボンのみ'], ['leftovers', 'たべのこし'], ['lumberry', 'ラムのみ'], ['rockyhelmet', 'ゴツゴツメット'], ['lifeorb', 'いのちのたま'], ['choicescarf', 'こだわりスカーフ']].map(([k, l]) => <button class={cx('chip', ev.item === k && 'on')} onClick={() => setEv({...ev, item: k, consumed: consumable(k)})}>{l}</button>)}
          <Toggle small on={!!ev.consumed} onChange={v => setEv({...ev, consumed: v})}>消費した</Toggle>
          <label class="cp-hp">発動後のHP (任意。オボンは空欄で+25%)
            <input class="input sm num" type="number" inputMode="decimal" value={ev.hp ?? ''} onInput={e => setEv({...ev, hp: e.currentTarget.value})} />{evMax ? `/${evMax}` : '%'}</label>
          <button class="btn primary sm" disabled={!ev.item} onClick={() => addEv()}>追加</button>
        </div>}
        {ev.kind === 'hp' && <div class="chips">
          <label class="cp-hp">変化後のHP (やどりぎ・ゴツゴツメット・回復技など)
            <input class="input sm num" type="number" inputMode="decimal" value={ev.hp ?? ''} onInput={e => setEv({...ev, hp: e.currentTarget.value})} />{evMax ? `/${evMax}` : '%'}</label>
          <button class="btn primary sm" disabled={!ev.hp && ev.hp !== 0} onClick={() => addEv()}>追加</button>
        </div>}
        {ev.kind === 'status' && <div class="chips">{STATUSES.map(([k, l]) => <button class="chip" onClick={() => addEv({status: k})}>{k ? l : '回復した'}</button>)}</div>}
        {ev.kind === 'boost' && <div class="chips">
          {BOOST_KEYS.map(k => <button class={cx('chip', ev.stat === k && 'on')} onClick={() => setEv({...ev, stat: k})}>{{atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ'}[k]}</button>)}
          {ev.stat && [-2, -1, 1, 2].map(d => <button class="chip add" onClick={() => addEv({delta: d})}>{d > 0 ? `+${d}` : d}</button>)}
        </div>}
        {ev.kind === 'ability' && <div class="chips">{dex.species[list[mon].species].ab.map(a => <button class="chip" onClick={() => addEv({ability: a})}>{abilityName(a)}</button>)}</div>}
        {ev.kind === 'faint' && <div class="chips"><button class="chip" onClick={() => addEv()}>ひんしになった</button></div>}
        {ev.kind === 'field' && <>
          <div class="chips"><span class="muted">天候:</span>{WEATHERS.map(([k, l]) => <button class={cx('chip', battle.state.field.weather === k && 'on')} onClick={() => addEv({key: 'weather', value: k})}>{l}</button>)}</div>
          <div class="chips"><span class="muted">フィールド:</span>{TERRAINS.map(([k, l]) => <button class={cx('chip', battle.state.field.terrain === k && 'on')} onClick={() => addEv({key: 'terrain', value: k})}>{l}</button>)}</div>
          <div class="chips">{[['trickRoom', 'トリックルーム'], ['gravity', 'じゅうりょく']].map(([k, l]) => <button class={cx('chip', battle.state.field[k] && 'on')} onClick={() => addEv({key: k, value: !battle.state.field[k]})}>{l}{battle.state.field[k] ? ' 終了' : ''}</button>)}</div>
        </>}
        {ev.kind === 'side' && <div class="chips">
          {FLAGS.map(([k, l]) => <button class={cx('chip', sd[k] && 'on')} onClick={() => addEv({key: k, value: !sd[k]})}>{l}{sd[k] ? ' 終了' : ''}</button>)}
          {[0, 1, 2, 3].map(n => <button class={cx('chip', sd.spikes === n && 'on')} onClick={() => addEv({kind: 'spikes', value: n})}>まきびし{n}</button>)}
        </div>}
      </>}
      {pick && <Picker kind="items" title="持ち物" onClose={() => setPick(false)} filter={id => !dex.items[id].ms}
        onPick={id => { setEv({...ev, item: id, consumed: consumable(id)}); setPick(false); }} />}
    </div>
  );
}

// 盤面の名前の横に置くメガシンカのボタン
export function MegaButtons({battle, side, mon, mut, usage}) {
  const cond = condOf(battle, side, mon);
  const build = buildOf(battle, side, mon);
  const s = dex.species[build?.species];
  if (!s?.megas?.length || cond?.fainted) return null;
  if (dex.species[cond.forme]?.mega) return <span class="tag accent">メガ</span>;
  if (battle.state.sides[side].megaUsed) return null;
  const target = megaTarget(battle, side, mon);
  // 相手で持ち物が分からないときは、メガの姿をすべて出す (リザードンX/Y など)
  const formes = side === 'opp' && !build.item ? s.megas : target ? [target] : [];
  if (!formes.length) return null;
  return <>{formes.map(fm => (
    <button class="btn mega-btn sm" title={`${speciesName(fm)}にメガシンカした`} onClick={() => mut(b => addEvent(b, {kind: 'mega', side, mon, forme: fm}, usage))}>
      メガ{formes.length > 1 ? (/[XYZＸＹＺ]$/.exec(speciesName(fm))?.[0] || '') : ''}
    </button>
  ))}</>;
}
