import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
import {comboOf} from '../src/engine/assume.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();
 for(const width of [1180,1024,390]) {
  const page=await browser.newPage({viewport:{width,height:820},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForSelector('.bottomnav');
  const team=newTeam();team.mons=[newBuild('garchomp')];const b=newBattle({team});b.opp=[newOpp('garchomp')];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);
  b.opp[0].statOk={def:Array.from({length:3267},(_,i)=>[comboOf(1,32),32*99+comboOf(1,0)].includes(i)?'1':'0').join('')};
  await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);
  const patterns=page.locator('.pl.opp .mp-table');await patterns.waitFor();assert.equal(await patterns.locator('.est-pattern').count(),1);assert.match(await patterns.innerText(),/物理・省Pt/);
  assert.equal(await patterns.locator('thead th').count(),7);assert.equal(await patterns.locator('.est-pattern').first().locator('td').count(),6);assert.match(await patterns.innerText(),/推定Pt/);assert.match(await patterns.innerText(),/実数値/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('ok: 推定範囲・耐久代表例・素早さを同じ表に統合・1180/1024/390px横はみ出しなし');
} finally {await browser?.close();server.close();}
