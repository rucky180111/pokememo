import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam, newBuild, newBattle, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {addAct, addEvent, finishTurn, replay} from '../src/engine/flow.js';

function battle() {
  const team = newTeam();
  team.mons = [{...newBuild('garchomp'), moves: ['earthquake', 'swordsdance']}];
  const b = newBattle({team});
  b.opp = [newOpp('tyranitar')];
  normalizeBattle(b);
  sendOut(b, 'me', 0, 0);
  sendOut(b, 'opp', 0, 0);
  return b;
}

test('HP不明の攻撃を記録しても予測値を実測や能力推定に使わない', () => {
  const b = battle();
  addAct(b, {side:'me', type:'move', move:'earthquake', hpUnknown:true}, null);
  assert.equal(condOf(b, 'opp', 0).hp, 100);
  assert.equal(condOf(b, 'opp', 0).hpUnknown, true);
  assert.equal(b.turns[0].acts[0].hpAfter, undefined);
  assert.equal(condOf(b, 'opp', 0).timesAttacked, 1);
  assert.equal(b.opp[0].statOk ?? null, null);
  finishTurn(b, null);
  addAct(b, {side:'me', type:'move', move:'earthquake', hpAfter:30}, null);
  assert.equal(b.opp[0].statOk ?? null, null, '直前のHPが不明なら次の実測からもダメージを逆算しない');
  assert.equal(condOf(b, 'opp', 0).hp, 30);
  assert.equal(condOf(b, 'opp', 0).hpUnknown, undefined);
  assert.equal(b.turns[1].acts[0].dmgPct, undefined, '前のHPが不明ならダメージ量を捏造しない');
  replay(b, null);
  assert.equal(condOf(b, 'opp', 0).hp, 30);
  assert.equal(b.opp[0].statOk ?? null, null);
});

test('行動のないターンも未入力として終了し、再生しても未入力情報が残る', () => {
  const b = battle();
  finishTurn(b, null, {incomplete:true});
  assert.equal(b.turns.length, 1);
  assert.equal(b.turns[0].open, false);
  assert.equal(b.turns[0].incomplete, true);
  assert.equal(b.turns[0].end.noOrder, true);
  assert.equal(condOf(b, 'me', 0).hpUnknown, true);
  addAct(b, {side:'me', type:'move', move:'swordsdance'}, null);
  assert.equal(b.turns[1].n, 2);
  replay(b, null);
  assert.equal(b.turns[0].incomplete, true);
  assert.equal(condOf(b, 'me', 0).boosts.atk, 2);
  assert.equal(b.opp[0].speOk ?? null, null);
  addEvent(b, {kind:'hp', side:'me', mon:0, hpAfter:70}, null);
  assert.equal(condOf(b, 'me', 0).hpUnknown, undefined);
});

test('ターン終了後に確認したHPで未確認状態を解消する', () => {
  const b = battle();
  addAct(b, {side:'me', type:'move', move:'earthquake', hpUnknown:true}, null);
  finishTurn(b, null, {finalHp:{opp0:60}});
  assert.equal(condOf(b, 'opp', 0).hp, 60);
  assert.equal(condOf(b, 'opp', 0).hpUnknown, undefined);
  assert.equal(b.turns[0].acts[0].hpUnknown, undefined);
  replay(b, null);
  assert.equal(condOf(b, 'opp', 0).hp, 60);
});
