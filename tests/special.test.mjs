import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dex} from '../src/engine/dex.js';
import {newBattle, newTeam, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {boardContext, attackTable} from '../src/engine/board.js';
import {addAct, addEvent, endTurn, revealIllusion} from '../src/engine/flow.js';
import {calcDamage} from '../src/engine/calc.js';

const usage = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));
const B = (species, o = {}) => ({species, item: '', ability: dex.species[species].ab[0], nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: '', ...o});
function battle(opp) {
  const team = newTeam();
  team.mons = [
    B('garchomp', {nature: 'Jolly', sp: [2, 32, 0, 0, 0, 32], moves: ['earthquake', 'dragonclaw', 'rockslide', 'swordsdance'], ability: 'roughskin'}),
    B('primarina', {nature: 'Modest', sp: [32, 0, 0, 32, 2, 0], moves: ['moonblast', 'sparklingaria'], item: 'sitrusberry'}),
    B('rotomwash', {moves: ['hydropump', 'voltswitch'], nature: 'Bold', sp: [32, 0, 32, 0, 2, 0]}),
  ];
  const b = newBattle({team});
  for (const s of opp) b.opp.push(newOpp(s));
  b.start = null;
  return normalizeBattle(b);
}

test('ほかの相手で判明した持ち物は、候補に出さない', () => {
  const b = battle(['gholdengo', 'hippowdon', 'garchomp']);
  const before = boardContext(b, usage).views[0].items.map(x => x[0]);
  assert.ok(before.includes('airballoon'));
  b.opp[1].item = 'airballoon';
  const after = boardContext(b, usage).views[0];
  assert.ok(!after.items.some(x => x[0] === 'airballoon'), 'ふうせん は候補から消える');
  assert.notEqual(after.build.item, 'airballoon', '推定の持ち物も別のものになる');
  const sum = after.items.reduce((a, [, r]) => a + r, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `残りで割合を付け直す (${sum})`);
});

test('メタモン (かわりもの): 場に出たら向かい合う相手にへんしんし、HP以外は相手と同じで計算する', () => {
  const b = battle(['ditto', 'hippowdon']);
  b.opp[0].ability = 'imposter'; b.opp[0].item = 'choicescarf';
  sendOut(b, 'me', 0, 0);
  sendOut(b, 'opp', 0, 0);
  const c = condOf(b, 'opp', 0);
  assert.deepEqual(c.transformed, {side: 'me', mon: 0});
  const ctx = boardContext(b, usage);
  const db = ctx.build('opp', 0);
  assert.equal(db.species, 'garchomp');
  assert.equal(db.item, 'choicescarf', '持ち物は自分のまま');
  assert.equal(db.hpBase, 48);
  assert.deepEqual(db.moves.slice(0, 2), ['earthquake', 'dragonclaw'], '技は相手のもの');
  // じしん: 本物のガブリアスより HP が少ない分、割合ダメージは大きい
  const vsDitto = attackTable(ctx, 'me', 0, {only: {def: 0, move: 'earthquake'}}).targets[0].results.earthquake;
  const real = calcDamage({build: b.my[0], cond: {hp: 100}}, {build: {...b.my[0]}, cond: {hp: 100}}, 'earthquake');
  assert.ok(vsDitto.maxPct > real.maxPct + 10, `メタモンの HP で計算 (${vsDitto.maxPct.toFixed(0)}% > ${real.maxPct.toFixed(0)}%)`);
  // へんしん中に使った技は「判明した技」に入れない・推定もしない
  const log = addAct(b, {side: 'opp', type: 'move', move: 'earthquake', hpAfter: 40}, usage);
  assert.deepEqual(b.opp[0].moves, []);
  assert.ok(log.some(l => l.includes('へんしん')), log.join('/'));
  // 交代するとへんしんは解ける
  addAct(b, {side: 'opp', type: 'switch', to: 1, sameTurn: true}, usage);
  assert.equal(condOf(b, 'opp', 0).transformed, null);
});

test('イリュージョン: 化けていた間の記録をゾロアークに付け替えて入れ直す', () => {
  const b = battle(['garchomp', 'zoroarkhisui', 'primarina']);
  sendOut(b, 'me', 0, 1);
  sendOut(b, 'opp', 0, 0);
  b.start = {state: JSON.parse(JSON.stringify(b.state)), pick: JSON.parse(JSON.stringify(b.pick)), opp: JSON.parse(JSON.stringify(b.opp))};
  // 1ターン目: 相手は ガブリアス と思っていたら…
  addAct(b, {side: 'me', type: 'move', move: 'moonblast', hpAfter: 0.1}, usage);
  addAct(b, {side: 'opp', type: 'move', move: 'shadowball', hpAfter: 60}, usage);
  endTurn(b, usage);
  assert.ok(b.opp[0].moves.includes('shadowball'));
  const n = revealIllusion(b, usage, 1);
  assert.ok(n >= 1, `付け替えた数 ${n}`);
  assert.deepEqual(b.state.sides.opp.active, [1], '場にいるのはゾロアーク');
  assert.ok(b.opp[1].moves.includes('shadowball'), '技はゾロアークの記録に');
  assert.ok(!b.opp[0].moves.includes('shadowball'), 'ガブリアスからは消える');
  assert.ok(!b.pick.opp.includes(0), 'ガブリアスは選出されたことにならない');
  assert.ok(b.pick.opp.includes(1));
  assert.ok(condOf(b, 'opp', 1).hp < 1, 'HP の記録もゾロアークに');
  assert.equal(condOf(b, 'opp', 0).hp, 100);
});
