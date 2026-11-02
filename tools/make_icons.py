"""Gera os ícones PNG do app usando só a biblioteca padrão."""
import struct
import zlib
from pathlib import Path

BACKGROUND = (47, 93, 80)
FOREGROUND = (255, 255, 255)
# Pontos do sinal de "concluído", dentro da área segura dos ícones adaptáveis.
CHECK = [(0.30, 0.52), (0.44, 0.66), (0.71, 0.36)]
THICKNESS = 0.045


def segment_distance(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
    return ((x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2) ** 0.5


def make_png(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            x, y = (px + 0.5) / size, (py + 0.5) / size
            distance = min(segment_distance(x, y, CHECK[0], CHECK[1]), segment_distance(x, y, CHECK[1], CHECK[2]))
            # Borda suavizada em cerca de um pixel.
            coverage = max(0.0, min(1.0, (THICKNESS - distance) * size + 0.5))
            row += bytes(round(b + (f - b) * coverage) for b, f in zip(BACKGROUND, FOREGROUND))
        rows.append(bytes(row))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    folder = Path(__file__).resolve().parent.parent / 'icons'
    folder.mkdir(exist_ok=True)
    for size in (192, 512):
        (folder / f'icon-{size}.png').write_bytes(make_png(size))
