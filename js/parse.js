// Entende datas, horários e repetições escritas no campo de adicionar ("pagar luz sexta 9h").
import { addDays, weekday, firstOnWeekdays } from './rules.js';

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAY_NAMES = [
  ['domingo'], ['segunda'], ['terça', 'terca'], ['quarta'], ['quinta'], ['sexta'], ['sábado', 'sabado'],
];
const weekdayPattern = WEEKDAY_NAMES.flat().join('|');
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';

// Dias da semana numa repetição: "segunda", "terças-feiras", "sábados".
const dayWord = `(?:${weekdayPattern})s?(?:-feiras?)?`;
const dayList = `${dayWord}(?:\\s*,\\s*${dayWord})*(?:\\s*,?\\s+e\\s+${dayWord})?`;
const pluralDay = '(?:segundas|ter[çc]as|quartas|quintas|sextas|s[áa]bados|domingos)(?:-feiras)?';
const pluralList = `${pluralDay}(?:\\s*,\\s*${pluralDay})*(?:\\s*,?\\s+e\\s+${pluralDay})?`;
const WEEKDAY_SETS = [
  // "de segunda a sexta", "de terça a quinta-feira": todos os dias do intervalo.
  [`de\\s+(${dayWord})\\s+a\\s+(${dayWord})`, (m) => dayRange(dayIndex(m[1]), dayIndex(m[2]))],
  // "todo dia útil", "dias úteis" (mas não "5 dias úteis").
  ['(?:tod[oa]s?\\s+(?:os\\s+)?(?:dia\\s+[úu]til|dias\\s+[úu]teis)|(?<!\\d\\s*)(?:(?:em|nos)\\s+)?dias\\s+[úu]teis)', () => [1, 2, 3, 4, 5]],
  ['(?:tod[oa]s?\\s+(?:os\\s+)?(?:fim|fins)\\s+de\\s+semana|(?:nos|aos)\\s+fins\\s+de\\s+semana)', () => [0, 6]],
  // "toda segunda e quarta", "todas as terças e quintas".
  [`tod[oa]s?\\s+(?:(?:as|os)\\s+)?(${dayList})`, (m) => daysIn(m[1])],
  // "segundas, quartas e sextas", "às terças".
  [`(?:(?:[àa]s|aos|nas|nos)\\s+)?(${pluralList})`, (m) => daysIn(m[1])],
];

const REPEATS = [
  [`(?:quinzenal(?:mente)?|a cada (?:duas|2) semanas|de duas em duas semanas)`, () => ({ freq: 'weekly', interval: 2 })],
  ...WEEKDAY_SETS.map(([pattern, days]) => [pattern, (m) => ({ freq: 'weekly', weekdays: days(m) })]),
  [`(?:todos os dias|todo dia|diariamente)`, () => ({ freq: 'daily' })],
  [`(?:toda semana|semanalmente)`, () => ({ freq: 'weekly' })],
  [`(?:todo m[eê]s|mensalmente)`, () => ({ freq: 'monthly' })],
  [`(?:todo ano|anualmente)`, () => ({ freq: 'yearly' })],
];

/** Os dias citados num trecho, em ordem e sem repetir. */
function daysIn(text) {
  const found = text.toLocaleLowerCase('pt-BR').match(new RegExp(dayWord, 'gu')) || [];
  return [...new Set(found.map(dayIndex))].filter((d) => d >= 0).sort((a, b) => a - b);
}

function dayRange(from, to) {
  if (from < 0 || to < 0) return [];
  const days = [];
  for (let d = from; ; d = (d + 1) % 7) {
    days.push(d);
    if (d === to || days.length === 7) break;
  }
  return days.sort((a, b) => a - b);
}

function dayIndex(word) {
  // "terças-feiras" e "sábados" viram "terça" e "sábado".
  const clean = word.toLocaleLowerCase('pt-BR').replace(/-feiras?$/, '').replace(/s$/, '');
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
      const repeat = { interval: 1, ...build(m) };
      if (repeat.weekdays && !repeat.weekdays.length) return false;
      found.repeat = repeat;
      return true;
    });
  }
  // "quinzenal às segundas e quartas", "toda semana de segunda a sexta": os dias entram na mesma repetição.
  if (found.repeat?.freq === 'weekly' && !found.repeat.weekdays) {
    for (const [pattern, days] of WEEKDAY_SETS) {
      if (found.repeat.weekdays) break;
      take(new RegExp(`${B}${pattern}${E}`, 'iu'), (m) => {
        const list = days(m);
        if (!list.length) return false;
        found.repeat.weekdays = list;
        return true;
      });
    }
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

  // "todo sábado", "toda segunda e quarta": a primeira vez é o próximo desses dias
  // (hoje, se hoje for um deles e a hora ainda não passou).
  if (found.repeat?.weekdays && !found.when) {
    let day = firstOnWeekdays(found.repeat.weekdays, today);
    if (day === today && found.time && found.time <= nowTime) day = firstOnWeekdays(found.repeat.weekdays, addDays(today, 1));
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
