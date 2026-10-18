import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, CurrentAction } from '../types'
import { LONG_CALL_MS, SILENCE_MS } from '../hooks/lead/config'
import { EMPTY_LEAD } from '../hooks/lead/ledger'
import { WAKE_GAP_MS, alarmsOf, leadIdle, mayWake, rearmed, watchStep } from '../hooks/lead/watch'
import { mainRow } from '../hooks/mission/model'
import { complete, engineBeneath, spawn, submit } from './helpers'

const MIN = 60_000
const SESSION = { cwd: '/home/magos/forge', surface: 'terminal' as const, isInteractive: true }
const T = 1_000_000

function agent(id: string, patch: Partial<AgentRow> = {}): AgentRow {
  return { ...mainRow(T), id, parentId: 'main', type: 'coder', description: `задача ${id}`, phase: 'thinking', ...patch }
}

function call(startedAt: number, status: CurrentAction['status'] = 'run'): CurrentAction {
  return { id: 'c1', kind: 'run', run: 'идёт', done: 'готово', target: 'x', status, startedAt, ms: null }
}

const main = (phase: AgentRow['phase']): AgentRow => ({ ...mainRow(T), phase })

describe('alarmsOf', () => {
  test('silent after 15 minutes, not after 14', () => {
    const rows = [main('thinking'), agent('a1')]
    expect(alarmsOf(rows, T + SILENCE_MS - MIN, {})).toEqual([])
    expect(alarmsOf(rows, T + SILENCE_MS, {})).toEqual([{ agentId: 'a1', kind: 'silent', minutes: 15 }])
  })

  test('a waiting agent is never silent', () => {
    expect(alarmsOf([agent('a1', { phase: 'waiting' })], T + 60 * MIN, {})).toEqual([])
  })

  test('main, unconfirmed and ended rows are never silent', () => {
    const rows = [
      { ...main('thinking'), lastEventAt: T },
      agent('a2', { isConfirmed: false }),
      agent('a3', { phase: 'done' }),
    ]
    expect(alarmsOf(rows, T + 60 * MIN, {})).toEqual([])
  })

  test('an alarm is raised once', () => {
    const rows = [agent('a1')]
    const first = alarmsOf(rows, T + 16 * MIN, {})
    expect(first).toHaveLength(1)
    expect(alarmsOf(rows, T + 17 * MIN, { 'a1:silent': T + 16 * MIN })).toEqual([])
  })

  test('long call over 20 minutes alarms', () => {
    const at = (min: number) => [agent('a1', { phase: 'acting', lastEventAt: T + min * MIN, current: call(T) })]
    expect(alarmsOf(at(20), T + LONG_CALL_MS, {}).filter(a => a.kind === 'long-call')).toEqual([])
    expect(alarmsOf(at(21), T + 21 * MIN, {})).toEqual([{ agentId: 'a1', kind: 'long-call', minutes: 21 }])
  })

  test('a finished call is no long call', () => {
    const rows = [agent('a1', { phase: 'thinking', lastEventAt: T + 29 * MIN, current: call(T, 'ok') })]
    expect(alarmsOf(rows, T + 30 * MIN, {})).toEqual([])
  })
})

describe('rearmed', () => {
  test('an alarm clears once the agent shows life, so a later silence alarms again', () => {
    const silent = [agent('a1')]
    const sent = { 'a1:silent': T + 15 * MIN }
    expect(rearmed(silent, T + 16 * MIN, sent)).toEqual(sent)
    const alive = [agent('a1', { lastEventAt: T + 16 * MIN })]
    const cleared = rearmed(alive, T + 17 * MIN, sent)
    expect(cleared).toEqual({})
    expect(alarmsOf(alive, T + 31 * MIN, cleared)).toEqual([{ agentId: 'a1', kind: 'silent', minutes: 15 }])
  })

  test('a long call that ended clears its alarm; an unrelated key is dropped with its agent', () => {
    const ended = [agent('a1', { phase: 'thinking', lastEventAt: T + 25 * MIN, current: call(T, 'ok') })]
    expect(rearmed(ended, T + 26 * MIN, { 'a1:long-call': T + 21 * MIN, 'gone:silent': T })).toEqual({})
  })
})

describe('leadIdle and mayWake', () => {
  test('idle or done main is idle; a thinking or acting one is not', () => {
    expect(leadIdle([main('idle')])).toBe(true)
    expect(leadIdle([main('done')])).toBe(true)
    expect(leadIdle([main('thinking')])).toBe(false)
    expect(leadIdle([main('acting')])).toBe(false)
    // no main row yet: it has done nothing, so it waits
    expect(leadIdle([agent('a1')])).toBe(true)
  })

  test('one wake per 10 minutes', () => {
    expect(mayWake(EMPTY_LEAD, T)).toBe(true)
    expect(mayWake({ ...EMPTY_LEAD, lastWakeAt: T }, T + WAKE_GAP_MS - 1)).toBe(false)
    expect(mayWake({ ...EMPTY_LEAD, lastWakeAt: T }, T + WAKE_GAP_MS)).toBe(true)
  })
})

