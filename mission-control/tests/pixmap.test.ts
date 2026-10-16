import { describe, expect, test } from 'claude-code/testing'

import { mosaicCells, mosaicRuns } from '../hooks/lib/pixmap'
import type { Pixmap } from '../hooks/lib/pixmap'

// Colours on the mosaic's 8-step grid, so they come back exactly.
const GOLD = [248, 192, 80, 255]
const RED = [232, 64, 48, 255]
const NONE = [0, 0, 0, 0]
const GOLD_RGB = (248 << 16) | (192 << 8) | 80
const RED_RGB = (232 << 16) | (64 << 8) | 48
const DEFAULT = 0x01000000

/** An 8 × 8 pixmap (one cell) where `on(x, y)` picks `a`, else `b`. */
function cell(on: (x: number, y: number) => boolean, a: number[] = GOLD, b: number[] = NONE): Pixmap {
  const bytes: number[] = []
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bytes.push(...(on(x, y) ? a : b))
  return { w: 8, h: 8, rgba: btoa(String.fromCharCode(...bytes)) }
}

/** A Raster's packed cells back into (glyph, fg, bg) words. */
function cellsOf(packed: string): { glyph: number; fg: number; bg: number }[] {
  const bytes = Uint8Array.from(atob(packed), ch => ch.charCodeAt(0))
  const words: number[] = []
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    words.push(((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24)) >>> 0)
  }
  const cells: { glyph: number; fg: number; bg: number }[] = []
  for (let i = 0; i + 2 < words.length; i += 3) cells.push({ glyph: words[i] ?? 0, fg: words[i + 1] ?? 0, bg: words[i + 2] ?? 0 })
  return cells
}

const one = (p: Pixmap) => cellsOf(mosaicCells(p, 1, 1))[0]

describe('mosaicCells: a picture in blocks, two colours a cell', () => {
  test('the left half gold: a left half block, the ground left to the terminal', () => {
    expect(one(cell(x => x < 4))).toEqual({ glyph: 0x258c, fg: GOLD_RGB, bg: DEFAULT })
  })

  test('the upper half gold: an upper half block', () => {
    expect(one(cell((_x, y) => y < 4))).toEqual({ glyph: 0x2580, fg: GOLD_RGB, bg: DEFAULT })
  })

  test('the lower three eighths gold: the lower three-eighths block', () => {
    expect(one(cell((_x, y) => y >= 5))).toEqual({ glyph: 0x2583, fg: GOLD_RGB, bg: DEFAULT })
  })

  test('the upper left quarter gold: its quadrant', () => {
    expect(one(cell((x, y) => x < 4 && y < 4))).toEqual({ glyph: 0x2598, fg: GOLD_RGB, bg: DEFAULT })
  })

  test('two inks in one cell: the glyph between them, each its own colour', () => {
    expect(one(cell((_x, y) => y < 4, GOLD, RED))).toEqual({ glyph: 0x2580, fg: GOLD_RGB, bg: RED_RGB })
  })

  test('all gold is a full block; nothing is a blank cell in the terminal’s own colours', () => {
    expect(one(cell(() => true))).toEqual({ glyph: 0x2588, fg: GOLD_RGB, bg: DEFAULT })
    expect(one(cell(() => false))).toEqual({ glyph: 0x20, fg: DEFAULT, bg: DEFAULT })
  })

  test('a shape pixmap decides the blocks; the picture itself gives their colours', () => {
    // the picture all gold; its shape (the outline thickened) dark on the right half
    const picture = cell(() => true)
    const shape = cell(x => x < 4, GOLD, [20, 12, 4, 255])
    expect(one({ ...picture, shape: shape.rgba })).toEqual({ glyph: 0x258c, fg: GOLD_RGB, bg: GOLD_RGB })
  })

  test('the box is filled cell by cell, row-major', () => {
    const cells = cellsOf(mosaicCells(cell(x => x < 4), 2, 1))
    expect(cells.length).toBe(2)
    // each cell sees half the pixmap: the left one all gold, the right one all ground
    expect(cells[0]?.glyph).toBe(0x2588)
    expect(cells[1]?.glyph).toBe(0x20)
  })

  test('every glyph is a block element, printable and one cell wide', () => {
    const p = cell((x, y) => (x * 7 + y * 3) % 5 < 2, GOLD, RED)
    for (const c of cellsOf(mosaicCells(p, 3, 2))) {
      expect(c.glyph === 0x20 || (c.glyph >= 0x2580 && c.glyph <= 0x259f)).toBe(true)
    }
  })
})

describe('mosaicRuns: the mosaic as text runs, for the exact colours a Raster does not keep', () => {
  test('a row is cut where the colours change; the ground is left to the terminal', () => {
    // 3 cells: gold, gold, nothing
    const bytes: number[] = []
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 24; x += 1) bytes.push(...(x < 16 ? GOLD : NONE))
    const rows = mosaicRuns({ w: 24, h: 8, rgba: btoa(String.fromCharCode(...bytes)) }, 3, 1)
    expect(rows).toEqual([[{ text: '██', fg: '#f8c050', bg: null }, { text: ' ', fg: null, bg: null }]])
  })

  test('two inks in a cell keep both, as the cells do', () => {
    expect(mosaicRuns(cell((_x, y) => y < 4, GOLD, RED), 1, 1)).toEqual([[{ text: '▀', fg: '#f8c050', bg: '#e84030' }]])
  })

  test('every row is exactly as wide as the box', () => {
    const p = cell((x, y) => (x * 7 + y * 3) % 5 < 2, GOLD, RED)
    for (const row of mosaicRuns(p, 5, 3)) expect(row.map(r => r.text).join('').length).toBe(5)
  })
})
