import test from 'node:test';
import assert from 'node:assert/strict';
import {dex} from '../src/engine/dex.js';
import {newBattle, newTeam, newOpp, normalizeBattle, sendOut, condOf, setHP, maxHPOf, applyBoosts, setTerrain} from '../src/engine/battle.js';
import {addAct, addEvent, endTurn, replay} from '../src/engine/flow.js';
import effects from '../src/generated/move-effects.json' with {type: 'json'};
import audit from '../audit/mechanics-catalog.json' with {type: 'json'};
const B = (species, extra = {}) => ({species, ability: '', item: '', nature: 'Serious', sp: [0,0,0,0,0,0], moves: [], ...extra});
function battle(mine = [B('snorlax')], foes = [B('garchomp')], double = false) {
  for (const bd of [...mine, ...foes]) assert.ok(dex.species[bd.species], `テスト用の種族: ${bd.species}`);
  const team = newTeam(); team.mons = mine;
  const b = normalizeBattle(newBattle({team, format: double ? 'double' : 'single'}));
  b.opp = foes.map(x => Object.assign(newOpp(x.species), x)); normalizeBattle(b);
  sendOut(b,'me',0,0); sendOut(b,'opp',0,0);
  if(double){sendOut(b,'me',1,1); sendOut(b,'opp',1,1);}
  return b;
}
const move = (b,id,extra={}) => addAct(b,{side:'me',mon:0,type:'move',move:id,sameTurn:true,...extra});
const hp = (b,side='me',i=0) => Math.round(condOf(b,side,i).hp * maxHPOf(b,side,i)/100);

