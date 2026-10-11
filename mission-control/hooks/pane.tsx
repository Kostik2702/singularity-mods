import type { ElementTable, RenderChildren } from 'claude-code'

import type { Action, Alerts, ClaudeMdFile, HookInjection, MbCall, TurnRow, Usage } from '../types'
import { fmtTokens } from './parse'
import { COLORS, allocate, bigText, fmtDur, meter, pct, plural, rule, sparkline } from './viz'

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

export type PaneData = {
  hooks: readonly HookInjection[]
  calls: readonly MbCall[]
  reads: readonly string[]
  claudeMd: readonly ClaudeMdFile[]
  turns: readonly TurnRow[]
  usage: Usage | null
  alerts: Alerts | null
  actions: readonly Action[]
  /** The current turn's index (prompt.submit counts them). */
  turn: number
  lastTurnEndAt: number | null
  now: number
}

type Source = { name: string; tokens: number; color: string; isPulled: boolean }

const LABEL = 10
const LOG_ROWS = 8

function total(list: readonly { tokens: number }[]): number {
  return list.reduce((acc, x) => acc + x.tokens, 0)
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

/** A "bad when high" percentage: neutral accent at rest, then warning, then critical. */
function severity(percent: number, warnAt: number, critAt: number): string {
  if (percent >= critAt) return COLORS.critical
  if (percent >= warnAt) return COLORS.warning
  return COLORS.accent
}

const STATUS_ICON: Record<Action['status'], { icon: string; color: string }> = {
  run: { icon: '◌', color: COLORS.accent },
  ok: { icon: '✓', color: COLORS.good },
  error: { icon: '✖', color: COLORS.critical },
  denied: { icon: '⊘', color: COLORS.warning },
}

function verbColor(kind: Action['kind']): string {
  if (kind === 'memory') return COLORS.search
  if (kind === 'delete') return COLORS.serious
  return COLORS.ink2
}

/**
 * The sidebar as one tree: a dark surface filling the column, the one figure that
 * answers "how much reached the model from memory", then short sections.
 * `cols` is the pane's body width, `rows` its visible height.
 */
export function drawPane(table: ElementTable, d: PaneData, cols: number, rows: number) {
  const { Box, Text } = table
  const inner = Math.max(24, cols - 2)

  const section = (title: string, body: RenderChildren) => {
    const r = rule(title, inner)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={COLORS.rule}>{r.lead}</Text>
          <Text color={COLORS.muted} bold>
            {r.title}
          </Text>
          <Text color={COLORS.rule}>{r.tail}</Text>
        </Text>
        {body}
      </Box>
    )
  }

  const status = (icon: string, color: string, label: string) => (
    <Text wrap="truncate-end">
      <Text color={color}>{icon} </Text>
      <Text color={COLORS.ink2}>{label}</Text>
    </Text>
  )

  const meterRow = (label: string, percent: number | null, color: string) => {
    const width = Math.max(6, inner - LABEL - 5)
    const m = meter((percent ?? 0) / 100, width)
    return (
      <Text wrap="truncate-end">
        <Text color={COLORS.muted}>{label.padEnd(LABEL)}</Text>
        <Text color={color}>{m.fill}</Text>
        <Text color={COLORS.track}>{m.track}</Text>
        <Text color={COLORS.ink2}>{`${percent === null ? '—' : Math.round(percent)}%`.padStart(5)}</Text>
      </Text>
    )
  }

  const searches = d.calls.filter(c => c.kind === 'search')
  const codeCalls = d.calls.filter(c => c.kind === 'code')
  const sources: Source[] = [
    { name: 'Хуки', tokens: total(d.hooks), color: COLORS.hooks, isPulled: false },
    { name: 'CLAUDE.md', tokens: total(d.claudeMd), color: COLORS.claudeMd, isPulled: false },
    { name: 'Поиск mb', tokens: total(searches), color: COLORS.search, isPulled: true },
    { name: 'Код mb', tokens: total(codeCalls), color: COLORS.code, isPulled: true },
  ]
  const memTotal = sources.reduce((acc, src) => acc + src.tokens, 0)
  const pulled = sources.filter(src => src.isPulled).reduce((acc, src) => acc + src.tokens, 0)
  const share = d.usage?.tokens != null && d.usage.tokens > 0 ? pct(memTotal, d.usage.tokens) : null
  const isRunning = !d.turns.some(t => t.index === d.turn) && d.turn > 0

  // ── Hero ────────────────────────────────────────────────
  const heroBlock = (
    <Box flexDirection="column">
      {bigText(fmtTokens(memTotal)).map(line => (
        <Text color={COLORS.ink} bold>
          {line}
        </Text>
      ))}
      <Text color={COLORS.ink2}>токенов из памяти за сессию</Text>
      <Text color={COLORS.muted} wrap="truncate-end">
        {share === null ? 'доля контекста — после ответа модели' : `≈${share}% текущего контекста`}
        {memTotal > 0 ? ` · по запросу ${pct(pulled, memTotal)}%` : ''}
      </Text>
    </Box>
  )

  // ── Activity log: the newest turn that did anything, oldest step at the top ──
  const logTurn = d.actions.at(-1)?.turn ?? d.turn
  const turnActs = d.actions.filter(a => a.turn === logTurn)
  const visible = turnActs.slice(-LOG_ROWS)
  const earlier = turnActs.length - visible.length
  const logTitle = isRunning && logTurn === d.turn ? `Сейчас · ход ${logTurn}` : `Ход ${logTurn}`
  const logBlock =
    turnActs.length === 0 ? (
      <Text color={COLORS.muted}>пока без действий</Text>
    ) : (
      <Box flexDirection="column">
        {earlier > 0 && (
          <Text color={COLORS.muted}>
            … ещё {earlier} {plural(earlier, ['шаг', 'шага', 'шагов'])} раньше
          </Text>
        )}
        {visible.map(a => {
          const mark = STATUS_ICON[a.status]
          const verb = a.status === 'run' ? a.run : a.done
          const slow = a.status !== 'run' && a.ms !== null && a.ms >= 3000 ? ` ${fmtDur(a.ms)}` : ''
          const room = Math.max(6, inner - 2 - (a.isAgent ? 2 : 0) - verb.length - 1 - slow.length)
          return (
            <Text wrap="truncate-end">
              <Text color={mark.color}>{mark.icon} </Text>
              {a.isAgent && <Text color={COLORS.muted}>↳ </Text>}
              <Text color={verbColor(a.kind)}>{verb}</Text>
              {a.target.length > 0 && <Text color={a.isAgent ? COLORS.muted : COLORS.ink}> {clip(a.target, room)}</Text>}
              <Text color={COLORS.muted}>{slow}</Text>
            </Text>
          )
        })}
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
            {isLast ? '' : <Text color={COLORS.surface}> </Text>}
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
      {memTotal > 0 ? bar : <Text color={COLORS.muted}>ещё ничего не пришло</Text>}
      {sources.map(src => (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={src.color}>■ </Text>
            <Text color={src.tokens > 0 ? COLORS.ink2 : COLORS.muted}>{src.name.padEnd(LABEL)}</Text>
            <Text color={src.tokens > 0 ? COLORS.ink : COLORS.muted}>{fmtTokens(src.tokens).padStart(6)}</Text>
            <Text color={COLORS.muted}>
              {`${pct(src.tokens, memTotal)}%`.padStart(5)} {src.isPulled ? 'запрос' : 'авто'}
            </Text>
          </Text>
          {src.name === 'Хуки' && eventLine.length > 0 && (
            <Text color={COLORS.muted} wrap="truncate-end">
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
      <Text color={COLORS.muted}>появится после следующего ответа модели</Text>
    ) : (
      <Box flexDirection="column">
        {meterRow('из кэша', hitRate, hitRate !== null && hitRate < 50 ? COLORS.warning : COLORS.accent)}
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>{'прочитано'.padEnd(LABEL)}</Text>
          <Text color={COLORS.ink}>{fmtTokens(cacheRead)}</Text>
          <Text color={COLORS.muted}> · записано </Text>
          <Text color={COLORS.ink}>{fmtTokens(cacheWrite)}</Text>
          <Text color={COLORS.muted}> · без </Text>
          <Text color={COLORS.ink}>{fmtTokens(uncached)}</Text>
        </Text>
        {lastMeasured !== undefined && (
          <Text wrap="truncate-end">
            <Text color={COLORS.muted}>{'посл. ход'.padEnd(LABEL)}</Text>
            <Text color={COLORS.ink2}>{pct(lastMeasured.cacheRead ?? 0, lastIn)}%</Text>
            <Text color={COLORS.muted}> из кэша · </Text>
            <Text color={COLORS.ink2}>{fmtTokens(lastMeasured.cacheRead ?? 0)}</Text>
          </Text>
        )}
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>{'простой'.padEnd(LABEL)}</Text>
          <Text color={COLORS.ink2}>{isRunning ? 'идёт ход' : idle === null ? '—' : fmtDur(idle)}</Text>
          {!isRunning && idle !== null && <Text color={COLORS.muted}> с последнего ответа</Text>}
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
      status('⚠', COLORS.warning, 'модель ещё не искала в памяти')
    ) : (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>запросов </Text>
          <Text color={COLORS.ink}>{searches.length}</Text>
          <Text color={COLORS.muted}> · найдено </Text>
          <Text color={COLORS.ink}>{hits}</Text>
          <Text color={COLORS.muted}> · лучший </Text>
          <Text color={COLORS.ink}>{best === null ? '—' : best.toFixed(2)}</Text>
        </Text>
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>{'прочитано'.padEnd(LABEL)}</Text>
          <Text color={COLORS.search}>{used.fill}</Text>
          <Text color={COLORS.track}>{used.track}</Text>
          <Text color={COLORS.ink2}>{` ${d.reads.length}/${shown}`.padStart(6)}</Text>
        </Text>
        {searches
          .slice(-4)
          .reverse()
          .map(c => {
            const usedHere = c.paths.filter(p => d.reads.includes(p)).length
            const tail = ` ${c.hits ?? '–'} · ${c.best === null ? '–' : c.best.toFixed(2)}`
            return (
              <Text wrap="truncate-end">
                <Text color={COLORS.muted}>› </Text>
                <Text color={c.isError ? COLORS.critical : COLORS.ink2}>
                  {clip(c.queries.join(', ') || 'mb search', Math.max(8, inner - 4 - tail.length - 2))}
                </Text>
                <Text color={COLORS.muted}>{tail}</Text>
                {usedHere > 0 && <Text color={COLORS.good}> ✓</Text>}
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
      <Text color={COLORS.muted}>ни одного завершённого хода</Text>
    ) : (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {runs.map(run => (
            <Text color={run.isBar ? COLORS.search : COLORS.muted}>{run.text}</Text>
          ))}
          <Text color={COLORS.muted}>
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
                <Text color={COLORS.muted}>t{t.index} </Text>
                {t.durationMs !== undefined && <Text color={COLORS.ink2}>{fmtDur(t.durationMs)}</Text>}
                {t.actions !== undefined && (
                  <Text color={COLORS.muted}>
                    {' · '}
                    {t.actions} {plural(t.actions, ['шаг', 'шага', 'шагов'])}
                  </Text>
                )}
                {(t.edits ?? 0) > 0 && <Text color={COLORS.muted}> · правок {t.edits}</Text>}
                <Text color={COLORS.muted}> · </Text>
                {t.searches > 0 ? <Text color={COLORS.search}>поиск {t.searches}</Text> : <Text color={COLORS.warning}>без поиска</Text>}
                {tIn > 0 && <Text color={COLORS.muted}> · кэш {pct(t.cacheRead ?? 0, tIn)}%</Text>}
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
      {meterRow('контекст', ctx, severity(ctx ?? 0, 80, 90))}
      {meterRow('5 часов', fiveHour, severity(fiveHour ?? 0, 80, 95))}
      {meterRow('7 дней', sevenDay, severity(sevenDay ?? 0, 90, 98))}
      <Text color={COLORS.muted} wrap="truncate-end">
        {'окно'.padEnd(LABEL)}
        {d.usage === null ? '—' : `${fmtTokens(d.usage.tokens ?? 0)} из ${fmtTokens(d.usage.window)}`}
      </Text>
    </Box>
  )

  // ── Vault health: icon + label, never colour alone ──────────────────
  const a = d.alerts
  const vaultRows: { icon: string; color: string; label: string }[] = []
  if (a === null) vaultRows.push({ icon: '…', color: COLORS.muted, label: 'ещё не прочитан' })
  else {
    if (a.error !== null) vaultRows.push({ icon: '✖', color: COLORS.serious, label: `не прочитан: ${a.error}` })
    if (a.doctorFail > 0) vaultRows.push({ icon: '✖', color: COLORS.critical, label: `doctor: ${a.doctorFail} FAIL` })
    if (a.doctorWarn > 0) vaultRows.push({ icon: '⚠', color: COLORS.warning, label: `doctor: ${a.doctorWarn} WARN` })
    if (a.plans > 0) vaultRows.push({ icon: '◷', color: COLORS.muted, label: `compaction-планы: ${a.plans}` })
    if (vaultRows.length === 0) vaultRows.push({ icon: '✓', color: COLORS.good, label: 'всё чисто' })
  }
  const vaultBlock = <Box flexDirection="column">{vaultRows.map(r => status(r.icon, r.color, r.label))}</Box>

  return (
    <Box
      flexDirection="column"
      backgroundColor={COLORS.surface}
      paddingX={1}
      paddingTop={1}
      width={cols}
      minHeight={Math.max(1, rows)}
    >
      {heroBlock}
      {section(logTitle, logBlock)}
      {section('Откуда', sourcesBlock)}
      {section('Кэш', cacheBlock)}
      {section('Поиск в памяти', searchBlock)}
      {section('Ходы', turnsBlock)}
      {section('Окно', windowBlock)}
      {section('Vault', vaultBlock)}
      <Box marginTop={1}>
        <Text color={COLORS.muted} wrap="truncate-end">
          /mem close · quiet · reset
        </Text>
      </Box>
    </Box>
  )
}
