// icon.svg から PNG アイコンを作る (Playwright の Chromium を使用。アイコンを変えたときだけ実行)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'static', 'icon.svg'), 'utf8');
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({viewport: {width: size, height: size}});
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({path: path.join(root, 'static', `icon-${size}.png`)});
  await page.close();
}
await browser.close();
console.log('icons ok');
