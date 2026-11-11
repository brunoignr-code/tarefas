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

/* ---------- Conta Google: entrar com Google e backup no Google Drive ---------- */
// O ID do cliente OAuth é público (vai também no app). O segredo do cliente fica só no Worker,
// como variável secreta GOOGLE_CLIENT_SECRET, cadastrada à mão no painel da Cloudflare.
const GOOGLE_CLIENT_ID = '643498059820-hocjtrln1pfprt1naj3jmi6dk4chum6m.apps.googleusercontent.com';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const DRIVE_FOLDER = 'Minha lista de afazeres';
const DRIVE_KEEP = 30;
const DRIVE_HOUR = 3; // backup automático a partir das 3h, horário de Brasília
const TZ = 'America/Sao_Paulo';

const clientId = (env) => env.GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID;
const b64urlBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64urlJson = (text) => JSON.parse(new TextDecoder().decode(b64urlBytes(text)));

let googleKeys = { at: 0, keys: [] };
async function googleCerts() {
  if (Date.now() - googleKeys.at < 3600000 && googleKeys.keys.length) return googleKeys.keys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) throw new Error('Chaves do Google indisponíveis.');
  googleKeys = { at: Date.now(), keys: (await response.json()).keys || [] };
  return googleKeys.keys;
}

/** Confere a assinatura e os dados do token de login do Google. Devolve { sub, email } ou null. */
async function verifyGoogleToken(env, credential) {
  if (typeof credential !== 'string' || credential.length > 4096) return null;
  const parts = credential.split('.');
  if (parts.length !== 3) return null;
  let head;
  let claims;
  try {
    head = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (head.alg !== 'RS256') return null;
  const jwk = (await googleCerts()).find((key) => key.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || !GOOGLE_ISSUERS.has(claims.iss) || claims.aud !== clientId(env) || !(claims.exp > now) || !claims.sub) return null;
  if (claims.email && claims.email_verified === false) return null;
  return { sub: String(claims.sub), email: String(claims.email || '') };
}

/** Liga a conta Google à conta do app (o aparelho já está conectado). */
async function googleLink(request, env) {
  const { credential } = await request.json();
  const google = await verifyGoogleToken(env, credential);
  if (!google) return reply(request, { error: 'Não foi possível confirmar a conta Google.' }, 400);
  await writeMeta(env, 'google', { sub: google.sub, email: google.email, at: Date.now() }).run();
  return reply(request, { ok: true, email: google.email });
}

async function googleUnlink(request, env) {
  await env.DB.prepare("DELETE FROM meta WHERE key = 'google'").run();
  return reply(request, { ok: true });
}

/** Entrar com Google: só a conta Google ligada antes abre a sessão. */
async function googleLogin(request, env) {
  const { credential } = await request.json();
  const google = await verifyGoogleToken(env, credential);
  const linked = await readMeta(env, 'google');
  if (!google || !linked || linked.sub !== google.sub) {
    return reply(request, { error: 'Esta conta Google não está ligada ao app. Entre com login e senha e ligue em Config.' }, 401);
  }
  const account = await readMeta(env, 'account');
  return reply(request, { token: await newSession(env), login: account?.login || '', email: google.email });
}

/* Drive: o servidor guarda o "refresh token" e faz o backup sozinho, uma vez por dia. */

async function googleToken(env, params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(env), client_secret: env.GOOGLE_CLIENT_SECRET || '', ...params }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.error || 'O Google recusou a autorização.');
  return body;
}

let driveAccess = { token: '', until: 0 };
async function driveToken(env, drive) {
  if (driveAccess.token && driveAccess.until > Date.now() + 60000) return driveAccess.token;
  const body = await googleToken(env, { grant_type: 'refresh_token', refresh_token: drive.refresh });
  driveAccess = { token: body.access_token, until: Date.now() + (body.expires_in || 3600) * 1000 };
  return driveAccess.token;
}

