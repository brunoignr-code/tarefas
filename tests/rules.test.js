import {
  addDays, applyEdit, completeTask, daysWaiting, dismissReminder, dueReminders, firstOccurrence,
  isOverdue, nextOccurrence, skipOccurrence, snooze, todayTasks, upcomingTasks,
} from '../js/rules.js';
import {
  DEFAULT_HIGHLIGHT, HIGHLIGHTS, contrast, isHexColor, isTooLight, normalizeTheme, resolveTheme, textOn,
} from '../js/theme.js';
import { changedSince, merge, stamp, stampAll, toWire } from '../js/sync-core.js';
import { parseQuickAdd } from '../js/parse.js';
import {
  activeReminder, cleanTags, insistStep, isUrgent, notifyMark, reminderTimes, shownReminder,
} from '../js/rules.js';
import { alreadyNotified, buildSchedule, parsePushKey, pushKey } from '../js/push-core.js';

const results = [];
const eq = (actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`esperado ${e}, veio ${a}`);
};
const test = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
};

const TODAY = '2026-11-02'; // segunda-feira
const base = { id: 't1', status: 'open', order: 1, steps: [] };
const edit = (fields, prev = null) => applyEdit(prev, { title: 'Tarefa', ...fields }, TODAY);
const make = (fields) => ({ ...base, ...edit(fields).task });

test('R1: Hoje inclui Quando de hoje e passado, sem futuro nem vazio', () => {
  const tasks = [
    { ...base, id: 'a', when: TODAY }, { ...base, id: 'b', when: '2026-10-30' },
    { ...base, id: 'c', when: '2026-11-03' }, { ...base, id: 'd', when: null },
  ];
  eq(todayTasks(tasks, TODAY).map((t) => t.id), ['a', 'b']);
  eq(upcomingTasks(tasks, TODAY).map((t) => t.id), ['c']);
});

test('R1: Até e Lembrar não colocam a tarefa em Hoje', () => {
  const task = make({ until: TODAY, remindAt: `${TODAY}T08:00` });
  eq(todayTasks([task], TODAY), []);
});

test('R2: tarefa parada mostra há quantos dias está em Hoje', () => {
  eq(daysWaiting({ when: '2026-10-30' }, TODAY), 3);
  eq(daysWaiting({ when: TODAY }, TODAY), 0);
});

test('R3: prazo vencido atrasa, e a tarefa continua aberta', () => {
  const task = make({ until: '2026-11-01' });
  eq(isOverdue(task, TODAY), true);
  eq(task.status, 'open');
});

test('R3: o fim de uma série não conta como atraso', () => {
  eq(isOverdue(make({ when: '2026-10-01', until: '2026-11-01', repeat: { freq: 'daily' } }), TODAY), false);
});

test('R4: o último dia da série é inclusive, e depois a série termina', () => {
  const series = make({ when: TODAY, until: '2026-11-03', repeat: { freq: 'daily' } });
  const second = completeTask(series, TODAY, 'x').task;
  eq(second.when, '2026-11-03');
  eq(second.status, 'open');
  const ended = completeTask(second, '2026-11-03', 'x');
  eq(ended.task.status, 'ended');
  eq(ended.log.occurrence, '2026-11-03');
});

test('R5: Repetir sem Quando preenche a próxima data compatível', () => {
  const result = edit({ repeat: { freq: 'weekly', weekdays: [5] } });
  eq(result.task.when, '2026-11-06');
  eq(result.whenFilled, true);
});

test('R5: Quando informado não é alterado', () => {
  const result = edit({ when: '2026-11-10', repeat: { freq: 'daily' } });
  eq(result.task.when, '2026-11-10');
  eq(result.whenFilled, false);
});

test('R6: Até anterior a Quando é bloqueado, com ou sem repetição', () => {
  eq(typeof edit({ when: '2026-11-10', until: '2026-11-09' }).error, 'string');
  eq(typeof edit({ when: '2026-11-10', until: '2026-11-09', repeat: { freq: 'daily' } }).error, 'string');
  eq(edit({ when: '2026-11-10', until: '2026-11-10' }).error, undefined);
});

