import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut,condOf,clone} from '../src/engine/battle.js';
import {calcDamage} from '../src/engine/calc.js';
import {addAct,confirmAbility,replay,undoLast} from '../src/engine/flow.js';
function setup(species){const team=newTeam();team.mons=[{...newBuild('garchomp'),moves:['fireblast','earthquake']}];const b=newBattle({team});b.opp=[newOpp(species)];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;}
test('厚い脂肪の後入力で既存ダメージの特防推定を再計算し、取消で元に戻せる',()=>{
 const b=setup('snorlax');b.opp[0].ability='immunity';const r=calcDamage({build:b.my[0],cond:condOf(b,'me',0)},{build:{...newBuild('snorlax'),ability:'thickfat'},cond:condOf(b,'opp',0)},'fireblast');addAct(b,{side:'me',mon:0,type:'move',move:'fireblast',hpAfter:100-r.rolls[0]/r.defMaxHP*100,sameTurn:true});const mask=b.opp[0].statOk?.spd;
 assert.ok(confirmAbility(b,{mon:0,ability:'thickfat'}));assert.notEqual(b.opp[0].statOk.spd,mask);const after=clone(b.opp[0].statOk);replay(b);assert.deepEqual(b.opp[0].statOk,after);assert.ok(undoLast(b));assert.equal(b.opp[0].ability,'immunity');assert.equal(b.opp[0].statOk?.spd,mask);
});
test('砕ける鎧の後入力は発動を一度だけ補い、再計算・取消でも二重にならない',()=>{
 const b=setup('skarmory');addAct(b,{side:'me',mon:0,type:'move',move:'bodyslam',hpAfter:80,sameTurn:true});confirmAbility(b,{mon:0,ability:'weakarmor'});assert.equal(condOf(b,'opp',0).boosts.def,-1);assert.equal(condOf(b,'opp',0).boosts.spe,2);replay(b);assert.equal(condOf(b,'opp',0).boosts.def,-1);undoLast(b);assert.equal(condOf(b,'opp',0).boosts.def,0);assert.equal(b.opp[0].ability,'');
});
test('既知の登場時特性を再確認しても二重発動しない',()=>{
 const b=setup('gyarados');b.opp[0].ability='intimidate';confirmAbility(b,{mon:0,ability:'intimidate'});assert.equal(b.turns[0].acts.at(-1).in.activate,false);
});
