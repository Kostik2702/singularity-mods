import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { COLORS } from '../lib/viz'
import { MAIN } from '../mission/model'
import {
  agentLabelOf,
  applyCallEnd,
  applyJobStart,
  applyTaskEnd,
  backgroundIdOf,
  dirOf,
  outputPathOf,
  parseNotifications,
} from './model'
import { drawJobsPane } from './pane'

// The Processes tab's observers and its drawing. What runs on a timer (polling the
// output files, raising the tab), /jobs and opening the tab live in register.tsx:
// the engine takes one unmatched hook per event per module and never follows `$`
// into an imported function.

export const JOBS_PANE = 'jobs'
/** Both shells; a pattern, so no build's tool list has to name PowerShell. */
const SHELLS = /^(Bash|PowerShell)$/

// The engine's scan accepts only an atom made in the same file: every file declares
// the values it reads or writes, with the same key and initial value as the others.
const jobsA = atom({ plugin: 'mission-control', key: 'jobs' } as const, [])
const jobsDirA = atom({ plugin: 'mission-control', key: 'jobsDir' } as const, null)
const agentsA = atom({ plugin: 'mission-control', key: 'agents' } as const, [])

type $ = EngineInterface

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** The task output files in the session's tasks folder; [] when it cannot be read. */
async function listOutputs($: $, dir: string): Promise<string[]> {
  try {
    return (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.output')).map(f => f.name)
  } catch {
    return []
  }
}

type CallFacts = { id: string; tool: string; agentId: string | null; command: string; description: string; isBackground: boolean; timeoutMs: number | null }

/** A long-capable call begins: a row with who started it and why. Never throws. */
async function begin($: $, f: CallFacts): Promise<void> {
  try {
    const agents = await read($, agentsA)
    const intent = agents.find(r => r.id === (f.agentId ?? MAIN))?.intent ?? null
    const dir = await read($, jobsDirA)
    // A foreground call's own output file is the one that appears after this listing.
    const before = f.isBackground || dir === null ? null : await listOutputs($, dir)
    const now = await $.clock.now()
    await update($, jobsA, jobs =>
      applyJobStart(jobs, { ...f, agentLabel: agentLabelOf(agents, f.agentId), intent, before, now }),
    )
  } catch {
    // the call goes on unobserved
  }
}

type Ran = { deny?: string; isError?: true; result?: unknown; text?: string }

/** The call returned: a launch keeps running under its task id, anything else ends. Never throws. */
async function settle($: $, id: string, ran: Ran): Promise<void> {
  try {
    if (ran.deny !== undefined) {
      await update($, jobsA, jobs => jobs.filter(j => j.id !== id))
      return
    }
    const now = await $.clock.now()
    const taskId = ran.isError === true ? null : backgroundIdOf(ran.result)
    let outputPath: string | null = null
    if (taskId !== null) {
      const dir = await read($, jobsDirA)
      outputPath = outputPathOf(ran.text ?? '') ?? (dir === null ? null : `${dir}/${taskId}.output`)
      const learned = outputPath === null ? null : dirOf(outputPath)
      if (learned !== null && dir === null) await update($, jobsDirA, () => learned)
    }
    const interrupted = (ran.result as { interrupted?: unknown } | undefined)?.interrupted === true
    const status = ran.isError === true ? 'error' : interrupted ? 'killed' : 'ok'
    await update($, jobsA, jobs => applyCallEnd(jobs, { id, now, taskId, outputPath, status }))
  } catch {
    // a missed end is settled by the poll or the task's notification
  }
}

export function registerJobs(on: On): void {
  // Every shell call may turn long: it is followed from its start, and shown once it is.
  on('tool.call', { tool: SHELLS }, async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const command = str(input.command)
    if (command.length === 0) return next(e)
    const startedAt = await $.clock.now()
    const id = str(input.tool_use_id) || `${String(e.tool)}-${startedAt}`
    await begin($, {
      id,
      tool: String(e.tool),
      agentId: e.agentId ?? null,
      command,
      description: str(input.description),
      isBackground: input.run_in_background === true,
      timeoutMs: null,
    })
    const ran = await next(e)
    await settle($, id, ran as unknown as Ran)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `Monitor-${startedAt}`
    await begin($, {
      id,
      tool: 'Monitor',
      agentId: e.agentId ?? null,
      command: e.command ?? e.ws?.url ?? '',
      description: e.description,
      isBackground: true,
      timeoutMs: typeof e.timeout_ms === 'number' ? e.timeout_ms : null,
    })
    const ran = await next(e)
    await settle($, id, ran as unknown as Ran)
    return ran
  }).catch(($, e, next) => next(e))

  // Claude stopped a task: it ended, whatever its output says next.
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      const taskId = e.task_id ?? e.shell_id ?? null
      if (ran.deny === undefined && ran.isError !== true && taskId !== null) {
        const now = await $.clock.now()
        await update($, jobsA, jobs => applyTaskEnd(jobs, { taskId, toolUseId: null, status: 'killed', exitCode: null, now }))
      }
    } catch {
      // the poll settles it
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A background task's notification: how it ended, as the engine tells the model.
  on('prompt.submit', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    try {
      const ends = parseNotifications(e.text)
      if (ends.length > 0) {
        const now = await $.clock.now()
        await update($, jobsA, jobs => ends.reduce((acc, end) => applyTaskEnd(acc, { ...end, now }), jobs))
      }
    } catch {
      // the poll reads the exit from the output file
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The Processes tab: drawn by pane.tsx from the jobs and the agent rows.
  on('ui.render', { component: 'Pane', requestId: JOBS_PANE }, async ($, e) => {
    const data = {
      jobs: await read($, jobsA),
      agents: await read($, agentsA),
      now: await $.clock.now(),
    }
    return drawJobsPane($.ui.resolve(e), data, e.props.bodyColumns, e.props.scroll.bodyRows)
  }).catch(($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" backgroundColor={COLORS.surface} paddingX={1}>
        <Text color={COLORS.critical} bold>
          mission-control: вкладка «Процессы» упала
        </Text>
        <Text color={COLORS.ink2} wrap="wrap">
          {reason(next.error)}
        </Text>
      </Box>
    )
  })
}
