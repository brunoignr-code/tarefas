// Regras de sincronização: a edição mais recente de cada campo vence. Sem rede nem banco.

// Cada aparelho decide sozinho se já avisou; marcas internas não viajam.
const LOCAL_FIELDS = new Set(['_t', '_dirty', 'notifiedFor']);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const syncedFields = (...records) => [...new Set(records.flatMap((r) => Object.keys(r || {})))]
  .filter((field) => !LOCAL_FIELDS.has(field));

/** Marca com a hora atual os campos que mudaram entre duas versões. */
export function stamp(prev, next, now) {
  const times = { ...(prev?._t || {}) };
  let changed = false;
  syncedFields(prev, next).forEach((field) => {
    if (!same(prev?.[field], next[field])) {
      times[field] = now;
      changed = true;
    }
  });
  return { ...next, _t: times, _dirty: changed || !!prev?._dirty };
}

/** Marca todos os campos, para enviar o registro inteiro. */
export function stampAll(record, now) {
  const times = {};
  syncedFields(record).forEach((field) => { times[field] = now; });
  return { ...record, _t: times, _dirty: true };
}

export function toWire(record) {
  const wire = { ...record };
  LOCAL_FIELDS.forEach((field) => { if (field !== '_t') delete wire[field]; });
  return wire;
}

/** Junta a versão do servidor à local, mantendo o que só existe neste aparelho. */
export function merge(local, remote) {
  const result = { ...(local || {}), _t: { ...(local?._t || {}) } };
  Object.entries(remote._t || {}).forEach(([field, time]) => {
    if (time > (result._t[field] || 0)) {
      result._t[field] = time;
      if (field in remote) result[field] = remote[field];
      else delete result[field];
    }
  });
  return result;
}

/** O registro mudou depois da versão enviada? */
export const changedSince = (record, sentTimes) =>
  Object.entries(record._t || {}).some(([field, time]) => time > (sentTimes[field] || 0));

export const normalizeLogin = (login) => (login || '').trim().toLocaleLowerCase('pt-BR');

/** Deriva a prova enviada ao servidor. A senha em si nunca sai do aparelho. */
export async function deriveProof(login, password) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: encoder.encode(`tarefas-sync:${normalizeLogin(login)}`),
    iterations: 600000,
  }, material, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
