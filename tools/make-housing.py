"""Draw the cogitator's brass housing for a terminal that runs no shader (WezTerm).

Ghostty draws the housing with terminal/ghostty/cogitator.glsl and Windows Terminal with its
HLSL twin; WezTerm has no custom shaders, only background layers. This is the same housing
in numpy, the shader's own maths line for line: a bevelled brass bezel with a groove and a
gilt trim, rivets every RIVET_EVERY pixels counted from the middle of each edge, a cross
medallion in each corner, a Mechanicus hazard band on the middle third of the lower edge,
the housing's shadow falling on the glass, and the aquila faint in the glass's lower right
(the Ghostty background image). The glass itself stays transparent: the terminal's own
background shows through it, and its text is drawn over it.

A housing fits one window size only (rivets, corners and the band are placed by the
window's pixels, never stretched), so terminal/wezterm/cogitator.lua asks for one per size
it meets and keeps them in a cache folder; this prunes that folder to the newest --keep.

Usage (from anywhere; needs numpy and Pillow):
  python tools/make-housing.py --size 2560x1369 --out <png> [--scale 0.8] [--aquila <png>] [--keep 24]
  --scale multiplies the shader's pixel sizes (BEZEL 44, rivets 5 / 150, band stripes 18),
  which are a Retina screen's; 0.8 suits a 1x screen.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

# The shader's constants (terminal/ghostty/cogitator.glsl), in its physical pixels.
BEZEL = 44.0
RIVET_EVERY = 150.0
RIVET_R = 5.0
HAZARD_PERIOD = 18.0
SHADOW = 18.0

BRASS_DARK = np.array([0.13, 0.09, 0.035])
BRASS = np.array([0.56, 0.42, 0.19])
BRASS_LIGHT = np.array([0.98, 0.82, 0.48])
HAZARD = np.array([0.90, 0.66, 0.10])
LIGHT = np.array([-0.6, 0.8])

# The aquila in the glass: Ghostty's background-image-opacity.
AQUILA_OPACITY = 0.10


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return a * (1.0 - t) + b * t


def hash2(x, y):
    v = np.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return v - np.floor(v)


def dome(px, py, r, under):
    """A domed rivet or boss at (px, py) from its centre, radius r; `under` shows around it."""
    d = np.sqrt(px * px + py * py)
    gx, gy = px / r, py / r
    gz = np.sqrt(np.maximum(0.0, 1.0 - (gx * gx + gy * gy)))
    norm = np.sqrt(gx * gx + gy * gy + gz * gz) + 1e-9
    lx, ly, lz = LIGHT[0], LIGHT[1], 0.9
    ln = np.sqrt(lx * lx + ly * ly + lz * lz)
    shade = np.clip((gx * lx + gy * ly + gz * lz) / (norm * ln), 0.0, 1.0)
    c = mix(BRASS_DARK, BRASS_LIGHT, shade)
    c = mix(c, BRASS_DARK * 0.5, smoothstep(r - 1.2, r, d))
    out = mix(c, under, smoothstep(r, r + 1.0, d))
    return np.where((d > r + 1.0)[..., None], under, out)


def housing(width, height, scale):
    """The housing as RGBA floats, y down; the glass transparent but for the shadow."""
    B = BEZEL * scale
    every = RIVET_EVERY * scale
    rr = max(2.5, RIVET_R * scale)
    # fragCoord as the shader sees it: pixel centres, y up.
    x = np.arange(width, dtype=np.float64) + 0.5
    y = height - (np.arange(height, dtype=np.float64) + 0.5)
    X, Y = np.meshgrid(x, y)
    dl, dr, db, dt = X, width - X, Y, height - Y
    edge = np.minimum(np.minimum(dl, dr), np.minimum(db, dt))

    # The edge's outward normal, in the shader's order of preference: left, right, bottom, top.
    nx = np.where(edge == dl, -1.0, np.where(edge == dr, 1.0, 0.0))
    ny = np.where((edge != dl) & (edge != dr), np.where(edge == db, -1.0, 1.0), 0.0)
    t = np.clip(edge / B, 0.0, 1.0)

    ll = LIGHT / np.linalg.norm(LIGHT)
    lit = (nx * ll[0] + ny * ll[1]) * np.cos(t * np.pi)
    c = mix(BRASS_DARK, BRASS, 0.35 + 0.55 * np.sin(t * np.pi))
    c = c + BRASS_LIGHT * 0.30 * np.maximum(lit, 0.0)[..., None] - 0.10 * np.maximum(-lit, 0.0)[..., None]
    c = c * (0.90 + 0.10 * hash2(np.floor(X / 1.5), np.floor(Y / 1.5)))[..., None]

    lower = (edge == db) & (edge != dl) & (edge != dr)
    band = lower & (t > 0.36) & (t < 0.86) & (np.abs(X - width * 0.5) < width / 6.0)
    period = HAZARD_PERIOD * scale
    stripe = (((X + Y) / period) % 1.0 >= 0.5).astype(np.float64)
    hz = mix(np.array([0.05, 0.035, 0.02]), HAZARD, stripe) * (0.85 + 0.15 * np.sin(t * np.pi))[..., None]
    c = np.where(band[..., None], hz, c)

    c = mix(c, BRASS_DARK * 0.55, 1.0 - smoothstep(0.0, 1.4, np.abs(edge - B * 0.30)))
    c = mix(c, BRASS_LIGHT, 1.0 - smoothstep(0.0, 1.0, np.abs(edge - (B - 1.5))))
    c = mix(c, np.array([0.02, 0.015, 0.01]), 1.0 - smoothstep(0.0, 1.5, edge))

    # Rivets along the crest of each edge, counted from its middle; none by the corners or the band.
    crest = B * 0.64
    vertical = nx != 0.0
    along = np.where(vertical, Y, X)
    span = np.where(vertical, float(height), float(width))
    k = (along - span * 0.5) % every - every * 0.5
    near_corner = (along < B * 2.2) | (along > span - B * 2.2)
    in_band = lower & (np.abs(X - width * 0.5) < width / 6.0 + rr * 2.0)
    riveted = dome(k, edge - crest, rr, c)
    c = np.where((~near_corner & ~in_band)[..., None], riveted, c)

    # A cross medallion in each corner.
    cx = np.where(X < width * 0.5, B * 0.5, width - B * 0.5)
    cy = np.where(Y < height * 0.5, B * 0.5, height - B * 0.5)
    qx, qy = X - cx, Y - cy
    R = B * 0.46
    ql = np.sqrt(qx * qx + qy * qy)
    m = dome(qx, qy, R, c)
    ring = np.abs(ql - R * 0.80)
    m = mix(m, BRASS_LIGHT, 1.0 - smoothstep(0.6, 1.6, ring))
    ax, ay = np.abs(qx), np.abs(qy)
    w1 = R * 0.16 + ay * 0.35
    w2 = R * 0.16 + ax * 0.35
    cross = ((ax < w1) & (ay < R * 0.62)) | ((ay < w2) & (ax < R * 0.62))
    m = np.where(cross[..., None], mix(BRASS_DARK * 0.6, np.array([0.25, 0.04, 0.03]), 0.5), m)
    c = np.where((ql < R + 1.0)[..., None], m, c)

    # The bezel opaque; the glass clear but for the housing's shadow (the shader darkens the
    # glass to 0.45 at its edge, back to 1 SHADOW pixels in).
    rgba = np.zeros((height, width, 4))
    on_bezel = edge < B
    shade = 0.55 * (1.0 - smoothstep(B, B + SHADOW * scale, edge))
    rgba[..., :3] = np.where(on_bezel[..., None], np.clip(c, 0.0, 1.0), 0.0)
    rgba[..., 3] = np.where(on_bezel, 1.0, shade)
    return rgba


def aquila_layer(path, width, height, scale, inset):
    """The aquila at AQUILA_OPACITY in the glass's lower right, as an RGBA image."""
    layer = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    if not path or not os.path.isfile(path):
        return layer
    img = Image.open(path).convert('RGBA')
    w = min(max(1, round(img.width * scale)), max(1, width - 2 * inset))
    h = max(1, round(img.height * w / img.width))
    img = img.resize((w, h), Image.LANCZOS)
    img.putalpha(img.getchannel('A').point(lambda v: round(v * AQUILA_OPACITY)))
    layer.alpha_composite(img, (max(0, width - inset - w), max(0, height - inset - h)))
    return layer


