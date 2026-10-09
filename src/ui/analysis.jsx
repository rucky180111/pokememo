// 盤面からの分析: ダメージ表・素早さ・行動予測
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, STAT_JA} from '../engine/dex.js';
import {calcDamage, currentSpecies, hitRange} from '../engine/calc.js';
import {attackTable, speedTable, speedLine} from '../engine/board.js';
import {PRESETS, spreadLabel, leadRate} from '../engine/assume.js';
import {matchupActions, oppSpeciesStats, sortCounts, pct} from '../engine/predict.js';
import {condOf, other} from '../engine/battle.js';
import {useApp, Sheet, Seg, Toggle, TypeChip, Empty, cx, fmtPct, rate} from './common.jsx';
import {dmgClass} from './battle.jsx';

const CAT_JA = {P: '物理', S: '特殊', Z: '変化'};
const SIDE_JA = {me: '自分', opp: '相手'};

function defaultAttacker(battle, side) {
  const act = battle.state.sides[side].active.find(i => i != null && !condOf(battle, side, i)?.fainted);
  if (act != null) return act;
  const list = side === 'me' ? battle.my : battle.opp;
  const i = list.findIndex((_, k) => !condOf(battle, side, k)?.fainted);
  return i >= 0 ? i : null;
}

export function DamageTab({battle, ctx}) {
  const [dir, setDir] = useState('me');
  const [sel, setSel] = useState({me: null, opp: null});
  const [crit, setCrit] = useState(false);
  const [hh, setHH] = useState(false);
  const [hits, setHits] = useState({});
  const [detail, setDetail] = useState(null);
  const list = dir === 'me' ? battle.my : battle.opp;
  const actives = battle.state.sides[dir].active;
  let atk = sel[dir];
  if (atk == null || !list[atk] || condOf(battle, dir, atk)?.fainted) atk = defaultAttacker(battle, dir);
  const table = useMemo(() => (atk == null ? null : attackTable(ctx, dir, atk, {crit, helpingHand: hh, hits})), [ctx, dir, atk, crit, hh, hits]);
  if (!battle.my.length || !battle.opp.length) return <div class="page-in"><Empty>自分と相手のポケモンを登録すると、ダメージ表が出ます。</Empty></div>;
  const view = dir === 'opp' && atk != null ? ctx.views[atk] : null;
  return (
    <div class="page-in">
      <Seg value={dir} options={[['me', '与ダメージ (自分→相手)'], ['opp', '被ダメージ (相手→自分)']]} onChange={setDir} />
      <div class="chips pad-s">
        <span class="muted">攻撃側:</span>
        {list.map((m, i) => {
          const c = condOf(battle, dir, i);
          if (!dex.species[m.species]) return null;
          return <button class={cx('chip', atk === i && 'on', c?.fainted && 'strike', actives.includes(i) && 'active')} disabled={c?.fainted} onClick={() => setSel({...sel, [dir]: i})}>{speciesName(m.species)}{actives.includes(i) ? ' ●' : ''}</button>;
        })}
      </div>
      <div class="chips">
        <Toggle small on={crit} onChange={setCrit}>急所</Toggle>
        {battle.format === 'double' && <Toggle small on={hh} onChange={setHH}>てだすけ</Toggle>}
        {view && <span class="muted">相手の型: {view.megaForme && !battle.state.mons.opp[atk].forme ? `${speciesName(view.megaForme)} ` : ''}{spreadLabel(view.build.nature, view.build.sp)} / {itemName(view.build.item) || '持ち物なし'}{view.itemGuess ? '?' : ''} ({view.spreadSource})</span>}
      </div>
      {table && table.moves.length === 0 && <Empty>{dir === 'me' ? 'このポケモンに技が登録されていません。' : 'このポケモンの技候補がありません。相手の情報から技を追加してください。'}</Empty>}
      {table && table.moves.length > 0 && (
        <div class="scroll-x">
          <table class="dmg">
            <thead>
              <tr>
                <th class="mv-col">技</th>
                {table.targets.map(t => {
                  const c = ctx.cond(t.side, t.idx);
                  return (
                    <th class={cx(t.active ? 'col-active' : 'col-bench')}>
                      <div class="th-name">{speciesName(t.species)}</div>
                      <div class="th-sub">{t.active ? '場' : '控え'}・{Math.round(c.hp)}%</div>
                      {t.notes.length > 0 && <div class="th-note">{t.notes.join('・')}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {table.moves.map(m => {
                const mv = dex.moves[m.id];
                const hr = hitRange(m.id);
                return (
                  <tr>
                    <th class="mv-col">
                      <div class="mv-name"><TypeChip type={mv.t} small />{mv.j}</div>
                      <div class="mv-sub">
                        {CAT_JA[mv.c]}{mv.bp ? ` ${mv.bp}` : ''}{m.priority ? ` 優先${m.priority > 0 ? '+' : ''}${m.priority}` : ''}
                        {!m.known && <span class="rate"> 採用{rate(m.rate)}</span>}
                        {dir === 'opp' && m.known && <span class="tag sm">確定</span>}
                      </div>
                      {hr && hr[0] !== hr[1] && (
                        <select class="input sm" value={m.hits} aria-label="ヒット数" onChange={e => setHits({...hits, [m.id]: Number(e.currentTarget.value)})}>
                          {Array.from({length: hr[1] - hr[0] + 1}, (_, k) => hr[0] + k).map(n => <option value={n}>{n}回</option>)}
                        </select>
                      )}
                    </th>
                    {table.targets.map(t => {
                      const r = t.results[m.id];
                      if (!r?.ok) return <td class="none">—</td>;
                      if (r.status) return <td class="none">変化</td>;
                      return (
                        <td class={dmgClass(r)}>
                          <button class="cell" onClick={() => setDetail({dir, atk, def: t.idx, move: m.id, active: t.active})}>
                            {r.immune ? <span class="pc">無効</span> : <>
                              <span class="pc num">{fmtPct(r.minPct)}–{fmtPct(r.maxPct)}%</span>
                              <span class="ko">{r.koText}</span>
                            </>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="legend">
        <span class="lg ko1">確定1発</span><span class="lg ko1r">乱数1発</span><span class="lg ko2">2発圏内</span><span class="lg ko3">3発圏内</span>
        <span class="muted">割合は最大HP比、確定数は現在HP基準。控えは「交代で出てきた場合」で、設置技・いかく・天候変化を加味します。マスをタップで内訳。</span>
      </p>
      {detail && <DamageDetail battle={battle} ctx={ctx} d={detail} opts={{crit, helpingHand: hh, hits}} onClose={() => setDetail(null)} />}
    </div>
  );
}

// 1マス分の内訳と、相手の型を変えた場合の比較
function DamageDetail({battle, ctx, d, opts, onClose}) {
  const defSide = other(d.dir);
  const table = attackTable(ctx, d.dir, d.atk, opts);
  const target = table.targets.find(t => t.idx === d.def);
  const r = target.results[d.move];
  const oppIdx = d.dir === 'me' ? d.def : d.atk;
  const oppBuild = ctx.build('opp', oppIdx);
  // 相手の型を差し替えて同じ条件で再計算する
  const variants = useMemo(() => {
    const out = [];
    const keys = d.dir === 'me' ? ['none', 'hb', 'hd'] : ['none', 'ha', 'hc', 'as', 'cs'];
    const s = dex.species[oppBuild.species];
    for (const k of keys) {
      const p = PRESETS[k];
      let nature = p.nature;
      if (k === 'hb' && s.bs[1] > s.bs[3]) nature = 'Impish';
      if (k === 'hd' && s.bs[1] > s.bs[3]) nature = 'Careful';
      const alt = {...oppBuild, nature, sp: p.sp};
      const ctx2 = {...ctx, build: (side, i) => (side === 'opp' && i === oppIdx ? alt : ctx.build(side, i))};
      const t2 = attackTable(ctx2, d.dir, d.atk, opts);
      out.push({label: p.label, r: t2.targets.find(t => t.idx === d.def)?.results[d.move]});
    }
    return out;
  }, [ctx, d]);
  const aSp = table.species, dSp = target.species;
  return (
    <Sheet title={`${speciesName(aSp)} の ${moveName(d.move)} → ${speciesName(dSp)}`} onClose={onClose}>
      <div class="pad">
        <p class={cx('big', dmgClass(r))}><span class="num">{fmtPct(r.minPct)}–{fmtPct(r.maxPct)}%</span> <span>{r.koText || (r.immune ? '無効' : '')}</span></p>
        {!r.immune && <p class="num">ダメージ {r.min}–{r.max} / 相手の残りHP {r.defHP}/{r.defMaxHP}{r.hits > 1 ? ` / ${r.hits}回ヒット合計` : ''}</p>}
        {target.notes.length > 0 && <p class="hint">{target.notes.join('・')}</p>}
        {r.rolls && r.rolls.length === 16 && <p class="rolls num">{r.rolls.join(' ')}</p>}
        {r.desc && <p class="hint en">{r.desc}</p>}
        <h4>{d.dir === 'me' ? '相手の耐久を変えた場合' : '相手の火力を変えた場合'} <span class="muted">(持ち物・特性はそのまま)</span></h4>
        <table class="mini">
          <tbody>
            <tr><th>いまの想定 ({spreadLabel(oppBuild.nature, oppBuild.sp)})</th><td class={dmgClass(r)}>{r.immune ? '無効' : `${fmtPct(r.minPct)}–${fmtPct(r.maxPct)}%`}</td><td>{r.koText}</td></tr>
            {variants.map(v => v.r?.ok && (
              <tr><th>{v.label}</th><td class={dmgClass(v.r)}>{v.r.immune ? '無効' : `${fmtPct(v.r.minPct)}–${fmtPct(v.r.maxPct)}%`}</td><td>{v.r.koText}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sheet>
  );
}

// ---- 素早さ ----
export function SpeedTab({battle, ctx}) {
  const mine = battle.state.sides.me.active.filter(i => i != null && !condOf(battle, 'me', i)?.fainted);
  const line = useMemo(() => speedLine(ctx), [ctx]);
  const tr = battle.state.field.trickRoom;
  const sorted = line.slice().sort((a, b) => ((b.speed ?? b.assumed) - (a.speed ?? a.assumed)) * (tr ? -1 : 1));
  return (
    <div class="page-in">
      {tr && <p class="hint warn-box">トリックルーム中: 素早さが低いほうが先に動きます。</p>}
      {!mine.length && <Empty>自分のポケモンを場に出すと、対面ごとの比較が出ます。</Empty>}
      {mine.map(mi => {
        const t = speedTable(ctx, mi);
        if (!t) return null;
        return (
          <div class="box" key={mi}>
            <h4>{speciesName(currentSpecies(battle.my[mi], battle.state.mons.me[mi]))} <span class="num big-num">{t.my}</span> <span class="muted">(補正込みの素早さ)</span></h4>
            {!t.rows.length && <p class="muted">相手のポケモンが場にいません。</p>}
            {t.rows.map(row => {
              const o = row.outlook;
              const first = v => (v === t.my ? 'tie' : (v > t.my) !== tr ? 'opp' : 'me');
              return (
                <div class="spd" key={row.idx}>
                  <div class="spd-head">vs <strong>{speciesName(o.speciesId)}</strong> <span class="muted">素早さ種族値 {o.base}</span></div>
                  {o.pFaster != null && (
                    <div class="prob">
                      <div class="probbar"><span class="p-me" style={{width: `${o.pSlower * 100}%`}} /><span class="p-tie" style={{width: `${o.pTie * 100}%`}} /><span class="p-opp" style={{width: `${o.pFaster * 100}%`}} /></div>
                      <div class="prob-txt">自分が先 <b>{rate(o.pSlower)}</b>・同速 {rate(o.pTie)}・相手が先 <b>{rate(o.pFaster)}</b> <span class="muted">(使用率の配分{o.canScarf && o.pScarf > 0 ? `・スカーフ率 ${rate(o.pScarf)}` : ''}から算出)</span></div>
                    </div>
                  )}
                  <table class="mini">
                    <thead><tr><th></th>{o.bench.map(b => <th>{b.label}</th>)}</tr></thead>
                    <tbody>
                      <tr><th>そのまま</th>{o.bench.map(b => <td class={cx('num', `who-${first(b.eff)}`, !b.ok && 'ruled')}>{b.eff}</td>)}</tr>
                      {o.canScarf && <tr><th>スカーフ</th>{o.bench.map(b => <td class={cx('num', `who-${first(b.scarfEff)}`, !b.okScarf && 'ruled')}>{b.scarfEff}</td>)}</tr>}
                    </tbody>
                  </table>
                  {o.range && <p class="hint">行動順からの絞り込み: {o.range.plain ? `実数値 ${o.range.plain[0]}〜${o.range.plain[1]}` : 'スカーフなしでは説明がつかない'}{o.range.scarf && o.canScarf ? ` / スカーフなら ${o.range.scarf[0]}〜${o.range.scarf[1]}` : ''}</p>}
                </div>
              );
            })}
          </div>
        );
      })}
      <p class="legend"><span class="lg who-me">自分が先</span><span class="lg who-opp">相手が先</span><span class="lg who-tie">同速</span><span class="muted">打ち消し線は、記録した行動順と合わない配分です。</span></p>
      <div class="box">
        <h4>全体の素早さ順 <span class="muted">(相手は推定型。場の補正込み)</span></h4>
        <ol class="spdline">
          {sorted.map(e => (
            <li class={e.side}>
              <span class={cx('side-tag', e.side)}>{SIDE_JA[e.side]}</span>
              <span class="nm">{speciesName(e.species)}</span>
              <span class="num">{e.side === 'me' ? e.speed : e.assumed}</span>
              {e.side === 'opp' && <span class="muted num">最遅 {e.bench[3].eff}〜最速 {e.bench[0].eff}{e.canScarf ? ` (スカーフ ${e.bench[0].scarfEff})` : ''}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ---- 行動予測 ----
function Bars({title, entries, total, name, note}) {
  if (!entries.length) return null;
  return (
    <div class="bars">
      <h5>{title} {note && <span class="muted">{note}</span>}</h5>
      {entries.map(([k, n]) => (
        <div class="bar-row">
          <span class="bar-lb">{name(k)}</span>
          <span class="bar"><span style={{width: `${Math.min(100, (n / total) * 100)}%`}} /></span>
          <span class="num bar-v">{total === 1 ? `${(n * 100).toFixed(0)}%` : `${n}回 (${pct(n, total)}%)`}</span>
        </div>
      ))}
    </div>
  );
}

export function PredictTab({battle, ctx}) {
  const {store} = useApp();
  const [sel, setSel] = useState(null);
  const battles = store.battles().filter(b => b.id !== battle.id);
  const oppActive = battle.state.sides.opp.active.filter(i => i != null);
  const idx = sel != null && battle.opp[sel] ? sel : oppActive[0] ?? (battle.opp.length ? 0 : null);
  if (idx == null) return <div class="page-in"><Empty>相手のポケモンを登録すると、行動の傾向が出ます。</Empty></div>;
  const o = battle.opp[idx];
  const v = ctx.views[idx];
  const myActive = battle.state.sides.me.active.filter(i => i != null).map(i => battle.my[i]?.species).filter(Boolean);
  const filter = {format: battle.format};
  const st = oppSpeciesStats(battles, o.species, filter);
  const general = matchupActions(battles, o.species, null, filter);
  const acts = a => [...sortCounts(a.moves).map(([k, n]) => [`m:${k}`, n]), ...sortCounts(a.switches).map(([k, n]) => [`s:${k}`, n])].sort((x, y) => y[1] - x[1]).slice(0, 8);
  const actName = k => (k.startsWith('m:') ? moveName(k.slice(2)) : `交代 → ${speciesName(k.slice(2))}`);
  const usageMeta = store.state.usage[battle.format];
  return (
    <div class="page-in">
      <div class="chips">
        {battle.opp.map((x, i) => <button class={cx('chip', idx === i && 'on')} onClick={() => setSel(i)}>{speciesName(x.species)}{oppActive.includes(i) ? ' ●' : ''}</button>)}
      </div>

      <div class="box">
        <h4>自分の対戦記録から <span class="muted">({battle.format === 'double' ? 'ダブル' : 'シングル'}・実戦のみ)</span></h4>
        {st.seen === 0 && <p class="muted">{speciesName(o.species)} との対戦記録はまだありません。記録が増えるほど、この欄が当たるようになります。</p>}
        {st.seen > 0 && <p>見せ合いに {st.seen}回 / 選出 {st.picked}回 ({pct(st.picked, st.seen)}%) / 初手 {st.lead}回 / 選出された試合 {st.pickedWin}勝 {st.pickedLose}敗</p>}
        {myActive.map(ms => {
          const m = matchupActions(battles, o.species, ms, filter);
          if (!m.n) return <p class="muted">自分の{speciesName(ms)}との対面: 記録なし</p>;
          return <Bars title={`自分の${speciesName(ms)}との対面で相手がしたこと`} note={`${m.n}回`} entries={acts(m)} total={m.n} name={actName} />;
        })}
        {general.turn1.n > 0 && <Bars title="1ターン目の行動" note={`${general.turn1.n}回`} entries={acts(general.turn1)} total={general.turn1.n} name={actName} />}
        {general.n > 0 && <Bars title="全対面での行動" note={`${general.n}回`} entries={acts(general)} total={general.n} name={actName} />}
        {Object.keys(st.items).length > 0 && <Bars title="判明した持ち物" entries={sortCounts(st.items)} total={st.seen} name={itemName} />}
        {Object.keys(st.moves).length > 0 && <Bars title="判明した技" note={`技が見えた ${st.moveBattles}戦中`} entries={sortCounts(st.moves).slice(0, 8)} total={st.moveBattles} name={moveName} />}
      </div>

      <div class="box">
        <h4>使用率データから <span class="muted">(Pokémon Showdown {usageMeta?.month || ''} {usageMeta?.source || ''})</span></h4>
        {!v?.hasData && <p class="muted">このポケモンの使用率データがありません。</p>}
        {v?.hasData && <>
          <p>パーティ採用率 {rate(v.usageAll || 0, 1)}{v.megaForme ? ` (うち${speciesName(v.megaForme)} ${rate(v.megaP)})` : ''} / パーティにいるとき初手に出る率 {rate(leadRate(v, battle.format))}</p>
          <Bars title="技の採用率" entries={v.moves.filter(m => !m.known).slice(0, 10).map(m => [m.id, m.rate])} total={1} name={moveName} />
          <Bars title="持ち物" entries={(v.items || []).slice(0, 6)} total={1} name={k => itemName(k) || 'なし'} />
          <Bars title="特性" entries={(v.abilities || []).slice(0, 3)} total={1} name={abilityName} />
          <Bars title="配分" entries={(v.spreads || []).slice(0, 5).map(s => [spreadLabel(s.nature, s.sp), s.rate])} total={1} name={k => k} />
        </>}
        <p class="hint">Showdown の対戦から集計された値で、ゲーム内ランクバトルの使用率とは母集団が違います。目安として使ってください。</p>
      </div>
    </div>
  );
}
