"""Gera os ícones do APK a partir de icons/icon-barco-512.png (barquinho, decisão de 9/11).

Rodar na pasta android/:  python tools/gerar_icones.py
"""
import os
from PIL import Image

src = Image.open('../icons/icon-barco-512.png').convert('RGBA')
res = 'app/src/main/res'
fundo = (234, 242, 245, 255)  # mesma cor das bordas do ícone (#EAF2F5)

# Ícone adaptável: camada da frente com o ícone inteiro em 72% do quadro,
# para o barco ficar dentro da área que o Android não corta.
for d, fg in [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]:
    p = f'{res}/mipmap-{d}'
    os.makedirs(p, exist_ok=True)
    c = Image.new('RGBA', (fg, fg), fundo)
    s = round(fg * 0.72)
    c.paste(src.resize((s, s), Image.LANCZOS), ((fg - s) // 2, (fg - s) // 2))
    c.save(f'{p}/ic_launcher_foreground.png')

# Tela de abertura: o ícone com cantos arredondados, sobre o fundo escuro do app.
os.makedirs(f'{res}/drawable-nodpi', exist_ok=True)
size = 288
splash = src.resize((size, size), Image.LANCZOS)
mask = Image.new('L', (size, size), 0)
from PIL import ImageDraw  # noqa: E402
ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=64, fill=255)
splash.putalpha(mask)
splash.save(f'{res}/drawable-nodpi/splash.png')

os.makedirs(f'{res}/mipmap-anydpi', exist_ok=True)
with open(f'{res}/mipmap-anydpi/ic_launcher.xml', 'w', encoding='utf-8') as f:
    f.write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconeFundo" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_notificacao" />
</adaptive-icon>
''')
print('ícones ok')
