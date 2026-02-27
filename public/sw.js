const CACHE_NAME = 'rent-collection-v5-fresh';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/manifest-tenant.webmanifest'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing v5-fresh - clearing all old caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log('[SW] Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      return caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v5-fresh - claiming all clients');
  event.waitUntil(
    caches.keys().then((keys) => {
      console.log('[SW] Found caches:', keys);
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] All old caches deleted, claiming clients');
      return self.clients.claim();
    }).then(() => {
      // Notify all clients to refresh
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          console.log('[SW] Notifying client to refresh');
          client.postMessage({ type: 'SW_UPDATED', version: 'v5-fresh' });
        });
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // NEVER cache Netlify Functions, Firebase, or any API calls
  if (url.pathname.startsWith('/.netlify/functions/') || 
      url.pathname.startsWith('/api/') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('cloudfunctions.net')) {
    console.log('[SW] Bypassing cache for API call:', url.pathname);
    return; // Let browser handle it directly, no caching
  }

  if (request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          return caches.match('/index.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          const isCacheable = request.destination === 'script' ||
            request.destination === 'style' ||
            request.destination === 'image' ||
            request.destination === 'font' ||
            request.destination === 'document';

          if (isCacheable) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }

          return networkResponse;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
