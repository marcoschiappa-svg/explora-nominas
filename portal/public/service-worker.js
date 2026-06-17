const CACHE_NAME = 'explora-portal-v1';

const ASSETS = [
  '/',
  '/index.html',
  '/logo.png',
  '/planta_bg.jpg',
];

// Instalación — cachea los assets estáticos principales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activación — elimina caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network first, cache como fallback
self.addEventListener('fetch', event => {
  // Solo interceptar peticiones GET al mismo origen
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Si la red responde bien, actualizar cache y devolver
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // Sin red: devolver desde cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Si no hay cache, devolver index.html (SPA fallback)
          return caches.match('/index.html');
        });
      })
  );
});
