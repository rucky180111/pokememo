import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp} from '../src/engine/battle.js';
import example from '../src/generated/selection-example.json' with {type:'json'};
const {server,url}=await serve();let browser;
try{
 browser=await chromium.launch();
 for(const width of [1180,1024,390]){
  const page=await browser.newPage({viewport:{width,height:820},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.bottomnav');
  const t=newTeam();t.mons=[{...newBuild('charizard'),item:'charizarditey'},{...newBuild('garchomp'),item:'garchompitez'},newBuild('rillaboom'),newBuild('gholdengo'),newBuild('dragonite'),newBuild('kingambit')];t.name='評価v3テスト';
  await page.evaluate(t=>window.__pokememo.store.saveTeam(t),t);await page.goto(`${url}#/team/${t.id}`);await page.getByRole('button',{name:'選出評価',exact:true}).click();const editor=page.locator('.selection-editor');
  await editor.getByRole('button',{name:'仕様書の見本を編集欄へ',exact:true}).click();await editor.getByRole('button',{name:'評価データをまとめて保存',exact:true}).click();let saved=await page.evaluate(id=>window.__pokememo.store.team(id),t.id);assert.equal(saved.selectionAssessment.rules.sampleOnly,true);
  await editor.getByRole('button',{name:'危険CSV',exact:true}).click();await editor.locator('textarea').fill('条件,自分条件,危険ID,対象,場面,減点,理由\nアシレーヌ,,bad,リザードン,対応,30,');assert.ok(await editor.getByRole('button',{name:'評価データをまとめて保存',exact:true}).isDisabled());assert.match(await editor.innerText(),/2行目/);assert.deepEqual((await page.evaluate(id=>window.__pokememo.store.team(id),t.id)).selectionAssessment,saved.selectionAssessment);
  const b=newBattle({team:saved});b.opp=['primarina','excadrill','glimmora','pelipper','corviknight','gengar'].map(newOpp);await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);const hint=page.locator('.selection-assessment');await hint.waitFor();assert.match(await hint.innerText(),/16組・先発込み48候補/);assert.match(await hint.innerText(),/均等な仮定/);assert.match(await hint.innerText(),/説明用の仮点数/);assert.equal(await hint.locator('.assessment-candidate').count(),3);assert.equal(await page.getByText('相手の初手予想',{exact:false}).count(),0);
  await hint.locator('.assessment-candidate').first().getByRole('button',{name:'この選出・先発にする',exact:true}).click();const selected=(await page.evaluate(id=>window.__pokememo.store.battle(id),b.id)).pick.me;assert.equal(selected.length,3);const recorded=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(recorded.selectionRecommendation.dataVersion,saved.selectionAssessment.dataVersion);assert.equal(recorded.selectionRecommendation.totalScore,null);assert.ok(!(selected.includes(0)&&selected.includes(1)));
  await hint.locator('.assessment-candidate').first().locator('summary').click();assert.equal(await hint.locator('.assessment-opening').first().locator('tbody tr').count(),6);assert.match(await hint.innerText(),/未登録の対面/);await hint.getByRole('button',{name:'全48候補を表示',exact:true}).click();assert.equal(await hint.locator('.assessment-candidate').count(),48);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync('e2e-out',{recursive:true});await page.screenshot({path:`e2e-out/selection-v3-${width}.png`});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('ok: 評価データ保存・不正入力の原子性・48候補/上位3・6先発/未評価・選出反映・1180/1024/390px');
}finally{await browser?.close();server.close();}
