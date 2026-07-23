/* Sequence PWA service worker: app-shell caching.
   Gameplay always needs the network (websockets are never intercepted). */
const CACHE = 'sequence-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/socket.io')) return; // realtime: never cache
  if (url.pathname.startsWith('/api')) return; // live data: never cache
  if (url.origin !== location.origin) return; // fonts etc. use browser cache

  // The page navigation: network-first with a short timeout so a flaky mobile
  // connection falls back to the cached shell instead of hanging.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      Promise.race([
        fetch(event.request).then((res) => {
          // only cache a genuine, same-origin OK HTML document
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        }),
        new Promise((resolve) =>
          setTimeout(() => resolve(caches.match('/').then((r) => r || fetch(event.request))), 3000),
        ),
      ]).catch(() => caches.match('/')),
    );
    return;
  }

  // Immutable hashed build assets: cache-first (safe — the filename changes on
  // every build). Everything else: stale-while-revalidate.
  const immutable = url.pathname.startsWith('/assets/');
  if (immutable) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((hit) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
