/*
 * Service worker: guarda los archivos de la app en la caché del navegador
 * para que funcione sin conexión. Los datos del torneo NO van aquí: viven en localStorage.
 * Estrategia "primero la red": si hay conexión se sirve la versión más reciente
 * (y se actualiza la caché); si no, se usa la copia guardada.
 */
const CACHE = 'torneos-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/tournament.js',
  './js/app.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('torneos-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
  );
});