test('ちからをすいとる: 攻撃ランクを下げ、回復量は自動計算しない',()=>{
 const b=battle([B('garchomp',{sp:[0,32,0,0,0,0],nature:'Adamant',item:'choiceband',ability:'hugepower'})],[B('snorlax')]);
 setHP(b,'opp',0,10);condOf(b,'me',0).boosts.atk=2;
 move(b,'strengthsap',{side:'opp'});
 assert.equal(condOf(b,'me',0).boosts.atk,1);assert.equal(condOf(b,'opp',0).hp,10);assert.ok(condOf(b,'opp',0).hpUnknown);
});
test('ちからをすいとる: 入力した行動後HPを採用し、再生でも維持',()=>{
 const b=battle();setHP(b,'me',0,10);
 move(b,'strengthsap',{observedHp:[{side:'me',mon:0,hpAfter:75}]});
 assert.equal(condOf(b,'me',0).hp,75);assert.equal(condOf(b,'opp',0).boosts.atk,-1);assert.ok(!condOf(b,'me',0).hpUnknown);
 replay(b);assert.equal(condOf(b,'me',0).hp,75);
});
for(const failure of ['miss','protect','cant','healBlock','minimum']) test(`ちからをすいとる: ${failure}で回復しない`,()=>{
 const b=battle();setHP(b,'me',0,10);const before=hp(b);
 if(failure==='healBlock')condOf(b,'me',0).healBlock=1;
 if(failure==='minimum')condOf(b,'opp',0).boosts.atk=-6;
 move(b,'strengthsap', ['miss','protect','cant'].includes(failure)?{[failure]:true}:{});
 assert.equal(hp(b),before); assert.equal(condOf(b,'opp',0).boosts.atk,failure==='minimum'?-6:0);
});
for(const ability of ['contrary','defiant','hypercutter','clearbody']) test(`ちからをすいとる: ${ability}で攻撃低下を処理し、回復は未確認`,()=>{
 const b=battle(undefined,[B('garchomp',{ability})]);setHP(b,'me',0,10); const before=hp(b);
 move(b,'strengthsap');assert.equal(hp(b),before);assert.ok(condOf(b,'me',0).hpUnknown);
 assert.equal(condOf(b,'opp',0).boosts.atk,{contrary:1,defiant:1,hypercutter:0,clearbody:0}[ability]);
});
test('ちからをすいとる: おおきなねっこ・ヘドロえき・マジックガード',()=>{
 for(const ooze of [false,true]){
  const b=battle([B('snorlax',{item:'bigroot'})],[B('garchomp',{ability:ooze?'liquidooze':''})]);
  setHP(b,'me',0,90); const before=hp(b);move(b,'strengthsap');
  assert.equal(hp(b),before);assert.ok(condOf(b,'me',0).hpUnknown);
 }
 const b=battle([B('snorlax',{ability:'magicguard'})],[B('garchomp',{ability:'liquidooze'})]);setHP(b,'me',0,80);const before=hp(b);move(b,'strengthsap');assert.equal(hp(b),before);
});
test('ちからをすいとる: マジックミラー・そうしょく・おうごんのからだ',()=>{
 const b=battle([B('garchomp')],[B('snorlax',{ability:'magicbounce'})]);setHP(b,'opp',0,10); move(b,'strengthsap');assert.equal(condOf(b,'me',0).boosts.atk,-1);assert.equal(condOf(b,'opp',0).hp,10);assert.ok(condOf(b,'opp',0).hpUnknown);
 for(const ability of ['sapsipper','goodasgold']) {const b=battle(undefined,[B('garchomp',{ability})]);setHP(b,'me',0,10);const before=hp(b);move(b,'strengthsap');assert.equal(hp(b),before);assert.equal(condOf(b,'opp',0).boosts.atk,ability==='sapsipper'?1:0);}
});
for(const [ability,id] of [['waterabsorb','surf'],['dryskin','surf'],['voltabsorb','thunderbolt'],['eartheater','earthquake']]) test(`${ability}: 回復し、攻撃のHP入力・追加効果を適用しない`,()=>{
 const b=battle(undefined,[B('garchomp',{ability})]);setHP(b,'opp',0,50);move(b,id,{hpAfter:20,secFx:[{bo:{spd:-1}}]});assert.equal(condOf(b,'opp',0).hp,75);assert.equal(condOf(b,'opp',0).boosts.spd,0);
});
test('吸収特性: 回復封じ・かたやぶり・未判明特性',()=>{
 const b=battle(undefined,[B('garchomp',{ability:'waterabsorb'})]);setHP(b,'opp',0,50);condOf(b,'opp',0).healBlock=1;move(b,'surf',{hpAfter:20});assert.equal(condOf(b,'opp',0).hp,50);
 const b2=battle([B('garchomp',{ability:'moldbreaker'})],[B('garchomp',{ability:'waterabsorb'})]);move(b2,'surf',{hpAfter:30});assert.equal(condOf(b2,'opp',0).hp,30);
});
test('いのちのしずく・とおぼえ: 自分と味方全員、相手は対象外',()=>{
 const b=battle([B('clefable'),B('garchomp')],[B('garchomp'),B('clefable')],true);
 setHP(b,'me',0,20);setHP(b,'me',1,50);const before=[hp(b,'me',0),hp(b,'me',1)];move(b,'lifedew');
 for(let i=0;i<2;i++)assert.equal(hp(b,'me',i),before[i]+Math.floor(maxHPOf(b,'me',i)/4));
 assert.equal(condOf(b,'opp',0).hp,100);move(b,'howl');assert.equal(condOf(b,'me',0).boosts.atk,1);assert.equal(condOf(b,'me',1).boosts.atk,1);assert.equal(condOf(b,'opp',0).boosts.atk,0);
});
for(const [id,changes] of [['coaching',{atk:1,def:1}],['aromaticmist',{spd:1}],['decorate',{atk:2,spa:2}]]) test(`${id}: 指定した味方のランクを変更`,()=>{
 const b=battle([B('clefable'),B('garchomp')],[B('garchomp'),B('clefable')],true);move(b,id,{target:{side:'me',mon:1}});
 for(const [k,n] of Object.entries(changes))assert.equal(condOf(b,'me',1).boosts[k],n);
 assert.equal(condOf(b,'me',0).boosts.atk,0);assert.equal(condOf(b,'opp',0).boosts.atk,0);
});
test('いやしのはどう: 味方を回復、メガランチャーで3/4、回復封じを尊重',()=>{
 for(const ability of ['', 'megalauncher']) {const b=battle([B('clefable',{ability}),B('garchomp')],[B('garchomp'),B('clefable')],true);setHP(b,'me',1,10);const before=hp(b,'me',1);move(b,'healpulse',{target:{side:'me',mon:1}});assert.equal(hp(b,'me',1),before+Math.floor(maxHPOf(b,'me',1)*(ability?0.75:0.5)));}
});
for(const id of ['bellydrum','filletaway','clangoroussoul'])test(`${id}: HP不足で能力もHPも変化しない`,()=>{
 const b=battle();setHP(b,'me',0,10);const before=hp(b);move(b,id);assert.equal(hp(b),before);assert.deepEqual(condOf(b,'me',0).boosts,{atk:0,def:0,spa:0,spd:0,spe:0});
});
test('スキルスワップ・なかまづくり・いえきはnull/空文字定義でも処理',()=>{
 const b=battle([B('garchomp',{ability:'roughskin'})],[B('clefable',{ability:'magicguard'})]);
 move(b,'skillswap');assert.equal(condOf(b,'me',0).abilityChanged,'magicguard');assert.equal(condOf(b,'opp',0).abilityChanged,'roughskin');
 move(b,'entrainment');assert.equal(condOf(b,'opp',0).abilityChanged,'magicguard');move(b,'gastroacid');assert.equal(condOf(b,'opp',0).abilityChanged,'');
});
for(const [item,ability,amount] of [['sitrusberry','',43],['sitrusberry','ripen',86],['oranberry','',10],['oranberry','ripen',20],['oranberry','cheekpouch',68]])test(`${item}/${ability}: 消費イベントの回復を実数で反映`,()=>{
 const b=battle([B('azumarill',{item,ability})]);setHP(b,'me',0,10);const before=hp(b);addEvent(b,{kind:'item',side:'me',mon:0,item,consumed:true});assert.equal(hp(b),before+amount);assert.ok(condOf(b,'me',0).itemGone);
});
test('ラムのみ・ほおぶくろ・きんちょうかん・ぶきよう',()=>{
 const b=battle([B('azumarill',{item:'lumberry',ability:'cheekpouch'})]);setHP(b,'me',0,10);const before=hp(b);addEvent(b,{kind:'status',side:'me',mon:0,status:'brn'});assert.equal(condOf(b,'me',0).status,'');assert.equal(hp(b),before+58);
 for(const block of ['unnerve','klutz']) {const b=battle([B('azumarill',{item:'lumberry',ability:block==='klutz'?'klutz':''})],[B('garchomp',{ability:block==='unnerve'?'unnerve':''})]);addEvent(b,{kind:'status',side:'me',mon:0,status:'brn'});assert.equal(condOf(b,'me',0).status,'brn');assert.ok(!condOf(b,'me',0).itemGone);}
});
test('はんすう: 次のターン終了時に一度だけ再発動、交代で消える',()=>{
 const b=battle([B('azumarill',{ability:'cudchew',item:'oranberry'}),B('clefable')]);setHP(b,'me',0,10);const before=hp(b);
 addEvent(b,{kind:'item',side:'me',mon:0,item:'oranberry',consumed:true});endTurn(b,null,{incomplete:true});assert.equal(hp(b),before+10);
 move(b,'splash');endTurn(b,null,{incomplete:true});assert.equal(hp(b),before+20);move(b,'splash');endTurn(b,null,{incomplete:true});assert.equal(hp(b),before+20);
});
test('しろいハーブ・びんじょう: 実際に起きたランク変化だけを反映',()=>{
 const b=battle([B('garchomp',{item:'whiteherb'})],[B('clefable',{ability:'opportunist'})]);move(b,'shellsmash');assert.equal(condOf(b,'me',0).boosts.def,0);assert.equal(condOf(b,'me',0).boosts.atk,2);assert.ok(condOf(b,'me',0).itemGone);
 condOf(b,'opp',0).boosts.atk=0;condOf(b,'me',0).boosts.atk=6;applyBoosts(b,'me',0,{atk:2});assert.equal(condOf(b,'opp',0).boosts.atk,0);
 condOf(b,'me',0).boosts.atk=5;applyBoosts(b,'me',0,{atk:2});assert.equal(condOf(b,'opp',0).boosts.atk,1);
});
for(const [terrain,item,key] of [['Electric','electricseed','def'],['Grassy','grassyseed','def'],['Misty','mistyseed','spd'],['Psychic','psychicseed','spd']])test(`${item}: フィールド発動時と交代時の消費`,()=>{
 const b=battle([B('garchomp',{item}),B('clefable',{item})]);setTerrain(b,terrain);assert.equal(condOf(b,'me',0).boosts[key],1);assert.ok(condOf(b,'me',0).itemGone);sendOut(b,'me',0,1);assert.equal(condOf(b,'me',1).boosts[key],1);
});
test('おもてなし・きみょうなくすり: 登場時に隣の味方へ反映',()=>{
 const b=battle([B('garchomp'),B('clefable',{ability:'hospitality'}),B('clefable',{ability:'curiousmedicine'})],[B('garchomp')]);setHP(b,'me',0,30);const before=hp(b);sendOut(b,'me',1,1);assert.equal(hp(b),before+Math.floor(maxHPOf(b,'me',0)/4));condOf(b,'me',0).boosts.atk=2;sendOut(b,'me',1,2);assert.equal(condOf(b,'me',0).boosts.atk,0);
});
test('技メタデータ: 現行カタログとの整合性、全回復・吸収・反動の定義',()=>{
 for(const category of ['moves','abilities','items']) {
  assert.deepEqual(Object.keys(audit.catalog[category]),Object.keys(dex[category]));
  for(const entry of Object.values(audit.catalog[category])) assert.ok(entry.reference&&entry.calculatorEntry);
 }
 for(const id of Object.keys(effects))assert.ok(dex.moves[id],id);
 assert.deepEqual(effects.lifedew.heal,[1,4]);assert.deepEqual(effects.gigadrain.drain,[1,2]);assert.deepEqual(effects.wavecrash.recoil,[33,100]);assert.ok(effects.strengthsap.healing&&effects.strengthsap.reflectable);
});
for(const id of ['highjumpkick','axekick','supercellslam','steelbeam']) for(const failure of ['miss','protect','cant'])test(`${id}: ${failure}の失敗ダメージ`,()=>{
 const b=battle();const before=hp(b);move(b,id,{[failure]:true});assert.equal(hp(b),failure==='cant'?before:before-(id==='steelbeam'?Math.round(maxHPOf(b,'me',0)/2):Math.floor(maxHPOf(b,'me',0)/2)));
});
test('かふんだんご: 味方を半分回復、回復封じでは失敗',()=>{
 const b=battle([B('clefable'),B('garchomp')],[B('garchomp'),B('clefable')],true);setHP(b,'me',1,10);const before=hp(b,'me',1);move(b,'pollenpuff',{target:{side:'me',mon:1}});assert.equal(hp(b,'me',1),before+Math.floor(maxHPOf(b,'me',1)/2));
 condOf(b,'me',0).healBlock=1;const after=hp(b,'me',1);move(b,'pollenpuff',{target:{side:'me',mon:1}});assert.equal(hp(b,'me',1),after);
});
for(const layers of [0,1,2,3])test(`のみこむ: たくわえる${layers}回に応じた回復とランク解除`,()=>{
 const b=battle();for(let i=0;i<layers;i++)move(b,'stockpile');setHP(b,'me',0,10);const before=hp(b);move(b,'swallow');assert.equal(hp(b),Math.min(maxHPOf(b,'me',0),before+Math.floor(maxHPOf(b,'me',0)*[0,0.25,0.5,1][layers])));assert.equal(condOf(b,'me',0).boosts.def,0);assert.equal(condOf(b,'me',0).stockpile||0,0);
});
for(const [id,m] of Object.entries(effects).filter(([id,m])=>m.heal&&dex.moves[id].tg==='self'))test(`${id}: データに定義された回復量・行動不能`,()=>{
 const b=battle();setHP(b,'me',0,10);const before=hp(b);move(b,id,{cant:true});assert.equal(hp(b),before);move(b,id);assert.equal(hp(b),Math.min(maxHPOf(b,'me',0),before+Math.floor(maxHPOf(b,'me',0)*m.heal[0]/m.heal[1])));
});
for(const [id,m] of Object.entries(effects).filter(([,m])=>m.drain||m.recoil))test(`${id}: 変動する吸収・反動は入力したHPで記録`,()=>{
 const b=battle([B('snorlax')],[B('snorlax')]);setHP(b,'me',0,50);const before=hp(b);
 move(b,id,{hpAfter:50,selfFx:[m.drain?'drain':'recoil']});assert.equal(hp(b),before);assert.ok(condOf(b,'me',0).hpUnknown);move(b,id,{hpAfter:25,selfFx:[m.drain?'drain':'recoil'],observedHp:[{side:'me',mon:0,hpAfter:60}]});assert.equal(condOf(b,'me',0).hp,60);assert.ok(!condOf(b,'me',0).hpUnknown);
});
test('吸収: 相手のオボン回復があっても入力した行動後HPをそのまま採用',()=>{
 const b=battle();setHP(b,'me',0,20);
 move(b,'gigadrain',{hpAfter:75,defItem:{item:'sitrusberry',consumed:true},selfFx:['drain'],observedHp:[{side:'me',mon:0,hpAfter:70}]});assert.equal(condOf(b,'me',0).hp,70);
});
test('吸収: ヘドロえきの変動ダメージも未確認で保持、マジックガードでは減らない',()=>{
 for(const ability of ['', 'magicguard']){const b=battle([B('snorlax',{ability,item:'bigroot'})],[B('garchomp',{ability:'liquidooze'})]);setHP(b,'me',0,90);const before=hp(b);move(b,'gigadrain',{hpAfter:50,selfFx:['ooze']});assert.equal(hp(b),before);assert.equal(!!condOf(b,'me',0).hpUnknown,!ability);}
});
