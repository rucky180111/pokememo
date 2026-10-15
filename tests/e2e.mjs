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
for (const n of ['ぼーまんだ', 'ばんぎらす', 'げんがー', 'はっさむ', 'みろかろす', 'げんがー']) await pickFrom(page, n);
check(await page.locator('.party-slot.filled').count() === 6, '選ぶたびに上の6つの枠に入る');
await shot(page, 'party-picker');
const h1 = await page.locator('.sheet.tall').boundingBox();
await page.locator('.overlay .tf', {hasText: 'ドラゴン'}).click();
const h2 = await page.locator('.sheet.tall').boundingBox();
check(Math.abs(h1.height - h2.height) < 1 && Math.abs(h1.y - h2.y) < 1, '絞り込んでも枠の大きさ・位置が変わらない');
await page.locator('.overlay .tf', {hasText: 'ドラゴン'}).click();
await page.locator('.party-slot').nth(5).click();
await pickFrom(page, 'どりゅうず');
check((await page.locator('.party-slot').nth(5).innerText()).includes('ドリュウズ'), '枠を押して選び直すと上書きされる');
await page.getByRole('button', {name: '確定', exact: true}).click();
await page.waitForFunction(() => window.__pokememo.store.battles()[0].opp.length === 6);
check(await page.locator('.overlay').count() === 0, '確定で6体が決まってパネルが閉じる');
await shot(page, 'setup');
// 選出
check(await page.locator('.sel-table tbody tr').count() === 3, '選出表が自分3体ぶん出る');
check(await page.locator('.sel-table tbody tr').first().locator('td').count() === 6, '選出表に相手6体ぶんの列');
await page.locator('.sel-mon').nth(0).click(); await page.locator('.sel-mon').nth(2).click(); await page.locator('.sel-mon').nth(1).click();
await shot(page, 'select');
await page.getByRole('button', {name: /この選出で対戦開始/}).click();
await page.waitForSelector('.arena .pl.me');
const pane = async n => { await page.locator('.arena-tabs button', {hasText: n}).click(); };
const openLog = async () => { await pane('ダメージ・ログ'); await page.locator('.ar-right .seg button', {hasText: 'ログ・メモ'}).click(); };
const closeLog = async () => { await pane('盤面'); };
const realActs = t => t.acts.filter(a => a.type !== 'event').length;
const oppP = page.locator('.pl.opp'), meP = page.locator('.pl.me');
// 相手の先発: 右上のアイコン → 確定
check(await oppP.locator('.pl-bmon').count() === 6, '相手の枠の右上に6体のアイコン');
await oppP.locator('.pl-bmon[title="バンギラス"]').click();
await oppP.getByRole('button', {name: '確定', exact: true}).click();
let b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 0 && b.state.sides.opp.active[0] === 1, '初手が場に出る');
check(b.pick.opp.join() === '1', '相手の選出に自動で入る');
// 特性はその場で選ぶ → すぐ反映
await oppP.locator('select.pl-dd').selectOption('sandstream');
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.opp[1].ability === 'sandstream' && b.state.field.weather === 'Sand', `特性を選ぶと確定し、すなおこしで砂 (${b.state.field.weather})`);
await shot(page, 'board');

