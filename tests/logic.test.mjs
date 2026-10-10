import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dex} from '../src/engine/dex.js';
import {newCond, finalSpeed} from '../src/engine/calc.js';
import {newBattle, newTeam, newOpp, normalizeBattle, sendOut, commitTurn, undoTurn, megaEvolve, megaTarget, setHP, applyBoosts, clone, MOVE_BOOSTS, PIVOT_MOVES, SPEED_CHANGING, describeAct, UNDO_DEPTH} from '../src/engine/battle.js';
import {commitTurnInfer, inferSpeeds} from '../src/engine/infer.js';
import {oppView, oppCond, speedOutlook, parseSpread, PRESETS, speFromCombo, comboOf, megaLikelihood} from '../src/engine/assume.js';
import {boardContext, attackTable, speedTable, speedLine} from '../src/engine/board.js';
import {oppSpeciesStats, matchupActions, similarTeams, teamRecord, oppRanking, realBattles} from '../src/engine/predict.js';

const usage = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));
const usageD = JSON.parse(fs.readFileSync(new URL('../docs/usage-double.json', import.meta.url)));
const B = (species, o = {}) => ({species, item: '', ability: dex.species[species].ab[0], nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: '', ...o});

function makeBattle(format = 'single') {
  const team = newTeam(format);
  team.name = 'テスト構築';
  team.mons = [
    B('garchomp', {nature: 'Jolly', sp: [2, 32, 0, 0, 0, 32], moves: ['earthquake', 'dragonclaw', 'rockslide', 'swordsdance'], ability: 'roughskin'}),
    B('charizard', {item: 'charizarditey', nature: 'Timid', sp: [2, 0, 0, 32, 0, 32], moves: ['flamethrower', 'airslash', 'solarbeam', 'protect']}),
    B('incineroar', {ability: 'intimidate', moves: ['fakeout', 'flareblitz', 'knockoff', 'partingshot'], sp: [32, 0, 16, 0, 18, 0], nature: 'Careful'}),
    B('kingambit', {ability: 'defiant', moves: ['kowtowcleave', 'suckerpunch', 'ironhead', 'swordsdance'], nature: 'Adamant', sp: [32, 32, 0, 0, 2, 0]}),
    B('pelipper', {ability: 'drizzle', moves: ['hurricane', 'weatherball', 'tailwind', 'uturn']}),
    B('rotomwash', {moves: ['hydropump', 'voltswitch', 'thunderwave', 'protect'], nature: 'Bold', sp: [32, 0, 32, 0, 2, 0]}),
  ];
  const b = newBattle({team});
  for (const s of ['salamence', 'tyranitar', 'gengar', 'scizor', 'milotic', 'excadrill']) b.opp.push(newOpp(s));
  return normalizeBattle(b);
}

test('対戦の初期化と選出・繰り出し', () => {
  const b = makeBattle();
  assert.equal(b.my.length, 6);
  assert.equal(b.state.mons.opp.length, 6);
  assert.deepEqual(b.state.sides.me.active, [null]);
  sendOut(b, 'me', 0, 0);
  sendOut(b, 'opp', 0, 2);
  assert.deepEqual(b.state.sides.me.active, [0]);
  assert.deepEqual(b.pick, {me: [0], opp: [2]});
  const d = normalizeBattle(Object.assign(makeBattle(), {format: 'double'}));
  assert.equal(d.state.sides.me.active.length, 2);
});

test('いかく: 登場時に相手のこうげきが下がる。まけんきは差し引き+1、クリアボディは無効', () => {
  const b = makeBattle('double');
  b.format = 'double'; normalizeBattle(b);
  sendOut(b, 'opp', 0, 0); // ボーマンダ (特性不明)
  sendOut(b, 'me', 0, 3); // ドドゲザン (まけんき)
  sendOut(b, 'me', 1, 0); // ガブリアス
  b.opp[0].ability = 'intimidate';
  const log = [];
  sendOut(b, 'opp', 1, 1, {log});
  assert.deepEqual(b.state.mons.me[3].boosts.atk, 0, '相手2体目 (バンギラス) はいかくではない');
  // いかく持ちを出し直す
  sendOut(b, 'opp', 0, 4);
  sendOut(b, 'opp', 0, 0, {log});
  assert.equal(b.state.mons.me[3].boosts.atk, 1, 'まけんき: -1 → +2 で +1');
  assert.equal(b.state.mons.me[0].boosts.atk, -1);
  assert.ok(log.some(l => l.includes('こうげき')));
  // 自分のガオガエンのいかく → 相手のメタグロス (クリアボディ) には無効
  const c = makeBattle();
  c.opp[0] = newOpp('metagross');
  c.opp[0].ability = 'clearbody';
  sendOut(c, 'opp', 0, 0);
  sendOut(c, 'me', 0, 2);
  assert.equal(c.state.mons.opp[0].boosts.atk, 0);
});

