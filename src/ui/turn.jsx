// 対戦フェーズの左側: 時系列とターンの入力。
// 入力の流れ: ① 自分の行動を選ぶ (相手の選択待ちの間に) → ② 動いた順に1体ずつ記録 → ③ ターン終了時の処理を確認して締める。
// 記録した行動はあとから時系列をタップして直せる (最初の状態から全ターンを入れ直す)。
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies} from '../engine/calc.js';
import {megaTarget, buildOf, condOf, other, PIVOT_MOVES, faintedCount, pickCount} from '../engine/battle.js';
import {RECOIL, HALF_RECOIL, DRAIN, SELF_FX_JA} from '../engine/flow.js';
import {addAct, addEvent, openTurn, actLine, canReplay, editAct, reopenLastTurn, residualCandidates, finishTurn, replay, expiryCandidates, hazardDamage, dispOf} from '../engine/flow.js';
import {Picker, Sheet, Seg, Toggle, Sprite, cx} from './common.jsx';

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
// メガシンカできる姿 (相手で持ち物が分からないときは全候補。リザードンX/Y など)
const megaFormes = (b, side, mon) => {
  if (!canMegaNow(b, side, mon)) return [];
  const bd = buildOf(b, side, mon);
  const s = dex.species[bd.species];
  return side === 'opp' && !bd.item ? s.megas || [] : [megaTarget(b, side, mon)].filter(Boolean);
};
const megaLabel = (fm, many) => `メガシンカ${many ? (/[XYZＸＹＺ]$/.exec(speciesName(fm))?.[0] || '') : ''}`;
const canMegaNow = (b, side, mon) => !!megaTarget(b, side, mon) && !b.state.sides[side].megaUsed && !dex.species[condOf(b, side, mon)?.forme]?.mega;

// ポケモンをアイコンで選ぶボタン (交代先・場に出すポケモン)
function MonBtn({battle, side, mon, on, onClick}) {
  const sid = currentSpecies(buildOf(battle, side, mon), condOf(battle, side, mon));
  const hp = condOf(battle, side, mon)?.hp ?? 100;
  return (
    <button class={cx('mon-btn', side, on && 'on')} onClick={onClick} title={speciesName(sid)}>
      <Sprite id={sid} size={44} />
      <span class="mb-nm">{speciesName(sid)}</span>
      <span class="mb-hp"><i class={cx(hp <= 25 ? 'red' : hp <= 50 && 'yellow')} style={{width: `${Math.max(0, hp)}%`}} /></span>
      <span class="mb-pct num">{Math.round(hp)}%</span>
    </button>
  );
}

// 場に出たとき: 設置技のダメージ・ふうせん
function EntryHazardAsk({battle, mut, usage, toast}) {
  const [val, setVal] = useState({});
  const list = ['me', 'opp'].flatMap(side => battle.state.sides[side].active.filter(i => i != null && condOf(battle, side, i)?.hazard && !condOf(battle, side, i)?.fainted).map(mon => ({side, mon})));
  if (!list.length) return null;
  return list.map(({side, mon}) => {
    const d = hazardDamage(battle, side, mon);
    const max = side === 'me' ? maxHPOf(battle, mon) : null;
    const c = condOf(battle, side, mon);
    const after = d ? Math.max(0, c.hp - d.pct) : c.hp;
    const k = `${side}${mon}`;
    const rec = ev => { mut(b => addEvent(b, {kind: 'hazard', side, mon, ...ev}, usage)); setVal({...val, [k]: ''}); };
    return (
      <div class="tc-box ask">
        <div class="tc-h">{SIDE_JA[side]}の{monName(battle, side, mon)}が場に出ました: {d ? d.parts.join('・') : '設置技'}のダメージ</div>
        <div class="chips">
          {d && <button class="chip add" onClick={() => rec(side === 'opp' ? {hpAfter: dispOf(after)} : {})}>計算どおり → {max ? `${Math.round((after * max) / 100)}/${max}` : `${dispOf(after)}%`}</button>}
          <label class="cp-hp">HPを入力
            <input class="input sm num" type="number" inputMode="decimal" value={val[k] ?? ''} onInput={e => setVal({...val, [k]: e.currentTarget.value})} />{max ? `/${max}` : '%'}
            <button class="btn sm" disabled={!val[k]} onClick={() => rec({hpAfter: max ? (Number(val[k]) / max) * 100 : Number(val[k])})}>記録</button>
          </label>
          <button class="chip" onClick={() => rec({none: true})}>ダメージを受けなかった{side === 'opp' ? ' (あつぞこブーツ等)' : ''}</button>
        </div>
      </div>
    );
  });
}

// 場に出ただけで表示される特性 (かならず表示されるもの / 条件しだいで表示されるもの)
const ENTRY_ALWAYS = new Set(['intimidate', 'drizzle', 'drought', 'sandstream', 'snowwarning', 'electricsurge', 'grassysurge', 'psychicsurge', 'mistysurge', 'pressure', 'moldbreaker', 'teravolt', 'turboblaze', 'unnerve', 'trace', 'download', 'intrepidsword', 'dauntlessshield', 'airlock', 'cloudnine', 'forewarn', 'screencleaner', 'supremeoverlord', 'neutralizinggas', 'comatose', 'vesselofruin', 'swordofruin', 'tabletsofruin', 'beadsofruin', 'hadronengine', 'orichalcumpulse', 'asoneglastrier', 'asonespectrier', 'curiousmedicine']);
const ENTRY_MAYBE = new Set(['anticipation', 'frisk', 'protosynthesis', 'quarkdrive', 'hospitality', 'zerotohero', 'costar', 'imposter']);

