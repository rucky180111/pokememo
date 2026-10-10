// 対戦データの生成と、盤面 (仮想のゲーム状況) の状態遷移。
// UI から独立した純粋なロジックで、tests/ から直接検証する。
import {dex, megaFormeFor, speciesName, moveName, abilityName} from './dex.js';
import {newCond, emptyBoosts, currentSpecies, currentAbility, BOOST_KEYS} from './calc.js';

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

export const turnNumber = b => b.turns.length + 1;
export const buildOf = (b, side, i) => (side === 'me' ? b.my[i] : b.opp[i]);
export const condOf = (b, side, i) => b.state.mons[side][i];
export const faintedCount = (b, side) => b.state.mons[side].filter(c => c.fainted).length;

// 特性が確定していないポケモンの「たぶんこの特性」を返す resolver を差し込める
// resolver(side, index) -> abilityId ('' なら不明)
const defaultAbilityResolver = (b, side, i) => {
  const build = buildOf(b, side, i);
  if (!build) return '';
  const cond = condOf(b, side, i);
  const sid = currentSpecies(build, cond);
  const s = dex.species[sid];
  if (!s) return '';
  if (s.mega) return s.ab[0] || '';
  if (build.ability) return build.ability;
  if (side === 'opp' && s.ab.length === 1) return s.ab[0];
  return side === 'me' ? s.ab[0] || '' : '';
};

