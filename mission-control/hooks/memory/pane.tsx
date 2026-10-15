import type { ElementTable, RenderChildren } from 'claude-code'

import type { Alerts, ClaudeMdFile, HookInjection, MbCall, TurnRow, Usage } from '../../types'
import { fmtTokens } from '../lib/parse'
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

  const meterRow = (label: string, percent: number | null, color: string) => {
    const width = Math.max(6, inner - LABEL - 5)
    const m = meter((percent ?? 0) / 100, width)
    return (
      <Text wrap="truncate-end">
        <Text color={pal.muted}>{label.padEnd(LABEL)}</Text>
        <Text color={color}>{m.fill}</Text>
        <Text color={pal.track}>{m.track}</Text>
        <Text color={pal.ink2}>{`${percent === null ? '—' : Math.round(percent)}%`.padStart(5)}</Text>
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
  const heroBlock = (
    <Box flexDirection="column">
      {bigText(fmtTokens(memTotal)).map(line => (
        <Text color={pal.ink} bold>
          {line}
        </Text>
      ))}
      <Text color={pal.ink2}>{t.words.memHero}</Text>
      <Text color={pal.muted} wrap="truncate-end">
        {share === null ? 'доля контекста — после ответа модели' : `≈${share}% текущего контекста`}
        {memTotal > 0 ? ` · по запросу ${pct(pulled, memTotal)}%` : ''}
      </Text>
    </Box>
  )

  // ── Sources: one stacked bar, then a labelled row per source ──────────
  const cells = allocate(
    sources.map(src => src.tokens),
    inner,
  )
  const bar = (
    <Text>
      {sources.map((src, i) => {
        const n = cells[i] ?? 0
        if (n === 0) return ''
        const isLast = cells.slice(i + 1).every(c => c === 0)
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
  const sourcesBlock = (
    <Box flexDirection="column">
      {memTotal > 0 ? bar : <Text color={pal.muted}>ещё ничего не пришло</Text>}
      {sources.map(src => (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={src.color}>■ </Text>
            <Text color={src.tokens > 0 ? pal.ink2 : pal.muted}>{src.name.padEnd(LABEL)}</Text>
            <Text color={src.tokens > 0 ? pal.ink : pal.muted}>{fmtTokens(src.tokens).padStart(6)}</Text>
            <Text color={pal.muted}>
              {`${pct(src.tokens, memTotal)}%`.padStart(5)} {src.isPulled ? 'запрос' : 'авто'}
            </Text>
          </Text>
          {src.name === 'Хуки' && eventLine.length > 0 && (
            <Text color={pal.muted} wrap="truncate-end">
              {'  '}
              {eventLine}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )

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
  const cacheBlock =
    measured.length === 0 ? (
      <Text color={pal.muted}>появится после следующего ответа модели</Text>
    ) : (
      <Box flexDirection="column">
        {meterRow('из кэша', hitRate, hitRate !== null && hitRate < 50 ? pal.warning : pal.accent)}
        <Text wrap="truncate-end">
          <Text color={pal.muted}>{'прочитано'.padEnd(LABEL)}</Text>
          <Text color={pal.ink}>{fmtTokens(cacheRead)}</Text>
          <Text color={pal.muted}> · записано </Text>
          <Text color={pal.ink}>{fmtTokens(cacheWrite)}</Text>
          <Text color={pal.muted}> · без </Text>
          <Text color={pal.ink}>{fmtTokens(uncached)}</Text>
        </Text>
        {lastMeasured !== undefined && (
          <Text wrap="truncate-end">
            <Text color={pal.muted}>{'посл. ход'.padEnd(LABEL)}</Text>
            <Text color={pal.ink2}>{pct(lastMeasured.cacheRead ?? 0, lastIn)}%</Text>
            <Text color={pal.muted}> из кэша · </Text>
            <Text color={pal.ink2}>{fmtTokens(lastMeasured.cacheRead ?? 0)}</Text>
          </Text>
        )}
        <Text wrap="truncate-end">
          <Text color={pal.muted}>{'простой'.padEnd(LABEL)}</Text>
          <Text color={pal.ink2}>{isRunning ? 'идёт ход' : idle === null ? '—' : fmtDur(idle)}</Text>
          {!isRunning && idle !== null && <Text color={pal.muted}> с последнего ответа</Text>}
        </Text>
      </Box>
    )

  // ── Search quality ────────────────────────────────────────────────
  const hits = searches.reduce((acc, c) => acc + (c.hits ?? 0), 0)
  const best = searches.reduce<number | null>((acc, c) => (c.best !== null && (acc === null || c.best > acc) ? c.best : acc), null)
  const shown = new Set(d.calls.flatMap(c => c.paths)).size
  const used = meter(shown > 0 ? d.reads.length / shown : 0, Math.max(6, inner - LABEL - 6))
  const searchBlock =
    searches.length === 0 ? (
      status(t.icons.warn, pal.warning, 'модель ещё не искала в памяти')
    ) : (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={pal.muted}>запросов </Text>
          <Text color={pal.ink}>{searches.length}</Text>
          <Text color={pal.muted}> · найдено </Text>
          <Text color={pal.ink}>{hits}</Text>
          <Text color={pal.muted}> · лучший </Text>
          <Text color={pal.ink}>{best === null ? '—' : best.toFixed(2)}</Text>
        </Text>
        <Text wrap="truncate-end">
          <Text color={pal.muted}>{'прочитано'.padEnd(LABEL)}</Text>
          <Text color={pal.search}>{used.fill}</Text>
          <Text color={pal.track}>{used.track}</Text>
          <Text color={pal.ink2}>{` ${d.reads.length}/${shown}`.padStart(6)}</Text>
        </Text>
        {searches
          .slice(-4)
          .reverse()
          .map(c => {
            const usedHere = c.paths.filter(p => d.reads.includes(p)).length
            const tail = ` ${c.hits ?? '–'} · ${c.best === null ? '–' : c.best.toFixed(2)}`
            return (
              <Text wrap="truncate-end">
                <Text color={pal.muted}>› </Text>
                <Text color={c.isError ? pal.critical : pal.ink2}>
                  {clip(c.queries.join(', ') || 'mb search', Math.max(8, inner - 4 - tail.length - 2))}
                </Text>
                <Text color={pal.muted}>{tail}</Text>
                {usedHere > 0 && <Text color={pal.good}> {t.icons.ok}</Text>}
              </Text>
            )
          })}
      </Box>
    )

  // ── Turns: a spark per turn (height = tokens pulled by search), then the last four in words ──
  const recent = d.turns.slice(-Math.max(4, inner - 2))
  const spark = sparkline(recent.map(t => (t.searches > 0 ? Math.max(1, t.searchTokens ?? 1) : 0)))
  const runs: { isBar: boolean; text: string }[] = []
  for (const ch of spark) {
    const isBar = ch !== '·'
    const last = runs.at(-1)
    if (last !== undefined && last.isBar === isBar) last.text += ch
    else runs.push({ isBar, text: ch })
  }
  const withSearch = d.turns.filter(t => t.searches > 0).length
  const turnsBlock =
    d.turns.length === 0 ? (
      <Text color={pal.muted}>ни одного завершённого хода</Text>
    ) : (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {runs.map(run => (
            <Text color={run.isBar ? pal.search : pal.muted}>{run.text}</Text>
          ))}
          <Text color={pal.muted}>
            {'  '}с поиском {withSearch} из {d.turns.length}
          </Text>
        </Text>
        {d.turns
          .slice(-4)
          .reverse()
          .map(t => {
            const tIn = (t.cacheRead ?? 0) + (t.cacheWrite ?? 0) + (t.input ?? 0)
            return (
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
              </Text>
            )
          })}
      </Box>
    )

  // ── Window and limits ─────────────────────────────────────────────
  const ctx = d.usage?.percent ?? null
  const fiveHour = d.usage?.fiveHour ?? null
  const sevenDay = d.usage?.sevenDay ?? null
  const windowBlock = (
    <Box flexDirection="column">
      {meterRow('контекст', ctx, severity(pal, ctx ?? 0, 80, 90))}
      {meterRow('5 часов', fiveHour, severity(pal, fiveHour ?? 0, 80, 95))}
      {meterRow('7 дней', sevenDay, severity(pal, sevenDay ?? 0, 90, 98))}
      <Text color={pal.muted} wrap="truncate-end">
        {'окно'.padEnd(LABEL)}
        {d.usage === null ? '—' : `${fmtTokens(d.usage.tokens ?? 0)} из ${fmtTokens(d.usage.window)}`}
      </Text>
    </Box>
  )

  // ── Vault health: icon + label, never colour alone ──────────────────
  const a = d.alerts
  const vaultRows: { icon: string; color: string; label: string }[] = []
  if (a === null) vaultRows.push({ icon: '…', color: pal.muted, label: 'ещё не прочитан' })
  else {
    if (a.error !== null) vaultRows.push({ icon: t.icons.error, color: pal.serious, label: `не прочитан: ${a.error}` })
    if (a.doctorFail > 0) vaultRows.push({ icon: t.icons.error, color: pal.critical, label: `doctor: ${a.doctorFail} FAIL` })
    if (a.doctorWarn > 0) vaultRows.push({ icon: t.icons.warn, color: pal.warning, label: `doctor: ${a.doctorWarn} WARN` })
    if (a.plans > 0) vaultRows.push({ icon: t.icons.jobs, color: pal.muted, label: `compaction-планы: ${a.plans}` })
    if (vaultRows.length === 0) vaultRows.push({ icon: t.icons.ok, color: pal.good, label: 'всё чисто' })
  }
  const vaultBlock = <Box flexDirection="column">{vaultRows.map(r => status(r.icon, r.color, r.label))}</Box>

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
      {section(sec.cache, cacheBlock)}
      {section(sec.search, searchBlock)}
      {section(sec.turns, turnsBlock)}
      {section(sec.window, windowBlock)}
      {section(sec.vault, vaultBlock)}
      <Box marginTop={1}>
        <Text color={pal.muted} wrap="truncate-end">
          /mem close · quiet · reset · /mc
        </Text>
      </Box>
    </Box>
  )
}
