// team-sim.mjs の結果を集計する。node tests/team-sim-report.mjs 結果1.json 結果2.json ...
import fs from 'node:fs';
import {dex} from '../src/engine/dex.js';
const R = process.argv.slice(2).flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const nm = id => dex.species[id]?.j || id;
const dec = R.filter(r => r.winner !== 'draw');
const wr = list => { const d = list.filter(r => r.winner !== 'draw'); return d.length ? d.filter(r => r.winner === 'win').length / d.length : null; };
const pc = x => (x == null ? '-' : `${Math.round(x * 100)}%`);
console.log(`対戦 ${R.length} / 勝ち ${R.filter(r => r.winner === 'win').length} 負け ${R.filter(r => r.winner === 'lose').length} 引分 ${R.filter(r => r.winner === 'draw').length} / 勝率 ${pc(wr(R))} / エラー ${R.filter(r => r.err).length}`);
console.log(`平均ターン ${(R.reduce((a, r) => a + r.turns, 0) / R.length).toFixed(1)}`);

const group = (keyFn, minN = 15) => {
  const m = new Map();
  for (const r of R) for (const k of new Set([].concat(keyFn(r)))) { if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m].map(([k, l]) => ({k, n: l.length, w: wr(l)})).filter(x => x.n >= minN);
};
console.log('\n## 相手が選出してきたときの勝率 (低い順)');
for (const x of group(r => r.oppBrought).sort((a, b) => a.w - b.w).slice(0, 25)) console.log(`${nm(x.k)}\t${pc(x.w)}\t(${x.n}戦)`);
console.log('\n## 相手が選出してきたときの勝率 (高い順)');
for (const x of group(r => r.oppBrought).sort((a, b) => b.w - a.w).slice(0, 12)) console.log(`${nm(x.k)}\t${pc(x.w)}\t(${x.n}戦)`);
console.log('\n## 相手の初手ごとの勝率 (低い順)');
for (const x of group(r => r.oppPick[0], 10).sort((a, b) => a.w - b.w).slice(0, 12)) console.log(`${nm(x.k)}\t${pc(x.w)}\t(${x.n}戦)`);
console.log('\n## 自分の選出 (順不同) ごとの勝率');
for (const x of group(r => [...r.myPick].sort().join('+'), 5).sort((a, b) => b.n - a.n)) console.log(`${x.k.split('+').map(nm).join('・')}\t${pc(x.w)}\t(${x.n}戦)`);
console.log('\n## 自分の初手ごとの勝率');
for (const x of group(r => r.myPick[0], 5).sort((a, b) => b.n - a.n)) console.log(`${nm(x.k)}\t${pc(x.w)}\t(${x.n}戦)`);

// 倒した・倒された
const kills = new Map(), deaths = new Map(), killers = new Map();
for (const r of R) for (const k of r.kos) {
  if (k.victimSide === 'p2' && k.by !== '?') kills.set(k.by, (kills.get(k.by) || 0) + 1);
  if (k.victimSide === 'p1') { deaths.set(k.victim, (deaths.get(k.victim) || 0) + 1); const key = `${k.victim}<${k.by}`; killers.set(key, (killers.get(key) || 0) + 1); }
}
const broughtN = new Map();
for (const r of R) for (const s of r.myBrought) broughtN.set(s, (broughtN.get(s) || 0) + 1);
console.log('\n## 自分のポケモン: 場に出た回数 / 倒した数 / 倒された数');
for (const [s, n] of [...broughtN].sort((a, b) => b[1] - a[1])) {
  const k = [...kills].filter(([id]) => id === s || id.startsWith(s)).reduce((a, [, v]) => a + v, 0);
  const d = [...deaths].filter(([id]) => id === s || id.startsWith(s)).reduce((a, [, v]) => a + v, 0);
  console.log(`${nm(s)}\t出た ${n}\t倒した ${k} (1回あたり ${(k / n).toFixed(2)})\t倒された ${d} (${pc(d / n)})`);
}
console.log('\n## 自分のポケモンを倒した相手 (多い順)');
const byKiller = new Map();
for (const [key, v] of killers) { const by = key.split('<')[1]; byKiller.set(by, (byKiller.get(by) || 0) + v); }
for (const [k, v] of [...byKiller].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  const det = [...killers].filter(([key]) => key.endsWith('<' + k)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, c]) => `${nm(key.split('<')[0])}${c}`).join('・');
  const seen = R.filter(r => r.oppBrought.includes(k)).length;
  console.log(`${nm(k)}\t${v}体 (選出1回あたり ${(v / Math.max(1, seen)).toFixed(2)})\t${det}`);
}
console.log('\n## 自分のポケモンを倒した技 (多い順)');
const mv = new Map();
for (const r of R) for (const k of r.kos) if (k.victimSide === 'p1' && k.move) mv.set(k.move, (mv.get(k.move) || 0) + 1);
console.log([...mv].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([m, c]) => `${m} ${c}`).join(' / '));
