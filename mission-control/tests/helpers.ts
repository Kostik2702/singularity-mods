// Test helpers: the engine beneath the plugin, the events mission control hooks, and
// the two ways to look at the result — the plugin's own snapshot tool (exact state;
// a test's `$` has no state noun) and a mounted Agents tab (what the person sees).
import { mock } from 'claude-code/testing'
import type { AgentInfo, On, TurnStepResult, TurnStepServerToolUse, TurnUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { Action, AgentRow, Job } from '../types'

export const PLUGIN = 'mission-control'
const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
export const T0 = 1_000_000

export type Snapshot = {
  turn: number
  agents: AgentRow[]
  actions: Action[]
  agentsPaneStatus: string | null
  jobs: Job[]
  jobsDir: string | null
  jobsPaneStatus: string | null
}

type SpawnAnswer = string | { deny: string }

/** What one model request beneath the plugin answers besides its text. */
export type StepExtra = { usage?: TurnUsage; serverToolUses?: TurnStepServerToolUse[] }

/** What a Bash call answers beneath the plugin: `{ result, text }`, `{ isError, text }` or `{ deny }`. */
export type BashAnswer = Record<string, unknown>

export const SESSION_ID = 'sess-1'
export const TASKS_DIR = `/tmp/claude-501/-proj/${SESSION_ID}/tasks`

/**
 * A file system in memory beneath the plugin: `$.fs.list`, `stat`, `read`, `exists`
 * over `files` (path → text), folders implied by the paths. `$.session.id` answers
 * SESSION_ID, so the tasks folder is found under /tmp as a live session lays it out.
 */
export function fakeFs(on: On) {
  const files = new Map<string, string>()
  const dirsOf = (): Set<string> => {
    const dirs = new Set<string>()
    for (const path of files.keys()) {
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/') || '/')
    }
    return dirs
  }
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  on('session.id', () => ({ value: SESSION_ID }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) || dirsOf().has(e.path) }))
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw missing(e.path)
    return { value: text }
  })
  on('fs.stat', (_$, e) => {
    const text = files.get(e.path)
    if (text !== undefined) return { value: { kind: 'file' as const, size: text.length, mtimeMs: 0, isLink: false } }
    if (dirsOf().has(e.path)) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    throw missing(e.path)
  })
  on('fs.list', (_$, e) => {
    const dirs = dirsOf()
    if (!dirs.has(e.path)) throw missing(e.path)
    const prefix = e.path === '/' ? '/' : `${e.path}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of [...files.keys(), ...dirs]) {
      if (!path.startsWith(prefix) || path === e.path) continue
      const rest = path.slice(prefix.length)
      const name = rest.split('/')[0] ?? ''
      if (name.length === 0) continue
      names.set(name, rest.includes('/') || dirs.has(path) ? (names.get(name) === 'file' ? 'file' : 'dir') : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: files.get(`${prefix}${name}`)?.length ?? 0, mtimeMs: 0, isLink: false })) }
  })
  return {
    write: (path: string, text: string): void => {
      files.set(path, text)
    },
    append: (path: string, text: string): void => {
      files.set(path, (files.get(path) ?? '') + text)
    },
    remove: (path: string): void => {
      files.delete(path)
    },
  }
}

/**
 * Answers, beneath the plugin, every event mission control raises or hooks, as a
 * session would. `say` queues the text the next model step streams; `list` sets what
 * $.agent.list() returns; spawns take ids from `spawns` in order.
 */
export function engineBeneath(
  on: On,
  opts: {
    spawns?: SpawnAnswer[]
    failCommandRegister?: boolean
    /** The engine refuses every prompt.submit (a settings hook's block). */
    refuseSubmit?: boolean
    /** While `down` is true every clock read throws (no clock handle is returned then). */
    brokenClock?: { down: boolean }
    bash?: (input: Record<string, unknown>) => BashAnswer | Promise<BashAnswer>
    /** Tabs already open when the module (re)loads, by id and title. */
    panes?: { id: string; title: string }[]
    /** The environment the plugin reads (TERM_PROGRAM and the like); empty by default. */
    env?: Record<string, string>
    /** The model an agent.spawn answers the row with (what the engine resolved); `claude-test` by default. */
    spawnModel?: string
  } = {},
) {
  const broken = opts.brokenClock
  if (broken !== undefined) {
    on('clock.now', () => {
      if (broken.down) throw new Error('clock down')
      return { value: T0 }
    })
  }
  const clock = broken === undefined ? mock.clock(on, { now: T0 }) : (undefined as never)
  mock.env(on, opts.env ?? {})
  // session.start and what it calls: the kit has no bottom for these.
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    if (opts.failCommandRegister === true) throw new Error('command registry unavailable')
    return { value: { command: e.name } }
  })
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__mission-control__${e.name}` } }))
  on('ui.invalidate', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const spawns: SpawnAnswer[] = [...(opts.spawns ?? ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])]
  const texts: string[] = []
  let listed: AgentInfo[] = []
  /** The texts a plugin (not the person) submitted, as they reached the engine. */
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    if (e.origin.kind === 'plugin') submitted.push(e.text)
    return opts.refuseSubmit === true ? { drop: 'blocked' } : { text: e.text }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
  /** What reached the engine beneath the plugin: the spawn inputs after every hook above it. */
  const reached: { model?: string; prompt: string; subagentType: string; fork: boolean }[] = []
  on('agent.spawn', (_$, e) => {
    reached.push({ ...(e.model === undefined ? {} : { model: e.model }), prompt: e.prompt, subagentType: e.subagentType, fork: e.fork })
    const next = spawns.shift() ?? 'a-extra'
    return typeof next === 'string' ? { model: opts.spawnModel ?? 'claude-test', agentId: next } : { deny: next.deny }
  })
  on('agent.list', () => ({ value: listed }))
  const panes = [...(opts.panes ?? [])]
  on('ui.panes', () => ({ value: panes.map(p => ({ ...p, isShown: false, isFocused: false, isPlaced: true })) }))
  const opened: string[] = []
  const titles: Record<string, string> = {}
  const closed: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    titles[e.id] = e.title ?? ''
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    const at = panes.findIndex(p => p.id === e.id)
    if (at >= 0) panes.splice(at, 1)
    return { value: undefined }
  })
  /** What reached the engine beneath the plugin as model requests, after every turn.step hook above it. */
  const stepsReached: { agentId?: string; model: string; effort?: unknown }[] = []
  const extras: StepExtra[] = []
  on('turn.step', async function* (_$, e) {
    stepsReached.push({
      ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
      model: e.model,
      ...(e.effort === undefined ? {} : { effort: e.effort }),
    })
    const extra = extras.shift() ?? {}
    const text = texts.shift() ?? ''
    const usage = extra.usage ?? null
    if (text.length > 0) yield { kind: 'text' as const, index: 0, text }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: text,
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage,
      ...(extra.serverToolUses === undefined ? {} : { serverToolUses: extra.serverToolUses }),
    }
  })
  // A pattern: Glob is not a built-in of every build, and the types refuse a name they do not list.
  on('tool.call', { tool: /^Glob$/ }, () => ({ result: { filenames: [], durationMs: 1, numFiles: 0, truncated: false }, text: '' }) as never)
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: 'x', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
    text: 'x',
  }))
  const bash = opts.bash
  on('tool.call', { tool: 'Bash' }, async (_$, e) =>
    (bash === undefined
      ? { result: { stdout: 'boom', stderr: '', interrupted: false }, text: 'boom', isError: true }
      : await bash(e as unknown as Record<string, unknown>)) as never,
  )
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped', task_id: 'x', task_type: 'local_bash' }, text: 'stopped' }) as never)
  // An Agent call with run_in_background returns at once: the engine's async_launched record.
  on('tool.call', { tool: 'Agent' }, () => ({
    result: { status: 'async_launched', agentId: 'bg1', description: 'фоновый поиск', prompt: 'p', outputFile: 'o' },
    text: 'launched',
  }) as never)
  return {
    clock,
    reached,
    submitted,
    stepsReached,
    /** The texts $.ui.toast was called with. */
    toasts,
    /** Queues what the next model request answers: its usage (with the model that answered) and server tool calls. */
    stepAnswer: (extra: StepExtra): void => {
      extras.push(extra)
    },
    /** Pane ids in the order $.ui.open was called. */
    opened,
    /** The title each pane was last opened under. */
    titles,
    /** Pane ids in the order $.ui.close was called. */
    closed,
    say: (text: string): void => {
      texts.push(text)
    },
    list: (rows: AgentInfo[]): void => {
      listed = rows
    },
  }
}

