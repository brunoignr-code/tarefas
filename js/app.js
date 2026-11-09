import * as db from './db.js';
import {
  applyEdit, completeTask, daysWaiting, addDays, dismissReminder, dueReminders, isOverdue, isUrgent,
  INSIST_MAX, activeReminder, insistStep, nextDate, localDate, localDateTime, notifyMark, shownReminder, skipOccurrence, snooze,
  todayTasks, upcomingTasks,
} from './rules.js';
import { DEFAULT_PUSH_SETTINGS, normalizePushSettings, pushKey } from './push-core.js';
import {
  currentSubscription, disablePush, enablePush, fetchPushState, pushSupported, savePushSettings, sendPushTest, uploadSchedule,
} from './push.js';
import { parseQuickAdd } from './parse.js';
import {
  DEFAULT_HIGHLIGHT, HIGHLIGHTS, THEMES, isHexColor, isTooLight, normalizeTheme, resolveTheme, textOn,
} from './theme.js';
import { stamp, stampAll } from './sync-core.js';
import { authenticate, changePassword, createSync, endSession } from './sync.js';

const INBOX = 'inbox';
// Atualize junto com CACHE em sw.js a cada publicação.
const APP_NAME = 'Minha lista de afazeres';
const APP_VERSION = 'v12 · 09/11/2026';
const SNOOZE_MINUTES = 10;
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FREQ_LABELS = {
  daily: ['Diária', 'dias'], weekly: ['Semanal', 'semanas'],
  monthly: ['Mensal', 'meses'], yearly: ['Anual', 'anos'],
};

const state = { lists: [], tasks: [], log: [], settings: { id: 'settings', theme: 'diamante', themeChosen: true, themeV2: true, highlight: DEFAULT_HIGHLIGHT, fontSize: 3 }, search: '', selecting: false, selected: new Set(), doneOpen: new Set() };
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
  if (repeat.freq === 'weekly' && repeat.weekdays?.length) label += ` (${repeat.weekdays.map((d) => WEEKDAYS[d].toLowerCase()).join(', ')})`;
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
const FONT_SIZES = [[1, 12.5, 'Muito pequena'], [2, 13.5, 'Pequena'], [3, 14.5, 'Normal'], [4, 16, 'Grande'], [5, 17.5, 'Muito grande']];
const fontSizePx = () => (FONT_SIZES.find(([id]) => id === Number(state.settings.fontSize)) || FONT_SIZES[2])[1];

const UPCOMING_MODES = [['list', 'Lista'], ['calendar', 'Calendário'], ['kanban', 'Kanban'], ['matrix', 'Matriz']];

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

/** Os campos atuais da tarefa no formato de applyEdit, para mudar só um deles. */
const editFields = (task, changes = {}) => ({
  title: task.title,
  notes: task.notes,
  listId: task.listId,
  steps: task.steps,
  when: task.when,
  repeat: task.repeat,
  deadline: task.deadline,
  seriesEnd: task.seriesEnd,
  important: task.important,
  tags: task.tags || [],
  remindAt: task.remindAt,
  extraReminders: task.extraReminders || [],
  remindEach: task.remindEach !== false,
  insist: task.insist,
  ...changes,
});

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
    order: nextOrder(),
    createdAt: new Date().toISOString(),
  });
  render();
  return id;
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
    icon: 'icons/icon-diamante-192.png',
    badge: 'icons/icon-diamante-192.png',
    data: { id: task.id },
    actions: [
      { action: 'done', title: 'Concluir' },
      { action: 'snooze', title: `Adiar ${SNOOZE_MINUTES} min` },
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
  $('#reminders').innerHTML = due.map((task) => `
    <section class="reminder" aria-label="Lembrete">
      <div class="reminder-label">Lembrete: ${escapeHtml(formatDateTime(activeReminder(task, now)).toLowerCase())}</div>
      <div class="reminder-title">${escapeHtml(task.title)}</div>
      <div class="reminder-actions">
        <button class="btn small primary" data-action="complete" data-id="${task.id}">Concluir</button>
        <button class="btn small" data-action="snooze" data-id="${task.id}">Adiar ${SNOOZE_MINUTES} min</button>
        <button class="btn small" data-action="dismiss" data-id="${task.id}">Dispensar</button>
      </div>
    </section>`).join('');
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
  } else if (action === 'open') {
    openTask(id);
  }
}

/* ---------- Telas ---------- */

