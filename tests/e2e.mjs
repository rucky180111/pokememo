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
  // 外部のスプライトはテストでは取得できないので、手元のアイコン画像で代用する (レイアウト確認用)
  const placeholder = fs.readFileSync(new URL('../docs/icon-192.png', import.meta.url));
  await ctx.route('https://play.pokemonshowdown.com/**', r => r.fulfill({status: 200, contentType: 'image/png', body: placeholder}));
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('.bottomnav');
  return {ctx, page};
}
// パネルが出ていないのに背景のスクロールが止まったままになっていないか
const scrollOK = async (page, where) => {
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({overlays: document.querySelectorAll('.overlay').length, body: document.body.style.overflow, html: getComputedStyle(document.documentElement).overflowY}));
  check(r.overlays > 0 || (r.body !== 'hidden' && r.html !== 'hidden'), `${where}: 背景がスクロールできる状態 (overlay ${r.overlays}, body "${r.body}")`);
};
// 実際に縦スクロールが効くか (内容が画面より長いとき)
const canScroll = async (page, where) => {
  const r = await page.evaluate(async () => {
    const need = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, 0); window.scrollTo(0, 400);
    await new Promise(f => setTimeout(f, 50));
    const y = window.scrollY; window.scrollTo(0, 0);
    return {need, y};
  });
  check(r.need <= 4 || r.y > 0, `${where}: 縦スクロールが効く (必要 ${r.need}px, 動いた ${r.y}px)`);
};
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
await scrollOK(page, '構築 (3体追加後)');
await canScroll(page, '構築');
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
// 編集パネルの中で選択パネルを開いて、外側ごと閉じても背景が固まらない
await page.locator('.editor .field', {hasText: '持ち物'}).locator('button').click();
await page.waitForSelector('.picker-bar');
await page.waitForTimeout(250);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
await page.getByRole('button', {name: '閉じる', exact: true}).last().click();
await scrollOK(page, '構築 (編集を閉じた後)');
await canScroll(page, '構築 (編集後)');

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
await pane('ターン入力');
await page.locator('.composer .tc-box.warn .mon-btn', {hasText: 'バンギラス'}).click();
let b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 0 && b.state.sides.opp.active[0] === 1, '初手が場に出る');
check(b.pick.opp.join() === '1', '相手の選出に自動で入る');
check(await page.locator('.tc-box.ask', {hasText: 'バンギラス'}).count() === 1, '場に出たら特性が表示されたかを聞く');
await page.locator('.tc-box.ask .chip', {hasText: 'すなおこし'}).click();
check((await page.evaluate(() => window.__pokememo.store.battles()[0].opp[1].ability)) === 'sandstream' && await page.locator('.tc-box.ask').count() === 0, '選ぶと特性が確定して質問が消える');
check(b.state.field.weather === 'Sand', `バンギラスのすなおこしで砂 (${b.state.field.weather})`);
const realActs = t => t.acts.filter(a => a.type !== 'event').length;

