import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam, newBuild, newBattle, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {boardContext} from '../src/engine/board.js';
import {inferFromTaken, inferFromDealt} from '../src/engine/infer-dmg.js';
import {addAct, replay} from '../src/engine/flow.js';
import {comboOf} from '../src/engine/assume.js';

function battle() {
  const team = newTeam();
  team.mons = [{...newBuild('garchomp'), item:'leftovers', nature:'Adamant', sp:[0,32,0,0,0,0], moves:['dragonclaw']}];
  const b = newBattle({team});
  b.opp = [{...newOpp('garchomp'), ability:'roughskin', item:'leftovers'}];
  normalizeBattle(b);
  sendOut(b, 'me', 0, 0);
  sendOut(b, 'opp', 0, 0);
  return b;
}

test('倒されたとき、残りHPを削れる火力の候補だけ残し、過剰ダメージは否定しない', () => {
  const b = battle();
  const ctx = boardContext(b, null);
  const r = inferFromTaken(ctx, 0, 0, 'dragonclaw', 183, {atLeast:true});
  assert.equal(r.mask[comboOf(1.1,32)], '1');
  assert.equal(r.mask[comboOf(1,0)], '0');
  assert.ok(r.spRange[0] > 0);
  const log = addAct(b, {side:'opp', type:'move', move:'dragonclaw', hpAfter:0, exact:true}, null);
  assert.equal(b.opp[0].statOk.atk[comboOf(1.1,32)], '1');
  assert.equal(b.opp[0].statOk.atk[comboOf(1,0)], '0');
  assert.ok(log.some(x => /能力Ptは最低/.test(x)));
  assert.ok(log.some(x => /下限/.test(x)));
  assert.equal(condOf(b, 'me', 0).fainted, true);
  const mask = b.opp[0].statOk.atk;
  replay(b, null);
  assert.equal(b.opp[0].statOk.atk, mask);
});

test('倒したときは耐久が高すぎる組み合わせを除外する', () => {
  const b = battle();
  const r = inferFromDealt(boardContext(b, null), 0, 0, 'dragonclaw', 100, 0, {atLeast:true});
  assert.equal(r.mask[comboOf(1,0)], '1', 'H0 B0は倒せる');
  assert.equal(r.mask[32 * 99 + comboOf(1.1,32)], '0', 'H32 B32補正ありは倒せない');
  addAct(b, {side:'me', type:'move', move:'dragonclaw', hpAfter:0}, null);
  assert.equal(b.opp[0].statOk.def[comboOf(1,0)], '1');
  assert.equal(b.opp[0].statOk.def[32 * 99 + comboOf(1.1,32)], '0');
});

test('削れた相手のひんしから、満タンから倒せると決めつけない', () => {
  const b = battle();
  condOf(b, 'opp', 0).hp = 30;
  addAct(b, {side:'me', type:'move', move:'dragonclaw', hpAfter:0}, null);
  assert.equal(b.opp[0].statOk.def[32 * 99 + comboOf(1.1,32)], '1');
});

test('不明だったHPや非対応の技では、ひんしでも絞り込まない', () => {
  const b = battle();
  condOf(b, 'me', 0).hpUnknown = true;
  addAct(b, {side:'opp', type:'move', move:'dragonclaw', hpAfter:0}, null);
  assert.equal(b.opp[0].statOk, undefined);
  const c = battle();
  addAct(c, {side:'opp', type:'move', move:'fissure', hpAfter:0}, null);
  assert.equal(c.opp[0].statOk, undefined);
});
