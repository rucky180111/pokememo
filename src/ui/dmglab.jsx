// ダメージ計算 (右側のタブ)。盤面の予想よりくわしく、相手の配分・性格・持ち物・特性を自分で動かして試す。
//   上: 相手6体 / 自分6体のアイコン (選んだものが光る)
//   自分: 登録した型そのまま (壁・天候・フィールド・ランク変化も盤面どおり)
//   相手: 能力Ptのスライダー6本 (分かっている分は最初から入っていて、動かせる)、性格補正は ▲/－/▼ を押して切り替え
//   技: 相手はこの対戦で使った技 (固定で上) → 使用率の高い技 TOP10 → 自分で追加した技
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statValue, STAT_KEYS, STAT_JA, SP_MAX, SP_TOTAL, natureMod} from '../engine/dex.js';
import {currentSpecies, currentAbility} from '../engine/calc.js';
import {condOf} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {estimateStats} from '../engine/estimate.js';
import {Picker, Toggle, TypeChip, Sprite, Empty, cx, fmtPct, rate} from './common.jsx';
import {dmgClass} from './battle.jsx';
import {DmgBar} from './board.jsx';
import {outcome} from './play.jsx';

// タブを切り替えても入力が消えないように、対戦ごと・相手ごとに覚えておく
const memo = new Map();
const keyOf = (battle, oi) => `${battle.id || ''}:${oi}`;

/** ▲ (up) と ▼ (down) から性格を決める。片方だけなら、もう片方は影響の小さい攻撃側の能力で補う */
function natureFrom(up, down, bs) {
  if (!up && !down) return {nature: 'Serious', autoUp: null, autoDown: null};
  let u = up, d = down, autoUp = null, autoDown = null;
  const weakAtk = bs[1] <= bs[3] ? 'atk' : 'spa', strongAtk = weakAtk === 'atk' ? 'spa' : 'atk';
  if (u && !d) { d = u === weakAtk ? strongAtk : weakAtk; autoDown = d; }
  if (d && !u) { u = d === strongAtk ? weakAtk : strongAtk; autoUp = u; }
  const nature = Object.keys(dex.natures).find(n => dex.natures[n].p === u && dex.natures[n].m === d) || 'Serious';
  return {nature, autoUp, autoDown};
}

export function DamageLab({battle, ctx}) {
  const activeOpp = battle.state.sides.opp.active.find(i => i != null && !condOf(battle, 'opp', i)?.fainted);
  const activeMe = battle.state.sides.me.active.find(i => i != null && !condOf(battle, 'me', i)?.fainted);
  const [oSel, setOSel] = useState(null);
  const [mSel, setMSel] = useState(null);
  const [crit, setCrit] = useState(false);
  const oi = oSel ?? activeOpp ?? 0;
  const mi = mSel ?? activeMe ?? (battle.pick.me[0] ?? 0);
  const opp = battle.opp[oi];
  const myB = battle.my[mi];
  if (!opp || !myB || !dex.species[opp.species] || !dex.species[myB.species]) return <Empty>自分と相手のポケモンを登録すると表示されます。</Empty>;
  return <LabBody battle={battle} ctx={ctx} oi={oi} mi={mi} setOSel={setOSel} setMSel={setMSel} crit={crit} setCrit={setCrit} />;
}

