import type { ElementTable, RenderChildren } from 'claude-code'

import type { Alerts, ClaudeMdFile, HookInjection, MbCall, TurnRow, Usage } from '../../types'
import { fmtTokens } from '../lib/parse'
import { SEAL, cells, slateKit, stamp } from '../lib/frame'
import { CLASSIC, bannerLine, themedRule } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { allocate, bigText, fmtDur, meter, pct, plural, sparkline } from '../lib/viz'

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

export type MemoryPaneData = {
  hooks: readonly HookInjection[]
  calls: readonly MbCall[]
  reads: readonly string[]
  claudeMd: readonly ClaudeMdFile[]
  turns: readonly TurnRow[]
  usage: Usage | null
  alerts: Alerts | null
  /** The current turn's index (prompt.submit counts them). */
  turn: number
  lastTurnEndAt: number | null
  now: number
  /** A purity seal's PNG (the `puritySeal` option) where the terminal draws pictures; absent, none. */
  sealFile?: string | null
}

type Source = { name: string; tokens: number; color: string; isPulled: boolean }

const LABEL = 10

function total(list: readonly { tokens: number }[]): number {
  return list.reduce((acc, x) => acc + x.tokens, 0)
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

/** A "bad when high" percentage: neutral accent at rest, then warning, then critical. */
function severity(pal: Theme['colors'], percent: number, warnAt: number, critAt: number): string {
  if (percent >= critAt) return pal.critical
  if (percent >= warnAt) return pal.warning
  return pal.accent
}

/**
 * The Memory tab as one tree: a dark surface filling the column, the one figure that
 * answers "how much reached the model from memory", then short sections.
 * `cols` is the pane's body width, `rows` its visible height.
 */
export function drawMemoryPane(table: ElementTable, d: MemoryPaneData, cols: number, rows: number, t: Theme = CLASSIC) {
  const { Box, Text } = table
  const pal = t.colors
  const sec = t.words.memSections
  const inner = Math.max(24, cols - 2)
  const banner = bannerLine(t, 'memory', inner)
  const slate = t.slate
  const kit = slate === null ? null : slateKit(table, t, slate)
  // Cells each block is laid out to: the column, or the inside of a slate's frame.
  const span = slate === null ? inner : inner - 4
  // A purity seal hangs in the head's top left corner: the litany, the strip, the dial and
  // the first two reliquaries stand beside it, laid out to the room it leaves them.
  const { Image } = table as Partial<ElementTable<'terminal'>>
  const sealOn = slate !== null && d.sealFile != null && Image !== undefined && inner >= 36
  const beside = sealOn ? SEAL.columns + 1 : 0
  const heroSpan = span - beside
  /** Cells the blocks beside the seal (the dial, sources, cache) are laid out to. */
  const topSpan = span - beside

  const section = (title: string, body: RenderChildren) => {
    const r = themedRule(t, title, inner)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={pal.rule}>{r.lead}</Text>
          <Text color={pal.muted} bold>
            {r.title}
          </Text>
          <Text color={pal.rule}>{r.tail}</Text>
        </Text>
        {body}
      </Box>
    )
  }

  const status = (icon: string, color: string, label: string) => (
    <Text wrap="truncate-end">
      <Text color={color}>{icon} </Text>
      <Text color={pal.ink2}>{label}</Text>
    </Text>
  )

  const meterRow = (label: string, percent: number | null, color: string, room = span) => {
    const width = Math.max(6, room - LABEL - 5)
    const figure = <Text color={pal.ink2}>{`${percent === null ? '—' : Math.round(percent)}%`.padStart(5)}</Text>
    if (kit !== null) {
      return (
        <Text wrap="truncate-end">
          <Text color={pal.muted}>{label.padEnd(LABEL)}</Text>
          {kit.gauge((percent ?? 0) / 100, width, color)}
          {figure}
        </Text>
      )
    }
    const m = meter((percent ?? 0) / 100, width)
    return (
      <Text wrap="truncate-end">
        <Text color={pal.muted}>{label.padEnd(LABEL)}</Text>
        <Text color={color}>{m.fill}</Text>
        <Text color={pal.track}>{m.track}</Text>
        {figure}
      </Text>
    )
  }

  const searches = d.calls.filter(c => c.kind === 'search')
  const codeCalls = d.calls.filter(c => c.kind === 'code')
  const sources: Source[] = [
    { name: 'Хуки', tokens: total(d.hooks), color: pal.hooks, isPulled: false },
    { name: 'CLAUDE.md', tokens: total(d.claudeMd), color: pal.claudeMd, isPulled: false },
    { name: 'Поиск mb', tokens: total(searches), color: pal.search, isPulled: true },
    { name: 'Код mb', tokens: total(codeCalls), color: pal.code, isPulled: true },
  ]
  const memTotal = sources.reduce((acc, src) => acc + src.tokens, 0)
  const pulled = sources.filter(src => src.isPulled).reduce((acc, src) => acc + src.tokens, 0)
  const share = d.usage?.tokens != null && d.usage.tokens > 0 ? pct(memTotal, d.usage.tokens) : null
  const isRunning = !d.turns.some(t => t.index === d.turn) && d.turn > 0

  // ── Hero ────────────────────────────────────────────────
  const big = bigText(fmtTokens(memTotal))
  // On a slate the figure sits centred on its dial.
  const centre = (line: string) => (slate === null ? line : ' '.repeat(Math.max(0, Math.floor((heroSpan - cells(line)) / 2))) + line)
  const heroRows: JSX.Element[] = [
    ...big.map(line => (
      <Text color={slate === null ? pal.ink : pal.accent} bold>
        {centre(line)}
      </Text>
    )),
    <Text color={pal.ink2}>{centre(t.words.memHero)}</Text>,
    <Text color={pal.muted} wrap="truncate-end">
      {share === null ? 'доля контекста — после ответа модели' : `≈${share}% текущего контекста`}
      {memTotal > 0 ? ` · по запросу ${pct(pulled, memTotal)}%` : ''}
    </Text>,
  ]
  const heroBlock = <Box flexDirection="column">{heroRows}</Box>

  // ── Sources: one stacked bar, then a labelled row per source ──────────
  const split = allocate(
    sources.map(src => src.tokens),
    topSpan,
  )
  const bar = (
    <Text>
      {sources.map((src, i) => {
        const n = split[i] ?? 0
        if (n === 0) return ''
        const isLast = split.slice(i + 1).every(c => c === 0)
        return (
          <Text>
            <Text color={src.color}>{'█'.repeat(n)}</Text>
            {isLast ? '' : <Text color={pal.surface}> </Text>}
          </Text>
        )
      })}
    </Text>
  )
  const events = new Map<string, number>()
  for (const inj of d.hooks) events.set(inj.event, (events.get(inj.event) ?? 0) + inj.tokens)
  const eventLine = [...events.entries()].map(([ev, tokens]) => `${ev} ${fmtTokens(tokens)}`).join(' · ')
  const sourcesRows: JSX.Element[] = [memTotal > 0 ? bar : <Text color={pal.muted}>ещё ничего не пришло</Text>]
  for (const src of sources) {
    sourcesRows.push(
      <Text wrap="truncate-end">
        <Text color={src.color}>■ </Text>
        <Text color={src.tokens > 0 ? pal.ink2 : pal.muted}>{src.name.padEnd(LABEL)}</Text>
        <Text color={src.tokens > 0 ? pal.ink : pal.muted}>{fmtTokens(src.tokens).padStart(6)}</Text>
        <Text color={pal.muted}>
          {`${pct(src.tokens, memTotal)}%`.padStart(5)} {src.isPulled ? 'запрос' : 'авто'}
        </Text>
      </Text>,
    )
    if (src.name === 'Хуки' && eventLine.length > 0) {
      sourcesRows.push(
        <Text color={pal.muted} wrap="truncate-end">
          {'  '}
          {eventLine}
        </Text>,
      )
    }
  }
  const sourcesBlock = <Box flexDirection="column">{sourcesRows}</Box>

  // ── Prompt cache: from the API usage turn.complete reports ──────────────
  const measured = d.turns.filter(t => t.cacheRead !== undefined)
  const cacheRead = measured.reduce((acc, t) => acc + (t.cacheRead ?? 0), 0)
  const cacheWrite = measured.reduce((acc, t) => acc + (t.cacheWrite ?? 0), 0)
  const uncached = measured.reduce((acc, t) => acc + (t.input ?? 0), 0)
  const allInput = cacheRead + cacheWrite + uncached
  const hitRate = allInput > 0 ? (cacheRead / allInput) * 100 : null
  const lastMeasured = measured.at(-1)
  const lastIn = lastMeasured === undefined ? 0 : (lastMeasured.cacheRead ?? 0) + (lastMeasured.cacheWrite ?? 0) + (lastMeasured.input ?? 0)
  const idle = d.lastTurnEndAt === null ? null : d.now - d.lastTurnEndAt
  const cacheRows: JSX.Element[] = []
  if (measured.length === 0) cacheRows.push(<Text color={pal.muted}>появится после следующего ответа модели</Text>)
  else {
    cacheRows.push(meterRow('из кэша', hitRate, hitRate !== null && hitRate < 50 ? pal.warning : pal.accent, topSpan))
    cacheRows.push(
      <Text wrap="truncate-end">
        <Text color={pal.muted}>{'прочитано'.padEnd(LABEL)}</Text>
        <Text color={pal.ink}>{fmtTokens(cacheRead)}</Text>
        <Text color={pal.muted}> · записано </Text>
        <Text color={pal.ink}>{fmtTokens(cacheWrite)}</Text>
        <Text color={pal.muted}> · без </Text>
        <Text color={pal.ink}>{fmtTokens(uncached)}</Text>
      </Text>,
    )
    if (lastMeasured !== undefined) {
      cacheRows.push(
        <Text wrap="truncate-end">
          <Text color={pal.muted}>{'посл. ход'.padEnd(LABEL)}</Text>
          <Text color={pal.ink2}>{pct(lastMeasured.cacheRead ?? 0, lastIn)}%</Text>
          <Text color={pal.muted}> из кэша · </Text>
          <Text color={pal.ink2}>{fmtTokens(lastMeasured.cacheRead ?? 0)}</Text>
        </Text>,
      )
    }
    cacheRows.push(
      <Text wrap="truncate-end">
        <Text color={pal.muted}>{'простой'.padEnd(LABEL)}</Text>
        <Text color={pal.ink2}>{isRunning ? 'идёт ход' : idle === null ? '—' : fmtDur(idle)}</Text>
        {!isRunning && idle !== null && <Text color={pal.muted}> с последнего ответа</Text>}
      </Text>,
    )
  }

  // ── Search quality ────────────────────────────────────────────────
  const hits = searches.reduce((acc, c) => acc + (c.hits ?? 0), 0)
  const best = searches.reduce<number | null>((acc, c) => (c.best !== null && (acc === null || c.best > acc) ? c.best : acc), null)
  const shown = new Set(d.calls.flatMap(c => c.paths)).size
  const readShare = shown > 0 ? d.reads.length / shown : 0
  const usedWidth = Math.max(6, span - LABEL - 6)
  const used = meter(readShare, usedWidth)
  const searchRows: JSX.Element[] = []
  if (searches.length === 0) searchRows.push(status(t.icons.warn, pal.warning, 'модель ещё не искала в памяти'))
  else {
    searchRows.push(
      <Text wrap="truncate-end">
        <Text color={pal.muted}>запросов </Text>
        <Text color={pal.ink}>{searches.length}</Text>
        <Text color={pal.muted}> · найдено </Text>
        <Text color={pal.ink}>{hits}</Text>
        <Text color={pal.muted}> · лучший </Text>
        <Text color={pal.ink}>{best === null ? '—' : best.toFixed(2)}</Text>
      </Text>,
    )
    searchRows.push(
      <Text wrap="truncate-end">
        <Text color={pal.muted}>{'прочитано'.padEnd(LABEL)}</Text>
        {kit !== null ? (
          kit.gauge(readShare, usedWidth, pal.search)
        ) : (
          <Text>
            <Text color={pal.search}>{used.fill}</Text>
            <Text color={pal.track}>{used.track}</Text>
          </Text>
        )}
        <Text color={pal.ink2}>{` ${d.reads.length}/${shown}`.padStart(6)}</Text>
      </Text>,
    )
    for (const c of searches.slice(-4).reverse()) {
      const usedHere = c.paths.filter(p => d.reads.includes(p)).length
      const tail = ` ${c.hits ?? '–'} · ${c.best === null ? '–' : c.best.toFixed(2)}`
      searchRows.push(
        <Text wrap="truncate-end">
          <Text color={pal.muted}>› </Text>
          <Text color={c.isError ? pal.critical : pal.ink2}>{clip(c.queries.join(', ') || 'mb search', Math.max(8, span - 4 - tail.length - 2))}</Text>
          <Text color={pal.muted}>{tail}</Text>
          {usedHere > 0 && <Text color={pal.good}> {t.icons.ok}</Text>}
        </Text>,
      )
    }
  }

  // ── Turns: a spark per turn (height = tokens pulled by search), then the last four in words ──
  const recent = d.turns.slice(-Math.max(4, span - 2))
  const spark = sparkline(recent.map(t => (t.searches > 0 ? Math.max(1, t.searchTokens ?? 1) : 0)))
  const runs: { isBar: boolean; text: string }[] = []
  for (const ch of spark) {
    const isBar = ch !== '·'
    const last = runs.at(-1)
    if (last !== undefined && last.isBar === isBar) last.text += ch
    else runs.push({ isBar, text: ch })
  }
  const withSearch = d.turns.filter(t => t.searches > 0).length
  const turnsRows: JSX.Element[] = []
  if (d.turns.length === 0) turnsRows.push(<Text color={pal.muted}>ни одного завершённого хода</Text>)
  else {
    turnsRows.push(
      <Text wrap="truncate-end">
        {runs.map(run => (
          <Text color={run.isBar ? pal.search : pal.muted}>{run.text}</Text>
        ))}
        <Text color={pal.muted}>
          {'  '}с поиском {withSearch} из {d.turns.length}
        </Text>
      </Text>,
    )
    for (const t of d.turns.slice(-4).reverse()) {
      const tIn = (t.cacheRead ?? 0) + (t.cacheWrite ?? 0) + (t.input ?? 0)
      turnsRows.push(
        <Text wrap="truncate-end">
          <Text color={pal.muted}>t{t.index} </Text>
          {t.durationMs !== undefined && <Text color={pal.ink2}>{fmtDur(t.durationMs)}</Text>}
          {t.actions !== undefined && (
            <Text color={pal.muted}>
              {' · '}
              {t.actions} {plural(t.actions, ['шаг', 'шага', 'шагов'])}
            </Text>
          )}
          {(t.edits ?? 0) > 0 && <Text color={pal.muted}> · правок {t.edits}</Text>}
          <Text color={pal.muted}> · </Text>
          {t.searches > 0 ? <Text color={pal.search}>поиск {t.searches}</Text> : <Text color={pal.warning}>без поиска</Text>}
          {tIn > 0 && <Text color={pal.muted}> · кэш {pct(t.cacheRead ?? 0, tIn)}%</Text>}
        </Text>,
      )
    }
  }

  // ── Window and limits ─────────────────────────────────────────────
  const ctx = d.usage?.percent ?? null
  const fiveHour = d.usage?.fiveHour ?? null
  const sevenDay = d.usage?.sevenDay ?? null
  const windowRows: JSX.Element[] = [
    meterRow('контекст', ctx, severity(pal, ctx ?? 0, 80, 90)),
    meterRow('5 часов', fiveHour, severity(pal, fiveHour ?? 0, 80, 95)),
    meterRow('7 дней', sevenDay, severity(pal, sevenDay ?? 0, 90, 98)),
    <Text color={pal.muted} wrap="truncate-end">
      {'окно'.padEnd(LABEL)}
      {d.usage === null ? '—' : `${fmtTokens(d.usage.tokens ?? 0)} из ${fmtTokens(d.usage.window)}`}
    </Text>,
  ]

  // ── Vault health: icon + label, never colour alone ──────────────────
  const a = d.alerts
  const vaultMarks: { icon: string; color: string; label: string }[] = []
  if (a === null) vaultMarks.push({ icon: '…', color: pal.muted, label: 'ещё не прочитан' })
  else {
    if (a.error !== null) vaultMarks.push({ icon: t.icons.error, color: pal.serious, label: `не прочитан: ${a.error}` })
    if (a.doctorFail > 0) vaultMarks.push({ icon: t.icons.error, color: pal.critical, label: `doctor: ${a.doctorFail} FAIL` })
    if (a.doctorWarn > 0) vaultMarks.push({ icon: t.icons.warn, color: pal.warning, label: `doctor: ${a.doctorWarn} WARN` })
    if (a.plans > 0) vaultMarks.push({ icon: t.icons.jobs, color: pal.muted, label: `compaction-планы: ${a.plans}` })
    if (vaultMarks.length === 0) vaultMarks.push({ icon: t.icons.ok, color: pal.good, label: 'всё чисто' })
  }
  const vaultRows = vaultMarks.map(r => status(r.icon, r.color, r.label))

  if (slate !== null && kit !== null) {
    // The slate: the crest over the litany and the strip, the figure on a dial in a double
    // frame (a purity seal hanging beside them, where one is chosen), then each section a
    // reliquary of its own, its stamp on the bottom edge.
    const reliquary = (title: string, list: readonly JSX.Element[], n: number, meta = '', width = inner) =>
      kit.panel({ style: 'light', width, title: title.toUpperCase(), meta, foot: stamp('АРХ', n * 977 + d.turn), rows: list, titleColor: pal.ink2 })
    const ctxMeta = ctx === null ? '' : `${Math.round(ctx)}%`
    return (
      <Box flexDirection="column" backgroundColor={pal.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
        {rows >= 50 ? kit.crest(inner) : ''}
        <Box flexDirection="row">
          {sealOn && Image !== undefined && d.sealFile != null ? (
            <Box width={beside} paddingRight={1} flexShrink={0}>
              <Image source={{ file: d.sealFile, format: 'png' }} columns={SEAL.columns} rows={SEAL.rows} alt="✠" />
            </Box>
          ) : (
            ''
          )}
          <Box flexDirection="column" width={inner - beside}>
            <Text color={pal.accent} bold wrap="truncate-end">
              {bannerLine(t, 'memory', inner - beside) ?? ''}
            </Text>
            {kit.strip(slate.strip.memory, `ход ${d.turn}`, inner - beside)}
            {kit.panel({ style: 'double', width: inner - beside, title: `✠ ${slate.memPlate}`, rows: heroRows })}
            {reliquary(sec.sources, sourcesRows, 1, fmtTokens(memTotal), inner - beside)}
            {reliquary(sec.cache, cacheRows, 2, hitRate === null ? '' : `${Math.round(hitRate)}%`, inner - beside)}
          </Box>
        </Box>
        {reliquary(sec.search, searchRows, 3, `×${searches.length}`)}
        {reliquary(sec.turns, turnsRows, 4, String(d.turns.length))}
        {reliquary(sec.window, windowRows, 5, ctxMeta)}
        {reliquary(sec.vault, vaultRows, 6)}
        <Box marginTop={1}>{kit.keys(['/mem close', 'quiet', 'reset', '/mc'])}</Box>
      </Box>
    )
  }

  const column = (list: readonly JSX.Element[]) => <Box flexDirection="column">{list}</Box>
  return (
    <Box
      flexDirection="column"
      backgroundColor={pal.surface}
      paddingX={1}
      paddingTop={1}
      width={cols}
      minHeight={Math.max(1, rows)}
    >
      {banner !== null && (
        <Box marginBottom={1}>
          <Text color={pal.accent} bold wrap="truncate-end">
            {banner}
          </Text>
        </Box>
      )}
      {heroBlock}
      {section(sec.sources, sourcesBlock)}
      {section(sec.cache, column(cacheRows))}
      {section(sec.search, column(searchRows))}
      {section(sec.turns, column(turnsRows))}
      {section(sec.window, column(windowRows))}
      {section(sec.vault, column(vaultRows))}
      <Box marginTop={1}>
        <Text color={pal.muted} wrap="truncate-end">
          /mem close · quiet · reset · /mc
        </Text>
      </Box>
    </Box>
  )
}
