import type { ElementTable } from 'claude-code'

import { fmtTokens } from './parse'
import { cells, fit, imperialDate, slateKit } from './frame'
import type { Pixmap } from './pixmap'
import type { Slate, Theme } from './theme'

// The herald: the slate's own card under the engine's logo, in the band above the prompt
// while the conversation is empty. The engine's logo has no render site, so the card
// stands right under it instead: the aquila, then the session in the cogitator's words.
// It gives way to the usual band once the first prompt is sent. Pure: a tree, no `$`.

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

/** The card never grows wider than this, so it reads as a card and not a rule across the screen. */
export const HERALD_MAX_COLS = 96
/** The aquila stands at most this many rows tall over the card. */
export const HERALD_CREST_ROWS = 8

/** What the card says: the session's facts, read by the band's hook. */
export type HeraldData = {
  /** The band's columns and rows (AbovePrompt's bodyColumns and maxRows). */
  cols: number
  maxRows: number
  now: number
  /** Milliseconds into the awakening, null once it is over. */
  booting: number | null
  /** The fraction of the awakening's gauge, 0..1. */
  bootFill: number
  version: string | null
  model: string | null
  /** The project's directory, the home folder as `~`. */
  place: string | null
  branch: string | null
  hookTokens: number
  claudeMdTokens: number | null
  /** The vault's alarms in words; empty when there are none. */
  alarms: readonly string[]
  fiveHour: number | null
  sevenDay: number | null
  /** Draw the aquila as a picture (the terminal draws them), else in blocks. */
  pictures: boolean
  crestFile: string | null
  crestPix: Pixmap | null
}

/** The label column: every label padded to one width, so the arrows line up. */
const LABELS = { spirit: 'ДУХ МАШИНЫ', place: 'ПРИЧАЛ', archives: 'АРХИВЫ', quota: 'КВОТА', order: 'НАКАЗ', keys: 'КОМАНДЫ' } as const
const LABEL_CELLS = Math.max(...Object.values(LABELS).map(cells))

