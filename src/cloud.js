// アカウント同期の窓口: Firebase の部品の読み込み・ログイン状態・同期の開始と停止
import {createCloudSync, parseFirebaseConfig} from './cloud-sync.js';
import {serverAdapter, testServer} from './cloud-server.js';
import {fetchServerUsage} from './usage.js';

let libP = null;
function loadLib() {
  if (window.PokememoCloud) return Promise.resolve(window.PokememoCloud);
  return (libP ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(`./cloud.js?v=${window.__pmVersion || ''}`, location.href).href;
    s.onload = () => resolve(window.PokememoCloud);
    s.onerror = () => { libP = null; reject(new Error('同期の部品を読み込めませんでした (通信状況を確認してください)')); };
    document.head.appendChild(s);
  }));
}

export function createCloud(store) {
  const subs = new Set();
  const st = {state: 'off', user: null, message: '', last: 0};
  const emit = () => { for (const f of subs) f({...st}); };
  const set = patch => { Object.assign(st, patch); emit(); };
  let conn = null, sync = null, unUser = null, lib = null, usageTimer = null;

  async function start() {
    stopAll();
    const c = store.state.settings.cloud || {};
    // 自分のサーバー (ラズパイなど): ログインは無く、同期キーでつなぐ
    if (c.provider === 'server' && c.url && c.key) {
      set({state: 'connecting', user: {server: c.url}, message: ''});
      sync = createCloudSync(store, serverAdapter(c.url, c.key), {onStatus: s => set({state: s.state, message: s.message, last: s.last || st.last})});
      // ラズパイが取り込んだゲーム内の使用率があれば使う (起動時と6時間ごと)
      if (store.state.settings.usageFromServer !== false) {
        const pull = () => fetchServerUsage(store, c.url, c.key).catch(() => null);
        setTimeout(pull, 3000);
        usageTimer = setInterval(pull, 6 * 3600e3);
      }
      return;
    }
    const cfg = c.config;
    if (!cfg) { set({state: 'off', user: null, message: ''}); return; }
    set({state: 'connecting', message: ''});
    try {
      lib = await loadLib();
      conn = lib.connect(cfg);
    } catch (e) { set({state: 'error', message: e?.message || String(e)}); return; }
    unUser = conn.onUser(user => {
      sync?.stop(); sync = null;
      if (!user) { set({state: 'signedout', user: null, message: ''}); return; }
      set({state: 'connecting', user, message: ''});
      sync = createCloudSync(store, conn.adapter(user.uid), {onStatus: s => set({state: s.state, message: s.message, last: s.last || st.last})});
    });
  }
  function stopAll() {
    clearInterval(usageTimer); usageTimer = null;
    sync?.stop(); sync = null;
    try { unUser?.(); } catch { /* 無視 */ }
    unUser = null;
    conn?.close().catch(() => {}); conn = null;
  }
  const wrap = fn => async (...a) => { try { await fn(...a); } catch (e) { throw new Error(lib?.message ? lib.message(e) : e?.message || String(e)); } };
  return {
    get status() { return {...st}; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    start,
    /** 設定 (firebaseConfig の貼り付け) を保存して接続する */
    async configure(text) {
      const config = parseFirebaseConfig(text);
      await store.saveSettings({cloud: {provider: 'firebase', config}});
      await start();
    },
    /** 自分のサーバーの設定を確かめてから保存して接続する */
    async configureServer(url, key) {
      url = url.trim().replace(/\/+$/, '');
      if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) throw new Error('アドレスは https:// で始まるものを入れてください (Tailscale Funnel の URL)');
      await testServer(url, key.trim());
      await store.saveSettings({cloud: {provider: 'server', url, key: key.trim()}});
      await start();
    },
    async forget() {
      stopAll();
      await store.saveSettings({cloud: {}});
      set({state: 'off', user: null, message: ''});
    },
    signIn: wrap((email, pw) => conn.signIn(email, pw)),
    signUp: wrap((email, pw) => conn.signUp(email, pw)),
    reset: wrap(email => conn.reset(email)),
    signOut: wrap(() => conn.signOut()),
    changed(kind, rec) { sync?.changed(kind, rec); },
    flush() { return sync?.flush(); },
  };
}
