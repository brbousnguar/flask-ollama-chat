const CACHE_NAME = 'ai-chat-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/static/style.css',
  '/static/app.js',
  '/static/manifest.json',
  '/static/icons/icon-192.svg',
  '/static/icons/icon-512.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // For API/chat streaming endpoints prefer network-first
  if (url.pathname.startsWith('/chat') || url.pathname.startsWith('/api')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  // For navigation and static assets try cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      try { if (event.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
      }} catch(e){}
      return res;
    }).catch(() => caches.match('/')))
  );
});