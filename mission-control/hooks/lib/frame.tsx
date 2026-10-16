import type { ElementTable } from 'claude-code'

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

  const edge = (parts: Part[], titleColor: string) => (
    <Text wrap="truncate-end">
      {parts.map(p => (
        <Text color={p.role === 'frame' ? slate.frame : p.role === 'title' ? titleColor : c.muted} bold={p.role === 'title'}>
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
  }): JSX.Element[] => {
    const g = FRAME[o.style]
    const w = Math.max(8, o.width)
    const lead = o.lead ?? ''
    const stem = o.stem ?? ''
    const side = (text: string) => <Text color={slate.frame}>{text}</Text>
    const out: JSX.Element[] = []
    out.push(
      <Box flexDirection="row">
        {lead.length > 0 ? <Text color={c.muted}>{lead}</Text> : ''}
        {edge(edgeTop(o.style, w, o.title, o.meta), o.titleColor ?? c.accent)}
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
        {edge(edgeBottom(o.style, w, o.foot), c.muted)}
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

  return { panel, crest, strip, gauge, keys, edge }
}
