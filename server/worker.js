// Servidor de sincronização: guarda registros e entrega só o que mudou para cada aparelho.
const ORIGINS = new Set([
  'https://brunoignr-code.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);
const KINDS = new Set(['tasks', 'lists', 'log']);
const MAX_BATCH = 25;
const MAX_RECORD = 64 * 1024;
const PAGE = 300;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

function headers(request) {
  const origin = request.headers.get('Origin');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(ORIGINS.has(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      Vary: 'Origin',
    } : {}),
  };
}

const reply = (request, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(request) });

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const readMeta = async (env, key) => {
  const value = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first('value');
  return value ? JSON.parse(value) : null;
};
const writeMeta = (env, key, value) =>
  env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value));

const randomHex = (size) => [...crypto.getRandomValues(new Uint8Array(size))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

// A senha nunca chega aqui: o aparelho envia uma prova derivada dela com PBKDF2.
const validLogin = (login) => typeof login === 'string' && login.length >= 3 && login.length <= 100;
const validProof = (proof) => typeof proof === 'string' && /^[0-9a-f]{64}$/.test(proof);

async function newSession(env) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, created_at) VALUES (?, ?)')
    .bind(await sha256(token), Date.now()).run();
  return token;
}

async function sessionHash(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').bind(hash).first();
  return row ? hash : null;
}

const hashProof = (salt, proof) => sha256(`${salt}:${proof}`);

async function register(request, env) {
  const { login, proof } = await request.json();
  if (!validLogin(login) || !validProof(proof)) return reply(request, { error: 'Dados inválidos.' }, 400);
  const salt = randomHex(16);
  const account = JSON.stringify({ login, salt, hash: await hashProof(salt, proof) });
  const result = await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('account', ?)").bind(account).run();
  if (!result.meta.changes) return reply(request, { error: 'Já existe uma conta. Use Entrar.' }, 409);
  return reply(request, { token: await newSession(env) });
}

async function login(request, env) {
  const body = await request.json();
  if (!validLogin(body.login) || !validProof(body.proof)) return reply(request, { error: 'Login ou senha incorretos.' }, 401);
  const lock = (await readMeta(env, 'lock')) || { fails: 0, until: 0 };
  if (lock.until > Date.now()) {
    return reply(request, { error: `Muitas tentativas. Aguarde ${Math.ceil((lock.until - Date.now()) / 60000)} min.` }, 429);
  }
  const account = await readMeta(env, 'account');
  const correct = account && account.login === body.login && (await hashProof(account.salt, body.proof)) === account.hash;
  if (!correct) {
    const fails = lock.fails + 1;
    await writeMeta(env, 'lock', { fails: fails >= MAX_FAILS ? 0 : fails, until: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 }).run();
    return reply(request, { error: 'Login ou senha incorretos.' }, 401);
  }
  await writeMeta(env, 'lock', { fails: 0, until: 0 }).run();
  return reply(request, { token: await newSession(env) });
}

async function logout(request, env, current) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(current).run();
  return reply(request, { ok: true });
}

// Trocar a senha encerra a sessão de todos os outros aparelhos.
async function changePassword(request, env, current) {
  const { proof, newProof } = await request.json();
  if (!validProof(proof) || !validProof(newProof)) return reply(request, { error: 'Dados inválidos.' }, 400);
  const account = await readMeta(env, 'account');
  if ((await hashProof(account.salt, proof)) !== account.hash) return reply(request, { error: 'Senha atual incorreta.' }, 403);
  const salt = randomHex(16);
  await env.DB.batch([
    writeMeta(env, 'account', { login: account.login, salt, hash: await hashProof(salt, newProof) }),
    env.DB.prepare('DELETE FROM sessions WHERE token_hash <> ?').bind(current),
  ]);
  return reply(request, { ok: true });
}

// A edição mais recente de cada campo vence.
function merge(current, incoming) {
  const result = { ...current, _t: { ...(current._t || {}) } };
  for (const [field, time] of Object.entries(incoming._t || {})) {
    if (time > (result._t[field] || 0)) {
      result._t[field] = time;
      if (field in incoming) result[field] = incoming[field];
      else delete result[field];
    }
  }
  return result;
}

