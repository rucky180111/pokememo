// 設定画面: アカウント同期 (Firebase)
import {useEffect, useState} from 'preact/hooks';
import {useApp, cx} from './common.jsx';

export const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

export function CloudSettings() {
  const {store, cloud, toast} = useApp();
  const [st, setSt] = useState(() => cloud.status);
  useEffect(() => cloud.subscribe(setSt), [cloud]);
  const [cfgText, setCfgText] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const configured = !!store.state.settings.cloud?.config;
  const run = async (fn, okMsg) => {
    setBusy(true); setErr('');
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { setErr(e?.message || String(e)); }
    setBusy(false);
  };
  const copyRules = async () => { try { await navigator.clipboard.writeText(RULES); toast('ルールをコピーしました'); } catch { toast('コピーできませんでした。手で選択してコピーしてください'); } };
  return (
    <section class="box cloud">
      <h4>アカウント同期 (スマホ・iPad で同じデータ)</h4>
      {!configured && <>
        <p class="hint">自分専用の Firebase (Google の無料サービス) にデータを置いて、ログインした端末どうしでリアルタイムに同期します。最初に1回だけ準備が必要です。</p>
        <details class="cloud-steps">
          <summary>準備の手順 (はじめての人はここを開く)</summary>
          <ol class="steps">
            <li><a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase コンソール</a> を開き、Google アカウントでログインして「プロジェクトを作成」(名前は自由。Gemini・アナリティクスはオフで可)</li>
            <li>左のメニュー「構築」→「Authentication」→「始める」→「メール/パスワード」を有効にして保存</li>
            <li>「構築」→「Firestore Database」→「データベースを作成」(場所は asia-northeast1 (東京) がおすすめ、「本番環境モード」で開始)</li>
            <li>Firestore の「ルール」タブで、中身を下のルールに置き換えて「公開」 (自分のデータは自分しか読めない設定)
              <pre class="rules">{RULES}</pre>
              <button class="btn sm" onClick={copyRules}>ルールをコピー</button>
            </li>
            <li>プロジェクトの概要の横の歯車 →「プロジェクトの設定」→ 下の「マイアプリ」で <b>&lt;/&gt;</b> (ウェブ) を押してアプリを登録 (名前は自由。Hosting は不要)</li>
            <li>表示された <code>const firebaseConfig = {'{ ... }'}</code> の部分を丸ごとコピーして、下に貼り付けて「保存して接続」</li>
          </ol>
        </details>
        <label class="field"><span>firebaseConfig (貼り付け)</span>
          <textarea class="input" rows={5} value={cfgText} onInput={e => setCfgText(e.currentTarget.value)} placeholder={'const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  ...\n};'} />
        </label>
        <button class="btn primary" disabled={busy || !cfgText.trim()} onClick={() => run(() => cloud.configure(cfgText))}>保存して接続</button>
        <p class="hint">2台目の端末でも、同じ firebaseConfig を貼り付けてから同じメールアドレスでログインしてください。</p>
      </>}
      {configured && (st.state === 'signedout' || (st.state === 'connecting' && !st.user)) && <>
        <p class="hint">メールアドレスとパスワードでログインします。1台目は「新しく登録」、2台目以降は「ログイン」です (パスワードは Firebase が管理し、このアプリには保存しません)。</p>
        <div class="form">
          <label class="field grow"><span>メールアドレス</span><input class="input" type="email" autocomplete="username" value={email} onInput={e => setEmail(e.currentTarget.value)} /></label>
          <label class="field grow"><span>パスワード (6文字以上)</span><input class="input" type="password" autocomplete="current-password" value={pw} onInput={e => setPw(e.currentTarget.value)} /></label>
        </div>
        <div class="btnrow">
          <button class="btn primary" disabled={busy || !email || !pw} onClick={() => run(() => cloud.signIn(email.trim(), pw), 'ログインしました')}>ログイン</button>
          <button class="btn" disabled={busy || !email || !pw} onClick={() => run(() => cloud.signUp(email.trim(), pw), '登録してログインしました')}>新しく登録</button>
          <button class="btn ghost" disabled={busy || !email} onClick={() => run(() => cloud.reset(email.trim()), 'パスワード再設定のメールを送りました')}>パスワードを忘れた</button>
        </div>
      </>}
      {configured && st.user && <>
        <p><b>{st.user.email}</b> でログイン中 <span class={cx('tag', st.state === 'ok' ? 'good' : st.state === 'error' ? 'bad' : '')}>{st.state === 'ok' ? '同期済み' : st.state === 'error' ? 'エラー' : st.state === 'syncing' ? '送信中' : '接続中'}</span></p>
        {st.message && <p class={cx('hint', st.state === 'error' && 'bad')}>{st.message}</p>}
        <p class="hint">記録を変えると数秒で送信され、ログイン中のほかの端末にすぐ反映されます。</p>
        <div class="btnrow">
          <button class="btn" disabled={busy} onClick={() => run(() => cloud.flush(), '送信しました')}>今すぐ送る</button>
          <button class="btn ghost" disabled={busy} onClick={() => run(() => cloud.signOut(), 'ログアウトしました (この端末のデータは残ります)')}>ログアウト</button>
        </div>
      </>}
      {configured && st.state === 'error' && !st.user && <p class="hint bad">{st.message}</p>}
      {err && <p class="hint bad">{err}</p>}
      {configured && <details class="cloud-steps"><summary>Firebase の設定</summary>
        <p class="hint">プロジェクト: <code>{store.state.settings.cloud.config.projectId}</code></p>
        <button class="btn ghost sm" onClick={() => run(() => cloud.forget(), 'アカウント同期をやめました (この端末のデータは残ります)')}>設定をやり直す</button>
      </details>}
    </section>
  );
}
