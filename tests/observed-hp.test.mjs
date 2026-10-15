import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut,setHP,condOf} from '../src/engine/battle.js';
import {addAct,addEvent,replay,editAct,finishTurn,residualCandidates} from '../src/engine/flow.js';
function battle(){const team=newTeam();team.mons=[newBuild('arboliva'),newBuild('garchomp')];const b=newBattle({team});b.opp=[newOpp('garchomp')];normalizeBattle(b);b.opp[0].ability='roughskin';sendOut(b,'me',0,0);sendOut(b,'opp',0,0);setHP(b,'me',0,20);return b;}
const act=(b,move,extra={})=>addAct(b,{type:'move',side:'me',mon:0,move,sameTurn:true,...extra});
const own=b=>condOf(b,'me',0);
const observed=(hpAfter,side='me')=>({side,mon:0,hpAfter});

test('ちからをすいとる: 未入力ではHPを変えず、攻撃低下だけを反映',()=>{
 const b=battle();act(b,'strengthsap');assert.equal(own(b).hp,20);assert.ok(own(b).hpUnknown);assert.equal(condOf(b,'opp',0).boosts.atk,-1);
});
test('行動後HP: 実測を採用し、後から訂正・再生しても自動回復を足さない',()=>{
 const b=battle();act(b,'strengthsap',{observedHp:[observed(70)]});assert.equal(own(b).hp,70);assert.ok(!own(b).hpUnknown);
 const input={...b.turns[0].acts[0].in,observedHp:[observed(80)]};editAct(b,0,0,input);assert.equal(own(b).hp,80);replay(b);assert.equal(own(b).hp,80);assert.equal(condOf(b,'opp',0).boosts.atk,-1);
});
test('ちからをすいとる: マジックミラーでは反射先の回復後HPを記録',()=>{
 const b=battle();b.opp[0].ability='magicbounce';setHP(b,'opp',0,30);act(b,'strengthsap',{observedHp:[observed(85,'opp')]});assert.equal(own(b).hp,20);assert.equal(condOf(b,'opp',0).hp,85);assert.equal(own(b).boosts.atk,-1);assert.ok(!condOf(b,'opp',0).hpUnknown);
});
test('いたみわけ: 両者のHPを別々に入力し、片方が未入力でも記録できる',()=>{
 const b=battle();act(b,'painsplit',{observedHp:[observed(60)]});assert.equal(own(b).hp,60);assert.ok(!own(b).hpUnknown);assert.equal(condOf(b,'opp',0).hp,100);assert.ok(condOf(b,'opp',0).hpUnknown);
});
test('吸収: 相手HPが不明でも使用者の実測HPは記録できる',()=>{
 const b=battle();act(b,'gigadrain',{hpUnknown:true,selfHpUnknown:true,observedHp:[observed(65)]});assert.equal(own(b).hp,65);assert.ok(!own(b).hpUnknown);assert.ok(condOf(b,'opp',0).hpUnknown);
});
test('変動する反動: いのちのたまと一緒でも未確認のHPを計算しない',()=>{
 const b=battle();b.my[0].item='lifeorb';act(b,'woodhammer',{hpAfter:50,selfFx:['recoil','lifeorb']});assert.equal(own(b).hp,20);assert.ok(own(b).hpUnknown);
});
test('固定のHP消費・固定割合の回復は自動反映を続ける',()=>{
 const b=battle();act(b,'recover');assert.ok(own(b).hp>69&&own(b).hp<71);assert.ok(!own(b).hpUnknown);
 const before=own(b).hp;act(b,'gigadrain',{hpAfter:80,selfFx:['lifeorb']});assert.ok(own(b).hp<before);assert.ok(!own(b).hpUnknown);
});
test('かいがらのすず: 未入力で推測せず、行動後HPをそのまま記録',()=>{
 const b=battle();b.my[0].item='shellbell';act(b,'earthpower',{hpAfter:50,selfFx:['shellbell']});assert.equal(own(b).hp,20);assert.ok(own(b).hpUnknown);
 act(b,'earthpower',{hpAfter:25,selfFx:['shellbell'],observedHp:[observed(55)]});assert.equal(own(b).hp,55);assert.ok(!own(b).hpUnknown);
});
test('やどりぎの回復: ターン終了後HPで確定、未入力なら回復量を推測しない',()=>{
 for(const measured of [false,true]){
  const b=battle();act(b,'leechseed');const residual=residualCandidates(b).filter(c=>c.key==='leechheal');assert.equal(residual.length,1);assert.ok(residual[0].manualHP);
  finishTurn(b,null,{incomplete:true,residual,finalHp:measured?{me0:40}:{}});assert.equal(own(b).hp,measured?40:20);assert.equal(!!own(b).hpUnknown,!measured);
 }
});
test('ねがいごと: 交代した回復先のHPを入力し、使用者の最大HPから推測しない',()=>{
 const b=battle();act(b,'wish');finishTurn(b,null,{incomplete:true});addAct(b,{side:'me',mon:0,type:'switch',to:1});setHP(b,'me',1,20);
 const residual=residualCandidates(b).filter(c=>c.key==='wish');assert.equal(residual.length,1);assert.ok(residual[0].manualHP);finishTurn(b,null,{incomplete:true,residual,finalHp:{me1:60}});assert.equal(condOf(b,'me',1).hp,60);assert.ok(!condOf(b,'me',1).hpUnknown);
});
test('実測0HPも有効、未入力のHPはダメージ推定の起点に使わない',()=>{
 const b=battle();act(b,'strengthsap');assert.ok(own(b).hpUnknown);addAct(b,{side:'opp',mon:0,type:'move',move:'earthquake',hpAfter:10});assert.ok(!b.opp[0].statOk);
 addEvent(b,{side:'me',mon:0,kind:'hp',hpAfter:20});act(b,'gigadrain',{hpUnknown:true,observedHp:[observed(0)]});assert.ok(own(b).fainted);assert.equal(own(b).hp,0);
});
