import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Alerts, HookInjection, MbCall, Usage } from '../../types'
import { estimateTokens, findMbInvocations, fmtTokens, hashText, matchesHitPath, parseSearchOutput, shortEvent } from '../lib/parse'
import type { MbInvocation } from '../lib/parse'
import { BOOT_BLESS_MS, BOOT_MS, BOOT_STEP_MS, bootElapsed } from '../lib/boot'
import { drawsPictures } from '../lib/terminal'
import { forSurface } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { drawMemoryPane } from './pane'

// The memory feature's own observers and drawings. What it shares with mission
// control (session.start, turn.complete, /mem, the vault alerts) lives in
// register.tsx: the engine takes one unmatched hook per event per module and
// never follows `$` into an imported function.

export const MEMORY_PANE = 'mem-meter'
const MAX_HOOKS = 100
const MAX_CALLS = 200

/** Hard alerts: a figure past these shows on the band even while the pane is up. */
const CTX_ALERT = 80
const FIVE_HOUR_ALERT = 80
const SEVEN_DAY_ALERT = 90

// The engine's scan accepts only an atom made in the same file: every file declares
// the values it reads or writes, with the same key and initial value as the others.
const hooksA = atom({ plugin: 'mission-control', key: 'hooks' } as const, [])
const callsA = atom({ plugin: 'mission-control', key: 'calls' } as const, [])
const readsA = atom({ plugin: 'mission-control', key: 'reads' } as const, [])
const claudeMdA = atom({ plugin: 'mission-control', key: 'claudeMd' } as const, [])
const turnsA = atom({ plugin: 'mission-control', key: 'turns' } as const, [])
const turnA = atom({ plugin: 'mission-control', key: 'turn' } as const, 0)
const usageA = atom({ plugin: 'mission-control', key: 'usage' } as const, null)
const alertsA = atom({ plugin: 'mission-control', key: 'alerts' } as const, null)
const hiddenA = atom({ plugin: 'mission-control', key: 'isHidden' } as const, false)
const quietA = atom({ plugin: 'mission-control', key: 'isQuiet' } as const, false)
const lastEndA = atom({ plugin: 'mission-control', key: 'lastTurnEndAt' } as const, null)

type $ = EngineInterface

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function recordInjection($: $, event: string, text: string): Promise<void> {
  const id = hashText(`${event}\n${text}`)
  const turn = await read($, turnA)
  const row: HookInjection = {
    id,
    event,
    tokens: estimateTokens(text),
    chars: text.length,
    preview: text.split('\n').find(line => line.trim().length > 0)?.trim().slice(0, 120) ?? '',
    turn,
  }
  await update($, hooksA, list => (list.some(inj => inj.id === id) ? list : [...list, row].slice(-MAX_HOOKS)))
}

async function recordMbCall(
  $: $,
  id: string,
  invocations: MbInvocation[],
  text: string,
  flags: { isError: boolean; isAgent: boolean },
): Promise<void> {
  const isSearch = invocations.some(i => i.kind === 'search')
  const parsed = isSearch ? parseSearchOutput(text, invocations.every(i => i.isCodeOnly)) : null
  const call: MbCall = {
    id,
    kind: isSearch ? 'search' : 'code',
    queries: invocations.map(i => i.query),
    hits: parsed?.hits ?? null,
    memHits: parsed?.memHits ?? 0,
    codeHits: parsed?.codeHits ?? 0,
    best: parsed?.best ?? null,
    tokens: estimateTokens(text),
    paths: parsed?.paths ?? [],
    turn: await read($, turnA),
    isAgent: flags.isAgent,
    isError: flags.isError,
  }
  await update($, callsA, list => [...list.filter(c => c.id !== id), call].slice(-MAX_CALLS))
}

/** Is the Memory tab on screen right now (open, placed and shown)? Unknown counts as no: the band then carries the meter. */
async function isPaneUp($: $): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === MEMORY_PANE && p.isPlaced && p.isShown)
  } catch {
    return false
  }
}

function sum(list: readonly { tokens: number }[]): number {
  return list.reduce((acc, x) => acc + x.tokens, 0)
}

