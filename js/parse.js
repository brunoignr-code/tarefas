// Entende datas, horários e repetições escritas no campo de adicionar ("pagar luz sexta 9h").
import { addDays, weekday } from './rules.js';

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAY_NAMES = [
  ['domingo'], ['segunda'], ['terça', 'terca'], ['quarta'], ['quinta'], ['sexta'], ['sábado', 'sabado'],
];
const weekdayPattern = WEEKDAY_NAMES.flat().join('|');
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';

const REPEATS = [
  [`(?:quinzenal(?:mente)?|a cada (?:duas|2) semanas|de duas em duas semanas)`, () => ({ freq: 'weekly', interval: 2 })],
  [`(?:todos os dias|todo dia|diariamente)`, () => ({ freq: 'daily' })],
  [`(?:toda semana|semanalmente)`, () => ({ freq: 'weekly' })],
  [`(?:todo m[eê]s|mensalmente)`, () => ({ freq: 'monthly' })],
  [`(?:todo ano|anualmente)`, () => ({ freq: 'yearly' })],
  [`(?:toda|todo)s?\\s+(${weekdayPattern})(?:-feira)?`, (m) => ({ freq: 'weekly', weekdays: [dayIndex(m[1])] })],
];

function dayIndex(word) {
  const clean = word.toLocaleLowerCase('pt-BR');
  return WEEKDAY_NAMES.findIndex((names) => names.includes(clean));
}

const validDate = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

function dateFromWords(match, today) {
  const word = match.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  if (word === 'hoje') return today;
  if (/^amanh[ãa]$/.test(word)) return addDays(today, 1);
  if (/^depois de amanh[ãa]$/.test(word)) return addDays(today, 2);
  const name = word.replace(/-feira$/, '');
  const index = dayIndex(name);
  if (index >= 0) return addDays(today, (index - weekday(today) + 7) % 7);
  return null;
}

function dateFromNumbers(day, month, year, today) {
  const [ty, tm, td] = today.split('-').map(Number);
  if (year) {
    const y = year < 100 ? 2000 + year : year;
    return validDate(y, month, day) ? `${y}-${pad(month)}-${pad(day)}` : null;
  }
  if (month) {
    // Sem ano: a próxima vez que esse dia acontece.
    for (const y of [ty, ty + 1]) {
      const date = `${y}-${pad(month)}-${pad(day)}`;
      if (validDate(y, month, day) && date >= today) return date;
    }
    return null;
  }
  // Só o dia: neste mês ou no próximo em que ele existir.
  for (let i = 0; i < 13; i += 1) {
    const index = ty * 12 + tm - 1 + i;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const date = `${y}-${pad(m)}-${pad(day)}`;
    if (validDate(y, m, day) && (i > 0 || day >= td)) return date;
  }
  return null;
}

/**
 * Devolve o título limpo e o que foi entendido. Só reconhece palavras inteiras,
 * para não mexer em textos como "2 kg" ou "ter que ligar".
 */
export function parseQuickAdd(text, today, nowTime = '00:00') {
  let rest = ` ${text} `;
  const found = {};
  const take = (regex, handler) => {
    rest = rest.replace(regex, (...args) => {
      const result = handler(args);
      return result === false ? args[0] : ' ';
    });
  };

  for (const [pattern, build] of REPEATS) {
    if (found.repeat) break;
    take(new RegExp(`${B}${pattern}${E}`, 'iu'), (m) => {
      found.repeat = { interval: 1, ...build(m) };
      return true;
    });
  }

  const prefix = '(?:(?:na|no|nesta|neste|em|para|pra|pro)\\s+(?:pr[oó]xim[ao]\\s+)?)?';
  const dateWords = `(?:depois de amanh[ãa]|amanh[ãa]|hoje|(?:${weekdayPattern})(?:-feira)?)`;
  const dateNumbers = '(?:(?:dia\\s+)?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?|dia\\s+(\\d{1,2}))';
  const dateRegex = new RegExp(`${B}(at[ée]\\s+)?${prefix}(?:(${dateWords})|${dateNumbers})${E}`, 'iu');
  for (let i = 0; i < 2; i += 1) {
    take(dateRegex, (m) => {
      const [, until, words, d1, m1, y1, d2] = m;
      const date = words
        ? dateFromWords(words, today)
        : dateFromNumbers(Number(d1 || d2), m1 ? Number(m1) : 0, y1 ? Number(y1) : 0, today);
      if (!date) return false;
      const key = until ? 'until' : 'when';
      if (found[key]) return false;
      found[key] = date;
      return true;
    });
  }

  take(new RegExp(`${B}(?:[àa]s\\s+)?(\\d{1,2})(?:h(\\d{2})?|:(\\d{2}))${E}`, 'iu'), (m) => {
    const hour = Number(m[1]);
    const minute = Number(m[2] || m[3] || 0);
    if (hour > 23 || minute > 59) return false;
    found.time = `${pad(hour)}:${pad(minute)}`;
    return true;
  });

  // "todo sábado": a primeira vez é o próximo sábado, não hoje.
  if (found.repeat?.weekdays && !found.when) {
    const target = found.repeat.weekdays[0];
    let day = addDays(today, (target - weekday(today) + 7) % 7);
    if (day === today && found.time && found.time <= nowTime) day = addDays(today, 7);
    found.when = day;
  }

  if (found.time) {
    let day = found.when || today;
    if (!found.when && found.time <= nowTime) day = addDays(today, 1);
    found.remindAt = `${day}T${found.time}`;
  }
  delete found.time;

  const title = rest.replace(/\s+/g, ' ').trim();
  const matched = Object.keys(found).length > 0;
  return { title: title || text.trim(), matched, ...found };
}
