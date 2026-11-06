// Agenda dos avisos enviados pelo servidor com o app fechado. Sem rede nem banco, para poder testar.
import {
  INSIST_MAX, activeReminder, addDays, addMinutes, localDate, localDateTime, parseLocal, reminderTimes, todayTasks,
} from './rules.js';

export const DEFAULT_PUSH_SETTINGS = { digest: false, digestTime: '08:00', insistMinutes: 5 };
const HORIZON_DAYS = 14;
const DIGEST_DAYS = 7;
const MAX_ITEMS = 250;
// Avisos de até 2 minutos atrás ainda entram: o servidor pode não ter enviado.
const GRACE_MS = 2 * 60000;

export function normalizePushSettings(input) {
  const settings = { ...DEFAULT_PUSH_SETTINGS, ...(input || {}) };
  return {
    digest: !!settings.digest,
    digestTime: /^\d{2}:\d{2}$/.test(settings.digestTime) ? settings.digestTime : DEFAULT_PUSH_SETTINGS.digestTime,
    insistMinutes: [5, 10, 15, 30].includes(Number(settings.insistMinutes)) ? Number(settings.insistMinutes) : 5,
  };
}

/** Chave única do aviso: tarefa, horário do lembrete e número da insistência. */
export const pushKey = (taskId, time, step) => `${taskId}|${time}|${step}`;

export function parsePushKey(key) {
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
export function buildSchedule(tasks, nowDate, rawSettings) {
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
export function alreadyNotified(task, key) {
  if (!task) return false;
  const { time, step } = parsePushKey(key);
  if (task.status !== 'open' || task.deletedAt) return true;
  if (task.ackedAt && task.ackedAt >= time) return true;
  const mark = task.notifiedFor || '';
  const [markTime, markStep] = mark.split('#');
  return markTime === time && (Number(markStep) || 0) >= step;
}
