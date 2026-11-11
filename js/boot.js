// Aplica o modo (claro ou escuro), a cor de destaque e a letra antes da primeira pintura, sem lampejo.
// Fica num arquivo (e não dentro do index.html) por causa da política de segurança (CSP), que não deixa rodar scripts embutidos.
try {
  const saved = JSON.parse(localStorage.getItem('tarefas-tema') || 'null');
  const root = document.documentElement;
  if (saved) {
    const mode = saved.mode === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : saved.mode || (saved.theme === 'diamante' ? 'dark' : 'light');
    root.dataset.mode = mode;
    Object.entries(saved.vars || {}).forEach(([name, value]) => root.style.setProperty(name, value));
    if (saved.fs) root.style.fontSize = `${saved.fs}px`;
  }
} catch { /* O tema salvo é só uma conveniência. */ }