// ターン1: ① 自分=つるぎのまい を先に選ぶ → ② 相手が先に ステルスロック → 自分
await page.locator('.composer .plan .mv-btn', {hasText: 'つるぎのまい'}).click();
check(await page.locator('.actor-btn').count() === 2, '技を選ぶと ② の画面に進む');
check(await page.locator('.mega-row .mega-btn', {hasText: 'バンギラス'}).count() === 1, '② の画面に相手のメガシンカのボタンが出る');
await page.locator('.actor-btn.opp').click();
await page.locator('.actform .mv-btn', {hasText: 'ステルスロック'}).click();
check(await page.locator('.oc-btn').count() === 4, '技を選ぶと結果の画面に進む');
await page.locator('.oc-btn.hit').click();
await page.locator('.actor-btn.me').click();
check((await page.locator('.wz-sub').innerText()).includes('つるぎのまい'), '自分の行動は①で選んだ技の結果から始まる');
await page.locator('.wz-back').click();
check(await page.locator('.actform .mv-btn.on', {hasText: 'つるぎのまい'}).count() === 1, '戻るで技の選択に戻れる');
await page.locator('.actform .mv-btn', {hasText: 'つるぎのまい'}).click();
await page.locator('.oc-btn.hit').click();
await shot(page, 'timeline');
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 1 && realActs(b.turns[0]) === 2, '同じターンに2行動が入る');
check(b.state.mons.me[0].boosts.atk === 2, 'つるぎのまいで A+2');
check(b.state.sides.me.sr === true, '自分の場にステルスロック');
check(b.opp[1].moves.includes('stealthrock'), '相手の技が判明済みに入る');
check(await page.locator('.tl-act').count() === 3, '時系列に3行 (場に出す + 2行動)');
check(await page.getByRole('button', {name: /ターンを終える/}).count() === 1, '全員記録したら ③ ターン終了の画面に進む');
await shot(page, 'endturn');
await page.getByRole('button', {name: 'ターンを終える'}).click();
// ターン2: 相手=がんせきふうじ (自分の残り70) → 自分=じしん (相手の残り20%)
await page.locator('.composer .plan .mv-btn', {hasText: 'じしん'}).click();
await page.locator('.actor-btn.opp').click();
await page.locator('.actform .mv-btn', {hasText: 'がんせきふうじ'}).click();
await page.locator('.oc-btn.hit').click();
await page.locator('.af-hp input').fill('70');
await page.locator('.actform .btn.primary').click();
await page.locator('.actor-btn.me').click();
await page.locator('.oc-btn.hit').click();
// 自分のじしんのダメージは「わからない」で飛ばし、ターン終了時にHPを入れて逆算する
await page.locator('.actform .chip.unk').click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 2 && realActs(b.turns[1]) === 2, '2ターン目に2行動');
check(Math.round(b.state.mons.me[0].hp) === Math.round(70 / 185 * 100) && b.state.mons.opp[1].hp === 100 && b.turns[1].acts.some(a => a.hpUnknown), `残りHPが盤面に反映され、分からないHPは保留 (${b.state.mons.me[0].hp})`);
check(b.state.mons.me[0].boosts.spe === -1, 'がんせきふうじで S-1');
check(b.turns[1].acts.some(a => (a.auto || []).some(x => /実数値|説明がつきません/.test(x))), 'ダメージからの絞り込み結果が時系列に出る');
// あとから修正: 相手のがんせきふうじの残りHPを 80 に直す
await page.locator('.tl-turn').nth(1).locator('.tl-act').first().click();
await page.locator('.overlay .af-hp input').fill('80');
await page.getByRole('button', {name: 'この内容で直す'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(Math.round(b.state.mons.me[0].hp) === Math.round(80 / 185 * 100) && b.state.mons.opp[1].hp === 100 && b.state.mons.me[0].boosts.atk === 2, `修正が反映され、ほかの記録は残る (${b.state.mons.me[0].hp})`);
check(await page.locator('.res-group.need').count() === 1, 'ターン終了時に「HPは?」と聞かれる');
await page.locator('.res-group.need .rg-hp input').fill('20');
await page.getByRole('button', {name: 'ターンを終える'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.mons.opp[1].hp === 20 && b.turns[1].acts.some(a => a.move === 'earthquake' && a.hpAfter === 20 && !a.hpUnknown), `ターン終了後のHPからダメージを逆算してバトルログを更新 (${b.state.mons.opp[1].hp})`);
// 出来事: 相手のオボンのみ発動 (+25%)
await page.locator('.composer .cp-head .seg button', {hasText: 'その他の変化'}).click();
await page.locator('.ev .seg button', {hasText: '相手'}).click();
await page.locator('.ev .chip', {hasText: 'オボンのみ'}).click();
await page.locator('.ev .btn.primary', {hasText: '追加'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.opp[1].item === 'sitrusberry' && b.state.mons.opp[1].itemGone && b.state.mons.opp[1].hp === 45, `オボン発動で持ち物確定・消費・HP+25% (${b.state.mons.opp[1].hp})`);
check(await page.locator('.tl-act', {hasText: 'オボンのみ 発動'}).count() === 1, '時系列に持ち物の発動が出る');
await page.locator('.composer .cp-head .seg button', {hasText: '行動'}).click();
await pane('盤面');
check(await page.locator('.mon-panel input, .mon-panel select, .ar-field select').count() === 0, '中央は表示専用 (入力欄なし)');
check(await page.locator('.party-strip .ps-mon.unseen').count() === 5 && await page.locator('.party-strip .ps-mon.active').count() === 1, '相手の6体のうち場に出た1体だけが明るい');
await shot(page, 'arena-center');
check(await page.locator('.mon-panel.opp .mp-table tbody tr').count() === 4, '相手の表に 種族値/推定Pt/能力上昇/実数値');
check(await page.locator('.mon-panel.opp .mp-speed li').count() >= 5, '素早さ一覧に自分の位置が入る');
check(await page.locator('.mon-panel.me .mv-box').count() === 4, '自分の技4つ');
await pane('ダメージ・傾向');
await page.waitForSelector('.dp-move');
await shot(page, 'arena-damage');
check(await page.locator('.dp-move .dp-bar').count() >= 8, '無振り/全振りの2本ずつ帯が出る');
// 出来事の削除
await pane('ターン入力');
await page.locator('.tl-act', {hasText: 'オボンのみ 発動'}).click();
await page.getByRole('button', {name: '削除'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.mons.opp[1].hp === 20 && !b.state.mons.opp[1].itemGone, `出来事を消すと盤面も戻る (${b.state.mons.opp[1].hp})`);
// 交代 (①で交代を選んで記録)
await page.locator('.composer .plan .mon-btn', {hasText: 'ガオガエン'}).click();
await page.locator('.actor-btn.me').click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 2 && b.state.mons.opp[1].boosts.atk === -1, '交代でガオガエンが出て、いかくが入る');
// 検索パネルのタイプ絞り込み
await page.locator('.actor-btn.opp').click();
await page.locator('.actform .mv-btn.add').click();
await page.locator('.overlay label.check input').check();
await page.locator('.overlay .tf', {hasText: 'ドラゴン'}).click();
const rows = await page.locator('.overlay .picker-list .row').count();
const allDragon = await page.locator('.overlay .picker-list .row .type').evaluateAll(els => els.every(e => e.textContent === 'ドラゴン'));
check(rows > 5 && allDragon, `技をタイプで絞り込める (${rows}件)`);
await page.getByRole('button', {name: '閉じる', exact: true}).last().click();
// 既存の詳細タブ
await page.getByRole('tab', {name: '③ ダメージ計算'}).click();
await page.waitForSelector('table.dmg');
check(await page.locator('table.dmg thead th').count() === 7, 'ダメージ表タブは相手6体ぶん');
check(await page.locator('table.dmg td .dbar').count() > 0, 'ダメージ表にゲージが出る');
await shot(page, 'dmg-tab');
check(await page.getByRole('tab').count() === 3, '大きいタブは 選出・対戦・ダメージ表 の3つ');
await page.getByRole('tab', {name: '② 対戦'}).click();
await pane('ダメージ・傾向');
await page.locator('.ar-right > .seg button', {hasText: 'メモ'}).click();
check(await page.locator('.ar-right .log li').count() >= 3, '右側のメモにターンが並ぶ');
await page.locator('.ar-right > .seg button', {hasText: '傾向'}).click();
await page.locator('.ar-right > .seg button', {hasText: 'ダメージ'}).click();
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
check(await page.locator('.brow:not(.head)').count() === 1, '対戦の履歴に1行');
await shot(page, 'home');

// 再読み込みしてもデータが残る
await page.reload();
await page.waitForSelector('.brow:not(.head)');
check(await page.evaluate(() => window.__pokememo.store.battles().length === 1 && window.__pokememo.store.teams().length === 1), '再読み込み後もデータが残る');

// 横にはみ出していないか
for (const h of ['#/battles', '#/teams', '#/stats', '#/settings']) {
  await page.goto(url + h);
  await page.waitForTimeout(150);
  await scrollOK(page, h);
  await canScroll(page, h);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${h} が横にはみ出さない (${over}px)`);
}
const bid = await page.evaluate(() => window.__pokememo.store.battles()[0].id);
await page.goto(`${url}#/battle/${bid}`);
await page.waitForSelector('.battle');
for (const t of ['① 選出', '② 対戦', '③ ダメージ計算']) {
  await page.getByRole('tab', {name: t}).click();
  await page.waitForTimeout(120);
  await scrollOK(page, `対戦/${t}`);
  await canScroll(page, `対戦/${t}`);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `対戦/${t} が横にはみ出さない (${over}px)`);
}

// データの受け渡し: 書き出したファイルを別の端末で読み込む
await page.goto(`${url}#/settings`);
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: 'ファイルに保存'}).click()]);
const dlPath = path.join(outDir, 'transfer.json');
await dl.saveAs(dlPath);
check(JSON.parse(fs.readFileSync(dlPath, 'utf8')).battles.length >= 1, '書き出したファイルに対戦記録が入る');
check(await page.getByText('最後に書き出した日時').isVisible(), '最後に書き出した日時が出る');
check(!(await page.locator('details.box').getAttribute('open') !== null), 'GitHub 同期は畳まれている');
await shot(page, 'settings-transfer');

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
// 入力欄を開いた状態の見た目
await ipad.locator('.actor-btn.opp').click();
await ipad.locator('.actform .mv-btn').first().click();
await shot(ipad, 'ipad-actform');
check(await ipad.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'iPad横: 入力を開いても横にはみ出さない');
// 追加効果の確認: れいとうビーム (10% こおり) を当てたら「発生しましたか?」と聞かれる
await ipad.locator('.wz-back').click();
await ipad.locator('.actform .mv-btn', {hasText: 'れいとうビーム'}).click();
await ipad.locator('.oc-btn.hit').click();
await ipad.locator('.af-hp input').fill('150');
await ipad.locator('.actform .btn.primary', {hasText: '次へ'}).click();
check((await ipad.locator('.sec-ask').innerText()).includes('こおり'), 'ダメージのあとに追加効果 (こおり) が発生したか聞かれる');
await shot(ipad, 'ipad-secondary');
await ipad.locator('.sec-ask .oc-btn', {hasText: '発生した'}).first().click();
let b3 = await ipad.evaluate(() => window.__pokememo.store.battles().find(x => x.turns.length >= 3));
check(b3.state.mons.me[2].status === 'frz', `発生したを押すと状態異常が付く (${b3.state.mons.me[2].status})`);
const hs = await ipad.evaluate(() => [...document.querySelectorAll('.arena.wide > *')].map(e => Math.round(e.getBoundingClientRect().height)));
check(hs.length === 3 && Math.max(...hs) - Math.min(...hs) <= 2, `iPad横: 3列の高さがそろう (${hs.join(', ')})`);
await shot(ipad, 'ipad-endturn');
// 2戦目の選出画面: 1戦目の記録から 選出率・勝率・初手率 が出る
await ipad.goto(`${url}#/battles`);
await ipad.getByRole('button', {name: '対戦を記録'}).click();
await ipad.waitForSelector('.battle');
await ipad.locator('.opp-tile.empty').first().click();
for (const n of ['ぼーまんだ', 'ばんぎらす', 'げんがー', 'はっさむ', 'みろかろす', 'どりゅうず']) await pickFrom(ipad, n);
await ipad.waitForSelector('.sel-table tr.rec');
check(await ipad.locator('.sel-table tr.rec').count() === 3, '選出表の上に 選出率・勝率・初手率 の3段');
const recTxt = await ipad.locator('.sel-table tr.rec').nth(0).locator('td').nth(1).innerText();
check(recTxt.trim() === '100%', `バンギラスの選出率 (1戦中1回) = ${recTxt}`);
check(await ipad.locator('.sel-table .cx-rec', {hasText: '選出率 100%'}).count() >= 6, '自分×相手のマスに 選出率・勝率 (ラベル付き)');
check(await ipad.locator('.sel-table .cx-types .type').count() > 0, '弱点を突けるタイプが出る');
check(await ipad.locator('.sel-table .sprite').count() >= 9, 'ポケモンの画像が出る');
await shot(ipad, 'ipad-select-records');
await ipad.locator('.sel-table tbody tr').last().scrollIntoViewIfNeeded();
await shot(ipad, 'ipad-select-cells');
// 対戦の履歴: 1行に1対戦、新しいものが上
await ipad.goto(`${url}#/battles`);
await ipad.waitForSelector('.brow:not(.head)');
check(await ipad.locator('.brow:not(.head)').count() === 2, '対戦の履歴に2行');
check((await ipad.locator('.brow:not(.head) .br-turn').first().innerText()).startsWith('0'), '新しい対戦 (まだ0ターン) がいちばん上');
await shot(ipad, 'ipad-history');

