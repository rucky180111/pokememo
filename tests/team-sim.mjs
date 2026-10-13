// 構築の勝率を、公式シミュレーター (Pokémon Showdown, チャンピオンズ) で大量に回して調べる。
// 使い方: node tests/team-sim.mjs [対戦数] [乱数の種] > 結果.json
// 自分: tests/fixtures/team-expected.json (チーム10)。相手: 使用率データから、組まれやすい並びでランダムに組む。
// 行動は両者とも、ダメージ計算にもとづく自動操作 (相手の型は分かっている前提)。自分側は参考記事の選出・立ち回りの方針を入れる。
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {dex, toID, STAT_KEYS, typeEffect} from '../src/engine/dex.js';
import {calcDamage, finalSpeed, movePriority} from '../src/engine/calc.js';
import {parseSpread} from '../src/engine/assume.js';

const require = createRequire(import.meta.url);
const PS = process.env.PS || '/home/claude/ps';
const {Battle} = require(`${PS}/dist/sim`);
const FORMAT = 'gen9championsbssregmc';
const N = Number(process.argv[2]) || 200;
let seed = Number(process.argv[3]) || 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let tseed = seed * 7919 + 13;
const trnd = () => { tseed = (tseed * 1103515245 + 12345) & 0x7fffffff; return tseed / 0x7fffffff; };
const weightedR = (pairs, R) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = R() * tot; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[pairs.length - 1]?.[0]; };
const weighted = pairs => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = rnd() * tot; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[pairs.length - 1]?.[0]; };
const usage = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));

// ---- 自分の構築 ----
const MY = JSON.parse(fs.readFileSync(new URL('./fixtures/team-expected.json', import.meta.url), 'utf8')).map(m => ({
  ...m, megaForme: m.item === 'salamencite' ? 'salamencemega' : m.item === 'garchompitez' ? 'garchompmegaz' : null,
}));
// 入れ替えの検証: SWAP='{"species":...}' で ボーマンダ の枠を差し替える
if (process.env.SWAP) { const i = MY.findIndex(m => m.species === 'salamence'); MY[i] = {megaForme: null, note: '', ...JSON.parse(process.env.SWAP)}; }
if (process.env.SWAPC) { const i = MY.findIndex(m => m.species === 'corviknight'); MY[i] = {...MY[i], ...JSON.parse(process.env.SWAPC)}; }
if (process.env.SWAP3) { const i = MY.findIndex(m => m.species === 'gholdengo'); MY[i] = {megaForme: null, note: '', ...JSON.parse(process.env.SWAP3)}; }

// ---- 相手の構築: 使用率と「一緒に使われやすさ」から組む ----
const EXCLUDE = /^(ditto)$/;
const entries = Object.entries(usage.pokemon).filter(([id, d]) => dex.species[id] && !EXCLUDE.test(id) && d.mv.length >= 4 && d.sp.length && d.u > 0.004);
function setFor(id) {
  const s = dex.species[id], d = usage.pokemon[id];
  const base = s.mega || id;
  let item = s.mega ? s.stone : weightedR(d.it.filter(([x]) => x && dex.items[x] && !dex.items[x].ms), trnd);
  const baseD = usage.pokemon[base] || d;
  const abC = ((s.mega ? baseD.ab : d.ab) || []).filter(([a]) => dex.species[base].ab.includes(a));
  const ability = abC.length ? weightedR(abC, trnd) : dex.species[base].ab[0];
  const spr = parseSpread(weightedR(d.sp, trnd));
  const moves = [];
  for (let g = 0; moves.length < 4 && g < 60; g++) { const m = weightedR(d.mv, trnd); if (dex.moves[m] && !moves.includes(m)) moves.push(m); }
  return {species: base, item: item || '', ability, nature: spr.nature, sp: spr.sp, moves, megaForme: s.mega ? id : null};
}
function makeOppTeam() {
  const ids = [weightedR(entries.map(([id, d]) => [id, d.u]), trnd)];
  const baseOf = id => dex.species[dex.species[id].mega || id].n.split('-')[0];
  for (let guard = 0; ids.length < 6 && guard < 200; guard++) {
    // いまの並びのだれかの「よく一緒にいる」から選ぶ (使用率で少し重みづけ)
    const anchor = usage.pokemon[ids[Math.floor(trnd() * ids.length)]];
    const cand = (anchor.tm || []).filter(([t]) => usage.pokemon[t] && entries.some(([e]) => e === t)).map(([t, w]) => [t, w * (0.3 + usage.pokemon[t].u)]);
    const id = cand.length && trnd() < 0.85 ? weightedR(cand, trnd) : weightedR(entries.map(([e, d]) => [e, d.u]), trnd);
    if (ids.some(x => baseOf(x) === baseOf(id))) continue;
    if (dex.species[id].mega && ids.filter(x => dex.species[x].mega).length >= 2) continue;
    ids.push(id);
  }
  const sets = ids.map(setFor);
  // 持ち物の重複はゲームで禁止なので、重複したら「なし」以外の別のものに
  const used = new Set();
  for (const s of sets) { if (s.item && used.has(s.item)) s.item = ['sitrusberry', 'leftovers', 'focussash', 'lumberry', 'choicescarf', 'expertbelt'].find(x => !used.has(x)) || ''; if (s.item) used.add(s.item); }
  return sets;
}
const psName = id => (id.startsWith('aegislash') ? 'Aegislash' : dex.species[id].n);
const toPS = sets => sets.map((s, i) => ({name: `M${i}`, species: psName(s.species), item: s.item ? dex.items[s.item].n : '', ability: dex.abilities[s.ability].n,
  moves: s.moves.map(m => dex.moves[m].n), nature: s.nature, evs: Object.fromEntries(STAT_KEYS.map((k, i) => [k, s.sp[i]])), ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31}, level: 50, gender: ''}));