test('天候特性・メガシンカで場が変わる', () => {
  const b = makeBattle();
  sendOut(b, 'opp', 0, 0);
  sendOut(b, 'me', 0, 4); // ペリッパー あめふらし
  assert.equal(b.state.field.weather, 'Rain');
  sendOut(b, 'me', 0, 1); // リザードン
  assert.equal(megaTarget(b, 'me', 1), 'charizardmegay');
  megaEvolve(b, 'me', 1);
  assert.equal(b.state.mons.me[1].forme, 'charizardmegay');
  assert.equal(b.state.field.weather, 'Sun', 'メガリザードンYのひでり');
  assert.ok(b.state.sides.me.megaUsed);
  // 交代してもメガシンカは戻らない / ランクは戻る
  b.state.mons.me[1].boosts.spa = 2;
  sendOut(b, 'me', 0, 0);
  assert.equal(b.state.mons.me[1].forme, 'charizardmegay');
  assert.equal(b.state.mons.me[1].boosts.spa, 0);
  // メガストーンを持たないポケモンはメガシンカできない
  assert.equal(megaTarget(b, 'me', 0), null);
  // 相手: 持ち物不明なら候補のメガ、判明後はそれに従う
  assert.equal(megaTarget(b, 'opp', 0), 'salamencemega');
  b.opp[0].item = 'choicescarf';
  assert.equal(megaTarget(b, 'opp', 0), null);
});

test('ターンの記録: 技・交代・自動反映・取り消し', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0);
  sendOut(b, 'opp', 0, 1); // バンギラス
  const before = clone(b.state);
  const log = commitTurn(b, {acts: [
    {side: 'me', mon: 0, type: 'move', move: 'swordsdance', flags: {}},
    {side: 'opp', mon: 1, type: 'move', move: 'stealthrock', flags: {}},
  ]});
  assert.equal(b.turns.length, 1);
  assert.equal(b.state.mons.me[0].boosts.atk, 2);
  assert.ok(b.state.sides.me.sr, 'ステルスロックは受ける側 (自分) の場に');
  assert.ok(!b.state.sides.opp.sr);
  assert.deepEqual(b.opp[1].moves, ['stealthrock'], '相手の技が判明済みに入る');
  assert.ok(log.length >= 2);
  assert.deepEqual(b.turns[0].acts[0].vs, ['tyranitar']);
  // 交代: ランクがリセットされる
  commitTurn(b, {acts: [
    {side: 'me', mon: 0, type: 'switch', to: 5},
    {side: 'opp', mon: 1, type: 'move', move: 'crunch', flags: {}},
  ]});
  assert.deepEqual(b.state.sides.me.active, [5]);
  assert.equal(b.state.mons.me[0].boosts.atk, 0);
  assert.equal(b.turns[1].acts[0].toSp, 'rotomwash');
  assert.deepEqual(b.pick.me, [0, 5]);
  // 取り消し
  assert.ok(undoTurn(b));
  assert.deepEqual(b.state.sides.me.active, [0]);
  assert.equal(b.state.mons.me[0].boosts.atk, 2);
  assert.deepEqual(b.opp[1].moves, ['stealthrock']);
  assert.ok(undoTurn(b));
  assert.deepEqual(b.state, before);
  assert.deepEqual(b.opp[1].moves, []);
  assert.ok(!undoTurn(b));
});

test('ターンの記録: 外れ・まもる・行動不能では効果を反映しない', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 1);
  commitTurn(b, {acts: [{side: 'opp', mon: 1, type: 'move', move: 'stealthrock', flags: {cant: true}}]});
  assert.ok(!b.state.sides.me.sr);
  commitTurn(b, {acts: [{side: 'opp', mon: 1, type: 'move', move: 'icywind', flags: {miss: true}}]});
  assert.equal(b.state.mons.me[0].boosts.spe, 0);
  commitTurn(b, {acts: [{side: 'opp', mon: 1, type: 'move', move: 'icywind', flags: {}}]});
  assert.equal(b.state.mons.me[0].boosts.spe, -1);
});

