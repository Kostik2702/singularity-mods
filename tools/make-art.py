"""Draw the slate's pixel art and embed it in the mod.

The Agents tab of the warhammer theme shows the Imperial aquila as a real picture where
the terminal draws pictures (Ghostty, kitty), drawn here in the emblem's own manner (our
own drawing, not a copy of any artwork): two heads looking out on necks that curl over,
level wings of straight feathers fanning down from the shoulder, a wedge of a breast, a
tail fan and hooked talons, stencil gold over a dark outline. This draws it with
Pillow, symmetric from its left half, writes terminal/art/aquila-crest.png and embeds
it as base64 in mission-control/hooks/lib/art.ts, so the mod needs no file at run time.
Usage: python tools/make-art.py   (from the repo root; needs Pillow)

  python tools/make-art.py --from <file or https URL> [--out <png>]
    Cuts the emblem out of a picture the person chose (a gold or amber emblem on a dark,
    grey ground, as Imperial wallpapers are): keeps the emblem's own pixels, makes the
    ground transparent, crops it and pads it to 3 : 1. Writes terminal/art/aquila-custom.png
    by default, which git ignores: someone else's artwork stays on this machine and never
    goes into the repository. tools/install.mjs --aquila runs this and points the mod at it.

  python tools/make-art.py --servo-frames <cut-out PNG> [--out-dir <dir>]
    Animates a servo-skull from a picture already cut out onto a transparent ground (imgqa
    cutout makes one): SKULL_FRAMES frames of it hovering up and down, swaying a little,
    its cyan optics pulsing, as frame-00.png ... in terminal/art/servo-skull/ by default,
    git-ignored like the crest. The Processes tab shows them in place of the cog.

  python tools/make-art.py --seal <cut-out PNG> [--out <png>]
    A purity seal for the Archives tab from a picture already cut out: cropped and padded
    to 5 : 24 (a box of 5 x 12 cells), terminal/art/purity-seal.png by default, git-ignored.

  python tools/make-art.py --portrait <cut-out PNG> --out <png>
    A rank's portrait for Легион from a picture already cut out: cropped to its subject and
    padded square (192 x 192, a box of 6 x 3 cells), into terminal/art/portraits/, git-ignored.
"""
import base64
import io
import math
import os
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageOps

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


