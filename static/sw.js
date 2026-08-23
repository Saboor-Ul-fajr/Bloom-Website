self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : 'You have a Bloom reminder.' };
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Bloom reminder', {
    body: data.body || 'You have a task reminder.',
    requireInteraction: true,
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
