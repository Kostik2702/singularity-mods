import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { leadConfigOf } from '../hooks/lead/config'
import { journalLine } from '../hooks/lead/journal'
import { endedLine, startedLine } from '../hooks/lead/news'
import { EMPTY_LEAD } from '../hooks/lead/ledger'
import { teamTable } from '../hooks/lead/team'
import { modelText } from '../hooks/mission/pane'
import { complete, engineBeneath, spawn, step, submit } from './helpers'

const SONNET = 'claude-sonnet-5-5'
// 1000 input + 400 output tokens on sonnet: (1000 x 2 + 400 x 10) / 4 = 1500 OE.
const used = { model: SONNET, input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

describe('the news lines', () => {
  test('started: label, tier, effort; a spawn outside the background is marked', () => {
    expect(startedLine({ label: 'найти', tier: 'sonnet', effort: 'medium', background: true })).toBe('запущен: найти · sonnet · medium')
    expect(startedLine({ label: 'найти', tier: 'sonnet', effort: 'medium', background: false })).toBe(
      'запущен: найти · sonnet · medium · не в фоне',
    )
  })
  test('started: a tier or an effort not known yet is a dash', () => {
    expect(startedLine({ label: 'найти', tier: null, effort: null, background: true })).toBe('запущен: найти · — · —')
  })
  test('ended: label, outcome, the run’s OE as a whole number', () => {
    expect(endedLine({ label: 'найти', outcome: 'готов', oe: 1500.4 })).toBe('закончил: найти · готов · 1500 OE')
    expect(endedLine({ label: 'найти', outcome: 'ошибка', oe: 0 })).toBe('закончил: найти · ошибка · 0 OE')
  })
})

const contextOf = (engine: ReturnType<typeof engineBeneath>): string => (engine.contexts.at(-1) ?? []).join('\n')

describe('the digest says who started and who finished', () => {
  test('a started executor: label, tier, effort unknown yet, not in the background', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    await spawn($, { subagentType: 'scout', description: 'найти', model: 'sonnet' })
    await submit($, 'что нового?')
    expect(contextOf(engine)).toContain('запущен: найти · sonnet · — · не в фоне')
  })

  test('a background executor is not marked', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    await spawn($, { subagentType: 'scout', description: 'найти', model: 'sonnet', background: true })
    await submit($, 'что нового?')
    expect(contextOf(engine)).toContain('запущен: найти · sonnet · —')
    expect(contextOf(engine)).not.toContain('не в фоне')
  })

  test('a model the table does not know is a dash; with no description the type names it', async ($, on) => {
    const engine = engineBeneath(on)
    await submit($, 'прогон')
    await spawn($, { subagentType: 'scout', description: '', background: true })
    await submit($, 'что нового?')
    expect(contextOf(engine)).toContain('запущен: scout · — · —')
  })

  test('a refused spawn is not a start', async ($, on) => {
    const engine = engineBeneath(on)
    await submit($, 'прогон')
    await spawn($, { subagentType: 'coder', description: 'шаг', model: 'fable' })
    await submit($, 'что нового?')
    expect(contextOf(engine)).toContain('отказ в спавне')
    expect(contextOf(engine)).not.toContain('запущен')
  })

  test('an end: label, outcome and the OE of the run', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    await spawn($, { subagentType: 'scout', description: 'найти', model: 'sonnet', background: true })
    await submit($, 'раз')
    engine.stepAnswer({ usage: used })
    await step($, 'a1', { model: SONNET })
    await complete($, { agentId: 'a1', answer: 'готово.' })
    await submit($, 'два')
    expect(contextOf(engine)).toBe('закончил: найти · готов · 1500 OE')
  })

  test('a failed end says so', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    await spawn($, { subagentType: 'scout', description: 'найти', background: true })
    await submit($, 'раз')
    await complete($, { agentId: 'a1', answer: 'упал', reason: 'error' })
    await submit($, 'два')
    expect(contextOf(engine)).toBe('закончил: найти · ошибка · 0 OE')
  })

  test('a resumed executor ends again: each end holds only its own run', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET, spawns: ['a1', 'a1'] })
    await submit($, 'прогон')
    await spawn($, { subagentType: 'scout', description: 'найти', background: true })
    engine.stepAnswer({ usage: used })
    await step($, 'a1', { model: SONNET })
    await complete($, { agentId: 'a1', answer: 'готово.' })
    await submit($, 'раз')
    expect(contextOf(engine)).toContain('закончил: найти · готов · 1500 OE')
    await spawn($, { subagentType: 'scout', description: 'найти', background: true })
    engine.stepAnswer({ usage: used })
    engine.stepAnswer({ usage: used })
    await step($, 'a1', { model: SONNET })
    await step($, 'a1', { model: SONNET })
    await complete($, { agentId: 'a1', answer: 'готово снова.' })
    await submit($, 'два')
    expect(contextOf(engine)).toContain('закончил: найти · готов · 3000 OE')
  })

  test('the lead’s own end and a teammate are not executors: no start, no end', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    await spawn($, { subagentType: 'teammate', description: 'напарник', name: 'bob', isTeammate: true, background: true })
    await complete($, { agentId: 'a1', answer: 'жду сообщений' })
    await complete($, { answer: 'готово' })
    await submit($, 'что нового?')
    expect(engine.contexts.at(-1)).toEqual([])
  })

  test('starts of the same kind merge into one line instead of crowding out the rest', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    for (let i = 0; i < 6; i += 1) await spawn($, { subagentType: 'scout', description: 'шаг', model: 'sonnet', background: true })
    await submit($, 'что нового?')
    expect(contextOf(engine)).toBe('запущен: шаг · sonnet · — ×6')
  })
})

describe('rows from before 0.4.0 have no oe', () => {
  const bare = (o: Partial<AgentRow> = {}): AgentRow => {
    const row = {
      id: 'a1',
      parentId: 'main',
      turn: 1,
      type: 'scout',
      name: null,
      description: 'найти',
      task: 'найди',
      model: SONNET,
      requestedModel: null,
      isBackground: true,
      isTeammate: false,
      workflowRunId: null,
      phase: 'acting',
      phaseAt: 1000,
      startedAt: 1000,
      endedAt: null,
      lastEventAt: 1000,
      steps: 2,
      tools: 1,
      intent: null,
      current: null,
      report: null,
      tokens: 0,
      effort: 'medium',
      toolUseId: null,
      ...o,
    } as Partial<AgentRow>
    delete row.oe
    return row as AgentRow
  }

  test('the team table counts it as 0 OE', () => {
    const table = teamTable([bare()], EMPTY_LEAD, leadConfigOf({ agentBudgetOE: '5000' }))
    expect(table).toContain(' · 0/5000 · ')
    expect(table).not.toContain('NaN')
  })

  test('the card’s model row counts it as 0 OE under a limit, and shows none without', () => {
    const d = (agentLimit: number | null) => ({ lead: { mode: 'enforce', session: 0, limit: null, halted: false, agentLimit } }) as never
    expect(modelText(bare(), d(5000))).toBe('sonnet · medium · 0/5 000 OE')
    expect(modelText(bare(), d(null))).toBe('sonnet · medium')
  })

  test('the journal line counts it as 0 OE', () => {
    const o = JSON.parse(journalLine(bare({ phase: 'done', endedAt: 2000 }))) as Record<string, unknown>
    expect(o.oe).toBe(0)
  })
})
