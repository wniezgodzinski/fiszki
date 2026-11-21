// Service worker: aplikacja działa offline; words.json zawsze najpierw z sieci.
// Po każdej zmianie plików aplikacji podnieś numer wersji, żeby telefony pobrały nową wersję.
const CACHE = 'fiszki-v5';
const FILES = ['./', 'index.html', 'styles.css', 'srs.js', 'app.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('words.json') || url.pathname.endsWith('config.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('words.json', { ignoreSearch: true })));
    return;
  }
  // Aplikacja: najpierw sieć (świeża wersja), w razie braku internetu – kopia
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