const validItem = (item) => KINDS.has(item?.kind) && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100;

async function sync(request, env) {
  const body = await request.json();
  const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
  const records = Array.isArray(body.records) ? body.records : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  if (records.length > MAX_BATCH || deletes.length > MAX_BATCH) return reply(request, { error: 'Lote grande demais.' }, 413);
  if (![...records, ...deletes].every(validItem)) return reply(request, { error: 'Registro inválido.' }, 400);
  if (records.some((r) => JSON.stringify(r.data ?? {}).length > MAX_RECORD)) return reply(request, { error: 'Registro grande demais.' }, 413);

  const writes = [];
  if (records.length) {
    const found = await env.DB.batch(records.map((r) =>
      env.DB.prepare('SELECT data, deleted FROM items WHERE kind = ? AND id = ?').bind(r.kind, r.id)));
    records.forEach((record, index) => {
      const row = found[index].results[0];
      if (row?.deleted) return;
      const merged = merge(row ? JSON.parse(row.data) : {}, record.data);
      writes.push(env.DB.prepare(`INSERT INTO items (kind, id, data, deleted, seq)
        VALUES (?, ?, ?, 0, (SELECT seq FROM counter))
        ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, seq = excluded.seq WHERE items.deleted = 0`)
        .bind(record.kind, record.id, JSON.stringify(merged)));
    });
  }
  deletes.forEach((item) => {
    writes.push(env.DB.prepare(`INSERT INTO items (kind, id, data, deleted, seq)
      VALUES (?, ?, '{}', 1, (SELECT seq FROM counter))
      ON CONFLICT (kind, id) DO UPDATE SET data = '{}', deleted = 1, seq = excluded.seq`)
      .bind(item.kind, item.id));
  });
  if (writes.length) {
    // Tudo na mesma transação: nenhum aparelho vê um número de sequência pela metade.
    await env.DB.batch([env.DB.prepare('UPDATE counter SET seq = seq + 1'), ...writes]);
  }

  const { results } = await env.DB.prepare('SELECT kind, id, data, deleted, seq FROM items WHERE seq > ? ORDER BY seq LIMIT ?')
    .bind(since, PAGE + 1).all();
  const more = results.length > PAGE;
  let rows = results.slice(0, PAGE);
  if (more) {
    // Uma sequência nunca é dividida entre páginas.
    const last = rows[rows.length - 1].seq;
    const whole = rows.filter((row) => row.seq < last);
    if (whole.length) rows = whole;
  }
  return reply(request, {
    since: rows.length ? rows[rows.length - 1].seq : since,
    more,
    records: rows.map((row) => ({
      kind: row.kind, id: row.id, deleted: !!row.deleted, data: row.deleted ? null : JSON.parse(row.data),
    })),
  });
}

/* ---------- Avisos com o app fechado (Web Push) ---------- */
// O push vai sem conteúdo: não há criptografia por mensagem, só a assinatura VAPID, que fica guardada
// por 12 horas. Ao receber, o aparelho busca em /push/due o que mostrar. Assim o envio gasta quase
// nada dos 10 ms de CPU do plano gratuito.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];
const MAX_SCHEDULE = 250;
const DUE_WINDOW_MS = 15 * 60000;
const STALE_MS = 6 * 3600000;
const JWT_HOURS = 12;
const PUSH_SUBJECT = 'https://brunoignr-code.github.io/tarefas/';
const PUSH_KINDS = new Set(['remind', 'insist', 'digest', 'test']);
const DEFAULT_PUSH_SETTINGS = { digest: false, digestTime: '08:00', insistMinutes: 5 };

let tablesReady;
const ensureTables = (env) => {
  tablesReady ||= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_queue (key TEXT PRIMARY KEY, at INTEGER NOT NULL, sent_at INTEGER,
      task_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS push_queue_due ON push_queue (sent_at, at)'),
  ]).catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
};

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (value) => b64url(new TextEncoder().encode(value));

