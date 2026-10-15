import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Alerts, ClaudeMdFile, Job, TurnRow } from '../types'
import { JOBS_PANE, registerJobs } from './jobs/hooks'
import {
  FULL_READ_MAX,
  TAIL_BYTES,
  applyDeadlines,
  applyOutput,
  clearJobs,
  freshOutput,
  markAnnounced,
  needsPoll,
  toAnnounce,
} from './jobs/model'
import type { OutputRead } from './jobs/model'
import { MEMORY_PANE, registerMemory } from './memory/hooks'
import { countDoctor } from './lib/parse'
import { themeOf } from './lib/theme'
import type { Theme } from './lib/theme'
import { AGENTS_PANE, registerMission } from './mission/hooks'
import { applyComplete, applyList, clearEnded, needsReconcile, needsTick } from './mission/model'
import type { ListedAgent } from './mission/model'

// The module's entry and its lifecycle. The engine takes one unmatched hook per
// event per module and never follows `$` into an imported function, so everything
// that spans both features or runs on a timer lives here: session.start,
// turn.complete, the commands, the snapshot tool, the vault alerts, the panes.
// memory/ and mission/ register their own observers and drawings.

const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
const MAX_TURNS = 50
/** Running jobs' output files are read once a second, and only while one runs. */
const JOBS_MS = 1000
/** While the tasks folder is not found, it is looked for again at most this often. */
const JOBS_DIR_RETRY_MS = 30_000
const ALERTS_EVERY_MS = 5 * 60_000
/** Timers on the Agents tab are redrawn once a second, and only while something works. */
const TICK_MS = 1000
/** The engine's own agent list is read every 2 s, and only while a subagent works. */
const LIST_MS = 2000

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
const jobsA = atom({ plugin: 'mission-control', key: 'jobs' } as const, [])
const jobsDirA = atom({ plugin: 'mission-control', key: 'jobsDir' } as const, null)
const jobsPaneStatusA = atom({ plugin: 'mission-control', key: 'jobsPaneStatus' } as const, null)

type $ = EngineInterface

/** When the tasks folder was last looked for: a module variable, a reload looks again at once. */
let jobsDirTriedAt = Number.NEGATIVE_INFINITY

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sum(list: readonly { tokens: number }[]): number {
  return list.reduce((acc, x) => acc + x.tokens, 0)
}

/**
 * Runs each part of a shared event in turn. One part's failure does not skip the
 * others; the first failure is thrown once all have run, and the hook's `.catch`
 * then lets the event go on (fail-open): a broken part never holds up the session,
 * and the failure stays out of the transcript.
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
async function openMemoryPane($: $, theme: Theme): Promise<void> {
  try {
    const mine = (await $.ui.panes()).find(p => p.id === MEMORY_PANE)
    if (mine !== undefined && mine.title === theme.titles.memory) {
      await update($, paneStatusA, () => 'already open')
      return
    }
    // Open under another title: the theme changed and the module reloaded, so the tab is opened again under the new one.
    if (mine !== undefined) await $.ui.close({ id: MEMORY_PANE })
    const opened = await $.ui.open({ id: MEMORY_PANE, title: theme.titles.memory })
    await update($, paneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, paneStatusA, () => `open failed: ${reason(err)}`)
  }
}

/** Opens the Agents tab unless it is open; records what the engine answered, so a tab that never shows can be explained. */
async function openAgentsPane($: $, theme: Theme): Promise<void> {
  try {
    const mine = (await $.ui.panes()).find(p => p.id === AGENTS_PANE)
    if (mine !== undefined && mine.title === theme.titles.agents) {
      await update($, agentsPaneStatusA, () => 'already open')
      return
    }
    // Open under another title: the theme changed and the module reloaded, so the tab is opened again under the new one.
    if (mine !== undefined) await $.ui.close({ id: AGENTS_PANE })
    const opened = await $.ui.open({ id: AGENTS_PANE, title: theme.titles.agents })
    await update($, agentsPaneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, agentsPaneStatusA, () => `open failed: ${reason(err)}`)
  }
}

