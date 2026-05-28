// ZeloChat service worker
// Two jobs: (1) make the app installable as a PWA, (2) receive Web Push.
// Intentionally minimal — no offline caching of HTML/JS so deploys ship
// instantly. Static assets fall through to the browser HTTP cache.

const SW_VERSION = 'zelochat-sw-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Web Push — payload shape produced by server/push.ts
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'ZeloChat', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Nova mensagem no ZeloChat';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/favicon-96.png',
    tag: data.tag || 'zelochat-message',
    renotify: true,
    data: { url: data.url || '/', sessionId: data.sessionId || null },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin) {
        client.focus();
        if ('navigate' in client && targetUrl !== '/') {
          try { await client.navigate(targetUrl); } catch { /* ignore */ }
        }
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

// Allow the page to force-update the SW
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// no-op fetch handler — required by some browsers to count as a PWA
self.addEventListener('fetch', () => { /* fall through to network */ });

self.SW_VERSION = SW_VERSION;
