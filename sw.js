// Service Worker for Survival Game PWA

const CACHE_NAME = 'survival-game-v8-weather-wolves';
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
  './js/components/save.js',
  './js/components/player.js',
  './js/components/ui.js',
  './js/components/inventory.js',
  './js/components/animals.js',
  './js/components/combat.js',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  // Babylon.js core libraries
  'https://cdn.babylonjs.com/babylon.js'
];

// Install event - cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching assets...');
        return cache.addAll(ASSETS);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache.startsWith('survival-game-') && cache !== CACHE_NAME) {
            console.log('Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version if available
        if (response) {
          return response;
        }

        // Otherwise fetch from network
        return fetch(event.request)
          .then(networkResponse => {
            // Don't cache cross-origin requests
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Clone the response - one to return, one to cache
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          });
      })
      .catch(error => {
        console.log('Fetch failed:', error);
        // Could return a custom offline page here
      })
  );
});
