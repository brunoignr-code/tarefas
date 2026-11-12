import * as db from './db.js';
import {
  applyEdit, completeTask, daysWaiting, addDays, dismissReminder, dueReminders, isOverdue,
  INSIST_MAX, activeReminder, firstOnWeekdays, insistStep, nextDate, localDate, localDateTime, notifyMark, shownReminder, skipOccurrence, snooze, snoozeTo,
  todayTasks, upcomingTasks,
} from './rules.js';
import { DEFAULT_PUSH_SETTINGS, normalizePushSettings, pushKey } from './push-core.js';
import {
  currentSubscription, disablePush, enablePush, fetchPushState, pushSupported, refreshSubscription, savePushSettings, sendPushTest, uploadSchedule,
} from './push.js';
import { parseQuickAdd } from './parse.js';
import {
  ACCENTS, CHROME, DEFAULT_ACCENT, DEFAULT_MODE, MODES, accentVars, normalizeAccent, normalizeMode, resolveMode,
} from './theme.js';
import { stamp, stampAll } from './sync-core.js';
import {
  SNOOZE_MINUTES, blockedByDeadline, dateChanges, editFields,
} from './actions-core.js';
import {
  authenticate, callServer, changePassword, createSync, endSession,
} from './sync.js';
import { googleReady, loadGoogle, renderGoogleButton, requestDriveCode } from './google.js';

const INBOX = 'inbox';
// Atualize junto com CACHE em sw.js a cada publicação.
const APP_NAME = 'Minha lista de afazeres';
const APP_VERSION = 'v25 · 12/11/2026';
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const FREQ_LABELS = {
  daily: ['Diária', 'dias'], weekly: ['Semanal', 'semanas'],
  monthly: ['Mensal', 'meses'], yearly: ['Anual', 'anos'],
};
// Opções do Repetir. "Quinzenal" é semanal a cada 2 semanas (no banco: weekly, interval 2).
// "Dias da semana" é semanal toda semana nos dias marcados (no banco: weekly, interval 1, weekdays).
// Dias da semana vem por último: na grade de botões ele estica até o fim da linha (v25).
const FREQ_OPTIONS = [['daily', 'Diária'], ['weekly', 'Semanal'], ['biweekly', 'Quinzenal'], ['monthly', 'Mensal'], ['yearly', 'Anual'], ['days', 'Dias da semana']];
const WEEKLY_CHOICES = ['weekly', 'days', 'biweekly'];
const isBiweekly = (repeat) => repeat?.freq === 'weekly' && Number(repeat.interval) === 2;
/** Botão do Repetir que corresponde à repetição salva. */
function repeatChoice(repeat) {
  if (!repeat?.freq) return '';
  if (isBiweekly(repeat)) return 'biweekly';
  if (repeat.freq === 'weekly' && Number(repeat.interval || 1) === 1 && (repeat.weekdays || []).length > 1) return 'days';
  return repeat.freq;
}
const WEEKDAY_GROUPS = { '1,2,3,4,5': 'dias úteis', '0,6': 'fins de semana', '0,1,2,3,4,5,6': 'todos os dias' };

const state = { quick: {}, lists: [], tasks: [], log: [], settings: { id: 'settings', mode: DEFAULT_MODE, accent: DEFAULT_ACCENT }, search: '', selecting: false, selected: new Set(), doneOpen: new Set() };
const $ = (selector, root = document) => root.querySelector(selector);
const today = () => localDate();
const newId = () => crypto.randomUUID();

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function formatDate(date) {
  if (date === today()) return 'Hoje';
  if (date === addDays(today(), 1)) return 'Amanhã';
  if (date === addDays(today(), -1)) return 'Ontem';
  const [y, m, d] = date.split('-');
  const name = WEEKDAYS[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()].toLowerCase();
  return `${name}, ${d}/${m}${y === today().slice(0, 4) ? '' : `/${y}`}`;
}
const formatDateTime = (value) => `${formatDate(value.slice(0, 10))}, ${value.slice(11)}`;

function repeatLabel(repeat) {
  if (!repeat) return '';
  const [name, unit] = FREQ_LABELS[repeat.freq];
  let label = repeat.interval > 1 ? `a cada ${repeat.interval} ${unit}` : name.toLowerCase();
  if (isBiweekly(repeat)) label = 'quinzenal';
  if (repeat.freq === 'weekly' && repeat.weekdays?.length) {
    const group = WEEKDAY_GROUPS[repeat.weekdays.join()];
    const days = group || repeat.weekdays.map((d) => WEEKDAYS[d].toLowerCase()).join(', ');
    label = group && Number(repeat.interval) === 1 ? group : `${label} (${days})`;
  }
  if (repeat.fromCompletion) label += ', após concluir';
  if (repeat.count) label += `, ${repeat.done || 0}/${repeat.count}`;
  return label;
}

const UNTIL_MODES = {
  A: ['Campo único', 'Um só campo Até: é o prazo sem repetição e o fim da série com repetição.'],
  B: ['Dois campos', 'Prazo e Fim da repetição sempre visíveis. Com repetição, o prazo anda junto com cada ocorrência.'],
  C: ['Fim em Repetir', 'Prazo na tarefa; o fim da repetição fica dentro de Repetir.'],
};
const untilMode = () => (UNTIL_MODES[state.settings.untilMode] ? state.settings.untilMode : 'A');

// Tamanhos da letra em Config.; o 3 é o padrão.
// v23: dez tamanhos (antes eram cinco). `textSize` vai de 1 a 10; o `fontSize` antigo (1 a 5) é convertido.
const TEXT_SIZES = [11, 11.75, 12.5, 13.25, 14, 14.75, 15.5, 16.25, 17, 18];
const DEFAULT_TEXT_SIZE = 5;
const OLD_FONT_SIZES = { 1: 3, 2: 4, 3: 5, 4: 7, 5: 9 };
function textSize() {
  const value = Number(state.settings.textSize);
  if (Number.isInteger(value) && value >= 1 && value <= TEXT_SIZES.length) return value;
  return OLD_FONT_SIZES[Number(state.settings.fontSize)] || DEFAULT_TEXT_SIZE;
}
const fontSizePx = () => TEXT_SIZES[textSize() - 1];

// A Matriz saiu na v20; quem a usava volta para a Lista.
const UPCOMING_MODES = [['list', 'Lista'], ['calendar', 'Calendário'], ['kanban', 'Kanban']];

// Cores das listas (aparecem como uma bolinha ao lado do nome).
const LIST_COLORS = [
  ['', 'Sem cor'], ['#4C80AE', 'Azul'], ['#2E9E6B', 'Verde'], ['#D9A02B', 'Amarelo'], ['#D9543C', 'Laranja'],
  ['#C2417A', 'Rosa'], ['#7A5BC7', 'Roxo'], ['#7E8A99', 'Cinza'],
];
const LIST_SORTS = [
  ['manual', 'Minha ordem'], ['when', 'Data (Quando)'], ['deadline', 'Prazo'], ['important', 'Importância'],
  ['title', 'Título (A–Z)'], ['created', 'Criação (mais novas)'],
];
const START_VIEWS = [['today', 'Hoje'], ['upcoming', 'Próximos dias'], ['lists', 'Listas'], ['inbox', 'Entrada']];

// Ícones de traço do design v14 (24×24).
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" stroke-width="3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  alert: '<path d="M12 3.8 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17v.2"/>',
  phone: '<rect x="7" y="2.8" width="10" height="18.4" rx="2.2"/><path d="M11 18h2"/>',
  laptop: '<rect x="4.5" y="5" width="15" height="10" rx="1.6"/><path d="M2.5 19h19"/>',
  repeat: '<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-2a4 4 0 0 1 4-4h12"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v2a4 4 0 0 1-4 4H4"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  check: '<path d="M5.5 12.5l4.2 4.2L18.5 7.8"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  select: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.2l2.8 2.8L16 9.5"/>',
  inbox: '<path d="M3.5 13.5l2.6-7.2A2 2 0 0 1 8 5h8a2 2 0 0 1 1.9 1.3l2.6 7.2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z"/><circle cx="8" cy="8" r="1.4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.6 2.6 5-5.4"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  next: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M14 6h7M14 12h5M14 18h3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  dn: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  organize: '<path d="M8 4v16M4.5 7.5L8 4l3.5 3.5M16 20V4M12.5 16.5L16 20l3.5-3.5"/>',
  folderPlus: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
};
const ico = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const STAR_ICON = (on) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"></path></svg>`;
const MARK = '<span class="mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.8"></path></svg></span>';
const GRIP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle><circle cx="9" cy="12" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle><circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle></svg>';

/* ---------- Persistência ---------- */

const syncEngine = createSync({
  state,
  config: () => state.sync,
  saveConfig: (config) => db.put('meta', { ...config, id: 'sync' }),
  put: (kind, record) => db.put(kind, record),
  remove: (kind, id) => db.remove(kind, id),
  onStatus: () => {
    const line = $('#sync-status');
    if (line) line.textContent = syncStatusText();
  },
  onRemoteChange: () => {
    // Não apaga o que está sendo digitado na tela.
    const active = document.activeElement;
    const typing = active?.tagName === 'INPUT' && active.closest('#view');
    if (typing && active.value && active.id !== 'search-input') {
      renderNav();
      renderReminders();
      return;
    }
    const focusId = typing ? active.id : null;
    render();
    if (focusId) document.getElementById(focusId)?.focus();
  },
  onSynced: () => refreshPushSchedule(),
});

const savedLocally = () => { if (state.sync?.token) syncEngine.schedule(); };

/* ---------- Avisos com o app fechado ---------- */

const pushLocal = () => state.push || { id: 'push', settings: DEFAULT_PUSH_SETTINGS, hash: null };
const pushSettings = () => normalizePushSettings(pushLocal().settings);

async function savePushLocal(record) {
  state.push = { ...record, id: 'push' };
  await db.put('meta', state.push);
}

let pushUploading = false;

/** Depois de sincronizar, envia a agenda de avisos se ela mudou. */
async function refreshPushSchedule(force = false) {
  if (!state.sync?.token || pushUploading || !navigator.onLine) return;
  pushUploading = true;
  try {
    await uploadSchedule(state.sync.token, { tasks: () => state.tasks, local: pushLocal, saveLocal: savePushLocal }, force);
  } catch (error) {
    console.warn('Agenda de avisos não enviada', error);
  } finally {
    pushUploading = false;
  }
}

async function saveTask(task) {
  const index = state.tasks.findIndex((t) => t.id === task.id);
  const stamped = stamp(index >= 0 ? state.tasks[index] : null, task, Date.now());
  if (index >= 0) state.tasks[index] = stamped; else state.tasks.push(stamped);
  await db.put('tasks', stamped);
  if (stamped._dirty) savedLocally();
}

async function saveList(list) {
  const index = state.lists.findIndex((l) => l.id === list.id);
  const stamped = stamp(index >= 0 ? state.lists[index] : null, list, Date.now());
  if (index >= 0) state.lists[index] = stamped; else state.lists.push(stamped);
  await db.put('lists', stamped);
  if (stamped._dirty) savedLocally();
}

async function saveLogEntry(entry) {
  const stamped = stamp(null, entry, Date.now());
  state.log.push(stamped);
  await db.put('log', stamped);
  savedLocally();
}

/** Exclusão definitiva: avisa os outros aparelhos na próxima sincronização. */
async function forget(kind, id) {
  state[kind] = state[kind].filter((item) => item.id !== id);
  await db.remove(kind, id);
  if (state.sync?.token) {
    state.sync.tombstones = [...(state.sync.tombstones || []), { kind, id }];
    await db.put('meta', { ...state.sync, id: 'sync' });
    savedLocally();
  }
}

async function saveSettings(changes) {
  state.settings = { ...state.settings, ...changes };
  await db.put('meta', state.settings);
}

const findTask = (id) => state.tasks.find((t) => t.id === id);
const findList = (id) => state.lists.find((l) => l.id === id);
const listName = (id) => (findList(id) || { name: 'Entrada' }).name;
const nextOrder = () => state.tasks.reduce((max, t) => Math.max(max, t.order || 0), 0) + 1;
const topOrder = () => state.tasks.reduce((min, t) => Math.min(min, t.order || 0), 1) - 1;
// Depois de anotar: abrir a janela da tarefa (padrão) ou continuar no campo Anotar.
const afterAdd = () => (state.settings.afterAdd === 'keep' ? 'keep' : 'open');
/** Lista padrão das tarefas novas que não vêm de uma lista (Hoje, compartilhar). */
const defaultListId = () => (findList(state.settings.defaultList) ? state.settings.defaultList : INBOX);

/** Nome da lista com emoji e bolinha de cor, já escapado. */
function listLabel(list, { dot = true } = {}) {
  if (!list) return 'Entrada';
  const color = dot && list.color ? `<span class="list-dot" style="--dot:${escapeHtml(list.color)}" aria-hidden="true"></span>` : '';
  const emoji = list.emoji ? `<span class="list-emoji" aria-hidden="true">${escapeHtml(list.emoji)}</span>` : '';
  return `${color}${emoji}<span class="list-name">${escapeHtml(list.name)}</span>`;
}

/** Ordem das listas: a escolhida em "Organizar", depois alfabética. */
function byListOrder(a, b) {
  if (a.id === INBOX) return -1;
  if (b.id === INBOX) return 1;
  const oa = Number.isFinite(a.order) ? a.order : Infinity;
  const ob = Number.isFinite(b.order) ? b.order : Infinity;
  return oa === ob ? a.name.localeCompare(b.name, 'pt-BR') : oa - ob;
}
const sortedLists = () => state.lists.slice().sort(byListOrder);


/** Ordena as tarefas de uma lista conforme a escolha da lista. */
function sortTasks(tasks, mode = 'manual') {
  const far = '9999-12-31';
  const sorters = {
    manual: byOrder,
    when: (a, b) => (a.when || far).localeCompare(b.when || far) || byOrder(a, b),
    deadline: (a, b) => (a.deadline || far).localeCompare(b.deadline || far) || byOrder(a, b),
    important: (a, b) => Number(!!b.important) - Number(!!a.important) || byOrder(a, b),
    title: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
    created: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
  };
  return tasks.slice().sort(sorters[mode] || byOrder);
}

/* ---------- Ações sobre tarefas ---------- */

async function addTask(title, context, parsed = null, extra = {}) {
  const result = applyEdit(null, {
    title,
    listId: context.listId || defaultListId(),
    when: parsed?.when || context.when || null,
    until: parsed?.until || null,
    remindAt: parsed?.remindAt || null,
    repeat: parsed?.repeat || null,
    notes: extra.notes || '',
  }, today());
  if (result.error) return null;
  const id = newId();
  await saveTask({
    ...result.task,
    id,
    status: 'open',
    // Tarefa nova entra no topo, como no To Do.
    order: topOrder(),
    createdAt: new Date().toISOString(),
  });
  render();
  return id;
}

/** Rola até a tarefa recém-criada, se ela aparece nesta tela, e a destaca por um instante. */
function revealTask(id) {
  if (!id) return;
  setTimeout(() => {
    const row = document.querySelector(`#view .task[data-id="${id}"]`);
    if (!row) return;
    // No meio da tela: no fim ela ficaria atrás do campo Anotar e das abas.
    // Sem rolagem suave: ela pode não acontecer em alguns aparelhos.
    row.scrollIntoView({ block: 'center' });
    row.classList.add('just-added');
    setTimeout(() => row.classList.remove('just-added'), 1800);
  }, 60);
}

/** Onde a tarefa nova foi parar, quando não aparece na tela atual. */
function createdMessage(task, contextListId) {
  if (!task || task.deletedAt || task.status !== 'open') return '';
  const route = currentRoute().name;
  if (route === 'today' && task.when !== today() && !(task.when && task.when < today())) {
    return task.when ? `Criada para ${formatDate(task.when).toLowerCase()}: está em Próximos dias.` : `Criada sem data em ${listName(task.listId)}.`;
  }
  if (route === 'upcoming' && !task.when) return `Criada sem data em ${listName(task.listId)}.`;
  if (contextListId && task.listId !== contextListId) return `Criada em ${listName(task.listId)}.`;
  return '';
}

// Tarefa recém-anotada: ao fechar a janela, a tela rola até ela.
let pendingReveal = null;
function runPendingReveal() {
  if (!pendingReveal) return;
  const { id, listId } = pendingReveal;
  pendingReveal = null;
  render();
  revealTask(id);
  const message = createdMessage(findTask(id), listId);
  if (message) showToast(message);
}

/** Nova posição entre os vizinhos, sem renumerar a lista inteira. */
async function reorderTo(id, orderedIds) {
  const tasks = orderedIds.map(findTask).filter(Boolean);
  const position = tasks.findIndex((task) => task.id === id);
  const prev = tasks[position - 1];
  const next = tasks[position + 1];
  let order = tasks[position].order;
  if (prev && next) order = (prev.order + next.order) / 2;
  else if (prev) order = prev.order + 1;
  else if (next) order = next.order - 1;
  await saveTask({ ...tasks[position], order });
  render();
}

async function complete(id) {
  const task = findTask(id);
  if (!task) return;
  const { task: updated, log } = completeTask(task, today(), new Date().toISOString());
  let logEntry = null;
  if (log) {
    logEntry = { ...log, id: newId() };
    await saveLogEntry(logEntry);
  }
  await saveTask(updated);
  render();

  let message = 'Tarefa concluída.';
  if (updated.status === 'ended') message = 'Concluída. A repetição terminou.';
  else if (task.repeat) message = `Concluída. Próxima: ${nextLabel(updated, updated.when)}.`;
  showToast(message, async () => {
    if (logEntry) await forget('log', logEntry.id);
    await saveTask(task);
    render();
  });
}

async function reopen(id) {
  const task = findTask(id);
  if (!task) return;
  await saveTask({ ...task, status: 'open', completedAt: null });
  render();
}

async function moveToTrash(id) {
  const task = findTask(id);
  if (!task) return;
  await saveTask({ ...task, deletedAt: new Date().toISOString() });
  render();
  showToast('Tarefa enviada para a lixeira.', async () => {
    await saveTask(task);
    render();
  });
}

/** Restaura da lixeira; se a lista dela foi excluída, volta para a Entrada. */
async function restoreTask(id) {
  const task = findTask(id);
  if (!task) return;
  await saveTask({ ...task, deletedAt: null, listId: findList(task.listId) ? task.listId : INBOX });
}

/** Muda um campo pela mesma regra dos detalhes (validações e repetição). */
async function editTask(id, changes) {
  const task = findTask(id);
  if (!task) return false;
  const result = applyEdit(task, editFields(task, changes), today());
  if (result.error) {
    showToast(result.error);
    return false;
  }
  await saveTask(result.task);
  return true;
}

async function duplicateTask(id) {
  const task = findTask(id);
  if (!task) return null;
  const copy = {
    ...task,
    id: newId(),
    status: 'open',
    order: task.order + 0.001,
    createdAt: new Date().toISOString(),
    completedAt: null,
    deletedAt: null,
    ackedAt: null,
    snoozedUntil: null,
    snoozedFor: null,
    notifiedFor: null,
    steps: (task.steps || []).map((step) => ({ ...step })),
  };
  delete copy._t;
  delete copy._dirty;
  if (copy.repeat) copy.repeat = { ...copy.repeat, done: 0 };
  await saveTask(copy);
  render();
  showToast('Tarefa duplicada.', async () => {
    await forget('tasks', copy.id);
    render();
  });
  return copy.id;
}

/** Ações sobre várias tarefas de uma vez, com Desfazer. */
async function bulkApply(ids, label, change) {
  const before = ids.map(findTask).filter(Boolean);
  for (const task of before) {
    // eslint-disable-next-line no-await-in-loop
    await change(task);
  }
  render();
  showToast(label, async () => {
    for (const task of before) {
      // eslint-disable-next-line no-await-in-loop
      await saveTask(task);
    }
    render();
  });
}

async function moveTask(id, direction) {
  const task = findTask(id);
  const siblings = state.tasks
    .filter((t) => t.status === 'open' && !t.deletedAt && t.listId === task.listId)
    .sort((a, b) => a.order - b.order);
  const other = siblings[siblings.findIndex((t) => t.id === id) + direction];
  if (!other) return;
  const order = task.order;
  await saveTask({ ...task, order: other.order });
  await saveTask({ ...other, order });
  render();
}

/* ---------- Lembretes ---------- */

async function showNotification(task, { time = null, step = 0 } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  let body = 'Toque para ver a tarefa.';
  if (time) body = step ? `Ainda pendente · lembrete das ${time.slice(11)}` : `Lembrete das ${time.slice(11)}`;
  const options = {
    body,
    tag: task.id,
    renotify: step > 0,
    icon: 'icons/icon-folha-192.png',
    badge: 'icons/badge-folha-96.png',
    data: { id: task.id },
    // O Chrome mostra no máximo dois botões: Concluir e o escolhido em Config. › Avisos.
    actions: [
      { action: 'done', title: 'Concluir' },
      notifySecond() === 'snooze' ? { action: 'snooze', title: `Adiar ${SNOOZE_MINUTES} min` } : { action: 'tomorrow', title: 'Amanhã' },
    ],
  };
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  if (registration) {
    await registration.showNotification(task.title, options);
  } else {
    const { actions, ...plain } = options;
    new Notification(task.title, plain);
  }
}

/** Avisos que o service worker já mostrou a partir de um push. */
async function pushShownKeys() {
  try {
    const record = await db.get('meta', 'pushShown');
    return new Set(record?.keys || []);
  } catch {
    return new Set();
  }
}

let checking = false;

async function checkReminders() {
  if (checking) return;
  checking = true;
  try {
    const nowDate = new Date();
    const now = localDateTime(nowDate);
    const due = dueReminders(state.tasks, now);
    const shown = due.length ? await pushShownKeys() : new Set();
    for (const task of due) {
      const time = activeReminder(task, now);
      const step = insistStep(task, time, nowDate, pushSettings().insistMinutes);
      const mark = notifyMark(time, step);
      if (task.notifiedFor === mark) continue;
      await saveTask({ ...findTask(task.id), notifiedFor: mark });
      if (shown.has(pushKey(task.id, time, step))) continue;
      try {
        await showNotification(task, { time, step });
      } catch (error) {
        console.warn('Notificação não enviada', error);
      }
    }
  } finally {
    checking = false;
  }
  renderReminders();
}

function renderReminders() {
  const now = localDateTime();
  const due = dueReminders(state.tasks, now);
  document.title = due.length ? `(${due.length}) ${APP_NAME}` : APP_NAME;
  // Em Hoje, o lembrete fica logo abaixo do título; nas outras telas, no topo.
  const slot = $('#view-reminders');
  $('#reminders').innerHTML = '';
  // Fora de Hoje, uma linha só, para os cartões não empurrarem o conteúdo da tela.
  if (!slot) {
    if (due.length) {
      const text = due.length === 1 ? `Lembrete: ${due[0].title}` : `${due.length} lembretes pendentes`;
      $('#reminders').innerHTML = `<a class="reminder-line" href="#today">${ico('bell')}<span class="grow">${escapeHtml(text)}</span><span class="go">Ver em Hoje${ico('right')}</span></a>`;
    }
    return;
  }
  // Em Hoje, um cartão só: o lembrete vencido mais antigo (com "e mais N" para os outros)
  // ou, sem nenhum vencido, o próximo de hoje.
  const next = nextShown();
  if (!next) {
    slot.innerHTML = '';
  } else {
    const { task, time, due, total } = next;
    const late = due && (parseLocalTime(now) - parseLocalTime(time)) / 60000 > 15;
    const when = time.slice(0, 10) === today() ? time.slice(11) : formatDateTime(time).toLowerCase();
    const label = due ? (late ? 'Lembrete' : 'Lembrete agora') : 'A seguir';
    const meta = [
      task.listId !== INBOX && findList(task.listId) ? listChip(findList(task.listId)) : '',
      task.deadline === today() ? '<span>vence hoje</span>' : '',
      isOverdue(task, today()) ? `<span class="chip-overdue">Era até ${escapeHtml(formatDate(task.deadline).toLowerCase())}</span>` : '',
    ].filter(Boolean).join('');
    const others = total - 1;
    slot.innerHTML = `
    <section class="leaf-card big next-card" aria-label="${label}">
      <div>
        <div class="leaf-kicker">${ico('bell')}${label} · ${escapeHtml(when)}</div>
        <button class="next-title" data-action="open" data-id="${task.id}">${escapeHtml(task.title)}</button>
        ${meta ? `<div class="chips">${meta}</div>` : ''}
      </div>
      ${due ? `<button class="ib" data-action="dismiss" data-id="${task.id}" aria-label="Dispensar lembrete: ${escapeHtml(task.title)}" title="Dispensar">${ico('x')}</button>` : ''}
      <div class="next-actions">
        <button class="pill-btn primary" data-action="complete" data-id="${task.id}">Concluir</button>
        <button class="pill-btn" data-action="snooze-menu" data-id="${task.id}" aria-haspopup="dialog">Adiar</button>
      </div>
      ${others > 0 ? `<button class="next-more" data-action="next-more" aria-label="Ver o próximo lembrete pendente (mais ${others})">e mais ${others}</button>` : ''}
    </section>`;
  }
  // O cabeçalho só sobe por baixo de um cartão quando há cartão logo depois dele.
  $('#view > .hero')?.classList.toggle('lifted', !!slot.innerHTML.trim() || !!$('#view > .empty-card'));
}

const parseLocalTime = (value) => {
  const [date, time = '00:00'] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
};

/** "às 10:00" hoje, "amanhã, 09:00" nos outros dias. */
const timeWords = (time) => (time.slice(0, 10) === today() ? `às ${time.slice(11)}` : formatDateTime(time).toLowerCase());

/** Adiar o lembrete: 10 min, 1 hora, hoje à noite, amanhã ou um horário escolhido. */
function openSnoozeSheet(id) {
  const task = findTask(id);
  if (!task) return;
  const nowDate = new Date();
  const plus = (minutes) => localDateTime(new Date(nowDate.getTime() + minutes * 60000));
  const evening = `${today()}T19:00`;
  const options = [
    ['10 minutos', plus(10)],
    ['1 hora', plus(60)],
    localDateTime(nowDate) < `${today()}T18:30` && ['Hoje à noite', evening],
    ['Amanhã', `${addDays(today(), 1)}T${defaultRemindTime()}`],
  ].filter(Boolean);
  const current = activeReminder(task, localDateTime()) || shownReminder(task, localDateTime());
  const hint = (time) => (time.slice(0, 10) === today() ? time.slice(11) : `${formatDate(time.slice(0, 10)).split(',')[0].toLowerCase()}, ${time.slice(11)}`);
  openSheet(task.title, [
    ...options.map(([label, time]) => [
      `${label}<span class="sheet-hint accent">${escapeHtml(hint(time))}</span>`,
      async () => { $('#dialog').close(); await snoozeTask(id, time); },
      { html: true },
    ]),
    ['Escolher dia e horário…', () => openSnoozePicker(id)],
  ], '', {
    kicker: current ? `Adiar · lembrete das ${current.slice(11)}` : 'Adiar o lembrete',
    lined: true,
    note: task.repeat ? `Esta tarefa se repete (${repeatLabel(task.repeat).toLowerCase()}). Adiar muda só este lembrete; a repetição continua igual.` : '',
  });
}

async function snoozeTask(id, time) {
  const task = findTask(id);
  if (!task) return;
  await saveTask(snoozeTo(task, time, localDateTime()));
  render();
  showToast(`Lembro de novo ${timeWords(time)}.`, async () => {
    await saveTask(task);
    render();
  });
}

function openSnoozePicker(id) {
  const next = new Date(Date.now() + 60 * 60000);
  next.setMinutes(0, 0, 0);
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form" data-form="snooze" data-id="${id}">
      <div class="form-head"><h2>Lembrar de novo em</h2><button type="button" class="ib" data-action="close-dialog" aria-label="Fechar">${ico('x')}</button></div>
      <div class="field"><label for="s-at">Data e hora</label><input id="s-at" type="datetime-local" name="at" required value="${localDateTime(next)}"></div>
      <div class="form-foot"><div></div><div><button class="btn primary">${ico('clock')}Adiar</button></div></div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  $('#s-at').focus();
}

async function handleReminderAction(action, id) {
  const task = findTask(id);
  if (!task) return;
  if (action === 'done') {
    await complete(id);
  } else if (action === 'snooze') {
    await saveTask(snooze(task, new Date(), SNOOZE_MINUTES));
    render();
    showToast(`Adiado por ${SNOOZE_MINUTES} minutos.`);
  } else if (action === 'tomorrow') {
    await tomorrowFromReminder(id);
  } else if (action === 'open') {
    openTask(id);
  }
}

const notifySecond = () => (state.settings.notifySecond === 'snooze' ? 'snooze' : 'tomorrow');

/** Botão "Amanhã" do aviso: a tarefa vai para amanhã e o lembrete de hoje volta amanhã, no mesmo horário. */
async function tomorrowFromReminder(id) {
  const task = findTask(id);
  if (!task) return;
  const now = localDateTime();
  const active = activeReminder(task, now);
  const tomorrow = addDays(today(), 1);
  await moveToDate(id, tomorrow);
  const moved = findTask(id);
  if (active && moved && activeReminder(moved, localDateTime())) {
    await saveTask(snoozeTo(moved, `${tomorrow}T${active.slice(11)}`, now));
    render();
  }
}

/* ---------- Telas ---------- */

/** Lista com a bolinha de cor (a Entrada vai sem bolinha). */
function listChip(list) {
  if (!list) return '<span class="lc plain">Entrada</span>';
  return `<span class="lc${list.color ? '' : ' plain'}" style="--c:${escapeHtml(list.color || '')}">${escapeHtml(list.name)}</span>`;
}

