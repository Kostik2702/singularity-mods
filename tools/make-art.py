"""Draw the slate's pixel art and embed it in the mod.

The Agents tab of the warhammer theme shows the Imperial aquila as a real picture where
the terminal draws pictures (Ghostty, kitty), drawn here in the emblem's own manner (our
own drawing, not a copy of any artwork): two heads looking out on necks that curl over,
level wings of straight feathers fanning down from the shoulder, a wedge of a breast, a
tail fan and hooked talons, stencil gold over a dark outline. This draws it with
Pillow, symmetric from its left half, writes terminal/art/aquila-crest.png and embeds
it as base64 in mission-control/hooks/lib/art.ts, so the mod needs no file at run time.
Usage: python tools/make-art.py   (from the repo root; needs Pillow)
"""
import base64
import io
import math
import os
import sys

from PIL import Image, ImageDraw, ImageOps

W, H = 480, 160         # 3 : 1, the box of 54 x 9 terminal cells (a cell is 1 : 2)
CX = W // 2
SCALE = 3               # drawn large, then scaled down for smooth edges

OUTLINE = (34, 20, 6, 255)
GOLD_TOP = (255, 230, 150)
GOLD_BOTTOM = (176, 116, 32)
HIGHLIGHT = (255, 246, 210, 255)
EYE = (20, 10, 4, 255)


def gold(y: float) -> tuple[int, int, int, int]:
    t = min(1.0, max(0.0, y / H))
    return tuple(int(a + (b - a) * t) for a, b in zip(GOLD_TOP, GOLD_BOTTOM)) + (255,)


def s(points):
    return [(x * SCALE, y * SCALE) for x, y in points]


def slab(draw: ImageDraw.ImageDraw, poly, y_mid: float) -> None:
    """A gold slab with a dark outline and a lit upper edge: the stencil look of the emblem."""
    draw.polygon(s(poly), fill=gold(y_mid), outline=OUTLINE, width=2 * SCALE)
    draw.line(s([poly[0], poly[1]]), fill=HIGHLIGHT, width=SCALE)


def bar(draw: ImageDraw.ImageDraw, start, angle: float, length: float, thick: float) -> None:
    """A straight feather: a bar from `start`, `angle` degrees below the horizontal, going out
    to the left, its outer end cut square to the wing's sweep."""
    a = math.radians(angle)
    dx, dy = -math.cos(a), math.sin(a)          # outward and down
    nx, ny = -dy, dx                            # the bar's thickness, across it
    x0, y0 = start
    x1, y1 = x0 + dx * length, y0 + dy * length
    h = thick / 2
    poly = [(x0 + nx * h, y0 + ny * h), (x1 + nx * h, y1 + ny * h), (x1 - nx * h, y1 - ny * h), (x0 - nx * h, y0 - ny * h)]
    # Upper edge first, so the highlight runs along the top of each feather.
    slab(draw, [poly[3], poly[2], poly[1], poly[0]] if ny > 0 else poly, (y0 + y1) / 2)


def left_half(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)
    # The wing: straight feathers fanning out from under the neck, the top one level and
    # longest, each one below shorter and steeper; drawn bottom up, so the upper lie on top.
    count = 9
    for i in reversed(range(count)):
        t = i / (count - 1)                      # 0 the top feather, 1 the lowest
        start = (CX - 26 + t * 6, 34 + t * 46)
        angle = 3 + t * 50
        length = (CX - 36) * (1 - t * 0.6)
        bar(draw, start, angle, length, 11 - t * 2)
    # The neck: rising from the breast along its inner side, arching up and over toward
    # the outside, where the head sits looking out.
    box = [(CX - 50, 8), (CX - 6, 64)]
    draw.arc(s(box), 270, 100, fill=OUTLINE, width=17 * SCALE)
    draw.arc(s(box), 272, 98, fill=gold(30), width=12 * SCALE)
    # The head at the top of the arch, facing out: a brow, a beak hooked down, an eye.
    head = [(CX - 22, 4), (CX - 40, 4), (CX - 54, 10), (CX - 66, 18), (CX - 70, 30), (CX - 62, 24), (CX - 56, 30), (CX - 46, 20), (CX - 26, 20)]
    slab(draw, head, 14)
    draw.ellipse(s([(CX - 44, 8), (CX - 38, 14)]), fill=EYE)
    # A talon: a leg down and out from the breast, three hooked claws.
    slab(draw, [(CX - 16, 110), (CX - 6, 112), (CX - 24, 142), (CX - 34, 139)], 125)
    for dx, dy in [(-16, 4), (-9, 13), (1, 14)]:
        x0, y0 = CX - 29, 140
        slab(draw, [(x0, y0 - 4), (x0 + dx, y0 + dy - 4), (x0 + dx + 4, y0 + dy + 2), (x0 + 4, y0 + 3)], 148)
    # Tail feathers under the breast, fanning down between the talons.
    for k, angle in enumerate([86, 74, 62]):
        bar(draw, (CX - 2 - k * 4, 118), angle, 28 - k * 4, 6)


def body(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)
    # The breast: a long wedge pointing down, a ridge down its middle.
    slab(draw, [(CX - 24, 40), (CX + 24, 40), (CX + 14, 104), (CX, 128), (CX - 14, 104)], 80)
    draw.line(s([(CX, 46), (CX, 122)]), fill=OUTLINE, width=2 * SCALE)
    # A gilt boss at the heart.
    draw.ellipse(s([(CX - 7, 58), (CX + 7, 72)]), fill=gold(20), outline=OUTLINE, width=2 * SCALE)


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    big = Image.new('RGBA', (W * SCALE, H * SCALE), (0, 0, 0, 0))
    left_half(big)
    # The right half is the left one mirrored: the aquila is symmetric by construction.
    half = big.crop((0, 0, CX * SCALE, H * SCALE))
    big.paste(ImageOps.mirror(half), (CX * SCALE, 0), ImageOps.mirror(half))
    body(big)
    img = big.resize((W, H), Image.LANCZOS).quantize(colors=48, method=Image.Quantize.FASTOCTREE)
    out_png = os.path.join(root, 'terminal', 'art', 'aquila-crest.png')
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    img.save(out_png, optimize=True)
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    lines = [b64[i:i + 100] for i in range(0, len(b64), 100)]
    ts = [
        '// Generated by tools/make-art.py: do not edit by hand, run it again.',
        '// The detailed aquila the warhammer Agents tab shows where the terminal draws pictures.',
        '',
        f'/** {W} x {H} pixels, 3 : 1, for a box of 54 x 9 cells. */',
        f'export const AQUILA_PNG_SIZE = {{ width: {W}, height: {H} }} as const',
        '',
        '/** The PNG, base64. */',
        'export const AQUILA_PNG =',
        *[f"  '{line}' +" for line in lines[:-1]],
        f"  '{lines[-1]}'",
        '',
    ]
    out_ts = os.path.join(root, 'mission-control', 'hooks', 'lib', 'art.ts')
    with open(out_ts, 'w', encoding='utf-8') as f:
        f.write('\n'.join(ts))
    print(out_png, img.size, f'{len(buf.getvalue())} bytes')
    print(out_ts)
    return 0


if __name__ == '__main__':
    sys.exit(main())
