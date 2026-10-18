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
export const PRICES: Readonly<Record<Tier, Readonly<Price>>> = Object.freeze({
  haiku: Object.freeze({ input: 0.1, output: 0.5, cacheRead: 0.1 }),
  sonnet: Object.freeze({ input: 2, output: 10, cacheRead: 0.2 }),
  opus: Object.freeze({ input: 4, output: 20, cacheRead: 0.2 }),
  fable: Object.freeze({ input: 10, output: 50, cacheRead: 0.25 }),
})

// The version the table above is priced for (spec 6.7: the key is family AND version).
const VERSIONS: Readonly<Record<Tier, string>> = Object.freeze({
  haiku: '5-5',
  sonnet: '5-5',
  opus: '5-5',
  fable: '5-1',
})

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

/**
 * The tier whose table price applies to this model: family word plus the known version (any suffix,
 * date or provider prefix allowed) or a bare alias. Another version of a known family is not known.
 */
function priceTierOf(model: string | null | undefined): Tier | null {
  const tier = tierOf(model)
  if (!tier || !model) return null
  const m = model.toLowerCase()
  const rest = m.slice(m.indexOf(tier) + tier.length)
  if (!/^-\d/.test(rest)) return tier // bare alias: `opus`, `opus[1m]`
  const v = VERSIONS[tier]
  return rest.startsWith('-' + v) && !/^\d/.test(rest.slice(v.length + 1)) ? tier : null
}

// NaN, negative and non-finite counts are zero: a NaN sum would make every budget comparison false.
function count(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Opus-equivalent tokens of one request. A model the table does not know (another version, no model
 * field) is priced as fable and flagged. Missing or bad counts are 0.
 */
export function oeOf(usage: StepUsage | null | undefined): { oe: number; unknown: boolean } {
  if (!usage) return { oe: 0, unknown: false }
  const tier = priceTierOf(usage.model)
  const p = PRICES[tier ?? 'fable']
  // Tokens x price first, the single division by the Opus input price last: keeps round figures exact.
  const dollars =
    count(usage.input_tokens) * p.input +
    count(usage.output_tokens) * p.output +
    count(usage.cache_read_input_tokens) * p.cacheRead +
    count(usage.cache_creation_input_tokens) * (p.input * CACHE_WRITE_FACTOR)
  return { oe: dollars / OE_UNIT, unknown: tier === null }
}
