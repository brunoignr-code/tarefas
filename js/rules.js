// Regras de datas do escopo (R1 a R12). Sem acesso a tela ou banco, para poder testar tudo.
// Datas são 'YYYY-MM-DD' e lembretes 'YYYY-MM-DDTHH:mm', sempre em horário local.

const DAY_MS = 86400000;

const toUTC = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');

export const addDays = (date, n) => fromUTC(toUTC(date) + n * DAY_MS);
export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / DAY_MS);
export const weekday = (date) => new Date(toUTC(date)).getUTCDay();

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localDateTime = (d = new Date()) =>
  `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

function occurrenceByMonths(repeat, from) {
  const months = repeat.freq === 'yearly' ? repeat.interval * 12 : repeat.interval;
  const [ay, am, ad] = repeat.anchor.split('-').map(Number);
  const [fy, fm] = from.split('-').map(Number);
  const anchorIndex = ay * 12 + am - 1;
  let k = Math.max(0, Math.ceil((fy * 12 + fm - 1 - anchorIndex) / months));
  for (;;) {
    const index = anchorIndex + k * months;
    const year = Math.floor(index / 12);
    const month = index % 12;
    // Dia 31 vira o último dia dos meses curtos, sem perder o dia original.
    const day = Math.min(ad, daysInMonth(year, month));
    const candidate = `${year}-${pad(month + 1)}-${pad(day)}`;
    if (candidate >= from) return candidate;
    k += 1;
  }
}

/** Primeira ocorrência da série na data `from` ou depois dela. */
export function firstOccurrence(repeat, from) {
  const start = from < repeat.anchor ? repeat.anchor : from;
  if (repeat.freq === 'daily') {
    const k = Math.ceil(diffDays(start, repeat.anchor) / repeat.interval);
    return addDays(repeat.anchor, k * repeat.interval);
  }
  if (repeat.freq === 'weekly') {
    const anchorWeek = addDays(repeat.anchor, -weekday(repeat.anchor));
    for (let i = 0; i <= 7 * repeat.interval + 7; i += 1) {
      const candidate = addDays(start, i);
      const weeks = Math.floor(diffDays(candidate, anchorWeek) / 7);
      if (weeks % repeat.interval === 0 && repeat.weekdays.includes(weekday(candidate))) {
        return candidate;
      }
    }
    throw new Error('Repetição semanal sem dias válidos');
  }
  return occurrenceByMonths(repeat, start);
}

export const nextOccurrence = (repeat, after) => firstOccurrence(repeat, addDays(after, 1));

function normalizeRepeat(input, anchor) {
  const repeat = {
    freq: input.freq,
    interval: Math.max(1, Math.floor(Number(input.interval) || 1)),
    anchor,
  };
  if (repeat.freq === 'weekly') {
    const days = [...new Set(input.weekdays || [])].sort((a, b) => a - b);
    repeat.weekdays = days.length ? days : [weekday(anchor)];
  }
  if (input.fromCompletion) repeat.fromCompletion = true;
  const count = Math.floor(Number(input.count) || 0);
  if (count >= 1) repeat.count = count;
  return repeat;
}

const sameRepeatPattern = (a, b) =>
  a && b && a.freq === b.freq && a.interval === b.interval &&
  (a.weekdays || []).join() === (b.weekdays || []).join() &&
  !!a.fromCompletion === !!b.fromCompletion && (a.count || 0) === (b.count || 0);

/** Próxima data contada a partir de um dia qualquer, como o dia da conclusão. */
const intervalAfter = (date, repeat) =>
  nextOccurrence({ ...repeat, anchor: date, weekdays: [weekday(date)] }, date);

/**
 * Valida uma edição e devolve a tarefa pronta para salvar, ou { error }.
 * R5: preenche Quando ao repetir. R6: bloqueia Até anterior a Quando.
 * No banco, Prazo e Fim da série são separados, e a tela mostra um único campo Até.
 */
export function applyEdit(prev, fields, today) {
  const title = (fields.title || '').trim();
  if (!title) return { error: 'Dê um título à tarefa.' };

  let when = fields.when || null;
  const until = fields.until || null;
  let repeat = null;
  let whenFilled = false;

  if (fields.repeat && fields.repeat.freq) {
    if (!when) {
      when = firstOccurrence(normalizeRepeat(fields.repeat, today), today);
      whenFilled = true;
    }
    const candidate = normalizeRepeat(fields.repeat, when);
    const unchanged = prev && prev.when === when && sameRepeatPattern(prev.repeat, candidate);
    repeat = unchanged ? prev.repeat : candidate;
    // A contagem de "terminar após N vezes" continua de onde estava.
    if (repeat.count && prev?.repeat?.done) repeat = { ...repeat, done: Math.min(prev.repeat.done, repeat.count) };
  }

  // Modo A: um campo Até. Modos B e C: Prazo e Fim da série separados na tela.
  let deadline;
  let seriesEnd;
  if ('deadline' in fields || 'seriesEnd' in fields) {
    deadline = fields.deadline || null;
    seriesEnd = repeat ? fields.seriesEnd || null : null;
  } else {
    deadline = repeat ? (prev?.repeat ? prev.deadline || null : null) : until;
    seriesEnd = repeat ? until : null;
  }

  if (seriesEnd && when && seriesEnd < when) return { error: 'O fim da repetição não pode ser anterior a Quando.' };
  if (deadline && when && deadline < when) return { error: 'O prazo não pode ser anterior a Quando.' };

  const remindAt = fields.remindAt || null;
  const task = {
    ...prev,
    title,
    notes: fields.notes || '',
    listId: fields.listId || (prev && prev.listId) || 'inbox',
    steps: fields.steps || (prev && prev.steps) || [],
    when,
    repeat,
    deadline,
    seriesEnd,
    important: 'important' in fields ? !!fields.important : !!prev?.important,
    tags: 'tags' in fields ? cleanTags(fields.tags) : (prev?.tags || []),
    remindAt,
    remindEach: fields.remindEach !== false,
  };
  if (!prev || prev.remindAt !== remindAt) {
    task.snoozedUntil = null;
    task.ackedAt = null;
    task.notifiedFor = null;
  }
  return { task, whenFilled };
}

/** Tags sem repetição, sem "#" e sem espaços nas pontas. */
export function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const seen = new Set();
  return list.map((tag) => String(tag).trim().replace(/^#+/, '').trim()).filter((tag) => {
    const key = tag.toLocaleLowerCase('pt-BR');
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function advance(task, today) {
  const done = (task.repeat.done || 0) + 1;
  if (task.repeat.count && done >= task.repeat.count) {
    return { ...task, status: 'ended', endedAt: today, repeat: { ...task.repeat, done } };
  }
  let repeat = { ...task.repeat, done };
  let next;
  if (repeat.fromCompletion) {
    // Conta a partir do dia em que foi concluída ou pulada.
    next = intervalAfter(today, repeat);
    repeat = { ...repeat, anchor: next };
  } else {
    next = nextOccurrence(repeat, task.when > today ? task.when : today);
  }
  // R4: Até é o último dia possível, inclusive.
  if (task.seriesEnd && next > task.seriesEnd) {
    return { ...task, status: 'ended', endedAt: today, repeat };
  }
  const updated = {
    ...task,
    repeat,
    when: next,
    steps: (task.steps || []).map((step) => ({ ...step, done: false })),
  };
  // No modo de dois campos, o prazo de cada ocorrência anda junto com ela.
  if (task.deadline && task.when) updated.deadline = addDays(task.deadline, diffDays(next, task.when));
  // R9: o lembrete acompanha cada ocorrência, mantendo o horário relativo.
  if (task.remindAt && task.remindEach) {
    const days = diffDays(next, task.when);
    updated.remindAt = `${addDays(task.remindAt.slice(0, 10), days)}${task.remindAt.slice(10)}`;
    updated.snoozedUntil = null;
    updated.ackedAt = null;
    updated.notifiedFor = null;
  }
  return updated;
}

/** Conclui a ocorrência aberta. R7 e R8: segue o calendário e não acumula dias perdidos. */
export function completeTask(task, today, completedAt) {
  if (!task.repeat) {
    return { task: { ...task, status: 'done', completedAt }, log: null };
  }
  return {
    task: advance(task, today),
    log: { taskId: task.id, title: task.title, occurrence: task.when, completedAt },
  };
}

/** Pula a ocorrência aberta sem registrá-la como concluída. */
export const skipOccurrence = (task, today) => advance(task, today);

// R1: Hoje mostra tarefas abertas com Quando igual ou anterior a hoje.
const isOpen = (task) => task.status === 'open' && !task.deletedAt;
export const todayTasks = (tasks, today) =>
  tasks.filter((task) => isOpen(task) && task.when && task.when <= today);
export const upcomingTasks = (tasks, today) =>
  tasks.filter((task) => isOpen(task) && task.when && task.when > today)
    .sort((a, b) => a.when.localeCompare(b.when) || a.order - b.order);

// R2: dias parados em Hoje, para a etiqueta discreta.
export const daysWaiting = (task, today) =>
  task.when && task.when < today ? diffDays(today, task.when) : 0;

// R3: só o prazo atrasa; o fim da série, não.
export const isOverdue = (task, today) =>
  isOpen(task) && !!task.deadline && task.deadline < today;

/** Urgente para a matriz: Quando chegou ou o prazo vence em até 2 dias. */
export const isUrgent = (task, today) =>
  (!!task.when && task.when <= today) || (!!task.deadline && task.deadline <= addDays(today, 2));

export const reminderTime = (task) => task.snoozedUntil || task.remindAt || null;

// R10 e R11: o lembrete funciona sem datas e deixa de valer ao concluir.
export const dueReminders = (tasks, now) => tasks.filter((task) => {
  const time = reminderTime(task);
  return isOpen(task) && time && !task.ackedAt && time <= now;
});

export const snooze = (task, nowDate, minutes) => ({
  ...task,
  snoozedUntil: localDateTime(new Date(nowDate.getTime() + minutes * 60000)),
  notifiedFor: null,
});

export const dismissReminder = (task, now) => ({ ...task, ackedAt: now });