test('技の効果: 壁・おいかぜ・トリックルーム・天候・きりばらい・とんぼがえり・はたきおとす', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 4); sendOut(b, 'opp', 0, 1);
  b.state.field.weather = '';
  commitTurn(b, {acts: [{side: 'me', mon: 4, type: 'move', move: 'tailwind', flags: {}}, {side: 'opp', mon: 1, type: 'move', move: 'sandstorm', flags: {}}]});
  assert.ok(b.state.sides.me.tailwind);
  assert.equal(b.state.field.weather, 'Sand');
  assert.equal(b.state.sides.me.since.tailwind, 1);
  commitTurn(b, {acts: [{side: 'opp', mon: 1, type: 'move', move: 'trickroom', flags: {}}]});
  assert.ok(b.state.field.trickRoom);
  commitTurn(b, {acts: [{side: 'opp', mon: 1, type: 'move', move: 'trickroom', flags: {}}]});
  assert.ok(!b.state.field.trickRoom, '2回目で解除');
  b.state.sides.me.sr = true; b.state.sides.opp.reflect = true; b.state.sides.opp.spikes = 2;
  commitTurn(b, {acts: [{side: 'me', mon: 4, type: 'move', move: 'defog', flags: {}}]});
  assert.ok(!b.state.sides.me.sr && !b.state.sides.opp.reflect && b.state.sides.opp.spikes === 0);
  // とんぼがえり + 交代先
  commitTurn(b, {acts: [{side: 'me', mon: 4, type: 'move', move: 'uturn', to: 2, flags: {}}]});
  assert.deepEqual(b.state.sides.me.active, [2]);
  assert.equal(b.state.mons.opp[1].boosts.atk, -1, '出てきたガオガエンのいかく');
  // はたきおとす
  b.opp[1].item = 'leftovers';
  commitTurn(b, {acts: [{side: 'me', mon: 2, type: 'move', move: 'knockoff', flags: {}}]});
  assert.ok(b.state.mons.opp[1].itemGone);
  // メガストーンは落とせない
  const c = makeBattle();
  sendOut(c, 'me', 0, 2); sendOut(c, 'opp', 0, 0);
  c.opp[0].item = 'salamencite';
  commitTurn(c, {acts: [{side: 'me', mon: 2, type: 'move', move: 'knockoff', flags: {}}]});
  assert.ok(!c.state.mons.opp[0].itemGone);
});

test('ランク変化: あまのじゃく・ちからずく・上限', () => {
  const b = makeBattle();
  b.my[0] = B('serperior', {ability: 'contrary', moves: ['leafstorm']});
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 1);
  commitTurn(b, {acts: [{side: 'me', mon: 0, type: 'move', move: 'leafstorm', flags: {}}]});
  assert.equal(b.state.mons.me[0].boosts.spa, 2, 'あまのじゃくリーフストーム');
  applyBoosts(b, 'me', 0, {spa: -12});
  assert.equal(b.state.mons.me[0].boosts.spa, 6, 'あまのじゃくで反転し、+6 が上限');
  applyBoosts(b, 'opp', 1, {atk: 12});
  assert.equal(b.state.mons.opp[1].boosts.atk, 6);
  for (const id of Object.keys(MOVE_BOOSTS)) if (dex.moves[id]) assert.ok(MOVE_BOOSTS[id].self || MOVE_BOOSTS[id].target, id);
  for (const id of [...PIVOT_MOVES]) assert.ok(dex.moves[id] || ['teleport', 'batonpass', 'shedtail', 'chillyreception', 'partingshot', 'flipturn'].includes(id), id);
});

test('ターン記録中のメガシンカ: 相手のメガストーンが確定する', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 0);
  commitTurn(b, {acts: [{side: 'opp', mon: 0, type: 'move', move: 'doubleedge', mega: true, flags: {}}]});
  assert.equal(b.state.mons.opp[0].forme, 'salamencemega');
  assert.equal(b.opp[0].item, 'salamencite');
  assert.ok(b.opp[0].megaSeen);
  undoTurn(b);
  assert.equal(b.opp[0].item, '');
  assert.ok(!b.opp[0].megaSeen);
  assert.equal(b.state.mons.opp[0].forme, null);
});

test('HP: 0でひんし、控えへのダメージ表から外れる', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 0);
  setHP(b, 'opp', 3, 0);
  assert.ok(b.state.mons.opp[3].fainted);
  const ctx = boardContext(b, usage);
  const t = attackTable(ctx, 'me', 0);
  assert.equal(t.targets.length, 5);
  assert.ok(t.targets[0].active);
  assert.equal(t.targets[0].idx, 0);
});

test('取り消し用スナップショットは直近分だけ保持', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 0);
  for (let i = 0; i < UNDO_DEPTH + 4; i++) commitTurn(b, {acts: [{side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}}]});
  assert.equal(b.turns.filter(t => t.before).length, UNDO_DEPTH);
  assert.ok(b.turns[b.turns.length - 1].before);
});