// 戦績分析 (対戦を増やして見た目を確認)
await ipad.evaluate(async () => {
  const s = window.__pokememo.store;
  const base = s.battles().find(b => b.turns.length >= 3);
  const P = [[0, 1, 2], [0, 2, 1], [1, 2, 0], [0, 1, 2]], O = [[1, 0, 2], [3, 4, 5], [2, 1, 0], [1, 5, 4]];
  for (let k = 0; k < 11; k++) { const b = JSON.parse(JSON.stringify(base)); b.id = 'x' + k; b.createdAt = base.createdAt - 1000 * (k + 1); b.pick.me = P[k % 4]; b.pick.opp = O[k % 4]; b.result = k % 3 ? 'win' : 'lose'; await s.saveBattle(b); }
});
// 受け取った端末でファイルを読み込む (アカウント不要の受け渡し)
{
  const {page: other} = await open({width: 820, height: 1180}, 'other');
  await other.goto(`${url}#/settings`);
  await other.locator('input[type=file]').setInputFiles(dlPath);
  await other.waitForTimeout(300);
  check((await other.evaluate(() => window.__pokememo.store.battles().length)) >= 1, '別の端末でファイルから読み込める');
  await other.close();
}
await ipad.goto(`${url}#/stats`);
await ipad.waitForSelector('.ta-row');
check(await ipad.locator('.ta-row:not(.head)').count() === 3, '戦績分析: 構築のポケモンごとの行');
await shot(ipad, 'ipad-stats-mons');
await ipad.locator('.ta > .seg button', {hasText: '選出パターン'}).click();
check(await ipad.locator('.ta-pat').count() >= 1, '選出パターンごとの行');
await shot(ipad, 'ipad-stats-pattern');
await ipad.locator('.ta > .seg button', {hasText: '相手'}).click();
check(await ipad.locator('.ta-opp').count() >= 5, '相手が選出したときの勝率');
await shot(ipad, 'ipad-stats-opp');
// 対戦の外 (構築画面) からも見られる
await ipad.goto(`${url}#/teams`);
await ipad.locator('.card-link', {hasText: '戦績と分析'}).first().click();
await ipad.waitForSelector('.ta-row');
check(ipad.url().includes('#/stats/'), '構築一覧から戦績と分析へ');
const tid = await ipad.evaluate(() => window.__pokememo.store.teams()[0].id);
await ipad.goto(`${url}#/team/${tid}`);
await ipad.locator('.seg button', {hasText: '戦績と分析'}).click();
await ipad.waitForSelector('.ta-row');
check(await ipad.locator('.ta-row:not(.head)').count() === 3, '構築画面の戦績と分析タブ');
await shot(ipad, 'ipad-team-report');
// スクショから構築を追加 (端末内の文字認識)
{
  await ipad.goto(`${url}#/teams`);
  await ipad.getByRole('button', {name: 'スクショから追加'}).click();
  const t0 = Date.now();
  await ipad.locator('.shot input[type=file]').setInputFiles([new URL('./fixtures/team-ability.png', import.meta.url).pathname, new URL('./fixtures/team-status.png', import.meta.url).pathname]);
  await ipad.waitForSelector('.shot-mon', {timeout: 120000});
  console.log(`  (読み取り ${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
  await shot(ipad, 'ipad-shot-import');
  const names = await ipad.locator('.shot-mon .sm-head b').allInnerTexts();
  check(names.join() === 'エンペルト,ボーマンダ,サーフゴー,ガブリアス,ゴリランダー,アーマーガア', `スクショから6体を読み取る (${names})`);
  await ipad.getByRole('button', {name: 'この内容で構築を作る'}).click();
  await ipad.waitForSelector('.cards');
  const t = await ipad.evaluate(() => window.__pokememo.store.teams().find(x => x.name.startsWith('スクショから追加')));
  const exp = JSON.parse(fs.readFileSync(new URL('./fixtures/team-expected.json', import.meta.url), 'utf8'));
  const same = t && exp.every((e, i) => ['species', 'item', 'ability', 'nature'].every(k => t.mons[i][k] === e[k]) && t.mons[i].sp.join() === e.sp.join() && e.moves.every(m => t.mons[i].moves.includes(m)));
  check(same, 'スクショから作った構築が正しい (持ち物・特性・性格・能力ポイント・技)');
  // 構築診断 (構築一覧から)
  await ipad.goto(`${url}#/teams`);
  await ipad.locator('.card', {hasText: 'スクショから追加'}).locator('.card-link', {hasText: '構築診断'}).click();
  await ipad.waitForSelector('.td-table');
  const missRows = await ipad.locator('tr.td-miss th .type').allInnerTexts();
  check(missRows.join() === 'ゴースト,あく', `構築診断: 半減で受けられないタイプ (${missRows})`);
  await shot(ipad, 'ipad-team-diag');
  await ipad.locator('.seg button', {hasText: '攻め'}).click();
  check(await ipad.locator('.td-crow.miss').count() >= 1, '構築診断: 弱点を突けない組み合わせ');
  await shot(ipad, 'ipad-team-diag-off');
  await ipad.locator('.seg button', {hasText: '使用率上位30'}).click();
  check(await ipad.locator('.td-tile').count() === 30, '構築診断: 使用率上位30');
  await shot(ipad, 'ipad-team-diag-top');
}
await browser.close();
server.close();
console.log(errors.length ? `\n問題 ${errors.length}件:\n${errors.join('\n')}` : '\nすべて通過');
process.exit(errors.length ? 1 : 0);
