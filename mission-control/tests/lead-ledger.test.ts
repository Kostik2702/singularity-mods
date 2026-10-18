import { describe, expect, test } from 'claude-code/testing'

import { LONG_CALL_MS, SILENCE_MS, leadConfigOf } from '../hooks/lead/config'
import { EMPTY_LEAD, addUsage, budgetLeft, isExhausted, pushNews } from '../hooks/lead/ledger'

const cfg = (o: Partial<ReturnType<typeof leadConfigOf>> = {}) => ({ ...leadConfigOf({}), ...o })

describe('lead config', () => {
  test('defaults', () =>
    expect(leadConfigOf({})).toEqual({
      mode: 'observe',
      sessionBudget: null,
      runBudget: null,
      agentBudget: null,
      fableCap: 3,
    }))
  test('strings are parsed, a bad fableCap falls back to 3', () =>
    expect(leadConfigOf({ budgetMode: 'enforce', sessionBudgetOE: '2000000', fableCap: 'x' })).toEqual({
      mode: 'enforce',
      sessionBudget: 2000000,
      runBudget: null,
      agentBudget: null,
      fableCap: 3,
    }))
  test('empty, non-numeric, non-positive and fractional budgets are null', () => {
    for (const bad of ['', ' ', 'abc', '0', '-5', '1.5', 'NaN', 'Infinity']) {
      const c = leadConfigOf({ sessionBudgetOE: bad, runBudgetOE: bad, agentBudgetOE: bad })
      expect([bad, c.sessionBudget, c.runBudget, c.agentBudget]).toEqual([bad, null, null, null])
    }
  })
  test('non-string options and null input are defaults', () => {
    expect(leadConfigOf(null)).toEqual(leadConfigOf({}))
    expect(leadConfigOf({ budgetMode: 1, sessionBudgetOE: 5 }).sessionBudget).toBe(null)
  })
  test('any mode but enforce is observe', () => expect(leadConfigOf({ budgetMode: 'ENFORCE' }).mode).toBe('observe'))
  test('fableCap is a non-negative integer, 0 forbids Fable, anything else is 3', () => {
    expect(leadConfigOf({ fableCap: '5' }).fableCap).toBe(5)
    expect(leadConfigOf({ fableCap: '0' }).fableCap).toBe(0)
    expect(leadConfigOf({ fableCap: ' 7 ' }).fableCap).toBe(7)
    for (const bad of ['-1', '2.5', '', 'x', '0x10', '1e6', '+5']) expect(leadConfigOf({ fableCap: bad }).fableCap).toBe(3)
  })
  test('integers are digits only: hex, exponent, fraction and unsafe sizes are refused', () => {
    for (const bad of ['0x10', '1e6', '1.5', '+5', '99999999999999999999']) {
      expect([bad, leadConfigOf({ sessionBudgetOE: bad }).sessionBudget]).toEqual([bad, null])
    }
    expect(leadConfigOf({ sessionBudgetOE: ' 1000 ' }).sessionBudget).toBe(1000)
  })
  test('budgetLeft: extra on top of no session limit is still no limit', () =>
    expect(budgetLeft({ ...EMPTY_LEAD, extra: 500 }, cfg(), { agentId: null, runId: null }).session).toBe(null))
  test('timing constants', () => {
    expect(SILENCE_MS).toBe(15 * 60_000)
    expect(LONG_CALL_MS).toBe(20 * 60_000)
  })
})

