// 対戦の流れで変わる技・特性・場の状態 (ポケ徹のチャンピオンズ仕様に合わせたもの)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dex} from '../src/engine/dex.js';
import {newBattle, newTeam, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {boardContext, attackTable, moveState} from '../src/engine/board.js';
import {addAct, finishTurn, residualCandidates} from '../src/engine/flow.js';

const usage = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));
const B = (species, o = {}) => ({species, item: '', ability: dex.species[species].ab[0], nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: '', ...o});
function battle(mine, opp) {
  const team = newTeam();
  team.mons = mine;
  const b = normalizeBattle(Object.assign(newBattle({team}), {start: null}));
  for (const s of opp) b.opp.push(newOpp(s));
  const nb = normalizeBattle(b);
  sendOut(nb, 'me', 0, 0); sendOut(nb, 'opp', 0, 0);
  return nb;
}
const dmg = (b, side, idx, move) => attackTable(boardContext(b, usage), side, idx, {only: {def: b.state.sides[side === 'me' ? 'opp' : 'me'].active[0], move}}).targets[0].results[move];
const faint = (b, side, i) => { const c = condOf(b, side, i); c.hp = 0; c.fainted = true; };

test('おはかまいり: 倒れた味方1体ごとに威力+50', () => {
  const b = battle([B('houndstone', {moves: ['lastrespects']}), B('garchomp'), B('corviknight')], ['garchomp']);
  const r0 = dmg(b, 'me', 0, 'lastrespects');
  faint(b, 'me', 1);
  assert.equal(moveState(b, 'me', 0, 'opp', 0, 'lastrespects').bp, 100);
  const r1 = dmg(b, 'me', 0, 'lastrespects');
  assert.ok(r1.max > r0.max * 1.8, `${r0.max} → ${r1.max}`);
});

test('ふんどのこぶし: 攻撃を受けた回数 (連続技は1発ずつ) で威力+50、交代でリセット (チャンピオンズ)', () => {
  const b = battle([B('annihilape', {moves: ['ragefist']}), B('garchomp')], ['garchomp', 'cinccino']);
  addAct(b, {side: 'opp', type: 'move', move: 'dragonclaw', hpAfter: 80}, usage);
  assert.equal(condOf(b, 'me', 0).timesAttacked, 1);
  assert.equal(moveState(b, 'me', 0, 'opp', 0, 'ragefist').bp, 100);
  addAct(b, {side: 'opp', type: 'move', move: 'dualwingbeat', hpAfter: 60, sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 0).timesAttacked, 3, 'ダブルウイングは2回');
  addAct(b, {side: 'me', type: 'switch', to: 1, sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 0).timesAttacked, 0);
});

test('そうだいしょう: 場に出た時点で倒れていた味方の数で威力が上がる', () => {
  const b = battle([B('garchomp'), B('kingambit', {ability: 'supremeoverlord', moves: ['kowtowcleave']}), B('corviknight')], ['hippowdon']);
  const before = attackTable(boardContext(b, usage), 'me', 1, {only: {def: 0, move: 'kowtowcleave'}}).targets[0].results.kowtowcleave.max;
  faint(b, 'me', 0);
  sendOut(b, 'me', 0, 1);
  assert.equal(condOf(b, 'me', 1).entryFainted, 1);
  const after = dmg(b, 'me', 1, 'kowtowcleave').max;
  assert.ok(after > before, `${before} → ${after}`);
});

test('じだんだ: 前のターンに外れると威力2倍 / カウンター・いかりのまえば: 決まった量のダメージ', () => {
  const b = battle([B('garchomp', {moves: ['stompingtantrum', 'earthquake']})], ['hippowdon']);
  addAct(b, {side: 'me', type: 'move', move: 'stompingtantrum', miss: true}, usage);
  addAct(b, {side: 'opp', type: 'move', move: 'slackoff'}, usage);
  finishTurn(b, usage, {});
  assert.equal(moveState(b, 'me', 0, 'opp', 0, 'stompingtantrum').bp, 150);
  const b2 = battle([B('garchomp')], ['hippowdon', 'corviknight']);
  const sf = dmg(b2, 'opp', 0, 'superfang');
  assert.ok(sf.ok && Math.abs(sf.maxPct - 50) < 1, `いかりのまえば ${sf.maxPct}`);
  addAct(b2, {side: 'me', type: 'move', move: 'dragonclaw', hpAfter: 70}, usage);
  const ct = dmg(b2, 'opp', 0, 'counter');
  assert.ok(ct.max > 0 && !ct.immune, 'カウンター: 物理技を受けたあとならダメージが出る');
});

