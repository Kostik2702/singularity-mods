// Pictures for the terminals that draw none (Windows Terminal, and any without kitty
// graphics): a small RGBA pixmap, made beside each picture by tools/make-art.py, laid into
// a Raster's cells at whatever box the tab gives it. An emblem goes in a block mosaic (a
// cell is the block element and the two colours nearest the picture there: edges to an
// eighth of a cell); a photograph in half blocks (a cell is two pixels, each its own
// colour). Pure: numbers and strings, no `$`.

import { packCells } from './cog'

/**
 * A picture's pixels, w × h RGBA as base64; `shape`, where present, the same picture with
 * its dark outline thickened (made by tools/make-art.py for an emblem): what a mosaic's
 * blocks are chosen on, while their colours stay the picture's own.
 */
export type Pixmap = { w: number; h: number; rgba: string; shape?: string }
type Pixels = { w: number; h: number; data: Uint8Array }

const DEFAULT = 0x01000000
const SPACE = 0x20
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄

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
    if (typeof v.w !== 'number' || typeof v.h !== 'number' || typeof v.rgba !== 'string') return null
    return typeof v.shape === 'string' ? { w: v.w, h: v.h, rgba: v.rgba, shape: v.shape } : { w: v.w, h: v.h, rgba: v.rgba }
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

/** A glyph's shape: which of a cell's points, (u, v) in [0, 1) from its top left, are its ink. */
type Shape = (u: number, v: number) => boolean

const lowerEighths = (k: number): Shape => (_u, v) => v >= 1 - k / 8
const leftEighths = (k: number): Shape => u => u < k / 8
const quadrants = (tl: boolean, tr: boolean, bl: boolean, br: boolean): Shape => (u, v) => (v < 0.5 ? (u < 0.5 ? tl : tr) : u < 0.5 ? bl : br)

/**
 * The block elements a cell may take (U+2580–259F: every terminal draws them, most from
 * their own geometry, no font needed): halves, eighths, the quadrants. With its two colours
 * a glyph splits a cell between them, so the set draws any edge level or upright to an
 * eighth of the cell, and a corner to a quarter.
 */
const SHAPES: readonly (readonly [number, Shape])[] = [
  [0x2588, () => true],
  [0x2580, (_u, v) => v < 0.5],
  [0x2594, (_u, v) => v < 1 / 8],
  ...[1, 2, 3, 4, 5, 6, 7].map(k => [0x2580 + k, lowerEighths(k)] as const),
  ...[1, 2, 3, 4, 5, 6, 7].map(k => [0x2590 - k, leftEighths(k)] as const),
  [0x2590, u => u >= 0.5],
  [0x2595, u => u >= 7 / 8],
  [0x2596, quadrants(false, false, true, false)],
  [0x2597, quadrants(false, false, false, true)],
  [0x2598, quadrants(true, false, false, false)],
  [0x259d, quadrants(false, true, false, false)],
  [0x2599, quadrants(true, false, true, true)],
  [0x259a, quadrants(true, false, false, true)],
  [0x259b, quadrants(true, true, true, false)],
  [0x259c, quadrants(true, true, false, true)],
  [0x259e, quadrants(false, true, true, false)],
  [0x259f, quadrants(false, true, true, true)],
]

// The points a cell is judged at: SU across, SV down (a cell is twice as tall as wide).
const SU = 8
const SV = 16
/** Each shape's ink at those points, row-major. */
const INK: readonly (readonly [number, readonly boolean[]])[] = SHAPES.map(([glyph, shape]) => {
  const ink: boolean[] = []
  for (let j = 0; j < SV; j += 1) for (let i = 0; i < SU; i += 1) ink.push(shape((i + 0.5) / SU, (j + 0.5) / SV))
  return [glyph, ink] as const
})

/** The cogitator's glass: what the picture's transparency shows, unless told otherwise. */
const GLASS = 0x0e0a05

/** A channel on an 8-step grid, so fewer colour pairs reach the terminal's palette. */
function step(v: number): number {
  return Math.min(255, Math.round(v / 8) * 8)
}