describe('lead ledger', () => {
  test('addUsage sums per agent, per run and per session', () => {
    const l = addUsage(addUsage(EMPTY_LEAD, { agentId: 'a1', runId: 'wf_1', oe: 100 }), {
      agentId: 'a1',
      runId: 'wf_1',
      oe: 50,
    })
    expect(l.byAgent).toEqual({ a1: 150 })
    expect(l.byRun).toEqual({ wf_1: 150 })
    expect(l.session).toBe(150)
  })
  test('main (agentId null) counts into the session only', () => {
    const l = addUsage(EMPTY_LEAD, { agentId: null, runId: null, oe: 70 })
    expect(l).toEqual({ ...EMPTY_LEAD, session: 70 })
  })
  test('a run id without an agent id is still main: session only', () => {
    const l = addUsage(EMPTY_LEAD, { agentId: null, runId: 'wf_1', oe: 70 })
    expect(l.byRun).toEqual({})
    expect(l.byAgent).toEqual({})
    expect(l.session).toBe(70)
  })
  test('an agent outside a workflow counts into agent and session', () => {
    const l = addUsage(EMPTY_LEAD, { agentId: 'a2', runId: null, oe: 30 })
    expect(l.byAgent).toEqual({ a2: 30 })
    expect(l.byRun).toEqual({})
    expect(l.session).toBe(30)
  })
  test('non-finite or negative oe adds 0', () => {
    for (const oe of [NaN, Infinity, -Infinity, -5]) {
      const l = addUsage(EMPTY_LEAD, { agentId: 'a1', runId: 'wf_1', oe })
      expect([oe, l.session, l.byAgent.a1, l.byRun.wf_1]).toEqual([oe, 0, 0, 0])
    }
  })
  test('addUsage does not mutate its input', () => {
    const before = addUsage(EMPTY_LEAD, { agentId: 'a1', runId: 'wf_1', oe: 10 })
    const snap = JSON.stringify(before)
    const after = addUsage(before, { agentId: 'a1', runId: 'wf_1', oe: 5 })
    expect(JSON.stringify(before)).toBe(snap)
    expect(after).not.toBe(before)
    expect(after.byAgent).not.toBe(before.byAgent)
    expect(JSON.stringify(EMPTY_LEAD)).toBe(JSON.stringify(addUsage(EMPTY_LEAD, { agentId: null, runId: null, oe: 0 })))
  })
  test('EMPTY_LEAD is a clean ledger', () =>
    expect(EMPTY_LEAD).toEqual({
      byAgent: {},
      byRun: {},
      session: 0,
      extra: 0,
      fableCalls: 0,
      councilTurn: null,
      halted: false,
      solo: false,
      rewrites: 0,
      denials: 0,
      news: [],
      alarmsSent: {},
      lastWakeAt: null,
      flags: [],
    }))

  test('budgetLeft: session limit is budget plus extra', () =>
    expect(
      budgetLeft({ ...EMPTY_LEAD, extra: 500, session: 1200 }, cfg({ sessionBudget: 1000 }), {
        agentId: null,
        runId: null,
      }),
    ).toEqual({ session: 300, run: null, agent: null }))
  test('budgetLeft: run and agent limits', () => {
    const l = { ...EMPTY_LEAD, byRun: { wf_1: 400 }, byAgent: { a1: 90 }, session: 500 }
    const c = cfg({ runBudget: 1000, agentBudget: 100 })
    expect(budgetLeft(l, c, { agentId: 'a1', runId: 'wf_1' })).toEqual({ session: null, run: 600, agent: 10 })
    expect(budgetLeft(l, c, { agentId: null, runId: null })).toEqual({ session: null, run: null, agent: null })
  })
  test('budgetLeft: overspend is clamped at 0', () =>
    expect(budgetLeft({ ...EMPTY_LEAD, session: 5000 }, cfg({ sessionBudget: 1000 }), { agentId: null, runId: null })
      .session).toBe(0))
  test('budgetLeft: an unseen agent has spent nothing', () =>
    expect(budgetLeft(EMPTY_LEAD, cfg({ agentBudget: 100 }), { agentId: 'new', runId: null }).agent).toBe(100))

  test('isExhausted', () => {
    expect(isExhausted({ session: 0, run: null, agent: null })).toBe(true)
    expect(isExhausted({ session: 5, run: 0, agent: null })).toBe(true)
    expect(isExhausted({ session: 5, run: 1, agent: 1 })).toBe(false)
    expect(isExhausted({ session: null, run: null, agent: null })).toBe(false)
  })

  test('pushNews keeps the last 20 lines and does not mutate', () => {
    let l = EMPTY_LEAD
    for (let i = 0; i < 25; i++) l = pushNews(l, `n${i}`)
    expect(l.news).toHaveLength(20)
    expect(l.news[0]).toBe('n5')
    expect(l.news[19]).toBe('n24')
    expect(EMPTY_LEAD.news).toEqual([])
  })
})
