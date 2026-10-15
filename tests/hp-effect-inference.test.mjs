import test from 'node:test';
import assert from 'node:assert/strict';
import {dex,statsOf,statValue} from '../src/engine/dex.js';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut,setHP,clone,condOf} from '../src/engine/battle.js';
import {addAct,addEvent,editAct,replay} from '../src/engine/flow.js';
import {estimateStats} from '../src/engine/estimate.js';
import {comboOf,comboMod,comboSP} from '../src/engine/assume.js';
import {applyHpConstraint,applyInference,spreadFits,inferFromDealt,inferFromTaken} from '../src/engine/infer-dmg.js';
import {inferHpEffects} from '../src/engine/infer-hp-effects.js';
import {calcDamage} from '../src/engine/calc.js';
import {boardContext} from '../src/engine/board.js';
const row=(b,k)=>estimateStats(b.opp[0],b.opp[0].species).rows.find(r=>r.key===k);
function battle(mine='snorlax',opp='garchomp'){
 const team=newTeam();team.mons=[{...newBuild(mine),ability:dex.species[mine].ab[0]}];const b=newBattle({team});b.opp=[newOpp(opp)];b.opp[0].ability=dex.species[opp].ab[0];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;
}
const me=b=>condOf(b,'me',0), opp=b=>condOf(b,'opp',0);
const max=b=>statsOf(b.my[0].species,b.my[0].sp,b.my[0].nature)[0];
const pct=(h,m)=>h/m*100;
const display=(h,m)=>h<=0?0:Math.max(1,Math.floor(h/m*100));
const measure=(side,hpAfter)=>({side,mon:0,hpAfter});
function sap(b,after,extra={}){return addAct(b,{side:'me',mon:0,type:'move',move:'strengthsap',sameTurn:true,observedHp:[measure('me',after)],...extra});}
function inferDirect(b,move,input,actorSide='me'){
 const before=clone(b.state),a={type:'move',side:actorSide,mon:0,move,target:{side:actorSide==='me'?'opp':'me',mon:0},flags:{},selfFx:input.selfFx},log=[];
 inferHpEffects(b,before,a,input,null,log);return log;
}

