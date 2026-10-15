// iPad横向きで、回復と味方対象の入力を盤面から検証する。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {newTeam,newBuild,newBattle,newOpp,normalizeBattle,sendOut,setHP} from '../src/engine/battle.js';
import {dex} from '../src/engine/dex.js';
const {server,url}=await serve();let browser;
try {
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1180,height:820}});
 await context.route('https://play.pokemonshowdown.com/**',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(new URL('../docs/icon-192.png',import.meta.url))}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForSelector('.bottomnav');
 async function open(format,builds,hp=20,foe='garchomp'){
  const team=newTeam({format});team.mons=builds;const b=newBattle({team,format});b.opp=[newOpp(foe),newOpp('clefable')];normalizeBattle(b);sendOut(b,'me',0,0);sendOut(b,'opp',0,0);
  if(format==='double'){sendOut(b,'me',1,1);sendOut(b,'opp',1,1);setHP(b,'me',1,20);}
  setHP(b,'me',0,hp);b.opp[0].ability=dex.species[foe].ab[0];
  await page.evaluate(b=>window.__pokememo.store.saveBattle(b),b);await page.goto(`${url}#/battle/${b.id}`);await page.locator('.pl.me').first().waitFor();return b;
 }
 const sap=await open('single',[{...newBuild('arboliva'),moves:['strengthsap','gigadrain','painsplit','leechseed']}]);const mine=page.locator('.pl.me').first();
 await mine.locator('.pl-mv',{hasText:'ちからをすいとる'}).click();
 assert.equal(await mine.getByLabel('自分 オリーヴァの行動後HP',{exact:true}).inputValue(),'');
 assert.ok(await mine.getByRole('button',{name:'記録',exact:true}).isDisabled());
 await mine.getByLabel('自分 オリーヴァの行動後HP',{exact:true}).fill('100');
 await mine.getByRole('button',{name:'自分 オリーヴァの行動後HPを1増やす',exact:true}).click();
 assert.equal(await mine.getByLabel('自分 オリーヴァの行動後HP',{exact:true}).inputValue(),'101');
 await mine.getByRole('button',{name:'記録',exact:true}).click();
 let saved=await page.evaluate(id=>window.__pokememo.store.battle(id),sap.id);assert.ok(Math.abs(saved.state.mons.me[0].hp-101/153*100)<1e-9);assert.ok(!saved.state.mons.me[0].hpUnknown);assert.equal(saved.state.mons.opp[0].boosts.atk,-1);assert.equal(await mine.getByText('HP未確認',{exact:true}).count(),0);
 await page.getByRole('button',{name:'1つ戻す',exact:true}).click();saved=await page.evaluate(id=>window.__pokememo.store.battle(id),sap.id);assert.equal(saved.state.mons.me[0].hp,20);await mine.locator('.pl-mv',{hasText:'ちからをすいとる'}).click();await mine.getByRole('button',{name:'HP不明で記録',exact:true}).click();saved=await page.evaluate(id=>window.__pokememo.store.battle(id),sap.id);assert.equal(saved.state.mons.me[0].hp,20);assert.ok(saved.state.mons.me[0].hpUnknown);console.log('ok iPad: ちからをすいとるの実測HP・1ずつ調整・取り消し・未入力');
 await page.getByRole('button',{name:'1つ戻す',exact:true}).click();
 await mine.locator('.pl-mv',{hasText:'ギガドレイン'}).click();
 await mine.getByLabel('残りHP',{exact:true}).fill('50');
 assert.ok(await mine.getByRole('button',{name:'記録',exact:true}).isDisabled());
 await mine.getByLabel('自分 オリーヴァの行動後HP',{exact:true}).fill('100');
 await mine.getByRole('button',{name:'記録',exact:true}).click();
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),sap.id);assert.equal(saved.state.mons.opp[0].hp,50);assert.ok(Math.abs(saved.state.mons.me[0].hp-100/153*100)<1e-9);assert.ok(!saved.state.mons.me[0].hpUnknown);
 await page.getByRole('button',{name:'1つ戻す',exact:true}).click();
 await mine.locator('.pl-mv',{hasText:'ギガドレイン'}).click();
 await mine.getByLabel('残りHP',{exact:true}).fill('50');await mine.getByRole('button',{name:'HP不明で記録',exact:true}).click();
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),sap.id);assert.equal(saved.state.mons.opp[0].hp,50);assert.ok(!saved.state.mons.opp[0].hpUnknown);assert.equal(saved.state.mons.me[0].hp,20);assert.ok(saved.state.mons.me[0].hpUnknown);
 await page.getByRole('button',{name:'1つ戻す',exact:true}).click();
 await mine.locator('.pl-mv',{hasText:'いたみわけ'}).click();
 await mine.getByLabel('自分 オリーヴァの行動後HP',{exact:true}).fill('80');
 await mine.getByLabel('相手 ガブリアスの行動後HP',{exact:true}).fill('70');
 await mine.getByRole('button',{name:'記録',exact:true}).click();
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),sap.id);assert.equal(saved.state.mons.opp[0].hp,70);assert.ok(Math.abs(saved.state.mons.me[0].hp-80/153*100)<1e-9);
 await page.getByRole('button',{name:'1つ戻す',exact:true}).click();
 await mine.locator('.pl-mv',{hasText:'やどりぎのタネ'}).click();await mine.getByRole('button',{name:'記録',exact:true}).click();
 await page.getByLabel('自分 オリーヴァのターン終了後HP',{exact:true}).fill('60');
 await page.screenshot({path:'e2e-out/observed-end-hp-ipad.png'});
 await page.getByRole('button',{name:'未入力のまま次へ',exact:true}).click();await page.getByRole('button',{name:'次のターンへ',exact:true}).click();
 await page.waitForFunction(id => window.__pokememo.store.battle(id).turns[0]?.open === false, sap.id);
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),sap.id);assert.ok(Math.abs(saved.state.mons.me[0].hp-60/153*100)<1e-9);assert.ok(!saved.state.mons.me[0].hpUnknown);
 console.log('ok iPad: 吸収・いたみわけ・やどりぎの実測HPを記録');
 const inferred=await open('single',[{...newBuild('arboliva'),sp:[32,0,0,0,0,0],moves:['strengthsap']}],10);
 await mine.locator('.pl-mv',{hasText:'ちからをすいとる'}).click();await mine.getByLabel('自分 オリーヴァの行動後HP',{exact:true}).fill('169');await mine.getByRole('button',{name:'記録',exact:true}).click();
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),inferred.id);assert.ok(saved.opp[0].statOk.atk.includes('1'));
 const attackCell=page.locator('.pl.opp .mp-table tr.real td').nth(1);assert.ok((await attackCell.getAttribute('class')).includes('known'));assert.match(await attackCell.innerText(),/100.*150/s);
 await page.screenshot({path:'e2e-out/inferred-attack-ipad.png'});
 const split=await open('single',[{...newBuild('gengar'),sp:[32,0,0,0,0,0],moves:['painsplit']}],40/167*100,'snorlax');
 await mine.locator('.pl-mv',{hasText:'いたみわけ'}).click();await mine.getByLabel('自分 ゲンガーの行動後HP',{exact:true}).fill('145');await mine.getByLabel('相手 カビゴンの行動後HP',{exact:true}).fill('58');await mine.getByRole('button',{name:'記録',exact:true}).click();
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),split.id);assert.equal(saved.opp[0].statOk.hp,'0'.repeat(15)+'1'+'0'.repeat(17));assert.equal(await page.locator('.pl.opp .mp-table tr.real td').first().innerText(),'250');
 console.log('ok iPad: 回復から攻撃150・いたみわけから最大HP250を確定して能力表へ反映');
 const doubles=await open('double',[{...newBuild('clefable'),moves:['lifedew','healpulse']},{...newBuild('garchomp'),moves:['earthquake']}]);
 await mine.locator('.pl-mv',{hasText:'いのちのしずく'}).click();await mine.getByRole('button',{name:'記録',exact:true}).click();
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),doubles.id);assert.ok(saved.state.mons.me.every(c=>c.hp>20));assert.equal(saved.state.mons.opp[0].hp,100);
 await page.getByRole('button',{name:'1つ戻す',exact:true}).click();
 await mine.locator('.pl-mv',{hasText:'いやしのはどう'}).click();
 // 同じ種族が相手にもいるため、自分/相手のラベルで味方を選ぶ。
 await mine.locator('.pa-h').getByRole('button',{name:'自分 ガブリアス',exact:true}).click();await mine.getByRole('button',{name:'記録',exact:true}).click();
 saved=await page.evaluate(id=>window.__pokememo.store.battle(id),doubles.id);assert.equal(saved.state.mons.me[0].hp,20);assert.ok(saved.state.mons.me[1].hp>60);assert.equal(saved.state.mons.opp[0].hp,100);
 assert.deepEqual(errors,[]);await page.screenshot({path:'e2e-out/effects-ipad.png'});console.log('ok iPad: いのちのしずく・いやしのはどうの味方対象');
 await context.close();
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
