// Modo demonstração (v31): aberto por ?demo=1, com dados de exemplo num banco próprio deste navegador.
// As tarefas de verdade (banco "tarefas") nunca são abertas; nada vai para o servidor.
import { addDays, applyEdit, completeTask, localDate, localDateTime } from './rules.js';

export const DEMO = new URLSearchParams(location.search).get('demo') === '1';
export const DEMO_DB = 'tarefas-demo';
// Os dados de exemplo são remontados quando a demonstração abre num dia diferente (datas sempre atuais).
export const DEMO_SEED_VERSION = 1;

/**
 * Chave do localStorage: na demonstração ganha o prefixo "demo:", para nunca ler nem mudar
 * as preferências do app de verdade, que divide a mesma origem.
 */
export const localKey = (name) => (DEMO ? `demo:${name}` : name);

/** Endereço do app nesta mesma página: na demonstração, mantém o ?demo=1 ao trocar o endereço. */
export const appPath = () => `${location.pathname}${DEMO ? '?demo=1' : ''}`;

const at = (date, time) => `${date}T${time}`;
const iso = (dateTime) => {
  const [date, time] = dateTime.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).toISOString();
};
const weekdayOf = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
/** Último dia antes de `date` (sem contar ele) que cai no dia da semana pedido. */
const lastWeekday = (date, day) => {
  for (let i = 1; i <= 7; i += 1) {
    const candidate = addDays(date, -i);
    if (weekdayOf(candidate) === day) return candidate;
  }
  return addDays(date, -7);
};

