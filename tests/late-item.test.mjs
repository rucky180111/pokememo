import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut,clone,condOf} from '../src/engine/battle.js';
import {addAct,confirmItem,replay,undoLast} from '../src/engine/flow.js';
import {calcDamage} from '../src/engine/calc.js';
import {comboOf} from '../src/engine/assume.js';
function setup(species='garchomp',ability='roughskin'){const team=newTeam();team.mons=[{...newBuild('umbreon'),sp:[32,0,0,0,0,0]}];const b=newBattle({team});b.opp=[{...newOpp(species),ability}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;}
function attack(b,extra={}){const truth={...newBuild('garchomp'),item:'lifeorb',nature:'Jolly',sp:[0,12,0,0,0,0]};const r=calcDamage({build:truth,cond:condOf(b,'opp',0)},{build:b.my[0],cond:condOf(b,'me',0)},'earthquake');addAct(b,{side:'opp',mon:0,type:'move',move:'earthquake',hpAfter:(r.defMaxHP-r.rolls[0])/r.defMaxHP*100,exact:true,sameTurn:true,...extra});}
test('技の後のいのちのたま判明で、反動と攻撃推定を直前の技から計算し直す',()=>{
 const b=setup();attack(b);const before=clone(b),mask=b.opp[0].statOk.atk;assert.equal(condOf(b,'opp',0).hp,100);assert.ok(confirmItem(b,{mon:0,item:'lifeorb'}));assert.equal(b.opp[0].item,'lifeorb');assert.ok(condOf(b,'opp',0).hp>89&&condOf(b,'opp',0).hp<91);assert.notEqual(b.opp[0].statOk.atk,mask);assert.equal(b.opp[0].statOk.atk[comboOf(1,12)],'1');assert.ok(b.turns[0].acts[0].selfFx.includes('lifeorb'));const hp=condOf(b,'opp',0).hp;replay(b);assert.equal(condOf(b,'opp',0).hp,hp);assert.ok(undoLast(b));assert.equal(b.opp[0].item,'');assert.equal(condOf(b,'opp',0).hp,100);assert.equal(b.opp[0].statOk.atk,before.opp[0].statOk.atk);
});
test('判明を繰り返しても二重反動にせず、実測済みの行動後HPを優先する',()=>{for(const observed of [false,true]){const b=setup();attack(b,observed?{observedHp:[{side:'opp',mon:0,hpAfter:88}]}:{});confirmItem(b,{mon:0,item:'lifeorb'});const hp=condOf(b,'opp',0).hp;confirmItem(b,{mon:0,item:'lifeorb'});assert.equal(condOf(b,'opp',0).hp,hp);if(observed)assert.equal(hp,88);assert.equal(b.turns[0].acts[0].selfFx.filter(x=>x==='lifeorb').length,1);}});
test('マジックガード・ちからずく適用技・外し・まもるでは反動を足さない',()=>{
 for(const [species,ability,move,flags] of [['alakazam','magicguard','energyball',{}],['feraligatr','sheerforce','icepunch',{}],['garchomp','roughskin','earthquake',{miss:true}],['garchomp','roughskin','earthquake',{protect:true}]]){const b=setup(species,ability);addAct(b,{side:'opp',mon:0,type:'move',move,hpAfter:80,sameTurn:true,...flags});confirmItem(b,{mon:0,item:'lifeorb'});assert.equal(condOf(b,'opp',0).hp,100,ability);}
});
test('トリック後に分かった持ち物を、入れ替え前までさかのぼって適用しない',()=>{const b=setup();condOf(b,'opp',0).tricked=true;attack(b);confirmItem(b,{mon:0,item:'lifeorb'});assert.equal(condOf(b,'opp',0).hp,100);assert.equal(b.opp[0].item,'lifeorb');});
test('技の後に分かったゴツゴツメットも接触側へ反映し、非接触では減らさない',()=>{for(const move of ['bodyslam','earthquake']){const b=setup('snorlax','thickfat');addAct(b,{side:'me',mon:0,type:'move',move,hpAfter:70,sameTurn:true});confirmItem(b,{mon:0,item:'rockyhelmet'});assert.equal(condOf(b,'me',0).hp<100,move==='bodyslam');}});
test('旧版でログなしに設定したいのちのたまも、再計算で推定と反動へ反映する',()=>{const b=setup();attack(b);const before=b.opp[0].statOk.atk;b.opp[0].item='lifeorb';replay(b);assert.notEqual(b.opp[0].statOk.atk,before);assert.ok(condOf(b,'opp',0).hp<91);});
