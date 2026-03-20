// Hay Luz? Service Worker — v1.4
const CACHE = 'hayluz-v3';
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

  // Skip non-http schemes (chrome-extension, data:, blob:, etc.)
  if (!url.protocol.startsWith('http')) return;
  if (request.method !== 'GET') return;

  // API routes: network-only, never cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión', source: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Static assets: cache-first
  if (/\.(js|css|png|jpg|svg|ico|woff2?)(\?.*)?$/.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          // Only cache successful, non-opaque responses from known origins
          const cacheable = response.ok &&
            response.type !== 'opaque' &&
            (url.origin === self.location.origin ||
             url.hostname.endsWith('unpkg.com') ||
             url.hostname.endsWith('fonts.googleapis.com') ||
             url.hostname.endsWith('fonts.gstatic.com'));
          if (cacheable) {
            // Clone FIRST before the body is consumed by respondWith
            const toCache = response.clone();
            caches.open(CACHE).then(c => c.put(request, toCache)).catch(() => {});
          }
          return response;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // HTML navigation: network-first, fallback to cached shell
  e.respondWith(
    fetch(request).then(response => {
      if (response.ok && response.type !== 'opaque') {
        const toCache = response.clone();
        caches.open(CACHE).then(c => c.put(request, toCache)).catch(() => {});
      }
      return response;
    }).catch(() =>
      caches.match('/index.html').then(cached => cached ||
        new Response('<h1>Sin conexión</h1>', { headers: { 'Content-Type': 'text/html' } })
      )
    )
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
