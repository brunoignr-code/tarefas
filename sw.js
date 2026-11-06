// Mantém o app disponível offline e trata os botões das notificações.
const CACHE = 'tarefas-v7';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/rules.js',
  'js/parse.js',
  'js/theme.js',
  'js/sync-core.js',
  'js/sync.js',
  'fonts/bitter.woff2',
  'fonts/manrope.woff2',
  'fonts/nunito.woff2',
  'fonts/figtree.woff2',
  'fonts/bricolage.woff2',
  'icons/barco.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// 'reload' ignora o cache HTTP do navegador, que poderia guardar uma versão antiga.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Responde na hora com o que está salvo e atualiza em segundo plano.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/tests/')) return;
  // A chave ignora a busca do endereço, para não guardar textos compartilhados no cache.
  const key = url.origin + url.pathname;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    const network = fetch(key, { cache: 'no-cache' }).then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  const action = event.action || 'open';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) {
      windows[0].postMessage({ type: 'notification-action', action, id });
      return windows[0].focus();
    }
    return self.clients.openWindow(`./#notif/${action}/${id}`);
  })());
});
