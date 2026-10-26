import test from 'node:test';
import assert from 'node:assert/strict';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
import {comboOf} from '../src/engine/assume.js';
import {addAct} from '../src/engine/flow.js';
import {inferFromDealt,applyInference,spreadFits} from '../src/engine/infer-dmg.js';
import {boardContext,attackTable} from '../src/engine/board.js';
import {damageRange,candidateSpreads} from '../src/engine/damage-range.js';
import {estimateStats,fitBuild} from '../src/engine/estimate.js';
import {natureMod} from '../src/engine/dex.js';
function setup(species='garchomp'){const team=newTeam();team.mons=[{...newBuild('garchomp'),sp:[0,32,0,0,0,32],moves:['earthquake','outrage','fireblast']}];const b=newBattle({team});b.opp=[{...newOpp(species),ability:species==='garchomp'?'roughskin':''}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);return b;}
const mask=(n,points)=>Array.from({length:n},(_,i)=>points.includes(i)?'1':'0').join('');
test('地震を観測した後の地震・げきりんは、同じHP×Bの観測を満たす配分で計算する',()=>{
 const b=setup();addAct(b,{side:'me',mon:0,type:'move',move:'earthquake',hpAfter:55,sameTurn:true});const ctx=boardContext(b);
 for(const move of ['earthquake','outrage']){const r=damageRange(ctx,'me',0,0,move);for(const p of [r.lowBuild,r.highBuild])assert.ok(spreadFits(b.opp[0],p.nature,p.sp));assert.equal(b.opp[0].statOk.def[32*99+comboOf(1.1,32)],'0');const all=candidateSpreads(b.opp[0],ctx.build('opp',0),'garchomp','def');let low=Infinity,high=-Infinity;for(const p of all){const alt={...ctx.build('opp',0),nature:p.nature,sp:p.sp};const c={...ctx,build:(s,i)=>s==='opp'?alt:ctx.build(s,i)};const x=attackTable(c,'me',0,{only:{def:0,move}}).targets[0].results[move];low=Math.min(low,x.minPct);high=Math.max(high,x.maxPct);}assert.equal(r.minPct,low);assert.equal(r.maxPct,high);}
});
test('HPとBが確定したら全物理技で固定し、特殊技でもHPと残りPtを守る',()=>{
 const b=setup();b.opp[0].statOk={hp:mask(33,[32]),def:mask(3267,[32*99+comboOf(1,32)])};const ctx=boardContext(b);for(const move of ['earthquake','outrage','fireblast']){const r=damageRange(ctx,'me',0,0,move);for(const p of [r.lowBuild,r.highBuild]){assert.equal(p.sp[0],32);assert.equal(p.sp[2],32);assert.equal(natureMod(p.nature,'def'),1);assert.ok(p.sp[4]<=2);assert.ok(p.sp.reduce((a,v)=>a+v,0)<=66);}}
});
test('効率のよいHP/Bの一例を確定値にしない。相関上の最低消費Ptを計算する',()=>{
 const o=newOpp('garchomp');o.statOk={def:mask(3267,[comboOf(1,32),32*99+comboOf(1,0)])};const e=estimateStats(o,'garchomp');assert.deepEqual([e.rows[0].spLo,e.rows[0].spHi],[0,32]);assert.deepEqual([e.rows[2].spLo,e.rows[2].spHi],[0,32]);assert.equal(e.used,32);assert.equal(e.remain,34);const f=fitBuild(o,{...newBuild('garchomp'),sp:[32,0,32,0,0,0]},'garchomp');assert.ok(spreadFits(o,f.nature,f.sp));assert.ok(!(f.sp[0]===32&&f.sp[2]===32));
});
test('確定した攻撃・特攻と合計66から、他の能力の上限と性格も絞り込む',()=>{const o=newOpp('garchomp');o.statOk={atk:mask(99,[comboOf(1.1,32)]),spa:mask(99,[comboOf(1,32)])};const e=estimateStats(o,'garchomp');assert.equal(e.rows[0].spHi,2);assert.ok(e.rows[2].spHi<=2);assert.ok(e.rows[5].modHi<=1);assert.equal(e.used,64);});
test('1つの性格で実現できない新たな推定は保存しない',()=>{const o=newOpp('garchomp');o.statOk={atk:mask(99,[comboOf(1.1,32)])};const message=applyInference(o,null,{stat:'spa',mask:mask(99,[comboOf(1.1,32)]),count:1,range:[100,100]});assert.match(message,/矛盾/);assert.equal(o.statOk.spa,undefined);});
test('特性候補の最小と最大の間でも、どの実乱数にも存在しないダメージは除く',()=>{
 const b=setup('persianalola'),ctx=boardContext(b),base=ctx.build('opp',0);const results=['furcoat','technician'].map(ability=>{const alt={...base,ability,nature:'Serious',sp:[0,0,0,0,0,0]};const c={...ctx,build:(s,i)=>s==='opp'?alt:ctx.build(s,i),ability:(s,i)=>s==='opp'?ability:ctx.ability(s,i)};return attackTable(c,'me',0,{only:{def:0,move:'earthquake'}}).targets[0].results.earthquake;});assert.ok(results[0].max<results[1].min);const lost=(results[0].max+results[1].min)/2/results[0].defMaxHP*100;const r=inferFromDealt(ctx,0,0,'earthquake',100,100-lost,{tol:0,abilityUnknown:true});assert.equal(r.mask[comboOf(1,0)],'0');
});
test('推定ログにも新しい観測単体でなく、これまでの観測の共通部分を表示する',()=>{const o=newOpp('garchomp');o.statOk={atk:mask(99,[comboOf(1,5)])};const msg=applyInference(o,null,{stat:'atk',mask:mask(99,[comboOf(1,5),comboOf(1,10)]),count:2,range:[155,160]});assert.match(msg,/155（確定）/);});
