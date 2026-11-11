// Tema único Folha (v14): modo claro, escuro ou automático e oito cores de destaque.

export const DEFAULT_MODE = 'light';
export const MODES = [['light', 'Claro'], ['dark', 'Escuro'], ['auto', 'Automático']];

// Cor de destaque: `light` no modo claro (texto branco por cima) e `dark` no escuro (texto escuro por cima).
export const DEFAULT_ACCENT = 'folha';
export const ACCENTS = [
  { id: 'folha', name: 'Folha', light: '#0F6B4C', dark: '#7FD3A2', onDark: '#0B2A1D' },
  { id: 'azul', name: 'Azul', light: '#2B5F8E', dark: '#9CC3EC', onDark: '#0D2238' },
  { id: 'roxo', name: 'Roxo', light: '#5E44A8', dark: '#C4B2F5', onDark: '#221447' },
  { id: 'rosa', name: 'Rosa', light: '#A3325F', dark: '#F2A7C6', onDark: '#3D0F22' },
  { id: 'terracota', name: 'Terracota', light: '#B23F26', dark: '#F4AE99', onDark: '#3D140A' },
  { id: 'ambar', name: 'Âmbar', light: '#8A5A00', dark: '#E8C26A', onDark: '#2E1F00' },
  { id: 'petroleo', name: 'Petróleo', light: '#0E6E78', dark: '#7FD0D8', onDark: '#062B30' },
  { id: 'grafite', name: 'Grafite', light: '#4A5560', dark: '#BAC4CE', onDark: '#1C232A' },
];

// Cores de fundo da barra do navegador e da capa em cada modo.
export const CHROME = { light: '#F3F8F3', dark: '#0F1714' };
export const SURFACE = { light: '#FFFEFA', dark: '#17221D' };

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

/**
 * Modo salvo, convertendo os temas que saíram em 10/11 (v14):
 * Diamante (e o antigo "dark") vira a Folha escura; Marca-texto, Barquinho e o resto, a Folha clara.
 */
export function normalizeMode(mode, legacyTheme) {
  if (MODES.some(([id]) => id === mode)) return mode;
  return ['diamante', 'dark'].includes(legacyTheme) ? 'dark' : DEFAULT_MODE;
}

export const resolveMode = (mode, prefersDark) => {
  const value = normalizeMode(mode);
  if (value === 'auto') return prefersDark ? 'dark' : 'light';
  return value;
};

export const normalizeAccent = (id) => (ACCENTS.some((item) => item.id === id) ? id : DEFAULT_ACCENT);
export const findAccent = (id) => ACCENTS.find((item) => item.id === normalizeAccent(id));

/** Variáveis de cor da cor de destaque. A Folha usa as do styles.css (lista vazia). */
export function accentVars(id, mode) {
  const accent = findAccent(id);
  if (accent.id === DEFAULT_ACCENT) return {};
  const dark = mode === 'dark';
  const primary = dark ? accent.dark : accent.light;
  const onPrimary = dark ? accent.onDark : '#FFFFFF';
  const surface = SURFACE[dark ? 'dark' : 'light'];
  return {
    '--primary': primary,
    '--on-primary': onPrimary,
    '--accent': primary,
    '--mark-line': primary,
    '--mark-fill': primary,
    '--on-mark': onPrimary,
    '--soft': `color-mix(in srgb, ${primary} ${dark ? 16 : 11}%, ${surface})`,
    '--banner': `color-mix(in srgb, ${primary} ${dark ? 20 : 16}%, ${surface})`,
    // Desde a v22 o aviso de rodapé é escuro nos dois modos: a ação usa sempre o tom claro.
    '--toast-act': accent.dark,
  };
}
