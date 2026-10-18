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
import { BOOT_MS, markBoot } from './lib/boot'
import { cogCells } from './lib/cog'
import { COG, SKULL, cogAngle, cogPalette, skullFrame } from './lib/frame'
import { halfBlockCells } from './lib/pixmap'
import { drawsPictures, loadPixmap, refusePictures, saysAlt } from './lib/terminal'
import { AQUILA_PNG } from './lib/art'
import { countDoctor } from './lib/parse'
import { themeOf } from './lib/theme'
import type { Theme } from './lib/theme'
import { AGENTS_PANE, registerMission } from './mission/hooks'
import { leadConfigOf } from './lead/config'
import { takeDigest } from './lead/digest'
import { EMPTY_LEAD, pushNews } from './lead/ledger'
import { BUDGET_BAD, BUDGET_NO_LIMIT, TEAM_TOOL, budgetIncrement, haltLead, raiseBudget, resumeLead, sessionLimit, soloLead, teamReport, teamTable } from './lead/team'
import { watchStep } from './lead/watch'
import { applyComplete, applyList, clearEnded, isWorking, needsReconcile, needsTick } from './mission/model'
import type { ListedAgent } from './mission/model'
import { registerChrome } from './chrome/hooks'

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
/**
 * The slate's cog turns at four frames a second while an agent works: each frame is a
 * redraw of the terminal (and of its shader over the whole window), and at ten pixels
 * across four read as a turn as well as eight (measured 2026-10-16: Ghostty ~8-9% CPU
 * with two sessions open and the cog turning).
 */
const COG_MS = 250
/** After a blit the engine refused (the tab not on screen), the cog waits this long. */
const COG_REST_MS = 5000
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
const leadA = atom({ plugin: 'mission-control', key: 'lead' } as const, EMPTY_LEAD)

type $ = EngineInterface

/** When the tasks folder was last looked for: a module variable, a reload looks again at once. */
let jobsDirTriedAt = Number.NEGATIVE_INFINITY
/** Until when the cog rests after a refused blit: a module variable, a reload tries at once. */
let cogRestsUntil = Number.NEGATIVE_INFINITY
/** Until when the servo-skull rests after a refused blit (Обряды closed or behind another tab). */
let skullRestsUntil = Number.NEGATIVE_INFINITY

/** The slate's sounds: their gain from the `sound` option (0 is silence), set as the module registers. */
const SOUND_GAIN: Record<string, number> = { off: 0, quiet: 0.35, full: 1 }
let soundGain = 0
/** Each job's status at the last look, to sound a rite's end once. */
const riteStatus = new Map<string, string>()

/**
 * Where the sounds play: the engine's player (macOS, afplay), or one the mod runs itself
 * where the engine has none (Windows: PowerShell's MediaPlayer; Linux: paplay or aplay).
 * Found once as the session starts; null until then, and where nothing can play.
 */
let soundHost: 'engine' | 'windows' | 'linux' | null = null

/** Which player this machine has: Windows by its OS variable, macOS or Linux by uname. */
async function findSoundHost($: $): Promise<'engine' | 'windows' | 'linux' | null> {
  try {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
    const ran = await $.process.run(['uname', '-s'], { timeoutMs: 3000 })
    return ran.stdout.trim() === 'Darwin' ? 'engine' : 'linux'
  } catch {
    return null
  }
}

/** The absolute path of one of the mod's sounds ($.plugin.root may name .claude-plugin itself). */
function soundFile($: $, name: string): string {
  const root = $.plugin.root.replace(/[\\/]\.claude-plugin[\\/]?$/, '').replace(/[\\/]+$/, '')
  return `${root}/sounds/${name}.wav`
}

/** Plays one of the slate's sounds (mission-control/sounds/<name>.wav); silent where it cannot. */
async function chime($: $, name: 'awake' | 'vox' | 'servo' | 'rite-done' | 'heresy'): Promise<void> {
  if (soundGain <= 0 || soundHost === null) return
  try {
    if (soundHost === 'engine') {
      await $.audio.play({ asset: `sounds/${name}.wav` }, { gain: soundGain })
      return
    }
    const file = soundFile($, name)
    if (soundHost === 'windows') {
      // MediaPlayer, unlike SoundPlayer, takes a volume; it plays while the script waits.
      const script = `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]'${file.replace(/'/g, "''")}'); $p.Volume = ${soundGain}; $p.Play(); Start-Sleep -Milliseconds 1600`
      await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 5000 })
      return
    }
    try {
      await $.process.run(['paplay', `--volume=${Math.round(soundGain * 65536)}`, file], { timeoutMs: 5000 })
    } catch {
      await $.process.run(['aplay', '-q', file], { timeoutMs: 5000 })
    }
  } catch {
    // no player here, or the clip could not play: the slate stays silent
  }
}