function rgbOf(r: number, g: number, b: number): number {
  return (step(r) << 16) | (step(g) << 8) | step(b)
}

/** Is a colour the ground's own (within a step), so the terminal's default can stand for it? */
function isGround(rgb: number, ground: number): boolean {
  return (
    Math.abs(((rgb >> 16) & 0xff) - ((ground >> 16) & 0xff)) <= 8 &&
    Math.abs(((rgb >> 8) & 0xff) - ((ground >> 8) & 0xff)) <= 8 &&
    Math.abs((rgb & 0xff) - (ground & 0xff)) <= 8
  )
}

/** Mosaics drawn so far, by pixmap, box and ground: a redraw of the tab draws none anew. */
const mosaics = new WeakMap<Pixmap, Map<string, number[]>>()

/**
 * A picture in blocks, as close to it as a cell grid allows: each cell the block element and
 * the two colours (its ink, its ground) that differ least from the picture's pixels there,
 * the picture laid over `ground` (the terminal's background) where it is transparent. A
 * colour that is the ground's own is left to the terminal's default, so the cells sit on
 * whatever is behind them.
 */
export function mosaicCells(p: Pixmap, columns: number, rows: number, ground: number = GLASS): string {
  return packCells(mosaicWords(p, columns, rows, ground))
}

/** One run of a mosaic's row: its glyphs and their colours (`#rrggbb`, null the terminal's own). */
export type Run = { text: string; fg: string | null; bg: string | null }

const hexOf = (rgb: number): string | null => (rgb === DEFAULT ? null : `#${rgb.toString(16).padStart(6, '0')}`)

/**
 * The same mosaic as rows of text runs, each run the cells of one colour pair: what a
 * Text draws in the colours exactly (a Raster's palette rounds them to the terminal's 256,
 * and gold goes olive and rose).
 */
export function mosaicRuns(p: Pixmap, columns: number, rows: number, ground: number = GLASS): Run[][] {
  const words = mosaicWords(p, columns, rows, ground)
  const out: Run[][] = []
  for (let row = 0; row < rows; row += 1) {
    const runs: Run[] = []
    for (let col = 0; col < columns; col += 1) {
      const at = (row * columns + col) * 3
      const text = String.fromCharCode(words[at] ?? SPACE)
      const fg = hexOf(words[at + 1] ?? DEFAULT)
      const bg = hexOf(words[at + 2] ?? DEFAULT)
      const last = runs.at(-1)
      if (last !== undefined && last.fg === fg && last.bg === bg) last.text += text
      else runs.push({ text, fg, bg })
    }
    out.push(runs)
  }
  return out
}