// ---- 盤面の読み取り (シミュレーターの状態 → ダメージ計算の形) ----
const WEATHER = {raindance: 'Rain', primordialsea: 'Rain', sunnyday: 'Sun', desolateland: 'Sun', sandstorm: 'Sand', snowscape: 'Snow', snow: 'Snow'};
const TERRAIN = {grassyterrain: 'Grassy', electricterrain: 'Electric', psychicterrain: 'Psychic', mistyterrain: 'Misty'};
const fieldOf = b => ({weather: WEATHER[b.field.weather] || '', terrain: TERRAIN[b.field.terrain] || '', trickRoom: !!b.field.pseudoWeather.trickroom, gravity: !!b.field.pseudoWeather.gravity});
const sideOf = side => ({reflect: !!side.sideConditions.reflect, lightScreen: !!side.sideConditions.lightscreen, auroraVeil: !!side.sideConditions.auroraveil, tailwind: !!side.sideConditions.tailwind, sr: !!side.sideConditions.stealthrock, spikes: side.sideConditions.spikes?.layers || 0});
function monOf(p, sets) {
  const set = sets[Number(p.set.name.slice(1))];
  const sid = toID(p.species.name);
  const forme = dex.species[sid]?.mega ? sid : (sid.startsWith('aegislash') ? (p.species.name.includes('Blade') ? 'aegislashblade' : null) : null);
  return {set, build: {species: set.species, item: set.item, ability: set.ability, nature: set.nature, sp: set.sp, moves: set.moves},
    cond: {hp: (p.hp / p.maxhp) * 100, status: p.status || '', boosts: {...p.boosts}, forme, itemGone: !p.item && !!set.item, abilityOn: false, fainted: p.fainted}, p};
}
const memo = new Map();
function dmg(A, D, moveId, b, aSide, dSide, {hazards = false} = {}) {
  const key = [A.p.fullname, A.cond.hp.toFixed(0), JSON.stringify(A.cond.boosts), A.cond.forme, A.cond.status, D.p.fullname, D.cond.hp.toFixed(0), JSON.stringify(D.cond.boosts), D.cond.forme, moveId, JSON.stringify(fieldOf(b)), hazards].join('|');
  if (memo.has(key)) return memo.get(key);
  // ギルガルドは攻撃するときブレードフォルムになる
  if (A.build.species.startsWith('aegislash') && dex.moves[moveId]?.c !== 'Z') A = {...A, cond: {...A.cond, forme: 'aegislashblade'}};
  const r = calcDamage({build: A.build, cond: A.cond}, {build: D.build, cond: D.cond}, moveId, {field: fieldOf(b), atkSide: sideOf(aSide), defSide: sideOf(dSide), hazards});
  memo.set(key, r);
  if (memo.size > 200000) memo.clear();
  return r;
}
const speedOf = (M, b, side) => finalSpeed({build: M.build, cond: M.cond}, {field: fieldOf(b), side: sideOf(side)});
const accOf = m => { const a = dex.moves[m]?.acc; return a === true || a == null ? 1 : a / 100; };
const koProb = (r, hpPct) => (!r?.ok || r.status ? 0 : r.minPct >= hpPct ? 1 : r.maxPct < hpPct ? 0 : (r.maxPct - hpPct) / Math.max(0.01, r.maxPct - r.minPct));

