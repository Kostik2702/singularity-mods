import { describe, expect, test } from 'claude-code/testing'

import { isFable, oeOf, tierOf } from '../hooks/lead/price'

describe('lead price', () => {
  test('opus input is 1 OE per token', () =>
    expect(oeOf({ model: 'claude-opus-5-5', input_tokens: 1000 }).oe).toBe(1000))
  test('sonnet output is 2.5 OE per token', () =>
    expect(oeOf({ model: 'claude-sonnet-5-5', output_tokens: 100 }).oe).toBe(250))
  test('haiku input is 0.025 OE per token', () =>
    expect(oeOf({ model: 'haiku', input_tokens: 1000 }).oe).toBe(25))
  test('cache write is 1.25 x input', () =>
    expect(oeOf({ model: 'claude-opus-5-5', cache_creation_input_tokens: 100 }).oe).toBe(125))
  test('unknown model is priced as fable and flagged', () =>
    expect(oeOf({ model: 'claude-test', input_tokens: 100 })).toEqual({ oe: 250, unknown: true }))
  test('missing usage fields count as zero', () => {
    expect(oeOf(null).oe).toBe(0)
    expect(oeOf({ model: 'claude-opus-5-5' }).oe).toBe(0)
  })
  test('tierOf reads aliases and ids', () => {
    expect(tierOf('claude-fable-5-1')).toBe('fable')
    expect(tierOf('sonnet')).toBe('sonnet')
    expect(tierOf(undefined)).toBe(null)
  })
  test('isFable reads alias and id', () => {
    expect(isFable('fable')).toBe(true)
    expect(isFable('claude-fable-5-1')).toBe(true)
    expect(isFable('claude-opus-5-5')).toBe(false)
    expect(isFable(null)).toBe(false)
  })
  test('same family with another version is priced as fable and flagged', () => {
    expect(oeOf({ model: 'claude-haiku-4-5', input_tokens: 100 })).toEqual({ oe: 250, unknown: true })
    expect(oeOf({ model: 'claude-opus-6', input_tokens: 100 })).toEqual({ oe: 250, unknown: true })
  })
  test('provider prefix, date and suffix keep a known id known', () =>
    expect(oeOf({ model: 'us.anthropic.claude-sonnet-5-5-20261001-v1:0', output_tokens: 100 })).toEqual({
      oe: 250,
      unknown: false,
    }))
  test('known fable id is priced as fable and not flagged', () =>
    expect(oeOf({ model: 'claude-fable-5-1', output_tokens: 100 })).toEqual({ oe: 1250, unknown: false }))
  test('model id is matched case-insensitively', () =>
    expect(oeOf({ model: 'Claude-Opus-5-5', input_tokens: 1000 })).toEqual({ oe: 1000, unknown: false }))
  test('NaN, negative and non-finite counts are zero', () => {
    expect(oeOf({ model: 'claude-opus-5-5', input_tokens: NaN, output_tokens: -5 })).toEqual({
      oe: 0,
      unknown: false,
    })
    expect(oeOf({ model: 'claude-opus-5-5', input_tokens: Infinity, cache_read_input_tokens: 1000 }).oe).toBe(50)
  })
  test('counts without a model are priced as fable and flagged', () =>
    expect(oeOf({ input_tokens: 100 })).toEqual({ oe: 250, unknown: true }))
  test('a known model with cache reads is not flagged', () =>
    expect(oeOf({ model: 'claude-opus-5-5[1m]', cache_read_input_tokens: 1000 })).toEqual({
      oe: 50,
      unknown: false,
    }))
})
