import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dex} from '../src/engine/dex.js';
import {newBattle, newTeam, newOpp, normalizeBattle, sendOut, condOf} from '../src/engine/battle.js';
import {boardContext} from '../src/engine/board.js';
import {addAct, replay} from '../src/engine/flow.js';
import {calcDamage, typesOf} from '../src/engine/calc.js';

const usage = JSON.parse(fs.readFileSync(new URL('../docs/usage-single.json', import.meta.url)));
const B = (species, o = {}) => ({species, item: '', ability: dex.species[species].ab[0], nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: '', ...o});
function battle(mine, opp) {
  const team = newTeam();
  team.mons = mine;
  const b = normalizeBattle(Object.assign(newBattle({team}), {start: null}));
  for (const s of opp) b.opp.push(newOpp(s));
  const nb = normalizeBattle(b);
  sendOut(nb, 'me', 0, 0); sendOut(nb, 'opp', 0, 0);
  return nb;
}
const mon = (b, side, i) => ({build: side === 'me' ? b.my[i] : b.opp[i], cond: condOf(b, side, i)});

test('へんげんじざい: 技を出すとそのタイプになり、2回目以降は変わらない (交代で戻る)', () => {
  const b = battle([B('greninja', {ability: 'protean', moves: ['icebeam', 'darkpulse']}), B('garchomp')], ['garchomp', 'hippowdon']);
  addAct(b, {side: 'me', type: 'move', move: 'icebeam', hpAfter: 10}, usage);
  assert.deepEqual(typesOf(b.my[0], condOf(b, 'me', 0)), ['Ice']);
  addAct(b, {side: 'me', type: 'move', move: 'darkpulse', hpAfter: 5, sameTurn: false}, usage);
  assert.deepEqual(typesOf(b.my[0], condOf(b, 'me', 0)), ['Ice'], '2回目は変わらない');
  addAct(b, {side: 'me', type: 'switch', to: 1}, usage);
  assert.equal(condOf(b, 'me', 0).types, null, '交代で元に戻る');
});

test('みずびたし: 相手がみずタイプになり、ダメージ計算にも反映', () => {
  const b = battle([B('rotomwash', {moves: ['soak', 'thunderbolt']})], ['garchomp']);
  const before = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'thunderbolt');
  assert.equal(before.max, 0, 'じめんに でんき は無効');
  addAct(b, {side: 'me', type: 'move', move: 'soak'}, usage);
  assert.deepEqual(typesOf(b.opp[0], condOf(b, 'opp', 0)), ['Water']);
  const after = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'thunderbolt');
  assert.ok(after.max > 0 && after.eff === 2);
});

test('ばけのかわ: 最初の攻撃は HP 1/8 だけ減り、推定に使わない。2回目からは普通に受ける', () => {
  const b = battle([B('garchomp', {moves: ['earthquake']})], ['mimikyu']);
  const r = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'earthquake');
  assert.ok(r.disguise && /ばけのかわ/.test(r.koText));
  const log = addAct(b, {side: 'me', type: 'move', move: 'earthquake'}, usage);
  assert.ok(Math.abs(condOf(b, 'opp', 0).hp - 87.5) < 1e-9);
  assert.ok(log.some(l => /ばけのかわ/.test(l)));
  assert.ok(condOf(b, 'opp', 0).disguiseBroken);
  assert.ok(!calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'earthquake').disguise);
});

test('ドラゴンテール: 相手を選んだポケモンと入れ替える (やり直しでも同じ)', () => {
  const b = battle([B('garchomp', {moves: ['dragontail']})], ['gholdengo', 'hippowdon', 'corviknight']);
  addAct(b, {side: 'me', type: 'move', move: 'dragontail', hpAfter: 80, forceTo: 2}, usage);
  assert.deepEqual(b.state.sides.opp.active, [2]);
  replay(b, usage);
  assert.deepEqual(b.state.sides.opp.active, [2]);
});