const SETUP = {dragondance: 1, swordsdance: 1, nastyplot: 1, calmmind: 1, irondefense: 0.6, bulkup: 1, quiverdance: 1, shellsmash: 1.2, coil: 0.8, agility: 0.6, curse: 0.6, tidyup: 1, victorydance: 1, shiftgear: 1};
const HEAL = new Set(['roost', 'recover', 'softboiled', 'slackoff', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'milkdrink', 'strengthsap']);
const PIVOT = new Set(['uturn', 'flipturn', 'voltswitch', 'partingshot', 'teleport', 'chillyreception', 'shedtail']);
const DRAWBACK = {dracometeor: 12, overheat: 12, leafstorm: 10, closecombat: 6, makeitrain: 6, superpower: 8, vcreate: 8, headlongrush: 6};

// 相手がこちらに出せる最大ダメージ (割合)
function bestThreat(O, A, b, oSide, aSide) {
  let best = {pct: 0, move: null, pri: 0};
  for (const m of O.set.moves) {
    const r = dmg(O, A, m, b, oSide, aSide);
    if (!r.ok || r.status) continue;
    const pct = ((r.minPct + r.maxPct) / 2) * accOf(m);
    if (pct > best.pct) best = {pct, max: r.maxPct, move: m, pri: movePriority(m, O.build.ability, {grassyTerrain: fieldOf(b).terrain === 'Grassy'})};
  }
  return best;
}
// どちらが先に動くか (同じ優先度の技どうし)
function faster(A, O, b, aSide, oSide) {
  const sa = speedOf(A, b, aSide), so = speedOf(O, b, oSide);
  return fieldOf(b).trickRoom ? sa < so : sa > so;
}
// 交代で出したときの見込み (受けるダメージ・与えるダメージ)
function matchup(B, O, b, bSide, oSide, entering) {
  const t = bestThreat(O, B, b, oSide, bSide);
  const sr = entering && bSide.sideConditions.stealthrock && B.build.item !== 'heavydutyboots' ? 12.5 * typeEffect('Rock', dex.species[B.cond.forme || B.build.species].t) : 0;
  let off = 0;
  for (const m of B.set.moves) { const r = dmg(B, O, m, b, bSide, oSide); if (r.ok && !r.status) off = Math.max(off, ((r.minPct + r.maxPct) / 2) * accOf(m)); }
  const taken = t.pct + sr;
  return {taken, off, score: Math.min(off, O.cond.hp) * (faster(B, O, b, bSide, oSide) ? 1.3 : 1) - Math.min(taken, B.cond.hp) * 1.1 - (taken >= B.cond.hp ? 40 : 0)};
}