function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

function normalizePushSettings(input) {
  const settings = { ...DEFAULT_PUSH_SETTINGS, ...(input || {}) };
  return {
    digest: !!settings.digest,
    digestTime: /^\d{2}:\d{2}$/.test(settings.digestTime) ? settings.digestTime : DEFAULT_PUSH_SETTINGS.digestTime,
    insistMinutes: [5, 10, 15, 30].includes(Number(settings.insistMinutes)) ? Number(settings.insistMinutes) : 5,
  };
}

/** Par de chaves VAPID, criado na primeira vez e guardado no banco. */
async function vapidKeys(env) {
  const saved = await readMeta(env, 'vapid');
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const created = {
    jwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    pub: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
  await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(created)).run();
  return readMeta(env, 'vapid');
}

const jwtCache = new Map();

async function vapidAuth(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  let cached = jwtCache.get(aud) || (await readMeta(env, `jwt:${aud}`));
  if (!cached || cached.exp - now < 3600) {
    const keys = await vapidKeys(env);
    const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const exp = now + JWT_HOURS * 3600;
    const unsigned = `${b64urlText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64urlText(JSON.stringify({ aud, exp, sub: PUSH_SUBJECT }))}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
    cached = { header: `vapid t=${unsigned}.${b64url(signature)}, k=${keys.pub}`, exp };
    await writeMeta(env, `jwt:${aud}`, cached).run();
  }
  jwtCache.set(aud, cached);
  return cached.header;
}

async function sendPushes(env) {
  const { results: subs } = await env.DB.prepare('SELECT id, endpoint FROM push_subs').all();
  await Promise.all(subs.map(async (sub) => {
    try {
      const response = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidAuth(env, sub.endpoint), TTL: '900', Urgency: 'high', 'Content-Length': '0' },
        body: '',
      });
      // O aparelho cancelou a inscrição ou reinstalou o app.
      if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id).run();
      } else if (!response.ok) {
        console.error('push', response.status, await response.text());
      }
    } catch (error) {
      console.error('push', error);
    }
  }));
}

/** Executado a cada minuto pelo Cron Trigger. */
async function runPushes(env) {
  await ensureTables(env);
  const now = Date.now();
  if (new Date(now).getUTCMinutes() === 0) {
    await env.DB.prepare('DELETE FROM push_queue WHERE sent_at < ? OR (sent_at IS NULL AND at < ?)')
      .bind(now - 86400000, now - STALE_MS).run();
  }
  // Marca antes de enviar: o aparelho que receber já encontra o aviso em /push/due.
  const marked = await env.DB.prepare('UPDATE push_queue SET sent_at = ? WHERE sent_at IS NULL AND at <= ? AND at >= ?')
    .bind(now, now, now - STALE_MS).run();
  if (marked.meta.changes) await sendPushes(env);
}

const subId = (endpoint) => sha256(endpoint);
const deviceCount = (env) => env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first('n');

async function pushState(request, env) {
  const [keys, settings, devices] = await Promise.all([vapidKeys(env), readMeta(env, 'pushSettings'), deviceCount(env)]);
  return reply(request, { publicKey: keys.pub, settings: normalizePushSettings(settings), devices });
}

async function pushSubscribe(request, env) {
  const { endpoint } = await request.json();
  if (!validEndpoint(endpoint)) return reply(request, { error: 'Inscrição inválida.' }, 400);
  await env.DB.prepare('INSERT INTO push_subs (id, endpoint, created_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING')
    .bind(await subId(endpoint), endpoint, Date.now()).run();
  return reply(request, { ok: true, devices: await deviceCount(env) });
}

async function pushUnsubscribe(request, env) {
  const { endpoint } = await request.json();
  if (typeof endpoint !== 'string') return reply(request, { error: 'Inscrição inválida.' }, 400);
  await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(await subId(endpoint)).run();
  return reply(request, { ok: true });
}

async function pushSettings(request, env) {
  const settings = normalizePushSettings(await request.json());
  await writeMeta(env, 'pushSettings', settings).run();
  return reply(request, { settings });
}

const clip = (value, max) => String(value ?? '').slice(0, max);

/** Substitui os avisos ainda não enviados. Os já enviados ficam, para não repetir. */
async function pushSchedule(request, env) {
  const body = await request.json();
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > MAX_SCHEDULE) return reply(request, { error: 'Agenda grande demais.' }, 413);
  const valid = items.every((item) => typeof item?.key === 'string' && item.key.length <= 200
    && Number.isFinite(item.at) && PUSH_KINDS.has(item.kind) && item.kind !== 'test');
  if (!valid) return reply(request, { error: 'Agenda inválida.' }, 400);
  const insert = env.DB.prepare('INSERT OR IGNORE INTO push_queue (key, at, task_id, kind, title, body) VALUES (?, ?, ?, ?, ?, ?)');
  await env.DB.batch([
    env.DB.prepare("DELETE FROM push_queue WHERE sent_at IS NULL AND kind <> 'test'"),
    ...items.map((item) => insert.bind(item.key, Math.round(item.at), item.taskId ? clip(item.taskId, 100) : null,
      item.kind, clip(item.title, 300), clip(item.body, 500))),
  ]);
  const [settings, devices] = await Promise.all([readMeta(env, 'pushSettings'), deviceCount(env)]);
  return reply(request, { ok: true, settings: normalizePushSettings(settings), devices });
}

/** Teste: um aviso daqui a 1 minuto, para dar tempo de fechar o app. */
async function pushTest(request, env) {
  const at = Date.now() + 60000;
  await env.DB.prepare('INSERT OR REPLACE INTO push_queue (key, at, task_id, kind, title, body) VALUES (?, ?, NULL, ?, ?, ?)')
    .bind(`test|${at}`, at, 'test', 'Teste com o app fechado', 'Se você está vendo isto, os lembretes chegam com o app fechado.').run();
  return reply(request, { ok: true, at });
}

/** Chamado pelo aparelho ao receber um push. A própria inscrição serve de credencial. */
async function pushDue(request, env) {
  const { endpoint } = await request.json();
  if (typeof endpoint !== 'string') return reply(request, { error: 'Inscrição inválida.' }, 400);
  const known = await env.DB.prepare('SELECT id FROM push_subs WHERE id = ?').bind(await subId(endpoint)).first();
  if (!known) return reply(request, { error: 'Inscrição desconhecida.' }, 404);
  const { results } = await env.DB.prepare(`SELECT key, at, task_id AS taskId, kind, title, body FROM push_queue
    WHERE sent_at >= ? ORDER BY at LIMIT 50`).bind(Date.now() - DUE_WINDOW_MS).all();
  return reply(request, { items: results });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request) });
    const { pathname } = new URL(request.url);
    try {
      if (request.method !== 'POST') return reply(request, { error: 'Não encontrado.' }, 404);
      if (pathname === '/register') return await register(request, env);
      if (pathname === '/login') return await login(request, env);
      if (pathname.startsWith('/push/')) await ensureTables(env);
      if (pathname === '/push/due') return await pushDue(request, env);
      const routes = {
        '/sync': (r, e) => sync(r, e),
        '/logout': logout,
        '/password': changePassword,
        '/push/state': pushState,
        '/push/subscribe': pushSubscribe,
        '/push/unsubscribe': pushUnsubscribe,
        '/push/settings': pushSettings,
        '/push/schedule': pushSchedule,
        '/push/test': pushTest,
      };
      if (!routes[pathname]) return reply(request, { error: 'Não encontrado.' }, 404);
      const current = await sessionHash(request, env);
      if (!current) return reply(request, { error: 'Sessão encerrada.' }, 401);
      return await routes[pathname](request, env, current);
    } catch (error) {
      console.error(error);
      return reply(request, { error: 'Erro no servidor.' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPushes(env).catch((error) => console.error('cron', error)));
  },
};
