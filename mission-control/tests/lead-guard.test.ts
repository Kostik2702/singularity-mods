import { describe, expect, test } from 'claude-code/testing'

import { leadConfigOf } from '../hooks/lead/config'
import { decideSpawn } from '../hooks/lead/guard'
import type { SpawnFacts } from '../hooks/lead/guard'
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
    const spent = lead({ session: 9e9, halted: true })
    expect(decideSpawn(facts(), spent, cfg({ sessionBudget: 1 }))).toEqual({ kind: 'pass' })
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
