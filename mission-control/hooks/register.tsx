import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Alerts, ClaudeMdFile, TurnRow } from '../types'
import { MEMORY_PANE, registerMemory } from './memory/hooks'
import { countDoctor } from './lib/parse'
import { registerMission } from './mission/hooks'

// The module's entry and its lifecycle. The engine takes one unmatched hook per
// event per module and never follows `$` into an imported function, so everything
// that spans both features or runs on a timer lives here: session.start,
// turn.complete, the commands, the snapshot tool, the vault alerts, the panes.
// memory/ and mission/ register their own observers and drawings.

const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
const MEMORY_TITLE = 'Память'
const MAX_TURNS = 50
const ALERTS_EVERY_MS = 5 * 60_000

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
const paneStatusA = atom({ plugin: 'mission-control', key: 'paneStatus' } as const, null)
const agentsPaneStatusA = atom({ plugin: 'mission-control', key: 'agentsPaneStatus' } as const, null)
const actionsA = atom({ plugin: 'mission-control', key: 'actions' } as const, [])
const lastEndA = atom({ plugin: 'mission-control', key: 'lastTurnEndAt' } as const, null)
const agentsA = atom({ plugin: 'mission-control', key: 'agents' } as const, [])

type $ = EngineInterface

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sum(list: readonly { tokens: number }[]): number {
  return list.reduce((acc, x) => acc + x.tokens, 0)
}

/**
 * Runs each part of a shared event in turn. One part's failure does not skip the
 * others; the first failure is thrown once all have run, so the engine still
 * reports the hook as failed instead of it failing silently.
 */
async function fanOut(parts: readonly (() => Promise<void>)[]): Promise<void> {
  const errors: unknown[] = []
  for (const part of parts) {
    try {
      await part()
    } catch (err) {
      errors.push(err)
    }
  }
  if (errors.length > 0) throw errors[0]
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
    next.error = reason(err)
  }
  await update($, alertsA, () => next)
}

/** Opens the Memory tab unless it is open; records what the engine answered, so a tab that never shows can be explained. */
async function openMemoryPane($: $): Promise<void> {
  try {
    if ((await $.ui.panes()).some(p => p.id === MEMORY_PANE)) {
      await update($, paneStatusA, () => 'already open')
      return
    }
    const opened = await $.ui.open({ id: MEMORY_PANE, title: MEMORY_TITLE })
    await update($, paneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, paneStatusA, () => `open failed: ${reason(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await fanOut([
      async () => {
        await $.tool.register({
          name: 'snapshot',
          description:
            'mission-control state as JSON: agents (main and every subagent: phase, task, intent, current action, report), the activity feed, and the memory figures (settings-hook injections, CLAUDE.md tokens, mb search / mb code calls, turns, usage, vault alerts). Read-only.',
        })
      },
      async () => {
        await $.command.register({
          name: 'mem',
          description: 'Память → контекст: вкладка «Память»; /mem close|hide|show|quiet|reset',
          argumentHint: '[close|hide|show|quiet|reset]',
        })
      },
      async () => {
        await refreshAlerts($)
        $.clock.every(ALERTS_EVERY_MS, () => void refreshAlerts($))
        // Idle times are drawn from the clock: redraw once a minute so they stay true.
        $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
      },
    ])
    // After a reload a pane may be up with the old module's drawing: redraw once it is (re)opened.
    void openMemoryPane($)
      .then(() => $.ui.invalidate('ui.render'))
      .catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)
    await fanOut([
      // Memory: a main turn's row (searches, hook text, steps, edits, cache) and the CLAUDE.md figures.
      async () => {
        if (e.agentId !== undefined) return
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
      },
    ])
    return answer
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mem' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: MEMORY_PANE })
      return { text: 'mission-control: вкладка «Память» закрыта, счётчики снова на полосе над вводом (/mem — открыть).' }
    }
    if (arg === 'hide') {
      await update($, hiddenA, () => true)
      return { text: 'mission-control: полоса памяти скрыта (/mem show — вернуть).' }
    }
    if (arg === 'show') {
      await update($, hiddenA, () => false)
      return { text: 'mission-control: полоса памяти показана.' }
    }
    if (arg === 'quiet') {
      const isQuiet = !(await read($, quietA))
      await update($, quietA, () => isQuiet)
      return { text: `mission-control: мягкие тревоги на полосе (compaction-планы, doctor WARN) ${isQuiet ? 'скрыты' : 'показаны'}.` }
    }
    if (arg === 'reset') {
      await update($, callsA, () => [])
      await update($, readsA, () => [])
      await update($, turnsA, () => [])
      return { text: 'mission-control: счётчики поиска и ходов сброшены (инъекции хуков, CLAUDE.md, агенты и лента оставлены).' }
    }
    await refreshAlerts($)
    await refreshClaudeMd($)
    const opened = await $.ui.open({ id: MEMORY_PANE, title: MEMORY_TITLE })
    await update($, paneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
    return { text: opened.isPlaced ? 'mission-control: вкладка «Память» открыта.' : `mission-control: вкладка не встала: ${opened.reason}` }
  }).catch(($, e, next) => ({ text: `mission-control: /mem упала: ${reason(next.error)}` }))

  on('tool.call', { tool: SNAPSHOT_TOOL }, async $ => {
    let panes: unknown = []
    try {
      panes = await $.ui.panes()
    } catch {
      // no surface bound (a test, a headless start): the rest still answers
    }
    const state = {
      turn: await read($, turnA),
      agents: await read($, agentsA),
      actions: (await read($, actionsA)).slice(-30),
      hooks: await read($, hooksA),
      claudeMd: await read($, claudeMdA),
      calls: await read($, callsA),
      reads: await read($, readsA),
      turns: await read($, turnsA),
      usage: await read($, usageA),
      alerts: await read($, alertsA),
      paneStatus: await read($, paneStatusA),
      agentsPaneStatus: await read($, agentsPaneStatusA),
      panes,
      lastTurnEndAt: await read($, lastEndA),
    }
    return { result: JSON.stringify(state, null, 1) }
  })

  registerMission(on)
  registerMemory(on)
}
