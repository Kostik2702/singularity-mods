import { describe, expect, test } from 'claude-code/testing'

import { leadConfigOf } from '../hooks/lead/config'
import { decideSpawn, decideStep } from '../hooks/lead/guard'
import type { SpawnFacts, StepFacts } from '../hooks/lead/guard'
import { EMPTY_LEAD } from '../hooks/lead/ledger'
import type { Lead } from '../types'

const facts = (o: Partial<SpawnFacts> = {}): SpawnFacts => ({
  prompt: 'Задача.',
  subagentType: 'coder',
  fork: false,
  isWorkflow: false,
  isResume: false,
  runId: null,
  ...o,
})
const lead = (o: Partial<Lead> = {}): Lead => ({ ...EMPTY_LEAD, ...o })
const cfg = (o: Partial<ReturnType<typeof leadConfigOf>> = {}) => ({ ...leadConfigOf({}), ...o })

const WHY = 'ПОЧЕМУ FABLE: решение необратимо\nВопрос: как делить схему?'

describe('spawn guard', () => {
  test('council without command is denied', () => {
    for (const marker of ['COUNCIL MISSION', 'PLANNING MISSION', 'SRE MISSION']) {
      expect(decideSpawn(facts({ prompt: `${marker}: оцени`, model: 'opus' }), lead(), cfg())).toEqual({
        kind: 'deny',
        reason: 'Council запускается только командой владельца — попроси его',
      })
    }
  })

  test('council inside the window runs on opus', () => {
    const l = lead({ councilTurn: 'council' })
    for (const model of [undefined, 'fable', 'claude-fable-5-1']) {
      const d = decideSpawn(facts({ prompt: 'COUNCIL MISSION: оцени', ...(model === undefined ? {} : { model }) }), l, cfg())
      expect(d).toMatchObject({ kind: 'rewrite', model: 'opus' })
    }
    expect(decideSpawn(facts({ prompt: 'COUNCIL MISSION: оцени', model: 'sonnet' }), l, cfg())).toEqual({ kind: 'pass' })
  })

  test('fable in a workflow becomes opus', () => {
    expect(decideSpawn(facts({ model: 'fable', isWorkflow: true, runId: 'wf_1' }), lead(), cfg())).toMatchObject({
      kind: 'rewrite',
      model: 'opus',
    })
  })

  test('fable outside advisor is denied', () => {
    expect(decideSpawn(facts({ model: 'fable', prompt: WHY }), lead(), cfg())).toEqual({
      kind: 'deny',
      reason: 'Fable только через advisor',
    })
  })

  test('advisor without ПОЧЕМУ FABLE is denied', () => {
    for (const prompt of ['Вопрос: как делить схему?', 'ПОЧЕМУ FABLE:\nВопрос', 'ПОЧЕМУ FABLE:   \n']) {
      expect(decideSpawn(facts({ model: 'fable', subagentType: 'advisor', prompt }), lead(), cfg())).toMatchObject({
        kind: 'deny',
        reason: 'нет строки ПОЧЕМУ FABLE:',
      })
    }
    expect(decideSpawn(facts({ model: 'fable', subagentType: 'advisor', prompt: WHY }), lead(), cfg())).toEqual({ kind: 'pass', countsAsFable: true })
  })

  test('fourth advisor over cap 3 is denied', () => {
    const f = facts({ model: 'fable', subagentType: 'advisor', prompt: WHY })
    expect(decideSpawn(f, lead({ fableCalls: 2 }), cfg())).toEqual({ kind: 'pass', countsAsFable: true })
    expect(decideSpawn(f, lead({ fableCalls: 3 }), cfg())).toMatchObject({ kind: 'deny', reason: expect.stringContaining('3/3') })
  })

  test('cap 0 forbids the first advisor', () => {
    const f = facts({ model: 'fable', subagentType: 'advisor', prompt: WHY })
    expect(decideSpawn(f, lead(), cfg({ fableCap: 0 }))).toMatchObject({ kind: 'deny' })
  })

  test('no model is left to the engine', () => {
    const d = decideSpawn(facts(), lead(), cfg())
    expect(d).toEqual({ kind: 'pass' })
    expect(d).not.toHaveProperty('model')
  })

  test('fork is noted, never rewritten', () => {
    expect(decideSpawn(facts({ fork: true, model: 'fable' }), lead(), cfg())).toEqual({ kind: 'note', note: 'форк · модель лида' })
    expect(decideSpawn(facts({ fork: true, prompt: 'COUNCIL MISSION' }), lead({ councilTurn: 'council' }), cfg())).toMatchObject({
      kind: 'note',
    })
  })

  test('resume is never rewritten', () => {
    expect(decideSpawn(facts({ isResume: true, model: 'fable', isWorkflow: true }), lead(), cfg())).toEqual({ kind: 'pass' })
    expect(decideSpawn(facts({ isResume: true, prompt: 'COUNCIL MISSION' }), lead({ councilTurn: 'council' }), cfg())).toEqual({
      kind: 'pass',
    })
  })

  test('observe never denies on numbers', () => {
    const spent = lead({ session: 9e9 })
    expect(decideSpawn(facts(), spent, cfg({ sessionBudget: 1 }))).toEqual({ kind: 'pass' })
  })

  test('the owner’s halt denies in every mode, forks and resumes too, with its own reason', () => {
    const reason = 'заморожено владельцем — остановись и спроси владельца'
    for (const mode of ['observe', 'enforce'] as const) {
      const c = cfg({ mode })
      expect(decideSpawn(facts(), lead({ halted: true }), c)).toEqual({ kind: 'deny', reason })
      expect(decideSpawn(facts({ fork: true }), lead({ halted: true }), c)).toEqual({ kind: 'deny', reason })
      expect(decideSpawn(facts({ isResume: true }), lead({ halted: true }), c)).toEqual({ kind: 'deny', reason })
    }
  })

  test('enforce denies when the session is spent', () => {
    const c = cfg({ mode: 'enforce', sessionBudget: 100 })
    const deny = { kind: 'deny', reason: 'бюджет исчерпан — остановись и спроси владельца' }
    expect(decideSpawn(facts(), lead({ session: 100 }), c)).toEqual(deny)
    expect(decideSpawn(facts(), lead({ session: 99 }), c)).toEqual({ kind: 'pass' })
    expect(decideSpawn(facts(), lead({ session: 100 }), { ...c, sessionBudget: 100 })).toEqual(deny)
  })

  test('enforce denies a halted session, a spent run, forks and resumes', () => {
    const c = cfg({ mode: 'enforce', runBudget: 10 })
    expect(decideSpawn(facts(), lead({ halted: true }), c)).toMatchObject({ kind: 'deny' })
    expect(decideSpawn(facts({ runId: 'wf_1' }), lead({ byRun: { wf_1: 10 } }), c)).toMatchObject({ kind: 'deny' })
    expect(decideSpawn(facts({ runId: 'wf_1', fork: true }), lead({ byRun: { wf_1: 10 } }), c)).toMatchObject({ kind: 'deny' })
    expect(decideSpawn(facts({ runId: 'wf_1', isResume: true }), lead({ byRun: { wf_1: 10 } }), c)).toMatchObject({ kind: 'deny' })
    expect(decideSpawn(facts({ runId: 'wf_2' }), lead({ byRun: { wf_1: 10 } }), c)).toEqual({ kind: 'pass' })
  })

  test('a budget deny beats a rewrite', () => {
    const c = cfg({ mode: 'enforce', sessionBudget: 1 })
    expect(decideSpawn(facts({ model: 'fable', isWorkflow: true }), lead({ session: 5 }), c)).toMatchObject({ kind: 'deny' })
  })

  describe('a bare advisor is Fable (R15)', () => {
    const bare = (o: Partial<SpawnFacts> = {}) => facts({ subagentType: 'advisor', ...o })
    test('without the reason line it is denied', () => {
      expect(decideSpawn(bare({ prompt: 'Вопрос?' }), lead(), cfg())).toMatchObject({ kind: 'deny', reason: 'нет строки ПОЧЕМУ FABLE:' })
      expect(decideSpawn(bare({ prompt: 'Вопрос?', model: '' }), lead(), cfg())).toMatchObject({ kind: 'deny' })
    })
    test('the fourth over cap 3 is denied', () => {
      expect(decideSpawn(bare({ prompt: WHY }), lead({ fableCalls: 3 }), cfg())).toMatchObject({ kind: 'deny' })
    })
    test('in a workflow it becomes opus and is not counted', () => {
      const d = decideSpawn(bare({ prompt: 'Вопрос?', isWorkflow: true, runId: 'wf_1' }), lead(), cfg())
      expect(d).toMatchObject({ kind: 'rewrite', model: 'opus' })
      expect(d).not.toHaveProperty('countsAsFable')
    })
    test('with an explicit model sonnet it passes and is not counted', () => {
      const d = decideSpawn(bare({ prompt: 'Вопрос?', model: 'sonnet' }), lead(), cfg())
      expect(d).toEqual({ kind: 'pass' })
    })
    test('justified, it passes and counts once', () => {
      expect(decideSpawn(bare({ prompt: WHY }), lead(), cfg())).toEqual({ kind: 'pass', countsAsFable: true })
      expect(decideSpawn(bare({ prompt: WHY, model: 'fable' }), lead(), cfg())).toEqual({ kind: 'pass', countsAsFable: true })
    })
    test('a fork or a resume is never counted', () => {
      expect(decideSpawn(bare({ prompt: WHY, fork: true }), lead(), cfg())).not.toHaveProperty('countsAsFable')
      expect(decideSpawn(bare({ prompt: WHY, isResume: true }), lead(), cfg())).not.toHaveProperty('countsAsFable')
    })
  })

  describe('markers count at the start of a line (R16)', () => {
    test('a council marker mid-line in prose is not a council', () => {
      const prompt = 'Объясни, что значит COUNCIL MISSION в промпте, и не запускай совет.'
      expect(decideSpawn(facts({ prompt }), lead(), cfg())).toEqual({ kind: 'pass' })
    })
    test('at the line start, or after indentation, it is denied', () => {
      expect(decideSpawn(facts({ prompt: 'Вступление\nSRE MISSION: оцени' }), lead(), cfg())).toMatchObject({ kind: 'deny' })
      expect(decideSpawn(facts({ prompt: 'Вступление\n  \tPLANNING MISSION: план' }), lead(), cfg())).toMatchObject({ kind: 'deny' })
    })
    test('a reason mentioned mid-line is not a justification', () => {
      const prompt = 'Нужна строка ПОЧЕМУ FABLE: потом допишу'
      expect(decideSpawn(facts({ model: 'fable', subagentType: 'advisor', prompt }), lead(), cfg())).toMatchObject({
        kind: 'deny',
        reason: 'нет строки ПОЧЕМУ FABLE:',
      })
    })
  })
})

