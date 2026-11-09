"""Gera os ícones do APK a partir de icons/icon-diamante-512.png.

Rodar na pasta android/:  python tools/gerar_icones.py
"""
import os
from PIL import Image

src = Image.open('../icons/icon-diamante-512.png').convert('RGBA')
res = 'app/src/main/res'
fundo = (14, 18, 24, 255)  # mesma cor das bordas do ícone (#0E1218)

# Ícone adaptável: camada da frente com o ícone inteiro em 80% do quadro,
# para o diamante ficar dentro da área que o Android não corta.
for d, fg in [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]:
    p = f'{res}/mipmap-{d}'
    os.makedirs(p, exist_ok=True)
    c = Image.new('RGBA', (fg, fg), fundo)
    s = round(fg * 0.80)
    c.paste(src.resize((s, s), Image.LANCZOS), ((fg - s) // 2, (fg - s) // 2))
    c.save(f'{p}/ic_launcher_foreground.png')

os.makedirs(f'{res}/drawable-nodpi', exist_ok=True)
src.resize((288, 288), Image.LANCZOS).save(f'{res}/drawable-nodpi/splash.png')

os.makedirs(f'{res}/mipmap-anydpi', exist_ok=True)
with open(f'{res}/mipmap-anydpi/ic_launcher.xml', 'w', encoding='utf-8') as f:
    f.write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/fundo" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_notificacao" />
</adaptive-icon>
''')
print('ícones ok')