test('相手の推定: 使用率から配分・持ち物・技が埋まり、判明情報が優先される', () => {
  const o = newOpp('garchomp');
  let v = oppView(o, usage);
  assert.ok(v.hasData);
  assert.ok(v.itemGuess && v.build.item, '持ち物は推定');
  assert.ok(dex.natures[v.build.nature]);
  assert.equal(v.build.sp.length, 6);
  assert.ok(v.moves.length >= 4 && v.moves.every(m => !m.known));
  assert.ok(v.moves.some(m => m.id === 'earthquake'));
  o.item = 'focussash'; o.ability = 'roughskin'; o.moves = ['earthquake', 'stealthrock'];
  v = oppView(o, usage);
  assert.equal(v.build.item, 'focussash');
  assert.ok(!v.itemGuess);
  assert.deepEqual(v.moves.slice(0, 2).map(m => [m.id, m.known]), [['earthquake', true], ['stealthrock', true]]);
  assert.ok(!v.moves.slice(2).some(m => m.id === 'earthquake'));
  // 型の切り替え
  o.assume = {kind: 'preset', key: 'hb'};
  v = oppView(o, usage);
  assert.deepEqual(v.build.sp, PRESETS.hb.sp);
  assert.equal(v.build.nature, 'Impish', '物理アタッカー寄りの種族はわんぱく');
  o.assume = {kind: 'custom', nature: 'Adamant', sp: [0, 32, 0, 0, 0, 32]};
  assert.equal(oppView(o, usage).build.nature, 'Adamant');
  o.assume = {kind: 'usage', idx: 99};
  assert.ok(oppView(o, usage).build.sp, '範囲外の順位でも落ちない');
  // 使用率データが無くても動く
  v = oppView(newOpp('garchomp'), null);
  assert.equal(v.hasData, false);
  assert.deepEqual(v.build.sp, [0, 0, 0, 0, 0, 0]);
});

test('相手の推定: メガシンカの見込み', () => {
  const ml = megaLikelihood(usage, 'salamence');
  assert.equal(ml.forme, 'salamencemega');
  assert.ok(ml.p > 0 && ml.p <= 1);
  const o = newOpp('salamence');
  const v = oppView(o, usage);
  if (ml.p >= 0.5) { assert.equal(v.megaForme, 'salamencemega'); assert.equal(v.build.item, 'salamencite'); }
  // 別のポケモンがメガシンカ済みなら、メガ想定をしない
  assert.equal(oppView(o, usage, {megaBlocked: true}).megaForme, null);
  // 持ち物が判明していればそれに従う
  o.item = 'choicescarf';
  assert.equal(oppView(o, usage).megaForme, null);
  o.item = 'salamencite';
  assert.equal(oppView(o, usage).megaForme, 'salamencemega');
  assert.equal(oppCond(newCond(), oppView(o, usage)).forme, 'salamencemega');
  // リザードン: X/Y のうち持ち物で決まる
  const c = newOpp('charizard'); c.item = 'charizarditex';
  assert.equal(oppView(c, usage).megaForme, 'charizardmegax');
});

test('ダメージ表: 控えには設置技・いかく・天候変化を加味する', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 1);
  b.opp[0].ability = 'intimidate'; b.opp[0].item = 'choicescarf';
  b.opp[4].assume = {kind: 'preset', key: 'none'};
  let ctx = boardContext(b, usage);
  let t = attackTable(ctx, 'me', 0);
  assert.deepEqual(t.moves.map(m => m.id), ['earthquake', 'dragonclaw', 'rockslide', 'swordsdance']);
  const mence = t.targets.find(x => x.idx === 0);
  assert.ok(mence.notes.includes('いかく込み'));
  // いかく無しの場合より小さい
  b.opp[0].ability = 'moxie';
  const t2 = attackTable(boardContext(b, usage), 'me', 0);
  assert.ok(mence.results.dragonclaw.max < t2.targets.find(x => x.idx === 0).results.dragonclaw.max);
  assert.ok(mence.results.earthquake.immune);
  assert.ok(t.targets[0].results.swordsdance.status);
  // 設置技
  b.state.sides.opp.sr = true;
  t = attackTable(boardContext(b, usage), 'me', 0);
  assert.ok(t.targets.find(x => x.idx === 0).notes.includes('設置技込み'));
  assert.ok(!t.targets.find(x => x.idx === 1).notes.includes('設置技込み'), '場にいる相手には加味しない');
  // 被ダメージ: 相手の候補技から
  ctx = boardContext(b, usage);
  const d = attackTable(ctx, 'opp', 1);
  assert.ok(d.moves.length >= 1 && d.moves.length <= 8);
  assert.equal(d.targets.length, 6);
  assert.ok(d.targets[0].active && d.targets[0].idx === 0);
  // 自分の控えのいかく (ガオガエン) が相手の物理技に反映される
  const inc = d.targets.find(x => x.idx === 2);
  assert.ok(inc.notes.includes('いかく込み'));
});

