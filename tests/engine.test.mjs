import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import calcPkg from '@smogon/calc';
import {dex, statsOf, STAT_KEYS, search, normKana, megaFormeFor, typeEffect, baseSpeciesId} from '../src/engine/dex.js';
import {calcDamage, finalSpeed, turnOrder, newCond, referenceDamage, gen, movePriority, defaultHits, toCalcPokemon} from '../src/engine/calc.js';

const {Pokemon, Move, Field, calculate} = calcPkg;
const mon = (species, o = {}) => ({build: {species, item: '', ability: dex.species[species].ab[0], nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], ...o.build}, cond: {...newCond(), ...o.cond}});

test('図鑑データ: 全項目に日本語名があり、参照が壊れていない', () => {
  for (const [id, s] of Object.entries(dex.species)) {
    assert.ok(s.j && !/^[A-Za-z]/.test(s.j), `species ${id} の日本語名`);
    assert.equal(s.bs.length, 6);
    assert.ok(s.ab.length >= 1, `${id} の特性`);
    for (const a of s.ab) assert.ok(dex.abilities[a], `${id} の特性 ${a}`);
    for (const m of s.megas || []) assert.equal(dex.species[m].mega, id);
    assert.ok(dex.learn[id]?.length, `${id} の習得技`);
  }
  for (const [id, m] of Object.entries(dex.moves)) assert.ok(m.j && !/^[A-Za-z]/.test(m.j), `move ${id}`);
  for (const [id, m] of Object.entries(dex.items)) assert.ok(m.j && !/^[A-Za-z]/.test(m.j), `item ${id}`);
  for (const [id, m] of Object.entries(dex.abilities)) assert.ok(m.j && !/^[A-Za-z]/.test(m.j), `ability ${id}`);
  assert.equal(Object.keys(dex.natures).length, 25);
});

test('日本語名の重複がない (検索で取り違えない)', () => {
  for (const kind of ['species', 'moves', 'items', 'abilities']) {
    const seen = new Map();
    for (const [id, v] of Object.entries(dex[kind])) {
      assert.ok(!seen.has(v.j), `${kind}: ${v.j} が ${seen.get(v.j)} と ${id} で重複`);
      seen.set(v.j, id);
    }
  }
});

test('能力値: 計算機ライブラリと全種族・全性格・SP 0/1/16/31/32 で一致', () => {
  for (const [id, s] of Object.entries(dex.species)) {
    for (const nature of Object.keys(dex.natures)) {
      for (const v of [0, 1, 16, 31, 32]) {
        const sp = [v, v, v, v, v, v];
        const mine = statsOf(id, sp, nature);
        const p = new Pokemon(gen, s.n, {nature, evs: Object.fromEntries(STAT_KEYS.map(k => [k, v]))});
        assert.deepEqual(mine, STAT_KEYS.map(k => p.rawStats[k]), `${id} ${nature} ${v}`);
      }
    }
  }
});

test('能力値: 公開されている計算式の具体例 (HP=種族値+75+SP, 他=(種族値+20+SP)×補正)', () => {
  // ガブリアス 108-130-95-80-85-102
  assert.deepEqual(statsOf('garchomp', [0, 0, 0, 0, 0, 0], 'Serious'), [183, 150, 115, 100, 105, 122]);
  assert.deepEqual(statsOf('garchomp', [2, 32, 0, 0, 0, 32], 'Jolly'), [185, 182, 115, 90, 105, 169]);
  // 補正あり: floor((130+20+32)*1.1) = 200
  assert.equal(statsOf('garchomp', [0, 32, 0, 0, 0, 0], 'Adamant')[1], 200);
});

test('検索: ひらがな・カタカナ・英語のどれでも引ける', () => {
  assert.equal(search('species', 'がぶ')[0].id, 'garchomp');
  assert.equal(search('species', 'ガブ')[0].id, 'garchomp');
  assert.ok(search('species', 'garchomp').some(e => e.id === 'garchomp'));
  assert.equal(search('moves', 'じしん')[0].id, 'earthquake');
  assert.ok(search('species', 'ろとむ').length >= 6);
  assert.equal(normKana('がぶりあす'), normKana('ガブリアス'));
});

