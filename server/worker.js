// Servidor de sincronização: guarda registros e entrega só o que mudou para cada aparelho.
// As regras do app (Concluir, Amanhã, Adiar e a agenda de avisos) são embutidas abaixo por
// tools/build_sw.py, para os botões da notificação do Android funcionarem sem abrir o app (v30).
// ---- INÍCIO DAS REGRAS EMBUTIDAS (gerado por tools/build_sw.py; não edite à mão) ----
const SHARED_RULES = (() => {
  const M = {};
M['rules'] = (() => {
  // Regras de datas do escopo (R1 a R12). Sem acesso a tela ou banco, para poder testar tudo.
  // Datas são 'YYYY-MM-DD' e lembretes 'YYYY-MM-DDTHH:mm', sempre em horário local.

  const DAY_MS = 86400000;

  const toUTC = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');

  const addDays = (date, n) => fromUTC(toUTC(date) + n * DAY_MS);
  const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / DAY_MS);
  const weekday = (date) => new Date(toUTC(date)).getUTCDay();

  const localDate = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const localDateTime = (d = new Date()) =>
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
  function firstOccurrence(repeat, from) {
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

  const nextOccurrence = (repeat, after) => firstOccurrence(repeat, addDays(after, 1));

  /** Primeiro dia em `from` ou depois dele que cai num dos dias da semana (0 = domingo). Sem dias, `from`. */
  function firstOnWeekdays(weekdays, from) {
    if (!from || !weekdays || !weekdays.length) return from;
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(from, i);
      if (weekdays.includes(weekday(day))) return day;
    }
    return from;
  }

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
  function applyEdit(prev, fields, today) {
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

    // Vários lembretes: o primeiro fica em remindAt, os outros em extraReminders.
    const times = cleanTimes([fields.remindAt, ...('extraReminders' in fields ? fields.extraReminders || [] : prev?.extraReminders || [])]);
    const remindAt = fields.remindAt || times[0] || null;
    const extraReminders = times.filter((time) => time !== remindAt);
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
      extraReminders,
      remindEach: fields.remindEach !== false,
      insist: 'insist' in fields ? !!fields.insist && !!remindAt : !!prev?.insist && !!remindAt,
    };
    // Só esta vez: a ocorrência muda de dia ou de hora e a série continua no calendário de antes.
    // `occurrence` guarda o dia e os lembretes oficiais dessa ocorrência; some ao concluir ou pular.
    if (prev?.repeat && repeat) {
      const moved = occurrenceKey(task) !== occurrenceKey(prev);
      if (fields.occurrenceOnly && moved) {
        const original = prev.occurrence || { when: prev.when, remindAt: prev.remindAt || null, extraReminders: prev.extraReminders || [] };
        task.repeat = prev.repeat;
        task.occurrence = occurrenceKey(task) === occurrenceKey(original) ? null : original;
      } else if (moved && prev.occurrence) {
        // Esta e as próximas: a série passa a seguir a data nova.
        task.occurrence = null;
      }
    } else if (prev?.occurrence) {
      task.occurrence = null;
    }
    if (!prev || prev.remindAt !== remindAt || (prev.extraReminders || []).join() !== extraReminders.join()) {
      task.snoozedUntil = null;
      task.snoozedFor = null;
      task.ackedAt = null;
      task.notifiedFor = null;
    }
    return { task, whenFilled };
  }

  function occurrenceKey(task) {
    return JSON.stringify([task.when || null, task.remindAt || null, (task.extraReminders || []).join()]);
  }

  const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const cleanTimes = (list) => [...new Set(list.filter((time) => TIME_RE.test(time || '')))].sort();

  /** Tags sem repetição, sem "#" e sem espaços nas pontas. */
  function cleanTags(tags) {
    const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
    const seen = new Set();
    return list.map((tag) => String(tag).trim().replace(/^#+/, '').trim()).filter((tag) => {
      const key = tag.toLocaleLowerCase('pt-BR');
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Próxima data da série. Ao concluir, "a cada N dias" conta a partir de hoje. */
  function nextDate(task, today, completing = true) {
    const repeat = task.repeat;
    if (repeat.fromCompletion) return intervalAfter(today, repeat);
    // Ocorrência mudada só desta vez: a série conta do dia oficial dela.
    const when = task.occurrence?.when || task.when;
    if (completing && repeat.freq === 'daily') {
      // Feita hoje: a próxima vem N dias depois. Se foi adiantada, não volta para antes da data marcada.
      const next = addDays(today, repeat.interval);
      return when > today && next <= when ? addDays(when, repeat.interval) : next;
    }
    return nextOccurrence(repeat, when > today ? when : today);
  }

  function advance(moved, today, completing) {
    // Ocorrência mudada só desta vez: a próxima volta ao dia e ao horário oficiais.
    const occ = moved.occurrence;
    const task = occ
      ? { ...moved, when: occ.when, remindAt: occ.remindAt || null, extraReminders: occ.extraReminders || [], occurrence: null }
      : moved;
    if (occ && !task.remindEach) {
      task.remindAt = moved.remindAt;
      task.extraReminders = moved.extraReminders || [];
    }
    const done = (task.repeat.done || 0) + 1;
    if (task.repeat.count && done >= task.repeat.count) {
      return { ...task, status: 'ended', endedAt: today, repeat: { ...task.repeat, done } };
    }
    let repeat = { ...task.repeat, done };
    const next = nextDate(task, today, completing);
    // Contando a partir da conclusão, a série passa a seguir a nova data.
    if (repeat.fromCompletion || (completing && repeat.freq === 'daily')) repeat = { ...repeat, anchor: next };
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
      const shift = (time) => `${addDays(time.slice(0, 10), days)}${time.slice(10)}`;
      updated.remindAt = shift(task.remindAt);
      updated.extraReminders = (task.extraReminders || []).map(shift);
      updated.snoozedUntil = null;
      updated.snoozedFor = null;
      updated.ackedAt = null;
      updated.notifiedFor = null;
    }
    return updated;
  }

  /** Conclui a ocorrência aberta. R7 e R8: segue o calendário e não acumula dias perdidos. */
  function completeTask(task, today, completedAt) {
    if (!task.repeat) {
      return { task: { ...task, status: 'done', completedAt }, log: null };
    }
    return {
      task: advance(task, today, true),
      log: { taskId: task.id, title: task.title, occurrence: task.when, completedAt },
    };
  }

  /** Pula a ocorrência aberta sem registrá-la como concluída. */
  const skipOccurrence = (task, today) => advance(task, today, false);

  // R1: Hoje mostra tarefas abertas com Quando igual ou anterior a hoje.
  const isOpen = (task) => task.status === 'open' && !task.deletedAt;
  const todayTasks = (tasks, today) =>
    tasks.filter((task) => isOpen(task) && task.when && task.when <= today);
  const upcomingTasks = (tasks, today) =>
    tasks.filter((task) => isOpen(task) && task.when && task.when > today)
      .sort((a, b) => a.when.localeCompare(b.when) || a.order - b.order);

  // R2: dias parados em Hoje, para a etiqueta discreta.
  const daysWaiting = (task, today) =>
    task.when && task.when < today ? diffDays(today, task.when) : 0;

  // R3: só o prazo atrasa; o fim da série, não.
  const isOverdue = (task, today) =>
    isOpen(task) && !!task.deadline && task.deadline < today;

  /** Urgente para a matriz: Quando chegou ou o prazo vence em até 2 dias. */
  const isUrgent = (task, today) =>
    (!!task.when && task.when <= today) || (!!task.deadline && task.deadline <= addDays(today, 2));

  /** Todos os horários de lembrete da tarefa, em ordem. */
  const reminderTimes = (task) => cleanTimes([task.remindAt, ...(task.extraReminders || [])]);

  /**
   * Lembrete em vigor no momento `now`: o último que já passou, ou o adiamento dele.
   * Um lembrete posterior ao adiamento passa na frente. Dispensar vale até a hora dispensada.
   */
  function activeReminder(task, now) {
    if (!isOpen(task)) return null;
    const passed = reminderTimes(task).filter((time) => time <= now);
    let time = passed.length ? passed[passed.length - 1] : null;
    const later = task.snoozedFor && time > task.snoozedFor;
    if (task.snoozedUntil && time && time < task.snoozedUntil && !later) {
      time = task.snoozedUntil <= now ? task.snoozedUntil : null;
    }
    if (!time || (task.ackedAt && task.ackedAt >= time)) return null;
    return time;
  }

  /** Lembrete para mostrar na tarefa: o que está em vigor ou o próximo. */
  function shownReminder(task, now) {
    const active = activeReminder(task, now);
    if (active) return active;
    if (!isOpen(task)) return null;
    const next = [...reminderTimes(task), task.snoozedUntil].filter((time) => time && time > now).sort();
    return next[0] || null;
  }

  const reminderTime = (task, now = localDateTime()) => activeReminder(task, now) || shownReminder(task, now);

  // R10 e R11: o lembrete funciona sem datas e deixa de valer ao concluir.
  const dueReminders = (tasks, now) => tasks.filter((task) => activeReminder(task, now));

  /** Adia o lembrete para um horário ("AAAA-MM-DDTHH:MM"): 10 min, hoje à noite, amanhã... */
  const snoozeTo = (task, until, now) => ({
    ...task,
    snoozedUntil: until,
    snoozedFor: activeReminder(task, now) || task.remindAt || null,
    notifiedFor: null,
  });

  const snooze = (task, nowDate, minutes) =>
    snoozeTo(task, localDateTime(new Date(nowDate.getTime() + minutes * 60000)), localDateTime(nowDate));

  const dismissReminder = (task, now) => ({ ...task, ackedAt: now });

  /* ---------- Lembrete insistente ---------- */

  const INSIST_MAX = 12;

  /** 'YYYY-MM-DDTHH:mm' local para Date. */
  const parseLocal = (time) => {
    const [date, clock] = time.split('T');
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = clock.split(':').map(Number);
    return new Date(y, m - 1, d, h, mi);
  };

  const addMinutes = (time, minutes) => localDateTime(new Date(parseLocal(time).getTime() + minutes * 60000));

  /** Quantas vezes o lembrete já insistiu até `now` (0 é o aviso original). */
  function insistStep(task, time, nowDate, minutes) {
    if (!task.insist || !minutes) return 0;
    const elapsed = Math.floor((nowDate.getTime() - parseLocal(time).getTime()) / 60000);
    return Math.max(0, Math.min(INSIST_MAX, Math.floor(elapsed / minutes)));
  }

  /** Marca local de "já avisei": o horário, seguido de #n quando é uma insistência. */
  const notifyMark = (time, step) => (step ? `${time}#${step}` : time);
  return { addDays, diffDays, weekday, localDate, localDateTime, firstOccurrence, nextOccurrence, firstOnWeekdays, applyEdit, cleanTags, nextDate, completeTask, skipOccurrence, todayTasks, upcomingTasks, daysWaiting, isOverdue, isUrgent, reminderTimes, activeReminder, shownReminder, reminderTime, dueReminders, snoozeTo, snooze, dismissReminder, INSIST_MAX, parseLocal, addMinutes, insistStep, notifyMark };
})();
M['sync-core'] = (() => {
  // Regras de sincronização: a edição mais recente de cada campo vence. Sem rede nem banco.

  // Cada aparelho decide sozinho se já avisou; marcas internas não viajam.
  const LOCAL_FIELDS = new Set(['_t', '_dirty', 'notifiedFor']);

  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const syncedFields = (...records) => [...new Set(records.flatMap((r) => Object.keys(r || {})))]
    .filter((field) => !LOCAL_FIELDS.has(field));

  /** Marca com a hora atual os campos que mudaram entre duas versões. */
  function stamp(prev, next, now) {
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
  function stampAll(record, now) {
    const times = {};
    syncedFields(record).forEach((field) => { times[field] = now; });
    return { ...record, _t: times, _dirty: true };
  }

  function toWire(record) {
    const wire = { ...record };
    LOCAL_FIELDS.forEach((field) => { if (field !== '_t') delete wire[field]; });
    return wire;
  }

  /** Junta a versão do servidor à local, mantendo o que só existe neste aparelho. */
  function merge(local, remote) {
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
  const changedSince = (record, sentTimes) =>
    Object.entries(record._t || {}).some(([field, time]) => time > (sentTimes[field] || 0));

  const normalizeLogin = (login) => (login || '').trim().toLocaleLowerCase('pt-BR');

  /** Deriva a prova enviada ao servidor. A senha em si nunca sai do aparelho. */
  async function deriveProof(login, password) {
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
  return { stamp, stampAll, toWire, merge, changedSince, normalizeLogin, deriveProof };
})();
M['push-core'] = (() => {
  // Agenda dos avisos enviados pelo servidor com o app fechado. Sem rede nem banco, para poder testar.
  const { INSIST_MAX, activeReminder, addDays, addMinutes, localDate, localDateTime, parseLocal, reminderTimes, todayTasks } = M['rules'];

  const DEFAULT_PUSH_SETTINGS = { digest: false, digestTime: '08:00', insistMinutes: 5 };
  const HORIZON_DAYS = 14;
  const DIGEST_DAYS = 7;
  const MAX_ITEMS = 250;
  // Avisos de até 2 minutos atrás ainda entram: o servidor pode não ter enviado.
  const GRACE_MS = 2 * 60000;

  function normalizePushSettings(input) {
    const settings = { ...DEFAULT_PUSH_SETTINGS, ...(input || {}) };
    return {
      digest: !!settings.digest,
      digestTime: /^\d{2}:\d{2}$/.test(settings.digestTime) ? settings.digestTime : DEFAULT_PUSH_SETTINGS.digestTime,
      insistMinutes: [5, 10, 15, 30].includes(Number(settings.insistMinutes)) ? Number(settings.insistMinutes) : 5,
    };
  }

  /** Chave única do aviso: tarefa, horário do lembrete e número da insistência. */
  const pushKey = (taskId, time, step) => `${taskId}|${time}|${step}`;

  function parsePushKey(key) {
    const [taskId, time, step] = String(key).split('|');
    return { taskId, time, step: Number(step) || 0 };
  }

  const clock = (time) => time.slice(11, 16);

  function digestText(tasks, date) {
    const due = todayTasks(tasks, date).sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || a.order - b.order);
    if (!due.length) return null;
    const names = due.slice(0, 5).map((task) => task.title).join(' · ');
    return {
      title: due.length === 1 ? 'Hoje: 1 tarefa' : `Hoje: ${due.length} tarefas`,
      body: due.length > 5 ? `${names} · e mais ${due.length - 5}` : names,
    };
  }

  /**
   * Lista de avisos futuros: { key, at (ms), taskId, kind, title, body }.
   * `nowDate` é um Date; os horários das tarefas são locais deste aparelho.
   */
  function buildSchedule(tasks, nowDate, rawSettings) {
    const settings = normalizePushSettings(rawSettings);
    const now = localDateTime(nowDate);
    const from = localDateTime(new Date(nowDate.getTime() - GRACE_MS));
    const until = `${addDays(localDate(nowDate), HORIZON_DAYS)}T23:59`;
    const items = [];
    const add = (key, time, fields) => items.push({ key, at: parseLocal(time).getTime(), ...fields });

    tasks.forEach((task) => {
      if (task.status !== 'open' || task.deletedAt) return;
      const moments = [...new Set([...reminderTimes(task), task.snoozedUntil].filter(Boolean))].sort();
      const bases = moments.filter((time) => time >= from && time <= until && activeReminder(task, time) === time);
      bases.forEach((time) => add(pushKey(task.id, time, 0), time, {
        taskId: task.id, kind: 'remind', title: task.title, body: `Lembrete das ${clock(time)}`,
      }));
      if (!task.insist) return;
      // A insistência também continua um lembrete que já passou e ainda não teve resposta.
      const current = activeReminder(task, now);
      [...new Set([current, ...bases].filter(Boolean))].forEach((base) => {
        for (let step = 1; step <= INSIST_MAX; step += 1) {
          const time = addMinutes(base, step * settings.insistMinutes);
          if (time > until) break;
          if (activeReminder(task, time) !== base) break;
          if (time < from) continue;
          add(pushKey(task.id, base, step), time, {
            taskId: task.id, kind: 'insist', title: task.title, body: `Ainda pendente · lembrete das ${clock(base)}`,
          });
        }
      });
    });

    if (settings.digest) {
      for (let day = 0; day <= DIGEST_DAYS; day += 1) {
        const date = addDays(localDate(nowDate), day);
        const time = `${date}T${settings.digestTime}`;
        if (time < from) continue;
        const text = digestText(tasks, date);
        if (text) add(`digest|${date}`, time, { taskId: null, kind: 'digest', ...text });
      }
    }

    return items.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, MAX_ITEMS);
  }

  /** O aparelho já avisou deste lembrete, pelo app aberto? */
  function alreadyNotified(task, key) {
    if (!task) return false;
    const { time, step } = parsePushKey(key);
    if (task.status !== 'open' || task.deletedAt) return true;
    if (task.ackedAt && task.ackedAt >= time) return true;
    const mark = task.notifiedFor || '';
    const [markTime, markStep] = mark.split('#');
    return markTime === time && (Number(markStep) || 0) >= step;
  }
  return { DEFAULT_PUSH_SETTINGS, normalizePushSettings, pushKey, parsePushKey, buildSchedule, alreadyNotified };
})();
M['actions-core'] = (() => {
  // Ações sobre uma tarefa que valem igual no app e no service worker (botões da notificação).
  // Sem tela nem banco: recebem a tarefa e devolvem a tarefa nova.
  const { activeReminder, addDays, applyEdit, completeTask, localDate, localDateTime, snooze, snoozeTo } = M['rules'];

  const SNOOZE_MINUTES = 10;

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

  /** Mudar a data leva junto o lembrete que estava no mesmo dia, no mesmo horário. */
  function dateChanges(task, date) {
    // Numa tarefa que se repete, adiar ou mudar o dia pelo menu, pelo deslizar ou pela
    // notificação vale só para esta ocorrência: a série continua no calendário de antes.
    const changes = task.repeat ? { when: date, occurrenceOnly: true } : { when: date };
    if (date && task.remindAt && task.when && task.remindAt.slice(0, 10) === task.when) changes.remindAt = `${date}T${task.remindAt.slice(11)}`;
    return changes;
  }

  /** O prazo (Até) não deixa Quando passar dele. */
  const blockedByDeadline = (task, date) => !!(date && task.deadline && date > task.deadline);

  /**
   * Botões da notificação: 'done' (concluir), 'snooze' (adiar alguns minutos) e
   * 'tomorrow' (vai para amanhã e o lembrete volta amanhã no mesmo horário).
   * Devolve { task, log } ou { error }.
   */
  function notificationAction(task, action, nowDate = new Date()) {
    if (!task || task.status !== 'open' || task.deletedAt) return { error: 'A tarefa não está mais aberta.' };
    const day = localDate(nowDate);
    if (action === 'done') return completeTask(task, day, nowDate.toISOString());
    if (action === 'snooze') return { task: snooze(task, nowDate, SNOOZE_MINUTES) };
    if (action === 'tomorrow') {
      const tomorrow = addDays(day, 1);
      if (blockedByDeadline(task, tomorrow)) return { error: 'O prazo não deixa ir para amanhã.' };
      const now = localDateTime(nowDate);
      const active = activeReminder(task, now);
      const result = applyEdit(task, editFields(task, dateChanges(task, tomorrow)), day);
      if (result.error) return { error: result.error };
      let moved = result.task;
      if (active && activeReminder(moved, now)) moved = snoozeTo(moved, `${tomorrow}T${active.slice(11)}`, now);
      return { task: moved };
    }
    return { error: 'Ação desconhecida.' };
  }
  return { SNOOZE_MINUTES, editFields, dateChanges, blockedByDeadline, notificationAction };
})();
  return M;
})();
// ---- FIM DAS REGRAS EMBUTIDAS ----
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
// Sessão vence depois de 90 dias sem uso; cada uso renova (gravado no máximo uma vez por hora).
const SESSION_IDLE_MS = 90 * 24 * 3600 * 1000;
const SESSION_TOUCH_MS = 3600 * 1000;

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

/* ---------- Sessões: validade, nome do aparelho e sair dos outros ---------- */

// Colunas novas da v21 (last_used e name). ALTER falha se a coluna já existe: tudo bem.
let sessionColumnsReady;
async function addColumn(env, sql) {
  try {
    await env.DB.prepare(sql).run();
  } catch { /* coluna já existe */ }
}
const ensureSessionColumns = (env) => {
  sessionColumnsReady ||= (async () => {
    await addColumn(env, 'ALTER TABLE sessions ADD COLUMN last_used INTEGER');
    await addColumn(env, 'ALTER TABLE sessions ADD COLUMN name TEXT');
    // Sessões de antes da v21 contam a partir de agora: nenhuma cai na troca.
    await env.DB.prepare('UPDATE sessions SET last_used = ? WHERE last_used IS NULL').bind(Date.now()).run();
  })().catch((error) => {
    sessionColumnsReady = null;
    throw error;
  });
  return sessionColumnsReady;
};

/** "Android · Chrome", "Windows · Edge"... a partir do navegador que abriu a sessão. */
function deviceName(request) {
  const ua = request.headers.get('User-Agent') || '';
  const model = (ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/) || [])[1];
  const system = /Android/.test(ua) ? `Android${model && !/^K$/.test(model.trim()) ? ` (${model.trim()})` : ''}`
    : /iPhone|iPad/.test(ua) ? 'iPhone ou iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return (browser ? `${system} · ${browser}` : system).slice(0, 60);
}