test('Até vira Prazo sem repetição e Fim da série com repetição', () => {
  const single = make({ until: '2026-12-01' });
  eq([single.deadline, single.seriesEnd], ['2026-12-01', null]);
  const series = make({ when: TODAY, until: '2026-12-01', repeat: { freq: 'daily' } });
  eq([series.deadline, series.seriesEnd], [null, '2026-12-01']);
});

test('R7: dias perdidos não se acumulam', () => {
  const late = make({ when: '2026-10-20', repeat: { freq: 'daily' } });
  eq(completeTask(late, TODAY, 'x').task.when, '2026-11-03');
});

test('R8: mensal mantém o dia 31 nos meses seguintes', () => {
  let task = make({ when: '2027-01-31', repeat: { freq: 'monthly' } });
  const dates = [];
  for (let i = 0; i < 3; i += 1) {
    task = completeTask(task, task.when, 'x').task;
    dates.push(task.when);
  }
  eq(dates, ['2027-02-28', '2027-03-31', '2027-04-30']);
});

test('R8: anual em 29/02 cai em 28/02 e volta em ano bissexto', () => {
  const repeat = { freq: 'yearly', interval: 1, anchor: '2028-02-29' };
  eq(nextOccurrence(repeat, '2028-02-29'), '2029-02-28');
  eq(firstOccurrence(repeat, '2031-03-01'), '2032-02-29');
});

test('R8: semanal respeita os dias e o intervalo', () => {
  const repeat = { freq: 'weekly', interval: 2, weekdays: [1, 3], anchor: TODAY };
  eq(nextOccurrence(repeat, TODAY), '2026-11-04');
  eq(nextOccurrence(repeat, '2026-11-04'), '2026-11-16');
});

test('R8: a cada N dias conta a partir da âncora', () => {
  const repeat = { freq: 'daily', interval: 3, anchor: TODAY };
  eq(firstOccurrence(repeat, '2026-11-04'), '2026-11-05');
});

test('R9: lembrete recorrente acompanha a ocorrência no mesmo horário', () => {
  const task = make({ when: TODAY, repeat: { freq: 'daily' }, remindAt: `${TODAY}T08:00` });
  const next = completeTask({ ...task, ackedAt: 'x' }, TODAY, 'x').task;
  eq(next.remindAt, '2026-11-03T08:00');
  eq(next.ackedAt, null);
});

test('R9: lembrete único não acompanha a série', () => {
  const task = make({ when: TODAY, repeat: { freq: 'daily' }, remindAt: `${TODAY}T08:00`, remindEach: false });
  eq(completeTask(task, TODAY, 'x').task.remindAt, `${TODAY}T08:00`);
});

test('R10: lembrete funciona sem Quando nem Até', () => {
  const task = make({ remindAt: `${TODAY}T14:00` });
  eq(task.when, null);
  eq(dueReminders([task], `${TODAY}T13:59`).length, 0);
  eq(dueReminders([task], `${TODAY}T14:00`).length, 1);
});

test('R11: concluir cancela o lembrete pendente', () => {
  const task = make({ remindAt: `${TODAY}T14:00` });
  eq(dueReminders([completeTask(task, TODAY, 'x').task], `${TODAY}T15:00`).length, 0);
});

test('R12: editar a série preserva o histórico e a âncora', () => {
  const first = make({ when: '2027-01-31', repeat: { freq: 'monthly' } });
  const { task: second, log } = completeTask(first, '2027-01-31', 'x');
  const edited = applyEdit(second, {
    title: 'Novo título', when: second.when, repeat: { freq: 'monthly', interval: 1 },
  }, '2027-02-01').task;
  eq(edited.repeat.anchor, '2027-01-31');
  eq(log.title, 'Tarefa');
  eq(edited.title, 'Novo título');
});

test('Pular avança sem gerar histórico e pode encerrar a série', () => {
  const task = make({ when: TODAY, until: addDays(TODAY, 1), repeat: { freq: 'daily' } });
  const skipped = skipOccurrence(task, TODAY);
  eq(skipped.when, '2026-11-03');
  eq(skipOccurrence(skipped, '2026-11-03').status, 'ended');
});

