import {useMemo, useRef, useState} from 'preact/hooks';
import {parseTeamCSV, TEAM_CSV_TEMPLATE} from '../engine/team-csv.js';
import {speciesName} from '../engine/dex.js';
import {teamWarnings} from './teams.jsx';
import {useApp, Sheet, Sprite} from './common.jsx';

export function TeamCSVImport({onClose}) {
  const {store, toast} = useApp();
  const [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef(null);
  const result = useMemo(() => text.trim() ? parseTeamCSV(text) : null, [text]);
  const load = async e => {
    const f = e.currentTarget.files?.[0]; e.currentTarget.value = '';
    if (!f) return;
    try {
      if (f.size > 1024 * 1024) throw new Error('1MB以下のCSVファイルを選んでください');
      const bytes = await f.arrayBuffer();
      let data = new TextDecoder('utf-8').decode(bytes);
      if (data.includes('\uFFFD')) data = new TextDecoder('shift_jis').decode(bytes);
      setText(data); setError('');
    } catch (e) { setError(e.message); }
  };
  const template = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + TEAM_CSV_TEMPLATE], {type: 'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'pokememo-party-template.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const save = async () => {
    if (busy || !result || result.errors.length) return;
    setBusy(true); setError('');
    try {
      for (const t of result.teams) { await store.saveTeam(t); if (store.state.saveError) throw new Error(store.state.saveError); }
      toast(`${result.teams.length}件の構築を追加しました`); onClose();
    } catch (e) { setError(`保存できませんでした: ${e.message}`); }
    finally { setBusy(false); }
  };
  return <Sheet title="CSVでパーティをまとめて追加" wide onClose={() => { if (!busy) onClose(); }}>
    <p>1行に1体、同じ構築名の行をまとめて1パーティ（最大6体）にします。構築名を変えると、複数のパーティを一度に追加できます。</p>
    <div class="btnrow">
      <button class="btn" disabled={busy} onClick={() => input.current.click()}>CSVファイルを選ぶ</button>
      <button class="btn ghost" disabled={busy} onClick={template}>テンプレートを保存</button>
      <button class="btn ghost" disabled={busy} onClick={() => {setText(TEAM_CSV_TEMPLATE); setError('');}}>入力例を表示</button>
    </div>
    <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden onChange={load} />
    <label class="field"><span>CSV・表計算のデータを貼り付け</span><textarea class="input" rows={7} aria-label="パーティCSV" value={text} disabled={busy} onInput={e => {setText(e.currentTarget.value); setError('');}} placeholder={'構築名,ポケモン\n自分の構築,ガブリアス\n自分の構築,カイリュー'} spellcheck={false} /></label>
    <p class="hint">日本語名・英語IDに対応。Excelなどのセルのコピーも使えます。「ポケモン」以外の列は省略できます。空欄は持ち物なし・通常の先頭の特性・性格補正なし・能力Pt 0・技未登録になります。H/A/B/C/D/Sは努力値ではなく能力Pt（各0〜32、合計66以下）です。構築名の空欄は直前の構築名を引き継ぎます。</p>
    {error && <p role="alert">{error}</p>}
    {result?.errors.length > 0 && <div role="alert"><b>{result.errors.length}件を修正してください（まだ追加されていません）</b><ul>{result.errors.slice(0, 30).map(e => <li>{e}</li>)}</ul></div>}
    {result && !result.errors.length && <>
      <h3>追加する構築：{result.teams.length}件</h3>
      <p class="hint">既存の構築は上書きせず、新しい構築として追加します。</p>
      {result.teams.map(t => <div class="box" key={t.id}><b>{t.name}（{t.mons.length}体）</b><div class="team-icons">{t.mons.map(m => <span class="ti-mon"><Sprite id={m.species} size={40}/><small>{speciesName(m.species)}</small></span>)}</div>{teamWarnings(t).map(w => <p class="hint">注意：{w}</p>)}</div>)}
    </>}
    <div class="btnrow"><button class="btn primary" disabled={busy || !result || !!result.errors.length} onClick={save}>{busy ? '追加中…' : `${result?.teams.length || 0}件の構築を追加`}</button></div>
  </Sheet>;
}