test('メガシンカ: 持ち物から正しい姿が決まる', () => {
  assert.equal(megaFormeFor('charizard', 'charizarditex'), 'charizardmegax');
  assert.equal(megaFormeFor('charizard', 'charizarditey'), 'charizardmegay');
  assert.equal(megaFormeFor('charizard', 'leftovers'), null);
  assert.equal(megaFormeFor('garchomp', 'charizarditex'), null);
  assert.equal(baseSpeciesId('charizardmegax'), 'charizard');
  assert.equal(baseSpeciesId('aegislashblade'), 'aegislashshield');
  for (const [id, it] of Object.entries(dex.items)) if (it.ms) for (const [b, m] of Object.entries(it.ms)) { assert.ok(dex.species[b], `${id}:${b}`); assert.ok(dex.species[m], `${id}:${m}`); }
});

test('ダメージ: ライブラリを直接呼んだ結果と、変換を通した結果が一致 (多数の組み合わせ)', () => {
  const ids = Object.keys(dex.species);
  let n = 0;
  let seed = 12345;
  const rnd = k => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  const natures = Object.keys(dex.natures);
  for (let t = 0; t < 1500; t++) {
    const a = ids[rnd(ids.length)], d = ids[rnd(ids.length)];
    const learn = dex.learn[a].filter(m => dex.moves[m].c !== 'Z');
    if (!learn.length) continue;
    const mv = learn[rnd(learn.length)];
    const an = natures[rnd(25)], dn = natures[rnd(25)];
    const asp = [rnd(33), rnd(33), 0, rnd(33), 0, rnd(33)], dsp = [rnd(33), 0, rnd(33), 0, rnd(33), 0];
    const r = calcDamage(mon(a, {build: {nature: an, sp: asp}}), mon(d, {build: {nature: dn, sp: dsp}}), mv, {});
    assert.ok(r.ok, `${a} ${mv} ${d}: ${r.error}`);
    const ev = sp => Object.fromEntries(STAT_KEYS.map((k, i) => [k, sp[i]]));
    const ap = new Pokemon(gen, dex.species[a].n, {nature: an, evs: ev(asp), ability: dex.abilities[dex.species[a].ab[0]].n});
    const dp = new Pokemon(gen, dex.species[d].n, {nature: dn, evs: ev(dsp), ability: dex.abilities[dex.species[d].ab[0]].n});
    const direct = calculate(gen, ap, dp, new Move(gen, dex.moves[mv].n, {ability: ap.ability}), new Field());
    assert.deepEqual([r.min, r.max], direct.range(), `${a} ${mv} ${d}`);
    n++;
  }
  assert.ok(n > 1200);
});

test('ダメージ: ライブラリに頼らない基準式との突き合わせ (補正のない単純な例)', () => {
  // ガブリアス(ようき A32) ドラゴンクロー(威力80, タイプ一致) → ボーマンダ(無振り B100): ×2
  let r = calcDamage(mon('garchomp', {build: {nature: 'Jolly', sp: [0, 32, 0, 0, 0, 32]}}), mon('salamence'), 'dragonclaw');
  assert.deepEqual(r.rolls, referenceDamage({power: 80, atk: 182, def: 100, stab: 1.5, eff: 2}));
  // リザードン(無振り C129) かえんほうしゃ(90, 一致) → ハッサム(無振り D100): ×4
  r = calcDamage(mon('charizard'), mon('scizor', {build: {ability: 'swarm'}}), 'flamethrower');
  assert.equal(statsOf('charizard')[3], 129);
  assert.deepEqual(r.rolls, referenceDamage({power: 90, atk: 129, def: statsOf('scizor')[4], stab: 1.5, eff: 4}));
  // タイプ不一致・等倍: ガブリアス いわなだれ(75) → リザードン は4倍なので、カビゴンに撃つ
  r = calcDamage(mon('garchomp'), mon('snorlax', {build: {ability: 'immunity'}}), 'rockslide');
  assert.deepEqual(r.rolls, referenceDamage({power: 75, atk: 150, def: statsOf('snorlax')[2]}));
  // ダブルの範囲技は 0.75 倍
  r = calcDamage(mon('garchomp'), mon('snorlax', {build: {ability: 'immunity'}}), 'rockslide', {format: 'double'});
  assert.deepEqual(r.rolls, referenceDamage({power: 75, atk: 150, def: statsOf('snorlax')[2], spread: true}));
  // 相手が1体しか残っていなければ範囲補正なし
  r = calcDamage(mon('garchomp'), mon('snorlax', {build: {ability: 'immunity'}}), 'rockslide', {format: 'double', singleTarget: true});
  assert.deepEqual(r.rolls, referenceDamage({power: 75, atk: 150, def: statsOf('snorlax')[2]}));
});

