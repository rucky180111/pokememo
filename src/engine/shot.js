// ゲームの「チーム」画面のスクショ (能力 / ステータス) から構築を読み取る。
// 画像処理と照合だけを行い、文字認識 (OCR) そのものは呼び出し側が渡す関数で行う。
// 画像は {data: RGBA の配列, width, height} (canvas の ImageData と同じ形)。
import {dex, normKana, natureMod, statValue, STAT_KEYS} from './dex.js';

// パネル内の位置 (パネルの幅・高さに対する割合)。ゲームの画面構成で決まっている
const ROWS3 = [0.354, 0.6, 0.84];
const ROWS4 = [0.13, 0.37, 0.605, 0.85];
export const LAYOUT = {
  // ステータス: 左列 = HP・こうげき・ぼうぎょ / 右列 = とくこう・とくぼう・すばやさ。各行に 実数値 と 能力ポイント
  status: [
    ...['hp', 'atk', 'def'].flatMap((k, r) => ['v', 'sp'].map(part => ({key: `${k}.${part}`, part, x0: 0.18, x1: 0.5, y: ROWS3[r]}))),
    ...['spa', 'spd', 'spe'].flatMap((k, r) => ['v', 'sp'].map(part => ({key: `${k}.${part}`, part, x0: 0.62, x1: 0.97, y: ROWS3[r]}))),
  ].map(c => ({...c, h: 0.2, digits: true})),
  // 能力: 左 = 特性・持ち物 / 右 = 技4つ
  ability: [
    {key: 'ability', x0: 0.11, x1: 0.58, y: 0.365, h: 0.19},
    {key: 'item', x0: 0.11, x1: 0.58, y: 0.615, h: 0.19},
    ...ROWS4.map((y, i) => ({key: `move${i}`, x0: 0.655, x1: 0.975, y, h: 0.2})),
  ],
};

const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const isPanel = (r, g, b) => b > r + 30 && b > g + 35 && r < 200;

/** 紫色のパネル (6体分) を探す。上の段から左→右の順 (ゲームの並び順) */
export function detectPanels(img) {
  const S = Math.max(2, Math.round(img.width / 600));
  const w = Math.floor(img.width / S), h = Math.floor(img.height / S);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(img, x * S, y * S); m[y * w + x] = isPanel(r, g, b) ? 1 : 0; }
  const seen = new Uint8Array(w * h);
  const comps = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || seen[s]) continue;
    const q = [s]; seen[s] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    while (q.length) {
      const p = q.pop(); n++;
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && m[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; q.push(p - 1); }
      if (x < w - 1 && m[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; q.push(p + 1); }
      if (y > 0 && m[p - w] && !seen[p - w]) { seen[p - w] = 1; q.push(p - w); }
      if (y < h - 1 && m[p + w] && !seen[p + w]) { seen[p + w] = 1; q.push(p + w); }
    }
    comps.push({x: x0 * S, y: y0 * S, w: (x1 - x0 + 1) * S, h: (y1 - y0 + 1) * S, fill: n / ((x1 - x0 + 1) * (y1 - y0 + 1))});
  }
  // パネルは横長 (約 4:1) で、ほぼ同じ大きさのものが 6 つ並ぶ
  const cand = comps.filter(c => c.w / c.h > 3 && c.w / c.h < 5.5 && c.fill > 0.6 && c.w > img.width * 0.15);
  if (cand.length < 6) return [];
  cand.sort((a, b) => b.w * b.h - a.w * a.h);
  const ref = cand[Math.min(3, cand.length - 1)];
  const same = cand.filter(c => Math.abs(c.w - ref.w) < ref.w * 0.08 && Math.abs(c.h - ref.h) < ref.h * 0.15).slice(0, 6);
  if (same.length < 6) return [];
  same.sort((a, b) => (Math.abs(a.y - b.y) > ref.h / 2 ? a.y - b.y : a.x - b.x));
  return same;
}

