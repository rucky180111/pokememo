import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle} from '../src/engine/battle.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true,acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://play.pokemonshowdown.com/**',r=>r.abort());await page.goto(url);await page.waitForSelector('.bottomnav');
 const team=newTeam();team.mons=[newBuild('garchomp')];const b=newBattle({team});b.memo='この対戦だけ';b.oppName='テスト相手';const other=newBattle({team});other.memo='含めない対戦';await page.evaluate(async({team,b,other})=>{await window.__pokememo.store.saveTeam(team);await window.__pokememo.store.saveBattle(b);await window.__pokememo.store.saveBattle(other);},{team,b,other});await page.goto(`${url}#/battle/${b.id}`);
 const button=page.getByRole('button',{name:'この対戦を書き出す',exact:true});await button.click();const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'JSONファイルを保存',exact:true}).click();const download=await downloadEvent;assert.match(download.suggestedFilename(),/^pokememo-battle-.*\.json$/);const data=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(data.battles.length,1);assert.equal(data.battles[0].id,b.id);assert.equal(data.battles[0].memo,b.memo);assert.deepEqual(data.teams,[]);assert.ok(!JSON.stringify(data).includes(other.id));
 await page.setViewportSize({width:390,height:844});assert.ok(await button.isVisible());const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);await button.click();await page.getByRole('button',{name:'JSONファイルを保存',exact:true}).waitFor();assert.deepEqual(errors,[]);console.log('ok iPad・スマホ: 対戦1件のJSONをダウンロード、ほかの対戦は含めない');
}finally{await browser?.close();server.close();}
