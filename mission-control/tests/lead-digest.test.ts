import { describe, expect, test } from 'claude-code/testing'

import { leadConfigOf } from '../hooks/lead/config'
import { DIGEST_MAX, afterDigest, digestOf } from '../hooks/lead/digest'
import { EMPTY_LEAD } from '../hooks/lead/ledger'
import type { Lead } from '../types'
import { engineBeneath, spawn, submit } from './helpers'

const SESSION = { cwd: '/home/magos/forge', surface: 'terminal' as const, isInteractive: true }
const lead = (o: Partial<Lead> = {}): Lead => ({ ...EMPTY_LEAD, ...o })
const cfg = (o: Partial<ReturnType<typeof leadConfigOf>> = {}) => ({ ...leadConfigOf({}), ...o })
const LIMITED = cfg({ sessionBudget: 100 })

describe('digestOf', () => {
  test('no news, no digest', () => {
    expect(digestOf(lead(), cfg())).toBeNull()
    expect(digestOf(lead({ session: 5000 }), cfg())).toBeNull()
  })

  test('news is listed', () => {
    expect(digestOf(lead({ news: ['первая', 'вторая'] }), cfg())).toBe('первая\nвторая')
  })

  test('identical lines merge', () => {
    const text = digestOf(lead({ news: ['отказ', 'другое', 'отказ', 'отказ'] }), cfg())
    expect(text).toBe('отказ ×3\nдругое')
  })

  test('digest never exceeds 600 characters', () => {
    const news = Array.from({ length: 40 }, (_, i) => `агент ${i} — нет вестей ${i + 15} мин, задача про длинное описание`)
    const text = digestOf(lead({ news, solo: true, session: 90 }), LIMITED) ?? ''
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX)
    expect(text).toMatch(/…и ещё \d+$/)
    // one huge line cannot break the cap either
    const huge = digestOf(lead({ news: ['я'.repeat(5000)] }), cfg()) ?? ''
    expect(huge.length).toBeLessThanOrEqual(DIGEST_MAX)
  })

  test('the cut is on a line boundary and counts what is left', () => {
    const news = Array.from({ length: 30 }, (_, i) => `строка номер ${String(i).padStart(2, '0')} ${'x'.repeat(40)}`)
    const text = digestOf(lead({ news }), cfg()) ?? ''
    const lines = text.split('\n')
    const shown = lines.length - 1
    expect(lines[lines.length - 1]).toBe(`…и ещё ${30 - shown}`)
    for (const l of lines.slice(0, -1)) expect(news).toContain(l)
  })

  test('exhausted session tells the lead to stop and ask', () => {
    const text = digestOf(lead({ session: 100.4 }), LIMITED)
    expect(text).toBe('бюджет сессии исчерпан: потрачено 100 OE — остановись и спроси владельца')
  })

  test('80 % of the session budget is said', () => {
    expect(digestOf(lead({ session: 79 }), LIMITED)).toBeNull()
    expect(digestOf(lead({ session: 80 }), LIMITED)).toBe('бюджет сессии: 80 % (потрачено 80 из 100 OE)')
  })

  test('extra OE moves the line', () => {
    expect(digestOf(lead({ session: 100, extra: 100 }), LIMITED)).toBeNull()
    expect(digestOf(lead({ session: 160, extra: 100 }), LIMITED)).toContain('80 %')
  })

  test('solo is said', () => {
    expect(digestOf(lead({ solo: true }), cfg())).toBe('владелец: дальше делай сам, не делегируй')
  })

  test('budget and solo lines come first and survive the cap', () => {
    const news = Array.from({ length: 40 }, (_, i) => `новость ${i} ${'y'.repeat(50)}`)
    const text = digestOf(lead({ news, solo: true, session: 120 }), LIMITED) ?? ''
    const lines = text.split('\n')
    expect(lines[0]).toContain('исчерпан')
    expect(lines[1]).toBe('владелец: дальше делай сам, не делегируй')
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX)
  })

  test('announced budget lines are not repeated', () => {
    expect(digestOf(lead({ session: 90, flags: ['budget80'] }), LIMITED)).toBeNull()
    expect(digestOf(lead({ session: 120, flags: ['budget100'] }), LIMITED)).toBeNull()
    // exhausted after the 80 % line was told: the new line still comes
    expect(digestOf(lead({ session: 120, flags: ['budget80'] }), LIMITED)).toContain('исчерпан')
  })
})