// ターン1: 相手=ステルスロック (技を検索して選ぶ) → 自分=つるぎのまい
await oppP.locator('.pl-mv.empty').first().click();
await page.locator('.picker-bar input[type=search]').last().fill('ステルスロック');
await page.locator('.picker-list .row').first().click();
check(await oppP.locator('.pl-act.move').count() === 1, '技を選ぶと右側に入力が出る');
await oppP.getByRole('button', {name: '確定', exact: true}).click();
await meP.locator('.pl-mv', {hasText: 'つるぎのまい'}).click();
await meP.getByRole('button', {name: '確定', exact: true}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 1 && realActs(b.turns[0]) === 2, '同じターンに2行動が入る');
check(b.state.mons.me[0].boosts.atk === 2, 'つるぎのまいで A+2');
check(b.state.sides.me.sr === true, '自分の場にステルスロック');
check(b.opp[1].moves.includes('stealthrock'), '相手の技が判明済みに入る');
check(await meP.locator('.pl-mv', {hasText: 'つるぎのまい'}).locator('.pl-pp').innerText() === '19/20', `PPが減る (${await meP.locator('.pl-mv', {hasText: 'つるぎのまい'}).locator('.pl-pp').innerText()})`);
check(await meP.locator('.pl-mv').first().isDisabled(), '行動したら次のターンまで技を押せない');
check(await page.locator('.tb-end').isEnabled(), '両方動いたらターン終了を押せる');
await page.locator('.tb-end').click();
// ターン2: 相手=がんせきふうじ (予想 → 確定 → HPを合わせる) → 自分=じしん
check(!(await page.locator('.tb-end').isEnabled()), '新しいターンはまだ終了できない');
await oppP.locator('.pl-mv.empty').first().click();
await page.locator('.picker-bar input[type=search]').last().fill('がんせきふうじ');
await page.locator('.picker-list .row').first().click();
check(await meP.locator('.hp-pred').count() === 1, '技を選ぶと、受ける側のHPバーに予想が出る');
check(await oppP.locator('.pa-row').count() === 3 && /→/.test(await oppP.locator('.pa-row.on').innerText()), `今のHPから減ったあとの予想が3通り出る (${(await oppP.locator('.pa-row.on').innerText()).replace(/\n/g, ' ')})`);
await shot(page, 'board-predict');
await oppP.getByRole('button', {name: '確定', exact: true}).click();
await meP.locator('.pl-hp.edit input.input').fill('70');
await shot(page, 'board-hp');
await oppP.getByRole('button', {name: '記録', exact: true}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.turns.length === 2 && Math.round(b.state.mons.me[0].hp) === Math.round(70 / 185 * 100), `残りHPが反映される (${b.state.mons.me[0].hp})`);
check(b.state.mons.me[0].boosts.spe === -1, 'がんせきふうじで S-1');
check(b.turns[1].acts.some(a => (a.auto || []).some(x => /実数値|説明がつきません/.test(x))), 'ダメージからの絞り込み結果がログに出る');
await meP.locator('.pl-mv', {hasText: 'じしん'}).click();
check(await oppP.locator('.hp-pred').count() === 1, '自分の技でも相手のHPバーに予想');
await meP.locator('.pa-row', {hasText: '耐久全振り'}).click();
check(await meP.locator('.pa-row.on', {hasText: '耐久全振り'}).count() === 1, '振り方を切り替えられる');
await meP.getByRole('button', {name: '確定', exact: true}).click();
await oppP.locator('.pl-hp.edit input.input').fill('20');
await meP.getByRole('button', {name: '記録', exact: true}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.mons.opp[1].hp === 20, `相手のHPが20%に (${b.state.mons.opp[1].hp})`);
await page.locator('.tb-end').click();
// あとから修正: ログをタップして相手のがんせきふうじの残りHPを 80 に直す
await openLog();
await page.locator('.tl-turn').nth(1).locator('.tl-act').first().click();
await page.locator('.overlay .af-hp input').fill('80');
await page.getByRole('button', {name: 'この内容で直す'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(Math.round(b.state.mons.me[0].hp) === Math.round(80 / 185 * 100) && b.state.mons.opp[1].hp === 20 && b.state.mons.me[0].boosts.atk === 2, `修正が反映され、ほかの記録は残る (${b.state.mons.me[0].hp})`);
await closeLog();
// その他の変化: 相手のオボンのみ発動 (+25%)
await page.getByRole('button', {name: 'その他の変化…'}).click();
await page.locator('.ev .seg button', {hasText: '相手'}).click();
await page.locator('.ev .chip', {hasText: 'オボンのみ'}).click();
await page.locator('.ev .btn.primary', {hasText: '追加'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.opp[1].item === 'sitrusberry' && b.state.mons.opp[1].itemGone && b.state.mons.opp[1].hp === 45, `オボン発動で持ち物確定・消費・HP+25% (${b.state.mons.opp[1].hp})`);
await page.locator('.overlay').count() && await page.getByRole('button', {name: '閉じる', exact: true}).last().click().catch(() => {});
check(await oppP.locator('.pl-dd.gone', {hasText: 'オボンのみ'}).count() === 1, '持ち物が使用済みで表示される');
// 1つ戻す
await page.getByRole('button', {name: '1つ戻す'}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.mons.opp[1].hp === 20 && !b.state.mons.opp[1].itemGone, `1つ戻すで盤面も戻る (${b.state.mons.opp[1].hp})`);
await pane('盤面').catch(() => {});
await shot(page, 'arena-center');
check(await oppP.locator('.mp-table tbody tr').count() >= 4, '相手の表に 種族値/能力Pt/能力上昇/実数値');
{
  const rank = () => oppP.locator('.mp-table .rankv').first().innerText();
  const before = Number((await rank()).replace('+', ''));
  await oppP.locator('.rank-edit').click();
  await oppP.locator('.rank-cell').first().locator('.rank-btn').first().click();
  await oppP.locator('.rank-cell').first().locator('.rank-btn').first().click();
  await oppP.locator('.rank-actions').getByRole('button', {name: '記録', exact: true}).click();
  const after = Number((await rank()).replace('+', ''));
  check(after === before + 2, `能力ランクを表から直接入力できる (${before} → ${after})`);
  await page.getByRole('button', {name: '1つ戻す'}).first().click();
  check(Number((await rank()).replace('+', '')) === before, '1つ戻すで元に戻る');
}
check(await oppP.locator('.mp-speed li').count() >= 5, '素早さ一覧に自分の位置が入る');
// 交代: ⇄ → アイコン → 確定 (いかくが入る)
await meP.locator('.pl-swap').click();
await meP.locator('.pl-bmon[title="ガオガエン"]').click();
await meP.getByRole('button', {name: '確定', exact: true}).click();
b = await page.evaluate(() => window.__pokememo.store.battles()[0]);
check(b.state.sides.me.active[0] === 2 && b.state.mons.opp[1].boosts.atk === -1, '交代でガオガエンが出て、いかくが入る');
check(b.state.mons.me[2].hp < 100, `ステルスロックのダメージを自動で反映 (${b.state.mons.me[2].hp})`);
await pane('ダメージ・ログ');
await page.waitForSelector('.dl');
await shot(page, 'arena-damage');
check(await page.locator('.dl-ic.opp').count() >= 3 && await page.locator('.dl-ic.me').count() >= 3, 'ダメージ計算に相手と自分のアイコン');
check(await page.locator('.dl-ic.on').count() === 2, '選んでいる2体が光る');
check(await page.locator('.dl-st input[type=range]').count() === 6, '相手の能力Ptスライダーが6本');
const dmgText = () => page.locator('.dl h4.me ~ .dl-row .dl-v').first().innerText();
const before = await dmgText();
await page.locator('.dl-st').nth(0).locator('input[type=range]').fill('32'); // HPに全振り
const afterSp = await dmgText();
const natBtn = page.locator('.dl-st').nth(4).locator('.dl-nat');
await natBtn.click();
check((await natBtn.innerText()).trim() === '▲', '性格補正を▲にできる');
await natBtn.click();
check((await natBtn.innerText()).trim() === '▼', '押すと▼');
await natBtn.click();
check((await natBtn.innerText()).trim() === '－', 'もう一度で補正なし');
check(before !== afterSp, `スライダーで計算が変わる (${before} → ${afterSp})`);
await natBtn.click(); // ▲
await page.locator('.dl-st').nth(1).locator('.dl-nat').click();
await page.locator('.dl-st').nth(3).locator('.dl-nat').click();
check(await page.locator('.dl-nat.up').count() === 3, '性格補正の▲をいくつでもつけられる');
for (let i = 1; i < 6; i++) await page.locator('.dl-st').nth(i).locator('input[type=range]').fill('32');
check((await page.locator('.dl-total').innerText()).startsWith('66'), `能力Ptは合計66まで (${await page.locator('.dl-total').innerText()})`);
await page.locator('.dl-dir').click();
check(await page.locator('.dl h4.me').count() === 0 && await page.locator('.dl h4.opp ~ .dl-row').count() >= 4, '⇄で攻撃側を入れ替え、相手の技が並ぶ');
await page.locator('.dl-ic.opp').nth(1).click();
check(await page.locator('.dl-ic.opp.on').count() === 1, '相手を切り替えられる');
await pane('盤面');
// 検索パネルのタイプ絞り込み
await oppP.locator('.pl-mv.empty').first().click();
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
await pane('ダメージ・ログ');
await page.locator('.ar-right > .seg button', {hasText: 'メモ'}).click();
check(await page.locator('.ar-right .tl-turn').count() >= 2, '右側のログにターンが並ぶ');
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
check(await ipad.locator('.arena.wide > .ar-center').count() === 1 && await ipad.locator('.arena.wide > .ar-right-col').count() === 1, 'iPad横は 盤面 と 右 (ダメージ・ログ・ターン終了) の2列');
check(await ipad.locator('.ar-right-col .tb-end').count() === 1, 'iPad横: ターン終了は右下');
await shot(ipad, 'ipad-arena');
await ipad.locator('.pl.opp .pl-name').first().click();
await ipad.waitForSelector('.os-info');
check(await ipad.locator('.sheet .mp-table').count() === 1 && await ipad.locator('.sheet .moves4 > *').count() === 4, '相手の詳細: 能力表と技4枠');
await shot(ipad, 'ipad-opp-sheet');
await ipad.locator('.sheet button', {hasText: '閉じる'}).first().click().catch(() => {});
const over = await ipad.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(over <= 0, `iPad横で横にはみ出さない (${over}px)`);
// 追加効果: 相手のれいとうビーム → HPを合わせる段階で「こおり」を選ぶ
await ipad.locator('.pl.opp .pl-mv.empty').first().click();
await ipad.locator('.picker-bar input[type=search]').last().fill('れいとうビーム');
await ipad.locator('.picker-list .row').first().click();
await shot(ipad, 'ipad-actform');
await ipad.locator('.pl.opp').getByRole('button', {name: '確定', exact: true}).click();
await ipad.locator('.pl.opp .pl-act .chip', {hasText: 'こおり'}).click();
await ipad.locator('.pl.me .pl-hp.edit input.input').fill('150');
await shot(ipad, 'ipad-secondary');
await ipad.locator('.pl.opp').getByRole('button', {name: '記録', exact: true}).click();
let b3 = await ipad.evaluate(() => window.__pokememo.store.battles().find(x => x.turns.length >= 3));
check(b3.state.mons.me[2].status === 'frz', `追加効果を選ぶと状態異常が付く (${b3.state.mons.me[2].status})`);
check(await ipad.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'iPad横: 入力中も横にはみ出さない');
await shot(ipad, 'ipad-endturn');
// 2戦目の選出画面: 1戦目の記録から 選出率・勝率・初手率 が出る
await ipad.goto(`${url}#/battles`);
await ipad.getByRole('button', {name: '対戦を記録'}).click();
await ipad.waitForSelector('.battle');
await ipad.locator('.opp-tile.empty').first().click();
for (const n of ['ぼーまんだ', 'ばんぎらす', 'げんがー', 'はっさむ', 'みろかろす', 'どりゅうず']) await pickFrom(ipad, n);
await ipad.getByRole('button', {name: '確定', exact: true}).click();
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
  await ipad.locator('.seg button', {hasText: '使用率上位100'}).click();
  check(await ipad.locator('.td-tile').count() === 100, '構築診断: 使用率上位100');
  await shot(ipad, 'ipad-team-diag-top');
  await ipad.locator('.seg button', {hasText: 'おすすめ'}).click();
  await ipad.locator('.td-slots .chip', {hasText: 'アーマーガア'}).click();
  check(await ipad.locator('.td-rec').count() >= 10, '構築診断: おすすめのタイプとポケモン');
  await shot(ipad, 'ipad-team-diag-rec');
}
await browser.close();
server.close();
console.log(errors.length ? `\n問題 ${errors.length}件:\n${errors.join('\n')}` : '\nすべて通過');
process.exit(errors.length ? 1 : 0);
