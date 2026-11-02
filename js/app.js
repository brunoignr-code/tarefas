import * as db from './db.js';
import {
  applyEdit, completeTask, daysWaiting, addDays, dismissReminder, dueReminders, isOverdue,
  localDate, localDateTime, reminderTime, skipOccurrence, snooze, todayTasks, upcomingTasks,
} from './rules.js';
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
  if (repeat.freq === 'weekly') label += ` (${repeat.weekdays.map((d) => WEEKDAYS[d].toLowerCase()).join(', ')})`;
  return label;
}

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
});

const savedLocally = () => { if (state.sync?.token) syncEngine.schedule(); };

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

async function addTask(title, context) {
  const result = applyEdit(null, {
    title,
    listId: context.listId || INBOX,
    when: context.when || null,
  }, today());
  if (result.error) return;
  await saveTask({
    ...result.task,
    id: newId(),
    status: 'open',
    order: nextOrder(),
    createdAt: new Date().toISOString(),
  });
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

async function showNotification(task) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = {
    body: 'Toque para ver a tarefa.',
    tag: task.id,
    icon: 'icons/icon-192.png',
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

async function checkReminders() {
  const due = dueReminders(state.tasks, localDateTime());
  for (const task of due) {
    const time = reminderTime(task);
    if (task.notifiedFor !== time) {
      await saveTask({ ...task, notifiedFor: time });
      try {
        await showNotification(task);
      } catch (error) {
        console.warn('Notificação não enviada', error);
      }
    }
  }
  renderReminders();
}

function renderReminders() {
  const due = dueReminders(state.tasks, localDateTime());
  document.title = due.length ? `(${due.length}) Tarefas` : 'Tarefas';
  $('#reminders').innerHTML = due.map((task) => `
    <section class="reminder" aria-label="Lembrete">
      <div class="reminder-label">Lembrete: ${escapeHtml(formatDateTime(reminderTime(task)).toLowerCase())}</div>
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
  const reminder = reminderTime(task);
  if (reminder && !task.ackedAt) chips.push(`<span class="chip-reminder">Lembrar: ${escapeHtml(formatDateTime(reminder).toLowerCase())}</span>`);
  if (task.steps && task.steps.length) {
    chips.push(`<span>${task.steps.filter((s) => s.done).length}/${task.steps.length} etapas</span>`);
  }
  if (task.notes) chips.push('<span>Nota</span>');
  if (showList && task.listId !== INBOX) chips.push(`<span>${escapeHtml(listName(task.listId))}</span>`);
  return chips.length ? `<span class="chips">${chips.join('')}</span>` : '';
}

const taskRow = (task, options) => `
  <li class="task">
    <button class="check" data-action="complete" data-id="${task.id}" aria-label="Concluir ${escapeHtml(task.title)}"><span class="mark"></span></button>
    <button class="task-body" data-action="open" data-id="${task.id}">
      <span class="task-title">${escapeHtml(task.title)}</span>
      ${taskChips(task, options)}
    </button>
    <button class="icon" disabled aria-label="Marcar como importante (em breve)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"></path></svg></button>
  </li>`;

const taskListHtml = (tasks, options) => `<ul class="task-list">${tasks.map((t) => taskRow(t, options)).join('')}</ul>`;

const quickAdd = (placeholder, context) => `
  <form class="quick-add" data-form="quick-add" data-list="${context.listId || ''}" data-when="${context.when || ''}">
    <input id="quick-input" name="title" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" autocomplete="off" enterkeyhint="done">
    <button class="btn primary">Adicionar</button>
  </form>`;

const byOrder = (a, b) => a.order - b.order;
const activeTasks = () => state.tasks.filter((t) => !t.deletedAt);

function todayView() {
  const now = today();
  const tasks = todayTasks(state.tasks, now).sort(byOrder);
  const [y, m, d] = now.split('-').map(Number);
  const long = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `
    <div class="view-head"><div><h1><span>Hoje</span></h1><div class="subtitle">${escapeHtml(long)}</div></div></div>
    ${quickAdd('Adicionar a Hoje', { when: now })}
    ${tasks.length ? taskListHtml(tasks, { showWhen: false, showList: true }) : '<p class="empty">Nada planejado para hoje.</p>'}
    <button class="btn small" data-action="sync-now" ${state.sync?.token ? '' : 'disabled'} style="margin-top:14px">Sincronizar agora</button>`;
}

function upcomingView() {
  const tasks = upcomingTasks(state.tasks, today());
  const groups = new Map();
  tasks.forEach((task) => groups.set(task.when, [...(groups.get(task.when) || []), task]));
  const body = [...groups].map(([date, items]) =>
    `<h2>${escapeHtml(formatDate(date))}</h2>${taskListHtml(items, { showWhen: false, showList: true })}`).join('');
  return `
    <div class="view-head"><div><h1><span>Próximos dias</span></h1></div></div>
    <div class="segments"><button class="on">Lista</button><button disabled>Calendário</button><button disabled>Kanban</button><button disabled>Matriz</button></div>
    ${body || '<p class="empty">Nenhuma tarefa com Quando no futuro.</p>'}`;
}

function listView(id) {
  const list = state.lists.find((l) => l.id === id);
  if (!list) return listsView();
  const tasks = state.tasks.filter((t) => t.listId === id && t.status === 'open' && !t.deletedAt).sort(byOrder);
  const edit = id === INBOX ? '' : `<button class="btn small" data-action="edit-list" data-id="${id}">Editar lista</button>`;
  return `
    <div class="view-head"><div><h1><span>${escapeHtml(list.name)}</span></h1>${list.group ? `<div class="subtitle">${escapeHtml(list.group)}</div>` : ''}</div>${edit}</div>
    ${quickAdd(`Adicionar a ${list.name}`, { listId: id })}
    ${tasks.length ? taskListHtml(tasks, {}) : '<p class="empty">Esta lista está vazia.</p>'}`;
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
    <h2>Outros</h2>
    <div class="rows">
      <a class="row-link" href="#done"><span>Concluídas</span></a>
      <a class="row-link" href="#trash"><span>Lixeira</span><span class="count">${state.tasks.filter((t) => t.deletedAt).length}</span></a>
    </div>
    <h2>Mais recursos</h2>
    <div class="rows">
      <button class="row-link" disabled>Listas compartilhadas</button>
      <button class="row-link" disabled>Tags</button>
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
  if (!query) return '<p class="empty">Busque por título, nota ou etapa.</p>';
  const matches = (task) => [task.title, task.notes, ...(task.steps || []).map((s) => s.title)]
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
      <p>${statusText} Por enquanto, os avisos só disparam com o app aberto. Ao abrir, os atrasados aparecem em destaque.</p>
      <div class="actions">
        ${permission === 'default' ? '<button class="btn primary" data-action="enable-notifications">Ativar notificações</button>' : ''}
        ${permission === 'granted' ? '<button class="btn" data-action="test-notification">Enviar teste</button>' : ''}
        <button class="btn" disabled>Resumo diário</button>
      </div>
    </section>
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
      <button class="fake-field" disabled>Modo do campo Até</button>
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
  const isLists = ['lists', 'list', 'done', 'trash'].includes(route.name);
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
  const notifyHint = 'Notification' in window && Notification.permission === 'granted'
    ? 'Avisa com o app aberto. Se estiver fechado, aparece em destaque ao abrir.'
    : 'Sinal visual no app. Para receber notificação, ative em Config.';

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
        <div class="field">
          <label for="f-until" id="until-label">Até</label>
          <input id="f-until" type="date" name="until" value="${task.repeat ? task.seriesEnd || '' : task.deadline || ''}">
          <div class="help" id="until-help"></div>
        </div>
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
      <button type="button" class="switch" disabled>Contar a partir da conclusão</button>
      <div class="field off"><span class="label-text">Terminar após</span><button type="button" class="fake-field" disabled>N vezes</button></div>
      <div class="field">
        <label for="f-remind">Lembrar</label>
        <input id="f-remind" type="datetime-local" name="remindAt" value="${task.remindAt || ''}">
        <div class="help">${notifyHint}</div>
        <label class="check-line" id="remind-each-line" hidden><input type="checkbox" name="remindEach" ${task.remindEach !== false ? 'checked' : ''}> Lembrar em cada ocorrência</label>
      </div>
      <button type="button" class="btn" disabled>Adicionar outro lembrete</button>
      <button type="button" class="switch" disabled>Insistir até eu reagir</button>
      <div class="field"><label for="f-list">Lista</label><select id="f-list" name="listId">${options(task.listId)}</select></div>
      <div class="field off"><span class="label-text">Tags</span><button type="button" class="fake-field" disabled>Adicionar tag</button></div>
      <button type="button" class="switch" disabled>Importante</button>
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
  return {
    title: data.get('title'),
    when: data.get('when'),
    until: data.get('until'),
    remindAt: data.get('remindAt'),
    remindEach: data.get('remindEach') === 'on',
    listId: data.get('listId'),
    notes: data.get('notes'),
    steps: draftSteps.filter((step) => step.title.trim()),
    repeat: freq ? {
      freq,
      interval: data.get('interval'),
      weekdays: data.getAll('weekday').map(Number),
    } : null,
  };
}

// Mostra o significado de Até e antecipa o preenchimento de Quando (R5).
function updateFormHints() {
  const form = $('form[data-form="task"]');
  if (!form) return;
  const freq = form.elements.freq.value;
  $('#until-label').textContent = freq ? 'Até (fim da repetição)' : 'Até (prazo)';
  $('#until-help').textContent = freq ? 'Último dia da série, inclusive.' : 'Data limite da tarefa.';
  $('#repeat-options').hidden = !freq;
  $('#weekday-field').hidden = freq !== 'weekly';
  $('#remind-each-line').hidden = !freq || !form.elements.remindAt.value;
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
    await addTask(title, { listId: form.dataset.list, when: form.dataset.when });
    $('#quick-input')?.focus();
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
  } else if (target.id === 'import-file' && target.files[0]) {
    await importData(target.files[0]);
    target.value = '';
  } else if (target.closest('form[data-form="task"]')) {
    updateFormHints();
  }
});

document.addEventListener('keydown', (event) => {
  // Enter na etapa adiciona a etapa, sem salvar a tarefa.
  if (event.key === 'Enter' && event.target.id === 'step-input') {
    event.preventDefault();
    clickActions['add-step']();
  }
});

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
  state.settings.theme = normalizeTheme(state.settings.theme);
  if (!state.settings.themeChosen) {
    // Aparelhos que já usavam o app recebem uma vez o tema escolhido.
    await saveSettings({ theme: 'barquinho', themeChosen: true });
  }
  if (!isHexColor(state.settings.highlight)) state.settings.highlight = DEFAULT_HIGHLIGHT;
  if (!state.lists.some((l) => l.id === INBOX)) await saveList({ id: INBOX, name: 'Entrada', group: '' });
  applyTheme();
}

async function start() {
  await db.openDb();
  await load();
  // Pede ao navegador para não apagar os dados quando faltar espaço.
  navigator.storage?.persist?.();
  handleRoute();
  await checkReminders();
  setInterval(checkReminders, 15000);
  syncEngine.run();
  setInterval(() => syncEngine.run(), 60000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker não registrado', error));
  }
}

start().catch((error) => {
  console.error(error);
  $('#view').innerHTML = '<p class="empty">Não foi possível abrir os dados deste aparelho. Verifique se o navegador permite armazenamento.</p>';
});