// ---- 1手の選び方 ----
function decide(b, sid, req, policy) {
  const me = b[sid], foe = b[sid === 'p1' ? 'p2' : 'p1'];
  const mySets = policy.sets, foeSets = policy.foeSets;
  const A = monOf(me.active[0], mySets), O = monOf(foe.active[0], foeSets);
  const bench = req.side.pokemon.map((p, i) => ({p, i})).filter(x => !x.p.active && !x.p.condition.endsWith(' fnt'));
  const benchMons = bench.map(x => ({...x, M: monOf(me.pokemon.find(pp => pp.set.name === x.p.ident.split(': ')[1] || pp.fullname === x.p.ident) || me.pokemon.find(pp => pp.name === x.p.ident.split(': ')[1]), mySets)}));
  if (req.forceSwitch) {
    if (!benchMons.length) return 'pass';
    const best = benchMons.map(x => ({x, s: matchup(x.M, O, b, me, foe, true).score + (policy.switchBias?.(x.M) || 0)})).sort((a, c) => c.s - a.s)[0];
    return `switch ${best.x.i + 1}`;
  }
  const act = req.active[0];
  const threat = bestThreat(O, A, b, foe, me);
  const iAmFaster = faster(A, O, b, me, foe);
  const oKoMe = threat.max >= A.cond.hp ? Math.min(1, threat.pct >= A.cond.hp ? 1 : 0.5) : 0;
  const oFirst = threat.pri > 0 || !iAmFaster;
  const opts = [];
  const fresh = (me.active[0].activeTurns || 0) === 0;
  act.moves.forEach((mv, i) => {
    if (mv.disabled || mv.pp === 0) return;
    const id = toID(mv.move === 'Recharge' ? '' : mv.id || mv.move);
    const m = dex.moves[id];
    if (!m) return;
    let v = 0;
    const pri = movePriority(id, A.build.ability, {hpFull: A.cond.hp >= 100, grassyTerrain: fieldOf(b).terrain === 'Grassy'});
    const goesFirst = pri > threat.pri || (pri === threat.pri && iAmFaster);
    if (m.c !== 'Z') {
      const r = dmg(A, O, id, b, me, foe);
      if (!r.ok) return;
      const avg = ((r.minPct + r.maxPct) / 2) * accOf(id);
      const ko = koProb(r, O.cond.hp) * accOf(id);
      v = Math.min(avg, O.cond.hp) + ko * 45;
      // 先に倒されるなら、その技は撃てない
      if (!goesFirst && oKoMe) v *= 0.15;
      if (ko > 0.9 && goesFirst) v += 25;
      v -= (DRAWBACK[id] || 0) * (ko > 0.9 ? 1 : 0.4);
      if (id === 'fakeout') v = fresh ? v + 30 : -100;
      if (PIVOT.has(id) && benchMons.length) {
        const alt = Math.max(...benchMons.map(x => matchup(x.M, O, b, me, foe, false).score));
        const stay = matchup(A, O, b, me, foe, false).score;
        if (alt > stay + 15) v += 18 + (policy.pivotBonus || 0);
      }
    } else {
      const oStat = O.cond.status, safe = threat.pct < 38 && !(oKoMe && oFirst);
      if (id === 'stealthrock') v = !foe.sideConditions.stealthrock && foe.pokemon.filter(p => !p.fainted).length >= 2 ? 48 : -50;
      else if (id === 'spikes' || id === 'toxicspikes') v = (foe.sideConditions[id]?.layers || 0) < 1 ? 30 : -50;
      else if (id === 'yawn') v = !oStat && !O.p.volatiles.yawn && O.cond.hp > 35 ? 40 : -50;
      else if (SETUP[id] != null) {
        const lvl = id === 'irondefense' ? A.cond.boosts.def : id === 'calmmind' || id === 'nastyplot' ? A.cond.boosts.spa : A.cond.boosts.atk;
        v = safe && lvl < 2 ? 55 * SETUP[id] : lvl < 1 && threat.pct < 55 ? 15 : -30;
      } else if (HEAL.has(id)) v = A.cond.hp < 55 && threat.pct < 45 ? 58 : A.cond.hp < 70 ? 10 : -50;
      else if (id === 'kingsshield' && A.cond.forme === 'aegislashblade') v = me.active[0].volatiles.stall ? -50 : threat.pct > 30 ? 46 : 12; // ブレードからシールドに戻る
      else if (id === 'protect' || id === 'detect' || id === 'spikyshield' || id === 'kingsshield' || id === 'banefulbunker') v = me.active[0].volatiles.stall ? -50 : 4;
      else if (id === 'willowisp') v = !oStat && dex.species[O.cond.forme || O.build.species].bs[1] > dex.species[O.cond.forme || O.build.species].bs[3] && !dex.species[O.cond.forme || O.build.species].t.includes('Fire') ? 50 : -30;
      else if (id === 'toxic') v = !oStat && !dex.species[O.cond.forme || O.build.species].t.some(t => t === 'Poison' || t === 'Steel') ? 36 : -30;
      else if (id === 'thunderwave' || id === 'glare' || id === 'nuzzle') v = !oStat && !iAmFaster ? 38 : -30;
      else if (id === 'spore' || id === 'sleeppowder' || id === 'hypnosis') v = !oStat ? 50 : -30;
      else if (id === 'tailwind') v = !me.sideConditions.tailwind && !iAmFaster ? 40 : -30;
      else if (id === 'trickroom') v = !fieldOf(b).trickRoom && !iAmFaster ? 40 : -50;
      else if (id === 'reflect' || id === 'lightscreen' || id === 'auroraveil') v = me.sideConditions[id] ? -50 : 22;
      else if (PIVOT.has(id)) v = benchMons.length ? 25 : -50;
      else v = 8;
      v = policy.statusHook?.(id, v, {A, O, threat, b, me, foe}) ?? v;
    }
    v += (rnd() - 0.5) * 6;
    opts.push({cmd: `move ${i + 1}${act.canMegaEvo ? ' mega' : ''}`, v, id});
  });
  // 交代: いまの対面が悪く、もっと良い控えがいるとき
  if (benchMons.length && !act.trapped && !act.maybeTrapped) {
    const stay = matchup(A, O, b, me, foe, false).score;
    for (const x of benchMons) {
      const mu = matchup(x.M, O, b, me, foe, true);
      const gain = mu.score - stay;
      let v = gain > 25 && (oKoMe && oFirst || threat.pct > 60) && mu.taken < x.M.cond.hp * 0.6 ? 30 + gain * 0.3 : -100;
      v += policy.switchBias?.(x.M) || 0;
      opts.push({cmd: `switch ${x.i + 1}`, v});
    }
  }
  if (!opts.length) return 'default';
  opts.sort((a, c) => c.v - a.v);
  return opts[0].cmd;
}