describe('afterDigest', () => {
  test('news and solo are cleared', () => {
    const l = lead({ news: ['а'], solo: true })
    const text = digestOf(l, cfg()) ?? ''
    const after = afterDigest(l, text)
    expect(after.news).toEqual([])
    expect(after.solo).toBe(false)
    expect(digestOf(after, cfg())).toBeNull()
  })

  test('80 % is announced once', () => {
    const l = lead({ session: 85 })
    const text = digestOf(l, LIMITED) ?? ''
    const after = afterDigest(l, text)
    expect(after.flags).toContain('budget80')
    expect(after.flags).not.toContain('budget100')
    expect(digestOf(after, LIMITED)).toBeNull()
  })

  test('exhausted is announced once and settles the 80 % line too', () => {
    const l = lead({ session: 150 })
    const after = afterDigest(l, digestOf(l, LIMITED) ?? '')
    expect(after.flags).toEqual(expect.arrayContaining(['budget80', 'budget100']))
    expect(digestOf(after, LIMITED)).toBeNull()
  })

  test('solo reaches the next digest once', () => {
    const l = lead({ solo: true })
    const after = afterDigest(l, digestOf(l, cfg()) ?? '')
    expect(digestOf(after, cfg())).toBeNull()
    expect(digestOf({ ...after, solo: true }, cfg())).toContain('делай сам')
  })

  test('the whole queue taken is cleared, even the lines the cap cut', () => {
    const l = lead({ news: ['а', 'б'] })
    expect(afterDigest(l, 'а\nб').news).toEqual([])
  })

  test('the input is not mutated', () => {
    const l = lead({ news: ['а'], flags: [] })
    afterDigest(l, 'а')
    expect(l.news).toEqual(['а'])
  })
})

describe('the digest in the engine', () => {
  test('a fork spawn reaches the lead once, then silence', async ($, on) => {
    engineBeneath(on)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, { subagentType: 'coder', description: 'форк', fork: true })
    const first = await $.classic.PostToolBatch({ tool_calls: [] })
    expect(first.additionalContext?.join('\n')).toContain('форк')
    const second = await $.classic.PostToolBatch({ tool_calls: [] })
    expect(second.additionalContext).toBeUndefined()
  })

  test("a subagent's batch gets no digest", async ($, on) => {
    engineBeneath(on)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, { subagentType: 'coder', description: 'форк', fork: true })
    const sub = await $.classic.PostToolBatch({ tool_calls: [], agent_id: 'a1' })
    expect(sub.additionalContext).toBeUndefined()
    // and the news is still waiting for the lead
    const main = await $.classic.PostToolBatch({ tool_calls: [] })
    expect(main.additionalContext?.join('\n')).toContain('форк')
  })

  test('the owner\'s prompt carries the digest in context', async ($, on) => {
    const engine = engineBeneath(on)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, { subagentType: 'coder', description: 'форк', fork: true })
    await submit($, 'что нового?')
    expect(engine.contexts.at(-1)?.join('\n')).toContain('форк')
    // delivered once: the next batch has nothing
    const batch = await $.classic.PostToolBatch({ tool_calls: [] })
    expect(batch.additionalContext).toBeUndefined()
  })

  test('a prompt without news carries no context', async ($, on) => {
    const engine = engineBeneath(on)
    await $.session.start(SESSION)
    await submit($, 'привет')
    expect(engine.contexts.at(-1)).toEqual([])
  })

  test('a plugin wake prompt does not take the digest', async ($, on) => {
    const engine = engineBeneath(on)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, { subagentType: 'coder', description: 'форк', fork: true })
    await $.prompt.submit({ text: 'тревога', wait: false, origin: { kind: 'plugin', name: 'mission-control' } })
    expect(engine.contexts.at(-1)).toEqual([])
    const batch = await $.classic.PostToolBatch({ tool_calls: [] })
    expect(batch.additionalContext?.join('\n')).toContain('форк')
  })
})