test('おうごんのからだ: 変化技 (あくび) は効かない。マジックミラー: ステルスロックをはね返す', () => {
  const b = battle([B('hippowdon', {moves: ['yawn', 'stealthrock']})], ['gholdengo', 'hatterene']);
  b.opp[0].ability = 'goodasgold';
  const l1 = addAct(b, {side: 'me', type: 'move', move: 'yawn'}, usage);
  assert.ok(l1.some(x => /おうごんのからだ/.test(x)));
  const b2 = battle([B('hippowdon', {moves: ['stealthrock']})], ['hatterene']);
  b2.opp[0].ability = 'magicbounce';
  addAct(b2, {side: 'me', type: 'move', move: 'stealthrock'}, usage);
  assert.ok(b2.state.sides.me.sr && !b2.state.sides.opp.sr);
});

test('バトルスイッチ: 攻撃技でブレード (計算もブレードのA)、キングシールドでシールド、交代でシールドに戻る', () => {
  const b = battle([B('aegislashshield', {nature: 'Adamant', sp: [2, 32, 0, 0, 0, 32], moves: ['shadowsneak', 'kingsshield']}), B('garchomp')], ['garchomp']);
  const shield = calcDamage(mon(b, 'opp', 0), mon(b, 'me', 0), 'earthquake');
  const hit = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'shadowsneak');
  assert.ok(hit.max > 0);
  addAct(b, {side: 'me', type: 'move', move: 'shadowsneak', hpAfter: 80}, usage);
  assert.equal(condOf(b, 'me', 0).forme, 'aegislashblade');
  const hit2 = calcDamage(mon(b, 'me', 0), mon(b, 'opp', 0), 'shadowsneak');
  assert.equal(hit2.max, hit.max, '待機中もブレードで計算している');
  const blade = calcDamage(mon(b, 'opp', 0), mon(b, 'me', 0), 'earthquake');
  assert.ok(blade.max > shield.max * 1.8, 'ブレード中は受けるダメージが増える');
  addAct(b, {side: 'me', type: 'move', move: 'kingsshield', sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 0).forme, null);
  addAct(b, {side: 'me', type: 'move', move: 'shadowsneak', hpAfter: 60, sameTurn: false}, usage);
  addAct(b, {side: 'me', type: 'switch', to: 1, sameTurn: false}, usage);
  assert.equal(condOf(b, 'me', 0).forme, null);
});

test('ターンの区切り: 両方が1回ずつ動いたら終われる。PPは使った回数だけ減る。分かっている持ち物の回復は聞かずに入る', async () => {
  const {sideDone, ppLeft, residualCandidates, finishTurn} = await import('../src/engine/flow.js');
  const b = battle([B('garchomp', {moves: ['earthquake'], item: 'leftovers'})], ['corviknight']);
  b.opp[0].item = 'leftovers';
  assert.ok(!sideDone(b, 'me') && !sideDone(b, 'opp'));
  addAct(b, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 100, sameTurn: true}, usage);
  assert.ok(sideDone(b, 'me') && !sideDone(b, 'opp'));
  addAct(b, {side: 'opp', type: 'move', move: 'bravebird', hpAfter: 60, sameTurn: true}, usage);
  assert.ok(sideDone(b, 'opp'));
  assert.deepEqual(ppLeft(b, 'me', 0, 'earthquake'), {left: 11, max: 12});
  const sure = residualCandidates(b, usage).filter(c => c.checked);
  assert.ok(sure.some(c => c.side === 'me' && c.key === 'leftovers'), '自分のたべのこし');
  finishTurn(b, usage, {residual: sure});
  assert.ok(condOf(b, 'me', 0).hp > 60);
  assert.ok(!sideDone(b, 'me'));
});

test('だいばくはつ: 使ったポケモンも倒れる (外れても)', () => {
  const b = battle([B('garchomp')], ['electrode', 'hippowdon']);
  addAct(b, {side: 'opp', type: 'move', move: 'explosion', hpAfter: 30}, usage);
  assert.ok(condOf(b, 'opp', 0).fainted);
  const b2 = battle([B('garchomp')], ['electrode']);
  addAct(b2, {side: 'opp', type: 'move', move: 'explosion', miss: true}, usage);
  assert.ok(condOf(b2, 'opp', 0).fainted, '外れても倒れる');
});

