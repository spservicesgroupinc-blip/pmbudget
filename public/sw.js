// Hays + Sons — Restoration Document Suite
// Hand-rolled service worker: no build step, no dependencies.
//
// Strategy:
//   - App shell precached on install (offline launch).
//   - Navigations: network-first, falling back to the cached shell offline.
//   - Other same-origin GETs: cache-first, filling the cache on first miss.
//   - API calls and Vite dev/HMR traffic are never intercepted or cached.

// Bump this version string on every deploy to ship fresh assets.
const CACHE_NAME = 'hays-sons-shell-v1';

// Hashed build assets (e.g. /assets/index-*.js, *.css) are injected into the
// dist copy of this file at build time by scripts/inject-sw-precache.mjs, so a
// first visit precaches everything needed for a fully offline launch. When
// running via `npm run dev` this stays empty (Vite serves modules directly).
const BUILD_ASSETS = [];

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  ...BUILD_ASSETS,
];

// install: precache the app shell one URL at a time (Promise.allSettled) so a
// single missing asset cannot abort the whole install. Then activate the new
// worker immediately instead of waiting for all tabs to close.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))),
      )
      .then(() => self.skipWaiting()),
  );
});

// activate: delete caches from previous versions, then take control of any
// pages that are already open.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// fetch: routing rules are evaluated in the order shown below.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // --- Bypass rules: leave the request alone (no respondWith, no caching). ---
  if (request.method !== 'GET') return; // only GETs are cacheable
  if (url.origin !== self.location.origin) return; // cross-origin (APIs, fonts)
  if (url.pathname.startsWith('/api/')) return; // dynamic API responses
  // Vite dev-server internals: transformed modules, prebundled deps, HMR.
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }
  // Vite dev cache-busting (`?t=...`) and import markers (`?import`).
  if (url.searchParams.has('t') || url.searchParams.has('import')) return;

  // --- Navigations: network-first, cached shell when offline. ---
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Cache a copy of the fresh document on a real success.
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy))
              .catch(() => {});
          }
          return response;
        } catch (error) {
          // Offline: serve the cached page, else the cached SPA shell.
          const cached =
            (await caches.match(request)) || (await caches.match('/index.html'));
          if (cached) return cached;
          throw error; // nothing cached — let the browser report the failure
        }
      })(),
    );
    return;
  }

  // --- All other same-origin GETs: cache-first, fill the cache on a miss. ---
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      // Nothing cached: fetch it and store a good response for next time.
      // If the network fails here, the error is intentionally rethrown so
      // the browser handles it (there is nothing cached to fall back to).
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, copy))
          .catch(() => {});
      }
      return response;
    })(),
  );
});
