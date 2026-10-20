import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCond, condMatches, matchRule, pickIndexes, parseRulesText, rulesToText, teamSpecies} from '../src/engine/pickrule.js';

const team = [
  {species: 'empoleon', item: 'shucaberry'}, {species: 'garchomp', item: 'garchompitez'}, {species: 'rillaboom', item: 'miracleseed'},
  {species: 'gholdengo', item: 'airballoon'}, {species: 'dragonite', item: 'rockyhelmet'}, {species: 'kingambit', item: 'lumberry'},
];
const sample = fs.readFileSync(new URL('./fixtures/pickrules-sample.txt', import.meta.url), 'utf8');
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/pickrules-cases.json', import.meta.url), 'utf8'));

test('条件の書き方: かつ・または・いない・n体以上・タイプ・どちらか', () => {
  const m = (c, opp) => condMatches(parseCond(c), opp);
  assert.ok(m('ルカリオ', ['lucario', 'hippowdon']));
  assert.ok(!m('ルカリオ+カバルドン', ['lucario']));
  assert.ok(m('ルカリオ+ヒスイヌメルゴン|エースバーン', ['lucario', 'cinderace']));
  assert.ok(!m('ルカリオ+ヒスイヌメルゴン|エースバーン', ['lucario', 'goodra']));
  assert.ok(m('ゲンガー-フラエッテ', ['gengar']));
  assert.ok(!m('ゲンガー-フラエッテ', ['gengar', 'floetteeternal']));
  assert.ok(m('2体以上:ドヒドイデ|エアームド|ブラッキー', ['toxapex', 'umbreon']));
  assert.ok(!m('2体以上:ドヒドイデ|エアームド|ブラッキー', ['toxapex', 'garchomp']));
  assert.ok(m('ゴーストタイプ', ['basculegion']));
  assert.ok(m('エースバーン / グソクムシャ+ガブリアス', ['golisopod', 'garchomp']));
  assert.ok(m('*', ['pikachu']));
  // メガの姿で入っていても元の種族で当たる
  assert.ok(m('メタグロス', ['metagrossmega']));
  assert.deepEqual(parseCond('ピカチュウッ').errors.length, 1);
});

test('構築の中の名前: 略称・メガの名前でも引ける', () => {
  assert.equal(teamSpecies('ガブZ', team), 'garchomp');
  assert.equal(teamSpecies('メガガブリアスZ', team), 'garchomp');
  assert.equal(teamSpecies('ゴリランダー', team), 'rillaboom');
  assert.equal(teamSpecies('エンペ', team), 'empoleon');
  assert.equal(teamSpecies('ピカチュウ', team), null);
});

test('一括入力の表を読み、上位34構築すべてで想定どおりの行に当たる', () => {
  const {rules, errors} = parseRulesText(sample, team);
  assert.deepEqual(errors, []);
  assert.equal(rules.length, 19);
  assert.deepEqual(rules[2].pick, ['garchomp', 'dragonite', 'kingambit']);
  assert.equal(rules[0].note, undefined); // メモは持たない
  for (const c of cases) assert.equal(matchRule(rules, c.opp).index + 1, c.rule, c.name);
  // 書き出し → 読み直しで同じ内容
  const again = parseRulesText(rulesToText(rules), team);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.rules, rules);
  assert.ok(rulesToText(rules).startsWith('条件,先発,2体目,3体目\n'));
});

test('CSV・タブ区切りで読める (見出しは飛ばす)', () => {
  const csv = '条件,先発,2体目,3体目\nルカリオ+ミミッキュ|ギルガルド,ゴリランダー,ガブZ,ドドゲザン\n*,エンペルト,ガブZ,ゴリランダー';
  const a = parseRulesText(csv, team);
  assert.deepEqual(a.errors, []);
  assert.equal(a.rules.length, 2);
  assert.deepEqual(a.rules[0], {cond: 'ルカリオ+ミミッキュ|ギルガルド', pick: ['rillaboom', 'garchomp', 'kingambit']});
  const tsv = parseRulesText(csv.replace(/,/g, '\t'), team);
  assert.deepEqual(tsv, a);
  assert.equal(parseRulesText('ルカリオ,', team).errors.length, 1); // 選出なし
  // 書き方のルールに載せた例・略し方・リージョンの書き方・コメント
  const ex = parseRulesText('2体以上:ドヒドイデ|アーマーガア|ブラッキー,サーフゴー,ガブZ,ドドゲザン\nヤドキング(ガラル),ゴリラ,ガブZ # コメント\n// 無視\nガラルヤドキング,サーフゴー,ガブZ', team);
  assert.deepEqual(ex.errors, []);
  assert.equal(ex.rules.length, 3);
  assert.deepEqual(ex.rules[1].pick, ['rillaboom', 'garchomp']);
});