/** 能力 / ステータス のどちらの画面か (上のタブの明るい黄緑の位置で判定)。分からなければ '' */
export function pageKind(img, panels) {
  if (!panels.length) return '';
  const top = Math.min(...panels.map(p => p.y));
  const left = Math.min(...panels.map(p => p.x)), right = Math.max(...panels.map(p => p.x + p.w));
  const mid = (left + right) / 2;
  let sx = 0, n = 0;
  const S = Math.max(1, Math.round(img.width / 800));
  for (let y = 0; y < top; y += S) for (let x = left; x < right; x += S) {
    const [r, g, b] = px(img, x, y);
    if (g > 200 && r > 150 && r < 235 && b < 110) { sx += x; n++; }
  }
  if (n < 20) return '';
  return sx / n < mid ? 'ability' : 'status';
}

// 白い文字らしさ (0〜1)。背景の薄い横縞 (最も暗い色が 160 前後) は 0.5 を超えない
const inkLevel = (r, g, b) => {
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  const v = Math.max(0, Math.min(1, (mn - 135) / 75));
  return mx - mn > 70 ? 0 : v;
};

/**
 * パネル内の1か所を切り出して、白い文字だけを黒、それ以外を白にした画像にする (文字認識しやすくする)。
 * 文字のある範囲だけに詰め、数字の欄は「最後の2つのかたまり (実数値・能力ポイント)」のどちらかを取り出す。
 * 戻り値 {data: RGBA, width, height} / 文字が無ければ null
 */
