// でたらめ操作テスト: 対戦画面のボタンを無作為に押し続けて、例外・データの破損が起きないかを見る。
// node tests/monkey.mjs [手数] [シード] [幅x高さ]
import {chromium} from 'playwright';
import fs from 'node:fs';
import {serve} from './serve.mjs';

const STEPS = Number(process.argv[2] || 400);
let seed = Number(process.argv[3] || 1);
const [vw, vh] = (process.argv[4] || '1180x820').split('x').map(Number);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const {server, url} = await serve();
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: vw, height: vh}, locale: 'ja-JP', hasTouch: vw < 800});
const placeholder = fs.readFileSync(new URL('../docs/icon-192.png', import.meta.url));
await ctx.route('https://play.pokemonshowdown.com/**', r => r.fulfill({status: 200, contentType: 'image/png', body: placeholder}));
const page = await ctx.newPage();
const errors = [];
const log = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', d => d.dismiss());
await page.goto(url);
await page.waitForSelector('.bottomnav');

const M = (species, item, ability, nature, sp, moves) => ({species, item, ability, nature, sp, moves, note: ''});
const team = {
  id: 'T1', name: '検査構築', format: 'single', memo: '', createdAt: Date.now(), updatedAt: Date.now(),
  mons: [
    M('garchomp', 'choicescarf', 'roughskin', 'Jolly', [2, 32, 0, 0, 0, 32], ['earthquake', 'outrage', 'rockslide', 'stealthrock']),
    M('charizard', 'charizarditey', 'blaze', 'Timid', [2, 0, 0, 32, 0, 32], ['flamethrower', 'airslash', 'solarbeam', 'protect']),
    M('incineroar', 'sitrusberry', 'intimidate', 'Careful', [32, 0, 2, 0, 32, 0], ['fakeout', 'flareblitz', 'knockoff', 'uturn']),
    M('rotomwash', 'leftovers', 'levitate', 'Bold', [32, 0, 32, 2, 0, 0], ['hydropump', 'voltswitch', 'willowisp', 'thunderbolt']),
    M('tyranitar', 'lifeorb', 'sandstream', 'Adamant', [32, 32, 0, 0, 2, 0], ['stoneedge', 'crunch', 'earthquake', 'dragondance']),
    M('gengar', 'focussash', 'cursedbody', 'Timid', [0, 0, 2, 32, 0, 32], ['shadowball', 'sludgebomb', 'toxic', 'leechseed']),
  ],
};
const OPP = ['dragonite', 'kingambit', 'gholdengo', 'sneasler', 'hippowdon', 'tyranitar'];
await page.evaluate(async ({team, OPP}) => {
  const s = window.__pokememo.store;
  await s.saveTeam(team);
}, {team, OPP});
await page.goto(`${url}#/team/T1`);
await page.getByRole('button', {name: '対戦を記録'}).click();
await page.waitForSelector('.battle');
const bid = await page.evaluate(() => location.hash.split('/')[2]);
await page.evaluate(async ({bid, OPP}) => {
  const s = window.__pokememo.store;
  const b = JSON.parse(JSON.stringify(s.battle(bid)));
  b.opp = OPP.map(species => ({species, item: '', ability: '', moves: [], assume: {kind: 'usage', idx: 0}, note: '', speOk: null, megaSeen: false}));
  await s.saveBattle(b);
}, {bid, OPP});
await page.goto(`${url}#/battles`);
await page.goto(`${url}#/battle/${bid}`);
await page.waitForSelector('.battle');

