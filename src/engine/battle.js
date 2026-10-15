// 対戦データの生成と、盤面 (仮想のゲーム状況) の状態遷移。
// UI から独立した純粋なロジックで、tests/ から直接検証する。
import {TYPE_JA} from './dex.js';
import {dex, megaFormeFor, speciesName, moveName, abilityName, statsOf} from './dex.js';
import {newCond, emptyBoosts, currentSpecies, typesOf, BOOST_KEYS} from './calc.js';
import moveEffects from '../generated/move-effects.json' with {type: 'json'};

export const UNDO_DEPTH = 6;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const activeCount = format => (format === 'double' ? 2 : 1);
export const pickCount = format => (format === 'double' ? 4 : 3);
export const other = side => (side === 'me' ? 'opp' : 'me');

export const newBuild = (species = '') => ({species, item: '', ability: dex.species[species]?.ab[0] || '', nature: 'Serious', sp: [0, 0, 0, 0, 0, 0], moves: [], note: ''});
export const newOpp = (species = '') => ({species, item: '', ability: '', moves: [], assume: {kind: 'usage', idx: 0}, note: '', speOk: null, megaSeen: false});
export const newSide = format => ({active: Array(activeCount(format)).fill(null), reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, sr: false, spikes: 0, megaUsed: false, since: {}});
export const newField = () => ({weather: '', terrain: '', trickRoom: false, gravity: false, since: {}});

export function newTeam(format = 'single') {
  const now = Date.now();
  return {id: uid(), name: '新しい構築', format, mons: [], memo: '', createdAt: now, updatedAt: now};
}

export function newBattle({team, format, kind = 'battle'} = {}) {
  const now = Date.now();
  const fmt = format || team?.format || 'single';
  return {
    id: uid(), kind, format: fmt, teamId: team?.id || null, teamName: team?.name || '',
    my: clone(team?.mons || []), opp: [],
    oppName: '', date: new Date(now).toISOString().slice(0, 10),
    pick: {me: [], opp: []},
    turns: [], result: '', memo: '', tags: [],
    state: {
      field: newField(),
      sides: {me: newSide(fmt), opp: newSide(fmt)},
      mons: {me: (team?.mons || []).map(() => newCond()), opp: []},
    },
    createdAt: now, updatedAt: now,
  };
}

// 状態配列の長さを構築/相手パーティの長さに合わせる (編集で増減したとき用)
export function normalizeBattle(b) {
  const st = b.state;
  for (const side of ['me', 'opp']) {
    const list = side === 'me' ? b.my : b.opp;
    const conds = st.mons[side];
    while (conds.length < list.length) conds.push(newCond());
    conds.length = list.length;
    const s = st.sides[side];
    const n = activeCount(b.format);
    while (s.active.length < n) s.active.push(null);
    s.active.length = n;
    s.active = s.active.map(i => (i != null && i < list.length ? i : null));
    b.pick[side] = (b.pick[side] || []).filter(i => i < list.length);
    s.since ||= {};
  }
  st.field.since ||= {};
  return b;
}

// いまのターン番号 (入力途中のターンがあればその番号)
export const turnNumber = b => (b.turns.length && b.turns[b.turns.length - 1].open ? b.turns.length : b.turns.length + 1);
export const buildOf = (b, side, i) => (side === 'me' ? b.my[i] : b.opp[i]);
export const condOf = (b, side, i) => b.state.mons[side][i];
export const faintedCount = (b, side) => b.state.mons[side].filter(c => c.fainted).length;
// これまでに倒れた回数の合計 (さいきのいのりで復活してまた倒れた分も数える)。おはかまいり・そうだいしょう用
export const totalFainted = (b, side) => b.state.sides[side].faintTotal ?? faintedCount(b, side);

// 相手の最大HPはHPポイント16の見込み。自分のHPは実数で丸めてから反映する。
export function maxHPOf(b, side, i) {
  const bd = buildOf(b, side, i), c = condOf(b, side, i);
  return statsOf(currentSpecies(bd, c), side === 'me' ? bd.sp : [16, 0, 0, 0, 0, 0], side === 'me' ? bd.nature : 'Serious')[0];
}
export function activeItem(b, side, i) {
  const c = condOf(b, side, i);
  return !c || c.itemGone || b.state.field.magicRoom || defaultAbilityResolver(b, side, i) === 'klutz' ? '' : buildOf(b, side, i)?.item || '';
}
export function healHP(b, side, i, amount, {log = [], label = '回復'} = {}) {
  const c = condOf(b, side, i);
  if (!c || c.fainted || (c.healBlock || 0) >= turnNumber(b)) return false;
  const mx = maxHPOf(b, side, i), before = c.hp;
  const after = side === 'me' ? (Math.round(c.hp * mx / 100) + Math.max(1, Math.floor(amount))) / mx * 100 : c.hp + amount / mx * 100;
  setHP(b, side, i, Math.min(100, after));
  // 相手は最大HPと表示丸めが未確定。自動更新した割合を次の「実測」として使わない。
  if (side === 'opp' && c.hp !== before) c.hpUnknown = true;
  if (c.hp !== before) log.push(`${label}: ${speciesName(buildOf(b, side, i).species)} HP ${Math.round(before)}% → ${Math.round(c.hp)}%`);
  return c.hp !== before;
}
export function unknownHP(b, side, i, log = []) {
  const c = condOf(b, side, i);
  if (!c || c.fainted) return;
  c.hpUnknown = true;
  log.push(`${speciesName(buildOf(b, side, i).species)}の行動後HPは未確認`);
}

// 特性が確定していないポケモンの「たぶんこの特性」を返す resolver を差し込める
// resolver(side, index) -> abilityId ('' なら不明)
const NO_TRACE = new Set(['trace', 'imposter', 'illusion', 'disguise', 'stancechange', 'zerotohero', 'commander', 'protosynthesis', 'quarkdrive', 'multitype', 'rkssystem', 'schooling', 'shieldsdown', 'battlebond', 'powerconstruct', 'iceface', 'hungerswitch', 'gulpmissile', 'receiver', 'powerofalchemy', 'flowergift', 'forecast', 'neutralizinggas', 'wonderguard', 'comatose', 'zenmode']);
const defaultAbilityResolver = (b, side, i) => {
  const build = buildOf(b, side, i);
  if (!build) return '';
  const cond = condOf(b, side, i);
  // へんしん中は相手の特性になる
  if (cond?.transformed) { const t = cond.transformed; const tc = condOf(b, t.side, t.mon); if (tc && !tc.transformed) return defaultAbilityResolver(b, t.side, t.mon); }
  // トレース・ミイラ・なやみのタネ・スキルスワップ等で変わった特性 ('' = 消された)
  if (cond?.abilityChanged != null) return cond.abilityChanged;
  const sid = currentSpecies(build, cond);
  const s = dex.species[sid];
  if (!s) return '';
  if (s.mega) return s.ab[0] || '';
  if (build.ability) return build.ability;
  if (side === 'opp' && s.ab.length === 1) return s.ab[0];
  return side === 'me' ? s.ab[0] || '' : '';
};

