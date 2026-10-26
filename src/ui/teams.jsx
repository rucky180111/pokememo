// 構築の一覧と編集
import {useMemo, useState} from 'preact/hooks';
import {dex, statsOf, STAT_JA, STAT_KEYS, SP_MAX, SP_TOTAL, spTotal, clampSP, speciesName, itemName, abilityName, moveName, natureName, megaFormeFor} from '../engine/dex.js';
import {newTeam, newBuild, newBattle, clone, uid} from '../engine/battle.js';
import {usageEntries, parseSpread} from '../engine/assume.js';
import {teamRecord, realBattles} from '../engine/predict.js';
import {TeamReport} from './stats.jsx';
import {ShotImport} from './shot-import.jsx';
import {TeamCSVImport} from './team-csv.jsx';
import {TeamExport} from './team-export.jsx';
import {TeamDiagnosis} from './teamdiag.jsx';
import {PickRulesEditor} from './pickrules.jsx';

// 調整メモの並び (優先順位)
const spOrderOf = b => { const o = (b.spOrder || []).filter(k => STAT_KEYS.includes(k)); return [...o, ...STAT_KEYS.filter(k => !o.includes(k))]; };
// 能力ポイントの目印: H は実数値が 16n、上昇補正の能力は 1 ポイントで実数値が 2 上がる点 (11n)
function spMarks(species, sp, nature, i) {
  if (!dex.species[species]) return [];
  const at = v => { const x = sp.slice(); x[i] = v; return statsOf(species, x, nature)[i]; };
  const out = [];
  if (i === 0) { for (let v = 0; v <= SP_MAX; v++) if (at(v) % 16 === 0) out.push(v); return out; }
  if (dex.natures[nature]?.p !== STAT_KEYS[i]) return out;
  for (let v = 1; v <= SP_MAX; v++) if (at(v) - at(v - 1) >= 2) out.push(v);
  return out;
}
import {useApp, Sheet, Picker, Seg, MonName, TypeChip, Sprite, Empty, Confirm, cx} from './common.jsx';

export const FORMAT_OPTS = [['single', 'シングル'], ['double', 'ダブル']];
const natureLabel = n => {
  const d = dex.natures[n];
  if (!d?.p) return `${d?.j || n} (補正なし)`;
  return `${d.j} (${STAT_JA[STAT_KEYS.indexOf(d.p)]}↑ ${STAT_JA[STAT_KEYS.indexOf(d.m)]}↓)`;
};

