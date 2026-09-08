/* eslint-disable no-restricted-globals */
// Service worker: precache the app shell (list generated into sw-manifest.js by tools/gen-sw-manifest.mjs),
// cache-first for same-origin assets, network-first for navigations with a cached index.html fallback.
importScripts('./sw-manifest.js');

const VERSION = (typeof self.__VERSION === 'string' && self.__VERSION) || 'dev';
const PRECACHE = Array.isArray(self.__PRECACHE) ? self.__PRECACHE : [];
const CACHE_PREFIX = 'sda-';
const CACHE = CACHE_PREFIX + VERSION;
const SCOPE = self.registration.scope;
const INDEX_URL = new URL('./index.html', SCOPE).href;
const MATCH_OPTS = { ignoreSearch: true };

function resolve(rel) {
  return new URL(rel, SCOPE).href;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fetch and store each file individually (opencv.js is ~10 MB): one failure must not abort the install.
    const results = await Promise.allSettled(PRECACHE.map(async (rel) => {
      const url = resolve(rel);
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '?'} ${url}`);
      await cache.put(url, res);
    }));
    let failed = 0;
    results.forEach((r, i) => { if (r.status === 'rejected') { failed++; console.warn('[sw] precache failed:', PRECACHE[i], r.reason && r.reason.message); } });
    console.log(`[sw] ${CACHE}: precached ${PRECACHE.length - failed}/${PRECACHE.length}`);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function putIfOk(request, response) {
  try {
    if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
  } catch (e) { /* storage full or opaque response: ignore */ }
}

async function handleNavigate(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const u = new URL(request.url);
      const isIndex = u.href === INDEX_URL || u.href.split('?')[0].split('#')[0] === SCOPE || u.pathname.endsWith('/');
      await putIfOk(isIndex ? INDEX_URL : request.url, res);
    }
    return res;
  } catch (e) {
    const exact = await caches.match(request, MATCH_OPTS);
    if (exact) return exact;
    const index = await caches.match(INDEX_URL, MATCH_OPTS);
    if (index) return index;
    return new Response('<!doctype html><meta charset="utf-8"><title>Офлайн</title><p style="font:18px sans-serif;padding:24px">Нет сети и нет сохранённой копии приложения. Откройте приложение при подключении к сети.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function handleAsset(request) {
  const cached = await caches.match(request, MATCH_OPTS);
  if (cached) return cached;
  const res = await fetch(request);
  await putIfOk(request, res);
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { event.respondWith(handleNavigate(req)); return; }
  event.respondWith(handleAsset(req));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
