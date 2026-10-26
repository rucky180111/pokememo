import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut,condOf,clone,UNDO_DEPTH} from '../src/engine/battle.js';
import {addAct,addEvent,finishTurn,residualCandidates,reopenLastTurn,undoPlan,undoLast,replay,editAct} from '../src/engine/flow.js';
function setup(){const t=newTeam();t.mons=[{...newBuild('snorlax'),ability:'thickfat',item:'leftovers',moves:['bodypress']}];const b=newBattle({team:t});b.opp=[{...newOpp('snorlax'),ability:'thickfat',item:'leftovers'}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);b.state.field.weather='Sand';b.state.field.terrain='Grassy';condOf(b,'me',0).hp=65;condOf(b,'opp',0).hp=65;condOf(b,'me',0).status='tox';condOf(b,'opp',0).status='brn';return b;}
const cant=(b,side='me')=>addAct(b,{side,mon:0,type:'move',cant:true,sameTurn:true});
const end=b=>finishTurn(b,null,{noOrder:true,residual:residualCandidates(b).filter(c=>c.checked),resFirst:'opp'});
test('終了時の全定数処理・回復・猛毒カウント・推定を1回で戻し、次は相手の行動を戻す',()=>{
 const b=setup();cant(b);cant(b,'opp');const state=clone(b.state),opp=clone(b.opp),acts=clone(b.turns[0].acts);end(b);assert.ok(b.turns[0].acts.length>4);assert.ok(b.opp[0].speOk);assert.equal(undoPlan(b).kind,'end');const result=undoLast(b);assert.equal(result.kind,'end');assert.equal(b.turns[0].open,true);assert.deepEqual(b.state,state);assert.deepEqual(b.opp,opp);assert.deepEqual(b.turns[0].acts,acts);assert.equal(b.turns[0].auto.length,0);assert.equal(undoPlan(b).kind,'act');assert.match(undoPlan(b).label,/相手/);assert.equal(undoLast(b).kind,'act');assert.equal(b.turns[0].acts.length,1);assert.match(undoPlan(b).label,/自分/);
});
test('保存・再読み込み後も終了直前へ完全復元し、何度終了しても重複しない',()=>{
 let b=setup();cant(b);cant(b,'opp');const original=clone(b.state);end(b);b=clone(b);assert.ok(reopenLastTurn(b));assert.deepEqual(b.state,original);const count=b.turns[0].acts.length;end(b);assert.ok(reopenLastTurn(b));assert.deepEqual(b.state,original);assert.equal(b.turns[0].acts.length,count);
});
test('旧データの終了処理もまとめて戻し、手入力したHPや行動は消さない',()=>{
 const b=setup();addEvent(b,{kind:'hp',side:'me',mon:0,hpAfter:45});cant(b);cant(b,'opp');const expected=clone(b.state);end(b);delete b.turns[0].undoEnd;for(const a of b.turns[0].acts)if(a.in)delete a.in.turnEnd;assert.ok(reopenLastTurn(b));assert.deepEqual(b.state,expected);assert.equal(b.turns[0].acts.length,3);assert.equal(b.turns[0].acts[0].kind,'hp');
});
test('終了後HPの逆算も戻して、元のHP未確認入力と推定に戻る',()=>{
 const b=setup();addAct(b,{side:'opp',mon:0,type:'move',move:'bodypress',hpUnknown:true,sameTurn:true});cant(b);const state=clone(b.state),input=clone(b.turns[0].acts[0].in);finishTurn(b,null,{noOrder:true,residual:[],finalHp:{me0:35}});assert.equal(b.turns[0].acts[0].in.hpUnknown,undefined);assert.ok(b.turns[0].acts[0].endCorrection);assert.ok(reopenLastTurn(b));assert.deepEqual(b.turns[0].acts[0].in,input);assert.deepEqual(b.state,state);
});
test('訂正で再生した後も、終了後HPの逆算を元に戻せる',()=>{
 const b=setup();addAct(b,{side:'opp',mon:0,type:'move',move:'bodypress',hpUnknown:true,sameTurn:true});cant(b);finishTurn(b,null,{noOrder:true,residual:[],finalHp:{me0:35}});replay(b);assert.ok(reopenLastTurn(b));assert.equal(b.turns[0].acts[0].in.hpUnknown,true);assert.equal(b.turns[0].acts[0].in.hpAfter,undefined);assert.equal(condOf(b,'me',0).hpUnknown,true);
});
test('古いチェックポイントを使わず、後から変更したメモや型を残す',()=>{
 const b=setup();cant(b);cant(b,'opp');const original=clone(b.state);end(b);b.opp[0].note='後からのメモ';b.opp[0].assume={kind:'preset',key:'fast'};assert.ok(reopenLastTurn(b));assert.deepEqual(b.state,original);assert.equal(b.opp[0].note,'後からのメモ');assert.equal(b.opp[0].assume.key,'fast');
});
test('長い対戦の最後の行動を戻しても、前のターンを再計算しない',()=>{
 const b=setup();for(let i=0;i<12;i++){cant(b);cant(b,'opp');finishTurn(b,null,{noOrder:true});}cant(b);cant(b,'opp');const prefix=b.turns.slice(0,12);assert.equal(undoLast(b).kind,'act');for(let i=0;i<12;i++)assert.strictEqual(b.turns[i],prefix[i]);assert.equal(b.turns.at(-1).acts.length,1);assert.equal(undoLast(b).kind,'act');assert.equal(b.turns.length,12);assert.equal(undoPlan(b).kind,'end');assert.equal(undoLast(b).kind,'end');assert.equal(b.turns.at(-1).acts.length,2);assert.ok(b.turns.filter(t=>t.undoEnd).length<=UNDO_DEPTH);assert.equal(undoLast(b).kind,'act');
});
test('途中の行動訂正は、前半を保った部分再生でも全再生と同じ盤面になる',()=>{
 const b=setup();for(let i=0;i<4;i++){cant(b);cant(b,'opp');end(b);}cant(b);cant(b,'opp');const full=clone(b);editAct(b,4,1,null);full.turns[4].acts.pop();replay(full);assert.deepEqual(b.state,full.state);assert.deepEqual(b.opp,full.opp);
});
test('終了処理だけでひんしになった場合、復元でHP・選出・確定結果も戻る',()=>{
 const b=setup();condOf(b,'opp',0).hp=1;cant(b);cant(b,'opp');const state=clone(b.state);finishTurn(b,null,{noOrder:true,residual:[{side:'opp',mon:0,key:'brn'}],result:'win'});assert.equal(condOf(b,'opp',0).fainted,true);assert.equal(b.result,'win');assert.equal(undoLast(b).kind,'end');assert.equal(b.result,'');assert.deepEqual(b.state,state);
});
test('かそく・壁の期限も終了処理にまとめて戻る',()=>{
 const b=setup();b.my[0].ability='speedboost';b.state.sides.me.reflect=true;b.state.sides.me.since.reflect=1;cant(b);cant(b,'opp');const state=clone(b.state);finishTurn(b,null,{noOrder:true,expiry:[{key:'me.reflect',ended:true,n:5}]});assert.equal(condOf(b,'me',0).boosts.spe,1);assert.ok(reopenLastTurn(b));assert.deepEqual(b.state,state);
});
test('空のターンも1回で終了を戻し、開始前のさらに先へは戻らない',()=>{const b=setup();finishTurn(b,null,{incomplete:true});assert.ok(undoLast(b));assert.equal(b.turns[0].open,true);assert.equal(b.turns[0].acts.length,0);assert.equal(undoPlan(b),null);assert.equal(undoLast(b),null);});
test('以前の「戻す」で定数ログだけ残った入力中ターンも、一括で取り消す',()=>{
 const b=setup();cant(b);cant(b,'opp');const state=clone(b.state);end(b);const t=b.turns[0];delete t.undoEnd;delete t.end;t.open=true;for(const a of t.acts)if(a.in)delete a.in.turnEnd;replay(b);assert.equal(undoPlan(b).kind,'end');assert.ok(undoLast(b));assert.equal(b.turns[0].acts.length,2);assert.deepEqual(b.state,state);
});
test('旧形式の終了処理を再生した直後も、全定数処理が正しく戻る',()=>{
 const b=setup();cant(b);cant(b,'opp');const state=clone(b.state);end(b);delete b.turns[0].undoEnd;for(const a of b.turns[0].acts)if(a.in)delete a.in.turnEnd;replay(b);assert.ok(reopenLastTurn(b));assert.equal(b.turns[0].acts.length,2);assert.deepEqual(b.state,state);
});
test('特性判明の入力を戻すと、不明へ戻り、その発動も残らない',()=>{
 const b=setup();b.opp[0].ability='';addEvent(b,{kind:'ability',side:'opp',mon:0,ability:'drizzle',activate:true});assert.equal(b.state.field.weather,'Rain');assert.ok(undoLast(b));assert.equal(b.opp[0].ability,'');assert.equal(b.state.field.weather,'Sand');
});
test('持ち物判明・消費を戻すと、元の判明状態と消費状態に戻る',()=>{
 const b=setup();b.opp[0].item='';addEvent(b,{kind:'item',side:'opp',mon:0,item:'sitrusberry',consumed:true});assert.equal(b.opp[0].item,'sitrusberry');assert.equal(condOf(b,'opp',0).itemGone,true);assert.ok(undoLast(b));assert.equal(b.opp[0].item,'');assert.equal(condOf(b,'opp',0).itemGone,false);
});
test('旧形式の定数処理で判明した持ち物も、終了を戻すと不明に戻る',()=>{
 const b=setup();b.opp[0].item='';cant(b);cant(b,'opp');finishTurn(b,null,{noOrder:true,residual:[{side:'opp',mon:0,key:'leftovers'}]});delete b.turns[0].undoEnd;for(const a of b.turns[0].acts)if(a.in)delete a.in.turnEnd;assert.equal(b.opp[0].item,'leftovers');assert.ok(undoLast(b));assert.equal(b.opp[0].item,'');
});
test('能力ランクだけの取り消しでは入力中の技をリセットせず、行動を戻すとリセットする',()=>{const b=setup();addEvent(b,{kind:'boost',side:'me',mon:0,stat:'atk',delta:1});const rev=b.undoRevision;undoLast(b);assert.equal(b.undoRevision,rev);cant(b);undoLast(b);assert.ok(b.undoRevision>0);});