test('どくびし・ねばねばネット・いやしのねがい・ねがいごと', () => {
  const b = battle([B('garchomp'), B('hippowdon'), B('corviknight')], ['glimmora', 'ribombee']);
  addAct(b, {side: 'opp', type: 'move', move: 'toxicspikes'}, usage);
  addAct(b, {side: 'opp', type: 'move', move: 'toxicspikes', sameTurn: false}, usage);
  assert.equal(b.state.sides.me.tspikes, 2);
  addAct(b, {side: 'me', type: 'switch', to: 1, sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 1).status, 'tox', '2層でもうどく');
  addAct(b, {side: 'me', type: 'switch', to: 2, sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 2).status, '', 'ひこうタイプは浮いている');
  const b2 = battle([B('garchomp'), B('hippowdon')], ['ribombee']);
  addAct(b2, {side: 'opp', type: 'move', move: 'stickyweb'}, usage);
  addAct(b2, {side: 'me', type: 'switch', to: 1, sameTurn: false}, usage);
  assert.equal(condOf(b2, 'me', 1).boosts.spe, -1);
  const b3 = battle([B('garchomp'), B('hippowdon')], ['clefable']);
  condOf(b3, 'me', 0).hp = 40;
  addAct(b3, {side: 'opp', type: 'move', move: 'wish'}, usage);
  addAct(b3, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 90}, usage);
  finishTurn(b3, usage, {});
  addAct(b3, {side: 'opp', type: 'move', move: 'moonblast', hpAfter: 90}, usage);
  addAct(b3, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 50}, usage);
  const c = residualCandidates(b3, usage).filter(x => x.key === 'wish');
  assert.equal(c.length, 1);
  assert.equal(c[0].side, 'opp', 'ねがいごとは使った側の場に');
});

test('しめつける・くろいきり・いたみわけ・みちづれ・とどめばり', () => {
  const b = battle([B('garchomp', {moves: ['swordsdance']})], ['hippowdon']);
  addAct(b, {side: 'opp', type: 'move', move: 'sandtomb', hpAfter: 90}, usage);
  assert.ok(residualCandidates(b, usage).some(x => x.key === 'bind' && x.side === 'me' && x.checked));
  addAct(b, {side: 'me', type: 'move', move: 'swordsdance'}, usage);
  addAct(b, {side: 'opp', type: 'move', move: 'haze', sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 0).boosts.atk, 0);
  const b2 = battle([B('garchomp', {moves: ['dragonclaw']})], ['gengar']);
  condOf(b2, 'me', 0).hp = 20;
  addAct(b2, {side: 'me', type: 'move', move: 'painsplit'}, usage);
  assert.ok(condOf(b2, 'me', 0).hp > 20 && condOf(b2, 'opp', 0).hp < 100);
  addAct(b2, {side: 'opp', type: 'move', move: 'destinybond', sameTurn: false}, usage);
  addAct(b2, {side: 'me', type: 'move', move: 'dragonclaw', hpAfter: 0}, usage);
  assert.ok(condOf(b2, 'me', 0).fainted, 'みちづれ');
});

test('特性: トレース・ミイラ・ひらいしん・シンクロ・うるおいボディ', () => {
  const b = battle([B('garchomp', {ability: 'roughskin', moves: ['dragonclaw']}), B('raichu', {moves: ['thunderbolt']})], ['gardevoir', 'cofagrigus']);
  b.opp[0].ability = 'trace';
  sendOut(b, 'opp', 0, 1); sendOut(b, 'opp', 0, 0);
  assert.equal(condOf(b, 'opp', 0).abilityChanged, 'roughskin', 'トレース');
  b.opp[1].ability = 'mummy';
  sendOut(b, 'opp', 0, 1);
  addAct(b, {side: 'me', type: 'move', move: 'dragonclaw', hpAfter: 70}, usage);
  assert.equal(condOf(b, 'me', 0).abilityChanged, 'mummy');
  const b2 = battle([B('raichu', {moves: ['thunderbolt']})], ['raichu']);
  b2.opp[0].ability = 'lightningrod';
  addAct(b2, {side: 'me', type: 'move', move: 'thunderbolt', hpAfter: 100}, usage);
  assert.equal(condOf(b2, 'opp', 0).boosts.spa, 1);
  const b3 = battle([B('garchomp', {moves: ['toxic']})], ['umbreon']);
  b3.opp[0].ability = 'synchronize';
  addAct(b3, {side: 'me', type: 'move', move: 'toxic', inflict: 'tox'}, usage);
  assert.equal(condOf(b3, 'me', 0).status, 'tox');
});