/** Totals and counts per settings-hook event, in first-seen order. */
function byEvent(hooks: readonly HookInjection[]): { event: string; tokens: number; count: number }[] {
  const totals = new Map<string, { tokens: number; count: number }>()
  for (const inj of hooks) {
    const t = totals.get(inj.event) ?? { tokens: 0, count: 0 }
    totals.set(inj.event, { tokens: t.tokens + inj.tokens, count: t.count + 1 })
  }
  return [...totals.entries()].map(([event, t]) => ({ event, ...t }))
}

type AlertItem = { text: string; level: 'error' | 'warning' | 'soft' }

function hardAlerts(usage: Usage | null, alerts: Alerts | null): AlertItem[] {
  const items: AlertItem[] = []
  if (usage?.percent != null && usage.percent >= CTX_ALERT) {
    items.push({ text: `контекст ${usage.percent}%`, level: usage.percent >= 90 ? 'error' : 'warning' })
  }
  if (usage?.fiveHour != null && usage.fiveHour >= FIVE_HOUR_ALERT) {
    items.push({ text: `5h ${Math.round(usage.fiveHour)}%`, level: usage.fiveHour >= 95 ? 'error' : 'warning' })
  }
  if (usage?.sevenDay != null && usage.sevenDay >= SEVEN_DAY_ALERT) {
    items.push({ text: `7d ${Math.round(usage.sevenDay)}%`, level: 'warning' })
  }
  if (alerts !== null && alerts.doctorFail > 0) items.push({ text: `doctor FAIL×${alerts.doctorFail}`, level: 'error' })
  return items
}

function softAlerts(alerts: Alerts | null): AlertItem[] {
  if (alerts === null) return []
  const items: AlertItem[] = []
  if (alerts.plans > 0) items.push({ text: `compaction-планов ${alerts.plans}`, level: 'soft' })
  if (alerts.doctorWarn > 0) items.push({ text: `doctor WARN×${alerts.doctorWarn}`, level: 'soft' })
  if (alerts.error !== null) items.push({ text: `vault не прочитан: ${alerts.error}`, level: 'soft' })
  return items
}

/** Everything the band and the Memory tab read, in one place. */
async function memoryData($: $) {
  const hooks = await read($, hooksA)
  const calls = await read($, callsA)
  const reads = await read($, readsA)
  const claudeMd = await read($, claudeMdA)
  const turns = await read($, turnsA)
  const usage = await read($, usageA)
  const alerts = await read($, alertsA)
  const searches = calls.filter(c => c.kind === 'search')
  const hits = searches.reduce((acc, c) => acc + (c.hits ?? 0), 0)
  const best = searches.reduce<number | null>((acc, c) => (c.best !== null && (acc === null || c.best > acc) ? c.best : acc), null)
  const codeQueries = calls.filter(c => c.kind === 'code').length + searches.filter(c => c.codeHits > 0).length
  const shown = new Set(calls.flatMap(c => c.paths)).size
  const turn = await read($, turnA)
  const lastTurnEndAt = await read($, lastEndA)
  const now = await $.clock.now()
  return { hooks, calls, reads, claudeMd, turns, usage, alerts, searches, hits, best, codeQueries, shown, turn, lastTurnEndAt, now }
}

