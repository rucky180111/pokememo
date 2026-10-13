// アカウント同期の窓口: Firebase の部品の読み込み・ログイン状態・同期の開始と停止
import {createCloudSync, parseFirebaseConfig} from './cloud-sync.js';

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
  let conn = null, sync = null, unUser = null, lib = null;

  async function start() {
    stopAll();
    const cfg = store.state.settings.cloud?.config;
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
      await store.saveSettings({cloud: {...(store.state.settings.cloud || {}), config}});
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
