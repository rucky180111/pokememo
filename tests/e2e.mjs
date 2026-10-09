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
  if (nature) await page.locator('.editor select').selectOption(nature);
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
await page.getByRole('button', {name: '閉じる'}).click();

// 対戦を記録
await page.getByRole('button', {name: '対戦を記録'}).click();
await page.waitForSelector('.battle');
await page.getByRole('button', {name: /相手のポケモンを追加/}).click();
for (const n of ['ぼーまんだ', 'ばんぎらす', 'げんがー', 'はっさむ', 'みろかろす', 'どりゅうず']) await pickFrom(page, n);
await page.waitForFunction(() => window.__pokememo.store.battles()[0].opp.length === 6);
check(await page.locator('.overlay').count() === 0, '6体入れたら選択パネルが閉じる');
await shot(page, 'setup');
// 選出
const myRows = page.locator('.party').nth(1).locator('.pick-no');
await myRows.nth(0).click(); await myRows.nth(2).click(); await myRows.nth(1).click();
const oppRows = page.locator('.party').nth(0).locator('.pick-no');
await oppRows.nth(1).click();
await page.getByRole('button', {name: '6×6 相性表を見る'}).click();
await page.waitForSelector('.matrix');
await shot(page, 'matrix');
check(await page.locator('.matrix tbody tr').count() === 3, '相性表が自分3体ぶん出る');
await page.getByRole('button', {name: '初手を場に出して開始'}).click();
await page.waitForSelector('.board .moncard');
let b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 0 && b.state.sides.opp.active[0] === 1, '初手が場に出る');
check(b.state.field.weather === 'Sand', `バンギラスのすなおこしで砂 (${b.state.field.weather})`);
await shot(page, 'board');

// ターンを記録: 自分=つるぎのまい, 相手=ステルスロック
await page.getByRole('button', {name: 'このターンの行動を記録'}).click();
await page.locator('.turn-row.me .chip', {hasText: 'つるぎのまい'}).click();
await page.locator('.turn-row.opp .chip.add').click();
await pickFrom(page, 'すてるすろっく');
await shot(page, 'turn-sheet');
await page.getByRole('button', {name: '記録する'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 1 && b.turns[0].acts.length === 2, 'ターンが記録された');
check(b.state.mons.me[0].boosts.atk === 2, 'つるぎのまいで A+2');
check(b.state.sides.me.sr === true, '自分の場にステルスロック');
check(b.opp[1].moves.includes('stealthrock'), '相手の技が判明済みに入る');

// HP を変える (スライダー)
const slider = page.locator('.side.opp .hp input[type=range]').first();
await slider.evaluate(el => { el.value = '40'; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); });
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.mons.opp[1].hp === 40, '相手のHPを40%に');

// ダメージ表
await page.getByRole('tab', {name: 'ダメージ'}).click();
await page.waitForSelector('table.dmg');
await shot(page, 'damage');
const cols = await page.locator('table.dmg thead th').count();
check(cols === 7, `ダメージ表は相手6体ぶん (${cols - 1})`);
const cellText = await page.locator('table.dmg tbody tr').first().locator('td').first().innerText();
check(/%/.test(cellText), `ダメージが表示される (${cellText.replace(/\n/g, ' ')})`);
await page.locator('table.dmg tbody tr').first().locator('td .cell').first().click();
await page.waitForSelector('.sheet .big');
await shot(page, 'damage-detail');
check(await page.locator('.sheet .mini tbody tr').count() >= 3, '耐久を変えた比較が出る');
await page.getByRole('button', {name: '閉じる'}).click();
await page.getByRole('button', {name: /被ダメージ/}).click();
await page.waitForSelector('table.dmg');
await shot(page, 'damage-taken');
check(await page.locator('table.dmg tbody tr').count() >= 1, '被ダメージ表に相手の候補技が出る');
check(await page.locator('table.dmg .tag', {hasText: '確定'}).count() === 1, '判明済みの技に「確定」が付く');

// 素早さ・予測・ログ
await page.getByRole('tab', {name: '素早さ'}).click();
await page.waitForSelector('.spd');
await shot(page, 'speed');
check((await page.locator('.box h4 .big-num').first().innerText()).trim() === '253', 'スカーフガブリアスの素早さ 253');
await page.getByRole('tab', {name: '予測'}).click();
await page.waitForSelector('.bars');
await shot(page, 'predict');
await page.getByRole('tab', {name: 'ログ'}).click();
check(await page.locator('.log li').count() === 1, 'ログに1ターン');
await shot(page, 'log');