/** Once a second: a rite that ended since the last look sounds its end, done or failed. */
async function listenRites($: $): Promise<void> {
  try {
    for (const job of await read($, jobsA)) {
      const before = riteStatus.get(job.id)
      riteStatus.set(job.id, job.status)
      if (before !== 'run' || job.status === 'run') continue
      if (job.status === 'ok') await chime($, 'rite-done')
      else if (job.status === 'error') await chime($, 'heresy')
    }
  } catch {
    // a missed look is made up by the next one
  }
}

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
    const what = `${theme.words.kinds[job.kind]} — ${job.description.length > 0 ? job.description : job.gist}`
    $.ui.toast(theme.slate === null ? `${theme.titles.jobs}: ${what}` : `+++ ${theme.titles.jobs.toUpperCase()} ✠ ${what} +++`)
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
      void chime($, 'servo')
      await raiseJobsPane($, first, theme)
    }
    // Elapsed times on the tab move every second even when no output did.
    $.ui.invalidate('ui.render')
  } catch {
    // a missed poll is made up by the next one
  }
}

/**
 * Turns the slate's cogs by one frame while work goes on: a blit of each tab's Raster,
 * no redraw. The angle comes from the clock, so a redraw draws a cog where the blits
 * left it. When no cog took the frame (the tabs closed or hidden), they rest a while.
 */
async function turnCog($: $, theme: Theme, skullOnJobs: boolean): Promise<void> {
  try {
    const slate = theme.slate
    if (slate === null) return
    const now = await $.clock.now()
    if (now < cogRestsUntil) return
    // Each tab's cog turns while its own work goes on: agents on Легион, rites on Обряды.
    const agentsAwake = (await read($, agentsA)).some(r => isWorking(r.phase))
    // On Обряды a servo-skull may stand in the cog's place: it has its own timer.
    const forgeAwake = !skullOnJobs && (await read($, jobsA)).some(j => j.status === 'run')
    if (!agentsAwake && !forgeAwake) return
    const cells = cogCells(COG.columns, COG.rows, cogAngle(now), cogPalette(theme, slate))
    let shown = false
    for (const [pane, awake] of [
      [AGENTS_PANE, agentsAwake],
      [JOBS_PANE, forgeAwake],
    ] as const) {
      if (!awake) continue
      const res = await $.ui.blit({ requestId: pane, key: COG.key, cells })
      if (res.deny === undefined) shown = true
    }
    if (!shown) cogRestsUntil = now + COG_REST_MS
  } catch {
    // no surface bound, or the tab drawn without a cog: the next frame tries again
  }
}

/**
 * The servo-skull on Обряды hovers while a rite runs: the next frame's file, swapped by a
 * blit. At rest it holds still (each frame is a redraw of the window). A refused blit
 * (the tab hidden, or a terminal without pictures, where the cog is drawn instead) rests it.
 */
async function hoverSkull($: $, dir: string, pictures: boolean): Promise<void> {
  try {
    const now = await $.clock.now()
    if (now < skullRestsUntil) return
    if (!(await read($, jobsA)).some(j => j.status === 'run')) return
    // A picture's next file where the terminal draws pictures, else its pixmap in half blocks.
    const frame = skullFrame(dir, now)
    // Asked each frame: the engine may have refused pictures here since the session began.
    const live = pictures && (await drawsPictures($))
    const pix = live ? null : await loadPixmap($, frame)
    if (!live && pix === null) return
    const res =
      pix === null
        ? await $.ui.blit({ requestId: JOBS_PANE, key: SKULL.key, source: { file: frame, format: 'png' } })
        : await $.ui.blit({ requestId: JOBS_PANE, key: SKULL.key, cells: halfBlockCells(pix, SKULL.columns, SKULL.rows) })
    if (saysAlt(res.deny)) {
      // The engine draws the picture's alt here: the slate goes back to its cells.
      refusePictures()
      $.ui.invalidate('ui.render')
    }
    if (res.deny !== undefined) skullRestsUntil = now + COG_REST_MS
  } catch {
    skullRestsUntil = Number.POSITIVE_INFINITY // no surface here: a reload tries again
  }
}

/**
 * Is the terminal really drawing pictures? Taken for one by its name (Ghostty, kitty),
 * it is asked once: the crest's picture blitted again. Where the engine answers
 * that it draws the alt there, the slate goes back to its cells, every tab redrawn.
 * The blit carries the very picture the tab draws (the chosen one when there is one):
 * the mod's own in its place would stand on Легион until the tab is drawn again.
 */
