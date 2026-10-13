// 統計: 自分の戦績と、相手ポケモンごとの傾向
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, moveName, abilityName} from '../engine/dex.js';
import {realBattles, oppSpeciesStats, matchupActions, sortCounts, pct, teamAnalysis} from '../engine/predict.js';
import {usageEntries, parseSpread, spreadLabel, leadRate} from '../engine/assume.js';
import {useApp, Sheet, Seg, Empty, MonName, Sprite, cx, rate} from './common.jsx';

export function StatsScreen({initialTeam}) {
  const {store} = useApp();
  const fmt = 'single';
  const [teamId, setTeamId] = useState(() => {
    if (initialTeam && store.team(initialTeam)) return initialTeam;
    // いちばん最近の対戦で使った構築を最初に出す
    const last = store.battles().filter(b => b.teamId && !b.deleted && b.kind !== 'sim').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    return last?.teamId || '';
  });
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('mine');
  const teams = store.teams();
  const usage = store.state.usage[fmt];
  const usageList = useMemo(() => (usage?.pokemon ? Object.entries(usage.pokemon).sort((a, b) => b[1].u - a[1].u).slice(0, 100) : []), [usage]);
  return (
    <div class="page">
      <div class="page-head"><h1>統計</h1></div>
      <Seg value={tab} options={[['mine', '自分の対戦記録'], ['usage', '使用率データ']]} onChange={setTab} />
      {tab === 'mine' && <>
        <label class="field pad-s"><span>構築で絞り込む</span>
          <select class="input" value={teamId} onChange={e => setTeamId(e.currentTarget.value)}>
            <option value="">すべての構築</option>
            {teams.map(t => <option value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <TeamReport teamId={teamId} />
      </>}
      {tab === 'usage' && <>
        <p class="hint pad-s">Pokémon Showdown の対戦から集計された使用率 ({usage?.month || '—'} / {usage?.source || '—'} / {usage?.battles?.toLocaleString() || '—'}戦)。ゲーム内ランクバトルとは母集団が違うので目安です。「設定」から最新に更新できます。</p>
        {!usageList.length && <Empty>使用率データを読み込めていません。</Empty>}
        <div class="scroll-x">
          <table class="mini wide">
            <thead><tr><th>#</th><th>ポケモン</th><th>採用率</th><th>初手率</th><th>よくある持ち物</th></tr></thead>
            <tbody>
              {usageList.map(([id, d], i) => (
                <tr class="clickable" onClick={() => setDetail(dex.species[id].mega || id)}>
                  <td class="num">{i + 1}</td><th><span class="row-mon"><Sprite id={id} size={32} />{speciesName(id)}</span></th><td class="num">{rate(d.u, 1)}</td><td class="num">{rate(leadRate(d, fmt))}</td>
                  <td>{d.it.slice(0, 2).map(([k]) => itemName(k) || 'なし').join('・')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      {detail && <SpeciesDetail species={detail} fmt={fmt} teamId={teamId} onClose={() => setDetail(null)} />}
    </div>
  );
}

// 構築の戦績と分析 (統計画面・構築画面の両方で使う)
export function TeamReport({teamId}) {
  const {store} = useApp();
  const fmt = 'single';
  const [sub, setSub] = useState('mons');
  const [psort, setPsort] = useState('n');
  const [detail, setDetail] = useState(null);
  const battles = store.battles();
  const filter = {format: fmt, teamId: teamId || undefined};
  const real = realBattles(battles, filter);
  const decided = real.filter(b => b.result);
  const win = decided.filter(b => b.result === 'win').length, lose = decided.filter(b => b.result === 'lose').length;
  return (
    <>
      <div class="kpis">
        <div class="kpi"><span class="kpi-v num">{real.length}</span><span class="kpi-l">記録した対戦</span></div>
        <div class="kpi"><span class="kpi-v num">{win}-{lose}</span><span class="kpi-l">勝ち-負け</span></div>
        <div class="kpi"><span class="kpi-v num">{win + lose ? `${Math.round((win / (win + lose)) * 100)}%` : '—'}</span><span class="kpi-l">勝率</span></div>
      </div>
      {!real.length && <Empty>この構築の対戦記録がまだありません。対戦を記録すると、選出率・勝率・選出パターン・相手ごとの勝率がここに貯まっていきます。</Empty>}
      {real.length > 0 && <TeamAnalysis battles={battles} filter={filter} team={store.team(teamId)} sub={sub} setSub={setSub} psort={psort} setPsort={setPsort} onOpp={setDetail} />}
      {detail && <SpeciesDetail species={detail} fmt={fmt} teamId={teamId} onClose={() => setDetail(null)} />}
    </>
  );
}

function SpeciesDetail({species, fmt, teamId, onClose}) {
  const {store} = useApp();
  const battles = store.battles();
  const filter = {format: fmt, teamId: teamId || undefined};
  const st = oppSpeciesStats(battles, species, filter);
  const acts = matchupActions(battles, species, null, filter);
  const entries = usageEntries(store.state.usage[fmt], species);
  const line = (title, list, name, total) => list.length > 0 && <p><b>{title}</b> {list.map(([k, n]) => `${name(k)} ${total ? `${n}回` : rate(n)}`).join('、')}</p>;
  return (
    <Sheet title={speciesName(species)} onClose={onClose} wide>
      <div class="pad">
        <p><MonName id={species} icon={56} /> <span class="num dim">種族値 {dex.species[species].bs.join('-')}</span></p>
        <h4>自分の対戦記録</h4>
        {!st.seen && <p class="muted">記録なし</p>}
        {st.seen > 0 && <>
          <p>遭遇 {st.seen}回 / 選出 {st.picked}回 ({pct(st.picked, st.seen)}%) / 初手 {st.lead}回 / 選出時 {st.pickedWin}勝 {st.pickedLose}敗 / メガシンカ確認 {st.mega}回</p>
          {line('持ち物', sortCounts(st.items), itemName, true)}
          {line('特性', sortCounts(st.abilities), abilityName, true)}
          {line('技', sortCounts(st.moves).slice(0, 10), moveName, true)}
          {acts.n > 0 && line('行動', [...sortCounts(acts.moves).map(([k, n]) => [moveName(k), n]), ...sortCounts(acts.switches).map(([k, n]) => [`交代→${speciesName(k)}`, n])].sort((a, b) => b[1] - a[1]).slice(0, 10), k => k, true)}
          {acts.turn1.n > 0 && line('1ターン目', [...sortCounts(acts.turn1.moves).map(([k, n]) => [moveName(k), n]), ...sortCounts(acts.turn1.switches).map(([k, n]) => [`交代→${speciesName(k)}`, n])].sort((a, b) => b[1] - a[1]).slice(0, 6), k => k, true)}
        </>}
        <h4>使用率データ</h4>
        {!entries.length && <p class="muted">データなし</p>}
        {entries.map(e => (
          <div class="box" key={e.id}>
            <h5><Sprite id={e.id} size={32} />{speciesName(e.id)} <span class="muted">採用率 {rate(e.d.u, 1)} / 初手率 {rate(leadRate(e.d, fmt))}</span></h5>
            {line('技', e.d.mv.slice(0, 10), moveName)}
            {line('持ち物', e.d.it.slice(0, 6), k => itemName(k) || 'なし')}
            {line('特性', e.d.ab, abilityName)}
            {line('配分', e.d.sp.slice(0, 5).map(([k, r]) => { const p = parseSpread(k); return [p ? spreadLabel(p.nature, p.sp) : k, r]; }), k => k)}
            {line('同じパーティにいやすい', e.d.tm.slice(0, 8), speciesName)}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// 率のマス: 上に % (高いと青・低いと赤)、下に 分子/分母
function RateCell({n, d, hi = 0.6, lo = 0.4, plain}) {
  const r = d ? n / d : null;
  return (
    <span class={cx('rc', r == null ? 'none' : !plain && r >= hi ? 'hi' : !plain && r <= lo ? 'lo' : '')}>
      <b>{r == null ? '-' : `${Math.round(r * 100)}`}<small>{r == null ? '' : '%'}</small></b>
      <span class="num">{n} / {d}</span>
    </span>
  );
}

function TeamAnalysis({battles, filter, team, sub, setSub, psort, setPsort, onOpp}) {
  const A = useMemo(() => teamAnalysis(battles, filter), [battles, filter.teamId]);
  const dec = (w, l) => w + l;
  // 構築の6体 (構築を選んでいなければ、選出したことのあるポケモン)
  const mons = team ? team.mons.map(m => m.species).filter(Boolean) : Object.keys(A.mons);
  const pats = Object.values(A.patterns).sort((a, b) => (psort === 'win' ? (b.win / Math.max(1, dec(b.win, b.lose))) - (a.win / Math.max(1, dec(a.win, a.lose))) || b.n - a.n : b.n - a.n));
  const opps = Object.entries(A.opps).filter(([, e]) => e.picked > 0)
    .map(([sp, e]) => ({sp, ...e, wr: dec(e.win, e.lose) ? e.win / dec(e.win, e.lose) : null}))
    .sort((a, b) => (psort === 'win' ? (b.wr ?? -1) - (a.wr ?? -1) || b.picked - a.picked : b.picked - a.picked || (b.wr ?? -1) - (a.wr ?? -1)));
  // 勝率ごとにまとめる (同じ勝率のポケモンを1段に)
  const groups = [];
  for (const o of opps) { const key = o.wr == null ? '-' : `${Math.round(o.wr * 100)}`; let g = groups.find(x => x.key === key); if (!g) groups.push(g = {key, list: []}); g.list.push(o); }
  if (psort === 'win') groups.sort((a, b) => (b.key === '-' ? -1 : Number(b.key)) - (a.key === '-' ? -1 : Number(a.key)));
  return (
    <div class="ta">
      <Seg value={sub} options={[['mons', '自分のポケモン'], ['pattern', '選出パターン'], ['opp', '相手 (敵分析)']]} onChange={setSub} />
      {A.n < battles.filter(b => !b.deleted && b.kind !== 'sim' && (!filter.teamId || b.teamId === filter.teamId)).length && <p class="hint">自分の選出を記録した {A.n}戦で集計しています (選出が未入力の対戦は含みません)。</p>}
      {sub === 'mons' && (
        <div class="ta-table">
          <div class="ta-row head"><span></span><span>選出率</span><span>勝率</span><span>初手率</span><span>初手勝率</span></div>
          {mons.map(sp => {
            const m = A.mons[sp] || {picked: 0, win: 0, lose: 0, lead: 0, leadWin: 0, leadLose: 0};
            return (
              <div class="ta-row">
                <span class="ta-mon"><Sprite id={sp} size={44} /><small>{speciesName(sp)}</small></span>
                <RateCell n={m.picked} d={A.n} hi={0.5} lo={0.25} />
                <RateCell n={m.win} d={dec(m.win, m.lose)} />
                <RateCell n={m.lead} d={m.picked} plain />
                <RateCell n={m.leadWin} d={dec(m.leadWin, m.leadLose)} />
              </div>
            );
          })}
          <p class="hint">選出率 = 対戦のうち選出した割合 / 勝率 = 選出した対戦の勝率 / 初手率 = 選出したうち初手だった割合 / 初手勝率 = 初手だった対戦の勝率 (勝率は勝ち負けをつけた対戦だけで計算)</p>
        </div>
      )}
      {sub === 'pattern' && <>
        <div class="ta-sort"><Seg small value={psort} options={[['n', '多い順'], ['win', '勝率順']]} onChange={setPsort} /></div>
        <div class="ta-list">
          {pats.map(p => (
            <div class="ta-pat">
              <span class="ta-pmons">{p.species.map(sp => <span class="ta-mon"><Sprite id={sp} size={44} /><small>{speciesName(sp)}</small></span>)}</span>
              <span class="ta-pstat"><span class="muted">選出率</span><RateCell n={p.n} d={A.n} plain /></span>
              <span class="ta-pstat"><span class="muted">勝率</span><RateCell n={p.win} d={dec(p.win, p.lose)} /></span>
            </div>
          ))}
          {!pats.length && <Empty>選出を記録した対戦がまだありません。</Empty>}
          <p class="hint">選出した3体の組み合わせごと (順番は区別しません)。</p>
        </div>
      </>}
      {sub === 'opp' && <>
        <div class="ta-sort"><Seg small value={psort} options={[['n', '選出された数順'], ['win', '勝率順']]} onChange={setPsort} /></div>
        <div class="ta-list">
          {groups.map(g => (
            <div class="ta-og">
              <span class={cx('ta-ogwr', g.key !== '-' && (Number(g.key) >= 60 ? 'hi' : Number(g.key) <= 40 ? 'lo' : ''))}>{g.key === '-' ? '-' : <>{g.key}<small>%</small></>}</span>
              <span class="ta-ogmons">
                {g.list.map(o => (
                  <button class="ta-opp" onClick={() => onOpp(o.sp)} title={`${speciesName(o.sp)}: 選出された ${o.picked}回 (${o.win}勝${o.lose}敗) / 見せ合い ${o.seen}回`}>
                    <Sprite id={o.sp} size={52} />
                    <small class="ta-onm">{speciesName(o.sp)}</small>
                    <span class="ta-ow num">{o.win}/{dec(o.win, o.lose)}</span>
                    <span class="ta-opr num">選出{Math.round((o.picked / o.seen) * 100)}%</span>
                  </button>
                ))}
              </span>
            </div>
          ))}
          {!groups.length && <Empty>相手の選出を記録した対戦がまだありません。</Empty>}
          <p class="hint">相手がそのポケモンを選出してきた対戦での自分の勝率 (左の大きな数字)。各ポケモンの「勝ち/勝敗のついた対戦」と、見せ合いにいたときに選出してきた率。タップで詳しい傾向。</p>
        </div>
      </>}
    </div>
  );
}
