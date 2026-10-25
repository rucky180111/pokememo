import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild} from '../src/engine/battle.js';
import {parseTeamCSV} from '../src/engine/team-csv.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1180,height:820},hasTouch:true,acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://play.pokemonshowdown.com/**',r=>r.abort());await page.goto(url);await page.waitForSelector('.bottomnav');const existing=newTeam();existing.name='既存構築';existing.mons=[newBuild('snorlax')];await page.evaluate(t=>window.__pokememo.store.saveTeam(t),existing);await page.goto(`${url}#/teams`);await page.getByRole('button',{name:'CSVでまとめて追加',exact:true}).click();
 const input=page.getByLabel('パーティCSV',{exact:true});await input.fill('ポケモン,H\nガブリアス,252');assert.ok(await page.getByRole('alert').isVisible());assert.ok(await page.getByRole('button',{name:/件の構築を追加$/}).isDisabled());assert.equal(await page.evaluate(()=>window.__pokememo.store.teams().length),1);
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'テンプレートを保存',exact:true}).click();const download=await downloadEvent;const template=await fs.readFile(await download.path(),'utf8');assert.deepEqual(parseTeamCSV(template).errors,[]);
 const csv='構築名,ポケモン,持ち物,技1\n新構築,ガブリアス,きあいのタスキ,じしん\n新構築,カイリュー,たべのこし,しんそく\n別構築,カビゴン,,ねむる';await page.locator('input[type=file]').setInputFiles({name:'parties.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFF'+csv)});await page.getByRole('heading',{name:'追加する構築：2件',exact:true}).waitFor();await page.getByRole('button',{name:'2件の構築を追加',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});const saved=await page.evaluate(()=>window.__pokememo.store.teams());assert.equal(saved.length,3);assert.equal(saved.find(t=>t.id===existing.id).name,'既存構築');assert.equal(saved.find(t=>t.name==='新構築').mons.length,2);assert.equal(saved.find(t=>t.name==='別構築').mons[0].moves[0],'rest');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'CSVでまとめて追加',exact:true}).click();await input.fill('ポケモン\nガブリアス');const textBox=await input.boundingBox();assert.ok(textBox.x>=0&&textBox.x+textBox.width<=390);await page.getByRole('button',{name:'1件の構築を追加',exact:true}).click();assert.equal(await page.evaluate(()=>window.__pokememo.store.teams().length),4);assert.deepEqual(errors,[]);console.log('ok CSV: 入力ミス防止・テンプレート保存・ファイルから複数構築追加・既存構築保持・スマホ貼り付け');
} finally {await browser?.close();server.close();}
