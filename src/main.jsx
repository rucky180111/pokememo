import {render} from 'preact';
import {createStore, idbBackend, localStorageBackend, memoryBackend} from './store.js';
import {createSyncer} from './sync.js';
import {loadBundledUsage} from './usage.js';
import {App} from './ui/app.jsx';

async function pickBackend() {
  try {
    const b = idbBackend();
    await b.getAll();
    return b;
  } catch {
    try { localStorage.setItem('pokememo:probe', '1'); localStorage.removeItem('pokememo:probe'); return localStorageBackend(); }
    catch { return memoryBackend(); }
  }
}

async function boot() {
  const store = createStore(await pickBackend());
  const syncer = createSyncer(store);
  store.onLocalChange = () => syncer.schedule();
  render(<App store={store} syncer={syncer} />, document.getElementById('app'));
  await store.load();
  loadBundledUsage(store);
  if (store.state.settings.sync.token && store.state.settings.sync.auto) syncer.run();
  // 別の端末での変更を拾うため、画面に戻ってきたときにも同期する
  document.addEventListener('visibilitychange', () => {
    const s = store.state.settings.sync;
    if (document.visibilityState === 'visible' && s.token && s.auto && Date.now() - (s.lastSync || 0) > 60000) syncer.run();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  window.__pokememo = {store, syncer};
}
boot();