/** Hora do lembrete: só a hora quando é hoje ou no dia de Quando; senão, dia e hora. */
function reminderWords(task, time) {
  const date = time.slice(0, 10);
  if (date === today() || date === task.when) return time.slice(11);
  return `${formatDate(date).toLowerCase()} ${time.slice(11)}`;
}

/** Uma linha com o essencial: estrela, data, lembrete, repetição, etapas e lista. */
function taskChips(task, { showWhen = true, showList = false, noDate = false, noReminder = false } = {}) {
  const now = today();
  const chips = [];
  const open = task.status === 'open';
  if (task.status === 'done' && task.completedAt) chips.push(`<span>concluída ${escapeHtml(formatDate(localDate(new Date(task.completedAt))).toLowerCase())}</span>`);
  if (task.important && open) chips.push(`<span class="star" title="Importante">${ico('star', 'fill')}<span class="visually-hidden">Importante</span></span>`);
  if (isOverdue(task, now)) chips.push(`<span class="chip-overdue">Era até ${escapeHtml(formatDate(task.deadline).toLowerCase())}</span>`);
  const waiting = open ? daysWaiting(task, now) : 0;
  if (waiting > 0 && !isOverdue(task, now)) chips.push(`<span>há ${waiting} ${waiting === 1 ? 'dia' : 'dias'}</span>`);
  else if (showWhen && task.when && open && !waiting) chips.push(`<span>${escapeHtml(formatDate(task.when).toLowerCase())}</span>`);
  else if (showWhen && noDate && !task.when && open) chips.push('<span>sem data</span>');
  if (task.deadline && !isOverdue(task, now) && open) chips.push(`<span>até ${escapeHtml(formatDate(task.deadline).toLowerCase())}</span>`);
  const reminder = shownReminder(task, localDateTime());
  const more = (task.extraReminders || []).length;
  // No ramo de Hoje a hora do lembrete já está na coluna da esquerda.
  if (reminder && !(noReminder && !more)) chips.push(`<span class="chip-reminder">${ico('bell')}${escapeHtml(reminderWords(task, reminder))}${more ? ` +${more}` : ''}</span>`);
  if (task.repeat) {
    const end = task.seriesEnd ? `, até ${formatDate(task.seriesEnd).toLowerCase()}` : '';
    chips.push(`<span>${ico('repeat')}${escapeHtml(repeatLabel(task.repeat) + end)}</span>`);
  }
  if (task.steps && task.steps.length) chips.push(`<span>${task.steps.filter((s) => s.done).length}/${task.steps.length} etapas</span>`);
  if (task.notes) chips.push('<span>Nota</span>');
  (task.tags || []).forEach((tag) => chips.push(`<span class="chip-tag">#${escapeHtml(tag)}</span>`));
  if (showList) chips.push(listChip(findList(task.listId)));
  return chips.length ? `<span class="chips">${chips.join('')}</span>` : '';
}

/** Texto do botão de concluir: nas repetições, diz para quando vai a próxima. */
function completeLabel(task) {
  if (!task.repeat) return `Concluir ${task.title}`;
  return `Concluir e ir para a próxima (${nextLabel(task, nextDate(task, today()))}): ${task.title}`;
}

/** "sex, 12/11 às 17:00", com o horário do lembrete quando houver. */
function nextLabel(task, date) {
  const time = task.remindAt && task.remindEach !== false ? ` às ${task.remindAt.slice(11)}` : '';
  return `${formatDate(date).toLowerCase()}${time}`;
}

const MORE_ICON = ico('more');

function taskRow(task, options = {}) {
  const done = task.status !== 'open';
  if (state.selecting) {
    const on = state.selected.has(task.id);
    return `
  <li class="task selectable ${on ? 'selected' : ''} ${done ? 'is-done' : ''}" data-id="${task.id}">
    <button class="task-body select-body" data-action="toggle-select" data-id="${task.id}" aria-pressed="${on}">
      <span class="select-box" aria-hidden="true">${on ? ico('check') : ''}</span>
      <span class="select-text"><span class="task-title">${escapeHtml(task.title)}</span>${taskChips(task, options)}</span>
    </button>
  </li>`;
  }
  const check = done
    ? `<button class="check done" data-action="reopen" data-id="${task.id}" aria-label="Reabrir ${escapeHtml(task.title)}">${MARK}</button>`
    : `<button class="check${task.repeat ? ' repeats' : ''}${isOverdue(task, today()) ? ' late' : ''}" data-action="complete" data-id="${task.id}" aria-label="${escapeHtml(completeLabel(task))}" title="${escapeHtml(task.repeat ? 'Concluir e ir para a próxima' : 'Concluir')}">${MARK}</button>`;
  // Coluna da hora do ramo (Hoje): hora do lembrete, da conclusão ou o dia.
  const time = options.time !== undefined ? `<span class="tm ${options.timeClass || ''}">${escapeHtml(options.time)}</span>` : '';
  return `
  <li class="task ${done ? 'is-done' : ''}" data-id="${task.id}">
    ${time}${check}
    <button class="task-body" data-action="open" data-id="${task.id}">
      <span class="task-title">${options.mark ? markText(task.title, options.mark) : escapeHtml(task.title)}</span>
      ${taskChips(task, options)}${options.snippet ? options.snippet(task) : ''}
    </button>
    ${options.draggable && !done ? `<button class="drag" data-drag="${task.id}" aria-label="Reordenar ${escapeHtml(task.title)}: arraste ou use as setas do teclado">${GRIP_ICON}</button>` : ''}
    <button class="icon more" data-action="task-menu" data-id="${task.id}" aria-label="Mais ações: ${escapeHtml(task.title)}" title="Mais ações">${MORE_ICON}</button>
  </li>`;
}

const taskListHtml = (tasks, options) => `<ul class="task-list">${tasks.map((t) => taskRow(t, options)).join('')}</ul>`;

/**
 * Campo "Anotar…". No note fica fixo, com o que foi entendido logo acima dele.
 * No celular (v22) fica escondido e vira a folha de baixo aberta pelo + da barra.
 */
const quickAdd = (placeholder, context) => `
  <div class="dock" id="dock" role="group" aria-label="Anotar tarefa">
    <div class="grab" aria-hidden="true"></div>
    <div class="dock-head"><label for="quick-input" id="quick-label">Anotar</label></div>
    <div class="parse" id="quick-preview" aria-live="polite" hidden></div>
    <form class="qa" id="quick-form" data-form="quick-add" data-list="${context.listId || ''}" data-when="${context.when || ''}">
      <input id="quick-input" name="title" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder.replace('…', ''))}" aria-describedby="quick-preview" autocomplete="off" enterkeyhint="done">
      <button class="go" aria-label="Adicionar" title="Adicionar">${ico('plus')}</button>
    </form>
    <div class="dock-actions">
      <button type="submit" form="quick-form" class="anotar-open-btn" data-after="open">Anotar e abrir</button>
      <button type="submit" form="quick-form" class="anotar-more-btn" data-after="keep">Anotar outra</button>
    </div>
  </div>`;

/** O que foi entendido no texto digitado, ou nada se a função estiver desligada. */
function quickParse(text) {
  if (state.settings.parseDates === false || !text.trim() || text === state.quickIgnore) return null;
  const parsed = parseQuickAdd(text, today(), localDateTime().slice(11));
  return parsed.matched ? parsed : null;
}

/** Valores finais da tarefa nova: o texto entendido, a tela atual e os botões de um toque. */
function quickValues(text, form) {
  const parsed = quickParse(text);
  const quick = state.quick || {};
  const context = { listId: form?.dataset.list || '', when: form?.dataset.when || '' };
  let when = quick.when !== undefined ? quick.when : (parsed?.when || context.when || null);
  let remindAt = parsed?.remindAt || null;
  if (remindAt && quick.when) {
    remindAt = `${quick.when}T${remindAt.slice(11)}`;
  } else if (remindAt && !parsed.when && quick.when === undefined && context.when) {
    // Só a hora, sem o dia ("pagar luz 10h"): Quando e lembrete ficam no mesmo dia; senão o
    // lembrete deixa de seguir o Quando na janela da tarefa. Num dia futuro da tela (Próximos),
    // vale esse dia; em Hoje, o dia da hora (amanhã, se a hora de hoje já passou).
    if (context.when > today()) remindAt = `${context.when}T${remindAt.slice(11)}`;
    else when = remindAt.slice(0, 10);
  }
  const repeat = quick.repeat !== undefined ? quick.repeat : (parsed?.repeat || null);
  // Repetição em dias da semana: o Quando vai para o primeiro dia marcado (o lembrete do mesmo dia vai junto).
  if (repeat?.freq === 'weekly' && repeat.weekdays?.length) {
    const base = when || (remindAt ? remindAt.slice(0, 10) : null);
    const day = base && firstOnWeekdays(repeat.weekdays, base);
    if (day) {
      if (remindAt && remindAt.slice(0, 10) === base) remindAt = `${day}T${remindAt.slice(11)}`;
      when = day;
    }
  }
  return {
    parsed,
    title: parsed ? parsed.title : text.trim(),
    when,
    until: parsed?.until || null,
    remindAt,
    repeat,
    listId: quick.listId || context.listId || defaultListId(),
  };
}

function renderQuickPreview() {
  const input = $('#quick-input');
  const box = $('#quick-preview');
  if (!input || !box) return;
  const text = input.value;
  const v = quickValues(text, input.form);
  const list = findList(v.listId);
  const label = $('#quick-label');
  if (label) label.textContent = `Anotar em ${list ? list.name : 'Entrada'}`;
  // No note, sem texto, a caixa some; na folha do celular os botões de um toque ficam sempre à vista.
  if (!text.trim() && !anotarOpen) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const tomorrow = addDays(today(), 1);
  const rows = [];
  if (text.trim()) {
    rows.push(`<div class="qp-title">${escapeHtml(v.title || '…')}</div>`);
    if (v.when) rows.push(`<div><span>Quando</span>${escapeHtml(formatDate(v.when).toLowerCase())}</div>`);
    if (v.remindAt) rows.push(`<div><span>Lembrar</span>${escapeHtml(v.remindAt.slice(0, 10) === (v.when || today()) ? `às ${v.remindAt.slice(11)}` : formatDateTime(v.remindAt).toLowerCase())}</div>`);
    if (v.repeat) rows.push(`<div><span>Repetir</span>${escapeHtml(repeatLabel({ interval: 1, ...v.repeat }))}</div>`);
    if (v.until) rows.push(`<div><span>Até</span>${escapeHtml(formatDate(v.until).toLowerCase())}</div>`);
  }
  box.innerHTML = `
    ${rows.length ? `<div class="qp-head"><h3>Entendi assim</h3>${v.parsed ? '<button type="button" class="link" data-action="quick-ignore">Usar o texto como está</button>' : ''}</div>
    <div class="qp-ramo">${rows.join('')}</div>` : ''}
    <div class="fit-box"><div class="qp-chips">
      <span class="lead">Um toque:</span>
      <button type="button" class="chip ${v.when === today() ? 'on' : ''}" data-action="quick-when" data-days="0" aria-pressed="${v.when === today()}">Hoje</button>
      <button type="button" class="chip ${v.when === tomorrow ? 'on' : ''}" data-action="quick-when" data-days="1" aria-pressed="${v.when === tomorrow}">Amanhã</button>
      <button type="button" class="chip ${v.repeat ? 'on' : ''}" data-action="quick-repeat">${ico('repeat')}Repetir</button>
      <button type="button" class="chip" data-action="quick-list" aria-label="Lista: ${escapeHtml(list ? list.name : 'Entrada')}">${listChip(list)}</button>
    </div></div>`;
  box.hidden = false;
}

/* ---------- Folha "Anotar" (celular) ---------- */

let anotarOpen = false;
let anotarHistory = false;
const isPhone = () => matchMedia('(max-width: 799px)').matches;

/** Tudo atrás da folha fica inerte: o Tab e o leitor de tela ficam só nela. */
function setAnotarInert(on) {
  const dock = $('#dock');
  const behind = [$('#nav'), $('#reminders'), ...document.querySelectorAll('#view > *')].filter((el) => el && el !== dock);
  behind.forEach((el) => { el.inert = on; });
}

/** Depois de um redesenho com a folha aberta, a folha continua aberta e com o foco. */
function keepAnotarOpen() {
  if (!$('#dock')) ensureDock();
  setAnotarInert(true);
  renderQuickPreview();
}

/** Telas sem campo de anotar (Listas, Busca, Config.) ganham um, sem data e na lista padrão. */
function ensureDock() {
  if ($('#dock')) return;
  $('#view').insertAdjacentHTML('beforeend', quickAdd('Anotar…', {}));
}

/** O + da barra, a tecla N, o atalho ?novo=1 e o Compartilhar abrem a folha (no note, focam o campo). */
function openAnotar({ text = '', notes = '' } = {}) {
  state.quickNotes = notes;
  if (!isPhone()) {
    focusQuickAdd();
    if (text) { $('#quick-input').value = text; renderQuickPreview(); }
    return;
  }
  ensureDock();
  if (!anotarOpen) {
    anotarOpen = true;
    document.body.classList.add('anotar-open');
    // O voltar do Android fecha a folha em vez de sair da tela.
    history.pushState({ anotar: true }, '', location.href);
    anotarHistory = true;
  }
  setAnotarInert(true);
  const input = $('#quick-input');
  if (text) input.value = text;
  renderQuickPreview();
  input.focus();
}

function closeAnotar({ back = true } = {}) {
  if (!anotarOpen) return;
  anotarOpen = false;
  document.body.classList.remove('anotar-open');
  setAnotarInert(false);
  state.quick = {};
  state.quickIgnore = '';
  state.quickNotes = '';
  const input = $('#quick-input');
  if (input) { input.value = ''; input.blur(); }
  renderQuickPreview();
  if (anotarHistory) {
    anotarHistory = false;
    if (back) history.back();
  }
}

window.addEventListener('popstate', () => {
  if (anotarOpen) {
    anotarHistory = false;
    closeAnotar({ back: false });
  }
});

function refocusQuick() {
  renderQuickPreview();
  $('#quick-input')?.focus();
}

function openQuickRepeat() {
  const choose = (repeat) => () => { $('#dialog').close(); state.quick = { ...state.quick, repeat }; refocusQuick(); };
  openSheet('Repetir', [
    ['Todo dia', choose({ freq: 'daily', interval: 1 }), { icon: 'repeat' }],
    ['Toda semana', choose({ freq: 'weekly', interval: 1 }), { icon: 'repeat' }],
    ['Dias da semana…', () => openQuickDays(), { icon: 'calendar', hint: 'seg e qua, dias úteis…' }],
    ['A cada 2 semanas (quinzenal)', choose({ freq: 'weekly', interval: 2 }), { icon: 'repeat' }],
    ['Todo mês', choose({ freq: 'monthly', interval: 1 }), { icon: 'repeat' }],
    ['Todo ano', choose({ freq: 'yearly', interval: 1 }), { icon: 'repeat' }],
    ['Não repetir', choose(null), { icon: 'x' }],
  ]);
}

/** Folha "Repetir nos dias" da folha Anotar: marca os dias e toca em Pronto. */
function openQuickDays() {
  const input = $('#quick-input');
  const v = quickValues(input?.value || '', input?.form);
  const chosen = v.repeat?.freq === 'weekly' && v.repeat.weekdays?.length
    ? v.repeat.weekdays
    : [new Date(`${v.when || today()}T12:00`).getDay()];
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="sheet days-sheet" data-form="quick-days">
      <div class="grab" aria-hidden="true"></div>
      <div class="form-head"><div><h2>Repetir nos dias</h2><div class="subtitle">Toda semana, só nos dias marcados.</div></div><button type="button" class="ib" data-action="close-dialog" aria-label="Fechar" title="Fechar">${ico('x')}</button></div>
      ${weekdayPicker(chosen)}
      <div class="form-foot"><div></div><div><button class="btn primary">${ico('check')}Pronto</button></div></div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('input[name="weekday"]')?.focus();
}

/** Bolinhas D S T Q Q S S e os atalhos Dias úteis e Fim de semana. */
const weekdayPicker = (chosen) => `
  <div class="weekdays" role="group" aria-label="Dias da semana">
    ${WEEKDAYS.map((name, index) => `<label><input type="checkbox" name="weekday" value="${index}" aria-label="${WEEKDAYS_FULL[index]}" ${chosen.includes(index) ? 'checked' : ''}><span>${name[0]}</span></label>`).join('')}
  </div>
  <div class="fit-box"><div class="shortcuts fit fit-pair days-presets">
    <button type="button" class="chip" data-action="set-days" data-days="1,2,3,4,5">Dias úteis</button>
    <button type="button" class="chip" data-action="set-days" data-days="0,6">Fim de semana</button>
  </div></div>`;

function openQuickList() {
  const current = quickValues($('#quick-input')?.value || '', $('#quick-input')?.form).listId;
  openSheet('Anotar em', sortedLists().map((list) => [
    `${listLabel(list)}${list.group ? ` <span class="sheet-hint">${escapeHtml(list.group)}</span>` : ''}`,
    () => { $('#dialog').close(); state.quick = { ...state.quick, listId: list.id }; refocusQuick(); },
    { html: true, on: list.id === current },
  ]));
}

const byOrder = (a, b) => a.order - b.order;
const activeTasks = () => state.tasks.filter((t) => !t.deletedAt);
const openTasks = () => state.tasks.filter((t) => t.status === 'open' && !t.deletedAt);
const sameTag = (a, b) => a.toLocaleLowerCase('pt-BR') === b.toLocaleLowerCase('pt-BR');

function allTags() {
  const counts = new Map();
  openTasks().forEach((task) => (task.tags || []).forEach((tag) => {
    const key = [...counts.keys()].find((name) => sameTag(name, tag)) || tag;
    counts.set(key, (counts.get(key) || 0) + 1);
  }));
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
}

/** Dia curto para a coluna da hora do ramo: "ontem", "seg", "03/11". */
function shortDay(date) {
  const now = today();
  if (!date || date === now) return 'hoje';
  if (date === addDays(now, -1)) return 'ontem';
  if (date === addDays(now, 1)) return 'amanhã';
  const [y, m, d] = date.split('-');
  if (date < now && date >= addDays(now, -6)) return WEEKDAYS[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()].toLowerCase();
  return `${d}/${m}`;
}

/** Horário de hoje de uma tarefa aberta (o lembrete de hoje), ou vazio. */
function todayTime(task, nowTime) {
  const shown = shownReminder(task, nowTime);
  if (shown && shown.slice(0, 10) === today()) return shown.slice(11);
  if (task.remindAt && task.remindAt.slice(0, 10) === today()) return task.remindAt.slice(11);
  return '';
}

/**
 * Cartão "A seguir": os lembretes vencidos, do mais antigo ao mais novo.
 * Sem nenhum vencido, o próximo lembrete de hoje; sem nenhum, a lista vem vazia.
 */
function nextUp() {
  const now = localDateTime();
  const due = dueReminders(state.tasks, now).map((task) => ({ task, time: activeReminder(task, now), due: true }))
    .sort((a, b) => a.time.localeCompare(b.time));
  if (due.length) return due;
  const soon = openTasks().map((task) => ({ task, time: shownReminder(task, now), due: false }))
    .filter((item) => item.time && item.time > now && item.time.slice(0, 10) === today())
    .sort((a, b) => a.time.localeCompare(b.time));
  return soon.slice(0, 1);
}

const nextShown = () => {
  const list = nextUp();
  return list.length ? { ...list[(state.nextIndex || 0) % list.length], total: list.length } : null;
};

/** Faixa da semana do cabeçalho de Hoje: tocar num dia abre Próximos rolado até ele. */
function weekStrip(now, hasToday) {
  const weekStart = Number(state.settings.weekStart) === 1 ? 1 : 0;
  const [y, m, d] = now.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const first = addDays(now, -((dow - weekStart + 7) % 7));
  const withTasks = new Set(openTasks().filter((t) => t.when > now).map((t) => t.when));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(first, i);
    const index = (weekStart + i) % 7;
    const name = WEEKDAYS[index].toLowerCase();
    const day = Number(date.slice(8));
    const has = date === now ? hasToday : withTasks.has(date);
    if (date < now) return `<span class="wk past" aria-hidden="true">${name}<b>${day}</b><i></i></span>`;
    if (date === now) return `<span class="wk today${has ? ' has' : ''}" aria-current="date" aria-label="Hoje, ${WEEKDAYS_FULL[index].toLowerCase()}, ${day}">${name}<b>${day}</b><i></i></span>`;
    return `<a class="wk${has ? ' has' : ''}" href="#upcoming/${date}" aria-label="${WEEKDAYS_FULL[index]}, ${day}${has ? ', com tarefas' : ''}: ver em Próximos">${name}<b>${day}</b><i></i></a>`;
  });
  return `<nav class="week" aria-label="Esta semana">${days.join('')}</nav>`;
}

function todayView() {
  const now = today();
  const nowTime = localDateTime();
  const tasks = todayTasks(state.tasks, now).sort(byOrder);
  const late = tasks.filter((t) => isOverdue(t, now));
  const rest = tasks.filter((t) => !isOverdue(t, now));
  const isToday = (iso) => iso && localDate(new Date(iso)) === now;
  const doneTasks = activeTasks().filter((t) => t.status === 'done' && isToday(t.completedAt));
  const doneLogs = state.log.filter((item) => isToday(item.completedAt));
  const doneCount = doneTasks.length + doneLogs.length;
  const total = tasks.length + doneCount;
  const [y, m, d] = now.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekdayName = capitalize(date.toLocaleDateString('pt-BR', { weekday: 'long' }));
  const dayMonth = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const opts = { showWhen: false, showList: true };
  const clock = nowTime.slice(11);
  const hourOf = (iso) => localDateTime(new Date(iso)).slice(11);
  const highlight = nextShown()?.task.id;
  const logRow = (item) => `
    <li class="task is-done">
      <span class="tm">${escapeHtml(hourOf(item.completedAt))}</span>
      <span class="check done" aria-hidden="true">${MARK}</span>
      <span class="task-body"><span class="task-title">${escapeHtml(item.title)}</span><span class="chips"><span>${ico('repeat')}ocorrência de ${escapeHtml(formatDate(item.occurrence || now).toLowerCase())}</span></span></span>
    </li>`;

  // Tudo por horário: atrasadas primeiro; depois feitas e abertas pela hora. As abertas sem hora
  // ficam na hora atual (as que vieram de dias anteriores, antes de todas), na ordem manual.
  const entries = [
    ...rest.map((t) => {
      const time = todayTime(t, nowTime);
      const key = time || (t.when < now ? '' : clock);
      return { key, rank: 1, order: t.order || 0, html: () => taskRow(t, { ...opts, noReminder: !!time, time: time || shortDay(t.when), timeClass: t.id === highlight ? 'now' : '' }) };
    }),
    ...doneTasks.map((t) => ({ key: hourOf(t.completedAt), rank: 0, order: 0, html: () => taskRow(t, { ...opts, time: hourOf(t.completedAt) }) })),
    ...doneLogs.map((item) => ({ key: hourOf(item.completedAt), rank: 0, order: 0, html: () => logRow(item) })),
  ].sort((a, b) => a.key.localeCompare(b.key) || a.rank - b.rank || a.order - b.order);
  const lateRows = late.map((t) => taskRow(t, { ...opts, time: shortDay(t.deadline), timeClass: 'late' }));

  const empty = !total;
  const leaves = total && total <= 12
    ? `<span class="prog-leaves" aria-hidden="true">${'<i class="on"></i>'.repeat(doneCount)}${'<i></i>'.repeat(tasks.length)}</span>` : '';
  const select = tasks.length && !state.selecting
    ? `<button class="hero-btn" data-action="select-start" aria-label="Selecionar várias tarefas" title="Selecionar várias">${ico('select')}</button>` : '';
  let body;
  if (empty) {
    body = `
    <div class="tips">
      <div class="tip"><i aria-hidden="true"></i><p>Escreva como fala: <span class="ex">pagar luz sexta 9h</span> ou <span class="ex">academia toda segunda 7h</span>. A data, a hora e o lembrete saem sozinhos.</p></div>
      <div class="tip"><i aria-hidden="true"></i><p>Deslize uma tarefa para a <b class="ex">direita</b> para concluir e para a <b class="ex">esquerda</b> para ${swipeLeft() === 'tomorrow' ? 'adiar para amanhã' : 'mandar para a Lixeira'}.</p></div>
      <div class="tip"><i aria-hidden="true"></i><p>Toque para abrir. <b class="ex">Segure</b> para ver todas as opções: mover, duplicar, excluir.</p></div>
    </div>`;
  } else if (state.selecting) {
    body = taskListHtml([...late, ...rest], opts);
  } else {
    body = `
    <ul class="task-list ramo" aria-label="Tarefas de hoje">${lateRows.join('')}${entries.map((e) => e.html()).join('')}</ul>
    ${tasks.length ? '' : '<p class="ramo-note">Tudo feito por hoje.</p>'}`;
  }
  return `
    <header class="hero">
      <div class="hero-top">
        <div><div class="hero-kicker">${escapeHtml(weekdayName)}</div><h1><span class="visually-hidden">Hoje, </span>${escapeHtml(dayMonth)}</h1></div>
        <div class="hero-tools"><a class="hero-btn" href="#search" aria-label="Buscar" title="Buscar (/)">${ico('search')}</a>${select}</div>
      </div>
      ${total ? `<div class="prog">${leaves}<span>${doneCount} de ${total} ${doneCount === 1 ? 'feita' : 'feitas'}</span></div>` : ''}
      ${weekStrip(now, tasks.length > 0)}
    </header>
    <div id="view-reminders" class="next-slot"></div>
    ${empty ? `
    <section class="leaf-card big empty-card">
      <span class="leaf-big" aria-hidden="true"></span>
      <div><h2>Nada para hoje</h2><p>Uma folha em branco. Que tal anotar algo?</p></div>
      <button class="pill-btn primary" data-action="anotar" style="flex:none">Anotar uma tarefa</button>
    </section>` : ''}
    ${driveWarning()}
    ${body}
    ${quickAdd('Anotar para hoje…', { when: now })}`;
}


/** "Amanhã · qua, 11/11", "Sexta · 13/11" na semana, "seg, 30/11" depois. */
function sectionDate(date) {
  const [y, m, d] = date.split('-');
  const name = WEEKDAYS_FULL[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()];
  const short = `${d}/${m}${y === today().slice(0, 4) ? '' : `/${y}`}`;
  if (date === today()) return `Hoje · ${name.slice(0, 3).toLowerCase()}, ${short}`;
  if (date === addDays(today(), 1)) return `Amanhã · ${name.slice(0, 3).toLowerCase()}, ${short}`;
  if (date <= addDays(today(), 6)) return `${name} · ${short}`;
  return formatDate(date);
}

/* ---------- Cabeçalho das telas (v23): a mesma peça em todas ---------- */

const heroSearch = () => `<a class="hero-btn" href="#search" aria-label="Buscar" title="Buscar (/)">${ico('search')}</a>`;
const heroSelect = (tasks) => (tasks.length && !state.selecting
  ? `<button class="hero-btn" data-action="select-start" aria-label="Selecionar várias tarefas" title="Selecionar várias">${ico('select')}</button>` : '');

/**
 * Cabeçalho na cor de destaque. `back`: [endereço, rótulo] do botão de voltar; `tools`: botões redondos;
 * `lead`: quadradinho à esquerda do título; `extra`: o que vem embaixo (abas, atalhos). `title` já vem escapado.
 */
function pageHero({ back = null, kicker = '', title = '', sub = '', tools = '', extra = '', lead = '' }) {
  return `
    <header class="hero hero-page">
      ${back ? `<div class="hero-bar"><a class="hero-pill" href="${back[0]}">${ico('left')}${escapeHtml(back[1])}</a><div class="hero-tools">${tools}</div></div>` : ''}
      <div class="hero-top">
        ${lead}
        <div class="hero-text">${kicker ? `<div class="hero-kicker">${escapeHtml(kicker)}</div>` : ''}<h1>${title}</h1>${sub ? `<div class="hero-sub">${sub}</div>` : ''}</div>
        ${!back && tools ? `<div class="hero-tools">${tools}</div>` : ''}
      </div>
      ${extra}
    </header>`;
}

/** Horário de uma tarefa no dia em que ela aparece (lembrete do mesmo dia), ou vazio. */
function dayTime(task, date) {
  if (date === today()) return todayTime(task, localDateTime());
  return task.remindAt && task.remindAt.slice(0, 10) === date ? task.remindAt.slice(11) : '';
}

/** Linhas de um dia no ramo: atrasadas primeiro, depois pelo horário; sem horário, "dia", no fim. */
function dayRows(items, date, opts) {
  const now = today();
  return items.map((task) => {
    const late = date === now && isOverdue(task, now);
    const time = late ? '' : dayTime(task, date);
    let label = time || 'dia';
    if (late) label = shortDay(task.deadline);
    else if (date === now && !time && task.when < now) label = shortDay(task.when);
    return { task, key: `${late ? 0 : 1}${time || '99'}`, label, late, time };
  }).sort((a, b) => a.key.localeCompare(b.key) || byOrder(a.task, b.task))
    .map(({ task, label, late, time }) => taskRow(task, { ...opts, noReminder: !!time, time: label, timeClass: late ? 'late' : '' }))
    .join('');
}

const ramoDay = (date, label, count, current = false) => `
  <li class="ramo-day${current ? ' current' : ''}"><span></span><i aria-hidden="true"></i><h2 data-day="${date}">${escapeHtml(label)}${count ? ` <span class="visually-hidden">(${count})</span>` : ''}</h2></li>`;

