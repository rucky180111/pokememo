import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
import {calcDamage} from '../src/engine/calc.js';
import {addAct} from '../src/engine/flow.js';
const {server,url}=await serve();let browser;
try{
 browser=await chromium.launch();
 for(const viewport of [{width:1180,height:820},{width:1024,height:768}]){
 const page=await browser.newPage({viewport,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.bottomnav');const team=newTeam();team.mons=[{...newBuild('umbreon'),sp:[32,0,0,0,0,0],moves:['bodypress']}];const b=newBattle({team});b.opp=[{...newOpp('garchomp'),ability:'roughskin'}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);const truth={...newBuild('garchomp'),item:'lifeorb',nature:'Jolly',sp:[0,12,0,0,0,0]};const r=calcDamage({build:truth,cond:b.state.mons.opp[0]},{build:b.my[0],cond:b.state.mons.me[0]},'earthquake');addAct(b,{side:'opp',mon:0,type:'move',move:'earthquake',exact:true,hpAfter:(r.defMaxHP-r.rolls[0])/r.defMaxHP*100,sameTurn:true});const mask=b.opp[0].statOk.atk;await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);
 const undo=page.getByRole('button',{name:'1つ戻す',exact:true});await undo.waitFor();const ub=await undo.boundingBox(),eb=await page.getByRole('button',{name:'ターン終了',exact:true}).boundingBox();assert.ok(ub.height>=44);assert.ok(ub.width>=eb.width-2);assert.ok(ub.y+ub.height<=eb.y+1,'大きな戻すボタンを入力と終了操作の上に置く');
 const opp=page.locator('.pl.opp');await opp.locator('.pl-info button.pl-dd').click();const sheet=page.getByRole('dialog');await sheet.locator('input[type=search]').fill('いのちのたま');await sheet.locator('.picker-list .row').first().click();let saved=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(saved.opp[0].item,'lifeorb');assert.ok(saved.state.mons.opp[0].hp<91&&saved.state.mons.opp[0].hp>89);assert.notEqual(saved.opp[0].statOk.atk,mask);assert.ok(saved.turns[0].acts[0].selfFx.includes('lifeorb'));
 await opp.getByRole('button',{name:'直前のHPを補正',exact:true}).click();await page.getByLabel('相手 ガブリアスの行動後HP',{exact:true}).waitFor();await page.getByRole('button',{name:'閉じる',exact:true}).click();
 await undo.click();saved=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(saved.opp[0].item,'');assert.equal(saved.state.mons.opp[0].hp,100);assert.equal(saved.opp[0].statOk.atk,mask);saved.opp[0].item='lifeorb';await page.evaluate(b=>window.__pokememo.store.saveBattle(b),saved);await page.getByRole('tab',{name:'ダメージ',exact:true}).click();await page.getByRole('button',{name:'推定を再計算',exact:true}).click();saved=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.ok(saved.state.mons.opp[0].hp<91);assert.notEqual(saved.opp[0].statOk.atk,mask);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('ok iPad 1180/1024: 大きな戻すボタンが入力の上・技後のいのちのたま判明→反動/推定再計算→取消で復元');
}finally{await browser?.close();server.close();}