test('Concluir recorrente desmarca as etapas', () => {
  const task = { ...make({ when: TODAY, repeat: { freq: 'daily' } }), steps: [{ title: 'a', done: true }] };
  eq(completeTask(task, TODAY, 'x').task.steps[0].done, false);
});

test('Adiar e dispensar controlam o lembrete', () => {
  const task = make({ remindAt: `${TODAY}T14:00` });
  const later = snooze(task, new Date(2026, 10, 2, 14, 0), 10);
  eq(later.snoozedUntil, `${TODAY}T14:10`);
  eq(dueReminders([later], `${TODAY}T14:05`).length, 0);
  eq(dueReminders([later], `${TODAY}T14:10`).length, 1);
  eq(dueReminders([dismissReminder(task, 'x')], `${TODAY}T15:00`).length, 0);
});

test('Título vazio é recusado', () => {
  eq(typeof applyEdit(null, { title: '  ' }, TODAY).error, 'string');
});

test('Tema: Sistema e Barquinho saíram e viram a Folha (padrão)', () => {
  eq(resolveTheme('system'), 'folha');
  eq(resolveTheme('barquinho'), 'folha');
  eq(resolveTheme('marca-texto'), 'marca-texto');
  eq(resolveTheme('diamante'), 'diamante');
});

test('Tema: valores antigos ou inválidos são convertidos', () => {
  eq(normalizeTheme('auto'), 'folha');
  eq(normalizeTheme('dark'), 'diamante');
  eq(normalizeTheme('light'), 'folha');
  eq(normalizeTheme('qualquer'), 'folha');
  eq(normalizeTheme('marca-texto'), 'marca-texto');
});

test('Marca-texto: o texto sobre a cor mantém contraste de 4,5:1', () => {
  ['#000000', '#FFFFFF', '#777777', '#767676', '#808080', '#FF0000', '#0000FF', '#00FF00', DEFAULT_HIGHLIGHT,
    ...HIGHLIGHTS.map((h) => h.color)].forEach((color) => {
    if (contrast(color, textOn(color)) < 4.5) throw new Error(`${color} ficou abaixo de 4,5:1`);
  });
});

test('Marca-texto: valida cores e avisa quando é clara demais', () => {
  eq(isHexColor('#a1B2c3'), true);
  eq(isHexColor('red'), false);
  eq(isTooLight('#FFFFFF'), true);
  eq(HIGHLIGHTS.some((h) => isTooLight(h.color)), false);
});

test('Sync: só os campos alterados recebem hora', () => {
  const first = stampAll({ id: 'a', title: 'x', notes: '' }, 100);
  const next = stamp(first, { ...first, title: 'y' }, 200);
  eq([next._t.title, next._t.notes, next._dirty], [200, 100, true]);
});

test('Sync: edições em campos diferentes de dois aparelhos se somam', () => {
  const base = stampAll({ id: 'a', title: 'x', notes: '' }, 100);
  const phone = stamp(base, { ...base, title: 'celular' }, 200);
  const note = stamp(base, { ...base, notes: 'note' }, 300);
  const merged = merge(phone, toWire(note));
  eq([merged.title, merged.notes], ['celular', 'note']);
});

test('Sync: no mesmo campo, a edição mais recente vence', () => {
  const base = stampAll({ id: 'a', title: 'x' }, 100);
  const older = stamp(base, { ...base, title: 'antigo' }, 200);
  const newer = stamp(base, { ...base, title: 'novo' }, 300);
  eq(merge(newer, toWire(older)).title, 'novo');
  eq(merge(older, toWire(newer)).title, 'novo');
});

test('Sync: o aviso de cada aparelho não viaja nem gera envio', () => {
  const base = { ...stampAll({ id: 'a', title: 'x' }, 100), _dirty: false };
  const notified = stamp(base, { ...base, notifiedFor: 't' }, 200);
  eq(notified._dirty, false);
  eq('notifiedFor' in toWire(notified), false);
  eq(merge(notified, toWire(stamp(base, { ...base, title: 'y' }, 300))).notifiedFor, 't');
});

