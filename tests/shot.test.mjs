import test from 'node:test';
import assert from 'node:assert/strict';
import {identify, bestMatch, assemble} from '../src/engine/shot.js';

test('スクショ読み取り: 実数値から種族・性格・能力ポイントを割り出す', () => {
  // サーフゴー ひかえめ H31 C27 D2 S6 (能力ポイントの読み取りが一部欠けても実数値から逆算する)
  const c = identify([193, 72, 115, 198, 113, 110], [31, null, 0, null, 2, 1]);
  assert.equal(c[0].species, 'gholdengo');
  assert.equal(c[0].nature, 'Modest');
  assert.deepEqual(c[0].sp, [31, 0, 0, 27, 2, 6]);
  // 1か所読めなくても、合計66から補う
  const d = identify([193, 72, 115, 198, 113, 10], [31, 0, 0, 27, 2, null]);
  assert.equal(d[0].species, 'gholdengo');
  assert.equal(d[0].sp[5], 6);
});

test('スクショ読み取り: 崩れた文字を図鑑の名前に当てはめる', () => {
  assert.equal(bestMatch('items', 'ただへのこし').id, 'leftovers');
  assert.equal(bestMatch('moves', 'とんほぼかがえり').id, 'uturn');
  assert.equal(bestMatch('abilities', 'フレウッシャー', ['pressure', 'unnerve', 'mirrorarmor']).id, 'pressure');
  const r = assemble({
    status: [{'hp.v': '207', 'hp.sp': '32', 'atk.v': '194', 'atk.sp': '32', 'def.v': '112', 'def.sp': '2', 'spa.v': '72', 'spa.sp': '0', 'spd.v': '90', 'spd.sp': '0', 'spe.v': '105', 'spe.sp': '0'}],
    ability: [{ability: 'グラスメイカー', item: 'させさきさのダネ', move0: 'ドラムアダタック', move1: 'とんほぼかがえり', move2: 'グラススライダー', move3: '10Oまんはりさ'}],
  });
  const b = r[0].build;
  assert.equal(b.species, 'rillaboom');
  assert.equal(b.nature, 'Adamant');
  assert.equal(b.ability, 'grassysurge');
  assert.deepEqual(b.moves.sort(), ['drumbeating', 'grassyglide', 'highhorsepower', 'uturn']);
  assert.equal(r[1].build.species, '', '写っていない枠は空');
});
