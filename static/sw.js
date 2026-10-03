const CACHE_NAME = 'bloom-shell-v16';
const SHELL_ASSETS = [
  '/static/css/style.css?v=prayer-stats-row2-20261004',
  '/static/js/app.js',
  '/static/js/local-store.js',
  '/static/js/prayer.js',
  '/static/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(response => response || caches.match('/dashboard'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  })));
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : 'You have a Bloom reminder.' };
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Bloom reminder', {
    body: data.body || 'You have a task reminder.',
    tag: data.tag,
    renotify: false,
    data: { url: data.url || '/tasks' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const target = new URL(event.notification.data?.url || '/tasks', self.location.origin).href;
    const existing = windows.find(window => window.url === target);
    if (existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
