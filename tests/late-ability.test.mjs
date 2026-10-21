import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam,newBattle,newBuild,newOpp,normalizeBattle,sendOut,condOf} from '../src/engine/battle.js';
import {addAct,addEvent,replay,hitAbilityAction} from '../src/engine/flow.js';
function setup(ability='') {
 const team=newTeam();team.mons=[newBuild('snorlax')];const b=newBattle({team});b.opp=[{...newOpp('skarmory'),ability}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;
}
const hit=(b,extra={})=>addAct(b,{side:'me',mon:0,type:'move',move:'bodypress',hpAfter:80,sameTurn:true,...extra});
const activate=b=>addEvent(b,{kind:'ability',side:'opp',mon:0,ability:'weakarmor',activate:true});
test('被弾後に判明したくだけるよろいを発動し、再生と再クリックで重複しない',()=>{
 const b=setup();hit(b);assert.equal(condOf(b,'opp',0).boosts.spe,0);
 addEvent(b,{kind:'ability',side:'opp',mon:0,ability:'weakarmor'});activate(b);
 assert.equal(condOf(b,'opp',0).boosts.def,-1);assert.equal(condOf(b,'opp',0).boosts.spe,2);
 activate(b);assert.equal(condOf(b,'opp',0).boosts.spe,2);replay(b);assert.equal(condOf(b,'opp',0).boosts.spe,2);
});
test('すでに自動発動した被弾は追加しない',()=>{const b=setup('weakarmor');hit(b);activate(b);assert.equal(condOf(b,'opp',0).boosts.spe,2);});
test('特殊技・外し・守られた・無効ではくだけるよろいを発動しない',()=>{
 for(const extra of [{move:'surf'},{miss:true},{protect:true},{move:'earthquake'}]){const b=setup();hit(b,extra);activate(b);assert.equal(condOf(b,'opp',0).boosts.spe,0,JSON.stringify(extra));}
});
test('連続技の回数を発動に反映する',()=>{const b=setup();hit(b,{move:'rockblast',hits:3});activate(b);assert.equal(condOf(b,'opp',0).boosts.def,-3);assert.equal(condOf(b,'opp',0).boosts.spe,6);replay(b);assert.equal(condOf(b,'opp',0).boosts.def,-3);});
test('発動元の技を削除した場合は別の被弾に付け替えない',()=>{const b=setup();hit(b);activate(b);b.turns[0].acts.shift();replay(b);assert.equal(condOf(b,'opp',0).boosts.spe,0);assert.equal(hitAbilityAction(b,'opp',0),null);});
