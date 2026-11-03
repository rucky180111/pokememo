import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp} from '../src/engine/battle.js';
import {blankClassRules,CLASS_HEADER} from '../src/engine/class-pickrule.js';
import example from '../src/generated/selection-example.json' with {type:'json'};
const {server,url}=await serve();let browser;
try{
 browser=await chromium.launch();
 for(const width of [1024,390]){
  const page=await browser.newPage({viewport:{width,height:820},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.bottomnav');
  const t=newTeam();t.mons=[{...newBuild('charizard'),item:'charizarditey'},{...newBuild('garchomp'),item:'garchompitez'},newBuild('rillaboom'),newBuild('kingambit'),newBuild('gholdengo'),newBuild('dragonite')];t.pickRules=[{cond:'*',pick:['rillaboom','kingambit','gholdengo']}];t.classPickRules=blankClassRules();t.classPickRules.rowsCsv=CLASS_HEADER+'\n3,イエッサン,terrain,採用,ゴリランダー,any,推奨,1,*,,確認済み,対面処理,テスト';t.selectionAssessment=structuredClone(example);
  const b=newBattle({team:t});b.opp=['indeedee','primarina','gengar','pelipper','corviknight','glimmora'].map(newOpp);await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);const area=page.locator('.selection-comparison'),tabs=area.getByRole('tablist');assert.equal(await tabs.getByRole('tab').count(),3);const before=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);
  for(const label of ['class・代替候補','役割・危険評価','優先順位']){await tabs.getByRole('tab',{name:label,exact:true}).click();assert.deepEqual(await page.evaluate(id=>window.__pokememo.store.battle(id),b.id),before);}
  await area.getByRole('button',{name:'この選出にする',exact:true}).click();let r=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(r.pickRuleMode,'legacy');assert.deepEqual(r.pick.me,[2,3,4]);assert.deepEqual(r.selectionDecision.matchedRows,[0]);
  await tabs.getByRole('tab',{name:'class・代替候補',exact:true}).click();const card=area.locator('.class-pick-hint .assessment-candidate').first();await card.locator('.chips .btn').nth(1).click();await card.getByRole('button',{name:'この3体と先発を使う',exact:true}).click();r=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(r.pickRuleMode,'class');assert.equal(r.selectionDecision.mode,'class');assert.ok(r.selectionDecision.details.length);
  await tabs.getByRole('tab',{name:'役割・危険評価',exact:true}).click();await area.getByRole('button',{name:'この選出・先発にする',exact:true}).first().click();r=await page.evaluate(id=>window.__pokememo.store.battle(id),b.id);assert.equal(r.pickRuleMode,'assessment');assert.equal(r.selectionDecision.totalScore,null);assert.equal(r.selectionRecommendation.dataVersion,t.selectionAssessment.dataVersion);assert.ok(r.pickRules.length);assert.ok(r.classPickRules);
  fs.mkdirSync('e2e-out',{recursive:true});await page.screenshot({path:`e2e-out/selection-comparison-configured-${width}.png`});
  r.state.sides.opp.active=[0];await page.evaluate(b=>window.__pokememo.store.saveBattle(b),r);await page.reload();await page.getByRole('tab',{name:'選出',exact:true}).click();for(const label of ['優先順位','class・代替候補','役割・危険評価']){await page.locator('.selection-comparison').getByRole('tab',{name:label,exact:true}).click();assert.equal(await area.getByRole('button',{name:/^(この選出にする|この3体と先発を使う|この選出・先発にする)$/}).count(),0);}
  const empty=newBattle({team:{...t,pickRules:[],classPickRules:null,selectionAssessment:null}});empty.opp=b.opp;await page.evaluate(b=>window.__pokememo.store.saveBattle(b),empty);await page.goto(`${url}#/battle/${empty.id}`);for(const label of ['優先順位','class・代替候補','役割・危険評価']){await page.locator('.selection-comparison').getByRole('tab',{name:label,exact:true}).click();assert.match(await page.locator('.selection-comparison').innerText(),/この方式の条件は未登録/);}
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync('e2e-out',{recursive:true});await page.screenshot({path:`e2e-out/selection-comparison-${width}.png`});await page.close();
 }
 console.log('ok 選出3方式: 閲覧のみで変更なし・各方式の適用と根拠保存・単体対戦でも比較・未登録表示・開始後適用不可・iPad/スマホ');
}finally{await browser?.close();server.close();}
