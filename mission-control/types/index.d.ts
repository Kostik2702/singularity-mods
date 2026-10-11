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

/** One tool call in plain words, for the activity log. */
export type Action = {
  id: string
  turn: number
  kind: 'memory' | 'read' | 'edit' | 'delete' | 'run' | 'web' | 'agent' | 'ask' | 'other'
  run: string
  done: string
  target: string
  status: 'run' | 'ok' | 'error' | 'denied'
  isAgent: boolean
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

declare module 'claude-code' {
  interface PluginState {
    'mem-meter': {
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
      /** The last `$.ui.open` outcome: 'placed', or the engine's reason it did not place the pane. */
      paneStatus: string | null
      actions: Action[]
      /** When the last main turn ended ($.clock.now() ms): how long the prompt cache has idled. */
      lastTurnEndAt: number | null
    }
  }
}