test('ダメージ表: ダブルの範囲技と味方の特性', () => {
  const b = makeBattle('double');
  b.format = 'double'; normalizeBattle(b);
  sendOut(b, 'me', 0, 0); sendOut(b, 'me', 1, 1);
  sendOut(b, 'opp', 0, 1); sendOut(b, 'opp', 1, 4);
  for (const o of b.opp) o.assume = {kind: 'preset', key: 'none'};
  const ctx = boardContext(b, usageD);
  const t = attackTable(ctx, 'me', 0);
  const rs = t.targets.find(x => x.idx === 1).results.rockslide;
  // 相手が1体だけになれば範囲補正が消えて上がる
  setHP(b, 'opp', 4, 0);
  const t1 = attackTable(boardContext(b, usageD), 'me', 0);
  const rs1 = t1.targets.find(x => x.idx === 1).results.rockslide;
  assert.ok(rs1.max > rs.max * 1.25, `${rs1.max} > ${rs.max}`);
  // じしんは味方も巻き込むので、相手1体でも範囲補正が残る
  const eq1 = t1.targets.find(x => x.idx === 1).results.earthquake;
  setHP(b, 'me', 1, 0);
  const eqSolo = attackTable(boardContext(b, usageD), 'me', 0).targets.find(x => x.idx === 1).results.earthquake;
  assert.ok(eqSolo.max > eq1.max * 1.25);
  // てだすけ
  const hh = attackTable(boardContext(b, usageD), 'me', 0, {helpingHand: true}).targets.find(x => x.idx === 1).results.earthquake;
  assert.ok(hh.max > eqSolo.max * 1.45);
});

test('素早さ: 対面比較と使用率からの先手確率', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 2); // ガブリアス(169) vs ゲンガー
  const ctx = boardContext(b, usage);
  const t = speedTable(ctx, 0);
  assert.equal(t.my, 169);
  const o = t.rows[0].outlook;
  assert.equal(o.bench.length, 4);
  assert.equal(o.bench[0].label, '最速');
  // 計算に使う姿 (メガ想定なら メガゲンガー) の種族値で出る
  const base = dex.species[o.speciesId].bs[5];
  assert.equal(o.bench[1].raw, base + 20 + 32);
  assert.equal(o.bench[0].raw, Math.floor((base + 52) * 1.1));
  if (o.pFaster != null) assert.ok(Math.abs(o.pFaster + o.pTie + o.pSlower - 1) < 1e-9);
  // トリックルームで反転
  b.state.field.trickRoom = true;
  const o2 = speedTable(boardContext(b, usage), 0).rows[0].outlook;
  if (o.pFaster != null) assert.ok(Math.abs(o2.pFaster - o.pSlower) < 1e-9);
  // おいかぜで自分が倍
  b.state.sides.me.tailwind = true;
  assert.equal(speedTable(boardContext(b, usage), 0).my, 338);
  assert.equal(speedLine(boardContext(b, usage)).length, 12);
});

test('行動順からの素早さ絞り込み', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 4); // ガブリアス(169) vs ミロカロス(種族値81)
  b.opp[4].ability = 'marvelscale';
  // ミロカロスは最速でも 133。先に動いたならスカーフしかない (133*1.5=199 > 169)
  let log = commitTurnInfer(b, {orderKnown: true, acts: [
    {side: 'opp', mon: 4, type: 'move', move: 'scald', flags: {}},
    {side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}},
  ]});
  assert.ok(b.opp[4].speOk);
  assert.ok(!b.opp[4].speOk.plain.includes('1'), 'スカーフなしはありえない');
  assert.ok(b.opp[4].speOk.scarf.includes('1'));
  assert.ok(b.opp[4].scarfLikely);
  assert.ok(log.some(l => l.includes('スカーフ')));
  // スカーフ時に 169 以上になる配分だけが残る: 実数値*1.5 >= 169 → 実数値 >= 113
  for (let i = 0; i < 99; i++) {
    const raw = speFromCombo('milotic', i);
    assert.equal(b.opp[4].speOk.scarf[i] === '1', Math.floor(raw * 1.5) >= 169, `raw ${raw}`);
  }
  // 取り消すと絞り込みも戻る
  undoTurn(b);
  assert.equal(b.opp[4].speOk, null);
  assert.ok(!b.opp[4].scarfLikely);

  // 自分が先に動いた → 相手は 169 以下
  commitTurnInfer(b, {orderKnown: true, acts: [
    {side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}},
    {side: 'opp', mon: 4, type: 'move', move: 'scald', flags: {}},
  ]});
  assert.ok(b.opp[4].speOk.plain.split('').every(c => c === '1'), 'スカーフなしなら全配分が可能');
  for (let i = 0; i < 99; i++) assert.equal(b.opp[4].speOk.scarf[i] === '1', Math.floor(speFromCombo('milotic', i) * 1.5) <= 169);

  // 優先度が違う技同士では絞り込まない
  const c = makeBattle();
  sendOut(c, 'me', 0, 3); sendOut(c, 'opp', 0, 4);
  c.opp[4].ability = 'marvelscale';
  commitTurnInfer(c, {orderKnown: true, acts: [
    {side: 'me', mon: 3, type: 'move', move: 'suckerpunch', flags: {}},
    {side: 'opp', mon: 4, type: 'move', move: 'scald', flags: {}},
  ]});
  assert.equal(c.opp[4].speOk, null);
  // 行動順を記録しない設定なら絞り込まない
  const d = makeBattle();
  sendOut(d, 'me', 0, 0); sendOut(d, 'opp', 0, 4);
  d.opp[4].ability = 'marvelscale';
  commitTurnInfer(d, {orderKnown: false, acts: [
    {side: 'opp', mon: 4, type: 'move', move: 'scald', flags: {}},
    {side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}},
  ]});
  assert.equal(d.opp[4].speOk, null);
  // すいすい等の可能性があり特性不明なら絞り込まない
  const e = makeBattle();
  e.opp[4] = newOpp('kingdra' in dex.species ? 'kingdra' : 'excadrill');
  sendOut(e, 'me', 0, 0); sendOut(e, 'opp', 0, 4);
  commitTurnInfer(e, {orderKnown: true, acts: [
    {side: 'opp', mon: 4, type: 'move', move: 'earthquake', flags: {}},
    {side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}},
  ]});
  assert.equal(e.opp[4].speOk, null);
});

