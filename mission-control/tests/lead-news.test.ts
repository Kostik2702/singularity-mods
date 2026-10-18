import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { leadConfigOf } from '../hooks/lead/config'
import { journalLine } from '../hooks/lead/journal'
import { digestOf, mergedNews } from '../hooks/lead/digest'
import { endedLine, startedLine } from '../hooks/lead/news'
import { EMPTY_LEAD, pushNews } from '../hooks/lead/ledger'
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
    expect(contextOf(engine)).toBe('запущены: 6 — шаг (sonnet) ×6')
  })

  test('a workflow agent is never marked as outside the background; a plain Agent spawn still is', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    await spawn($, { subagentType: 'coder', description: 'в workflow', model: 'sonnet', workflow: 'wf_1' })
    await submit($, 'раз')
    expect(contextOf(engine)).toBe('запущен: в workflow · sonnet · —')
    await spawn($, { subagentType: 'coder', description: 'через Agent', model: 'sonnet' })
    await submit($, 'два')
    expect(contextOf(engine)).toBe('запущен: через Agent · sonnet · — · не в фоне')
  })

  test('twelve distinct starts are one digest line and an alarm is still in it', async ($, on) => {
    const engine = engineBeneath(on, { spawnModel: SONNET })
    await submit($, 'прогон')
    for (let i = 0; i < 12; i += 1) await spawn($, { subagentType: 'scout', description: `задача ${i}`, model: 'sonnet', background: true })
    await submit($, 'что нового?')
    const lines = contextOf(engine).split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.startsWith('запущены: 12 — ')).toBe(true)
  })
})

const alarm = 'найти — вызов идёт 25 мин'
const start = (label: string, tail = ''): string => `запущен: ${label} · sonnet · —${tail}`
const fg = ' · не в фоне'
const lead = (news: string[]) => ({ ...EMPTY_LEAD, news })

describe('routine lines merge', () => {
  test('one line keeps its own format; two or more become one line with a count', () => {
    expect(mergedNews([start('найти')])).toEqual([start('найти')])
    expect(mergedNews([start('найти'), start('править')])).toEqual(['запущены: 2 — найти (sonnet); править (sonnet)'])
  })
  test('the header counts the starts outside the background; a tier not known and an effort known are told', () => {
    const news = [start('a', fg), 'запущен: b · — · high', start('c')]
    expect(mergedNews(news)).toEqual(['запущены: 3 (не в фоне: 1) — a (sonnet, не в фоне); b (high); c (sonnet)'])
  })
  test('identical entries collapse to ×N', () => {
    expect(mergedNews([start('шаг'), start('шаг'), start('шаг')])).toEqual(['запущены: 3 — шаг (sonnet) ×3'])
  })
  test('ends merge with the summed OE and each outcome', () => {
    const news = ['закончил: a · готов · 1000 OE', 'закончил: b · ошибка · 500 OE']
    expect(mergedNews(news)).toEqual(['закончили: 2 (1500 OE) — a (готов, 1000 OE); b (ошибка, 500 OE)'])
    expect(mergedNews([news[0] ?? ''])).toEqual([news[0] ?? ''])
  })
  test('the merged line stands where the first one stood; other lines keep their order', () => {
    const news = [alarm, start('a'), 'советчик вызван: x', start('b'), 'закончил: a · готов · 10 OE']
    expect(mergedNews(news)).toEqual([alarm, 'запущены: 2 — a (sonnet); b (sonnet)', 'советчик вызван: x', 'закончил: a · готов · 10 OE'])
  })
  test('a label with the separator in it is read from the right', () => {
    expect(mergedNews([start('а · б'), start('в')])).toEqual(['запущены: 2 — а · б (sonnet); в (sonnet)'])
  })
  test('a merged line is clipped like the others', () => {
    const [line] = mergedNews(Array.from({ length: 12 }, (_, i) => start(`длинная задача номер ${i}`)))
    expect(Array.from(line ?? '').length).toBeLessThanOrEqual(200)
    expect(line?.startsWith('запущены: 12 — ')).toBe(true)
    expect(line?.endsWith('…')).toBe(true)
  })
  test('twelve starts and an alarm: the digest keeps the alarm, the starts are one line', () => {
    const news = [...Array.from({ length: 12 }, (_, i) => start(`задача ${i}`)), alarm]
    const text = digestOf(lead(news), leadConfigOf({})) ?? ''
    expect(text).toContain(alarm)
    expect(text.split('\n').filter(l => l.startsWith('запущ'))).toHaveLength(1)
    expect(text).not.toContain('…и ещё')
  })
})

describe('the news cap never drops an alarm for a start', () => {
  test('an alarm survives any number of starts after it', () => {
    let l = pushNews(EMPTY_LEAD, alarm)
    for (let i = 0; i < 40; i += 1) l = pushNews(l, start(`задача ${i}`))
    expect(l.news).toContain(alarm)
    expect(l.news).toHaveLength(20)
    // the newest routine lines stay, the oldest go
    expect(l.news.at(-1)).toBe(start('задача 39'))
  })
  test('a start does not displace a full list of other news; an end does not either', () => {
    const full = Array.from({ length: 20 }, (_, i) => `тревога ${i}`)
    expect(pushNews(lead(full), start('a')).news).toEqual(full)
    expect(pushNews(lead(full), 'закончил: a · готов · 10 OE').news).toEqual(full)
  })
  test('other news still drops the oldest line first', () => {
    const full = Array.from({ length: 20 }, (_, i) => `тревога ${i}`)
    expect(pushNews(lead(full), 'тревога 20').news).toEqual([...full.slice(1), 'тревога 20'])
  })
  test('an alarm pushes out a routine line, not the oldest alarm', () => {
    const news = ['тревога 0', start('a'), ...Array.from({ length: 18 }, (_, i) => `тревога ${i + 1}`)]
    const out = pushNews(lead(news), 'тревога 19').news
    expect(out).toHaveLength(20)
    expect(out).toContain('тревога 0')
    expect(out).not.toContain(start('a'))
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
