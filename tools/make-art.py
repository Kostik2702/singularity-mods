"""Draw the slate's pixel art and embed it in the mod.

The Agents tab of the warhammer theme shows a detailed Imperial aquila as a real
picture where the terminal draws pictures (Ghostty, kitty): two heads, spread wings of
layered feathers, a skull on the breast, gold over a dark outline. This draws it with
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

W, H = 432, 96          # 4.5 : 1, the box of 54 x 6 terminal cells (a cell is 1 : 2)
CX = W // 2
SCALE = 3               # drawn large, then scaled down for smooth edges

OUTLINE = (42, 26, 8, 255)
GOLD_TOP = (255, 226, 140)
GOLD_BOTTOM = (168, 112, 30)
HIGHLIGHT = (255, 244, 200, 255)
BONE = (236, 220, 180, 255)
SOCKET = (24, 14, 5, 255)


def gold(y: float) -> tuple[int, int, int, int]:
    t = min(1.0, max(0.0, y / H))
    return tuple(int(a + (b - a) * t) for a, b in zip(GOLD_TOP, GOLD_BOTTOM)) + (255,)


def s(points):
    return [(x * SCALE, y * SCALE) for x, y in points]


def feather(draw: ImageDraw.ImageDraw, top: tuple[float, float], length: float, width: float, slant: float) -> None:
    """A feather hanging from `top`, leaning out by `slant`, a rounded tip, a quill line."""
    x, y = top
    tip = (x - slant, y + length)
    left = [(x - width / 2, y), (x + width / 2, y), (tip[0] + width * 0.18, tip[1] - width * 0.4), tip, (tip[0] - width * 0.3, tip[1] - width * 0.55)]
    draw.polygon(s(left), fill=gold(y + length * 0.5), outline=OUTLINE, width=2 * SCALE)
    draw.line(s([(x, y + 2), (tip[0] + width * 0.05, tip[1] - width * 0.5)]), fill=HIGHLIGHT, width=SCALE)


def wing_edge(t: float) -> tuple[float, float]:
    """The wing's leading edge, an arch from the shoulder (t = 0) to the tip (t = 1)."""
    x = CX - 20 - t * (CX - 34)
    y = 30 - math.sin(t * math.pi * 0.62) * 24 + t * 6
    return x, y


def covert(draw: ImageDraw.ImageDraw, at: tuple[float, float], size: float) -> None:
    """A short rounded covert feather, a scale of the wing's upper row."""
    x, y = at
    draw.pieslice(s([(x - size, y - size * 0.7), (x + size, y + size * 1.3)]), 20, 160, fill=gold(y), outline=OUTLINE, width=2 * SCALE)


def left_half(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)
    # Primaries: long feathers hung from the edge, overlapping, leaning out; drawn from
    # the tip in, so the inner ones lie on top.
    count = 13
    for i in reversed(range(count)):
        t = i / (count - 1)
        x, y = wing_edge(t * 0.97)
        feather(draw, (x, y + 4), 50 - t * 30, 20 - t * 6, 6 + t * 18)
    # Coverts: two rows of scales over the primaries' roots.
    for row, (shift, size) in enumerate([(9, 7.5), (3, 6.0)]):
        for k in range(14 - row * 3):
            t = k / 13
            x, y = wing_edge(t * 0.9)
            covert(draw, (x - 2, y + shift), size - t * 2)
    # The leading edge: a heavy gilt bar.
    edge = [wing_edge(k / 30) for k in range(31)]
    draw.line(s(edge), fill=OUTLINE, width=8 * SCALE, joint='curve')
    draw.line(s(edge), fill=gold(8), width=5 * SCALE, joint='curve')
    draw.line(s([(x, y - 1) for x, y in edge]), fill=HIGHLIGHT, width=SCALE)
    # Tail feathers under the body, fanning down and out.
    for k, slant in enumerate([3, 9, 15]):
        feather(draw, (CX - 3 - k * 6, 68), 22 - k * 4, 9, slant)
    # The neck, rising from the breast, and the head in profile looking out:
    # an eye, a brow, a hooked beak.
    draw.polygon(s([(CX - 2, 46), (CX - 13, 30), (CX - 16, 18), (CX - 8, 14), (CX - 1, 24)]), fill=gold(28), outline=OUTLINE, width=2 * SCALE)
    hx, hy = CX - 17, 14
    draw.ellipse(s([(hx - 9, hy - 6), (hx + 6, hy + 6)]), fill=gold(10), outline=OUTLINE, width=2 * SCALE)
    beak = [(hx - 7, hy - 3), (hx - 19, hy - 1), (hx - 20, hy + 4), (hx - 16, hy + 2), (hx - 7, hy + 4)]
    draw.polygon(s(beak), fill=gold(22), outline=OUTLINE, width=2 * SCALE)
    draw.line(s([(hx - 8, hy - 4), (hx - 1, hy - 5)]), fill=OUTLINE, width=2 * SCALE)
    draw.ellipse(s([(hx - 5, hy - 3), (hx - 2, hy)]), fill=SOCKET)


def body(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)
    # The breast: a gold shield, and on it a skull.
    draw.polygon(s([(CX - 15, 38), (CX + 15, 38), (CX + 13, 66), (CX, 78), (CX - 13, 66)]), fill=gold(50), outline=OUTLINE, width=2 * SCALE)
    sx, sy = CX, 55
    draw.ellipse(s([(sx - 10, sy - 11), (sx + 10, sy + 7)]), fill=BONE, outline=OUTLINE, width=2 * SCALE)
    draw.rectangle(s([(sx - 6, sy + 4), (sx + 6, sy + 12)]), fill=BONE, outline=OUTLINE, width=2 * SCALE)
    for ex in (-5, 5):
        draw.ellipse(s([(sx + ex - 3.5, sy - 4), (sx + ex + 3.5, sy + 2)]), fill=SOCKET)
    draw.polygon(s([(sx - 1.5, sy + 3), (sx + 1.5, sy + 3), (sx, sy + 6)]), fill=SOCKET)
    for tx in (-3, 0, 3):
        draw.line(s([(sx + tx, sy + 8), (sx + tx, sy + 12)]), fill=SOCKET, width=SCALE)


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
        f'/** {W} x {H} pixels, 4.5 : 1, for a box of 54 x 6 cells. */',
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