function taskChips(task, { showWhen = true, showList = false } = {}) {
  const now = today();
  const chips = [];
  const waiting = daysWaiting(task, now);
  if (waiting > 0) chips.push(`<span>há ${waiting} ${waiting === 1 ? 'dia' : 'dias'}</span>`);
  else if (showWhen && task.when && task.when !== now) chips.push(`<span>${escapeHtml(formatDate(task.when))}</span>`);
  if (task.deadline) {
    chips.push(isOverdue(task, now)
      ? `<span class="chip-overdue">Atrasada: era até ${escapeHtml(formatDate(task.deadline).toLowerCase())}</span>`
      : `<span>Até ${escapeHtml(formatDate(task.deadline).toLowerCase())}</span>`);
  }
  if (task.repeat) {
    const end = task.seriesEnd ? `, até ${formatDate(task.seriesEnd).toLowerCase()}` : '';
    chips.push(`<span>↻ ${escapeHtml(repeatLabel(task.repeat) + end)}</span>`);
  }
  const reminder = shownReminder(task, localDateTime());
  const more = (task.extraReminders || []).length;
  if (reminder) chips.push(`<span class="chip-reminder">Lembrar: ${escapeHtml(formatDateTime(reminder).toLowerCase())}${more ? ` +${more}` : ''}${task.insist ? ' · insiste' : ''}</span>`);
  if (task.steps && task.steps.length) {
    chips.push(`<span>${task.steps.filter((s) => s.done).length}/${task.steps.length} etapas</span>`);
  }
  (task.tags || []).forEach((tag) => chips.push(`<span class="chip-tag">#${escapeHtml(tag)}</span>`));
  if (task.notes) chips.push('<span>Nota</span>');
  if (showList && task.listId !== INBOX) chips.push(`<span class="chip-list">${listLabel(findList(task.listId))}</span>`);
  if (task.status === 'done' && task.completedAt) chips.unshift(`<span>Concluída ${escapeHtml(formatDate(localDate(new Date(task.completedAt))).toLowerCase())}</span>`);
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

const MORE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>';

function taskRow(task, options = {}) {
  const done = task.status !== 'open';
  if (state.selecting) {
    const on = state.selected.has(task.id);
    return `
  <li class="task selectable ${on ? 'selected' : ''} ${done ? 'is-done' : ''}" data-id="${task.id}">
    <button class="task-body select-body" data-action="toggle-select" data-id="${task.id}" aria-pressed="${on}">
      <span class="select-box" aria-hidden="true">${on ? '✓' : ''}</span>
      <span class="select-text"><span class="task-title">${escapeHtml(task.title)}</span>${taskChips(task, options)}</span>
    </button>
  </li>`;
  }
  const check = done
    ? `<button class="check done" data-action="reopen" data-id="${task.id}" aria-label="Reabrir ${escapeHtml(task.title)}">${MARK}</button>`
    : `<button class="check${task.repeat ? ' repeats' : ''}" data-action="complete" data-id="${task.id}" aria-label="${escapeHtml(completeLabel(task))}" title="${escapeHtml(task.repeat ? 'Concluir e ir para a próxima' : 'Concluir')}">${MARK}</button>`;
  return `
  <li class="task ${done ? 'is-done' : ''}" data-id="${task.id}">
    ${check}
    <button class="task-body" data-action="open" data-id="${task.id}">
      <span class="task-title">${escapeHtml(task.title)}</span>
      ${taskChips(task, options)}
    </button>
    ${options.draggable && !done ? `<button class="drag" data-drag="${task.id}" aria-label="Reordenar ${escapeHtml(task.title)}: arraste ou use as setas do teclado">${GRIP_ICON}</button>` : ''}
    ${done ? '' : `<button class="icon star ${task.important ? 'on' : ''}" data-action="toggle-important" data-id="${task.id}" aria-pressed="${!!task.important}" aria-label="Importante: ${escapeHtml(task.title)}">${STAR_ICON(task.important)}</button>`}
    <button class="icon more" data-action="task-menu" data-id="${task.id}" aria-label="Mais ações: ${escapeHtml(task.title)}" title="Mais ações">${MORE_ICON}</button>
  </li>`;
}

const taskListHtml = (tasks, options) => `<ul class="task-list">${tasks.map((t) => taskRow(t, options)).join('')}</ul>`;

const quickAdd = (placeholder, context) => `
  <form class="quick-add" data-form="quick-add" data-list="${context.listId || ''}" data-when="${context.when || ''}">
    <input id="quick-input" name="title" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" aria-describedby="quick-preview" autocomplete="off" enterkeyhint="done">
    <button class="btn primary">Adicionar</button>
  </form>
  <div class="quick-preview" id="quick-preview" aria-live="polite" hidden></div>`;

/** O que foi entendido no texto digitado, ou nada se a função estiver desligada. */
function quickParse(text) {
  if (state.settings.parseDates === false || !text.trim() || text === state.quickIgnore) return null;
  const parsed = parseQuickAdd(text, today(), localDateTime().slice(11));
  return parsed.matched ? parsed : null;
}

function renderQuickPreview() {
  const input = $('#quick-input');
  const box = $('#quick-preview');
  if (!input || !box) return;
  const parsed = quickParse(input.value);
  if (!parsed) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const chips = [`<span class="chip">"${escapeHtml(parsed.title)}"</span>`];
  if (parsed.when) chips.push(`<span class="chip">Quando: ${escapeHtml(formatDate(parsed.when).toLowerCase())}</span>`);
  if (parsed.until) chips.push(`<span class="chip">Até: ${escapeHtml(formatDate(parsed.until).toLowerCase())}</span>`);
  if (parsed.repeat) chips.push(`<span class="chip">↻ ${escapeHtml(repeatLabel(parsed.repeat))}</span>`);
  if (parsed.remindAt) chips.push(`<span class="chip">Lembrar: ${escapeHtml(formatDateTime(parsed.remindAt).toLowerCase())}</span>`);
  box.innerHTML = `<span>Entendi:</span>${chips.join('')}<button type="button" class="link-btn" data-action="quick-ignore">Usar o texto como está</button>`;
  box.hidden = false;
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

function todayView() {
  const now = today();
  const tasks = todayTasks(state.tasks, now).sort(byOrder);
  const [y, m, d] = now.split('-').map(Number);
  const long = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `
    <div class="view-head"><div><h1><span>Hoje</span></h1><div class="subtitle">${escapeHtml(long)}</div></div>${selectButton(tasks)}</div>
    ${quickAdd('Adicionar a Hoje', { when: now })}
    ${tasks.length ? taskListHtml(tasks, { showWhen: false, showList: true, draggable: true }) : `<div class="empty">
      <p>Nada planejado para hoje.</p>
      <p class="empty-tip">Digite acima, como "pagar luz sexta 9h" ou "academia toda segunda 7h". Toque numa tarefa para ver os detalhes; use ⋯ para mover, duplicar ou excluir. No celular, deslize para a direita para concluir e para a esquerda para excluir.</p>
    </div>`}`;
}

/** Botão "Selecionar" do topo das telas com tarefas. */
const selectButton = (tasks) => (tasks.length && !state.selecting
  ? '<button class="btn small" data-action="select-start">Selecionar</button>' : '');

function upcomingList() {
  const tasks = upcomingTasks(state.tasks, today());
  const groups = new Map();
  tasks.forEach((task) => groups.set(task.when, [...(groups.get(task.when) || []), task]));
  const body = [...groups].map(([date, items]) =>
    `<h2>${escapeHtml(formatDate(date))}</h2>${taskListHtml(items, { showWhen: false, showList: true })}`).join('');
  return body || '<p class="empty">Nenhuma tarefa com Quando no futuro.</p>';
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
    const classes = ['cal-day', date === now ? 'today' : '', date === selected ? 'selected' : ''].join(' ');
    cells.push(`<button class="${classes}" data-action="cal-day" data-date="${date}" aria-pressed="${date === selected}" aria-label="${d}${count ? `, ${count} tarefa(s)` : ''}">${d}${count ? `<span class="cal-count">${count}</span>` : ''}</button>`);
  }
  const longTitle = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const title = longTitle.charAt(0).toUpperCase() + longTitle.slice(1);
  const dayTasks = open.filter((t) => t.when === selected || t.deadline === selected).sort(byOrder);
  return `
    <div class="cal-head">
      <button class="btn small" data-action="cal-move" data-step="-1" aria-label="Mês anterior">‹</button>
      <strong>${escapeHtml(title)}</strong>
      <button class="btn small" data-action="cal-move" data-step="1" aria-label="Próximo mês">›</button>
    </div>
    <div class="cal-grid">${weekNames.map((name) => `<span class="cal-week" aria-hidden="true">${name}</span>`).join('')}${cells.join('')}</div>
    <h2>${escapeHtml(formatDate(selected))}</h2>
    ${dayTasks.length ? taskListHtml(dayTasks, { showWhen: false, showList: true }) : '<p class="empty">Nada com Quando ou prazo neste dia.</p>'}`;
}

function kanbanView() {
  const open = openTasks();
  const columns = sortedLists().map((list) => [list, open.filter((t) => t.listId === list.id).sort(byOrder)]).filter(([, tasks]) => tasks.length);
  if (!columns.length) return '<p class="empty">Nenhuma tarefa aberta.</p>';
  return `<div class="kanban">${columns.map(([list, tasks]) => `
    <section class="kanban-col" aria-label="${escapeHtml(list.name)}">
      <h3><span class="list-label">${listLabel(list)}</span><span class="count">${tasks.length}</span></h3>
      ${taskListHtml(tasks, {})}
    </section>`).join('')}</div>`;
}

function matrixView() {
  const now = today();
  const open = openTasks().sort(byOrder);
  const quadrants = [
    ['Importante e urgente', (t) => t.important && isUrgent(t, now)],
    ['Importante', (t) => t.important && !isUrgent(t, now)],
    ['Urgente', (t) => !t.important && isUrgent(t, now)],
    ['Nem importante nem urgente', (t) => !t.important && !isUrgent(t, now)],
  ];
  return `
    <p class="subtitle" style="margin:0 0 10px">Urgente: Quando já chegou ou o prazo vence em até 2 dias. Importante: marcada com a estrela.</p>
    <div class="matrix">${quadrants.map(([name, test]) => {
    const tasks = open.filter(test);
    return `<section class="quadrant" aria-label="${name}"><h3><span>${name}</span><span class="count">${tasks.length}</span></h3>
      ${tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty" style="padding:12px 4px">Nada aqui.</p>'}</section>`;
  }).join('')}</div>`;
}

function upcomingView() {
  const mode = UPCOMING_MODES.some(([id]) => id === state.settings.upcomingMode) ? state.settings.upcomingMode : 'list';
  const body = { list: upcomingList, calendar: calendarView, kanban: kanbanView, matrix: matrixView }[mode]();
  return `
    <div class="view-head"><div><h1><span>Próximos dias</span></h1></div></div>
    <div class="segments" role="group" aria-label="Visão">${UPCOMING_MODES.map(([id, name]) => `<button class="${id === mode ? 'on' : ''}" data-action="set-upcoming-mode" data-mode="${id}" aria-pressed="${id === mode}">${name}</button>`).join('')}</div>
    ${body}`;
}

function importantView() {
  const tasks = openTasks().filter((t) => t.important).sort(byOrder);
  return `
    <div class="view-head"><div><h1><span>Importantes</span></h1></div>${selectButton(tasks)}</div>
    ${tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty">Toque na estrela de uma tarefa para ela aparecer aqui.</p>'}`;
}

function tagView(encoded) {
  const tag = decodeURIComponent(encoded || '');
  const tasks = openTasks().filter((t) => (t.tags || []).some((name) => sameTag(name, tag))).sort(byOrder);
  return `
    <div class="view-head"><div><h1><span>#${escapeHtml(tag)}</span></h1><div class="subtitle">Tag</div></div>${selectButton(tasks)}</div>
    ${tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty">Nenhuma tarefa aberta com esta tag.</p>'}`;
}

