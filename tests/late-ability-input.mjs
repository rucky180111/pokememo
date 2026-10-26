import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://play.pokemonshowdown.com/**',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(new URL('../docs/icon-192.png',import.meta.url))}));await page.goto(url);await page.waitForSelector('.bottomnav');
 const team=newTeam();team.mons=[{...newBuild('snorlax'),moves:['bodypress']}];const b=newBattle({team});b.opp=[newOpp('skarmory')];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);
 const mine=page.locator('.pl.me');await mine.locator('.pl-mv',{hasText:'ボディプレス'}).click();assert.equal(await mine.locator('details.pa-predictions').count(),0);assert.equal(await mine.locator('.pa-predictions .pa-row').count(),3);await mine.getByLabel('残りHP',{exact:true}).fill('80');await mine.getByRole('button',{name:'記録',exact:true}).click();await page.getByLabel('相手の特性',{exact:true}).selectOption('weakarmor');const activate=page.getByRole('button',{name:'特性が発動した',exact:true});assert.ok(await activate.isDisabled());const box=await activate.boundingBox();assert.ok(box.x+box.width<=1024);let saved=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(saved.state.mons.opp[0].boosts.def,-1);assert.equal(saved.state.mons.opp[0].boosts.spe,2);assert.ok(await activate.isDisabled());assert.deepEqual(errors,[]);console.log('ok iPad: 被弾後に特性選択だけで発動・二重入力防止・予測3行を常時展開');
} finally {await browser?.close();server.close();}