export function cropCell(img, panel, cell, {textH = 40} = {}) {
  let x0 = Math.round(panel.x + panel.w * cell.x0), x1 = Math.round(panel.x + panel.w * cell.x1);
  let y0 = Math.round(panel.y + panel.h * (cell.y - cell.h / 2)), y1 = Math.round(panel.y + panel.h * (cell.y + cell.h / 2));
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.width, x1); y1 = Math.min(img.height, y1);
  const W = x1 - x0, H = y1 - y0;
  const lv = new Float32Array(W * H), ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = px(img, x0 + x, y0 + y); const v = inkLevel(r, g, b); lv[y * W + x] = v; ink[y * W + x] = v > 0.5 ? 1 : 0; }
  // 横いっぱいに伸びる線 (枠・ハイライト) は文字ではないので消す
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) n += ink[y * W + x]; if (n > W * 0.6) for (let x = 0; x < W; x++) { ink[y * W + x] = 0; lv[y * W + x] = 0; } }
  // 文字の行: インクのある行がいちばん長く続く範囲
  const rowHas = y => { for (let x = 0; x < W; x++) if (ink[y * W + x]) return true; return false; };
  let best = [0, -1], run = null;
  for (let y = 0; y <= H; y++) {
    if (y < H && rowHas(y)) { if (!run) run = [y, y]; else run[1] = y; }
    else if (run) { const gapOk = y < H && false; void gapOk; if (run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
  }
  // 濁点などで行が途切れるので、近い行はつなげる
  let ty0 = best[0], ty1 = best[1];
  if (ty1 < ty0) return null;
  for (let y = ty0 - 1, gap = 0; y >= 0 && gap < H * 0.08; y--) { if (rowHas(y)) { ty0 = y; gap = 0; } else gap++; }
  for (let y = ty1 + 1, gap = 0; y < H && gap < H * 0.08; y++) { if (rowHas(y)) { ty1 = y; gap = 0; } else gap++; }
  // 横方向のかたまり
  const colHas = x => { for (let y = ty0; y <= ty1; y++) if (ink[y * W + x]) return true; return false; };
  const lineH = ty1 - ty0 + 1;
  const clusters = [];
  let c = null, gap = 0;
  for (let x = 0; x < W; x++) {
    if (colHas(x)) { if (!c) c = [x, x]; else c[1] = x; gap = 0; }
    else if (c) { gap++; if (gap > lineH * (cell.digits ? 0.55 : 0.9)) { clusters.push(c); c = null; } }
  }
  if (c) clusters.push(c);
  let cx0, cx1;
  if (cell.digits) {
    // 数字の欄: 行の最後の2つのかたまりが 実数値・能力ポイント
    const big = clusters.filter(k => k[1] - k[0] >= lineH * 0.15);
    const pick = cell.part === 'sp' ? big[big.length - 1] : big[big.length - 2];
    if (!pick) return null;
    [cx0, cx1] = pick;
  } else {
    if (!clusters.length) return null;
    cx0 = clusters[0][0]; cx1 = clusters[clusters.length - 1][1];
  }
  // 文字の高さをそろえて拡大する。なめらかに拡大してから白黒にする (小さい画像でも字の形を保つ)
  const m = Math.max(1, Math.round(lineH * 0.15));
  cx0 = Math.max(0, cx0 - m); cx1 = Math.min(W - 1, cx1 + m); ty0 = Math.max(0, ty0 - m); ty1 = Math.min(H - 1, ty1 + m);
  const sc = textH / (ty1 - ty0 + 1), pad = Math.round(textH * 0.4);
  const OW = Math.max(8, Math.round((cx1 - cx0 + 1) * sc)) + pad * 2, OH = Math.round((ty1 - ty0 + 1) * sc) + pad * 2;
  const out = new Uint8ClampedArray(OW * OH * 4).fill(255);
  const at = (x, y) => lv[Math.max(ty0, Math.min(ty1, y)) * W + Math.max(cx0, Math.min(cx1, x))];
  for (let y = 0; y < OH - pad * 2; y++) for (let x = 0; x < OW - pad * 2; x++) {
    const fx = cx0 + (x + 0.5) / sc - 0.5, fy = ty0 + (y + 0.5) / sc - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), dx = fx - ix, dy = fy - iy;
    const v = at(ix, iy) * (1 - dx) * (1 - dy) + at(ix + 1, iy) * dx * (1 - dy) + at(ix, iy + 1) * (1 - dx) * dy + at(ix + 1, iy + 1) * dx * dy;
    if (v <= 0.5) continue;
    const o = ((y + pad) * OW + (x + pad)) * 4;
    out[o] = out[o + 1] = out[o + 2] = 0;
  }
  return {data: out, width: OW, height: OH};
}

// ---- 文字列の照合 ----
// 文字認識の結果は崩れることがあるので、図鑑の名前と「似ている度合い」で照合する
const plain = s => s.normalize('NFD').replace(/[\u3099\u309A]/g, '');
function sim(a, b) {
  if (!a || !b) return 0;
  a = plain(a); b = plain(b);
  if (a === b) return 1;
  // 編集距離ベースの類似度
  const m = a.length, n = b.length;
  let prev = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  const ed = 1 - prev[n] / Math.max(m, n);
  // 文字の重なり (順序を問わない) も加味する
  const bag = new Map();
  for (const c of b) bag.set(c, (bag.get(c) || 0) + 1);
  let hit = 0;
  for (const c of a) if (bag.get(c) > 0) { hit++; bag.set(c, bag.get(c) - 1); }
  const ov = (2 * hit) / (m + n);
  return 0.6 * ed + 0.4 * ov;
}
// 文字認識の結果から、記号や読み間違えやすい飾りを除く
export function cleanText(s) {
  return normKana(String(s || '').replace(/[^\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー0-9０-９A-Za-zＡ-Ｚａ-ｚ]/gu, ''));
}
/** kind の中から一番似ている名前。候補を ids で絞れる。戻り値 {id, score} */
export function bestMatch(kind, text, ids, prior = {}) {
  const q = cleanText(text);
  if (!q) return {id: '', score: 0};
  let best = {id: '', score: 0};
  for (const id of ids || Object.keys(dex[kind])) {
    const e = dex[kind][id];
    if (!e?.j) continue;
    // prior: そのポケモンがよく持つ・覚える (使用率) ものを少しだけ優先する
    const s = sim(q, normKana(e.j)) + (prior[id] ? 0.015 + Math.min(0.035, prior[id] * 0.1) : 0);
    if (s > best.score) best = {id, score: s};
  }
  return best;
}