function listView(id) {
  const list = findList(id);
  if (!list) return listsView();
  const mode = LIST_SORTS.some(([key]) => key === list.sort) ? list.sort : 'manual';
  const inList = state.tasks.filter((t) => t.listId === id && !t.deletedAt);
  const tasks = sortTasks(inList.filter((t) => t.status === 'open'), mode);
  const done = inList.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const sortNote = mode === 'manual' ? '' : `<div class="sort-note">Ordenada por ${escapeHtml(LIST_SORTS.find(([key]) => key === mode)[1].toLowerCase())} · <button class="link-btn" data-action="set-list-sort" data-id="${id}" data-sort="manual">Voltar à minha ordem</button></div>`;
  const doneOpen = state.doneOpen.has(id);
  return `
    <div class="view-head">
      <div><h1><span>${list.emoji ? `${escapeHtml(list.emoji)} ` : ''}${escapeHtml(list.name)}</span></h1>${list.group ? `<div class="subtitle">${escapeHtml(list.group)}</div>` : ''}</div>
      ${selectButton(tasks)}
      <button class="btn small icon-btn" data-action="list-menu" data-id="${id}" aria-label="Opções da lista ${escapeHtml(list.name)}" title="Opções da lista">${MORE_ICON}</button>
    </div>
    ${quickAdd(`Adicionar a ${list.name}`, { listId: id })}
    ${sortNote}
    ${tasks.length ? taskListHtml(tasks, { draggable: mode === 'manual' }) : `<p class="empty">${done.length ? 'Tudo feito nesta lista.' : 'Esta lista está vazia.'}</p>`}
    ${done.length ? `
    <button class="done-toggle" data-action="toggle-done-section" data-id="${id}" aria-expanded="${doneOpen}">${doneOpen ? '▾' : '▸'} Concluídas (${done.length})</button>
    ${doneOpen ? taskListHtml(done, {}) : ''}` : ''}`;
}

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
    <div class="row-wrap">
      <a class="row-link" href="#list/${list.id}"><span class="list-label">${listLabel(list)}</span><span class="count">${openCount(list.id)}</span></a>
      <button class="icon more" data-action="list-menu" data-id="${list.id}" aria-label="Opções da lista ${escapeHtml(list.name)}" title="Opções da lista">${MORE_ICON}</button>
    </div>`;
  const inbox = findList(INBOX);
  const doneCount = activeTasks().filter((t) => t.status === 'done').length;
  return `
    <div class="view-head"><div><h1><span>Listas</span></h1></div>
      <button class="btn small" data-action="organize-lists" ${ungrouped.length + groups.length ? '' : 'disabled'}>Organizar</button>
      <button class="btn small primary" data-action="new-list">Nova lista</button>
    </div>
    <div class="rows">${row(inbox)}${ungrouped.map(row).join('')}</div>
    ${groups.map(([name, lists]) => `<h2 class="group-head"><span>${escapeHtml(name)}</span><button class="icon more small-more" data-action="group-menu" data-group="${escapeHtml(name)}" aria-label="Opções do grupo ${escapeHtml(name)}" title="Opções do grupo">${MORE_ICON}</button></h2><div class="rows">${lists.map(row).join('')}</div>`).join('')}
    ${ungrouped.length + groups.length ? '' : '<p class="empty-tip">Crie listas para separar assuntos (Casa, Trabalho, Mercado). Para juntar listas, dê o mesmo nome de grupo a elas.</p>'}
    <h2>Filtros</h2>
    <div class="rows">
      <a class="row-link" href="#important"><span>Importantes</span><span class="count">${openTasks().filter((t) => t.important).length}</span></a>
      ${allTags().map(([tag, count]) => `<a class="row-link" href="#tag/${encodeURIComponent(tag)}"><span>#${escapeHtml(tag)}</span><span class="count">${count}</span></a>`).join('')}
    </div>
    <h2>Outros</h2>
    <div class="rows">
      <a class="row-link" href="#done"><span>Concluídas</span><span class="count">${doneCount || ''}</span></a>
      <a class="row-link" href="#trash"><span>Lixeira</span><span class="count">${state.tasks.filter((t) => t.deletedAt).length || ''}</span></a>
    </div>`;
}

/** Organizar: mudar a ordem das listas e cuidar dos grupos. */
function organizeView() {
  const { ungrouped, groups } = groupedLists();
  const section = (lists) => `<div class="rows">${lists.map((list, index) => `
    <div class="row-wrap organize-row">
      <span class="row-link"><span class="list-label">${listLabel(list)}</span></span>
      <button class="icon" data-action="move-list" data-id="${list.id}" data-step="-1" ${index === 0 ? 'disabled' : ''} aria-label="Subir ${escapeHtml(list.name)}">↑</button>
      <button class="icon" data-action="move-list" data-id="${list.id}" data-step="1" ${index === lists.length - 1 ? 'disabled' : ''} aria-label="Descer ${escapeHtml(list.name)}">↓</button>
      <button class="icon more" data-action="list-menu" data-id="${list.id}" aria-label="Opções da lista ${escapeHtml(list.name)}">${MORE_ICON}</button>
    </div>`).join('')}</div>`;
  return `
    <div class="view-head"><div><h1><span>Organizar listas</span></h1><div class="subtitle">Ordem das listas e grupos</div></div><a class="btn small primary btn-link" href="#lists">Pronto</a></div>
    <p class="empty-tip">Use ↑ e ↓ para mudar a ordem. A Entrada fica sempre em primeiro. Os grupos aparecem em ordem alfabética; use ⋯ no grupo para renomear ou desfazer.</p>
    ${ungrouped.length ? `<h2>Sem grupo</h2>${section(ungrouped)}` : ''}
    ${groups.map(([name, lists]) => `<h2 class="group-head"><span>${escapeHtml(name)}</span><button class="icon more small-more" data-action="group-menu" data-group="${escapeHtml(name)}" aria-label="Opções do grupo ${escapeHtml(name)}">${MORE_ICON}</button></h2>${section(lists)}`).join('')}
    <div class="actions" style="margin-top:14px"><button class="btn" data-action="new-list">Nova lista</button><button class="btn" data-action="new-group">Novo grupo</button></div>`;
}

function doneView() {
  const single = activeTasks().filter((t) => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const series = state.log.slice().sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const logRow = (item) => `
    <li class="task is-done">
      <span class="check done" aria-hidden="true">${MARK}</span>
      <button class="task-body" data-action="${findTask(item.taskId) && !findTask(item.taskId).deletedAt ? 'open' : 'noop'}" data-id="${item.taskId}">
        <span class="task-title">${escapeHtml(item.title)}</span>
        <span class="chips"><span>${item.completedAt ? `Concluída ${escapeHtml(formatDate(localDate(new Date(item.completedAt))).toLowerCase())}` : ''}</span>${item.occurrence ? `<span>↻ ocorrência de ${escapeHtml(formatDate(item.occurrence).toLowerCase())}</span>` : ''}</span>
      </button>
      <button class="icon" data-action="forget-log" data-id="${item.id}" aria-label="Apagar do histórico: ${escapeHtml(item.title)}" title="Apagar do histórico">×</button>
    </li>`;
  const empty = !single.length && !series.length;
  return `
    <div class="view-head"><div><h1><span>Concluídas</span></h1></div>
      ${single.length ? selectButton(single) : ''}
      ${empty ? '' : '<button class="btn small danger" data-action="clear-done">Limpar</button>'}
    </div>
    ${single.length ? `<h2>Tarefas</h2>${taskListHtml(single, { showList: true })}` : ''}
    ${series.length ? `<h2>Histórico das repetições</h2><ul class="task-list">${series.map(logRow).join('')}</ul>` : ''}
    ${empty ? '<p class="empty">Nada concluído ainda.</p>' : ''}`;
}

function trashView() {
  const tasks = state.tasks.filter((t) => t.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const row = (task) => `
    <li class="task">
      <div class="task-body" style="padding-left:12px"><span class="task-title">${escapeHtml(task.title)}</span>
        <span class="chips"><span>Excluída ${escapeHtml(formatDate(localDate(new Date(task.deletedAt))).toLowerCase())}</span><span class="chip-list">${findList(task.listId) ? listLabel(findList(task.listId)) : 'lista excluída (volta para a Entrada)'}</span></span>
        <span class="actions" style="margin-top:8px">
          <button class="btn small" data-action="restore" data-id="${task.id}">Restaurar</button>
          <button class="btn small danger" data-action="purge" data-id="${task.id}">Excluir de vez</button>
        </span>
      </div>
    </li>`;
  return `
    <div class="view-head"><div><h1><span>Lixeira</span></h1></div>
      ${tasks.length ? '<button class="btn small" data-action="restore-all">Restaurar tudo</button><button class="btn small danger" data-action="empty-trash">Esvaziar</button>' : ''}
    </div>
    ${tasks.length ? `<ul class="task-list">${tasks.map(row).join('')}</ul>` : '<p class="empty">A lixeira está vazia.</p>'}`;
}

function searchResults() {
  const query = state.search.trim().toLocaleLowerCase('pt-BR');
  if (!query) return '<p class="empty">Busque por título, nota, etapa, tag ou nome de lista.</p>';
  const matches = (task) => [task.title, task.notes, listName(task.listId), ...(task.steps || []).map((s) => s.title), ...(task.tags || [])]
    .some((text) => (text || '').toLocaleLowerCase('pt-BR').includes(query));
  const withDone = !!state.settings.searchDone;
  const tasks = state.tasks.filter((t) => !t.deletedAt && (t.status === 'open' || (withDone && t.status === 'done')) && matches(t))
    .sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || byOrder(a, b));
  return tasks.length ? taskListHtml(tasks, { showList: true }) : `<p class="empty">Nenhuma tarefa ${withDone ? '' : 'aberta '}encontrada.</p>`;
}

function searchView() {
  return `
    <div class="view-head"><div><h1><span>Busca</span></h1></div></div>
    <input class="search" id="search-input" type="search" placeholder="Buscar tarefas" aria-label="Buscar tarefas" value="${escapeHtml(state.search)}">
    <label class="check-line" style="margin:-6px 0 8px"><input type="checkbox" id="search-done" ${state.settings.searchDone ? 'checked' : ''}> Incluir concluídas</label>
    <div id="search-results">${searchResults()}</div>`;
}

function syncStatusText() {
  const { state: current, message, at } = syncEngine.status;
  if (current === 'running') return 'Sincronizando...';
  if (current === 'error' || current === 'offline') return message;
  if (current === 'ok' && at) return `Sincronizado às ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`;
  return 'Conectado.';
}

function syncPanel() {
  if (!state.sync?.token) {
    return `
    <section class="panel">
      <h3>Sincronização</h3>
      <p>Entre com sua conta para manter o note e os celulares iguais. Depois de entrar, o aparelho fica conectado.</p>
      <div class="field"><label for="sync-login">Login</label><input id="sync-login" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
      <div class="field" style="margin-top:8px"><label for="sync-password">Senha</label><input id="sync-password" type="password" autocomplete="current-password"></div>
      <div class="actions" style="margin-top:10px"><button class="btn primary" data-action="sync-login">Entrar</button></div>
      <h3 style="margin-top:16px">Primeira vez</h3>
      <p>Crie a conta no aparelho que tem suas tarefas, preenchendo login e senha acima. Use ao menos 12 caracteres. Só existe uma conta, e a senha não pode ser recuperada pelo app.</p>
      <div class="field"><label for="sync-password-2">Repita a senha</label><input id="sync-password-2" type="password" autocomplete="new-password"></div>
      <div class="actions" style="margin-top:10px"><button class="btn" data-action="sync-register">Criar conta</button></div>
    </section>`;
  }
  return `
    <section class="panel">
      <h3>Sincronização</h3>
      <p>Conectado como ${escapeHtml(state.sync.login)}.</p>
      <p id="sync-status" role="status">${escapeHtml(syncStatusText())}</p>
      <div class="actions">
        <button class="btn primary" data-action="sync-now">Sincronizar agora</button>
        <button class="btn" data-action="sync-toggle-password">Trocar senha</button>
        <button class="btn danger" data-action="sync-logout">Sair</button>
      </div>
      ${state.showPasswordForm ? `
      <div class="field" style="margin-top:12px"><label for="sync-current">Senha atual</label><input id="sync-current" type="password" autocomplete="current-password"></div>
      <div class="field" style="margin-top:8px"><label for="sync-new">Nova senha</label><input id="sync-new" type="password" autocomplete="new-password"></div>
      <div class="field" style="margin-top:8px"><label for="sync-new-2">Repita a nova senha</label><input id="sync-new-2" type="password" autocomplete="new-password"></div>
      <div class="actions" style="margin-top:10px"><button class="btn" data-action="sync-change-password">Salvar nova senha</button></div>` : ''}
    </section>`;
}

function pushPanel() {
  const settings = pushSettings();
  const head = '<h3>Lembretes com o app fechado</h3>';
  if (!pushSupported()) return `<section class="panel">${head}<p>Este navegador não recebe avisos com o app fechado.</p></section>`;
  if (!state.sync?.token) return `<section class="panel">${head}<p>Os avisos saem do servidor de sincronização. Entre na sua conta, em Sincronização, para ativar.</p></section>`;
  const on = !!state.push?.enabled;
  const devices = state.push?.devices;
  return `
    <section class="panel">
      ${head}
      <p>O servidor avisa este aparelho mesmo com o app fechado, com até 1 minuto de atraso. Vale também para o lembrete insistente e o resumo diário.</p>
      <label class="check-line"><input type="checkbox" id="push-enabled" ${on ? 'checked' : ''}> Receber neste aparelho</label>
      ${on ? `<p style="margin:6px 0 0">Ativado neste aparelho${devices ? `. Aparelhos inscritos na conta: ${devices}` : ''}.</p>
      <div class="actions"><button class="btn" data-action="push-test">Testar com o app fechado</button></div>` : ''}
      <h3 style="margin-top:16px">Resumo diário</h3>
      <label class="check-line"><input type="checkbox" id="push-digest" ${settings.digest ? 'checked' : ''}> Avisar as tarefas de Hoje todo dia às</label>
      <div class="field" style="max-width:160px"><input type="time" id="push-digest-time" aria-label="Horário do resumo" value="${settings.digestTime}" ${settings.digest ? '' : 'disabled'}></div>
      <h3 style="margin-top:16px">Lembrete insistente</h3>
      <p>Nas tarefas marcadas com "Insistir até eu reagir", repete o aviso até você concluir, adiar ou dispensar, no máximo ${INSIST_MAX} vezes.</p>
      <div class="segments" role="group" aria-label="Intervalo da insistência">
        ${[5, 10, 15, 30].map((minutes) => `<button class="${minutes === settings.insistMinutes ? 'on' : ''}" data-action="set-insist" data-minutes="${minutes}" aria-pressed="${minutes === settings.insistMinutes}">${minutes} min</button>`).join('')}
      </div>
      <p style="margin:8px 0 0">O resumo e a insistência valem para todos os aparelhos da conta.</p>
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

