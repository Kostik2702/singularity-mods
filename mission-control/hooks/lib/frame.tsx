import type { ElementTable } from 'claude-code'

import { AQUILA_PIXMAP, AQUILA_PNG, AQUILA_PNG_SIZE } from './art'
import { brailleCells, halfBlockCells } from './pixmap'
import type { Pixmap } from './pixmap'
import { cogCells, hex } from './cog'
import type { CogPalette } from './cog'
import type { Slate, Theme } from './theme'

// The parts of a data-slate: framed panels with name plates, the crest, the status
// strip, gauges and key caps. Every part is laid out here to an exact number of cells
// and drawn one element per screen row, so a tab can count its rows and every right
// edge lands on the same column. Pure: strings and trees, no `$`.

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

export type FrameStyle = 'double' | 'heavy' | 'light'

type Glyphs = { tl: string; tr: string; bl: string; br: string; h: string; v: string; open: string; close: string }

/** Corners, edges and the two halves of a plate (`╡ name ╞`) per frame style. */
export const FRAME: Record<FrameStyle, Glyphs> = {
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', open: '╡', close: '╞' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃', open: '┫', close: '┣' },
  light: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', open: '┤', close: '├' },
}

/** Cells a string takes: every glyph a slate draws is one cell. */
export function cells(text: string): number {
  return [...text].length
}

/** Cut to `max` cells, an ellipsis in the last when it runs on. */
export function fit(text: string, max: number): string {
  const glyphs = [...text]
  if (glyphs.length <= max) return text
  if (max <= 0) return ''
  return `${glyphs.slice(0, max - 1).join('')}…`
}

/** A run of an edge: `role` says how it is coloured. */
export type Part = { text: string; role: 'frame' | 'title' | 'meta' }

/**
 * A top edge of `width` cells: `╔═╡ title ╞════╡ meta ╞═╗`. The meta plate goes first
 * when the two do not fit, then the title is cut; never wider than `width`.
 */
export function edgeTop(style: FrameStyle, width: number, title: string, meta = ''): Part[] {
  const g = FRAME[style]
  const w = Math.max(4, width)
  // ╔═╡ + ' title ' + ╞ … ╡ + ' meta ' + ╞═╗
  const fixed = 3 + 1 + 1
  let shownMeta = meta
  let room = w - fixed - (shownMeta.length > 0 ? cells(shownMeta) + 4 : 0) - 1
  if (shownMeta.length > 0 && room < Math.min(8, cells(title) + 2)) {
    shownMeta = ''
    room = w - fixed - 1
  }
  // No room for even « … » between the plate's halves: the edge goes without a title.
  if (title.length === 0 || room < 3) {
    const fill = w - 2 - (shownMeta.length > 0 ? cells(shownMeta) + 5 : 0)
    const parts: Part[] = [{ text: g.tl + g.h.repeat(Math.max(0, fill)), role: 'frame' }]
    if (shownMeta.length > 0) parts.push({ text: g.open, role: 'frame' }, { text: ` ${shownMeta} `, role: 'meta' }, { text: g.close + g.h, role: 'frame' })
    parts.push({ text: g.tr, role: 'frame' })
    return parts
  }
  const name = ` ${fit(title, Math.max(1, room - 2))} `
  const metaCells = shownMeta.length > 0 ? cells(shownMeta) + 4 : 0
  const fill = Math.max(0, w - 3 - cells(name) - 1 - metaCells - 2)
  const parts: Part[] = [
    { text: g.tl + g.h + g.open, role: 'frame' },
    { text: name, role: 'title' },
    { text: g.close + g.h.repeat(fill), role: 'frame' },
  ]
  if (shownMeta.length > 0) parts.push({ text: g.open, role: 'frame' }, { text: ` ${shownMeta} `, role: 'meta' }, { text: g.close, role: 'frame' })
  parts.push({ text: g.h + g.tr, role: 'frame' })
  return parts
}