test('Sync: campo apagado em outro aparelho some aqui', () => {
  const base = stampAll({ id: 'a', title: 'x', notes: 'n' }, 100);
  const { notes, ...without } = base;
  const remote = stamp(base, without, 200);
  eq('notes' in merge(base, toWire(remote)), false);
});

test('Sync: detecta mudança depois do envio', () => {
  const record = stampAll({ id: 'a', title: 'x' }, 100);
  eq(changedSince(record, { ...record._t }), false);
  eq(changedSince(stamp(record, { ...record, title: 'y' }, 200), { ...record._t }), true);
});

test('Repetição: contar a partir da conclusão usa o dia em que foi feita', () => {
  const task = make({ when: '2026-10-25', repeat: { freq: 'daily', interval: 3, fromCompletion: true } });
  const next = completeTask(task, TODAY, 'x').task;
  eq(next.when, '2026-11-05');
  eq(next.repeat.anchor, '2026-11-05');
  const monthly = make({ when: '2026-10-10', repeat: { freq: 'monthly', fromCompletion: true } });
  eq(completeTask(monthly, TODAY, 'x').task.when, '2026-12-02');
});

test('Repetição: terminar após N vezes encerra na última', () => {
  let task = make({ when: TODAY, repeat: { freq: 'daily', count: 3 } });
  task = completeTask(task, TODAY, 'x').task;
  eq([task.status, task.repeat.done], ['open', 1]);
  task = skipOccurrence(task, task.when);
  eq([task.status, task.repeat.done], ['open', 2]);
  const last = completeTask(task, task.when, 'x');
  eq(last.task.status, 'ended');
  eq(!!last.log, true);
});

test('Repetição: editar a série mantém a contagem feita', () => {
  const task = completeTask(make({ when: TODAY, repeat: { freq: 'daily', count: 5 } }), TODAY, 'x').task;
  const edited = applyEdit(task, { title: 'Novo', when: task.when, repeat: { freq: 'daily', count: 5 } }, TODAY).task;
  eq(edited.repeat.done, 1);
});

test('Modo B/C: prazo da ocorrência anda junto e pode atrasar', () => {
  const task = make({ when: TODAY, repeat: { freq: 'weekly', weekdays: [1] }, deadline: '2026-11-06', seriesEnd: '2026-12-31' });
  eq([task.deadline, task.seriesEnd], ['2026-11-06', '2026-12-31']);
  const next = completeTask(task, TODAY, 'x').task;
  eq(next.deadline, '2026-11-13');
  eq(isOverdue(task, '2026-11-07'), true);
});

test('Modo A: salvar uma série não apaga o prazo criado em outro modo', () => {
  const task = make({ when: TODAY, repeat: { freq: 'daily' }, deadline: '2026-11-03', seriesEnd: null });
  const edited = applyEdit(task, { title: 'x', when: TODAY, until: '2026-11-30', repeat: { freq: 'daily' } }, TODAY).task;
  eq([edited.deadline, edited.seriesEnd], ['2026-11-03', '2026-11-30']);
});

test('Importante e tags são guardados e limpos', () => {
  const task = make({ important: true, tags: ' #casa, Casa ,  compras,' });
  eq([task.important, task.tags], [true, ['casa', 'compras']]);
  eq(cleanTags(['#a', 'a', 'b']), ['a', 'b']);
  eq(applyEdit(task, { title: 'Outro' }, TODAY).task.tags, ['casa', 'compras']);
});

test('Matriz: urgente quando Quando chegou ou o prazo vence em 2 dias', () => {
  eq(isUrgent({ when: TODAY }, TODAY), true);
  eq(isUrgent({ deadline: '2026-11-04' }, TODAY), true);
  eq(isUrgent({ deadline: '2026-11-05', when: '2026-11-03' }, TODAY), false);
});

const parse = (text, now = '10:00') => parseQuickAdd(text, TODAY, now);