test('素早さ絞り込み: トリックルーム中は逆向き、絞り込み結果が先手確率に反映される', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 4);
  b.opp[4].ability = 'marvelscale'; b.opp[4].item = 'leftovers';
  b.state.field.trickRoom = true;
  commitTurnInfer(b, {orderKnown: true, acts: [
    {side: 'opp', mon: 4, type: 'move', move: 'scald', flags: {}},
    {side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}},
  ]});
  // トリル下で相手が先 = 相手のほうが遅い (169以下) → 全配分が可能
  assert.ok(b.opp[4].speOk.plain.split('').every(c => c === '1'));
  assert.ok(!b.opp[4].speOk.scarf.includes('1'), '持ち物判明済みならスカーフの線はない');
  const o = speedTable(boardContext(b, usage), 0).rows[0].outlook;
  assert.ok(o.range.plain);
  assert.equal(o.range.scarf, null);
});

test('統計: 選出率・初手率・対面行動・似た並び・戦績', () => {
  const list = [];
  for (let k = 0; k < 4; k++) {
    const b = makeBattle();
    sendOut(b, 'me', 0, 0);
    sendOut(b, 'opp', 0, k < 3 ? 0 : 1);
    commitTurn(b, {acts: [
      {side: 'me', mon: 0, type: 'move', move: 'dragonclaw', flags: {}},
      k < 2 ? {side: 'opp', mon: 0, type: 'move', move: 'dragondance', flags: {}} : k === 2 ? {side: 'opp', mon: 0, type: 'switch', to: 3} : {side: 'opp', mon: 1, type: 'move', move: 'stoneedge', flags: {}},
    ]});
    b.result = k % 2 ? 'lose' : 'win';
    list.push(b);
  }
  const sim = makeBattle(); sim.kind = 'sim'; sendOut(sim, 'opp', 0, 0); list.push(sim);
  const del = makeBattle(); del.deleted = true; list.push(del);
  assert.equal(realBattles(list).length, 4);
  const st = oppSpeciesStats(list, 'salamence');
  assert.equal(st.seen, 4);
  assert.equal(st.picked, 3);
  assert.equal(st.lead, 3);
  assert.equal(st.moves.dragondance, 2);
  const m = matchupActions(list, 'salamence', 'garchomp');
  assert.equal(m.n, 3);
  assert.equal(m.moves.dragondance, 2);
  assert.equal(m.switches.scizor, 1);
  assert.equal(m.turn1.n, 3);
  assert.equal(matchupActions(list, 'salamence', 'charizard').n, 0);
  const s = similarTeams(list, ['salamence', 'tyranitar', 'gengar', 'scizor', 'pikachu', 'raichu']);
  assert.equal(s.n, 4);
  assert.equal(s.picked.salamence, 3);
  assert.equal(s.lead.tyranitar, 1);
  assert.equal(similarTeams(list, ['pikachu', 'raichu', 'salamence']).n, 0);
  const rec = teamRecord(list, list[0].teamId);
  assert.equal(rec.n, 1, '構築IDごと');
  const rk = oppRanking(list);
  assert.equal(rk[0].seen, 4);
  assert.equal(realBattles(list, {format: 'double'}).length, 0);
});

