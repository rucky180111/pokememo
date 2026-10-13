// ゲームの「チーム」画面のスクショから構築を作る (文字認識は端末の中で行う)
import {useState} from 'preact/hooks';
import {dex, speciesName, itemName, abilityName, moveName, statsOf} from '../engine/dex.js';
import {detectPanels, pageKind, cropCell, LAYOUT, assemble} from '../engine/shot.js';
import {newTeam, uid} from '../engine/battle.js';
import {useApp, Sheet, Sprite, TypeChip, cx} from './common.jsx';
import {MonEditor, buildSummary} from './teams.jsx';

// 文字認識のライブラリ (tesseract.js) は使うときだけ読み込む。ファイルはこのアプリと同じ場所に置いてある
let libP = null;
function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return (libP ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./ocr/tesseract.min.js', location.href).href;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { libP = null; reject(new Error('文字認識の部品を読み込めませんでした (通信状況を確認してください)')); };
    document.head.appendChild(s);
  }));
}
async function makeWorker(onStatus) {
  const T = await loadLib();
  const base = new URL('./ocr/', location.href).href;
  return T.createWorker('jpn', 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true,
    logger: m => { if (m.status && /load|init/i.test(m.status)) onStatus?.(m.progress != null && m.progress < 1 ? '文字認識の準備中 (初回のみ数MBの読み込み)…' : '文字認識の準備中…'); },
  });
}

async function fileToImage(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', {willReadFrequently: true});
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  return {data: d.data, width: d.width, height: d.height};
}
function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

