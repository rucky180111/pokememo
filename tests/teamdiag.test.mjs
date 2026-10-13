import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defenseReport, offenseReport, topReport, defMultiplier, existingTypeCombos} from '../src/engine/teamdiag.js';

const team = JSON.parse(fs.readFileSync(new URL('./fixtures/team-expected.json', import.meta.url))).mons || JSON.parse(fs.readFileSync(new URL('./fixtures/team-expected.json', import.meta.url)));
const usage = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));

test('特性込みの受け倍率', () => {
  assert.equal(defMultiplier('Ground', ['Dragon', 'Ground'], 'levitate'), 0);
  assert.equal(defMultiplier('Fire', ['Water'], 'dryskin'), 0.5 * 1.25);
  assert.equal(defMultiplier('Ground', ['Steel'], '', 'airballoon'), 0);
  assert.equal(defMultiplier('Ice', ['Normal'], 'thickfat'), 0.5);
});

test('存在する組み合わせだけを数える', () => {
  const c = existingTypeCombos().map(x => x.types.join('/'));
  assert.ok(c.includes('Dark/Ghost'));
  assert.equal(new Set(c).size, c.length);
});

test('構築の診断', () => {
  const d = defenseReport(team);
  assert.deepEqual(d.notResisted, ['Ghost', 'Dark']);
  const o = offenseReport(team);
  assert.ok(o.notHit.some(c => c.types.join('/') === 'Dark/Ghost'));
  const t = topReport(team, usage, 30);
  assert.equal(t.length, 30);
  assert.ok(t.every(x => x.best.m >= 0));
});

test('おすすめ: 入れ替える枠を指定すると、穴を埋めるものが上に来る', async () => {
  const {recommendTypes, recommendMons} = await import('../src/engine/teamdiag.js');
  const rt = recommendTypes(team, usage, {replace: 5});
  assert.ok(rt.list.length === 10 && rt.list[0].gain >= rt.list[9].gain);
  assert.ok(rt.list[0].diff.fixedRes.length > 0);
  const rm = recommendMons(team, usage, {replace: 5, mega: false});
  assert.ok(rm.list.length > 0 && rm.list.every(x => !x.id.includes('mega')));
  assert.ok(!rm.list.some(x => ['empoleon', 'salamence', 'gholdengo', 'garchomp', 'rillaboom'].includes(x.id)));
});
