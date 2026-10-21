import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut} from '../src/engine/battle.js';
const {server,url}=await serve();let browser;
try{
 browser=await chromium.launch();
 for(const viewport of [{width:1180,height:820},{width:1024,height:768}]){
  const page=await browser.newPage({viewport,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://play.pokemonshowdown.com/**',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(new URL('../docs/icon-192.png',import.meta.url))}));await page.goto(url);await page.waitForSelector('.bottomnav');const team=newTeam();team.mons=[{...newBuild('annihilape'),moves:['closecombat','drainpunch','flareblitz','doubleedge']}];const b=newBattle({team});b.opp=[{...newOpp('snorlax'),ability:'thickfat'}];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);const mine=page.locator('.pl.me'),column=mine.locator('.pl-action-column');await mine.waitFor();
  for(const move of ['インファイト','ドレインパンチ','フレアドライブ']){
   await mine.locator('.pl-mv',{hasText:move}).click();const box=await column.boundingBox();const hp=mine.getByLabel('残りHP',{exact:true});await hp.fill('73');assert.ok(Number(await hp.evaluate(e=>getComputedStyle(e).fontSize.replace('px','')))>=22);const controls=[hp,mine.getByRole('button',{name:'残りHPの調整を1減らす',exact:true}),mine.getByRole('button',{name:'残りHPの調整を1増やす',exact:true}),mine.getByRole('button',{name:'記録',exact:true})];if(move!=='インファイト')controls.push(mine.getByLabel('自分 コノヨザルの行動後HP',{exact:true}));const rec=await mine.getByRole('button',{name:'記録',exact:true}).boundingBox();for(const c of controls){const r=await c.boundingBox();assert.ok(r.y>=box.y-1&&r.y+r.height<=box.y+box.height+1,`${viewport.width}: ${move}のHPと操作が枠内に入る`);assert.ok(r.y+r.height<=viewport.height-54,`${viewport.width}: 下部ナビに隠れない`);if(c!==controls[3])assert.ok(r.y+r.height<=rec.y+1,'HPと±ボタンが記録ボタンに重ならない');assert.ok(r.x>=box.x-1&&r.x+r.width<=box.x+box.width+1,'横にはみ出さない');}await mine.getByRole('button',{name:'残りHPの調整を1減らす',exact:true}).click();assert.equal(await hp.inputValue(),'72');await mine.getByRole('button',{name:'残りHPの調整を1増やす',exact:true}).click();assert.equal(await hp.inputValue(),'73');await mine.locator('.pa-predictions').evaluate(e=>{e.open=true;});await column.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  }
  assert.equal(await column.evaluate(e=>e.scrollTop>0),true);await mine.locator('.pl-mv',{hasText:'ドレインパンチ'}).click();assert.ok(await column.evaluate(e=>e.scrollTop<2),'別の技を選ぶとHP欄の位置へ戻る');fs.mkdirSync('e2e-out',{recursive:true});await page.screenshot({path:`e2e-out/hp-visible-${viewport.width}.png`});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('ok iPad 1180/1024: 大きなHP数値・単位・±1・通常/吸収/反動の両HP・記録がスクロールなしで表示・技変更時に位置を戻す');
}finally{await browser?.close();server.close();}