// 押してはいけないもの (対戦の削除・全消去・外部リンク・ファイル)
const SKIP = /削除|全消去|外す|同期|書き出|読み込|バックアップ|使用率データを更新/;
const invariants = () => page.evaluate(bid => {
  const s = window.__pokememo.store;
  const b = s.battle(bid);
  if (!b) return location.hash.includes(bid) ? ['対戦が消えた'] : [];
  const bad = [];
  for (const side of ['me', 'opp']) {
    const list = side === 'me' ? b.my : b.opp;
    for (const i of b.pick[side]) if (!(i >= 0 && i < list.length)) bad.push(`pick.${side} 範囲外 ${i}`);
    if (new Set(b.pick[side]).size !== b.pick[side].length) bad.push(`pick.${side} 重複`);
    for (const i of b.state.sides[side].active) if (i != null && !(i >= 0 && i < list.length)) bad.push(`active.${side} 範囲外 ${i}`);
    (b.state.mons[side] || []).forEach((c, i) => {
      if (!c) return;
      if (!(c.hp >= 0 && c.hp <= 100) || Number.isNaN(c.hp)) bad.push(`${side}${i} hp=${c.hp}`);
      if (c.fainted && c.hp > 0) bad.push(`${side}${i} ひんしなのにHP ${c.hp}`);
      for (const [k, v] of Object.entries(c.boosts || {})) if (!(v >= -6 && v <= 6)) bad.push(`${side}${i} ${k}=${v}`);
    });
  }
  b.turns.forEach((t, ti) => { if (t.n !== ti + 1) bad.push(`ターン番号 ${t.n} @${ti}`); if (t.open && ti !== b.turns.length - 1) bad.push('途中のターンが開いたまま'); });
  for (const o of b.opp) {
    if (o.moves.length > 4) bad.push(`${o.species} 技が5つ以上`);
    if (o.statOk) for (const [k, m] of Object.entries(o.statOk)) if (typeof m === 'string' && !m.includes('1')) bad.push(`${o.species} statOk.${k} が全滅`);
  }
  return bad;
}, bid);

let lastBad = '';
for (let step = 0; step < STEPS; step++) {
  if (!page.url().includes(bid)) {
    if (rnd() < 0.7) await page.goto(`${url}#/battle/${bid}`);
  }
  const cands = await page.evaluate(SKIPsrc => {
    const SKIP = new RegExp(SKIPsrc);
    const els = [...document.querySelectorAll('button, a[href^="#"], input[type=checkbox], select, input.input:not([type=date]):not([type=search])')];
    const top = document.querySelectorAll('.overlay').length ? [...document.querySelectorAll('.overlay')].pop() : null;
    return els.map((e, i) => ({i, e})).filter(({e}) => {
      if (e.disabled) return false;
      if (top && !top.contains(e)) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      return !SKIP.test(e.textContent || '') && !SKIP.test(e.getAttribute('aria-label') || '');
    }).map(({e, i}) => { e.dataset.mk = String(i); return {i, tag: e.tagName, type: e.type, inComposer: !!e.closest('.play') || !!e.closest('.turnbar') || !!e.closest('.overlay'), back: /戻る|‹/.test(e.textContent || ''), text: (e.textContent || e.getAttribute('aria-label') || e.value || '').trim().slice(0, 30)}; });
  }, SKIP.source);
  if (!cands.length) { await page.keyboard.press('Escape'); continue; }
  // ターン入力を進める操作を多めに選ぶ (戻るは控えめに)
  const comp = cands.filter(x => x.inComposer && !x.back);
  const pool = comp.length && rnd() < 0.8 ? comp : cands;
  const c = pool[Math.floor(rnd() * pool.length)];
  const loc = page.locator(`[data-mk="${c.i}"]`);
  try {
    if (c.tag === 'SELECT') {
      const opts = await loc.locator('option').evaluateAll(os => os.map(o => o.value));
      if (opts.length) await loc.selectOption(opts[Math.floor(rnd() * opts.length)], {timeout: 1500});
      log.push(`select ${c.text}`);
    } else if (c.tag === 'INPUT' && c.type !== 'checkbox') {
      const v = c.type === 'number' ? String(Math.floor(rnd() * 120) - 5) : ['', '50', 'あ', '0', '100', '1'][Math.floor(rnd() * 6)];
      await loc.fill(v, {timeout: 1500}); await loc.blur();
      log.push(`fill ${c.text} = ${v}`);
    } else {
      await loc.click({timeout: 1500});
      log.push(`click ${c.text}`);
    }
  } catch (e) { log.push(`(押せず) ${c.text}`); }
  await page.waitForTimeout(30);
  if (rnd() < 0.03) await page.keyboard.press('Escape');
  const bad = await invariants();
  const key = bad.join('|');
  if (bad.length && key !== lastBad) { errors.push(`不整合 (手 ${step}): ${bad.join(', ')}\n  直前: ${log.slice(-6).join(' → ')}`); lastBad = key; }
  if (errors.length > 20) break;
}
const b = await page.evaluate(bid => window.__pokememo.store.battle(bid), bid);
console.log(`手数 ${STEPS} / ターン ${b?.turns.length ?? '-'} / 行動 ${b?.turns.reduce((n, t) => n + t.acts.length, 0) ?? '-'}`);
console.log(errors.length ? `問題 ${errors.length}件:\n${[...new Set(errors)].join('\n')}` : '問題なし');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