function settingsView() {
  const support = 'Notification' in window;
  const permission = support ? Notification.permission : 'denied';
  const statusText = {
    granted: 'Ativadas neste aparelho.',
    denied: support ? 'Bloqueadas. Libere nas configurações do navegador.' : 'Este navegador não oferece notificações.',
    default: 'Ainda não ativadas.',
  }[permission];
  const backup = state.settings.lastExport
    ? `Último backup: ${formatDate(localDate(new Date(state.settings.lastExport))).toLowerCase()}.`
    : 'Nenhum backup feito ainda.';
  const { theme, highlight } = state.settings;
  const themeOptions = [...THEMES, { id: 'system', name: 'Sistema' }];
  const highlightPanel = resolveTheme(theme, prefersDark()) === 'marca-texto' ? `
    <section class="panel">
      <h3>Cor do marca-texto</h3>
      <p>Vale para títulos, seleções e lembretes deste tema.</p>
      <div class="swatches">
        ${HIGHLIGHTS.map((item) => `<button class="swatch ${item.color.toLowerCase() === highlight.toLowerCase() ? 'on' : ''}" style="--swatch:${item.color};--swatch-text:${textOn(item.color)}" data-action="set-highlight" data-color="${item.color}" ${item.color.toLowerCase() === highlight.toLowerCase() ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${item.name}</button>`).join('')}
      </div>
      <label class="custom-color"><input type="color" id="highlight-custom" value="${highlight.toLowerCase()}"> Escolher qualquer cor</label>
      <p class="help-warning" id="highlight-warning" ${isTooLight(highlight) ? '' : 'hidden'}>Esta cor é muito clara e quase some no papel branco.</p>
    </section>` : '';
  const segmented = (label, action, options, current, dataKey = 'value') => `
      <div class="segments" role="group" aria-label="${label}">
        ${options.map(([id, name]) => `<button class="${String(id) === String(current) ? 'on' : ''}" data-action="${action}" data-${dataKey}="${id}" aria-pressed="${String(id) === String(current)}">${name}</button>`).join('')}
      </div>`;
  const startView = START_VIEWS.some(([id]) => id === state.settings.startView) ? state.settings.startView : 'today';
  return `
    <div class="view-head"><div><h1><span>Config.</span></h1></div></div>
    <nav class="settings-index" aria-label="Seções">
      <a href="#settings" data-action="jump" data-target="cfg-geral">Geral</a>
      <a href="#settings" data-action="jump" data-target="cfg-aparencia">Aparência</a>
      <a href="#settings" data-action="jump" data-target="cfg-avisos">Avisos</a>
      <a href="#settings" data-action="jump" data-target="cfg-conta">Conta</a>
      <a href="#settings" data-action="jump" data-target="cfg-dados">Dados</a>
    </nav>
    <h2 id="cfg-geral">Geral</h2>
    <section class="panel">
      <h3>Ao abrir o app, mostrar</h3>
      ${segmented('Tela inicial', 'set-start-view', START_VIEWS, startView)}
      <h3 style="margin-top:12px">Lista das tarefas novas</h3>
      <p>Para onde vão as tarefas criadas em Hoje, pelo atalho do ícone ou compartilhadas de outro app.</p>
      <div class="field"><select id="default-list" aria-label="Lista das tarefas novas">
        ${sortedLists().map((list) => `<option value="${list.id}" ${list.id === defaultListId() ? 'selected' : ''}>${escapeHtml(`${list.emoji ? `${list.emoji} ` : ''}${list.name}`)}</option>`).join('')}
      </select></div>
      <h3 style="margin-top:12px">A semana começa no</h3>
      ${segmented('Início da semana', 'set-week-start', [[0, 'Domingo'], [1, 'Segunda']], Number(state.settings.weekStart) === 1 ? 1 : 0)}
      <label class="check-line"><input type="checkbox" id="parse-dates" ${state.settings.parseDates === false ? '' : 'checked'}> Entender datas ao digitar, como "pagar luz sexta 9h"</label>
      <label class="check-line"><input type="checkbox" id="confirm-delete" ${state.settings.confirmDelete ? 'checked' : ''}> Perguntar antes de mandar uma tarefa para a lixeira</label>
      <h3 style="margin-top:12px">Campo Até nos detalhes da tarefa</h3>
      <div class="segments themes" role="group" aria-label="Modo do campo Até">
        ${Object.entries(UNTIL_MODES).map(([id, [name]]) => `<button class="${id === untilMode() ? 'on' : ''}" data-action="set-until-mode" data-mode="${id}" aria-pressed="${id === untilMode()}">${name}</button>`).join('')}
      </div>
      <p>${UNTIL_MODES[untilMode()][1]}</p>
      <p style="margin:0">No teclado do note: N cria uma tarefa e / abre a busca.</p>
    </section>
    <h2 id="cfg-aparencia">Aparência</h2>
    <section class="panel">
      <h3>Tema</h3>
      <div class="segments themes" role="group" aria-label="Tema">
        ${themeOptions.map((item) => `<button class="${item.id === theme ? 'on' : ''}" data-action="set-theme" data-theme-id="${item.id}" aria-pressed="${item.id === theme}">${item.name}</button>`).join('')}
      </div>
      <p>Em Sistema, o app usa Diamante no modo escuro e Barquinho no modo claro.</p>
      <h3 style="margin-top:6px">Tamanho da letra</h3>
      <div class="segments font-sizes" role="group" aria-label="Tamanho da letra">
        ${FONT_SIZES.map(([id, px, name]) => `<button class="${id === Number(state.settings.fontSize || 3) ? 'on' : ''}" data-action="set-font-size" data-size="${id}" aria-pressed="${id === Number(state.settings.fontSize || 3)}" aria-label="${name}" title="${name}"><span style="font-size:${px}px">Aa</span></button>`).join('')}
      </div>
      <p style="margin:0">${(FONT_SIZES.find(([id]) => id === Number(state.settings.fontSize || 3)) || FONT_SIZES[2])[2]}.</p>
    </section>
    ${highlightPanel}
    <h2 id="cfg-avisos">Avisos</h2>
    <section class="panel">
      <h3>Notificações</h3>
      <p>${statusText} Com o app aberto, os avisos disparam na hora. Ao abrir, os atrasados aparecem em destaque.</p>
      <div class="actions">
        ${permission === 'default' ? '<button class="btn primary" data-action="enable-notifications">Ativar notificações</button>' : ''}
        ${permission === 'granted' ? '<button class="btn" data-action="test-notification">Enviar teste</button>' : ''}
      </div>
    </section>
    ${pushPanel()}
    <h2 id="cfg-conta">Conta e sincronização</h2>
    ${syncPanel()}
    <h2 id="cfg-dados">Dados</h2>
    <section class="panel">
      <h3>Backup</h3>
      <p>${state.sync?.token ? 'Suas tarefas também ficam guardadas no servidor de sincronização.' : 'Seus dados ficam só neste aparelho. Limpar os dados do navegador apaga tudo.'} ${backup}</p>
      <div class="actions">
        <button class="btn primary" data-action="export">Exportar JSON</button>
        <button class="btn" data-action="import">Importar JSON</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>
    <section class="panel">
      <h3>Limpeza</h3>
      <p>Concluídas: ${activeTasks().filter((t) => t.status === 'done').length} tarefa(s) e ${state.log.length} registro(s) de repetição. Lixeira: ${state.tasks.filter((t) => t.deletedAt).length}.</p>
      <div class="actions">
        <button class="btn" data-action="clear-done">Limpar concluídas</button>
        <button class="btn danger" data-action="empty-trash">Esvaziar lixeira</button>
      </div>
    </section>
    <section class="panel">
      <h3>Sobre</h3>
      <p>${APP_NAME}, versão ${APP_VERSION}. As atualizações chegam sozinhas quando o app abre com internet.</p>
      <div class="actions"><button class="btn" data-action="check-update">Buscar atualização agora</button></div>
    </section>`;
}

function currentRoute() {
  const hash = location.hash.slice(1) || 'today';
  const [name, id] = hash.split('/');
  return { name, id };
}

function renderNav() {
  const route = currentRoute();
  const isLists = ['lists', 'list', 'done', 'trash', 'important', 'tag', 'organize'].includes(route.name);
  const dueCount = todayTasks(state.tasks, today()).length;
  const item = (href, label, active, count, extra = '') => `
    <a class="nav-item ${extra} ${active ? 'active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>
      <span class="label">${escapeHtml(label)}</span>${count ? `<span class="count">${count}</span>` : ''}
    </a>`;
  const desktopList = (list) => item(`#list/${list.id}`, `${list.emoji ? `${list.emoji} ` : ''}${list.name}`, route.name === 'list' && route.id === list.id, openCount(list.id), 'nav-only-desktop');
  const { ungrouped, groups } = groupedLists();
  const inbox = state.lists.find((l) => l.id === INBOX);
  $('#nav').innerHTML = `
    ${item('#today', 'Hoje', route.name === 'today', dueCount)}
    ${item('#upcoming', 'Próximos', route.name === 'upcoming')}
    ${item('#important', 'Importantes', route.name === 'important', openTasks().filter((t) => t.important).length, 'nav-only-desktop')}
    ${desktopList(inbox)}
    ${ungrouped.map(desktopList).join('')}
    ${groups.map(([name, lists]) => `<span class="nav-group">${escapeHtml(name)}</span>${lists.map(desktopList).join('')}`).join('')}
    ${item('#lists', 'Listas', route.name === 'lists' || (isLists && matchMedia('(max-width: 799px)').matches))}
    <span class="nav-spacer"></span>
    ${item('#done', 'Concluídas', route.name === 'done', 0, 'nav-only-desktop')}
    ${item('#trash', 'Lixeira', route.name === 'trash', 0, 'nav-only-desktop')}
    ${item('#search', 'Busca', route.name === 'search')}
    ${item('#settings', 'Config.', route.name === 'settings')}`;
}

function render() {
  const route = currentRoute();
  const views = {
    today: todayView, upcoming: upcomingView, lists: listsView, done: doneView,
    trash: trashView, search: searchView, settings: settingsView,
    list: () => listView(route.id),
    important: importantView,
    tag: () => tagView(route.id),
    organize: organizeView,
  };
  renderNav();
  $('#view').innerHTML = (views[route.name] || todayView)();
  renderReminders();
  renderSelectionBar();
}

/* ---------- Seleção de várias tarefas ---------- */

function renderSelectionBar() {
  let bar = $('#select-bar');
  if (!state.selecting) {
    bar?.remove();
    document.body.classList.remove('selecting');
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'select-bar';
    bar.className = 'select-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Ações das tarefas selecionadas');
    document.body.append(bar);
  }
  document.body.classList.add('selecting');
  const visible = [...document.querySelectorAll('#view .task.selectable')].map((row) => row.dataset.id);
  const n = state.selected.size;
  const off = n ? '' : 'disabled';
  const allOn = visible.length && visible.every((id) => state.selected.has(id));
  bar.innerHTML = `
    <div class="select-count"><span><strong>${n}</strong> selecionada${n === 1 ? '' : 's'}</span>
      <button class="link-btn" data-action="select-all">${allOn ? 'Nenhuma' : 'Todas'}</button>
      <button class="btn small primary" data-action="select-end">Pronto</button></div>
    <div class="select-actions">
      <button class="btn small" data-action="bulk" data-op="complete" ${off}>Concluir</button>
      <button class="btn small" data-action="bulk" data-op="today" ${off}>Hoje</button>
      <button class="btn small" data-action="bulk" data-op="important" ${off} aria-label="Importante">★</button>
      <button class="btn small" data-action="bulk" data-op="move" ${off}>Mover</button>
      <button class="btn small danger" data-action="bulk" data-op="trash" ${off}>Excluir</button>
    </div>`;
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
  const allImportant = ids.every((id) => findTask(id)?.important);
  const changes = {
    today: (task) => editTask(task.id, { when: today() }),
    important: (task) => saveTask({ ...task, important: !allImportant }),
    trash: (task) => saveTask({ ...task, deletedAt: now }),
  };
  const labels = {
    today: `${ids.length} tarefa(s) para hoje.`,
    important: allImportant ? 'Estrela retirada.' : 'Marcadas como importantes.',
    trash: `${ids.length} tarefa(s) na lixeira.`,
  };
  await bulkApply(ids, labels[op], changes[op]);
}

