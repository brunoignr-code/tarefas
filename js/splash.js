// Capa de abertura: a mesma folha nos dois modos; no escuro, muda só o fundo. Some depois de 1,1 s.
(() => {
  const splash = document.getElementById('splash');
  if (!splash) return;
  if (document.documentElement.dataset.mode === 'dark') splash.classList.add('splash-escuro');
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 300);
  }, 1100);
})();
