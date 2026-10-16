// A Mechanicus cog as a Raster's cells: drawn at any angle, two pixels to a cell (a
// half block, its top pixel in the foreground and its bottom one in the background),
// so it turns smoothly when the Agents tab blits a frame after a frame. Pure: numbers
// and strings, no `$`.

/** The terminal's default colour in a Raster cell (bit 24 alone). */
const DEFAULT = 0x01000000
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20

/** Teeth on the rim. */
const TEETH = 8

export type CogPalette = { light: number; mid: number; dark: number; hub: number }

/** '#a8823c' → 0xa8823c. */
export function hex(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16) & 0xffffff
}

/**
 * The colour of the cog's pixel at (x, y) in a `size` × `size` square, or null where
 * the cog is not: a rim with teeth, a dark ring, spokes and a hub, turned by `angle`
 * (radians), lit from the upper left.
 */
export function cogPixel(x: number, y: number, size: number, angle: number, p: CogPalette): number | null {
  const c = (size - 1) / 2
  const dx = x - c
  const dy = y - c
  const r = Math.hypot(dx, dy) / (size / 2)
  const a = Math.atan2(dy, dx) - angle
  const tooth = Math.cos(a * TEETH) > 0.25
  const outer = tooth ? 1.0 : 0.8
  if (r > outer) return null
  const lit = (-dx - dy) / (size * 0.7) // upper left is brighter
  if (r > 0.62) return lit > 0.15 ? p.light : lit < -0.25 ? p.dark : p.mid
  if (r > 0.5) return p.dark
  // Four spokes turn with the rim; between them the wheel is open.
  const spoke = Math.abs(Math.sin(a * 2)) < 0.38
  if (r > 0.24) return spoke ? p.mid : null
  return r > 0.13 ? p.hub : p.dark
}

/** Little-endian u32 words, standard padded base64, as a Raster's `cells` takes them. */
export function packCells(words: readonly number[]): string {
  const bytes = new Uint8Array(words.length * 4)
  words.forEach((w, i) => {
    bytes[i * 4] = w & 0xff
    bytes[i * 4 + 1] = (w >>> 8) & 0xff
    bytes[i * 4 + 2] = (w >>> 16) & 0xff
    bytes[i * 4 + 3] = (w >>> 24) & 0xff
  })
  return toBase64(bytes)
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63] ?? ''
    out += ALPHABET[(n >> 12) & 63] ?? ''
    out += i + 1 < bytes.length ? (ALPHABET[(n >> 6) & 63] ?? '') : '='
    out += i + 2 < bytes.length ? (ALPHABET[n & 63] ?? '') : '='
  }
  return out
}

/**
 * One frame of the cog in a box of `columns` × `rows` cells (a square of `columns`
 * pixels across and `rows * 2` down, the cog centred in it), as Raster `cells`.
 */
export function cogCells(columns: number, rows: number, angle: number, p: CogPalette): string {
  const size = Math.min(columns, rows * 2)
  const ox = Math.floor((columns - size) / 2)
  const oy = Math.floor((rows * 2 - size) / 2)
  const at = (x: number, y: number): number | null => {
    const px = x - ox
    const py = y - oy
    if (px < 0 || py < 0 || px >= size || py >= size) return null
    return cogPixel(px, py, size, angle, p)
  }
  const words: number[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const top = at(col, row * 2)
      const bottom = at(col, row * 2 + 1)
      if (top !== null) words.push(UPPER, top, bottom ?? DEFAULT)
      else if (bottom !== null) words.push(LOWER, bottom, DEFAULT)
      else words.push(SPACE, DEFAULT, DEFAULT)
    }
  }
  return packCells(words)
}
