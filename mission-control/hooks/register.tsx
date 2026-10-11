import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, Alerts, ClaudeMdFile, HookInjection, MbCall, TurnRow, Usage } from '../types'
import {
  countDoctor,
  estimateTokens,
  findMbInvocations,
  fmtTokens,
  hashText,
  matchesHitPath,
  parseSearchOutput,
  shortEvent,
} from './parse'
import type { MbInvocation } from './parse'
import { describeAction } from './actions'
import { drawPane } from './pane'
import { COLORS } from './viz'

const PANE = 'mem-meter'
const PANE_TITLE = 'Память → контекст'
const MAX_HOOKS = 100
const MAX_CALLS = 200
const MAX_TURNS = 50
const ALERTS_EVERY_MS = 5 * 60_000

/** Hard alerts: a figure past these shows on the band even while the pane is up. */
const CTX_ALERT = 80
const FIVE_HOUR_ALERT = 80
const SEVEN_DAY_ALERT = 90

const hooksA = atom({ plugin: 'mem-meter', key: 'hooks' } as const, [])
const callsA = atom({ plugin: 'mem-meter', key: 'calls' } as const, [])
const readsA = atom({ plugin: 'mem-meter', key: 'reads' } as const, [])
const claudeMdA = atom({ plugin: 'mem-meter', key: 'claudeMd' } as const, [])
const turnsA = atom({ plugin: 'mem-meter', key: 'turns' } as const, [])
const turnA = atom({ plugin: 'mem-meter', key: 'turn' } as const, 0)
const usageA = atom({ plugin: 'mem-meter', key: 'usage' } as const, null)
const alertsA = atom({ plugin: 'mem-meter', key: 'alerts' } as const, null)
const hiddenA = atom({ plugin: 'mem-meter', key: 'isHidden' } as const, false)
const quietA = atom({ plugin: 'mem-meter', key: 'isQuiet' } as const, false)
const paneStatusA = atom({ plugin: 'mem-meter', key: 'paneStatus' } as const, null)
const actionsA = atom({ plugin: 'mem-meter', key: 'actions' } as const, [])
const lastEndA = atom({ plugin: 'mem-meter', key: 'lastTurnEndAt' } as const, null)
const MAX_ACTIONS = 300

type $ = EngineInterface

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

/** The engine's own token count per instruction file, from the /context breakdown. */
async function refreshClaudeMd($: $): Promise<void> {
  let files: readonly { path: string; tokens: number }[] | undefined
  try {
    files = (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.memoryFiles
  } catch {
    return // no session bound yet (or no breakdown on this host): keep the last figures
  }
  if (files === undefined) return
  const rows: ClaudeMdFile[] = files.map(f => ({ path: f.path, tokens: f.tokens }))
  await update($, claudeMdA, () => rows)
}

async function readText($: $, path: string): Promise<string> {
  const body = await $.fs.read(path)
  if (typeof body !== 'string') throw new Error(`${path}: not text`)
  return body
}

/** Vault location from Singularity's per-machine config, as its own hooks resolve it. */
async function vaultPath($: $): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined) throw new Error('no USERPROFILE/HOME')
  const cfg = JSON.parse(await readText($, `${home}/.singularity.json`)) as { vault_path?: unknown }
  if (typeof cfg.vault_path !== 'string') throw new Error('.singularity.json has no vault_path')
  return cfg.vault_path
}

/** Reads the same cached files session_start.py reads; never runs `mb` (a cold run takes ~20 s). */
async function refreshAlerts($: $): Promise<void> {
  const next: Alerts = { plans: 0, doctorWarn: 0, doctorFail: 0, error: null }
  try {
    const vault = await vaultPath($)
    if (await $.fs.exists(`${vault}/compaction-plans`)) {
      const entries = await $.fs.list(`${vault}/compaction-plans`)
      next.plans = entries.filter(f => f.kind === 'file' && f.name.endsWith('.md')).length
    }
    if (await $.fs.exists(`${vault}/.mb/doctor-last.json`)) {
      const doctor = countDoctor(await readText($, `${vault}/.mb/doctor-last.json`))
      next.doctorWarn = doctor.warn
      next.doctorFail = doctor.fail
    }
  } catch (err) {
    next.error = err instanceof Error ? err.message : String(err)
  }
  await update($, alertsA, () => next)
}

/** Is the mem-meter pane on screen right now (open, placed and shown)? Unknown counts as no: the band then carries the meter. */
async function isPaneUp($: $): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)
  } catch {
    return false
  }
}