function upcomingList() {
  const now = today();
  // Hoje vem primeiro, com as que ficaram de dias anteriores (como na tela Hoje).
  const todayItems = todayTasks(state.tasks, now);
  const groups = new Map(todayItems.length ? [[now, todayItems]] : []);
  upcomingTasks(state.tasks, now).forEach((task) => groups.set(task.when, [...(groups.get(task.when) || []), task]));
  if (!groups.size) return '<p class="empty">Nada para hoje nem para os próximos dias.</p>';
  const opts = { showWhen: false, showList: true };
  if (state.selecting) {
    return [...groups].map(([date, items]) => `<h2 data-day="${date}">${escapeHtml(sectionDate(date))}</h2>${taskListHtml(items.sort(byOrder), opts)}`).join('');
  }
  return `<ul class="task-list ramo ramo-days" aria-label="Próximos dias">${[...groups].map(([date, items]) => `${ramoDay(date, sectionDate(date), items.length, date === now)}${dayRows(items, date, opts)}`).join('')}</ul>`;
}

function calendarView() {
  const now = today();
  const month = state.calMonth || now.slice(0, 7);
  const selected = state.calDay || now;
  const [y, m] = month.split('-').map(Number);
  const weekStart = Number(state.settings.weekStart) === 1 ? 1 : 0;
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() - weekStart + 7) % 7;
  const weekNames = [...WEEKDAYS.slice(weekStart), ...WEEKDAYS.slice(0, weekStart)];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const open = openTasks();
  const cells = [];
  for (let i = 0; i < first; i += 1) cells.push('<span class="cal-day out" aria-hidden="true"></span>');
  for (let d = 1; d <= days; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const count = open.filter((t) => t.when === date || t.deadline === date).length;
    const classes = ['cal-day', date === now ? 'today' : '', date === selected ? 'selected' : '', count ? 'has' : ''].join(' ');
    cells.push(`<button class="${classes}" data-action="cal-day" data-date="${date}" aria-pressed="${date === selected}" aria-label="${d}${date === now ? ', hoje' : ''}${count ? `, ${count} ${count === 1 ? 'tarefa' : 'tarefas'}` : ''}">${d}<i aria-hidden="true"></i></button>`);
  }
  const title = capitalize(new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  const dayTasks = open.filter((t) => t.when === selected || t.deadline === selected);
  const label = `${capitalize(formatDate(selected))}${selected === now ? '' : ''} · ${dayTasks.length ? `${dayTasks.length} ${dayTasks.length === 1 ? 'tarefa' : 'tarefas'}` : 'nada marcado'}`;
  return `
    <section class="leaf-card cal-card" aria-label="${escapeHtml(title)}">
      <div class="cal-head">
        <button class="ib" data-action="cal-move" data-step="-1" aria-label="Mês anterior">${ico('left')}</button>
        <strong>${escapeHtml(title)}</strong>
        <button class="ib" data-action="cal-move" data-step="1" aria-label="Próximo mês">${ico('right')}</button>
      </div>
      <div class="cal-grid">${weekNames.map((name) => `<span class="cal-week" aria-hidden="true">${name.toLowerCase()}</span>`).join('')}${cells.join('')}</div>
    </section>
    ${dayTasks.length && !state.selecting
    ? `<ul class="task-list ramo ramo-days">${ramoDay(selected, label, 0, true)}${dayRows(dayTasks, selected, { showWhen: false, showList: true })}</ul>`
    : `<h2 class="section-label" data-day="${selected}">${escapeHtml(label)}</h2>${dayTasks.length ? taskListHtml(dayTasks.sort(byOrder), { showWhen: false, showList: true }) : '<p class="empty">Nada com Quando ou prazo neste dia.</p>'}`}`;
}

function kanbanView() {
  const open = openTasks();
  const columns = sortedLists().map((list) => [list, open.filter((t) => t.listId === list.id).sort(byOrder)]).filter(([, tasks]) => tasks.length);
  if (!columns.length) return '<p class="empty">Nenhuma tarefa aberta.</p>';
  return `<div class="kanban">${columns.map(([list, tasks]) => `
    <section class="kanban-col" aria-label="${escapeHtml(list.name)}">
      <h3>${listSquare(list, 32)}<span class="grow">${escapeHtml(list.name)}</span><span class="count">${tasks.length}</span></h3>
      ${taskListHtml(tasks, {})}
    </section>`).join('')}</div>`;
}

