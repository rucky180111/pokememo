// 技の追加効果 (確率で起きるもの) を Pokémon Showdown のチャンピオンズのデータから書き出す。
// 実行: PS=/path/to/pokemon-showdown node scripts/make-secondaries.mjs  → scripts/secondaries.json
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {Dex} = require(`${process.env.PS || '/home/claude/ps'}/dist/sim`);
const dex = JSON.parse(fs.readFileSync(new URL('../src/generated/dex.json', import.meta.url)));
const d = Dex.mod('champions');
const out = {};
for (const id of Object.keys(dex.moves)) {
  const m = d.moves.get(id);
  const list = [];
  for (const s of m.secondaries || []) {
    if (!s.chance || s.chance >= 100) continue;
    const e = {ch: s.chance};
    if (s.status) e.st = s.status;
    if (s.volatileStatus) e.vo = s.volatileStatus;
    if (s.boosts) e.bo = s.boosts;
    if (s.self?.boosts) e.sb = s.self.boosts;
    if (e.st || e.vo || e.bo || e.sb) list.push(e);
  }
  if (list.length) out[id] = list;
}
fs.writeFileSync(new URL('./secondaries.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'moves');
