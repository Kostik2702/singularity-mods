// Pure drawing helpers for the pane: strings and numbers only, no `$`, no JSX.

/**
 * Dark palette. Series and status steps are the dataviz skill's validated dark
 * column (all checks pass on #1a1a19, run 2026-10-02); inks are toned below pure
 * white so the column does not glare next to the transcript.
 */
export const COLORS = {
  surface: '#1a1a19',
  rule: '#2c2c2a',
  track: '#243245',
  ink: '#e8e6df',
  ink2: '#c3c2b7',
  muted: '#898781',
  /** Meter fill at rest: neutral, so no meter borrows a series colour (blue already means "hooks"). */
  accent: '#9aa5b8',
  /** Categorical, fixed order: hooks, CLAUDE.md, mb search, code. */
  hooks: '#3987e5',
  claudeMd: '#d95926',
  search: '#199e70',
  code: '#c98500',
  /** Status: never a series colour, always beside an icon and a label. */
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

const GLYPHS: Record<string, readonly [string, string, string]> = {
  '0': ['█▀█', '█ █', '█▄█'],
  '1': ['▀█ ', ' █ ', '▄█▄'],
  '2': ['▀▀█', '█▀▀', '█▄▄'],
  '3': ['▀▀█', ' ▀█', '▄▄█'],
  '4': ['█ █', '▀▀█', '  █'],
  '5': ['█▀▀', '▀▀█', '▄▄█'],
  '6': ['█▀▀', '█▀█', '█▄█'],
  '7': ['▀▀█', '  █', '  █'],
  '8': ['█▀█', '█▀█', '█▄█'],
  '9': ['█▀█', '▀▀█', '▄▄█'],
  '.': [' ', ' ', '▄'],
  k: ['█  ', '█▄▀', '█ █'],
  M: ['█▄ ▄█', '█ ▀ █', '█   █'],
}

/** A short figure ("10.4k") as three rows of block glyphs, one column between glyphs. */
export function bigText(text: string): [string, string, string] {
  const rows: [string, string, string] = ['', '', '']
  const glyphs = [...text].map(ch => GLYPHS[ch]).filter((g): g is readonly [string, string, string] => g !== undefined)
  glyphs.forEach((g, i) => {
    const sep = i === 0 ? '' : ' '
    rows[0] += sep + g[0]
    rows[1] += sep + g[1]
    rows[2] += sep + g[2]
  })
  return rows
}

/**
 * Splits `width` cells among `values` for a stacked bar, one gap cell between
 * non-empty segments. A non-zero value always gets at least one cell, so a small
 * source stays visible; the rest is shared by largest remainder.
 */
export function allocate(values: readonly number[], width: number): number[] {
  const live = values.map(v => v > 0)
  const count = live.filter(Boolean).length
  const total = values.reduce((acc, v) => acc + Math.max(0, v), 0)
  if (count === 0 || total === 0) return values.map(() => 0)
  const room = Math.max(count, width - (count - 1))
  const spare = room - count
  const exact = values.map(v => (v > 0 ? (v / total) * spare : 0))
  const cells = exact.map((x, i) => (live[i] ? 1 + Math.floor(x) : 0))
  let left = room - cells.reduce((a, b) => a + b, 0)
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .filter(o => live[o.i])
    .sort((a, b) => b.rem - a.rem)
  for (const o of order) {
    if (left <= 0) break
    cells[o.i] = (cells[o.i] ?? 0) + 1
    left -= 1
  }
  return cells
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A meter of `width` cells at `fraction` (0..1): whole cells, one eighth-step cell, the track. */
export function meter(fraction: number, width: number): { fill: string; track: string } {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  const eighths = Math.round(f * width * 8)
  const whole = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8] ?? ''
  const fill = '█'.repeat(whole) + part
  return { fill, track: '█'.repeat(Math.max(0, width - whole - (part === '' ? 0 : 1))) }
}

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** One cell per turn: a bar scaled to the largest value, `·` for a turn with nothing. */
export function sparkline(values: readonly number[]): string {
  const max = Math.max(0, ...values)
  return values
    .map(v => {
      if (v <= 0 || max <= 0) return '·'
      const step = Math.min(BARS.length - 1, Math.max(0, Math.ceil((v / max) * BARS.length) - 1))
      return BARS[step] ?? '·'
    })
    .join('')
}

/** "── Title ─────" to `width` cells. */
export function rule(title: string, width: number): { lead: string; title: string; tail: string } {
  const lead = '── '
  const tail = '─'.repeat(Math.max(0, width - lead.length - title.length - 1))
  return { lead, title: `${title} `, tail }
}

/** 45000 -> "45с", 134000 -> "2м14с", 3900000 -> "1ч05м". */
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (hours > 0) return `${hours}ч${String(mins).padStart(2, '0')}м`
  if (mins > 0) return `${mins}м${String(s % 60).padStart(2, '0')}с`
  return `${s}с`
}

/** Russian plural: plural(5, ['шаг', 'шага', 'шагов']) -> "шагов". */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/** Percent of a part in a whole, rounded; '0' when the whole is empty. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}