test('当てはまった選出を手持ちの番号に直す (並び順どおり・先頭が先発)', () => {
  const {rules} = parseRulesText(sample, team);
  const hit = matchRule(rules, ['lucario', 'mimikyu', 'hippowdon']);
  assert.equal(hit.index + 1, 4);
  assert.deepEqual(pickIndexes(hit.rule.pick, team), [2, 1, 5]);
  assert.equal(matchRule([], ['lucario']), null);
  assert.equal(matchRule(rules, []), null);
});

test('間違った行はエラーで知らせる', () => {
  const {errors} = parseRulesText('ルカリオ ゴリランダー\nピカチュウッ => ガブZ\nルカリオ => ピカチュウ', team);
  assert.equal(errors.length, 3);
});

test('n体以上は相手の頭数で数える (同じ1体が複数の名前に当たっても1体)', () => {
  const m = (c, opp) => condMatches(parseCond(c), opp);
  // ヤドキング は ヤドキング(ガラル) も指すので、ガラルヤドキング1体で2回数えない
  assert.ok(!m('2体以上:ガラルヤドキング|ヤドキング|ドヒドイデ', ['slowkinggalar', 'garchomp']));
  assert.ok(m('2体以上:ガラルヤドキング|ヤドキング|ドヒドイデ', ['slowkinggalar', 'toxapex']));
  assert.ok(!m('2体以上:メタグロス|ドヒドイデ', ['metagrossmega']));
  assert.ok(m('2体以上:ゴーストタイプ', ['mimikyu', 'gengar']));
  assert.ok(!m('2体以上:ゴーストタイプ', ['mimikyu', 'garchomp']));
});

test('行を重ねて3体を決める (先発・空き枠・出さない・自動で埋める)', async () => {
  const {decidePick} = await import('../src/engine/pickrule.js');
  const ids = team.map(t => t.species);
  const csv = '条件,先発,2体目,3体目\nフシギバナ,ガブZ,ゴリランダー,サーフゴー\nルカリオ,,,,-エンペルト\nカバルドン,エンペルト\nボーマンダ,,サーフゴー\n*,ドドゲザン,ガブZ,ゴリランダー';
  const {rules, errors} = parseRulesText(csv, team);
  assert.deepEqual(errors, []);
  assert.deepEqual(rules[1], {cond: 'ルカリオ', pick: [], ban: ['empoleon']});
  assert.deepEqual(rules[3].pick, ['', 'gholdengo']);
  const d = (opp, r = rules) => decidePick(r, opp, ids);
  // 3体の行がいちばん上で当たれば、その3体
  assert.deepEqual(d(['venusaur', 'hippowdon']).pick, ['garchomp', 'rillaboom', 'gholdengo']);
  // カバ → エンペ先発、マンダ → サーフゴー、残りは既定の先頭 (ドドゲザン)
  const a = d(['hippowdon', 'salamence']);
  assert.deepEqual(a.pick, ['empoleon', 'gholdengo', 'kingambit']);
  assert.deepEqual(a.from, [2, 3, 4]);
  // ルカリオがいればエンペルトは出さない
  assert.deepEqual(d(['lucario', 'hippowdon']).pick, ['kingambit', 'garchomp', 'rillaboom']);
  assert.deepEqual(d(['lucario']).bans, ['empoleon']);
  // 先発が空 → 下の行の先発、それもなければ最初に入った1体
  assert.deepEqual(d(['salamence']).pick, ['kingambit', 'gholdengo', 'garchomp']);
  // * が無くて足りなければ構築の並び順で埋める
  const r2 = parseRulesText('カバルドン,,サーフゴー', team).rules;
  const b = d(['hippowdon'], r2);
  assert.equal(b.pick.length, 3); assert.equal(b.pick[0], 'gholdengo'); assert.equal(b.auto, 2);
  // 書き出し → 読み直し
  assert.deepEqual(parseRulesText(rulesToText(rules), team).rules, rules);
  assert.equal(parseRulesText('ルカリオ,A,B,C,D', team).errors.length > 0, true);
});