function upcomingView() {
  const saved = UPCOMING_MODES.some(([id]) => id === state.settings.upcomingMode) ? state.settings.upcomingMode : 'list';
  // Vindo de um dia da faixa da semana de Hoje (#upcoming/AAAA-MM-DD), abre na Lista.
  const mode = /^\d{4}-\d{2}-\d{2}$/.test(currentRoute().id || '') ? 'list' : saved;
  const body = { list: upcomingList, calendar: calendarView, kanban: kanbanView }[mode]();
  const month = state.calMonth || today().slice(0, 7);
  const titles = {
    list: 'Agenda',
    calendar: capitalize(new Date(`${month}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long' })),
    kanban: 'Por lista',
  };
  const tasks = mode === 'list' ? [...todayTasks(state.tasks, today()), ...upcomingTasks(state.tasks, today())] : [];
  const tabs = `<div class="hero-seg" role="group" aria-label="Visão">${UPCOMING_MODES.map(([id, name]) => `<button class="${id === mode ? 'on' : ''}" data-action="set-upcoming-mode" data-mode="${id}" aria-pressed="${id === mode}">${name}</button>`).join('')}</div>`;
  return `
    ${pageHero({ kicker: 'Próximos dias', title: escapeHtml(titles[mode]), tools: `${heroSearch()}${heroSelect(tasks)}`, extra: tabs })}
    ${body}
    ${quickAdd('Anotar com data: “sexta 9h”…', { when: mode === 'calendar' && state.calDay > today() ? state.calDay : addDays(today(), 1) })}`;
}

function importantView() {
  const tasks = openTasks().filter((t) => t.important).sort(byOrder);
  return `
    ${pageHero({ back: ['#lists', 'Listas'], title: 'Importantes', sub: tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'aberta' : 'abertas'}, de todas as listas` : '', tools: heroSelect(tasks), lead: `<span class="hero-square" aria-hidden="true">${ico('star', 'fill')}</span>` })}
    ${tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty">Toque na estrela de uma tarefa para ela aparecer aqui.</p>'}`;
}

/** Tags: as tags abertas viram atalhos no cabeçalho; a escolhida mostra as tarefas dela. */
function tagView(encoded) {
  const tags = allTags();
  const tag = encoded ? decodeURIComponent(encoded) : (tags[0]?.[0] || '');
  const tasks = tag ? openTasks().filter((t) => (t.tags || []).some((name) => sameTag(name, tag))).sort(byOrder) : [];
  const chips = tags.length ? `<div class="hero-chips">${tags.map(([name, count]) => {
    const on = sameTag(name, tag);
    return `<a class="hero-chip ${on ? 'on' : ''}" href="#tag/${encodeURIComponent(name)}" ${on ? 'aria-current="page"' : ''}>#${escapeHtml(name)} <span>${count}</span></a>`;
  }).join('')}</div>` : '';
  let body = '<p class="empty">Nenhuma tarefa aberta com tag. As tags ficam em "Mais opções", nos detalhes da tarefa.</p>';
  if (tag) {
    body = `<h2 class="section-label">#${escapeHtml(tag)} · ${tasks.length} ${tasks.length === 1 ? 'aberta' : 'abertas'}</h2>
      ${tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty">Nenhuma tarefa aberta com esta tag.</p>'}`;
  }
  return `
    ${pageHero({ back: ['#lists', 'Listas'], title: 'Tags', tools: heroSelect(tasks), extra: chips })}
    ${body}`;
}

const tagsView = () => tagView('');

function listView(id) {
  const list = findList(id);
  if (!list) return listsView();
  const mode = LIST_SORTS.some(([key]) => key === list.sort) ? list.sort : 'manual';
  const inList = state.tasks.filter((t) => t.listId === id && !t.deletedAt);
  const tasks = sortTasks(inList.filter((t) => t.status === 'open'), mode);
  const done = inList.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const sortName = LIST_SORTS.find(([key]) => key === mode)[1];
  const sortNote = mode === 'manual' ? '' : `<div class="sort-note"><button class="chip" data-action="list-sort-sheet" data-id="${id}">${ico('sort')}Por ${escapeHtml(sortName.toLowerCase())}${ico('down')}</button><button class="link" data-action="set-list-sort" data-id="${id}" data-sort="manual" style="margin-left:auto">Voltar à minha ordem</button></div>`;
  const doneOpen = state.doneOpen.has(id);
  const sub = [`${tasks.length} ${tasks.length === 1 ? 'aberta' : 'abertas'}`, list.group ? `grupo ${list.group}` : '', sortName.toLowerCase()].filter(Boolean).join(' · ');
  const tools = `
    <button class="hero-btn" data-action="list-sort-sheet" data-id="${id}" aria-label="Ordenar" title="Ordenar">${ico('sort')}</button>
    ${heroSelect(tasks)}
    <button class="hero-btn" data-action="list-menu" data-id="${id}" aria-label="Opções da lista ${escapeHtml(list.name)}" title="Opções da lista">${MORE_ICON}</button>`;
  return `
    ${pageHero({ back: ['#lists', 'Listas'], title: escapeHtml(list.name), sub: escapeHtml(sub), tools, lead: `<span class="hero-square" aria-hidden="true">${list.emoji ? escapeHtml(list.emoji) : (id === INBOX ? ico('inbox') : escapeHtml(initial(list.name)))}</span>` })}
    ${sortNote}
    ${tasks.length ? taskListHtml(tasks, { draggable: mode === 'manual', noDate: true }) : `<p class="empty">${done.length ? 'Tudo feito nesta lista.' : 'Esta lista está vazia.'}</p>`}
    ${done.length ? `
    <button class="pill-btn done-pill" data-action="toggle-done-section" data-id="${id}" aria-expanded="${doneOpen}">${ico(doneOpen ? 'down' : 'right')}Concluídas (${done.length})</button>
    ${doneOpen ? taskListHtml(done, {}) : ''}` : ''}
    ${quickAdd(`Anotar em ${list.name}…`, { listId: id })}`;
}

/** Inicial do nome da lista, para o quadradinho sem emoji. */
const initial = (name) => (String(name || '?').trim().charAt(0) || '?').toLocaleUpperCase('pt-BR');

/** Listas fora da Entrada, separadas em soltas e por grupo, na ordem escolhida. */
function groupedLists() {
  const custom = sortedLists().filter((l) => l.id !== INBOX);
  const ungrouped = custom.filter((l) => !l.group);
  const groups = new Map();
  custom.filter((l) => l.group).forEach((l) => groups.set(l.group, [...(groups.get(l.group) || []), l]));
  return { ungrouped, groups: [...groups].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')) };
}

const openCount = (id) => state.tasks.filter((t) => t.listId === id && t.status === 'open' && !t.deletedAt).length;

function listsView() {
  const { ungrouped, groups } = groupedLists();
  const row = (list) => `
    <div class="lr">
      ${listSquare(list)}
      <a class="nm" href="#list/${list.id}"><span>${escapeHtml(list.name)}</span></a>
      <span class="cnt">${openCount(list.id) || ''}</span>
      <button class="ib" data-action="list-menu" data-id="${list.id}" aria-label="Opções da lista ${escapeHtml(list.name)}" title="Opções da lista">${MORE_ICON}</button>
    </div>`;
  const inbox = findList(INBOX);
  const count = (n) => (n ? `<span>${n}</span>` : '');
  const trashCount = state.tasks.filter((t) => t.deletedAt).length;
  const listCount = ungrouped.length + groups.reduce((n, [, lists]) => n + lists.length, 0) + (inbox ? 1 : 0);
  const kicker = `${listCount} ${listCount === 1 ? 'lista' : 'listas'}${groups.length ? ` · ${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'}` : ''}`;
  const tiles = `
    <div class="hero-tiles">
      <a class="hero-tile" href="#important">${ico('star')}Importantes${count(openTasks().filter((t) => t.important).length)}</a>
      <a class="hero-tile" href="#tags">${ico('tag')}Tags${count(allTags().length)}</a>
      <a class="hero-tile" href="#done">${ico('done')}Concluídas</a>
      <a class="hero-tile" href="#trash">${ico('trash')}Lixeira${count(trashCount)}</a>
    </div>`;
  const tools = `${heroSearch()}<button class="hero-pill" data-action="organize-lists" ${ungrouped.length + groups.length ? '' : 'disabled'}>Organizar</button>`;
  return `
    ${pageHero({ kicker, title: 'Listas', tools, extra: tiles })}
    <div class="leaf-card rows-card">${inbox ? row(inbox) : ''}${ungrouped.map(row).join('')}</div>
    ${groups.map(([name, lists]) => `<div class="grp"><span>${escapeHtml(name)}</span><button class="ib" data-action="group-menu" data-group="${escapeHtml(name)}" aria-label="Opções do grupo ${escapeHtml(name)}" title="Opções do grupo">${MORE_ICON}</button></div><div class="leaf-card rows-card">${lists.map(row).join('')}</div>`).join('')}
    ${ungrouped.length + groups.length ? '' : '<p class="empty-tip">Crie listas para separar assuntos (Casa, Trabalho, Mercado). Para juntar listas, dê o mesmo nome de grupo a elas.</p>'}
    <button class="dashed-btn" data-action="new-list">${ico('plus')}Nova lista</button>`;
}

/** Organizar: mudar a ordem das listas e cuidar dos grupos. */
function organizeView() {
  const { ungrouped, groups } = groupedLists();
  const inbox = findList(INBOX);
  const section = (lists) => lists.map((list, index) => `
    <div class="lr organize-row">
      ${listSquare(list)}
      <span class="nm"><span>${escapeHtml(list.name)}</span></span>
      <button class="ib round-ib" data-action="move-list" data-id="${list.id}" data-step="-1" ${index === 0 ? 'disabled' : ''} aria-label="Subir ${escapeHtml(list.name)}">${ico('up')}</button>
      <button class="ib round-ib" data-action="move-list" data-id="${list.id}" data-step="1" ${index === lists.length - 1 ? 'disabled' : ''} aria-label="Descer ${escapeHtml(list.name)}">${ico('dn')}</button>
    </div>`).join('');
  const tools = `<button class="hero-pill" data-action="new-group">${ico('plus')}Novo grupo</button>`;
  return `
    ${pageHero({ back: ['#lists', 'Listas'], title: 'Organizar', sub: 'Mude a ordem com as setas ou junte listas em grupos', tools })}
    ${inbox ? `<div class="leaf-card rows-card"><div class="lr organize-row">${listSquare(inbox)}<span class="nm"><span>${escapeHtml(inbox.name)}</span></span><span class="help">sempre a primeira</span></div></div>` : ''}
    ${ungrouped.length ? `<div class="grp"><span>Sem grupo</span></div><div class="leaf-card rows-card">${section(ungrouped)}</div>` : ''}
    ${groups.map(([name, lists]) => `<div class="grp"><span>Grupo ${escapeHtml(name)}</span><button class="link" data-action="group-menu" data-group="${escapeHtml(name)}" aria-label="Opções do grupo ${escapeHtml(name)}">Editar grupo</button></div><div class="leaf-card rows-card">${section(lists)}</div>`).join('')}
    <p class="help" style="margin:12px 4px">Os grupos ficam em ordem alfabética.</p>
    <button class="dashed-btn" data-action="new-list">${ico('plus')}Nova lista</button>
    <a class="dark-btn" href="#lists">Pronto</a>`;
}

/** Grupo de uma data já passada: Hoje, Ontem, Esta semana, Semana passada ou o mês. */
function pastGroup(date) {
  const now = today();
  if (date === now) return 'Hoje';
  if (date === addDays(now, -1)) return 'Ontem';
  const weekStart = Number(state.settings.weekStart) === 1 ? 1 : 0;
  const [y, m, d] = now.split('-').map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() - weekStart + 7) % 7;
  const thisWeek = addDays(now, -back);
  if (date >= thisWeek) return 'Esta semana';
  if (date >= addDays(thisWeek, -7)) return 'Semana passada';
  const [yy, mm] = date.split('-').map(Number);
  const month = new Date(yy, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return month.charAt(0).toUpperCase() + month.slice(1);
}

function doneView() {
  const single = activeTasks().filter((t) => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const empty = !single.length && !state.log.length;
  const sub = empty ? '' : `${single.length} ${single.length === 1 ? 'tarefa' : 'tarefas'} · ${state.log.length} ${state.log.length === 1 ? 'repetição' : 'repetições'}`;
  const tools = `${single.length ? heroSelect(single) : ''}${empty ? '' : '<button class="hero-pill" data-action="clear-done">Limpar</button>'}`;
  const head = pageHero({ back: ['#lists', 'Listas'], title: 'Concluídas', sub, tools });
  if (empty) return `${head}<p class="empty">Nada concluído ainda.</p>`;
  if (state.selecting) return `${head}${taskListHtml(single, { showList: true })}`;
  const items = [
    ...single.map((task) => ({ at: task.completedAt || '', task })),
    ...state.log.map((item) => ({ at: item.completedAt || '', item })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  // Na coluna do ramo: a hora (hoje e ontem) ou o dia da semana / data.
  const when = (iso) => {
    if (!iso) return '';
    const date = localDate(new Date(iso));
    if (date === today() || date === addDays(today(), -1)) return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return shortDay(date);
  };
  const row = ({ task, item }) => {
    if (task) {
      return `
    <li class="task is-done" data-id="${task.id}">
      <span class="tm">${escapeHtml(when(task.completedAt))}</span>
      <button class="check done" data-action="reopen" data-id="${task.id}" aria-label="Reabrir ${escapeHtml(task.title)}">${MARK}</button>
      <button class="task-body" data-action="open" data-id="${task.id}"><span class="task-title">${escapeHtml(task.title)}</span><span class="chips">${listChip(findList(task.listId))}</span></button>
      <button class="btn small text" data-action="reopen" data-id="${task.id}">Reabrir</button>
    </li>`;
    }
    const source = findTask(item.taskId);
    const occurrence = item.occurrence ? formatDate(item.occurrence).toLowerCase() : '';
    return `
    <li class="task is-done">
      <span class="tm">${escapeHtml(when(item.completedAt))}</span>
      <span class="check done" aria-hidden="true">${MARK}</span>
      <button class="task-body" data-action="${source && !source.deletedAt ? 'open' : 'noop'}" data-id="${item.taskId}"><span class="task-title">${escapeHtml(item.title)}</span><span class="chips"><span>${ico('repeat')}repetição ${occurrence === 'hoje' ? 'de hoje' : `de ${escapeHtml(occurrence)}`}</span>${source ? listChip(findList(source.listId)) : ''}</span></button>
      <button class="icon" data-action="forget-log" data-id="${item.id}" aria-label="Apagar do histórico: ${escapeHtml(item.title)}" title="Apagar do histórico">${ico('x')}</button>
    </li>`;
  };
  const groups = new Map();
  items.forEach((entry) => {
    const name = entry.at ? pastGroup(localDate(new Date(entry.at))) : 'Sem data';
    groups.set(name, [...(groups.get(name) || []), entry]);
  });
  return `${head}<ul class="task-list ramo ramo-days" aria-label="Concluídas">${[...groups].map(([name, list], index) => `${ramoDay('', name, 0, index === 0)}${list.map(row).join('')}`).join('')}</ul>`;
}

function trashView() {
  const tasks = state.tasks.filter((t) => t.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const card = (task) => `
    <article class="leaf-card trash-card">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <span class="chips"><span>excluída ${escapeHtml(formatDate(localDate(new Date(task.deletedAt))).toLowerCase())}</span>${findList(task.listId) ? listChip(findList(task.listId)) : '<span>lista excluída: volta para a Entrada</span>'}</span>
      <div class="actions">
        <button class="pill-btn small" data-action="restore" data-id="${task.id}">${ico('undo')}Restaurar</button>
        <button class="btn small text danger" data-action="purge" data-id="${task.id}">Excluir de vez</button>
      </div>
    </article>`;
  const extra = tasks.length ? `
    <div class="hero-actions">
      <button class="hero-action on" data-action="restore-all">${ico('undo')}Restaurar tudo</button>
      <button class="hero-action" data-action="empty-trash">Esvaziar</button>
    </div>` : '';
  return `
    ${pageHero({ back: ['#lists', 'Listas'], title: 'Lixeira', sub: tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'tarefa' : 'tarefas'}` : '', extra })}
    ${tasks.length ? tasks.map(card).join('') : '<p class="empty">A lixeira está vazia.</p>'}`;
}

const foldText = (value) => (value || '').toLocaleLowerCase('pt-BR');

/** Texto com o termo da busca destacado, já escapado. */
function markText(text, query) {
  const source = String(text || '');
  const lower = foldText(source);
  if (!query || lower.length !== source.length) return escapeHtml(source);
  let html = '';
  let from = 0;
  let at = lower.indexOf(query);
  while (at >= 0) {
    html += `${escapeHtml(source.slice(from, at))}<mark>${escapeHtml(source.slice(at, at + query.length))}</mark>`;
    from = at + query.length;
    at = lower.indexOf(query, from);
  }
  return html + escapeHtml(source.slice(from));
}

/** Onde mais o termo apareceu, quando não foi no título: "Nas notas: “…”". */
function searchSnippet(task, query) {
  if (foldText(task.title).includes(query)) return '';
  const around = (text) => {
    const at = foldText(text).indexOf(query);
    const start = Math.max(0, at - 24);
    const end = Math.min(text.length, at + query.length + 24);
    return `“${start > 0 ? '…' : ''}${markText(text.slice(start, end).replace(/\s+/g, ' '), query)}${end < text.length ? '…' : ''}”`;
  };
  if (foldText(task.notes).includes(query)) return `<span class="snippet">Nas notas: ${around(task.notes)}</span>`;
  const step = (task.steps || []).find((s) => foldText(s.title).includes(query));
  if (step) return `<span class="snippet">Na etapa: ${around(step.title)}</span>`;
  return '';
}

function searchResults() {
  const query = foldText(state.search.trim());
  if (!query) return '<p class="help" style="text-align:center;margin-top:18px">Busca no título, nas notas, nas etapas, nas tags e no nome da lista.</p>';
  const matches = (task) => [task.title, task.notes, listName(task.listId), ...(task.steps || []).map((s) => s.title), ...(task.tags || [])]
    .some((text) => foldText(text).includes(query));
  const withDone = !!state.settings.searchDone;
  const tasks = state.tasks.filter((t) => !t.deletedAt && (t.status === 'open' || (withDone && t.status === 'done')) && matches(t))
    .sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || byOrder(a, b));
  const label = `${tasks.length} ${withDone ? '' : (tasks.length === 1 ? 'aberta ' : 'abertas ')}${tasks.length === 1 ? 'encontrada' : 'encontradas'}`;
  return `<h2 class="section-label search-meta">${tasks.length ? label : `Nenhuma tarefa ${withDone ? '' : 'aberta '}encontrada`}</h2>
    ${tasks.length ? taskListHtml(tasks, { showList: true, mark: query, snippet: (task) => searchSnippet(task, query) }) : ''}`;
}

function searchView() {
  return `
    <header class="hero hero-page hero-search">
      <h1 class="visually-hidden">Busca</h1>
      <div class="hero-bar">
        <button class="hero-btn" data-action="go-back" aria-label="Voltar" title="Voltar">${ico('left')}</button>
        <label class="search-box">${ico('search')}<input id="search-input" type="search" placeholder="Buscar tarefas" aria-label="Buscar tarefas" value="${escapeHtml(state.search)}" autocomplete="off" enterkeyhint="search">
          ${state.search ? `<button type="button" class="ib" data-action="search-clear" aria-label="Limpar a busca">${ico('x')}</button>` : ''}</label>
      </div>
      <label class="hero-switch"><span class="grow">Incluir concluídas</span><input type="checkbox" class="sw" role="switch" id="search-done" ${state.settings.searchDone ? 'checked' : ''}></label>
    </header>
    <div id="search-results">${searchResults()}</div>`;
}

function syncStatusText() {
  const { state: current, message, at } = syncEngine.status;
  if (current === 'running') return 'Sincronizando...';
  if (current === 'error' || current === 'offline') return message;
  if (current === 'ok' && at) return `Sincronizado às ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`;
  return 'Conectado.';
}

const switchRow = (id, title, help, on, extra = '') => `
  <label class="sr"><span class="grow">${title}${help ? `<small>${help}</small>` : ''}</span>${extra}<input type="checkbox" class="sw" role="switch" id="${id}" ${on ? 'checked' : ''}></label>`;

function syncPanel() {
  if (!state.sync?.token) {
    return `
    <section class="panel">
      <h3>Entrar</h3>
      <p>Entre com sua conta para manter o note e os celulares iguais. Depois de entrar, o aparelho fica conectado.</p>
      <div class="field"><label for="sync-login">Login</label><input id="sync-login" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
      <div class="field" style="margin-top:8px"><label for="sync-password">Senha</label><input id="sync-password" type="password" autocomplete="current-password"></div>
      <div class="actions" style="margin-top:10px"><button class="btn primary" data-action="sync-login">Entrar</button></div>
    </section>
    <section class="panel">
      ${googleReady() ? '<p class="help" style="margin:14px 0 6px">Ou, se você já ligou sua conta Google em outro aparelho:</p><div class="google-btn" id="google-login-btn"></div>' : ''}
      <h3>Primeira vez</h3>
      <p>Crie a conta no aparelho que tem suas tarefas, preenchendo login e senha acima. Use ao menos 12 caracteres. Só existe uma conta, e a senha não pode ser recuperada pelo app.</p>
      <div class="field"><label for="sync-password-2">Repita a senha</label><input id="sync-password-2" type="password" autocomplete="new-password"></div>
      <div class="actions" style="margin-top:10px"><button class="btn" data-action="sync-register">Criar conta</button></div>
    </section>`;
  }
  return `
    <section class="panel">
      <div class="nr" style="padding:0;min-height:0;margin:0 0 12px;background:none"><span class="ico">${ico('repeat')}</span>
        <span class="grow"><strong>Conectado como ${escapeHtml(state.sync.login)}</strong><small id="sync-status" role="status">${escapeHtml(syncStatusText())}</small></span></div>
      <div class="actions">
        <button class="btn small primary" data-action="sync-now">${ico('repeat')}Sincronizar agora</button>
        <button class="btn small" data-action="sync-toggle-password">Trocar senha</button>
        <button class="btn small text danger" data-action="sync-logout">Sair</button>
      </div>
      ${state.showPasswordForm ? `
      <div class="field" style="margin-top:12px"><label for="sync-current">Senha atual</label><input id="sync-current" type="password" autocomplete="current-password"></div>
      <div class="field" style="margin-top:8px"><label for="sync-new">Nova senha</label><input id="sync-new" type="password" autocomplete="new-password"></div>
      <div class="field" style="margin-top:8px"><label for="sync-new-2">Repita a nova senha</label><input id="sync-new-2" type="password" autocomplete="new-password"></div>
      <div class="actions" style="margin-top:10px"><button class="btn" data-action="sync-change-password">Salvar nova senha</button></div>` : ''}
    </section>
    ${googleAccountPanel()}`;
}

/* ---------- Conta Google e Google Drive ---------- */

async function refreshGoogleStatus() {
  if (!state.sync?.token || !googleReady()) return;
  try {
    state.google = await callServer('/google/status', {}, state.sync.token);
  } catch (error) {
    state.google = { error: error.message };
  }
  const route = currentRoute();
  if (route.name === 'settings' && ['conta', 'dados'].includes(route.id)) render();
}

function googleAccountPanel() {
  if (!googleReady()) return '';
  const g = state.google;
  let body = '<p>Carregando…</p>';
  if (g?.error) body = `<p>${escapeHtml(g.error)}</p>`;
  else if (g?.google) {
    body = `<p>Ligada a <b>${escapeHtml(g.google.email)}</b>. Nos outros aparelhos, toque em “Entrar com Google”. O login com senha continua valendo.</p>
      <div class="actions"><button class="btn small text danger" data-action="google-unlink">Desligar a conta Google</button></div>`;
  } else if (g) {
    body = `<p>Ligue sua conta Google para entrar nos outros aparelhos sem digitar a senha.</p><div class="google-btn" id="google-link-btn"></div>`;
  }
  return `<section class="panel"><h3>Conta Google</h3>${body}</section>`;
}

function drivePanel() {
  if (!googleReady()) return '';
  if (!state.sync?.token) {
    return '<section class="panel"><h3>Google Drive</h3><p>Entre na sua conta, em Conta e sincronização, para guardar backups no Google Drive.</p></section>';
  }
  const g = state.google;
  let body = '<p>Carregando…</p>';
  if (g?.error) body = `<p>${escapeHtml(g.error)}</p>`;
  else if (g?.drive) {
    const d = g.drive;
    const last = d.lastBackup
      ? `Último backup: ${formatDate(localDate(new Date(d.lastBackup))).toLowerCase()} às ${new Date(d.lastBackup).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${d.counts ? ` (${d.counts.tasks} tarefas, ${d.counts.lists} listas)` : ''}.`
      : 'Nenhum backup ainda.';
    body = `<p>Conectado${d.email ? ` a <b>${escapeHtml(d.email)}</b>` : ''}. O servidor guarda um backup por dia, depois das 3h, na pasta “Minha lista de afazeres” do seu Drive, e mantém os últimos 30.</p>
      <p>${escapeHtml(last)}</p>
      ${d.lastError ? `<p class="help-warning">Última tentativa falhou: ${escapeHtml(d.lastError)}</p>` : ''}
      <div class="actions">
        <button class="btn small primary" data-action="drive-backup" style="flex:1">Fazer backup agora</button>
        <button class="btn small" data-action="drive-restore" style="flex:1">Restaurar</button>
      </div>
      <button class="link danger" data-action="drive-disconnect" style="margin-top:8px">Desconectar o Google Drive</button>`;
  } else if (g) {
    body = `<p>Guarde uma cópia das tarefas no seu Google Drive todo dia, automaticamente, mesmo com o app fechado. O app só enxerga os arquivos que ele mesmo cria.</p>
      ${g.secretReady ? '' : '<p class="help-warning">Falta um passo no servidor (o segredo do Google). Veja o README.</p>'}
      <button class="btn small primary" data-action="drive-connect" ${g.secretReady ? '' : 'disabled'}>Conectar Google Drive</button>`;
  }
  return `<section class="panel"><h3>Google Drive</h3>${body}</section>`;
}

/* Backup do Drive atrasado: aviso em Hoje e em Config. quando o último tem mais de 3 dias. */
const DRIVE_LATE_DAYS = 3;
function driveLate() {
  const d = state.google?.drive;
  if (!state.sync?.token || !d) return null;
  if (!d.lastBackup) return d.lastError ? { days: null, error: d.lastError } : null;
  const days = Math.floor((Date.now() - new Date(d.lastBackup).getTime()) / 86400000);
  return days > DRIVE_LATE_DAYS ? { days, error: d.lastError || '' } : null;
}

function driveWarning() {
  const late = driveLate();
  if (!late) return '';
  const when = late.days === null ? 'O backup no Google Drive ainda não deu certo' : `O último backup no Google Drive foi há ${late.days} dias`;
  return `<a class="drive-warning" href="#settings/dados">${ico('alert')}<span class="grow"><b>${escapeHtml(when)}</b><small>${late.error ? `Erro: ${escapeHtml(late.error)} · ` : ''}Toque para ver em Config. › Dados.</small></span>${ico('right')}</a>`;
}

/** Busca o status do Google (e do backup no Drive) ao abrir o app, no máximo uma vez por hora. */
async function checkDriveHealth() {
  if (!state.sync?.token || !googleReady() || !navigator.onLine) return;
  if (state.google && Date.now() - (state.googleAt || 0) < 3600000) return;
  const before = !!driveLate();
  try {
    state.google = await callServer('/google/status', {}, state.sync.token);
    state.googleAt = Date.now();
  } catch {
    return;
  }
  if (before !== !!driveLate()) render();
}

/* ---------- Aparelhos conectados (v21) ---------- */

function lastUseText(time) {
  const day = localDate(new Date(time));
  const hour = new Date(time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (day === today()) return `hoje às ${hour}`;
  if (day === addDays(today(), -1)) return `ontem às ${hour}`;
  const days = Math.round((Date.now() - time) / 86400000);
  return days < 30 ? `há ${days} dias` : formatDate(day).toLowerCase();
}

function devicesPanel() {
  if (!state.sync?.token) return '';
  const data = state.devices;
  let body = '<p>Carregando…</p>';
  if (data?.error) body = `<p>${escapeHtml(data.error)}</p>`;
  else if (data?.sessions) {
    const others = data.sessions.filter((item) => !item.current);
    body = `<p>Cada aparelho sai sozinho depois de ${data.idleDays} dias sem abrir o app. Num celular perdido, toque em Sair nele: ele para de sincronizar e de receber avisos.</p>
      <ul class="device-list">${data.sessions.map((item) => `
        <li class="device">
          <span class="ico">${ico(/Android|iPhone/.test(item.name) ? 'phone' : 'laptop')}</span>
          <span class="grow"><strong>${escapeHtml(item.name)}${item.current ? ' <span class="chip-here">este aparelho</span>' : ''}</strong>
            <small>${item.name === 'Aparelho' ? 'Ainda não abriu o app desde a atualização de 11/11; o nome aparece quando abrir' : `Último uso ${escapeHtml(lastUseText(item.lastUsed))}`} · conectado desde ${escapeHtml(formatDate(localDate(new Date(item.createdAt))).toLowerCase())}</small></span>
          ${item.current ? '' : `<button class="btn small text danger" data-action="device-revoke" data-id="${item.id}" data-name="${escapeHtml(item.name)}">Sair</button>`}
        </li>`).join('')}</ul>
      ${others.length ? `<div class="actions"><button class="btn small danger" data-action="devices-revoke-others">Sair dos outros aparelhos (${others.length})</button></div>` : '<p class="help">Só este aparelho está conectado.</p>'}`;
  }
  return `<section class="panel" id="devices-panel"><h3>Aparelhos conectados</h3>${body}</section>`;
}

async function loadDevices(force = false) {
  if (!state.sync?.token || (state.devicesLoading && !force)) return;
  state.devicesLoading = true;
  state.devicesFor = state.sync.token;
  try {
    state.devices = await callServer('/sessions/list', {}, state.sync.token);
  } catch (error) {
    state.devices = { error: error.message };
  } finally {
    state.devicesLoading = false;
  }
  const route = currentRoute();
  if (route.name === 'settings' && route.id === 'conta') render();
}

const deviceActions = {
  'device-revoke': async (el) => {
    if (!confirm(`Tirar "${el.dataset.name}" da conta? Ele para de sincronizar e de receber avisos até entrar de novo.`)) return;
    try {
      state.devices = await callServer('/sessions/revoke', { id: el.dataset.id }, state.sync.token);
      showToast(`${el.dataset.name} saiu da conta.`);
    } catch (error) {
      showToast(error.message);
    }
    render();
  },
  'devices-revoke-others': async () => {
    if (!confirm('Sair de todos os outros aparelhos? Eles param de sincronizar e de receber avisos até entrar de novo. Este aparelho continua conectado.')) return;
    try {
      state.devices = await callServer('/sessions/revoke-others', {}, state.sync.token);
      // Os avisos inscritos antes da v21 saem junto; este aparelho se inscreve de novo.
      if (state.push?.enabled) await refreshSubscription(state.sync.token).catch(() => {});
      showToast('Pronto: só este aparelho continua conectado.');
    } catch (error) {
      showToast(error.message);
    }
    render();
  },
};

/** Depois de desenhar Config., coloca os botões oficiais do Google e busca o status. */
function mountGoogle() {
  const route = currentRoute();
  // Lista de aparelhos: busca ao abrir Conta (de novo se a sessão mudou).
  if (route.name === 'settings' && route.id === 'conta' && state.sync?.token && state.devicesFor !== state.sync.token && !state.devicesLoading) loadDevices();
  if (route.name !== 'settings' || !['conta', 'dados'].includes(route.id) || !googleReady()) return;
  loadGoogle().catch(() => {});
  if (state.sync?.token && !state.googleFetching && (!state.google || Date.now() - (state.googleAt || 0) > 60000)) {
    state.googleFetching = true;
    state.googleAt = Date.now();
    refreshGoogleStatus().finally(() => { state.googleFetching = false; });
  }
  renderGoogleButton($('#google-login-btn'), (credential) => loginWithGoogle(credential), 'signin_with').catch(() => {});
  renderGoogleButton($('#google-link-btn'), async (credential) => {
    try {
      const { email } = await callServer('/google/link', { credential }, state.sync.token);
      showToast(`Conta Google ligada: ${email}.`);
    } catch (error) {
      showToast(error.message);
    }
    state.googleAt = 0;
    refreshGoogleStatus();
  }, 'continue_with').catch(() => {});
}

const googleActions = {
  'google-unlink': async () => {
    if (!confirm('Desligar a conta Google? Para entrar nos outros aparelhos, use login e senha.')) return;
    try {
      await callServer('/google/unlink', {}, state.sync.token);
      showToast('Conta Google desligada.');
    } catch (error) {
      showToast(error.message);
    }
    refreshGoogleStatus();
  },
  'drive-connect': async () => {
    let code;
    try {
      code = await requestDriveCode();
    } catch (error) {
      showToast(error.message);
      return;
    }
    showToast('Conectando e fazendo o primeiro backup…');
    try {
      const result = await callServer('/drive/connect', { code }, state.sync.token);
      showToast(result.error || `Google Drive conectado. Primeiro backup: ${result.backup?.counts?.tasks ?? 0} tarefas.`);
    } catch (error) {
      showToast(error.message);
    }
    refreshGoogleStatus();
  },
  'drive-backup': async (el) => {
    el.disabled = true;
    try {
      // Envia antes o que ainda está só neste aparelho.
      await syncEngine.run();
      const { backup } = await callServer('/drive/backup', {}, state.sync.token);
      showToast(`Backup salvo no Drive: ${backup.counts.tasks} tarefas.`);
    } catch (error) {
      showToast(error.message);
    }
    refreshGoogleStatus();
  },
  'drive-restore': async () => {
    let files;
    try {
      ({ files } = await callServer('/drive/list', {}, state.sync.token));
    } catch (error) {
      showToast(error.message);
      return;
    }
    if (!files.length) {
      showToast('Nenhum backup no Drive ainda.');
      return;
    }
    openSheet('Restaurar do Google Drive', files.map((file) => {
      const day = (file.name.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
      const label = day ? capitalize(formatDate(day)) : file.name;
      return [label, async () => {
        $('#dialog').close();
        try {
          const { data } = await callServer('/drive/file', { id: file.id }, state.sync.token);
          await importPayload(data, `do backup de ${label.toLowerCase()}`);
        } catch (error) {
          showToast(error.message);
        }
      }];
    }), 'Volta o que não existe mais aqui; o que já existe fica como está. Nada é apagado.');
  },
  'drive-disconnect': async () => {
    if (!confirm('Desconectar o Google Drive? Os backups que já estão lá continuam no seu Drive.')) return;
    try {
      await callServer('/drive/disconnect', {}, state.sync.token);
      showToast('Google Drive desconectado.');
    } catch (error) {
      showToast(error.message);
    }
    refreshGoogleStatus();
  },
};

function pushPanel() {
  const settings = pushSettings();
  const head = '<span class="lbl">Com o app fechado</span>';
  if (!pushSupported()) return `<section class="panel">${head}<p>Este navegador não recebe avisos com o app fechado.</p></section>`;
  if (!state.sync?.token) return `<section class="panel">${head}<p>Os avisos saem do servidor de sincronização. Entre na sua conta, em Conta e sincronização, para ativar.</p></section>`;
  const on = !!state.push?.enabled;
  const devices = state.push?.devices;
  return `
    <section class="panel">
      ${head}
      ${switchRow('push-enabled', 'Receber neste aparelho', on && devices ? `Aparelhos inscritos na conta: ${devices}` : 'Avisa com até 1 minuto de atraso', on)}
      <div class="sr" style="display:block"><span>Insistir a cada</span><small>Para as tarefas marcadas com “Insistir até eu reagir”, até ${INSIST_MAX} vezes</small>
        <div class="segments" role="group" aria-label="Intervalo da insistência" style="margin:8px 0 0">
          ${[5, 10, 15, 30].map((minutes) => `<button class="${minutes === settings.insistMinutes ? 'on' : ''}" data-action="set-insist" data-minutes="${minutes}" aria-pressed="${minutes === settings.insistMinutes}">${minutes} min</button>`).join('')}
        </div></div>
      ${switchRow('push-digest', 'Resumo do dia', 'As tarefas de Hoje numa notificação', settings.digest, `<input type="time" class="time-in" id="push-digest-time" aria-label="Horário do resumo" value="${settings.digestTime}" ${settings.digest ? '' : 'disabled'}>`)}
      ${on ? '<button class="btn" data-action="push-test" style="width:100%;margin-top:10px">Testar com o app fechado</button>' : ''}
      <p class="help" style="margin:10px 0 0">O resumo e a insistência valem para todos os aparelhos da conta.</p>
    </section>`;
}

async function changePushSettings(changes) {
  const settings = normalizePushSettings({ ...pushSettings(), ...changes });
  try {
    await savePushSettings(state.sync.token, settings);
  } catch (error) {
    render();
    return showToast(error.message);
  }
  await savePushLocal({ ...pushLocal(), settings, hash: null });
  render();
  await refreshPushSchedule(true);
  return undefined;
}

async function togglePush(enabled) {
  try {
    if (enabled) {
      const { devices } = await enablePush(state.sync.token);
      const { settings } = await fetchPushState(state.sync.token);
      await savePushLocal({ ...pushLocal(), enabled: true, devices, settings, hash: null });
      await refreshPushSchedule(true);
      showToast('Pronto. Este aparelho recebe os lembretes com o app fechado.');
    } else {
      await disablePush(state.sync.token);
      await savePushLocal({ ...pushLocal(), enabled: false });
      showToast('Este aparelho não recebe mais avisos com o app fechado.');
    }
  } catch (error) {
    showToast(error.message);
  }
  render();
}

/** Config. › Aparência: modo, cor de destaque e tamanho da letra. */
function appearancePanels() {
  const mode = normalizeMode(state.settings.mode);
  const accent = normalizeAccent(state.settings.accent);
  const dark = resolveMode(mode, prefersDark()) === 'dark';
  const prev = (kind) => `<span class="mode-prev ${kind}"><span class="t"></span><span class="r"></span><span class="r"></span></span>`;
  const preview = { light: prev('claro'), dark: prev('escuro'), auto: `<span class="mode-prev auto">${prev('claro')}${prev('escuro')}</span>` };
  const size = textSize();
  return `
    <section class="panel">
      <span class="lbl">Modo</span>
      <div class="mode-grid" role="radiogroup" aria-label="Modo">
        ${MODES.map(([id, name]) => `<button type="button" class="mode-card" role="radio" aria-checked="${id === mode}" data-action="set-mode" data-mode="${id}">${preview[id]}<b>${name}</b></button>`).join('')}
      </div>
      <p class="help" style="margin:10px 0 0">Automático segue o modo do celular.</p>
    </section>
    <section class="panel">
      <span class="lbl">Cor de destaque</span>
      <div class="accent-grid" role="radiogroup" aria-label="Cor de destaque">
        ${ACCENTS.map((item) => `<button type="button" class="accent-btn" role="radio" aria-checked="${item.id === accent}" data-action="set-accent" data-accent="${item.id}" style="--c:${dark ? item.dark : item.light}"><span class="sw">${ico('check')}</span>${item.name}</button>`).join('')}
      </div>
      <p class="help" style="margin:12px 0 0">Muda botões, marcas e lembretes. No modo escuro, cada cor tem uma versão clara própria.</p>
    </section>
    <section class="panel">
      <span class="lbl">Tamanho da letra</span>
      <div class="text-size">
        <button type="button" class="size-btn" data-action="set-font-size" data-size="${size - 1}" ${size <= 1 ? 'disabled' : ''} aria-label="Letra menor" title="Letra menor"><span style="font-size:.85rem">A</span>${ico('down')}</button>
        <div class="size-steps" aria-hidden="true">${TEXT_SIZES.map((_, index) => `<i class="${index < size ? 'on' : ''}"></i>`).join('')}</div>
        <button type="button" class="size-btn" data-action="set-font-size" data-size="${size + 1}" ${size >= TEXT_SIZES.length ? 'disabled' : ''} aria-label="Letra maior" title="Letra maior"><span style="font-size:1.2rem">A</span>${ico('up')}</button>
      </div>
      <p class="size-now" role="status">Tamanho ${size} de ${TEXT_SIZES.length}${size === DEFAULT_TEXT_SIZE ? ' (padrão)' : ''}</p>
      <div class="size-preview" aria-hidden="true"><span class="task-title">Pagar conta de luz</span><span class="chips"><span>hoje às 18:00 · Casa</span></span></div>
    </section>`;
}

const SETTINGS_PAGES = [
  ['geral', 'Geral', 'sliders'], ['aparencia', 'Aparência', 'sun'], ['avisos', 'Avisos', 'bell'],
  ['conta', 'Conta e sincronização', 'repeat'], ['dados', 'Dados', 'folder'],
];

function notificationState() {
  const support = 'Notification' in window;
  return support ? Notification.permission : 'unsupported';
}

function settingsView(page) {
  const title = (name, sub = '') => pageHero({ back: ['#settings', 'Config.'], title: name, sub });
  const segmented = (label, action, options, current, dataKey = 'value') => `
      <div class="segments" role="group" aria-label="${label}">
        ${options.map(([id, name]) => `<button class="${String(id) === String(current) ? 'on' : ''}" data-action="${action}" data-${dataKey}="${id}" aria-pressed="${String(id) === String(current)}">${name}</button>`).join('')}
      </div>`;
  const startView = START_VIEWS.some(([id]) => id === state.settings.startView) ? state.settings.startView : 'today';
  const permission = notificationState();

  if (page === 'geral') {
    return `${title('Geral')}
    <section class="panel">
      <span class="lbl">Ao abrir o app, mostrar</span>
      ${segmented('Tela inicial', 'set-start-view', START_VIEWS.map(([id, name]) => [id, id === 'upcoming' ? 'Próximos' : name]), startView)}
      <label class="lbl" for="default-list">Tarefas novas vão para</label>
      <div class="field"><select id="default-list">
        ${sortedLists().map((list) => `<option value="${list.id}" ${list.id === defaultListId() ? 'selected' : ''}>${escapeHtml(`${list.emoji ? `${list.emoji} ` : ''}${list.name}`)}</option>`).join('')}
      </select></div>
      <p class="help" style="margin:4px 0 14px">Vale para Hoje, o atalho do ícone e o que vier de “Compartilhar”.</p>
      <span class="lbl">Depois de anotar no campo Anotar</span>
      ${segmented('Depois de anotar', 'set-after-add', [['open', 'Abrir a tarefa'], ['keep', 'Continuar anotando']], afterAdd())}
      <p class="help" style="margin:4px 0 14px">${afterAdd() === 'open' ? 'A tarefa abre para você completar dia, hora e repetição.' : 'O campo continua pronto para a próxima tarefa.'}</p>
      <label class="sr" style="border:0;padding:0"><span class="grow">Horário sugerido para lembrar<small>Ao escolher a data, a Hora e o Lembrar já vêm com ele.</small></span><input type="time" class="time-in" id="default-remind-time" value="${defaultRemindTime()}"></label>
    </section>
    <section class="panel">
      <span class="lbl">A semana começa no</span>
      ${segmented('Início da semana', 'set-week-start', [[0, 'Domingo'], [1, 'Segunda']], Number(state.settings.weekStart) === 1 ? 1 : 0)}
      ${switchRow('parse-dates', 'Entender datas ao digitar', '“pagar luz sexta 9h” vira data e lembrete', state.settings.parseDates !== false)}
      ${switchRow('confirm-delete', 'Perguntar antes de excluir', 'Antes de mandar uma tarefa para a Lixeira', !!state.settings.confirmDelete)}
      <div class="sr" style="display:block"><span>Deslizar para a esquerda</span>
        <div style="margin-top:8px">${segmented('Deslizar para a esquerda', 'set-swipe-left', [['tomorrow', 'Adiar para amanhã'], ['trash', 'Mandar para a Lixeira']], swipeLeft())}</div></div>
    </section>
    <section class="panel">
      <span class="lbl">Campo Até na tarefa</span>
      <div class="segments" role="group" aria-label="Modo do campo Até">
        ${Object.entries(UNTIL_MODES).map(([id, [name]]) => `<button class="${id === untilMode() ? 'on' : ''}" data-action="set-until-mode" data-mode="${id}" aria-pressed="${id === untilMode()}">${name}</button>`).join('')}
      </div>
      <p class="help" style="margin:0">${UNTIL_MODES[untilMode()][1]}</p>
    </section>
    <p class="help" style="text-align:center">No teclado do note: N cria uma tarefa e / abre a busca.</p>`;
  }
  if (page === 'aparencia') return `${title('Aparência')}${appearancePanels()}`;
  if (page === 'avisos') {
    const status = {
      granted: ['Notificações ativadas neste aparelho', 'var(--primary)'],
      denied: ['Notificações bloqueadas', 'var(--danger)'],
      default: ['Notificações ainda não ativadas', 'var(--muted)'],
      unsupported: ['Este navegador não oferece notificações', 'var(--muted)'],
    }[permission];
    return `${title('Avisos')}
    <section class="panel">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span class="list-dot" style="--dot:${status[1]}"></span><strong>${status[0]}</strong></div>
      <p>${permission === 'denied' ? 'Libere nas configurações do navegador. ' : ''}Com o app aberto, os avisos chegam na hora. Os atrasados aparecem em destaque em Hoje.</p>
      <div class="sr" style="display:block;border-top:1px solid var(--line);border-bottom:0;margin-bottom:6px"><span>Segundo botão do aviso</span><small>O Android mostra só dois botões: Concluir e este.</small>
        <div style="margin-top:8px">${segmented('Segundo botão do aviso', 'set-notify-second', [['tomorrow', 'Amanhã'], [
          'snooze', `Adiar ${SNOOZE_MINUTES} min`]], notifySecond())}</div></div>
      <div class="actions">
        ${permission === 'default' ? `<button class="btn small primary" data-action="enable-notifications">${ico('bell')}Ativar notificações</button>` : ''}
        ${permission === 'granted' ? `<button class="btn small" data-action="test-notification">${ico('bell')}Enviar teste</button>` : ''}
      </div>
    </section>
    ${pushPanel()}`;
  }
  if (page === 'conta') return `${title('Conta e sincronização')}${syncPanel()}${devicesPanel()}`;
  if (page === 'dados') {
    const backup = state.settings.lastExport
      ? `Último backup: ${formatDate(localDate(new Date(state.settings.lastExport))).toLowerCase()}.`
      : 'Nenhum backup feito ainda.';
    const doneN = activeTasks().filter((t) => t.status === 'done').length;
    return `${title('Dados')}
    <section class="panel">
      <h3>Backup</h3>
      <p>${backup} ${state.sync?.token ? 'As tarefas também ficam guardadas no servidor da sincronização.' : 'Sem conta, os dados ficam só neste aparelho: limpar os dados do navegador apaga tudo.'}</p>
      <div class="actions">
        <button class="btn small" data-action="export" style="flex:1">Exportar</button>
        <button class="btn small" data-action="import" style="flex:1">Importar</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>
    ${drivePanel()}
    <section class="panel">
      <h3>Limpeza</h3>
      <p>Concluídas: ${doneN} ${doneN === 1 ? 'tarefa' : 'tarefas'} e ${state.log.length} ${state.log.length === 1 ? 'registro' : 'registros'} de repetição. Lixeira: ${state.tasks.filter((t) => t.deletedAt).length}.</p>
      <div class="actions">
        <button class="btn small" data-action="clear-done" style="flex:1">Limpar concluídas</button>
        <button class="btn small danger" data-action="empty-trash" style="flex:1">Esvaziar lixeira</button>
      </div>
    </section>
    <p class="help" style="text-align:center">${APP_NAME} · versão ${APP_VERSION} · <button class="link" data-action="check-update" style="min-height:0">Buscar atualização</button></p>`;
  }

  // Índice
  const startName = START_VIEWS.find(([id]) => id === startView)[1];
  const modeName = MODES.find(([id]) => id === normalizeMode(state.settings.mode))[1];
  const accentName = ACCENTS.find((item) => item.id === normalizeAccent(state.settings.accent)).name;
  const sizeName = `${textSize()} de ${TEXT_SIZES.length}`;
  const notify = { granted: 'Notificações ligadas', denied: 'Notificações bloqueadas', default: 'Notificações desligadas', unsupported: 'Sem notificações neste navegador' }[permission];
  const subtitles = {
    geral: `Abre em ${startName} · lembrar às ${defaultRemindTime()}`,
    aparencia: `${modeName} · ${accentName} · letra ${sizeName}`,
    avisos: `${notify}${state.push?.enabled ? ' · também com o app fechado' : ''}`,
    conta: state.sync?.token ? `Conectado como ${state.sync.login}` : 'Não conectado: as tarefas ficam só aqui',
    dados: driveLate() ? 'Backup do Google Drive atrasado' : 'Backup, limpeza da lixeira e das concluídas',
  };
  const banner = state.sync?.token
    ? `<section class="leaf-card big sync-card" aria-label="Sincronização"><span class="sync-leaf" aria-hidden="true">${ico('repeat')}</span><div class="grow"><b id="sync-status" role="status">${escapeHtml(syncStatusText())}</b><small>Conectado como ${escapeHtml(state.sync.login)} · iguais no note e nos celulares</small></div><button class="ib round-ib" data-action="sync-now" aria-label="Sincronizar agora" title="Sincronizar agora">${ico('repeat')}</button></section>`
    : '';
  return `
    ${pageHero({ kicker: APP_NAME, title: 'Config.' })}
    ${driveWarning()}
    ${banner}
    <nav class="leaf-card rows-card" aria-label="Partes da configuração">${SETTINGS_PAGES.map(([id, name, icon]) => `<a class="nr" href="#settings/${id}"><span class="ico">${ico(icon)}</span><span class="grow"><strong>${name}</strong><small>${escapeHtml(subtitles[id])}</small></span><span class="chev">${ico('right')}</span></a>`).join('')}</nav>
    <div style="text-align:center;margin-top:22px">
      <div class="help">${APP_NAME} · versão ${APP_VERSION}</div>
      <button class="link" data-action="check-update">Buscar atualização agora</button>
    </div>`;
}

const swipeLeft = () => (state.settings.swipeLeft === 'trash' ? 'trash' : 'tomorrow');

function currentRoute() {
  const hash = location.hash.slice(1) || 'today';
  const [name, id] = hash.split('/');
  return { name, id };
}

function renderNav() {
  const route = currentRoute();
  const isLists = ['lists', 'list', 'done', 'trash', 'important', 'tag', 'tags', 'organize'].includes(route.name);
  const dueCount = todayTasks(state.tasks, today()).length;
  const item = (href, label, active, { icon = '', emoji = '', dot = '', count = 0, badge = false, extra = '' } = {}) => {
    let lead = `<span class="nav-dot" style="--dot:${escapeHtml(dot || 'var(--muted)')}"></span>`;
    if (icon) lead = `<span class="pill">${ico(icon)}</span>`;
    else if (emoji) lead = `<span class="pill" aria-hidden="true">${escapeHtml(emoji)}</span>`;
    return `
    <a class="nav-item ${extra} ${active ? 'active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>
      ${lead}<span class="label">${escapeHtml(label)}</span>${badge && count ? `<span class="bd" aria-hidden="true">${count}</span>` : ''}${count ? `<span class="count">${count}</span>` : ''}
    </a>`;
  };
  const desktopList = (list) => item(`#list/${list.id}`, list.name, route.name === 'list' && route.id === list.id, {
    icon: list.id === INBOX && !list.emoji ? 'inbox' : '', emoji: list.emoji, dot: list.color, count: openCount(list.id), extra: 'nav-only-desktop',
  });
  const { ungrouped, groups } = groupedLists();
  const inbox = state.lists.find((l) => l.id === INBOX);
  const mobile = matchMedia('(max-width: 799px)').matches;
  $('#nav').innerHTML = `
    ${item('#today', 'Hoje', route.name === 'today', { icon: 'sun', count: dueCount, badge: true })}
    ${item('#upcoming', 'Próximos', route.name === 'upcoming', { icon: 'calendar' })}
    ${item('#important', 'Importantes', route.name === 'important', { icon: 'star', count: openTasks().filter((t) => t.important).length, extra: 'nav-only-desktop' })}
    ${inbox ? desktopList(inbox) : ''}
    ${ungrouped.map(desktopList).join('')}
    ${groups.map(([name, lists]) => `<span class="nav-group">${escapeHtml(name)}</span>${lists.map(desktopList).join('')}`).join('')}
    <button type="button" class="nav-add" data-action="anotar" aria-label="Anotar tarefa" title="Anotar tarefa">${ico('plus')}</button>
    ${item('#lists', 'Listas', route.name === 'lists' || (isLists && mobile), { icon: 'list' })}
    <span class="nav-spacer"></span>
    ${item('#done', 'Concluídas', route.name === 'done', { icon: 'done', extra: 'nav-only-desktop' })}
    ${item('#trash', 'Lixeira', route.name === 'trash', { icon: 'trash', extra: 'nav-only-desktop' })}
    ${item('#search', 'Busca', route.name === 'search', { icon: 'search', extra: 'nav-only-desktop' })}
    ${item('#settings', 'Config.', route.name === 'settings', { icon: 'sliders' })}`;
}

function render() {
  const route = currentRoute();
  const views = {
    today: todayView, upcoming: upcomingView, lists: listsView, done: doneView,
    trash: trashView, search: searchView, settings: () => settingsView(route.id),
    list: () => listView(route.id),
    important: importantView,
    tag: () => tagView(route.id),
    tags: tagsView,
    organize: organizeView,
  };
  renderNav();
  $('#view').innerHTML = (views[route.name] || todayView)();
  mountGoogle();
  document.body.classList.toggle('has-dock', !!$('#dock'));
  // Telas de edição (Config. por dentro e Organizar) escondem a barra e usam o voltar.
  document.body.classList.toggle('no-bar', (route.name === 'settings' && !!route.id) || route.name === 'organize');
  renderReminders();
  renderSelectionBar();
  if (anotarOpen) keepAnotarOpen();
  paintChrome();
  // Rola só na chegada: os redesenhos seguintes (sincronização, lembretes) não mexem na rolagem.
  if (route.name === 'upcoming' && route.id && state.dayScrolled !== location.hash) {
    state.dayScrolled = location.hash;
    scrollToDay(route.id);
  }
}

/** Barra do sistema na cor do cabeçalho de Hoje; nas outras telas, na cor do fundo. */
function paintChrome() {
  const hero = $('#view > .hero');
  const meta = $('meta[name="theme-color"]');
  const color = hero && !state.selecting ? getComputedStyle(hero).backgroundColor : CHROME[document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'];
  if (meta && color) meta.content = color;
}

/** Próximos › Lista rolado até o dia tocado na faixa da semana (ou o primeiro depois dele). */
function scrollToDay(date) {
  const heads = [...document.querySelectorAll('#view h2[data-day]')];
  const target = heads.find((h) => h.dataset.day >= date);
  if (target) target.scrollIntoView({ block: 'start' });
  else if (heads.length) heads[heads.length - 1].scrollIntoView({ block: 'start' });
}

/* ---------- Seleção de várias tarefas ---------- */

function renderSelectionBar() {
  let bar = $('#select-bar');
  $('#select-head')?.remove();
  if (!state.selecting) {
    bar?.remove();
    document.body.classList.remove('selecting');
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'select-bar';
    bar.className = 'selbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Ações das tarefas selecionadas');
    document.body.append(bar);
  }
  document.body.classList.add('selecting');
  const visible = [...document.querySelectorAll('#view .task.selectable')].map((row) => row.dataset.id);
  const n = state.selected.size;
  const off = n ? '' : 'disabled';
  const allOn = visible.length && visible.every((id) => state.selected.has(id));
  // Cabeçalho da seleção no topo da tela, no lugar do título.
  $('#view').insertAdjacentHTML('afterbegin', `
    <div class="selhd" id="select-head" role="status"><span class="grow"><b>${n}</b> selecionada${n === 1 ? '' : 's'}</span>
      <button class="btn small text" data-action="select-all">${allOn ? 'Nenhuma' : 'Todas'}</button>
      <button class="btn small primary" data-action="select-end">Pronto</button></div>`);
  const allImportant = n && [...state.selected].every((id) => findTask(id)?.important);
  bar.innerHTML = `
    <button data-action="bulk" data-op="complete" ${off}>${ico('check')}Concluir</button>
    <button data-action="bulk" data-op="tomorrow" ${off}>${ico('next')}Amanhã</button>
    <button data-action="bulk" data-op="important" ${off}>${ico('star', allImportant ? 'fill' : '')}${allImportant ? 'Sem estrela' : 'Estrela'}</button>
    <button data-action="bulk" data-op="move" ${off}>${ico('folder')}Mover</button>
    <button data-action="bulk" data-op="trash" class="dg" ${off}>${ico('trash')}Excluir</button>`;
}

function endSelection() {
  state.selecting = false;
  state.selected.clear();
  render();
}

async function runBulk(op) {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (op === 'move') {
    openMoveSheet(ids);
    return;
  }
  if (op === 'trash' && state.settings.confirmDelete && !confirm(`Mandar ${ids.length} tarefa(s) para a lixeira?`)) return;
  const now = new Date().toISOString();
  state.selecting = false;
  state.selected.clear();
  if (op === 'complete') {
    const before = ids.map(findTask).filter((t) => t && t.status === 'open');
    const logs = [];
    for (const task of before) {
      const { task: updated, log } = completeTask(task, today(), now);
      if (log) {
        const entry = { ...log, id: newId() };
        logs.push(entry);
        // eslint-disable-next-line no-await-in-loop
        await saveLogEntry(entry);
      }
      // eslint-disable-next-line no-await-in-loop
      await saveTask(updated);
    }
    render();
    showToast(`${before.length} concluída(s).`, async () => {
      for (const entry of logs) await forget('log', entry.id); // eslint-disable-line no-await-in-loop
      for (const task of before) await saveTask(task); // eslint-disable-line no-await-in-loop
      render();
    });
    return;
  }
  if (op === 'today' || op === 'tomorrow') {
    const date = op === 'today' ? today() : addDays(today(), 1);
    const before = ids.map(findTask).filter(Boolean);
    const moved = [];
    for (const task of before) {
      // eslint-disable-next-line no-await-in-loop
      if (!blockedByDeadline(task, date) && await editTask(task.id, dateChanges(task, date))) moved.push(task);
    }
    render();
    const skipped = before.length - moved.length;
    const done = op === 'today' ? `${moved.length} para hoje` : `${moved.length} adiada${moved.length === 1 ? '' : 's'} para amanhã`;
    let message = skipped ? `${done}. ${skipped} não ${skipped === 1 ? 'mudou' : 'mudaram'}: o prazo vem antes.` : `${done}.`;
    if (!moved.length) message = before.length === 1 ? deadlineMessage(before[0]) : 'Nenhuma mudou: o prazo delas vem antes.';
    showToast(message, moved.length ? async () => {
      for (const task of moved) await saveTask(task); // eslint-disable-line no-await-in-loop
      render();
    } : undefined);
    return;
  }
  const allImportant = ids.every((id) => findTask(id)?.important);
  const changes = {
    today: (task) => editTask(task.id, dateChanges(task, today())),
    tomorrow: (task) => editTask(task.id, dateChanges(task, addDays(today(), 1))),
    important: (task) => saveTask({ ...task, important: !allImportant }),
    trash: (task) => saveTask({ ...task, deletedAt: now }),
  };
  const labels = {
    today: `${ids.length} tarefa(s) para hoje.`,
    tomorrow: `${ids.length} tarefa(s) adiada(s) para amanhã.`,
    important: allImportant ? 'Estrela retirada.' : 'Marcadas como importantes.',
    trash: `${ids.length} tarefa(s) na lixeira.`,
  };
  await bulkApply(ids, labels[op], changes[op]);
}

/* ---------- Menus (folha de opções) ---------- */

let sheetItems = [];

/** Abre uma folha com opções; cada item é [rótulo, função, {danger, disabled}]. */
function openSheet(title, items, subtitle = '', { tiles = [], meta = '', lead = '', kicker = '', note = '', lined = false } = {}) {
  const tileItems = tiles.filter(Boolean);
  sheetItems = [...tileItems, ...items.filter(Boolean)];
  const offset = tileItems.length;
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <div class="sheet">
      <div class="grab" aria-hidden="true"></div>
      <div class="form-head">${lead}<div>${kicker ? `<div class="sheet-kicker">${escapeHtml(kicker)}</div>` : ''}<h2>${escapeHtml(title)}</h2>${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}${meta ? `<div class="sheet-meta">${meta}</div>` : ''}</div><button type="button" class="ib" data-action="close-dialog" aria-label="Fechar" title="Fechar">${ico('x')}</button></div>
      ${offset ? `<div class="tiles">${tileItems.map(([label, , opts = {}], index) => `<button class="tile" data-action="sheet" data-index="${index}">${opts.icon ? ico(opts.icon, opts.fill ? 'fill' : '') : ''}${escapeHtml(label)}</button>`).join('')}</div>` : ''}
      <div class="sheet-items">
        ${sheetItems.slice(offset).map(([label, , opts = {}], i) => (opts.sep ? '<div class="sheet-sep" role="separator"></div>' : opts.header ? `<div class="grp sheet-grp">${escapeHtml(label)}</div>` : `<button class="sheet-item ${lined ? 'lined' : ''} ${opts.danger ? 'danger' : ''} ${opts.on ? 'on' : ''}" data-action="sheet" data-index="${i + offset}" ${opts.disabled ? 'disabled' : ''}>${opts.icon ? ico(opts.icon) : ''}${opts.html ? label : escapeHtml(label)}${opts.hint ? `<span class="sheet-hint">${escapeHtml(opts.hint)}</span>` : ''}</button>`)).join('')}
      </div>
      ${note ? `<div class="sheet-note">${escapeHtml(note)}</div>` : ''}
    </div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.tile, .sheet-item:not(:disabled)')?.focus();
}


/** O prazo (Até) não deixa Quando passar dele: explica em vez de só recusar. */
const deadlineMessage = (task) => `Não dá para mudar: o prazo era ${formatDate(task.deadline).toLowerCase()}. Mude o prazo nos detalhes.`;

async function moveToDate(id, date) {
  const task = findTask(id);
  if (!task) return;
  if (blockedByDeadline(task, date)) {
    render();
    showToast(deadlineMessage(task));
    return;
  }
  if (!(await editTask(id, dateChanges(task, date)))) return;
  render();
  let message = date ? `Movida para ${formatDate(date).toLowerCase()}.` : 'Data retirada.';
  if (date === addDays(today(), 1)) message = 'Adiada para amanhã.';
  if (date === today()) message = 'Movida para hoje.';
  showToast(message, async () => {
    await saveTask(task);
    render();
  });
}

function openDatePicker(id) {
  const task = findTask(id);
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form" data-form="pick-date" data-id="${id}">
      <div class="form-head"><h2>Escolher a data</h2><button type="button" class="ib" data-action="close-dialog" aria-label="Fechar">${ico('x')}</button></div>
      <div class="field"><label for="p-date">Quando</label><input id="p-date" type="date" name="date" required value="${task?.when || addDays(today(), 1)}"></div>
      <div class="form-foot"><div></div><div><button class="btn primary">${ico('calendar')}Mudar</button></div></div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  $('#p-date').focus();
}

function openTaskMenu(id) {
  const task = findTask(id);
  if (!task) return;
  const open = task.status === 'open';
  const close = () => $('#dialog').close();
  const tomorrow = addDays(today(), 1);
  const tiles = open ? [
    ['Concluir', async () => { close(); await complete(id); }, { icon: 'check' }],
    task.when === tomorrow
      ? ['Hoje', async () => { close(); await moveToDate(id, today()); }, { icon: 'sun' }]
      : ['Amanhã', async () => { close(); await moveToDate(id, tomorrow); }, { icon: 'next' }],
    [task.important ? 'Sem estrela' : 'Estrela', async () => { close(); await saveTask({ ...task, important: !task.important }); render(); }, { icon: 'star', fill: task.important }],
    ['Mover', () => openMoveSheet([id]), { icon: 'folder' }],
  ] : [];
  openSheet(task.title, [
    !open && ['Reabrir', async () => { close(); await reopen(id); }, { icon: 'undo' }],
    ['Abrir detalhes', () => openTask(id), { icon: 'edit' }],
    open && ['Escolher outra data…', () => openDatePicker(id), { icon: 'calendar' }],
    open && task.when && task.when !== today() && task.when !== tomorrow && ['Fazer hoje', async () => { close(); await moveToDate(id, today()); }, { icon: 'sun' }],
    open && task.when && !task.repeat && ['Tirar a data', async () => { close(); await moveToDate(id, null); }, { icon: 'x' }],
    !open && ['Mover para outra lista', () => openMoveSheet([id]), { icon: 'folder' }],
    ['Duplicar', async () => { close(); await duplicateTask(id); }, { icon: 'copy' }],
    ['Selecionar várias', () => { close(); state.selecting = true; state.selected = new Set([id]); render(); }, { icon: 'select' }],
    ['', null, { sep: true }],
    ['Mandar para a Lixeira', async () => { close(); await trashWithConfirm(id); }, { danger: true, icon: 'trash' }],
  ], '', { tiles, meta: taskChips(task, { showList: true }) });
}

/** Quadradinho da lista com o emoji (ou um ícone) na cor dela. */
// v23: com emoji, o emoji fica no quadradinho na cor clara da lista; sem emoji, a inicial em branco na cor cheia.
const listSquare = (list, size = 36) => {
  const color = escapeHtml(list?.color || (list?.id === INBOX ? 'var(--primary)' : '#7E8A99'));
  const style = `--c:${color};width:${size}px;height:${size}px`;
  if (list?.emoji) return `<span class="em" style="${style}" aria-hidden="true">${escapeHtml(list.emoji)}</span>`;
  return `<span class="em solid${list?.id === INBOX && !list?.color ? ' inbox' : ''}" style="${style}" aria-hidden="true">${list?.id === INBOX ? ico('inbox') : escapeHtml(initial(list?.name))}</span>`;
};

function openMoveSheet(ids) {
  const tasks = ids.map(findTask).filter(Boolean);
  const { ungrouped, groups } = groupedLists();
  const item = (list) => {
    const here = tasks.filter((t) => t.listId === list.id).length;
    let hint = '';
    if (here) hint = tasks.length === 1 ? 'está aqui' : `${here === 1 ? 'uma está' : `${here} estão`} aqui`;
    return [`${listSquare(list, 32)}${escapeHtml(list.name)}`, async () => {
      $('#dialog').close();
      state.selecting = false;
      state.selected.clear();
      await bulkApply(ids, `Movida${tasks.length === 1 ? '' : 's'} para ${list.name}.`, (task) => saveTask({ ...task, listId: list.id }));
    }, { html: true, on: here > 0, disabled: here === tasks.length, hint }];
  };
  const inbox = findList(INBOX);
  openSheet(tasks.length === 1 ? 'Mover para' : `Mover ${tasks.length} tarefas para`, [
    inbox && item(inbox),
    ...ungrouped.map(item),
    ...groups.flatMap(([name, lists]) => [[name, null, { header: true }], ...lists.map(item)]),
    ['', null, { sep: true }],
    ['Nova lista…', () => openListDialog(null, { moveIds: ids }), { icon: 'plus' }],
  ], escapeHtml(tasks.map((t) => t.title).join(', ')));
}

async function trashWithConfirm(id) {
  const task = findTask(id);
  if (!task) return;
  if (state.settings.confirmDelete && !confirm(`Mandar "${task.title}" para a lixeira?`)) return;
  await moveToTrash(id);
}

function openListMenu(id) {
  const list = findList(id);
  if (!list) return;
  const close = () => $('#dialog').close();
  const isInbox = id === INBOX;
  const doneCount = state.tasks.filter((t) => t.listId === id && t.status === 'done' && !t.deletedAt).length;
  const openN = openCount(id);
  const sortName = (LIST_SORTS.find(([key]) => key === (list.sort || 'manual')) || LIST_SORTS[0])[1];
  const sub = [`${openN} ${openN === 1 ? 'aberta' : 'abertas'}`, doneCount && `${doneCount} ${doneCount === 1 ? 'concluída' : 'concluídas'}`, isInbox ? '' : (list.group || 'sem grupo')].filter(Boolean).join(' · ');
  openSheet(list.name, [
    currentRoute().id !== id && ['Abrir', () => { close(); location.hash = `#list/${id}`; }, { icon: 'right' }],
    !isInbox && ['Editar nome, emoji, cor e grupo', () => openListDialog(id), { icon: 'edit' }],
    ['Ordenar tarefas', () => openSortSheet(id), { icon: 'sort', hint: sortName }],
    doneCount && [state.doneOpen.has(id) ? 'Esconder concluídas' : 'Mostrar concluídas', () => { close(); if (currentRoute().id !== id) { state.doneOpen.add(id); location.hash = `#list/${id}`; } else toggleDoneSection(id); }, { icon: 'eye', hint: String(doneCount) }],
    doneCount && ['Limpar concluídas', async () => { close(); await clearListDone(id); }, { icon: 'done', hint: String(doneCount) }],
    openN && ['Selecionar tarefas', () => { close(); location.hash = `#list/${id}`; state.selecting = true; state.selected.clear(); render(); }, { icon: 'select' }],
    !isInbox && ['Duplicar lista (sem as tarefas)', async () => { close(); await duplicateList(id); }, { icon: 'copy' }],
    !isInbox && ['Organizar listas', () => { close(); location.hash = '#organize'; }, { icon: 'organize' }],
    !isInbox && ['', null, { sep: true }],
    !isInbox && ['Excluir lista…', () => openDeleteList(id), { danger: true, icon: 'trash' }],
    isInbox && ['A Entrada não pode ser renomeada nem excluída.', () => {}, { disabled: true }],
  ], escapeHtml(sub), { lead: listSquare(list, 40) });
}

function openSortSheet(id) {
  const list = findList(id);
  const current = list.sort || 'manual';
  openSheet(`Ordenar ${list.name}`, LIST_SORTS.map(([key, name]) => [
    name,
    async () => { $('#dialog').close(); await setListSort(id, key); },
    { on: key === current, icon: key === current ? 'check' : 'sort' },
  ]));
}

async function setListSort(id, sort) {
  await saveList({ ...findList(id), sort });
  render();
}

function toggleDoneSection(id) {
  if (state.doneOpen.has(id)) state.doneOpen.delete(id); else state.doneOpen.add(id);
  render();
}

async function clearListDone(id) {
  const done = state.tasks.filter((t) => t.listId === id && t.status === 'done' && !t.deletedAt);
  const now = new Date().toISOString();
  await bulkApply(done.map((t) => t.id), `${done.length} concluída(s) na lixeira.`, (task) => saveTask({ ...task, deletedAt: now }));
}

async function duplicateList(id) {
  const list = findList(id);
  const copy = { ...list, id: newId(), name: `${list.name} (cópia)`, order: Number.isFinite(list.order) ? list.order + 0.5 : list.order };
  delete copy._t;
  delete copy._dirty;
  await saveList(copy);
  location.hash = `#list/${copy.id}`;
  showToast('Lista duplicada.');
}

/** Muda a ordem de uma lista dentro da sua seção (sem grupo ou o mesmo grupo). */
async function moveList(id, step) {
  const list = findList(id);
  const section = sortedLists().filter((l) => l.id !== INBOX && (l.group || '') === (list.group || ''));
  const from = section.findIndex((l) => l.id === id);
  const to = from + step;
  if (to < 0 || to >= section.length) return;
  section.splice(to, 0, section.splice(from, 1)[0]);
  // Numera a lista inteira, mantendo as outras seções onde estavam.
  const all = sortedLists().filter((l) => l.id !== INBOX);
  const queue = [...section];
  const ordered = all.map((l) => ((l.group || '') === (list.group || '') ? queue.shift() : l));
  for (const [index, item] of ordered.entries()) {
    // eslint-disable-next-line no-await-in-loop
    if (item.order !== index + 1) await saveList({ ...item, order: index + 1 });
  }
  render();
  document.querySelector(`[data-action="move-list"][data-id="${id}"][data-step="${step}"]:not(:disabled)`)?.focus();
}

function openGroupMenu(name) {
  const lists = state.lists.filter((l) => l.group === name);
  openSheet(`Grupo ${name}`, [
    ['Renomear grupo', () => openGroupDialog(name)],
    ['Nova lista neste grupo', () => openListDialog(null, { group: name })],
    ['Desfazer o grupo (as listas continuam)', async () => {
      $('#dialog').close();
      for (const list of lists) await saveList({ ...list, group: '' }); // eslint-disable-line no-await-in-loop
      render();
      showToast(`Grupo ${name} desfeito.`, async () => {
        for (const list of lists) await saveList({ ...findList(list.id), group: name }); // eslint-disable-line no-await-in-loop
        render();
      });
    }, { danger: true }],
  ], `${lists.length} lista(s): ${escapeHtml(lists.map((l) => l.name).join(', '))}`);
}

function openGroupDialog(name = '') {
  const lists = sortedLists().filter((l) => l.id !== INBOX);
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form" data-form="group" data-old="${escapeHtml(name)}">
      <div class="form-head"><h2>${name ? 'Renomear grupo' : 'Novo grupo'}</h2><button type="button" class="btn small" data-action="close-dialog">Fechar</button></div>
      <div class="field"><label for="g-name">Nome do grupo</label><input id="g-name" name="name" required value="${escapeHtml(name)}" autocomplete="off"></div>
      ${name ? '' : `<div class="field"><span class="label-text">Listas do grupo</span>
        ${lists.length ? lists.map((l) => `<label class="check-line"><input type="checkbox" name="lists" value="${l.id}"> ${listLabel(l)}${l.group ? ` <span class="sheet-hint">(hoje em ${escapeHtml(l.group)})</span>` : ''}</label>`).join('') : '<p class="help">Crie uma lista primeiro.</p>'}
      </div>`}
      <div class="form-foot"><div></div><div><button class="btn primary">Salvar</button></div></div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  $('#g-name').focus();
}

async function submitGroup(form) {
  const data = new FormData(form);
  const name = data.get('name').trim();
  if (!name) return;
  const old = form.dataset.old;
  const targets = old ? state.lists.filter((l) => l.group === old) : data.getAll('lists').map(findList).filter(Boolean);
  if (!old && !targets.length) {
    showToast('Marque ao menos uma lista para o grupo.');
    return;
  }
  for (const list of targets) await saveList({ ...list, group: name }); // eslint-disable-line no-await-in-loop
  $('#dialog').close();
  render();
  showToast(old ? 'Grupo renomeado.' : `Grupo ${name} criado.`);
}

/* ---------- Janela da tarefa ---------- */

let draftSteps = [];

function openTask(id, { isNew = false } = {}) {
  const task = findTask(id);
  if (!task) return;
  draftSteps = (task.steps || []).map((step) => ({ ...step }));
  const repeat = task.repeat || {};
  const options = (selected) => sortedLists()
    .map((l) => `<option value="${l.id}" ${l.id === selected ? 'selected' : ''}>${escapeHtml(`${l.emoji ? `${l.emoji} ` : ''}${l.name}${l.group ? ` · ${l.group}` : ''}`)}</option>`).join('');
  const stampText = (iso) => (iso ? `${formatDate(localDate(new Date(iso))).toLowerCase()} às ${new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '');
  const info = [
    task.createdAt && `Criada ${stampText(task.createdAt)}`,
    task.status === 'done' && task.completedAt && `Concluída ${stampText(task.completedAt)}`,
    task.deletedAt && `Na lixeira desde ${stampText(task.deletedAt)}`,
    task.occurrence?.when && `Mudada só desta vez: o normal seria ${formatDate(task.occurrence.when).toLowerCase()}${task.occurrence.remindAt ? ` às ${task.occurrence.remindAt.slice(11)}` : ''}`,
  ].filter(Boolean).join(' · ');
  const granted = 'Notification' in window && Notification.permission === 'granted';
  notifyHint = 'Só um sinal no app. Para receber notificação, ative em Config. › Avisos.';
  if (granted) {
    notifyHint = state.push?.enabled
      ? 'Avisa com o app fechado.'
      : 'Avisa com o app aberto. Para avisar com ele fechado, ative em Config. › Avisos.';
  }
  showRemindField = false;
  daysBase = task.when || null;
  daysNote = '';
  const next = task.repeat && task.status === 'open' ? nextDate(task, today()) : null;
  const mode = untilMode();
  const untilField = mode === 'A' ? `
        <div class="field">
          <label for="f-until" id="until-label">Até</label>
          <input id="f-until" type="date" name="until" value="${task.repeat ? task.seriesEnd || '' : task.deadline || ''}">
          <div class="help" id="until-help"></div>
        </div>` : `
        <div class="field">
          <label for="f-deadline">Prazo</label>
          <input id="f-deadline" type="date" name="deadline" value="${task.deadline || ''}">
          <div class="help" id="deadline-help"></div>
        </div>`;
  const seriesField = mode === 'A' ? '' : `
      <div class="field" id="series-field">
        <label for="f-series">${mode === 'B' ? 'Fim da repetição' : 'Termina em'}</label>
        <input id="f-series" type="date" name="seriesEnd" value="${task.seriesEnd || ''}">
        <div class="help" id="series-help"></div>
      </div>`;

  // A hora ao lado de Quando é a do lembrete, quando ele cai no mesmo dia.
  const whenTime = task.when && task.remindAt && task.remindAt.slice(0, 10) === task.when ? task.remindAt.slice(11, 16) : '';
  remindLinked = !task.remindAt || (!!task.when && task.remindAt === `${task.when}T${whenTime}`);
  const moreOpen = !!(task.deadline || task.seriesEnd || (task.tags || []).length || (task.extraReminders || []).length || task.insist);
  const repeatMoreOpen = !!(repeat.fromCompletion || repeat.count);

  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form task-form" data-form="task" data-id="${task.id}" novalidate>
      <header class="task-hero">
        <div class="hero-bar sticky-head">
          <button type="button" class="hero-pill" data-action="close-dialog">Fechar</button>
          <h2 class="hero-kicker">${isNew ? 'Nova tarefa' : 'Tarefa'}</h2>
          <span class="head-spacer" aria-hidden="true"></span>
        </div>
        <div class="title-row">
          ${task.status === 'open' && !task.deletedAt
    ? `<button type="button" class="check${isOverdue(task, today()) ? ' late' : ''}" data-action="complete-from-dialog" data-id="${task.id}" aria-label="${escapeHtml(completeLabel(task))}">${MARK}</button>`
    : `<span class="check done" aria-hidden="true">${MARK}</span>`}
          <div class="field"><label for="f-title" class="visually-hidden">Título</label><textarea id="f-title" class="title-input" name="title" rows="1" placeholder="O que fazer?" required autocomplete="off" enterkeyhint="done">${escapeHtml(task.title)}</textarea></div>
        </div>
      </header>
      <div class="error" id="form-error" role="alert" hidden></div>

      <section class="leaf-card form-card" aria-labelledby="when-kicker">
        <h3 class="card-kicker" id="when-kicker">Quando</h3>
        <div class="fit-box"><div class="shortcuts fit fit-dates">
          <button type="button" class="chip" data-action="set-when" data-days="0">Hoje</button>
          <button type="button" class="chip" data-action="set-when" data-days="1">Amanhã</button>
          <button type="button" class="chip" data-action="set-when" data-days="7">Próx. semana</button>
          <button type="button" class="chip" data-action="clear-when">Sem data</button>
        </div></div>
        <input id="f-when" type="hidden" name="when" value="${task.when || ''}">
        <input id="f-time" type="hidden" value="${whenTime}">
        <button type="button" class="when-pick" id="when-pick" data-action="pick-when">
          ${ico('calendar')}<span class="grow"><small>Dia e hora</small><b id="when-text"></b></span>${ico('right')}
        </button>
        <label class="remind-row">
          ${ico('bell')}
          <span class="grow"><b id="remind-title">Lembrar</b><small id="remind-help"></small></span>
          <input type="checkbox" class="sw" role="switch" id="f-remind-on" ${task.remindAt ? 'checked' : ''} aria-label="Lembrar">
        </label>
        <div class="field" id="remind-field">
          <input id="f-remind" type="hidden" name="remindAt" value="${task.remindAt || ''}">
          <button type="button" class="when-pick small-pick" data-action="pick-remind">${ico('bell')}<span class="grow"><small>Lembrar em</small><b id="remind-text"></b></span>${ico('right')}</button>
        </div>
        <button type="button" class="link" id="remind-other" data-action="show-remind-field" hidden>${ico('clock')}Outro dia ou horário para lembrar</button>
      </section>

      <details class="leaf-card form-card fold-card" id="repeat-card" ${task.repeat ? 'open' : ''}>
        <summary>${ico('repeat')}<span class="grow">Repetir<small id="repeat-summary"></small></span>${ico('right')}</summary>
        <div class="fold-body">
          <div class="fit-box"><div class="shortcuts fit fit-repeat" role="group" aria-label="Repetir">
            <button type="button" class="chip" data-action="set-freq" data-value="">Não repete</button>
            ${FREQ_OPTIONS.map(([value, name]) => `<button type="button" class="chip" data-action="set-freq" data-value="${value}">${name}</button>`).join('')}
          </div></div>
          <select id="f-freq" name="freq" data-prev="${repeatChoice(repeat)}" hidden>
            <option value="">Não repete</option>
            ${FREQ_OPTIONS.map(([value, name]) => `<option value="${value}" ${repeatChoice(repeat) === value ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
          <div id="repeat-options" class="inline-field" hidden>
            <label for="f-interval">A cada</label>
            <input id="f-interval" type="number" min="1" max="99" name="interval" value="${repeat.interval || 1}" inputmode="numeric">
            <span id="unit-text"></span>
          </div>
          <div class="field" id="weekday-field" hidden>
            <span class="label-text">Dias da semana</span>
            ${weekdayPicker(repeat.weekdays || [])}
          </div>
          <div class="help" id="repeat-help"></div>
          <label class="check-line" id="remind-each-line" hidden><input type="checkbox" name="remindEach" ${task.remindEach !== false ? 'checked' : ''}> Lembrar em cada repetição</label>
          <details id="repeat-extra" class="more" ${repeatMoreOpen ? 'open' : ''} hidden>
            <summary>Mais opções da repetição</summary>
            <label class="check-line"><input type="checkbox" name="fromCompletion" ${repeat.fromCompletion ? 'checked' : ''}> Contar a partir da conclusão</label>
            <div class="field">
              <label for="f-count">Terminar após (vezes)</label>
              <input id="f-count" type="number" min="1" max="999" name="count" value="${repeat.count || ''}" placeholder="Sem limite" inputmode="numeric">
              <div class="help">${repeat.count ? `Feitas ${repeat.done || 0} de ${repeat.count}.` : 'Deixe vazio para repetir sem limite.'}</div>
            </div>
            ${seriesField}
          </details>
        </div>
      </details>

      <div class="list-row">
        <div class="field tile-field"><label for="f-list">Lista</label><select id="f-list" name="listId">${options(task.listId)}</select></div>
        <label class="star-toggle"><input type="checkbox" name="important" ${task.important ? 'checked' : ''}><span>${STAR_ICON(true)} Importante</span></label>
      </div>

      <section class="leaf-card form-card steps-block" aria-labelledby="steps-kicker">
        <div class="steps-head"><h3 class="card-kicker" id="steps-kicker">Etapas</h3><span class="help" id="steps-count"></span></div>
        <div id="steps"></div>
        <div class="step-add">${ico('plus')}<input id="step-input" aria-label="Adicionar etapa" placeholder="Adicionar etapa" autocomplete="off" enterkeyhint="enter"><button type="button" class="btn small text" data-action="add-step">Adicionar</button></div>
      </section>
      <section class="leaf-card form-card notes-card">
        <label for="f-notes" class="card-kicker">Notas</label>
        <textarea id="f-notes" name="notes" placeholder="Detalhes, links, endereço…">${escapeHtml(task.notes)}</textarea>
      </section>

      <details class="leaf-card form-card fold-card more-row" id="more-options" ${moreOpen ? 'open' : ''}>
        <summary>${ico('sliders')}<span class="grow">Mais opções<small>Prazo, outros lembretes, insistir, tags</small></span>${ico('right')}</summary>
        <div class="more-body fold-body">
        ${untilField}
        <div class="field">
          <span class="label-text">Outros lembretes</span>
          <div id="extra-reminders" class="rows">${(task.extraReminders || []).map(extraReminderRow).join('')}</div>
          <button type="button" class="link" data-action="add-reminder">${ico('plus')}Adicionar outro lembrete</button>
        </div>
        <label class="check-line" id="insist-line"><input type="checkbox" name="insist" ${task.insist ? 'checked' : ''}> Insistir até eu reagir (a cada ${pushSettings().insistMinutes} min, até ${INSIST_MAX} vezes)</label>
        <div class="field">
          <label for="f-tags">Tags</label>
          <input id="f-tags" name="tags" list="tag-names" value="${escapeHtml((task.tags || []).join(', '))}" placeholder="casa, mercado" autocomplete="off">
          <datalist id="tag-names">${allTags().map(([tag]) => `<option value="${escapeHtml(tag)}">`).join('')}</datalist>
          <div class="help">Separe por vírgula.</div>
        </div>
        </div>
      </details>
      ${info ? `<p class="help task-info">${escapeHtml(info)}</p>` : ''}

      <div class="form-foot sticky-foot task-bar">
        ${task.deletedAt
    ? `<button type="button" class="bar-btn" data-action="restore" data-id="${task.id}">${ico('undo')}Restaurar</button>`
    : `<button type="button" class="bar-ib danger-ib" data-action="trash" data-id="${task.id}" aria-label="Mandar para a Lixeira" title="Mandar para a Lixeira">${ico('trash')}</button>`}
        <button type="button" class="bar-ib" data-action="duplicate-from-dialog" data-id="${task.id}" aria-label="Duplicar" title="Duplicar">${ico('copy')}</button>
        ${task.repeat && task.status === 'open' ? `<button type="button" class="bar-ib" data-action="skip" data-id="${task.id}" aria-label="Pular esta ocorrência" title="Pular esta ocorrência">${ico('next')}</button>` : ''}
        ${task.status === 'open'
    ? `<button type="button" class="bar-btn complete-small" data-action="complete-from-dialog" data-id="${task.id}" aria-label="Concluir" title="${next ? `Concluir; a próxima fica para ${escapeHtml(formatDate(next).toLowerCase())}` : 'Concluir a tarefa'}">${ico('check')}<span class="bar-label">Concluir</span></button>`
    : `<button type="button" class="bar-btn" data-action="reopen-from-dialog" data-id="${task.id}" aria-label="Reabrir">${ico('undo')}<span class="bar-label">Reabrir</span></button>`}
        <button class="save-btn">Salvar</button>
      </div>
    </form>`;
  renderSteps();
  updateFormHints();
  if (!dialog.open) dialog.showModal();
  fitTitle();
  // Abre sempre no topo, com o título à vista, mesmo se a anterior tinha sido rolada.
  dialog.scrollTop = 0;
  dialogSnapshot = formSnapshot();
}

/** O título da tarefa quebra em várias linhas: a caixa cresce com o texto. */
function fitTitle() {
  const title = $('#f-title');
  if (!title) return;
  title.style.height = 'auto';
  title.style.height = `${title.scrollHeight}px`;
}

/* ---------- Seletor de data e horário (abas Data e Horário, calendário e relógio de ponteiro) ---------- */

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
let picker = null;

/** target: 'when' (Quando + Hora) ou 'remind' (data e hora do lembrete). */
function openDateTimePicker(target) {
  if (!$('form[data-form="task"]')) return;
  let date = '';
  let time = '';
  if (target === 'when') {
    date = $('#f-when').value;
    time = $('#f-time').value;
  } else {
    const value = $('#f-remind').value;
    date = value.slice(0, 10);
    time = value.slice(11, 16);
  }
  const base = date || today();
  picker = { target, date: date || (target === 'remind' ? today() : ''), time, month: base.slice(0, 7), tab: 'day', mode: 'h', typing: false };
  let layer = $('#dt-picker');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'dt-picker';
    layer.className = 'dt-layer';
    $('#dialog').append(layer);
  }
  renderPicker();
}

function renderPicker() {
  const layer = $('#dt-picker');
  if (!layer || !picker) return;
  const p = picker;
  const [y, m] = p.month.split('-').map(Number);
  const weekStart = Number(state.settings.weekStart) === 1 ? 1 : 0;
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() - weekStart + 7) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekNames = [...WEEKDAYS.slice(weekStart), ...WEEKDAYS.slice(0, weekStart)];
  const cells = [];
  for (let i = 0; i < first; i += 1) cells.push('<span class="dt-day out" aria-hidden="true"></span>');
  for (let d = 1; d <= days; d += 1) {
    const date = `${p.month}-${String(d).padStart(2, '0')}`;
    const cls = ['dt-day', date === today() ? 'today' : '', date === p.date ? 'on' : '', date < today() ? 'past' : ''].join(' ');
    cells.push(`<button type="button" class="${cls}" data-action="dt-day" data-date="${date}" aria-pressed="${date === p.date}">${d}</button>`);
  }
  const monthTitle = capitalize(new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  const [hh, mm] = p.time ? p.time.split(':') : ['--', '--'];
  const isDay = p.tab === 'day';
  const dateShort = p.date ? new Date(`${p.date}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const head = isDay
    ? `<div class="dt-head"><small>${p.date ? p.date.slice(0, 4) : '&nbsp;'}</small><b>${p.date ? escapeHtml(capitalize(dateShort)) : 'Sem data'}</b></div>`
    : `<div class="dt-head dt-head-time">
        <button type="button" class="dt-hm ${p.mode === 'h' ? 'on' : ''}" data-action="dt-mode" data-mode="h" aria-label="Escolher a hora">${hh}</button><span class="dt-colon">:</span><button type="button" class="dt-hm ${p.mode === 'm' ? 'on' : ''}" data-action="dt-mode" data-mode="m" aria-label="Escolher os minutos">${mm}</button>
      </div>`;
  const timePane = p.typing
    ? `<div class="dt-typing">
        <label><input id="dt-type-h" inputmode="numeric" maxlength="2" value="${p.time ? hh : ''}" placeholder="00" aria-label="Hora"><small>Hora</small></label>
        <span class="dt-colon">:</span>
        <label><input id="dt-type-m" inputmode="numeric" maxlength="2" value="${p.time ? mm : ''}" placeholder="00" aria-label="Minutos"><small>Minutos</small></label>
      </div>`
    : `<div class="dt-dial" id="dt-dial" role="slider" tabindex="0" aria-label="${p.mode === 'h' ? 'Hora' : 'Minutos'}" aria-valuetext="${p.time || 'sem hora'}">${dialFace()}</div>`;
  layer.innerHTML = `
    <div class="dt-sheet dt-material" role="dialog" aria-label="Escolher data e horário">
      <div class="dt-tabs2" role="tablist">
        <button type="button" role="tab" class="${isDay ? 'on' : ''}" aria-selected="${isDay}" data-action="dt-tab" data-tab="day">Data<small>${p.date ? escapeHtml(formatDate(p.date)) : 'sem data'}</small></button>
        <button type="button" role="tab" class="${isDay ? '' : 'on'}" aria-selected="${!isDay}" data-action="dt-tab" data-tab="time">Horário<small>${p.time || 'sem hora'}</small></button>
      </div>
      ${head}
      <div class="dt-track" data-tab="${p.tab}">
        <div class="dt-pane" aria-hidden="${!isDay}">
          <div class="dt-month">
            <button type="button" class="ib" data-action="dt-month" data-step="-1" aria-label="Mês anterior">${ico('left')}</button>
            <strong>${escapeHtml(monthTitle)}</strong>
            <button type="button" class="ib" data-action="dt-month" data-step="1" aria-label="Próximo mês">${ico('right')}</button>
          </div>
          <div class="dt-grid">${weekNames.map((n) => `<span class="dt-week">${n[0]}</span>`).join('')}${cells.join('')}</div>
          <div class="fit-box"><div class="dt-quick fit fit-dates">
            <button type="button" class="chip" data-action="dt-quick" data-days="0">Hoje</button>
            <button type="button" class="chip" data-action="dt-quick" data-days="1">Amanhã</button>
            <button type="button" class="chip" data-action="dt-quick" data-days="7">Próx. semana</button>
            ${p.target === 'when' ? '<button type="button" class="chip" data-action="dt-quick" data-days="none">Sem data</button>' : ''}
          </div></div>
        </div>
        <div class="dt-pane dt-time-pane" aria-hidden="${isDay}">
          ${timePane}
          <div class="dt-time-tools">
            <button type="button" class="ib" data-action="dt-typing" aria-label="${p.typing ? 'Escolher no relógio' : 'Digitar o horário'}" title="${p.typing ? 'Relógio' : 'Digitar'}">${p.typing ? ico('clock') : KEYBOARD_ICON}</button>
            ${p.target === 'when' && p.time ? '<button type="button" class="btn small text" data-action="dt-time" data-t="">Sem hora</button>' : ''}
          </div>
        </div>
      </div>
      <div class="dt-foot">
        <span class="dt-summary"></span>
        <button type="button" class="btn small text" data-action="dt-cancel">Cancelar</button>
        <button type="button" class="btn primary" data-action="dt-ok" ${p.target === 'remind' && (!p.date || !p.time) ? 'disabled' : ''}>Definir</button>
      </div>
    </div>`;
}

const KEYBOARD_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M6 13.5h1M17 13.5h1M9 14h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/* Relógio de ponteiro, como o do Android: anel de fora 1 a 12, de dentro 13 a 00; depois os minutos. */
const DIAL = { size: 256, outer: 104, inner: 70 };

function dialPoint(index, radius) {
  const angle = (index * 30 - 90) * (Math.PI / 180);
  return [DIAL.size / 2 + radius * Math.cos(angle), DIAL.size / 2 + radius * Math.sin(angle)];
}

const pct = (value) => `${((value / DIAL.size) * 100).toFixed(2)}%`;

function dialFace() {
  const p = picker;
  const [h, mi] = p.time ? p.time.split(':').map(Number) : [null, null];
  const labels = [];
  let hand = null;
  if (p.mode === 'h') {
    for (let i = 0; i < 12; i += 1) {
      const outer = i === 0 ? 12 : i;
      const inner = i === 0 ? 0 : i + 12;
      const [ox, oy] = dialPoint(i, DIAL.outer);
      const [ix, iy] = dialPoint(i, DIAL.inner);
      labels.push(`<span class="dl ${outer === h ? 'on' : ''}" style="left:${pct(ox)};top:${pct(oy)}">${outer}</span>`);
      labels.push(`<span class="dl in ${inner === h ? 'on' : ''}" style="left:${pct(ix)};top:${pct(iy)}">${String(inner).padStart(2, '0')}</span>`);
    }
    if (h !== null) hand = { angle: (h % 12) * 30, radius: h >= 1 && h <= 12 ? DIAL.outer : DIAL.inner };
  } else {
    for (let i = 0; i < 12; i += 1) {
      const value = i * 5;
      const [x, y] = dialPoint(i, DIAL.outer);
      labels.push(`<span class="dl ${value === mi ? 'on' : ''}" style="left:${pct(x)};top:${pct(y)}">${String(value).padStart(2, '0')}</span>`);
    }
    if (mi !== null) hand = { angle: mi * 6, radius: DIAL.outer, between: mi % 5 !== 0 };
  }
  const c = DIAL.size / 2;
  let svg = '';
  if (hand) {
    const a = (hand.angle - 90) * (Math.PI / 180);
    const x = c + hand.radius * Math.cos(a);
    const y = c + hand.radius * Math.sin(a);
    svg = `<svg class="dial-hand" viewBox="0 0 ${DIAL.size} ${DIAL.size}" aria-hidden="true">
      <line x1="${c}" y1="${c}" x2="${x}" y2="${y}"/><circle cx="${c}" cy="${c}" r="4"/>
      <circle class="knob" cx="${x}" cy="${y}" r="${hand.radius === DIAL.inner ? 17 : 21}"/>${hand.between ? `<circle cx="${x}" cy="${y}" r="3" class="dot"/>` : ''}</svg>`;
  }
  return `<div class="dial-face">${svg}${labels.join('')}</div>`;
}

/** Valor do relógio no ponto tocado. */
function dialValueAt(event) {
  const face = $('#dt-dial .dial-face');
  const rect = face.getBoundingClientRect();
  const scale = rect.width / DIAL.size;
  const dx = (event.clientX - rect.left) / scale - DIAL.size / 2;
  const dy = (event.clientY - rect.top) / scale - DIAL.size / 2;
  const angle = (Math.atan2(dy, dx) * (180 / Math.PI) + 90 + 360) % 360;
  if (picker.mode === 'h') {
    const index = Math.round(angle / 30) % 12;
    const inner = Math.hypot(dx, dy) < (DIAL.outer + DIAL.inner) / 2;
    const hour = inner ? (index === 0 ? 0 : index + 12) : (index === 0 ? 12 : index);
    return { hour };
  }
  return { minute: Math.round(angle / 6) % 60 };
}

/** Mostra o horário escolhido no cabeçalho, na aba e no botão Definir, sem redesenhar o seletor. */
function pickerShowTime() {
  const [nh, nm] = picker.time ? picker.time.split(':') : ['--', '--'];
  const hm = [...document.querySelectorAll('#dt-picker .dt-hm')];
  if (hm.length === 2) { hm[0].textContent = nh; hm[1].textContent = nm; }
  const tab = $('#dt-picker [data-tab="time"] small');
  if (tab) tab.textContent = picker.time || 'sem hora';
  const ok = $('#dt-picker [data-action="dt-ok"]');
  if (ok) ok.disabled = picker.target === 'remind' && (!picker.date || !picker.time);
}

function dialApply(value) {
  const [h, mi] = picker.time ? picker.time.split(':') : [defaultRemindTime().split(':')[0], '00'];
  if (value.hour !== undefined) picker.time = `${String(value.hour).padStart(2, '0')}:${mi}`;
  else picker.time = `${h}:${String(value.minute).padStart(2, '0')}`;
  // Atualiza só o relógio, para não perder o dedo no meio do arraste.
  const dial = $('#dt-dial');
  dial.innerHTML = dialFace();
  dial.setAttribute('aria-valuetext', picker.time);
  pickerShowTime();
}

let dialDrag = false;
document.addEventListener('pointerdown', (event) => {
  const dial = event.target.closest('#dt-dial');
  if (!picker || !dial) return;
  event.preventDefault();
  dialDrag = true;
  try { dial.setPointerCapture(event.pointerId); } catch { /* sem captura, segue igual */ }
  dialApply(dialValueAt(event));
});
document.addEventListener('pointermove', (event) => {
  if (!dialDrag || !picker || !$('#dt-dial')) return;
  dialApply(dialValueAt(event));
});
document.addEventListener('pointerup', () => {
  if (!dialDrag || !picker) return;
  dialDrag = false;
  // Escolheu a hora: passa para os minutos, como no Android.
  if (picker.mode === 'h') {
    picker.mode = 'm';
    renderPicker();
  }
});
document.addEventListener('pointercancel', () => { dialDrag = false; });

// Setas do teclado no relógio (note).
document.addEventListener('keydown', (event) => {
  if (!picker || event.target.id !== 'dt-dial') return;
  const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const [h, mi] = (picker.time || `${defaultRemindTime().split(':')[0]}:00`).split(':').map(Number);
  if (picker.mode === 'h') dialApply({ hour: (h + step + 24) % 24 });
  else dialApply({ minute: (mi + step * 5 + 60) % 60 });
});

/** Horário digitado (modo teclado). */
function readTypedTime() {
  const h = $('#dt-type-h');
  const mi = $('#dt-type-m');
  if (!h || !mi) return;
  const hv = Number(h.value);
  const mv = Number(mi.value || 0);
  if (h.value === '' || !Number.isInteger(hv) || hv < 0 || hv > 23 || !Number.isInteger(mv) || mv < 0 || mv > 59) return;
  picker.time = `${String(hv).padStart(2, '0')}:${String(mv).padStart(2, '0')}`;
  pickerShowTime();
}
document.addEventListener('input', (event) => {
  if (!picker || !['dt-type-h', 'dt-type-m'].includes(event.target.id)) return;
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 2);
  readTypedTime();
  if (event.target.id === 'dt-type-h' && event.target.value.length === 2) $('#dt-type-m')?.focus();
});

function pickerSetDate(date) {
  picker.date = date;
  if (date) picker.month = date.slice(0, 7);
  // Escolheu o dia: sugere a hora e passa para a aba Horário.
  if (date && !picker.time && (picker.target === 'remind' || remindLinked)) picker.time = defaultRemindTime();
  if (date) {
    picker.tab = 'time';
    picker.mode = 'h';
  }
  renderPicker();
}

function closePicker() {
  picker = null;
  dialDrag = false;
  $('#dt-picker')?.remove();
}

function confirmPicker() {
  if (!picker) return;
  if (picker.typing) readTypedTime();
  const { target, date, time } = picker;
  closePicker();
  if (target === 'when') {
    $('#f-when').value = date;
    $('#f-time').value = date ? time : '';
    whenChosen();
    syncReminderFromWhen(false);
  } else {
    $('#f-remind').value = date && time ? `${date}T${time}` : '';
    reminderEdited();
  }
  updateFormHints();
}

function pickerGoTab(tab) {
  if (picker.typing) readTypedTime();
  picker.tab = tab;
  if (tab === 'time') picker.mode = 'h';
  renderPicker();
}

const pickerActions = {
  'pick-when': () => openDateTimePicker('when'),
  'pick-remind': () => openDateTimePicker('remind'),
  'dt-tab': (el) => pickerGoTab(el.dataset.tab),
  'dt-day': (el) => pickerSetDate(el.dataset.date),
  'dt-quick': (el) => pickerSetDate(el.dataset.days === 'none' ? '' : addDays(today(), Number(el.dataset.days))),
  'dt-month': (el) => {
    const [y, m] = picker.month.split('-').map(Number);
    const index = y * 12 + m - 1 + Number(el.dataset.step);
    picker.month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    renderPicker();
  },
  'dt-mode': (el) => {
    if (picker.typing) readTypedTime();
    picker.typing = false;
    picker.mode = el.dataset.mode;
    renderPicker();
  },
  'dt-typing': () => {
    if (picker.typing) readTypedTime();
    picker.typing = !picker.typing;
    renderPicker();
    if (picker.typing) $('#dt-type-h')?.focus();
  },
  'dt-time': (el) => { picker.time = el.dataset.t; picker.mode = 'h'; renderPicker(); },
  'dt-cancel': () => closePicker(),
  'dt-ok': () => confirmPicker(),
};

// Arrastar para o lado (fora do relógio) troca entre as abas Data e Horário.
let pickerSwipe = null;
document.addEventListener('pointerdown', (event) => {
  if (!picker || !event.target.closest('.dt-track') || event.target.closest('#dt-dial')) return;
  pickerSwipe = { x: event.clientX, y: event.clientY };
});
document.addEventListener('pointerup', (event) => {
  if (!picker || !pickerSwipe) return;
  const dx = event.clientX - pickerSwipe.x;
  const dy = event.clientY - pickerSwipe.y;
  pickerSwipe = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const tab = dx < 0 ? 'time' : 'day';
  if (tab !== picker.tab) pickerGoTab(tab);
});

/* ---------- Quando + Hora sugerem o lembrete ---------- */

let notifyHint = '';
// O campo de data e hora do lembrete só aparece quando ele não segue Quando e Hora, ou a pedido.
let showRemindField = false;
// Repetir em dias da semana: o Quando escolhido (ou o da tarefa ao abrir) é o ponto de partida para
// achar o primeiro dia marcado. Mudar os dias recalcula a partir dele, sem empurrar o Quando sempre para frente.
let daysBase = null;
let daysNote = '';

/** Os dias marcados num formulário. */
const checkedWeekdays = (root) => [...root.querySelectorAll('input[name="weekday"]:checked')].map((input) => Number(input.value));

/** O Quando escolhido à mão passa a ser o ponto de partida. */
function whenChosen() {
  daysBase = $('#f-when')?.value || null;
  daysNote = '';
}

/** Com Semanal, Dias da semana ou Quinzenal, o Quando vai para o primeiro dia marcado a partir do ponto de partida. */
function alignWhenToDays() {
  const form = $('form[data-form="task"]');
  if (!form || !WEEKLY_CHOICES.includes(form.elements.freq.value)) return;
  const when = $('#f-when');
  const days = checkedWeekdays(form);
  const base = daysBase || when.value;
  if (!base || !days.length) return;
  const target = firstOnWeekdays(days, base);
  daysNote = target !== base ? `Quando foi para ${formatDate(target).toLowerCase()}, o primeiro dia marcado.` : '';
  if (target === when.value) return;
  when.value = target;
  syncReminderFromWhen();
}

// Enquanto o lembrete seguir Quando e Hora, mudar a data ou a hora muda o lembrete junto.
let remindLinked = true;
const defaultRemindTime = () => (/^\d{2}:\d{2}$/.test(state.settings.defaultRemindTime || '') ? state.settings.defaultRemindTime : '09:00');

/** Chamado quando Quando ou Hora mudam. `fromDate`: a data acabou de ser escolhida. */
function syncReminderFromWhen(fromDate = false) {
  const when = $('#f-when');
  const time = $('#f-time');
  const remind = $('#f-remind');
  const on = $('#f-remind-on');
  if (!when || !remindLinked) return;
  if (!when.value) {
    remind.value = '';
    on.checked = false;
  } else {
    if (fromDate && !time.value) time.value = defaultRemindTime();
    if (time.value) {
      remind.value = `${when.value}T${time.value}`;
      on.checked = true;
    } else {
      remind.value = '';
      on.checked = false;
    }
  }
  updateFormHints();
}

/** O lembrete foi mudado à mão: deixa de seguir Quando, a não ser que coincida. */
function reminderEdited() {
  const when = $('#f-when').value;
  const time = $('#f-time').value;
  const value = $('#f-remind').value;
  remindLinked = !value || (when && value === `${when}T${time}`);
  if (value) $('#f-remind-on').checked = true;
  updateFormHints();
}

function reminderToggled() {
  const on = $('#f-remind-on').checked;
  const remind = $('#f-remind');
  if (on && !remind.value) {
    const when = $('#f-when').value;
    const time = $('#f-time').value || defaultRemindTime();
    if (when) {
      $('#f-time').value = time;
      remind.value = `${when}T${time}`;
      remindLinked = true;
    } else {
      // Sem Quando: sugere daqui a uma hora, arredondado.
      const next = new Date(Date.now() + 60 * 60000);
      next.setMinutes(0, 0, 0);
      remind.value = localDateTime(next);
      remindLinked = false;
    }
  } else if (!on) {
    // Desligado à mão: mudar a data não liga de novo.
    remindLinked = false;
  }
  updateFormHints();
}

// Para avisar antes de fechar os detalhes com alterações não salvas.
let dialogSnapshot = null;
function formSnapshot() {
  const form = $('form[data-form="task"]');
  return form ? JSON.stringify({ ...readForm(form), steps: draftSteps }) : null;
}
const hasUnsavedChanges = () => dialogSnapshot !== null && formSnapshot() !== null && formSnapshot() !== dialogSnapshot;

function closeDialog() {
  if (hasUnsavedChanges()) {
    showUnsavedGuard();
    return;
  }
  dialogSnapshot = null;
  $('#dialog').close();
  runPendingReveal();
}

/** Pergunta, dentro da janela da tarefa, o que fazer com as alterações não salvas. */
function showUnsavedGuard() {
  if ($('#unsaved-guard')) return;
  const layer = document.createElement('div');
  layer.className = 'dt-layer';
  layer.id = 'unsaved-guard';
  layer.innerHTML = `
    <div class="dt-sheet guard-sheet" role="alertdialog" aria-modal="true" aria-labelledby="guard-title" aria-describedby="guard-text">
      <div class="grab" aria-hidden="true"></div>
      <h3 id="guard-title">Sair sem salvar?</h3>
      <p class="help" id="guard-text">Você mudou esta tarefa. O que fazer com as alterações?</p>
      <button type="button" class="btn primary" data-action="guard-save">${ico('check')}Salvar e fechar</button>
      <button type="button" class="btn" data-action="guard-stay">Continuar editando</button>
      <button type="button" class="btn text danger" data-action="guard-discard">Descartar alterações</button>
    </div>`;
  $('#dialog').append(layer);
  layer.querySelector('[data-action="guard-save"]').focus();
}

function hideUnsavedGuard() {
  $('#unsaved-guard')?.remove();
}

/** Salva o que está na janela da tarefa, se mudou. Devolve false se há erro no formulário. */
async function saveTaskFormIfChanged() {
  const form = $('form[data-form="task"]');
  if (!form || !hasUnsavedChanges()) return true;
  const prev = findTask(form.dataset.id);
  let fields = readForm(form);
  // Concluir ou pular depois de mudar o dia: a mudança vale só para esta ocorrência.
  if (movesOccurrence(prev, fields)) fields = { ...fields, occurrenceOnly: true };
  const result = applyEdit(prev, fields, today());
  if (result.error) {
    hideUnsavedGuard();
    const errorBox = $('#form-error');
    errorBox.textContent = result.error;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'center' });
    return false;
  }
  await saveTask(result.task);
  dialogSnapshot = formSnapshot();
  return true;
}

const guardActions = {
  'guard-save': () => {
    const form = $('form[data-form="task"]');
    hideUnsavedGuard();
    if (form) submitTask(form);
  },
  'guard-stay': () => hideUnsavedGuard(),
  'guard-discard': () => {
    dialogSnapshot = null;
    hideUnsavedGuard();
    $('#dialog').close();
    runPendingReveal();
  },
};

function extraReminderRow(value = '') {
  return `
    <div class="step field" style="display:flex">
      <input type="datetime-local" name="extraReminder" aria-label="Outro lembrete" value="${escapeHtml(value)}">
      <button type="button" class="step-remove" data-action="remove-reminder" aria-label="Remover lembrete">${ico('x')}</button>
    </div>`;
}

function renderSteps() {
  const container = $('#steps');
  if (!container) return;
  container.innerHTML = draftSteps.map((step, index) => `
    <div class="step ${step.done ? 'done' : ''}">
      <input type="checkbox" class="leaf" aria-label="Etapa feita" data-step-done="${index}" ${step.done ? 'checked' : ''}>
      <input type="text" aria-label="Título da etapa" data-step-title="${index}" value="${escapeHtml(step.title)}">
      <button type="button" class="step-remove" data-action="remove-step" data-index="${index}" aria-label="Remover etapa">${ico('x')}</button>
    </div>`).join('');
  const count = $('#steps-count');
  if (count) count.textContent = draftSteps.length ? `${draftSteps.filter((s) => s.done).length} de ${draftSteps.length}` : '';
}

function readForm(form) {
  const data = new FormData(form);
  const rawFreq = data.get('freq');
  const freq = WEEKLY_CHOICES.includes(rawFreq) ? 'weekly' : rawFreq;
  const fields = {
    title: data.get('title'),
    when: data.get('when'),
    remindAt: form.querySelector('#f-remind-on')?.checked === false ? '' : data.get('remindAt'),
    remindEach: data.get('remindEach') === 'on',
    extraReminders: data.getAll('extraReminder').filter(Boolean),
    insist: data.get('insist') === 'on',
    listId: data.get('listId'),
    notes: data.get('notes'),
    tags: data.get('tags'),
    important: data.get('important') === 'on',
    steps: draftSteps.filter((step) => step.title.trim()),
    repeat: freq ? {
      freq,
      interval: { biweekly: 2, days: 1 }[rawFreq] || data.get('interval'),
      weekdays: data.getAll('weekday').map(Number),
      fromCompletion: data.get('fromCompletion') === 'on',
      count: data.get('count'),
    } : null,
  };
  if (untilMode() === 'A') {
    fields.until = data.get('until');
  } else {
    fields.deadline = data.get('deadline');
    fields.seriesEnd = data.get('seriesEnd');
  }
  return fields;
}

// Mostra o significado de Até e antecipa o preenchimento de Quando (R5).
function updateFormHints() {
  const form = $('form[data-form="task"]');
  if (!form) return;
  const rawFreq = form.elements.freq.value;
  const freq = WEEKLY_CHOICES.includes(rawFreq) ? 'weekly' : rawFreq;
  const mode = untilMode();
  if (mode === 'A') {
    $('#until-label').textContent = freq ? 'Até (fim da repetição)' : 'Até (prazo)';
    $('#until-help').textContent = freq ? 'Último dia da série, inclusive.' : 'Data limite da tarefa.';
  } else {
    $('#deadline-help').textContent = freq ? 'Anda junto com cada ocorrência.' : 'Data limite da tarefa.';
    const series = form.elements.seriesEnd;
    if (mode === 'B') {
      series.disabled = !freq;
      $('#series-help').textContent = freq ? 'Último dia da série, inclusive.' : 'Só vale para tarefas que repetem.';
    } else {
      $('#series-field').hidden = !freq;
      $('#series-help').textContent = 'Último dia da série, inclusive.';
    }
  }
  $('#repeat-extra').hidden = !freq;
  // Quinzenal e Dias da semana já dizem o intervalo: o "A cada" some.
  $('#repeat-options').hidden = !freq || rawFreq === 'biweekly' || rawFreq === 'days';
  $('#weekday-field').hidden = freq !== 'weekly';
  const remindOn = $('#f-remind-on').checked;
  const remindValue = form.elements.remindAt.value;
  const whenValue = form.elements.when.value;
  const followsWhen = remindLinked && !!whenValue;
  $('#remind-field').hidden = !remindOn || (followsWhen && !showRemindField);
  $('#remind-other').hidden = !remindOn || !$('#remind-field').hidden;
  $('#remind-title').textContent = remindOn && remindValue
    ? `Lembrar ${formatDate(remindValue.slice(0, 10)).toLowerCase()} às ${remindValue.slice(11)}` : 'Lembrar';
  $('#remind-help').textContent = remindOn ? `${followsWhen ? 'Segue Quando e Hora. ' : ''}${notifyHint}` : 'Desligado.';
  const timeValue = $('#f-time').value;
  $('#when-text').textContent = whenValue
    ? `${capitalize(formatDate(whenValue))}${timeValue ? ` às ${timeValue}` : ''}`
    : 'Sem data';
  $('#remind-text').textContent = remindValue ? `${formatDate(remindValue.slice(0, 10))} às ${remindValue.slice(11)}` : 'Escolher';
  const shortcutDates = { 0: today(), 1: addDays(today(), 1), 7: addDays(today(), 7) };
  form.querySelectorAll('[data-action="set-when"]').forEach((chip) => {
    const on = whenValue === shortcutDates[chip.dataset.days];
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', on);
  });
  const noDate = form.querySelector('[data-action="clear-when"]');
  noDate.classList.toggle('on', !whenValue);
  noDate.setAttribute('aria-pressed', !whenValue);
  const hasReminder = (remindOn && !!remindValue) || [...form.querySelectorAll('[name="extraReminder"]')].some((input) => input.value);
  $('#remind-each-line').hidden = !freq || !hasReminder;
  $('#insist-line').hidden = !hasReminder;
  if (freq) $('#unit-text').textContent = FREQ_LABELS[freq][1];
  // Botões de repetição e o resumo na linha "Repetir".
  form.querySelectorAll('[data-action="set-freq"]').forEach((chip) => {
    const on = chip.dataset.value === rawFreq;
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', on);
  });
  const draftRepeat = readForm(form).repeat;
  $('#repeat-summary').textContent = draftRepeat ? repeatLabel({ ...draftRepeat, interval: Number(draftRepeat.interval) || 1 }) : 'Não repete';
  const help = $('#repeat-help');
  help.textContent = freq === 'weekly' ? daysNote : '';
  if (freq && !form.elements.when.value) {
    const result = applyEdit(findTask(form.dataset.id), readForm(form), today());
    if (result.task && result.whenFilled) {
      help.textContent = `Quando será preenchido com ${formatDate(result.task.when).toLowerCase()} ao salvar.`;
    }
  }
}

/* Tarefa que se repete com dia ou hora mudados: só esta vez ou esta e as próximas? */
const occurrenceKey = (task) => JSON.stringify([task.when || null, task.remindAt || null, (task.extraReminders || []).join()]);
const samePattern = (a, b) => !!a && !!b && a.freq === b.freq && Number(a.interval) === Number(b.interval)
  && (a.weekdays || []).join() === (b.weekdays || []).join() && !!a.fromCompletion === !!b.fromCompletion
  && Number(a.count || 0) === Number(b.count || 0);

/** A edição muda o dia ou a hora de uma ocorrência sem mudar a regra da repetição? */
function movesOccurrence(prev, fields) {
  if (!prev?.repeat || !fields.repeat?.freq || prev.status !== 'open') return false;
  const draft = applyEdit(prev, fields, today());
  if (draft.error || !samePattern(prev.repeat, draft.task.repeat)) return false;
  return occurrenceKey(draft.task) !== occurrenceKey(prev);
}

/** "Esta e as próximas" numa semanal de um dia só: o dia da semana passa a ser o da data nova. */
function seriesFields(prev, fields) {
  const r = fields.repeat;
  if (!r || r.freq !== 'weekly' || !fields.when || (prev.repeat.weekdays || []).length !== 1) return fields;
  if ((r.weekdays || []).join() !== prev.repeat.weekdays.join()) return fields;
  const [y, m, d] = fields.when.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === prev.repeat.weekdays[0] ? fields : { ...fields, repeat: { ...r, weekdays: [day] } };
}

function askOccurrenceScope(prev, fields) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'dt-layer';
    layer.id = 'scope-ask';
    const official = prev.occurrence || prev;
    const moment = (when, remindAt) => (when ? `${formatDate(when).toLowerCase()}${remindAt && remindAt.slice(0, 10) === when ? ` às ${remindAt.slice(11)}` : ''}` : 'sem data');
    const from = moment(official.when, official.remindAt);
    const to = moment(fields.when, fields.remindAt);
    layer.innerHTML = `
      <div class="dt-sheet guard-sheet" role="alertdialog" aria-modal="true" aria-labelledby="scope-title">
        <div class="grab" aria-hidden="true"></div>
        <div class="sheet-kicker">${escapeHtml(prev.title)} · ${escapeHtml(repeatLabel(prev.repeat))}</div>
        <h3 id="scope-title">Só desta vez?</h3>
        <div class="qp-ramo scope-ramo">
          <div class="scope-from"><span>de</span>${escapeHtml(from)}</div>
          <div class="qp-title"><span>para</span>${escapeHtml(to)}</div>
        </div>
        <button type="button" class="btn primary" data-scope="once">Só esta vez<small class="btn-sub">as próximas continuam como antes</small></button>
        <button type="button" class="btn" data-scope="all">Esta e as próximas<small class="btn-sub">a repetição passa a seguir a data nova</small></button>
        <button type="button" class="btn text" data-scope="cancel">Cancelar</button>
      </div>`;
    const done = (answer) => {
      layer.remove();
      resolve(answer);
    };
    layer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-scope]');
      if (button) done(button.dataset.scope);
    });
    scopeCancel = () => done('cancel');
    $('#dialog').append(layer);
    layer.querySelector('[data-scope="once"]').focus();
  });
}
let scopeCancel = null;