// 交代を記録 → 取り消し
await page.getByRole('tab', {name: '盤面'}).click();
await page.getByRole('button', {name: 'このターンの行動を記録'}).click();
await page.locator('.turn-row.me .chips').nth(1).locator('.chip', {hasText: 'ガオガエン'}).click();
await page.getByRole('button', {name: '記録する'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 2, '交代でガオガエンが場に');
check(b.state.mons.me[0].boosts.atk === 0, '下がったガブリアスのランクが戻る');
await page.getByRole('button', {name: '戻す'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 1 && b.state.sides.me.active[0] === 0 && b.state.mons.me[0].boosts.atk === 2, '取り消しで元の盤面に戻る');

// メガシンカのトグル (リザードンを出してから)
await page.locator('.side.me .mc-top .btn', {hasText: '入替'}).click();
await page.locator('.sheet .row', {hasText: 'リザードン'}).click();
await page.locator('.side.me .toggle', {hasText: 'メガシンカ'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.mons.me[1].forme === 'charizardmegay' && b.state.field.weather === 'Sun', 'メガリザードンY で晴れ');
await shot(page, 'board-mega');

// 相手の情報入力
await page.locator('.side.opp .mc-name').click();
await page.waitForSelector('.sheet .editor');
await shot(page, 'opp-sheet');
await page.locator('.sheet .chip', {hasText: 'HB特化'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.opp[1].assume.kind === 'preset' && b.opp[1].assume.key === 'hb', '相手の想定型を切り替えられる');
await page.getByRole('button', {name: '閉じる'}).click();

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
for (const t of ['見せ合い', '盤面', 'ダメージ', '素早さ', '予測', 'ログ']) {
  await page.getByRole('tab', {name: t}).click();
  await page.waitForTimeout(120);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `対戦/${t} が横にはみ出さない (${over}px)`);
}

// ---------- iPad 横 ----------
console.log('iPad 横 (1180x820)');
const state = await mctx.storageState();
void state;
const dump = await page.evaluate(() => window.__pokememo.store.exportAll());
const {page: ipad} = await open({width: 1180, height: 820}, 'ipad');
await ipad.evaluate(async d => { await window.__pokememo.store.importAll(d); }, dump);
await ipad.goto(`${url}#/battle/${bid}`);
await ipad.waitForSelector('.battle-cols');
check(await ipad.locator('.col-board .moncard').count() >= 2, '2カラム表示で盤面が左に出る');
check(await ipad.locator('table.dmg').count() === 1, '右にダメージ表が出る');
await shot(ipad, 'ipad-battle');

// ダブルの仮想盤面
await ipad.goto(url + '#/teams');
await ipad.locator('.card.link').first().click();
await ipad.locator('.form .seg button', {hasText: 'ダブル'}).click();
await ipad.getByRole('button', {name: '仮想盤面'}).click();
await ipad.waitForSelector('.battle');
await ipad.getByRole('button', {name: /相手のポケモンを追加/}).click();
for (const n of ['がおがえん', 'ぺりっぱー', 'ふしぎばな', 'がぶりあす', 'みみっきゅ', 'さーないと']) {
  await ipad.locator('.picker-bar input[type=search]').last().fill(n);
  const rows = ipad.locator('.picker-list .row');
  if (await rows.count()) await rows.first().click();
}
await ipad.waitForFunction(() => window.__pokememo.store.battles().find(x => x.kind === 'sim').opp.length === 6);
const dbl = await ipad.evaluate(() => window.__pokememo.store.battles().find(x => x.kind === 'sim'));
check(dbl && dbl.format === 'double' && dbl.state.sides.me.active.length === 2, 'ダブルの仮想盤面は場が2枠');
console.log('  ダブルの相手:', dbl.opp.map(o => o.species).join(','));
const myNo = ipad.locator('.party').nth(1).locator('.pick-no');
await myNo.nth(0).click(); await myNo.nth(1).click(); await myNo.nth(2).click();
const opNo = ipad.locator('.party').nth(0).locator('.pick-no');
await opNo.nth(0).click(); await opNo.nth(1).click();
await ipad.getByRole('button', {name: '初手を場に出して開始'}).click();
await ipad.waitForSelector('.side.opp .moncard:not(.empty)');
const d2 = await ipad.evaluate(() => window.__pokememo.store.battles().find(x => x.kind === 'sim'));
check(d2.state.sides.me.active.join() === '0,1' && d2.state.sides.opp.active.join() === '0,1', 'ダブルの初手2体ずつ');
check(d2.state.mons.me[0].boosts.atk === -1 && d2.state.mons.me[1].boosts.atk === -1, `相手ガオガエンのいかくが2体に入る (${d2.state.mons.me[0].boosts.atk},${d2.state.mons.me[1].boosts.atk})`);
await shot(ipad, 'ipad-double');
await ipad.getByRole('button', {name: 'このターンの行動を記録'}).click();
await ipad.waitForSelector('.turn-row');
check(await ipad.locator('.turn-row').count() === 4, 'ダブルは4体ぶんの行動欄');
await ipad.locator('.turn-row.me').first().locator('.chip', {hasText: 'じしん'}).click();
await ipad.locator('.turn-row.me').nth(1).locator('.chip', {hasText: 'かえんほうしゃ'}).click();
await shot(ipad, 'ipad-turn');
check(await ipad.locator('.turn-row.me', {hasText: '対象:'}).count() === 1, '単体技だけ対象を選べる (じしんは範囲技)');
await ipad.getByRole('button', {name: '記録する'}).click();
const d3 = await ipad.evaluate(() => window.__pokememo.store.battles().find(x => x.kind === 'sim'));
check(d3.turns.length === 1, 'ダブルのターンが記録された');

// 統計に仮想盤面は含めない
await ipad.goto(url + '#/stats');
await ipad.locator('.page-head .seg button', {hasText: 'ダブル'}).click();
check((await ipad.locator('.kpi-v').first().innerText()).trim() === '0', '仮想盤面は統計に含まれない');

await browser.close();
server.close();
console.log(errors.length ? `\n問題 ${errors.length}件:\n${errors.join('\n')}` : '\nすべて通過');
process.exit(errors.length ? 1 : 0);