def cut_emblem(source: str, out: str) -> int:
    """The emblem of a picture the person chose, on a transparent ground, at 3 : 1."""
    if source.startswith(('http://', 'https://')):
        req = urllib.request.Request(source, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as res:
            data = res.read()
        img = Image.open(io.BytesIO(data))
    else:
        img = Image.open(source)
    rgb = img.convert('RGB')
    # The emblem is warm (red well above blue) and lit; the ground is grey or dark.
    r, g, b = rgb.split()
    warm = Image.eval(Image.merge('RGB', (r, g, b)).convert('RGB'), lambda v: v)
    px = warm.load()
    mask = Image.new('L', rgb.size, 0)
    mp = mask.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            R, G, B = px[x, y]
            if R - B > 45 and R > 70:
                mp[x, y] = 255
    # Close the rust's pinholes, drop specks, then soften the edge by a pixel.
    mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    box = mask.point(lambda v: 255 if v > 128 else 0).getbbox()
    if box is None:
        print('make-art: no warm emblem found in that picture', file=sys.stderr)
        return 1
    emblem = rgb.convert('RGBA')
    emblem.putalpha(mask)
    emblem = emblem.crop(box)
    # Pad to 3 : 1, the emblem centred, so the Agents tab's box keeps its shape.
    w, h = emblem.size
    cw, ch = max(w, 3 * h), max(h, math.ceil(w / 3))
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    canvas.paste(emblem, ((cw - w) // 2, (ch - h) // 2), emblem)
    width = min(960, cw)
    canvas = canvas.resize((width, round(width / 3)), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    canvas.save(out, optimize=True)
    print(os.path.abspath(out), canvas.size)
    return 0


SKULL_FRAMES = 12
SKULL_SIZE = (240, 360)   # 2 : 3, a box of 12 x 9 terminal cells


def servo_frames(source: str, out_dir: str) -> int:
    """A servo-skull's frames: hovering, swaying, its optics pulsing."""
    base = Image.open(source).convert('RGBA')
    box = base.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if box is None:
        print('make-art: the picture has no opaque subject (cut it out first)', file=sys.stderr)
        return 1
    base = base.crop(box)
    # Fit inside 88% of the box, leaving room to hover and sway.
    W2, H2 = SKULL_SIZE
    scale = min(W2 * 0.88 / base.width, H2 * 0.88 / base.height)
    base = base.resize((max(1, round(base.width * scale)), max(1, round(base.height * scale))), Image.LANCZOS)
    # The optics: bright cyan pixels, blurred into a glow of their own.
    px = base.load()
    eyes = Image.new('L', base.size, 0)
    ep = eyes.load()
    for y in range(base.height):
        for x in range(base.width):
            r, g, b, a = px[x, y]
            if a > 128 and g > 110 and b > 110 and (g + b) / 2 - r > 55:
                ep[x, y] = 255
    glow_mask = eyes.filter(ImageFilter.GaussianBlur(4))
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.startswith('frame-') and old.endswith('.png'):
            os.remove(os.path.join(out_dir, old))
    for k in range(SKULL_FRAMES):
        phase = 2 * math.pi * k / SKULL_FRAMES
        sprite = base.copy()
        pulse = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(phase * 2))
        glow = Image.new('RGBA', base.size, (90, 255, 235, 0))
        glow.putalpha(glow_mask.point(lambda v: int(v * pulse)))
        sprite = Image.alpha_composite(sprite, glow)
        sprite = sprite.rotate(math.sin(phase) * 3.0, resample=Image.BICUBIC, expand=True)
        frame = Image.new('RGBA', SKULL_SIZE, (0, 0, 0, 0))
        dy = round(math.sin(phase) * H2 * 0.03)
        frame.alpha_composite(sprite, ((W2 - sprite.width) // 2, (H2 - sprite.height) // 2 + dy))
        frame.save(os.path.join(out_dir, f'frame-{k:02d}.png'), optimize=True)
    print(os.path.abspath(out_dir), f'{SKULL_FRAMES} frames', SKULL_SIZE)
    return 0


SEAL_SIZE = (200, 960)    # 5 : 24, a box of 5 x 12 terminal cells


def seal(source: str, out: str) -> int:
    """A purity seal cropped to its subject and padded to SEAL_SIZE, hanging from the top."""
    img = Image.open(source).convert('RGBA')
    box = img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if box is None:
        print('make-art: the picture has no opaque subject (cut it out first)', file=sys.stderr)
        return 1
    img = img.crop(box)
    W2, H2 = SEAL_SIZE
    scale = min(W2 / img.width, H2 / img.height)
    img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', SEAL_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(img, ((W2 - img.width) // 2, 0))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    canvas.save(out, optimize=True)
    print(os.path.abspath(out), canvas.size)
    return 0


PORTRAIT_SIZE = 192


def portrait(source: str, out: str) -> int:
    """A rank's portrait: the subject cropped, centred on a transparent square."""
    img = Image.open(source).convert('RGBA')
    box = img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if box is None:
        print('make-art: the picture has no opaque subject (cut it out first)', file=sys.stderr)
        return 1
    img = img.crop(box)
    scale = PORTRAIT_SIZE / max(img.width, img.height)
    img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (PORTRAIT_SIZE, PORTRAIT_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((PORTRAIT_SIZE - img.width) // 2, (PORTRAIT_SIZE - img.height) // 2))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    canvas.save(out, optimize=True)
    print(os.path.abspath(out), canvas.size)
    return 0


def main() -> int:
    if len(sys.argv) >= 5 and sys.argv[1] == '--portrait' and sys.argv[3] == '--out':
        return portrait(sys.argv[2], sys.argv[4])
    if len(sys.argv) >= 3 and sys.argv[1] == '--seal':
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out = sys.argv[4] if len(sys.argv) >= 5 and sys.argv[3] == '--out' else os.path.join(root, 'terminal', 'art', 'purity-seal.png')
        return seal(sys.argv[2], out)
    if len(sys.argv) >= 3 and sys.argv[1] == '--servo-frames':
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out = sys.argv[4] if len(sys.argv) >= 5 and sys.argv[3] == '--out-dir' else os.path.join(root, 'terminal', 'art', 'servo-skull')
        return servo_frames(sys.argv[2], out)
    if len(sys.argv) >= 3 and sys.argv[1] == '--from':
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out = sys.argv[4] if len(sys.argv) >= 5 and sys.argv[3] == '--out' else os.path.join(root, 'terminal', 'art', 'aquila-custom.png')
        return cut_emblem(sys.argv[2], out)
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