async function driveFetch(env, drive, url, init = {}) {
  const token = await driveToken(env, drive);
  const response = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 204) {
    const text = await response.text().catch(() => '');
    throw new Error(`Drive respondeu ${response.status}. ${text.slice(0, 160)}`);
  }
  return response;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const query = (q, fields) => `${DRIVE_API}?${new URLSearchParams({ q, fields, orderBy: 'name desc', pageSize: '100', spaces: 'drive' })}`;

async function driveFolder(env, drive) {
  if (drive.folderId) {
    const check = await fetch(`${DRIVE_API}/${drive.folderId}?fields=id,trashed`, { headers: { Authorization: `Bearer ${await driveToken(env, drive)}` } });
    if (check.ok && !(await check.json()).trashed) return drive.folderId;
  }
  const found = await (await driveFetch(env, drive, query(`name = '${DRIVE_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, 'files(id)'))).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await driveFetch(env, drive, DRIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    });
    id = (await created.json()).id;
  }
  drive.folderId = id;
  return id;
}

const localDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const localHour = (date = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date));

/** Mesmo formato do "Exportar" do app, para o "Importar" e o "Restaurar" funcionarem igual. */
async function backupPayload(env) {
  const { results } = await env.DB.prepare('SELECT kind, id, data FROM items WHERE deleted = 0').all();
  const payload = { app: 'tarefas', version: 1, exportedAt: new Date().toISOString(), source: 'servidor', lists: [], tasks: [], log: [] };
  results.forEach((row) => {
    const { _t, ...data } = JSON.parse(row.data);
    if (payload[row.kind]) payload[row.kind].push({ ...data, id: row.id });
  });
  return payload;
}

/** Grava o backup do dia na pasta do app no Drive e apaga os mais antigos que os últimos 30. */
async function driveBackup(env) {
  const drive = await readMeta(env, 'drive');
  if (!drive?.refresh) throw new Error('Google Drive não conectado.');
  try {
    const folder = await driveFolder(env, drive);
    const payload = await backupPayload(env);
    const name = `afazeres-backup-${localDay()}.json`;
    const content = JSON.stringify(payload, null, 1);
    const existing = await (await driveFetch(env, drive, query(`name = '${name}' and '${folder}' in parents and trashed = false`, 'files(id)'))).json();
    const boundary = `b${randomHex(8)}`;
    const meta = existing.files?.[0]?.id ? { name } : { name, parents: [folder], mimeType: 'application/json' };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const url = existing.files?.[0]?.id ? `${DRIVE_UPLOAD}/${existing.files[0].id}?uploadType=multipart` : `${DRIVE_UPLOAD}?uploadType=multipart`;
    const saved = await (await driveFetch(env, drive, url, {
      method: existing.files?.[0]?.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })).json();
    const all = await (await driveFetch(env, drive, query(`'${folder}' in parents and trashed = false and name contains 'afazeres-backup-'`, 'files(id,name)'))).json();
    for (const old of (all.files || []).slice(DRIVE_KEEP)) {
      await driveFetch(env, drive, `${DRIVE_API}/${old.id}`, { method: 'DELETE' });
    }
    const counts = { tasks: payload.tasks.length, lists: payload.lists.length };
    await writeMeta(env, 'drive', { ...drive, lastBackup: Date.now(), lastDay: localDay(), lastError: '', lastFile: saved.id, counts }).run();
    return { id: saved.id, name, counts };
  } catch (error) {
    await writeMeta(env, 'drive', { ...drive, lastError: String(error.message || error).slice(0, 300), lastTry: Date.now(), lastTryDay: localDay() }).run();
    throw error;
  }
}

/** Chamado pelo cron: uma tentativa por dia, depois das 3h de Brasília. */
async function driveDaily(env) {
  const now = new Date();
  if (now.getUTCMinutes() % 15 !== 7 || localHour(now) < DRIVE_HOUR) return;
  const drive = await readMeta(env, 'drive');
  const today = localDay(now);
  if (!drive?.refresh || drive.lastDay === today || drive.lastTryDay === today) return;
  await driveBackup(env);
}

async function driveConnect(request, env) {
  const { code } = await request.json();
  if (typeof code !== 'string' || !code) return reply(request, { error: 'Autorização inválida.' }, 400);
  if (!env.GOOGLE_CLIENT_SECRET) return reply(request, { error: 'Falta cadastrar o segredo do Google no servidor (GOOGLE_CLIENT_SECRET).' }, 503);
  const body = await googleToken(env, { grant_type: 'authorization_code', code, redirect_uri: 'postmessage' });
  if (!body.refresh_token) return reply(request, { error: 'O Google não liberou o acesso contínuo. Desconecte o app em myaccount.google.com e tente de novo.' }, 400);
  let email = '';
  if (body.id_token) email = b64urlJson(body.id_token.split('.')[1]).email || '';
  driveAccess = { token: body.access_token, until: Date.now() + (body.expires_in || 3600) * 1000 };
  await writeMeta(env, 'drive', { refresh: body.refresh_token, email, connectedAt: Date.now() }).run();
  let first = null;
  try {
    first = await driveBackup(env);
  } catch (error) {
    return reply(request, { ok: true, email, error: `Conectado, mas o primeiro backup falhou: ${error.message}` });
  }
  return reply(request, { ok: true, email, backup: first });
}

async function driveDisconnect(request, env) {
  const drive = await readMeta(env, 'drive');
  if (drive?.refresh) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(drive.refresh)}`, { method: 'POST' }).catch(() => {});
  }
  driveAccess = { token: '', until: 0 };
  await env.DB.prepare("DELETE FROM meta WHERE key = 'drive'").run();
  return reply(request, { ok: true });
}

async function googleStatus(request, env) {
  const google = await readMeta(env, 'google');
  const drive = await readMeta(env, 'drive');
  return reply(request, {
    clientId: clientId(env),
    secretReady: !!env.GOOGLE_CLIENT_SECRET,
    google: google ? { email: google.email } : null,
    drive: drive?.refresh ? {
      email: drive.email, lastBackup: drive.lastBackup || null, lastError: drive.lastError || '', counts: drive.counts || null,
    } : null,
  });
}

async function driveBackupNow(request, env) {
  try {
    return reply(request, { ok: true, backup: await driveBackup(env) });
  } catch (error) {
    return reply(request, { error: String(error.message || error) }, 502);
  }
}

async function driveList(request, env) {
  const drive = await readMeta(env, 'drive');
  if (!drive?.refresh) return reply(request, { error: 'Google Drive não conectado.' }, 400);
  const folder = await driveFolder(env, drive);
  const list = await (await driveFetch(env, drive, query(`'${folder}' in parents and trashed = false and name contains 'afazeres-backup-'`, 'files(id,name,size,modifiedTime)'))).json();
  return reply(request, { files: list.files || [] });
}

async function driveFile(request, env) {
  const { id } = await request.json();
  if (typeof id !== 'string' || !/^[\w-]{10,200}$/.test(id)) return reply(request, { error: 'Arquivo inválido.' }, 400);
  const drive = await readMeta(env, 'drive');
  if (!drive?.refresh) return reply(request, { error: 'Google Drive não conectado.' }, 400);
  const response = await driveFetch(env, drive, `${DRIVE_API}/${id}?alt=media`);
  return reply(request, { data: await response.json() });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request) });
    const { pathname } = new URL(request.url);
    try {
      if (request.method !== 'POST') return reply(request, { error: 'Não encontrado.' }, 404);
      if (pathname === '/register') return await register(request, env);
      if (pathname === '/login') return await login(request, env);
      if (pathname === '/google/login') return await googleLogin(request, env);
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
        '/google/status': googleStatus,
        '/google/link': googleLink,
        '/google/unlink': googleUnlink,
        '/drive/connect': driveConnect,
        '/drive/backup': driveBackupNow,
        '/drive/list': driveList,
        '/drive/file': driveFile,
        '/drive/disconnect': driveDisconnect,
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
    ctx.waitUntil(driveDaily(env).catch((error) => console.error('drive', error)));
  },
};
