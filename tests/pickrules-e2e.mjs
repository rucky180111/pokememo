// 選出ルールのブラウザ確認 (Playwright)。node tests/pickrules-e2e.mjs [出力先]
import {chromium} from 'playwright';
import fs from 'node:fs';
import {serve} from './serve.mjs';

const out = process.argv[2] || 'e2e-out';
fs.mkdirSync(out, {recursive: true});
const {server, url} = await serve();
const browser = await chromium.launch();
const errors = [];
const check = (c, m) => { console.log(c ? '  ok' : '  NG', m); if (!c) errors.push(m); };
const sample = fs.readFileSync(new URL('./fixtures/pickrules-sample.txt', import.meta.url), 'utf8');
const mon = (species, item) => ({species, item, ability: '', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: ''});
const team = {id: 'prtest', name: '選出ルール確認', format: 'single', memo: '', createdAt: 1, updatedAt: 1,
  mons: [mon('empoleon', 'shucaberry'), mon('garchomp', 'garchompitez'), mon('rillaboom', 'miracleseed'), mon('gholdengo', 'airballoon'), mon('dragonite', 'rockyhelmet'), mon('kingambit', 'lumberry')]};

const idb = (page, fn, arg) => page.evaluate(([src, a]) => new Promise((res, rej) => {
  const r = indexedDB.open('pokememo', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const db = r.result; const t = db.transaction('kv', 'readwrite'); const s = t.objectStore('kv'); const f = new Function('s', 'a', src); const v = f(s, a); t.oncomplete = () => res(v?.result ?? null); t.onerror = () => rej(t.error); };
  r.onerror = () => rej(r.error);
}), [fn, arg]);

for (const [vw, name] of [[{width: 390, height: 844}, 'phone'], [{width: 1180, height: 820}, 'tablet']]) {
  const ctx = await browser.newContext({viewport: vw, locale: 'ja-JP'});
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/play\.pokemonshowdown|Failed to load resource/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('.bottomnav');
  await idb(page, 's.put(a, "team:" + a.id)', team);
  await page.goto(`${url}#/team/prtest`);
  await page.reload();
  await page.waitForSelector('.page-head');
  await page.getByRole('button', {name: /^選出ルール/}).click();
  await page.getByRole('button', {name: 'まとめて入力・書き出し'}).click();
  await page.locator('.pr-bulk').fill(sample);
  await page.getByRole('button', {name: 'この内容で置き換える'}).click();
  await page.waitForTimeout(200);
  check(await page.locator('.pr-row').count() === 19, `${name}: 19行のルールが入る`);
  check(await page.locator('.pr-err').count() === 0, `${name}: 条件のエラーなし`);
  check(await page.getByRole('button', {name: '選出ルール (19)'}).count() === 1, `${name}: タブに件数`);
  await page.screenshot({path: `${out}/pickrules-editor-${name}.png`, fullPage: true});
  // 並べ替え: 2行目を上へ
  await page.locator('.pr-row').nth(1).getByRole('button', {name: '上へ'}).click();
  check((await page.locator('.pr-row').nth(0).locator('input').first().inputValue()) === 'ゴリランダー', `${name}: 並べ替え`);
  await page.locator('.pr-row').nth(1).getByRole('button', {name: '上へ'}).click();
  // 対戦を始めて、相手6体を入れる
  await page.getByRole('button', {name: '対戦を記録'}).click();
  await page.waitForURL(/#\/battle\//);
  const bid = page.url().split('#/battle/')[1].split(/[?/]/)[0];
  await page.waitForTimeout(300);
  await idb(page, 'const g = s.get("battle:" + a); g.onsuccess = () => { const b = g.result; b.opp = ["lucario","mimikyu","hippowdon","basculegion","dragonite","toxapex"].map(x => ({species: x, item: "", ability: "", moves: [], assume: {kind: "usage", idx: 0}, note: "", speOk: null, megaSeen: false})); s.put(b, "battle:" + a); };', bid);
  await page.reload();
  await page.waitForSelector('.pr-hint');
  const txt = await page.locator('.pr-hint').innerText();
  check(/選出ルール\s*4/.test(txt) && /ゴリランダー/.test(txt) && /先発/.test(txt), `${name}: ルカリオ+ゴーストで4行目が出る`);
  await page.getByRole('button', {name: 'この選出にする'}).click();
  await page.waitForTimeout(200);
  const order = await page.locator('.sel-mon.on').evaluateAll(els => els.map(e => [e.querySelector('.no').textContent, e.querySelector('.nm').textContent]).sort());
  check(JSON.stringify(order) === JSON.stringify([['1', 'ゴリランダー'], ['2', 'ガブリアス'], ['3', 'ドドゲザン']]), `${name}: この選出にする で順番どおり選ばれる ${JSON.stringify(order)}`);
  check(await page.getByRole('button', {name: 'この選出になっています'}).count() === 1, `${name}: 反映済みの表示`);
  await page.screenshot({path: `${out}/pickrules-select-${name}.png`, fullPage: false});
  await ctx.close();
}
await browser.close();
server.close();
console.log(errors.length ? `NG ${errors.length}件\n${errors.join('\n')}` : 'すべてOK');
process.exit(errors.length ? 1 : 0);