const digits = s => {
  const m = String(s ?? '').replace(/[oOＯ]/g, '0').replace(/[lI|]/g, '1').match(/\d+/g);
  return m ? Number(m.join('')) : null;
};

const NATURES = () => Object.keys(dex.natures);
// 選べるポケモン (メガシンカ後の姿などは除く)
const baseSpecies = () => Object.keys(dex.species).filter(id => !dex.species[id].mega && !dex.species[id].bo);

/**
 * 実数値 (と読み取れた能力ポイント) から、種族・性格・能力ポイントを割り出す。
 * 能力ポイントは実数値から逆算できるので、読み取った能力ポイントは確認と、実数値が読めなかったときの補いに使う。
 * 戻り値: よく合う順に [{species, nature, sp, miss: 説明のつかない実数値の数, spDiff: 読み取りと違う能力ポイントの数}]
 */
export function identify(vals, sps, {abilityText, moveTexts = []} = {}) {
  const out = [];
  const natures = Object.keys(dex.natures).filter(n => dex.natures[n].p || n === 'Serious');
  for (const species of baseSpecies()) {
    const bs = dex.species[species].bs;
    // HP は性格に関係ないので、ここで大きく絞る (HP が読めていて合わないものは、ほかが全部合うときだけ残る)
    const hpSp = vals[0] != null ? vals[0] - 75 - bs[0] : null;
    const hpOk = hpSp != null && hpSp >= 0 && hpSp <= 32;
    for (const nature of natures) {
      const sp = [], miss = [];
      for (let i = 0; i < 6; i++) {
        const v = vals[i];
        let found = null;
        if (v != null) {
          if (i === 0) { if (hpOk) found = hpSp; }
          else {
            const mod = natureMod(nature, STAT_KEYS[i]);
            for (let x = 0; x <= 32; x++) if (statValue(bs[i], x, mod, false) === v) { found = x; break; }
          }
        }
        if (found == null) { miss.push(i); sp.push(Math.max(0, Math.min(32, sps[i] ?? 0))); }
        else sp.push(found);
      }
      if (miss.length > 2) continue;
      // 読めなかったのが1か所なら、合計66から残りを割り出す (ほとんどの構築は66を使い切る)
      if (miss.length === 1) { const rest = 66 - sp.reduce((a, b, i) => a + (i === miss[0] ? 0 : b), 0); if (rest >= 0 && rest <= 32) sp[miss[0]] = rest; }
      const spDiff = sp.filter((x, i) => sps[i] != null && sps[i] !== x).length;
      const total = sp.reduce((a, b) => a + b, 0);
      out.push({species, nature, sp, miss: miss.length, spDiff, over: total > 66 ? 1 : 0});
    }
  }
  // 特性・技の文字で同点を崩す
  const bonusCache = new Map();
  const bonus = c => {
    if (bonusCache.has(c.species)) return bonusCache.get(c.species);
    let s = 0;
    if (abilityText) s += bestMatch('abilities', abilityText, dex.species[c.species].ab).score;
    const learn = dex.learn?.[c.species];
    if (learn && moveTexts.length) for (const t of moveTexts) s += bestMatch('moves', t, learn).score * 0.25;
    bonusCache.set(c.species, s);
    return s;
  };
  const score = c => c.miss * 3 + c.spDiff + c.over * 2;
  out.sort((a, b) => score(a) - score(b) || bonus(b) - bonus(a));
  return out;
}