/** An sRGB channel (0..255) in linear light (0..1), where colours mix as light does. */
function linear(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** A linear-light channel back to sRGB, 0..255. */
function srgb(v: number): number {
  const c = Math.min(1, Math.max(0, v))
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
}

type Rgb = readonly [number, number, number]

/**
 * The mean colour of a cell's points under a glyph's ink (`on`) and around it (`off`); a
 * side with no points takes the other's, so a full block's ground is its ink.
 */
function split(ink: readonly boolean[], r: Float64Array, g: Float64Array, b: Float64Array): { on: Rgb; off: Rgb } {
  let r1 = 0
  let g1 = 0
  let b1 = 0
  let n1 = 0
  let r0 = 0
  let g0 = 0
  let b0 = 0
  for (let k = 0; k < r.length; k += 1) {
    if (ink[k] === true) {
      r1 += r[k] ?? 0
      g1 += g[k] ?? 0
      b1 += b[k] ?? 0
      n1 += 1
    } else {
      r0 += r[k] ?? 0
      g0 += g[k] ?? 0
      b0 += b[k] ?? 0
    }
  }
  const n0 = r.length - n1
  const on: Rgb = n1 > 0 ? [r1 / n1, g1 / n1, b1 / n1] : [r0 / n0, g0 / n0, b0 / n0]
  const off: Rgb = n0 > 0 ? [r0 / n0, g0 / n0, b0 / n0] : on
  return { on, off }
}

/**
 * The mosaic's cells as (glyph, fg, bg) words, row-major; drawn once per pixmap, box and
 * ground. The blocks are chosen on the pixmap's `shape` (the picture with its dark outline
 * thickened, so feathers stay apart) where it has one; their two colours are the picture's
 * own there, averaged in linear light, so the gold keeps its brightness.
 */
function mosaicWords(p: Pixmap, columns: number, rows: number, ground: number): number[] {
  const key = `${columns}x${rows}@${ground}`
  const known = mosaics.get(p)?.get(key)
  if (known !== undefined) return known
  const px = pixelsOf(p)
  const shaped = p.shape === undefined || px === null ? null : pixelsOf({ w: p.w, h: p.h, rgba: p.shape })
  const sx = shaped ?? px
  const words: number[] = []
  const gr = (ground >> 16) & 0xff
  const gg = (ground >> 8) & 0xff
  const gb = ground & 0xff
  const n = SU * SV
  // the shape over the ground, sRGB (what the blocks are judged on) …
  const sr = new Float64Array(n)
  const sg = new Float64Array(n)
  const sb = new Float64Array(n)
  // … and the picture over the ground, linear light (what the colours are made of)
  const lr = new Float64Array(n)
  const lg = new Float64Array(n)
  const lb = new Float64Array(n)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (px === null || sx === null) {
        words.push(SPACE, DEFAULT, DEFAULT)
        continue
      }
      for (let j = 0; j < SV; j += 1) {
        const y = Math.min(px.h - 1, Math.floor(((row + (j + 0.5) / SV) / rows) * px.h))
        for (let i = 0; i < SU; i += 1) {
          const x = Math.min(px.w - 1, Math.floor(((col + (i + 0.5) / SU) / columns) * px.w))
          const at = (y * px.w + x) * 4
          const k = j * SU + i
          const sa = (sx.data[at + 3] ?? 0) / 255
          const pa = (px.data[at + 3] ?? 0) / 255
          sr[k] = (sx.data[at] ?? 0) * sa + gr * (1 - sa)
          sg[k] = (sx.data[at + 1] ?? 0) * sa + gg * (1 - sa)
          sb[k] = (sx.data[at + 2] ?? 0) * sa + gb * (1 - sa)
          lr[k] = linear((px.data[at] ?? 0) * pa + gr * (1 - pa))
          lg[k] = linear((px.data[at + 1] ?? 0) * pa + gg * (1 - pa))
          lb[k] = linear((px.data[at + 2] ?? 0) * pa + gb * (1 - pa))
        }
      }
      // The block whose two flat colours fit the shape there best.
      let best = Number.POSITIVE_INFINITY
      let chosen: readonly boolean[] = INK[0]?.[1] ?? []
      let glyph = 0x2588
      for (const [code, ink] of INK) {
        const inked = split(ink, sr, sg, sb)
        let err = 0
        for (let k = 0; k < n && err < best; k += 1) {
          const m = ink[k] === true ? inked.on : inked.off
          const dr = (sr[k] ?? 0) - m[0]
          const dg = (sg[k] ?? 0) - m[1]
          const db = (sb[k] ?? 0) - m[2]
          err += dr * dr + dg * dg + db * db
        }
        if (err < best) {
          best = err
          glyph = code
          chosen = ink
        }
      }
      // Its colours: the picture's own under its ink and around it, mixed as light.
      const mixed = split(chosen, lr, lg, lb)
      const fg = rgbOf(srgb(mixed.on[0]), srgb(mixed.on[1]), srgb(mixed.on[2]))
      const bg = rgbOf(srgb(mixed.off[0]), srgb(mixed.off[1]), srgb(mixed.off[2]))
      const fgGround = isGround(fg, ground)
      const bgGround = isGround(bg, ground)
      if (glyph === 0x2588 ? fgGround : fgGround && bgGround) words.push(SPACE, DEFAULT, DEFAULT)
      else words.push(glyph, fg, glyph === 0x2588 || bgGround ? DEFAULT : bg)
    }
  }
  const byBox = mosaics.get(p) ?? new Map<string, number[]>()
  byBox.set(key, words)
  mosaics.set(p, byBox)
  return words
}
