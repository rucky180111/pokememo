// ブラウザでの通し確認 (Playwright)。node tests/e2e.mjs [出力先ディレクトリ]
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {serve} from './serve.mjs';

const outDir = process.argv[2] || 'e2e-out';
fs.mkdirSync(outDir, {recursive: true});
const {server, url} = await serve();
const browser = await chromium.launch();
const errors = [];
let step = 0;
const check = (cond, msg) => { if (!cond) { errors.push(`NG: ${msg}`); console.log('  NG', msg); } else console.log('  ok', msg); };

async function open(viewport, name) {
  const ctx = await browser.newContext({viewport, deviceScaleFactor: 2, hasTouch: viewport.width < 800, locale: 'ja-JP'});
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('.bottomnav');
  return {ctx, page};
}
const shot = async (page, name) => { await page.screenshot({path: path.join(outDir, `${String(++step).padStart(2, '0')}-${name}.png`)}); };
const pickFrom = async (page, text) => {
  await page.locator('.picker-bar input[type=search]').last().fill(text);
  await page.locator('.picker-list .row').first().click();
};

async function addMon(page, species, item, moves, {nature, sp} = {}) {
  await page.getByRole('button', {name: /ポケモンを追加/}).click();
  await pickFrom(page, species);
  if (item) { await page.locator('.editor .field', {hasText: '持ち物'}).locator('button').click(); await pickFrom(page, item); }
  if (nature) await page.locator('.nature button', {hasText: {Jolly: 'ようき', Timid: 'おくびょう'}[nature]}).click();
  if (sp) for (const [i, v] of Object.entries(sp)) { const inp = page.locator('.sp-num').nth(Number(i)); await inp.fill(String(v)); }
  for (let i = 0; i < moves.length; i++) { await page.locator('.move-grid button').nth(i).click(); await pickFrom(page, moves[i]); }
  await page.getByRole('button', {name: '保存', exact: true}).click();
}

process.on('uncaughtException', async e => {
  console.log('中断:', e.message.split('\n')[0]);
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({path: path.join(outDir, `fail-${Date.now()}.png`)}).catch(() => {});
  console.log(errors.join('\n'));
  process.exit(2);
});
// ---------- スマホ幅 ----------
console.log('スマホ幅 (390x844)');
const {ctx: mctx, page} = await open({width: 390, height: 844}, 'phone');
await shot(page, 'home-empty');
check(await page.getByText('はじめに「構築」で').isVisible(), '初回の案内が出る');

// 構築を作る
await page.getByRole('link', {name: '構築'}).click();
await page.getByRole('button', {name: '新しい構築'}).click();
await page.locator('.form input.input').first().fill('テスト構築');
await page.locator('.form input.input').first().blur();
await addMon(page, 'がぶりあす', 'こだわりスカーフ', ['じしん', 'げきりん', 'いわなだれ', 'つるぎのまい'], {nature: 'Jolly', sp: {1: 32, 5: 32, 0: 2}});
await addMon(page, 'りざーどん', 'リザードナイトY', ['かえんほうしゃ', 'エアスラッシュ', 'ソーラービーム', 'まもる'], {nature: 'Timid', sp: {3: 32, 5: 32}});
await addMon(page, 'がおがえん', 'オボンのみ', ['ねこだまし', 'フレアドライブ', 'じごくづき', 'すてゼリフ'], {sp: {0: 32}});
await shot(page, 'team');
const state1 = await page.evaluate(() => window.__pokememo.store.teams()[0]);
check(state1.mons.length === 3, '構築に3体登録された');
check(state1.mons[0].species === 'garchomp' && state1.mons[0].item === 'choicescarf' && state1.mons[0].nature === 'Jolly', 'ガブリアスの内容が正しい');
check(JSON.stringify(state1.mons[0].sp) === '[2,32,0,0,0,32]', `能力ポイントが入る (${JSON.stringify(state1.mons[0].sp)})`);
check(state1.mons[0].moves.join() === 'earthquake,outrage,rockslide,swordsdance', `技が入る (${state1.mons[0].moves})`);
check(state1.mons[1].item === 'charizarditey', 'メガストーンが入る');
check(await page.getByText('メガシンカ後').count() === 0, '編集パネルが閉じている');

