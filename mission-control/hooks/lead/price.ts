// Prices and Opus-equivalent tokens (OE) for the team-lead layer. Pure: no atoms, no runtime imports.
//
// OE = sum(tokens x $/MTok) / 4, where 4 is the Opus 5.5 input price: one Opus input token is 1 OE.

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'

export type StepUsage = {
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

type Price = { input: number; output: number; cacheRead: number }

// $/MTok. Source: skill `claude-api`, 2026-10-06.
// Haiku 5.5 cache read: the source gives no price, so the Haiku input price is used (a stand-in until one is found).
// Cache write is 1.25 x input for every tier.
export const PRICES: Record<Tier, Price> = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.1 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  fable: { input: 10, output: 50, cacheRead: 0.25 },
}

const OE_UNIT = PRICES.opus.input
const CACHE_WRITE_FACTOR = 1.25

const FAMILIES: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

/** Alias (`sonnet`) or full id (`claude-haiku-5-5...`) to a tier; null when the family is not known. */
export function tierOf(model: string | null | undefined): Tier | null {
  if (!model) return null
  const m = model.toLowerCase()
  for (const t of FAMILIES) if (m.includes(t)) return t
  return null
}

export function isFable(model: string | null | undefined): boolean {
  return tierOf(model) === 'fable'
}

/** Opus-equivalent tokens of one request. Unknown model: priced as fable and flagged. Missing fields count as 0. */
export function oeOf(usage: StepUsage | null | undefined): { oe: number; unknown: boolean } {
  if (!usage) return { oe: 0, unknown: false }
  const tier = tierOf(usage.model)
  const p = PRICES[tier ?? 'fable']
  // Tokens x price first, the single division by the Opus input price last: keeps round figures exact.
  const dollars =
    (usage.input_tokens ?? 0) * p.input +
    (usage.output_tokens ?? 0) * p.output +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * (p.input * CACHE_WRITE_FACTOR)
  return { oe: dollars / OE_UNIT, unknown: tier === null }
}
