import test from 'node:test';
import assert from 'node:assert/strict';
import {newOpp} from '../src/engine/battle.js';
import {bulkPatterns} from '../src/engine/estimate.js';
import {comboOf} from '../src/engine/assume.js';
import {spreadFits} from '../src/engine/infer-dmg.js';
const mask=(n,points)=>Array.from({length:n},(_,i)=>points.includes(i)?'1':'0').join('');
test('物理は観測に合うH+Bの最少Pt配分を選ぶ',()=>{
 const o=newOpp('garchomp');o.statOk={def:mask(3267,[comboOf(1,32),20*99+comboOf(1,0)])};
 const p=bulkPatterns(o);assert.equal(p.length,1);assert.equal(p[0].sp[0],20);assert.equal(p[0].sp[2],0);assert.equal(p[0].cost,20);
 for(const x of p){assert.ok(spreadFits(o,x.nature,x.sp));assert.ok(x.total<=66);}
});
test('物理と特殊はそれぞれのH+BとH+Dを最少にする',()=>{
 const o=newOpp('garchomp');o.statOk={def:mask(3267,[comboOf(1,20),20*99+comboOf(1,0)]),spd:mask(3267,[comboOf(1,10),20*99+comboOf(1,0)])};
 const p=bulkPatterns(o);assert.equal(p.length,2);assert.equal(p[0].cost,20);assert.equal(p[1].cost,10);assert.equal(p[0].sp[0],20);assert.equal(p[1].sp[0],0);
 for(const x of p)assert.ok(spreadFits(o,x.nature,x.sp));
});
test('代表例も確定HP、B、D、Sと合計Ptを守る',()=>{
 const o=newOpp('garchomp');o.statOk={hp:mask(33,[12]),def:mask(3267,[12*99+comboOf(1,20)]),spd:mask(3267,[12*99+comboOf(1,10)])};o.speOk={plain:mask(99,[comboOf(1,24)])};
 for(const x of bulkPatterns(o)){assert.deepEqual(x.sp,[12,0,20,0,10,24]);assert.ok(spreadFits(o,x.nature,x.sp));}
});
test('素早さだけの観測では耐久パターンを作らない',()=>{
 const o=newOpp('garchomp');o.speOk={plain:mask(99,[comboOf(1,24)])};assert.deepEqual(bulkPatterns(o),[]);
});
