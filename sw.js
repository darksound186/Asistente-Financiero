const CACHE_NAME = 'finanzas-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest'
];

// Instalación: Guardar recursos estáticos en caché
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activación: Limpieza de cachés antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Estrategia de peticiones
self.addEventListener('fetch', (event) => {
  const req = event.request;
  
  // Para APIs o peticiones HTTP no-GET, usar red directa
  if (req.method !== 'GET' || req.url.includes('google') || req.url.includes('api')) {
    event.respondWith(fetch(req));
    return;
  }

  // Network First con respaldo en Caché para assets estáticos
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(req))
  );
});