/**
 * パネルごとの文字認識の結果を、構築の6体にまとめる。
 * status: [{'hp.v': '191', 'hp.sp': '32', ...}] (6つ) / ability: [{ability, item, move0..3}] (6つ)
 * 戻り値: [{build, warn: [...], conf: {species, ability, item, moves}}]
 */
export function assemble({status, ability}, {usage} = {}) {
  const res = [];
  for (let i = 0; i < 6; i++) {
    const st = status?.[i], ab = ability?.[i];
    const warn = [];
    let species = '', nature = 'Serious', sp = [0, 0, 0, 0, 0, 0], conf = {};
    const moveTexts = ab ? [0, 1, 2, 3].map(k => ab[`move${k}`]).filter(Boolean) : [];
    if (st) {
      const vals = STAT_KEYS.map(k => digits(st[`${k}.v`]));
      const sps = STAT_KEYS.map(k => { const d = digits(st[`${k}.sp`]); return d != null && d <= 32 ? d : null; });
      sp = sps.map(v => v ?? 0);
      const cand = identify(vals, sps, {abilityText: ab?.ability, moveTexts});
      if (cand.length) {
        ({species, nature, sp} = cand[0]);
        conf.species = cand[0].miss === 0 ? 'sure' : 'guess';
        conf.sp = cand[0].miss === 0 ? 'sure' : 'guess';
        if (cand[0].miss) warn.push('一部の実数値を読み取れませんでした。能力ポイントを確認してください');
        const rival = cand.find(c => c.species !== species);
        if (rival && rival.miss === cand[0].miss && rival.spDiff <= cand[0].spDiff) conf.species = 'guess';
      } else warn.push('ポケモンを特定できませんでした');
      if (sp.reduce((a, b) => a + b, 0) > 66) warn.push('能力ポイントの合計が66を超えています (読み取りの誤りの可能性)');
    }
    if (!species && ab) {
      // ステータス画面が無いときは、特性と技から推測する
      let best = {species: '', s: 0};
      for (const id of baseSpecies()) {
        const s = dex.species[id];
        let score = ab.ability ? bestMatch('abilities', ab.ability, s.ab).score : 0;
        const learn = dex.learn?.[id];
        if (learn) for (const t of moveTexts) score += bestMatch('moves', t, learn).score * 0.5;
        if (score > best.s) best = {species: id, s: score};
      }
      species = best.species; conf.species = 'guess';
      if (species) warn.push('ステータス画面が無いため、ポケモンは特性と技からの推測です');
    }
    const build = {species, item: '', ability: species ? dex.species[species].ab[0] : '', nature, sp, moves: [], note: ''};
    if (ab && species) {
      const a = bestMatch('abilities', ab.ability, dex.species[species].ab);
      if (a.id) build.ability = a.id;
      conf.ability = a.score > 0.6 ? 'sure' : 'guess';
      const prior = Object.fromEntries(usage?.pokemon?.[species]?.it || []);
      const it = bestMatch('items', ab.item, null, prior);
      if (it.score >= 0.35) { build.item = it.id; conf.item = it.score > 0.7 ? 'sure' : 'guess'; }
      else if (cleanText(ab.item)) { conf.item = 'guess'; warn.push('持ち物を読み取れませんでした'); }
      const learn = dex.learn?.[species];
      const pool = learn && learn.length ? learn : null;
      conf.moves = [];
      for (const t of moveTexts) {
        if (!cleanText(t)) continue;
        const mprior = Object.fromEntries(usage?.pokemon?.[species]?.mv || []);
        let m = bestMatch('moves', t, pool, mprior);
        if (pool && m.score < 0.55) { const any = bestMatch('moves', t); if (any.score > m.score + 0.15) m = any; }
        if (m.id && m.score >= 0.4 && !build.moves.includes(m.id)) { build.moves.push(m.id); conf.moves.push(m.score > 0.7 ? 'sure' : 'guess'); }
      }
    }
    res.push({build, warn, conf});
  }
  return res;
}
