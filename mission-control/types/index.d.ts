/** One settings-hook injection the model read (SessionStart, UserPromptSubmit, PreToolUse...). */
export type HookInjection = {
  /** Hash of event + text: the same injection carried again is not counted twice. */
  id: string
  event: string
  tokens: number
  chars: number
  preview: string
  turn: number
}

/** One Bash/PowerShell call that ran `mb search` or `mb code`. */
export type MbCall = {
  id: string
  kind: 'search' | 'code'
  queries: string[]
  /** Result rows parsed from the output; null when the output has no rows to parse (`mb code`). */
  hits: number | null
  memHits: number
  codeHits: number
  best: number | null
  tokens: number
  paths: string[]
  turn: number
  isAgent: boolean
  isError: boolean
}

/** One finished turn: how much memory reached the model during it. */
export type TurnRow = {
  index: number
  searches: number
  /** Estimated tokens of the turn's mb search / mb code outputs. */
  searchTokens: number
  hookTokens: number
  /** Wall time of the turn, as turn.complete reports it. */
  durationMs?: number
  /** Tool calls of the turn, subagents' included, and how many of them changed files. */
  actions?: number
  edits?: number
  /** The turn's API usage summed over its responses (turn.complete's `usage`). */
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

/** One tool call in plain words: the activity feed of every loop. */
export type Action = {
  id: string
  turn: number
  kind: 'memory' | 'read' | 'edit' | 'delete' | 'run' | 'web' | 'agent' | 'ask' | 'other'
  run: string
  done: string
  target: string
  status: 'run' | 'ok' | 'error' | 'denied'
  /** The loop that made the call: a subagent's id, null on the main loop. */
  agentId: string | null
  startedAt: number
  ms: number | null
}

/** An instruction file (CLAUDE.md and its imports) with the engine's own token count. */
export type ClaudeMdFile = { path: string; tokens: number }

export type Usage = {
  /** Input tokens the last response was answered over (the live context fill). */
  tokens: number | null
  percent: number | null
  window: number
  fiveHour: number | null
  sevenDay: number | null
}

/** Vault state read from Singularity's cached files (no `mb` process is run). */
export type Alerts = {
  plans: number
  doctorWarn: number
  doctorFail: number
  /** Why the vault could not be read (config missing, fs refused); null when it was. */
  error: string | null
}

/**
 * Where an agent's loop stands. "No news" is not a phase: it is drawn for a
 * working row that has sent no event for a while (isSilent).
 */
export type AgentPhase =
  | 'starting'
  | 'thinking'
  | 'acting'
  | 'waiting'
  | 'idle'
  | 'done'
  | 'failed'
  | 'aborted'
  | 'denied'

/** A loop's latest tool call; it stays after its end, carrying the outcome. */
export type CurrentAction = {
  /** The call's tool_use_id: how its end finds it. */
  id: string
  kind: Action['kind']
  run: string
  done: string
  target: string
  status: Action['status']
  startedAt: number
  ms: number | null
}

/** One model loop of the session: main, or a subagent, teammate or workflow agent. */
export type AgentRow = {
  /** 'main', the agent's id, or `denied:<tool_use_id>` for a refused spawn. */
  id: string
  /** null for main only; 'main' for an agent the main loop spawned. */
  parentId: string | null
  /** The main loop's turn it was spawned in; -1 when unknown and already ended. */
  turn: number
  /** subagentType; 'главный' for main. */
  type: string
  name: string | null
  /** The Agent call's few-word description, ≤ 120. */
  description: string
  /** The prompt in one plain line, ≤ 240. */
  task: string
  model: string | null
  isBackground: boolean
  isTeammate: boolean
  workflowRunId: string | null
  phase: AgentPhase
  /** When the current phase began: "думает 12с". */
  phaseAt: number
  startedAt: number
  endedAt: number | null
  /** The last event of its loop: a working row silent for long is "no news". */
  lastEventAt: number
  steps: number
  tools: number
  /** The last sentence of its latest step text: what it does next and why, ≤ 160. */
  intent: string | null
  current: CurrentAction | null
  /** The first sentence of its report (or a refusal's reason), ≤ 160. */
  report: string | null
  /** New tokens its turns reported: input, output and cache written; cache reads left out. */
  tokens: number
  /** The parent's Agent call id. */
  toolUseId: string | null
  /**
   * False while only the loop's own events know it: its first request can stream
   * before agent.spawn settles, and the engine's own forks never get a spawn. A spawn
   * or the engine's list confirms it; an unconfirmed row is never drawn. Absent on
   * rows written by an older module before a reload: counts as confirmed.
   */
  isConfirmed?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      hooks: HookInjection[]
      calls: MbCall[]
      reads: string[]
      claudeMd: ClaudeMdFile[]
      turns: TurnRow[]
      turn: number
      usage: Usage | null
      alerts: Alerts | null
      isHidden: boolean
      isQuiet: boolean
      /** The Memory tab's last `$.ui.open` outcome: 'placed', or why not. */
      paneStatus: string | null
      /** The Agents tab's last `$.ui.open` outcome. */
      agentsPaneStatus: string | null
      actions: Action[]
      /** When the last main turn ended ($.clock.now() ms): how long the prompt cache has idled. */
      lastTurnEndAt: number | null
      agents: AgentRow[]
    }
  }
}
