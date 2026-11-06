// Inscrição deste aparelho nos avisos com o app fechado e envio da agenda ao servidor.
import { SYNC_URL } from './sync.js';
import { buildSchedule, normalizePushSettings } from './push-core.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function post(path, payload, token) {
  let response;
  try {
    response = await fetch(`${SYNC_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 404 && body.error === 'Não encontrado.') {
    throw new Error('O servidor ainda não foi atualizado para os avisos com o app fechado.');
  }
  if (!response.ok) throw new Error(body.error || 'O servidor não respondeu como esperado.');
  return body;
}

const fromB64url = (text) => {
  const base = text.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base + '='.repeat((4 - (base.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export const fetchPushState = (token) => post('/push/state', {}, token);

/** Pede permissão, inscreve este aparelho e registra a inscrição no servidor. */
export async function enablePush(token) {
  if (!pushSupported()) throw new Error('Este navegador não recebe avisos com o app fechado.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notificações bloqueadas. Libere nas configurações do navegador.');
  const { publicKey } = await fetchPushState(token);
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  // Uma inscrição feita com outra chave não funcionaria com este servidor.
  const key = subscription?.options?.applicationServerKey;
  if (subscription && key && btoa(String.fromCharCode(...new Uint8Array(key))) !== btoa(String.fromCharCode(...fromB64url(publicKey)))) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) });
  }
  const result = await post('/push/subscribe', { endpoint: subscription.endpoint }, token);
  return { endpoint: subscription.endpoint, devices: result.devices };
}

export async function disablePush(token) {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => {});
  if (token) await post('/push/unsubscribe', { endpoint }, token).catch(() => {});
}

export const savePushSettings = (token, settings) => post('/push/settings', normalizePushSettings(settings), token);
export const sendPushTest = (token) => post('/push/test', {}, token);

/**
 * Envia a agenda se ela mudou desde o último envio deste aparelho.
 * hooks: tasks(), local() e saveLocal(record) com { settings, hash }.
 */
export async function uploadSchedule(token, hooks, force = false) {
  const local = hooks.local();
  const items = buildSchedule(hooks.tasks(), new Date(), local.settings);
  const hash = JSON.stringify([local.settings, items]);
  if (!force && hash === local.hash) return false;
  const result = await post('/push/schedule', { items }, token);
  const settings = normalizePushSettings(result.settings);
  if (JSON.stringify(settings) !== JSON.stringify(normalizePushSettings(local.settings))) {
    // Outro aparelho mudou o resumo ou a insistência: refaz a agenda com os valores do servidor.
    await hooks.saveLocal({ ...local, settings, hash: null, devices: result.devices });
    return uploadSchedule(token, hooks, true);
  }
  await hooks.saveLocal({ ...local, settings, hash, devices: result.devices });
  return true;
}
