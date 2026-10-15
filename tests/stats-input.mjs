// 統計の期間・形式・対戦詳細への移動をiPad横向きで検証。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();const ctx=await browser.newContext({viewport:{width:1180,height:820}});
 await ctx.route('https://play.pokemonshowdown.com/**',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(new URL('../docs/icon-192.png',import.meta.url))}));
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.bottomnav');
 const records=[];
 for(const [format,date,result] of [['single',new Date().toISOString().slice(0,10),'win'],['single','2020-01-01','lose'],['double',new Date().toISOString().slice(0,10),'draw']]){
  const team=newTeam(format);team.mons=[newBuild('garchomp')];const b=newBattle({team,format});b.opp=[newOpp('snorlax')];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);b.date=date;b.result=result;b.turns=[{n:1,acts:[{type:'move',side:'opp',mon:0,sp:'snorlax',move:'bodyslam',vs:['garchomp'],flags:{}}]}];records.push(b);
 }
 await page.evaluate(async records=>{for(const b of records)await window.__pokememo.store.saveBattle(b);},records);
 await page.goto(`${url}#/stats`);await page.getByRole('combobox').selectOption('');
 await page.getByRole('button',{name:'全期間',exact:true}).click();assert.equal(await page.locator('.kpi-v').first().innerText(),'2');
 await page.getByRole('button',{name:'直近30日',exact:true}).click();assert.equal(await page.locator('.kpi-v').first().innerText(),'1');
 await page.getByRole('button',{name:'相手ごとの成績',exact:true}).click();assert.equal(await page.locator('.matchup-results tbody tr').count(),1);assert.match(await page.locator('.matchup-results').innerText(),/少数/);
 await page.getByRole('searchbox').fill('ピカチュウ');assert.equal(await page.locator('.matchup-results tbody tr').count(),0);await page.getByRole('searchbox').fill('');
 await page.getByRole('button',{name:'カビゴン',exact:true}).click();await page.getByRole('heading',{name:'最近の対戦（最大10件）'}).waitFor();assert.equal(await page.locator('.recent-matchups button').count(),1);
 await page.locator('.recent-matchups button').click();assert.ok(page.url().endsWith(`#/battle/${records[0].id}`));
 await page.goto(`${url}#/stats`);await page.getByRole('button',{name:'ダブル',exact:true}).click();assert.equal(await page.locator('.kpi-v').first().innerText(),'1');assert.match(await page.locator('.page').innerText(),/引き分け 1戦/);
 await page.getByRole('button',{name:'相手ごとの成績',exact:true}).click();assert.equal(await page.locator('.matchup-results tbody tr').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync('e2e-out',{recursive:true});await page.screenshot({path:'e2e-out/stats-ipad.png'});assert.deepEqual(errors,[]);console.log('ok iPad: 期間・形式・少数表示・検索・最近の対戦・履歴への移動・横スクロールなし');
} finally {await browser?.close();server.close();}