async function newSession(env, request) {
  await ensureSessionColumns(env);
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, created_at, last_used, name) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), now, now, deviceName(request)).run();
  return token;
}

/** Apaga sessões e as inscrições de aviso delas: o aparelho que saiu não recebe mais notificações. */
async function dropSessions(env, where, ...args) {
  await ensureTables(env);
  const ofSessions = `SELECT token_hash FROM sessions WHERE ${where}`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM push_subs WHERE session_hash IN (${ofSessions})`).bind(...args),
    env.DB.prepare(`DELETE FROM alarm_covered WHERE device_id IN (SELECT id FROM alarm_devices WHERE session_hash IN (${ofSessions}))`).bind(...args),
    env.DB.prepare(`DELETE FROM alarm_devices WHERE session_hash IN (${ofSessions})`).bind(...args),
    env.DB.prepare(`DELETE FROM sessions WHERE ${where}`).bind(...args),
  ]);
}

async function sessionHash(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!token) return null;
  await ensureSessionColumns(env);
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT token_hash, created_at, last_used, name FROM sessions WHERE token_hash = ?').bind(hash).first();
  if (!row) return null;
  const now = Date.now();
  if (now - (row.last_used || row.created_at || 0) > SESSION_IDLE_MS) {
    await dropSessions(env, 'token_hash = ?', hash);
    return null;
  }
  if (now - (row.last_used || 0) > SESSION_TOUCH_MS || !row.name) {
    await env.DB.prepare('UPDATE sessions SET last_used = ?, name = COALESCE(name, ?) WHERE token_hash = ?')
      .bind(now, deviceName(request), hash).run();
  }
  return hash;
}

const sessionId = (hash) => hash.slice(0, 16);

async function sessionsList(request, env, current) {
  const { results } = await env.DB.prepare('SELECT token_hash, created_at, last_used, name FROM sessions ORDER BY last_used DESC').all();
  return reply(request, {
    idleDays: SESSION_IDLE_MS / 86400000,
    sessions: results.map((row) => ({
      id: sessionId(row.token_hash),
      name: row.name || 'Aparelho',
      createdAt: row.created_at,
      lastUsed: row.last_used || row.created_at,
      current: row.token_hash === current,
    })),
  });
}

async function sessionsRevoke(request, env, current) {
  const { id } = await request.json();
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return reply(request, { error: 'Aparelho inválido.' }, 400);
  if (id === sessionId(current)) return reply(request, { error: 'Para este aparelho, use Sair.' }, 400);
  await dropSessions(env, 'substr(token_hash, 1, 16) = ? AND token_hash <> ?', id, current);
  return sessionsList(request, env, current);
}

/** Sair dos outros aparelhos: encerra as outras sessões e corta os avisos delas (e os de antes da v21). */
async function revokeOthers(env, current) {
  await dropSessions(env, 'token_hash <> ?', current);
  await env.DB.prepare('DELETE FROM push_subs WHERE session_hash IS NULL').run();
}

async function sessionsRevokeOthers(request, env, current) {
  await revokeOthers(env, current);
  return sessionsList(request, env, current);
}

const hashProof = (salt, proof) => sha256(`${salt}:${proof}`);

async function register(request, env) {
  const { login, proof } = await request.json();
  if (!validLogin(login) || !validProof(proof)) return reply(request, { error: 'Dados inválidos.' }, 400);
  const salt = randomHex(16);
  const account = JSON.stringify({ login, salt, hash: await hashProof(salt, proof) });
  const result = await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('account', ?)").bind(account).run();
  if (!result.meta.changes) return reply(request, { error: 'Já existe uma conta. Use Entrar.' }, 409);
  return reply(request, { token: await newSession(env, request) });
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
  return reply(request, { token: await newSession(env, request) });
}

async function logout(request, env, current) {
  await dropSessions(env, 'token_hash = ?', current);
  return reply(request, { ok: true });
}

// Trocar a senha encerra a sessão de todos os outros aparelhos.
async function changePassword(request, env, current) {
  const { proof, newProof } = await request.json();
  if (!validProof(proof) || !validProof(newProof)) return reply(request, { error: 'Dados inválidos.' }, 400);
  const account = await readMeta(env, 'account');
  if ((await hashProof(account.salt, proof)) !== account.hash) return reply(request, { error: 'Senha atual incorreta.' }, 403);
  const salt = randomHex(16);
  await writeMeta(env, 'account', { login: account.login, salt, hash: await hashProof(salt, newProof) }).run();
  await revokeOthers(env, current);
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
// v29: um aviso que chega atrasado (celular sem rede por um tempo) ainda aparece, até 1 hora depois.
const DUE_WINDOW_MS = 60 * 60000;
const STALE_MS = 6 * 3600000;
const JWT_HOURS = 12;
const PUSH_SUBJECT = 'https://brunoignr-code.github.io/tarefas/';
const PUSH_KINDS = new Set(['remind', 'insist', 'digest', 'test']);
const DEFAULT_PUSH_SETTINGS = { digest: false, digestTime: '08:00', insistMinutes: 5 };
// v34: lembrete que já tocou e foi resolvido (concluído, adiado, dispensado, mudado) num aparelho
// sai do painel de notificações dos outros. Vale para o que tocou nas últimas 12 horas.
const CLEAR_LOOKBACK_MS = 12 * 3600000;

let tablesReady;
const ensureTables = (env) => {
  tablesReady ||= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_queue (key TEXT PRIMARY KEY, at INTEGER NOT NULL, sent_at INTEGER,
      task_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS push_queue_due ON push_queue (sent_at, at)'),
    // v30: alarmes do app Android (códigos de pareamento, celulares e avisos que cada um já agendou).
    env.DB.prepare('CREATE TABLE IF NOT EXISTS alarm_codes (code_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, sub_id TEXT, expires INTEGER NOT NULL)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS alarm_devices (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      session_hash TEXT NOT NULL, sub_id TEXT, name TEXT, created_at INTEGER NOT NULL, last_seen INTEGER, ready INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS alarm_covered (device_id TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (device_id, key))'),
  ]).then(() => addColumn(env, 'ALTER TABLE push_subs ADD COLUMN session_hash TEXT'))
    // v34: o aparelho entende o aviso de "limpar" (service worker novo). Os antigos não recebem esse push.
    .then(() => addColumn(env, 'ALTER TABLE push_subs ADD COLUMN clear_ok INTEGER')).catch((error) => {
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

/** Para quem é o aviso de limpar: todos os aparelhos que entendem, menos o que resolveu. */
function clearSkip(row) {
  try {
    const skip = JSON.parse(row.body || '{}');
    return { session: skip.s || null, sub: skip.d || null };
  } catch {
    return { session: null, sub: null };
  }
}
const clearFor = (row, sub) => {
  const skip = clearSkip(row);
  return !!sub.clear_ok && sub.id !== skip.sub && !(skip.session && sub.session_hash === skip.session);
};

/** `rows` = avisos que venceram agora ({ key, kind, body }); sem lista, manda para todos. */
async function sendPushes(env, rows = null) {
  const { results: subs } = await env.DB.prepare(`SELECT p.id, p.endpoint, p.session_hash, p.clear_ok, d.id AS device FROM push_subs p
    LEFT JOIN alarm_devices d ON d.sub_id = p.id AND d.ready = 1`).all();
  // v30: celular com os alarmes nativos já agendados para todos estes avisos não recebe o push.
  const keys = (rows || []).filter((row) => row.kind !== 'clear').map((row) => row.key);
  const covered = new Map();
  if (keys.length && subs.some((sub) => sub.device)) {
    const { results } = await env.DB.prepare(`SELECT device_id, key FROM alarm_covered WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
    results.forEach((row) => covered.set(row.device_id, (covered.get(row.device_id) || new Set()).add(row.key)));
  }
  // v34: o aviso de limpar vai só para quem entende e não para o aparelho que resolveu.
  const wants = (sub) => !rows || rows.some((row) => (row.kind === 'clear'
    ? clearFor(row, sub)
    : !(sub.device && covered.get(sub.device)?.has(row.key))));
  await Promise.all(subs.filter(wants).map(async (sub) => {
    try {
      const response = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidAuth(env, sub.endpoint), TTL: '3600', Urgency: 'high', 'Content-Length': '0' },
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
  const { results: due } = await env.DB.prepare('SELECT key, kind, body FROM push_queue WHERE sent_at IS NULL AND at <= ? AND at >= ? LIMIT 100')
    .bind(now, now - STALE_MS).all();
  const marked = await env.DB.prepare('UPDATE push_queue SET sent_at = ? WHERE sent_at IS NULL AND at <= ? AND at >= ?')
    .bind(now, now, now - STALE_MS).run();
  if (marked.meta.changes) await sendPushes(env, due.length < 100 ? due : null);
}

const subId = (endpoint) => sha256(endpoint);
const deviceCount = (env) => env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first('n');

async function pushState(request, env) {
  const [keys, settings, devices] = await Promise.all([vapidKeys(env), readMeta(env, 'pushSettings'), deviceCount(env)]);
  return reply(request, { publicKey: keys.pub, settings: normalizePushSettings(settings), devices });
}

async function pushSubscribe(request, env, current) {
  const body = await request.json();
  const { endpoint } = body;
  if (!validEndpoint(endpoint)) return reply(request, { error: 'Inscrição inválida.' }, 400);
  // A inscrição fica ligada à sessão: sair (ou a sessão vencer) corta os avisos deste aparelho.
  const id = await subId(endpoint);
  await env.DB.prepare(`INSERT INTO push_subs (id, endpoint, created_at, session_hash) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET session_hash = excluded.session_hash`)
    .bind(id, endpoint, Date.now(), current).run();
  // v34: o app novo avisa que o service worker dele entende o aviso de limpar.
  if (body.clear === true) await env.DB.prepare('UPDATE push_subs SET clear_ok = 1 WHERE id = ?').bind(id).run();
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

/**
 * Substitui os avisos ainda não enviados. Os já enviados ficam, para não repetir.
 * v26: cada aparelho monta a agenda com as tarefas que tem. Para um aparelho atrasado não apagar
 * os avisos que outro acabou de pôr, a agenda vem com `since` (até onde ele sincronizou) e é
 * ignorada se outro aparelho já mandou uma agenda mais nova. Por /push/task, com `taskId` (botão da
 * notificação, com o app fechado), troca só os avisos daquela tarefa; o endereço é outro para um
 * servidor antigo responder 404 em vez de tratar como agenda inteira. Sem `since` (versões antigas
 * do app), vale como antes.
 */
/**
 * v34: anota "limpar" para as tarefas cujo lembrete já tocou (nas últimas 12 h, até `upTo`) e que
 * não estão mais pendentes. O cron manda o aviso aos outros aparelhos, que fecham a notificação.
 * `only`: só esta tarefa; `keep`: tarefas ainda pendentes (as outras que tocaram são limpas).
 */
async function enqueueClears(env, { only = null, keep = null, upTo = Date.now(), skipSession = null, skipSub = null }) {
  const now = Date.now();
  const filter = only ? 'AND task_id = ?' : '';
  const { results } = await env.DB.prepare(`SELECT task_id AS taskId, MAX(at) AS at FROM push_queue
    WHERE sent_at IS NOT NULL AND kind IN ('remind', 'insist') AND task_id IS NOT NULL AND at >= ? AND at <= ? ${filter}
    GROUP BY task_id`).bind(now - CLEAR_LOOKBACK_MS, Math.min(upTo, now), ...(only ? [only] : [])).all();
  const rung = results.filter((row) => !keep || !keep.has(row.taskId));
  if (!rung.length) return 0;
  const { results: done } = await env.DB.prepare(`SELECT task_id AS taskId, MAX(at) AS at FROM push_queue
    WHERE kind = 'clear' AND at >= ? GROUP BY task_id`).bind(now - CLEAR_LOOKBACK_MS).all();
  const clearedAt = new Map(done.map((row) => [row.taskId, row.at]));
  const fresh = rung.filter((row) => !(clearedAt.get(row.taskId) >= row.at));
  if (!fresh.length) return 0;
  const skip = JSON.stringify({ s: skipSession, d: skipSub });
  const insert = env.DB.prepare("INSERT OR IGNORE INTO push_queue (key, at, task_id, kind, title, body) VALUES (?, ?, ?, 'clear', '', ?)");
  await env.DB.batch(fresh.map((row) => insert.bind(`clear|${row.taskId}|${now}`, now, row.taskId, skip)));
  return fresh.length;
}

// As rotas recebem (request, env, sessão): a troca por tarefa vem num quarto argumento.
const pushTaskSchedule = (request, env, current) => pushSchedule(request, env, current, true);

async function pushSchedule(request, env, current, byTask = false) {
  const body = await request.json();
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > MAX_SCHEDULE) return reply(request, { error: 'Agenda grande demais.' }, 413);
  const valid = items.every((item) => typeof item?.key === 'string' && item.key.length <= 200
    && Number.isFinite(item.at) && PUSH_KINDS.has(item.kind) && item.kind !== 'test');
  if (!valid) return reply(request, { error: 'Agenda inválida.' }, 400);
  const taskId = byTask && typeof body.taskId === 'string' && body.taskId ? clip(body.taskId, 100) : null;
  if (byTask && (!taskId || items.some((item) => item.taskId !== taskId))) return reply(request, { error: 'Agenda inválida.' }, 400);
  const since = !taskId && Number.isInteger(body.since) && body.since >= 0 ? body.since : null;
  const newest = since === null ? null : await readMeta(env, 'pushScheduleSince');
  const stale = since !== null && !!newest && since < newest.since;
  if (!stale) {
    const insert = env.DB.prepare('INSERT OR IGNORE INTO push_queue (key, at, task_id, kind, title, body) VALUES (?, ?, ?, ?, ?, ?)');
    await env.DB.batch([
      taskId
        ? env.DB.prepare("DELETE FROM push_queue WHERE sent_at IS NULL AND task_id = ? AND kind <> 'clear'").bind(taskId)
        : env.DB.prepare("DELETE FROM push_queue WHERE sent_at IS NULL AND kind NOT IN ('test', 'clear')"),
      ...items.map((item) => insert.bind(item.key, Math.round(item.at), item.taskId ? clip(item.taskId, 100) : null,
        item.kind, clip(item.title, 300), clip(item.body, 500))),
      ...(since !== null ? [writeMeta(env, 'pushScheduleSince', { since })] : []),
    ]);
    // v34: o que tocou e não está mais pendente sai do painel dos outros aparelhos.
    // Versões antigas do app não mandam `due`: nada muda para elas.
    const upTo = Number.isFinite(body.now) ? body.now : Date.now();
    if (taskId && body.due === false) {
      await enqueueClears(env, { only: taskId, upTo, skipSession: current });
    } else if (!taskId && Array.isArray(body.due) && body.due.length <= MAX_SCHEDULE && body.due.every((id) => typeof id === 'string')) {
      await enqueueClears(env, { keep: new Set(body.due.map((id) => clip(id, 100))), upTo, skipSession: current });
    }
  }
  const [settings, devices] = await Promise.all([readMeta(env, 'pushSettings'), deviceCount(env)]);
  return reply(request, { ok: true, stale, settings: normalizePushSettings(settings), devices });
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
  const { endpoint, clear } = await request.json();
  if (typeof endpoint !== 'string') return reply(request, { error: 'Inscrição inválida.' }, 400);
  const known = await env.DB.prepare('SELECT id FROM push_subs WHERE id = ?').bind(await subId(endpoint)).first();
  if (!known) return reply(request, { error: 'Inscrição desconhecida.' }, 404);
  // Tarefas só para aparelho com sessão viva (ou inscrito antes da v21, até ele se inscrever de novo).
  await ensureSessionColumns(env);
  const alive = await env.DB.prepare(`SELECT 1 AS ok FROM push_subs p LEFT JOIN sessions s ON s.token_hash = p.session_hash
    WHERE p.id = ? AND (p.session_hash IS NULL OR s.token_hash IS NOT NULL)`).bind(known.id).first();
  if (!alive) {
    await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(known.id).run();
    return reply(request, { error: 'Inscrição desconhecida.' }, 404);
  }
  const { results } = await env.DB.prepare(`SELECT key, at, task_id AS taskId, kind, title, body FROM push_queue
    WHERE sent_at >= ? ORDER BY at LIMIT 50`).bind(Date.now() - DUE_WINDOW_MS).all();
  // v30: o que os alarmes nativos deste celular já mostram não vem de novo pelo push.
  const { results: mine } = await env.DB.prepare(`SELECT c.key FROM alarm_covered c JOIN alarm_devices d ON d.id = c.device_id
    WHERE d.sub_id = ? AND d.ready = 1`).bind(known.id).all();
  const skip = new Set(mine.map((row) => row.key));
  // v34: só o service worker novo pede (e entende) os avisos de limpar; ele fica marcado para recebê-los.
  if (clear === true) await env.DB.prepare('UPDATE push_subs SET clear_ok = 1 WHERE id = ? AND clear_ok IS NULL').bind(known.id).run();
  const items = results.filter((item) => !skip.has(item.key) && (item.kind !== 'clear' || clear === true))
    .map((item) => (item.kind === 'clear' ? { key: item.key, at: item.at, taskId: item.taskId, kind: 'clear' } : item));
  return reply(request, { items });
}

/* ---------- Alarmes do app Android (v30) ---------- */
// O APK agenda alarmes exatos no próprio celular, que tocam na hora mesmo com o celular parado
// e sem internet. Ele não tem a senha nem a sessão do app web: o app web gera um código de uso
// único (/alarms/pair) e o Android o troca por uma chave própria (/alarms/claim), presa à sessão
// daquele celular. Sair do aparelho (ou a sessão vencer) apaga a chave e os alarmes param.
// Com a chave, o Android busca a agenda (/alarms/list), confere se um aviso ainda vale na hora de
// tocar (/alarms/check) e resolve os botões Concluir, Amanhã e Adiar sem abrir o app (/alarms/act),
// com as mesmas regras do app, embutidas acima por tools/build_sw.py.
// O servidor guarda quais avisos cada celular já agendou e não manda push deles para esse celular.
const ALARM_CODE_MS = 10 * 60000;
const ALARM_HORIZON_MS = 3 * 86400000;
const ALARM_MAX_ITEMS = 150;
const ALARM_ACTIONS = new Set(['done', 'snooze', 'tomorrow']);

/** Celular dono da chave de alarme, com a sessão ainda viva; senão, apaga a chave e devolve null. */
async function alarmDevice(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  await ensureSessionColumns(env);
  const hash = await sha256(token);
  const row = await env.DB.prepare(`SELECT d.id, d.session_hash, d.sub_id, d.ready, s.token_hash AS alive, s.last_used, s.created_at
    FROM alarm_devices d LEFT JOIN sessions s ON s.token_hash = d.session_hash WHERE d.token_hash = ?`).bind(hash).first();
  if (!row) return null;
  const now = Date.now();
  if (!row.alive || now - (row.last_used || row.created_at || 0) > SESSION_IDLE_MS) {
    await dropAlarmDevices(env, 'id = ?', row.id);
    return null;
  }
  return row;
}

const dropAlarmDevices = (env, where, ...args) => env.DB.batch([
  env.DB.prepare(`DELETE FROM alarm_covered WHERE device_id IN (SELECT id FROM alarm_devices WHERE ${where})`).bind(...args),
  env.DB.prepare(`DELETE FROM alarm_devices WHERE ${where}`).bind(...args),
]);

/** App web, dentro do APK: código de uso único para o Android pegar a chave de alarme. */
async function alarmsPair(request, env, current) {
  const { endpoint } = await request.json().catch(() => ({}));
  const sub = validEndpoint(endpoint) ? await subId(endpoint) : null;
  const code = randomHex(16);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM alarm_codes WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT INTO alarm_codes (code_hash, session_hash, sub_id, expires) VALUES (?, ?, ?, ?)')
      .bind(await sha256(code), current, sub, now + ALARM_CODE_MS),
  ]);
  return reply(request, { code, expiresAt: now + ALARM_CODE_MS });
}