/** The person submits a prompt: prompt.submit counts the main loop's turn. */
export async function submit($: Engine, text: string): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** The person types `/<command> <args>` at a fullscreen prompt; resolves the command's text. */
export async function runCommand($: Engine, command: string, args: string): Promise<string> {
  const answer = await $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  return answer.text ?? ''
}

let seq = 0

export async function spawn(
  $: Engine,
  args: {
    subagentType: string
    description: string
    prompt?: string
    parentAgentId?: string
    name?: string
    model?: string
    fork?: boolean
    /** Makes the spawn a workflow `agent()` call of this run. */
    workflow?: string
  },
) {
  seq += 1
  return $.agent.spawn({
    tool_use_id: `tu-${seq}`,
    prompt: args.prompt ?? `Задача: ${args.description}.`,
    description: args.description,
    subagentType: args.subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-test',
    background: false,
    fork: args.fork ?? false,
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.workflow === undefined ? {} : { workflow: { runId: args.workflow, agentIndex: 1 } }),
    ...(args.parentAgentId === undefined ? {} : { parentAgentId: args.parentAgentId }),
    ...(args.name === undefined ? {} : { name: args.name }),
  })
}

/** One model step in a loop; the plugin sees its end once the stream is read through. Resolves the step's result. */
export async function step(
  $: Engine,
  agentId?: string,
  request: { model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number } = {},
): Promise<TurnStepResult> {
  const stream = $.turn.step({
    turnId: 't',
    index: 0,
    model: request.model ?? 'claude-test',
    messageCount: 1,
    ...(request.effort === undefined ? {} : { effort: request.effort }),
    ...(agentId === undefined ? {} : { agentId }),
  })
  // The kit's `stream.result` is undefined (probe 2026-10-18): the result is the iterator's final value.
  const it = stream[Symbol.asyncIterator]()
  let next = await it.next()
  while (next.done !== true) next = await it.next()
  return next.value
}