export const WEATHER_ABILITY = {drizzle: 'Rain', drought: 'Sun', sandstream: 'Sand', snowwarning: 'Snow'};
export const TERRAIN_ABILITY = {electricsurge: 'Electric', grassysurge: 'Grassy', psychicsurge: 'Psychic', mistysurge: 'Misty'};
const WEATHER_JA = {Sun: 'はれ', Rain: 'あめ', Sand: 'すなあらし', Snow: 'ゆき'};
const TERRAIN_JA = {Electric: 'エレキフィールド', Grassy: 'グラスフィールド', Misty: 'ミストフィールド', Psychic: 'サイコフィールド'};
const STAT_JA = {atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ'};

const NO_DROP = new Set(['clearbody', 'whitesmoke']); // 相手からの能力ダウンを受けない
const NO_INTIMIDATE = new Set(['clearbody', 'whitesmoke', 'hypercutter', 'innerfocus', 'owntempo', 'oblivious', 'scrappy']);

// by: 誰が起こしたか {side, mon} (延長する持ち物の判定に使う)
export function setWeather(b, w, by) {
  const f = b.state.field;
  if (f.weather === w) return false;
  f.weather = w;
  f.since.weather = w ? turnNumber(b) : undefined;
  (f.by ||= {}).weather = w && by ? by : undefined;
  return true;
}
export function setTerrain(b, t, by) {
  const f = b.state.field;
  if (f.terrain === t) return false;
  f.terrain = t;
  f.since.terrain = t ? turnNumber(b) : undefined;
  (f.by ||= {}).terrain = t && by ? by : undefined;
  activateTerrainSeeds(b);
  return true;
}
function activateTerrainSeeds(b, log = []) {
  const seed = {Electric: ['electricseed', 'def'], Grassy: ['grassyseed', 'def'], Misty: ['mistyseed', 'spd'], Psychic: ['psychicseed', 'spd']}[b.state.field.terrain];
  if (!seed) return;
  for (const side of ['me', 'opp']) for (const i of b.state.sides[side].active) {
    if (i == null || condOf(b, side, i)?.fainted || activeItem(b, side, i) !== seed[0]) continue;
    condOf(b, side, i).itemGone = true;
    applyBoosts(b, side, i, {[seed[1]]: 1}, {log});
  }
}
export function setSideFlag(b, side, key, val, by) {
  const s = b.state.sides[side];
  if (s[key] === val) return false;
  s[key] = val;
  s.since[key] = val ? turnNumber(b) : undefined;
  (s.by ||= {})[key] = val && by ? by : undefined;
  return true;
}
export function setFieldFlag(b, key, val) {
  const f = b.state.field;
  if (!!f[key] === !!val) return false;
  f[key] = !!val;
  f.since[key] = val ? turnNumber(b) : undefined;
  return true;
}

/**
 * ランク変化を適用する。fromOpp=true のとき相手由来 (クリアボディ・まけんき等が関係する)。
 * 変化内容を日本語で log に積む。
 */
export function applyBoosts(b, side, i, changes, {fromOpp = false, log = [], resolveAbility, opportunist = false} = {}) {
  const cond = condOf(b, side, i);
  const build = buildOf(b, side, i);
  if (!cond || !build || cond.fainted) return;
  const ab = (resolveAbility || defaultAbilityResolver)(b, side, i);
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(build, cond))}`;
  let dropped = false;
  const ups = {};
  for (const [k, raw] of Object.entries(changes)) {
    if (!BOOST_KEYS.includes(k) || !raw) continue;
    let d = raw;
    if (ab === 'contrary') d = -d;
    if (d < 0 && fromOpp && NO_DROP.has(ab)) { log.push(`${who}は${abilityName(ab)}で能力が下がらない`); continue; }
    if (d < 0 && fromOpp && k === 'atk' && ab === 'hypercutter') { log.push(`${who}は${abilityName(ab)}でこうげきが下がらない`); continue; }
    if (d < 0 && fromOpp && k === 'def' && ab === 'bigpecks') { log.push(`${who}は${abilityName(ab)}でぼうぎょが下がらない`); continue; }
    const before = cond.boosts[k] || 0;
    const after = Math.max(-6, Math.min(6, before + d));
    if (after === before) continue;
    cond.boosts[k] = after;
    if (after > before) ups[k] = after - before;
    if (after < before && fromOpp) dropped = true;
    log.push(`${who}の${STAT_JA[k]} ${after - before > 0 ? '+' : ''}${after - before} (→${after > 0 ? '+' : ''}${after})`);
  }
  if (dropped && ab === 'defiant') applyBoosts(b, side, i, {atk: 2}, {log, resolveAbility: () => ''});
  // びんじょう: 相手の能力が上がると、自分も同じだけ上がる
  if (Object.keys(ups).length && !opportunist) {
    const os = other(side);
    for (const t of b.state.sides[os].active) if (t != null && !condOf(b, os, t)?.fainted && defaultAbilityResolver(b, os, t) === 'opportunist') applyBoosts(b, os, t, ups, {log, resolveAbility: () => '', opportunist: true});
  }
  if (dropped && ab === 'competitive') applyBoosts(b, side, i, {spa: 2}, {log, resolveAbility: () => ''});
  if (activeItem(b, side, i) === 'whiteherb' && Object.values(cond.boosts).some(v => v < 0)) {
    for (const k of BOOST_KEYS) if (cond.boosts[k] < 0) cond.boosts[k] = 0;
    cond.itemGone = true;
    log.push(`${who}のしろいハーブ: 下がった能力が元に戻った`);
  }
}

// 場に出たとき・メガシンカしたときに発動する特性
export function applyEntryAbility(b, side, i, {log = [], resolveAbility} = {}) {
  const res = resolveAbility || defaultAbilityResolver;
  const ab = res(b, side, i);
  if (!ab) return;
  const build = buildOf(b, side, i), cond = condOf(b, side, i);
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(build, cond))}`;
  if (WEATHER_ABILITY[ab] && setWeather(b, WEATHER_ABILITY[ab], {side, mon: i})) log.push(`${who}の${abilityName(ab)}: 天候が${WEATHER_JA[WEATHER_ABILITY[ab]]}に`);
  if (TERRAIN_ABILITY[ab] && setTerrain(b, TERRAIN_ABILITY[ab], {side, mon: i})) log.push(`${who}の${abilityName(ab)}: ${TERRAIN_JA[TERRAIN_ABILITY[ab]]}に`);
  if (ab === 'hospitality' || ab === 'curiousmedicine') for (const ally of b.state.sides[side].active) {
    if (ally == null || ally === i || condOf(b, side, ally)?.fainted) continue;
    if (ab === 'hospitality') healHP(b, side, ally, maxHPOf(b, side, ally) / 4, {log, label: 'おもてなし'});
    else { condOf(b, side, ally).boosts = emptyBoosts(); log.push(`${who}のきみょうなくすり: 味方のランク変化が元に戻った`); }
  }
  // かわりもの (メタモン): 場に出たとき、向かい合う相手にへんしんする
  if (ab === 'imposter') {
    const os = other(side);
    const t = b.state.sides[os].active.find(x => x != null && !condOf(b, os, x)?.fainted);
    if (t != null) transformInto(b, side, i, {side: os, mon: t}, log);
  }
  // トレース: 相手の特性をコピー (相手の特性が分かっているとき)
  if (ab === 'trace') {
    const os = other(side);
    const t = b.state.sides[os].active.find(x => x != null && !condOf(b, os, x)?.fainted);
    const tab = t != null ? res(b, os, t) : '';
    if (tab && !NO_TRACE.has(tab)) { cond.abilityChanged = tab; log.push(`${who}のトレース: ${abilityName(tab)}になった`); applyEntryAbility(b, side, i, {log, resolveAbility: () => tab}); }
  }
  // バリアフリー: お互いの壁を消す
  if (ab === 'screencleaner') for (const sd of ['me', 'opp']) for (const k of ['reflect', 'lightScreen', 'auroraVeil']) if (b.state.sides[sd][k]) { setSideFlag(b, sd, k, false); log.push(`${who}のバリアフリー: ${sd === 'me' ? '自分' : '相手'}の壁が消えた`); }
  if (ab === 'intimidate') {
    for (const t of b.state.sides[other(side)].active) {
      if (t == null || condOf(b, other(side), t)?.fainted) continue;
      const tab = res(b, other(side), t);
      const tname = `${other(side) === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(buildOf(b, other(side), t), condOf(b, other(side), t)))}`;
      if (NO_INTIMIDATE.has(tab)) { log.push(`${who}のいかく: ${tname}は${abilityName(tab)}で無効`); continue; }
      if (tab === 'guarddog') { applyBoosts(b, other(side), t, {atk: 1}, {log, resolveAbility: () => ''}); continue; }
      if (tab === 'mirrorarmor') { applyBoosts(b, side, i, {atk: -1}, {log, fromOpp: true, resolveAbility: res}); continue; }
      applyBoosts(b, other(side), t, {atk: -1}, {log, fromOpp: true, resolveAbility: res});
      if (tab === 'rattled') applyBoosts(b, other(side), t, {spe: 1}, {log, resolveAbility: () => ''});
    }
  }
}

