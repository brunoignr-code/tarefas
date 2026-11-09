// Mantém o app disponível offline, mostra os avisos enviados pelo servidor e trata os botões das notificações.
const CACHE = 'tarefas-v9';
const SYNC_URL = 'https://tarefas-sync.brunoignr-code.workers.dev';
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
  'js/push-core.js',
  'js/push.js',
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
      if (id) windows[0].postMessage({ type: 'notification-action', action, id });
      return windows[0].focus();
    }
    return self.clients.openWindow(id ? `./#notif/${action}/${id}` : './#today');
  })());
});

/* ---------- Avisos com o app fechado ---------- */
// O push chega sem conteúdo. O aviso vem de /push/due; sem internet, das tarefas guardadas aqui.

const SHOWN_MAX = 300;

function openDb() {
  return new Promise((resolve, reject) => {
    // Mesma versão e mesmas tabelas de js/db.js, para não criar um banco vazio.
    const request = indexedDB.open('tarefas', 1);
    request.onupgradeneeded = () => {
      ['lists', 'tasks', 'log', 'meta'].forEach((name) => request.result.createObjectStore(name, { keyPath: 'id' }));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const idb = (database, name, mode, work) => new Promise((resolve, reject) => {
  const request = work(database.transaction(name, mode).objectStore(name));
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const pad = (n) => String(n).padStart(2, '0');
const localDateTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Igual a alreadyNotified em js/push-core.js: o app aberto já avisou deste lembrete?
function alreadyNotified(task, key) {
  if (!task) return false;
  const [, time, rawStep] = key.split('|');
  const step = Number(rawStep) || 0;
  if (task.status !== 'open' || task.deletedAt) return true;
  if (task.ackedAt && task.ackedAt >= time) return true;
  const [markTime, markStep] = (task.notifiedFor || '').split('#');
  return markTime === time && (Number(markStep) || 0) >= step;
}

// Sem internet: lembretes que venceram nos últimos 15 minutos, pelas tarefas deste aparelho.
function localDue(tasks, now) {
  const from = localDateTime(new Date(now.getTime() - 15 * 60000));
  const to = localDateTime(now);
  return tasks.filter((task) => task.status === 'open' && !task.deletedAt).flatMap((task) => {
    const time = [task.remindAt, ...(task.extraReminders || []), task.snoozedUntil]
      .filter((t) => t && t >= from && t <= to).sort().pop();
    return time ? [{ key: `${task.id}|${time}|0`, taskId: task.id, kind: 'remind', title: task.title, body: `Lembrete das ${time.slice(11)}` }] : [];
  });
}

function notify(item, quiet) {
  const options = {
    body: item.body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: item.taskId || item.kind,
    renotify: !quiet && item.kind === 'insist',
    silent: !!quiet,
    data: { id: item.taskId || null },
  };
  if (item.taskId) {
    options.actions = [{ action: 'done', title: 'Concluir' }, { action: 'snooze', title: 'Adiar 10 min' }];
  }
  return self.registration.showNotification(item.title, options);
}

async function onPush() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = windows.some((client) => client.visibilityState === 'visible');
  windows.forEach((client) => client.postMessage({ type: 'push-arrived' }));

  let database = null;
  try { database = await openDb(); } catch { /* Segue só com o servidor. */ }
  const tasks = database ? await idb(database, 'tasks', 'readonly', (s) => s.getAll()).catch(() => []) : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const record = database ? await idb(database, 'meta', 'readonly', (s) => s.get('pushShown')).catch(() => null) : null;
  const shown = new Set((record && record.keys) || []);

  let items = null;
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    const response = await fetch(`${SYNC_URL}/push/due`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription && subscription.endpoint }),
    });
    if (response.ok) items = (await response.json()).items;
  } catch { /* Sem internet: usa as tarefas guardadas. */ }
  if (!items) items = localDue(tasks, new Date());

  // Com o app na tela, ele mesmo mostra os lembretes; o resumo e o teste aparecem sempre.
  const fresh = items.filter((item) => !shown.has(item.key)
    && !(item.taskId && (visible || alreadyNotified(byId.get(item.taskId), item.key))));
  // Um aviso por tarefa: o mais recente.
  const latest = new Map();
  fresh.forEach((item) => latest.set(item.taskId || item.key, item));
  await Promise.all([...latest.values()].map((item) => notify(item, false)));

  if (fresh.length && database) {
    const keys = [...shown, ...fresh.map((item) => item.key)].slice(-SHOWN_MAX);
    await idb(database, 'meta', 'readwrite', (s) => s.put({ id: 'pushShown', keys })).catch(() => {});
  }
  if (!latest.size && !visible) {
    // O navegador exige um aviso a cada push. Repete em silêncio o último, ou um aviso genérico.
    const last = items[items.length - 1];
    await notify(last || { key: 'generic', kind: 'generic', title: 'Tarefas', body: 'Você tem um lembrete. Toque para abrir.' }, true);
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(onPush().catch((error) => {
    console.error(error);
    return self.registration.showNotification('Tarefas', { body: 'Você tem um lembrete. Toque para abrir.', icon: 'icons/icon-192.png', tag: 'generic' });
  }));
});