/* ---------- Menus (folha de opções) ---------- */

let sheetItems = [];

/** Abre uma folha com opções; cada item é [rótulo, função, {danger, disabled}]. */
function openSheet(title, items, subtitle = '') {
  sheetItems = items.filter(Boolean);
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <div class="sheet">
      <div class="form-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}</div><button type="button" class="btn small" data-action="close-dialog">Fechar</button></div>
      <div class="sheet-items">
        ${sheetItems.map(([label, , opts = {}], index) => `<button class="sheet-item ${opts.danger ? 'danger' : ''} ${opts.on ? 'on' : ''}" data-action="sheet" data-index="${index}" ${opts.disabled ? 'disabled' : ''}>${opts.html ? label : escapeHtml(label)}</button>`).join('')}
      </div>
    </div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.sheet-item:not(:disabled)')?.focus();
}

function openTaskMenu(id) {
  const task = findTask(id);
  if (!task) return;
  const open = task.status === 'open';
  const close = () => $('#dialog').close();
  const tomorrow = addDays(today(), 1);
  openSheet(task.title, [
    open ? [task.repeat ? 'Concluir e ir para a próxima' : 'Concluir', async () => { close(); await complete(id); }]
      : ['Reabrir', async () => { close(); await reopen(id); }],
    ['Abrir detalhes', () => openTask(id)],
    open && [task.important ? 'Tirar a estrela' : 'Marcar como importante', async () => { close(); await saveTask({ ...task, important: !task.important }); render(); }],
    open && task.when !== today() && ['Fazer hoje', async () => { close(); if (await editTask(id, { when: today() })) { render(); showToast('Movida para hoje.'); } }],
    open && task.when !== tomorrow && ['Fazer amanhã', async () => { close(); if (await editTask(id, { when: tomorrow })) { render(); showToast('Movida para amanhã.'); } }],
    open && task.when && !task.repeat && ['Tirar a data', async () => { close(); if (await editTask(id, { when: null })) render(); }],
    ['Mover para outra lista', () => openMoveSheet([id])],
    ['Duplicar', async () => { close(); await duplicateTask(id); }],
    ['Selecionar várias', () => { close(); state.selecting = true; state.selected = new Set([id]); render(); }],
    ['Excluir', async () => { close(); await trashWithConfirm(id); }, { danger: true }],
  ]);
}