// ---- 選出 ----
function matrix(mine, theirs) {
  // 自分 i が相手 j にどれだけ強いか (仮の盤面で計算)
  const mk = s => ({set: s, build: {species: s.species, item: s.item, ability: s.ability, nature: s.nature, sp: s.sp, moves: s.moves}, cond: {hp: 100, status: '', boosts: {}, forme: s.megaForme, itemGone: false}, p: {fullname: s.species + s.item, volatiles: {}}});
  const fake = {field: {weather: '', terrain: '', pseudoWeather: {}}};
  const side = {sideConditions: {}};
  return mine.map(a => theirs.map(o => matchup(mk(a), mk(o), fake, side, side, false).score));
}
function choosePreview(mine, theirs, override) {
  const M = matrix(mine, theirs);
  const idx = [0, 1, 2, 3, 4, 5];
  let best = null;
  for (let a = 0; a < 6; a++) for (let c = a + 1; c < 6; c++) for (let d = c + 1; d < 6; d++) {
    const pick = [a, c, d];
    const s = theirs.reduce((acc, _, j) => acc + Math.max(...pick.map(i => M[i][j])), 0) + (rnd() - 0.5) * 20;
    if (!best || s > best.s) best = {pick, s};
  }
  let pick = best.pick;
  if (override) return override(pick, M) || pick; // 方針で決めた順番 (先頭が初手) をそのまま使う
  // 初手: 相手6体に平均して強いもの
  pick.sort((x, y) => idx.reduce((a, j) => a + M[y][j], 0) - idx.reduce((a, j) => a + M[x][j], 0));
  return pick;
}

// 自分側の方針 (参考記事より): ガブZはほぼ毎回選出、エンペルトで起点作り
const has = (team, re) => team.some(s => re.test(s.megaForme || s.species));
function myPreview(mine, theirs) {
  const I = Object.fromEntries(mine.map((s, i) => [s.species, i]));
  return choosePreview(mine, theirs, (pick, M) => {
    const smart = () => {
      if (has(theirs, /^(mimikyu|kingambit|baxcalibur|golisopod)/) && I.corviknight != null) return I.corviknight;
      if (has(theirs, /^(rillaboom|lucario|glimmora|basculegion)/) && I.rillaboom != null) return I.rillaboom;
      if (process.env.RILLA_PRIM && has(theirs, /^primarina/) && I.rillaboom != null) return I.rillaboom;
      if (process.env.CORV_SPECIAL && has(theirs, /^(primarina|gholdengo)/) && I.corviknight != null) return I.corviknight;
      return I[process.env.SLOT3 || 'gholdengo'];
    };
    const third = process.env.RULE === 'smart' ? smart() : process.env.THIRD ? I[process.env.THIRD] : [0, 1, 2, 3, 4, 5].filter(i => i !== I.garchomp && i !== I.empoleon).sort((x, y) => theirs.reduce((a, _, j) => a + M[y][j], 0) - theirs.reduce((a, _, j) => a + M[x][j], 0))[0];
    const p = [I.empoleon, I.garchomp, third];
    // 初手の方針
    let lead = I.empoleon;
    if (has(theirs, /^(charizard|glimmora)/)) lead = I.garchomp;
    else if (has(theirs, /^(gengar|hippowdon|skarmory|ferrothorn|ting|forretress|garganacl)/) && p.includes(I.rillaboom)) lead = I.rillaboom;
    return [lead, ...p.filter(x => x !== lead)];
  });
}
const myPolicy = {
  // エンペルト: 3発以内で倒されそうなら あくび、そうでなければ ステロ
  statusHook(id, v, {A, threat}) {
    if (A.build.species !== 'empoleon') return v;
    if (id === 'stealthrock' && v > 0) return threat.pct >= 34 ? v - 15 : v + 5;
    if (id === 'yawn' && v > 0) return threat.pct >= 34 ? v + 15 : v - 10;
    return v;
  },
  pivotBonus: 6,
};