/**
 * A model's id as the engine's logo names it: `claude-opus-5-5` → `Opus 5.5`, a
 * `[1m]` window as `· 1M`; any other name as it is.
 */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id.trim())
  const family = m?.[1]
  if (m === null || family === undefined) return id
  const minor = m[3] === undefined ? '' : `.${m[3]}`
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${m[2] ?? ''}${minor}${m[4] === undefined ? '' : ' · 1M'}`
}

/** The branch a `.git/HEAD` names: `ref: refs/heads/main` → `main`, a detached head as `@` and seven hex digits. */
export function branchOf(head: string): string | null {
  const text = head.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text)?.[1]
  if (ref !== undefined) return ref
  return /^[0-9a-f]{7,}$/i.test(text) ? `@${text.slice(0, 7)}` : null
}

/** The home folder as `~`, so a path reads as the engine's logo writes it. */
export function homeShort(path: string, home: string | null): string {
  if (home === null || home.length === 0) return path
  const h = home.replace(/[\\/]+$/, '')
  if (path === h) return '~'
  return path.startsWith(`${h}/`) || path.startsWith(`${h}\\`) ? `~${path.slice(h.length)}` : path
}

/** The rows the card's frame takes, its two edges included. */
export function heraldFrameRows(d: Pick<HeraldData, 'fiveHour' | 'sevenDay'>): number {
  const quota = d.fiveHour !== null || d.sevenDay !== null ? 1 : 0
  // strip, spirit, place, archives, [quota], order, keys, and the two edges
  return 2 + 6 + quota
}

/**
 * The card: the aquila centred over a double frame, «✠ КОГИТАТОР ИМПЕРИУМА ✠» on its
 * plate and the version beside it, the status strip (the awakening's gauge while it
 * plays), then the machine spirit, the berth, the archives, the quota, the order to
 * give the prompt below and the commands; the Imperial date on the bottom edge. The
 * aquila is left out where the band has no rows to spare for it.
 */
export function drawHerald(table: ElementTable, d: HeraldData, t: Theme, slate: Slate): JSX.Element {
  const { Box, Text } = table
  const c = t.colors
  const kit = slateKit(table, t, slate)
  const width = Math.max(40, Math.min(d.cols, HERALD_MAX_COLS))
  const inner = width - 4
  const frameRows = heraldFrameRows(d)

  // The aquila over the card: as tall as the band spares, never taller than HERALD_CREST_ROWS.
  const crestRows = Math.min(HERALD_CREST_ROWS, d.maxRows - frameRows)
  let crest: JSX.Element | null = null
  if (crestRows >= 3) {
    // A picture 3 : 1 takes rows = columns / 6: the columns that fill the rows spared.
    const across = Math.min(width, crestRows * 6)
    const picture = d.pictures ? kit.aquila(across, d.crestFile) : kit.aquilaDots(across, d.crestPix)
    if (picture !== null && picture.rows <= crestRows) {
      crest = (
        <Box flexDirection="row">
          <Box width={Math.floor((width - across) / 2)} flexShrink={0} />
          {picture.element}
        </Box>
      )
    } else if (picture === null && crestRows >= 4) {
      crest = <Box flexDirection="column">{kit.crest(width)}</Box>
    }
  }

  const row = (label: string, body: JSX.Element | string) => (
    <Text wrap="truncate-end">
      <Text color={c.muted}>{label.padEnd(LABEL_CELLS)} </Text>
      <Text color={slate.frame}>▸ </Text>
      {typeof body === 'string' ? <Text color={c.ink}>{body}</Text> : body}
    </Text>
  )
  const dot = <Text color={c.muted}> · </Text>

  // The strip: the awakening's gauge while it plays, then the spirit awake and waiting.
  const strip =
    d.booting !== null
      ? kit.strip(`ИНИЦИАЦИЯ ДУХА МАШИНЫ ${'█'.repeat(Math.round(d.bootFill * 12)).padEnd(12, '░')}`, `${Math.round(d.bootFill * 100)}%`, inner)
      : kit.strip('ДУХ МАШИНЫ ПРОБУЖДЁН · ОМНИССИЯ БЛАГОСЛОВЛЯЕТ', 'ждёт воли Магистра', inner)

  const place = d.place === null ? '?' : fit(d.place, Math.max(8, inner - LABEL_CELLS - 3 - (d.branch === null ? 0 : cells(d.branch) + 9)))
  const quota: string[] = []
  if (d.fiveHour !== null) quota.push(`5ч ${Math.round(d.fiveHour)}%`)
  if (d.sevenDay !== null) quota.push(`7д ${Math.round(d.sevenDay)}%`)

  const rows: JSX.Element[] = [
    strip,
    row(LABELS.spirit, d.model === null ? '?' : modelName(d.model)),
    row(
      LABELS.place,
      <Text>
        <Text color={c.ink}>{place}</Text>
        {d.branch !== null && (
          <Text>
            {dot}
            <Text color={c.muted}>ветвь </Text>
            <Text color={c.accent}>{d.branch}</Text>
          </Text>
        )}
      </Text>,
    ),
    row(
      LABELS.archives,
      <Text>
        {/* Before the first request the engine has counted neither: no «≈0 · ?» in their place. */}
        {d.hookTokens > 0 && (
          <Text>
            <Text color={c.muted}>хуки </Text>
            <Text color={c.ink}>≈{fmtTokens(d.hookTokens)}</Text>
            {dot}
          </Text>
        )}
        {d.claudeMdTokens !== null && (
          <Text>
            <Text color={c.muted}>CLAUDE.md </Text>
            <Text color={c.ink}>{fmtTokens(d.claudeMdTokens)}</Text>
            {dot}
          </Text>
        )}
        {d.alarms.length === 0 ? (
          <Text color={c.good}>
            {t.icons.ok} тревог нет
          </Text>
        ) : (
          <Text color={c.warning}>
            {t.icons.warn} {d.alarms.join(' · ')}
          </Text>
        )}
      </Text>,
    ),
    ...(quota.length > 0 ? [row(LABELS.quota, quota.join(' · '))] : []),
    // Not the thought for the day: Легион shows it on the same screen.
    row(
      LABELS.order,
      <Text color={c.ink2} italic>
        изложи волю ниже — дух машины исполнит
      </Text>,
    ),
    row(LABELS.keys, kit.keys(['/mc', '/jobs', '/mem'])),
  ]

  return (
    <Box flexDirection="column">
      {crest ?? ''}
      {kit.panel({
        style: 'double',
        width,
        title: '✠ КОГИТАТОР ИМПЕРИУМА ✠',
        meta: d.version === null ? '' : `v${d.version}`,
        foot: `ДАТА ИМПЕРИИ ${imperialDate(d.now)}`,
        rows,
      })}
    </Box>
  )
}
