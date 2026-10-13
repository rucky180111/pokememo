import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {convertUsage} from '../server/usage-convert.mjs';

const showdown = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));
test('ゲーム内バトルデータ (中間形式) をアプリの使用率データに変換する', () => {
  const src = {season: 'M-6', source: 'テスト', pokemon: [
    {name: 'ガブリアス', rank: 1, moves: [['じしん', 99.5], ['スケイルショット', 49.1], ['ステルスロック', 47.1]], items: [['きあいのタスキ', 40.2], ['ガブリアスナイトZ', 20], ['こだわりスカーフ', 15]],
      abilities: [['さめはだ', 99.3]], natures: [['ようき', 50.9], ['いじっぱり', 30], ['おくびょう', 10]], teammates: [['アシレーヌ', 30]]},
    {name: 'アシレーヌ', rank: 2, usage: 20, moves: [['ムーンフォース', 98.2]], items: [['オボンのみ', 46.1]], abilities: [['げきりゅう', 96.5]], natures: [['ずぶとい', 40]]},
    {name: 'ぜんぜんちがうなまえ', rank: 3, moves: []},
  ]};
  const {usage, warnings} = convertUsage(src, showdown);
  const g = usage.pokemon.garchomp;
  assert.equal(g.mv[0][0], 'earthquake');
  assert.equal(g.ab[0][0], 'roughskin');
  assert.ok(Math.abs(g.mv[0][1] - 0.995) < 1e-9);
  assert.equal(g.it[0][0], 'focussash', 'メガストーンは通常の姿の持ち物から外す');
  assert.ok(!g.it.some(([i]) => i === 'garchompitez'));
  assert.ok(usage.pokemon.garchompmegaz, 'メガの項目を作る');
  assert.ok(Math.abs(usage.pokemon.garchompmegaz.u / (g.u + usage.pokemon.garchompmegaz.u) - 0.2) < 1e-6, 'メガの割合 = ストーンの採用率');
  assert.equal(usage.pokemon.primarina.u, 0.2, '使用率の%があればそれを使う');
  assert.ok(g.sp.length && g.sp[0][0].startsWith('Jolly'), `性格の割合で配分を重みづけ (${g.sp[0][0]})`);
  assert.equal(g.tm[0][0], 'primarina');
  assert.ok(warnings.some(w => w.includes('ぜんぜんちがうなまえ')), '対応づけられない名前は警告');
  assert.equal(usage.month, 'シーズンM-6');
});