/**
 * へんしん: HP 以外の能力・タイプ・特性・技・ランク変化を相手と同じにする (下がるまで続く)。
 * 計算では「相手の姿 + 自分の HP」として扱う (board.js の build)。
 */
export function transformInto(b, side, i, into, log = []) {
  const cond = condOf(b, side, i), tc = condOf(b, into.side, into.mon);
  if (!cond || !tc) return log;
  cond.transformed = {side: into.side, mon: into.mon};
  cond.boosts = {...emptyBoosts(), ...tc.boosts};
  const tb = buildOf(b, into.side, into.mon);
  log.push(`${side === 'me' ? '自分' : '相手'}の${speciesName(buildOf(b, side, i).species)}は${into.side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(tb, tc))}にへんしんした`);
  return log;
}

// 場から下がるときの処理 (ランクリセット、戦闘中フォルム解除、さいせいりょく、しぜんかいふく)
function leaveField(b, side, i, {log = [], resolveAbility} = {}) {
  const cond = condOf(b, side, i), build = buildOf(b, side, i);
  if (!cond || !build) return;
  const ab = (resolveAbility || defaultAbilityResolver)(b, side, i);
  cond.boosts = emptyBoosts();
  cond.abilityOn = false;
  cond.transformed = null;
  cond.healBlock = 0;
  cond.seeded = false;
  cond.salted = false;
  cond.timesAttacked = 0; // ふんどのこぶし: チャンピオンズでは交代でリセット
  // しめつける等・たこがためは、かけた側が下がっても解ける
  for (const t of b.state.sides[other(side)].active) { const tc = t != null ? condOf(b, other(side), t) : null; if (tc?.bound?.by?.mon === i && tc.bound.by.side === side) tc.bound = null; if (tc?.octolock?.mon === i && tc.octolock.side === side) tc.octolock = null; }
  cond.bound = null; cond.syrup = 0; cond.octolock = null; cond.aquaRing = false; cond.ingrain = false; cond.destinyBond = false; cond.perish = null;
  cond.abilityChanged = null; // 変わった特性は交代で戻る
  delete cond.cudChew;
  cond.stockpile = 0; cond.stockpileDrops = null;
  cond.lastResult = null;
  cond.types = null; // みずびたし・へんげんじざい等のタイプ変化は交代で戻る
  cond.proteanUsed = false;
  cond.drowsy = 0; // あくびの眠気は交代で消える
  if (cond.status === 'tox') cond.toxicCounter = 1;
  if (cond.forme && !dex.species[cond.forme]?.mega && cond.forme !== 'palafinhero') cond.forme = null; // メガシンカは交代しても戻らない
  if (cond.fainted) return;
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(build.species)}`;
  if (ab === 'regenerator' && cond.hp < 100) {
    if (side === 'me') {
      const mx = maxHPOf(b, side, i);
      cond.hp = Math.min(100, (Math.round(cond.hp * mx / 100) + Math.floor(mx / 3)) / mx * 100);
    } else { cond.hp = Math.min(100, Math.round((cond.hp + 100 / 3) * 10) / 10); cond.hpUnknown = true; }
    log.push(`${who}のさいせいりょく: HP ${Math.round(cond.hp)}% に回復`);
  }
  // マイティチェンジ (イルカマン): 一度下がるとマイティフォルムになる (以後ずっと)
  if (ab === 'zerotohero' && build.species === 'palafin' && dex.species.palafinhero) { cond.hero = true; log.push(`${who}はマイティフォルムになる`); }
  if (ab === 'naturalcure' && cond.status) {
    cond.status = '';
    log.push(`${who}のしぜんかいふく: 状態異常が回復`);
  }
}

// slot に monIdx を出す (交代・死に出し・初手)。
export function sendOut(b, side, slot, monIdx, opts = {}) {
  const s = b.state.sides[side];
  const log = opts.log || [];
  const prev = s.active[slot];
  if (prev === monIdx) return log;
  const dup = s.active.indexOf(monIdx);
  if (dup >= 0) s.active[dup] = null;
  if (prev != null) leaveField(b, side, prev, {log, resolveAbility: opts.resolveAbility});
  s.active[slot] = monIdx;
  if (monIdx == null) return log;
  { const c = condOf(b, side, monIdx); if (c?.hero) c.forme = 'palafinhero'; if (c) c.entryFainted = totalFainted(b, side); } // そうだいしょう: 場に出た時点の倒れた味方の数
  // 設置技がある場に出た → ダメージを確認する (ターン入力で聞く)
  { const c = condOf(b, side, monIdx); if (c) c.hazard = !!(s.sr || s.spikes) && !c.fainted; }
  entryHazards(b, side, monIdx, log, opts.resolveAbility);
  if (!b.pick[side].includes(monIdx)) b.pick[side].push(monIdx);
  if (!opts.silent) applyEntryAbility(b, side, monIdx, {log, resolveAbility: opts.resolveAbility});
  activateTerrainSeeds(b, log);
  return log;
}

export const BIND_MOVES = new Set(['bind', 'firespin', 'sandtomb', 'whirlpool', 'infestation', 'snaptrap']);
// 場に出たとき: いやしのねがい (全回復)、ねばねばネット (素早さ-1)、どくびし (どく/もうどく、どくタイプなら回収)
function entryHazards(b, side, i, log, resolveAbility) {
  const s = b.state.sides[side], c = condOf(b, side, i), bd = buildOf(b, side, i);
  if (!c || c.fainted) return;
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(bd, c))}`;
  if (s.healingWish) { s.healingWish = false; c.hp = 100; c.status = ''; log.push(`いやしのねがい: ${who}は全回復した`); }
  const res = resolveAbility || defaultAbilityResolver;
  const ab = res(b, side, i), item = c.itemGone ? '' : bd.item;
  if (item === 'heavydutyboots') return;
  const types = typesOf(bd, c);
  const grounded = b.state.field.gravity || (!types.includes('Flying') && ab !== 'levitate' && ab !== 'eelevate' && item !== 'airballoon');
  if (!grounded) return;
  if (s.stickyWeb) applyBoosts(b, side, i, {spe: -1}, {log, fromOpp: true, resolveAbility: res});
  if (s.tspikes) {
    if (types.includes('Poison')) { s.tspikes = 0; log.push(`${who}がどくびしを回収した`); }
    else if (!types.includes('Steel') && !c.status && !['immunity', 'pastelveil', 'purifyingsalt', 'comatose'].includes(ab)) { c.status = s.tspikes >= 2 ? 'tox' : 'psn'; c.toxicCounter = 1; log.push(`${who}はどくびしで${s.tspikes >= 2 ? 'もうどく' : 'どく'}になった`); }
  }
}