test('ダメージ: 場の状態が効く (天候・壁・フィールド・急所・手助け・やけど・ランク)', () => {
  const a = mon('charizard'), d = mon('snorlax', {build: {ability: 'immunity'}});
  const base = calcDamage(a, d, 'flamethrower').max;
  assert.ok(calcDamage(a, d, 'flamethrower', {field: {weather: 'Sun'}}).max > base * 1.45);
  assert.ok(calcDamage(a, d, 'flamethrower', {field: {weather: 'Rain'}}).max < base * 0.55);
  assert.ok(calcDamage(a, d, 'flamethrower', {defSide: {lightScreen: true}}).max < base * 0.55);
  assert.equal(calcDamage(a, d, 'flamethrower', {defSide: {reflect: true}}).max, base, 'リフレクターは特殊技に無関係');
  const dbl = calcDamage(a, d, 'flamethrower', {format: 'double'}).max;
  const dblScreen = calcDamage(a, d, 'flamethrower', {format: 'double', defSide: {lightScreen: true}}).max;
  assert.ok(dblScreen > dbl * 0.6 && dblScreen < dbl * 0.7, 'ダブルの壁は約2/3');
  assert.ok(calcDamage(a, d, 'flamethrower', {crit: true}).max > base * 1.45);
  assert.ok(calcDamage(a, d, 'flamethrower', {crit: true, defSide: {lightScreen: true}}).max > base * 1.45, '急所は壁を無視');
  assert.ok(calcDamage(a, d, 'flamethrower', {format: 'double', helpingHand: true}).max > dbl * 1.45);
  assert.ok(calcDamage(a, d, 'flamethrower', {format: 'double', friendGuard: true}).max < dbl * 0.8);
  const phys = calcDamage(mon('garchomp'), d, 'earthquake').max;
  assert.ok(calcDamage(mon('garchomp', {cond: {status: 'brn'}}), d, 'earthquake').max < phys * 0.55);
  assert.ok(calcDamage(mon('garchomp', {cond: {boosts: {atk: 2, def: 0, spa: 0, spd: 0, spe: 0}}}), d, 'earthquake').max > phys * 1.9);
  assert.ok(calcDamage(mon('garchomp', {cond: {boosts: {atk: -1, def: 0, spa: 0, spd: 0, spe: 0}}}), d, 'earthquake').max < phys * 0.7);
  // グラスフィールドでじしん半減 / エレキフィールドで電気1.3倍
  assert.ok(calcDamage(mon('garchomp'), d, 'earthquake', {field: {terrain: 'Grassy'}}).max < phys * 0.55);
  const tb = calcDamage(mon('jolteon'), d, 'thunderbolt').max;
  assert.ok(calcDamage(mon('jolteon'), d, 'thunderbolt', {field: {terrain: 'Electric'}}).max > tb * 1.25);
  // すなあらしで岩タイプの特防1.5倍
  const vsRock = calcDamage(a, mon('tyranitar', {build: {ability: 'unnerve'}}), 'airslash').max;
  assert.ok(calcDamage(a, mon('tyranitar', {build: {ability: 'unnerve'}}), 'airslash', {field: {weather: 'Sand'}}).max < vsRock * 0.7);
});

