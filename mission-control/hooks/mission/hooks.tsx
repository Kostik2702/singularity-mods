import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStepResult } from 'claude-code'

import type { Action, AgentRow, CurrentAction } from '../../types'
import { runningShown } from '../jobs/model'
import type { LeadConfig } from '../lead/config'
import { accountStep, stepPrice } from '../lead/account'
import { decideSpawn, decideStep } from '../lead/guard'
import type { SpawnDecision, StepDecision } from '../lead/guard'
import { EMPTY_LEAD, pushNews } from '../lead/ledger'
import { isFable } from '../lead/price'
import { TEAM_TOOL, sessionLimit } from '../lead/team'
import { describeAction, launchedVerb } from '../lib/actions'
import { drawsPictures, listPortraits, loadPixmap } from '../lib/terminal'
import type { Pixmap } from '../lib/pixmap'
import { forSurface } from '../lib/theme'
import type { Theme } from '../lib/theme'
import {
  MAIN,
  applySpawn,
  applyStepEnd,
  applyStepStart,
  applyStepUsage,
  applyToolEnd,
  applyToolStart,
  applyTurnStart,
  spawnedModelOf,
} from './model'
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
const leadA = atom({ plugin: 'mission-control', key: 'lead' } as const, EMPTY_LEAD)

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const FABLE_LEAD = 'лид на Fable — всё без явной модели унаследовало бы Fable'

/** A guard or the accounting threw: the request or spawn went through unchanged; the lead hears of it once. */
async function noteGuardError($: EngineInterface, err: unknown): Promise<void> {
  try {
    await update($, leadA, cur =>
      cur.flags.includes('guard-error')
        ? cur
        : { ...pushNews(cur, `ограждение упало: ${reason(err)}`), flags: [...cur.flags, 'guard-error'] },
    )
  } catch {
    // nothing more to do: the request goes through
  }
}

/** The session's lead runs on Fable (spec 6.4): one toast and one news line per session. */
async function noteFableLead($: EngineInterface): Promise<void> {
  if ((await read($, leadA)).flags.includes('fable-lead')) return
  await update($, leadA, cur =>
    cur.flags.includes('fable-lead') ? cur : { ...pushNews(cur, FABLE_LEAD), flags: [...cur.flags, 'fable-lead'] },
  )
  $.ui.toast(FABLE_LEAD)
}

/** How the news names a loop: its task, else its name or type, else its id; main is the lead. */
function labelOf(row: AgentRow | undefined, agentId: string | null): string {
  if (agentId === null) return 'лид'
  if (row === undefined) return agentId
  return [row.description, row.name ?? '', row.type].find(t => t.length > 0) ?? agentId
}

/**
 * A request settled (spec 6.2): its OE into the ledger and the loop's row, a model the table does not
 * know, a model the session forced, an advisor call into the lead's news. `effort` is the one the request ran at.
 */
async function settleStep(
  $: EngineInterface,
  f: { agentId: string | null; requestModel: string; effort: string | null; res: TurnStepResult | undefined },
): Promise<void> {
  const usage = f.res?.usage ?? null
  const rows = await read($, agentsA)
  const row = rows.find(r => r.id === (f.agentId ?? MAIN))
  const account = {
    agentId: f.agentId,
    runId: row?.workflowRunId || null,
    label: labelOf(row, f.agentId),
    requestModel: f.requestModel,
    usage,
    serverTools: (f.res?.serverToolUses ?? []).map(u => u.name),
    // The agent's first request says whether the session forced another model than the spawn asked for.
    spawnedModel: spawnedModelOf(row),
  }
  await update($, leadA, cur => accountStep(cur, account))
  const { oe } = stepPrice(usage, f.requestModel)
  await update($, agentsA, cur => applyStepUsage(cur, { agentId: f.agentId, oe, model: usage?.model || null, effort: f.effort }))
}

