// Ações sobre uma tarefa que valem igual no app e no service worker (botões da notificação).
// Sem tela nem banco: recebem a tarefa e devolvem a tarefa nova.
import {
  activeReminder, addDays, applyEdit, completeTask, diffDays, localDate, localDateTime, snooze, snoozeTo,
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

/**
 * v38: mudar a data leva o lembrete principal para o dia escolhido, no mesmo horário; os extras
 * andam junto, à mesma distância do principal. Pedido do usuário: "o lembrete vai sempre para o
 * novo dia da tarefa". Assim uma tarefa com o lembrete preso num dia antigo se acerta na próxima
 * mudança. (A v37 mantinha a distância até Quando, e um lembrete já desalinhado continuava
 * desalinhado; antes dela, só ia junto o lembrete do mesmo dia de Quando.)
 * Tirar a data não mexe nos lembretes.
 */
export function reminderShift(task, date) {
  if (!date || !task.remindAt || task.remindAt.slice(0, 10) === date) return {};
  const days = diffDays(date, task.remindAt.slice(0, 10));
  const shift = (time) => `${addDays(time.slice(0, 10), days)}${time.slice(10)}`;
  return { remindAt: shift(task.remindAt), extraReminders: (task.extraReminders || []).map(shift) };
}

/** Mudar a data leva junto os lembretes (veja reminderShift). */
export function dateChanges(task, date) {
  // Numa tarefa que se repete, adiar ou mudar o dia pelo menu, pelo deslizar ou pela
  // notificação vale só para esta ocorrência: a série continua no calendário de antes.
  const changes = task.repeat ? { when: date, occurrenceOnly: true } : { when: date };
  return { ...changes, ...reminderShift(task, date) };
}

/** O prazo (Até) não deixa Quando passar dele. */
export const blockedByDeadline = (task, date) => !!(date && task.deadline && date > task.deadline);

/**
 * v35: a notificação ainda vale? Depois de resolvida em outro aparelho, uma tarefa que se repete
 * já está na próxima ocorrência (todos os lembretes no futuro): o Concluir de uma notificação velha
 * concluía a próxima, e o Amanhã a empurrava mais um dia. Sem nenhum lembrete (nem adiamento) que
 * já passou, a notificação é de antes: os botões não fazem nada. Concluir uma tarefa sem repetição
 * continua valendo (é o que a pessoa quer, e não dá para concluir duas vezes).
 */
export function staleReminder(task, action, nowDate = new Date()) {
  if (!task || task.status !== 'open' || task.deletedAt) return true;
  if (action === 'done' && !task.repeat) return false;
  const now = localDateTime(nowDate);
  return ![task.remindAt, ...(task.extraReminders || []), task.snoozedUntil].some((time) => time && time <= now);
}

/**
 * Botões da notificação: 'done' (concluir), 'snooze' (adiar alguns minutos) e
 * 'tomorrow' (vai para amanhã e o lembrete volta amanhã no mesmo horário).
 * Devolve { task, log } ou { error } (com `resolved` quando a notificação era de antes).
 */
export function notificationAction(task, action, nowDate = new Date()) {
  if (!task || task.status !== 'open' || task.deletedAt) return { error: 'A tarefa não está mais aberta.', resolved: true };
  if (staleReminder(task, action, nowDate)) return { error: 'Este lembrete já foi resolvido.', resolved: true };
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