// ---- 対戦 ----
const results = [];
for (let n = 0; n < N; n++) {
  const opp = makeOppTeam();
  const battle = new Battle({formatid: FORMAT, seed: [n + 1, seed & 0xffff, 3, 9]});
  battle.setPlayer('p1', {name: 'me', team: toPS(MY)});
  battle.setPlayer('p2', {name: 'opp', team: toPS(opp)});
  const pol = {p1: {...myPolicy, sets: MY, foeSets: opp}, p2: {sets: opp, foeSets: MY}};
  const picks = {p1: myPreview(MY, opp), p2: choosePreview(opp, MY)};
  const kos = [];
  let guard = 0, err = '';
  try {
    while (!battle.ended && guard++ < 400) {
      for (const sid of ['p1', 'p2']) {
        const req = battle[sid].activeRequest;
        if (!req || req.wait || battle[sid].choice.done) continue;
        let c;
        if (req.teamPreview) c = `team ${picks[sid].map(i => i + 1).join('')}`;
        else c = decide(battle, sid, req, pol[sid]);
        if (!battle.choose(sid, c)) battle.choose(sid, 'default');
      }
      if (battle.turn > 80) { battle.tie(); break; }
    }
  } catch (e) { err = String(e.stack || e).split('\n').slice(0, 3).join(' | '); }
  // ログから「だれがだれを倒したか」
  let lastHit = {};
  for (const l of battle.log) {
    const p = l.split('|');
    if (p[1] === 'move') lastHit = {by: p[2], move: p[3]};
    if (p[1] === 'faint') kos.push({victim: p[2], by: lastHit.by, move: lastHit.move});
  }
  const name = (sets, ident) => { const i = Number(ident?.split(': ')[1]?.slice(1)); return sets[i] ? (sets[i].megaForme || sets[i].species) : '?'; };
  const sideSets = id => (id?.startsWith('p1') ? MY : opp);
  const brought = sid => battle[sid].pokemon.filter(p => p.previouslySwitchedIn || p.isActive || p.fainted).map(p => { const s = (sid === 'p1' ? MY : opp)[Number(p.set.name.slice(1))]; return s.species; });
  results.push({
    n, winner: battle.winner === 'me' ? 'win' : battle.winner === 'opp' ? 'lose' : 'draw', turns: battle.turn, err,
    opp: opp.map(s => s.megaForme || s.species), oppSets: opp,
    myPick: picks.p1.map(i => MY[i].species), oppPick: picks.p2.map(i => opp[i].megaForme || opp[i].species),
    myBrought: brought('p1'), oppBrought: brought('p2').map(sp => { const s = opp.find(x => x.species === sp); return s.megaForme || s.species; }),
    log: process.env.LOG ? battle.log.filter(l => /^\|(move|switch|drag|faint|-damage|-heal|turn|-boost|-unboost|-status|-weather|-fieldstart|-sidestart|-mega|detailschange|win)\|/.test(l)) : undefined,
    kos: kos.map(k => ({victim: name(sideSets(k.victim), k.victim), victimSide: k.victim?.slice(0, 2), by: name(sideSets(k.by), k.by), move: k.move})),
  });
  if ((n + 1) % 25 === 0) process.stderr.write(`${n + 1}/${N} 勝ち ${results.filter(r => r.winner === 'win').length}\n`);
}
process.stdout.write(JSON.stringify(results));