test('行動の説明文', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 0);
  commitTurn(b, {acts: [{side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {crit: true}}, {side: 'opp', mon: 0, type: 'switch', to: 1}]});
  assert.equal(describeAct(b, b.turns[0].acts[0]), '自 ガブリアス じしん [急所]');
  assert.equal(describeAct(b, b.turns[0].acts[1]), '相 ボーマンダ → バンギラス に交代');
  assert.ok(SPEED_CHANGING.has('tailwind'));
  assert.ok(parseSpread('Jolly:2/32/0/0/0/32'));
  assert.equal(parseSpread('x'), null);
  assert.equal(comboOf(1.1, 32), 98);
  assert.ok(inferSpeeds);
  assert.ok(finalSpeed);
});

import {inferFromTaken, inferFromDealt, applyInference, spreadFits} from '../src/engine/infer-dmg.js';
import {calcDamage} from '../src/engine/calc.js';
import {comboOf as cOf} from '../src/engine/assume.js';

test('ダメージからの逆算: 実際の配分が候補に残り、想定が合う型に切り替わる', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 5); sendOut(b, 'opp', 0, 1); // ウォッシュロトム vs バンギラス
  b.opp[1].ability = 'sandstream'; b.opp[1].item = 'leftovers';
  b.opp[1].assume = {kind: 'preset', key: 'none'};
  const truth = {species: 'tyranitar', item: 'leftovers', ability: 'sandstream', nature: 'Adamant', sp: [32, 32, 0, 0, 2, 0], moves: []};
  // 受けたダメージ: いじっぱりA32 のかみくだく
  let ctx = boardContext(b, usage);
  const real = calcDamage({build: truth, cond: b.state.mons.opp[1]}, {build: b.my[5], cond: b.state.mons.me[5]}, 'crunch', {field: b.state.field});
  const res = inferFromTaken(ctx, 1, 5, 'crunch', real.rolls[8]);
  assert.equal(res.stat, 'atk');
  assert.equal(res.mask[cOf(1.1, 32)], '1', '真の配分は候補に残る');
  assert.equal(res.mask[cOf(1, 0)], '0', '無振りは否定される');
  assert.ok(res.count < 40);
  const msg = applyInference(b.opp[1], ctx.views[1], res);
  assert.match(msg, /こうげきの実数値/);
  ctx = boardContext(b, usage);
  assert.ok(spreadFits(b.opp[1], ctx.views[1].build.nature, ctx.views[1].build.sp), '切り替え後の想定は矛盾しない');
  assert.equal(b.opp[1].assume.key, 'none', '型の選び直しはしない');
  assert.equal(ctx.views[1].build.sp[1] >= 28 || ctx.views[1].build.nature === 'Adamant', true, 'こうげきだけ観測に合わせて補正される');
  assert.deepEqual([ctx.views[1].build.sp[0], ctx.views[1].build.sp[3]], [0, 0], '観測のない能力はそのまま');

  // 与えたダメージ: 相手 HP 100% → after%
  const dealt = calcDamage({build: b.my[5], cond: b.state.mons.me[5]}, {build: truth, cond: b.state.mons.opp[1]}, 'hydropump', {field: b.state.field});
  const after = 100 - (dealt.rolls[8] / dealt.defMaxHP) * 100;
  const r2 = inferFromDealt(ctx, 5, 1, 'hydropump', 100, after);
  assert.equal(r2.stat, 'spd');
  assert.equal(r2.mask[32 * 99 + cOf(1, 2)], '1', '真の H32 D2 は候補に残る');
  assert.equal(r2.mask[0 * 99 + cOf(0.9, 0)], '0', 'H0 D下降は否定される');
  assert.match(applyInference(b.opp[1], ctx.views[1], r2), /HPの能力ポイント/);
  // ありえない値は保存しない
  const before = JSON.stringify(b.opp[1].statOk);
  assert.match(applyInference(b.opp[1], ctx.views[1], inferFromTaken(ctx, 1, 5, 'crunch', 9999)), /説明がつきません/);
  assert.equal(JSON.stringify(b.opp[1].statOk), before);
  assert.equal(inferFromTaken(ctx, 1, 5, 'foulplay', 50), null);
});

import {addAct, endTurn, openTurn, actLine} from '../src/engine/flow.js';
import {estimateStats, scenarioBuild} from '../src/engine/estimate.js';