/** 画像ファイル (1〜2枚) を読み取って、6体の候補を返す */
export async function readScreenshots(files, {usage, onStatus} = {}) {
  const pages = {};
  const prepared = [];
  for (const f of files) {
    onStatus?.(`画像を確認中: ${f.name || '画像'}`);
    const img = await fileToImage(f);
    const panels = detectPanels(img);
    if (panels.length !== 6) throw new Error('チーム画面の6体の枠を見つけられませんでした。ゲームの「チーム」→「能力」または「ステータス」の画面を、切り取らずにスクショしてください');
    const kind = pageKind(img, panels);
    if (!kind) throw new Error('「能力」と「ステータス」のどちらの画面か分かりませんでした。上のタブが写るようにスクショしてください');
    if (pages[kind]) throw new Error(`同じ画面 (${kind === 'status' ? 'ステータス' : '能力'}) が2枚あります。もう一方の画面のスクショを選んでください`);
    pages[kind] = [];
    prepared.push({img, panels, kind});
  }
  const total = prepared.reduce((n, p) => n + p.panels.length * LAYOUT[p.kind].length, 0);
  const worker = await makeWorker(onStatus);
  let done = 0;
  try {
    for (const {img, panels, kind} of prepared) {
      for (const p of panels) {
        const rec = {};
        for (const cell of LAYOUT[kind]) {
          const cr = cropCell(img, p, cell);
          done++;
          onStatus?.(`読み取り中 ${Math.round((done / total) * 100)}%`);
          if (!cr) { rec[cell.key] = ''; continue; }
          await worker.setParameters({tessedit_pageseg_mode: cell.digits ? '8' : '7', tessedit_char_whitelist: cell.digits ? '0123456789' : ''});
          const {data} = await worker.recognize(toCanvas(cr));
          rec[cell.key] = (data.text || '').trim();
        }
        pages[kind].push(rec);
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  return {kinds: Object.keys(pages), mons: assemble(pages, {usage})};
}

// ---- 画面 ----
export function ShotImport({onClose}) {
  const {store, nav, toast} = useApp();
  const usage = store.state.usage.single;
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [res, setRes] = useState(null); // {kinds, mons}
  const [name, setName] = useState(() => `スクショから追加 ${new Date().toLocaleDateString('ja-JP')}`);
  const [edit, setEdit] = useState(null);
  const run = async list => {
    setErr(''); setRes(null);
    if (!list.length) return;
    if (list.length > 2) { setErr('選べるのは2枚までです (「能力」と「ステータス」)'); return; }
    try {
      const r = await readScreenshots(list, {usage, onStatus: setStatus});
      setRes(r);
    } catch (e) { setErr(e?.message || String(e)); }
    setStatus('');
  };
  const save = async () => {
    const t = newTeam('single');
    t.id = uid(); t.name = name.trim() || '新しい構築';
    t.mons = res.mons.map(m => m.build).filter(b => b.species);
    await store.saveTeam(t);
    toast(`「${t.name}」を作りました`);
    onClose();
    nav(`#/team/${t.id}`);
  };
  const missing = res && !res.kinds.includes('status') ? 'ステータス' : res && !res.kinds.includes('ability') ? '能力' : '';
  return (
    <Sheet title="スクショから構築を追加" onClose={onClose} wide>
      <div class="editor shot">
        {!res && <>
          <p class="hint">ゲームの「チーム」画面で、<b>「能力」</b>と<b>「ステータス」</b>の2枚のスクショを選んでください。文字の読み取りはこの端末の中で行い、画像はどこにも送りません。</p>
          <label class={cx('btn primary shot-pick', status && 'disabled')}>
            {status ? '読み取り中…' : 'スクショを選ぶ (2枚)'}
            <input type="file" accept="image/*" multiple hidden disabled={!!status} onChange={e => { const l = [...(e.currentTarget.files || [])]; setFiles(l); e.currentTarget.value = ''; run(l); }} />
          </label>
          {status && <p class="shot-status"><span class="spin" />{status}</p>}
          {err && <p class="hint bad">{err}</p>}
          {!status && files.length > 0 && !err && <p class="hint">{files.length}枚を選びました</p>}
          <p class="hint">「ステータス」画面の実数値と能力ポイントからポケモンと性格を割り出し、「能力」画面から特性・持ち物・技を読み取ります。ニックネームを付けていても大丈夫です。</p>
        </>}
        {res && <>
          {missing && <p class="hint warn-line">「{missing}」画面のスクショが無いため、{missing === 'ステータス' ? 'ポケモン・性格・能力ポイントは推測です' : '特性・持ち物・技は入っていません'}。保存したあとに編集できます。</p>}
          <p class="hint">読み取った内容を確認してください。<span class="guess-mark">?</span> の付いた項目は自信がないところです。タップすると直せます。</p>
          <div class="shot-list">
            {res.mons.map((m, i) => {
              const b = m.build, c = m.conf || {};
              const q = k => (c[k] === 'guess' ? <span class="guess-mark">?</span> : null);
              const st = b.species ? statsOf(b.species, b.sp, b.nature) : null;
              return (
                <button class={cx('shot-mon', m.warn.length && 'warn')} onClick={() => setEdit(i)}>
                  <span class="sm-head">
                    <span class="sm-no num">{i + 1}</span>
                    <Sprite id={b.species} size={40} />
                    <b>{b.species ? speciesName(b.species) : 'ポケモン不明'}</b>{q('species')}
                    <span class="types">{(dex.species[b.species]?.t || []).map(t => <TypeChip type={t} small />)}</span>
                  </span>
                  <span class="sm-row"><span class="muted">特性</span> {abilityName(b.ability)}{q('ability')} <span class="muted">持ち物</span> {itemName(b.item) || 'なし'}{q('item')}</span>
                  <span class="sm-row"><span class="muted">性格・能力ポイント</span> <span class="num">{buildSummary(b)}</span>{q('sp')}</span>
                  {st && <span class="sm-row num dim">{st.join('-')}</span>}
                  <span class="sm-row">{b.moves.map((mv, k) => <span class="chip sm">{moveName(mv)}{c.moves?.[k] === 'guess' ? <span class="guess-mark">?</span> : null}</span>)}{!b.moves.length && <span class="muted">技なし</span>}</span>
                  {m.warn.map(w => <span class="sm-warn">{w}</span>)}
                </button>
              );
            })}
          </div>
          <label class="field"><span>構築名</span><input class="input" value={name} onInput={e => setName(e.currentTarget.value)} /></label>
          <div class="btnrow">
            <button class="btn" onClick={() => { setRes(null); setFiles([]); }}>選び直す</button>
            <button class="btn primary" disabled={!res.mons.some(m => m.build.species)} onClick={save}>この内容で構築を作る</button>
          </div>
        </>}
      </div>
      {edit != null && res && (
        <MonEditor title={`${edit + 1}体目を直す`} usage={usage} build={res.mons[edit].build}
          onSave={bd => { setRes(r => ({...r, mons: r.mons.map((m, i) => (i === edit ? {build: bd, warn: [], conf: {}} : m))})); setEdit(null); }}
          onClose={() => setEdit(null)} />
      )}
    </Sheet>
  );
}
