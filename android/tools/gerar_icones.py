"""Gera os ícones do APK a partir dos SVGs da logo 3 (v14, "Folha de papel") em ../icons.

Rodar na pasta android/:  python tools/gerar_icones.py
Precisa do Chrome (desenha os SVGs) e do Pillow (recorta e salva os PNGs).
"""
import os
import pathlib
import subprocess
import tempfile

from PIL import Image, ImageDraw

CHROME = os.environ.get('CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
ICONS = pathlib.Path('../icons').resolve()
RES = pathlib.Path('app/src/main/res')
TMP = pathlib.Path(tempfile.mkdtemp(prefix='icones-'))


def render(svg_text, size, name):
    """Desenha um SVG em PNG transparente do tamanho pedido, usando o Chrome sem janela."""
    svg = TMP / f'{name}.svg'
    svg.write_text(svg_text, encoding='utf-8')
    html = TMP / f'{name}.html'
    html.write_text(f'<html><body style="margin:0;background:transparent"><img src="{svg.as_uri()}" '
                    f'width="{size}" height="{size}" style="display:block"></body></html>', encoding='utf-8')
    png = TMP / f'{name}-{size}.png'
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    f'--window-size={size},{size}', '--default-background-color=00000000',
                    f'--screenshot={png}', html.as_uri()], check=True, capture_output=True, timeout=60)
    return Image.open(png).convert('RGBA')


def svg(name):
    return (ICONS / name).read_text(encoding='utf-8')


frente = svg('icon-folha-frente.svg')                     # só o desenho, quadro de 108
cheio = svg('icon-folha.svg')                             # desenho com o fundo verde, ampliado
mono = svg('icon-folha-mono.svg')                         # silhueta branca, ampliada (notificação)
mono108 = mono.replace('viewBox="26 26 56 56"', 'viewBox="0 0 108 108"')   # silhueta no quadro de 108
fundo = cheio.replace('viewBox="18 18 72 72"', 'viewBox="0 0 108 108"')
fundo = fundo[:fundo.index('<path d="M35 73')] + '</svg>'  # só o degradê verde

# Ícone adaptável (108 dp): fundo, frente e silhueta para o ícone temático do Android 13+.
for density, px in [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]:
    folder = RES / f'mipmap-{density}'
    folder.mkdir(parents=True, exist_ok=True)
    render(frente, px, 'frente').save(folder / 'ic_launcher_foreground.png')
    render(fundo, px, 'fundo').convert('RGB').save(folder / 'ic_launcher_background.png')
    render(mono108, px, 'mono108').save(folder / 'ic_launcher_monochrome.png')

# Ícone pequeno das notificações (24 dp): silhueta branca.
for density, px in [('mdpi', 24), ('hdpi', 36), ('xhdpi', 48), ('xxhdpi', 72), ('xxxhdpi', 96)]:
    folder = RES / f'drawable-{density}'
    folder.mkdir(parents=True, exist_ok=True)
    render(mono, px, 'mono').save(folder / 'ic_notificacao.png')
old_vector = RES / 'drawable' / 'ic_notificacao.xml'
if old_vector.exists():
    old_vector.unlink()

# Tela de abertura: o ícone com cantos arredondados, sobre o fundo claro da Folha.
size = 288
splash = render(cheio, size, 'cheio')
mask = Image.new('L', (size, size), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=76, fill=255)
splash.putalpha(mask)
(RES / 'drawable-nodpi').mkdir(parents=True, exist_ok=True)
splash.save(RES / 'drawable-nodpi' / 'splash.png')

(RES / 'mipmap-anydpi').mkdir(parents=True, exist_ok=True)
(RES / 'mipmap-anydpi' / 'ic_launcher.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<!-- Logo 3 (v14): folha de papel pautado sobre verde-escuro. Gerado por tools/gerar_icones.py -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
''', encoding='utf-8')
print('ícones ok')