test('ちからをすいとる: 実測回復170から攻撃170を確定し、能力Ptの下限を表示',()=>{
 const b=battle();setHP(b,'me',0,pct(20,max(b)));const log=sap(b,pct(190,max(b)));
 assert.equal(row(b,'atk').valLo,170);assert.equal(row(b,'atk').valHi,170);assert.equal(row(b,'atk').spLo,5);
 assert.match(log.at(-1),/170（確定）/);assert.match(log.at(-1),/最低5/);assert.equal(me(b).hp,pct(190,max(b)));
 assert.equal(opp(b).boosts.atk,-1);
});
test('ちからをすいとる: 下がる前のランクで逆算、やけど・攻撃倍率の特性を含めない',()=>{
 const b=battle();b.opp[0].ability='hugepower';opp(b).status='brn';opp(b).boosts.atk=-1;setHP(b,'me',0,pct(20,max(b)));sap(b,pct(133,max(b)));
 assert.equal(row(b,'atk').valLo,170);assert.equal(row(b,'atk').valHi,170);assert.equal(opp(b).boosts.atk,-2);
});
test('ちからをすいとる: 満タンで頭打ちでも攻撃の下限・最低Ptを絞る',()=>{
 const b=battle();setHP(b,'me',0,pct(47,max(b)));const log=sap(b,100);
 assert.equal(row(b,'atk').valLo,188);assert.equal(row(b,'atk').spLo,21);assert.ok(row(b,'atk').valHi>188);assert.match(log.join(' '),/下限/);
});
test('ちからをすいとる: ねっこの倍率を戻して攻撃を推定',()=>{
 const b=battle();b.my[0].item='bigroot';setHP(b,'me',0,pct(1,max(b)));sap(b,pct(222,max(b)));
 assert.equal(row(b,'atk').valLo,170);assert.equal(row(b,'atk').valHi,170);
});
test('ちからをすいとる: ヘドロえきの実測ダメージからも攻撃を確定',()=>{
 const b=battle();b.opp[0].ability='liquidooze';setHP(b,'me',0,pct(210,max(b)));sap(b,pct(40,max(b)));
 assert.equal(row(b,'atk').valLo,170);assert.equal(row(b,'atk').valHi,170);
});
test('ちからをすいとる: 相手のHPは不明でも、使用者の回復量から攻撃を推定できる',()=>{
 const b=battle();opp(b).hpUnknown=true;setHP(b,'me',0,pct(20,max(b)));sap(b,pct(190,max(b)));assert.equal(row(b,'atk').valLo,170);
});
for(const reason of ['beforeUnknown','noMeasurement','miss','cant','protect','healBlock','minimum','transformed'])test(`ちからをすいとる: ${reason}では絞り込まない`,()=>{
 const b=battle();setHP(b,'me',0,pct(20,max(b)));
 if(reason==='beforeUnknown')me(b).hpUnknown=true;
 if(reason==='healBlock')me(b).healBlock=1;
 if(reason==='minimum')opp(b).boosts.atk=-6;
 if(reason==='transformed')opp(b).transformed={side:'me',mon:0};
 sap(b,pct(190,max(b)),reason==='noMeasurement'?{observedHp:[]}:['miss','cant','protect'].includes(reason)?{[reason]:true}:{});
 assert.ok(!b.opp[0].statOk?.atk);
});
test('ちからをすいとる: 複数観測・訂正・取り消しで絞り込みを再計算',()=>{
 const b=battle();setHP(b,'me',0,pct(20,max(b)));sap(b,pct(190,max(b)));const mask=b.opp[0].statOk.atk;
 replay(b);assert.equal(b.opp[0].statOk.atk,mask);
 editAct(b,0,0,{...b.turns[0].acts[0].in,observedHp:[measure('me',pct(200,max(b)))]});assert.equal(row(b,'atk').valLo,180);
 editAct(b,0,0,null);assert.ok(!b.opp[0].statOk?.atk);
});
test('ちからをすいとる: 相手が自分を吸収した場合は相手の最大HPを絞る',()=>{
 const b=battle('garchomp','snorlax');const trueHP=255;setHP(b,'opp',0,10);
 // 10%に対応するHP26から、攻撃150を吸収した後は69%表示。
 addAct(b,{side:'opp',mon:0,type:'move',move:'strengthsap',observedHp:[measure('opp',display(176,trueHP))]});
 assert.equal(b.opp[0].statOk.hp[20],'1');assert.ok(row(b,'hp').spLo>0);assert.ok(row(b,'hp').spHi<32);
});
test('いたみわけ: 両者の実測HPから最大HPを確定',()=>{
 const b=battle('garchomp','snorlax');setHP(b,'me',0,pct(40,max(b)));
 // (40 + 250) / 2 = 145。自分145HP、相手58%なら最大HP250だけが残る。
 addAct(b,{side:'me',mon:0,type:'move',move:'painsplit',observedHp:[measure('me',pct(145,max(b))),measure('opp',58)]});
 assert.equal(row(b,'hp').valLo,250);assert.equal(row(b,'hp').valHi,250);assert.equal(row(b,'hp').spLo,15);
});
for(const [move,fx,ratio] of [['bravebird','recoil',[33,100]],['gigadrain','drain',[1,2]],['drainingkiss','drain',[3,4]],['earthpower','shellbell',[1,8]]])test(`${move}/${fx}: 自分の実測変化から相手のHPポイントを絞る`,()=>{
 const b=battle('snorlax','garchomp'), trueHP=203,damage=100,ownMax=max(b),start=100;
 setHP(b,'me',0,pct(start,ownMax));const amount=fx==='shellbell'?Math.floor(damage/8):Math.round(damage*ratio[0]/ratio[1]);
 const after=fx==='recoil'?start-amount:start+amount;
 const logs=inferDirect(b,move,{hpAfter:display(trueHP-damage,trueHP),selfFx:[fx],observedHp:[measure('me',pct(after,ownMax))]});
 assert.equal(b.opp[0].statOk.hp[20],'1');assert.ok(row(b,'hp').spLo>0||row(b,'hp').spHi<32);assert.match(logs.join(' '),/HP/);assert.equal(me(b).hp,pct(start,ownMax),'逆算はHPを変更しない');
});
test('相手の反動: 自分が受けたダメージ実数と相手の%表示から最大HPを絞る',()=>{
 const b=battle(), trueHP=203, damage=100, recoil=33, mine=max(b);
 inferDirect(b,'bravebird',{hpAfter:pct(mine-damage,mine),selfFx:['recoil'],observedHp:[measure('opp',display(trueHP-recoil,trueHP))]},'opp');
 assert.equal(b.opp[0].statOk.hp[20],'1');assert.ok(row(b,'hp').spLo>0||row(b,'hp').spHi<32);
});
test('反動: ひんしで反動量が頭打ちでも実際の配分を除外しない',()=>{
 const b=battle(), trueHP=203;setHP(b,'me',0,pct(20,max(b)));
 inferDirect(b,'bravebird',{hpAfter:display(103,trueHP),selfFx:['recoil'],observedHp:[measure('me',0)]});
 assert.equal(b.opp[0].statOk?.hp?.[20]??'1','1');
});
test('吸収: 満タンでも回復量の下限として最大HPを絞る',()=>{
 const b=battle(), trueHP=203;setHP(b,'me',0,pct(max(b)-50,max(b)));
 inferDirect(b,'gigadrain',{hpAfter:display(103,trueHP),selfFx:['drain'],observedHp:[measure('me',100)]});
 assert.equal(b.opp[0].statOk.hp[20],'1');assert.ok(row(b,'hp').spLo>0);
});
test('反動といのちのたま: 固定ダメージを混ぜても本当のHPが残る',()=>{
 const b=battle(), trueHP=203,mine=max(b),after=mine-33-Math.floor(mine/10);
 inferDirect(b,'bravebird',{hpAfter:display(103,trueHP),selfFx:['recoil','lifeorb'],observedHp:[measure('me',pct(after,mine))]});
 assert.equal(b.opp[0].statOk.hp[20],'1');assert.ok(row(b,'hp').spHi<32);
});
test('とびだすなかみ: 実測ダメージと倒す前のHP割合から最大HPを絞る',()=>{
 const b=battle();setHP(b,'opp',0,50);const trueHP=203,damage=102,after=max(b)-damage;
 inferDirect(b,'tackle',{hpAfter:0,selfFx:['innards'],observedHp:[measure('me',pct(after,max(b)))]});
 assert.equal(b.opp[0].statOk.hp[20],'1');assert.ok(row(b,'hp').spLo>0);
});
test('実戦の反動: HPと耐久を連携して絞り、実際のHP×防御を残す',()=>{
 const b=battle('staraptor','snorlax');b.my[0].ability='reckless';b.my[0].sp=[0,32,0,0,0,0];
 const trueBuild={...newBuild('snorlax'),sp:[20,0,18,0,0,0],nature:'Serious',ability:'immunity',item:''};
 const result=calcDamage({build:b.my[0],cond:me(b)},{build:trueBuild,cond:opp(b)},'bravebird');
 const damage=result.min, trueHP=statsOf('snorlax',trueBuild.sp,trueBuild.nature)[0],after=display(trueHP-damage,trueHP),ownAfter=max(b)-Math.round(damage*33/100);
 const base=inferFromDealt(boardContext(b),0,0,'bravebird',100,after,{abilityUnknown:false,itemUnknown:true,tol:1});
 addAct(b,{side:'me',mon:0,type:'move',move:'bravebird',hpAfter:after,selfFx:['recoil'],observedHp:[measure('me',pct(ownAfter,max(b)))]});
 assert.equal(b.opp[0].statOk.hp[20],'1');assert.equal(b.opp[0].statOk.def[20*99+comboOf(1,18)],'1');
 assert.ok([...b.opp[0].statOk.def].filter(x=>x==='1').length<base.count,'HP割合だけより耐久候補が減る');
});
test('矛盾するHP観測は既存のHP×防御・特防の絞り込みを壊さない',()=>{
 const o=newOpp('garchomp');const pair='0'.repeat(12*99)+'1'.repeat(99)+'0'.repeat(20*99);o.statOk={def:pair};
 applyHpConstraint(o,h=>h===12);const saved=clone(o.statOk);const msg=applyHpConstraint(o,h=>h===13);assert.match(msg,/矛盾/);assert.deepEqual(o.statOk,saved);
 const mismatch='0'.repeat(13*99)+'1'.repeat(99)+'0'.repeat(19*99);applyInference(o,null,{stat:'spd',mask:mismatch,count:99,hpRange:[13,13],defRange:[1,1]});assert.deepEqual(o.statOk,saved);
 assert.ok(!spreadFits(o,'Serious',[13,0,0,0,0,0]));
});
test('ちからをすいとる: 全99通りの補正×Pt・ランク・ねっこ・満タンでも本当の攻撃を候補に残す',()=>{
 for(let combo=0;combo<99;combo++)for(const stage of [-2,0,2])for(const root of [1,5324/4096]){
  const b=battle(),raw=statValue(130,comboSP(combo),comboMod(combo),false);b.my[0].item=root===1?'':'bigroot';opp(b).boosts.atk=stage;setHP(b,'me',0,pct(1,max(b)));
  const stageAttack=Math.floor(stage>=0?raw*(2+stage)/2:raw*2/(2-stage));const amount=Math.max(1,Math.ceil(stageAttack*root-0.5));
  inferDirect(b,'strengthsap',{observedHp:[measure('me',pct(Math.min(max(b),1+amount),max(b)))]});
  assert.equal(b.opp[0].statOk?.atk?.[combo]??'1','1',`補正×Pt ${combo} ランク${stage} ねっこ${root}`);
 }
});
test('相手の反動: 全33通りのHPポイント・1%表示・途中のHPでも実際の配分を除外しない',()=>{
 for(let sp=0;sp<=32;sp++)for(const ratio of [1,0.75,0.01]){
  const b=battle(),trueMax=183+sp,start=Math.max(1,Math.floor(trueMax*ratio));setHP(b,'opp',0,display(start,trueMax));
  inferDirect(b,'bravebird',{hpAfter:pct(max(b)-100,max(b)),selfFx:['recoil'],observedHp:[measure('opp',display(Math.max(0,start-33),trueMax))]},'opp');
  assert.equal(b.opp[0].statOk?.hp?.[sp]??'1','1',`HP Pt${sp} 開始比率${ratio}`);
 }
});
test('相手の吸収: 未判明の持ち物にねっこが含まれていても本当のHPを残す',()=>{
 for(let sp=0;sp<=32;sp++)for(const root of [1,5324/4096]){
  const b=battle(),trueMax=183+sp,start=40;setHP(b,'opp',0,display(start,trueMax));
  const healed=Math.round(100/2*root);
  inferDirect(b,'gigadrain',{hpAfter:pct(max(b)-100,max(b)),selfFx:['drain'],observedHp:[measure('opp',display(start+healed,trueMax))]},'opp');
  assert.equal(b.opp[0].statOk?.hp?.[sp]??'1','1');
 }
});
test('相手の固定割合のHP消費: 攻撃対象のHPが未入力でも推定を保つ',()=>{
 const b=battle();setHP(b,'opp',0,75);inferDirect(b,'steelbeam',{selfFx:['recoil'],observedHp:[measure('opp',24)]},'opp');assert.ok(b.opp[0].statOk?.hp);
});
for(const reason of ['unknownSource','missingSource','berry','multiHit'])test(`反動: ${reason}を実測の証拠に混ぜない`,()=>{
 const b=battle();if(reason==='unknownSource')me(b).hpUnknown=true;
 inferDirect(b,'bravebird',{hpAfter:50,selfFx:['recoil'],observedHp:reason==='missingSource'?[]:[measure('me',80)],...(reason==='berry'?{defItem:{item:'sitrusberry'}}:{}),...(reason==='multiHit'?{hits:2}:{})});
 assert.ok(!b.opp[0].statOk?.hp);
});
test('吸収とねっこ: 奇数ダメージでは吸収量を丸めた後に倍率を掛ける',()=>{
 const b=battle();b.my[0].item='bigroot';setHP(b,'me',0,pct(100,max(b)));const trueHP=203;
 // 103ダメージ → 52回復 → おおきなねっこで68回復。
 inferDirect(b,'gigadrain',{hpAfter:display(100,trueHP),selfFx:['drain'],observedHp:[measure('me',pct(168,max(b)))]});assert.equal(b.opp[0].statOk.hp[20],'1');
});
test('いたみわけ: %入力の浮動小数点の誤差を許容し、本当の小数%は実測整数と混ぜない',()=>{
 const b=battle('garchomp','snorlax');setHP(b,'me',0,pct(40,max(b)));
 inferDirect(b,'painsplit',{observedHp:[measure('me',pct(145,max(b))),measure('opp',58-1e-14)]});assert.equal(row(b,'hp').valLo,250);assert.equal(row(b,'hp').valHi,250);
 const c=battle('garchomp','snorlax');setHP(c,'me',0,pct(40,max(c)));inferDirect(c,'painsplit',{observedHp:[measure('me',pct(145,max(c))),measure('opp',58.1)]});assert.ok(!c.opp[0].statOk?.hp);
});
test('相手のボディプレス: 受けた実数ダメージから攻撃ではなく防御を絞る',()=>{
 const b=battle('snorlax','corviknight'),truth={...newBuild('corviknight'),ability:'pressure',item:'',sp:[0,0,32,0,0,0],nature:'Impish'};
 b.opp[0].ability='pressure';b.opp[0].item='leftovers';const result=calcDamage({build:truth,cond:opp(b)},{build:b.my[0],cond:me(b)},'bodypress');
 const inferred=inferFromTaken(boardContext(b),0,0,'bodypress',result.min,{itemUnknown:false});assert.equal(inferred.stat,'def');assert.equal(inferred.mask.length,33*99);
 for(let h=0;h<=32;h++)assert.equal(inferred.mask[h*99+comboOf(1.1,32)],'1');
 addAct(b,{side:'opp',mon:0,type:'move',move:'bodypress',hpAfter:pct(max(b)-result.min,max(b)),exact:true});
 assert.ok(!b.opp[0].statOk.atk);assert.equal(b.opp[0].statOk.def[comboOf(1.1,32)],'1');assert.ok(row(b,'def').spLo>0);
});
test('相手のサイコショック: 受けたダメージから特攻を絞る',()=>{
 const b=battle('snorlax','gengar'),truth={...newBuild('gengar'),ability:'cursedbody',item:'',sp:[0,0,0,30,0,0],nature:'Modest'};
 b.opp[0].ability='cursedbody';const result=calcDamage({build:truth,cond:opp(b)},{build:b.my[0],cond:me(b)},'psyshock');
 const inferred=inferFromTaken(boardContext(b),0,0,'psyshock',result.min,{itemUnknown:true});assert.equal(inferred.stat,'spa');assert.equal(inferred.mask[comboOf(1.1,30)],'1');
});
test('自分のサイコショック: 相手の特防ではなくHP×防御を絞る',()=>{
 const b=battle('gengar','snorlax'),truth={...newBuild('snorlax'),ability:'immunity',item:'',sp:[20,0,18,0,32,0],nature:'Serious'};
 const result=calcDamage({build:b.my[0],cond:me(b)},{build:truth,cond:opp(b)},'psyshock'),trueHP=statsOf('snorlax',truth.sp,truth.nature)[0];
 const inferred=inferFromDealt(boardContext(b),0,0,'psyshock',100,display(trueHP-result.min,trueHP),{itemUnknown:true});assert.equal(inferred.stat,'def');assert.equal(inferred.mask[20*99+comboOf(1,18)],'1');
});
test('反動・吸収と通常ダメージの連携: HP×耐久9配分ずつの実ダメージで真の候補を残す',()=>{
 for(const move of ['bravebird','gigadrain'])for(const hpSP of [0,16,32])for(const bulkSP of [0,16,32]){
  const draining=move==='gigadrain',b=battle(draining?'gengar':'staraptor','snorlax');b.my[0].ability=draining?'cursedbody':'reckless';b.my[0].sp=draining?[0,0,0,32,0,0]:[0,32,0,0,0,0];
  b.opp[0].ability='immunity';const truth={...newBuild('snorlax'),item:'',ability:'immunity',sp:draining?[hpSP,0,0,0,bulkSP,0]:[hpSP,0,bulkSP,0,0,0],nature:'Serious'};
  const r=calcDamage({build:b.my[0],cond:me(b)},{build:truth,cond:opp(b)},move),trueHP=statsOf('snorlax',truth.sp,truth.nature)[0],damage=Math.min(trueHP,r.min),start=draining?20:max(b);
  setHP(b,'me',0,pct(start,max(b)));const ending=draining?Math.min(max(b),start+Math.round(damage/2)):Math.max(0,start-Math.round(damage*33/100));
  addAct(b,{side:'me',mon:0,type:'move',move,hpAfter:display(trueHP-damage,trueHP),selfFx:[draining?'drain':'recoil'],observedHp:[measure('me',pct(ending,max(b)))]});
  const known=b.opp[0].statOk;assert.equal(known.hp?.[hpSP]??'1','1',`${move} HP Pt${hpSP}`);assert.equal(known[draining?'spd':'def'][hpSP*99+comboOf(1,bulkSP)],'1',`${move} 耐久Pt${bulkSP}`);
 }
});
test('自動更新した相手HPを次の実測に使わず、明示した実測HPで解除する',()=>{
 const b=battle();setHP(b,'opp',0,40);addEvent(b,{side:'opp',mon:0,kind:'item',item:'sitrusberry',consumed:true});assert.ok(opp(b).hpUnknown);
 inferDirect(b,'bravebird',{hpAfter:pct(max(b)-100,max(b)),selfFx:['recoil'],observedHp:[measure('opp',49)]},'opp');assert.ok(!b.opp[0].statOk?.hp);
 addEvent(b,{side:'opp',mon:0,kind:'item',item:'leftovers',hpAfter:65});assert.ok(!opp(b).hpUnknown);
});
test('さいせいりょく: 自分は実HPで切り捨て、相手の概算は実測として扱わない',()=>{
 const b=battle('slowbro');b.my[0].ability='regenerator';b.my.push(newBuild('snorlax'));normalizeBattle(b);setHP(b,'me',0,pct(20,max(b)));sendOut(b,'me',0,1);
 assert.equal(Math.round(me(b).hp*max(b)/100),76,'最大HP170の1/3は56回復');
 const c=battle('snorlax','slowbro');c.opp[0].ability='regenerator';c.opp.push(newOpp('snorlax'));normalizeBattle(c);setHP(c,'opp',0,20);sendOut(c,'opp',0,1);assert.ok(opp(c).hpUnknown);
});
