import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
import {addAct} from '../src/engine/flow.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();
 for(const viewport of [{width:1180,height:820},{width:1024,height:768}]){
 const page=await browser.newPage({viewport,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://play.pokemonshowdown.com/**',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(new URL('../docs/icon-192.png',import.meta.url))}));await page.goto(url);await page.waitForSelector('.bottomnav');const team=newTeam();team.mons=[{...newBuild('toucannon'),moves:['beakblast']}];const b=newBattle({team});b.opp=[{...newOpp('snorlax'),ability:'thickfat'}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);addAct(b,{side:'opp',mon:0,type:'move',move:'bodypress',hpAfter:70,sameTurn:true});addAct(b,{side:'me',mon:0,type:'move',move:'beakblast',hpAfter:70,sameTurn:true});await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);
 for(const card of ['.pl.me','.pl.opp']){const row=page.locator(`${card} .pl-conditions`),r=await row.boundingBox();assert.ok(await row.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'状態の操作が横にはみ出さない');for(const button of await row.locator('button').all()){const v=await button.boundingBox();assert.ok(v.x>=r.x-1&&v.x+v.width<=r.x+r.width+1);}}
 await page.getByRole('button',{name:'相手の状態異常を後から入力',exact:true}).click();await page.getByLabel('状態異常のタイミング',{exact:true}).selectOption('0:0:after');await page.getByRole('button',{name:'やけど',exact:true}).click();const saved=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(saved.state.mons.opp[0].status,'brn');assert.equal(saved.state.mons.me[0].status,'');assert.equal(saved.turns[0].acts[1].kind,'status');assert.equal(saved.turns[0].acts.filter(a=>a.type==='move').length,2);assert.equal(await page.getByLabel('相手の状態異常',{exact:true}).inputValue(),'brn');
 await page.getByRole('button',{name:'相手の状態異常を後から入力',exact:true}).click();await page.getByRole('button',{name:'状態異常なし・回復',exact:true}).click();assert.equal((await page.evaluate(id=>window.__pokememo.store.battle(id),b.id)).state.mons.opp[0].status,'');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('ok iPad: 行動後にやけどを接触技の後へ追加・対象とログを確認・回復入力・状態欄の幅を維持');
}finally{await browser?.close();server.close();}