test('ダメージ: 無効・特性・持ち物', () => {
  assert.ok(calcDamage(mon('garchomp'), mon('charizard'), 'earthquake').immune, '飛行に地面は無効');
  assert.ok(!calcDamage(mon('garchomp'), mon('charizard'), 'earthquake', {field: {gravity: true}}).immune, 'じゅうりょく中は当たる');
  assert.ok(calcDamage(mon('garchomp'), mon('rotomwash'), 'earthquake').immune, 'ふゆう');
  assert.ok(!calcDamage(mon('excadrill', {build: {ability: 'moldbreaker'}}), mon('rotomwash'), 'earthquake').immune, 'かたやぶり');
  assert.ok(calcDamage(mon('jolteon'), mon('garchomp'), 'thunderbolt').immune);
  assert.ok(calcDamage(mon('garchomp'), mon('eelektross', {cond: {forme: 'eelektrossmega'}}), 'earthquake').immune, 'うなぎのぼり');
  // こだわり系は無いがいのちのたまはある
  const base = calcDamage(mon('garchomp'), mon('snorlax'), 'earthquake').max;
  const orb = calcDamage(mon('garchomp', {build: {item: 'lifeorb'}}), mon('snorlax'), 'earthquake').max;
  assert.ok(orb > base * 1.28 && orb < base * 1.32);
  const gone = calcDamage(mon('garchomp', {build: {item: 'lifeorb'}, cond: {itemGone: true}}), mon('snorlax'), 'earthquake').max;
  assert.equal(gone, base, '持ち物を失ったら補正なし');
  // 半減実
  const berry = calcDamage(mon('garchomp'), mon('charizard', {build: {item: 'chartiberry'}}), 'rockslide').max;
  const noBerry = calcDamage(mon('garchomp'), mon('charizard'), 'rockslide').max;
  assert.ok(berry < noBerry * 0.55);
});

test('メガシンカ後は種族値・タイプ・特性がメガ側になる', () => {
  const normal = toCalcPokemon({species: 'charizard', item: 'charizarditex', ability: 'blaze', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0]}, newCond());
  const mega = toCalcPokemon({species: 'charizard', item: 'charizarditex', ability: 'blaze', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0]}, {...newCond(), forme: 'charizardmegax'});
  assert.equal(normal.name, 'Charizard');
  assert.equal(mega.name, 'Charizard-Mega-X');
  assert.deepEqual(mega.types, ['Fire', 'Dragon']);
  assert.equal(mega.ability, 'Tough Claws');
  assert.equal(mega.rawStats.atk, 130 + 20);
  // スカイスキン: ボーマンダのすてみタックルがひこうタイプになる
  const r = calcDamage(mon('salamence', {build: {item: 'salamencite'}, cond: {forme: 'salamencemega'}}), mon('garchomp'), 'doubleedge');
  assert.equal(r.moveType, 'Flying');
});

test('確定数: 現在HP・設置技・連続技', () => {
  const a = mon('garchomp', {build: {nature: 'Jolly', sp: [0, 32, 0, 0, 0, 32]}});
  const full = calcDamage(a, mon('salamence'), 'dragonclaw');
  assert.equal(full.koText, '乱数1発 (87.5%)'); // HP170 に対し 168〜198 の16段階中14段階
  assert.equal(calcDamage(a, mon('salamence', {cond: {hp: 90}}), 'dragonclaw').koText, '確定1発');
  // ステルスロック (ボーマンダは1/4) 込みなら交代先として確定
  assert.equal(calcDamage(a, mon('salamence'), 'dragonclaw', {defSide: {sr: true}, hazards: true}).koText, '確定1発');
  // 場に出ている相手には設置技を加味しない
  assert.equal(calcDamage(a, mon('salamence'), 'dragonclaw', {defSide: {sr: true}, hazards: false}).koText, '乱数1発 (87.5%)');
  const weak = calcDamage(mon('garchomp'), mon('snorlax', {build: {sp: [32, 0, 32, 0, 0, 0], nature: 'Impish'}}), 'rocktomb');
  assert.match(weak.koText, /確定\d+発|乱数\d+発|\d+〜\d+発/);
  // 連続技
  assert.equal(defaultHits('scaleshot', 'roughskin'), 3);
  assert.equal(defaultHits('scaleshot', 'skilllink'), 5);
  const h3 = calcDamage(mon('garchomp'), mon('snorlax'), 'scaleshot');
  const h5 = calcDamage(mon('garchomp'), mon('snorlax'), 'scaleshot', {hits: 5});
  assert.equal(h3.hits, 3);
  assert.ok(h5.max > h3.max * 1.5);
  // 変化技はダメージなし
  assert.ok(calcDamage(a, mon('salamence'), 'swordsdance').status);
});

