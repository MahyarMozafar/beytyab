// Service worker: after the first visit the book opens without internet.
//
// Big files that never change under the same name (the model, the engine,
// the poems, the fonts) are answered from the cache first.
// The page itself (HTML, CSS, JS) is answered from the cache too, but a
// fresh copy is fetched in the background for the next visit.

const VERSION = 'beytyab-v2'; // v2: smaller model (13,723 word pieces)
const HEAVY = /\/(models|data|fonts|js\/vendor)\//;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function fromCacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function fromCacheThenRefresh(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(HEAVY.test(url.pathname) ? fromCacheFirst(request) : fromCacheThenRefresh(request));
});
