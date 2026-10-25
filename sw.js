// Versioned PWA cache. Core game assets are required; remote Babylon is
// optional at install time but cached when available to support offline play.
const CACHE_NAME = 'survival-game-v10-installable-offline';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './js/main.js',
  './js/game.js',
  './js/utils.js',
  './js/resources.js',
  './js/models/wilderness.js',
  './js/components/terrain.js',
  './js/components/exploration.js',
  './js/components/building.js',
  './js/components/survival.js',
  './js/components/weather.js',
  './js/components/touch.js',
  './js/components/save.js',
  './js/components/player.js',
  './js/components/ui.js',
  './js/components/inventory.js',
  './js/components/animals.js',
  './js/components/combat.js',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];
const REMOTE_ENGINE = 'https://cdn.babylonjs.com/babylon.js';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Fail install only when a core local asset is actually unavailable.
    await cache.addAll(ASSETS);
    // The engine is cross-origin, so a temporary CDN failure must not block
    // local PWA updates. It will also be cached during normal online play.
    try { await cache.add(REMOTE_ENGINE); }
    catch (error) { console.info('Babylon engine will cache on next online load', error); }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('survival-game-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const local = url.origin === self.location.origin;
  const engine = request.url === REMOTE_ENGINE;
  // External font/CDN resources other than our engine are handled by browser.
  if (!local && !engine) return;

  event.respondWith((async () => {
    const saved = await caches.match(request);
    if (saved) return saved;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        // Store a clone for next time; never cache opaque failed requests.
        const cache = await caches.open(CACHE_NAME);
        event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      }
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
