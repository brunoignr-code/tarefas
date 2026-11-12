// Mantém o app disponível offline, mostra os avisos enviados pelo servidor e trata os botões das notificações.
// Sem import: funciona registrado como clássico (aparelhos até a v14.5) ou como módulo (v15 e v16).
// As regras de Concluir, Adiar e Amanhã são as mesmas do app, embutidas abaixo por tools/build_sw.py.
// ---- INÍCIO DAS REGRAS EMBUTIDAS (gerado por tools/build_sw.py; não edite à mão) ----
const SW_RULES = (() => {
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
const { notificationAction } = SW_RULES['actions-core'];
const { stamp, toWire } = SW_RULES['sync-core'];
const { buildSchedule, normalizePushSettings } = SW_RULES['push-core'];
const CACHE = 'tarefas-v27';
const APP_NAME = 'Minha lista de afazeres';
const SYNC_URL = 'https://tarefas-sync.brunoignr-code.workers.dev';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/boot.js',
  'js/splash.js',
  'js/db.js',
  'js/rules.js',
  'js/parse.js',
  'js/theme.js',
  'js/sync-core.js',
  'js/actions-core.js',
  'js/google.js',
  'js/sync.js',
  'js/push-core.js',
  'js/push.js',
  'fonts/nunito.woff2',
  'icons/icon-folha.svg',
  'icons/capa-folha.svg',
  'icons/icon-folha-192.png',
  'icons/icon-folha-512.png',
  'icons/icon-folha-maskable-512.png',
  'icons/badge-folha-96.png',
  'icons/favicon.svg',
  'icons/favicon-32.png',
  'icons/favicon-16.png',
];

// 'reload' ignora o cache HTTP do navegador, que poderia guardar uma versão antiga.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Responde na hora com o que está salvo e atualiza em segundo plano.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/tests/')) return;
  // A chave ignora a busca do endereço, para não guardar textos compartilhados no cache.
  const key = url.origin + url.pathname;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    const network = fetch(key, { cache: 'no-cache' }).then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  }));
});

const BACKGROUND_ACTIONS = ['done', 'snooze', 'tomorrow'];

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  const action = event.action || 'open';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (id && BACKGROUND_ACTIONS.includes(action)) {
      // Concluir, Adiar e Amanhã não abrem o app.
      const visible = windows.find((client) => client.visibilityState === 'visible');
      if (visible) {
        visible.postMessage({ type: 'notification-action', action, id });
        return undefined;
      }
      try {
        await actInBackground(action, id);
        windows.forEach((client) => client.postMessage({ type: 'reload-data' }));
        return undefined;
      } catch (error) {
        console.warn('Ação da notificação não registrada aqui; abrindo o app', error);
        return self.clients.openWindow(`./#notif/${action}/${id}`);
      }
    }
    if (windows.length) {
      if (id) windows[0].postMessage({ type: 'notification-action', action, id });
      return windows[0].focus();
    }
    return self.clients.openWindow(id ? `./#notif/${action}/${id}` : './#today');
  })());
});

// Mesma ação, pedida pela própria página: usado para testar no navegador sem notificação de verdade.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'run-notification-action' || !BACKGROUND_ACTIONS.includes(data.action)) return;
  event.waitUntil(actInBackground(data.action, data.id)
    .then(async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      windows.forEach((client) => client.postMessage({ type: 'reload-data' }));
      if (event.source) event.source.postMessage({ type: 'notification-action-done', id: data.id });
    })
    .catch((error) => event.source && event.source.postMessage({ type: 'notification-action-done', id: data.id, error: String(error) })));
});

/**
 * Registra o botão da notificação direto no banco deste aparelho e avisa o servidor,
 * sem abrir o app. A sincronização completa acontece na próxima vez que o app abrir.
 */
async function actInBackground(action, id) {
  const database = await openDb();
  try {
    await registerAction(database, action, id);
  } finally {
    database.close();
  }
}

