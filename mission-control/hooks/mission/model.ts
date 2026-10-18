// Mission control's model: pure functions from engine facts to agent rows, and the
// text helpers that say what an agent is doing and why. No `$` here: the hooks feed
// facts in, the tests call these directly.

import type { AgentPhase, AgentRow, CurrentAction } from '../../types'

export const INTENT_MAX = 160
export const TASK_MAX = 240
export const DESCRIPTION_MAX = 120

/** Cuts to `max` characters, counted in code points so no emoji is split; an ellipsis marks the cut. */
export function clip(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`
}

/** Markdown down to plain words: code blocks and table rows dropped, marks stripped, links to their text. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, '\n')
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|[\s(«"])[*_]([^*_\n]+)[*_](?=[\s).,!?:;»"]|$)/gm, '$1$2')
}

const OPENERS = new Set(['(', '[', '{', '«', '“', '„'])
const CLOSERS = new Set([')', ']', '}', '»', '”'])
const ENDS = new Set(['.', '!', '?', '…'])

/**
 * One line cut into sentences after . ! ? … followed by a space, never inside
 * brackets or quotes: «запусти субагента… вызови snapshot» is one phrase (seen live).
 * A closing bracket or quote right after the end mark ends the sentence with it.
 */
function splitLine(line: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? ''
    if (OPENERS.has(ch)) depth += 1
    else if (CLOSERS.has(ch)) depth = Math.max(0, depth - 1)
    const isEnd = ENDS.has(ch) || (CLOSERS.has(ch) && ENDS.has(line[i - 1] ?? ''))
    if (depth === 0 && isEnd && /\s/.test(line[i + 1] ?? '')) {
      parts.push(line.slice(start, i + 1))
      start = i + 1
    }
  }
  parts.push(line.slice(start))
  return parts
}

/** The plain sentences of a text, in order: split after a sentence end outside brackets, and at line breaks. */
export function sentences(text: string): string[] {
  return plainText(text)
    .split(/\n+/)
    .flatMap(splitLine)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(part => /[\p{L}\p{N}]/u.test(part))
}

/**
 * The text without its layout: headings, table rows, rules and fenced code dropped.
 * Reports by reviewer, investigator and critic agents open with a heading; what the
 * agent says is in the lines between them.
 */
function prose(text: string): string {
  const kept: string[] = []
  let isFence = false
  for (const line of text.split('\n')) {
    if (/^[ \t]*```/.test(line)) {
      isFence = !isFence
      continue
    }
    if (isFence) continue
    if (/^[ \t]{0,3}#{1,6}[ \t]/.test(line)) continue
    if (/^[ \t]*\|/.test(line)) continue
    if (/^[ \t]*([-*_][ \t]*){3,}$/.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n')
}

/** The sentences of what a text says, falling back to its headings when it says nothing else. */
function saidSentences(text: string): string[] {
  const said = sentences(prose(text))
  return said.length > 0 ? said : sentences(text)
}

/** What a step's text says last: before a tool call that is what the agent does next, and why. */
export function lastSentence(text: string): string | null {
  const last = saidSentences(text).at(-1)
  return last === undefined ? null : clip(last, INTENT_MAX)
}

/** What a text says first: a subagent's report opens with its point. */
export function firstSentence(text: string): string | null {
  const first = saidSentences(text)[0]
  return first === undefined ? null : clip(first, INTENT_MAX)
}

/** A task prompt as one line of plain words from its start. */
export function taskLine(prompt: string): string {
  return clip(sentences(prompt).join(' '), TASK_MAX)
}

export const MAIN = 'main'
export const MAIN_TYPE = 'главный'
/** Rows kept at most: past this the oldest ended ones leave, never main or a working one. */
export const MAX_AGENTS = 100
/** A working subagent with no event for this long is drawn as "no news". */
export const SILENT_MS = 5 * 60_000
/** An ended agent's report line stays on the tree this long, whatever turn it belongs to. */
export const RECENT_MS = 10 * 60_000

const ENDED: ReadonlySet<AgentPhase> = new Set<AgentPhase>(['done', 'failed', 'aborted', 'denied'])
const WORKING: ReadonlySet<AgentPhase> = new Set<AgentPhase>(['starting', 'thinking', 'acting', 'waiting'])

/** done, failed, aborted or denied: nothing changes unless the agent is resumed. */
export function isEnded(phase: AgentPhase): boolean {
  return ENDED.has(phase)
}

/** starting, thinking, acting or waiting: its clock is running. */
export function isWorking(phase: AgentPhase): boolean {
  return WORKING.has(phase)
}

/** The main loop's row before it has done anything. */
export function mainRow(now: number): AgentRow {
  return {
    id: MAIN,
    parentId: null,
    turn: 0,
    type: MAIN_TYPE,
    name: null,
    description: '',
    task: '',
    model: null,
    requestedModel: null,
    isBackground: false,
    isTeammate: false,
    workflowRunId: null,
    phase: 'idle',
    phaseAt: now,
    startedAt: now,
    endedAt: null,
    lastEventAt: now,
    steps: 0,
    tools: 0,
    intent: null,
    current: null,
    report: null,
    tokens: 0,
    effort: null,
    oe: 0,
    toolUseId: null,
    isConfirmed: true,
  }
}

/** A row a spawn or the engine's list has vouched for (a row from before a reload, with no flag, counts). */
export function isConfirmed(r: AgentRow): boolean {
  return r.isConfirmed !== false
}

/** A loop only its own events know so far: kept, never drawn, until a spawn or the list confirms it. */
function provisionalRow(agentId: string, now: number): AgentRow {
  return { ...mainRow(now), id: agentId, parentId: MAIN, turn: -1, type: '', isConfirmed: false }
}

/** `rows` with row `id` replaced by `fn(row)`; the same rows when there is no such row. */
function patch(rows: readonly AgentRow[], id: string, fn: (row: AgentRow) => AgentRow): AgentRow[] {
  return rows.map(r => (r.id === id ? fn(r) : r))
}

/** Rows with the main row in them (it is made on first use). */
function withMain(rows: readonly AgentRow[], now: number): AgentRow[] {
  return rows.some(r => r.id === MAIN) ? [...rows] : [mainRow(now), ...rows]
}

/** The row a loop's event belongs to: main when the event names no agent. */
function loopId(agentId: string | null): string {
  return agentId ?? MAIN
}

/**
 * Rows with a row for the event's loop: main made on first use; an agent no row
 * follows yet gets a provisional one, since its first request can stream before
 * agent.spawn settles (seen live) and the spawn must find its first step.
 */
function withLoop(rows: readonly AgentRow[], agentId: string | null, now: number): AgentRow[] {
  if (agentId === null) return withMain(rows, now)
  if (rows.some(r => r.id === agentId)) return [...rows]
  return trimAgents([...rows, provisionalRow(agentId, now)])
}

/**
 * At most MAX_AGENTS rows. Unconfirmed loops leave first, then the oldest ended
 * agents; main and confirmed working ones always stay.
 */
export function trimAgents(rows: readonly AgentRow[]): AgentRow[] {
  let excess = rows.length - MAX_AGENTS
  if (excess <= 0) return [...rows]
  const drop = new Set<string>()
  for (const pass of [(r: AgentRow) => !isConfirmed(r), (r: AgentRow) => isEnded(r.phase)]) {
    for (const r of rows) {
      if (excess <= 0) break
      if (r.id !== MAIN && !drop.has(r.id) && pass(r)) {
        drop.add(r.id)
        excess -= 1
      }
    }
  }
  return rows.filter(r => !drop.has(r.id))
}

/** Rows without the ended agents and the unconfirmed loops: main and every confirmed working or idle one stay. */
export function clearEnded(rows: readonly AgentRow[]): AgentRow[] {
  return rows.filter(r => r.id === MAIN || (isConfirmed(r) && !isEnded(r.phase)))
}

/** The main loop starts a turn: it thinks, its counters, last action and reason start over. */
export function applyTurnStart(rows: readonly AgentRow[], at: { turn: number; now: number }): AgentRow[] {
  return patch(withMain(rows, at.now), MAIN, r => ({
    ...r,
    turn: at.turn,
    phase: 'thinking',
    phaseAt: at.now,
    startedAt: at.now,
    endedAt: null,
    lastEventAt: at.now,
    steps: 0,
    tools: 0,
    current: null,
    intent: null,
  }))
}

/** What an Agent call settled to, as the agent.spawn hook saw it. */
export type SpawnFacts = {
  /** The started agent's id; null when nothing started. */
  agentId: string | null
  /** The refusal's reason; null when not refused. */
  deny: string | null
  toolUseId: string
  parentAgentId: string | null
  subagentType: string
  description: string
  prompt: string
  model: string | null
  /** The model the call asked for after the guard (before core resolved it); null when it named none. */
  requestedModel: string | null
  name: string | null
  isBackground: boolean
  isTeammate: boolean
  workflowRunId: string | null
  /** The main loop's turn at the spawn. */
  turn: number
  now: number
}

function newAgent(f: SpawnFacts, id: string): AgentRow {
  return {
    id,
    parentId: f.parentAgentId ?? MAIN,
    turn: f.turn,
    type: f.subagentType,
    name: f.name,
    description: clip(f.description.trim(), DESCRIPTION_MAX),
    task: taskLine(f.prompt),
    model: f.model,
    requestedModel: f.requestedModel,
    isBackground: f.isBackground,
    isTeammate: f.isTeammate,
    workflowRunId: f.workflowRunId,
    phase: 'starting',
    phaseAt: f.now,
    startedAt: f.now,
    endedAt: null,
    lastEventAt: f.now,
    steps: 0,
    tools: 0,
    intent: null,
    current: null,
    report: null,
    tokens: 0,
    effort: null,
    oe: 0,
    toolUseId: f.toolUseId,
    isConfirmed: true,
  }
}

/**
 * An Agent call settled: a started agent gets its row under its parent, a refused
 * one a row saying why. A spawn with neither (an internal-build remote agent) gets
 * none: nothing would ever end it.
 */
export function applySpawn(rows: readonly AgentRow[], f: SpawnFacts): AgentRow[] {
  const base = withMain(rows, f.now)
  if (f.deny !== null) {
    const id = `denied:${f.toolUseId}`
    if (base.some(r => r.id === id)) return base
    return trimAgents([...base, { ...newAgent(f, id), phase: 'denied', endedAt: f.now, report: clip(f.deny, INTENT_MAX) }])
  }
  if (f.agentId === null) return base
  const known = base.find(r => r.id === f.agentId)
  if (known !== undefined && !isConfirmed(known)) {
    // Its first events came before the spawn settled: keep what they recorded, add who it is.
    return patch(base, known.id, r => ({
      ...newAgent(f, r.id),
      phase: r.phase === 'idle' ? 'starting' : r.phase,
      phaseAt: r.phaseAt,
      startedAt: Math.min(r.startedAt, f.now),
      endedAt: r.endedAt,
      lastEventAt: Math.max(r.lastEventAt, f.now),
      steps: r.steps,
      tools: r.tools,
      intent: r.intent,
      current: r.current,
      report: r.report,
      tokens: r.tokens,
      effort: r.effort ?? null,
      oe: r.oe ?? 0,
    }))
  }
  if (known !== undefined) {
    // A resume of an ended agent starts it again; one the list found first keeps its phase
    // and gains what only the spawn knows (its task, model and call).
    return patch(base, known.id, r => {
      const isResumed = isEnded(r.phase)
      return {
        ...r,
        phase: isResumed ? 'starting' : r.phase,
        phaseAt: isResumed ? f.now : r.phaseAt,
        endedAt: null,
        lastEventAt: f.now,
        turn: r.turn === -1 ? f.turn : r.turn,
        description: r.description.length > 0 ? r.description : clip(f.description.trim(), DESCRIPTION_MAX),
        task: r.task.length > 0 ? r.task : taskLine(f.prompt),
        model: r.model ?? f.model,
        requestedModel: r.requestedModel ?? f.requestedModel,
        name: r.name ?? f.name,
        toolUseId: r.toolUseId ?? f.toolUseId,
      }
    })
  }
  return trimAgents([...base, newAgent(f, f.agentId)])
}

/** A model request begins in a loop: it thinks. A loop no row follows yet gets a provisional one. */
export function applyStepStart(rows: readonly AgentRow[], at: { agentId: string | null; now: number }): AgentRow[] {
  const base = withLoop(rows, at.agentId, at.now)
  return patch(base, loopId(at.agentId), r => ({
    ...r,
    phase: 'thinking',
    phaseAt: at.now,
    lastEventAt: at.now,
    steps: r.steps + 1,
    endedAt: null,
  }))
}

/** A model request ended: its text's last sentence is the loop's reason for what it does next. */
export function applyStepEnd(rows: readonly AgentRow[], at: { agentId: string | null; answer: string; now: number }): AgentRow[] {
  const intent = lastSentence(at.answer)
  return patch(withLoop(rows, at.agentId, at.now), loopId(at.agentId), r => ({ ...r, lastEventAt: at.now, intent: intent ?? r.intent }))
}

/**
 * A model request settled: its OE joins the loop's row, which also takes the model that answered and the
 * effort the request ran at (a null keeps what the row has). A loop with no row changes nothing.
 */
export function applyStepUsage(
  rows: readonly AgentRow[],
  at: { agentId: string | null; oe: number; model: string | null; effort: string | null },
): AgentRow[] {
  const oe = Number.isFinite(at.oe) && at.oe > 0 ? at.oe : 0
  return patch(rows, loopId(at.agentId), r => ({
    ...r,
    // rows from before the ledger carry no oe
    oe: (r.oe ?? 0) + oe,
    model: at.model ?? r.model,
    effort: at.effort ?? r.effort ?? null,
  }))
}

/**
 * The model the spawn asked for, on the agent's first request only (spec 6.7): what the forced-model check
 * compares the answering model with. Never the resolved `model`, which core may already have forced.
 * Null for main, a later request, a spawn that named no model, a missing row or one from before the field.
 */
export function spawnedModelOf(row: AgentRow | undefined): string | null {
  return row !== undefined && row.id !== MAIN && row.steps === 1 ? (row.requestedModel ?? null) : null
}

/** A tool call begins in a loop: it acts, and the call is its current action. */
export function applyToolStart(
  rows: readonly AgentRow[],
  at: { agentId: string | null; action: CurrentAction; now: number },
): AgentRow[] {
  const base = withLoop(rows, at.agentId, at.now)
  return patch(base, loopId(at.agentId), r => ({
    ...r,
    phase: 'acting',
    phaseAt: at.now,
    lastEventAt: at.now,
    tools: r.tools + 1,
    current: at.action,
  }))
}

/**
 * A tool call ended: its loop's current action takes the outcome, if it is still the
 * current one. `done` says what really happened when the finished verb would lie (an
 * Agent call that only launched a background agent). `fallback` is an older call of
 * the same loop still running: it becomes current, so parallel calls never read as done.
 */
export function applyToolEnd(
  rows: readonly AgentRow[],
  at: {
    agentId: string | null
    id: string
    status: CurrentAction['status']
    ms: number
    now: number
    done?: string
    fallback?: CurrentAction
  },
): AgentRow[] {
  return patch(withLoop(rows, at.agentId, at.now), loopId(at.agentId), r => {
    if (r.current === null || r.current.id !== at.id) return { ...r, lastEventAt: at.now }
    const ended: CurrentAction = { ...r.current, status: at.status, ms: at.ms, done: at.done ?? r.current.done }
    return { ...r, lastEventAt: at.now, current: at.fallback ?? ended }
  })
}

/** What turn.complete said about a loop's turn. */
export type CompleteFacts = {
  agentId: string | null
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  answer: string
  tokens: number
  now: number
}

/** A loop's turn ended: main waits for the person, a subagent is done (a teammate idles), failed or stopped. */
export function applyComplete(rows: readonly AgentRow[], f: CompleteFacts): AgentRow[] {
  const base = withLoop(rows, f.agentId, f.now)
  return patch(base, loopId(f.agentId), r => {
    const isMain = r.id === MAIN
    const phase: AgentPhase =
      f.reason === 'aborted' ? 'aborted' : f.reason === 'answer' ? (isMain || r.isTeammate ? 'idle' : 'done') : 'failed'
    return {
      ...r,
      phase,
      phaseAt: f.now,
      endedAt: f.now,
      lastEventAt: f.now,
      tokens: r.tokens + f.tokens,
      intent: isMain ? (lastSentence(f.answer) ?? r.intent) : r.intent,
      report: isMain ? r.report : (firstSentence(f.answer) ?? r.report),
    }
  })
}

/** One row of $.agent.list(), reduced to what the rows use. */
export type ListedAgent = {
  id: string
  type: string
  description: string
  status: string
  parentId?: string
  name?: string
  isTeammate: boolean
}

const FROM_STATUS: Record<string, AgentPhase> = {
  pending: 'starting',
  waiting: 'waiting',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'aborted',
}

/**
 * The phase a listed status means, given what we hold. Our own end is final: a list
 * read racing turn.complete must not reopen an ended agent (it would then sit at "no
 * news" for good); a real resume arrives as the agent's own turn.step. Running keeps
 * our finer thinking/acting.
 */
export function phaseFromList(status: string, held: AgentPhase): AgentPhase {
  if (isEnded(held)) return held
  if (status === 'running') return held === 'thinking' || held === 'acting' ? held : 'thinking'
  const listed = FROM_STATUS[status]
  if (listed === undefined) return held
  if (listed === 'starting' && isWorking(held)) return held
  return listed
}

function listedRow(item: ListedAgent, turn: number, now: number): AgentRow {
  const phase = phaseFromList(item.status, 'starting')
  const ended = isEnded(phase)
  return {
    ...mainRow(now),
    id: item.id,
    parentId: item.parentId ?? MAIN,
    turn: ended ? -1 : turn,
    type: item.type,
    name: item.name ?? null,
    description: clip(item.description.trim(), DESCRIPTION_MAX),
    isTeammate: item.isTeammate,
    phase,
    endedAt: ended ? now : null,
  }
}

/** Squares the rows with the engine's list: its status wins where ours is stale, and agents we never saw are added. */
export function applyList(rows: readonly AgentRow[], listed: readonly ListedAgent[], at: { turn: number; now: number }): AgentRow[] {
  let next = withMain(rows, at.now)
  for (const item of listed) {
    const known = next.find(r => r.id === item.id)
    if (known === undefined) {
      next = [...next, listedRow(item, at.turn, at.now)]
      continue
    }
    if (!isConfirmed(known)) {
      // The list names a loop only its events knew: it is a real agent, with a type and a task.
      const confirmed = listedRow(item, at.turn, at.now)
      next = patch(next, item.id, r => ({
        ...r,
        parentId: confirmed.parentId,
        turn: confirmed.turn,
        type: confirmed.type,
        name: confirmed.name,
        description: confirmed.description,
        isTeammate: confirmed.isTeammate,
        isConfirmed: true,
      }))
    }
    const held = next.find(r => r.id === item.id) ?? known
    const phase = phaseFromList(item.status, held.phase)
    if (phase === held.phase) continue
    next = patch(next, item.id, r => ({ ...r, phase, phaseAt: at.now, endedAt: isEnded(phase) ? (r.endedAt ?? at.now) : null }))
  }
  return trimAgents(next)
}

/** A working subagent that sent nothing for SILENT_MS: drawn as "no news". Never main, never one that waits. */
export function isSilent(r: AgentRow, now: number): boolean {
  return r.id !== MAIN && isConfirmed(r) && r.phase !== 'waiting' && isWorking(r.phase) && now - r.lastEventAt > SILENT_MS
}

/** Is a timer on screen running? Confirmed working rows that are not silent. */
export function needsTick(rows: readonly AgentRow[], now: number): boolean {
  return rows.some(r => isConfirmed(r) && isWorking(r.phase) && !isSilent(r, now))
}

/**
 * Is the engine's list worth reading? While a confirmed subagent works, and while a
 * loop only its own events know is fresh: the list is how a forked skill (no
 * agent.spawn) gets confirmed. A quiet unconfirmed loop stops the reads.
 */
export function needsReconcile(rows: readonly AgentRow[], now: number): boolean {
  return rows.some(
    r => r.id !== MAIN && isWorking(r.phase) && (isConfirmed(r) || now - r.lastEventAt <= SILENT_MS),
  )
}

/** One drawn agent: `lead` goes before its own line, `indent` before its detail lines. */
export type TreeLine = { row: AgentRow; depth: number; lead: string; indent: string }
export type Tree = { lines: TreeLine[]; hidden: number }

/**
 * The rows as a tree under main, in spawn order. Shown: main, every agent not
 * ended, every agent of `turn` or ended during it, and the ancestors of those; the
 * rest (ended in earlier turns) is counted in `hidden`. An unknown parent or a parent cycle
 * hangs the row under main, so no row is ever lost.
 */
/** Tree connectors, two cells each: the theme's, or the plain box-drawing ones. */
export type TreeGlyphs = { branch: string; last: string; stem: string }
const PLAIN_TREE: TreeGlyphs = { branch: '├─', last: '└─', stem: '│ ' }

export function buildTree(rows: readonly AgentRow[], turn: number, now: number, glyphs: TreeGlyphs = PLAIN_TREE): Tree {
  const main = rows.find(r => r.id === MAIN) ?? mainRow(now)
  // Unconfirmed loops (the engine's own forks, or a spawn not settled yet) are never drawn.
  const others = rows.filter(r => r.id !== MAIN && isConfirmed(r))
  const byId = new Map(others.map(r => [r.id, r]))
  const parent = new Map<string, string>()
  for (const r of others) {
    parent.set(r.id, r.parentId !== null && r.parentId !== r.id && byId.has(r.parentId) ? r.parentId : MAIN)
  }
  for (const r of others) {
    const seen = new Set<string>()
    let cur = r.id
    while (cur !== MAIN) {
      if (seen.has(cur)) {
        parent.set(cur, MAIN)
        break
      }
      seen.add(cur)
      cur = parent.get(cur) ?? MAIN
    }
  }
  const keep = new Set<string>()
  for (const r of others) {
    // An ended agent stays while it belongs to this turn (spawned in it, or ended during it)
    // or while its report is fresh: a background agent spawned earlier reports now, and it
    // may end just before the engine starts the turn that tells main (seen live: 137 ms).
    const endedThisTurn = r.endedAt !== null && r.endedAt > main.startedAt
    const isFresh = r.endedAt !== null && now - r.endedAt <= RECENT_MS
    if (isEnded(r.phase) && r.turn !== turn && !endedThisTurn && !isFresh) continue
    let cur: string = r.id
    while (cur !== MAIN && !keep.has(cur)) {
      keep.add(cur)
      cur = parent.get(cur) ?? MAIN
    }
  }
  const children = new Map<string, AgentRow[]>()
  for (const r of others) {
    if (!keep.has(r.id)) continue
    const p = parent.get(r.id) ?? MAIN
    children.set(p, [...(children.get(p) ?? []), r])
  }
  const lines: TreeLine[] = [{ row: main, depth: 0, lead: '', indent: '  ' }]
  const walk = (of: string, pad: string, depth: number): void => {
    const kids = children.get(of) ?? []
    kids.forEach((kid, i) => {
      const isLast = i === kids.length - 1
      const stem = isLast ? '  ' : glyphs.stem
      lines.push({ row: kid, depth, lead: `${pad}${isLast ? glyphs.last : glyphs.branch}`, indent: `${pad}${stem}  ` })
      walk(kid.id, `${pad}${stem}`, depth + 1)
    })
  }
  walk(MAIN, '', 1)
  return { lines, hidden: others.length - keep.size }
}