// 能力ポイントの合計上限
await page.locator('.card-main').first().click();
await page.locator('.sp-num').nth(2).fill('32');
await page.locator('.sp-num').nth(3).fill('32');
const spNow = await page.locator('.sp-num').evaluateAll(els => els.map(e => Number(e.value)));
check(spNow.reduce((a, b) => a + b, 0) <= 66, `能力ポイント合計は66を超えない (${spNow})`);
await shot(page, 'mon-editor');
await page.getByRole('button', {name: '閉じる', exact: true}).last().click();

// 対戦を記録
await page.getByRole('button', {name: '対戦を記録'}).click();
await page.waitForSelector('.battle');
await page.locator('.opp-tile.empty').first().click();
for (const n of ['ぼーまんだ', 'ばんぎらす', 'げんがー', 'はっさむ', 'みろかろす', 'どりゅうず']) await pickFrom(page, n);
await page.waitForFunction(() => window.__pokememo.store.battles()[0].opp.length === 6);
check(await page.locator('.overlay').count() === 0, '6体入れたら選択パネルが閉じる');
await shot(page, 'setup');
// 選出
check(await page.locator('.sel-table tbody tr').count() === 3, '選出表が自分3体ぶん出る');
check(await page.locator('.sel-table tbody tr').first().locator('td').count() === 6, '選出表に相手6体ぶんの列');
await page.locator('.sel-mon').nth(0).click(); await page.locator('.sel-mon').nth(2).click(); await page.locator('.sel-mon').nth(1).click();
await shot(page, 'select');
await page.getByRole('button', {name: /この選出で対戦開始/}).click();
await page.waitForSelector('.arena .mon-panel.me');
const pane = async n => { await page.locator('.arena-tabs button', {hasText: n}).click(); };
await pane('入力');
await page.locator('.composer .chip.add', {hasText: 'バンギラス'}).click();
let b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 0 && b.state.sides.opp.active[0] === 1, '初手が場に出る');
check(b.pick.opp.join() === '1', '相手の選出に自動で入る');
check(b.state.field.weather === 'Sand', `バンギラスのすなおこしで砂 (${b.state.field.weather})`);

