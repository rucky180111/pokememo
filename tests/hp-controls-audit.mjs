import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();
 for(const viewport of [{width:1180,height:820},{width:1024,height:768},{width:820,height:1180},{width:390,height:844}]) {
  const page=await browser.newPage({viewport,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.bottomnav');
  const team=newTeam();team.mons=[{...newBuild('annihilape'),moves:['closecombat','drainpunch','flareblitz','doubleedge']}];const b=newBattle({team});b.opp=[{...newOpp('snorlax'),ability:'thickfat'}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);
  await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);const mine=page.locator('.pl.me');
  for(const name of ['インファイト','ドレインパンチ','フレアドライブ']) {
   await mine.locator('.pl-mv',{hasText:name}).click();const sliders=mine.locator('.pa-quick-fields input[type=range]');assert.equal(await sliders.count(),name==='インファイト'?1:2);
   for(const slider of await sliders.all()) {
    await slider.evaluate(e=>e.scrollIntoView({block:'center'}));const rect=await slider.boundingBox();assert.ok(rect.width>150);assert.ok(rect.height>=24);
    assert.ok(await slider.evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}),'レールがほかの操作に隠れず実際に触れる');
    await slider.fill('50');await slider.press('ArrowRight');const input=slider.locator('xpath=ancestor::div[contains(@class,"hp-control")]').locator('input[type=number]');assert.equal(await input.inputValue(),'51');assert.equal(await input.getAttribute('inputmode'),'none');const control=slider.locator('xpath=ancestor::div[contains(@class,"hp-control")]');await control.locator('.hp-clear').click();assert.equal(await input.inputValue(),'');await slider.fill('51');
   }
   fs.mkdirSync('e2e-out',{recursive:true});await mine.screenshot({path:`e2e-out/hp-audit-${viewport.width}-${name}.png`});
  }
  await mine.getByRole('button',{name:'記録',exact:true}).click();await mine.getByRole('button',{name:'直前のHPを補正',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('.hp-control input[type=range]').count(),2);await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await mine.getByRole('button',{name:'直前の技・結果を修正',exact:true}).click();const edit=page.getByRole('dialog').getByLabel('コノヨザルの行動後HPの調整',{exact:true});await edit.fill('130');await page.getByRole('button',{name:'この内容で直す',exact:true}).click();const saved=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(saved.turns[0].acts[0].in.atkHpAfter,130/185*100);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('ok HP監査: 自分/相手・通常/吸収/反動・レール実操作/±・補正/ログ修正・4画面幅');
}finally{await browser?.close();server.close();}