/** A bottom edge of `width` cells, with an optional stamp near its right end: `╚════╡ 0x2A7F ╞═╝`. */
export function edgeBottom(style: FrameStyle, width: number, stamp = ''): Part[] {
  const g = FRAME[style]
  const w = Math.max(4, width)
  const stampCells = stamp.length > 0 ? cells(stamp) + 4 : 0
  if (stamp.length === 0 || w - 4 - stampCells < 2) return [{ text: g.bl + g.h.repeat(w - 2) + g.br, role: 'frame' }]
  return [
    { text: g.bl + g.h.repeat(w - 4 - stampCells + 1), role: 'frame' },
    { text: g.open, role: 'frame' },
    { text: ` ${stamp} `, role: 'meta' },
    { text: g.close + g.h + g.br, role: 'frame' },
  ]
}

/** Greedy word wrap into lines of at most `width` cells; a word wider than a line is cut. */
export function wrapLines(text: string, width: number, max = Number.POSITIVE_INFINITY): string[] {
  const w = Math.max(4, width)
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(x => x.length > 0)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (cells(candidate) <= w) {
      line = candidate
      continue
    }
    if (line.length > 0) lines.push(line)
    line = cells(word) <= w ? word : fit(word, w)
  }
  if (line.length > 0) lines.push(line)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  kept[max - 1] = fit(`${kept[max - 1] ?? ''}…`, w)
  return kept
}

const MIRROR: Record<string, string> = { '▌': '▐', '▐': '▌', '▖': '▗', '▗': '▖', '▘': '▝', '▝': '▘' }

function mirror(text: string): string {
  return [...text]
    .reverse()
    .map(ch => MIRROR[ch] ?? ch)
    .join('')
}

const CREST_LEFT = ['▄▄▄▄▄▄▄▄▄▄▄▄▄   ▗▄▖', ' ▀▀███████████▄▄▐█▀', '    ▀▀▀▀▀██████▄▐█▄', '           ▀▀▀▀▀▀█▀']
const CREST_MID = [' ', '▄', '✠', '█']

/** The Imperial aquila, two heads and spread wings, built symmetric from its left half: 39 cells across. */
export const CREST: readonly string[] = CREST_LEFT.map((left, i) => left + (CREST_MID[i] ?? ' ') + mirror(left))

/** The crest centred in `width` cells; null when the column is narrower than it. */
export function crestLines(width: number): string[] | null {
  const across = Math.max(...CREST.map(cells))
  if (width < across) return null
  const left = Math.floor((width - across) / 2)
  return CREST.map(row => ' '.repeat(left) + row.padEnd(across) + ' '.repeat(width - left - across))
}

/** The cog on the Agents tab: its Raster's key and box, turned a little more each frame while agents work. */
export const COG = { key: 'cog', columns: 10, rows: 5 } as const

/** A servo-skull in place of the cog: its Image's key and box, and the frames it cycles through. */
export const SKULL = { key: 'skull', columns: 12, rows: 9, frames: 12, frameMs: 250 } as const

/** The frame of the servo-skull at `now` in the folder `dir` (frame-00.png ...), the same on every redraw and blit. */
export function skullFrame(dir: string, now: number): string {
  const k = Math.floor(now / SKULL.frameMs) % SKULL.frames
  return `${dir.replace(/[\\/]+$/, '')}/frame-${String(k).padStart(2, '0')}.png`
}

/** A rank's portrait on Легион: a square picture in a box of 6 x 3 cells, a cell's gap after it. */
export const PORTRAIT = { columns: 6, rows: 3 } as const

/** A purity seal's picture is 5 wide to 24 tall; the Archives tab sizes its box to the blocks beside it. */
export const SEAL_ASPECT = { width: 5, height: 24 } as const

/** Radians the cog has turned at `now`: a slow, steady turn, the same on every redraw and blit. */
export function cogAngle(now: number): number {
  return ((now / 1000) * 1.7) % (Math.PI * 2)
}

/** The cog in the slate's brass, its hub the red eye of the Omnissiah. */
export function cogPalette(t: Theme, slate: Slate): CogPalette {
  return { light: hex(t.colors.accent), mid: hex(slate.frame), dark: hex(t.colors.track), hub: hex(t.colors.critical) }
}

/** The context fill (percent) from which the slate shows the warp's taint. */
export const WARP_AT = 80

/** Is the Machine Spirit overloaded: the context at or past WARP_AT? */
export function isWarped(percent: number | null | undefined): boolean {
  return typeof percent === 'number' && percent >= WARP_AT
}