// 時系列入力: 相手=ステルスロック → 自分=つるぎのまい
await page.locator('.composer .chip', {hasText: 'ステルスロック'}).click();
await page.getByRole('button', {name: '追加', exact: true}).click();
await page.locator('.composer .chip', {hasText: 'つるぎのまい'}).click();
await page.getByRole('button', {name: '追加', exact: true}).click();
await shot(page, 'timeline');
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 1 && b.turns[0].acts.length === 2, '同じターンに2行動が入る');
check(b.state.mons.me[0].boosts.atk === 2, 'つるぎのまいで A+2');
check(b.state.sides.me.sr === true, '自分の場にステルスロック');
check(b.opp[1].moves.includes('stealthrock'), '相手の技が判明済みに入る');
check(await page.locator('.tl-act').count() === 2, '時系列に2行');
// 相手=がんせきふうじ(自分の残り70%) → 自分=じしん(相手の残り20%)。次のターンに自動で進む
await page.locator('.composer .chip', {hasText: 'がんせきふうじ'}).click();
await page.locator('.cp-hp input').fill('70');
await page.getByRole('button', {name: '追加', exact: true}).click();
await page.locator('.composer .chip', {hasText: 'じしん'}).first().click();
await page.locator('.cp-hp input').fill('20');
await page.getByRole('button', {name: '追加', exact: true}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 2 && b.turns[1].acts.length === 2, '次のターンに自動で進む');
check(b.state.mons.me[0].hp === 70 && b.state.mons.opp[1].hp === 20, '残りHPが盤面に反映される');
check(b.state.mons.me[0].boosts.spe === -1, 'がんせきふうじで S-1');
check(b.turns[1].acts.some(a => (a.auto || []).some(x => /実数値|説明がつきません/.test(x))), 'ダメージからの絞り込み結果が時系列に出る');
await page.getByRole('button', {name: 'ターン終了'}).click();
await pane('盤面');
await shot(page, 'arena-center');
check(await page.locator('.mon-panel.opp .mp-table tbody tr').count() === 4, '相手の表に 種族値/推定Pt/能力上昇/実数値');
check(await page.locator('.mon-panel.opp .mp-speed li').count() >= 5, '素早さ一覧に自分の位置が入る');
check(await page.locator('.mon-panel.me .mv-box').count() === 4, '自分の技4つ');
await pane('ダメージ表');
await page.waitForSelector('.dp-move');
await shot(page, 'arena-damage');
check(await page.locator('.dp-move .dp-bar').count() >= 8, '無振り/全振りの2本ずつ帯が出る');
// 取り消し
await pane('入力');
await page.getByRole('button', {name: '戻す'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 1 && b.state.mons.opp[1].hp === 100, '取り消しでターンごと戻る');
// 交代
await page.locator('.composer .seg button', {hasText: '自分'}).click();
await page.locator('.composer .chip', {hasText: 'ガオガエン'}).click();
await page.getByRole('button', {name: '追加', exact: true}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 2 && b.state.mons.opp[1].boosts.atk === -1, '交代でガオガエンが出て、いかくが入る');
// 既存の詳細タブ
await page.getByRole('tab', {name: 'ダメージ表'}).click();
await page.waitForSelector('table.dmg');
check(await page.locator('table.dmg thead th').count() === 7, 'ダメージ表タブは相手6体ぶん');
await page.getByRole('tab', {name: '素早さ'}).click();
await page.waitForSelector('.spd');
await page.getByRole('tab', {name: 'ログ'}).click();
check(await page.locator('.log li').count() === 2, 'ログに2ターン');
await page.getByRole('tab', {name: '② 対戦'}).click();
// 勝敗をつけて統計へ
await page.locator('.battle-head .seg button', {hasText: '勝ち'}).click();
await page.getByRole('link', {name: '統計'}).click();
await shot(page, 'stats');
check((await page.locator('.kpi-v').nth(1).innerText()).trim() === '1-0', '統計に1勝が出る');
await page.getByRole('button', {name: '使用率データ'}).click();
check(await page.locator('.mini.wide tbody tr').count() > 50, '使用率ランキングが出る');
await shot(page, 'usage');
await page.getByRole('link', {name: '設定'}).click();
await shot(page, 'settings');
await page.getByRole('link', {name: '対戦', exact: true}).click();
await page.waitForSelector('.page-head h1');
await page.waitForTimeout(200);
check(await page.locator('.card.link').count() === 1, '対戦一覧に1件');
await shot(page, 'home');

// 再読み込みしてもデータが残る
await page.reload();
await page.waitForSelector('.card.link');
check(await page.evaluate(() => window.__pokememo.store.battles().length === 1 && window.__pokememo.store.teams().length === 1), '再読み込み後もデータが残る');

// 横にはみ出していないか
for (const h of ['#/battles', '#/teams', '#/stats', '#/settings']) {
  await page.goto(url + h);
  await page.waitForTimeout(150);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${h} が横にはみ出さない (${over}px)`);
}
const bid = await page.evaluate(() => window.__pokememo.store.battles()[0].id);
await page.goto(`${url}#/battle/${bid}`);
await page.waitForSelector('.battle');
for (const t of ['① 選出', '② 対戦', 'ダメージ表', '素早さ', '予測', 'ログ']) {
  await page.getByRole('tab', {name: t}).click();
  await page.waitForTimeout(120);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `対戦/${t} が横にはみ出さない (${over}px)`);
}

// ---------- iPad 横 ----------
console.log('iPad 横 (1180x820)');
const dump = await page.evaluate(() => window.__pokememo.store.exportAll());
const {page: ipad} = await open({width: 1180, height: 820}, 'ipad');
await ipad.evaluate(async d => { await window.__pokememo.store.importAll(d); }, dump);
await ipad.goto(`${url}#/battle/${bid}`);
await ipad.waitForSelector('.arena.wide');
check(await ipad.locator('.arena.wide > .ar-left').count() === 1 && await ipad.locator('.arena.wide > .ar-center').count() === 1 && await ipad.locator('.arena.wide > .ar-right').count() === 1, 'iPad横は3列で表示');
await shot(ipad, 'ipad-arena');
const over = await ipad.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(over <= 0, `iPad横で横にはみ出さない (${over}px)`);

await browser.close();
server.close();
console.log(errors.length ? `\n問題 ${errors.length}件:\n${errors.join('\n')}` : '\nすべて通過');
process.exit(errors.length ? 1 : 0);
