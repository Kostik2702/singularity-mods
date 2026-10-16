"""Render the tabs' block-glyph aquila (mission-control/hooks/lib/frame.tsx CREST) as a PNG.

The Ghostty theme (terminal/ghostty/cogitator.conf) lays it faintly on the glass. Each
character cell is two quadrants across and two down; a quadrant glyph fills its
quadrants, the cross ✠ is drawn as a cross. Needs Pillow.
Usage: python tools/make-aquila.py terminal/ghostty/aquila.png
"""
import sys

from PIL import Image, ImageDraw

MIRROR = {"▌": "▐", "▐": "▌", "▖": "▗", "▗": "▖", "▘": "▝", "▝": "▘"}
LEFT = ["▄▄▄▄▄▄▄▄▄▄▄▄▄   ▗▄▖", " ▀▀███████████▄▄▐█▀", "    ▀▀▀▀▀██████▄▐█▄", "           ▀▀▀▀▀▀█▀"]
MID = [" ", "▄", "✠", "█"]
# Quadrants per glyph: top-left, top-right, bottom-left, bottom-right.
QUADS = {
    "█": (1, 1, 1, 1),
    "▀": (1, 1, 0, 0),
    "▄": (0, 0, 1, 1),
    "▌": (1, 0, 1, 0),
    "▐": (0, 1, 0, 1),
    "▖": (0, 0, 1, 0),
    "▗": (0, 0, 0, 1),
    "▘": (1, 0, 0, 0),
    "▝": (0, 1, 0, 0),
}
CELL_W, CELL_H = 24, 48
BRASS = (200, 156, 72, 255)


def crest() -> list[str]:
    return [left + mid + "".join(MIRROR.get(ch, ch) for ch in reversed(left)) for left, mid in zip(LEFT, MID)]


def main() -> int:
    rows = crest()
    across = max(len(r) for r in rows)
    pad = CELL_W
    img = Image.new("RGBA", (across * CELL_W + pad * 2, len(rows) * CELL_H + pad * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    qw, qh = CELL_W // 2, CELL_H // 2
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            x0, y0 = pad + x * CELL_W, pad + y * CELL_H
            if ch == "✠":
                t = CELL_W // 5
                draw.rectangle([x0 + CELL_W // 2 - t, y0 + 4, x0 + CELL_W // 2 + t, y0 + CELL_H - 4], fill=BRASS)
                draw.rectangle([x0 + 2, y0 + CELL_H // 2 - t, x0 + CELL_W - 2, y0 + CELL_H // 2 + t], fill=BRASS)
                continue
            quads = QUADS.get(ch)
            if quads is None:
                continue
            for i, on in enumerate(quads):
                if on:
                    qx, qy = x0 + (i % 2) * qw, y0 + (i // 2) * qh
                    draw.rectangle([qx, qy, qx + qw - 1, qy + qh - 1], fill=BRASS)
    img.save(sys.argv[1])
    print(sys.argv[1], img.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