export async function complete($: Engine, args: { agentId?: string; answer: string; reason?: 'answer' | 'aborted' | 'error' }): Promise<void> {
  await $.turn.complete({
    answer: args.answer,
    durationMs: 1000,
    isAborted: args.reason === 'aborted',
    turnId: 't',
    reason: args.reason ?? 'answer',
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 0, model: 'claude-test' },
    ...(args.agentId === undefined ? {} : { agentId: args.agentId }),
  })
}

/** A tool call in a loop. The kit keeps `agentId` though ToolCallArgs' comment says it is dropped (probe 2026-10-11). */
export async function toolCall($: Engine, args: Record<string, unknown> & { tool: string }, agentId?: string): Promise<void> {
  await $.tool.call({ ...args, ...(agentId === undefined ? {} : { agentId }) } as never)
}

export async function snapshot($: Engine): Promise<Snapshot> {
  const answer = (await $.tool.call({ tool: SNAPSHOT_TOOL } as never)) as unknown as { result?: unknown }
  return JSON.parse(String(answer.result)) as Snapshot
}

export async function mountJobs($: Engine, surface: 'terminal' | 'desktop', opts: { cols?: number; rows?: number } = {}) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'jobs',
    props: {
      title: 'Процессы',
      isFocused: false,
      bodyColumns: opts.cols ?? 72,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: opts.rows ?? 60 },
      view: {},
    },
  })
}

export async function mountAgents(
  $: Engine,
  surface: 'terminal' | 'desktop',
  opts: { cols?: number; rows?: number; viewAgentId?: string } = {},
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'agents',
    props: {
      title: 'Агенты',
      isFocused: false,
      bodyColumns: opts.cols ?? 64,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: opts.rows ?? 60 },
      view: opts.viewAgentId === undefined ? {} : { agentId: opts.viewAgentId },
    },
  })
}
