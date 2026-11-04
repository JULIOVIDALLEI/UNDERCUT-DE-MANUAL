// UND service worker — funciona sin conexión con los últimos datos descargados
const V = 'und-v14';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

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

  // Datos, página y código propio: primero red, si no hay conexión, caché
  if (url.pathname.includes('/data/') || req.mode === 'navigate' || (url.origin === location.origin && /\.(js|json|html|webmanifest)$/.test(url.pathname))) {
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

  // APIs de terceros (tiempo, avisos, cuentas): siempre en directo, sin guardar
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname)) return;

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