async function submitTask(form) {
  const prev = findTask(form.dataset.id);
  let fields = readForm(form);
  if (movesOccurrence(prev, fields)) {
    const scope = await askOccurrenceScope(prev, fields);
    scopeCancel = null;
    if (scope === 'cancel') return;
    fields = scope === 'once' ? { ...fields, occurrenceOnly: true } : seriesFields(prev, fields);
  }
  const result = applyEdit(prev, fields, today());
  const errorBox = $('#form-error');
  if (result.error) {
    errorBox.textContent = result.error;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'center' });
    return;
  }
  await saveTask(result.task);
  dialogSnapshot = null;
  $('#dialog').close();
  render();
  runPendingReveal();
  await checkReminders();
  if (result.whenFilled) showToast(`Quando preenchido com ${formatDate(result.task.when).toLowerCase()}.`);
}

/* ---------- Janela da lista ---------- */

const EMOJI_SUGGESTIONS = ['🏠', '💼', '🛒', '💰', '❤️', '📚', '🎯', '✈️', '🔧', '🐾', '🎉', '🧘'];

function openListDialog(id, { moveIds = null, group = '' } = {}) {
  const list = findList(id);
  const groupNames = [...new Set(state.lists.map((l) => l.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const color = list?.color || '';
  const emoji = list?.emoji || '';
  const currentGroup = list ? list.group || '' : group;
  const otherEmoji = emoji && !EMOJI_SUGGESTIONS.includes(emoji);
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form sheet-form" data-form="list" data-id="${id || ''}" data-move="${moveIds ? escapeHtml(moveIds.join(',')) : ''}">
      <div class="grab" aria-hidden="true"></div>
      <div class="form-head"><h2>${list ? 'Editar lista' : 'Nova lista'}</h2><button type="button" class="btn small" data-action="close-dialog">Fechar</button></div>
      <div class="lr list-preview" aria-hidden="true"><span class="em" id="lp-em"></span><span class="nm"><span id="lp-name"></span></span><span class="help" id="lp-group"></span></div>
      <div class="error" id="list-error" role="alert" hidden></div>
      <div class="field"><label for="l-name">Nome</label><input id="l-name" name="name" required maxlength="60" value="${escapeHtml(list ? list.name : '')}" autocomplete="off"></div>
      <div class="field">
        <span class="label-text">Emoji</span>
        <div class="emoji-grid">
          <button type="button" class="chip ${emoji ? '' : 'on'}" data-action="pick-emoji" data-emoji="" aria-label="Sem emoji">—</button>
          ${EMOJI_SUGGESTIONS.map((item) => `<button type="button" class="chip ${item === emoji ? 'on' : ''}" data-action="pick-emoji" data-emoji="${item}" aria-label="Usar ${item}">${item}</button>`).join('')}
          <button type="button" class="chip ${otherEmoji ? 'on' : ''}" data-action="pick-emoji-other">Outro</button>
        </div>
        <input id="l-emoji" name="emoji" maxlength="8" value="${escapeHtml(emoji)}" autocomplete="off" placeholder="Digite um emoji" aria-label="Emoji" ${otherEmoji ? '' : 'hidden'}>
      </div>
      <div class="field">
        <span class="label-text">Cor</span>
        <div class="color-row" role="radiogroup" aria-label="Cor da lista">
          ${LIST_COLORS.map(([value, name]) => `<label class="color-pick" title="${name}"><input type="radio" name="color" value="${value}" ${value === color ? 'checked' : ''} aria-label="${name}"><span style="--dot:${value || 'transparent'}" class="${value ? '' : 'no-color'}"></span></label>`).join('')}
        </div>
      </div>
      <div class="field">
        <span class="label-text">Grupo</span>
        <div class="shortcuts">
          <button type="button" class="chip ${currentGroup ? '' : 'on'}" data-action="pick-group" data-group="">Nenhum</button>
          ${groupNames.map((name) => `<button type="button" class="chip ${name === currentGroup ? 'on' : ''}" data-action="pick-group" data-group="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}
          <button type="button" class="chip" data-action="pick-group-new">${ico('plus')}Novo grupo</button>
        </div>
        <input id="l-group" name="group" maxlength="40" value="${escapeHtml(currentGroup)}" autocomplete="off" placeholder="Nome do grupo novo" aria-label="Nome do grupo" hidden>
      </div>
      <div class="form-foot">
        ${list ? `<button type="button" class="btn text danger" data-action="delete-list" data-id="${id}">${ico('trash')}Excluir lista</button>` : '<span></span>'}
        <button class="btn primary" style="min-width:130px">${list ? 'Salvar' : 'Criar lista'}</button>
      </div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  updateListPreview();
  $('#l-name').focus();
}

/** Prévia da lista no topo da janela: emoji, cor, nome e grupo. */
function updateListPreview() {
  const form = $('form[data-form="list"]');
  if (!form) return;
  const emoji = form.elements.emoji.value.trim();
  const color = form.querySelector('[name="color"]:checked')?.value || '';
  const em = $('#lp-em');
  em.style.setProperty('--c', color || '#7E8A99');
  em.innerHTML = emoji ? escapeHtml(emoji) : ico('list');
  $('#lp-name').textContent = form.elements.name.value.trim() || 'Nova lista';
  $('#lp-group').textContent = form.elements.group.value.trim();
}

async function submitList(form) {
  const data = new FormData(form);
  const name = data.get('name').trim();
  const error = $('#list-error');
  if (!name) {
    error.textContent = 'Dê um nome à lista.';
    error.hidden = false;
    return;
  }
  const id = form.dataset.id || newId();
  const twin = state.lists.find((l) => l.id !== id && l.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
  if (twin && !form.dataset.confirmed) {
    error.textContent = `Já existe uma lista chamada ${twin.name}. Toque em ${form.dataset.id ? 'Salvar' : 'Criar lista'} de novo para manter o nome.`;
    error.hidden = false;
    form.dataset.confirmed = '1';
    return;
  }
  const prev = findList(id);
  const order = prev ? prev.order : Math.max(0, ...state.lists.map((l) => (Number.isFinite(l.order) ? l.order : 0))) + 1;
  await saveList({
    ...(prev || {}), id, name, group: data.get('group').trim(), emoji: data.get('emoji').trim(), color: data.get('color') || '', order,
  });
  const moveIds = form.dataset.move ? form.dataset.move.split(',') : null;
  $('#dialog').close();
  if (moveIds) {
    state.selecting = false;
    state.selected.clear();
    await bulkApply(moveIds, `Movida(s) para ${name}.`, (task) => saveTask({ ...task, listId: id }));
    return;
  }
  if (prev) {
    render();
    showToast('Lista salva.');
  } else {
    location.hash = `#list/${id}`;
  }
}

/** Excluir lista: escolher o que acontece com as tarefas dela. */
function openDeleteList(id) {
  const list = findList(id);
  const tasks = state.tasks.filter((t) => t.listId === id && !t.deletedAt);
  const open = tasks.filter((t) => t.status === 'open').length;
  const others = sortedLists().filter((l) => l.id !== id && l.id !== INBOX);
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form sheet-form" data-form="delete-list" data-id="${id}">
      <div class="grab" aria-hidden="true"></div>
      <div class="form-head" style="justify-content:flex-start;gap:12px">${listSquare(list)}<h2>Excluir ${escapeHtml(list.name)}?</h2></div>
      ${tasks.length ? `
      <p class="help" style="font-size:.97rem;margin:0">A lista tem ${tasks.length} ${tasks.length === 1 ? 'tarefa' : 'tarefas'}, ${open} ${open === 1 ? 'aberta' : 'abertas'}. Para onde elas vão?</p>
      <label class="radio-card"><input type="radio" name="fate" value="inbox" checked><span><strong>Para a Entrada</strong><small>Ficam esperando você decidir.</small></span></label>
      ${others.length ? `<label class="radio-card"><input type="radio" name="fate" value="other"><span class="grow"><strong>Para outra lista</strong><small>Escolha a lista:</small>
        <select name="target" aria-label="Lista de destino">${others.map((l) => `<option value="${l.id}">${escapeHtml(`${l.emoji ? `${l.emoji} ` : ''}${l.name}`)}</option>`).join('')}</select></span></label>` : ''}
      <label class="radio-card"><input type="radio" name="fate" value="trash"><span><strong>Para a Lixeira</strong><small>Dá para restaurar depois.</small></span></label>` : '<p class="help" style="font-size:.97rem;margin:0">A lista está vazia.</p>'}
      <div class="actions">
        <button type="button" class="btn" data-action="close-dialog" style="flex:1">Cancelar</button>
        <button class="btn danger-fill" style="flex:1.4">${ico('trash')}Excluir lista</button>
      </div>
    </form>`;
  if (!dialog.open) dialog.showModal();
}

async function deleteList(form) {
  const id = form.dataset.id;
  const list = findList(id);
  const data = new FormData(form);
  const fate = data.get('fate') || 'inbox';
  const target = fate === 'other' ? data.get('target') : INBOX;
  const now = new Date().toISOString();
  for (const task of state.tasks.filter((t) => t.listId === id)) {
    // Na lixeira, a tarefa guarda a Entrada como destino de quando for restaurada.
    // eslint-disable-next-line no-await-in-loop
    await saveTask(fate === 'trash' && !task.deletedAt ? { ...task, listId: INBOX, deletedAt: now } : { ...task, listId: target });
  }
  if (state.settings.defaultList === id) await saveSettings({ defaultList: INBOX });
  await forget('lists', id);
  $('#dialog').close();
  location.hash = '#lists';
  render();
  showToast(`Lista ${list.name} excluída.`);
}

/* ---------- Backup ---------- */

async function exportData() {
  const payload = {
    app: 'tarefas',
    version: 1,
    exportedAt: new Date().toISOString(),
    lists: state.lists,
    tasks: state.tasks,
    log: state.log,
    settings: state.settings,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `tarefas-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  await saveSettings({ lastExport: payload.exportedAt });
  render();
  showToast('Backup exportado.');
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast('Arquivo inválido. Nada foi alterado.');
    return;
  }
  await importPayload(data, 'do arquivo');
}

/** Importa um backup (arquivo ou Google Drive). Com conta, junta; sem conta, substitui. */
async function importPayload(data, source) {
  if (data?.app !== 'tarefas' || !Array.isArray(data.tasks) || !Array.isArray(data.lists) || !Array.isArray(data.log)) {
    showToast('Backup inválido. Nada foi alterado.');
    return;
  }
  if (state.sync?.token) {
    await mergeBackup(data, source);
    return;
  }
  if (!confirm(`Substituir tudo o que está neste aparelho por ${data.tasks.length} tarefa(s) ${source}?`)) return;
  const settings = { ...state.settings, ...(data.settings || {}), id: 'settings' };
  const meta = [settings];
  if (state.push) meta.push({ ...state.push, hash: null });
  await db.replaceAll({ lists: data.lists, tasks: data.tasks, log: data.log, meta });
  await load();
  render();
  showToast('Dados importados.');
}

/**
 * Com conta: junta o backup ao que está na sincronização, sem apagar nada.
 * O que ainda existe fica como está (uma tarefa concluída depois do backup continua concluída).
 * O que não existe mais (excluído de vez) volta com um id novo, porque o servidor recusa ids apagados.
 */
async function mergeBackup(data, source) {
  // Primeiro traz o que mudou nos outros aparelhos, para não confundir "mais novo" com "sumiu".
  for (let i = 0; i < 40 && syncEngine.status.state === 'running'; i += 1) await new Promise((r) => { setTimeout(r, 250); }); // eslint-disable-line no-await-in-loop
  await syncEngine.run();
  if (syncEngine.status.state !== 'ok') {
    showToast('Não deu para sincronizar antes de restaurar. Tente de novo com internet; nada foi alterado.');
    return;
  }
  const strip = (item) => {
    const { _t, _dirty, notifiedFor, ...rest } = item;
    return rest;
  };
  const missing = (kind) => data[kind].filter((item) => item?.id && !state[kind].some((local) => local.id === item.id));
  const lists = missing('lists').filter((list) => list.id !== INBOX);
  const tasks = missing('tasks');
  const log = missing('log');
  const kept = data.tasks.length - tasks.length;
  if (!lists.length && !tasks.length && !log.length) {
    showToast(`Nada a restaurar: as ${data.tasks.length} tarefas ${source} já estão aqui.`);
    return;
  }
  const parts = [`${tasks.length} tarefa(s)`, lists.length && `${lists.length} lista(s)`, log.length && `${log.length} registro(s) de repetição`].filter(Boolean).join(', ');
  if (!confirm(`Restaurar ${source}: voltam ${parts} que não existem mais aqui. As ${kept} tarefa(s) que já existem ficam como estão. Nada é apagado.`)) return;

  const now = Date.now();
  const listIds = {};
  const taskIds = {};
  for (const list of lists) listIds[list.id] = newId();
  for (const task of tasks) taskIds[task.id] = newId();
  const listOf = (id) => listIds[id] || (state.lists.some((l) => l.id === id) ? id : INBOX);
  const records = {
    lists: lists.map((list) => ({ ...strip(list), id: listIds[list.id] })),
    tasks: tasks.map((task) => ({ ...strip(task), id: taskIds[task.id], listId: listOf(task.listId) })),
    log: log.map((entry) => ({ ...strip(entry), id: newId(), taskId: taskIds[entry.taskId] || entry.taskId })),
  };
  for (const kind of ['lists', 'tasks', 'log']) {
    for (const record of records[kind]) {
      const stamped = stampAll(record, now);
      state[kind].push(stamped);
      await db.put(kind, stamped); // eslint-disable-line no-await-in-loop
    }
  }
  render();
  savedLocally();
  showToast(`Restaurado: voltaram ${parts}.`);
}

/* ---------- Sincronização ---------- */

const MIN_PASSWORD = 12;

async function registerAccount() {
  const login = $('#sync-login').value;
  const password = $('#sync-password').value;
  if (login.trim().length < 3) return showToast('Escolha um login com ao menos 3 caracteres.');
  if (password.length < MIN_PASSWORD) return showToast(`Use uma senha com ao menos ${MIN_PASSWORD} caracteres.`);
  if (password !== $('#sync-password-2').value) return showToast('As senhas não são iguais.');
  if (!confirm('Criar a conta neste aparelho? Todas as tarefas daqui serão enviadas ao servidor e serão a base para os outros aparelhos.')) return undefined;
  let session;
  try {
    session = await authenticate('register', login, password);
  } catch (error) {
    return showToast(error.message);
  }
  const now = Date.now();
  state.tasks = state.tasks.map((item) => stampAll(item, now));
  state.lists = state.lists.map((item) => stampAll(item, now));
  state.log = state.log.map((item) => stampAll(item, now));
  await Promise.all(['tasks', 'lists', 'log'].flatMap((kind) => state[kind].map((item) => db.put(kind, item))));
  state.sync = { ...session, since: 0, tombstones: [] };
  await db.put('meta', { ...state.sync, id: 'sync' });
  render();
  await syncEngine.run();
  render();
  return undefined;
}

async function loginThisDevice() {
  return connectWith(() => authenticate('login', $('#sync-login').value, $('#sync-password').value));
}

/** Entrar com Google: o servidor confere o token e abre a sessão da conta ligada. */
async function loginWithGoogle(credential) {
  return connectWith(async () => {
    const { token, login } = await callServer('/google/login', { credential });
    return { token, login };
  });
}

/** Abre a sessão (senha ou Google) e troca as tarefas deste aparelho pelas da sincronização. */
async function connectWith(getSession) {
  const count = state.tasks.length;
  if (count && !confirm(`Entrar neste aparelho? As ${count} tarefa(s) daqui serão substituídas pelas da sincronização. Exporte um backup antes se precisar delas.`)) return undefined;
  let session;
  try {
    session = await getSession();
  } catch (error) {
    return showToast(error.message);
  }
  const previous = { lists: state.lists, tasks: state.tasks, log: state.log };
  state.lists = [];
  state.tasks = [];
  state.log = [];
  state.sync = { ...session, since: 0, tombstones: [] };
  await syncEngine.run();
  if (syncEngine.status.state !== 'ok') {
    // Sem conexão no meio do caminho: nada local é perdido.
    await endSession(session.token).catch(() => {});
    state.lists = previous.lists;
    state.tasks = previous.tasks;
    state.log = previous.log;
    state.sync = null;
    await db.replaceAll({ lists: state.lists, tasks: state.tasks, log: state.log, meta: [state.settings] });
    render();
    return showToast(syncEngine.status.message || 'Não foi possível conectar.');
  }
  for (const kind of ['tasks', 'lists', 'log']) {
    const ids = new Set(state[kind].map((item) => item.id));
    await Promise.all(previous[kind].filter((item) => !ids.has(item.id)).map((item) => db.remove(kind, item.id)));
  }
  await load();
  render();
  return showToast('Aparelho conectado.');
}

async function logoutThisDevice() {
  if (!confirm('Sair neste aparelho? As tarefas ficam aqui, mas param de sincronizar.')) return;
  const { token } = state.sync;
  // Sem conta, o servidor não deve mais avisar este aparelho.
  await disablePush(token).catch(() => {});
  if (state.push) await savePushLocal({ ...state.push, enabled: false, hash: null });
  state.sync = null;
  state.showPasswordForm = false;
  await db.remove('meta', 'sync');
  await endSession(token).catch(() => {});
  render();
}

async function saveNewPassword() {
  const next = $('#sync-new').value;
  if (next.length < MIN_PASSWORD) return showToast(`Use uma senha com ao menos ${MIN_PASSWORD} caracteres.`);
  if (next !== $('#sync-new-2').value) return showToast('As senhas novas não são iguais.');
  try {
    await changePassword(state.sync.login, state.sync.token, $('#sync-current').value, next);
  } catch (error) {
    return showToast(error.message);
  }
  state.showPasswordForm = false;
  render();
  return showToast('Senha trocada. Os outros aparelhos precisam entrar de novo.');
}

/* ---------- Eventos ---------- */

let toastTimer;
function showToast(message, undo) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${undo ? '<button type="button">Desfazer</button>' : ''}`;
  toast.hidden = false;
  if (undo) {
    $('button', toast).addEventListener('click', () => {
      toast.hidden = true;
      undo();
    });
  }
  toastTimer = setTimeout(() => { toast.hidden = true; }, undo ? 7000 : 3500);
}

const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const prefersDark = () => darkScheme.matches;

function applyTheme() {
  const root = document.documentElement;
  const mode = normalizeMode(state.settings.mode);
  const shown = resolveMode(mode, prefersDark());
  const vars = accentVars(state.settings.accent, shown);
  root.dataset.mode = shown;
  ['--primary', '--on-primary', '--accent', '--mark-line', '--mark-fill', '--on-mark', '--soft', '--banner', '--toast-act']
    .forEach((name) => root.style.removeProperty(name));
  Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
  $('meta[name="theme-color"]').content = CHROME[shown];
  const fs = fontSizePx();
  root.style.fontSize = `${fs}px`;
  try {
    localStorage.setItem('tarefas-tema', JSON.stringify({ mode, vars, fs }));
  } catch { /* O tema salvo é só uma conveniência. */ }
}

const clickActions = {
  complete: async (el) => {
    // Mostra o check aceso por um instante antes de a tarefa sair da lista.
    if (el.classList.contains('check')) {
      el.classList.add('done');
      await new Promise((resolve) => { setTimeout(resolve, 220); });
    }
    complete(el.dataset.id);
  },
  open: (el) => openTask(el.dataset.id),
  reopen: (el) => reopen(el.dataset.id),
  snooze: (el) => handleReminderAction('snooze', el.dataset.id),
  dismiss: async (el) => {
    await saveTask(dismissReminder(findTask(el.dataset.id), localDateTime()));
    render();
  },
  'close-dialog': () => closeDialog(),
  // Concluir, Reabrir, Duplicar e Pular salvam antes o que foi mudado na janela.
  'complete-from-dialog': async (el) => {
    if (!(await saveTaskFormIfChanged())) return;
    dialogSnapshot = null;
    $('#dialog').close();
    await complete(el.dataset.id);
  },
  'reopen-from-dialog': async (el) => {
    if (!(await saveTaskFormIfChanged())) return;
    dialogSnapshot = null;
    $('#dialog').close();
    await reopen(el.dataset.id);
  },
  'duplicate-from-dialog': async (el) => {
    if (!(await saveTaskFormIfChanged())) return;
    dialogSnapshot = null;
    $('#dialog').close();
    const id = await duplicateTask(el.dataset.id);
    if (id) openTask(id);
  },
  noop: () => {},
  'task-menu': (el) => openTaskMenu(el.dataset.id),
  'list-menu': (el) => openListMenu(el.dataset.id),
  'group-menu': (el) => openGroupMenu(el.dataset.group),
  'new-group': () => openGroupDialog(''),
  'organize-lists': () => { location.hash = '#organize'; },
  'move-list': (el) => moveList(el.dataset.id, Number(el.dataset.step)),
  'set-list-sort': (el) => setListSort(el.dataset.id, el.dataset.sort),
  'toggle-done-section': (el) => toggleDoneSection(el.dataset.id),
  'pick-emoji-other': (el) => {
    const input = $('#l-emoji');
    input.hidden = false;
    el.closest('.emoji-grid').querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip === el));
    input.focus();
  },
  'pick-group': (el) => {
    const input = $('#l-group');
    input.value = el.dataset.group;
    input.hidden = true;
    el.parentElement.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip === el));
    updateListPreview();
  },
  'pick-group-new': (el) => {
    const input = $('#l-group');
    input.value = '';
    input.hidden = false;
    el.parentElement.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip === el));
    updateListPreview();
    input.focus();
  },
  'pick-emoji': (el) => {
    const input = $('#l-emoji');
    input.value = el.dataset.emoji;
    input.hidden = true;
    el.closest('.emoji-grid').querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip === el));
    updateListPreview();
  },
  sheet: (el) => {
    const item = sheetItems[Number(el.dataset.index)];
    if (item) item[1]();
  },
  'select-start': () => {
    state.selecting = true;
    state.selected.clear();
    render();
  },
  'select-end': () => endSelection(),
  'toggle-select': (el) => {
    const { id } = el.dataset;
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    render();
  },
  'select-all': () => {
    const visible = [...document.querySelectorAll('#view .task.selectable')].map((row) => row.dataset.id);
    const allOn = visible.every((id) => state.selected.has(id));
    visible.forEach((id) => (allOn ? state.selected.delete(id) : state.selected.add(id)));
    render();
  },
  bulk: (el) => runBulk(el.dataset.op),
  'forget-log': async (el) => {
    const entry = state.log.find((item) => item.id === el.dataset.id);
    if (!entry) return;
    await forget('log', entry.id);
    render();
    showToast('Apagado do histórico.', async () => {
      const { _t, _dirty, ...clean } = entry;
      await saveLogEntry(clean);
      render();
    });
  },
  'clear-done': async () => {
    const done = activeTasks().filter((t) => t.status === 'done');
    const logs = state.log.slice();
    if (!done.length && !logs.length) return showToast('Não há concluídas para limpar.');
    if (!confirm(`Mandar ${done.length} tarefa(s) concluída(s) para a Lixeira${logs.length ? ` e apagar ${logs.length} registro(s) do histórico das repetições` : ''}?`)) return undefined;
    const now = new Date().toISOString();
    for (const task of done) await saveTask({ ...task, deletedAt: now }); // eslint-disable-line no-await-in-loop
    for (const entry of logs) await forget('log', entry.id); // eslint-disable-line no-await-in-loop
    render();
    return showToast('Concluídas limpas. As tarefas estão na Lixeira.');
  },
  'restore-all': async () => {
    const trashed = state.tasks.filter((t) => t.deletedAt);
    for (const task of trashed) await restoreTask(task.id); // eslint-disable-line no-await-in-loop
    render();
    showToast(`${trashed.length} tarefa(s) restaurada(s).`);
  },
  'empty-trash': async () => {
    const trashed = state.tasks.filter((t) => t.deletedAt);
    if (!trashed.length) return showToast('A lixeira já está vazia.');
    if (!confirm(`Excluir de vez ${trashed.length} tarefa(s) da lixeira? Isso não pode ser desfeito, e vale para todos os aparelhos.`)) return undefined;
    for (const task of trashed) await forget('tasks', task.id); // eslint-disable-line no-await-in-loop
    render();
    return showToast('Lixeira esvaziada.');
  },
  'set-start-view': async (el) => {
    await saveSettings({ startView: el.dataset.value });
    render();
  },
  'set-week-start': async (el) => {
    await saveSettings({ weekStart: Number(el.dataset.value) });
    render();
  },
  jump: (el) => {
    document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'check-update': async () => {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (!registration) return showToast('Sem o modo offline ativo; recarregue a página.');
    await registration.update().catch(() => {});
    if (registration.installing || registration.waiting) {
      showToast('Atualização encontrada. Reabrindo...');
      setTimeout(() => location.reload(), 1200);
    } else {
      showToast(`Você já está na versão mais nova (${APP_VERSION}).`);
    }
    return undefined;
  },
  'set-freq': (el) => {
    const select = $('#f-freq');
    select.value = el.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  },
  'set-when': (el) => {
    $('#f-when').value = addDays(today(), Number(el.dataset.days));
    whenChosen();
    syncReminderFromWhen(true);
  },
  'clear-when': () => {
    $('#f-when').value = '';
    whenChosen();
    syncReminderFromWhen();
  },
  'set-days': (el) => {
    const days = el.dataset.days.split(',').map(Number);
    const root = el.closest('form');
    root.querySelectorAll('input[name="weekday"]').forEach((input) => { input.checked = days.includes(Number(input.value)); });
    if (root.dataset.form === 'task') {
      // Mais de um dia numa semanal simples: o botão "Dias da semana" fica marcado.
      const select = $('#f-freq');
      if (days.length > 1 && select.value === 'weekly' && Number($('#f-interval').value) === 1) {
        select.value = 'days';
        select.dataset.prev = 'days';
      }
      alignWhenToDays();
      updateFormHints();
    }
  },
  'show-remind-field': () => {
    showRemindField = true;
    updateFormHints();
    openDateTimePicker('remind');
  },
  'add-step': () => {
    const input = $('#step-input');
    if (!input.value.trim()) return;
    draftSteps.push({ title: input.value.trim(), done: false });
    input.value = '';
    renderSteps();
    input.focus();
  },
  'add-reminder': () => {
    const box = $('#extra-reminders');
    box.insertAdjacentHTML('beforeend', extraReminderRow());
    box.lastElementChild.querySelector('input').focus();
  },
  'remove-reminder': (el) => {
    el.closest('.step').remove();
    updateFormHints();
  },
  'push-test': async () => {
    try {
      await sendPushTest(state.sync.token);
      showToast('Teste agendado para daqui a 1 minuto. Feche o app e aguarde.');
    } catch (error) {
      showToast(error.message);
    }
  },
  'set-insist': (el) => changePushSettings({ insistMinutes: Number(el.dataset.minutes) }),
  'remove-step': (el) => {
    draftSteps.splice(Number(el.dataset.index), 1);
    renderSteps();
  },
  trash: async (el) => {
    if (state.settings.confirmDelete && !confirm(`Mandar "${findTask(el.dataset.id).title}" para a lixeira?`)) return;
    dialogSnapshot = null;
    $('#dialog').close();
    await moveToTrash(el.dataset.id);
  },
  skip: async (el) => {
    if (!(await saveTaskFormIfChanged())) return;
    const updated = skipOccurrence(findTask(el.dataset.id), today());
    const before = findTask(el.dataset.id);
    await saveTask(updated);
    dialogSnapshot = null;
    $('#dialog').close();
    render();
    showToast(
      updated.status === 'ended' ? 'Pulada. A repetição terminou.' : `Pulada. Próxima: ${formatDate(updated.when).toLowerCase()}.`,
      async () => {
        await saveTask(before);
        render();
      },
    );
  },
  'move-up': (el) => moveTask(el.dataset.id, -1),
  'move-down': (el) => moveTask(el.dataset.id, 1),
  restore: async (el) => {
    dialogSnapshot = null;
    if ($('#dialog').open) $('#dialog').close();
    await restoreTask(el.dataset.id);
    render();
    showToast('Tarefa restaurada.');
  },
  purge: async (el) => {
    const task = findTask(el.dataset.id);
    if (!confirm(`Excluir "${task.title}" de vez? Isso não pode ser desfeito.`)) return;
    await forget('tasks', task.id);
    render();
  },
  'sync-now': () => syncEngine.run(),
  // Voltar da Busca: para a tela anterior do app (ou Hoje, se a Busca abriu direto).
  'go-back': () => {
    const prev = state.prevHash && !state.prevHash.startsWith('#search') ? state.prevHash : '#today';
    location.hash = prev;
  },
  'sync-register': registerAccount,
  'sync-login': loginThisDevice,
  'sync-logout': logoutThisDevice,
  'sync-change-password': saveNewPassword,
  'sync-toggle-password': () => {
    state.showPasswordForm = !state.showPasswordForm;
    render();
  },
  'new-list': () => openListDialog(null),
  'edit-list': (el) => openListDialog(el.dataset.id),
  'delete-list': (el) => openDeleteList(el.dataset.id),
  'enable-notifications': async () => {
    await Notification.requestPermission();
    render();
  },
  'test-notification': async () => {
    await showNotification({ id: 'teste', title: 'Teste de notificação' });
  },
  'set-mode': async (el) => {
    await saveSettings({ mode: el.dataset.mode });
    applyTheme();
    render();
  },
  'set-accent': async (el) => {
    await saveSettings({ accent: el.dataset.accent });
    applyTheme();
    render();
  },
  'set-font-size': async (el) => {
    const size = Math.min(TEXT_SIZES.length, Math.max(1, Number(el.dataset.size)));
    await saveSettings({ textSize: size });
    applyTheme();
    render();
    // O foco continua no botão tocado (ou no outro, se este ficou desligado no fim da escala).
    const again = document.querySelector(`[data-action="set-font-size"][aria-label="${el.getAttribute('aria-label')}"]`);
    (again && !again.disabled ? again : document.querySelector('[data-action="set-font-size"]:not(:disabled)'))?.focus();
  },
  'toggle-important': async (el) => {
    const task = findTask(el.dataset.id);
    await saveTask({ ...task, important: !task.important });
    render();
    document.querySelector(`[data-action="toggle-important"][data-id="${task.id}"]`)?.focus();
  },
  'set-until-mode': async (el) => {
    await saveSettings({ untilMode: el.dataset.mode });
    render();
  },
  'set-upcoming-mode': async (el) => {
    await saveSettings({ upcomingMode: el.dataset.mode });
    if (currentRoute().id) history.replaceState(null, '', '#upcoming');
    render();
  },
  'cal-day': (el) => {
    state.calDay = el.dataset.date;
    render();
  },
  'cal-move': (el) => {
    const [y, m] = (state.calMonth || today().slice(0, 7)).split('-').map(Number);
    const index = y * 12 + m - 1 + Number(el.dataset.step);
    state.calMonth = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    render();
  },
  'snooze-menu': (el) => openSnoozeSheet(el.dataset.id),
  'set-notify-second': async (el) => {
    await saveSettings({ notifySecond: el.dataset.value });
    render();
  },
  'set-after-add': async (el) => {
    await saveSettings({ afterAdd: el.dataset.value });
    render();
  },
  'set-swipe-left': async (el) => {
    await saveSettings({ swipeLeft: el.dataset.value });
    render();
  },
  'search-clear': () => {
    state.search = '';
    render();
    $('#search-input')?.focus();
  },
  'list-sort-sheet': (el) => openSortSheet(el.dataset.id),
  'quick-when': (el) => {
    const date = addDays(today(), Number(el.dataset.days));
    const current = quickValues($('#quick-input').value, $('#quick-input').form).when;
    state.quick = { ...state.quick, when: current === date ? null : date };
    refocusQuick();
  },
  anotar: () => openAnotar(),
  'anotar-close': () => closeAnotar(),
  'next-more': () => {
    state.nextIndex = (state.nextIndex || 0) + 1;
    renderReminders();
    $('#view-reminders .next-title')?.focus();
  },
  'quick-repeat': () => openQuickRepeat(),
  'quick-list': () => openQuickList(),
  'quick-ignore': () => {
    const input = $('#quick-input');
    state.quickIgnore = input.value;
    renderQuickPreview();
    input.focus();
  },
  export: exportData,
  import: () => $('#import-file').click(),
};

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = clickActions[target.dataset.action] || pickerActions[target.dataset.action] || googleActions[target.dataset.action]
    || guardActions[target.dataset.action] || deviceActions[target.dataset.action];
  if (action) action(target);
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.dataset.form === 'quick-add') {
    const text = form.elements.title.value;
    if (!text.trim()) {
      form.elements.title.focus();
      return;
    }
    const v = quickValues(text, form);
    const context = { when: form.dataset.when, listId: form.dataset.list };
    // "Anotar e abrir" e "Anotar outra" na folha; o Enter segue Config. › Geral › Depois de anotar.
    const after = event.submitter?.dataset.after || afterAdd();
    const notes = state.quickNotes || '';
    state.quickIgnore = '';
    state.quick = {};
    state.quickNotes = '';
    const newTaskId = await addTask(v.title || text.trim(), { listId: v.listId, when: null }, v, { notes });
    if (!newTaskId) return;
    if (after === 'open') {
      // Abre a tarefa para completar data, hora e repetição, sem abrir o teclado.
      $('#quick-input')?.blur();
      closeAnotar();
      pendingReveal = { id: newTaskId, listId: context.listId };
      openTask(newTaskId, { isNew: true });
      return;
    }
    if (anotarOpen) keepAnotarOpen();
    $('#quick-input')?.focus();
    revealTask(newTaskId);
    const message = createdMessage(findTask(newTaskId), context.listId);
    if (message) showToast(message);
  } else if (form.dataset.form === 'quick-days') {
    const weekdays = checkedWeekdays(form);
    if (!weekdays.length) {
      showToast('Marque pelo menos um dia.');
      return;
    }
    $('#dialog').close();
    state.quick = { ...state.quick, repeat: { freq: 'weekly', interval: 1, weekdays } };
    refocusQuick();
  } else if (form.dataset.form === 'pick-date') {
    const date = form.elements.date.value;
    if (!date) return;
    $('#dialog').close();
    await moveToDate(form.dataset.id, date);
  } else if (form.dataset.form === 'snooze') {
    const at = form.elements.at.value;
    if (!at || at <= localDateTime()) {
      showToast('Escolha um horário no futuro.');
      return;
    }
    $('#dialog').close();
    await snoozeTask(form.dataset.id, at);
  } else if (form.dataset.form === 'task') {
    await submitTask(form);
  } else if (form.dataset.form === 'list') {
    await submitList(form);
  } else if (form.dataset.form === 'group') {
    await submitGroup(form);
  } else if (form.dataset.form === 'delete-list') {
    await deleteList(form);
  }
});

// Esc no note ou voltar no Android: com alterações não salvas, pergunta antes de fechar.
$('#dialog').addEventListener('cancel', (event) => {
  // Com o seletor de dia e hora aberto, voltar fecha só o seletor.
  if (picker) {
    event.preventDefault();
    closePicker();
    return;
  }
  // Voltar com a pergunta "Só esta vez" na tela: cancela e continua editando.
  if ($('#scope-ask')) {
    event.preventDefault();
    scopeCancel?.();
    return;
  }
  // Voltar com a pergunta na tela: continua editando.
  if ($('#unsaved-guard')) {
    event.preventDefault();
    hideUnsavedGuard();
    return;
  }
  if (hasUnsavedChanges()) {
    event.preventDefault();
    showUnsavedGuard();
  }
  // Sem alterações, a janela fecha; o evento 'close' limpa o resto.
});

// Rede de segurança: o Chrome do Android pode fechar a janela no gesto de voltar sem
// deixar o app impedir (quando não houve toque desde a última vez). Ela reabre com o
// que foi digitado e pergunta.
$('#dialog').addEventListener('close', () => {
  const dialog = $('#dialog');
  if (picker) closePicker();
  if ($('form[data-form="task"]') && hasUnsavedChanges()) {
    dialog.showModal();
    showUnsavedGuard();
    return;
  }
  dialogSnapshot = null;
  hideUnsavedGuard();
  runPendingReveal();
});

document.addEventListener('input', (event) => {
  const { target } = event;
  if (target.id === 'search-input') {
    const hadText = !!state.search;
    state.search = target.value;
    if (hadText !== !!state.search) {
      // Mostra ou esconde o botão de limpar sem perder o foco.
      render();
      const input = $('#search-input');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    } else {
      $('#search-results').innerHTML = searchResults();
    }
  } else if (target.id === 'quick-input') {
    // No note, apagar o texto desfaz os botões de um toque; na folha eles ficam até fechar.
    if (!target.value.trim() && !anotarOpen) state.quick = {};
    renderQuickPreview();
  } else if (target.closest('form[data-form="list"]')) {
    updateListPreview();
  } else if (target.id === 'f-when') {
    whenChosen();
    syncReminderFromWhen(true);
  } else if (target.id === 'f-time') {
    syncReminderFromWhen();
  } else if (target.id === 'f-remind') {
    reminderEdited();
  } else if (target.id === 'f-remind-on') {
    // Tratado no evento change.
  } else if (target.id === 'f-title') {
    // Um título colado com quebras de linha vira uma linha só.
    if (/\n/.test(target.value)) target.value = target.value.replace(/\s*\n\s*/g, ' ');
    fitTitle();
    updateFormHints();
  } else if (target.dataset.stepTitle !== undefined) {
    draftSteps[Number(target.dataset.stepTitle)].title = target.value;
  } else if (target.name === 'weekday' && target.closest('form[data-form="task"]')) {
    alignWhenToDays();
    updateFormHints();
  } else if (target.closest('form[data-form="task"]')) {
    updateFormHints();
  }
});

document.addEventListener('change', async (event) => {
  const { target } = event;
  if (target.id === 'f-freq') {
    // Sair de Quinzenal para Semanal volta a "a cada 1 semana".
    const interval = $('#f-interval');
    if (target.value === 'biweekly') interval.value = 2;
    else if (target.value === 'days') interval.value = 1;
    else if ((target.value === 'weekly' || target.dataset.prev === 'biweekly') && Number(interval.value) === 2) interval.value = 1;
    target.dataset.prev = target.value;
    // Semanal, Dias da semana ou Quinzenal sem dia marcado: já marca o dia do Quando (ou de hoje).
    const form = target.form;
    if (WEEKLY_CHOICES.includes(target.value) && !checkedWeekdays(form).length) {
      const day = new Date(`${form.elements.when.value || today()}T12:00`).getDay();
      form.querySelector(`input[name="weekday"][value="${day}"]`).checked = true;
    }
    alignWhenToDays();
    updateFormHints();
  } else if (target.id === 'f-remind-on') {
    reminderToggled();
  } else if (target.id === 'default-remind-time' && target.value) {
    await saveSettings({ defaultRemindTime: target.value });
    showToast(`Lembrete sugerido às ${target.value} quando você escolher só a data.`);
  } else if (target.id === 'f-when' || target.id === 'f-time' || target.id === 'f-remind') {
    // Já tratado no evento input.
  } else if (target.name === 'color' && target.closest('form[data-form="list"]')) {
    updateListPreview();
  } else if (target.dataset.stepDone !== undefined) {
    draftSteps[Number(target.dataset.stepDone)].done = target.checked;
    renderSteps();
  } else if (target.id === 'push-enabled') {
    await togglePush(target.checked);
  } else if (target.id === 'push-digest') {
    await changePushSettings({ digest: target.checked });
  } else if (target.id === 'push-digest-time' && target.value) {
    await changePushSettings({ digestTime: target.value });
  } else if (target.id === 'parse-dates') {
    await saveSettings({ parseDates: target.checked });
  } else if (target.id === 'confirm-delete') {
    await saveSettings({ confirmDelete: target.checked });
  } else if (target.id === 'default-list') {
    await saveSettings({ defaultList: target.value });
    showToast(`Tarefas novas vão para ${listName(target.value)}.`);
  } else if (target.id === 'search-done') {
    await saveSettings({ searchDone: target.checked });
    $('#search-results').innerHTML = searchResults();
  } else if (target.id === 'import-file' && target.files[0]) {
    await importData(target.files[0]);
    target.value = '';
  } else if (target.closest('form[data-form="task"]')) {
    updateFormHints();
  }
});

function focusQuickAdd() {
  if (!$('#quick-input')) {
    // Sem disparar hashchange, que redesenharia a tela e tiraria o foco.
    history.pushState(null, '', '#today');
    render();
  }
  $('#quick-input')?.focus();
}

const visualOrder = (list) => [...list.children].map((row) => row.dataset.id).filter(Boolean);

document.addEventListener('keydown', async (event) => {
  // Enter no título salva a tarefa, como no campo de uma linha de antes (sem quebrar linha).
  if (event.key === 'Enter' && event.target.id === 'f-title') {
    event.preventDefault();
    event.target.form.requestSubmit();
    return;
  }
  // Enter na etapa adiciona a etapa, sem salvar a tarefa.
  if (event.key === 'Enter' && event.target.id === 'step-input') {
    event.preventDefault();
    clickActions['add-step']();
    return;
  }
  // Setas no botão de arrastar movem a tarefa sem mouse.
  const handle = event.target.closest?.('[data-drag]');
  if (handle && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    const ids = visualOrder(handle.closest('.task-list'));
    const from = ids.indexOf(handle.dataset.drag);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await reorderTo(handle.dataset.drag, ids);
    document.querySelector(`[data-drag="${handle.dataset.drag}"]`)?.focus();
    return;
  }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable;
  // Esc fecha a folha de anotar (as de menu são <dialog> e fecham sozinhas).
  if (event.key === 'Escape' && anotarOpen && !$('#dialog').open) {
    event.preventDefault();
    closeAnotar();
    return;
  }
  if (event.key === 'Escape' && state.selecting && !$('#dialog').open) {
    endSelection();
    return;
  }
  if (typing || event.ctrlKey || event.metaKey || event.altKey || $('#dialog').open) return;
  if (event.key === 'n' || event.key === 'N') {
    event.preventDefault();
    openAnotar();
  } else if (event.key === '/') {
    event.preventDefault();
    if (currentRoute().name !== 'search') {
      state.prevHash = location.hash || '#today';
      history.pushState(null, '', '#search');
      render();
    }
    $('#search-input')?.focus();
  }
});

/* ---------- Arrastar para ordenar ---------- */

let drag = null;

document.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-drag]');
  if (!handle || event.button > 0) return;
  event.preventDefault();
  const row = handle.closest('.task');
  const rows = [...row.parentElement.children];
  const rects = rows.map((item) => item.getBoundingClientRect());
  const index = rows.indexOf(row);
  const gap = rows.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
  handle.setPointerCapture(event.pointerId);
  drag = { handle, row, rows, rects, index, target: index, startY: event.clientY, shift: rects[index].height + gap };
  row.classList.add('dragging');
});

document.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dy = event.clientY - drag.startY;
  const center = drag.rects[drag.index].top + drag.rects[drag.index].height / 2 + dy;
  const above = drag.rects.filter((rect, i) => i !== drag.index && rect.top + rect.height / 2 < center).length;
  drag.target = above;
  drag.row.style.transform = `translateY(${dy}px)`;
  drag.rows.forEach((item, i) => {
    if (item === drag.row) return;
    let offset = 0;
    if (drag.index < above && i > drag.index && i <= above) offset = -drag.shift;
    if (drag.index > above && i < drag.index && i >= above) offset = drag.shift;
    item.style.transform = offset ? `translateY(${offset}px)` : '';
  });
});

async function endDrag() {
  if (!drag) return;
  const { row, rows, index, target } = drag;
  drag = null;
  rows.forEach((item) => { item.style.transform = ''; });
  row.classList.remove('dragging');
  if (target === index) return;
  const ids = rows.map((item) => item.dataset.id);
  ids.splice(target, 0, ids.splice(index, 1)[0]);
  await reorderTo(row.dataset.id, ids);
}

document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* ---------- Deslizar (celular) e menu do botão direito / toque longo ---------- */

const SWIPE_DONE = 90;
let swipe = null;
let suppressClick = false;

document.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch' || state.selecting || drag) return;
  const row = event.target.closest('#view .task[data-id]');
  if (!row || event.target.closest('[data-drag]')) return;
  swipe = { row, id: row.dataset.id, x: event.clientX, y: event.clientY, dx: 0, active: false, pointerId: event.pointerId };
});

document.addEventListener('pointermove', (event) => {
  if (!swipe || event.pointerId !== swipe.pointerId) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 14) return;
    swipe.active = true;
    swipe.row.classList.add('swiping');
  }
  swipe.dx = dx;
  const task = findTask(swipe.id);
  const canComplete = task?.status === 'open';
  const shown = dx > 0 && !canComplete ? Math.min(dx, 24) : dx;
  swipe.row.style.transform = `translateX(${shown}px)`;
  // Faixa colorida por baixo da tarefa, dizendo o que vai acontecer.
  if (!swipe.under) {
    const list = swipe.row.parentElement;
    const under = document.createElement('div');
    under.className = 'swipe-under';
    under.setAttribute('aria-hidden', 'true');
    list.style.position = 'relative';
    under.style.top = `${swipe.row.offsetTop}px`;
    under.style.height = `${swipe.row.offsetHeight}px`;
    list.insertBefore(under, swipe.row);
    swipe.under = under;
  }
  const side = dx > 0 ? 'complete' : leftAction(task);
  if (swipe.under.dataset.side !== side) {
    swipe.under.dataset.side = side;
    swipe.under.innerHTML = { complete: `${ico('check')}Concluir`, later: `Amanhã${ico('next')}`, trash: `Lixeira${ico('trash')}` }[side];
  }
  swipe.under.classList.toggle('armed', Math.abs(dx) > SWIPE_DONE && (dx < 0 || canComplete));
});

/** O que deslizar para a esquerda faz com esta tarefa. */
const leftAction = (task) => (swipeLeft() === 'tomorrow' && task?.status === 'open' ? 'later' : 'trash');

async function endSwipe() {
  if (!swipe) return;
  const { row, id, dx, active, under } = swipe;
  swipe = null;
  under?.remove();
  if (!active) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 350);
  row.classList.remove('swiping');
  row.style.transform = '';
  delete row.dataset.swipe;
  const task = findTask(id);
  if (dx > SWIPE_DONE && task?.status === 'open') await complete(id);
  else if (dx < -SWIPE_DONE && leftAction(task) === 'later') await moveToDate(id, addDays(today(), 1));
  else if (dx < -SWIPE_DONE) await trashWithConfirm(id);
}

document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', () => {
  if (!swipe) return;
  swipe.row.classList.remove('swiping');
  swipe.row.style.transform = '';
  swipe.under?.remove();
  swipe = null;
});

// Um toque logo depois de deslizar não deve abrir a tarefa.
document.addEventListener('click', (event) => {
  if (suppressClick) {
    event.stopPropagation();
    event.preventDefault();
  }
}, true);

// Botão direito no note e toque longo no celular abrem o menu da tarefa ou da lista,
// no lugar do menu do Chrome (copiar, abrir link em nova aba...).
document.addEventListener('contextmenu', (event) => {
  if (event.target.closest('input, textarea, select')) return;
  const row = event.target.closest('#view .task[data-id]');
  const listRow = event.target.closest('#view .row-wrap, #view .lr')?.querySelector('[data-action="list-menu"]');
  const touch = event.pointerType === 'touch' || (event.sourceCapabilities?.firesTouchEvents ?? false) || matchMedia('(pointer: coarse)').matches;
  if (state.selecting || swipe?.active || (!row && !listRow)) {
    // Nas telas do app, toque longo não deve abrir o menu do Chrome.
    if (touch && event.target.closest('#view, #nav, #dialog, #select-bar')) event.preventDefault();
    return;
  }
  event.preventDefault();
  if (swipe) swipe = null;
  if (touch) {
    navigator.vibrate?.(15);
    // O dedo ainda na tela não deve "tocar" a primeira opção do menu.
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 450);
  }
  if (row) openTaskMenu(row.dataset.id);
  else openListMenu(listRow.dataset.id);
});

// Tocar nos botões de um toque não tira o foco do campo Anotar (o teclado do celular continua aberto).
document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.dock button')) event.preventDefault();
});

window.addEventListener('hashchange', (event) => {
  state.prevHash = new URL(event.oldURL).hash || '#today';
  state.quick = {};
  state.dayScrolled = null;
  state.nextIndex = 0;
  state.quickNotes = '';
  if (anotarOpen) closeAnotar({ back: false });
  // Trocar de tela encerra a seleção de várias tarefas.
  if (state.selecting && !currentRoute().name.startsWith('notif')) {
    state.selecting = false;
    state.selected.clear();
  }
  handleRoute();
});
matchMedia('(max-width: 799px)').addEventListener('change', renderNav);
darkScheme.addEventListener('change', () => {
  applyTheme();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    render();
    checkReminders();
    syncEngine.run();
    checkDriveHealth();
  }
});
window.addEventListener('online', () => syncEngine.run());

// Ações de notificação abertas com o app fechado chegam pelo endereço.
function handleRoute() {
  const match = location.hash.match(/^#notif\/(\w+)\/(.+)$/);
  if (match) {
    history.replaceState(null, '', '#today');
    render();
    handleReminderAction(match[1], match[2]);
    return;
  }
  render();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'notification-action') {
      handleReminderAction(event.data.action, event.data.id);
    } else if (event.data && event.data.type === 'reload-data') {
      // Um botão da notificação mudou uma tarefa com o app em segundo plano.
      load().then(() => { render(); syncEngine.run(); });
    } else if (event.data && event.data.type === 'push-arrived') {
      // Com o app aberto, ele mesmo avisa; sincroniza antes, caso a tarefa venha de outro aparelho.
      syncEngine.run().finally(checkReminders);
    }
  });
}

/* ---------- Início ---------- */

async function load() {
  const [lists, tasks, log, meta] = await Promise.all(
    ['lists', 'tasks', 'log', 'meta'].map((name) => db.getAll(name)),
  );
  state.lists = lists;
  state.tasks = tasks;
  state.log = log;
  const settings = meta.find((item) => item.id === 'settings');
  if (settings) state.settings = settings;
  const sync = meta.find((item) => item.id === 'sync');
  state.sync = sync?.token ? sync : null;
  state.push = meta.find((item) => item.id === 'push') || null;
  // v14: um tema só. Diamante vira a Folha escura; Marca-texto e os outros, a Folha clara.
  if (!MODES.some(([id]) => id === state.settings.mode)) {
    await saveSettings({ mode: normalizeMode(state.settings.mode, state.settings.theme), accent: normalizeAccent(state.settings.accent) });
  }
  if (!state.lists.some((l) => l.id === INBOX)) await saveList({ id: INBOX, name: 'Entrada', group: '' });
  applyTheme();
}

/** Algo compartilhado de outro app vira uma tarefa na Entrada. */
async function createFromShare(title, text, url) {
  const source = title || text || url;
  const [first, ...rest] = source.split('\n');
  const notes = [title ? text : rest.join('\n'), text.includes(url) ? '' : url]
    .map((part) => part.trim()).filter(Boolean).join('\n');
  // v22: abre a folha de anotar já com o texto; o resto (e o link) vai para a nota da tarefa.
  // Como antes: sem data, na lista padrão e sem interpretar o texto (dá para mudar nos botões de um toque).
  const typed = first.trim().slice(0, 200) || 'Compartilhado';
  state.quick = { when: null };
  openAnotar({ text: typed, notes });
  state.quickIgnore = typed;
  renderQuickPreview();
}

async function start() {
  await db.openDb();
  await load();
  // Pede ao navegador para não apagar os dados quando faltar espaço.
  navigator.storage?.persist?.();
  const params = new URLSearchParams(location.search);
  const shared = ['share-title', 'share-text', 'share-url'].map((key) => (params.get(key) || '').trim());
  const wantsNew = params.has('novo');
  if (wantsNew || shared.some(Boolean)) history.replaceState(null, '', `${location.pathname}${location.hash || '#today'}`);
  else if (!location.hash) {
    // Tela inicial escolhida em Config.
    const start = state.settings.startView;
    const hash = { upcoming: '#upcoming', lists: '#lists', inbox: `#list/${INBOX}` }[start];
    if (hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }
  handleRoute();
  if (shared.some(Boolean)) await createFromShare(...shared);
  else if (wantsNew) openAnotar();
  await checkReminders();
  setInterval(checkReminders, 15000);
  syncEngine.run();
  checkDriveHealth();
  setInterval(() => syncEngine.run(), 60000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker não registrado', error));
  }
  // A inscrição pode sumir se o navegador limpar os dados ou a permissão for retirada.
  if (state.push?.enabled && !(await currentSubscription().catch(() => null))) {
    await savePushLocal({ ...state.push, enabled: false });
    if (currentRoute().name === 'settings') render();
  } else if (state.push?.enabled && state.sync?.token) {
    // Desde a v21 a inscrição fica ligada à sessão: sair dos outros aparelhos corta os avisos deles.
    refreshSubscription(state.sync.token).catch(() => {});
  }
}

start().catch((error) => {
  console.error(error);
  $('#view').innerHTML = '<p class="empty">Não foi possível abrir os dados deste aparelho. Verifique se o navegador permite armazenamento.</p>';
});
