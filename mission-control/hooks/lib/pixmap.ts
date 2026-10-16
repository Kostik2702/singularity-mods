// Pictures for the terminals that draw none (Windows Terminal, and any without kitty
// graphics): a small RGBA pixmap, made beside each picture by tools/make-art.py, laid into
// a Raster's cells at whatever box the tab gives it. An emblem goes in braille (a cell is
// 2 x 4 dots of one colour: a sharp silhouette); a photograph in half blocks (a cell is
// two pixels, each its own colour). Pure: numbers and strings, no `$`.

import { packCells } from './cog'

export type Pixmap = { w: number; h: number; rgba: string }
type Pixels = { w: number; h: number; data: Uint8Array }

const DEFAULT = 0x01000000
const SPACE = 0x20
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const BRAILLE = 0x2800

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let n = 0
  let bits = 0
  let at = 0
  for (const ch of clean) {
    n = (n << 6) | ALPHABET.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at] = (n >> bits) & 0xff
      at += 1
    }
  }
  return out.subarray(0, at)
}

/** A pixmap's pixels; null when it does not hold w × h × 4 bytes. */
export function pixelsOf(p: Pixmap): Pixels | null {
  const data = fromBase64(p.rgba)
  return data.length === p.w * p.h * 4 ? { w: p.w, h: p.h, data } : null
}

/** A pixmap from the text of a .pix.json file; null for anything else. */
export function parsePixmap(text: string): Pixmap | null {
  try {
    const v = JSON.parse(text) as Partial<Pixmap>
    return typeof v.w === 'number' && typeof v.h === 'number' && typeof v.rgba === 'string' ? { w: v.w, h: v.h, rgba: v.rgba } : null
  } catch {
    return null
  }
}

/** The average colour and opacity of the pixels in a box [x0, x1) × [y0, y1). */
function average(px: Pixels, x0: number, y0: number, x1: number, y1: number): { rgb: number; alpha: number } {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let n = 0
  const xa = Math.max(0, Math.floor(x0))
  const ya = Math.max(0, Math.floor(y0))
  const xb = Math.min(px.w, Math.max(xa + 1, Math.ceil(x1)))
  const yb = Math.min(px.h, Math.max(ya + 1, Math.ceil(y1)))
  for (let y = ya; y < yb; y += 1) {
    for (let x = xa; x < xb; x += 1) {
      const i = (y * px.w + x) * 4
      const alpha = px.data[i + 3] ?? 0
      r += (px.data[i] ?? 0) * alpha
      g += (px.data[i + 1] ?? 0) * alpha
      b += (px.data[i + 2] ?? 0) * alpha
      a += alpha
      n += 1
    }
  }
  if (a === 0) return { rgb: 0, alpha: 0 }
  return { rgb: (Math.round(r / a) << 16) | (Math.round(g / a) << 8) | Math.round(b / a), alpha: a / n }
}

/** A photograph in half blocks: each cell two pixels (top, bottom), each its own colour. */
export function halfBlockCells(p: Pixmap, columns: number, rows: number): string {
  const px = pixelsOf(p)
  const words: number[] = []
  const sx = px === null ? 0 : px.w / columns
  const sy = px === null ? 0 : px.h / (rows * 2)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (px === null) {
        words.push(SPACE, DEFAULT, DEFAULT)
        continue
      }
      const top = average(px, col * sx, row * 2 * sy, (col + 1) * sx, (row * 2 + 1) * sy)
      const bottom = average(px, col * sx, (row * 2 + 1) * sy, (col + 1) * sx, (row * 2 + 2) * sy)
      const t = top.alpha >= 110
      const b = bottom.alpha >= 110
      if (t) words.push(UPPER, top.rgb, b ? bottom.rgb : DEFAULT)
      else if (b) words.push(LOWER, bottom.rgb, DEFAULT)
      else words.push(SPACE, DEFAULT, DEFAULT)
    }
  }
  return packCells(words)
}

// The dot of each place in a braille cell: (column, row) → bit.
const DOTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0x01],
  [0, 1, 0x02],
  [0, 2, 0x04],
  [1, 0, 0x08],
  [1, 1, 0x10],
  [1, 2, 0x20],
  [0, 3, 0x40],
  [1, 3, 0x80],
]

/**
 * An emblem in braille: each cell 2 × 4 dots, a dot where the emblem is, the cell in the
 * emblem's average colour there (or `tint`, when given).
 */
export function brailleCells(p: Pixmap, columns: number, rows: number, tint: number | null = null): string {
  const px = pixelsOf(p)
  const words: number[] = []
  const sx = px === null ? 0 : px.w / (columns * 2)
  const sy = px === null ? 0 : px.h / (rows * 4)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (px === null) {
        words.push(SPACE, DEFAULT, DEFAULT)
        continue
      }
      let bits = 0
      for (const [dx, dy, bit] of DOTS) {
        const x = (col * 2 + dx) * sx
        const y = (row * 4 + dy) * sy
        if (average(px, x, y, x + sx, y + sy).alpha >= 96) bits |= bit
      }
      if (bits === 0) {
        words.push(SPACE, DEFAULT, DEFAULT)
        continue
      }
      const colour = tint ?? average(px, col * 2 * sx, row * 4 * sy, (col + 1) * 2 * sx, (row + 1) * 4 * sy).rgb
      words.push(BRAILLE + bits, colour, DEFAULT)
    }
  }
  return packCells(words)
}
