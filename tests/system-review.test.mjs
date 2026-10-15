import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createStore, memoryBackend} from '../src/store.js';
import {dex} from '../src/engine/dex.js';
import {newBattle,newTeam,newOpp,normalizeBattle,sendOut,condOf,setHP,clone,maxHPOf} from '../src/engine/battle.js';
import {addAct,replay,hazardDamage,residualCandidates} from '../src/engine/flow.js';
import {calcDamage,newCond,turnOrder,movePriority} from '../src/engine/calc.js';
import {boardContext} from '../src/engine/board.js';
import {inferFromTaken} from '../src/engine/infer-dmg.js';
import {estimateStats} from '../src/engine/estimate.js';
import {comboOf} from '../src/engine/assume.js';
import {matchupActions,myActions,realBattles,teamAnalysis} from '../src/engine/predict.js';
const build=(species,o={})=>({species,ability:dex.species[species].ab[0],item:'',nature:'Serious',sp:[0,0,0,0,0,0],moves:[],...o});
const mon=(species,o={})=>({build:build(species,o),cond:newCond()});
function battle(mine=build('snorlax'),opp=build('snorlax')){
 const team=newTeam();team.mons=[mine];const b=newBattle({team});b.opp=[{...newOpp(opp.species),...opp}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;
}
const move=(b,id,o={})=>addAct(b,{type:'move',side:'me',mon:0,move:id,sameTurn:true,...o});
for(const [id,foe,ability] of [['thunderbolt','garchomp','stamina'],['shadowball','snorlax','weakarmor'],['earthquake','rotomwash','levitate']])test(`無効な${id}でHP・被弾回数・追加効果を動かさない`,()=>{
 const b=battle(build('snorlax'),build(foe,{ability}));move(b,id,{hpAfter:50,hpUnknown:true});const c=condOf(b,'opp',0);assert.equal(c.hp,100);assert.equal(c.timesAttacked||0,0);assert.equal(c.boosts.def,0);assert.ok(b.turns[0].acts[0].moveImmune);replay(b);assert.equal(condOf(b,'opp',0).hp,100);
});
test('きもったまの攻撃はゴーストにも通り、被弾効果が起きる',()=>{
 const b=battle(build('snorlax',{ability:'scrappy'}),build('gengar',{ability:'stamina'}));move(b,'bodypress',{hpAfter:50});assert.equal(condOf(b,'opp',0).hp,50);assert.equal(condOf(b,'opp',0).boosts.def,1);
});
for(const [item,ability,expected] of [['','',-1],['protectivepads','',0],['','longreach',0]])test(`接触防止 ${item||ability||'なし'} とぬめぬめ`,()=>{
 const b=battle(build('snorlax',{item,ability}),build('goodra',{ability:'gooey'}));move(b,'bodyslam',{hpAfter:90});assert.equal(condOf(b,'me',0).boosts.spe,expected);
});
for(const ability of ['stamina','weakarmor'])test(`連続技3回の ${ability} をヒット数分反映`,()=>{
 const b=battle(build('snorlax'),build('snorlax',{ability}));move(b,'bulletseed',{hits:3,hpAfter:70});assert.equal(condOf(b,'opp',0).boosts.def,ability==='stamina'?3:-3);if(ability==='weakarmor')assert.equal(condOf(b,'opp',0).boosts.spe,6);
});
test('瀕死のポケモンの行動を二重に記録しない',()=>{
 const b=battle();setHP(b,'me',0,0);const before=clone(b);assert.match(move(b,'bodyslam')[0],/ひんし/);assert.deepEqual(b,before);
});
test('固定ダメージ: がんじょうはかたやぶりで無視、ふうせんはじゅうりょくで無視',()=>{
 const a=mon('garchomp'),d=mon('snorlax',{ability:'sturdy'});assert.ok(calcDamage(a,d,'fissure').immune);a.build.ability='moldbreaker';assert.ok(!calcDamage(a,d,'fissure').immune);
 d.build.ability='';d.build.item='airballoon';assert.ok(calcDamage(a,d,'fissure').immune);assert.ok(!calcDamage(a,d,'fissure',{field:{gravity:true}}).immune);
});
test('固定ダメージ: きもったまのいかりのまえばはゴーストにも通る',()=>{
 const a=mon('snorlax',{ability:'scrappy'}),d=mon('gengar');assert.ok(calcDamage(a,d,'superfang').min>0);
});
test('グラススライダーは非接地だと先制しない',()=>{
 const a=mon('snorlax',{moves:['grassyglide'],item:'airballoon'}),d=mon('garchomp');a.moveId='grassyglide';d.moveId='bodyslam';assert.equal(turnOrder(a,d,{field:{terrain:'Grassy'}}),'b');a.build.item='';assert.equal(turnOrder(a,d,{field:{terrain:'Grassy'}}),'a');
});
test('ヒーリングシフト: 吸収技・回復技だけ優先度+3',()=>{
 assert.equal(movePriority('gigadrain','triage'),3);assert.equal(movePriority('recover','triage'),3);assert.equal(movePriority('bodyslam','triage'),0);
});
for(const id of ['storedpower','powertrip'])test(`${id}: 観測済みランクから攻撃側の能力を逆算`,()=>{
 const b=battle(build('snorlax'),build('snorlax',{moves:[id],sp:[0,10,0,20,0,0]}));condOf(b,'opp',0).boosts.spe=2;const ctx=boardContext(b,null);const real={build:b.opp[0],cond:condOf(b,'opp',0)};const r=calcDamage(real,{build:b.my[0],cond:condOf(b,'me',0)},id);const inferred=inferFromTaken(ctx,0,0,id,r.min);assert.ok(inferred.count>0);assert.equal(inferred.mask[comboOf(1,id==='powertrip'?10:20)],'1');
});
test('対面統計: 行動不能を割合から除き、行動数と対戦数を区別',()=>{
 const b=battle();b.turns=[{n:1,acts:[{side:'opp',sp:'snorlax',type:'move',move:'bodyslam',vs:['snorlax'],flags:{cant:true}},{side:'opp',sp:'snorlax',type:'move',move:'recover',vs:['snorlax']}]},{n:2,acts:[{side:'opp',sp:'snorlax',type:'move',move:'bodyslam',vs:['snorlax']}]}];const a=matchupActions([b],'snorlax','snorlax');assert.equal(a.n,2);assert.equal(a.battles,1);assert.equal(a.cant,1);assert.equal(a.moves.bodyslam,1);assert.equal(a.turn1.n,1);
 b.turns[0].acts[0].side='me';assert.equal(myActions([b],'snorlax').n,0);
});
test('統計の期間・形式フィルターを全集計に適用',()=>{
 const a=battle(),b=battle();a.date='2026-01-01';b.date='2026-10-01';b.result='win';assert.deepEqual(realBattles([a,b],{since:'2026-09-01'}),[b]);assert.equal(teamAnalysis([a,b],{since:'2026-09-01'}).n,1);assert.equal(realBattles([a,b],{format:'double'}).length,0);
});
test('保存はスナップショットを順番どおり書き込み、次の値の変更に影響されない',async()=>{
 const backend=memoryBackend();const seen=[];let release;const gate=new Promise(r=>release=r);const set=backend.set;backend.set=async(k,v)=>{if(!seen.length){seen.push(v.memo);await gate;}else seen.push(v.memo);await set(k,v);};const store=createStore(backend);const b=battle();b.memo='first';const p=store.saveBattle(b);await Promise.resolve();b.memo='second';const q=store.saveBattle(b);b.memo='unsaved';release();await Promise.all([p,q]);await store.flush();assert.deepEqual(seen,['first','second']);assert.equal(backend._map.get(`battle:${b.id}`).memo,'second');
});
test('別レコードの保存成功で未保存エラーを消さない。同じレコードの再保存で解除',async()=>{
 const backend=memoryBackend();let fail=true;const set=backend.set;backend.set=async(k,v)=>{if(k.startsWith('battle:')&&fail)throw Error('容量不足');await set(k,v);};const s=createStore(backend),b=battle();await s.saveBattle(b);assert.match(s.state.saveError,/容量不足/);await s.saveTeam(newTeam());assert.match(s.state.saveError,/容量不足/);fail=false;await s.saveBattle(b);assert.equal(s.state.saveError,'');
});
test('データ消去は先行する保存の完了を待ち、古い書き込みを復活させない',async()=>{
 const backend=memoryBackend();const set=backend.set;let release;const gate=new Promise(r=>release=r);backend.set=async(k,v)=>{await gate;await set(k,v);};const s=createStore(backend);const p=s.saveBattle(battle()),q=s.wipe();release();await Promise.all([p,q]);assert.equal((await backend.getAll()).length,0);
});

const usage=JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json',import.meta.url)));
test('未判明の特性を使用率から盤面に確定反映しない',()=>{
 const b=battle(build('gengar'),build('meowscarada'));b.opp[0].ability='';
 assert.equal(boardContext(b,usage).strictAbility(b,'opp',0),'');
 addAct(b,{type:'move',side:'opp',mon:0,move:'flowertrick',hpAfter:80},usage);
 assert.ok(!condOf(b,'opp',0).proteanUsed);assert.ok(!condOf(b,'opp',0).types);
 b.opp[0].ability='protean';addAct(b,{type:'move',side:'opp',mon:0,move:'flowertrick',hpAfter:60,sameTurn:true},usage);assert.deepEqual(condOf(b,'opp',0).types,['Grass']);
});
test('設置ダメージ: ステルスロックとまきびしを個別に切り捨てる',()=>{
 const b=battle(build('garchomp'));b.state.sides.me.sr=true;b.state.sides.me.spikes=1;
 const max=maxHPOf(b,'me',0);assert.equal(hazardDamage(b,'me',0).hp,Math.floor(max/16)+Math.floor(max/8));
});
test('じゅうりょくで飛行タイプもまきびしとグラス回復の対象',()=>{
 const b=battle(build('charizard'));b.state.sides.me.spikes=1;assert.equal(hazardDamage(b,'me',0),null);
 b.state.field.gravity=true;assert.ok(hazardDamage(b,'me',0).hp>0);b.state.field.terrain='Grassy';setHP(b,'me',0,50);assert.ok(residualCandidates(b,usage).some(r=>r.side==='me'&&r.key==='grassy'));
});
test('設置ダメージ: あつぞこブーツは無効、マジックルームでは効かない',()=>{
 const b=battle(build('snorlax',{item:'heavydutyboots'}));b.state.sides.me.sr=true;assert.equal(hazardDamage(b,'me',0),null);b.state.field.magicRoom=true;assert.ok(hazardDamage(b,'me',0).hp>0);
});
test('こんがりボディ: 炎を無効化し、防御+2。きんしのちからの攻撃は無視しない',()=>{
 const b=battle(build('snorlax',{ability:'myceliummight'}),build('snorlax',{ability:'wellbakedbody'}));move(b,'flamethrower',{hpAfter:10});assert.equal(condOf(b,'opp',0).hp,100);assert.equal(condOf(b,'opp',0).boosts.def,2);
});
test('保存失敗を再試行でき、失敗したバックアップの取り込みを成功扱いしない',async()=>{
 const backend=memoryBackend();const set=backend.set;let fail=true;backend.set=async(k,v)=>{if(fail)throw Error('容量不足');await set(k,v);};const store=createStore(backend);const b=battle();await store.saveBattle(b);fail=false;assert.equal(await store.retrySaves(),true);assert.equal(backend._map.get(`battle:${b.id}`).id,b.id);
 const t=newTeam();fail=true;await assert.rejects(store.importAll({app:'pokememo',teams:[t],battles:[]}),/容量不足/);assert.equal(store.team(t.id),null);fail=false;assert.equal(await store.importAll({app:'pokememo',teams:[t],battles:[]}),1);
});

test('素早さの実数値表はスカーフあり・なしの候補の和集合を表示',()=>{
 const b=battle();const mask=i=>'0'.repeat(i)+'1'+'0'.repeat(98-i);
 b.opp[0].speOk={plain:mask(comboOf(1,32)),scarf:mask(comboOf(1,0))};
 const row=estimateStats(b.opp[0],'snorlax').rows.find(r=>r.key==='spe');assert.equal(row.spLo,0);assert.equal(row.spHi,32);assert.ok(row.valLo<row.valHi);
});

test('持ち物の交換後: 元の消費済みの印で回復候補を隠さず、確実扱いもしない',()=>{
 const b=battle(build('snorlax',{item:'leftovers'}));setHP(b,'me',0,40);const c=condOf(b,'me',0);c.tricked=true;c.itemGone=true;
 const opts=residualCandidates(b,usage).filter(x=>x.side==='me'&&['leftovers','blacksludge'].includes(x.key));assert.equal(opts.length,2);assert.ok(opts.every(x=>!x.checked));
});
