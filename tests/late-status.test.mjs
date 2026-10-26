import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut,condOf,clone} from '../src/engine/battle.js';
import {addAct,addEvent,recordStatusAt,replay,finishTurn,deleteActs,ppLeft} from '../src/engine/flow.js';
function setup(){const team=newTeam();team.mons=[{...newBuild('toucannon'),moves:['beakblast']}];const b=newBattle({team});b.opp=[{...newOpp('snorlax'),ability:'thickfat'}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;}
function contact(b){addAct(b,{side:'opp',mon:0,type:'move',move:'bodypress',hpAfter:70,sameTurn:true});}
test('くちばしキャノンの接触側を技の後にやけどにし、PP・行動数を増やさない',()=>{
 const b=setup();contact(b);addAct(b,{side:'me',mon:0,type:'move',move:'beakblast',hpAfter:60,sameTurn:true});const pp=ppLeft(b,'opp',0,'bodypress').left;
 assert.ok(recordStatusAt(b,{side:'opp',mon:0,status:'brn'},{ti:0,ai:0,when:'after'}));assert.equal(condOf(b,'opp',0).status,'brn');assert.equal(condOf(b,'me',0).status,'');assert.equal(b.turns[0].acts.filter(a=>a.type==='move').length,2);assert.equal(ppLeft(b,'opp',0,'bodypress').left,pp);assert.equal(b.turns[0].acts[1].kind,'status');const hp=condOf(b,'me',0).hp;replay(b);assert.equal(condOf(b,'opp',0).status,'brn');assert.equal(condOf(b,'me',0).hp,hp);
 assert.ok(deleteActs(b,[{ti:0,ai:1}]));assert.equal(condOf(b,'opp',0).status,'');
});
test('ターンを閉じた後でも過去に追加でき、ターンが増えない',()=>{const b=setup();contact(b);finishTurn(b,null,{incomplete:true});assert.ok(recordStatusAt(b,{side:'me',mon:0,status:'par'},{ti:0,ai:0,when:'after'}));assert.equal(b.turns.length,1);assert.equal(b.turns[0].open,false);assert.equal(condOf(b,'me',0).status,'par');});
test('眠り・こおり・猛毒を変更・解除すると古い回数を残さない。同じ状態なら維持',()=>{
 const b=setup(),c=condOf(b,'me',0);c.status='slp';c.statusKey='slpRest';c.statusCant=2;c.toxicCounter=4;addEvent(b,{kind:'status',side:'me',mon:0,status:'slp'});assert.equal(c.statusCant,2);assert.ok(recordStatusAt(b,{side:'me',mon:0,status:'frz'}));assert.equal(c.statusCant,0);assert.equal(c.statusKey,'');assert.equal(c.toxicCounter,1);recordStatusAt(b,{side:'me',mon:0,status:''});assert.equal(c.status,'');
});
test('状態異常を後入力しても、判明済みのラムのみは重複消費せず自動回復する',()=>{const b=setup();b.my[0].item='lumberry';contact(b);recordStatusAt(b,{side:'me',mon:0,status:'brn'},{ti:0,ai:0,when:'after'});assert.equal(condOf(b,'me',0).status,'');assert.equal(condOf(b,'me',0).itemGone,true);replay(b);assert.equal(condOf(b,'me',0).status,'');assert.equal(condOf(b,'me',0).itemGone,true);});
test('無効なタイミング・対象・状態は盤面を書き換えない',()=>{const b=setup();contact(b);const before=clone(b);for(const at of [{ti:9,ai:0,when:'before'},{ti:0,ai:9,when:'after'},{ti:0,ai:0,when:'invalid'}])assert.equal(recordStatusAt(b,{side:'me',mon:0,status:'brn'},at),false);assert.equal(recordStatusAt(b,{side:'me',mon:99,status:'brn'}),false);assert.equal(recordStatusAt(b,{side:'me',mon:0,status:'unknown'}),false);assert.deepEqual(b,before);});