async function probePictures($: $, crestFile: string | null): Promise<void> {
  try {
    if (!(await drawsPictures($))) return
    const source = crestFile !== null ? { file: crestFile, format: 'png' as const } : { png: AQUILA_PNG }
    const res = await $.ui.blit({ requestId: AGENTS_PANE, key: 'crest', source })
    if (saysAlt(res.deny)) {
      refusePictures()
      $.ui.invalidate('ui.render')
    }
  } catch {
    // no surface here: the next start asks again
  }
}

/** Redraws while something works, so the Agents tab's timers stay true; does nothing when all is quiet. */
async function tick($: $): Promise<void> {
  try {
    if (needsTick(await read($, agentsA), await $.clock.now())) $.ui.invalidate('ui.render')
  } catch {
    // a missed redraw is drawn by the next tick
  }
  await watch($)
}

/**
 * The watchdog (spec 6.5), on the same tick (it runs whether or not anything is drawn): new alarms go to the
 * lead's news; an idle lead is also woken, at most once per 10 minutes. Fails open: a throw is told once.
 */
async function watch($: $): Promise<void> {
  try {
    const rows = await read($, agentsA)
    const now = await $.clock.now()
    const held = await read($, leadA)
    if (watchStep(held, rows, now).lead === held) return
    const out: { wake: string | null } = { wake: null }
    await update($, leadA, cur => {
      const step = watchStep(cur, rows, now)
      out.wake = step.wake
      return step.lead
    })
    if (out.wake !== null) await $.prompt.submit({ text: out.wake })
  } catch (err) {
    try {
      await update($, leadA, cur =>
        cur.flags.includes('guard-error')
          ? cur
          : { ...pushNews(cur, `сторож упал: ${reason(err)}`), flags: [...cur.flags, 'guard-error'] },
      )
    } catch {
      // nothing more to do: the next tick tries again
    }
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
  // Sounds belong to a slate; the `sound` option sets how loud (quiet when unset).
  const soundOpt = (options as Record<string, unknown> | undefined)?.sound
  soundGain = theme.slate === null ? 0 : (SOUND_GAIN[typeof soundOpt === 'string' ? soundOpt : 'quiet'] ?? SOUND_GAIN.quiet ?? 0)
  // A crest picture the person chose (tools/install.mjs --aquila): an absolute PNG path.
  const chosen = (options as Record<string, unknown> | undefined)?.aquilaImage
  const crestFile = typeof chosen === 'string' && chosen.trim().length > 0 ? chosen.trim() : null
  // A servo-skull's frames the person chose (tools/install.mjs --servo-skull): a folder.
  const skull = (options as Record<string, unknown> | undefined)?.servoSkull
  const skullDir = typeof skull === 'string' && skull.trim().length > 0 ? skull.trim() : null
  // A purity seal the person chose (tools/install.mjs --purity-seal): a PNG.
  const sealOpt = (options as Record<string, unknown> | undefined)?.puritySeal
  const sealFile = typeof sealOpt === 'string' && sealOpt.trim().length > 0 ? sealOpt.trim() : null
  // The ranks' portraits the person chose (tools/install.mjs --portrait): a folder.
  const portraitsOpt = (options as Record<string, unknown> | undefined)?.rankPortraits
  const portraitsDir = typeof portraitsOpt === 'string' && portraitsOpt.trim().length > 0 ? portraitsOpt.trim() : null

  on('session.start', async ($, e, next) => {
    // The slate's awakening: the band plays the cogitator's boot for a few seconds, redrawn
    // four times a second, then the timer stops itself.
    if (theme.slate !== null) {
      try {
        const began = await $.clock.now()
        markBoot(began)
        if (soundGain > 0) soundHost = await findSoundHost($)
        void chime($, 'awake')
        const timer = $.clock.every(250, () => {
          $.ui.invalidate('ui.render')
          void $.clock.now().then(now => {
            if (now - began > BOOT_MS + 250) timer.cancel()
          })
        })
      } catch {
        // no clock bound: the band draws as always
      }
    }
    // The tabs open first and on their own, so a registration that fails below cannot keep
    // them shut. Memory first, Agents last: the tab opened last is the one on screen (seen
    // live in a 170-column terminal), and mission control is what the person opens the
    // sidebar for; Processes comes forward by itself when a long action begins. After a
    // reload any may be up with the old module's drawing, so all are redrawn once (re)opened.
    void openMemoryPane($, theme)
      .then(() => openJobsPane($, theme))
      .then(() => openAgentsPane($, theme))
      .then(() => $.ui.invalidate('ui.render'))
      .then(() => {
        if (theme.slate !== null) $.clock.after(2000, () => void probePictures($, crestFile))
      })
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
        await $.tool.register({
          name: 'team',
          description:
            'The executors you delegated to, as a table: id, tier, effort, task, turns, OE spent (and the limit), state. Also the session OE budget, the Fable calls used, the news the digest has not delivered yet and the flags (frozen, solo, budget notices). Read-only: it does not clear the news.',
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
          description: 'Mission control: кто из агентов чем занят и почему; /mc close|clear|budget [+N]|halt|resume|solo',
          argumentHint: '[close|clear|budget [+N]|halt|resume|solo]',
        })
      },
      async () => {
        $.clock.every(TICK_MS, () => void tick($))
        // On Обряды the servo-skull stands in the cog's place where it can be drawn (a picture,
        // or the pixmaps beside its frames where the terminal draws none) on its own timer;
        // elsewhere both tabs' cogs turn on the one.
        const pictures = await drawsPictures($)
        const skullOn = theme.slate !== null && skullDir !== null && (pictures || (await loadPixmap($, skullFrame(skullDir, 0))) !== null)
        if (theme.slate !== null) $.clock.every(COG_MS, () => void turnCog($, theme, skullOn))
        if (soundGain > 0) $.clock.every(1000, () => void listenRites($))
        if (skullOn && skullDir !== null) $.clock.every(SKULL.frameMs, () => void hoverSkull($, skullDir, pictures))
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
      // The council window is the main turn that opened it: main's end closes it.
      async () => {
        if (e.agentId === undefined) await update($, leadA, l => (l.councilTurn === null ? l : { ...l, councilTurn: null }))
      },
      // The vox chirps when a main turn ends (the slate's sound).
      async () => {
        if (e.agentId === undefined) await chime($, 'vox')
      },
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
    const words = arg.split(/\s+/)
    if (words[0] === 'budget') {
      if (words.length === 1) return { text: teamTable(await read($, agentsA), await read($, leadA), leadConfig, await $.clock.now()) }
      const n = budgetIncrement(words.slice(1))
      if (n === null) return { text: BUDGET_BAD }
      if (leadConfig.sessionBudget === null) return { text: BUDGET_NO_LIMIT }
      await update($, leadA, cur => raiseBudget(cur, leadConfig, n))
      return { text: `mission-control: лимит сессии: ${sessionLimit(await read($, leadA), leadConfig)} OE (+${n})` }
    }
    if (words.length === 1 && words[0] === 'halt') {
      await update($, leadA, haltLead)
      return { text: 'mission-control: исполнители остановлены (/mc resume — снять).' }
    }
    if (words.length === 1 && words[0] === 'resume') {
      if (!(await read($, leadA)).halted) return { text: 'mission-control: исполнители не заморожены' }
      await update($, leadA, resumeLead)
      return { text: 'mission-control: заморозка снята.' }
    }
    if (words.length === 1 && words[0] === 'solo') {
      await update($, leadA, soloLead)
      return { text: 'mission-control: solo — лид получит «делай сам, не делегируй» в ближайшей сводке.' }
    }
    if (arg.length > 0) {
      return { text: `mission-control: не знаю «${arg}». /mc — открыть вкладку, /mc close, /mc clear, /mc budget [+N], /mc halt, /mc resume, /mc solo.` }
    }
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

  // The team table for the lead: read-only, the news it lists is still delivered by the digest.
  on('tool.call', { tool: TEAM_TOOL }, async $ => ({
    result: teamReport(await read($, agentsA), await read($, leadA), leadConfig, await $.clock.now()),
  }))

  // The digest for the lead (spec 6.6): what changed since the last one, after every tool batch of the
  // main loop (a subagent's batch carries agent_id and gets nothing). Fails open: a throw leaves the batch
  // untouched and says so once in the lead's news.
  const leadConfig = leadConfigOf(options)
  on('classic.PostToolBatch', async ($, e, next) => {
    const res = await next(e)
    if (e.agent_id !== undefined) return res
    try {
      const out: { text: string | null } = { text: null }
      await update($, leadA, cur => {
        const taken = takeDigest(cur, leadConfig)
        out.text = taken.text
        return taken.lead
      })
      if (out.text === null) return res
      return { ...res, additionalContext: [...(res.additionalContext ?? []), out.text] }
    } catch (err) {
      try {
        await update($, leadA, cur =>
          cur.flags.includes('guard-error')
            ? cur
            : { ...pushNews(cur, `сводка упала: ${reason(err)}`), flags: [...cur.flags, 'guard-error'] },
        )
      } catch {
        // nothing more to do: the next batch tries again
      }
      return res
    }
  }).catch(($, e, next) => next(e))

  registerMission(on, theme, leadConfig, crestFile, portraitsDir)
  registerMemory(on, theme, sealFile, crestFile, leadConfig)
  registerJobs(on, theme, skullDir)
  registerChrome(on, theme)
}