// メガシンカ先 (できないなら null)。相手で持ち物不明なら種族のメガ先候補の先頭。
export function megaTarget(b, side, i) {
  const build = buildOf(b, side, i);
  if (!build) return null;
  const s = dex.species[build.species];
  if (!s?.megas?.length) return null;
  const byItem = megaFormeFor(build.species, build.item);
  if (byItem) return byItem;
  if (side === 'opp' && !build.item) return s.megas[0];
  return null;
}

export function megaEvolve(b, side, i, forme, opts = {}) {
  const log = opts.log || [];
  const cond = condOf(b, side, i), build = buildOf(b, side, i);
  const target = forme || megaTarget(b, side, i);
  if (!cond || !target || cond.forme === target) return log;
  cond.forme = target;
  b.state.sides[side].megaUsed = true;
  if (side === 'opp') {
    build.megaSeen = true;
    const stone = dex.species[target]?.stone;
    if (stone && !build.item) build.item = stone;
  }
  log.push(`${side === 'me' ? '自分' : '相手'}の${speciesName(build.species)}がメガシンカ`);
  applyEntryAbility(b, side, i, {log, resolveAbility: opts.resolveAbility});
  return log;
}

// ---- 技による場・ランクの変化 ----
// self: 使用者のランク変化, target: 当てた相手のランク変化, sec: 追加効果 (ちからずくで消える / りんぷん等で防がれる)
const B = (self, target, extra = {}) => ({self, target, ...extra});
export const MOVE_BOOSTS = {
  swordsdance: B({atk: 2}), nastyplot: B({spa: 2}), dragondance: B({atk: 1, spe: 1}), calmmind: B({spa: 1, spd: 1}),
  bulkup: B({atk: 1, def: 1}), quiverdance: B({spa: 1, spd: 1, spe: 1}), shellsmash: B({atk: 2, spa: 2, spe: 2, def: -1, spd: -1}),
  irondefense: B({def: 2}), acidarmor: B({def: 2}), barrier: B({def: 2}), cottonguard: B({def: 3}), amnesia: B({spd: 2}),
  agility: B({spe: 2}), rockpolish: B({spe: 2}), autotomize: B({spe: 2}), coil: B({atk: 1, def: 1}), honeclaws: B({atk: 1}),
  workup: B({atk: 1, spa: 1}), growth: B({atk: 1, spa: 1}), cosmicpower: B({def: 1, spd: 1}), defendorder: B({def: 1, spd: 1}),
  tailglow: B({spa: 3}), shiftgear: B({spe: 2, atk: 1}), victorydance: B({atk: 1, def: 1, spe: 1}), noretreat: B({atk: 1, def: 1, spa: 1, spd: 1, spe: 1}),
  howl: B({atk: 1}), meditate: B({atk: 1}), sharpen: B({atk: 1}), harden: B({def: 1}), withdraw: B({def: 1}), defensecurl: B({def: 1}),
  stockpile: B({def: 1, spd: 1}), tidyup: B({atk: 1, spe: 1}), bellydrum: B({atk: 12}), filletaway: B({atk: 2, spa: 2, spe: 2}),
  clangoroussoul: B({atk: 1, def: 1, spa: 1, spd: 1, spe: 1}), geomancy: B({spa: 2, spd: 2, spe: 2}), shelter: B({def: 2}), strengthsap: B(null, {atk: -1}), electroshot: B({spa: 1}), meteorbeam: B({spa: 1}), charge: B({spd: 1}), toxicthread: B(null, {spe: -2}),
  // 使用者が下がる攻撃技 (追加効果ではないので ちからずく の影響を受けない)
  closecombat: B({def: -1, spd: -1}), superpower: B({atk: -1, def: -1}), dracometeor: B({spa: -2}), overheat: B({spa: -2}),
  leafstorm: B({spa: -2}), psychoboost: B({spa: -2}), fleurcannon: B({spa: -2}), makeitrain: B({spa: -2}), hammerarm: B({spe: -1}),
  icehammer: B({spe: -1}), vcreate: B({def: -1, spd: -1, spe: -1}), armorcannon: B({def: -1, spd: -1}), headlongrush: B({def: -1, spd: -1}),
  scaleshot: B({def: -1, spe: 1}), spinout: B({spe: -2}), clangingscales: B({def: -1}), dragonascent: B({def: -1, spd: -1}),
  // 100% の追加効果で使用者が上がる技
  poweruppunch: B({atk: 1}, null, {sec: 1}), flamecharge: B({spe: 1}, null, {sec: 1}), trailblaze: B({spe: 1}, null, {sec: 1}),
  aquastep: B({spe: 1}, null, {sec: 1}), torchsong: B({spa: 1}, null, {sec: 1}), rapidspin: B({spe: 1}, null, {sec: 1}),
  aurawheel: B({spe: 1}, null, {sec: 1}), psyshieldbash: B({def: 1}, null, {sec: 1}), mysticalpower: B({spa: 1}, null, {sec: 1}), esperwing: B({spe: 1}, null, {sec: 1}),
  // 相手を下げる技
  icywind: B(null, {spe: -1}, {sec: 1}), electroweb: B(null, {spe: -1}, {sec: 1}), bulldoze: B(null, {spe: -1}, {sec: 1}),
  rocktomb: B(null, {spe: -1}, {sec: 1}), lowsweep: B(null, {spe: -1}, {sec: 1}), mudshot: B(null, {spe: -1}, {sec: 1}),
  drumbeating: B(null, {spe: -1}, {sec: 1}), pounce: B(null, {spe: -1}, {sec: 1}), glaciate: B(null, {spe: -1}, {sec: 1}),
  snarl: B(null, {spa: -1}, {sec: 1}), strugglebug: B(null, {spa: -1}, {sec: 1}), mysticalfire: B(null, {spa: -1}, {sec: 1}),
  spiritbreak: B(null, {spa: -1}, {sec: 1}), skittersmack: B(null, {spa: -1}, {sec: 1}), lunge: B(null, {atk: -1}, {sec: 1}),
  breakingswipe: B(null, {atk: -1}, {sec: 1}), tropkick: B(null, {atk: -1}, {sec: 1}), chillingwater: B(null, {atk: -1}, {sec: 1}),
  bittermalice: B(null, {atk: -1}, {sec: 1}), firelash: B(null, {def: -1}, {sec: 1}), thunderouskick: B(null, {def: -1}, {sec: 1}),
  gravapple: B(null, {def: -1}, {sec: 1}), acidspray: B(null, {spd: -2}, {sec: 1}), luminacrash: B(null, {spd: -2}, {sec: 1}),
  appleacid: B(null, {spd: -1}, {sec: 1}),
  partingshot: B(null, {atk: -1, spa: -1}), faketears: B(null, {spd: -2}), metalsound: B(null, {spd: -2}), screech: B(null, {def: -2}),
  charm: B(null, {atk: -2}), featherdance: B(null, {atk: -2}), eerieimpulse: B(null, {spa: -2}), scaryface: B(null, {spe: -2}),
  stringshot: B(null, {spe: -2}), cottonspore: B(null, {spe: -2}), tickle: B(null, {atk: -1, def: -1}), nobleroar: B(null, {atk: -1, spa: -1}),
  tearfullook: B(null, {atk: -1, spa: -1}), growl: B(null, {atk: -1}), leer: B(null, {def: -1}), tailwhip: B(null, {def: -1}),
  babydolleyes: B(null, {atk: -1}), playnice: B(null, {atk: -1}), confide: B(null, {spa: -1}), memento: B(null, {atk: -2, spa: -2}),
  spicyextract: B(null, {atk: 2, def: -2}), swagger: B(null, {atk: 2}), flatter: B(null, {spa: 1}),
};