function openMoveSheet(ids) {
  const tasks = ids.map(findTask).filter(Boolean);
  const current = tasks.length === 1 ? tasks[0].listId : null;
  openSheet(tasks.length === 1 ? 'Mover para' : `Mover ${tasks.length} tarefas para`, [
    ...sortedLists().map((list) => [`${listLabel(list)}${list.group ? ` <span class="sheet-hint">${escapeHtml(list.group)}</span>` : ''}`, async () => {
      $('#dialog').close();
      state.selecting = false;
      state.selected.clear();
      await bulkApply(ids, `Movida${tasks.length === 1 ? '' : 's'} para ${list.name}.`, (task) => saveTask({ ...task, listId: list.id }));
    }, { html: true, on: list.id === current, disabled: list.id === current }]),
    ['+ Nova lista…', () => openListDialog(null, { moveIds: ids }), {}],
  ]);
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
  openSheet(list.name, [
    currentRoute().id !== id && ['Abrir', () => { close(); location.hash = `#list/${id}`; }],
    !isInbox && ['Editar nome, emoji, cor e grupo', () => openListDialog(id)],
    ['Ordenar tarefas por…', () => openSortSheet(id)],
    doneCount && [state.doneOpen.has(id) ? 'Esconder concluídas' : `Mostrar concluídas (${doneCount})`, () => { close(); toggleDoneSection(id); }],
    doneCount && [`Limpar concluídas (${doneCount})`, async () => { close(); await clearListDone(id); }],
    openN && ['Selecionar tarefas', () => { close(); location.hash = `#list/${id}`; state.selecting = true; state.selected.clear(); render(); }],
    !isInbox && ['Duplicar lista (sem as tarefas)', async () => { close(); await duplicateList(id); }],
    !isInbox && ['Organizar listas', () => { close(); location.hash = '#organize'; }],
    !isInbox && ['Excluir lista', () => openDeleteList(id), { danger: true }],
    isInbox && ['A Entrada não pode ser renomeada nem excluída.', () => {}, { disabled: true }],
  ], list.group ? `Grupo: ${escapeHtml(list.group)}` : '');
}

