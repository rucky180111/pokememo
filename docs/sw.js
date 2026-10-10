// オフラインでも開けるようにアプリ本体をキャッシュする。
// 取得できたら新しいものに差し替え、できなければキャッシュを使う (stale-while-revalidate)。
const CACHE = 'pokememo-547daba9d3';
const SHELL = ['./', './index.html', './app.js?v=547daba9d3', './app.css?v=547daba9d3', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './usage-single.json', './usage-double.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pokememo-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API などは素通し
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, {ignoreSearch: req.mode === 'navigate'});
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (req.mode === 'navigate') return (await fresh) || cached || (await cache.match('./index.html')) || Response.error();
    return cached || (await fresh) || Response.error();
  })());
});
