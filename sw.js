// UND service worker — funciona sin conexión con los últimos datos descargados
const V = 'und-v5';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos y página: primero red, si no hay conexión, caché
  if (url.pathname.includes('/data/') || req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(V).then((c) => c.put(url.pathname.includes('/data/') ? url.origin + url.pathname : req, copy));
          return res;
        })
        .catch(() => caches.match(url.pathname.includes('/data/') ? url.origin + url.pathname : req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Resto (fuentes, iconos): caché primero
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(V).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
