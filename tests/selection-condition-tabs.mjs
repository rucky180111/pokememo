import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild} from '../src/engine/battle.js';
import {blankClassRules,CLASS_HEADER} from '../src/engine/class-pickrule.js';
const {server,url}=await serve();let browser;
try{
 browser=await chromium.launch();
 for(const width of [1024,390]){
  const page=await browser.newPage({viewport:{width,height:820},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.bottomnav');
  const t=newTeam();t.mons=[{...newBuild('charizard'),item:'charizarditey',moves:['flamethrower']},{...newBuild('garchomp'),item:'garchompitez'},newBuild('rillaboom'),newBuild('kingambit'),newBuild('gholdengo'),newBuild('dragonite')];t.pickRuleMode='class';t.classPickRules=blankClassRules();t.pickRules=[{cond:'アシレーヌ',pick:['rillaboom','kingambit','gholdengo']}];await page.evaluate(t=>window.__pokememo.store.saveTeam(t),t);await page.goto(`${url}#/team/${t.id}`);await page.getByRole('button',{name:'選出条件',exact:true}).click();
  const list=page.getByRole('tablist',{name:'選出条件の方式'});assert.deepEqual(await list.getByRole('tab').allTextContents(),['優先順位','class・代替候補','役割・危険評価']);assert.equal(await list.getByRole('tab',{selected:true}).innerText(),'class・代替候補');
  const edited=CLASS_HEADER+'\n3,アシレーヌ,water,採用,ゴリランダー,any,推奨,1,*,,未評価,対面処理,編集中';await page.getByLabel('classルールCSV',{exact:true}).fill(edited);
  await page.getByRole('tab',{name:'役割・危険評価',exact:true}).click();assert.equal(await page.locator('.selection-editor').isVisible(),true);assert.equal(await page.locator('.class-rules-editor').isVisible(),false);await page.getByRole('tab',{name:'class・代替候補',exact:true}).click();assert.equal(await page.getByLabel('classルールCSV',{exact:true}).inputValue(),edited);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedPrompt=text;}},configurable:true}));await page.getByText('AIに作成を依頼する',{exact:true}).click();
  for(const label of ['優先順位','class・代替候補','役割・危険評価']){
   await page.getByRole('tab',{name:label,exact:true}).click();const prompt=await page.getByLabel('AIに送る依頼文',{exact:true}).inputValue();assert.match(prompt,/リザードン/);assert.match(prompt,/かえんほうしゃ/);assert.ok(!prompt.includes('従来'));if(label==='class・代替候補')assert.match(prompt,/候補はセミコロン/);if(label==='役割・危険評価')assert.match(prompt,/riskRoleLinks/);if(label==='優先順位')assert.match(prompt,/条件,先発,2体目,3体目/);
   await page.getByRole('button',{name:'AI用の依頼文をコピー',exact:true}).click();assert.equal(await page.evaluate(()=>window.copiedPrompt),prompt);
  }
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('unavailable')}},configurable:true}));await page.getByRole('button',{name:'AI用の依頼文をコピー',exact:true}).click();assert.match(await page.locator('.pickrule-ai-help').innerText(),/コピー操作/);
  const saved=await page.evaluate(id=>window.__pokememo.store.team(id),t.id);assert.equal(saved.pickRuleMode,'class');assert.equal(saved.classPickRules.rowsCsv,CLASS_HEADER);assert.deepEqual(saved.pickRules,t.pickRules);assert.ok(!/従来|旧CSV|旧優先/.test(await page.locator('.selection-conditions').innerText()));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);fs.mkdirSync('e2e-out',{recursive:true});await page.screenshot({path:`e2e-out/selection-condition-tabs-${width}.png`});await page.close();
 }
 console.log('ok: 選出条件3タブ・説明整理・入力途中を保持・方式別AI依頼文/コピーと代替操作・保存データ維持・2画面幅');
}finally{await browser?.close();server.close();}