test('素早さ: スカーフ・おいかぜ・まひ・天候特性・ランク', () => {
  const g = {build: {species: 'garchomp', item: '', ability: 'roughskin', nature: 'Jolly', sp: [0, 0, 0, 0, 0, 32], moves: []}, cond: newCond()};
  assert.equal(finalSpeed(g), 169);
  assert.equal(finalSpeed({...g, build: {...g.build, item: 'choicescarf'}}), 253);
  assert.equal(finalSpeed(g, {side: {tailwind: true}}), 338);
  assert.equal(finalSpeed({...g, cond: {...newCond(), status: 'par'}}), 84);
  assert.equal(finalSpeed({...g, cond: {...newCond(), boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 1}}}), 253);
  assert.equal(finalSpeed({...g, cond: {...newCond(), boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: -1}}}), 112);
  const ex = {build: {species: 'excadrill', item: '', ability: 'sandrush', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: []}, cond: newCond()};
  assert.equal(finalSpeed(ex), 108);
  assert.equal(finalSpeed(ex, {field: {weather: 'Sand'}}), 216);
  assert.equal(finalSpeed({...g, build: {...g.build, item: 'choicescarf'}, cond: {...newCond(), itemGone: true}}), 169);
});

test('行動順: 優先度 > 素早さ、トリックルームで反転、いたずらごころ', () => {
  const fast = {build: {species: 'jolteon', item: '', ability: 'voltabsorb', nature: 'Timid', sp: [0, 0, 0, 0, 0, 32], moves: []}, cond: newCond(), side: {}};
  const slow = {build: {species: 'snorlax', item: '', ability: 'immunity', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: []}, cond: newCond(), side: {}};
  assert.equal(turnOrder({...fast, moveId: 'thunderbolt'}, {...slow, moveId: 'bodyslam'}), 'a');
  assert.equal(turnOrder({...fast, moveId: 'thunderbolt'}, {...slow, moveId: 'bodyslam'}, {field: {trickRoom: true}}), 'b');
  assert.equal(turnOrder({...fast, moveId: 'thunderbolt'}, {...slow, moveId: 'protect'}), 'b');
  assert.equal(turnOrder({...fast, moveId: 'thunderbolt'}, {...slow, moveId: null}), 'b', '交代が先');
  assert.equal(turnOrder({...fast, moveId: 'thunderbolt'}, {...fast, moveId: 'thunderbolt'}), 'tie');
  assert.equal(movePriority('thunderwave', 'prankster'), 1);
  assert.equal(movePriority('thunderbolt', 'prankster'), 0);
  assert.equal(movePriority('fakeout', ''), 3);
  assert.equal(movePriority('bravebird', 'galewings', {hpFull: true}), 1);
  assert.equal(movePriority('bravebird', 'galewings', {hpFull: false}), 0);
});

test('タイプ相性表', () => {
  assert.equal(typeEffect('Ground', ['Fire', 'Flying']), 0);
  assert.equal(typeEffect('Rock', ['Fire', 'Flying']), 4);
  assert.equal(typeEffect('Fairy', ['Dragon', 'Ground']), 2);
  assert.equal(typeEffect('Steel', ['Steel', 'Ghost']), 0.5);
  // ライブラリの相性表と全組み合わせ一致
  for (const t of gen.types) {
    if (t.name === '???' || t.name === 'Stellar') continue;
    for (const u of gen.types) {
      if (u.name === '???' || u.name === 'Stellar') continue;
      assert.equal(typeEffect(t.name, [u.name]), t.effectiveness[u.name], `${t.name}→${u.name}`);
    }
  }
});

test('使用率スナップショットが読める', () => {
  for (const k of ['single', 'double']) {
    const u = JSON.parse(fs.readFileSync(new URL(`../docs/usage-${k}.json`, import.meta.url)));
    assert.ok(Object.keys(u.pokemon).length > 100);
    for (const [id, p] of Object.entries(u.pokemon)) {
      assert.ok(dex.species[id], id);
      for (const [m] of p.mv) assert.ok(dex.moves[m], `${id} ${m}`);
      for (const [m] of p.it) assert.ok(m === '' || dex.items[m], `${id} ${m}`);
    }
  }
});