/** Opens the Processes tab unless it is open; records what the engine answered. */
async function openJobsPane($: $, theme: Theme): Promise<void> {
  try {
    const mine = (await $.ui.panes()).find(p => p.id === JOBS_PANE)
    if (mine !== undefined && mine.title === theme.titles.jobs) {
      await update($, jobsPaneStatusA, () => 'already open')
      return
    }
    // Open under another title: the theme changed and the module reloaded, so the tab is opened again under the new one.
    if (mine !== undefined) await $.ui.close({ id: JOBS_PANE })
    const opened = await $.ui.open({ id: JOBS_PANE, title: theme.titles.jobs })
    await update($, jobsPaneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, jobsPaneStatusA, () => `open failed: ${reason(err)}`)
  }
}

/**
 * A long action has begun: bring the Processes tab to the front, so its progress is on
 * screen without asking. The tab opened last is the one shown, so an open tab behind
 * another is closed and opened again; never while the person holds a pane's keyboard.
 */
async function raiseJobsPane($: $, job: Job, theme: Theme): Promise<void> {
  try {
    $.ui.toast(`${theme.titles.jobs}: ${theme.words.kinds[job.kind]} — ${job.description.length > 0 ? job.description : job.gist}`)
    const panes = await $.ui.panes()
    const mine = panes.find(p => p.id === JOBS_PANE)
    if (mine !== undefined && (mine.isShown || panes.some(p => p.isFocused))) return
    if (mine !== undefined) await $.ui.close({ id: JOBS_PANE })
    const opened = await $.ui.open({ id: JOBS_PANE, title: theme.titles.jobs })
    await update($, jobsPaneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, jobsPaneStatusA, () => `raise failed: ${reason(err)}`)
  }
}

/**
 * The session's background-task folder, `<tmp>/claude-<uid>/<cwd slug>/<session id>/tasks`:
 * looked for under the temp roots by the session id alone, so neither the uid nor the
 * slug's rules have to be guessed. Null when it is not there (yet).
 */
async function findTasksDir($: $): Promise<string | null> {
  const sessionId = await $.session.id()
  const roots = new Set<string>(['/tmp', '/private/tmp'])
  // The engine lists the variables a module reads: each is named by a literal.
  const named = [await $.env.get('CLAUDE_CODE_TMPDIR'), await $.env.get('TMPDIR'), await $.env.get('TEMP'), await $.env.get('TMP')]
  for (const v of named) {
    if (v !== undefined && v.length > 0) roots.add(v.replace(/[\\/]+$/, ''))
  }
  for (const root of roots) {
    let tops: { name: string; kind: string }[]
    try {
      tops = (await $.fs.list(root)).filter(f => f.kind === 'dir' && f.name.startsWith('claude'))
    } catch {
      continue
    }
    for (const top of tops) {
      let projects: { name: string; kind: string }[]
      try {
        projects = (await $.fs.list(`${root}/${top.name}`)).filter(f => f.kind === 'dir')
      } catch {
        continue
      }
      for (const project of projects) {
        const dir = `${root}/${top.name}/${project.name}/${sessionId}/tasks`
        if (await $.fs.exists(dir)) return dir
      }
    }
  }
  return null
}

