// 設定: 同期・使用率データ・バックアップ
import {useRef, useState} from 'preact/hooks';
import {dex} from '../engine/dex.js';
import {refreshUsage, DEFAULT_SOURCES} from '../usage.js';
import {useApp, Seg, Confirm, cx} from './common.jsx';

export function SettingsScreen() {
  const {store, syncer, toast} = useApp();
  const st = store.state.settings;
  const sync = st.sync;
  const [token, setToken] = useState(sync.token);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef(null);
  const sources = st.usageSources || DEFAULT_SOURCES;

  const saveToken = async () => {
    const t = token.trim();
    await store.saveSettings({sync: {...sync, token: t, gistId: t === sync.token ? sync.gistId : '', lastError: ''}});
    if (!t) { toast('同期を解除しました (この端末のデータは残ります)'); return; }
    setBusy('sync');
    const r = await syncer.run();
    setBusy('');
    toast(r ? `同期しました (取り込み ${r.pulled}件)` : `同期に失敗: ${store.state.settings.sync.lastError}`);
  };
  const syncNow = async () => {
    setBusy('sync');
    const r = await syncer.run();
    setBusy('');
    toast(r ? `同期しました (取り込み ${r.pulled}件・送信 ${r.pushed}ファイル)` : `同期に失敗: ${store.state.settings.sync.lastError}`);
  };
  const doRefresh = async () => {
    setBusy('usage');
    try {
      const r = await refreshUsage(store, sources);
      toast(`使用率を更新しました (${r.month || '月不明'}: ${r.done.join('、')})`);
    } catch (e) { toast(`更新に失敗: ${e.message}`); }
    setBusy('');
  };
  const doExport = () => {
    const blob = new Blob([JSON.stringify(store.exportAll())], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pokememo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const doImport = async e => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    try {
      const n = await store.importAll(JSON.parse(await f.text()));
      toast(`${n}件を読み込みました`);
    } catch (err) { toast(`読み込めませんでした: ${err.message}`); }
    e.currentTarget.value = '';
  };
  const usage = store.state.usage;
  return (
    <div class="page">
      <div class="page-head"><h1>設定</h1></div>

      <section class="box">
        <h4>よく使うルール</h4>
        <Seg value={st.format} options={[['single', 'シングル'], ['double', 'ダブル']]} onChange={v => store.saveSettings({format: v})} />
      </section>

      <section class="box">
        <h4>端末間の同期 (GitHub)</h4>
        <p class="hint">自分の GitHub アカウントの非公開 Gist に、構築と対戦記録を保存します。スマホ・iPad・PC で同じトークンを入れると、同じデータが使えます。</p>
        <ol class="steps">
          <li>GitHub の Settings → Developer settings → Personal access tokens → <b>Tokens (classic)</b> で新しいトークンを作る</li>
          <li>権限 (scope) は <b>gist</b> だけにチェックを入れる</li>
          <li>できたトークン (ghp_ で始まる文字列) を下に貼り付けて「保存して同期」</li>
          <li>ほかの端末でも同じトークンを入れる</li>
        </ol>
        <label class="field"><span>GitHub トークン (この端末のブラウザにだけ保存され、同期データには含まれません)</span>
          <input class="input" type="password" autocomplete="off" value={token} onInput={e => setToken(e.currentTarget.value)} placeholder="ghp_..." />
        </label>
        <div class="btnrow">
          <button class="btn primary" disabled={busy === 'sync'} onClick={saveToken}>{token.trim() ? '保存して同期' : '同期を解除'}</button>
          {sync.token && <button class="btn" disabled={busy === 'sync'} onClick={syncNow}>{busy === 'sync' ? '同期中…' : '今すぐ同期'}</button>}
        </div>
        {sync.token && <>
          <label class="check pad-s"><input type="checkbox" checked={sync.auto} onChange={e => store.saveSettings({sync: {...sync, auto: e.currentTarget.checked}})} />変更があったら自動で同期する</label>
          <p class={cx('hint', sync.lastError && 'bad')}>
            {sync.lastError ? `前回の同期でエラー: ${sync.lastError}` : sync.lastSync ? `最後の同期: ${new Date(sync.lastSync).toLocaleString('ja-JP')}` : 'まだ同期していません'}
            {sync.gistId && <> / 保存先 Gist ID: <code>{sync.gistId}</code></>}
          </p>
        </>}
        <p class="hint">同じ対戦を2台で同時に編集した場合は、あとから保存したほうが残ります。</p>
      </section>

      <section class="box">
        <h4>使用率データ</h4>
        <p class="hint">いまのデータ: シングル {usage.single ? `${usage.single.month} (${Object.keys(usage.single.pokemon).length}体)` : 'なし'} / ダブル {usage.double ? `${usage.double.month} (${Object.keys(usage.double.pokemon).length}体)` : 'なし'}。Pokémon Showdown の月次集計 (pkmn/smogon 経由) から取得します。合計で約8MB の通信が発生します。</p>
        <div class="form">
          <label class="field grow"><span>シングルの集計名</span><input class="input" value={sources.single} onChange={e => store.saveSettings({usageSources: {...sources, single: e.currentTarget.value.trim()}})} /></label>
          <label class="field grow"><span>ダブルの集計名</span><input class="input" value={sources.double} onChange={e => store.saveSettings({usageSources: {...sources, double: e.currentTarget.value.trim()}})} /></label>
        </div>
        <button class="btn" disabled={busy === 'usage'} onClick={doRefresh}>{busy === 'usage' ? '取得中…' : '最新の使用率に更新'}</button>
      </section>

      <section class="box">
        <h4>バックアップ</h4>
        <p class="hint">構築と対戦記録を1つのファイルに書き出します。読み込みは、同じ記録なら新しいほうを残します。</p>
        <div class="btnrow">
          <button class="btn" onClick={doExport}>ファイルに書き出す</button>
          <button class="btn" onClick={() => fileRef.current?.click()}>ファイルから読み込む</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
        </div>
      </section>

      <section class="box">
        <h4>このアプリについて</h4>
        <p class="hint">
          ポケモンチャンピオンズ向けの対戦メモ・ダメージ計算ツールです (非公式のファンメイド)。
          ダメージ計算は @smogon/calc {dex.calcVersion} のチャンピオンズ用実装、図鑑データは同ライブラリと Pokémon Showdown、日本語名は PokéAPI を元にしています (データ作成日 {dex.built})。
          収録: ポケモン {Object.keys(dex.species).length}・技 {Object.keys(dex.moves).length}・持ち物 {Object.keys(dex.items).length}・特性 {Object.keys(dex.abilities).length}。
        </p>
        <p class="hint">能力値: HP = 種族値 + 75 + 能力ポイント / それ以外 = (種族値 + 20 + 能力ポイント) × 性格補正。能力ポイントは1か所最大32・合計66。</p>
        <p class="hint">ポケモン・Pokémon は任天堂・クリーチャーズ・ゲームフリークの登録商標です。</p>
        <button class="btn danger" onClick={() => setConfirm(true)}>この端末のデータをすべて消す</button>
      </section>
      {confirm && <Confirm title="この端末のデータを消す" message="この端末に保存されている構築・対戦記録・設定をすべて消します。同期先 (Gist) のデータは消えません。" okLabel="消す" danger
        onOk={async () => { await store.wipe(); location.hash = '#/battles'; location.reload(); }} onClose={() => setConfirm(false)} />}
    </div>
  );
}
