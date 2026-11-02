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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request) });
    const { pathname } = new URL(request.url);
    try {
      if (request.method !== 'POST') return reply(request, { error: 'Não encontrado.' }, 404);
      if (pathname === '/register') return await register(request, env);
      if (pathname === '/login') return await login(request, env);
      const routes = { '/sync': (r, e) => sync(r, e), '/logout': logout, '/password': changePassword };
      if (!routes[pathname]) return reply(request, { error: 'Não encontrado.' }, 404);
      const current = await sessionHash(request, env);
      if (!current) return reply(request, { error: 'Sessão encerrada.' }, 401);
      return await routes[pathname](request, env, current);
    } catch (error) {
      console.error(error);
      return reply(request, { error: 'Erro no servidor.' }, 500);
    }
  },
};