function openSortSheet(id) {
  const list = findList(id);
  const current = list.sort || 'manual';
  openSheet(`Ordenar ${list.name}`, LIST_SORTS.map(([key, name]) => [
    `${key === current ? '✓ ' : ''}${name}`,
    async () => { $('#dialog').close(); await setListSort(id, key); },
    { on: key === current },
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

function openTask(id) {
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
  ].filter(Boolean).join(' · ');
  const granted = 'Notification' in window && Notification.permission === 'granted';
  let notifyHint = 'Sinal visual no app. Para receber notificação, ative em Config.';
  if (granted) {
    notifyHint = state.push?.enabled
      ? 'Avisa mesmo com o app fechado.'
      : 'Avisa com o app aberto. Para avisar com ele fechado, ative em Config.';
  }
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

  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form" data-form="task" data-id="${task.id}" novalidate>
      <div class="form-head"><h2>Detalhes da tarefa</h2><button type="button" class="btn small" data-action="close-dialog">Fechar</button></div>
      <div class="error" id="form-error" role="alert" hidden></div>
      <div class="field"><label for="f-title">Título</label><input id="f-title" name="title" value="${escapeHtml(task.title)}" required></div>
      <div class="grid-2">
        <div class="field">
          <label for="f-when">Quando</label>
          <input id="f-when" type="date" name="when" value="${task.when || ''}">
          <div class="shortcuts">
            <button type="button" class="link-btn" data-action="set-when" data-days="0">Hoje</button>
            <button type="button" class="link-btn" data-action="set-when" data-days="1">Amanhã</button>
          </div>
        </div>
        ${untilField}
      </div>
      <div class="field">
        <label for="f-freq">Repetir</label>
        <select id="f-freq" name="freq">
          <option value="">Não repete</option>
          ${Object.entries(FREQ_LABELS).map(([value, [name]]) => `<option value="${value}" ${repeat.freq === value ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
        <div class="help" id="repeat-help"></div>
      </div>
      <div id="repeat-options" class="grid-2" hidden>
        <div class="field"><label for="f-interval">A cada</label><input id="f-interval" type="number" min="1" max="99" name="interval" value="${repeat.interval || 1}" inputmode="numeric"></div>
        <div class="field" id="unit-field"><span class="label-text">Unidade</span><div class="help" id="unit-text" style="min-height:44px;display:flex;align-items:center"></div></div>
      </div>
      <div class="field" id="weekday-field" hidden>
        <span class="label-text">Dias da semana</span>
        <div class="weekdays">
          ${WEEKDAYS.map((name, index) => `<label><input type="checkbox" name="weekday" value="${index}" aria-label="${name}" ${(repeat.weekdays || []).includes(index) ? 'checked' : ''}><span>${name[0]}</span></label>`).join('')}
        </div>
      </div>
      <div id="repeat-extra" hidden>
        <label class="check-line"><input type="checkbox" name="fromCompletion" ${repeat.fromCompletion ? 'checked' : ''}> Contar a partir da conclusão</label>
        <div class="field">
          <label for="f-count">Terminar após (vezes)</label>
          <input id="f-count" type="number" min="1" max="999" name="count" value="${repeat.count || ''}" placeholder="Sem limite" inputmode="numeric">
          <div class="help">${repeat.count ? `Feitas ${repeat.done || 0} de ${repeat.count}.` : 'Deixe vazio para repetir sem limite.'}</div>
        </div>
      </div>
      ${seriesField}
      <div class="field">
        <label for="f-remind">Lembrar</label>
        <input id="f-remind" type="datetime-local" name="remindAt" value="${task.remindAt || ''}">
        <div id="extra-reminders" class="rows">${(task.extraReminders || []).map(extraReminderRow).join('')}</div>
        <div class="help">${notifyHint}</div>
        <label class="check-line" id="remind-each-line" hidden><input type="checkbox" name="remindEach" ${task.remindEach !== false ? 'checked' : ''}> Lembrar em cada ocorrência</label>
      </div>
      <button type="button" class="btn" data-action="add-reminder">Adicionar outro lembrete</button>
      <label class="check-line" id="insist-line"><input type="checkbox" name="insist" ${task.insist ? 'checked' : ''}> Insistir até eu reagir (a cada ${pushSettings().insistMinutes} min, até ${INSIST_MAX} vezes)</label>
      <div class="field"><label for="f-list">Lista</label><select id="f-list" name="listId">${options(task.listId)}</select></div>
      <div class="field">
        <label for="f-tags">Tags</label>
        <input id="f-tags" name="tags" list="tag-names" value="${escapeHtml((task.tags || []).join(', '))}" placeholder="casa, mercado" autocomplete="off">
        <datalist id="tag-names">${allTags().map(([tag]) => `<option value="${escapeHtml(tag)}">`).join('')}</datalist>
        <div class="help">Separe por vírgula.</div>
      </div>
      <label class="check-line"><input type="checkbox" name="important" ${task.important ? 'checked' : ''}> Importante</label>
      <div class="field">
        <span class="label-text">Etapas</span>
        <div id="steps" class="rows"></div>
        <div class="quick-add" style="margin:0"><div class="field" style="flex:1"><input id="step-input" aria-label="Nova etapa" placeholder="Nova etapa" autocomplete="off"></div><button type="button" class="btn" data-action="add-step">Adicionar</button></div>
      </div>
      <div class="field"><label for="f-notes">Notas</label><textarea id="f-notes" name="notes">${escapeHtml(task.notes)}</textarea></div>
      ${info ? `<p class="help task-info">${escapeHtml(info)}</p>` : ''}
      <div class="form-foot">
        <div>
          ${task.deletedAt
    ? `<button type="button" class="btn" data-action="restore" data-id="${task.id}">Restaurar</button>`
    : `<button type="button" class="btn danger" data-action="trash" data-id="${task.id}">Excluir</button>`}
          ${task.status === 'open' ? `<button type="button" class="btn primary" data-action="complete-from-dialog" data-id="${task.id}">${task.repeat ? 'Concluir e ir para a próxima' : 'Concluir'}</button>`
    : `<button type="button" class="btn" data-action="reopen-from-dialog" data-id="${task.id}">Reabrir</button>`}
          ${task.repeat && task.status === 'open' ? `<button type="button" class="btn" data-action="skip" data-id="${task.id}">Pular ocorrência</button>` : ''}
          <button type="button" class="btn" data-action="duplicate-from-dialog" data-id="${task.id}">Duplicar</button>
        </div>
        <div><button class="btn primary">Salvar</button></div>
      </div>
    </form>`;
  renderSteps();
  updateFormHints();
  if (!dialog.open) dialog.showModal();
  dialogSnapshot = formSnapshot();
}

// Para avisar antes de fechar os detalhes com alterações não salvas.
let dialogSnapshot = null;
function formSnapshot() {
  const form = $('form[data-form="task"]');
  return form ? JSON.stringify({ ...readForm(form), steps: draftSteps }) : null;
}
const hasUnsavedChanges = () => dialogSnapshot !== null && formSnapshot() !== null && formSnapshot() !== dialogSnapshot;

function closeDialog() {
  if (hasUnsavedChanges() && !confirm('Descartar as alterações desta tarefa?')) return;
  dialogSnapshot = null;
  $('#dialog').close();
}

function extraReminderRow(value = '') {
  return `
    <div class="step field" style="display:flex">
      <input type="datetime-local" name="extraReminder" aria-label="Outro lembrete" value="${escapeHtml(value)}">
      <button type="button" class="step-remove" data-action="remove-reminder" aria-label="Remover lembrete">×</button>
    </div>`;
}

function renderSteps() {
  const container = $('#steps');
  if (!container) return;
  container.innerHTML = draftSteps.map((step, index) => `
    <div class="step field" style="display:flex">
      <input type="checkbox" aria-label="Etapa feita" data-step-done="${index}" ${step.done ? 'checked' : ''}>
      <input type="text" aria-label="Título da etapa" data-step-title="${index}" value="${escapeHtml(step.title)}">
      <button type="button" class="step-remove" data-action="remove-step" data-index="${index}" aria-label="Remover etapa">×</button>
    </div>`).join('');
}

function readForm(form) {
  const data = new FormData(form);
  const freq = data.get('freq');
  const fields = {
    title: data.get('title'),
    when: data.get('when'),
    remindAt: data.get('remindAt'),
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
      interval: data.get('interval'),
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
  const freq = form.elements.freq.value;
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
  $('#repeat-options').hidden = !freq;
  $('#weekday-field').hidden = freq !== 'weekly';
  const hasReminder = !!form.elements.remindAt.value || [...form.querySelectorAll('[name="extraReminder"]')].some((input) => input.value);
  $('#remind-each-line').hidden = !freq || !hasReminder;
  $('#insist-line').hidden = !hasReminder;
  if (freq) $('#unit-text').textContent = FREQ_LABELS[freq][1];
  const help = $('#repeat-help');
  help.textContent = '';
  if (freq && !form.elements.when.value) {
    const result = applyEdit(findTask(form.dataset.id), readForm(form), today());
    if (result.task && result.whenFilled) {
      help.textContent = `Quando será preenchido com ${formatDate(result.task.when).toLowerCase()} ao salvar.`;
    }
  }
}

async function submitTask(form) {
  const prev = findTask(form.dataset.id);
  const fields = readForm(form);
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
  await checkReminders();
  if (result.whenFilled) showToast(`Quando preenchido com ${formatDate(result.task.when).toLowerCase()}.`);
}

/* ---------- Janela da lista ---------- */

const EMOJI_SUGGESTIONS = ['🏠', '💼', '🛒', '💰', '❤️', '📚', '🎯', '✈️', '🔧', '🐾', '🎉', '🧘'];

function openListDialog(id, { moveIds = null, group = '' } = {}) {
  const list = findList(id);
  const groupNames = [...new Set(state.lists.map((l) => l.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const color = list?.color || '';
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form" data-form="list" data-id="${id || ''}" data-move="${moveIds ? escapeHtml(moveIds.join(',')) : ''}">
      <div class="form-head"><h2>${list ? 'Editar lista' : 'Nova lista'}</h2><button type="button" class="btn small" data-action="close-dialog">Fechar</button></div>
      <div class="error" id="list-error" role="alert" hidden></div>
      <div class="field"><label for="l-name">Nome</label><input id="l-name" name="name" required maxlength="60" value="${escapeHtml(list ? list.name : '')}" autocomplete="off"></div>
      <div class="field">
        <label for="l-emoji">Emoji (opcional)</label>
        <div class="emoji-row">
          <input id="l-emoji" name="emoji" maxlength="8" value="${escapeHtml(list?.emoji || '')}" autocomplete="off" placeholder="—">
          ${EMOJI_SUGGESTIONS.map((e) => `<button type="button" class="emoji-pick" data-action="pick-emoji" data-emoji="${e}" aria-label="Usar ${e}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <span class="label-text">Cor</span>
        <div class="color-row" role="radiogroup" aria-label="Cor da lista">
          ${LIST_COLORS.map(([value, name]) => `<label class="color-pick" title="${name}"><input type="radio" name="color" value="${value}" ${value === color ? 'checked' : ''} aria-label="${name}"><span style="--dot:${value || 'transparent'}" class="${value ? '' : 'no-color'}"></span></label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="l-group">Grupo (opcional)</label>
        <input id="l-group" name="group" list="group-names" maxlength="40" value="${escapeHtml(list ? list.group : group)}" autocomplete="off" placeholder="Ex.: Casa, Trabalho">
        <datalist id="group-names">${groupNames.map((name) => `<option value="${escapeHtml(name)}">`).join('')}</datalist>
        <div class="help">Listas com o mesmo grupo aparecem juntas. ${groupNames.length ? `Grupos atuais: ${escapeHtml(groupNames.join(', '))}.` : ''}</div>
      </div>
      <div class="form-foot">
        <div>${list ? `<button type="button" class="btn danger" data-action="delete-list" data-id="${id}">Excluir lista</button>` : ''}</div>
        <div><button class="btn primary">${list ? 'Salvar' : 'Criar lista'}</button></div>
      </div>
    </form>`;
  if (!dialog.open) dialog.showModal();
  $('#l-name').focus();
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
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form" data-form="delete-list" data-id="${id}">
      <div class="form-head"><h2>Excluir ${escapeHtml(list.name)}?</h2><button type="button" class="btn small" data-action="close-dialog">Cancelar</button></div>
      ${tasks.length ? `
      <p class="help">A lista tem ${tasks.length} tarefa(s), ${open} aberta(s). O que fazer com elas?</p>
      <label class="check-line"><input type="radio" name="fate" value="inbox" checked> Mover para a Entrada</label>
      <label class="check-line"><input type="radio" name="fate" value="other"> Mover para outra lista:</label>
      <div class="field"><select name="target" aria-label="Lista de destino">${sortedLists().filter((l) => l.id !== id).map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}</select></div>
      <label class="check-line"><input type="radio" name="fate" value="trash"> Mandar para a Lixeira (dá para restaurar)</label>` : '<p class="help">A lista está vazia.</p>'}
      <div class="form-foot"><div></div><div><button class="btn danger">Excluir lista</button></div></div>
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
    if (data.app !== 'tarefas' || !Array.isArray(data.tasks) || !Array.isArray(data.lists) || !Array.isArray(data.log)) {
      throw new Error('formato');
    }
  } catch {
    showToast('Arquivo inválido. Nada foi alterado.');
    return;
  }
  const syncing = !!state.sync?.token;
  const question = syncing
    ? `Importar ${data.tasks.length} tarefa(s) do arquivo? Elas serão enviadas aos seus aparelhos, e as tarefas que já estão na sincronização continuam lá.`
    : `Substituir tudo o que está neste aparelho por ${data.tasks.length} tarefa(s) do arquivo?`;
  if (!confirm(question)) return;
  const settings = { ...state.settings, ...(data.settings || {}), id: 'settings' };
  const now = Date.now();
  const prepare = (items) => (syncing ? items.map((item) => stampAll(item, now)) : items);
  const meta = syncing ? [settings, { ...state.sync, id: 'sync' }] : [settings];
  if (state.push) meta.push({ ...state.push, hash: null });
  await db.replaceAll({ lists: prepare(data.lists), tasks: prepare(data.tasks), log: prepare(data.log), meta });
  await load();
  render();
  showToast('Dados importados.');
  savedLocally();
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
  const count = state.tasks.length;
  if (count && !confirm(`Entrar neste aparelho? As ${count} tarefa(s) daqui serão substituídas pelas da sincronização. Exporte um backup antes se precisar delas.`)) return undefined;
  let session;
  try {
    session = await authenticate('login', $('#sync-login').value, $('#sync-password').value);
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

function applyTheme(highlight = state.settings.highlight) {
  const root = document.documentElement;
  const theme = resolveTheme(state.settings.theme, prefersDark());
  const onHi = textOn(highlight);
  root.dataset.theme = theme;
  root.style.setProperty('--hi', highlight);
  root.style.setProperty('--on-hi', onHi);
  $('meta[name="theme-color"]').content = THEMES.find((item) => item.id === theme).chrome;
  const fs = fontSizePx();
  root.style.fontSize = `${fs}px`;
  const icon = theme === 'diamante' ? 'icons/icon-diamante-192.png' : 'icons/icon-barco-192.png';
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((link) => { link.href = icon; });
  try {
    localStorage.setItem('tarefas-tema', JSON.stringify({ theme, hi: highlight, onHi, fs }));
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
  'complete-from-dialog': async (el) => {
    $('#dialog').close();
    await complete(el.dataset.id);
  },
  'reopen-from-dialog': async (el) => {
    $('#dialog').close();
    await reopen(el.dataset.id);
  },
  'duplicate-from-dialog': async (el) => {
    if (hasUnsavedChanges() && !confirm('Duplicar sem salvar as alterações desta tarefa?')) return;
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
  'pick-emoji': (el) => {
    const input = $('#l-emoji');
    input.value = input.value === el.dataset.emoji ? '' : el.dataset.emoji;
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
  'set-when': (el) => {
    $('#f-when').value = addDays(today(), Number(el.dataset.days));
    updateFormHints();
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
    const updated = skipOccurrence(findTask(el.dataset.id), today());
    const before = findTask(el.dataset.id);
    await saveTask(updated);
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
  'set-theme': async (el) => {
    await saveSettings({ theme: el.dataset.themeId });
    applyTheme();
    render();
  },
  'set-font-size': async (el) => {
    await saveSettings({ fontSize: Number(el.dataset.size) });
    applyTheme();
    render();
  },
  'set-highlight': async (el) => {
    await saveSettings({ highlight: el.dataset.color });
    applyTheme();
    render();
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
  const action = clickActions[target.dataset.action];
  if (action) action(target);
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.dataset.form === 'quick-add') {
    const title = form.elements.title.value;
    if (!title.trim()) return;
    const parsed = quickParse(title);
    state.quickIgnore = '';
    await addTask(parsed ? parsed.title : title, { listId: form.dataset.list, when: form.dataset.when }, parsed);
    $('#quick-input')?.focus();
    if (parsed?.when && parsed.when !== today() && form.dataset.when) {
      showToast(`Criada para ${formatDate(parsed.when).toLowerCase()}: está em Próximos dias.`);
    }
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

// Esc nos detalhes: avisa se há alterações não salvas.
$('#dialog').addEventListener('cancel', (event) => {
  if (hasUnsavedChanges() && !confirm('Descartar as alterações desta tarefa?')) event.preventDefault();
  else dialogSnapshot = null;
});

document.addEventListener('input', (event) => {
  const { target } = event;
  if (target.id === 'search-input') {
    state.search = target.value;
    $('#search-results').innerHTML = searchResults();
  } else if (target.id === 'quick-input') {
    renderQuickPreview();
  } else if (target.id === 'highlight-custom') {
    // Mostra a cor enquanto ela é escolhida; só salva ao confirmar.
    applyTheme(target.value);
    $('#highlight-warning').hidden = !isTooLight(target.value);
  } else if (target.dataset.stepTitle !== undefined) {
    draftSteps[Number(target.dataset.stepTitle)].title = target.value;
  } else if (target.closest('form[data-form="task"]')) {
    updateFormHints();
  }
});

document.addEventListener('change', async (event) => {
  const { target } = event;
  if (target.dataset.stepDone !== undefined) {
    draftSteps[Number(target.dataset.stepDone)].done = target.checked;
  } else if (target.id === 'highlight-custom') {
    await saveSettings({ highlight: target.value });
    applyTheme();
    render();
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
  if (event.key === 'Escape' && state.selecting && !$('#dialog').open) {
    endSelection();
    return;
  }
  if (typing || event.ctrlKey || event.metaKey || event.altKey || $('#dialog').open) return;
  if (event.key === 'n' || event.key === 'N') {
    event.preventDefault();
    focusQuickAdd();
  } else if (event.key === '/') {
    event.preventDefault();
    if (currentRoute().name !== 'search') {
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
  swipe.row.dataset.swipe = dx > SWIPE_DONE && canComplete ? 'complete' : dx < -SWIPE_DONE ? 'trash' : '';
});

async function endSwipe() {
  if (!swipe) return;
  const { row, id, dx, active } = swipe;
  swipe = null;
  if (!active) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 350);
  row.classList.remove('swiping');
  row.style.transform = '';
  delete row.dataset.swipe;
  const task = findTask(id);
  if (dx > SWIPE_DONE && task?.status === 'open') await complete(id);
  else if (dx < -SWIPE_DONE) await trashWithConfirm(id);
}

document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', () => {
  if (!swipe) return;
  swipe.row.classList.remove('swiping');
  swipe.row.style.transform = '';
  swipe = null;
});

// Um toque logo depois de deslizar não deve abrir a tarefa.
document.addEventListener('click', (event) => {
  if (suppressClick) {
    event.stopPropagation();
    event.preventDefault();
  }
}, true);

// Botão direito no note e toque longo no celular abrem o menu da tarefa.
document.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('#view .task[data-id]');
  if (!row || state.selecting || swipe?.active) return;
  event.preventDefault();
  openTaskMenu(row.dataset.id);
});

window.addEventListener('hashchange', () => {
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
  state.settings.theme = normalizeTheme(state.settings.theme);
  if (!state.settings.themeV2) {
    // Aparelhos que já usavam o app recebem uma vez o novo tema padrão.
    await saveSettings({ theme: 'diamante', themeChosen: true, themeV2: true });
  }
  if (!isHexColor(state.settings.highlight)) state.settings.highlight = DEFAULT_HIGHLIGHT;
  if (!state.lists.some((l) => l.id === INBOX)) await saveList({ id: INBOX, name: 'Entrada', group: '' });
  applyTheme();
}

/** Algo compartilhado de outro app vira uma tarefa na Entrada. */
async function createFromShare(title, text, url) {
  const source = title || text || url;
  const [first, ...rest] = source.split('\n');
  const notes = [title ? text : rest.join('\n'), text.includes(url) ? '' : url]
    .map((part) => part.trim()).filter(Boolean).join('\n');
  const id = await addTask(first.trim().slice(0, 200) || 'Compartilhado', { listId: defaultListId() }, null, { notes });
  if (!id) return;
  openTask(id);
  showToast('Tarefa criada a partir do compartilhamento.');
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
  else if (wantsNew) focusQuickAdd();
  await checkReminders();
  setInterval(checkReminders, 15000);
  syncEngine.run();
  setInterval(() => syncEngine.run(), 60000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker não registrado', error));
  }
  // A inscrição pode sumir se o navegador limpar os dados ou a permissão for retirada.
  if (state.push?.enabled && !(await currentSubscription().catch(() => null))) {
    await savePushLocal({ ...state.push, enabled: false });
    if (currentRoute().name === 'settings') render();
  }
}

start().catch((error) => {
  console.error(error);
  $('#view').innerHTML = '<p class="empty">Não foi possível abrir os dados deste aparelho. Verifique se o navegador permite armazenamento.</p>';
});
