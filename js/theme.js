// Temas do app e cálculos de cor do marca-texto.

export const THEMES = [
  { id: 'diamante', name: 'Diamante', chrome: '#0E1218' },
  { id: 'folha', name: 'Folha', chrome: '#F3F8F3' },
  { id: 'marca-texto', name: 'Marca-texto', chrome: '#FFFFFF' },
];

export const DEFAULT_HIGHLIGHT = '#FFE44D';
export const HIGHLIGHTS = [
  { name: 'Amarelo', color: DEFAULT_HIGHLIGHT },
  { name: 'Limão', color: '#B8F34A' },
  { name: 'Menta', color: '#7DF0C0' },
  { name: 'Céu', color: '#7FE3FF' },
  { name: 'Lilás', color: '#CDB8FF' },
  { name: 'Rosa', color: '#FF9FD0' },
  { name: 'Pêssego', color: '#FFB38A' },
  { name: 'Coral', color: '#FF8A7A' },
];

const INK = '#16181A';
const WHITE = '#FFFFFF';
const BLACK = '#000000';

export const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(value || '');

function luminance(hex) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Cor de texto mais legível sobre o marca-texto escolhido. */
export function textOn(color) {
  if (contrast(color, INK) >= 4.5) return INK;
  // Em cores médias, só o preto puro ou o branco garantem 4,5:1.
  return contrast(color, WHITE) >= contrast(color, BLACK) ? WHITE : BLACK;
}

/** Uma cor quase branca não aparece como destaque no papel branco. */
export const isTooLight = (color) => contrast(color, WHITE) < 1.15;

/** Sistema escolhe entre os dois temas aprovados; valores antigos são convertidos. */
export function normalizeTheme(theme) {
  const legacy = { auto: 'system', dark: 'diamante', light: 'folha' };
  const value = legacy[theme] || theme;
  return value === 'system' || THEMES.some((item) => item.id === value) ? value : 'system';
}

export const resolveTheme = (theme, prefersDark) =>
  (theme === 'system' ? (prefersDark ? 'diamante' : 'folha') : theme);