test('あくび・ムラッケ・交代: 眠気とランクとタイプは交代で消え、どく/もうどく/やけどは残る (もうどくのカウントは戻る)', async () => {
  const {finishTurn} = await import('../src/engine/flow.js');
  const b = battle([B('garchomp', {moves: ['earthquake']}), B('hippowdon')], ['slowking', 'glimmora']);
  addAct(b, {side: 'opp', type: 'move', move: 'yawn'}, usage);
  addAct(b, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 60}, usage);
  assert.ok(condOf(b, 'me', 0).drowsy);
  finishTurn(b, usage, {});
  assert.equal(condOf(b, 'me', 0).status, '', '1ターン目は眠らない');
  addAct(b, {side: 'opp', type: 'move', move: 'yawn'}, usage);
  addAct(b, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 30}, usage);
  finishTurn(b, usage, {});
  assert.equal(condOf(b, 'me', 0).status, 'slp', '次のターンの終わりに眠る');
  // ムラッケ
  const b2 = battle([B('garchomp')], ['glalie']);
  finishTurn(b2, usage, {moody: [{side: 'opp', mon: 0, up: 'spe', down: 'atk'}]});
  assert.equal(condOf(b2, 'opp', 0).boosts.spe, 2);
  assert.equal(condOf(b2, 'opp', 0).boosts.atk, -1);
  // 交代
  const c = condOf(b2, 'opp', 0);
  c.status = 'tox'; c.toxicCounter = 4; c.types = ['Water']; c.drowsy = 3;
  sendOut(b2, 'opp', 0, 0); // 同じ → 何もしない
  b2.opp.push(newOpp('hippowdon'));
  sendOut(b2, 'opp', 0, 1);
  assert.deepEqual(c.boosts.spe, 0);
  assert.equal(c.types, null); assert.equal(c.drowsy, 0);
  assert.equal(c.status, 'tox'); assert.equal(c.toxicCounter, 1);
});

test('1つ戻す: ターン終了を取り消すと、次の記録は戻ったターンに入る', async () => {
  const {finishTurn, reopenLastTurn, editAct, openTurn} = await import('../src/engine/flow.js');
  const b = battle([B('garchomp', {moves: ['earthquake']})], ['corviknight']);
  addAct(b, {side: 'me', type: 'move', move: 'earthquake', hpAfter: 100, sameTurn: true}, usage);
  addAct(b, {side: 'opp', type: 'move', move: 'bravebird', hpAfter: 60, sameTurn: true}, usage);
  finishTurn(b, usage, {});
  assert.equal(openTurn(b), null);
  reopenLastTurn(b, usage);
  assert.equal(openTurn(b).n, 1);
  editAct(b, 0, 1, null, usage);
  addAct(b, {side: 'opp', type: 'move', move: 'bodypress', hpAfter: 70, sameTurn: true}, usage);
  assert.equal(b.turns.length, 1);
  assert.equal(b.turns[0].acts.length, 2);
  assert.equal(condOf(b, 'me', 0).hp, 70);
});

test('能力ごとの性格補正 (natureMods): ▲を複数つけると両方の実数値が上がる', () => {
  const b = battle([B('garchomp', {moves: ['earthquake']})], ['corviknight']);
  const d = {build: {...b.opp[0], species: 'corviknight', sp: [0, 0, 0, 0, 0, 0], nature: 'Serious', ability: 'pressure', item: ''}, cond: condOf(b, 'opp', 0)};
  const plain = calcDamage(mon(b, 'me', 0), d, 'dragonclaw');
  const up = calcDamage(mon(b, 'me', 0), {...d, build: {...d.build, natureMods: {def: 1.1, spd: 1.1}}}, 'dragonclaw');
  assert.ok(plain.max > 0);
  assert.ok(up.max < plain.max);
});