/** Android: troca o código pela chave. Um celular com alarme por sessão; parear de novo troca a chave. */
async function alarmsClaim(request, env) {
  const { code, name } = await request.json().catch(() => ({}));
  if (typeof code !== 'string' || !/^[0-9a-f]{32}$/.test(code)) return reply(request, { error: 'Código inválido.' }, 400);
  const codeHash = await sha256(code);
  const row = await env.DB.prepare('SELECT session_hash, sub_id, expires FROM alarm_codes WHERE code_hash = ?').bind(codeHash).first();
  await env.DB.prepare('DELETE FROM alarm_codes WHERE code_hash = ?').bind(codeHash).run();
  if (!row || row.expires < Date.now()) return reply(request, { error: 'Código vencido. Toque de novo em Ativar alarmes.' }, 400);
  const alive = await env.DB.prepare('SELECT 1 AS ok FROM sessions WHERE token_hash = ?').bind(row.session_hash).first();
  if (!alive) return reply(request, { error: 'Sessão encerrada.' }, 401);
  const token = randomHex(32);
  const id = randomHex(8);
  const now = Date.now();
  await dropAlarmDevices(env, 'session_hash = ?', row.session_hash);
  await env.DB.prepare(`INSERT INTO alarm_devices (id, token_hash, session_hash, sub_id, name, created_at, last_seen, ready)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).bind(id, await sha256(token), row.session_hash, row.sub_id,
    clip(typeof name === 'string' ? name : 'Android', 80), now, now).run();
  return reply(request, { token, id });
}

/** Próximos avisos ainda não enviados, para o Android agendar. Marca quais ele cobre. */
async function alarmItems(env, device, ready) {
  const now = Date.now();
  const { results } = await env.DB.prepare(`SELECT key, at, task_id AS taskId, kind, title, body FROM push_queue
    WHERE sent_at IS NULL AND kind <> 'clear' AND at >= ? AND at <= ? ORDER BY at LIMIT ?`).bind(now - 60000, now + ALARM_HORIZON_MS, ALARM_MAX_ITEMS).all();
  const insert = env.DB.prepare('INSERT OR IGNORE INTO alarm_covered (device_id, key) VALUES (?, ?)');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM alarm_covered WHERE device_id = ?').bind(device.id),
    ...(ready ? results.map((item) => insert.bind(device.id, item.key)) : []),
    env.DB.prepare('UPDATE alarm_devices SET ready = ?, last_seen = ? WHERE id = ?').bind(ready ? 1 : 0, now, device.id),
  ]);
  return { items: results, now, ready };
}

async function alarmsList(request, env, device) {
  const { exact, notify } = await request.json().catch(() => ({}));
  // Só conta como coberto se o Android pode agendar alarme exato e mostrar notificação.
  return reply(request, await alarmItems(env, device, exact === true && notify === true));
}

/** Na hora de tocar: o aviso ainda vale? (Tarefa concluída ou mudada em outro aparelho sai da fila.) */
async function alarmsCheck(request, env) {
  const { key } = await request.json().catch(() => ({}));
  if (typeof key !== 'string' || key.length > 200) return reply(request, { error: 'Aviso inválido.' }, 400);
  const row = await env.DB.prepare('SELECT 1 AS ok FROM push_queue WHERE key = ?').bind(key).first();
  return reply(request, { valid: !!row });
}

/**
 * Botões Concluir, Amanhã e Adiar da notificação do Android, sem abrir o app.
 * As regras são as do app; o relógio é o do celular (`offset`, em minutos, como no Android).
 * O Worker roda em UTC, então a data "local" é montada deslocando o relógio do servidor.
 */
async function alarmsAct(request, env, device) {
  const { taskId, action, offset } = await request.json().catch(() => ({}));
  if (typeof taskId !== 'string' || !taskId || taskId.length > 100 || !ALARM_ACTIONS.has(action)
    || !Number.isInteger(offset) || Math.abs(offset) > 14 * 60) return reply(request, { error: 'Pedido inválido.' }, 400);
  const row = await env.DB.prepare("SELECT data, deleted FROM items WHERE kind = 'tasks' AND id = ?").bind(taskId).first();
  if (!row || row.deleted) return reply(request, { ok: false, error: 'A tarefa não existe mais.' });
  const current = JSON.parse(row.data);
  const realNow = Date.now();
  const shift = (offset + new Date(realNow).getTimezoneOffset()) * 60000;
  const wallNow = new Date(realNow + shift);
  const result = SHARED_RULES['actions-core'].notificationAction(current, action, wallNow);
  if (result.error) return reply(request, { ok: false, error: result.error, ...(await alarmItems(env, device, !!device.ready)) });
  // Concluir grava a hora da conclusão em ISO: a do relógio deslocado precisa voltar para a real.
  const fakeIso = wallNow.toISOString();
  const realIso = new Date(realNow).toISOString();
  const fixIso = (record) => (record && record.completedAt === fakeIso ? { ...record, completedAt: realIso } : record);
  const { stamp, toWire } = SHARED_RULES['sync-core'];
  const saved = toWire(stamp(current, fixIso(result.task), realNow));
  const merged = merge(current, saved);
  const writes = [env.DB.prepare(`INSERT INTO items (kind, id, data, deleted, seq) VALUES ('tasks', ?, ?, 0, (SELECT seq FROM counter))
    ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, seq = excluded.seq WHERE items.deleted = 0`).bind(taskId, JSON.stringify(merged))];
  if (result.log) {
    const entry = toWire(stamp(null, { ...fixIso(result.log), id: crypto.randomUUID() }, realNow));
    writes.push(env.DB.prepare(`INSERT INTO items (kind, id, data, deleted, seq) VALUES ('log', ?, ?, 0, (SELECT seq FROM counter))`)
      .bind(entry.id, JSON.stringify(entry)));
  }
  // Os avisos desta tarefa, refeitos com a tarefa nova (como o botão da notificação do app faz por /push/task).
  const settings = normalizePushSettings(await readMeta(env, 'pushSettings'));
  const items = SHARED_RULES['push-core'].buildSchedule([merged], wallNow, settings).filter((item) => item.taskId === taskId);
  const insert = env.DB.prepare('INSERT OR IGNORE INTO push_queue (key, at, task_id, kind, title, body) VALUES (?, ?, ?, ?, ?, ?)');
  await env.DB.batch([
    env.DB.prepare('UPDATE counter SET seq = seq + 1'),
    ...writes,
    env.DB.prepare("DELETE FROM push_queue WHERE sent_at IS NULL AND task_id = ? AND kind <> 'clear'").bind(taskId),
    ...items.map((item) => insert.bind(item.key, Math.round(item.at - shift), taskId, item.kind, clip(item.title, 300), clip(item.body, 500))),
  ]);
  // v34: resolvido aqui, sai do painel dos outros aparelhos (este celular já tirou a dele).
  const rules = SHARED_RULES.rules;
  if (!rules.activeReminder(merged, rules.localDateTime(wallNow))) {
    await enqueueClears(env, { only: taskId, upTo: realNow, skipSub: device.sub_id || null });
  }
  return reply(request, { ok: true, ...(await alarmItems(env, device, !!device.ready)) });
}

/** App web: este celular tem alarmes nativos ativos? */
async function alarmsStatus(request, env, current) {
  const row = await env.DB.prepare('SELECT id, name, ready, last_seen, created_at FROM alarm_devices WHERE session_hash = ?').bind(current).first();
  return reply(request, row
    ? { active: true, ready: !!row.ready, name: row.name, lastSeen: row.last_seen, createdAt: row.created_at }
    : { active: false });
}

async function alarmsRevoke(request, env, current) {
  await dropAlarmDevices(env, 'session_hash = ?', current);
  return reply(request, { active: false });
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
  return reply(request, { token: await newSession(env, request), login: account?.login || '', email: google.email });
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

const DRIVE_RETRY_MS = 3 * 3600 * 1000;

/** Chamado pelo cron: um backup por dia, depois das 3h de Brasília. Se falhar, tenta de novo a cada 3 horas. */
async function driveDaily(env) {
  const now = new Date();
  if (now.getUTCMinutes() % 15 !== 7 || localHour(now) < DRIVE_HOUR) return;
  const drive = await readMeta(env, 'drive');
  const today = localDay(now);
  if (!drive?.refresh || drive.lastDay === today) return;
  if (drive.lastTryDay === today && now.getTime() - (drive.lastTry || 0) < DRIVE_RETRY_MS) return;
  await driveBackup(env);
}

/** Uma vez por hora, pelo cron: apaga as sessões vencidas e as inscrições de aviso delas. */
async function cleanSessions(env) {
  if (new Date().getUTCMinutes() !== 23) return;
  await ensureSessionColumns(env);
  await dropSessions(env, 'COALESCE(last_used, created_at) < ?', Date.now() - SESSION_IDLE_MS);
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
      if (pathname.startsWith('/alarms/')) await ensureTables(env);
      if (pathname === '/alarms/claim') return await alarmsClaim(request, env);
      const alarmRoutes = { '/alarms/list': alarmsList, '/alarms/check': alarmsCheck, '/alarms/act': alarmsAct };
      if (alarmRoutes[pathname]) {
        const device = await alarmDevice(request, env);
        if (!device) return reply(request, { error: 'Alarmes desligados neste celular. Ative de novo no app.' }, 401);
        return await alarmRoutes[pathname](request, env, device);
      }
      const routes = {
        '/sync': (r, e) => sync(r, e),
        '/logout': logout,
        '/password': changePassword,
        '/push/state': pushState,
        '/push/subscribe': pushSubscribe,
        '/push/unsubscribe': pushUnsubscribe,
        '/push/settings': pushSettings,
        '/push/schedule': pushSchedule,
        '/push/task': pushTaskSchedule,
        '/alarms/pair': alarmsPair,
        '/alarms/status': alarmsStatus,
        '/alarms/revoke': alarmsRevoke,
        '/push/test': pushTest,
        '/google/status': googleStatus,
        '/google/link': googleLink,
        '/google/unlink': googleUnlink,
        '/drive/connect': driveConnect,
        '/drive/backup': driveBackupNow,
        '/drive/list': driveList,
        '/drive/file': driveFile,
        '/drive/disconnect': driveDisconnect,
        '/sessions/list': sessionsList,
        '/sessions/revoke': sessionsRevoke,
        '/sessions/revoke-others': sessionsRevokeOthers,
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
    ctx.waitUntil(cleanSessions(env).catch((error) => console.error('sessões', error)));
  },
};