const BLOCK_BUDGET = '[mission-control] остановлен до запроса: бюджет исчерпан'
const BLOCK_HALT = '[mission-control] остановлен до запроса: заморожено владельцем'

const sfacts = (o: Partial<StepFacts> = {}): StepFacts => ({
  agentId: 'a1',
  runId: null,
  isWorkflow: false,
  model: 'claude-sonnet-5-5',
  ...o,
})

describe('request guard', () => {
  test('main is never blocked', () => {
    const c = cfg({ mode: 'enforce', sessionBudget: 1, agentBudget: 1, runBudget: 1 })
    const spent = lead({ session: 9e9, halted: true, byAgent: { a1: 9e9 }, byRun: { wf_1: 9e9 } })
    expect(decideStep(sfacts({ agentId: null, runId: 'wf_1', isWorkflow: true }), spent, c)).toEqual({ kind: 'send' })
  })

  test('main never gets an effort rewrite', () => {
    expect(decideStep(sfacts({ agentId: null, isWorkflow: true, model: 'sonnet' }), lead(), cfg())).toEqual({ kind: 'send' })
  })

  test('a spent subagent is blocked in enforce: agent, run and session', () => {
    const c = cfg({ mode: 'enforce', agentBudget: 100, runBudget: 200, sessionBudget: 300 })
    const block = { kind: 'block', answer: BLOCK_BUDGET }
    expect(decideStep(sfacts(), lead({ byAgent: { a1: 100 } }), c)).toEqual(block)
    expect(decideStep(sfacts({ runId: 'wf_1', isWorkflow: true }), lead({ byRun: { wf_1: 200 } }), c)).toEqual(block)
    expect(decideStep(sfacts(), lead({ session: 300 }), c)).toEqual(block)
    expect(decideStep(sfacts(), lead({ byAgent: { a1: 99 }, session: 299 }), c)).toEqual({ kind: 'send' })
    expect(decideStep(sfacts(), lead({ byAgent: { a2: 100 } }), c)).toEqual({ kind: 'send' })
  })

  test('halted blocks every subagent', () => {
    const c = cfg({ mode: 'enforce' })
    expect(decideStep(sfacts(), lead({ halted: true }), c)).toEqual({ kind: 'block', answer: BLOCK_HALT })
    expect(decideStep(sfacts({ agentId: 'a2', runId: 'wf_9', isWorkflow: true }), lead({ halted: true }), c)).toEqual({
      kind: 'block',
      answer: BLOCK_HALT,
    })
  })

  test('a freeze wins over an exhausted budget in the answer', () => {
    const c = cfg({ mode: 'enforce', sessionBudget: 1 })
    expect(decideStep(sfacts(), lead({ halted: true, session: 5 }), c)).toEqual({ kind: 'block', answer: BLOCK_HALT })
  })

  test('observe never blocks on numbers', () => {
    const spent = lead({ session: 9e9, byAgent: { a1: 9e9 } })
    expect(decideStep(sfacts(), spent, cfg({ sessionBudget: 1, agentBudget: 1 }))).toEqual({ kind: 'send' })
  })

  test('the owner’s halt blocks a subagent in observe too, main never', () => {
    expect(decideStep(sfacts(), lead({ halted: true }), cfg())).toEqual({ kind: 'block', answer: BLOCK_HALT })
    expect(decideStep(sfacts({ agentId: null }), lead({ halted: true }), cfg())).toEqual({ kind: 'send' })
  })

  describe('a workflow agent’s effort is capped at its tier (R17)', () => {
    const wf = (model: string, effort?: StepFacts['effort']) =>
      sfacts({ isWorkflow: true, runId: 'wf_1', model, ...(effort === undefined ? {} : { effort }) })
    const cap = (effort: string) => ({ kind: 'send', effort })

    test('no effort at all gets the tier’s', () => {
      expect(decideStep(wf('sonnet'), lead(), cfg())).toEqual(cap('medium'))
      expect(decideStep(wf('claude-sonnet-5-5'), lead(), cfg())).toEqual(cap('medium'))
      expect(decideStep(wf('claude-haiku-5-5'), lead(), cfg())).toEqual(cap('low'))
      expect(decideStep(wf('claude-opus-5-5'), lead(), cfg())).toEqual(cap('high'))
    })

    test('workflow sonnet agent gets medium effort: an incoming high is cut, a low stays', () => {
      expect(decideStep(wf('claude-sonnet-5-5', 'high'), lead(), cfg())).toEqual(cap('medium'))
      expect(decideStep(wf('claude-sonnet-5-5', 'xhigh'), lead(), cfg())).toEqual(cap('medium'))
      expect(decideStep(wf('claude-sonnet-5-5', 'max'), lead(), cfg())).toEqual(cap('medium'))
      expect(decideStep(wf('claude-sonnet-5-5', 'low'), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('claude-sonnet-5-5', 'medium'), lead(), cfg())).toEqual({ kind: 'send' })
    })

    test('haiku is capped at low, opus at high; a lower effort is never raised', () => {
      expect(decideStep(wf('claude-haiku-5-5', 'high'), lead(), cfg())).toEqual(cap('low'))
      expect(decideStep(wf('claude-haiku-5-5', 'low'), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('claude-opus-5-5', 'xhigh'), lead(), cfg())).toEqual(cap('high'))
      expect(decideStep(wf('claude-opus-5-5', 'max'), lead(), cfg())).toEqual(cap('high'))
      expect(decideStep(wf('claude-opus-5-5', 'high'), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('claude-opus-5-5', 'medium'), lead(), cfg())).toEqual({ kind: 'send' })
    })

    test('left alone: fable, an unknown model, a numeric or unknown effort, a non-workflow agent, main', () => {
      expect(decideStep(wf('claude-fable-5-1', 'max'), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('claude-fable-5-1'), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('claude-test', 'max'), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('sonnet', 0), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('sonnet', 32000), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(wf('sonnet', 'ultra'), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(sfacts({ model: 'sonnet', effort: 'high' }), lead(), cfg())).toEqual({ kind: 'send' })
      expect(decideStep(sfacts({ agentId: null, isWorkflow: true, model: 'sonnet', effort: 'max' }), lead(), cfg())).toEqual({
        kind: 'send',
      })
    })
  })

  test('a block beats an effort rewrite', () => {
    const f = sfacts({ isWorkflow: true, runId: 'wf_1', model: 'sonnet' })
    expect(decideStep(f, lead({ halted: true }), cfg({ mode: 'enforce' }))).toMatchObject({ kind: 'block' })
  })
})
