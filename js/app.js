import * as db from './db.js';
import {
  applyEdit, completeTask, daysWaiting, addDays, dismissReminder, dueReminders, isOverdue, isUrgent,
  INSIST_MAX, activeReminder, insistStep, localDate, localDateTime, notifyMark, shownReminder, skipOccurrence, snooze,
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
const SNOOZE_MINUTES = 10;
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FREQ_LABELS = {
  daily: ['Diária', 'dias'], weekly: ['Semanal', 'semanas'],
  monthly: ['Mensal', 'meses'], yearly: ['Anual', 'anos'],
};

const state = { lists: [], tasks: [], log: [], settings: { id: 'settings', theme: 'barquinho', themeChosen: true, highlight: DEFAULT_HIGHLIGHT }, search: '' };
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

const UPCOMING_MODES = [['list', 'Lista'], ['calendar', 'Calendário'], ['kanban', 'Kanban'], ['matrix', 'Matriz']];

const STAR_ICON = (on) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"></path></svg>`;
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
const listName = (id) => (state.lists.find((l) => l.id === id) || { name: 'Entrada' }).name;
const nextOrder = () => state.tasks.reduce((max, t) => Math.max(max, t.order || 0), 0) + 1;

/* ---------- Ações sobre tarefas ---------- */

async function addTask(title, context, parsed = null, extra = {}) {
  const result = applyEdit(null, {
    title,
    listId: context.listId || INBOX,
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
  else if (task.repeat) message = `Concluída. Próxima: ${formatDate(updated.when).toLowerCase()}.`;
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
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
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
  document.title = due.length ? `(${due.length}) Tarefas` : 'Tarefas';
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
  if (showList && task.listId !== INBOX) chips.push(`<span>${escapeHtml(listName(task.listId))}</span>`);
  return chips.length ? `<span class="chips">${chips.join('')}</span>` : '';
}

const taskRow = (task, options = {}) => `
  <li class="task" data-id="${task.id}">
    <button class="check" data-action="complete" data-id="${task.id}" aria-label="Concluir ${escapeHtml(task.title)}"><span class="mark"></span></button>
    <button class="task-body" data-action="open" data-id="${task.id}">
      <span class="task-title">${escapeHtml(task.title)}</span>
      ${taskChips(task, options)}
    </button>
    ${options.draggable ? `<button class="drag" data-drag="${task.id}" aria-label="Reordenar ${escapeHtml(task.title)}: arraste ou use as setas do teclado">${GRIP_ICON}</button>` : ''}
    <button class="icon star ${task.important ? 'on' : ''}" data-action="toggle-important" data-id="${task.id}" aria-pressed="${!!task.important}" aria-label="Importante: ${escapeHtml(task.title)}">${STAR_ICON(task.important)}</button>
  </li>`;

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
    <div class="view-head"><div><h1><span>Hoje</span></h1><div class="subtitle">${escapeHtml(long)}</div></div></div>
    ${quickAdd('Adicionar a Hoje', { when: now })}
    ${tasks.length ? taskListHtml(tasks, { showWhen: false, showList: true, draggable: true }) : '<p class="empty">Nada planejado para hoje.</p>'}
    <button class="btn small" data-action="sync-now" ${state.sync?.token ? '' : 'disabled'} style="margin-top:14px">Sincronizar agora</button>`;
}

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
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
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
    <div class="cal-grid">${WEEKDAYS.map((name) => `<span class="cal-week" aria-hidden="true">${name}</span>`).join('')}${cells.join('')}</div>
    <h2>${escapeHtml(formatDate(selected))}</h2>
    ${dayTasks.length ? taskListHtml(dayTasks, { showWhen: false, showList: true }) : '<p class="empty">Nada com Quando ou prazo neste dia.</p>'}`;
}

function kanbanView() {
  const open = openTasks();
  const lists = state.lists.slice().sort((a, b) => (a.id === INBOX ? -1 : b.id === INBOX ? 1 : a.name.localeCompare(b.name, 'pt-BR')));
  const columns = lists.map((list) => [list, open.filter((t) => t.listId === list.id).sort(byOrder)]).filter(([, tasks]) => tasks.length);
  if (!columns.length) return '<p class="empty">Nenhuma tarefa aberta.</p>';
  return `<div class="kanban">${columns.map(([list, tasks]) => `
    <section class="kanban-col" aria-label="${escapeHtml(list.name)}">
      <h3><span>${escapeHtml(list.name)}</span><span class="count">${tasks.length}</span></h3>
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
    <div class="view-head"><div><h1><span>Importantes</span></h1></div></div>
    ${tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty">Toque na estrela de uma tarefa para ela aparecer aqui.</p>'}`;
}

function tagView(encoded) {
  const tag = decodeURIComponent(encoded || '');
  const tasks = openTasks().filter((t) => (t.tags || []).some((name) => sameTag(name, tag))).sort(byOrder);
  return `
    <div class="view-head"><div><h1><span>#${escapeHtml(tag)}</span></h1><div class="subtitle">Tag</div></div></div>
    ${tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty">Nenhuma tarefa aberta com esta tag.</p>'}`;
}

function listView(id) {
  const list = state.lists.find((l) => l.id === id);
  if (!list) return listsView();
  const tasks = state.tasks.filter((t) => t.listId === id && t.status === 'open' && !t.deletedAt).sort(byOrder);
  const edit = id === INBOX ? '' : `<button class="btn small" data-action="edit-list" data-id="${id}">Editar lista</button>`;
  return `
    <div class="view-head"><div><h1><span>${escapeHtml(list.name)}</span></h1>${list.group ? `<div class="subtitle">${escapeHtml(list.group)}</div>` : ''}</div>${edit}</div>
    ${quickAdd(`Adicionar a ${list.name}`, { listId: id })}
    ${tasks.length ? taskListHtml(tasks, { draggable: true }) : '<p class="empty">Esta lista está vazia.</p>'}`;
}

function groupedLists() {
  const custom = state.lists.filter((l) => l.id !== INBOX).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const ungrouped = custom.filter((l) => !l.group);
  const groups = new Map();
  custom.filter((l) => l.group).forEach((l) => groups.set(l.group, [...(groups.get(l.group) || []), l]));
  return { ungrouped, groups: [...groups].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')) };
}

const openCount = (id) => state.tasks.filter((t) => t.listId === id && t.status === 'open' && !t.deletedAt).length;

function listsView() {
  const { ungrouped, groups } = groupedLists();
  const row = (list) => `<a class="row-link" href="#list/${list.id}"><span>${escapeHtml(list.name)}</span><span class="count">${openCount(list.id)}</span></a>`;
  const inbox = state.lists.find((l) => l.id === INBOX);
  return `
    <div class="view-head"><div><h1><span>Listas</span></h1></div><button class="btn small primary" data-action="new-list">Nova lista</button></div>
    <div class="rows">${row(inbox)}${ungrouped.map(row).join('')}</div>
    ${groups.map(([name, lists]) => `<h2>${escapeHtml(name)}</h2><div class="rows">${lists.map(row).join('')}</div>`).join('')}
    <h2>Filtros</h2>
    <div class="rows">
      <a class="row-link" href="#important"><span>Importantes</span><span class="count">${openTasks().filter((t) => t.important).length}</span></a>
      ${allTags().map(([tag, count]) => `<a class="row-link" href="#tag/${encodeURIComponent(tag)}"><span>#${escapeHtml(tag)}</span><span class="count">${count}</span></a>`).join('')}
    </div>
    <h2>Outros</h2>
    <div class="rows">
      <a class="row-link" href="#done"><span>Concluídas</span></a>
      <a class="row-link" href="#trash"><span>Lixeira</span><span class="count">${state.tasks.filter((t) => t.deletedAt).length}</span></a>
    </div>
    <h2>Mais recursos</h2>
    <div class="rows">
      <button class="row-link" disabled>Listas compartilhadas</button>
      <button class="row-link" disabled>Hábitos</button>
      <button class="row-link" disabled>Pomodoro</button>
    </div>`;
}

function doneView() {
  const single = activeTasks().filter((t) => t.status === 'done').map((t) => ({ title: t.title, at: t.completedAt || '', taskId: t.id, reopen: true }));
  const series = state.log.map((l) => ({ title: l.title, at: l.completedAt, occurrence: l.occurrence, taskId: l.taskId }));
  const items = [...single, ...series].sort((a, b) => b.at.localeCompare(a.at));
  const row = (item) => `
    <li class="task is-done">
      ${item.reopen
        ? `<button class="check done" data-action="reopen" data-id="${item.taskId}" aria-label="Reabrir ${escapeHtml(item.title)}"><span class="mark"></span></button>`
        : '<span class="check done" aria-hidden="true"><span class="mark"></span></span>'}
      <div class="task-body">
        <span class="task-title">${escapeHtml(item.title)}</span>
        <span class="chips"><span>${item.at ? `Concluída ${escapeHtml(formatDate(localDate(new Date(item.at))).toLowerCase())}` : ''}</span>${item.occurrence ? `<span>↻ ocorrência de ${escapeHtml(formatDate(item.occurrence).toLowerCase())}</span>` : ''}</span>
      </div>
    </li>`;
  return `
    <div class="view-head"><div><h1><span>Concluídas</span></h1></div></div>
    ${items.length ? `<ul class="task-list">${items.map(row).join('')}</ul>` : '<p class="empty">Nada concluído ainda.</p>'}`;
}

function trashView() {
  const tasks = state.tasks.filter((t) => t.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const row = (task) => `
    <li class="task">
      <div class="task-body" style="padding-left:12px"><span class="task-title">${escapeHtml(task.title)}</span>
        <span class="actions" style="margin-top:8px">
          <button class="btn small" data-action="restore" data-id="${task.id}">Restaurar</button>
          <button class="btn small danger" data-action="purge" data-id="${task.id}">Excluir de vez</button>
        </span>
      </div>
    </li>`;
  return `
    <div class="view-head"><div><h1><span>Lixeira</span></h1></div></div>
    ${tasks.length ? `<ul class="task-list">${tasks.map(row).join('')}</ul>` : '<p class="empty">A lixeira está vazia.</p>'}`;
}

function searchResults() {
  const query = state.search.trim().toLocaleLowerCase('pt-BR');
  if (!query) return '<p class="empty">Busque por título, nota, etapa ou tag.</p>';
  const matches = (task) => [task.title, task.notes, ...(task.steps || []).map((s) => s.title), ...(task.tags || [])]
    .some((text) => (text || '').toLocaleLowerCase('pt-BR').includes(query));
  const tasks = state.tasks.filter((t) => t.status === 'open' && !t.deletedAt && matches(t)).sort(byOrder);
  return tasks.length ? taskListHtml(tasks, { showList: true }) : '<p class="empty">Nenhuma tarefa aberta encontrada.</p>';
}

function searchView() {
  return `
    <div class="view-head"><div><h1><span>Busca</span></h1></div></div>
    <input class="search" id="search-input" type="search" placeholder="Buscar tarefas abertas" aria-label="Buscar tarefas abertas" value="${escapeHtml(state.search)}">
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
  return `
    <div class="view-head"><div><h1><span>Config.</span></h1></div></div>
    <section class="panel">
      <h3>Notificações</h3>
      <p>${statusText} Com o app aberto, os avisos disparam na hora. Ao abrir, os atrasados aparecem em destaque.</p>
      <div class="actions">
        ${permission === 'default' ? '<button class="btn primary" data-action="enable-notifications">Ativar notificações</button>' : ''}
        ${permission === 'granted' ? '<button class="btn" data-action="test-notification">Enviar teste</button>' : ''}
      </div>
    </section>
    ${pushPanel()}
    ${syncPanel()}
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
      <h3>Aparência</h3>
      <div class="segments themes" role="group" aria-label="Tema">
        ${themeOptions.map((item) => `<button class="${item.id === theme ? 'on' : ''}" data-action="set-theme" data-theme-id="${item.id}" aria-pressed="${item.id === theme}">${item.name}</button>`).join('')}
      </div>
      <p style="margin:0">Em Sistema, o app usa Diamante no modo escuro e Barquinho no modo claro.</p>
    </section>
    ${highlightPanel}
    <section class="panel">
      <h3>Tarefas</h3>
      <p>Como o campo Até aparece nos detalhes da tarefa:</p>
      <div class="segments themes" role="group" aria-label="Modo do campo Até">
        ${Object.entries(UNTIL_MODES).map(([id, [name]]) => `<button class="${id === untilMode() ? 'on' : ''}" data-action="set-until-mode" data-mode="${id}" aria-pressed="${id === untilMode()}">${name}</button>`).join('')}
      </div>
      <p>${UNTIL_MODES[untilMode()][1]}</p>
      <label class="check-line"><input type="checkbox" id="parse-dates" ${state.settings.parseDates === false ? '' : 'checked'}> Entender datas ao digitar, como "pagar luz sexta 9h"</label>
      <p style="margin:8px 0 0">No teclado do note: N cria uma tarefa e / abre a busca.</p>
    </section>
    <section class="panel">
      <h3>Contas e integrações</h3>
      <div class="rows">
        <button class="row-link" disabled>Google Agenda</button>
        <button class="row-link" disabled>Importar do To Do</button>
      </div>
    </section>`;
}

function currentRoute() {
  const hash = location.hash.slice(1) || 'today';
  const [name, id] = hash.split('/');
  return { name, id };
}

function renderNav() {
  const route = currentRoute();
  const isLists = ['lists', 'list', 'done', 'trash', 'important', 'tag'].includes(route.name);
  const dueCount = todayTasks(state.tasks, today()).length;
  const item = (href, label, active, count, extra = '') => `
    <a class="nav-item ${extra} ${active ? 'active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>
      <span class="label">${escapeHtml(label)}</span>${count ? `<span class="count">${count}</span>` : ''}
    </a>`;
  const desktopList = (list) => item(`#list/${list.id}`, list.name, route.name === 'list' && route.id === list.id, openCount(list.id), 'nav-only-desktop');
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
  };
  renderNav();
  $('#view').innerHTML = (views[route.name] || todayView)();
  renderReminders();
}

/* ---------- Janela da tarefa ---------- */

let draftSteps = [];

function openTask(id) {
  const task = findTask(id);
  if (!task) return;
  draftSteps = (task.steps || []).map((step) => ({ ...step }));
  const repeat = task.repeat || {};
  const options = (selected) => state.lists
    .slice().sort((a, b) => (a.id === INBOX ? -1 : b.id === INBOX ? 1 : a.name.localeCompare(b.name, 'pt-BR')))
    .map((l) => `<option value="${l.id}" ${l.id === selected ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('');
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
      <div class="form-foot">
        <div>
          <button type="button" class="btn danger" data-action="trash" data-id="${task.id}">Excluir</button>
          ${task.repeat ? `<button type="button" class="btn" data-action="skip" data-id="${task.id}">Pular ocorrência</button>` : ''}
          <button type="button" class="btn" data-action="move-up" data-id="${task.id}" aria-label="Mover para cima">↑</button>
          <button type="button" class="btn" data-action="move-down" data-id="${task.id}" aria-label="Mover para baixo">↓</button>
        </div>
        <div><button class="btn primary">Salvar</button></div>
      </div>
    </form>`;
  renderSteps();
  updateFormHints();
  dialog.showModal();
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
  $('#dialog').close();
  render();
  await checkReminders();
  if (result.whenFilled) showToast(`Quando preenchido com ${formatDate(result.task.when).toLowerCase()}.`);
}

/* ---------- Janela da lista ---------- */

function openListDialog(id) {
  const list = state.lists.find((l) => l.id === id);
  const groupNames = [...new Set(state.lists.map((l) => l.group).filter(Boolean))];
  const dialog = $('#dialog');
  dialog.innerHTML = `
    <form class="form" data-form="list" data-id="${id || ''}">
      <div class="form-head"><h2>${list ? 'Editar lista' : 'Nova lista'}</h2><button type="button" class="btn small" data-action="close-dialog">Fechar</button></div>
      <div class="field"><label for="l-name">Nome</label><input id="l-name" name="name" required value="${escapeHtml(list ? list.name : '')}"></div>
      <div class="field">
        <label for="l-group">Grupo (opcional)</label>
        <input id="l-group" name="group" list="group-names" value="${escapeHtml(list ? list.group : '')}" autocomplete="off">
        <datalist id="group-names">${groupNames.map((name) => `<option value="${escapeHtml(name)}">`).join('')}</datalist>
      </div>
      <div class="form-foot">
        <div>${list ? `<button type="button" class="btn danger" data-action="delete-list" data-id="${id}">Excluir lista</button>` : ''}</div>
        <div><button class="btn primary">Salvar</button></div>
      </div>
    </form>`;
  dialog.showModal();
}

async function submitList(form) {
  const data = new FormData(form);
  const name = data.get('name').trim();
  if (!name) return;
  const id = form.dataset.id || newId();
  await saveList({ id, name, group: data.get('group').trim() });
  $('#dialog').close();
  if (form.dataset.id) render(); else location.hash = `#list/${id}`;
}

async function deleteList(id) {
  const count = state.tasks.filter((t) => t.listId === id).length;
  if (!confirm(`Excluir esta lista? ${count ? `${count} tarefa(s) irão para a Entrada.` : ''}`)) return;
  for (const task of state.tasks.filter((t) => t.listId === id)) {
    await saveTask({ ...task, listId: INBOX });
  }
  await forget('lists', id);
  $('#dialog').close();
  location.hash = '#lists';
  render();
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
  try {
    localStorage.setItem('tarefas-tema', JSON.stringify({ theme, hi: highlight, onHi }));
  } catch { /* O tema salvo é só uma conveniência. */ }
}

const clickActions = {
  complete: (el) => complete(el.dataset.id),
  open: (el) => openTask(el.dataset.id),
  reopen: (el) => reopen(el.dataset.id),
  snooze: (el) => handleReminderAction('snooze', el.dataset.id),
  dismiss: async (el) => {
    await saveTask(dismissReminder(findTask(el.dataset.id), localDateTime()));
    render();
  },
  'close-dialog': () => $('#dialog').close(),
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
    await saveTask({ ...findTask(el.dataset.id), deletedAt: null });
    render();
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
  'delete-list': (el) => deleteList(el.dataset.id),
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
  }
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

window.addEventListener('hashchange', handleRoute);
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
  if (!state.settings.themeChosen) {
    // Aparelhos que já usavam o app recebem uma vez o tema escolhido.
    await saveSettings({ theme: 'barquinho', themeChosen: true });
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
  const id = await addTask(first.trim().slice(0, 200) || 'Compartilhado', { listId: INBOX }, null, { notes });
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
