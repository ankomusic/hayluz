// Hay Luz? Service Worker — v1.3
const CACHE = 'hayluz-v2';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(url => c.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // ── Only handle http/https — skip chrome-extension, data:, etc.
  if (!url.protocol.startsWith('http')) return;
  if (request.method !== 'GET') return;

  // API: network only, offline fallback JSON
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión', source: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Static assets (css/js/svg/png/woff): cache-first
  if (/\.(js|css|png|jpg|svg|ico|woff2?)(\?.*)?$/.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then(hit => {
        if (hit) return hit;
        return fetch(request).then(res => {
          // Only cache same-origin or known CDNs
          if (res.ok && (url.origin === self.location.origin || url.hostname.endsWith('unpkg.com') || url.hostname.endsWith('fonts.googleapis.com'))) {
            caches.open(CACHE).then(c => c.put(request, res.clone()));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML pages: network-first, fallback to shell
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match('/index.html'))
  );
});

self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const { title, body } = e.data.json();
    e.waitUntil(self.registration.showNotification(title || 'Hay Luz?', {
      body: body || 'Alerta de fluctuación',
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      vibrate: [200, 100, 200],
      data: { url: '/' }
    }));
  } catch {}
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
