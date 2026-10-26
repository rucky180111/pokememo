// バトルログ (タップで修正) と、記録の修正フォーム・その他の変化・メガシンカのボタン。
// 入力そのものは盤面 (play.jsx) で行う。修正すると最初の状態から全ターンを入れ直す。
import {logGroups, remainingTurnEffects} from '../engine/log.js';
import {useEffect, useRef, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf, isConsumableItem} from '../engine/dex.js';
import {WEATHERS, TERRAINS, STATUSES, BOOST_KEYS, currentSpecies} from '../engine/calc.js';
import {megaTarget, buildOf, condOf, other, PIVOT_MOVES} from '../engine/battle.js';
import {RECOIL, HALF_RECOIL, DRAIN, SELF_FX_JA, FORCE_MOVES} from '../engine/flow.js';
import {addEvent, openTurn, actLine, canReplay, editAct, deleteActs, reopenLastTurn, dispOf} from '../engine/flow.js';
import {Picker, Sheet, Seg, Toggle, Sprite, cx} from './common.jsx';

const SIDE_JA = {me: '自分', opp: '相手'};
const FLAGS = [['reflect', 'リフレクター'], ['lightScreen', 'ひかりのかべ'], ['auroraVeil', 'オーロラベール'], ['tailwind', 'おいかぜ'], ['sr', 'ステルスロック']];
export const STATUS_OPTS = [['brn', 'やけど'], ['par', 'まひ'], ['psn', 'どく'], ['tox', 'もうどく'], ['slp', 'ねむり'], ['frz', 'こおり']];
// 変化技で必ず入る状態異常 (無効だったら外す)
export {STATUS_MOVE} from '../engine/flow.js';
import {STATUS_MOVE} from '../engine/flow.js';
// 発動すると無くなる持ち物
export const consumable = isConsumableItem;
const OUTCOMES = [['hit', '当たった'], ['miss', '外し'], ['protect', 'まもられた'], ['cant', '行動不能']];

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

