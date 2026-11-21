// Service worker: aplikacja działa offline, ale zawsze najpierw próbuje pobrać świeże pliki z sieci.
// Po każdej zmianie plików aplikacji podnieś numer wersji (i APP_VERSION w app.js).
const CACHE = 'fiszki-v9';
const FILES = ['./', 'index.html', 'styles.css', 'srs.js', 'conj.js', 'app.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(FILES.map(f => fetch(f, { cache: 'no-cache' }).then(r => r.ok && c.put(f, r)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Zawsze z sieci z pominięciem pamięci podręcznej przeglądarki; kopia tylko gdy brak internetu.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok && !url.pathname.endsWith('.json')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