test('時系列入力: 1行動ずつ追加すると盤面・判明技・HP・能力の絞り込みに反映される', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 5); sendOut(b, 'opp', 0, 1); // ウォッシュロトム vs バンギラス
  b.opp[1].ability = 'sandstream'; b.opp[1].item = 'leftovers'; b.opp[1].assume = {kind: 'preset', key: 'none'};
  const truth = {species: 'tyranitar', item: 'leftovers', ability: 'sandstream', nature: 'Adamant', sp: [32, 32, 0, 0, 2, 0], moves: []};
  const real = calcDamage({build: truth, cond: b.state.mons.opp[1]}, {build: b.my[5], cond: b.state.mons.me[5]}, 'crunch', {field: b.state.field});
  const myMax = statsOf5(b.my[5]);
  const after = 100 - (real.rolls[8] / myMax) * 100;
  let log = addAct(b, {side: 'opp', type: 'move', move: 'crunch', hpAfter: after}, usage);
  assert.equal(b.turns.length, 1);
  assert.ok(openTurn(b));
  assert.deepEqual(b.opp[1].moves, ['crunch']);
  assert.ok(Math.abs(b.state.mons.me[5].hp - after) < 1e-9);
  assert.ok(b.opp[1].statOk?.atk, 'こうげきが絞り込まれる');
  assert.ok(log.some(l => l.includes('こうげきの実数値')));
  assert.match(actLine(b, b.turns[0].acts[0]), /^かみくだく \d+%$/);
  // 同じターンに自分の行動
  addAct(b, {side: 'me', type: 'move', move: 'thunderwave'}, usage);
  assert.equal(b.turns.length, 1);
  assert.equal(b.turns[0].acts.length, 2);
  // 同じ側がもう一度動いたら次のターンへ
  addAct(b, {side: 'me', type: 'switch', to: 0}, usage);
  assert.equal(b.turns.length, 2);
  assert.ok(!b.turns[0].open && b.turns[1].open);
  assert.deepEqual(b.state.sides.me.active, [0]);
  assert.equal(actLine(b, b.turns[1].acts[0]), '交代 ガブリアス');
  endTurn(b, usage);
  assert.ok(!openTurn(b));
  // 取り消しでターンごと戻る (絞り込みも戻る)
  undoTurn(b); undoTurn(b);
  assert.equal(b.turns.length, 0);
  assert.equal(b.opp[1].statOk, undefined);
  assert.equal(b.state.mons.me[5].hp, 100);
  assert.deepEqual(b.opp[1].moves, []);
});

test('時系列入力: 行動順から素早さが絞り込まれる (入力順 = 行動順)', () => {
  const b = makeBattle();
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 4);
  b.opp[4].ability = 'marvelscale';
  addAct(b, {side: 'opp', type: 'move', move: 'scald', hpAfter: 80}, usage);
  addAct(b, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 60}, usage);
  endTurn(b, usage);
  assert.ok(b.opp[4].speOk, '相手が先に動いた → 絞り込み');
  assert.ok(!b.opp[4].speOk.plain.includes('1'));
  assert.ok(b.opp[4].scarfLikely);
});

test('推定能力ポイント: 絞り込みの範囲と残りポイント、無振り/全振りの配分', () => {
  const o = newOpp('tyranitar');
  let e = estimateStats(o, 'tyranitar');
  assert.equal(e.remain, 66);
  assert.deepEqual([e.rows[0].spLo, e.rows[0].spHi], [0, 32]);
  // こうげきが SP28以上・補正ありに絞り込まれた場合
  let mask = '';
  for (let c = 0; c < 99; c++) mask += c >= 66 + 28 ? '1' : '0';
  o.statOk = {atk: mask};
  e = estimateStats(o, 'tyranitar');
  assert.deepEqual([e.rows[1].spLo, e.rows[1].spHi], [28, 32]);
  assert.equal(e.remain, 38);
  assert.equal(e.rows[2].spHi, 32);
  const base = {species: 'tyranitar', item: '', ability: 'sandstream', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: []};
  const lo = scenarioBuild(o, base, 'tyranitar', 'bulkMin', 'P');
  assert.deepEqual(lo.sp, [0, 28, 0, 0, 0, 0]);
  const hi = scenarioBuild(o, base, 'tyranitar', 'bulkMax', 'P');
  assert.deepEqual(hi.sp, [32, 28, 6, 0, 0, 0], '残り38を HP32 + B6 に');
  assert.equal(hi.nature, 'Bold');
  const pm = scenarioBuild(o, base, 'tyranitar', 'powMax', 'P');
  assert.equal(pm.sp[1], 32);
  assert.equal(pm.nature, 'Adamant');
  assert.equal(scenarioBuild(o, base, 'tyranitar', 'powMin', 'P').nature, 'Adamant', '補正ありが確定しているので下限も補正あり');
  assert.equal(scenarioBuild(newOpp('tyranitar'), base, 'tyranitar', 'powMin', 'S').nature, 'Serious');
});

function statsOf5(build) { return calcDamage({build, cond: newCond()}, {build, cond: newCond()}, 'tackle' in dex.moves ? 'tackle' : 'bodyslam').defMaxHP; }
