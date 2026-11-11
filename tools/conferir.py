"""Confere a publicação antes do git push e recusa se faltar algum passo.

Os quatro passos manuais que já prenderam aparelhos numa versão antiga (v14.5):
  1. CACHE em sw.js subiu (senão os aparelhos não baixam os arquivos novos);
  2. APP_VERSION em js/app.js mudou (é o que aparece no rodapé de Config.);
  3. sw.js está igual ao que tools/build_sw.py gera (regras embutidas em dia, sem import);
  4. a lista FILES do sw.js tem todos os arquivos do app e só arquivos que existem.

Uso, na pasta do projeto:
    python tools/conferir.py              confere (compara com origin/main)
    python tools/conferir.py --instalar   instala como trava do git push (.git/hooks/pre-push)
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import build_sw  # noqa: E402

# Arquivos que vão para o aparelho: mudar qualquer um deles exige subir CACHE e APP_VERSION.
APP_FILES = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'js/', 'fonts/', 'icons/']


def git(*args):
    result = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    return result.stdout if result.returncode == 0 else None


def find(pattern, text):
    match = re.search(pattern, text or '')
    return match.group(1) if match else None


def main():
    problems = []
    sw = (ROOT / 'sw.js').read_text(encoding='utf-8')
    app = (ROOT / 'js' / 'app.js').read_text(encoding='utf-8')
    cache = find(r"const CACHE = '([^']+)'", sw)
    version = find(r"const APP_VERSION = '([^']+)'", app)

    # 1 e 2: comparados com o que está publicado (origin/main).
    git('fetch', '-q', 'origin', 'main')
    changed = [name for name in (git('diff', '--name-only', 'origin/main', '--', *APP_FILES) or '').split() if name]
    published_sw = git('show', 'origin/main:sw.js')
    published_app = git('show', 'origin/main:js/app.js')
    if changed and published_sw is not None:
        if cache == find(r"const CACHE = '([^']+)'", published_sw):
            problems.append(f'CACHE continua "{cache}", mas mudaram arquivos do app: {", ".join(changed[:6])}. Suba o número em sw.js.')
        if version == find(r"const APP_VERSION = '([^']+)'", published_app):
            problems.append(f'APP_VERSION continua "{version}". Mude em js/app.js (aparece no rodapé de Config.).')

    # 3: regras embutidas em dia e sem import.
    parts = [build_sw.convert(name, (ROOT / 'js' / f'{name}.js').read_text(encoding='utf-8')) for name in build_sw.MODULES]
    block = '\n'.join([build_sw.START, 'const SW_RULES = (() => {', '  const M = {};', *parts, '  return M;', '})();', build_sw.END])
    if build_sw.START not in sw or block not in sw:
        problems.append('sw.js está desatualizado em relação a js/rules.js, sync-core, push-core ou actions-core. Rode: python tools/build_sw.py')
    if re.search(r'^\s*import\s', re.sub(r'//.*', '', sw), re.M):
        problems.append('sw.js tem import: aparelhos com o service worker clássico ficariam presos. Tire o import.')

    # 4: lista FILES do sw.js.
    files_block = find(r'const FILES = \[(.*?)\];', sw.replace('\n', ' ')) or ''
    files = re.findall(r"'([^']+)'", files_block)
    for name in files:
        if name != './' and not (ROOT / name).exists():
            problems.append(f'FILES do sw.js cita "{name}", que não existe.')
    needed = ['index.html', 'styles.css', 'manifest.webmanifest']
    needed += [f'js/{p.name}' for p in sorted((ROOT / 'js').glob('*.js'))]
    for name in needed:
        if name not in files:
            problems.append(f'FILES do sw.js não tem "{name}": sem internet, o app quebraria. Acrescente.')
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    for ref in re.findall(r'(?:src|href)="([^"#:]+)"', index):
        if ref not in files and not ref.startswith('http'):
            problems.append(f'index.html usa "{ref}", que não está em FILES do sw.js.')

    if problems:
        print('Publicação recusada:')
        for item in problems:
            print(f'  - {item}')
        return 1
    print(f'Tudo certo: {version}, cache {cache}, regras do sw.js em dia, {len(files)} arquivos em FILES.')
    return 0


def install():
    hook = ROOT / '.git' / 'hooks' / 'pre-push'
    hook.write_text('#!/bin/sh\n# Confere CACHE, APP_VERSION, sw.js e FILES antes de publicar.\npython tools/conferir.py || exit 1\n', encoding='utf-8')
    hook.chmod(0o755)
    print(f'Trava instalada em {hook}. Para publicar sem conferir (não recomendado): git push --no-verify')


if __name__ == '__main__':
    if '--instalar' in sys.argv:
        install()
        sys.exit(0)
    sys.exit(main())
