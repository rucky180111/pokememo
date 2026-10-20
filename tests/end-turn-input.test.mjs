import test from 'node:test';
import assert from 'node:assert/strict';
import {dex,statsOf} from '../src/engine/dex.js';
import {newBattle,newTeam,newOpp,normalizeBattle,sendOut,condOf,setHP,clone} from '../src/engine/battle.js';
import {addAct,finishTurn,residualCandidates,replay,editAct,actLine} from '../src/engine/flow.js';
import {inferSpeeds} from '../src/engine/infer.js';
const B=(species,o={})=>({species,ability:dex.species[species].ab[0],nature:'Serious',sp:[0,0,0,0,0,0],item:'',moves:[],...o});
function battle(mine=B('snorlax'),opp=B('snorlax')){const t=newTeam();t.mons=[mine];const b=newBattle({team:t});b.opp=[{...newOpp(opp.species),...opp}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;}
const cant=(b,side='me')=>addAct(b,{side,mon:0,type:'move',cant:true,sameTurn:true});
test('技不明の行動不能: 眠りを数え、技やPPを捏造しない。再生・取り消しも可能',()=>{const b=battle();condOf(b,'opp',0).status='slp';cant(b,'opp');const a=b.turns[0].acts[0];assert.equal(a.move,'');assert.equal(a.pp,undefined);assert.deepEqual(b.opp[0].moves,[]);assert.equal(condOf(b,'opp',0).statusCant,1);assert.match(actLine(b,a),/行動できず/);replay(b);assert.equal(condOf(b,'opp',0).statusCant,1);editAct(b,0,0,null);assert.equal(condOf(b,'opp',0).statusCant||0,0);});
test('未確認のHPが満タンのままでもグラス回復候補を隠さない',()=>{const b=battle();b.state.field.terrain='Grassy';condOf(b,'me',0).hpUnknown=true;cant(b);const c=residualCandidates(b).find(r=>r.side==='me'&&r.key==='grassy');assert.ok(c?.checked);});
for(const tr of [false,true])test(`定数処理順の推定: トリックルーム${tr?'あり':'なし'}でも速い順・同速は残す`,()=>{const b=battle(B('snorlax',{sp:[0,0,0,0,0,20]}),B('snorlax',{item:'leftovers'}));b.state.field.trickRoom=tr;cant(b);cant(b,'opp');const expected=clone(b);inferSpeeds(expected,{acts:[{side:'opp',mon:0,type:'move',move:'bodyslam',flags:{}},{side:'me',mon:0,type:'move',move:'bodyslam',flags:{}}]},{residual:true});const logs=finishTurn(b,null,{resFirst:'opp'});assert.ok(b.opp[0].speOk);assert.deepEqual(b.opp[0].speOk,expected.opp[0].speOk);assert.match(logs.join(' '),/処理の順番/);const mask=b.opp[0].speOk;replay(b);assert.deepEqual(b.opp[0].speOk,mask);});
test('処理順はかそく発動前の能力で比較する',()=>{const b=battle(B('snorlax',{sp:[0,0,0,0,0,20]}),B('snorlax',{ability:'speedboost',item:'leftovers'}));cant(b);cant(b,'opp');const e=clone(b);inferSpeeds(e,{acts:[{type:'move',side:'opp',mon:0,move:'bodyslam',flags:{}},{type:'move',side:'me',mon:0,move:'bodyslam',flags:{}}]},{residual:true});finishTurn(b,null,{resFirst:'opp'});assert.deepEqual(b.opp[0].speOk,e.opp[0].speOk);assert.equal(condOf(b,'opp',0).boosts.spe,1);});
test('終了後HPから見逃した被ダメージを逆算し、回復を二重に加えない',()=>{const b=battle(B('snorlax',{item:'leftovers'}));b.state.field.terrain='Grassy';const mx=statsOf('snorlax',b.my[0].sp,'Serious')[0],heal=2*Math.floor(mx/16),final=80;addAct(b,{side:'opp',mon:0,type:'move',move:'bodyslam',hpUnknown:true,endHp:{side:'me',mon:0,hpAfter:final/mx*100},sameTurn:true});cant(b);finishTurn(b,null,{residual:residualCandidates(b).filter(r=>r.checked)});assert.ok(Math.abs(b.turns[0].acts[0].hpAfter-(final-heal)/mx*100)<1e-8);assert.equal(Math.round(condOf(b,'me',0).hp*mx/100),final);const hp=condOf(b,'me',0).hp;replay(b);assert.equal(condOf(b,'me',0).hp,hp);});
test('回復が満タンで頭打ちなら攻撃直後HPを決めつけない',()=>{const b=battle(B('snorlax',{item:'leftovers'}));addAct(b,{side:'opp',mon:0,type:'move',move:'bodyslam',hpUnknown:true,endHp:{side:'me',mon:0,hpAfter:100},sameTurn:true});cant(b);finishTurn(b,null,{residual:residualCandidates(b).filter(r=>r.checked)});assert.equal(b.turns[0].acts[0].hpAfter,undefined);assert.equal(condOf(b,'me',0).hp,100);assert.ok(!condOf(b,'me',0).hpUnknown);});
test('すなあらし→グラス回復で最終HPが同じでも途中の実測からHP候補を絞る',()=>{const b=battle();b.state.field.weather='Sand';b.state.field.terrain='Grassy';setHP(b,'opp',0,22);cant(b);cant(b,'opp');finishTurn(b,null,{residual:[{side:'opp',mon:0,key:'sand',hpAfter:17},{side:'opp',mon:0,key:'grassy',hpAfter:22}]});const m=b.opp[0].statOk?.hp;assert.ok(m?.includes('0'));assert.equal(m[0],'1','最大HP235の真の候補を残す');assert.equal(condOf(b,'opp',0).hp,22);replay(b);assert.equal(b.opp[0].statOk.hp,m);});

// 相手のHP候補ごとに回復の切り捨てを戻し、仮定した最大HPで真の配分を除外しない。
for(const [h,def,nature,mod] of [[0,0,'Serious',1],[3,16,'Bold',1.1],[15,32,'Hasty',0.9],[32,16,'Serious',1]])test(`回復込みの与ダメージ逆算: HP Pt${h}・防御${def}・${nature}`,async()=>{
 const {calcDamage}=await import('../src/engine/calc.js');const {comboOf}=await import('../src/engine/assume.js');
 const b=battle(B('snorlax'),B('garchomp',{item:'leftovers'}));b.state.field.terrain='Grassy';
 const real=B('garchomp',{item:'leftovers',sp:[h,0,def,0,0,0],nature});const mx=statsOf('garchomp',real.sp,nature)[0];const r=calcDamage({build:b.my[0],cond:condOf(b,'me',0)},{build:real,cond:condOf(b,'opp',0)},'bodyslam',{field:b.state.field});
 const after=Math.floor(Math.min(mx,mx-r.min+2*Math.floor(mx/16))*100/mx);
 addAct(b,{side:'me',mon:0,type:'move',move:'bodyslam',hpUnknown:true,endHp:{side:'opp',mon:0,hpAfter:after},sameTurn:true});cant(b,'opp');
 finishTurn(b,null,{residual:residualCandidates(b).filter(x=>x.checked)});const mask=b.opp[0].statOk?.def;assert.ok(mask);assert.equal(mask[h*99+comboOf(mod,def)],'1');assert.equal(condOf(b,'opp',0).hp,after);replay(b);assert.equal(b.opp[0].statOk.def,mask);
});

test('途中で回復が満タンになってから定数ダメージを受けた場合も逆算を決めつけない',()=>{
 const b=battle(B('snorlax',{item:'leftovers'}));condOf(b,'me',0).status='psn';const mx=235,final=mx-Math.floor(mx/8);
 addAct(b,{side:'opp',mon:0,type:'move',move:'bodyslam',hpUnknown:true,endHp:{side:'me',mon:0,hpAfter:final/mx*100},sameTurn:true});cant(b);
 finishTurn(b,null,{residual:[{side:'me',mon:0,key:'leftovers'},{side:'me',mon:0,key:'psn'}]});assert.equal(b.turns[0].acts[0].hpAfter,undefined);assert.equal(Math.round(condOf(b,'me',0).hp*mx/100),final);
});
test('残HPより大きな定数ダメージもクリップせず戻す',()=>{
 const b=battle();condOf(b,'me',0).status='psn';const mx=235;
 addAct(b,{side:'opp',mon:0,type:'move',move:'bodyslam',hpUnknown:true,endHp:{side:'me',mon:0,hpAfter:10/mx*100},sameTurn:true});cant(b);
 finishTurn(b,null,{residual:[{side:'me',mon:0,key:'psn'}]});assert.equal(Math.round(b.turns[0].acts[0].hpAfter*mx/100),39);assert.equal(Math.round(condOf(b,'me',0).hp*mx/100),10);
});
