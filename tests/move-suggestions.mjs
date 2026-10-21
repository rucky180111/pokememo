import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {moveName} from '../src/engine/dex.js';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
const {server,url}=await serve();let browser;
try{
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1180,height:820}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://play.pokemonshowdown.com/**',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(new URL('../docs/icon-192.png',import.meta.url))}));await page.goto(url);await page.waitForSelector('.bottomnav');const t=newTeam();t.mons=[{...newBuild('snorlax'),moves:['protect']}];const b=newBattle({team:t});b.opp=[newOpp('snorlax')];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);const pool=['bodyslam','earthquake','crunch','icepunch','firepunch','thunderpunch','heavyslam','zenheadbutt','rockslide','doubleedge'];const usage={pokemon:{snorlax:{u:1,ab:[['thickfat',1]],it:[],mv:pool.map((m,i)=>[m,1-i*.08])}}};await page.evaluate(async ({b,usage})=>{await window.__pokememo.store.saveUsage('single',usage);await window.__pokememo.store.saveBattle(b);},{b,usage});await page.goto(`${url}#/battle/${b.id}`);const opp=page.locator('.pl.opp'),mine=page.locator('.pl.me'),suggestions=opp.locator('.pl-suggestions .chip');await suggestions.first().waitFor();
 for(let known=0;known<4;known++){
  assert.equal(await suggestions.count(),6,`判明${known}件でも候補を6件維持`);assert.deepEqual(await suggestions.allTextContents(),pool.slice(known,known+6).map(m=>`${moveName(m)} 推定`));const boxes=await suggestions.evaluateAll(xs=>xs.map(x=>{const b=x.getBoundingClientRect();return{x:b.x,y:b.y};}));assert.equal(boxes[0].y,boxes[1].y);await suggestions.first().click();await opp.getByRole('button',{name:'記録',exact:true}).click();const saved=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.deepEqual(saved.opp[0].moves,pool.slice(0,known+1));await mine.getByRole('button',{name:'行動不能（技不明）',exact:true}).click();await page.getByRole('button',{name:'ターン終了',exact:true}).click();
 }
 assert.equal(await suggestions.count(),0,'4技がすべて判明したら推測候補を終了');assert.deepEqual(errors,[]);console.log('ok 相手の技候補: 使用率上位6件・2列表示・1〜3技判明後も次順位を補充・既知技の重複なし・記録後の4技確定');
}finally{await browser?.close();server.close();}
