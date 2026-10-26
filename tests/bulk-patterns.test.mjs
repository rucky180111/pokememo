import test from 'node:test';
import assert from 'node:assert/strict';
import {newOpp} from '../src/engine/battle.js';
import {bulkPatterns} from '../src/engine/estimate.js';
import {comboOf} from '../src/engine/assume.js';
import {spreadFits} from '../src/engine/infer-dmg.js';
const mask=(n,points)=>Array.from({length:n},(_,i)=>points.includes(i)?'1':'0').join('');
test('HP振りと防御振りの代替を混ぜず実現可能な代表配分として表示する',()=>{
 const o=newOpp('garchomp');o.statOk={def:mask(3267,[comboOf(1,32),32*99+comboOf(1,0)])};
 const p=bulkPatterns(o);assert.equal(p.length,2);assert.equal(p[0].sp[0],32);assert.equal(p[0].sp[2],0);assert.equal(p[1].sp[0],0);assert.equal(p[1].sp[2],32);
 for(const x of p){assert.ok(spreadFits(o,x.nature,x.sp));assert.ok(x.total<=66);}
});
test('代表例も確定HP、B、D、Sと合計Ptを守る',()=>{
 const o=newOpp('garchomp');o.statOk={hp:mask(33,[12]),def:mask(3267,[12*99+comboOf(1,20)]),spd:mask(3267,[12*99+comboOf(1,10)])};o.speOk={plain:mask(99,[comboOf(1,24)])};
 for(const x of bulkPatterns(o)){assert.deepEqual(x.sp,[12,0,20,0,10,24]);assert.ok(spreadFits(o,x.nature,x.sp));}
});
test('素早さだけの観測では耐久パターンを作らない',()=>{
 const o=newOpp('garchomp');o.speOk={plain:mask(99,[comboOf(1,24)])};assert.deepEqual(bulkPatterns(o),[]);
});
