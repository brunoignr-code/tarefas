// Aplica o modo (claro ou escuro), a cor de destaque e a letra antes da primeira pintura, sem lampejo.
// Fica num arquivo (e não dentro do index.html) por causa da política de segurança (CSP), que não deixa rodar scripts embutidos.
// Na demonstração (?demo=1, v31) o tema salvo é outro, para não misturar com as preferências do app de verdade.
try {
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const saved = JSON.parse(localStorage.getItem(demo ? 'demo:tarefas-tema' : 'tarefas-tema') || 'null');
  const root = document.documentElement;
  if (demo) root.classList.add('demo');
  if (saved) {
    const mode = saved.mode === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : saved.mode || (saved.theme === 'diamante' ? 'dark' : 'light');
    root.dataset.mode = mode;
    Object.entries(saved.vars || {}).forEach(([name, value]) => root.style.setProperty(name, value));
    if (saved.fs) root.style.fontSize = `${saved.fs}px`;
  } else if (demo && matchMedia('(prefers-color-scheme: dark)').matches) {
    // Demonstração aberta pela primeira vez: os dados de exemplo seguem o modo do aparelho.
    root.dataset.mode = 'dark';
  }
} catch { /* O tema salvo é só uma conveniência. */ }
