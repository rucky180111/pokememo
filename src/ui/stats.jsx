// 統計: 自分の戦績と、相手ポケモンごとの傾向
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, itemName, moveName, abilityName} from '../engine/dex.js';
import {realBattles, teamRecord, oppRanking, oppSpeciesStats, matchupActions, sortCounts, pct} from '../engine/predict.js';
import {usageEntries, parseSpread, spreadLabel, leadRate} from '../engine/assume.js';
import {useApp, Sheet, Seg, Empty, MonName, cx, rate} from './common.jsx';

export function StatsScreen() {
  const {store} = useApp();
  const [fmt, setFmt] = useState(store.state.settings.format);
  const [teamId, setTeamId] = useState('');
  const [sort, setSort] = useState('seen');
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('mine');
  const battles = store.battles();
  const teams = store.teams();
  const filter = {format: fmt, teamId: teamId || undefined};
  const real = realBattles(battles, filter);
  const decided = real.filter(b => b.result);
  const win = decided.filter(b => b.result === 'win').length, lose = decided.filter(b => b.result === 'lose').length;
  const ranking = useMemo(() => {
    const r = oppRanking(battles, filter);
    const wr = e => (e.win + e.lose ? e.win / (e.win + e.lose) : 2);
    if (sort === 'picked') r.sort((a, b) => b.picked - a.picked);
    if (sort === 'weak') r.sort((a, b) => wr(a) - wr(b) || b.picked - a.picked);
    return r;
  }, [battles, fmt, teamId, sort]);
  const usage = store.state.usage[fmt];
  const usageList = useMemo(() => (usage?.pokemon ? Object.entries(usage.pokemon).sort((a, b) => b[1].u - a[1].u).slice(0, 100) : []), [usage]);
  return (
    <div class="page">
      <div class="page-head"><h1>統計</h1><Seg small value={fmt} options={[['single', 'シングル'], ['double', 'ダブル']]} onChange={setFmt} /></div>
      <Seg value={tab} options={[['mine', '自分の対戦記録'], ['usage', '使用率データ']]} onChange={setTab} />
      {tab === 'mine' && <>
        <label class="field pad-s"><span>構築で絞り込む</span>
          <select class="input" value={teamId} onChange={e => setTeamId(e.currentTarget.value)}>
            <option value="">すべての構築</option>
            {teams.map(t => <option value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <div class="kpis">
          <div class="kpi"><span class="kpi-v num">{real.length}</span><span class="kpi-l">記録した対戦</span></div>
          <div class="kpi"><span class="kpi-v num">{win}-{lose}</span><span class="kpi-l">勝ち-負け</span></div>
          <div class="kpi"><span class="kpi-v num">{win + lose ? `${Math.round((win / (win + lose)) * 100)}%` : '—'}</span><span class="kpi-l">勝率</span></div>
        </div>
        {!real.length && <Empty>このルールの対戦記録がまだありません。対戦を記録すると、相手の選出率・初手率・対面ごとの行動がここに貯まっていきます。</Empty>}
        {teams.filter(t => !teamId || t.id === teamId).map(t => {
          const rec = teamRecord(battles, t.id, fmt);
          if (!rec.n) return null;
          return (
            <div class="box" key={t.id}>
              <h4>{t.name} <span class="muted">{rec.win}勝 {rec.lose}敗 (勝率 {pct(rec.win, rec.win + rec.lose)}%)</span></h4>
              <table class="mini">
                <thead><tr><th>自分のポケモン</th><th>選出</th><th>初手</th><th>選出時の勝率</th></tr></thead>
                <tbody>
                  {sortCounts(rec.picks).map(([sp, n]) => (
                    <tr><th>{speciesName(sp)}</th><td class="num">{n} ({pct(n, rec.n)}%)</td><td class="num">{rec.leads[sp] || 0}</td><td class="num">{pct(rec.pickWins[sp] || 0, n)}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {ranking.length > 0 && (
          <div class="box">
            <h4>相手のポケモン</h4>
            <Seg small value={sort} options={[['seen', '遭遇順'], ['picked', '選出順'], ['weak', '勝率の低い順']]} onChange={setSort} />
            <div class="scroll-x">
              <table class="mini wide">
                <thead><tr><th>ポケモン</th><th>遭遇</th><th>選出率</th><th>初手</th><th>選出時の勝敗</th></tr></thead>
                <tbody>
                  {ranking.slice(0, 80).map(e => (
                    <tr class="clickable" onClick={() => setDetail(e.species)}>
                      <th>{speciesName(e.species)}</th>
                      <td class="num">{e.seen}</td>
                      <td class="num">{pct(e.picked, e.seen)}%</td>
                      <td class="num">{e.lead}</td>
                      <td class="num">{e.win}-{e.lose}{e.win + e.lose ? ` (${pct(e.win, e.win + e.lose)}%)` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
                  <td class="num">{i + 1}</td><th>{speciesName(id)}</th><td class="num">{rate(d.u, 1)}</td><td class="num">{rate(leadRate(d, fmt))}</td>
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
        <p><MonName id={species} /> <span class="num dim">種族値 {dex.species[species].bs.join('-')}</span></p>
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
            <h5>{speciesName(e.id)} <span class="muted">採用率 {rate(e.d.u, 1)} / 初手率 {rate(leadRate(e.d, fmt))}</span></h5>
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
