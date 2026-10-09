// 図鑑データへのアクセスと、能力値・検索のユーティリティ
import dexData from '../generated/dex.json' with {type: 'json'};

export const dex = dexData;
export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_JA = ['H', 'A', 'B', 'C', 'D', 'S'];
export const SP_MAX = 32;
export const SP_TOTAL = 66;

export const TYPE_JA = {
  Normal: 'ノーマル', Fire: 'ほのお', Water: 'みず', Electric: 'でんき', Grass: 'くさ', Ice: 'こおり',
  Fighting: 'かくとう', Poison: 'どく', Ground: 'じめん', Flying: 'ひこう', Psychic: 'エスパー', Bug: 'むし',
  Rock: 'いわ', Ghost: 'ゴースト', Dragon: 'ドラゴン', Dark: 'あく', Steel: 'はがね', Fairy: 'フェアリー',
};
export const TYPES = Object.keys(TYPE_JA);

export const toID = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export const speciesOf = id => dex.species[id] || null;
export const speciesName = id => dex.species[id]?.j || (id ? String(id) : '—');
export const moveName = id => dex.moves[id]?.j || (id ? String(id) : '—');
export const itemName = id => dex.items[id]?.j || (id ? String(id) : '');
export const abilityName = id => dex.abilities[id]?.j || (id ? String(id) : '');
export const natureName = n => dex.natures[n]?.j || n || '';

// 性格補正 (1.1 / 0.9 / 1)
export function natureMod(nature, statKey) {
  const n = dex.natures[nature];
  if (!n || !n.p) return 1;
  if (n.p === statKey) return 1.1;
  if (n.m === statKey) return 0.9;
  return 1;
}

// ポケモンチャンピオンズの能力値: HP = 種族値+75+SP、それ以外 = floor((種族値+20+SP)×性格補正)
// 性格補正は整数演算 (×11/10, ×9/10) で行う。
export function statValue(base, sp, mod, isHP) {
  if (isHP) return base === 1 ? 1 : base + 75 + sp;
  const raw = base + 20 + sp;
  if (mod > 1) return Math.floor((raw * 11) / 10);
  if (mod < 1) return Math.floor((raw * 9) / 10);
  return raw;
}

export function statsOf(speciesId, sp = [0, 0, 0, 0, 0, 0], nature = 'Serious') {
  const s = dex.species[speciesId];
  if (!s) return [0, 0, 0, 0, 0, 0];
  return s.bs.map((b, i) => statValue(b, clampSP(sp[i]), natureMod(nature, STAT_KEYS[i]), i === 0));
}

export const clampSP = v => Math.max(0, Math.min(SP_MAX, Math.round(Number(v) || 0)));
export const spTotal = sp => (sp || []).reduce((a, b) => a + clampSP(b), 0);

// ランク補正
export function boostMul(stage) {
  const s = Math.max(-6, Math.min(6, stage || 0));
  return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
}

// ---- 検索 (ひらがな/カタカナ/英語を区別しない) ----
export function normKana(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s・\-ー]/g, '');
}

const indexCache = {};
function indexOf(kind) {
  if (!indexCache[kind]) {
    indexCache[kind] = Object.entries(dex[kind]).map(([id, v]) => ({id, j: v.j, key: normKana(v.j), en: toID(v.n)}));
  }
  return indexCache[kind];
}

// kind: 'species' | 'moves' | 'items' | 'abilities'
// 前方一致 → 部分一致 → 英語名一致 の順に並べる
export function search(kind, query, {limit = 60, filter} = {}) {
  const q = normKana(query);
  const qe = toID(query);
  const list = indexOf(kind);
  const a = [], b = [], c = [];
  for (const e of list) {
    if (filter && !filter(e.id)) continue;
    if (!q) { a.push(e); continue; }
    if (e.key.startsWith(q)) a.push(e);
    else if (e.key.includes(q)) b.push(e);
    else if (qe && e.en.includes(qe)) c.push(e);
  }
  const out = a.concat(b, c);
  return limit ? out.slice(0, limit) : out;
}