test('Datas digitadas: dia da semana e horário', () => {
  const r = parse('Pagar luz sexta 9h');
  eq([r.title, r.when, r.remindAt], ['Pagar luz', '2026-11-06', '2026-11-06T09:00']);
  eq(parse('Ligar na segunda-feira às 14:30').remindAt, '2026-11-02T14:30');
});

test('Datas digitadas: amanhã, dia do mês e data com barra', () => {
  eq(parse('Comprar pão amanhã').when, '2026-11-03');
  eq(parse('Dia 24 8h psiquiatra').when, '2026-11-24');
  eq(parse('Pagar dia 1').when, '2026-12-01');
  eq(parse('Renovar 10/03').when, '2027-03-10');
  eq(parse('Viagem 31/02').matched, false);
});

test('Datas digitadas: só horário vai para hoje ou amanhã', () => {
  eq(parse('Remédio 22h').remindAt, '2026-11-02T22:00');
  eq(parse('Remédio 8h').remindAt, '2026-11-03T08:00');
  eq(parse('Remédio 8h').when, undefined);
});

test('Datas digitadas: repetição e prazo', () => {
  const r = parse('Lavar roupa toda segunda até 30/11');
  eq([r.title, r.repeat, r.until], ['Lavar roupa', { interval: 1, freq: 'weekly', weekdays: [1] }, '2026-11-30']);
  eq(parse('Tomar água todo dia').repeat.freq, 'daily');
});

test('Datas digitadas: textos comuns ficam intactos', () => {
  ['Comprar 2 kg de arroz', 'Ter que ligar pro dom', 'Ver até onde vai', 'Hojeeee festa'].forEach((text) => {
    const r = parse(text);
    if (r.matched || r.title !== text) throw new Error(`mexeu em "${text}"`);
  });
});


/* ---------- Lote B: vários lembretes, insistência e agenda do push ---------- */

test('Vários lembretes: o primeiro fica em remindAt e os outros em ordem', () => {
  const task = make({ remindAt: `${TODAY}T18:00`, extraReminders: [`${TODAY}T09:00`, `${TODAY}T18:00`, 'lixo', `${TODAY}T12:00`] });
  eq(task.remindAt, `${TODAY}T18:00`);
  eq(task.extraReminders, [`${TODAY}T09:00`, `${TODAY}T12:00`]);
  eq(reminderTimes(task), [`${TODAY}T09:00`, `${TODAY}T12:00`, `${TODAY}T18:00`]);
  const only = make({ remindAt: '', extraReminders: [`${TODAY}T10:00`] });
  eq([only.remindAt, only.extraReminders], [`${TODAY}T10:00`, []]);
});

test('Vários lembretes: cada um dispara, e dispensar vale até a hora dispensada', () => {
  const task = make({ remindAt: `${TODAY}T09:00`, extraReminders: [`${TODAY}T12:00`] });
  eq(activeReminder(task, `${TODAY}T08:59`), null);
  eq(activeReminder(task, `${TODAY}T09:30`), `${TODAY}T09:00`);
  const acked = dismissReminder(task, `${TODAY}T09:30`);
  eq(activeReminder(acked, `${TODAY}T11:00`), null);
  eq(activeReminder(acked, `${TODAY}T12:00`), `${TODAY}T12:00`);
  eq(shownReminder(acked, `${TODAY}T11:00`), `${TODAY}T12:00`);
});

test('Vários lembretes: o adiamento segura o anterior, e o seguinte passa na frente', () => {
  const task = make({ remindAt: `${TODAY}T09:00`, extraReminders: [`${TODAY}T09:05`] });
  const later = snooze(task, new Date(2026, 10, 2, 9, 0), 10);
  eq(activeReminder({ ...later, extraReminders: [] }, `${TODAY}T09:05`), null);
  eq(activeReminder({ ...later, extraReminders: [] }, `${TODAY}T09:10`), `${TODAY}T09:10`);
  eq(activeReminder(later, `${TODAY}T09:05`), `${TODAY}T09:05`);
});