export function registerMission(
  on: On,
  theme: Theme,
  lead: LeadConfig,
  crestFile: string | null = null,
  portraitsDir: string | null = null,
): void {
  const c = theme.colors
  on('turn.start', async ($, e, next) => {
    const res = await next(e)
    const turn = await read($, turnA)
    const now = await $.clock.now()
    await update($, agentsA, rows => applyTurnStart(rows, { turn, now }))
    return res
  }).catch(($, e, next) => next(e))

  // One model request: the loop thinks while it streams; its text's last sentence is the reason.
  // The request guard (spec 6.4, 6.7) decides first: a spent or frozen subagent in enforce gets the
  // block answer and no request goes out; a workflow agent gets the tier's effort; main goes as it
  // is. A guard that throws lets the request through unchanged and says so once in the lead's news.
  // After the response its usage is settled into the ledger and the loop's row.
  // Known limit: a step that streams before its spawn row settles (seen live) gets no block and no effort cap for that request.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId ?? null
    let input = e
    let decision: StepDecision = { kind: 'send' }
    try {
      const row = agentId === null ? undefined : (await read($, agentsA)).find(r => r.id === agentId)
      const runId = row?.workflowRunId || null
      decision = decideStep(
        {
          agentId,
          runId,
          isWorkflow: runId !== null,
          model: e.model,
          ...(e.effort === undefined ? {} : { effort: e.effort }),
        },
        await read($, leadA),
        lead,
      )
      if (decision.kind === 'send' && 'effort' in decision) input = { ...e, effort: decision.effort }
    } catch (err) {
      input = e
      decision = { kind: 'send' }
      await noteGuardError($, err)
    }
    if (decision.kind === 'block') {
      const answer = decision.answer
      try {
        const now = await $.clock.now()
        await update($, agentsA, rows => applyStepEnd(rows, { agentId, answer, now }))
      } catch {
        // the block stands, unobserved
      }
      yield { kind: 'text' as const, index: 0, text: answer }
      yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
      return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn' as const, usage: null }
    }
    if (agentId === null && isFable(e.model)) {
      try {
        await noteFableLead($)
      } catch (err) {
        await noteGuardError($, err)
      }
    }
    try {
      const now = await $.clock.now()
      await update($, agentsA, rows => applyStepStart(rows, { agentId, now }))
    } catch {
      // the step goes on unobserved
    }
    const res = yield* next(input)
    // `res` is undefined when nothing streamed beneath (seen in the test kit): read it defensively.
    const result = res as TurnStepResult | undefined
    try {
      const answer = result?.answer ?? ''
      if (answer.length > 0) {
        const now = await $.clock.now()
        await update($, agentsA, rows => applyStepEnd(rows, { agentId, answer, now }))
      }
    } catch {
      // never let the observer fail the model's stream
    }
    try {
      const effort = input.effort === undefined ? null : String(input.effort)
      await settleStep($, { agentId, requestModel: e.model, effort, res: result })
    } catch (err) {
      await noteGuardError($, err)
    }
    return res
  })

  // Every tool call, in plain words: the feed, and the calling loop's current action.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === SNAPSHOT_TOOL || tool === TEAM_TOOL) return next(e)
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

  // The spawn guard (spec 6.3): deny before `next`, or rewrite the model on the way in. A guard that
  // throws lets the spawn through unchanged and says so once in the lead's news. Once it has decided
  // a deny, nothing after that may turn the deny into a spawn: bookkeeping failures are swallowed
  // and the .catch repeats the deny.
  const decidedDenies = new Map<string, string>()
  on('agent.spawn', async ($, e, next) => {
    let input = e
    let denied: string | null = null
    let countsAsFable = false
    let decision: SpawnDecision | null = null
    try {
      decision = decideSpawn(
        {
          prompt: e.prompt,
          subagentType: e.subagentType,
          fork: e.fork,
          isWorkflow: e.workflow !== undefined,
          isResume: e.resume !== undefined,
          runId: e.workflow?.runId || null,
          ...(e.model === undefined ? {} : { model: e.model }),
        },
        await read($, leadA),
        lead,
      )
      if (decision.kind === 'deny') {
        // Decided first: the news below may fail, the deny stands.
        denied = decision.reason
        decidedDenies.set(e.tool_use_id, decision.reason)
      } else if (decision.kind === 'rewrite') {
        input = { ...e, model: decision.model }
      } else if (decision.kind === 'pass') {
        countsAsFable = decision.countsAsFable === true
      }
    } catch (err) {
      input = e
      denied = null
      countsAsFable = false
      decision = null
      await noteGuardError($, err)
    }
    try {
      if (decision?.kind === 'deny') {
        const why = decision.reason
        await update($, leadA, cur => ({ ...pushNews(cur, `отказ в спавне: ${why}`), denials: cur.denials + 1 }))
      } else if (decision?.kind === 'rewrite') {
        const note = decision.note
        await update($, leadA, cur => ({ ...pushNews(cur, note), rewrites: cur.rewrites + 1 }))
      } else if (decision?.kind === 'note') {
        const note = decision.note
        await update($, leadA, cur => pushNews(cur, note))
      }
    } catch {
      // the news is lost, the decision is not
    }
    const res = denied !== null ? { deny: denied } : await next(input)
    if (res.deny === undefined && countsAsFable) {
      try {
        await update($, leadA, cur => ({ ...cur, fableCalls: cur.fableCalls + 1 }))
      } catch {
        // the count is lost, the spawn is not
      }
    }
    // The row of the spawn (a refused one too). A failure here must not undo the spawn or the deny.
    try {
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
          requestedModel: input.model ?? e.model ?? null,
          name: e.name ?? null,
          isBackground: e.background,
          isTeammate: e.isTeammate === true,
          workflowRunId: e.workflow?.runId || null,
          turn,
          now,
        }),
      )
    } catch {
      // unobserved
    }
    // The deny is delivered: a later spawn that shares the id (a workflow run's agents do) must not meet it.
    decidedDenies.delete(e.tool_use_id)
    return res
  }).catch(($, e, next) => {
    const deny = decidedDenies.get(e.tool_use_id)
    decidedDenies.delete(e.tool_use_id)
    return next.called || deny === undefined ? next(e) : { deny }
  })

  // The Agents tab: drawn by pane.tsx from the rows and the feed.
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const now = await $.clock.now()
    const pictures = await drawsPictures($)
    const portraits = portraitsDir !== null ? await listPortraits($, portraitsDir) : {}
    // Where the terminal draws no pictures: the pixmaps beside them, laid into cells.
    const portraitPix: Record<string, Pixmap> = {}
    if (!pictures) {
      for (const [slug, file] of Object.entries(portraits)) {
        const pix = await loadPixmap($, file)
        if (pix !== null) portraitPix[slug] = pix
      }
    }
    const ledger = await read($, leadA)
    const data = {
      lead: { mode: lead.mode, session: ledger.session, limit: sessionLimit(ledger, lead), halted: ledger.halted },
      agents: await read($, agentsA),
      actions: await read($, actionsA),
      turn: await read($, turnA),
      now,
      viewAgentId: e.props.view.agentId ?? null,
      jobsRunning: runningShown(await read($, jobsA), now).length,
      pictures,
      crestFile,
      portraits: pictures ? portraits : {},
      crestPix: !pictures && crestFile !== null ? await loadPixmap($, crestFile) : null,
      portraitPix,
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
