// Team-lead options. Pure: no atoms. The mod has no number option type, so every option is a string.

export type LeadConfig = {
  mode: 'observe' | 'enforce'
  /** OE limits; null = no limit. */
  sessionBudget: number | null
  runBudget: number | null
  agentBudget: number | null
  /** Fable calls allowed per session. */
  fableCap: number
}

/** A working agent silent for this long is "no news" (every tier). */
export const SILENCE_MS = 15 * 60_000
/** A single tool call running for this long is worth a word to the lead. */
export const LONG_CALL_MS = 20 * 60_000

const DEFAULT_FABLE_CAP = 3

function positiveInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

function optionsOf(options: unknown): Record<string, unknown> {
  return typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {}
}

export function leadConfigOf(options: unknown): LeadConfig {
  const o = optionsOf(options)
  return {
    mode: o.budgetMode === 'enforce' ? 'enforce' : 'observe',
    sessionBudget: positiveInt(o.sessionBudgetOE),
    runBudget: positiveInt(o.runBudgetOE),
    agentBudget: positiveInt(o.agentBudgetOE),
    fableCap: positiveInt(o.fableCap) ?? DEFAULT_FABLE_CAP,
  }
}
