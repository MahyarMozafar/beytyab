// Service worker: after the first visit the book opens without internet.
//
// Big files that never change under the same name (the model, the engine,
// the poems, the fonts) are answered from the cache first.
// The page itself (HTML, CSS, JS) is small, so it is asked from the network
// first: every visitor gets one matching set of files. Only when the
// network does not answer in a few seconds (or there is none) the saved
// copy is used. Answering these files from the cache first, each one on
// its own, once gave a visitor today's page with yesterday's search
// thread, and a part of the page stayed empty.

const VERSION = 'beytyab-v4'; // v4: the big files are kept by js/worker.js, in parts
// Fonts and libraries: the same file under the same name for ever.
const HEAVY = /\/(fonts|js\/vendor)\//;
// The model, the engine and the poems are downloaded in parts by
// js/worker.js, which keeps them in its own cache ("beytyab-files-...").
// It marks those requests with ?v=..., and this file leaves them alone.
const KEPT_BY_WORKER = 'beytyab-files-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((n) => n !== VERSION && !n.startsWith(KEPT_BY_WORKER))
        .map((n) => caches.delete(n))))
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

const PATIENCE = 4000; // milliseconds to wait for the network

async function fromNetworkFirst(request) {
  const cache = await caches.open(VERSION);
  const fresh = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  const saved = await cache.match(request);
  if (!saved) return fresh; // first visit: there is nothing else to give
  const late = new Promise((resolve) => setTimeout(() => resolve(null), PATIENCE));
  const answer = await Promise.race([fresh.catch(() => null), late]);
  return answer && answer.ok ? answer : saved;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.searchParams.has('v')) return;
  event.respondWith(HEAVY.test(url.pathname) ? fromCacheFirst(request) : fromNetworkFirst(request));
});
