// JUWEI WMS Mobile & Desktop Service Worker
const CACHE_VERSION = 'v7';
const CACHE_NAME = `juwei-wms-${CACHE_VERSION}`;
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/pwa-192.png',
  '/pwa-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
          return Promise.resolve();
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const upgradeHeader = (event.request.headers.get('upgrade') || '').toLowerCase();
  const url = new URL(event.request.url);

  // Never cache or intercept /api requests, WebSocket traffic, or dev modules
  if (
    upgradeHeader === 'websocket' ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/ws' ||
    url.pathname.startsWith('/ws/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.includes('.vite/') ||
    url.search.includes('v=') ||
    url.search.includes('t=') ||
    url.search.includes('import') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.tsx') ||
    url.pathname.endsWith('.jsx') ||
    url.pathname.endsWith('.map')
  ) {
    return;
  }

  // Network-first with cache fallback for HTML navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(event.request)
            .then((cached) => cached || caches.match('/index.html'))
            .then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  // Network-first for all other app files & static assets
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