/** Opens the pane unless it is already open; records what the engine answered, so a pane that never shows can be explained. */
async function openPane($: $): Promise<void> {
  try {
    const panes = await $.ui.panes()
    if (panes.some(p => p.id === PANE)) {
      await update($, paneStatusA, () => 'already open')
      return
    }
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    await update($, paneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, paneStatusA, () => `open failed: ${err instanceof Error ? err.message : String(err)}`)
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

/** Everything both drawings read, in one place. */
async function snapshot($: $) {
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
  const memTotal = sum(hooks) + sum(claudeMd) + sum(calls)
  const actions = await read($, actionsA)
  const turn = await read($, turnA)
  const lastTurnEndAt = await read($, lastEndA)
  const now = await $.clock.now()
  return { hooks, calls, reads, claudeMd, turns, usage, alerts, searches, hits, best, codeQueries, shown, memTotal, actions, turn, lastTurnEndAt, now }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mem',
      description: 'Память → контекст: панель; /mem close|hide|show|quiet|reset',
      argumentHint: '[close|hide|show|quiet|reset]',
    })
    await $.tool.register({
      name: 'snapshot',
      description:
        'mem-meter state as JSON: settings-hook injections, CLAUDE.md token counts, mb search / mb code calls, hits read afterwards, per-turn rows, usage and vault alerts. Read-only.',
    })
    await refreshAlerts($)
    $.clock.every(ALERTS_EVERY_MS, () => refreshAlerts($))
    // The idle time since the last answer is drawn from the clock: redraw once a minute so it stays true.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    // Opened unasked: the engine seats it as a sidebar from 144 columns and holds it below that.
    // After a reload the pane may already be up with the old module's (possibly failed) drawing: redraw it.
    void openPane($).then(() => $.ui.invalidate('ui.render'))

    return next(e)
  })

  on('tool.call', { tool: 'mcp__mem-meter__snapshot' }, async $ => {
    const state = {
      turn: await read($, turnA),
      hooks: await read($, hooksA),
      claudeMd: await read($, claudeMdA),
      calls: await read($, callsA),
      reads: await read($, readsA),
      turns: await read($, turnsA),
      usage: await read($, usageA),
      alerts: await read($, alertsA),
      paneStatus: await read($, paneStatusA),
      panes: await $.ui.panes(),
      actions: (await read($, actionsA)).slice(-30),
      lastTurnEndAt: await read($, lastEndA),
    }

    return { result: JSON.stringify(state, null, 1) }
  })

  // Every tool call, in plain words, for the activity log: logged as it starts, settled as it ends.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === 'mcp__mem-meter__snapshot') return next(e)
    const words = describeAction(tool, e as unknown as Record<string, unknown>)
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `${tool}-${startedAt}`
    const action: Action = {
      id,
      turn: await read($, turnA),
      ...words,
      status: 'run',
      isAgent: e.agentId !== undefined,
      startedAt,
      ms: null,
    }
    await update($, actionsA, list => [...list, action].slice(-MAX_ACTIONS))
    const ran = await next(e)
    const status: Action['status'] = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
    const ms = (await $.clock.now()) - startedAt
    await update($, actionsA, list => list.map(a => (a.id === id ? { ...a, status, ms } : a)))

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turnA, n => n + 1)

    return next(e)
  })

  // Every text the engine injects for the model, raised on every request that carries it
  // (seen live: SessionStart's text arrived after a mid-session load); only a settings
  // hook's (Singularity's) is memory, and the hash keeps each one counted once.
  on('prompt.attachment', async ($, e, next) => {
    const answer = await next(e)
    if (e.origin.kind === 'hook' && answer.text !== null && answer.text.length > 0) {
      await recordInjection($, e.origin.event, answer.text)
    }

    return answer
  })

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
  })

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
  })

  // A Read of a file a search returned: the hit was used, not only listed.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const hit = matchesHitPath(e.file_path, (await read($, callsA)).flatMap(c => c.paths))
    if (hit !== undefined) await update($, readsA, list => (list.includes(hit) ? list : [...list, hit]))

    return ran
  })

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
  })

  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId !== undefined) return answer
    const index = await read($, turnA)
    const calls = (await read($, callsA)).filter(c => c.turn === index)
    const hooks = (await read($, hooksA)).filter(inj => inj.turn === index)
    const acts = (await read($, actionsA)).filter(a => a.turn === index)
    const u = e.usage
    const row: TurnRow = {
      index,
      searches: calls.length,
      searchTokens: sum(calls),
      hookTokens: sum(hooks),
      durationMs: e.durationMs,
      actions: acts.length,
      edits: acts.filter(a => a.kind === 'edit' || a.kind === 'delete').length,
      input: u?.input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
      cacheWrite: u?.cache_creation_input_tokens ?? 0,
    }
    await update($, turnsA, list => [...list.filter(t => t.index !== index), row].slice(-MAX_TURNS))
    const endedAt = await $.clock.now()
    await update($, lastEndA, () => endedAt)
    await refreshClaudeMd($)

    return answer
  })

  on('command.run', { command: 'mem' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'mem-meter: панель закрыта, счётчики снова на полосе над вводом (/mem — открыть).' }
    }
    if (arg === 'hide') {
      await update($, hiddenA, () => true)
      return { text: 'mem-meter: полоса скрыта (/mem show — вернуть).' }
    }
    if (arg === 'show') {
      await update($, hiddenA, () => false)
      return { text: 'mem-meter: полоса показана.' }
    }
    if (arg === 'quiet') {
      const isQuiet = !(await read($, quietA))
      await update($, quietA, () => isQuiet)
      return { text: `mem-meter: мягкие тревоги на полосе (compaction-планы, doctor WARN) ${isQuiet ? 'скрыты' : 'показаны'}.` }
    }
    if (arg === 'reset') {
      await update($, callsA, () => [])
      await update($, readsA, () => [])
      await update($, turnsA, () => [])
      await update($, actionsA, () => [])
      return { text: 'mem-meter: счётчики поиска, ходов и журнал действий сброшены (инъекции хуков и CLAUDE.md оставлены).' }
    }
    await refreshAlerts($)
    await refreshClaudeMd($)
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    await update($, paneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))

    return { text: opened.isPlaced ? 'mem-meter: панель открыта.' : `mem-meter: панель не встала: ${opened.reason}` }
  })

  // The band: hard alerts while the pane is up; without the pane, the one-line meter as well.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hiddenA))) return next(e)
    const isPane = await isPaneUp($)
    const s = await snapshot($)
    const items = [...hardAlerts(s.usage, s.alerts), ...(isPane || (await read($, quietA)) ? [] : softAlerts(s.alerts))]
    if (isPane && items.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const events = byEvent(s.hooks).map(ev => `${shortEvent(ev.event)} ${fmtTokens(ev.tokens)}`).join(' · ')
    const last = s.turns.at(-1)

    return (
      <Box flexDirection="column">
        {!isPane && (
          <Text wrap="truncate-end">
            <Text dimColor>память ▸ </Text>
            <Text>хуки ≈{fmtTokens(sum(s.hooks))}</Text>
            {events.length > 0 && <Text dimColor> ({events})</Text>}
            <Text dimColor> │ </Text>
            <Text>CLAUDE.md {s.claudeMd.length > 0 ? fmtTokens(sum(s.claudeMd)) : '?'}</Text>
            <Text dimColor> │ </Text>
            <Text color={s.searches.length > 0 ? COLORS.search : COLORS.ink2}>поиск ×{s.searches.length}</Text>
            {s.searches.length > 0 && (
              <Text dimColor>
                {' '}· {s.hits} hits · best {s.best === null ? '—' : s.best.toFixed(2)} · ≈{fmtTokens(sum(s.searches))} · прочит {s.reads.length}/{s.shown}
              </Text>
            )}
            <Text dimColor> │ </Text>
            <Text>код ×{s.codeQueries}</Text>
            {last !== undefined && last.searches === 0 && <Text color={COLORS.warning}> │ ⚠ прошлый ход без поиска</Text>}
          </Text>
        )}
        {items.length > 0 && (
          <Text wrap="truncate-end">
            <Text dimColor>⚠ </Text>
            {items.map((item, i) => (
              <Text color={item.level === 'soft' ? COLORS.muted : item.level === 'error' ? COLORS.critical : COLORS.warning}>
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
    const reason = next.error instanceof Error ? next.error.message : String(next.error)
    return (
      <Text color="error" wrap="truncate-end">
        mem-meter: полоса упала: {reason}
      </Text>
    )
  })

  // The sidebar: a dark surface filling the column, drawn by pane.tsx from the session's figures.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await snapshot($)
    return drawPane($.ui.resolve(e), s, e.props.bodyColumns, e.props.scroll.bodyRows)
  }).catch(($, e, next) => {
    // A drawing that throws shows its error in the pane instead of a blank column.
    const { Box, Text } = $.ui.resolve(e)
    const reason = next.error instanceof Error ? next.error.message : String(next.error)
    return (
      <Box flexDirection="column" backgroundColor={COLORS.surface} paddingX={1}>
        <Text color={COLORS.critical} bold>
          mem-meter: панель упала
        </Text>
        <Text color={COLORS.ink2} wrap="wrap">
          {reason}
        </Text>
      </Box>
    )
  })
}
