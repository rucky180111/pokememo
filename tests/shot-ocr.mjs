// スクショ読み取りの通し確認 (Node で実際に文字認識する)。node tests/shot-ocr.mjs [画像...]
import sharp from 'sharp';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorker} from 'tesseract.js';
import {detectPanels, pageKind, cropCell, LAYOUT, assemble} from '../src/engine/shot.js';
import {dex, statsOf} from '../src/engine/dex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['fixtures/team-status.png', 'fixtures/team-ability.png'].map(f => path.join(here, f));
const load = async f => { const {data, info} = await sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height}; };
const toPng = img => sharp(Buffer.from(img.data), {raw: {width: img.width, height: img.height, channels: 4}}).png().toBuffer();

const worker = await createWorker('jpn', 1, {langPath: path.join(here, '../node_modules/@tesseract.js-data/jpn/4.0.0_best_int'), gzip: true, cacheMethod: 'none'});
const t0 = Date.now();
const pages = {};
for (const f of files) {
  const img = await load(f);
  const panels = detectPanels(img);
  const kind = pageKind(img, panels);
  console.log(path.basename(f), 'パネル', panels.length, '画面', kind);
  if (!kind) continue;
  pages[kind] = [];
  for (const p of panels) {
    const rec = {};
    for (const cell of LAYOUT[kind]) {
      await worker.setParameters({tessedit_pageseg_mode: cell.digits ? '8' : '7', tessedit_char_whitelist: cell.digits ? '0123456789' : ''});
      const cr = cropCell(img, p, cell); if (!cr) { rec[cell.key] = ''; continue; } if (process.env.DUMP) await sharp(Buffer.from(cr.data), {raw: {width: cr.width, height: cr.height, channels: 4}}).png().toFile(`/tmp/claude-0/ocr/cell-${kind}-${pages[kind].length}-${cell.key}.png`); const {data} = await worker.recognize(await toPng(cr));
      rec[cell.key] = data.text.trim();
    }
    pages[kind].push(rec);
  }
}
await worker.terminate();
console.log('時間', Date.now() - t0, 'ms');
import fs from 'node:fs';
const usage = JSON.parse(fs.readFileSync(path.join(here, '../docs/usage-single.json'), 'utf8'));
const out = assemble(pages, {usage});
for (const [i, r] of out.entries()) {
  const b = r.build;
  console.log(i + 1, dex.species[b.species]?.j, dex.natures[b.nature]?.j, b.sp.join('/'), statsOf(b.species, b.sp, b.nature).join('/'), dex.abilities[b.ability]?.j, dex.items[b.item]?.j || '-', b.moves.map(m => dex.moves[m]?.j).join('・'), JSON.stringify(r.conf), r.warn.join(' '));
}
if (process.env.RAW) console.log(JSON.stringify(pages, null, 1));
export {};
// 正解 (fixtures/team-expected.json) との比較
if (!process.argv.slice(2).length) {
  const exp = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/team-expected.json'), 'utf8'));
  let ok = 0, all = 0;
  const bad = [];
  exp.forEach((e, i) => {
    const b = out[i].build;
    for (const k of ['species', 'item', 'ability', 'nature']) { all++; if (b[k] === e[k]) ok++; else bad.push(`${i + 1} ${k}: ${b[k]} (正解 ${e[k]})`); }
    all++; if (b.sp.join() === e.sp.join()) ok++; else bad.push(`${i + 1} sp: ${b.sp} (正解 ${e.sp})`);
    for (const m of e.moves) { all++; if (b.moves.includes(m)) ok++; else bad.push(`${i + 1} 技: ${m} が無い (${b.moves})`); }
  });
  console.log(`正解との一致 ${ok}/${all}`); if (bad.length) console.log(bad.join('\n'));
  process.exitCode = bad.length ? 1 : 0;
}
