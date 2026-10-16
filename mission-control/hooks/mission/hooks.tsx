import { atom, read, update } from 'claude-code'
import type { On, TurnStepResult } from 'claude-code'

import type { Action, CurrentAction } from '../../types'
import { runningShown } from '../jobs/model'
import { describeAction, launchedVerb } from '../lib/actions'
import { drawsPictures, listPortraits } from '../lib/terminal'
import { forSurface } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { applySpawn, applyStepEnd, applyStepStart, applyToolEnd, applyToolStart, applyTurnStart } from './model'
import { drawAgentsPane } from './pane'

// Mission control's own observers and its tab. What it shares with the memory
// feature or runs on a timer (session.start, turn.complete, /mc, the list
// reconcile, the redraw tick, opening the tab) lives in register.tsx: the engine
// takes one unmatched hook per event per module and never follows `$` into an
// imported function.

export const AGENTS_PANE = 'agents'
const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
const MAX_ACTIONS = 300

// The engine's scan accepts only an atom made in the same file: every file declares
// the values it reads or writes, with the same key and initial value as the others.
const agentsA = atom({ plugin: 'mission-control', key: 'agents' } as const, [])
const actionsA = atom({ plugin: 'mission-control', key: 'actions' } as const, [])
const turnA = atom({ plugin: 'mission-control', key: 'turn' } as const, 0)
const jobsA = atom({ plugin: 'mission-control', key: 'jobs' } as const, [])
const usageA = atom({ plugin: 'mission-control', key: 'usage' } as const, null)

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerMission(on: On, theme: Theme, crestFile: string | null = null, portraitsDir: string | null = null): void {
  const c = theme.colors
  on('turn.start', async ($, e, next) => {
    const res = await next(e)
    const turn = await read($, turnA)
    const now = await $.clock.now()
    await update($, agentsA, rows => applyTurnStart(rows, { turn, now }))
    return res
  }).catch(($, e, next) => next(e))

  // One model request: the loop thinks while it streams; its text's last sentence is the reason.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId ?? null
    try {
      const now = await $.clock.now()
      await update($, agentsA, rows => applyStepStart(rows, { agentId, now }))
    } catch {
      // the step goes on unobserved
    }
    const res = yield* next(e)
    try {
      // `res` is undefined when nothing streamed beneath (seen in the test kit): read it defensively.
      const answer = (res as TurnStepResult | undefined)?.answer ?? ''
      if (answer.length > 0) {
        const now = await $.clock.now()
        await update($, agentsA, rows => applyStepEnd(rows, { agentId, answer, now }))
      }
    } catch {
      // never let the observer fail the model's stream
    }
    return res
  })

  // Every tool call, in plain words: the feed, and the calling loop's current action.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === SNAPSHOT_TOOL) return next(e)
    const agentId = e.agentId ?? null
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `${tool}-${startedAt}`
    const words = describeAction(tool, e as unknown as Record<string, unknown>)
    const action: Action = { id, turn: await read($, turnA), ...words, status: 'run', agentId, startedAt, ms: null }
    const current: CurrentAction = { id, ...words, status: 'run', startedAt, ms: null }
    await update($, actionsA, list => [...list, action].slice(-MAX_ACTIONS))
    await update($, agentsA, rows => applyToolStart(rows, { agentId, action: current, now: startedAt }))
    const ran = await next(e)
    const status: Action['status'] = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
    const endedAt = await $.clock.now()
    const ms = endedAt - startedAt
    // An Agent or Workflow call that only launched work in the background finished nothing.
    const done = ran.deny === undefined ? (launchedVerb(ran.result) ?? words.done) : words.done
    await update($, actionsA, list => list.map(a => (a.id === id ? { ...a, status, ms, done } : a)))
    // Parallel calls: when this one ends, an older call of the same loop still running becomes current.
    const running = (await read($, actionsA)).filter(a => a.agentId === agentId && a.status === 'run' && a.id !== id).at(-1)
    const fallback: CurrentAction | undefined =
      running === undefined
        ? undefined
        : { id: running.id, kind: running.kind, run: running.run, done: running.done, target: running.target, status: 'run', startedAt: running.startedAt, ms: null }
    await update($, agentsA, rows => applyToolEnd(rows, { agentId, id, status, ms, now: endedAt, done, ...(fallback === undefined ? {} : { fallback }) }))
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    const now = await $.clock.now()
    const turn = await read($, turnA)
    await update($, agentsA, rows =>
      applySpawn(rows, {
        agentId: res.agentId ?? null,
        deny: res.deny ?? null,
        toolUseId: e.tool_use_id,
        parentAgentId: e.parentAgentId ?? null,
        subagentType: e.subagentType,
        description: e.description,
        prompt: e.prompt,
        model: res.model ?? e.model ?? null,
        name: e.name ?? null,
        isBackground: e.background,
        isTeammate: e.isTeammate === true,
        workflowRunId: e.workflow?.runId ?? null,
        turn,
        now,
      }),
    )
    return res
  }).catch(($, e, next) => next(e))

  // The Agents tab: drawn by pane.tsx from the rows and the feed.
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const now = await $.clock.now()
    const data = {
      agents: await read($, agentsA),
      actions: await read($, actionsA),
      turn: await read($, turnA),
      now,
      viewAgentId: e.props.view.agentId ?? null,
      jobsRunning: runningShown(await read($, jobsA), now).length,
      pictures: await drawsPictures($),
      crestFile,
      portraits: portraitsDir !== null && (await drawsPictures($)) ? await listPortraits($, portraitsDir) : {},
      contextPercent: (await read($, usageA))?.percent ?? null,
    }
    return drawAgentsPane($.ui.resolve(e), data, e.props.bodyColumns, e.props.scroll.bodyRows, forSurface(theme, e.surface))
  }).catch(($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" backgroundColor={c.surface} paddingX={1}>
        <Text color={c.critical} bold>
          mission-control: вкладка «{theme.titles.agents}» упала
        </Text>
        <Text color={c.ink2} wrap="wrap">
          {reason(next.error)}
        </Text>
      </Box>
    )
  })
}
