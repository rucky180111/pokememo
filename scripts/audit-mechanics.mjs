// 全カタログをShowdown本体+Champions差分と照合し、効果データと監査台帳を生成する。
// 入力: node scripts/audit-mechanics.mjs /path/to/reference
// reference/{moves,abilities,items,champions-moves,champions-abilities,champions-items}.ts
// 取得元は出力のsourcesに記録。関数本体は評価せず、TSモジュールの宣言を読み取る。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
import calc from '@smogon/calc';
const root = new URL('../', import.meta.url);
const directory = process.argv[2];
if (!directory) throw new Error('参照TSファイルのディレクトリを指定してください');
const dex = JSON.parse(fs.readFileSync(new URL('src/generated/dex.json', root)));
const engineFiles = fs.readdirSync(new URL('src/engine/', root)).filter(f => f.endsWith('.js')).map(f => ({path: `src/engine/${f}`, text: fs.readFileSync(new URL(`src/engine/${f}`, root), 'utf8')}));
const sources = [], catalog = {}, moveEffects = {};
async function read(category, champions) {
  const filename = `${champions ? 'champions-' : ''}${category}.ts`;
  const source = fs.readFileSync(path.join(directory, filename), 'utf8');
  sources.push({filename, url: `https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/${champions ? 'mods/champions/' : ''}${category}.ts`, sha256: createHash('sha256').update(source).digest('hex')});
  const {code} = await transform(source, {loader: 'ts', format: 'esm'});
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  return Object.values(module)[0];
}
for (const category of ['moves', 'abilities', 'items']) {
  const base = await read(category, false), champions = await read(category, true);
  catalog[category] = {};
  for (const [id, entry] of Object.entries(dex[category])) {
    const ref = {...base[id], ...champions[id]};
    if (!ref.name) throw new Error(`参照データなし: ${category}/${id}`);
    const hooks = Object.keys(ref).filter(k => k.startsWith('on') && typeof ref[k] === 'function');
    const engineReferences = engineFiles.filter(f => f.text.includes(id)).map(f => f.path);
    const dataEffects = {};
    if (category === 'moves') {
      for (const k of ['heal', 'drain', 'recoil', 'boosts']) if (ref[k]) dataEffects[k] = ref[k];
      if (ref.self?.boosts) dataEffects.selfBoosts = ref.self.boosts;
      if (ref.flags?.heal) dataEffects.healing = true;
      if (ref.flags?.reflectable) dataEffects.reflectable = true;
      if (Object.keys(dataEffects).length) moveEffects[id] = dataEffects;
    }
    catalog[category][id] = {name: entry.j, reference: true, calculatorEntry: !!calc.Generations.get(0)[category].get(id),
      hooks, ...(ref.status ? {status: ref.status} : {}), ...(ref.volatileStatus ? {volatile: ref.volatileStatus} : {}),
      ...(ref.sideCondition ? {sideCondition: ref.sideCondition} : {}), ...(ref.megaStone ? {megaStone: ref.megaStone} : {}),
      engineReferences, ...(Object.keys(dataEffects).length ? {dataEffects} : {})};
  }
}
const report = {date: new Date().toISOString().slice(0, 10),
  note: '全件の参照定義・計算機登録・アプリの参照箇所の照合。engineReferencesは文字列照合であり対応保証ではない。全組み合わせの実機検証を意味しない。未対応の効果はMECHANICS_AUDIT.mdを参照。',
  sources, counts: Object.fromEntries(Object.entries(catalog).map(([k,v]) => [k, Object.keys(v).length])), catalog};
fs.mkdirSync(new URL('audit/', root), {recursive: true});
fs.writeFileSync(new URL('audit/mechanics-catalog.json', root), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(new URL('src/generated/move-effects.json', root), JSON.stringify(moveEffects, null, 2) + '\n');
console.log(JSON.stringify(report.counts));