test('さいきのいのり・しおづけ・回復技・はらだいこ', async () => {
  const {residualCandidates, finishTurn} = await import('../src/engine/flow.js');
  const {faintedCount} = await import('../src/engine/battle.js');
  const b = battle([B('garchomp'), B('hippowdon'), B('corviknight')], ['pawmot', 'garganacl']);
  condOf(b, 'opp', 1).hp = 0; condOf(b, 'opp', 1).fainted = true;
  assert.equal(faintedCount(b, 'opp'), 1);
  addAct(b, {side: 'opp', type: 'move', move: 'revivalblessing', revive: 1}, usage);
  assert.ok(!condOf(b, 'opp', 1).fainted);
  assert.equal(condOf(b, 'opp', 1).hp, 50);
  assert.equal(faintedCount(b, 'opp'), 0);
  // しおづけ: はがね (アーマーガア) は 1/8、それ以外は 1/16
  const b2 = battle([B('corviknight'), B('garchomp')], ['garganacl']);
  addAct(b2, {side: 'opp', type: 'move', move: 'saltcure', hpAfter: 80}, usage);
  addAct(b2, {side: 'me', type: 'move', move: 'roost'}, usage);
  assert.ok(condOf(b2, 'me', 0).hp > 80, 'はねやすめで回復');
  const c = residualCandidates(b2, usage).find(x => x.key === 'saltcure');
  assert.ok(c && c.checked && Math.abs(c.pct + 12.5) < 1);
  addAct(b2, {side: 'me', type: 'switch', to: 1}, usage);
  assert.ok(!condOf(b2, 'me', 0).salted, '交代で消える');
  // はらだいこ
  const b3 = battle([B('azumarill')], ['garchomp']);
  addAct(b3, {side: 'me', type: 'move', move: 'bellydrum'}, usage);
  assert.equal(condOf(b3, 'me', 0).hp, 50);
  assert.equal(condOf(b3, 'me', 0).boosts.atk, 6);
});

test('だっしゅつボタン・せいでんき・ねむりから目覚める・ふかしのこぶし', async () => {
  const {sideDone} = await import('../src/engine/flow.js');
  const b = battle([B('garchomp', {moves: ['earthquake', 'dragonclaw']})], ['corviknight', 'pawmot', 'hippowdon']);
  addAct(b, {side: 'me', type: 'move', move: 'dragonclaw', hpAfter: 70, eject: {reason: 'ejectbutton', who: 'tgt', to: 2}}, usage);
  assert.deepEqual(b.state.sides.opp.active, [2]);
  assert.equal(b.opp[0].item, 'ejectbutton');
  assert.ok(condOf(b, 'opp', 0).itemGone);
  assert.ok(sideDone(b, 'opp'), '出てきたポケモンはこのターン動かない');
  const b2 = battle([B('garchomp', {moves: ['dragonclaw']})], ['pawmot']);
  addAct(b2, {side: 'me', type: 'move', move: 'dragonclaw', hpAfter: 60, contactStatus: 'par', contactAbility: 'static'}, usage);
  assert.equal(condOf(b2, 'me', 0).status, 'par');
  assert.equal(b2.opp[0].ability, 'static');
  const b3 = battle([B('garchomp', {moves: ['dragonclaw']})], ['pawmot']);
  condOf(b3, 'me', 0).status = 'slp';
  addAct(b3, {side: 'me', type: 'move', move: 'dragonclaw', cant: true}, usage);
  assert.equal(condOf(b3, 'me', 0).statusCant, 1);
  addAct(b3, {side: 'me', type: 'move', move: 'dragonclaw', hpAfter: 50, sameTurn: false}, usage);
  assert.equal(condOf(b3, 'me', 0).status, '', '技を出せた = 起きた');
  const b4 = battle([B('excadrill', {moves: ['ironhead']})], ['corviknight']);
  const log = addAct(b4, {side: 'me', type: 'move', move: 'ironhead', hpAfter: 92, pierce: true}, usage);
  assert.equal(condOf(b4, 'opp', 0).hp, 92);
  assert.ok(log.some(l => /推定は見送り/.test(l)));
});