const NOISE = ['▓', '░', '▒', '#', '%', '¤', '†', '‡', '?']

/** Binaric cant broken by the warp: a third of its cells turned to noise, the same within a second. */
export function corruptCant(text: string, seed: number): string {
  let n = Math.abs(Math.floor(seed)) % 2147483647 || 1
  return [...text]
    .map(ch => {
      n = (n * 48271) % 2147483647
      return ch !== ' ' && n % 3 === 0 ? (NOISE[n % NOISE.length] ?? ch) : ch
    })
    .join('')
}

const CANT_SOURCE = 'ОМНИССИЯ ВИДИТ ДУХ МАШИНЫ БДИТ ПЛОТЬ СЛАБА'

/**
 * A strip of binaric cant `width` cells long: bytes of a litany as eight-bit groups,
 * a cross between every few, shifted by `offset` cells so it crawls as time passes.
 */
export function binaryCant(width: number, offset: number): string {
  const groups: string[] = []
  for (const ch of CANT_SOURCE) groups.push(((ch.codePointAt(0) ?? 0) & 0xff).toString(2).padStart(8, '0'))
  const tape = groups.map((g, i) => (i % 4 === 3 ? `${g} ✠ ` : `${g} `)).join('')
  const loop = [...tape]
  const start = ((Math.floor(offset) % loop.length) + loop.length) % loop.length
  let out = ''
  for (let i = 0; i < width; i += 1) out += loop[(start + i) % loop.length] ?? ' '
  return out
}

/**
 * The date as the Imperium writes it: a check number, the part of the year passed in
 * thousandths, the year of the millennium, the millennium. 2026-10-16 is «0 789 026.M3».
 */
export function imperialDate(now: number): string {
  const d = new Date(now)
  const year = d.getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  const length = Date.UTC(year + 1, 0, 1) - start
  const part = Math.min(999, Math.floor(((now - start) / length) * 1000))
  const millennium = Math.floor(year / 1000) + 1
  return `0 ${String(part).padStart(3, '0')} ${String(year % 1000).padStart(3, '0')}.M${millennium}`
}

