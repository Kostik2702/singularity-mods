import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_LEAD } from '../hooks/lead/ledger'
import { accountStep, stepPrice } from '../hooks/lead/account'
import type { StepAccount } from '../hooks/lead/account'
import type { Lead } from '../types'

const lead = (o: Partial<Lead> = {}): Lead => ({ ...EMPTY_LEAD, ...o })

const SONNET = 'claude-sonnet-5-5'
const usageOf = (model?: string) => ({
  ...(model === undefined ? {} : { model }),
  input_tokens: 1000,
  output_tokens: 400,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
})

const acc = (o: Partial<StepAccount> = {}): StepAccount => ({
  agentId: 'a1',
  runId: null,
  label: 'разведка',
  requestModel: SONNET,
  usage: usageOf(SONNET),
  serverTools: [],
  spawnedModel: null,
  ...o,
})

describe('stepPrice', () => {
  test('the usage is priced by its own model', () => {
    // sonnet: (1000 x 2 + 400 x 10) / 4
    expect(stepPrice(usageOf(SONNET), 'claude-test')).toEqual({ oe: 1500, unknown: false, model: SONNET })
  })

  test('usage without a model is priced by the request model, not as fable', () => {
    expect(stepPrice(usageOf(), SONNET)).toEqual({ oe: 1500, unknown: false, model: SONNET })
    expect(stepPrice(usageOf(''), 'opus').oe).toBe((1000 * 4 + 400 * 20) / 4)
  })

  test('no usage is 0 OE and never unknown', () => {
    expect(stepPrice(null, 'claude-test')).toEqual({ oe: 0, unknown: false, model: 'claude-test' })
  })

  test('an unknown model is priced as fable and flagged', () => {
    expect(stepPrice(usageOf('claude-test'), SONNET)).toEqual({ oe: (1000 * 10 + 400 * 50) / 4, unknown: true, model: 'claude-test' })
  })

  test('a bad token count adds zero, never NaN', () => {
    expect(stepPrice({ model: SONNET, input_tokens: Number.NaN, output_tokens: -4 }, SONNET).oe).toBe(0)
  })
})

describe('per-request accounting', () => {
  test('the OE lands in the agent, the run and the session', () => {
    const l = accountStep(lead(), acc({ runId: 'wf_1' }))
    expect(l.session).toBe(1500)
    expect(l.byAgent).toEqual({ a1: 1500 })
    expect(l.byRun).toEqual({ wf_1: 1500 })
    expect(l.flags).toEqual([])
    expect(l.news).toEqual([])
  })

  test('main counts into the session only', () => {
    const l = accountStep(lead(), acc({ agentId: null }))
    expect(l.session).toBe(1500)
    expect(l.byAgent).toEqual({})
  })

  test('usage without a model is priced by the request model and flags nothing', () => {
    const l = accountStep(lead(), acc({ usage: usageOf() }))
    expect(l.session).toBe(1500)
    expect(l.flags).toEqual([])
  })

  test('no usage adds nothing and flags nothing', () => {
    const l = accountStep(lead(), acc({ usage: null, requestModel: 'claude-test' }))
    expect(l.session).toBe(0)
    expect(l.flags).toEqual([])
    expect(l.news).toEqual([])
  })

  test('an unknown model is priced as fable, flagged once and told once per model', () => {
    let l = lead()
    for (let i = 0; i < 3; i += 1) l = accountStep(l, acc({ usage: usageOf('claude-test') }))
    expect(l.session).toBe(3 * ((1000 * 10 + 400 * 50) / 4))
    expect(l.flags.filter(f => f === '?')).toHaveLength(1)
    expect(l.news).toEqual(['цена неизвестна: claude-test — считаю по Fable'])
    l = accountStep(l, acc({ usage: usageOf('claude-other') }))
    expect(l.flags.filter(f => f === '?')).toHaveLength(1)
    expect(l.news).toEqual(['цена неизвестна: claude-test — считаю по Fable', 'цена неизвестна: claude-other — считаю по Fable'])
  })

  test('the unknown model a request names is the one told when the usage names none', () => {
    const l = accountStep(lead(), acc({ usage: usageOf(), requestModel: 'claude-test' }))
    expect(l.news).toEqual(['цена неизвестна: claude-test — считаю по Fable'])
  })

  test('forced model is reported when the tiers differ', () => {
    const l = accountStep(lead(), acc({ spawnedModel: 'haiku', usage: usageOf(SONNET) }))
    expect(l.news).toEqual(['модель навязана сессией: haiku → sonnet'])
  })

  test('a spawn that asked for sonnet and was answered by opus is reported; one that asked for nothing is not', () => {
    expect(accountStep(lead(), acc({ spawnedModel: 'sonnet', usage: usageOf('claude-opus-5-5') })).news).toEqual([
      'модель навязана сессией: sonnet → opus',
    ])
    expect(accountStep(lead(), acc({ spawnedModel: null, usage: usageOf('claude-opus-5-5') })).news).toEqual([])
  })

  test('no forced-model report when the tiers match, when the spawn model is unknown or null, or the usage names none', () => {
    expect(accountStep(lead(), acc({ spawnedModel: 'sonnet' })).news).toEqual([])
    expect(accountStep(lead(), acc({ spawnedModel: null })).news).toEqual([])
    expect(accountStep(lead(), acc({ spawnedModel: 'claude-test' })).news).toEqual([])
    expect(accountStep(lead(), acc({ spawnedModel: 'haiku', usage: usageOf() })).news).toEqual([])
  })

  test('an advisor call reaches the news, other server tools do not', () => {
    const l = accountStep(lead(), acc({ serverTools: ['web_search', 'advisor', 'advisor'] }))
    expect(l.news).toEqual(['советчик вызван: разведка', 'советчик вызван: разведка'])
  })

  test('the input lead is never mutated', () => {
    const before = lead({ news: ['x'] })
    const after = accountStep(before, acc({ serverTools: ['advisor'], usage: usageOf('claude-test') }))
    expect(before.news).toEqual(['x'])
    expect(before.flags).toEqual([])
    expect(after).not.toBe(before)
  })
})
