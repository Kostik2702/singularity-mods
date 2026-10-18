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
  /** The effort the agent runs at, once known; null until then. */
  effort: string | null
  /** Opus-equivalent tokens (OE) it has spent. */
  oe: number
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

/** What a long action is, by its command: the Processes tab's label and its gist. */
export type JobKind = 'download' | 'train' | 'data' | 'eval' | 'install' | 'build' | 'test' | 'server' | 'watch' | 'run'

/** What the tail of a job's output says about how far it got; every part optional. */
export type JobProgress = {
  /** 0..1 when the output names a total; null for a count without one. */
  fraction: number | null
  /** "450/1000", "12.3/45.1 MB". */
  count: string | null
  /** Time left as the tool printed it: "00:15", "5s". */
  eta: string | null
  /** "3.4MB/s", "12.1it/s". */
  rate: string | null
  /** The outer loop when the bar is an inner one: "эпоха 3/10". */
  stage: string | null
  /** The latest training figure: "loss 0.213". */
  metric: string | null
}

/**
 * One long action: a background shell, a foreground command that runs for a while,
 * or a Monitor. Lives in the Processes tab while it runs and a while after.
 */
export type Job = {
  /** The call's tool_use_id: stable from start to end. */
  id: string
  /** The engine's background task id, once the command is (or moved) in the background. */
  taskId: string | null
  tool: string
  /** The loop that started it: a subagent's id, null on the main loop. */
  agentId: string | null
  /** Who started it as the tab names it at the start ('главный', 'coder'); the live row wins when drawn. */
  agentLabel: string
  /** The call's own description, ≤ 160. */
  description: string
  /** The command line in one line, ≤ 400. */
  command: string
  kind: JobKind
  /** The gist in Russian from the command: «скачивает model.bin ← huggingface.co». */
  gist: string
  /** The starting agent's reason when it made the call: its last sentence before acting. */
  intent: string | null
  isBackground: boolean
  status: 'run' | 'ok' | 'error' | 'killed'
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  /** The task's live output file; null until it is known. */
  outputPath: string | null
  /** Names in the tasks folder when a foreground call started: its own file is the new one. */
  before: string[] | null
  outputSize: number
  /** When the output last grew. */
  outputAt: number | null
  progress: JobProgress | null
  /** The last line the output shows, ANSI and carriage-return rewrites resolved, ≤ 200. */
  lastLine: string | null
  /** Monitor's deadline in ms; 0 or null when it has none. */
  timeoutMs: number | null
  /** Set once the tab showed it and raised itself for it: a job raises the tab once. */
  isAnnounced: boolean
}

/** The team-lead layer's ledger: OE spent, Fable calls, guard counters and the lead's unread news. */
export type Lead = {
  /** OE spent by each agent id; main is not here. */
  byAgent: Record<string, number>
  /** OE spent by each workflow run id. */
  byRun: Record<string, number>
  /** OE spent by the whole session, main included. */
  session: number
  /** OE the owner added to the session budget (`/mc budget +N`). */
  extra: number
  fableCalls: number
  /** The council command name while one is open, null when closed. */
  councilTurn: string | null
  halted: boolean
  solo: boolean
  rewrites: number
  denials: number
  /** Lines for the lead's next digest, last 20. */
  news: string[]
  /** Alarms already sent, by `<alarm>:<agent>`: the time of the send. */
  alarmsSent: Record<string, number>
  lastWakeAt: number | null
  flags: string[]
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
      /** Long actions: background shells, long foreground commands, monitors. */
      jobs: Job[]
      /** The session's background-task folder (`…/<session id>/tasks`), once found. */
      jobsDir: string | null
      /** The Processes tab's last `$.ui.open` outcome. */
      jobsPaneStatus: string | null
      /** The team-lead layer's ledger and counters. */
      lead: Lead
    }
  }
}
