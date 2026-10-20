// オフラインでも開けるようにアプリ本体をキャッシュする。
// 取得できたら新しいものに差し替え、できなければキャッシュを使う (stale-while-revalidate)。
const CACHE = 'pokememo-24d40b64be';
const SHELL = ['./', './index.html', './app.js?v=24d40b64be', './app.css?v=24d40b64be', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './usage-single.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pokememo-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 通信が止まったまま返ってこないと起動が進まないので、待つ時間に上限を付ける
const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API などは素通し
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const nav = req.mode === 'navigate';
    // いまの版のキャッシュ → 古い版のキャッシュ の順に探す
    const cached = (await cache.match(req, {ignoreSearch: nav})) || (await caches.match(req, {ignoreSearch: nav}));
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
    if (nav) {
      // 画面: 最新を 3 秒だけ待ち、だめならキャッシュで開く (最新は裏で取り込まれ、次に開いたときに使われる)
      const fallback = cached || (await caches.match('./index.html'));
      return (await within(fresh, fallback ? 3000 : 20000)) || fallback || (await fresh) || Response.error();
    }
    return cached || (await within(fresh, 20000)) || Response.error();
  })());
});
