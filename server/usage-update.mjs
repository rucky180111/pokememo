// ゲーム内バトルデータの使用率を取り込む: usage-scrape.mjs (サイトから取る部分) → usage-convert.mjs (アプリの形に変換) → DATA_DIR に保存
// 手動で実行: docker compose exec pokememo-sync node usage-update.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {convertUsage} from './usage-convert.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCRAPER = path.join(here, 'usage-scrape.mjs');
const SHOWDOWN = path.join(here, '..', 'docs', 'usage-single.json');

export async function updateUsage(dataDir) {
  if (!fs.existsSync(SCRAPER)) return {ok: false, reason: 'usage-scrape.mjs がありません'};
  const {scrape} = await import(`${pathToFileURL(SCRAPER).href}?t=${Date.now()}`);
  const src = await scrape(fetch);
  const sd = fs.existsSync(SHOWDOWN) ? JSON.parse(fs.readFileSync(SHOWDOWN, 'utf8')) : {pokemon: {}};
  const {usage, warnings} = convertUsage(src, sd);
  const n = Object.keys(usage.pokemon).length;
  if (n < 30) throw new Error(`取り込めたポケモンが少なすぎます (${n}体)。サイトの形が変わった可能性があります`);
  fs.mkdirSync(dataDir, {recursive: true});
  const tmp = path.join(dataDir, 'usage-single.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(usage));
  fs.renameSync(tmp, path.join(dataDir, 'usage-single.json'));
  const status = {ok: true, at: new Date().toISOString(), month: usage.month, source: usage.source, count: n, warnings};
  fs.writeFileSync(path.join(dataDir, 'usage-status.json'), JSON.stringify(status, null, 1));
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateUsage(process.env.DATA_DIR || '/data').then(s => console.log(JSON.stringify(s, null, 1)), e => { console.error(e); process.exit(1); });
}