// ゲーム内と同じ並びの性格表: 行 = 上がる能力、列 = 下がる能力
const NATURE_STATS = [['atk', 'こうげき'], ['def', 'ぼうぎょ'], ['spa', 'とくこう'], ['spd', 'とくぼう'], ['spe', 'すばやさ']];
function NatureGrid({value, onChange}) {
  const find = (up, down) => (up === down ? (up === 'atk' ? 'Serious' : null) : Object.keys(dex.natures).find(n => dex.natures[n].p === up && dex.natures[n].m === down));
  const cur = dex.natures[value]?.p ? value : 'Serious';
  return (
    <div class="scroll-x nature-wrap">
      <table class="nature">
        <thead><tr><th></th>{NATURE_STATS.map(([, l]) => <th class="down">{l}<span aria-hidden="true">▼</span></th>)}</tr></thead>
        <tbody>
          {NATURE_STATS.map(([up, l]) => (
            <tr>
              <th class="up">{l}<span aria-hidden="true">▲</span></th>
              {NATURE_STATS.map(([down]) => {
                const n = find(up, down);
                return <td>{n ? <button class={cx(cur === n && 'on')} aria-pressed={cur === n} onClick={() => onChange(n)}>{dex.natures[n].j}</button> : <span class="blank" />}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function buildSummary(b) {
  const sp = (b.sp || []).map((v, i) => (v ? `${STAT_JA[i]}${v}` : '')).filter(Boolean).join(' ');
  return `${natureName(b.nature)}${sp ? ' / ' + sp : ''}`;
}

// 構築の注意点 (ルール違反になりうる点)
export function teamWarnings(team) {
  const out = [];
  const mons = (team.mons || []).filter(m => dex.species[m.species]);
  const sp = new Map(), it = new Map();
  for (const m of mons) {
    // 同じ図鑑番号のポケモン (リージョンフォームやロトムの各フォルムを含む) は1体まで
    const base = dex.species[m.species].n.split('-')[0];
    sp.set(base, (sp.get(base) || []).concat(m.species));
    if (m.item) it.set(m.item, (it.get(m.item) || 0) + 1);
    if (spTotal(m.sp) > SP_TOTAL) out.push(`${speciesName(m.species)}: 能力ポイントが合計${SP_TOTAL}を超えています`);
    const learn = dex.learn[m.species];
    for (const mv of m.moves || []) if (learn && !learn.includes(mv)) out.push(`${speciesName(m.species)}: ${moveName(mv)} は習得技一覧にありません`);
    if (m.ability && !dex.species[m.species].ab.includes(m.ability)) out.push(`${speciesName(m.species)}: 特性 ${abilityName(m.ability)} は持てません`);
  }
  for (const list of sp.values()) if (list.length > 1) out.push(`同じ種類のポケモンが${list.length}体います (${list.map(speciesName).join('、')})`);
  for (const [k, n] of it) if (n > 1) out.push(`同じ持ち物が${n}個あります (${itemName(k)})`);
  return out;
}

export function TeamList() {
  const {store, nav} = useApp();
  const teams = store.teams();
  const battles = store.battles();
  const [shot, setShot] = useState(false);
  const [csv, setCSV] = useState(false);
  const create = async () => {
    const t = newTeam('single');
    await store.saveTeam(t);
    nav(`#/team/${t.id}`);
  };
  return (
    <div class="page">
      <div class="page-head">
        <h1>構築</h1>
        <div class="btnrow">
          <button class="btn" onClick={() => setCSV(true)}>CSVでまとめて追加</button>
          <button class="btn" onClick={() => setShot(true)}>スクショから追加</button>
          <button class="btn primary" onClick={create}>新しい構築</button>
        </div>
      </div>
      {csv && <TeamCSVImport onClose={() => setCSV(false)} />}
      {shot && <ShotImport onClose={() => setShot(false)} />}
      {!teams.length && <Empty>まだ構築がありません。「新しい構築」から6体を登録すると、対戦の記録とダメージ計算に使えます。</Empty>}
      <div class="cards">
        {teams.map(t => {
          const rec = teamRecord(battles, t.id);
          return (
            <button class="card link" key={t.id} onClick={() => nav(`#/team/${t.id}`)}>
              <div class="card-top">
                <strong>{t.name || '(名前なし)'}</strong>
              </div>
              <div class="team-icons">{t.mons.map(m => <span class="ti-mon" title={speciesName(m.species)}><Sprite id={m.species} size={52} /><small>{speciesName(m.species)}</small></span>)}{!t.mons.length && <span class="muted">ポケモン未登録</span>}</div>
              <div class="card-foot muted">{rec.n ? `${rec.win}勝 ${rec.lose}敗${rec.draw ? ` ${rec.draw}分` : ''} (勝率 ${rec.win + rec.lose ? Math.round((rec.win / (rec.win + rec.lose)) * 100) : '-'}%)` : '対戦記録なし'}</div>
              <span class="card-links">
                {t.mons.length > 0 && <span class="card-link" role="link" onClick={e => { e.stopPropagation(); nav(`#/team/${t.id}?diag`); }}>構築診断 ›</span>}
                {rec.n > 0 && <span class="card-link" role="link" onClick={e => { e.stopPropagation(); nav(`#/stats/${t.id}`); }}>戦績と分析を見る ›</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TeamEditor({id}) {
  const {store, nav, toast} = useApp();
  const team = store.team(id);
  const [edit, setEdit] = useState(null); // 編集中のスロット番号
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState(() => (location.hash.endsWith('?diag') ? 'diag' : 'mons'));
  if (!team) return <div class="page"><Empty>この構築は見つかりません。</Empty><button class="btn" onClick={() => nav('#/teams')}>構築一覧へ</button></div>;
  const save = fn => { const t = clone(team); fn(t); store.saveTeam(t); };
  const usage = store.state.usage[team.format];
  const warnings = teamWarnings(team);
  const nReal = realBattles(store.battles(), {format: 'single', teamId: team.id}).length;
  const startBattle = async kind => {
    if (!team.mons.length) { toast('先にポケモンを登録してください'); return; }
    const b = newBattle({team, kind});
    await store.saveBattle(b);
    nav(`#/battle/${b.id}`);
  };
  const duplicate = async () => {
    const t = clone(team);
    t.id = uid(); t.name = `${team.name} のコピー`; t.createdAt = Date.now();
    await store.saveTeam(t);
    nav(`#/team/${t.id}`);
  };
  return (
    <div class="page">
      <div class="page-head">
        <button class="btn ghost" onClick={() => nav('#/teams')}>‹ 構築一覧</button>
        <div class="btnrow">
          <TeamExport id={team.id} />
          <button class="btn" onClick={() => startBattle('sim')}>仮想盤面</button>
          <button class="btn primary" onClick={() => startBattle('battle')}>対戦を記録</button>
        </div>
      </div>
      <div class="form">
        <label class="field grow"><span>構築名</span>
          <input class="input" value={team.name} onChange={e => save(t => { t.name = e.currentTarget.value; })} />
        </label>
      </div>
      <Seg value={view} options={[['mons', 'ポケモン'], ['rules', `選出ルール${team.pickRules?.length ? ` (${team.pickRules.length})` : ''}`], ['diag', '構築診断'], ['report', `戦績と分析${nReal ? ` (${nReal}戦)` : ''}`]]} onChange={setView} />
      {view === 'report' && <div class="team-report"><TeamReport teamId={team.id} /></div>}
      {view === 'diag' && <div class="team-report"><TeamDiagnosis team={team} /></div>}
      {view === 'rules' && <PickRulesEditor team={team} save={save} />}
      {view === 'mons' && <>
      {warnings.length > 0 && <ul class="warn">{warnings.map(w => <li>{w}</li>)}</ul>}

      <div class="cards">
        {team.mons.map((m, i) => (
          <div class="card" key={i}>
            <button class="card-main" onClick={() => setEdit(i)}>
              <div class="card-top"><MonName id={m.species} icon={48} /><span class="muted">{itemName(m.item) || '持ち物なし'}</span></div>
              <div class="muted">{abilityName(m.ability)} / {buildSummary(m)}</div>
              <div class="num dim">{statsOf(m.species, m.sp, m.nature).join('-')}</div>
              {(m.moves || []).length ? <div class="moves4">{[0, 1, 2, 3].map(i => { const mv = m.moves[i]; return mv ? <span class="chip"><TypeChip type={dex.moves[mv]?.t} small /><span class="mv-nm">{moveName(mv)}</span></span> : <span class="chip empty" />; })}</div> : <span class="muted">技が未設定</span>}
              {spOrderOf(m).some(k => m.spNotes?.[k]) && <ol class="sp-note-list">{spOrderOf(m).filter(k => m.spNotes?.[k]).map(k => <li><b>{STAT_JA[STAT_KEYS.indexOf(k)]}</b> {m.spNotes[k]}</li>)}</ol>}
              {m.note && <div class="note">{m.note}</div>}
            </button>
            <div class="card-tools">
              <button class="btn ghost sm" disabled={i === 0} onClick={() => save(t => { [t.mons[i - 1], t.mons[i]] = [t.mons[i], t.mons[i - 1]]; })} aria-label="上へ">↑</button>
              <button class="btn ghost sm" disabled={i === team.mons.length - 1} onClick={() => save(t => { [t.mons[i + 1], t.mons[i]] = [t.mons[i], t.mons[i + 1]]; })} aria-label="下へ">↓</button>
              <button class="btn ghost sm" onClick={() => save(t => { t.mons.splice(i, 1); })}>外す</button>
            </div>
          </div>
        ))}
        {team.mons.length < 6 && <button class="card add" onClick={() => setEdit(team.mons.length)}>＋ ポケモンを追加 ({team.mons.length}/6)</button>}
      </div>

      <label class="field"><span>構築メモ (コンセプト・選出の基本方針など)</span>
        <textarea class="input" rows={4} value={team.memo} onChange={e => save(t => { t.memo = e.currentTarget.value; })} />
      </label>
      <div class="btnrow pad-s">
        <button class="btn" onClick={duplicate}>複製</button>
        <button class="btn danger" onClick={() => setConfirm(true)}>この構築を削除</button>
      </div>
      </>}

      {edit != null && (
        <MonEditor build={team.mons[edit] || newBuild()} usage={usage} isNew={!team.mons[edit]}
          onSave={b => { save(t => { t.mons[edit] = b; }); setEdit(null); }} onClose={() => setEdit(null)} />
      )}
      {confirm && <Confirm title="構築を削除" message={`「${team.name}」を削除します。この構築で記録した対戦は残ります。`} okLabel="削除する" danger
        onOk={async () => { await store.deleteTeam(team.id); nav('#/teams'); }} onClose={() => setConfirm(false)} />}
    </div>
  );
}

// 1体分の編集 (構築・対戦中の自分のポケモン・相手の型の手入力で共用)
export function MonEditor({build, usage, onSave, onClose, isNew, title, lockSpecies}) {
  const [b, setB] = useState(() => clone(build));
  const [pick, setPick] = useState(isNew && !build.species ? {kind: 'species'} : null);
  const s = dex.species[b.species];
  const stats = s ? statsOf(b.species, b.sp, b.nature) : null;
  const total = spTotal(b.sp);
  const set = patch => setB(prev => ({...prev, ...patch}));
  const entries = useMemo(() => usageEntries(usage, b.species), [usage, b.species]);
  const megaForme = megaFormeFor(b.species, b.item);
  const entry = entries.find(e => e.id === (megaForme || b.species))?.d || entries[0]?.d;
  const rankOf = list => (list ? Object.fromEntries(list) : null);
  const itemRank = useMemo(() => {
    const r = {};
    for (const e of entries) for (const [id, v] of e.d.it || []) r[id] = Math.max(r[id] || 0, v * (e.w || 1));
    const max = Math.max(0, ...Object.values(r));
    if (max > 0) for (const k in r) r[k] /= max;
    return Object.keys(r).length ? r : null;
  }, [entries]);
  const setSP = (i, v) => setB(prev => {
    const sp = prev.sp.slice();
    const others = spTotal(sp) - clampSP(sp[i]);
    sp[i] = Math.min(clampSP(v), Math.max(0, SP_TOTAL - others));
    return {...prev, sp};
  });
  const setSpecies = id => {
    const sp2 = dex.species[id];
    if (b.species === id) return;
    // 特性の初期値は、使用率が分かればいちばん多いもの
    const top = usage?.pokemon?.[id]?.ab?.[0]?.[0];
    setB(prev => ({...prev, species: id, ability: top && sp2.ab.includes(top) ? top : sp2.ab[0], moves: [], item: dex.items[prev.item]?.ms ? '' : prev.item}));
  };
  const applyCommon = () => {
    if (!entry) return;
    const spr = parseSpread(entry.sp?.[0]?.[0]);
    const patch = {moves: (entry.mv || []).slice(0, 4).map(m => m[0])};
    if (spr) { patch.nature = spr.nature; patch.sp = spr.sp; }
    if (!megaForme) { const it = entry.it?.[0]?.[0]; if (it) patch.item = it; const ab = entry.ab?.[0]?.[0]; if (ab && s.ab.includes(ab)) patch.ability = ab; }
    set(patch);
  };
  const megaSpecies = megaForme ? dex.species[megaForme] : null;
  return (
    <Sheet title={title || (isNew ? 'ポケモンを追加' : 'ポケモンを編集')} onClose={onClose} wide
      actions={<button class="btn primary" disabled={!s} onClick={() => onSave(b)}>保存</button>}>
      <div class="editor">
        <div class="form">
          <div class="field grow"><span>ポケモン</span>
            <button class="input as-btn" disabled={lockSpecies} onClick={() => setPick({kind: 'species'})}>{s ? <MonName id={b.species} icon={36} /> : <span class="muted">えらぶ</span>}</button>
          </div>
          <div class="field grow"><span>持ち物</span>
            <button class="input as-btn" onClick={() => setPick({kind: 'items'})}>{b.item ? itemName(b.item) : <span class="muted">なし</span>}</button>
          </div>
        </div>
        {s && <>
          {megaSpecies && <p class="hint">メガシンカ後: {megaSpecies.j} / {megaSpecies.t.map(t => <TypeChip type={t} small />)} / {abilityName(megaSpecies.ab[0])} / 種族値 {megaSpecies.bs.join('-')}</p>}
          <div class="field"><span>特性</span>
            <Seg wrap value={b.ability} options={s.ab.map(a => [a, abilityName(a)])} onChange={v => set({ability: v})} />
          </div>
          <div class="field"><span>性格 (能力補正): {natureLabel(b.nature)}</span>
            <NatureGrid value={b.nature} onChange={v => set({nature: v})} />
          </div>
          <div class="field">
            <span>能力ポイント <b class={cx('num', total > SP_TOTAL && 'bad')}>残り {SP_TOTAL - total}</b> / 種族値 {s.bs.join('-')}</span>
            <div class="sp-grid">
              {STAT_KEYS.map((k, i) => {
                const n = dex.natures[b.nature];
                const mark = n?.p === k ? 'up' : n?.m === k ? 'down' : '';
                return (
                  <div class="sp-row" key={k}>
                    <span class={cx('sp-lb', mark)}>{STAT_JA[i]}</span>
                    <div class="sp-track">
                      <input type="range" min={0} max={SP_MAX} value={b.sp[i]} onInput={e => setSP(i, e.currentTarget.value)} aria-label={`${STAT_JA[i]} の能力ポイント`} />
                      {spMarks(b.species, b.sp, b.nature, i).map(v => <span class={cx('sp-dot', v === b.sp[i] && 'on')} style={{left: `calc(11px + (100% - 22px) * ${v / SP_MAX})`}} onClick={() => setSP(i, v)} />)}
                    </div>
                    <input class="input num sp-num" type="number" inputMode="numeric" min={0} max={SP_MAX} value={b.sp[i]} onInput={e => setSP(i, e.currentTarget.value)} />
                    <button class="btn ghost sm" onClick={() => setSP(i, b.sp[i] === SP_MAX ? 0 : SP_MAX)} aria-label={`${STAT_JA[i]} を${b.sp[i] === SP_MAX ? '0' : '最大'}にする`}>{b.sp[i] === SP_MAX ? '0に' : '最大'}</button>
                    <span class={cx('num sp-val', spMarks(b.species, b.sp, b.nature, i).includes(b.sp[i]) && 'on')}>{stats[i]}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div class="field"><span>技</span>
            <div class="move-grid">
              {[0, 1, 2, 3].map(i => {
                const mv = b.moves[i];
                return (
                  <button class="input as-btn" onClick={() => setPick({kind: 'moves', slot: i})}>
                    {mv ? <><TypeChip type={dex.moves[mv]?.t} small />{moveName(mv)}</> : <span class="muted">技{i + 1}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          {entry && <button class="btn" onClick={applyCommon}>使用率の高い型を入れる (配分・技{megaForme ? '' : '・持ち物・特性'})</button>}
          <div class="field"><span>調整メモ (上から優先順位。↑↓で入れ替え)</span>
            <div class="sp-notes">
              {spOrderOf(b).map((k, j, arr) => {
                const i = STAT_KEYS.indexOf(k);
                const move = d => { const o = arr.slice(); [o[j], o[j + d]] = [o[j + d], o[j]]; set({spOrder: o}); };
                return (
                  <div class="sp-note" key={k}>
                    <span class="sp-note-n num">{j + 1}</span>
                    <span class={cx('sp-lb', dex.natures[b.nature]?.p === k ? 'up' : dex.natures[b.nature]?.m === k ? 'down' : '')}>{STAT_JA[i]}</span>
                    <span class="num muted sp-note-v">{b.sp[i]}<small>→{stats[i]}</small></span>
                    <input class="input" value={b.spNotes?.[k] || ''} onInput={e => set({spNotes: {...(b.spNotes || {}), [k]: e.currentTarget.value}})} />
                    <button class="btn ghost sm" disabled={j === 0} onClick={() => move(-1)} aria-label={`${STAT_JA[i]} を上へ`}>↑</button>
                    <button class="btn ghost sm" disabled={j === arr.length - 1} onClick={() => move(1)} aria-label={`${STAT_JA[i]} を下へ`}>↓</button>
                  </div>
                );
              })}
            </div>
          </div>
          <label class="field"><span>メモ</span>
            <textarea class="input" rows={2} value={b.note || ''} onInput={e => set({note: e.currentTarget.value})} />
          </label>
        </>}
      </div>
      {pick?.kind === 'species' && <Picker kind="species" title="ポケモンをえらぶ" onClose={() => setPick(null)}
        filter={id => !dex.species[id].mega && !dex.species[id].bo}
        rank={usage?.pokemon ? Object.fromEntries(Object.entries(usage.pokemon).map(([k, v]) => [k, v.u])) : null}
        onPick={id => { setSpecies(id); setPick(null); }} />}
      {pick?.kind === 'items' && <Picker kind="items" title="持ち物をえらぶ" allowClear onClose={() => setPick(null)}
        filter={id => !dex.items[id].ms || !!megaFormeFor(b.species, id)} rank={itemRank}
        onPick={id => { set({item: id}); setPick(null); }} />}
      {pick?.kind === 'moves' && <Picker kind="moves" title={`技${pick.slot + 1}をえらぶ`} allowClear onClose={() => setPick(null)}
        prefer={dex.learn[b.species]} preferLabel="覚えない技も表示" rank={rankOf(entry?.mv)}
        onPick={id => {
          setB(prev => { const moves = prev.moves.slice(); if (id) moves[pick.slot] = id; else moves.splice(pick.slot, 1); return {...prev, moves: moves.filter((m, i2) => m && moves.indexOf(m) === i2)}; });
          setPick(null);
        }} />}
    </Sheet>
  );
}
