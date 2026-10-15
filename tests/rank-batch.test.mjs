import test from 'node:test';
import assert from 'node:assert/strict';
import {newBattle, newTeam, newBuild, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {addEvent, addAct, finishTurn, replay, editAct} from '../src/engine/flow.js';

function battle() {
  const team = newTeam();
  team.mons = [newBuild('garchomp')];
  const b = newBattle({team});
  b.opp = [newOpp('tyranitar')];
  normalizeBattle(b);
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 0);
  return b;
}
const set = (b, side, values) => addEvent(b, {kind:'boosts', side, mon:0, set:values}, null);

test('連続するランク変更は能力・対象をまたいでも1件に集約し、相殺した分だけ除く', () => {
  const b = battle();
  set(b, 'me', {atk:1}); set(b, 'me', {def:2}); set(b, 'opp', {spe:-1});
  assert.equal(b.turns[0].acts.length, 1);
  assert.match(b.turns[0].acts[0].text, /こうげき \+1/);
  assert.match(b.turns[0].acts[0].text, /ぼうぎょ \+2/);
  assert.match(b.turns[0].acts[0].text, /すばやさ -1/);
  set(b, 'me', {atk:0});
  assert.equal(b.turns[0].acts.length, 1);
  assert.doesNotMatch(b.turns[0].acts[0].text, /こうげき/);
  assert.match(b.turns[0].acts[0].text, /ぼうぎょ/);
  replay(b, null);
  assert.equal(condOf(b, 'me', 0).boosts.def, 2);
  assert.equal(condOf(b, 'opp', 0).boosts.spe, -1);
  set(b, 'me', {def:0}); set(b, 'opp', {spe:0});
  assert.equal(b.turns.length, 0, 'すべて元に戻れば記録も消える');
});

test('元のランクが0でなくても、上下を相殺するとログが残らない', () => {
  const b = battle();
  condOf(b, 'me', 0).boosts.atk = 2;
  set(b, 'me', {atk:3}); set(b, 'me', {atk:2});
  assert.equal(condOf(b, 'me', 0).boosts.atk, 2);
  assert.equal(b.turns.length, 0);
});

test('技・ターン終了を挟んだ能力変更はまとめない', () => {
  const b = battle();
  set(b, 'me', {atk:1});
  addAct(b, {side:'me', type:'move', move:'swordsdance', sameTurn:true}, null);
  set(b, 'me', {atk:4});
  assert.equal(b.turns[0].acts.length, 3);
  assert.equal(condOf(b, 'me', 0).boosts.atk, 4);
  finishTurn(b, null);
  set(b, 'me', {atk:3});
  assert.equal(b.turns.length, 2);
  assert.equal(b.turns[1].acts.length, 1);
  replay(b, null);
  assert.equal(condOf(b, 'me', 0).boosts.atk, 3);
  assert.equal(b.turns[0].acts.length, 3);
});

test('行動を挟まずにHPを修正した場合も、能力変更は1件にまとめる', () => {
  const b = battle();
  set(b, 'me', {atk:1});
  addEvent(b, {kind:'hp', side:'me', mon:0, hpAfter:70}, null);
  set(b, 'me', {atk:2});
  assert.equal(b.turns[0].acts.filter(a => a.kind === 'boosts').length, 1);
  replay(b, null);
  assert.equal(condOf(b, 'me', 0).boosts.atk, 2);
  assert.equal(condOf(b, 'me', 0).hp, 70);
  assert.equal(b.turns[0].acts.at(-1).kind, 'boosts', '最後に変更したグループを1つ戻せる順序にする');
  set(b, 'me', {atk:0});
  assert.equal(b.turns[0].acts.length, 1);
  assert.equal(b.turns[0].acts[0].kind, 'hp');
});

test('交代を挟んだ変更は別のログに残す', () => {
  const b = battle();
  b.my.push(newBuild('rotomwash'));
  normalizeBattle(b);
  set(b, 'me', {atk:1});
  addAct(b, {side:'me', type:'switch', mon:0, to:1, sameTurn:true}, null);
  addEvent(b, {kind:'boosts', side:'me', mon:1, set:{def:1}}, null);
  assert.equal(b.turns[0].acts.length, 3);
  replay(b, null);
  assert.equal(condOf(b, 'me', 0).boosts.atk, 0);
  assert.equal(condOf(b, 'me', 1).boosts.def, 1);
});

test('まとめた変更を1つ戻すと、全対象の変更が復元される', () => {
  const b = battle();
  set(b, 'me', {atk:2}); set(b, 'opp', {def:-2});
  editAct(b, 0, 0, null, null);
  assert.equal(condOf(b, 'me', 0).boosts.atk, 0);
  assert.equal(condOf(b, 'opp', 0).boosts.def, 0);
});

test('従来の1段階変更も同じログにまとめ、上限・下限を守る', () => {
  const b = battle();
  addEvent(b, {kind:'boost', side:'me', mon:0, stat:'atk', delta:1}, null);
  set(b, 'me', {atk:99});
  assert.equal(condOf(b, 'me', 0).boosts.atk, 6);
  assert.equal(b.turns[0].acts.length, 1);
  set(b, 'me', {atk:-99});
  assert.equal(condOf(b, 'me', 0).boosts.atk, -6);
});