async function registerAction(database, action, id) {
  const task = await idb(database, 'tasks', 'readonly', (store) => store.get(id));
  if (!task) throw new Error('Tarefa não encontrada neste aparelho.');
  const result = notificationAction(task, action, new Date());
  if (result.error) {
    // Já concluída ou mudada em outro aparelho: nada a fazer.
    return;
  }
  const now = Date.now();
  const saved = stamp(task, result.task, now);
  await idb(database, 'tasks', 'readwrite', (store) => store.put(saved));
  const records = [{ kind: 'tasks', id, data: toWire(saved) }];
  if (result.log) {
    const entry = stamp(null, { ...result.log, id: crypto.randomUUID() }, now);
    await idb(database, 'log', 'readwrite', (store) => store.put(entry));
    records.push({ kind: 'log', id: entry.id, data: toWire(entry) });
  }
  const sync = await idb(database, 'meta', 'readonly', (store) => store.get('sync'));
  if (!sync || !sync.token) return;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${sync.token}` };
  try {
    // "since" não avança aqui: o app recebe tudo na próxima sincronização (a junção é campo a campo).
    await fetch(`${SYNC_URL}/sync`, { method: 'POST', headers, body: JSON.stringify({ since: sync.since || 0, records, deletes: [] }) });
    // Refaz os avisos só desta tarefa, para os outros aparelhos não avisarem de uma tarefa já
    // resolvida (v26). Antes ia a agenda inteira, montada com as tarefas deste aparelho, que com o
    // app fechado podem estar desatualizadas: apagava avisos que outro aparelho tinha acabado de pôr.
    const push = await idb(database, 'meta', 'readonly', (store) => store.get('push'));
    const items = buildSchedule([saved], new Date(), normalizePushSettings(push && push.settings)).filter((item) => item.taskId === id);
    // Endereço próprio: um servidor antigo responde 404 em vez de tratar como agenda inteira.
    await fetch(`${SYNC_URL}/push/task`, { method: 'POST', headers, body: JSON.stringify({ taskId: id, items }) });
    if (push) await idb(database, 'meta', 'readwrite', (store) => store.put({ ...push, hash: null }));
  } catch (error) {
    // Sem internet: a mudança fica guardada (marcada para enviar) e sobe quando o app abrir.
    console.warn('Ação guardada; será enviada depois', error);
  }
}

/* ---------- Avisos com o app fechado ---------- */
// O push chega sem conteúdo. O aviso vem de /push/due; sem internet, das tarefas guardadas aqui.

const SHOWN_MAX = 300;
const LOG_MAX = 20;

/** Guarda os últimos avisos que chegaram a este aparelho, para Config. › Avisos mostrar (v26). */
async function logPush(database, entry) {
  if (!database) return;
  try {
    const record = await idb(database, 'meta', 'readonly', (s) => s.get('pushLog'));
    const entries = [...((record && record.entries) || []), { at: Date.now(), ...entry }].slice(-LOG_MAX);
    await idb(database, 'meta', 'readwrite', (s) => s.put({ id: 'pushLog', entries }));
  } catch { /* Só um registro: não atrapalha o aviso. */ }
}

function openDb() {
  return new Promise((resolve, reject) => {
    // Mesma versão e mesmas tabelas de js/db.js, para não criar um banco vazio.
    const request = indexedDB.open('tarefas', 1);
    request.onupgradeneeded = () => {
      ['lists', 'tasks', 'log', 'meta'].forEach((name) => request.result.createObjectStore(name, { keyPath: 'id' }));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const idb = (database, name, mode, work) => new Promise((resolve, reject) => {
  const request = work(database.transaction(name, mode).objectStore(name));
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const pad = (n) => String(n).padStart(2, '0');
const localDateTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Igual a alreadyNotified em js/push-core.js: o app aberto já avisou deste lembrete?
function alreadyNotified(task, key) {
  if (!task) return false;
  const [, time, rawStep] = key.split('|');
  const step = Number(rawStep) || 0;
  if (task.status !== 'open' || task.deletedAt) return true;
  if (task.ackedAt && task.ackedAt >= time) return true;
  const [markTime, markStep] = (task.notifiedFor || '').split('#');
  return markTime === time && (Number(markStep) || 0) >= step;
}

// Sem internet: lembretes que venceram nos últimos 15 minutos, pelas tarefas deste aparelho.
function localDue(tasks, now) {
  const from = localDateTime(new Date(now.getTime() - 15 * 60000));
  const to = localDateTime(now);
  return tasks.filter((task) => task.status === 'open' && !task.deletedAt).flatMap((task) => {
    const time = [task.remindAt, ...(task.extraReminders || []), task.snoozedUntil]
      .filter((t) => t && t >= from && t <= to).sort().pop();
    return time ? [{ key: `${task.id}|${time}|0`, taskId: task.id, kind: 'remind', title: task.title, body: `Lembrete das ${time.slice(11)}` }] : [];
  });
}

function notify(item, quiet, second = 'tomorrow') {
  const options = {
    body: item.body,
    icon: 'icons/icon-folha-192.png',
    badge: 'icons/badge-folha-96.png',
    tag: item.taskId || item.kind,
    renotify: !quiet && item.kind === 'insist',
    silent: !!quiet,
    data: { id: item.taskId || null },
  };
  if (item.taskId) {
    // O Chrome mostra no máximo dois botões: Concluir e o escolhido em Config. › Avisos.
    options.actions = [
      { action: 'done', title: 'Concluir' },
      second === 'snooze' ? { action: 'snooze', title: 'Adiar 10 min' } : { action: 'tomorrow', title: 'Amanhã' },
    ];
  }
  return self.registration.showNotification(item.title, options);
}

async function onPush() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = windows.some((client) => client.visibilityState === 'visible');
  windows.forEach((client) => client.postMessage({ type: 'push-arrived' }));

  let database = null;
  try { database = await openDb(); } catch { /* Segue só com o servidor. */ }
  const tasks = database ? await idb(database, 'tasks', 'readonly', (s) => s.getAll()).catch(() => []) : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const record = database ? await idb(database, 'meta', 'readonly', (s) => s.get('pushShown')).catch(() => null) : null;
  const shown = new Set((record && record.keys) || []);
  const settings = database ? await idb(database, 'meta', 'readonly', (s) => s.get('settings')).catch(() => null) : null;
  const second = settings && settings.notifySecond === 'snooze' ? 'snooze' : 'tomorrow';

  let items = null;
  let source = 'server';
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    const response = await fetch(`${SYNC_URL}/push/due`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription && subscription.endpoint }),
    });
    if (response.ok) items = (await response.json()).items;
    else source = `server-${response.status}`;
  } catch { source = 'offline'; }
  if (!items) items = localDue(tasks, new Date());

  // Com o app na tela, ele mesmo mostra os lembretes; o resumo e o teste aparecem sempre.
  const fresh = items.filter((item) => !shown.has(item.key)
    && !(item.taskId && (visible || alreadyNotified(byId.get(item.taskId), item.key))));
  // Um aviso por tarefa: o mais recente.
  const latest = new Map();
  fresh.forEach((item) => latest.set(item.taskId || item.key, item));
  await Promise.all([...latest.values()].map((item) => notify(item, false, second)));

  if (fresh.length && database) {
    const keys = [...shown, ...fresh.map((item) => item.key)].slice(-SHOWN_MAX);
    await idb(database, 'meta', 'readwrite', (s) => s.put({ id: 'pushShown', keys })).catch(() => {});
  }
  await logPush(database, { source, items: items.length, shown: latest.size, visible });
  if (!latest.size && !visible) {
    // O navegador exige um aviso a cada push. Repete em silêncio o último, ou um aviso genérico.
    const last = items[items.length - 1];
    await notify(last || { key: 'generic', kind: 'generic', title: APP_NAME, body: 'Você tem um lembrete. Toque para abrir.' }, true, second);
  }
}

/**
 * O Chrome às vezes troca a inscrição de push (atualização, limpeza). Sem isto, o servidor seguia
 * mandando para o endereço velho, recebia "410" e apagava o aparelho: os avisos só voltavam ao abrir o app.
 */
async function renewSubscription(event) {
  let subscription = event.newSubscription || null;
  if (!subscription) {
    const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
    if (!key) return;
    subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const database = await openDb();
  try {
    const sync = await idb(database, 'meta', 'readonly', (store) => store.get('sync'));
    if (!sync || !sync.token) return;
    await fetch(`${SYNC_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sync.token}` },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await logPush(database, { source: 'renewed', items: 0, shown: 0, visible: false });
  } finally {
    database.close();
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(renewSubscription(event).catch((error) => console.warn('Inscrição não renovada', error)));
});

self.addEventListener('push', (event) => {
  event.waitUntil(onPush().catch((error) => {
    console.error(error);
    return self.registration.showNotification(APP_NAME, { body: 'Você tem um lembrete. Toque para abrir.', icon: 'icons/icon-folha-192.png', tag: 'generic' });
  }));
});