export function registerMemory(on: On, theme: Theme, sealFile: string | null = null): void {
  const pal = theme.colors
  on('prompt.submit', async ($, e, next) => {
    await update($, turnA, n => n + 1)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every text the engine injects for the model, raised on every request that carries it
  // (seen live: SessionStart's text arrived after a mid-session load); only a settings
  // hook's (Singularity's) is memory, and the hash keeps each one counted once.
  on('prompt.attachment', async ($, e, next) => {
    const answer = await next(e)
    if (e.origin.kind === 'hook' && answer.text !== null && answer.text.length > 0) {
      await recordInjection($, e.origin.event, answer.text)
    }
    return answer
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const invocations = findMbInvocations(e.command)
    if (invocations.length === 0) return next(e)
    const ran = await next(e)
    if (ran.deny === undefined) {
      await recordMbCall($, e.tool_use_id, invocations, ran.text ?? '', {
        isError: ran.isError === true,
        isAgent: e.agentId !== undefined,
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const invocations = findMbInvocations(e.command)
    if (invocations.length === 0) return next(e)
    const ran = await next(e)
    if (ran.deny === undefined) {
      await recordMbCall($, e.tool_use_id, invocations, ran.text ?? '', {
        isError: ran.isError === true,
        isAgent: e.agentId !== undefined,
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A Read of a file a search returned: the hit was used, not only listed.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const hit = matchesHitPath(e.file_path, (await read($, callsA)).flatMap(c => c.paths))
    if (hit !== undefined) await update($, readsA, list => (list.includes(hit) ? list : [...list, hit]))
    return ran
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const answer = await next(e)
    const window = (kind: string): number | null => e.rateLimits.find(w => w.kind === kind)?.percentUsed ?? null
    const usage: Usage = {
      tokens: e.context.tokens ?? null,
      percent: e.context.percent ?? null,
      window: e.context.window,
      fiveHour: window('five_hour'),
      sevenDay: window('seven_day'),
    }
    await update($, usageA, () => usage)
    return answer
  }).catch(($, e, next) => next(e))

  // The band: hard alerts while the Memory tab is up; without it, the one-line meter as well.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hiddenA))) return next(e)
    const isPane = await isPaneUp($)
    const s = await memoryData($)
    const items = [...hardAlerts(s.usage, s.alerts), ...(isPane || (await read($, quietA)) ? [] : softAlerts(s.alerts))]
    // With the tab up and nothing alarming the band yields, unless the awakening plays.
    const awakening = e.surface === 'terminal' && theme.slate !== null && bootElapsed(await $.clock.now()) !== null
    if (isPane && items.length === 0 && !awakening) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const events = byEvent(s.hooks).map(ev => `${shortEvent(ev.event)} ${fmtTokens(ev.tokens)}`).join(' · ')
    const last = s.turns.at(-1)

    // The slate's band, in the status line's manner: each part opens on a brass plate,
    // its figures follow in amber, the alerts on a plate of their own colour.
    const slate = e.surface === 'terminal' ? theme.slate : null
    // The awakening plays first, whatever the tab: the boot log of the cogitator.
    const booting = slate === null ? null : bootElapsed(await $.clock.now())
    if (slate !== null && booting !== null) {
      const fill = Math.min(1, booting / (BOOT_BLESS_MS - 300))
      const width = 24
      const full = Math.round(fill * width)
      const alarms = hardAlerts(s.usage, s.alerts).length + softAlerts(s.alerts).length
      const steps = [
        'литания пуска прочитана',
        `архивы вскрыты · хуки ≈${fmtTokens(sum(s.hooks))}`,
        `CLAUDE.md ${s.claudeMd.length > 0 ? fmtTokens(sum(s.claudeMd)) : '?'}`,
        'легион построен',
        alarms === 0 ? 'тревог нет' : `тревог: ${alarms}`,
      ].slice(0, Math.min(5, Math.floor(booting / BOOT_STEP_MS) + 1))
      const blessed = booting >= BOOT_BLESS_MS
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text backgroundColor={blessed ? pal.accent : slate.frame} color={pal.surface} bold>
              {blessed ? ' ✠ ОМНИССИЯ БЛАГОСЛОВЛЯЕТ ✠ ' : ' +++ ИНИЦИАЦИЯ ДУХА МАШИНЫ +++ '}
            </Text>
            <Text> </Text>
            <Text color={pal.accent}>{'█'.repeat(full)}</Text>
            <Text color={pal.track}>{'█'.repeat(width - full)}</Text>
            <Text color={pal.ink} bold>
              {' '}
              {Math.round(fill * 100)}%
            </Text>
            <Text color={pal.muted}> · {Math.max(0, Math.ceil((BOOT_MS - booting) / 1000))}с</Text>
          </Text>
          <Text wrap="truncate-end">
            {steps.map((step, i) => (
              <Text>
                <Text color={pal.muted}>{i > 0 ? ' · ' : ''}</Text>
                <Text color={pal.good}>{theme.icons.ok} </Text>
                <Text color={i === steps.length - 1 && !blessed ? pal.ink : pal.ink2}>{step}</Text>
              </Text>
            ))}
          </Text>
        </Box>
      )
    }
    if (slate !== null) {
      const plate = (text: string, ground: string = slate.frame) => (
        <Text backgroundColor={ground} color={pal.surface} bold>
          {` ${text} `}
        </Text>
      )
      const dot = <Text color={pal.muted}> · </Text>
      return (
        <Box flexDirection="column">
          {!isPane && (
            <Text wrap="truncate-end">
              {plate('АРХИВЫ')}
              <Text color={pal.muted}> хуки </Text>
              <Text color={pal.ink}>≈{fmtTokens(sum(s.hooks))}</Text>
              {events.length > 0 && <Text color={pal.muted}> ({events})</Text>}
              {dot}
              <Text color={pal.muted}>CLAUDE.md </Text>
              <Text color={pal.ink}>{s.claudeMd.length > 0 ? fmtTokens(sum(s.claudeMd)) : '?'}</Text>
              {dot}
              <Text color={pal.muted}>поиск </Text>
              <Text color={s.searches.length > 0 ? pal.search : pal.ink}>×{s.searches.length}</Text>
              {s.searches.length > 0 && (
                <Text color={pal.muted}>
                  {' '}({s.hits} найдено · лучший {s.best === null ? '—' : s.best.toFixed(2)} · ≈{fmtTokens(sum(s.searches))} · прочит {s.reads.length}/{s.shown})
                </Text>
              )}
              {dot}
              <Text color={pal.muted}>код </Text>
              <Text color={pal.ink}>×{s.codeQueries}</Text>
              {last !== undefined && last.searches === 0 && <Text color={pal.warning}>    {theme.icons.warn} прошлый ход без поиска</Text>}
            </Text>
          )}
          {items.length > 0 && (
            <Text wrap="truncate-end">
              {plate(`${theme.icons.warn} ТРЕВОГИ`, items.some(item => item.level === 'error') ? pal.critical : pal.warning)}{' '}
              {items.map((item, i) => (
                <Text color={item.level === 'soft' ? pal.muted : item.level === 'error' ? pal.critical : pal.warning}>
                  {i > 0 ? ' · ' : ''}
                  {item.text}
                </Text>
              ))}
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {!isPane && (
          <Text wrap="truncate-end">
            <Text dimColor>{theme.words.band}</Text>
            <Text>хуки ≈{fmtTokens(sum(s.hooks))}</Text>
            {events.length > 0 && <Text dimColor> ({events})</Text>}
            <Text dimColor> │ </Text>
            <Text>CLAUDE.md {s.claudeMd.length > 0 ? fmtTokens(sum(s.claudeMd)) : '?'}</Text>
            <Text dimColor> │ </Text>
            <Text color={s.searches.length > 0 ? pal.search : pal.ink2}>поиск ×{s.searches.length}</Text>
            {s.searches.length > 0 && (
              <Text dimColor>
                {' '}· {s.hits} hits · best {s.best === null ? '—' : s.best.toFixed(2)} · ≈{fmtTokens(sum(s.searches))} · прочит {s.reads.length}/{s.shown}
              </Text>
            )}
            <Text dimColor> │ </Text>
            <Text>код ×{s.codeQueries}</Text>
            {last !== undefined && last.searches === 0 && <Text color={pal.warning}> │ {theme.icons.warn} прошлый ход без поиска</Text>}
          </Text>
        )}
        {items.length > 0 && (
          <Text wrap="truncate-end">
            <Text dimColor>{theme.icons.warn} </Text>
            {items.map((item, i) => (
              <Text color={item.level === 'soft' ? pal.muted : item.level === 'error' ? pal.critical : pal.warning}>
                {i > 0 ? ' · ' : ''}
                {item.text}
              </Text>
            ))}
          </Text>
        )}
      </Box>
    )
  }).catch(($, e, next) => {
    // A drawing that throws must say so where the person looks, not leave the slot silently empty.
    const { Text } = $.ui.resolve(e)
    return (
      <Text color="error" wrap="truncate-end">
        mission-control: полоса памяти упала: {reason(next.error)}
      </Text>
    )
  })

  // The Memory tab: a dark surface filling the column, drawn by pane.tsx from the session's figures.
  on('ui.render', { component: 'Pane', requestId: MEMORY_PANE }, async ($, e) => {
    const s = await memoryData($)
    // The purity seal only where the terminal draws pictures.
    const seal = sealFile !== null && (await drawsPictures($)) ? sealFile : null
    return drawMemoryPane($.ui.resolve(e), { ...s, sealFile: seal }, e.props.bodyColumns, e.props.scroll.bodyRows, forSurface(theme, e.surface))
  }).catch(($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" backgroundColor={pal.surface} paddingX={1}>
        <Text color={pal.critical} bold>
          mission-control: вкладка «{theme.titles.memory}» упала
        </Text>
        <Text color={pal.ink2} wrap="wrap">
          {reason(next.error)}
        </Text>
      </Box>
    )
  })
}