test('Vários lembretes: andam junto com a repetição', () => {
  const task = make({ when: TODAY, repeat: { freq: 'daily' }, remindAt: `${TODAY}T08:00`, extraReminders: [`${TODAY}T20:00`] });
  eq(completeTask(task, TODAY, 'x').task.extraReminders, ['2026-11-03T20:00']);
});

test('Insistir: só com lembrete e conta os passos até o máximo', () => {
  eq(make({ insist: true }).insist, false);
  const task = make({ remindAt: `${TODAY}T09:00`, insist: true });
  eq(task.insist, true);
  eq(insistStep(task, `${TODAY}T09:00`, new Date(2026, 10, 2, 9, 4), 5), 0);
  eq(insistStep(task, `${TODAY}T09:00`, new Date(2026, 10, 2, 9, 11), 5), 2);
  eq(insistStep(task, `${TODAY}T09:00`, new Date(2026, 10, 2, 15, 0), 5), 12);
  eq(insistStep({ ...task, insist: false }, `${TODAY}T09:00`, new Date(2026, 10, 2, 9, 11), 5), 0);
  eq([notifyMark('x', 0), notifyMark('x', 3)], ['x', 'x#3']);
});

test('Agenda do push: lembretes futuros, sem concluídas, com folga de 2 minutos', () => {
  const now = new Date(2026, 10, 2, 10, 0);
  const tasks = [
    { ...make({ remindAt: `${TODAY}T11:00` }), id: 'a' },
    { ...make({ remindAt: `${TODAY}T09:59` }), id: 'b' },
    { ...make({ remindAt: `${TODAY}T09:00` }), id: 'c' },
    { ...make({ remindAt: `${TODAY}T12:00` }), id: 'd', status: 'done' },
  ];
  const items = buildSchedule(tasks, now, {});
  eq(items.map((i) => i.key), [pushKey('b', `${TODAY}T09:59`, 0), pushKey('a', `${TODAY}T11:00`, 0)]);
  eq(items[1].at, new Date(2026, 10, 2, 11, 0).getTime());
  eq([items[1].kind, items[1].body], ['remind', 'Lembrete das 11:00']);
});

test('Agenda do push: adiamento substitui o lembrete adiado', () => {
  const now = new Date(2026, 10, 2, 9, 1);
  const task = snooze({ ...make({ remindAt: `${TODAY}T09:00` }), id: 'a' }, new Date(2026, 10, 2, 9, 0), 10);
  eq(buildSchedule([task], now, {}).map((i) => i.key), [pushKey('a', `${TODAY}T09:10`, 0)]);
});

test('Agenda do push: insistência para em 12 vezes e no próximo lembrete', () => {
  const now = new Date(2026, 10, 2, 8, 0);
  const task = { ...make({ remindAt: `${TODAY}T09:00`, extraReminders: [`${TODAY}T09:20`], insist: true }), id: 'a' };
  const keys = buildSchedule([task], now, { insistMinutes: 5 }).map((i) => i.key);
  eq(keys.slice(0, 5), ['a|2026-11-02T09:00|0', 'a|2026-11-02T09:00|1', 'a|2026-11-02T09:00|2', 'a|2026-11-02T09:00|3', 'a|2026-11-02T09:20|0']);
  eq(keys.filter((k) => k.includes('T09:20|')).length, 13);
  eq(parsePushKey(keys[1]), { taskId: 'a', time: '2026-11-02T09:00', step: 1 });
});

test('Agenda do push: insistência continua um lembrete passado sem resposta', () => {
  const now = new Date(2026, 10, 2, 9, 12);
  const task = { ...make({ remindAt: `${TODAY}T09:00`, insist: true }), id: 'a' };
  // 9:10 ainda está dentro da folga de 2 minutos; 9:05 já passou.
  eq(buildSchedule([task], now, { insistMinutes: 5 })[0].key, 'a|2026-11-02T09:00|2');
  eq(buildSchedule([dismissReminder(task, `${TODAY}T09:12`)], now, { insistMinutes: 5 }).length, 0);
});

