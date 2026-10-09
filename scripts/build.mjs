// アプリをビルドして docs/ に出力する (GitHub Pages は docs/ をそのまま配信する)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs');
fs.mkdirSync(out, {recursive: true});

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'main.jsx')],
  bundle: true, minify: true, format: 'iife', target: ['es2020', 'safari15'],
  jsx: 'automatic', jsxImportSource: 'preact',
  outfile: path.join(out, 'app.js'), legalComments: 'none', metafile: true,
  define: {'process.env.NODE_ENV': '"production"'},
  logLevel: 'warning',
});
const css = await esbuild.build({entryPoints: [path.join(root, 'src', 'styles.css')], bundle: true, minify: true, outfile: path.join(out, 'app.css'), logLevel: 'warning'});
void css;

const hash = crypto.createHash('sha1');
for (const f of ['app.js', 'app.css', 'usage-single.json', 'usage-double.json']) hash.update(fs.readFileSync(path.join(out, f)));
const version = hash.digest('hex').slice(0, 10);
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg']) {
  const text = fs.readFileSync(path.join(root, 'static', f), 'utf8').replaceAll('__VERSION__', version);
  fs.writeFileSync(path.join(out, f), text);
}
for (const f of fs.readdirSync(path.join(root, 'static'))) if (f.endsWith('.png')) fs.copyFileSync(path.join(root, 'static', f), path.join(out, f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
const size = f => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + 'KB';
console.log(`built ${version}: app.js ${size('app.js')}, app.css ${size('app.css')}`);
void result;
