// 自分の対戦記録からの集計 (選出率・初手率・対面ごとの行動傾向・戦績)。
import {dex} from './dex.js';
import {activeCount} from './battle.js';

const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
export const realBattles = (battles, {format, teamId} = {}) => battles.filter(b => !b.deleted && b.kind !== 'sim' && (!format || b.format === format) && (!teamId || b.teamId === teamId));
export const sortCounts = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
export const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// 初手に出たポケモン (選出順の先頭)
export const leadsOf = (b, side) => (b.pick?.[side] || []).slice(0, activeCount(b.format));

/**
 * 相手の種族ごとの集計。
 * 戻り値: {seen, picked, lead, win, lose, items, abilities, moves, mega, battles}
 *   seen = 見せ合いにいた回数 / picked = 選出された回数 (確認できた分) / lead = 初手で出てきた回数
 */
export function oppSpeciesStats(battles, speciesId, filter = {}) {
  const out = {seen: 0, picked: 0, lead: 0, win: 0, lose: 0, pickedWin: 0, pickedLose: 0, items: {}, abilities: {}, moves: {}, mega: 0, moveBattles: 0};
  for (const b of realBattles(battles, filter)) {
    const idx = b.opp.findIndex(o => o.species === speciesId);
    if (idx < 0) continue;
    const o = b.opp[idx];
    out.seen++;
    if (b.result === 'win') out.win++;
    if (b.result === 'lose') out.lose++;
    const picked = (b.pick?.opp || []).includes(idx);
    if (picked) {
      out.picked++;
      if (b.result === 'win') out.pickedWin++;
      if (b.result === 'lose') out.pickedLose++;
      if (leadsOf(b, 'opp').includes(idx)) out.lead++;
    }
    if (o.item) inc(out.items, o.item);
    if (o.ability) inc(out.abilities, o.ability);
    if (o.megaSeen) out.mega++;
    if (o.moves?.length) { out.moveBattles++; for (const m of o.moves) inc(out.moves, m); }
  }
  return out;
}

/**
 * 対面ごとの相手の行動傾向。
 * oppSpecies が場にいて、自分の mySpecies (省略時は誰でも) と向かい合っているターンに、相手が何をしたか。
 * 戻り値: {n, moves: {id: 回数}, switches: {交代先: 回数}, turn1: {...同形式, 1ターン目のみ}}
 */
export function matchupActions(battles, oppSpecies, mySpecies, filter = {}) {
  const mk = () => ({n: 0, moves: {}, switches: {}, mega: 0});
  const out = {...mk(), turn1: mk()};
  for (const b of realBattles(battles, filter)) {
    for (const t of b.turns || []) {
      for (const a of t.acts || []) {
        if (a.side !== 'opp' || a.sp !== oppSpecies) continue;
        if (mySpecies && !(a.vs || []).includes(mySpecies)) continue;
        for (const o of t.n === 1 ? [out, out.turn1] : [out]) {
          if (a.type === 'switch') { o.n++; inc(o.switches, a.toSp || '?'); }
          else if (a.type === 'move' && a.move) { o.n++; inc(o.moves, a.move); if (a.mega) o.mega++; }
        }
      }
    }
  }
  return out;
}

// 自分側の同じ集計 (自分の癖の確認用)
export function myActions(battles, mySpecies, oppSpecies, filter = {}) {
  const out = {n: 0, moves: {}, switches: {}};
  for (const b of realBattles(battles, filter)) {
    for (const t of b.turns || []) {
      for (const a of t.acts || []) {
        if (a.side !== 'me' || a.sp !== mySpecies) continue;
        if (oppSpecies && !(a.vs || []).includes(oppSpecies)) continue;
        if (a.type === 'switch') { out.n++; inc(out.switches, a.toSp || '?'); }
        else if (a.type === 'move' && a.move) { out.n++; inc(out.moves, a.move); }
      }
    }
  }
  return out;
}

/**
 * 似た並びの相手が、過去に誰を選出・初手にしたか。
 * oppSpeciesList: いまの相手6体。minShared 体以上が一致する過去の対戦を対象にする。
 */
export function similarTeams(battles, oppSpeciesList, {minShared = 4, ...filter} = {}) {
  const cur = new Set(oppSpeciesList.filter(Boolean));
  const out = {n: 0, win: 0, lose: 0, picked: {}, lead: {}, matches: []};
  if (cur.size < 2) return out;
  for (const b of realBattles(battles, filter)) {
    const shared = b.opp.filter(o => cur.has(o.species)).length;
    if (shared < Math.min(minShared, cur.size)) continue;
    out.n++;
    if (b.result === 'win') out.win++;
    if (b.result === 'lose') out.lose++;
    const leads = leadsOf(b, 'opp');
    for (const i of b.pick?.opp || []) {
      const sp = b.opp[i]?.species;
      if (!sp || !cur.has(sp)) continue;
      inc(out.picked, sp);
      if (leads.includes(i)) inc(out.lead, sp);
    }
    out.matches.push({id: b.id, shared, date: b.date, result: b.result});
  }
  out.matches.sort((a, b) => b.shared - a.shared || String(b.date).localeCompare(String(a.date)));
  return out;
}

// 構築ごとの戦績
export function teamRecord(battles, teamId, format) {
  const out = {n: 0, win: 0, lose: 0, draw: 0, picks: {}, pickWins: {}, leads: {}};
  for (const b of realBattles(battles, {teamId, format})) {
    if (!b.result) continue;
    out.n++;
    inc(out, b.result);
    const leads = leadsOf(b, 'me');
    for (const i of b.pick?.me || []) {
      const sp = b.my[i]?.species;
      if (!sp) continue;
      inc(out.picks, sp);
      if (b.result === 'win') inc(out.pickWins, sp);
      if (leads.includes(i)) inc(out.leads, sp);
    }
  }
  return out;
}

// よく当たる相手・苦手な相手
export function oppRanking(battles, filter = {}) {
  const map = {};
  for (const b of realBattles(battles, filter)) {
    for (let i = 0; i < b.opp.length; i++) {
      const sp = b.opp[i].species;
      if (!dex.species[sp]) continue;
      const e = (map[sp] ||= {species: sp, seen: 0, picked: 0, lead: 0, win: 0, lose: 0});
      e.seen++;
      const picked = (b.pick?.opp || []).includes(i);
      if (picked) { e.picked++; if (leadsOf(b, 'opp').includes(i)) e.lead++; if (b.result === 'win') e.win++; if (b.result === 'lose') e.lose++; }
    }
  }
  return Object.values(map).sort((a, b) => b.seen - a.seen);
}