function LabBody({battle, ctx, oi, mi, setOSel, setMSel, crit, setCrit}) {
  const opp = battle.opp[oi];
  const myB = battle.my[mi];
  const [, force] = useState(0);
  const [adding, setAdding] = useState(false);

  const view = ctx.views[oi];
  const oCond = ctx.cond('opp', oi);
  const base = ctx.build('opp', oi);
  const sid = currentSpecies(base, oCond);
  const s = dex.species[sid];
  const est = useMemo(() => estimateStats(opp, sid), [opp, sid]);

  // 盤面から決まる初期値 (分かっている能力Ptと性格補正だけ)
  const init = useMemo(() => {
    const sp = est.rows.map(r => (r.known ? r.spLo : 0));
    let up = null, down = null;
    for (const r of est.rows) {
      if (!r.known || r.key === 'hp') continue;
      if (r.modLo === r.modHi && r.modLo > 1) up = r.key;
      if (r.modLo === r.modHi && r.modLo < 1) down = r.key;
    }
    return {sp, up, down};
  }, [est]);
  const mk = keyOf(battle, oi);
  const ed = memo.get(mk) || {};
  const set = patch => { memo.set(mk, {...ed, ...patch}); force(x => x + 1); };
  const sp = ed.sp || init.sp;
  const up = ed.up !== undefined ? ed.up : init.up;
  const down = ed.down !== undefined ? ed.down : init.down;
  const item = ed.item !== undefined ? ed.item : (opp.item || view?.build.item || '');
  const ability = ed.ability !== undefined ? ed.ability : currentAbility(base, oCond);
  const {nature, autoUp, autoDown} = natureFrom(up, down, s.bs);
  const total = sp.reduce((a, b) => a + b, 0);

  const oBuild = useMemo(() => ({...base, sp, nature, item, ability, abilityOverride: ed.ability !== undefined ? ability : undefined}), [base, sp.join(), nature, item, ability, ed.ability]);
  const lctx = useMemo(() => {
    const c = {...ctx, build: (side, i) => (side === 'opp' && i === oi ? oBuild : ctx.build(side, i))};
    c.ability = (side, i) => { const bd = c.build(side, i); return bd ? currentAbility(bd, ctx.cond(side, i)) : ''; };
    return c;
  }, [ctx, oi, oBuild]);

  // 相手の技: 使った技 (固定) → 使用率 TOP10 → 追加した技
  const known = (opp.moves || []).filter(m => dex.moves[m]);
  const top = (view?.moves || []).filter(m => !m.known && !known.includes(m.id)).slice(0, 10);
  const extra = (ed.extra || []).filter(m => !known.includes(m) && !top.some(t => t.id === m));
  const oppMoves = [...known.map(id => ({id, known: true})), ...top.map(m => ({id: m.id, rate: m.rate})), ...extra.map(id => ({id, extra: true}))];

  const calc = (side, idx, def, move) => attackTable(lctx, side, idx, {crit, only: {def, move}})?.targets[0]?.results[move] || null;
  const give = useMemo(() => (myB.moves || []).filter(m => dex.moves[m]).map(m => ({id: m, r: calc('me', mi, oi, m)})), [lctx, mi, crit]);
  const take = useMemo(() => oppMoves.map(m => ({...m, r: calc('opp', oi, mi, m.id)})), [lctx, mi, crit, oppMoves.map(m => m.id).join()]);

  const oHP = oCond.fainted ? 0 : oCond.hp ?? 100;
  const mCond = ctx.cond('me', mi);
  const mHP = mCond.fainted ? 0 : mCond.hp ?? 100;
  const myMax = useMemo(() => { const c = ctx.cond('me', mi); return statValue(dex.species[currentSpecies(myB, c)].bs[0], myB.sp[0], 1, true); }, [myB, mi]);
  const oMax = statValue(s.bs[0], sp[0], 1, true);

  const icons = (side, list, sel, setSel) => (
    <div class="dl-icons">
      {list.map((b, i) => {
        if (!b || !dex.species[b.species]) return null;
        const c = condOf(battle, side, i);
        const picked = side === 'opp' ? battle.pick.opp.includes(i) : (!battle.pick.me.length || battle.pick.me.includes(i));
        return (
          <button class={cx('dl-ic', side, sel === i && 'on', c?.fainted && 'out', !picked && 'unpicked', battle.state.sides[side].active.includes(i) && 'field')} onClick={() => setSel(i)} title={speciesName(b.species)}>
            <Sprite id={c?.forme || b.species} size={38} />
          </button>
        );
      })}
    </div>
  );

  const cycle = key => {
    // －(補正なし) → ▲ → ▼ → －
    if (up === key) set({up: null, down: key});
    else if (down === key) set({down: null});
    else set({up: key});
  };
  const modOf = key => (key === 'hp' ? 1 : natureMod(nature, key));
  const row = (label, r, hp, max, sub) => {
    const o = outcome(r, hp, max);
    return (
      <div class="dl-row">
        <div class="dl-mv">{sub}</div>
        {!r?.ok ? <span class="muted dl-v">—</span> : r.status ? <span class="muted dl-v">変化技</span> : r.immune ? <span class="dl-v"><b>効果なし</b></span> : <>
          <DmgBar r={r} hp={hp} />
          <span class={cx('dl-v num', dmgClass(r))}>{fmtPct(r.minPct)}〜{fmtPct(r.maxPct)}%</span>
          <span class={cx('dl-ko', o?.ko)}>{o ? `${o.from}→${o.to} ${o.koLabel}` : ''}</span>
        </>}
      </div>
    );
  };

  return (
    <div class="dl">
      <div class="dl-pick">
        <div><span class="dl-cap opp">相手</span>{icons('opp', battle.opp, oi, setOSel)}</div>
        <div><span class="dl-cap me">自分</span>{icons('me', battle.my, mi, setMSel)}</div>
      </div>

      <section class="dl-opp">
        <div class="dl-h"><Sprite id={sid} size={32} /><b>{s.j}</b>{s.t.map(t => <TypeChip type={t} small />)}
          <span class={cx('dl-total num', total > SP_TOTAL && 'bad')}>{total}/{SP_TOTAL}</span>
          <button class="btn ghost sm" onClick={() => { memo.delete(mk); force(x => x + 1); }}>盤面の値に戻す</button>
        </div>
        <div class="dl-sel">
          <label>持ち物
            <select class="input sm" value={item} onChange={e => (e.currentTarget.value === '__more' ? setAdding('item') : set({item: e.currentTarget.value}))}>
              <option value="">なし</option>
              {item && !(view?.items || []).some(([id]) => id === item) && <option value={item}>{itemName(item)}</option>}
              {(view?.items || []).slice(0, 12).map(([id, r]) => <option value={id}>{itemName(id)}{opp.item === id ? ' (判明)' : r ? ` ${rate(r)}` : ''}</option>)}
              <option value="__more">ほかの持ち物…</option>
            </select>
          </label>
          <label>特性
            <select class="input sm" value={ability} onChange={e => set({ability: e.currentTarget.value})}>
              <option value="">なし (無効)</option>
              {[...new Set([ability, ...s.ab].filter(Boolean))].map(a => {
                const r = (view?.abilities || []).find(x => x[0] === a)?.[1];
                return <option value={a}>{abilityName(a)}{opp.ability === a ? ' (判明)' : r && r < 1 ? ` ${Math.round(r * 100)}%` : ''}</option>;
              })}
            </select>
          </label>
        </div>
        <div class="dl-stats">
          {STAT_KEYS.map((key, i) => {
            const r = est.rows[i];
            const mod = modOf(key);
            const v = statValue(s.bs[i], sp[i], mod, i === 0);
            const isUp = up === key || autoUp === key, isDown = down === key || autoDown === key;
            return (
              <div class={cx('dl-st', r.known && 'known')}>
                <span class="dl-sk">{STAT_JA[i]}</span>
                {i === 0 ? <span class="dl-nat none" /> : (
                  <button class={cx('dl-nat', isUp && 'up', isDown && 'down', (autoUp === key || autoDown === key) && 'auto')} onClick={() => cycle(key)} title="性格補正 (押すと ▲ → ▼ → なし)">
                    {isUp ? '▲' : isDown ? '▼' : '－'}
                  </button>
                )}
                <span class="dl-range">
                  {r.known && <i class="dl-band" style={{left: `${(r.spLo / SP_MAX) * 100}%`, width: `${Math.max(2, ((r.spHi - r.spLo) / SP_MAX) * 100)}%`}} title="これまでの観測と矛盾しない範囲" />}
                  <input type="range" min={0} max={SP_MAX} step={1} value={sp[i]} onInput={e => { const nsp = sp.slice(); nsp[i] = Number(e.currentTarget.value); set({sp: nsp}); }} aria-label={`${STAT_JA[i]}の能力Pt`} />
                </span>
                <span class="dl-sp num">{sp[i]}</span>
                <b class={cx('dl-val num', mod > 1 && 'pos', mod < 1 && 'neg')}>{v}</b>
              </div>
            );
          })}
        </div>
        <p class="hint">{est.rows.some(r => r.known) ? '色の帯は、これまでのダメージ・行動順と矛盾しない範囲です。' : 'まだ観測がないので、能力Ptは0から始まります。'}性格補正の ▲▼ は、片方だけ選ぶともう片方を攻撃側の使わない能力に自動で入れます (薄い表示)。</p>
      </section>

      <div class="dl-opts"><Toggle small on={crit} onChange={setCrit}>急所</Toggle><span class="muted">自分は登録した型、場の状態とランク変化は盤面どおり</span></div>

      <h4 class="me">自分の{speciesName(myB.species)} → 相手 <span class="muted">残り{fmtPct(oHP)}% (H{oMax})</span></h4>
      {give.map(m => row('', m.r, oHP, null, <><TypeChip type={dex.moves[m.id].t} small />{moveName(m.id)}</>))}
      {!give.length && <p class="muted">技が登録されていません。</p>}

      <h4 class="opp">相手 → 自分の{speciesName(myB.species)} <span class="muted">残り{Math.round((myMax * mHP) / 100)}/{myMax}</span></h4>
      {take.map(m => row('', m.r, mHP, myMax, <><TypeChip type={dex.moves[m.id].t} small />{moveName(m.id)}
        {m.known ? <span class="tag sm accent">使用</span> : m.extra ? <button class="chip sm" onClick={() => set({extra: (ed.extra || []).filter(x => x !== m.id)})}>×</button> : <span class="rate">{rate(m.rate)}</span>}</>))}
      <button class="btn ghost sm" onClick={() => setAdding('move')}>＋ 技を追加</button>

      {adding === 'move' && <Picker kind="moves" title="計算する技を追加" rank={view ? Object.fromEntries(view.moves.map(m => [m.id, m.rate])) : null} prefer={dex.learn[opp.species]} preferLabel="覚えない技も表示" onClose={() => setAdding(false)}
        onPick={id => { setAdding(false); if (id) set({extra: [...(ed.extra || []).filter(x => x !== id), id]}); }} />}
      {adding === 'item' && <Picker kind="items" title="相手の持ち物 (計算用)" rank={view?.items?.length ? Object.fromEntries(view.items) : null} onClose={() => setAdding(false)}
        filter={id => !dex.items[id].ms || !!dex.items[id].ms[opp.species]}
        onPick={id => { setAdding(false); if (id != null) set({item: id || ''}); }} />}
    </div>
  );
}
