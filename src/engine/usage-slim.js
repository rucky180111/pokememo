// Smogon 使用率 (pkmn/smogon の stats 形式) を、アプリで使う軽量形式に変換する。
// ビルド時 (Node) と、アプリ内の「最新データに更新」(ブラウザ) の両方で使う。
const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

function top(obj, n, min, mapKey) {
  if (!obj) return [];
  const merged = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = mapKey(k);
    if (key == null) continue;
    merged[key] = (merged[key] || 0) + v;
  }
  return Object.entries(merged)
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => [k, Math.round(v * 10000) / 10000]);
}

export function slimUsage(rawStats, dex) {
  const out = {battles: rawStats.battles || 0, pokemon: {}};
  const sid = name => { const id = toID(name); return dex.species[id] ? id : null; };
  for (const [name, p] of Object.entries(rawStats.pokemon || {})) {
    const id = sid(name);
    if (!id) continue;
    const usage = p.usage?.weighted ?? p.usage?.real ?? 0;
    if (usage < 0.0005) continue;
    out.pokemon[id] = {
      u: Math.round(usage * 10000) / 10000,
      l: Math.round((p.lead?.weighted ?? p.lead?.real ?? 0) * 10000) / 10000,
      n: p.count || 0,
      ab: top(p.abilities, 4, 0.01, k => (dex.abilities[toID(k)] ? toID(k) : null)),
      it: top(p.items, 10, 0.01, k => (toID(k) === 'nothing' ? '' : dex.items[toID(k)] ? toID(k) : null)),
      mv: top(p.moves, 16, 0.02, k => (dex.moves[toID(k)] ? toID(k) : null)),
      // 性格:H/A/B/C/D/S
      sp: top(p.spreads, 14, 0.004, k => (/^\w+:\d+\/\d+\/\d+\/\d+\/\d+\/\d+$/.test(k) ? k : null)),
      tm: top(p.teammates, 10, 0.05, sid),
    };
  }
  return out;
}
