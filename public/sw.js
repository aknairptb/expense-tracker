const CACHE_NAME = 'expenseflow-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through fetch to satisfy PWA requirements without aggressive caching yet
  event.respondWith(fetch(event.request));
});
