import {
  addDays, applyEdit, completeTask, daysWaiting, dismissReminder, dueReminders, firstOccurrence,
  isOverdue, nextOccurrence, skipOccurrence, snooze, todayTasks, upcomingTasks,
} from '../js/rules.js';
import {
  DEFAULT_HIGHLIGHT, HIGHLIGHTS, contrast, isHexColor, isTooLight, normalizeTheme, resolveTheme, textOn,
} from '../js/theme.js';
import { changedSince, merge, stamp, stampAll, toWire } from '../js/sync-core.js';

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

test('Tema: Sistema alterna entre Diamante e Folha', () => {
  eq(resolveTheme('system', true), 'diamante');
  eq(resolveTheme('system', false), 'folha');
  eq(resolveTheme('marca-texto', true), 'marca-texto');
});

test('Tema: valores antigos ou inválidos são convertidos', () => {
  eq(normalizeTheme('auto'), 'system');
  eq(normalizeTheme('dark'), 'diamante');
  eq(normalizeTheme('light'), 'folha');
  eq(normalizeTheme('qualquer'), 'system');
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

const failed = results.filter((r) => !r.ok);
document.title = failed.length ? `FALHOU ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`;
const pre = document.getElementById('results');
pre.textContent = [
  document.title,
  ...results.map((r) => `${r.ok ? 'ok   ' : 'FALHA'} ${r.name}${r.message ? ` -> ${r.message}` : ''}`),
].join('\n');
