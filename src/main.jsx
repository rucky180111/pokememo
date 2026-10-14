import {render} from 'preact';
import {createStore, idbBackend, localStorageBackend, memoryBackend} from './store.js';
import {createSyncer} from './sync.js';
import {createCloud} from './cloud.js';
import {loadBundledUsage} from './usage.js';
import {App} from './ui/app.jsx';

async function pickBackend() {
  try {
    const b = idbBackend();
    await b.getAll();
    return b;
  } catch (e) {
    // IndexedDB が開けないときは、空のデータで始めない (記録が消えたように見えるため)。起動の見張りに原因を出す
    if (typeof indexedDB !== 'undefined') { window.__pmBootFail?.(`${e?.message || e}`); throw e; }
    try { localStorage.setItem('pokememo:probe', '1'); localStorage.removeItem('pokememo:probe'); return localStorageBackend(); }
    catch { return memoryBackend(); }
  }
}

async function boot() {
  if (window.__pmRescue) return; // 立て直しの画面を出している
  const safe = /[?&]safe\b/.test(location.search);
  const store = createStore(await pickBackend());
  const syncer = createSyncer(store);
  const cloud = createCloud(store);
  store.onLocalChange = (kind, rec) => { syncer.schedule(); cloud.changed(kind, rec); };
  try { render(<App store={store} syncer={syncer} cloud={cloud} />, document.getElementById('app')); }
  catch (e) { window.__pmBootFail?.(`画面の表示でエラー: ${e?.message || e}`); throw e; }
  await store.load();
  if (safe) { window.__pmSafe = true; return void (window.__pokememo = {store, syncer, cloud}); } // 同期を止めた起動
  if (store.state.settings.cloud?.config || store.state.settings.cloud?.provider === 'server') cloud.start();
  loadBundledUsage(store);
  if (store.state.settings.sync.token && store.state.settings.sync.auto) syncer.run();
  // 別の端末での変更を拾うため、画面に戻ってきたときにも同期する
  document.addEventListener('visibilitychange', () => {
    const s = store.state.settings.sync;
    if (document.visibilityState === 'visible' && s.token && s.auto && Date.now() - (s.lastSync || 0) > 60000) syncer.run();
    // 画面を離れるときは、まだ送っていない変更をすぐ送る
    if (document.visibilityState === 'hidden') cloud.flush();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  window.__pokememo = {store, syncer, cloud};
}
boot().catch(e => window.__pmBootFail?.(e?.message || String(e)));
