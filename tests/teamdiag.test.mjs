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

test('くさむすびで水・地面と水/地面の弱点を突ける。上位診断と構築スコアにも反映',async()=>{
 const {teamScore}=await import('../src/engine/teamdiag.js');
 const b={species:'greninja',ability:'torrent',item:'',moves:['grassknot']};
 const o=offenseReport([b]);assert.equal(o.moves,1);
 for(const [types,m] of [[['Water'],2],[['Ground'],2],[['Ground','Water'],4]]){
  const c=o.combos.find(c=>c.types.join('/')===types.join('/'));assert.ok(c);assert.equal(c.best.m,m);assert.equal(c.best.move,'grassknot');assert.ok(!o.notHit.includes(c));
 }
 const u={pokemon:{swampert:{u:1,ab:[['torrent',1]],it:[]}}};
 assert.equal(topReport([b],u)[0].best.m,4);assert.equal(teamScore([b],u).topMiss.length,0);assert.equal(teamScore([{...b,moves:[]}],u).topMiss.length,1);
});
test('他の威力変動技もタイプ相性に含み、特殊なタイプ変更と草食を維持する',()=>{
 for(const [move,type,expected] of [['lowkick','Normal',2],['gyroball','Fairy',2],['electroball','Water',2],['heavyslam','Fairy',2],['heatcrash','Grass',2],['hardpress','Fairy',2],['reversal','Normal',2],['beatup','Ghost',2],['fling','Ghost',2]]){
  const o=offenseReport([{species:'lucario',ability:'innerfocus',moves:[move]}]);assert.equal(o.moves,1,move);assert.equal(o.combos.find(c=>c.types.join('/')===type).best.m,expected,move);
 }
 for(const move of ['flail','spitup']){
  const o=offenseReport([{species:'sylveon',ability:'pixilate',moves:[move]}]);assert.equal(o.combos.find(c=>c.types.join('/')==='Dragon').best.m,2);
 }
 const t=topReport([{species:'greninja',moves:['grassknot']}],{pokemon:{azumarill:{u:1,ab:[['sapsipper',1]]}}});assert.equal(t[0].best.m,0);
});
test('固定・割合・反射ダメージや一撃必殺・変化技を弱点打点に混ぜない',()=>{
 for(const move of ['seismictoss','nightshade','counter','mirrorcoat','metalburst','comeuppance','finalgambit','endeavor','superfang','fissure','sheercold','guillotine','horndrill','swordsdance']){
  const o=offenseReport([{species:'lucario',moves:[move]}]);assert.equal(o.moves,0,move);assert.ok(o.combos.every(c=>c.best.m===-1),move);
 }
});