/** Dados de exemplo, montados na hora com datas relativas a hoje. Nada aqui é de alguém de verdade. */
export function demoData(nowDate = new Date()) {
  const T = localDate(nowDate);
  const now = localDateTime(nowDate);
  const minutesFromNow = (m) => localDateTime(new Date(nowDate.getTime() + m * 60000));
  // Hora de hoje já passada (para o que foi feito hoje); de madrugada, fica logo depois da meia-noite.
  const earlierToday = (m) => {
    const time = minutesFromNow(-m);
    return time.slice(0, 10) === T ? time : at(T, '00:01');
  };
  // Mais tarde hoje, se ainda der; senão, amanhã de manhã.
  const laterToday = (m, fallback = '09:00') => {
    const time = minutesFromNow(m);
    return time.slice(0, 10) === T && time.slice(11) <= '22:30' ? `${time.slice(0, 15)}0` : at(addDays(T, 1), fallback);
  };

  const lists = [
    { id: 'inbox', name: 'Entrada', group: '', order: 0 },
    { id: 'demo-casa', name: 'Casa', emoji: '🏠', color: '#2E9E6B', group: 'Pessoal', order: 1 },
    { id: 'demo-saude', name: 'Saúde', emoji: '❤️', color: '#C2417A', group: 'Pessoal', order: 2 },
    { id: 'demo-financas', name: 'Finanças', emoji: '💰', color: '#D9A02B', group: 'Pessoal', order: 3 },
    { id: 'demo-trabalho', name: 'Trabalho', emoji: '💼', color: '#4C80AE', group: '', order: 4 },
  ];

  const tasks = [];
  const log = [];
  let order = 0;
  let serial = 0;
  const createdAt = iso(at(addDays(T, -6), '10:00'));

  /** Cria a tarefa com as mesmas regras do app (applyEdit), como se tivesse sido anotada. */
  const add = (fields, extra = {}) => {
    let { task } = applyEdit(null, fields, T);
    // Repetição sem Quando: a regra escolhe o primeiro dia; o lembrete vai para esse dia.
    if (fields.remindTime && task.when) {
      ({ task } = applyEdit(null, { ...fields, when: task.when, remindAt: at(task.when, fields.remindTime) }, T));
    }
    serial += 1;
    order += 1;
    const full = { ...task, id: `demo-${serial}`, status: 'open', order, createdAt, ...extra };
    delete full.remindTime;
    tasks.push(full);
    return full;
  };
  /** Concluída num horário: tarefa simples fica feita; repetição registra no histórico e anda. */
  const doneAt = (task, dateTime) => {
    const index = tasks.indexOf(task);
    const result = completeTask(task, T, iso(dateTime));
    tasks[index] = result.task;
    if (result.log) {
      serial += 1;
      log.push({ ...result.log, id: `demo-${serial}` });
    }
  };
  const history = (task, occurrence, time) => {
    serial += 1;
    log.push({ taskId: task.id, title: task.title, occurrence, completedAt: iso(at(occurrence, time)), id: `demo-${serial}` });
  };

  // Hoje
  add({ title: 'Enviar o relatório da semana', listId: 'demo-trabalho', when: T, remindAt: minutesFromNow(3), important: true, tags: ['relatório'] },
    { notes: 'Lembrete para daqui a 3 minutos: deixe o app aberto para ver o aviso chegar.' });
  add({ title: 'Marcar consulta no dentista', listId: 'demo-saude', when: laterToday(120).slice(0, 10), remindAt: laterToday(120), tags: ['consulta'] });
  add({
    title: 'Comprar pão e frutas', listId: 'demo-casa', when: T, tags: ['mercado'],
    steps: [{ title: 'Pão integral', done: true }, { title: 'Bananas', done: false }, { title: 'Maçãs', done: false }],
  });
  add({ title: 'Regar as plantas', listId: 'demo-casa', when: T, repeat: { freq: 'daily', interval: 2 } });

  // Atrasadas e paradas
  add({ title: 'Revisar a apresentação do projeto', listId: 'demo-trabalho', when: addDays(T, -3), until: addDays(T, -1), important: true },
    { notes: 'O prazo era ontem: por isso aparece em vermelho no topo de Hoje.' });
  add({ title: 'Trocar a lâmpada da cozinha', listId: 'demo-casa', when: addDays(T, -2) });
  add({ title: 'Pagar a fatura do cartão', listId: 'demo-financas', when: addDays(T, -1), tags: ['contas'] });

  // Repetições com lembrete (as de hoje que já passaram ficam como feitas, no histórico)
  const academia = add({
    title: 'Academia', listId: 'demo-saude', repeat: { freq: 'weekly', interval: 1, weekdays: [1, 3] }, remindTime: '07:00', tags: ['exercício'],
  });
  const emails = add({
    title: 'Responder os e-mails pendentes', listId: 'demo-trabalho', repeat: { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, remindTime: '08:30',
  });
  const vitamina = add({ title: 'Tomar a vitamina', listId: 'demo-saude', repeat: { freq: 'daily', interval: 1 }, remindTime: '08:00' });
  add({
    title: 'Faxina geral', listId: 'demo-casa', repeat: { freq: 'weekly', interval: 1, weekdays: [6] }, remindTime: '09:00',
    steps: [{ title: 'Banheiro', done: false }, { title: 'Cozinha', done: false }, { title: 'Quartos', done: false }],
  });
  add({ title: 'Pagar o condomínio', listId: 'demo-financas', when: addDays(T, 3), until: addDays(T, 3), remindAt: at(addDays(T, 3), '09:00'), important: true, tags: ['contas'] });
  add({ title: 'Revisar os gastos do mês', listId: 'demo-financas', when: addDays(T, 6), repeat: { freq: 'monthly', interval: 1 }, tags: ['planejamento'] });

  // Próximos dias
  add({ title: 'Reunião de planejamento', listId: 'demo-trabalho', when: addDays(T, 1), remindAt: at(addDays(T, 1), '10:00'), tags: ['reunião'] },
    { notes: 'Levar os números do trimestre e a lista de prioridades.' });
  add({ title: 'Caminhada no parque', listId: 'demo-saude', when: addDays(T, 2), remindAt: at(addDays(T, 2), '07:30') });
  add({
    title: 'Organizar os arquivos do projeto', listId: 'demo-trabalho', when: addDays(T, 5),
    steps: [{ title: 'Separar por ano', done: false }, { title: 'Apagar duplicados', done: false }, { title: 'Fazer uma cópia de segurança', done: false }],
  });
  add({ title: 'Levar o carro para a revisão', listId: 'demo-casa', when: addDays(T, 9), remindAt: at(addDays(T, 9), '08:00') });

  // Sem data (Entrada)
  add({ title: 'Ver ideias de presente de aniversário', listId: 'inbox' });
  add({ title: 'Ler o livro do clube de leitura', listId: 'inbox', tags: ['leitura'] });

  // Feitas hoje e nos dias anteriores. Nenhum lembrete de exemplo começa vencido: o que já passou
  // hoje (academia às 7h, vitamina às 8h...) fica como feito uns minutos depois, no histórico.
  tasks.slice().forEach((current) => {
    if (current.remindAt && current.remindAt <= now) {
      const minutesAgo = Math.round((nowDate - new Date(iso(current.remindAt))) / 60000);
      doneAt(current, earlierToday(Math.max(1, minutesAgo - 10)));
    }
  });
  doneAt(add({ title: 'Lavar a louça', listId: 'demo-casa', when: T }), earlierToday(50));
  doneAt(add({ title: 'Atualizar a planilha de horas', listId: 'demo-trabalho', when: addDays(T, -1) }), at(addDays(T, -1), '17:40'));
  doneAt(add({ title: 'Separar roupas para doação', listId: 'demo-casa', when: addDays(T, -2) }), at(addDays(T, -2), '19:15'));
  history(academia, lastWeekday(T, 3), '07:20');
  history(academia, lastWeekday(T, 1), '07:10');
  history(vitamina, addDays(T, -1), '08:05');
  history(emails, addDays(T, -1), '08:45');

  const settings = { id: 'settings', mode: 'auto', accent: 'folha' };
  const meta = [settings, { id: 'demo', seededOn: T, version: DEMO_SEED_VERSION }];
  return { lists, tasks, log, meta };
}