// 交代を伴う技 (交代先を一緒に記録できる)
export const PIVOT_MOVES = new Set(['uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'batonpass', 'chillyreception', 'shedtail']);
// その時点以降の行動順に影響する技 (素早さ推定の対象から外す判定に使う)
export const SPEED_CHANGING = new Set(['tailwind', 'trickroom', 'icywind', 'electroweb', 'bulldoze', 'rocktomb', 'lowsweep', 'mudshot', 'drumbeating', 'pounce',
  'scaryface', 'stringshot', 'cottonspore', 'thunderwave', 'glare', 'nuzzle', 'stunspore', 'raindance', 'sunnyday', 'sandstorm', 'snowscape', 'chillyreception',
  'electricterrain', 'stickyweb', 'afteryou', 'quash', 'speedswap', 'skillswap', 'trick', 'switcheroo', 'knockoff', 'bodyslam', 'thunder', 'thunderbolt', 'discharge',
  'forcepalm', 'lick', 'dragonbreath', 'bounce', 'zapcannon', 'glaciate']);

/**
 * 技による場・ランクの自動反映。act: {side, mon, move, target, flags}
 * 技が外れた/行動できなかった/まもられた場合は呼ばない。
 */
export function applyMoveEffects(b, act, opts = {}) {
  const log = opts.log || [];
  const res = opts.resolveAbility || defaultAbilityResolver;
  const {side, mon, move} = act;
  const mv = dex.moves[move];
  if (!mv) return log;
  const foe = other(side);
  if (move === 'stockpile' && (condOf(b, side, mon).stockpile || 0) >= 3) { log.push('たくわえる: すでに3回たくわえているため失敗'); return log; }
  const userAb = res(b, side, mon);
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(buildOf(b, side, mon), condOf(b, side, mon)))}`;
  const st = b.state;

  // タイプを変える技
  const tgtRef = act.target;
  const tcond = tgtRef ? condOf(b, tgtRef.side, tgtRef.mon) : null;
  const tname = tgtRef ? `${tgtRef.side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(buildOf(b, tgtRef.side, tgtRef.mon), tcond))}` : '';
  const setTypes = (c, types, name) => { c.types = types; log.push(`${name}は${types.map(t => TYPE_JA[t] || t).join('・')}タイプになった`); };
  if (tcond && !tcond.fainted) {
    const tt = typesOf(buildOf(b, tgtRef.side, tgtRef.mon), tcond);
    if (move === 'soak') setTypes(tcond, ['Water'], tname);
    if (move === 'magicpowder') setTypes(tcond, ['Psychic'], tname);
    if (move === 'trickortreat' && !tt.includes('Ghost')) setTypes(tcond, [...tt, 'Ghost'], tname);
    if (move === 'forestscurse' && !tt.includes('Grass')) setTypes(tcond, [...tt, 'Grass'], tname);
    if (move === 'reflecttype') setTypes(condOf(b, side, mon), [...tt], who);
  }
  {
    const uc = condOf(b, side, mon), ut = typesOf(buildOf(b, side, mon), uc);
    if (move === 'burnup' && ut.includes('Fire')) setTypes(uc, ut.filter(t => t !== 'Fire').length ? ut.filter(t => t !== 'Fire') : ['???'], who);
    if (move === 'doubleshock' && ut.includes('Electric')) setTypes(uc, ut.filter(t => t !== 'Electric').length ? ut.filter(t => t !== 'Electric') : ['???'], who);
  }

  const weatherMove = {raindance: 'Rain', sunnyday: 'Sun', sandstorm: 'Sand', snowscape: 'Snow', chillyreception: 'Snow'}[move];
  if (weatherMove && setWeather(b, weatherMove, {side, mon})) log.push(`${moveName(move)}: 天候が${WEATHER_JA[weatherMove]}に`);
  const terrainMove = {electricterrain: 'Electric', grassyterrain: 'Grassy', mistyterrain: 'Misty', psychicterrain: 'Psychic'}[move];
  if (terrainMove && setTerrain(b, terrainMove, {side, mon})) log.push(`${moveName(move)}: ${TERRAIN_JA[terrainMove]}に`);
  if (move === 'reflect' && setSideFlag(b, side, 'reflect', true, {side, mon})) log.push(`${who}のリフレクター`);
  if (move === 'lightscreen' && setSideFlag(b, side, 'lightScreen', true, {side, mon})) log.push(`${who}のひかりのかべ`);
  if (move === 'auroraveil' && st.field.weather === 'Snow' && setSideFlag(b, side, 'auroraVeil', true, {side, mon})) log.push(`${who}のオーロラベール`);
  if (move === 'tailwind' && setSideFlag(b, side, 'tailwind', true)) log.push(`${who}のおいかぜ`);
  if (move === 'trickroom') { setFieldFlag(b, 'trickRoom', !st.field.trickRoom); log.push(`トリックルーム${st.field.trickRoom ? '発動' : '解除'}`); }
  if (move === 'gravity' && setFieldFlag(b, 'gravity', true)) log.push('じゅうりょく発動');
  if ((move === 'stealthrock' || move === 'stoneaxe') && setSideFlag(b, foe, 'sr', true)) log.push(`${foe === 'me' ? '自分' : '相手'}の場にステルスロック`);
  if (move === 'toxicspikes' && (st.sides[foe].tspikes || 0) < 2) { st.sides[foe].tspikes = (st.sides[foe].tspikes || 0) + 1; log.push(`${foe === 'me' ? '自分' : '相手'}の場にどくびし (${st.sides[foe].tspikes}層)`); }
  if (move === 'stickyweb' && !st.sides[foe].stickyWeb) { st.sides[foe].stickyWeb = true; log.push(`${foe === 'me' ? '自分' : '相手'}の場にねばねばネット`); }
  if (move === 'magicroom' || move === 'wonderroom') { const k = move === 'magicroom' ? 'magicRoom' : 'wonderRoom'; setFieldFlag(b, k, !st.field[k]); log.push(`${moveName(move)}${st.field[k] ? '発動' : '解除'}`); }
  if (move === 'healingwish') st.sides[side].healingWish = true;
  if (move === 'wish') st.sides[side].wish = {turn: turnNumber(b) + 1, from: mon};
  if ((move === 'spikes' || move === 'ceaselessedge') && st.sides[foe].spikes < 3) { st.sides[foe].spikes++; log.push(`${foe === 'me' ? '自分' : '相手'}の場にまきびし (${st.sides[foe].spikes}層)`); }
  const clearHazards = s => { const had = st.sides[s].sr || st.sides[s].spikes || st.sides[s].tspikes || st.sides[s].stickyWeb; st.sides[s].sr = false; st.sides[s].spikes = 0; st.sides[s].tspikes = 0; st.sides[s].stickyWeb = false; return had; };
  const clearScreens = s => { const sd = st.sides[s]; const had = sd.reflect || sd.lightScreen || sd.auroraVeil; sd.reflect = sd.lightScreen = sd.auroraVeil = false; return had; };
  if (move === 'defog') {
    const h = clearHazards('me') | clearHazards('opp');
    const sc = clearScreens(foe);
    const t = setTerrain(b, '');
    if (h || sc || t) log.push('きりばらい: 設置技・壁・フィールドを解除');
  }
  if ((move === 'rapidspin' || move === 'mortalspin') && clearHazards(side)) log.push(`${moveName(move)}: 自陣の設置技を解除`);
  if (move === 'tidyup' && (clearHazards('me') | clearHazards('opp'))) log.push('おかたづけ: 設置技を解除');
  if (['brickbreak', 'psychicfangs', 'ragingbull'].includes(move) && clearScreens(foe)) log.push(`${moveName(move)}: 壁を破壊`);
  if (['icespinner', 'steelroller'].includes(move) && setTerrain(b, '')) log.push(`${moveName(move)}: フィールドを解除`);
  if (move === 'courtchange') {
    for (const k of ['reflect', 'lightScreen', 'auroraVeil', 'tailwind', 'sr', 'spikes', 'tspikes', 'stickyWeb']) {
      const t = st.sides.me[k]; st.sides.me[k] = st.sides.opp[k]; st.sides.opp[k] = t;
      const ts = st.sides.me.since[k]; st.sides.me.since[k] = st.sides.opp.since[k]; st.sides.opp.since[k] = ts;
    }
    log.push('コートチェンジ: 両陣の場の状態を入れ替え');
  }

  // 対象 (ランク変化・はたきおとす用)
  let targets = [];
  if (act.target && act.target.mon != null) targets = [act.target];
  else if (mv.tg === 'adjacentAlly') targets = st.sides[side].active.filter(i => i != null && i !== mon).map(i => ({side, mon: i}));
  else if (mv.tg === 'allAdjacentFoes') targets = st.sides[foe].active.filter(i => i != null).map(i => ({side: foe, mon: i}));
  else if (mv.tg === 'allAdjacent') {
    targets = st.sides[foe].active.filter(i => i != null).map(i => ({side: foe, mon: i}))
      .concat(st.sides[side].active.filter(i => i != null && i !== mon).map(i => ({side, mon: i})));
  } else {
    const foes = st.sides[foe].active.filter(i => i != null && !condOf(b, foe, i)?.fainted);
    if (foes.length === 1) targets = [{side: foe, mon: foes[0]}];
  }

  // 相手の攻撃で変わる回復量は計算せず、観測した行動後HPを入力する。
  if (move === 'strengthsap' && tcond && !tcond.fainted) {
    if ((tcond.boosts.atk || 0) <= -6) { log.push('ちからをすいとる: 相手のこうげきが最低なので失敗'); return log; }
    if (!(res(b, tgtRef.side, tgtRef.mon) === 'liquidooze' && userAb === 'magicguard')) unknownHP(b, side, mon, log);
  }
  const data = moveEffects[move];
  const eff = MOVE_BOOSTS[move] || (data?.boosts ? (mv.tg === 'self' ? B(data.boosts) : B(null, data.boosts)) : data?.selfBoosts ? B(data.selfBoosts) : null);
  const stockBefore = move === 'stockpile' ? {...condOf(b, side, mon).boosts} : null;
  if (eff) {
    const sheer = eff.sec && userAb === 'sheerforce';
    if (eff.self && !sheer) {
      let self = eff.self;
      if (move === 'growth' && st.field.weather === 'Sun') self = {atk: 2, spa: 2};
      if (mv.tg === 'allies') for (const ally of st.sides[side].active) { if (ally != null) applyBoosts(b, side, ally, self, {log, resolveAbility: res}); }
      else applyBoosts(b, side, mon, self, {log, resolveAbility: res});
    }
    if (eff.target && !sheer) {
      for (const t of targets) {
        if (eff.sec && (res(b, t.side, t.mon) === 'shielddust' || activeItem(b, t.side, t.mon) === 'covertcloak')) continue;
        applyBoosts(b, t.side, t.mon, eff.target, {log, fromOpp: t.side !== side, resolveAbility: res});
      }
    }
  }
  if (move === 'curse') {
    const types = typesOf(buildOf(b, side, mon), condOf(b, side, mon)) || [];
    if (!types.includes('Ghost')) applyBoosts(b, side, mon, {atk: 1, def: 1, spe: -1}, {log, resolveAbility: res});
  }
  // ランク変化をいじる技
  const uc = condOf(b, side, mon);
  if (stockBefore) {
    uc.stockpile = (uc.stockpile || 0) + 1;
    uc.stockpileDrops ||= {def: 0, spd: 0};
    for (const k of ['def', 'spd']) if (uc.boosts[k] !== stockBefore[k]) uc.stockpileDrops[k]--;
    log.push(`たくわえる: ${uc.stockpile}回`);
  }
  if (data?.heal || move === 'healpulse' || move === 'pollenpuff') {
    const healTargets = mv.tg === 'allies' ? st.sides[side].active.filter(i => i != null).map(mon => ({side, mon})) : move === 'healpulse' ? targets : move === 'pollenpuff' ? targets.filter(t => t.side === side && t.mon !== mon) : [];
    for (const h of healTargets) {
      const ratio = move === 'healpulse' ? (userAb === 'megalauncher' ? 3 / 4 : 1 / 2) : move === 'pollenpuff' ? 1 / 2 : data.heal[0] / data.heal[1];
      healHP(b, h.side, h.mon, maxHPOf(b, h.side, h.mon) * ratio, {log, label: moveName(move)});
    }
  }
  if (move === 'swallow') {
    if (!uc.stockpile) log.push('のみこむ: たくわえていないため失敗');
    else {
      healHP(b, side, mon, maxHPOf(b, side, mon) * [0, 1 / 4, 1 / 2, 1][uc.stockpile], {log, label: 'のみこむ'});
      applyBoosts(b, side, mon, uc.stockpileDrops || {}, {log, resolveAbility: res});
      uc.stockpile = 0; uc.stockpileDrops = null;
    }
  }
  if (move === 'haze') { for (const sd of ['me', 'opp']) for (const i of st.sides[sd].active) if (i != null) condOf(b, sd, i).boosts = emptyBoosts(); log.push('くろいきり: 全員のランク変化が元に戻った'); }
  for (const t of targets) {
    const tc = condOf(b, t.side, t.mon);
    if (!tc || t.side === side) continue;
    const tn = `${t.side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(buildOf(b, t.side, t.mon), tc))}`;
    if (move === 'clearsmog' && !tc.fainted) { tc.boosts = emptyBoosts(); log.push(`クリアスモッグ: ${tn}のランク変化が元に戻った`); }
    if (move === 'psychup') { uc.boosts = {...emptyBoosts(), ...tc.boosts}; log.push(`じこあんじ: ${tn}のランク変化をコピー`); }
    if (move === 'topsyturvy') { for (const k of BOOST_KEYS) tc.boosts[k] = -(tc.boosts[k] || 0); log.push(`ひっくりかえす: ${tn}のランク変化が逆になった`); }
    if (move === 'guardswap' || move === 'powerswap') {
      for (const k of move === 'guardswap' ? ['def', 'spd'] : ['atk', 'spa']) { const x = uc.boosts[k] || 0; uc.boosts[k] = tc.boosts[k] || 0; tc.boosts[k] = x; }
      log.push(`${moveName(move)}: ランク変化を入れ替えた`);
    }
    if (move === 'painsplit' && !tc.fainted) {
      unknownHP(b, side, mon, log);
      unknownHP(b, t.side, t.mon, log);
    }
    if (move === 'roleplay') { const ta = res(b, t.side, t.mon); if (ta) { uc.abilityChanged = ta; log.push(`なりきり: ${abilityName(ta)}になった`); } }
    if (move === 'corrosivegas' && !tc.itemGone) { tc.itemGone = true; log.push(`ふしょくガス: ${tn}の持ち物が使えなくなった`); }
    if ((move === 'bugbite' || move === 'pluck') && !tc.itemGone && /berry$/.test(buildOf(b, t.side, t.mon).item || '')) { tc.itemGone = true; log.push(`${moveName(move)}: ${tn}のきのみを食べた`); }
    if (move === 'sparklingaria' && tc.status === 'brn') { tc.status = ''; log.push(`うたかたのアリア: ${tn}のやけどが治った`); }
    if ((move === 'scald' || move === 'scorchingsands' || mv.t === 'Fire') && tc.status === 'frz' && mv.c !== 'Z') { tc.status = ''; log.push(`${tn}のこおりが溶けた`); }
    if (BIND_MOVES.has(move) && !tc.fainted && !tc.bound) { tc.bound = {turn: turnNumber(b), by: {side, mon}, band: !uc.itemGone && buildOf(b, side, mon).item === 'bindingband'}; log.push(`${tn}はしめつけられた (4〜5ターン)`); }
    if (move === 'syrupbomb' && !tc.fainted && res(b, t.side, t.mon) !== 'shielddust' && !(buildOf(b, t.side, t.mon).item === 'covertcloak' && !tc.itemGone) && userAb !== 'sheerforce') tc.syrup = turnNumber(b) + 2;
    if (move === 'octolock' && !tc.fainted) { tc.octolock = {side, mon}; log.push(`${tn}はたこがためで逃げられない`); }
  }
  if (move === 'healbell') { for (const c of st.mons[side]) if (c && !c.fainted) c.status = ''; log.push('いやしのすず: 味方全員の状態異常が治った'); }
  if (move === 'recycle' && uc.itemGone) { uc.itemGone = false; log.push('リサイクル: 持ち物が戻った'); }
  if (move === 'aquaring') uc.aquaRing = true;
  if (move === 'ingrain') uc.ingrain = true;
  if (move === 'destinybond') uc.destinyBond = true;
  if (move === 'perishsong') { for (const sd of ['me', 'opp']) for (const i of st.sides[sd].active) if (i != null && !condOf(b, sd, i).fainted && condOf(b, sd, i).perish == null) condOf(b, sd, i).perish = 4; log.push('ほろびのうた: 3ターン後の終わりに倒れる'); }
  if (move === 'knockoff') {
    for (const t of targets) {
      const tb = buildOf(b, t.side, t.mon), tc = condOf(b, t.side, t.mon);
      if (!tb || !tc || tc.itemGone) continue;
      const isStone = !!dex.items[tb.item]?.ms;
      if (isStone || res(b, t.side, t.mon) === 'stickyhold') continue;
      tc.itemGone = true;
      log.push(`${t.side === 'me' ? '自分' : '相手'}の${speciesName(tb.species)}の持ち物をはたきおとした`);
    }
  }
  return log;
}

/**
 * ターンを確定して記録する。
 * draft: {acts: [{side, mon, type: 'move'|'switch', move, to, mega, target, flags: {crit, miss, cant, protect}}], orderKnown, note}
 * 戻り値: 自動反映した内容のログ (日本語)
 */
export function commitTurn(b, draft, opts = {}) {
  const log = [];
  const before = opts.before || clone({state: b.state, pick: b.pick, opp: b.opp});
  const res = opts.resolveAbility;
  const n = turnNumber(b);
  const acts = [];
  const enteredThisTurn = new Set();
  for (const a0 of draft.acts || []) {
    const a = clone(a0);
    a.flags ||= {};
    const build = buildOf(b, a.side, a.mon);
    if (!build) continue;
    // 統計用に、行動時点の対面を保存しておく
    a.sp = build.species;
    a.vs = b.state.sides[other(a.side)].active.filter(i => i != null).map(i => buildOf(b, other(a.side), i)?.species).filter(Boolean);
    const slot = b.state.sides[a.side].active.indexOf(a.mon);
    if (a.type === 'switch') {
      if (a.to == null || slot < 0) continue;
      a.toSp = buildOf(b, a.side, a.to)?.species;
      sendOut(b, a.side, slot, a.to, {log, resolveAbility: res});
      enteredThisTurn.add(`${a.side}${a.to}`);
    } else if (a.type === 'move') {
      if (a.mega) megaEvolve(b, a.side, a.mon, null, {log, resolveAbility: res});
      if (a.move && a.side === 'opp' && dex.moves[a.move] && !build.moves.includes(a.move)) build.moves.push(a.move);
      const failed = a.flags.cant || a.flags.miss || a.flags.protect;
      if (a.move && !a.flags.cant && !(a.flags.miss || a.flags.protect)) applyMoveEffects(b, a, {log, resolveAbility: res});
      if (a.move && PIVOT_MOVES.has(a.move) && a.to != null && !failed) {
        const s2 = b.state.sides[a.side].active.indexOf(a.mon);
        if (s2 >= 0) {
          a.toSp = buildOf(b, a.side, a.to)?.species;
          if (a.move === 'batonpass') {
            const keep = clone(condOf(b, a.side, a.mon).boosts);
            sendOut(b, a.side, s2, a.to, {log, resolveAbility: res});
            condOf(b, a.side, a.to).boosts = keep;
          } else sendOut(b, a.side, s2, a.to, {log, resolveAbility: res});
          enteredThisTurn.add(`${a.side}${a.to}`);
        }
      }
    } else continue;
    acts.push(a);
  }
  // ターン終了時: かそく
  for (const side of ['me', 'opp']) {
    for (const i of b.state.sides[side].active) {
      if (i == null || condOf(b, side, i).fainted || enteredThisTurn.has(`${side}${i}`)) continue;
      const ab = (res || defaultAbilityResolver)(b, side, i);
      if (ab === 'speedboost') applyBoosts(b, side, i, {spe: 1}, {log, resolveAbility: () => ''});
    }
  }
  b.turns.push({n, acts, orderKnown: !!draft.orderKnown, note: draft.note || '', auto: log, before});
  // 取り消し用の盤面スナップショットは直近 UNDO_DEPTH ターン分だけ保持する (同期データを小さく保つ)
  for (let i = 0; i < b.turns.length - UNDO_DEPTH; i++) delete b.turns[i].before;
  b.updatedAt = Date.now();
  return log;
}

// 直前のターンを取り消して盤面を戻す
export function undoTurn(b) {
  const last = b.turns[b.turns.length - 1];
  if (!last || !last.before) return false;
  const t = b.turns.pop();
  {
    b.state = t.before.state;
    b.pick = t.before.pick;
    // 相手の判明情報のうち、このターンで増えた技だけ戻す (メモ等の手入力は残す)
    t.before.opp.forEach((o, i) => { if (b.opp[i] && b.opp[i].species === o.species) { b.opp[i].moves = o.moves; if (!o.megaSeen && b.opp[i].megaSeen) b.opp[i].item = o.item; b.opp[i].megaSeen = o.megaSeen; b.opp[i].speOk = o.speOk; b.opp[i].scarfLikely = o.scarfLikely; b.opp[i].statOk = o.statOk; b.opp[i].assume = o.assume; } });
  }
  b.updatedAt = Date.now();
  return true;
}

// HP を設定する。0 でひんし扱い。
export function setHP(b, side, i, hp) {
  const c = condOf(b, side, i);
  if (!c) return;
  c.hp = Math.max(0, Math.min(100, hp));
  const was = c.fainted;
  c.fainted = c.hp <= 0;
  if (c.fainted && !was) { const s = b.state.sides[side]; s.faintTotal = (s.faintTotal ?? faintedCount(b, side) - 1) + 1; }
  if (c.fainted) { c.status = ''; c.boosts = emptyBoosts(); }
}

// 行動を1行の日本語にする (ログ表示用)
export function describeAct(b, a) {
  const who = `${a.side === 'me' ? '自' : '相'} ${speciesName(a.sp || buildOf(b, a.side, a.mon)?.species)}`;
  if (a.type === 'switch') return `${who} → ${speciesName(a.toSp || buildOf(b, a.side, a.to)?.species)} に交代`;
  const f = a.flags || {};
  const tags = [a.mega && 'メガシンカ', f.crit && '急所', f.miss && '外れ', f.protect && 'まもられた', f.cant && '行動不能'].filter(Boolean);
  let s = `${who} ${a.move ? moveName(a.move) : '(行動なし)'}`;
  if (a.target?.mon != null) s += ` → ${speciesName(buildOf(b, a.target.side, a.target.mon)?.species)}`;
  if (a.toSp) s += ` → ${speciesName(a.toSp)} に交代`;
  if (tags.length) s += ` [${tags.join('・')}]`;
  return s;
}

export {defaultAbilityResolver, WEATHER_JA, TERRAIN_JA};
