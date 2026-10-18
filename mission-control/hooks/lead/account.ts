// Per-request accounting of the team-lead layer (spec 6.2, 6.7). Pure: one settled request in, the next ledger out.

import type { Lead } from '../../types'
import { addUsage, pushNews } from './ledger'
import { oeOf, tierOf } from './price'
import type { StepUsage } from './price'

export type StepAccount = {
  /** The loop the request was made in; null = the lead's own (main). */
  agentId: string | null
  runId: string | null
  /** How the news names the agent. */
  label: string
  /** The model the request named: it prices a usage that carries no model of its own. */
  requestModel: string
  /** What the API reported for the request; null when no response arrived. */
  usage: StepUsage | null | undefined
  /** Names of the server tools the API ran inside the request. */
  serverTools: readonly string[]
  /** The model the agent was started on, set on the agent's first request only; null otherwise. */
  spawnedModel: string | null
}

/**
 * What one request cost in OE. The model that answered prices it; without one the request's own model
 * does, never Fable by default. `model` is the one priced; `unknown` = it is not in the price table.
 */
export function stepPrice(
  usage: StepUsage | null | undefined,
  requestModel: string,
): { oe: number; unknown: boolean; model: string } {
  const model = usage?.model || requestModel
  return { ...oeOf(usage ? { ...usage, model } : null), model }
}

/**
 * Settles one request: its OE into the agent, the run and the session; a model the table does not know
 * flagged `?` (once) and told (once per model); a model the session forced on the agent told; every
 * advisor call told. The lead's own requests count into the session only.
 */
export function accountStep(l: Lead, f: StepAccount): Lead {
  const { oe, unknown, model } = stepPrice(f.usage, f.requestModel)
  let next = addUsage(l, { agentId: f.agentId, runId: f.runId, oe })

  const unknownTag = `?:${model}`
  if (unknown && !next.flags.includes(unknownTag)) {
    const flags = next.flags.includes('?') ? [...next.flags, unknownTag] : [...next.flags, '?', unknownTag]
    next = { ...pushNews(next, `цена неизвестна: ${model} — считаю по Fable`), flags }
  }

  // Both tiers must be known to call a difference "forced": an unrecognised id says nothing.
  const answered = f.usage?.model
  if (f.spawnedModel !== null && answered) {
    const was = tierOf(f.spawnedModel)
    const now = tierOf(answered)
    if (was !== null && now !== null && was !== now) next = pushNews(next, `модель навязана сессией: ${was} → ${now}`)
  }

  for (const tool of f.serverTools) {
    if (tool === 'advisor') next = pushNews(next, `советчик вызван: ${f.label}`)
  }
  return next
}
