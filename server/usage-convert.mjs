// ゲーム内のバトルデータ (使用率サイトから取った中間形式) を、アプリの使用率データの形に変換する。
// 足りない項目 (初手率・能力ポイントの配分) は、Pokémon Showdown の集計 (docs/usage-single.json) で補う。
//
// 中間形式 (スクレイパーが出すもの。割合は 0〜100 の%):
// {
//   season: 'M-6', rule: 'single', updatedAt: '2026-10-13T11:00:00+09:00', source: 'バトルデータベース チャンピオンズ',
//   pokemon: [{
//     name: 'ガブリアス',          // 日本語名 (フォルム・メガは「メガボーマンダ」「ゾロアーク(ヒスイ)」のように)
//     rank: 1,                      // 使用率の順位
//     usage: 24.2,                  // 使用率 (%)。サイトに無ければ省略
//     moves: [['じしん', 99.5], ...], items: [['きあいのタスキ', 40.2], ...], abilities: [['さめはだ', 99.3], ...],
//     natures: [['ようき', 50.9], ...], teammates: [['アシレーヌ', 30.1], ...],
//     spreads: [['ようき', [2, 32, 0, 0, 0, 32], 12.3], ...]   // 能力ポイントの配分 (あれば)
//   }]
// }
import {dex, normKana} from '../src/engine/dex.js';
import {bestMatch} from '../src/engine/shot.js';

const KIND = {moves: 'moves', items: 'items', abilities: 'abilities', teammates: 'species'};
const natureByJa = Object.fromEntries(Object.entries(dex.natures).map(([id, n]) => [normKana(n.j), id]));

function idOf(kind, name, cache, miss) {
  const key = `${kind}:${name}`;
  if (cache.has(key)) return cache.get(key);
  const q = normKana(name);
  let id = Object.keys(dex[kind]).find(k => normKana(dex[kind][k].j) === q) || '';
  if (!id) { const m = bestMatch(kind, name); if (m.score >= 0.75) id = m.id; }
  if (!id) miss.add(`${kind}:${name}`);
  cache.set(key, id);
  return id;
}

/**
 * src: 中間形式 / showdown: いまの docs/usage-single.json (補いに使う)
 * 戻り値: {usage: アプリの使用率データ, warnings: [...]}
 */
export function convertUsage(src, showdown) {
  const cache = new Map(), miss = new Set(), warnings = [];
  const sd = showdown?.pokemon || {};
  // 使用率の%が無いときは、Showdown の使用率の並びを順位に当てはめる (分布の形だけ借りる)
  const sdRates = Object.values(sd).map(d => d.u || 0).sort((a, b) => b - a);
  const out = {};
  const list = [...(src.pokemon || [])].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  list.forEach((p, i) => {
    const id = idOf('species', p.name, cache, miss);
    if (!id) return;
    const pct = (arr, kind) => (arr || []).filter(([n]) => n).map(([n, r]) => [kind ? idOf(kind, n, cache, miss) : n, Number(r) / 100]).filter(([x, r]) => x && r > 0);
    const u = p.usage != null ? Number(p.usage) / 100 : sdRates[Math.min(sdRates.length - 1, (p.rank || i + 1) - 1)] || 0.001;
    const base = sd[id] || {};
    // 能力ポイントの配分: サイトにあればそれを、無ければ Showdown の配分をゲーム内の性格の割合で重みづけし直す
    let sp = [];
    if (p.spreads?.length) sp = p.spreads.map(([nat, v, r]) => [`${natureByJa[normKana(nat)] || nat}:${v.join('/')}`, Number(r) / 100]).filter(([k]) => /^[A-Z]/.test(k));
    else if (base.sp?.length) {
      const nat = Object.fromEntries((p.natures || []).map(([n, r]) => [natureByJa[normKana(n)], Number(r) / 100]).filter(([k]) => k));
      if (Object.keys(nat).length) {
        const sdNat = {};
        for (const [k, r] of base.sp) { const n = k.split(':')[0]; sdNat[n] = (sdNat[n] || 0) + r; }
        sp = base.sp.map(([k, r]) => { const n = k.split(':')[0]; return [k, nat[n] ? (r / sdNat[n]) * nat[n] : r * 0.05]; });
        // Showdown に無い性格: いちばん多い配分の形を借りる
        const top = base.sp[0]?.[0]?.split(':')[1];
        for (const [n, r] of Object.entries(nat)) if (!sdNat[n] && top) sp.push([`${n}:${top}`, r]);
        const tot = sp.reduce((a, [, r]) => a + r, 0);
        sp = sp.map(([k, r]) => [k, r / tot]).sort((a, b) => b[1] - a[1]);
      } else sp = base.sp;
    }
    out[id] = {
      u, l: base.l != null && base.u ? (base.l / base.u) * u : u * 0.33, n: base.n || 0,
      ab: pct(p.abilities, 'abilities'), it: pct(p.items, 'items'), mv: pct(p.moves, 'moves'),
      sp, tm: pct(p.teammates, 'species'),
    };
    if (!out[id].mv.length && base.mv) { out[id].mv = base.mv; warnings.push(`${p.name}: 技のデータが無いので Showdown の値`); }
    if (!out[id].ab.length && base.ab) out[id].ab = base.ab;
  });
  // メガシンカ: 持ち物のメガストーンの割合から、メガの姿の項目を作る (サイトが別の行で出していればそちらを優先)
  for (const [id, d] of Object.entries(out)) {
    const s = dex.species[id];
    if (!s?.megas?.length || s.mega) continue;
    const stones = d.it.filter(([it]) => dex.items[it]?.ms?.[id]);
    if (!stones.length) continue;
    let rest = 1;
    for (const [stone, r] of stones) {
      const megaId = dex.items[stone].ms[id];
      if (!dex.species[megaId] || out[megaId]) continue;
      const sdm = sd[megaId] || {};
      out[megaId] = {u: d.u * r, l: (d.l || 0) * r, n: 0, ab: [[dex.species[megaId].ab[0], 1]], it: [[stone, 1]], mv: d.mv, sp: sdm.sp?.length ? sdm.sp : d.sp, tm: d.tm};
      rest -= r;
    }
    d.u *= Math.max(0.05, rest); d.l *= Math.max(0.05, rest);
    const others = d.it.filter(([it]) => !dex.items[it]?.ms?.[id]);
    const tot = others.reduce((a, [, r]) => a + r, 0);
    d.it = tot ? others.map(([it, r]) => [it, r / tot]) : others;
  }
  if (miss.size) warnings.push(`名前を対応づけられなかったもの: ${[...miss].slice(0, 30).join('、')}${miss.size > 30 ? ' ほか' : ''}`);
  return {
    usage: {month: `シーズン${src.season || '?'}`, source: src.source || 'ゲーム内バトルデータ', updatedAt: src.updatedAt || new Date().toISOString(), battles: 0, ingame: true, pokemon: out},
    warnings,
  };
}
