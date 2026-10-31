import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild} from '../src/engine/battle.js';
const {server,url}=await serve();let browser;
try{
 browser=await chromium.launch();
 for(const width of [1180,1024]){
  const page=await browser.newPage({viewport:{width,height:820},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.bottomnav');
  const team=newTeam();team.mons=[{...newBuild('greninja'),ability:'torrent',moves:['grassknot']}];await page.evaluate(t=>window.__pokememo.store.saveTeam(t),team);await page.goto(`${url}#/team/${team.id}`);await page.getByRole('button',{name:'構築診断',exact:true}).click();await page.getByRole('button',{name:'攻め (組み合わせ別)',exact:true}).click();
  assert.match(await page.locator('.tdiag').innerText(),/攻撃技 1個/);
  for(const row of await page.locator('.td-crow.miss').all()) {const types=await row.locator('.td-combo .type').allTextContents();assert.notDeepEqual(types,['みず']);assert.notDeepEqual(types,['じめん']);assert.ok(!(types.length===2&&types.includes('みず')&&types.includes('じめん')));}
  await page.locator('.td-all summary').click();const rows=page.locator('.td-all .td-crow');let found=false;
  for(const row of await rows.all()){const types=await row.locator('.td-combo .type').allTextContents();if(types.length===2&&types.includes('みず')&&types.includes('じめん')){assert.match(await row.innerText(),/×4 くさむすび/);found=true;}}
  assert.ok(found,'みず/じめんは草結び4倍として表示');assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync('e2e-out',{recursive:true});await page.screenshot({path:`e2e-out/teamdiag-grassknot-${width}.png`});await page.close();
 }
 console.log('ok 構築診断: 草結びを1技に数え、水・地面への打点と水/地面4倍をiPad表示で確認');
}finally{await browser?.close();server.close();}