/** The task output files in the tasks folder; [] when it cannot be read. */
async function listOutputs($: $, dir: string): Promise<string[]> {
  try {
    return (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.output')).map(f => f.name)
  } catch {
    return []
  }
}

/** The last TAIL_BYTES of an output; a large file through `tail -c`, never read whole. Null when unreadable. */
async function readTail($: $, path: string, size: number): Promise<string | null> {
  try {
    if (size <= FULL_READ_MAX) return (await readText($, path)).slice(-TAIL_BYTES)
    const ran = await $.process.run(['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: 5000 })
    return ran.exitCode === 0 ? ran.stdout : null
  } catch {
    return null
  }
}

/**
 * Once a second while a job runs: finds a foreground call's output file, reads each
 * running job's output when it grew (progress, last line, a background exit), ends a
 * monitor past its deadline, and raises the tab for a job that just became long.
 */
async function pollJobs($: $, theme: Theme): Promise<void> {
  try {
    const jobs = await read($, jobsA)
    if (!needsPoll(jobs)) return
    const now = await $.clock.now()
    let dir = await read($, jobsDirA)
    if (dir === null && now - jobsDirTriedAt >= JOBS_DIR_RETRY_MS) {
      jobsDirTriedAt = now
      dir = await findTasksDir($)
      const found = dir
      if (found !== null) await update($, jobsDirA, () => found)
    }
    const running = jobs.filter(j => j.status === 'run')
    // A foreground call's file is the one new since it began, when exactly one is.
    const attach = new Map<string, string>()
    const unattached = running.filter(j => j.outputPath === null && !j.isBackground && j.before !== null)
    if (dir !== null && unattached.length === 1) {
      const job = unattached[0]
      const claimed = new Set(jobs.map(j => (j.outputPath === null ? '' : (j.outputPath.split(/[\\/]/).at(-1) ?? ''))))
      const name = job === undefined || job.before === null ? null : freshOutput(job.before, await listOutputs($, dir), claimed)
      if (job !== undefined && name !== null) attach.set(job.id, `${dir}/${name}`)
    }
    const reads: OutputRead[] = []
    for (const job of running) {
      const path = job.outputPath ?? attach.get(job.id) ?? null
      if (path === null) continue
      try {
        const stat = await $.fs.stat(path)
        const grew = stat.size !== job.outputSize || job.outputPath === null
        reads.push({ id: job.id, path, size: stat.size, tail: grew ? await readTail($, path, stat.size) : null })
      } catch {
        // not written yet, or a foreground call's file already gone: its tool.call end settles it
      }
    }
    await update($, jobsA, list => applyDeadlines(applyOutput(list, reads, now), now))
    const fresh = toAnnounce(await read($, jobsA), now)
    const first = fresh[0]
    if (first !== undefined) {
      await update($, jobsA, list => markAnnounced(list, fresh.map(j => j.id)))
      await raiseJobsPane($, first, theme)
    }
    // Elapsed times on the tab move every second even when no output did.
    $.ui.invalidate('ui.render')
  } catch {
    // a missed poll is made up by the next one
  }
}

/** Redraws while something works, so the Agents tab's timers stay true; does nothing when all is quiet. */
async function tick($: $): Promise<void> {
  try {
    if (needsTick(await read($, agentsA), await $.clock.now())) $.ui.invalidate('ui.render')
  } catch {
    // a missed redraw is drawn by the next tick
  }
}

/** Squares the rows with $.agent.list(); `always` reads it even when nothing works (a load, a reload). */
async function reconcile($: $, always: boolean): Promise<void> {
  try {
    if (!always && !needsReconcile(await read($, agentsA), await $.clock.now())) return
    const listed: ListedAgent[] = (await $.agent.list()).map(a => ({
      id: a.id,
      type: a.type,
      description: a.description,
      status: a.status,
      ...(a.parentId === undefined ? {} : { parentId: a.parentId }),
      ...(a.name === undefined ? {} : { name: a.name }),
      isTeammate: a.teammateId !== undefined,
    }))
    const turn = await read($, turnA)
    const now = await $.clock.now()
    await update($, agentsA, rows => applyList(rows, listed, { turn, now }))
  } catch {
    // no session bound yet, or a host without agents: the events still keep the rows
  }
}

export const register: Register = (on, options) => {
  // The look comes from the `theme` option (/config → mission-control); a change there
  // reloads the module, so it is read once here and handed to every drawing.
  const theme = themeOf((options as Record<string, unknown> | undefined)?.theme)

  on('session.start', async ($, e, next) => {
    // The tabs open first and on their own, so a registration that fails below cannot keep
    // them shut. Memory first, Agents last: the tab opened last is the one on screen (seen
    // live in a 170-column terminal), and mission control is what the person opens the
    // sidebar for; Processes comes forward by itself when a long action begins. After a
    // reload any may be up with the old module's drawing, so all are redrawn once (re)opened.
    void openMemoryPane($, theme)
      .then(() => openJobsPane($, theme))
      .then(() => openAgentsPane($, theme))
      .then(() => $.ui.invalidate('ui.render'))
      .catch(() => undefined)
    await fanOut([
      async () => {
        await $.tool.register({
          name: 'snapshot',
          description:
            'mission-control state as JSON: agents (main and every subagent: phase, task, intent, current action, report), the activity feed, long jobs (background shells, long commands, monitors: kind, gist, who started them, progress parsed from their output), and the memory figures (settings-hook injections, CLAUDE.md tokens, mb search / mb code calls, turns, usage, vault alerts). Read-only.',
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
      async () => {
        await $.command.register({
          name: 'mc',
          description: 'Mission control: кто из агентов чем занят и почему; /mc close|clear',
          argumentHint: '[close|clear]',
        })
      },
      async () => {
        $.clock.every(TICK_MS, () => void tick($))
        $.clock.every(LIST_MS, () => void reconcile($, false))
        // A reload (or the mod set up mid-session) finds agents already at work: learn them now.
        await reconcile($, true)
      },
      async () => {
        await $.command.register({
          name: 'jobs',
          description: 'Процессы: долгие команды (скачивание, обучение, подготовка данных) с прогрессом; /jobs close|clear',
          argumentHint: '[close|clear]',
        })
      },
      async () => {
        $.clock.every(JOBS_MS, () => void pollJobs($, theme))
        // Found now, so a foreground call's file can be told apart from the first call on.
        if ((await read($, jobsDirA)) === null) {
          jobsDirTriedAt = await $.clock.now()
          const dir = await findTasksDir($)
          if (dir !== null) await update($, jobsDirA, () => dir)
        }
      },
    ])
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
      // Mission control: the loop's row ends (main waits, a subagent reports, a teammate idles).
      async () => {
        const now = await $.clock.now()
        const u = e.usage
        // New work only: every step re-reads the cached context, so cache reads would count it
        // again per step (seen live: 77k summed against the engine's own 27k for one agent).
        const tokens = u === undefined ? 0 : (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        await update($, agentsA, rows => applyComplete(rows, { agentId: e.agentId ?? null, reason: e.reason, answer: e.answer, tokens, now }))
      },
    ])
    return answer
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mc' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: AGENTS_PANE })
      return { text: 'mission-control: вкладка «Агенты» закрыта (/mc — открыть).' }
    }
    if (arg === 'clear') {
      const turn = await read($, turnA)
      await update($, agentsA, rows => clearEnded(rows))
      await update($, actionsA, list => list.filter(a => a.turn === turn))
      return { text: 'mission-control: завершённые агенты и лента прошлых ходов убраны.' }
    }
    if (arg.length > 0) return { text: `mission-control: не знаю «${arg}». /mc — открыть вкладку, /mc close, /mc clear.` }
    const opened = await $.ui.open({ id: AGENTS_PANE, title: theme.titles.agents })
    await update($, agentsPaneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
    return { text: opened.isPlaced ? 'mission-control: вкладка «Агенты» открыта.' : `mission-control: вкладка не встала: ${opened.reason}` }
  }).catch(($, e, next) => ({ text: `mission-control: /mc упала: ${reason(next.error)}` }))

  on('command.run', { command: 'jobs' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: JOBS_PANE })
      return { text: 'mission-control: вкладка «Процессы» закрыта (/jobs — открыть; новый долгий процесс откроет её сам).' }
    }
    if (arg === 'clear') {
      await update($, jobsA, jobs => clearJobs(jobs))
      return { text: 'mission-control: завершённые процессы убраны.' }
    }
    if (arg.length > 0) return { text: `mission-control: не знаю «${arg}». /jobs — открыть вкладку, /jobs close, /jobs clear.` }
    const opened = await $.ui.open({ id: JOBS_PANE, title: theme.titles.jobs })
    await update($, jobsPaneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
    return { text: opened.isPlaced ? 'mission-control: вкладка «Процессы» открыта.' : `mission-control: вкладка не встала: ${opened.reason}` }
  }).catch(($, e, next) => ({ text: `mission-control: /jobs упала: ${reason(next.error)}` }))

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
    const opened = await $.ui.open({ id: MEMORY_PANE, title: theme.titles.memory })
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
      jobs: await read($, jobsA),
      jobsDir: await read($, jobsDirA),
      jobsPaneStatus: await read($, jobsPaneStatusA),
      panes,
      lastTurnEndAt: await read($, lastEndA),
    }
    return { result: JSON.stringify(state, null, 1) }
  })

  registerMission(on, theme)
  registerMemory(on, theme)
  registerJobs(on, theme)
}