/** A reference stamp for a panel's bottom edge: four hex digits from `seed`, as a cogitator numbers its records. */
export function stamp(prefix: string, seed: number): string {
  const n = Math.abs(Math.floor(seed * 2654435761) % 0x10000)
  return `${prefix} 0x${n.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * The parts drawn with the surface's elements: framed panels, the crest, the strip,
 * the gauge and the key caps, all in the theme's palette and its slate's brass.
 */
export function slateKit(table: ElementTable, t: Theme, slate: Slate) {
  const { Box, Text } = table
  const c = t.colors

  const edge = (parts: Part[], titleColor: string, bezel: string = slate.frame) => (
    <Text wrap="truncate-end">
      {parts.map(p => (
        <Text color={p.role === 'frame' ? bezel : p.role === 'title' ? titleColor : c.muted} bold={p.role === 'title'}>
          {p.text}
        </Text>
      ))}
    </Text>
  )

  /**
   * A framed panel, one element per screen row: the top edge with its plates, each row
   * between the two sides, the bottom edge. `lead` goes before the top edge and `stem`
   * before every other row (a tree's connectors); `width` is the frame's own.
   */
  const panel = (o: {
    style: FrameStyle
    width: number
    title: string
    meta?: string
    foot?: string
    rows: readonly JSX.Element[]
    titleColor?: string
    lead?: string
    stem?: string
    /** The bezel's colour; the slate's brass by default (scarlet for the warp's taint). */
    frameColor?: string
  }): JSX.Element[] => {
    const g = FRAME[o.style]
    const bezel = o.frameColor ?? slate.frame
    const w = Math.max(8, o.width)
    const lead = o.lead ?? ''
    const stem = o.stem ?? ''
    const side = (text: string) => <Text color={bezel}>{text}</Text>
    const out: JSX.Element[] = []
    out.push(
      <Box flexDirection="row">
        {lead.length > 0 ? <Text color={c.muted}>{lead}</Text> : ''}
        {edge(edgeTop(o.style, w, o.title, o.meta), o.titleColor ?? c.accent, bezel)}
      </Box>,
    )
    for (const row of o.rows) {
      out.push(
        <Box flexDirection="row">
          {stem.length > 0 ? <Text color={c.muted}>{stem}</Text> : ''}
          {side(`${g.v} `)}
          <Box width={w - 4} overflow="hidden">
            {row}
          </Box>
          {side(` ${g.v}`)}
        </Box>,
      )
    }
    out.push(
      <Box flexDirection="row">
        {stem.length > 0 ? <Text color={c.muted}>{stem}</Text> : ''}
        {edge(edgeBottom(o.style, w, o.foot), c.muted, bezel)}
      </Box>,
    )
    return out
  }

  /** The crest in the accent, centred; [] when the column is too narrow for it. */
  const crest = (width: number): JSX.Element[] =>
    (crestLines(width) ?? []).map(row => (
      <Text color={c.accent} wrap="truncate-end">
        {row}
      </Text>
    ))

  /** An inverse strip across `width` cells: ` ✠ LEFT ……… RIGHT `, glass-coloured ink on the accent. */
  const strip = (left: string, right: string, width: number) => {
    const l = ` ✠ ${left}`
    const r = right.length > 0 ? `${right} ` : ''
    const room = width - cells(l) - cells(r)
    const text = room >= 1 ? l + ' '.repeat(room) + r : fit(l, width).padEnd(width)
    return (
      <Text backgroundColor={c.accent} color={c.surface} bold wrap="truncate-end">
        {text}
      </Text>
    )
  }

  /** A gauge of `width` cells between brass stops: `▕████▒▒▒▒▏`. */
  const gauge = (fraction: number, width: number, color: string) => {
    const inner = Math.max(2, width - 2)
    const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
    const full = Math.round(f * inner)
    return (
      <Text>
        <Text color={slate.frame}>▕</Text>
        <Text color={color}>{'█'.repeat(full)}</Text>
        <Text color={c.track}>{'▒'.repeat(inner - full)}</Text>
        <Text color={slate.frame}>▏</Text>
      </Text>
    )
  }

  /** Key caps: each command an inverse cap, a space between. */
  const keys = (list: readonly string[]) => (
    <Text wrap="truncate-end">
      {list.map((k, i) => (
        <Text>
          {i > 0 ? ' ' : ''}
          <Text backgroundColor={c.track} color={c.ink2}>
            {` ${k} `}
          </Text>
        </Text>
      ))}
    </Text>
  )

  // A terminal's table has Raster and Image; any other surface never draws a slate.
  const term = table as Partial<ElementTable<'terminal'>>

  /** The turning cog at `angle`, or null where the surface has no Raster. */
  const cog = (angle: number): JSX.Element | null => {
    const { Raster } = term
    if (Raster === undefined) return null
    return <Raster key={COG.key} columns={COG.columns} rows={COG.rows} cells={cogCells(COG.columns, COG.rows, angle, cogPalette(t, slate))} />
  }

  /**
   * The aquila as a picture `width` cells across (rows to keep its shape), from `file`
   * when the person chose one,
   * or null where the surface has no Image. Only where the terminal draws pictures:
   * elsewhere an Image draws its `alt`, so the caller keeps the block crest there.
   */
  const aquila = (width: number, file: string | null = null): { element: JSX.Element; rows: number } | null => {
    const { Image } = term
    if (Image === undefined) return null
    // A cell is twice as tall as wide: the box keeps the picture's shape at width × height / (2 × width px).
    const rows = Math.max(3, Math.round((width * AQUILA_PNG_SIZE.height) / (2 * AQUILA_PNG_SIZE.width)))
    // A picture the person chose (a PNG at 3 : 1, as tools/make-art.py --from makes it) is
    // read by the terminal from its file; else the aquila embedded in the mod.
    const source = file !== null ? { file, format: 'png' as const } : { png: AQUILA_PNG }
    return { element: <Image source={source} columns={width} rows={rows} alt="✠ аквила Империума ✠" />, rows }
  }

  /**
   * The instrument block of a tab's head: the cog (turning while `awake`) beside the
   * litany, the inverse status strip, a lamp with the machine's state, the crawling
   * binaric cant and the Imperial date. Null where the column is too narrow or the
   * surface has no Raster; the caller then draws the litany and the strip alone.
   * Takes COG.rows screen rows, or SKULL.rows with a servo-skull.
   */
  const instruments = (o: {
    width: number
    now: number
    litany: string | null
    strip: readonly [string, string]
    state: { label: string; awake: string; asleep: string }
    awake: boolean
    /** A servo-skull's frames in place of the cog, where the terminal draws pictures. */
    skullDir?: string | null
    /** The servo-skull's current frame as a pixmap, where the terminal draws no pictures. */
    skullPix?: Pixmap | null
    /** The warp's taint (the context past WARP_AT): the state overloaded, the cant broken. */
    warp?: boolean
  }): JSX.Element | null => {
    if (o.width < 44) return null
    const { Image } = term
    const skull =
      o.skullDir != null && Image !== undefined ? (
        <Image key={SKULL.key} source={{ file: skullFrame(o.skullDir, o.now), format: 'png' }} columns={SKULL.columns} rows={SKULL.rows} alt="☠" />
      ) : o.skullPix != null ? (
        picture(SKULL.key, o.skullPix, SKULL.columns, SKULL.rows)
      ) : null
    const wheel = skull ?? cog(cogAngle(o.now))
    if (wheel === null) return null
    const figure = skull !== null ? SKULL.columns : COG.columns
    const side = o.width - figure - 1
    const second = Math.floor(o.now / 1000)
    return (
      <Box flexDirection="row">
        <Box width={figure + 1} flexShrink={0}>
          {wheel}
        </Box>
        <Box flexDirection="column" width={side}>
          <Text color={c.accent} bold wrap="truncate-end">
            {o.litany ?? ''}
          </Text>
          {strip(o.strip[0], o.strip[1], side)}
          <Text wrap="truncate-end">
            <Text color={o.awake || o.warp === true ? c.critical : c.muted} bold>
              {o.warp === true || (o.awake && second % 2 === 0) ? '◉' : '○'}{' '}
            </Text>
            <Text color={c.muted}>{o.state.label} ▸ </Text>
            {o.warp === true ? (
              <Text color={c.critical} bold>
                ПЕРЕГРУЖЕН ‡ ВАРП-ПОРЧА
              </Text>
            ) : (
              <Text color={o.awake ? c.accent : c.muted} bold={o.awake}>
                {o.awake ? o.state.awake : o.state.asleep}
              </Text>
            )}
          </Text>
          <Text color={o.warp === true ? c.critical : c.rule} wrap="truncate-end">
            {o.warp === true ? corruptCant(binaryCant(side, second * 2), second) : binaryCant(side, o.awake ? second * 2 : 0)}
          </Text>
          <Text wrap="truncate-end">
            <Text color={c.muted}>ДАТА ИМПЕРИИ </Text>
            <Text color={c.ink2}>{imperialDate(o.now)}</Text>
          </Text>
        </Box>
      </Box>
    )
  }

  /**
   * The aquila in braille, for a terminal that draws no pictures: a sharp silhouette in the
   * emblem's own colour, from the chosen picture's pixmap or the mod's own; rows keep the
   * picture's shape (a cell is twice as tall as wide). Null where the surface has no Raster.
   */
  const aquilaDots = (width: number, pix: Pixmap | null = null): { element: JSX.Element; rows: number } | null => {
    const { Raster } = term
    if (Raster === undefined) return null
    const source = pix ?? AQUILA_PIXMAP
    const rows = Math.max(3, Math.round((width * source.h) / (2 * source.w)))
    return { element: <Raster key="crest" columns={width} rows={rows} cells={brailleCells(source, width, rows)} />, rows }
  }

  /** A photograph in half blocks at `columns` × `rows`, for a terminal that draws no pictures. */
  const picture = (key: string, pix: Pixmap, columns: number, rows: number): JSX.Element | null => {
    const { Raster } = term
    if (Raster === undefined) return null
    return <Raster key={key} columns={columns} rows={rows} cells={halfBlockCells(pix, columns, rows)} />
  }

  return { panel, crest, strip, gauge, keys, edge, cog, aquila, aquilaDots, picture, instruments }
}