test('Agenda do push: resumo diário com as tarefas de cada dia', () => {
  const now = new Date(2026, 10, 2, 7, 0);
  const tasks = [
    { ...base, id: 'a', title: 'Pagar luz', when: TODAY },
    { ...base, id: 'b', title: 'Mercado', when: '2026-11-03', important: true },
  ];
  const digests = buildSchedule(tasks, now, { digest: true, digestTime: '08:00' }).filter((i) => i.kind === 'digest');
  eq(digests.length, 8);
  eq([digests[0].key, digests[0].title, digests[0].body], ['digest|2026-11-02', 'Hoje: 1 tarefa', 'Pagar luz']);
  eq([digests[1].title, digests[1].body], ['Hoje: 2 tarefas', 'Mercado · Pagar luz']);
  eq(buildSchedule(tasks, now, {}).filter((i) => i.kind === 'digest').length, 0);
});

test('Push com o app aberto: não repete o que o app já avisou', () => {
  const task = { ...make({ remindAt: `${TODAY}T09:00` }), id: 'a', notifiedFor: `${TODAY}T09:00#2` };
  eq(alreadyNotified(task, 'a|2026-11-02T09:00|2'), true);
  eq(alreadyNotified(task, 'a|2026-11-02T09:00|3'), false);
  eq(alreadyNotified({ ...task, notifiedFor: null }, 'a|2026-11-02T09:00|0'), false);
  eq(alreadyNotified({ ...task, status: 'done' }, 'a|2026-11-02T09:00|0'), true);
  eq(alreadyNotified(undefined, 'a|2026-11-02T09:00|0'), false);
});

test('Concluir e ir para a próxima: a cada 3 dias conta a partir de hoje, com o mesmo horário', () => {
  const late = make({ when: '2026-10-30', repeat: { freq: 'daily', interval: 3 }, remindAt: '2026-10-30T17:00' });
  const next = completeTask(late, TODAY, 'x').task;
  eq([next.when, next.remindAt], ['2026-11-05', '2026-11-05T17:00']);
  eq(completeTask(next, TODAY, 'x').task.when, '2026-11-08');
});

test('Concluir e ir para a próxima: adiantada não volta para antes da data marcada', () => {
  eq(completeTask(make({ when: '2026-11-03', repeat: { freq: 'daily', interval: 3 } }), TODAY, 'x').task.when, '2026-11-05');
  eq(completeTask(make({ when: '2026-11-10', repeat: { freq: 'daily', interval: 3 } }), TODAY, 'x').task.when, '2026-11-13');
});

test('Concluir e ir para a próxima: semanal vai para o próximo dia da semana', () => {
  const saturday = make({ when: '2026-10-31', repeat: { freq: 'weekly', weekdays: [6] }, remindAt: '2026-10-31T06:30' });
  eq([completeTask(saturday, TODAY, 'x').task.when, completeTask(saturday, TODAY, 'x').task.remindAt], ['2026-11-07', '2026-11-07T06:30']);
});

test('Datas digitadas: "todo sábado 6h30" começa no próximo sábado', () => {
  eq([parse('Faxina todo sábado 6h30').when, parse('Faxina todo sábado 6h30').remindAt], ['2026-11-07', '2026-11-07T06:30']);
  eq(parse('Reunião toda segunda 9h').remindAt, '2026-11-09T09:00');
  eq(parse('Reunião toda segunda 11h').remindAt, '2026-11-02T11:00');
});

test('Pular ocorrência segue o calendário da série', () => {
  const task = make({ when: '2026-11-02', repeat: { freq: 'daily', interval: 3 } });
  eq(skipOccurrence(task, TODAY).when, '2026-11-05');
  eq(skipOccurrence(make({ when: '2026-10-30', repeat: { freq: 'daily', interval: 3 } }), TODAY).when, '2026-11-05');
});

const failed = results.filter((r) => !r.ok);
document.title = failed.length ? `FALHOU ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`;
const pre = document.getElementById('results');
pre.textContent = [
  document.title,
  ...results.map((r) => `${r.ok ? 'ok   ' : 'FALHA'} ${r.name}${r.message ? ` -> ${r.message}` : ''}`),
].join('\n');