/** バトルログ (タップで修正)。右の「ログ・メモ」タブに置く */
export function BattleLog({battle, ctx, mut, usage, toast, notes}) {
  const [edit, setEdit] = useState(null); // {ti, ai}
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState({version: '', keys: []});
  const version = JSON.stringify([battle.id, battle.turns.map(t => [t.n, t.open, t.acts, t.end])]);
  const selected = selection.version === version ? selection.keys : [];
  const allKeys = battle.turns.flatMap((t, ti) => t.acts.map((_, ai) => `${ti}:${ai}`));
  const toggle = keys => setSelection({version, keys: keys.every(k => selected.includes(k)) ? selected.filter(k => !keys.includes(k)) : [...new Set([...selected, ...keys])]});
  const removeSelected = () => {
    let removed = false;
    mut(b => {
      const current = JSON.stringify([b.id, b.turns.map(t => [t.n, t.open, t.acts, t.end])]);
      if (current === version) removed = deleteActs(b, selected.map(k => { const [ti, ai] = k.split(':').map(Number); return {ti, ai}; }), usage);
    });
    if (removed) { setSelection({version: '', keys: []}); setSelecting(false); toast(`${selected.length}件のログを削除しました`); }
    else toast('ログが更新されています。選び直してください');
  };
  const tlRef = useRef(null);
  const nActs = battle.turns.reduce((a, t) => a + t.acts.length, 0);
  useEffect(() => { const el = tlRef.current; if (el) el.scrollTop = el.scrollHeight; }, [nActs, battle.turns.length]);
  const editable = canReplay(battle);
  return (
    <div class="battle-log">
      <h3>バトルログ {editable && battle.turns.length > 0 && <small class="muted">(タップして修正)</small>}</h3>
      {editable && nActs > 0 && <div class="log-select-tools">
        <button class="btn ghost sm" onClick={() => { setSelecting(!selecting); setSelection({version, keys: []}); }}>{selecting ? '選択を終了' : 'まとめて選択'}</button>
        {selecting && <>
          <button class="btn ghost sm" onClick={() => setSelection({version, keys: allKeys})}>全選択</button>
          <button class="btn ghost sm" disabled={!selected.length} onClick={() => setSelection({version, keys: []})}>選択を解除</button>
          <button class="btn danger sm" disabled={!selected.length} onClick={removeSelected}>選択した{selected.length}件を削除</button>
          <small class="muted">選んだ記録とその効果を削除し、盤面・推定を再計算します。</small>
        </>}
      </div>}
      <div class="tl" ref={tlRef}>
        {!battle.turns.length && <p class="muted">下のターン入力で、自分の行動を選んでから、動いた順に記録します。記録した順番は行動順として、相手の素早さの推定に使います。</p>}
        {battle.turns.map((t, ti) => (
          <div class="tl-turn" key={t.n}>
            <div class="tl-n">— ターン {t.n}{t.open ? ' (入力中)' : ''}{t.incomplete && ' (未入力あり)'} —</div>
            {selecting && t.acts.length > 0 && <button class="btn ghost sm log-turn-select" aria-pressed={t.acts.every((_, ai) => selected.includes(`${ti}:${ai}`))} onClick={() => toggle(t.acts.map((_, ai) => `${ti}:${ai}`))}>このターンを選択</button>}
            {logGroups(battle, t).map((group, gi) => <div class={cx('tl-group', group.side)} key={gi}>
              <span class="tl-avatar">{group.species ? <Sprite id={group.species} size={38} /> : <span aria-label="場">◈</span>}<small>{SIDE_JA[group.side] || '場'}</small></span>
              <div class="tl-bubble">{group.actions.map(({a, ai, kind, text, effects}) => <button class={cx('tl-act', a.side, a.type === 'event' && 'ev', a.kind === 'residual' && 'res', selecting && 'selectable', selecting && selected.includes(`${ti}:${ai}`) && 'selected')} aria-pressed={selecting ? selected.includes(`${ti}:${ai}`) : undefined} disabled={!editable} onClick={() => selecting ? toggle([`${ti}:${ai}`]) : setEdit({ti, ai})}>
                {selecting && <span class="log-check" aria-hidden="true">{selected.includes(`${ti}:${ai}`) ? '☑' : '☐'}</span>}
                <span class="log-kind">{kind}</span><span class="tl-body">{text}</span>
                {effects.map(e => <span class="tl-effect"><span class="log-kind">{e.kind}</span><span>{e.text}</span></span>)}
              </button>)}</div>
            </div>)}
            {remainingTurnEffects(t).map(e => <div class="tl-system"><span class="log-kind">{e.kind}</span><span>{e.text}</span></div>)}
            {!selecting && !t.open && ti === battle.turns.length - 1 && editable && (
              <button class="btn ghost sm tl-reopen" onClick={() => { mut(b => { reopenLastTurn(b, usage); }); toast('ターン終了時の定数ダメージ・回復もまとめて取り消しました。行動を追加できます'); }}>このターンに行動を追加する</button>
            )}
            {notes && <input class="input log-note" placeholder="このターンのメモ" value={t.note || ''} onChange={e => mut(b => { b.turns[ti].note = e.currentTarget.value; })} />}
          </div>
        ))}
        {!editable && battle.turns.length > 0 && <p class="hint">この対戦は以前の形式で記録されているため、過去の記録は修正できません。</p>}
      </div>
      {edit && <EditSheet battle={battle} ctx={ctx} mut={mut} usage={usage} toast={toast} {...edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

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
      defItem: i.defItem?.item || '', atkItem: i.atkItem?.item || '', endured: !!i.endured, healedBy: i.healedBy || [], hpMode: 'left', secFx: i.secFx || [], selfFx: i.selfFx || [], atkHp: '', forceTo: i.forceTo ?? null, inflict: i.inflict || (i.move ? STATUS_MOVE[i.move] || '' : '')};
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
  const forced = mv && FORCE_MOVES.has(f.move) && hit && tgt ? benchOf(battle, tgt.side) : null;
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
      forceTo: m2 && FORCE_MOVES.has(ff.move) && h && ff.forceTo != null ? ff.forceTo : undefined,
    });
  };
  const submit = (patch = {}) => { const ff = {...f, ...patch}; if (!ff.type) return; onSubmit(build_input(ff)); };
  const ready = f.type === 'switch' ? f.to != null : f.type === 'move' && (!!f.move || f.outcome === 'cant');

  // 技を選んだ → 結果へ / 交代を選んだ → そのまま記録 (ウィザード時)
  const chooseMove = id => { set({type: 'move', move: id, inflict: STATUS_MOVE[id] || '', hits: 0, outcome: 'hit'}); if (wizard) goStep('result'); };
  const chooseSwitch = i => { if (wizard) submit({type: 'switch', to: i, move: ''}); else set({type: 'switch', to: i, move: ''}); };
  // 結果を選んだ → ダメージなどの入力が要るなら次へ、要らなければ記録
  const needDetail = m => m && (m.c !== 'Z' || STATUS_MOVE[f.move] || (PIVOT_MOVES.has(f.move) && bench.length) || FORCE_MOVES.has(f.move) || (double && !m.sp && foes.length > 1));
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
        {wizard && <button class="chip" onClick={() => submit({type: 'move', move: '', outcome: 'cant'})}>行動不能 (ひるみ・まひ・ねむり等)</button>}
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
      {forced && forced.length > 0 && (
        <div class="sw-row pivot"><span class="muted">{tgt.side === 'opp' ? '相手が' : '自分が'}引きずり出されたのは</span>
          {forced.map(i => <MonBtn battle={battle} side={tgt.side} mon={i} on={f.forceTo === i} onClick={() => set({forceTo: f.forceTo === i ? null : i})} />)}
        </div>
      )}
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
          {onCancel && <button class="btn" onClick={onCancel}>取消</button>}
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
export function EventForm({battle, mut, usage, toast}) {
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
        {ev.kind === 'ability' && <div class="chips">{dex.species[list[mon].species].ab.map(a => <button class="chip" onClick={() => addEv({ability: a, activate: true})}>{abilityName(a)}</button>)}</div>}
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
// メガシンカ: 押すと「確認中」(数値だけメガの姿で見る)。もう一度押すと戻る。
// 確認中にそのポケモンの行動を記録すると、メガシンカも一緒に記録される (preview/setPreview がないときはすぐ記録)
export function MegaButtons({battle, side, mon, mut, usage, preview, setPreview}) {
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
  const record = fm => mut(b => addEvent(b, {kind: 'mega', side, mon, forme: fm}, usage));
  return <>{formes.map(fm => {
    const on = preview === fm;
    const suffix = formes.length > 1 ? (/[XYZＸＹＺ]$/.exec(speciesName(fm))?.[0] || '') : '';
    return (
      <button class={cx('btn mega-btn sm', on && 'on')} aria-pressed={on} title={setPreview ? `${speciesName(fm)}の数値を確認 (もう一度押すと戻る)` : `${speciesName(fm)}にメガシンカした`}
        onClick={() => (setPreview ? setPreview(on ? null : fm) : record(fm))}>
        メガ{suffix}{on ? ' ON' : ' OFF'}
      </button>
    );
  })}
  </>;
}
