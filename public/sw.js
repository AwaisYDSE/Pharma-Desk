// Offline app shell: the app opens with no internet and no server. Data lives in IndexedDB.
const CACHE = 'pharmadesk-v2';
const SHELL = ['./', './index.html', './app.js', './app.css', './manifest.webmanifest', './favicon.png', './icon-192.png', './brand/logo-full.png', './brand/logo-mark.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.includes('/api/') || u.pathname.includes('/local/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (u.origin === location.origin || u.host.includes('fonts.g'))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