def prune(folder, keep):
    """Keep the newest `keep` housings in the cache folder."""
    files = [os.path.join(folder, f) for f in os.listdir(folder) if f.startswith('housing-') and f.endswith('.png')]
    files.sort(key=os.path.getmtime, reverse=True)
    for old in files[keep:]:
        try:
            os.remove(old)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--size', required=True, help='WIDTHxHEIGHT in pixels')
    ap.add_argument('--out', required=True)
    ap.add_argument('--scale', type=float, default=0.8)
    ap.add_argument('--aquila', default=None)
    ap.add_argument('--keep', type=int, default=24)
    a = ap.parse_args()
    try:
        width, height = (int(v) for v in a.size.lower().split('x'))
    except ValueError:
        print(f'make-housing: --size wants WIDTHxHEIGHT, got {a.size!r}', file=sys.stderr)
        return 2
    if width < 64 or height < 64 or width > 16384 or height > 16384:
        print(f'make-housing: no housing for a {width}x{height} window', file=sys.stderr)
        return 2
    rgba = housing(width, height, a.scale)
    bezel = Image.fromarray(np.round(rgba * 255.0).astype(np.uint8), 'RGBA')
    inset = round((BEZEL + SHADOW) * a.scale) + 8
    # The aquila under the shadow, the bezel over both. Its picture is a Retina one: halved for 1x.
    out = aquila_layer(a.aquila, width, height, a.scale * 0.6, inset)
    out.alpha_composite(bezel)
    folder = os.path.dirname(os.path.abspath(a.out))
    os.makedirs(folder, exist_ok=True)
    # Written aside and renamed, so a reader never meets half a file.
    part = a.out + '.part'
    out.save(part, format='PNG')
    os.replace(part, a.out)
    prune(folder, a.keep)
    print(os.path.abspath(a.out), out.size)
    return 0


if __name__ == '__main__':
    sys.exit(main())