describe('watchStep', () => {
  test('a busy lead is not woken, the alarm goes to news and is recorded', () => {
    const rows = [main('thinking'), agent('a1')]
    const { lead, wake } = watchStep(EMPTY_LEAD, rows, T + 15 * MIN)
    expect(wake).toBeNull()
    expect(lead.news).toHaveLength(1)
    expect(lead.news[0]).toContain('задача a1')
    expect(lead.news[0]).toContain('нет вестей 15 мин')
    expect(lead.alarmsSent).toEqual({ 'a1:silent': T + 15 * MIN })
    expect(lead.lastWakeAt).toBeNull()
  })

  test('an idle lead is woken: Russian text, lastWakeAt set, nothing repeated next time', () => {
    const rows = [main('idle'), agent('a1')]
    const first = watchStep(EMPTY_LEAD, rows, T + 15 * MIN)
    expect(first.wake).toBe(
      '[mission-control] тревога: задача a1 — нет вестей 15 мин. Реши: TaskStop, SendMessage или ждать.',
    )
    expect(first.lead.lastWakeAt).toBe(T + 15 * MIN)
    const again = watchStep(first.lead, rows, T + 16 * MIN)
    expect(again.wake).toBeNull()
    expect(again.lead).toBe(first.lead)
  })

  test('several new alarms make one wake of at most 600 characters', () => {
    const rows = [main('idle'), ...Array.from({ length: 30 }, (_, i) => agent(`a${i}`, { description: `долгая задача номер ${i}` }))]
    const { lead, wake } = watchStep(EMPTY_LEAD, rows, T + 15 * MIN)
    expect(wake).not.toBeNull()
    expect((wake ?? '').length).toBeLessThanOrEqual(600)
    expect(wake).toContain('долгая задача номер 0')
    expect(Object.keys(lead.alarmsSent)).toHaveLength(30)
    expect(lead.news).toHaveLength(20)
  })

  test('an idle lead inside the 10 minutes is not woken, the alarm still goes to news', () => {
    const rows = [main('idle'), agent('a1'), agent('a2', { lastEventAt: T + 2 * MIN })]
    const first = watchStep(EMPTY_LEAD, rows, T + 15 * MIN)
    expect(first.wake).not.toBeNull()
    const second = watchStep(first.lead, rows, T + 17 * MIN)
    expect(second.wake).toBeNull()
    expect(second.lead.news).toHaveLength(2)
  })

  test('an alarm deferred while the lead was busy wakes it once it idles', () => {
    const busy = watchStep(EMPTY_LEAD, [main('thinking'), agent('a1')], T + 15 * MIN)
    expect(busy.wake).toBeNull()
    const idle = watchStep(busy.lead, [main('idle'), agent('a1')], T + 16 * MIN)
    expect(idle.wake).toContain('нет вестей 16 мин')
    expect(idle.lead.lastWakeAt).toBe(T + 16 * MIN)
    expect(watchStep(idle.lead, [main('idle'), agent('a1')], T + 17 * MIN).wake).toBeNull()
  })

  test('two alarms 2 minutes apart: the first wakes, the second waits for the 10 minutes', () => {
    const rows = [main('idle'), agent('a1', { description: 'первая' }), agent('a2', { description: 'вторая', lastEventAt: T + 2 * MIN })]
    const first = watchStep(EMPTY_LEAD, rows.slice(0, 2), T + 15 * MIN)
    expect(first.wake).toContain('первая')
    const second = watchStep(first.lead, rows, T + 17 * MIN)
    expect(second.wake).toBeNull()
    expect(watchStep(second.lead, rows, T + 24 * MIN).wake).toBeNull()
    const third = watchStep(second.lead, rows, T + 25 * MIN)
    expect(third.wake).toContain('вторая')
    expect(third.wake).not.toContain('первая')
  })

  test('an alarm cleared by re-arm never wakes', () => {
    const busy = watchStep(EMPTY_LEAD, [main('thinking'), agent('a1')], T + 15 * MIN)
    const alive = [main('idle'), agent('a1', { lastEventAt: T + 16 * MIN })]
    expect(watchStep(busy.lead, alive, T + 17 * MIN).wake).toBeNull()
  })

  test('a 20-minute running call gives only a long-call alarm, no silent one', () => {
    const rows = [agent('a1', { phase: 'acting', lastEventAt: T, current: call(T) })]
    expect(alarmsOf(rows, T + 21 * MIN, {})).toEqual([{ agentId: 'a1', kind: 'long-call', minutes: 21 }])
    expect(alarmsOf(rows, T + 16 * MIN, {})).toEqual([])
  })

  test('nothing to say returns the same lead', () => {
    expect(watchStep(EMPTY_LEAD, [main('idle'), agent('a1')], T + MIN).lead).toBe(EMPTY_LEAD)
  })
})

describe('the watchdog in the engine', () => {
  // 13 virtual minutes of one-second ticks take 3-6 s of real time: past the kit's 5 s default on a busy machine.
  test('an idle lead is woken once per 10 minutes: two alarms 2 minutes apart make one prompt', { timeoutMs: 30_000 }, async ($, on) => {
    const engine = engineBeneath(on, { spawns: ['a1', 'a2'] })
    await $.session.start(SESSION)
    await submit($, 'go')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, { subagentType: 'coder', description: 'первая' })
    await engine.clock.advance(2 * MIN)
    await spawn($, { subagentType: 'coder', description: 'вторая' })
    await complete($, { answer: 'запустил, жду' })
    await engine.clock.advance(13 * MIN)
    expect(engine.submitted).toHaveLength(1)
    expect(engine.submitted[0]).toContain('первая')
    expect(engine.submitted[0]).toContain('нет вестей 15 мин')
    await engine.clock.advance(2 * MIN)
    expect(engine.submitted).toHaveLength(1)
  })

  test('a busy lead is not woken', { timeoutMs: 30_000 }, async ($, on) => {
    const engine = engineBeneath(on, { spawns: ['a1'] })
    await $.session.start(SESSION)
    await submit($, 'go')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, { subagentType: 'coder', description: 'первая' })
    await engine.clock.advance(16 * MIN)
    expect(engine.submitted).toEqual([])
  })
})
