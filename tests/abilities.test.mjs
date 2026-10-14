import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dex} from '../src/engine/dex.js';
import {newBattle, newTeam, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {boardContext} from '../src/engine/board.js';
import {addAct, replay} from '../src/engine/flow.js';
import {calcDamage, typesOf} from '../src/engine/calc.js';

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
const mon = (b, side, i) => ({build: side === 'me' ? b.my[i] : b.opp[i], cond: condOf(b, side, i)});

test('へんげんじざい: 技を出すとそのタイプになり、2回目以降は変わらない (交代で戻る)', () => {
  const b = battle([B('greninja', {ability: 'protean', moves: ['icebeam', 'darkpulse']}), B('garchomp')], ['garchomp', 'hippowdon']);
  addAct(b, {side: 'me', type: 'move', move: 'icebeam', hpAfter: 10}, usage);
  assert.deepEqual(typesOf(b.my[0], condOf(b, 'me', 0)), ['Ice']);
  addAct(b, {side: 'me', type: 'move', move: 'darkpulse', hpAfter: 5, sameTurn: false}, usage);
  assert.deepEqual(typesOf(b.my[0], condOf(b, 'me', 0)), ['Ice'], '2回目は変わらない');
  addAct(b, {side: 'me', type: 'switch', to: 1}, usage);
  assert.equal(condOf(b, 'me', 0).types, null, '交代で元に戻る');
});

test('みずびたし: 相手がみずタイプになり、ダメージ計算にも反映', () => {
  const b = battle([B('rotomwash', {moves: ['soak', 'thunderbolt']})], ['garchomp']);
  const before = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'thunderbolt');
  assert.equal(before.max, 0, 'じめんに でんき は無効');
  addAct(b, {side: 'me', type: 'move', move: 'soak'}, usage);
  assert.deepEqual(typesOf(b.opp[0], condOf(b, 'opp', 0)), ['Water']);
  const after = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'thunderbolt');
  assert.ok(after.max > 0 && after.eff === 2);
});

test('ばけのかわ: 最初の攻撃は HP 1/8 だけ減り、推定に使わない。2回目からは普通に受ける', () => {
  const b = battle([B('garchomp', {moves: ['earthquake']})], ['mimikyu']);
  const r = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'earthquake');
  assert.ok(r.disguise && /ばけのかわ/.test(r.koText));
  const log = addAct(b, {side: 'me', type: 'move', move: 'earthquake'}, usage);
  assert.ok(Math.abs(condOf(b, 'opp', 0).hp - 87.5) < 1e-9);
  assert.ok(log.some(l => /ばけのかわ/.test(l)));
  assert.ok(condOf(b, 'opp', 0).disguiseBroken);
  assert.ok(!calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'earthquake').disguise);
});

test('ドラゴンテール: 相手を選んだポケモンと入れ替える (やり直しでも同じ)', () => {
  const b = battle([B('garchomp', {moves: ['dragontail']})], ['gholdengo', 'hippowdon', 'corviknight']);
  addAct(b, {side: 'me', type: 'move', move: 'dragontail', hpAfter: 80, forceTo: 2}, usage);
  assert.deepEqual(b.state.sides.opp.active, [2]);
  replay(b, usage);
  assert.deepEqual(b.state.sides.opp.active, [2]);
});

test('おうごんのからだ: 変化技 (あくび) は効かない。マジックミラー: ステルスロックをはね返す', () => {
  const b = battle([B('hippowdon', {moves: ['yawn', 'stealthrock']})], ['gholdengo', 'hatterene']);
  b.opp[0].ability = 'goodasgold';
  const l1 = addAct(b, {side: 'me', type: 'move', move: 'yawn'}, usage);
  assert.ok(l1.some(x => /おうごんのからだ/.test(x)));
  const b2 = battle([B('hippowdon', {moves: ['stealthrock']})], ['hatterene']);
  b2.opp[0].ability = 'magicbounce';
  addAct(b2, {side: 'me', type: 'move', move: 'stealthrock'}, usage);
  assert.ok(b2.state.sides.me.sr && !b2.state.sides.opp.sr);
});

test('バトルスイッチ: 攻撃技でブレード (計算もブレードのA)、キングシールドでシールド、交代でシールドに戻る', () => {
  const b = battle([B('aegislashshield', {nature: 'Adamant', sp: [2, 32, 0, 0, 0, 32], moves: ['shadowsneak', 'kingsshield']}), B('garchomp')], ['garchomp']);
  const shield = calcDamage(mon(b, 'opp', 0), mon(b, 'me', 0), 'earthquake');
  const hit = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'shadowsneak');
  assert.ok(hit.max > 0);
  addAct(b, {side: 'me', type: 'move', move: 'shadowsneak', hpAfter: 80}, usage);
  assert.equal(condOf(b, 'me', 0).forme, 'aegislashblade');
  const hit2 = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'shadowsneak');
  assert.equal(hit2.max, hit.max, '待機中もブレードで計算している');
  const blade = calcDamage(mon(b, 'opp', 0), mon(b, 'me', 0), 'earthquake');
  assert.ok(blade.max > shield.max * 1.8, 'ブレード中は受けるダメージが増える');
  addAct(b, {side: 'me', type: 'move', move: 'kingsshield', sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 0).forme, null);
  addAct(b, {side: 'me', type: 'move', move: 'shadowsneak', hpAfter: 60, sameTurn: false}, usage);
  addAct(b, {side: 'me', type: 'switch', to: 1, sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 0).forme, null);
});

test('ターンの区切り: 両方が1回ずつ動いたら終われる。PPは使った回数だけ減る。分かっている持ち物の回復は聞かずに入る', async () => {
  const {sideDone, ppLeft, residualCandidates, finishTurn} = await import('../src/engine/flow.js');
  const b = battle([B('garchomp', {moves: ['earthquake'], item: 'leftovers'})], ['corviknight']);
  b.opp[0].item = 'leftovers';
  assert.ok(!sideDone(b, 'me') && !sideDone(b, 'opp'));
  addAct(b, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 100, sameTurn: true}, usage);
  assert.ok(sideDone(b, 'me') && !sideDone(b, 'opp'));
  addAct(b, {side: 'opp', type: 'move', move: 'bravebird', hpAfter: 60, sameTurn: true}, usage);
  assert.ok(sideDone(b, 'opp'));
  assert.deepEqual(ppLeft(b, 'me', 0, 'earthquake'), {left: 11, max: 12});
  const sure = residualCandidates(b, usage).filter(c => c.checked);
  assert.ok(sure.some(c => c.side === 'me' && c.key === 'leftovers'), '自分のたべのこし');
  finishTurn(b, usage, {residual: sure});
  assert.ok(condOf(b, 'me', 0).hp > 60);
  assert.ok(!sideDone(b, 'me'));
});