const WEATHER_ABILITY = {drizzle: 'Rain', drought: 'Sun', sandstream: 'Sand', snowwarning: 'Snow'};
const TERRAIN_ABILITY = {electricsurge: 'Electric', grassysurge: 'Grassy', psychicsurge: 'Psychic', mistysurge: 'Misty'};
const WEATHER_JA = {Sun: 'はれ', Rain: 'あめ', Sand: 'すなあらし', Snow: 'ゆき'};
const TERRAIN_JA = {Electric: 'エレキフィールド', Grassy: 'グラスフィールド', Misty: 'ミストフィールド', Psychic: 'サイコフィールド'};
const STAT_JA = {atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ'};

const NO_DROP = new Set(['clearbody', 'whitesmoke']); // 相手からの能力ダウンを受けない
const NO_INTIMIDATE = new Set(['clearbody', 'whitesmoke', 'hypercutter', 'innerfocus', 'owntempo', 'oblivious', 'scrappy']);

export function setWeather(b, w) {
  const f = b.state.field;
  if (f.weather === w) return false;
  f.weather = w;
  f.since.weather = w ? turnNumber(b) : undefined;
  return true;
}
export function setTerrain(b, t) {
  const f = b.state.field;
  if (f.terrain === t) return false;
  f.terrain = t;
  f.since.terrain = t ? turnNumber(b) : undefined;
  return true;
}
export function setSideFlag(b, side, key, val) {
  const s = b.state.sides[side];
  if (s[key] === val) return false;
  s[key] = val;
  s.since[key] = val ? turnNumber(b) : undefined;
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
export function applyBoosts(b, side, i, changes, {fromOpp = false, log = [], resolveAbility} = {}) {
  const cond = condOf(b, side, i);
  const build = buildOf(b, side, i);
  if (!cond || !build || cond.fainted) return;
  const ab = (resolveAbility || defaultAbilityResolver)(b, side, i);
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(build, cond))}`;
  let dropped = false;
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
    if (after < before && fromOpp) dropped = true;
    log.push(`${who}の${STAT_JA[k]} ${after - before > 0 ? '+' : ''}${after - before} (→${after > 0 ? '+' : ''}${after})`);
  }
  if (dropped && ab === 'defiant') applyBoosts(b, side, i, {atk: 2}, {log, resolveAbility: () => ''});
  if (dropped && ab === 'competitive') applyBoosts(b, side, i, {spa: 2}, {log, resolveAbility: () => ''});
}

// 場に出たとき・メガシンカしたときに発動する特性
export function applyEntryAbility(b, side, i, {log = [], resolveAbility} = {}) {
  const res = resolveAbility || defaultAbilityResolver;
  const ab = res(b, side, i);
  if (!ab) return;
  const build = buildOf(b, side, i), cond = condOf(b, side, i);
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(build, cond))}`;
  if (WEATHER_ABILITY[ab] && setWeather(b, WEATHER_ABILITY[ab])) log.push(`${who}の${abilityName(ab)}: 天候が${WEATHER_JA[WEATHER_ABILITY[ab]]}に`);
  if (TERRAIN_ABILITY[ab] && setTerrain(b, TERRAIN_ABILITY[ab])) log.push(`${who}の${abilityName(ab)}: ${TERRAIN_JA[TERRAIN_ABILITY[ab]]}に`);
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

// 場から下がるときの処理 (ランクリセット、戦闘中フォルム解除、さいせいりょく、しぜんかいふく)
function leaveField(b, side, i, {log = [], resolveAbility} = {}) {
  const cond = condOf(b, side, i), build = buildOf(b, side, i);
  if (!cond || !build) return;
  const ab = (resolveAbility || defaultAbilityResolver)(b, side, i);
  cond.boosts = emptyBoosts();
  cond.abilityOn = false;
  if (cond.status === 'tox') cond.toxicCounter = 1;
  if (cond.forme && !dex.species[cond.forme]?.mega) cond.forme = null; // メガシンカは交代しても戻らない
  if (cond.fainted) return;
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(build.species)}`;
  if (ab === 'regenerator' && cond.hp < 100) {
    cond.hp = Math.min(100, Math.round((cond.hp + 100 / 3) * 10) / 10);
    log.push(`${who}のさいせいりょく: HP ${Math.round(cond.hp)}% に回復`);
  }
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
  if (!b.pick[side].includes(monIdx)) b.pick[side].push(monIdx);
  if (!opts.silent) applyEntryAbility(b, side, monIdx, {log, resolveAbility: opts.resolveAbility});
  return log;
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
  clangoroussoul: B({atk: 1, def: 1, spa: 1, spd: 1, spe: 1}), geomancy: B({spa: 2, spd: 2, spe: 2}), shelter: B({def: 2}),
  // 使用者が下がる攻撃技 (追加効果ではないので ちからずく の影響を受けない)
  closecombat: B({def: -1, spd: -1}), superpower: B({atk: -1, def: -1}), dracometeor: B({spa: -2}), overheat: B({spa: -2}),
  leafstorm: B({spa: -2}), psychoboost: B({spa: -2}), fleurcannon: B({spa: -2}), makeitrain: B({spa: -1}), hammerarm: B({spe: -1}),
  icehammer: B({spe: -1}), vcreate: B({def: -1, spd: -1, spe: -1}), armorcannon: B({def: -1, spd: -1}), headlongrush: B({def: -1, spd: -1}),
  scaleshot: B({def: -1, spe: 1}), spinout: B({spe: -2}), clangingscales: B({def: -1}), dragonascent: B({def: -1, spd: -1}),
  // 100% の追加効果で使用者が上がる技
  poweruppunch: B({atk: 1}, null, {sec: 1}), flamecharge: B({spe: 1}, null, {sec: 1}), trailblaze: B({spe: 1}, null, {sec: 1}),
  aquastep: B({spe: 1}, null, {sec: 1}), torchsong: B({spa: 1}, null, {sec: 1}), rapidspin: B({spe: 1}, null, {sec: 1}),
  chargebeam: B({spa: 1}, null, {sec: 1}), mysticalpower: B({spa: 1}, null, {sec: 1}), esperwing: B({spe: 1}, null, {sec: 1}),
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
  const userAb = res(b, side, mon);
  const who = `${side === 'me' ? '自分' : '相手'}の${speciesName(currentSpecies(buildOf(b, side, mon), condOf(b, side, mon)))}`;
  const st = b.state;

  const weatherMove = {raindance: 'Rain', sunnyday: 'Sun', sandstorm: 'Sand', snowscape: 'Snow', chillyreception: 'Snow'}[move];
  if (weatherMove && setWeather(b, weatherMove)) log.push(`${moveName(move)}: 天候が${WEATHER_JA[weatherMove]}に`);
  const terrainMove = {electricterrain: 'Electric', grassyterrain: 'Grassy', mistyterrain: 'Misty', psychicterrain: 'Psychic'}[move];
  if (terrainMove && setTerrain(b, terrainMove)) log.push(`${moveName(move)}: ${TERRAIN_JA[terrainMove]}に`);
  if (move === 'reflect' && setSideFlag(b, side, 'reflect', true)) log.push(`${who}のリフレクター`);
  if (move === 'lightscreen' && setSideFlag(b, side, 'lightScreen', true)) log.push(`${who}のひかりのかべ`);
  if (move === 'auroraveil' && st.field.weather === 'Snow' && setSideFlag(b, side, 'auroraVeil', true)) log.push(`${who}のオーロラベール`);
  if (move === 'tailwind' && setSideFlag(b, side, 'tailwind', true)) log.push(`${who}のおいかぜ`);
  if (move === 'trickroom') { setFieldFlag(b, 'trickRoom', !st.field.trickRoom); log.push(`トリックルーム${st.field.trickRoom ? '発動' : '解除'}`); }
  if (move === 'gravity' && setFieldFlag(b, 'gravity', true)) log.push('じゅうりょく発動');
  if (move === 'stealthrock' && setSideFlag(b, foe, 'sr', true)) log.push(`${foe === 'me' ? '自分' : '相手'}の場にステルスロック`);
  if (move === 'spikes' && st.sides[foe].spikes < 3) { st.sides[foe].spikes++; log.push(`${foe === 'me' ? '自分' : '相手'}の場にまきびし (${st.sides[foe].spikes}層)`); }
  const clearHazards = s => { const had = st.sides[s].sr || st.sides[s].spikes; st.sides[s].sr = false; st.sides[s].spikes = 0; return had; };
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
    for (const k of ['reflect', 'lightScreen', 'auroraVeil', 'tailwind', 'sr', 'spikes']) {
      const t = st.sides.me[k]; st.sides.me[k] = st.sides.opp[k]; st.sides.opp[k] = t;
      const ts = st.sides.me.since[k]; st.sides.me.since[k] = st.sides.opp.since[k]; st.sides.opp.since[k] = ts;
    }
    log.push('コートチェンジ: 両陣の場の状態を入れ替え');
  }

  // 対象 (ランク変化・はたきおとす用)
  let targets = [];
  if (act.target && act.target.mon != null) targets = [act.target];
  else if (mv.tg === 'allAdjacentFoes') targets = st.sides[foe].active.filter(i => i != null).map(i => ({side: foe, mon: i}));
  else if (mv.tg === 'allAdjacent') {
    targets = st.sides[foe].active.filter(i => i != null).map(i => ({side: foe, mon: i}))
      .concat(st.sides[side].active.filter(i => i != null && i !== mon).map(i => ({side, mon: i})));
  } else {
    const foes = st.sides[foe].active.filter(i => i != null && !condOf(b, foe, i)?.fainted);
    if (foes.length === 1) targets = [{side: foe, mon: foes[0]}];
  }

  const eff = MOVE_BOOSTS[move];
  if (eff) {
    const sheer = eff.sec && userAb === 'sheerforce';
    if (eff.self && !sheer) {
      let self = eff.self;
      if (move === 'growth' && st.field.weather === 'Sun') self = {atk: 2, spa: 2};
      applyBoosts(b, side, mon, self, {log, resolveAbility: res});
    }
    if (eff.target && !sheer) {
      for (const t of targets) {
        if (eff.sec && res(b, t.side, t.mon) === 'shielddust') continue;
        applyBoosts(b, t.side, t.mon, eff.target, {log, fromOpp: t.side !== side, resolveAbility: res});
      }
    }
  }
  if (move === 'curse') {
    const types = dex.species[currentSpecies(buildOf(b, side, mon), condOf(b, side, mon))]?.t || [];
    if (!types.includes('Ghost')) applyBoosts(b, side, mon, {atk: 1, def: 1, spe: -1}, {log, resolveAbility: res});
  }
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
  c.fainted = c.hp <= 0;
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
