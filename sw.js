// Service Worker for Survival Game PWA

const CACHE_NAME = 'survival-game-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './js/main.js',
  './js/game.js',
  './js/utils.js',
  './js/components/terrain.js',
  './js/components/player.js',
  './js/components/ui.js',
  './js/components/inventory.js',
  './js/components/animals.js',
  './js/components/combat.js',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  // Babylon.js core libraries
  'https://cdn.babylonjs.com/babylon.js',
  'https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js',
  'https://cdn.babylonjs.com/proceduralTextures/babylonjs.proceduralTextures.min.js',
  'https://cdn.babylonjs.com/serializers/babylonjs.serializers.min.js',
  'https://cdn.babylonjs.com/gui/babylon.gui.min.js',
  // Physics engine
  'https://cdn.babylonjs.com/cannon.js',
  // SimplexNoise library for terrain generation
  'https://cdnjs.cloudflare.com/ajax/libs/simplex-noise/2.4.0/simplex-noise.min.js'
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
          if (cache !== CACHE_NAME) {
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
