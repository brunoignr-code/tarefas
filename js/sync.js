// Conversa com o servidor: envia o que mudou aqui e recebe o que mudou nos outros aparelhos.
import { changedSince, merge, toWire } from './sync-core.js';

export const SYNC_URL = 'https://tarefas-sync.brunoignr-code.workers.dev';
const BATCH = 25;
const MAX_ROUNDS = 40;
const KINDS = ['tasks', 'lists', 'log'];

export async function claimKey(key) {
  const response = await fetch(`${SYNC_URL}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  throw new Error(body.error || 'Não foi possível criar a chave.');
}

/**
 * hooks: state (coleções em memória), config() e saveConfig() com { key, since, tombstones },
 * put(kind, record), remove(kind, id), onStatus(), onRemoteChange().
 */
export function createSync(hooks) {
  const status = { state: 'idle', message: '', at: null };
  let running = false;
  let again = false;
  let timer;

  const setStatus = (state, message = '') => {
    status.state = state;
    status.message = message;
    if (state === 'ok') status.at = new Date();
    hooks.onStatus();
  };

  async function round(config) {
    const records = [];
    const sent = [];
    KINDS.forEach((kind) => {
      hooks.state[kind].filter((item) => item._dirty).forEach((item) => {
        if (records.length < BATCH) {
          records.push({ kind, id: item.id, data: toWire(item) });
          sent.push({ kind, id: item.id, times: { ...item._t } });
        }
      });
    });
    const deletes = (config.tombstones || []).slice(0, BATCH);

    const response = await fetch(`${SYNC_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ since: config.since || 0, records, deletes }),
    });
    if (response.status === 401) throw Object.assign(new Error('Chave recusada pelo servidor.'), { fatal: true });
    if (!response.ok) throw new Error('O servidor não respondeu como esperado.');
    const body = await response.json();

    let changed = false;
    for (const item of body.records) {
      const list = hooks.state[item.kind];
      const index = list.findIndex((record) => record.id === item.id);
      if (item.deleted) {
        if (index >= 0) {
          list.splice(index, 1);
          await hooks.remove(item.kind, item.id);
          changed = true;
        }
      } else {
        const local = index >= 0 ? list[index] : null;
        const merged = merge(local, item.data);
        merged.id = item.id;
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
          if (index >= 0) list[index] = merged; else list.push(merged);
          await hooks.put(item.kind, merged);
          changed = true;
        }
      }
    }
    for (const entry of sent) {
      const list = hooks.state[entry.kind];
      const index = list.findIndex((record) => record.id === entry.id);
      if (index >= 0 && !changedSince(list[index], entry.times) && list[index]._dirty) {
        list[index] = { ...list[index], _dirty: false };
        await hooks.put(entry.kind, list[index]);
      }
    }
    config.tombstones = (config.tombstones || []).slice(deletes.length);
    config.since = body.since;
    await hooks.saveConfig(config);
    if (changed) hooks.onRemoteChange();

    const pending = KINDS.some((kind) => hooks.state[kind].some((item) => item._dirty));
    return body.more || pending || config.tombstones.length > 0;
  }

  async function run() {
    const config = hooks.config();
    if (!config?.key) return;
    if (running) {
      again = true;
      return;
    }
    if (!navigator.onLine) {
      setStatus('offline', 'Sem internet. As mudanças serão enviadas quando a conexão voltar.');
      return;
    }
    running = true;
    setStatus('running');
    try {
      let rounds = 0;
      while (await round(config)) {
        rounds += 1;
        if (rounds >= MAX_ROUNDS) throw new Error('A sincronização não terminou. Tente de novo.');
      }
      setStatus('ok');
    } catch (error) {
      setStatus('error', error.fatal ? error.message : (navigator.onLine ? error.message : 'Sem internet.'));
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }

  function schedule(delay = 1500) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  return { run, schedule, status };
}
