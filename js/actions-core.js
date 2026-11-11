// Ações sobre uma tarefa que valem igual no app e no service worker (botões da notificação).
// Sem tela nem banco: recebem a tarefa e devolvem a tarefa nova.
import {
  activeReminder, addDays, applyEdit, completeTask, localDate, localDateTime, snooze, snoozeTo,
} from './rules.js';

export const SNOOZE_MINUTES = 10;

/** Os campos atuais da tarefa no formato de applyEdit, para mudar só um deles. */
export const editFields = (task, changes = {}) => ({
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
export function dateChanges(task, date) {
  const changes = { when: date };
  if (date && task.remindAt && task.when && task.remindAt.slice(0, 10) === task.when) changes.remindAt = `${date}T${task.remindAt.slice(11)}`;
  return changes;
}

/** O prazo (Até) não deixa Quando passar dele. */
export const blockedByDeadline = (task, date) => !!(date && task.deadline && date > task.deadline);

/**
 * Botões da notificação: 'done' (concluir), 'snooze' (adiar alguns minutos) e
 * 'tomorrow' (vai para amanhã e o lembrete volta amanhã no mesmo horário).
 * Devolve { task, log } ou { error }.
 */
export function notificationAction(task, action, nowDate = new Date()) {
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