// 相手が場に出たとき: 特性が表示されたかを聞く (表示されなかったら、かならず表示される特性は候補から外す)
function EntryAbilityAsk({battle, mut, usage, toast}) {
  const asks = battle.state.sides.opp.active.filter(i => {
    if (i == null) return false;
    const o = battle.opp[i], c = condOf(battle, 'opp', i);
    if (!o || o.ability || o.entryAsked || c?.fainted || dex.species[c?.forme]?.mega) return false;
    const ab = (dex.species[o.species]?.ab || []).filter(a => !(o.abilityNot || []).includes(a));
    return ab.length > 1 && ab.some(a => ENTRY_ALWAYS.has(a) || ENTRY_MAYBE.has(a));
  });
  if (!asks.length) return null;
  const decide = (i, ab) => {
    mut(b => {
      const o = b.opp[i];
      o.entryAsked = true;
      if (ab) o.ability = ab;
      else {
        o.abilityNot = [...new Set([...(o.abilityNot || []), ...dex.species[o.species].ab.filter(a => ENTRY_ALWAYS.has(a))])];
        const left = dex.species[o.species].ab.filter(a => !o.abilityNot.includes(a));
        if (left.length === 1) o.ability = left[0];
      }
      if (canReplay(b)) replay(b, usage);
    });
    toast(ab ? `特性を${abilityName(ab)}で確定しました` : '場に出たときに表示される特性を候補から外しました');
  };
  return asks.map(i => {
    const o = battle.opp[i];
    const ab = dex.species[o.species].ab.filter(a => !(o.abilityNot || []).includes(a));
    return (
      <div class="tc-box ask">
        <div class="tc-h">相手の{speciesName(o.species)}が場に出たとき、特性は表示されましたか?</div>
        <div class="chips">
          {ab.filter(a => ENTRY_ALWAYS.has(a) || ENTRY_MAYBE.has(a)).map(a => <button class="chip add" onClick={() => decide(i, a)}>{abilityName(a)} が表示された</button>)}
          <button class="chip" onClick={() => decide(i, '')}>表示されなかった</button>
        </div>
        <p class="hint">候補: {ab.map(abilityName).join(' / ')}。{ab.some(a => ENTRY_ALWAYS.has(a)) ? '表示されなかったときは、場に出ると必ず表示される特性を候補から外します。' : ''}</p>
      </div>
    );
  });
}

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
      <h3>バトルログ {editable && battle.turns.length > 0 && <small class="muted">(タップして修正)</small>}</h3>
      <div class="tl" ref={tlRef}>
        {!battle.turns.length && <p class="muted">下のターン入力で、自分の行動を選んでから、動いた順に記録します。記録した順番は行動順として、相手の素早さの推定に使います。</p>}
        {battle.turns.map((t, ti) => (
          <div class="tl-turn" key={t.n}>
            <div class="tl-n">— ターン {t.n}{t.open ? ' (入力中)' : ''} —</div>
            {t.acts.map((a, ai) => (
              <button class={cx('tl-act', a.side, a.type === 'event' && 'ev', a.kind === 'residual' && 'res')} disabled={!editable} onClick={() => setEdit({ti, ai})}>
                <span class="tl-who">{a.sp && a.side ? <Sprite id={a.sp} size={30} /> : null}<span>{SIDE_JA[a.side] || '場'}</span></span>
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
        {!editable && battle.turns.length > 0 && <p class="hint">この対戦は以前の形式で記録されているため、過去の記録は修正できません。</p>}
      </div>
      <Composer battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} />
      {edit && <EditSheet battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} {...edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// ---- 入力欄 (1画面ずつ進む) ----
// ページ: plan (① 自分の行動) → who (② 次に動いたのは) → act (技 → 結果 → ダメージ) → who ... → end (③ ターン終了)
const PAGE_TITLE = {plan: '① 自分の行動', who: '② 行動順', act: '② 行動の内容', end: '③ ターン終了'};

function Composer({battle, ctx, mut, usage, toast}) {
  const [mode, setMode] = useState('flow');
  const [actor, setActor] = useState(null); // {side, mon}
  const open = openTurn(battle);
  const turnNo = open ? open.n : battle.turns.length + 1;
  const planKey = `${battle.id}:${turnNo}`;
  const [plan, setPlanState] = useState(() => plans.get(planKey) || {});
  const startStack = () => (open?.acts.some(a => a.type !== 'event') ? ['plan', 'who'] : ['plan']);
  const [stack, setStack] = useState(startStack);
  const [pendingNext, setPendingNext] = useState(false);
  const backRef = useRef(null);
  useEffect(() => { setPlanState(plans.get(planKey) || {}); setActor(null); setStack(startStack()); }, [planKey]);
  const setPlan = p => { plans.set(planKey, p); setPlanState(p); };
  const page = stack[stack.length - 1];
  const go = p => setStack(s => [...s, p]);
  const back = () => {
    if (page === 'act' && backRef.current?.()) return;
    setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
  };

  const acted = (side, mon) => !!open?.acts.some(a => a.type !== 'event' && a.side === side && (a.mon === mon || a.to === mon));
  const actors = ['me', 'opp'].flatMap(side => alive(battle, side).map(mon => ({side, mon, done: acted(side, mon)})));
  const remaining = actors.filter(a => !a.done);
  const myTodo = alive(battle, 'me').filter(m => !acted('me', m));
  const needSend = ['me', 'opp'].filter(side => {
    const sd = battle.state.sides[side];
    return sd.active.some(x => x == null || condOf(battle, side, x)?.fainted) && benchOf(battle, side).length > 0;
  });
  // 記録したあと: まだ動いていないポケモンがいれば ②、いなければ ③ へ
  useEffect(() => {
    if (!pendingNext) return;
    setPendingNext(false);
    setStack(['plan', 'who', ...(remaining.length ? [] : ['end'])]);
  }, [battle]);
  // ① で決めることがない (全員行動済み・場にいない) ときは ② へ
  useEffect(() => { if (mode === 'flow' && page === 'plan' && !myTodo.length && alive(battle, 'opp').length && !needSend.length) setStack(['plan', 'who']); }, [page, myTodo.length, needSend.length]);

  const record = input => {
    const log = mut(b => addAct(b, {...input, sameTurn: true}, usage));
    toast(log?.length ? log[log.length - 1] : '記録しました');
    setActor(null);
    setPendingNext(true);
  };
  // ① で次に決めるポケモン (ダブルは1体ずつ)
  const [planIdx, setPlanIdx] = useState(0);
  const planMon = myTodo[Math.min(planIdx, myTodo.length - 1)];
  const planDone = p => {
    const next = myTodo.indexOf(planMon) + 1;
    setPlan({...plan, [planMon]: p});
    if (next < myTodo.length) setPlanIdx(next); else { setPlanIdx(0); go('who'); }
  };

  // 片方の選出 (シングル3体) が全員倒れたら終了
  const lostSide = ['opp', 'me'].find(side => faintedCount(battle, side) >= pickCount(battle.format));
  const [keepGoing, setKeepGoing] = useState(false);
  const autoRes = lostSide === 'opp' ? 'win' : 'lose';
  useEffect(() => { if (lostSide && !battle.result && battle.kind !== 'sim') mut(b => { b.result = autoRes; }); }, [lostSide]);
  if (lostSide && !keepGoing) {
    const hasOpen = !!open?.acts.length;
    return (
      <div class="composer">
        <div class={cx('tc-box', 'game-over', autoRes)}>
          <div class="go-title">{lostSide === 'opp' ? `相手を${pickCount(battle.format)}体倒しました。勝ち！` : `自分の${pickCount(battle.format)}体が倒れました。負け`}</div>
          {hasOpen
            ? <button class="btn primary" onClick={() => { mut(b => { finishTurn(b, usage); if (b.kind !== 'sim') b.result = autoRes; }); toast('対戦を終了しました'); }}>最後のターンを確定して終了</button>
            : <p class="muted">対戦の記録は保存されています。結果は右上で変えられます。</p>}
          <button class="btn ghost sm" onClick={() => setKeepGoing(true)}>記録を続ける・直す</button>
        </div>
      </div>
    );
  }
  return (
    <div class="composer">
      <div class="cp-head">
        <strong>ターン {turnNo}</strong>
        <Seg small value={mode} options={[['flow', '行動'], ['ev', 'その他の変化']]} onChange={v => { setMode(v); }} />
      </div>

      {needSend.map(side => (
        <div class="tc-box warn send-ask">
          <div class="tc-h">{(() => { const f = battle.state.sides[side].active.find(x => x != null && condOf(battle, side, x)?.fainted); return f != null ? `${SIDE_JA[side]}の${speciesName(buildOf(battle, side, f).species)}が倒れました。` : ''; })()}<b>{side === 'me' ? '次に出すポケモンを選んでください' : '相手が次に出したポケモンを選んでください'}</b></div>
          <div class="chips">
            {benchOf(battle, side).map(i => <MonBtn battle={battle} side={side} mon={i} onClick={() => { mut(b => addEvent(b, {kind: 'send', side, to: i}, usage)); }} />)}
          </div>
        </div>
      ))}

      <EntryAbilityAsk battle={battle} mut={mut} usage={usage} toast={toast} />
      <EntryHazardAsk battle={battle} mut={mut} usage={usage} toast={toast} />

      {mode === 'ev' && <EventForm battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} />}

      {mode === 'flow' && <>
        <div class="wz-nav">
          <button class="btn sm wz-back" disabled={stack.length <= 1 && page !== 'act'} onClick={back}>‹ 戻る</button>
          <span class="wz-title">{PAGE_TITLE[page]}</span>
          <span class="wz-dots">{['plan', 'who', 'end'].map((k, i) => <i class={cx((page === k || (k === 'who' && page === 'act')) && 'on')}>{i + 1}</i>)}</span>
        </div>

        {page === 'plan' && (
          <div class="tc-box wz-page">
            {planMon != null ? <>
              <p class="hint">相手の選択を待つ間に、{battle.format === 'double' ? `${monName(battle, 'me', planMon)}の` : ''}行動を選んでおきます。選ぶと次の画面に進みます。</p>
              <PlanRow key={planMon} battle={battle} mon={planMon} plan={plan[planMon]} onDone={planDone} onChange={p => setPlan({...plan, [planMon]: p})} />
              <div class="btnrow"><button class="btn ghost sm" onClick={() => go('who')}>あとで選ぶ</button></div>
            </> : <p class="muted">自分のポケモンが場にいません。上で場に出すポケモンを選んでください。</p>}
          </div>
        )}

        {page === 'who' && (
          <div class="tc-box wz-page">
            <p class="hint">{open?.acts.some(a => a.type !== 'event') ? '次に行動したポケモンを選んでください。' : '先に行動したポケモンを選んでください。'}</p>
            <div class="actor-row">
              {remaining.map(a => {
                const p = a.side === 'me' ? plan[a.mon] : null;
                return (
                  <button class={cx('actor-btn', a.side)} onClick={() => {
                    // ① で交代を選んでいたら、そのまま記録する
                    if (p?.type === 'switch') { record({side: 'me', mon: a.mon, type: 'switch', to: p.to}); return; }
                    setActor({side: a.side, mon: a.mon}); go('act');
                  }}>
                    <span class="ab-side">{SIDE_JA[a.side]}</span>
                    <span class="ab-name">{monName(battle, a.side, a.mon)}</span>
                    <span class="ab-sub">{p ? (p.type === 'switch' ? `交代→${speciesName(buildOf(battle, 'me', p.to).species)}` : moveName(p.move)) : a.side === 'opp' ? '技・交代を入力' : '行動を入力'}</span>
                  </button>
                );
              })}
            </div>
            {!remaining.length && <p class="muted">すべてのポケモンの行動を記録しました。</p>}
            {actors.some(a => megaFormes(battle, a.side, a.mon).length) && (
              <div class="mega-row">
                <span class="muted">ターンの最初にメガシンカ:</span>
                {actors.flatMap(a => megaFormes(battle, a.side, a.mon).map((fm, _, arr) => (
                  <button class={cx('btn sm mega-btn', a.side)} onClick={() => { const log = mut(b => addEvent(b, {kind: 'mega', side: a.side, mon: a.mon, forme: fm}, usage)); toast(log?.[log.length - 1] || 'メガシンカ'); }}>
                    {SIDE_JA[a.side]}の{monName(battle, a.side, a.mon)} {megaLabel(fm, arr.length > 1)}
                  </button>
                )))}
              </div>
            )}
            <div class="btnrow">
              <button class={cx('btn grow', !remaining.length && 'primary')} disabled={!open} onClick={() => go('end')}>ターン終了へ{remaining.length > 0 && <small class="muted">&nbsp;(未記録 {remaining.length}体)</small>}</button>
            </div>
          </div>
        )}

        {page === 'act' && actor && (
          <ActForm key={`${actor.side}${actor.mon}${turnNo}`} wizard backRef={backRef} battle={battle} ctx={ctx} usage={usage} side={actor.side} mon={actor.mon}
            init={actor.side === 'me' ? plan[actor.mon] : null} onSubmit={record} />
        )}

        {page === 'end' && open && (
          <EndTurn battle={battle} usage={usage}
            onDone={opts => {
              const log = mut(b => finishTurn(b, usage, opts));
              toast(log?.length ? log[log.length - 1] : 'ターンを終了しました');
            }} />
        )}
        {page === 'end' && !open && <p class="muted pad-s">このターンの記録はまだありません。</p>}
      </>}
    </div>
  );
}

// ① 自分の行動予定 (技か交代を押すと決定)
function PlanRow({battle, mon, plan, onChange, onDone}) {
  const build = battle.my[mon];
  const double = battle.format === 'double';
  const foes = alive(battle, 'opp');
  const bench = benchOf(battle, 'me');
  const [needTarget, setNeedTarget] = useState(null);
  const pickMove = m => {
    const p = {...(plan || {}), type: 'move', move: m, target: null};
    const mv = dex.moves[m];
    if (double && !mv.sp && foes.length > 1) { onChange(p); setNeedTarget(p); return; }
    onDone(p);
  };
  return (
    <div class="plan">
      <div class="move-grid big">
        {(build.moves || []).filter(m => dex.moves[m]).map(m => (
          <button class={cx('mv-btn', plan?.type === 'move' && plan.move === m && 'on')} onClick={() => pickMove(m)}>
            <span class={cx('mv-bar', `t-${dex.moves[m].t}`)} /><span class="mv-nm">{moveName(m)}</span>
          </button>
        ))}
      </div>
      {needTarget && (
        <div class="chips pivot"><span class="muted">対象:</span>{foes.map(i => <button class="chip" onClick={() => onDone({...needTarget, target: {side: 'opp', mon: i}})}>{monName(battle, 'opp', i)}</button>)}</div>
      )}
      {canMegaNow(battle, 'me', mon) && <div class="chips"><Toggle small on={!!plan?.mega} onChange={v => onChange({...(plan || {}), mega: v})}>メガシンカする</Toggle></div>}
      {bench.length > 0 && <div class="sw-row"><span class="muted">交代</span>
        {bench.map(i => <MonBtn battle={battle} side="me" mon={i} on={plan?.type === 'switch' && plan.to === i} onClick={() => onDone({type: 'switch', to: i})} />)}
      </div>}
    </div>
  );
}

// 1体ぶんの行動の入力 (新規・修正で共用)
// wizard: 「技 → 結果 → ダメージ」と1画面ずつ進む。backRef.current() で1つ前の画面に戻る (戻れたら true)
export function ActForm({battle, ctx, usage, side, mon, init, onSubmit, onCancel, submitLabel = '記録する', onDelete, wizard, backRef}) {
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
    return {type: i.type || null, move: i.move || '', to: i.to ?? null, target: t, mega: !!i.mega, megaForme: i.megaForme || '',
      outcome: i.cant ? 'cant' : i.miss ? 'miss' : i.protect ? 'protect' : 'hit', hp, crit: !!i.crit, hits: i.hits || 0,
      defItem: i.defItem?.item || '', atkItem: i.atkItem?.item || '', endured: !!i.endured, healedBy: i.healedBy || [], hpMode: 'left', secFx: i.secFx || [], selfFx: i.selfFx || [], atkHp: '', inflict: i.inflict || (i.move ? STATUS_MOVE[i.move] || '' : '')};
  };
  const [f, setF] = useState(fromInit);
  const [pick, setPick] = useState(null);
  // 予定の技が決まっていれば「結果」から始める
  const [steps, setSteps] = useState(() => (init?.type === 'move' && init.move ? ['result'] : ['move']));
  const step = steps[steps.length - 1];
  const goStep = st => setSteps(s => [...s, st]);
  if (backRef) backRef.current = () => { if (steps.length > 1) { setSteps(s => s.slice(0, -1)); return true; } if (step !== 'move') { setSteps(['move']); return true; } return false; };
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
  // 攻撃を受けた側がターン終了時に回復しうるもの (入れたHPが回復後かどうかを選べるように)
  const healOpts = (() => {
    if (!tgt) return [];
    const tb = buildOf(battle, tgt.side, tgt.mon), tc = condOf(battle, tgt.side, tgt.mon);
    const item = tc?.itemGone ? 'none' : tb.item;
    const out = [];
    if (!item || item === 'leftovers') out.push(['leftovers', 'たべのこし']);
    if ((!item || item === 'blacksludge') && dex.species[currentSpecies(tb, tc)]?.t.includes('Poison')) out.push(['blacksludge', 'くろいヘドロ']);
    if (battle.state.field.terrain === 'Grassy') out.push(['grassy', 'グラスフィールド']);
    return out;
  })();
  const moves = side === 'me'
    ? (build.moves || []).filter(m => dex.moves[m]).map(id => ({id, known: true}))
    : (ctx.views[mon]?.moves || []).slice(0, 10);
  if (f.move && !moves.some(m => m.id === f.move)) moves.push({id: f.move, known: false});

  const build_input = (ff = f) => {
    const input = {side, mon, type: ff.type};
    if (ff.type === 'switch') { input.to = ff.to; return input; }
    const h = ff.outcome === 'hit';
    const m2 = dex.moves[ff.move];
    let hpAfter = null;
    if (h && m2 && m2.c !== 'Z' && ff.hp !== '' && !ff.endured && ff.defItem !== 'focussash') {
      // 自分のHPは「残りHP」か「受けたダメージ」で入れられる
      const left = tgtMax && ff.hpMode === 'dmg' ? Math.max(0, Math.round((tgtNow * tgtMax) / 100) - Number(ff.hp)) : Number(ff.hp);
      hpAfter = tgtMax ? (left / tgtMax) * 100 : left;
    }
    return Object.assign(input, {
      move: ff.move, mega: ff.mega, megaForme: ff.mega ? ff.megaForme || '' : '', crit: h && ff.crit, miss: ff.outcome === 'miss', protect: ff.outcome === 'protect', cant: ff.outcome === 'cant',
      exact: !!tgtMax, endured: h && ff.endured, hits: h && ff.hits ? ff.hits : undefined,
      defItem: h && ff.defItem ? {item: ff.defItem, consumed: consumable(ff.defItem)} : null,
      atkItem: ff.atkItem ? {item: ff.atkItem, consumed: consumable(ff.atkItem)} : null,
      secFx: h && ff.secFx?.length ? ff.secFx : undefined,
      hpUnknown: h && ff.hpUnknown && hpAfter == null ? true : undefined,
      selfFx: h && ff.selfFx?.length ? ff.selfFx : undefined,
      atkHpAfter: h && ff.selfFx?.length && ff.atkHp !== '' && ff.atkHp != null ? (side === 'me' ? (Number(ff.atkHp) / maxHPOf(battle, mon)) * 100 : Number(ff.atkHp)) : undefined,
      target: double ? tgt : null, hpAfter, healedBy: h && hpAfter != null && ff.healedBy.length ? ff.healedBy : undefined, inflict: h && ff.inflict ? ff.inflict : '',
      to: m2 && PIVOT_MOVES.has(ff.move) && h && ff.to != null ? ff.to : null,
    });
  };
  const submit = (patch = {}) => { const ff = {...f, ...patch}; if (!ff.type) return; onSubmit(build_input(ff)); };
  const ready = f.type === 'switch' ? f.to != null : f.type === 'move' && (!!f.move || f.outcome === 'cant');

  // 技を選んだ → 結果へ / 交代を選んだ → そのまま記録 (ウィザード時)
  const chooseMove = id => { set({type: 'move', move: id, inflict: STATUS_MOVE[id] || '', hits: 0, outcome: 'hit'}); if (wizard) goStep('result'); };
  const chooseSwitch = i => { if (wizard) submit({type: 'switch', to: i, move: ''}); else set({type: 'switch', to: i, move: ''}); };
  // 結果を選んだ → ダメージなどの入力が要るなら次へ、要らなければ記録
  const needDetail = m => m && (m.c !== 'Z' || STATUS_MOVE[f.move] || (PIVOT_MOVES.has(f.move) && bench.length) || (double && !m.sp && foes.length > 1));
  // 確率で起きる追加効果: ダメージのあとに「起きたか」を聞く
  const STAT_NAME = {atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ', accuracy: '命中率', evasion: '回避率'};
  const tgtName = tgt ? `${SIDE_JA[tgt.side]}の${monName(battle, tgt.side, tgt.mon)}` : '';
  const selfName = `${SIDE_JA[side]}の${monName(battle, side, mon)}`;
  const boostText = (who, bo) => Object.entries(bo).map(([k, v]) => `${who}の${STAT_NAME[k] || k}が${Math.abs(v) > 1 ? `${Math.abs(v)}段階` : ''}${v > 0 ? '上がった' : '下がった'}`).join('・');
  const secList = ff => {
    const m = dex.moves[ff.move];
    if (!m?.sec || ff.outcome !== 'hit' || !tgt) return [];
    const ko = ff.hp !== '' && Number(ff.hp) <= 0 && (!tgtMax || ff.hpMode !== 'dmg');
    const tc = condOf(battle, tgt.side, tgt.mon);
    const tgtActed = !!openTurn(battle)?.acts.some(x => x.type !== 'event' && x.side === tgt.side && x.mon === tgt.mon);
    const out = [];
    for (const e of m.sec) {
      if (e.sb) out.push({e: {sb: e.sb}, ch: e.ch, label: boostText(selfName, e.sb)});
      if (ko) continue;
      if (e.bo) out.push({e: {bo: e.bo}, ch: e.ch, label: boostText(tgtName, e.bo)});
      if (e.st && !tc?.status && !ff.inflict) for (const st of [].concat(e.st)) out.push({e: {st}, ch: e.ch, label: `${tgtName}が${STATUS_OPTS.find(x => x[0] === st)?.[1] || st}になった`});
      if (e.vo === 'flinch' && !tgtActed) out.push({e: {vo: 'flinch'}, ch: e.ch, label: `${tgtName}がひるんだ`});
      if (e.vo === 'confusion') out.push({e: {vo: 'confusion'}, ch: e.ch, label: `${tgtName}がこんらんした`});
    }
    return out;
  };
  // 記録する前に、追加効果の確認が要るならその画面へ
  // 攻撃した側のHPが変わりうるもの (いのちのたま・反動・吸収・ゴツゴツメット・さめはだ)
  const selfList = ff => {
    const m = dex.moves[ff.move];
    if (!m || m.c === 'Z' || ff.outcome !== 'hit' || !tgt || tgt.side === side) return [];
    const out = [];
    const ab = buildOf(battle, side, mon), ac = condOf(battle, side, mon);
    const tb = buildOf(battle, tgt.side, tgt.mon), tcd = condOf(battle, tgt.side, tgt.mon);
    const rates = s2 => (s2 === 'opp' ? Object.fromEntries(ctx.views[s2 === side ? mon : tgt.mon]?.items || []) : {});
    const aItem = ac.itemGone ? 'none' : ab.item;
    if (aItem === 'lifeorb') out.push({k: 'lifeorb', sure: true});
    else if (side === 'opp' && !ab.item && (rates('opp').lifeorb || 0) > 0) out.push({k: 'lifeorb'});
    if (RECOIL[ff.move] || HALF_RECOIL.has(ff.move)) out.push({k: 'recoil', sure: true});
    if (DRAIN[ff.move]) out.push({k: 'drain', sure: true});
    if (m.fl?.includes('contact')) {
      const tItem = tcd.itemGone ? 'none' : tb.item;
      if (tItem === 'rockyhelmet') out.push({k: 'helmet', sure: true});
      else if (tgt.side === 'opp' && !tb.item) { const r = Object.fromEntries(ctx.views[tgt.mon]?.items || []); if ((r.rockyhelmet || 0) > 0) out.push({k: 'helmet'}); }
      const tAbs = tgt.side === 'me' ? [tb.ability] : tb.ability ? [tb.ability] : dex.species[tb.species]?.ab || [];
      if (tAbs.some(x => x === 'roughskin' || x === 'ironbarbs')) out.push({k: 'roughskin', sure: tAbs.length === 1});
    }
    return out;
  };
  // 記録する前に、追加効果・攻撃した側のHPの確認が要るならその画面へ
  const finish = (patch = {}) => {
    const ff = {...f, ...patch};
    if (wizard && secList(ff).length && !ff.secDone) { set(patch); goStep('sec'); return; }
    if (wizard && selfList(ff).length && !ff.selfDone) { set({...patch, selfFx: selfList(ff).filter(x => x.sure).map(x => x.k)}); goStep('self'); return; }
    submit(patch);
  };
  const chooseOutcome = o => {
    if (!wizard) { set({outcome: o}); return; }
    if (o === 'hit' && needDetail(mv)) { set({outcome: o}); goStep('detail'); return; }
    finish({outcome: o});
  };

  const ref = useRef(null);
  // 画面が変わったら入力欄の先頭 (戻るボタンのある位置) を見せる
  useEffect(() => { const c = ref.current?.closest('.composer'); if (c && wizard) c.scrollTop = 0; }, [step]);
  const show = st => !wizard || step === st;

  const moveSection = (
    <>
      <div class="move-grid big">
        {moves.map(m => (
          <button class={cx('mv-btn', f.type === 'move' && f.move === m.id && 'on', !m.known && 'guess')} onClick={() => chooseMove(m.id)}>
            <span class={cx('mv-bar', `t-${dex.moves[m.id]?.t}`)} /><span class="mv-nm">{moveName(m.id)}</span>
            {!m.known && m.rate ? <small class="rate">{Math.round(m.rate * 100)}%</small> : null}
          </button>
        ))}
        <button class="mv-btn add" onClick={() => setPick('move')}>ほかの技…</button>
      </div>
      {bench.length > 0 && (
        <div class="sw-row"><span class="muted">交代</span>
          {bench.map(i => <MonBtn battle={battle} side={side} mon={i} on={f.type === 'switch' && f.to === i} onClick={() => chooseSwitch(i)} />)}
        </div>
      )}
      <div class="chips">
        {megaFormes(battle, side, mon).map((fm, _, arr) => (
          <button class={cx('btn sm mega-btn', f.mega && (f.megaForme || arr[0]) === fm && 'on')} onClick={() => set(f.mega && (f.megaForme || arr[0]) === fm ? {mega: false, megaForme: ''} : {mega: true, megaForme: fm})}>{megaLabel(fm, arr.length > 1)}した</button>
        ))}
        {wizard && <button class="chip" onClick={() => submit({type: 'move', move: '', outcome: 'cant'})}>行動できず (ひるみ・まひ・ねむり等)</button>}
      </div>
    </>
  );

  const resultSection = f.type === 'move' && f.move && (
    <>
      {wizard && <div class="wz-sub">{moveName(f.move)}{f.mega ? ' (メガシンカ)' : ''} の結果は?</div>}
      {wizard ? (
        <div class="outcome-grid">
          {OUTCOMES.map(([k, l]) => <button class={cx('oc-btn', k)} onClick={() => chooseOutcome(k)}>{l}</button>)}
        </div>
      ) : (
        <div class="af-row"><Seg small value={f.outcome} options={OUTCOMES} onChange={chooseOutcome} />
          {canMegaNow(battle, side, mon) && <Toggle small on={f.mega} onChange={v => set({mega: v})}>メガシンカ</Toggle>}</div>
      )}
    </>
  );

  const detailSection = f.type === 'move' && f.move && hit && (
    <>
      {double && mv && !mv.sp && foes.length > 1 && (
        <div class="chips"><span class="muted">対象:</span>{foes.map(i => <button class={cx('chip', tgt?.mon === i && 'on')} onClick={() => set({target: {side: foeSide, mon: i}})}>{monName(battle, foeSide, i)}</button>)}</div>
      )}
      {damaging && tgt && (
        <div class="af-dmg">
          <label class="af-hp">
            <span>{monName(battle, tgt.side, tgt.mon)}の{tgtMax && f.hpMode === 'dmg' ? '受けたダメージ' : '残りHP'} {tgtMax ? '(実数値)' : '(%)'}
              {tgtMax && <Seg small value={f.hpMode} options={[['left', '残りHP'], ['dmg', 'ダメージ量']]} onChange={v => set({hpMode: v, hp: ''})} />}</span>
            {f.endured || f.defItem === 'focussash' ? <b class="num">1{tgtMax ? '' : '%'} (耐えた)</b> : <>
              <input class="input num" type="number" inputMode="decimal" min={0} max={tgtMax || 100} value={f.hp} autoFocus={wizard}
                placeholder={tgtMax && f.hpMode === 'dmg' ? '0' : String(tgtMax ? Math.round((tgtNow * tgtMax) / 100) : dispOf(tgtNow))} onInput={e => set({hp: e.currentTarget.value})}
                onKeyDown={e => { if (e.key === 'Enter' && ready) finish(); }} />
              <span class="muted">{tgtMax ? (f.hpMode === 'dmg' ? `(いま ${Math.round((tgtNow * tgtMax) / 100)}/${tgtMax})` : `/ ${tgtMax}`) : '%'}</span>
              <button class="chip" onClick={() => set(tgtMax && f.hpMode === 'dmg' ? {hp: String(Math.round((tgtNow * tgtMax) / 100))} : {hp: '0'})}>ひんし</button>
              {wizard && <button class="chip unk" title="回復などで分からなくなったときは、ターン終了時に聞きます" onClick={() => finish({hpUnknown: true, hp: ''})}>? わからない</button>}
            </>}
          </label>
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
          {healOpts.length > 0 && !(f.endured || f.defItem === 'focussash') && (
            <div class="chips">
              <span class="muted">入れたHPは回復したあとの値:</span>
              {healOpts.map(([k, l]) => <button class={cx('chip', f.healedBy.includes(k) && 'on')} onClick={() => set({healedBy: f.healedBy.includes(k) ? f.healedBy.filter(x => x !== k) : [...f.healedBy, k]})}>{l}</button>)}
            </div>
          )}
        </div>
      )}
      {tgt && (
        <div class="chips"><span class="muted">相手が:</span>
          {STATUS_OPTS.map(([k, l]) => <button class={cx('chip', f.inflict === k && 'on')} onClick={() => set({inflict: f.inflict === k ? '' : k})}>{l}</button>)}
        </div>
      )}
      <div class="chips">
        <span class="muted">攻撃側の持ち物:</span>
        <button class={cx('chip', f.atkItem ? 'on' : 'add')} onClick={() => (f.atkItem ? set({atkItem: ''}) : setPick('atk'))}>{f.atkItem ? itemName(f.atkItem) : '判明したら選ぶ…'}</button>
      </div>
      {pivot && bench.length > 0 && (
        <div class="sw-row pivot"><span class="muted">交代先</span>
          {bench.map(i => <MonBtn battle={battle} side={side} mon={i} on={f.to === i} onClick={() => set({to: f.to === i ? null : i})} />)}
        </div>
      )}
    </>
  );

  return (
    <div class={cx('actform', side, wizard && 'wz-page')} ref={ref}>
      <div class="af-h">{SIDE_JA[side]}の{monName(battle, side, mon)}{wizard && step === 'move' ? ' の行動は?' : ''}</div>
      {show('move') && moveSection}
      {show('result') && resultSection}
      {show('detail') && detailSection}
      {wizard && step === 'sec' && (() => {
        const list = secList(f);
        if (list.length === 1) return (
          <div class="sec-ask">
            <div class="wz-sub">追加効果で「{list[0].label}」は発生しましたか? <small class="muted">({list[0].ch}%)</small></div>
            <div class="outcome-grid two">
              <button class="oc-btn" onClick={() => finish({secFx: [list[0].e], secDone: true})}>発生した</button>
              <button class="oc-btn" onClick={() => finish({secFx: [], secDone: true})}>発生しなかった</button>
            </div>
          </div>
        );
        return (
          <div class="sec-ask">
            <div class="wz-sub">追加効果は発生しましたか?</div>
            {list.map(x => (
              <div class="sec-q">
                <span>{x.label} <small class="muted">({x.ch}%)</small></span>
                <div class="sec-btns">
                  <button class={cx('btn', f.secFx.some(y => JSON.stringify(y) === JSON.stringify(x.e)) && 'primary')} onClick={() => set({secFx: [...f.secFx.filter(y => JSON.stringify(y) !== JSON.stringify(x.e)), x.e]})}>発生した</button>
                </div>
              </div>
            ))}
            <div class="btnrow">
              <button class="btn grow" onClick={() => finish({secFx: [], secDone: true})}>発生しなかった</button>
              <button class="btn primary grow" disabled={!f.secFx.length} onClick={() => finish({secDone: true})}>発生した効果で次へ</button>
            </div>
          </div>
        );
      })()}
      {wizard && step === 'self' && (() => {
        const list = selfList(f);
        const amax = side === 'me' ? maxHPOf(battle, mon) : null;
        const now = condOf(battle, side, mon).hp;
        return (
          <div class="sec-ask">
            <div class="wz-sub">攻撃した{SIDE_JA[side]}の{monName(battle, side, mon)}のHPは変わりましたか?</div>
            <div class="chips">
              {list.map(x => { const on = f.selfFx.includes(x.k); return <button class={cx('chip', on && 'on')} onClick={() => set({selfFx: on ? f.selfFx.filter(y => y !== x.k) : [...f.selfFx, x.k]})}>{SELF_FX_JA[x.k]}{x.sure ? '' : ' (起きていたら)'}</button>; })}
            </div>
            {f.selfFx.length > 0 && (
              <label class="af-hp">
                <span>そのあとの{monName(battle, side, mon)}のHP {amax ? '(実数値)' : '(%)'} <small class="muted">入れると相手の最大HPなどを絞り込めます</small></span>
                <input class="input num" type="number" inputMode="decimal" min={0} max={amax || 100} value={f.atkHp} placeholder={amax ? String(Math.round((now * amax) / 100)) : String(dispOf(now))} onInput={e => set({atkHp: e.currentTarget.value})} />
                <span class="muted">{amax ? `/ ${amax}` : '%'}</span>
              </label>
            )}
            <div class="btnrow">
              <button class="btn grow" onClick={() => submit({selfFx: [], selfDone: true})}>変わらなかった</button>
              <button class="btn primary grow" disabled={!f.selfFx.length} onClick={() => submit({selfDone: true})}>記録する</button>
            </div>
          </div>
        );
      })()}
      {!wizard && f.type === 'move' && secList({...f, secFx: []}).length > 0 && (
        <div class="chips"><span class="muted">追加効果:</span>
          {secList({...f, secFx: []}).map(x => { const on = f.secFx.some(y => JSON.stringify(y) === JSON.stringify(x.e)); return <button class={cx('chip', on && 'on')} onClick={() => set({secFx: on ? f.secFx.filter(y => JSON.stringify(y) !== JSON.stringify(x.e)) : [...f.secFx, x.e]})}>{x.label}</button>; })}
        </div>
      )}
      {(!wizard || step === 'detail') && (
        <div class="btnrow">
          {onCancel && <button class="btn" onClick={onCancel}>やめる</button>}
          {onDelete && <button class="btn danger" onClick={onDelete}>削除</button>}
          <button class="btn primary grow" disabled={!ready} onClick={() => (wizard ? finish() : submit())}>{wizard && (secList(f).length || selfList(f).length) ? '次へ' : submitLabel}</button>
        </div>
      )}
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
  const expiries = useMemo(() => expiryCandidates(battle), [battle]);
  const keyOf = c => `${c.side}${c.mon}${c.key}`;
  const [on, setOn] = useState(() => new Set(cands.filter(c => c.checked).map(keyOf)));
  const [noOrder, setNoOrder] = useState(false);
  const [fin, setFin] = useState({}); // ターン終了後のHP (入力したもの)
  const [first, setFirst] = useState('');
  const [exp, setExp] = useState({});
  const toggle = k => setOn(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const fmt = c => (c.side === 'me' ? `${c.hp > 0 ? '+' : ''}${c.hp}` : `${c.pct > 0 ? '+' : ''}${Math.round(c.pct * 10) / 10}%`);
  // ポケモンごとにまとめる (場にいるポケモン全員: HPが分からない攻撃を受けた・回復/定数ダメージがある)
  const open = openTurn(battle);
  const mons = ['me', 'opp'].flatMap(side => alive(battle, side).map(mon => ({side, mon})));
  const groups = mons.map(m => {
    const list = cands.filter(c => c.side === m.side && c.mon === m.mon);
    const unknown = !!open?.acts.some(x => x.hpUnknown && x.target?.side === m.side && x.target?.mon === m.mon);
    const leech = list.some(c => c.key === 'leechheal' || c.key === 'leechseed');
    const c = condOf(battle, m.side, m.mon);
    const max = m.side === 'me' ? maxHPOf(battle, m.mon) : null;
    // チェックした処理を順に当てたあとのHP (計算)
    let hp = c.hp;
    for (const x of list) if (on.has(keyOf(x))) hp = Math.max(0, Math.min(100, hp + x.pct));
    return {...m, list, unknown, leech, max, calc: unknown ? null : hp};
  }).filter(g => g.list.length || g.unknown);
  const sidesWith = new Set(groups.filter(g => g.list.some(x => on.has(keyOf(x)))).map(g => g.side));
  const show = v => (v == null ? '' : v);
  const toPct = (g, v) => (v === '' || v == null ? null : g.max ? (Number(v) / g.max) * 100 : Number(v));
  const done = () => {
    const finalHp = {};
    for (const g of groups) { const p = toPct(g, fin[`${g.side}${g.mon}`]); if (p != null && Number.isFinite(p)) finalHp[`${g.side}${g.mon}`] = p; }
    onDone({
      residual: cands.filter(c => on.has(keyOf(c))), noOrder, finalHp,
      resFirst: first || undefined,
      expiry: expiries.filter(x => exp[x.key] != null).map(x => ({key: x.key, ended: exp[x.key], n: x.n})),
    });
  };
  const missing = groups.some(g => g.unknown && (fin[`${g.side}${g.mon}`] ?? '') === '');
  return (
    <div class="tc-box wz-page">
      {groups.length === 0 && <p class="muted">ターン終了時に処理されるものはありません。</p>}
      {groups.map(g => (
        <div class={cx('res-group', g.side, g.unknown && 'need')}>
          <div class="rg-h"><span class={cx('side-tag', g.side)}>{SIDE_JA[g.side]}</span><b>{monName(battle, g.side, g.mon)}</b></div>
          {g.list.length > 0 && (
            <ul class="res-list">
              {g.list.map(c => (
                <li><label>
                  <input type="checkbox" checked={on.has(keyOf(c))} onChange={() => toggle(keyOf(c))} />
                  {c.label} {!c.unknown && <span class={cx('num', c.pct < 0 ? 'neg' : 'pos')}>{fmt(c)}</span>}
                  {!c.checked && <small class="muted"> (起きていたら)</small>}
                </label></li>
              ))}
            </ul>
          )}
          <label class="rg-hp">
            <span>{g.unknown ? 'ターン終了後のHPは?' : g.leech ? 'ターン終了後のHP (やどりぎの回復量から相手のHPが分かります)' : 'ターン終了後のHP'}</span>
            {g.calc != null && <span class="muted">計算 {g.max ? `${Math.round((g.calc * g.max) / 100)}/${g.max}` : `${dispOf(g.calc)}%`}</span>}
            <input class="input num" type="number" inputMode="decimal" min={0} max={g.max || 100} placeholder={g.unknown ? '入力' : '違えば入力'}
              value={show(fin[`${g.side}${g.mon}`])} onInput={e => setFin({...fin, [`${g.side}${g.mon}`]: e.currentTarget.value})} />
            <span class="muted">{g.max ? `/ ${g.max}` : '%'}</span>
          </label>
          {g.unknown && <p class="hint">分からなかったダメージを、ここで入れたHPから逆算してバトルログを更新します。</p>}
        </div>
      ))}
      {sidesWith.size === 2 && (
        <div class="res-q">
          <span>先に処理されたのは? <small class="muted">(速いほうが先。素早さの推定に使います)</small></span>
          <Seg small value={first} options={[['', 'わからない'], ['me', '自分'], ['opp', '相手']]} onChange={setFirst} />
        </div>
      )}
      {expiries.map(x => (
        <div class="res-q">
          <span>{x.label}は終わりましたか? <small class="muted">({x.n}ターン目{x.byName ? `・${x.byName}` : ''})</small></span>
          <Seg small value={exp[x.key] == null ? '' : exp[x.key] ? 'y' : 'n'} options={[['', '未回答'], ['y', '終わった'], ['n', '続いている']]} onChange={v => setExp({...exp, [x.key]: v === '' ? null : v === 'y'})} />
        </div>
      ))}
      {expiries.some(x => x.n === 5) && <p class="hint">5ターンで終わらなければ、起こしたポケモンは延長する持ち物 (しめったいわ・ひかりのねんど・グランドコートなど) を持っています。</p>}
      <label class="check"><input type="checkbox" checked={noOrder} onChange={e => setNoOrder(e.currentTarget.checked)} />このターンの行動順は素早さの推定に使わない (せんせいのツメ・クイックドロウなど)</label>
      <div class="btnrow">
        {onBack && <button class="btn" onClick={onBack}>戻る</button>}
        <button class="btn primary grow" onClick={done}>{missing ? 'HPを入れずにターンを終える' : 'ターンを終える'}</button>
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
          <p class="hint">「その他の変化」は修正できないため、削除してから記録し直してください。</p>
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
