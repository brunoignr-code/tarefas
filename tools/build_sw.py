"""Embute em sw.js (e em server/worker.js, desde a v30) as regras de js/ (rules, sync-core, push-core, actions-core), sem import.

Por quê: aparelhos com o service worker registrado no formato clássico (até a v14.5)
não conseguem carregar um sw.js com `import`, e ficariam presos na versão antiga.
Com as regras embutidas, o sw.js funciona registrado como clássico ou como módulo.

Rodar na pasta do projeto depois de mudar qualquer um desses arquivos (depois, implante o servidor também):
    python tools/build_sw.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULES = ['rules', 'sync-core', 'push-core', 'actions-core']
START = '// ---- INÍCIO DAS REGRAS EMBUTIDAS (gerado por tools/build_sw.py; não edite à mão) ----'
END = '// ---- FIM DAS REGRAS EMBUTIDAS ----'

IMPORT_RE = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'\./([\w-]+)\.js';", re.S)
EXPORT_RE = re.compile(r'^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)', re.M)


def convert(name, source):
    def imp(match):
        names = ', '.join(part.strip() for part in match.group(1).split(',') if part.strip())
        return f"const {{ {names} }} = M['{match.group(2)}'];"
    body = IMPORT_RE.sub(imp, source)
    exported = EXPORT_RE.findall(body)
    body = re.sub(r'^export\s+', '', body, flags=re.M)
    assert 'import ' not in re.sub(r'//.*', '', body), f'{name}: import que não deu para converter'
    indented = '\n'.join(('  ' + line) if line.strip() else '' for line in body.rstrip().splitlines())
    return f"M['{name}'] = (() => {{\n{indented}\n  return {{ {', '.join(exported)} }};\n}})();"


def main():
    parts = [convert(name, (ROOT / 'js' / f'{name}.js').read_text(encoding='utf-8')) for name in MODULES]
    block = '\n'.join([START, 'const SW_RULES = (() => {', '  const M = {};', *parts, '  return M;', '})();', END])
    sw_path = ROOT / 'sw.js'
    sw = sw_path.read_text(encoding='utf-8')
    if START in sw:
        sw = sw[:sw.index(START)] + block + sw[sw.index(END) + len(END):]
    else:
        raise SystemExit('sw.js não tem os marcadores do bloco gerado.')
    sw_path.write_text(sw, encoding='utf-8')
    print(f'sw.js atualizado ({len(block)} caracteres de regras embutidas).')

    # v30: o servidor usa as mesmas regras nos botões da notificação do Android.
    server_block = block.replace('const SW_RULES = (() => {', 'const SHARED_RULES = (() => {')
    worker_path = ROOT / 'server' / 'worker.js'
    worker = worker_path.read_text(encoding='utf-8')
    if START not in worker:
        raise SystemExit('server/worker.js não tem os marcadores do bloco gerado.')
    worker = worker[:worker.index(START)] + server_block + worker[worker.index(END) + len(END):]
    worker_path.write_text(worker, encoding='utf-8')
    print(f'server/worker.js atualizado ({len(server_block)} caracteres de regras embutidas).')


if __name__ == '__main__':
    main()