export const isMegaForme = id => !!dex.species[id]?.mega;
// 持ち物からメガシンカ先を求める (持っていなければ null)
export function megaFormeFor(speciesId, itemId) {
  const ms = dex.items[itemId]?.ms;
  return (ms && ms[speciesId]) || null;
}
// メガ後・戦闘中フォルム → 基本の種族ID
export function baseSpeciesId(id) {
  const s = dex.species[id];
  if (!s) return id;
  if (s.mega) return s.mega;
  for (const [b, v] of Object.entries(dex.species)) if (v.forms?.includes(id)) return b;
  return id;
}
// 対戦中に取りうる姿 (基本 + 戦闘中フォルム + 持ち物に対応するメガ。持ち物不明なら全メガ)
export function formesOf(speciesId, itemId, itemKnown = true) {
  const s = dex.species[speciesId];
  if (!s) return [speciesId];
  const out = [speciesId, ...(s.forms || [])];
  const megas = s.megas || [];
  if (itemKnown) { const m = megaFormeFor(speciesId, itemId); if (m) out.push(m); } else out.push(...megas);
  return out;
}

// タイプ相性 (攻撃タイプ → 防御タイプ)
const E = {
  Normal: {Rock: .5, Ghost: 0, Steel: .5},
  Fire: {Fire: .5, Water: .5, Grass: 2, Ice: 2, Bug: 2, Rock: .5, Dragon: .5, Steel: 2},
  Water: {Fire: 2, Water: .5, Grass: .5, Ground: 2, Rock: 2, Dragon: .5},
  Electric: {Water: 2, Electric: .5, Grass: .5, Ground: 0, Flying: 2, Dragon: .5},
  Grass: {Fire: .5, Water: 2, Grass: .5, Poison: .5, Ground: 2, Flying: .5, Bug: .5, Rock: 2, Dragon: .5, Steel: .5},
  Ice: {Fire: .5, Water: .5, Grass: 2, Ice: .5, Ground: 2, Flying: 2, Dragon: 2, Steel: .5},
  Fighting: {Normal: 2, Ice: 2, Poison: .5, Flying: .5, Psychic: .5, Bug: .5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: .5},
  Poison: {Grass: 2, Poison: .5, Ground: .5, Rock: .5, Ghost: .5, Steel: 0, Fairy: 2},
  Ground: {Fire: 2, Electric: 2, Grass: .5, Poison: 2, Flying: 0, Bug: .5, Rock: 2, Steel: 2},
  Flying: {Electric: .5, Grass: 2, Fighting: 2, Bug: 2, Rock: .5, Steel: .5},
  Psychic: {Fighting: 2, Poison: 2, Psychic: .5, Dark: 0, Steel: .5},
  Bug: {Fire: .5, Grass: 2, Fighting: .5, Poison: .5, Flying: .5, Psychic: 2, Ghost: .5, Dark: 2, Steel: .5, Fairy: .5},
  Rock: {Fire: 2, Ice: 2, Fighting: .5, Ground: .5, Flying: 2, Bug: 2, Steel: .5},
  Ghost: {Normal: 0, Psychic: 2, Ghost: 2, Dark: .5},
  Dragon: {Dragon: 2, Steel: .5, Fairy: 0},
  Dark: {Fighting: .5, Psychic: 2, Ghost: 2, Dark: .5, Fairy: .5},
  Steel: {Fire: .5, Water: .5, Electric: .5, Ice: 2, Rock: 2, Steel: .5, Fairy: 2},
  Fairy: {Fire: .5, Fighting: 2, Poison: .5, Dragon: 2, Dark: 2, Steel: .5},
};
export function typeEffect(atkType, defTypes) {
  let m = 1;
  for (const t of defTypes || []) m *= E[atkType]?.[t] ?? 1;
  return m;
}
// 受ける側から見た弱点・耐性一覧
export function weaknessTable(defTypes) {
  const out = {};
  for (const t of TYPES) out[t] = typeEffect(t, defTypes);
  return out;
}
