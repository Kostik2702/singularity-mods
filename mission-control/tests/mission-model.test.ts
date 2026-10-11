import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, CurrentAction } from '../types'
import {
  MAIN,
  MAX_AGENTS,
  SILENT_MS,
  applyComplete,
  applyList,
  applySpawn,
  applyStepEnd,
  applyStepStart,
  applyToolEnd,
  applyToolStart,
  applyTurnStart,
  buildTree,
  clearEnded,
  isSilent,
  needsReconcile,
  needsTick,
  phaseFromList,
} from '../hooks/mission/model'
import type { SpawnFacts } from '../hooks/mission/model'

const T0 = 1_000_000

function facts(over: Partial<SpawnFacts> = {}): SpawnFacts {
  return {
    agentId: 'a1',
    deny: null,
    toolUseId: 'tu1',
    parentAgentId: null,
    subagentType: 'investigator',
    description: 'корень бага в parse.ts',
    prompt: 'Найди корень бага.',
    model: 'claude-test',
    name: null,
    isBackground: false,
    isTeammate: false,
    workflowRunId: null,
    turn: 1,
    now: T0,
    ...over,
  }
}

function row(rows: readonly AgentRow[], id: string): AgentRow {
  const found = rows.find(r => r.id === id)
  if (found === undefined) throw new Error(`no row ${id}`)
  return found
}

const call = (id: string, at: number): CurrentAction => ({
  id,
  kind: 'read',
  run: 'читаю',
  done: 'прочитал',
  target: 'parse.ts',
  status: 'run',
  startedAt: at,
  ms: null,
})

describe('a subagent from spawn to report', () => {
  test('spawn → step → tool → step → complete', () => {
    let rows = applySpawn([], facts())
    expect(row(rows, MAIN).phase).toBe('idle')
    expect(row(rows, 'a1')).toMatchObject({ parentId: MAIN, phase: 'starting', task: 'Найди корень бага.', turn: 1 })
    rows = applyStepStart(rows, { agentId: 'a1', now: T0 + 1000 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'thinking', steps: 1, phaseAt: T0 + 1000 })
    rows = applyStepEnd(rows, { agentId: 'a1', answer: 'Смотрю парсер. Сверяю вывод mb search с регэкспом.', now: T0 + 2000 })
    expect(row(rows, 'a1').intent).toBe('Сверяю вывод mb search с регэкспом.')
    rows = applyToolStart(rows, { agentId: 'a1', action: call('c1', T0 + 2000), now: T0 + 2000 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'acting', tools: 1 })
    rows = applyToolEnd(rows, { agentId: 'a1', id: 'c1', status: 'ok', ms: 300, now: T0 + 2300 })
    expect(row(rows, 'a1').current).toMatchObject({ id: 'c1', status: 'ok', ms: 300 })
    rows = applyStepEnd(rows, { agentId: 'a1', answer: '', now: T0 + 2500 })
    expect(row(rows, 'a1').intent).toBe('Сверяю вывод mb search с регэкспом.')
    rows = applyComplete(rows, { agentId: 'a1', reason: 'answer', answer: 'Корень: регэксп. Детали ниже.', tokens: 1200, now: T0 + 9000 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'done', endedAt: T0 + 9000, report: 'Корень: регэксп.', tokens: 1200 })
    expect(row(rows, MAIN).phase).toBe('idle')
  })

  test('a refused spawn is a row that says why', () => {
    const rows = applySpawn([], facts({ agentId: null, deny: 'agent type coder is not allowed here', subagentType: 'coder', toolUseId: 'tu9' }))
    expect(row(rows, 'denied:tu9')).toMatchObject({ phase: 'denied', type: 'coder', report: 'agent type coder is not allowed here', endedAt: T0 })
  })

  test('a spawn with neither an id nor a deny adds nothing', () => {
    expect(applySpawn([], facts({ agentId: null })).map(r => r.id)).toEqual([MAIN])
  })

  test('a teammate idles after its turn; aborted and error end a subagent', () => {
    let rows = applySpawn([], facts({ agentId: 't1', isTeammate: true }))
    rows = applySpawn(rows, facts({ agentId: 'a2', toolUseId: 'tu2' }))
    rows = applySpawn(rows, facts({ agentId: 'a3', toolUseId: 'tu3' }))
    rows = applyComplete(rows, { agentId: 't1', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applyComplete(rows, { agentId: 'a2', reason: 'aborted', answer: '', tokens: 0, now: T0 })
    rows = applyComplete(rows, { agentId: 'a3', reason: 'error', answer: '', tokens: 0, now: T0 })
    expect([row(rows, 't1').phase, row(rows, 'a2').phase, row(rows, 'a3').phase]).toEqual(['idle', 'aborted', 'failed'])
  })

  test('a loop no spawn or list names (the engine’s own forks) is never drawn and never keeps the clock running', () => {
    let rows = applySpawn([], facts())
    rows = applyComplete(rows, { agentId: 'a1', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applyStepStart(rows, { agentId: 'compact-fork', now: T0 })
    rows = applyToolStart(rows, { agentId: 'compact-fork', action: call('c9', T0), now: T0 })
    expect(buildTree(rows, 1, T0).lines.map(l => l.row.id)).toEqual([MAIN, 'a1'])
    expect(buildTree(rows, 1, T0).hidden).toBe(0)
    expect(needsTick(rows, T0)).toBe(false)
    expect(needsReconcile(rows)).toBe(false)
    expect(clearEnded(rows).map(r => r.id)).toEqual([MAIN])
  })

  // Seen live 2026-10-11 (headless e2e): a subagent's first model request starts before
  // agent.spawn settles, so its first step and its first reason were lost (steps 1 of 2).
  test('events that come before the spawn settles are kept and joined to the agent', () => {
    let rows = applyStepStart([], { agentId: 'a1', now: T0 })
    rows = applyStepEnd(rows, { agentId: 'a1', answer: 'Ищу README. Начну с корня папки.', now: T0 + 5 })
    rows = applyToolStart(rows, { agentId: 'a1', action: call('c1', T0 + 6), now: T0 + 6 })
    rows = applySpawn(rows, facts({ now: T0 + 10 }))
    expect(rows.filter(r => r.id === 'a1').length).toBe(1)
    expect(row(rows, 'a1')).toMatchObject({
      isConfirmed: true,
      type: 'investigator',
      parentId: MAIN,
      turn: 1,
      phase: 'acting',
      steps: 1,
      tools: 1,
      intent: 'Начну с корня папки.',
      startedAt: T0,
      task: 'Найди корень бага.',
    })
    expect(buildTree(rows, 1, T0 + 10).lines.map(l => l.row.id)).toEqual([MAIN, 'a1'])
  })

  test('the engine list confirms a loop it names', () => {
    let rows = applyStepStart([], { agentId: 'x1', now: T0 })
    rows = applyList(rows, [{ id: 'x1', type: 'Explore', description: 'find callers', status: 'running', isTeammate: false }], { turn: 2, now: T0 + 1 })
    expect(row(rows, 'x1')).toMatchObject({ isConfirmed: true, type: 'Explore', description: 'find callers', steps: 1, phase: 'thinking', turn: 2 })
  })

  test('unconfirmed loops are the first to leave when rows overflow', () => {
    let rows: AgentRow[] = applySpawn([], facts({ agentId: 'keep' }))
    for (let i = 0; i < MAX_AGENTS + 3; i += 1) rows = applyStepStart(rows, { agentId: `fork${i}`, now: T0 + i })
    rows = applySpawn(rows, facts({ agentId: 'new', toolUseId: 'tu2' }))
    expect(rows.length).toBeLessThanOrEqual(MAX_AGENTS)
    expect(rows.some(r => r.id === 'keep')).toBe(true)
    expect(rows.some(r => r.id === 'new')).toBe(true)
    expect(rows.some(r => r.id === 'fork0')).toBe(false)
  })

  test('a second spawn under a known id resumes it; a step after its end runs it again', () => {
    let rows = applySpawn([], facts())
    rows = applyComplete(rows, { agentId: 'a1', reason: 'answer', answer: 'ok', tokens: 0, now: T0 + 10 })
    rows = applyStepStart(rows, { agentId: 'a1', now: T0 + 20 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'thinking', endedAt: null })
    rows = applySpawn(rows, facts({ now: T0 + 30 }))
    expect(rows.filter(r => r.id === 'a1').length).toBe(1)
    expect(row(rows, 'a1').phase).toBe('starting')
  })

  test('a tool end that is not the current call leaves the current one running', () => {
    let rows = applySpawn([], facts())
    rows = applyToolStart(rows, { agentId: 'a1', action: call('c1', T0), now: T0 })
    rows = applyToolStart(rows, { agentId: 'a1', action: call('c2', T0 + 1), now: T0 + 1 })
    rows = applyToolEnd(rows, { agentId: 'a1', id: 'c1', status: 'ok', ms: 5, now: T0 + 5 })
    expect(row(rows, 'a1').current).toMatchObject({ id: 'c2', status: 'run' })
  })
})

describe('main', () => {
  test('turn start: thinking, counters reset; complete: idle with what it said last', () => {
    let rows = applyTurnStart([], { turn: 3, now: T0 })
    expect(row(rows, MAIN)).toMatchObject({ phase: 'thinking', turn: 3, steps: 0, tools: 0, startedAt: T0, endedAt: null })
    rows = applyToolStart(rows, { agentId: null, action: call('c1', T0 + 10), now: T0 + 10 })
    rows = applyComplete(rows, { agentId: null, reason: 'answer', answer: 'Готово. Утверждаешь дизайн?', tokens: 10, now: T0 + 5000 })
    expect(row(rows, MAIN)).toMatchObject({ phase: 'idle', endedAt: T0 + 5000, intent: 'Утверждаешь дизайн?', tools: 1 })
    rows = applyTurnStart(rows, { turn: 4, now: T0 + 9000 })
    expect(row(rows, MAIN)).toMatchObject({ phase: 'thinking', turn: 4, tools: 0, intent: null, current: null })
  })

  test('an interrupted main turn is aborted', () => {
    const rows = applyComplete(applyTurnStart([], { turn: 1, now: T0 }), { agentId: null, reason: 'aborted', answer: '', tokens: 0, now: T0 + 1 })
    expect(row(rows, MAIN).phase).toBe('aborted')
  })
})

describe('the engine list', () => {
  test('phaseFromList maps every status, and our own end knows more than a listed end', () => {
    expect(phaseFromList('pending', 'starting')).toBe('starting')
    expect(phaseFromList('pending', 'thinking')).toBe('thinking')
    expect(phaseFromList('running', 'acting')).toBe('acting')
    expect(phaseFromList('running', 'starting')).toBe('thinking')
    expect(phaseFromList('running', 'done')).toBe('thinking')
    expect(phaseFromList('waiting', 'thinking')).toBe('waiting')
    expect(phaseFromList('idle', 'thinking')).toBe('idle')
    expect(phaseFromList('completed', 'acting')).toBe('done')
    expect(phaseFromList('failed', 'acting')).toBe('failed')
    expect(phaseFromList('killed', 'acting')).toBe('aborted')
    expect(phaseFromList('completed', 'aborted')).toBe('aborted')
    expect(phaseFromList('mystery', 'thinking')).toBe('thinking')
  })

  test('an agent we never saw is added from the list; an ended one counts as earlier', () => {
    const rows = applyList(
      [],
      [
        { id: 'x1', type: 'Explore', description: 'find callers', status: 'running', isTeammate: false },
        { id: 'x0', type: 'Plan', description: 'old plan', status: 'completed', isTeammate: false },
        { id: 'x2', type: 'Explore', description: 'nested', status: 'running', parentId: 'x1', isTeammate: false },
      ],
      { turn: 2, now: T0 },
    )
    expect(row(rows, 'x1')).toMatchObject({ phase: 'thinking', parentId: MAIN, turn: 2, task: '', description: 'find callers' })
    expect(row(rows, 'x0')).toMatchObject({ phase: 'done', turn: -1, endedAt: T0 })
    expect(row(rows, 'x2').parentId).toBe('x1')
  })

  test('a listed status changes a known row and stamps its end once', () => {
    let rows = applySpawn([], facts())
    rows = applyList(rows, [{ id: 'a1', type: 'investigator', description: 'd', status: 'completed', isTeammate: false }], { turn: 1, now: T0 + 50 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'done', endedAt: T0 + 50 })
  })
})

describe('the tree', () => {
  test('children under their parent in spawn order, with connectors', () => {
    let rows = applyTurnStart([], { turn: 1, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'a1' }))
    rows = applySpawn(rows, facts({ agentId: 'a2', toolUseId: 'tu2', subagentType: 'Explore', parentAgentId: 'a1' }))
    rows = applySpawn(rows, facts({ agentId: 'a3', toolUseId: 'tu3', subagentType: 'coder' }))
    const tree = buildTree(rows, 1, T0)
    expect(tree.lines.map(l => `${l.lead}${l.row.id}`)).toEqual(['main', '├─a1', '│ └─a2', '└─a3'])
    expect(tree.lines.map(l => l.indent)).toEqual(['  ', '│   ', '│     ', '    '])
    expect(tree.lines.map(l => l.depth)).toEqual([0, 1, 2, 1])
    expect(tree.hidden).toBe(0)
  })

  test('an orphan hangs under main; a parent cycle is cut, no row is lost', () => {
    let rows = applySpawn([], facts({ agentId: 'o1', parentAgentId: 'ghost' }))
    rows = applySpawn(rows, facts({ agentId: 'c1', toolUseId: 'tu2', parentAgentId: 'c2' }))
    rows = applySpawn(rows, facts({ agentId: 'c2', toolUseId: 'tu3', parentAgentId: 'c1' }))
    const ids = buildTree(rows, 1, T0).lines.map(l => l.row.id)
    expect(ids.sort()).toEqual(['c1', 'c2', MAIN, 'o1'].sort())
  })

  test('ended agents of earlier turns fold into hidden; working ones and their parents always show', () => {
    let rows = applyTurnStart([], { turn: 1, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'old' }))
    rows = applyComplete(rows, { agentId: 'old', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'parent', toolUseId: 'tu2' }))
    rows = applySpawn(rows, facts({ agentId: 'child', toolUseId: 'tu3', parentAgentId: 'parent' }))
    rows = applyComplete(rows, { agentId: 'parent', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applyTurnStart(rows, { turn: 2, now: T0 + 10 })
    const tree = buildTree(rows, 2, T0 + 10)
    expect(tree.lines.map(l => l.row.id)).toEqual([MAIN, 'parent', 'child'])
    expect(tree.hidden).toBe(1)
  })
})

describe('limits and timers', () => {
  test('past MAX_AGENTS the oldest ended rows leave; main and working ones stay', () => {
    let rows: AgentRow[] = []
    for (let i = 0; i < MAX_AGENTS + 5; i += 1) {
      rows = applySpawn(rows, facts({ agentId: `a${i}`, toolUseId: `tu${i}` }))
      if (i >= 2) rows = applyComplete(rows, { agentId: `a${i}`, reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    }
    expect(rows.length).toBe(MAX_AGENTS)
    expect(rows.some(r => r.id === MAIN)).toBe(true)
    expect(rows.some(r => r.id === 'a0')).toBe(true)
    expect(rows.some(r => r.id === 'a2')).toBe(false)
  })

  test('clearEnded keeps main, working and idle rows', () => {
    let rows = applySpawn([], facts({ agentId: 'w' }))
    rows = applySpawn(rows, facts({ agentId: 'd', toolUseId: 'tu2' }))
    rows = applySpawn(rows, facts({ agentId: 't', toolUseId: 'tu3', isTeammate: true }))
    rows = applyComplete(rows, { agentId: 'd', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applyComplete(rows, { agentId: 't', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    expect(clearEnded(rows).map(r => r.id)).toEqual([MAIN, 'w', 't'])
  })

  test('silence: a working subagent past SILENT_MS without an event; never main, never a waiting one', () => {
    let rows = applyTurnStart([], { turn: 1, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'a1' }))
    rows = applySpawn(rows, facts({ agentId: 'a2', toolUseId: 'tu2' }))
    rows = applyList(rows, [{ id: 'a2', type: 'x', description: '', status: 'waiting', isTeammate: false }], { turn: 1, now: T0 })
    const later = T0 + SILENT_MS + 1
    expect(isSilent(row(rows, 'a1'), T0 + SILENT_MS)).toBe(false)
    expect(isSilent(row(rows, 'a1'), later)).toBe(true)
    expect(isSilent(row(rows, MAIN), later)).toBe(false)
    expect(isSilent(row(rows, 'a2'), later)).toBe(false)
  })

  test('ticks run only while something works and is not silent; the list is read only for working subagents', () => {
    const idle = applySpawn([], facts({ agentId: null }))
    expect(needsTick(idle, T0)).toBe(false)
    expect(needsReconcile(idle)).toBe(false)
    const thinking = applyTurnStart([], { turn: 1, now: T0 })
    expect(needsTick(thinking, T0)).toBe(true)
    expect(needsReconcile(thinking)).toBe(false)
    const sub = applySpawn([], facts())
    expect(needsReconcile(sub)).toBe(true)
    expect(needsTick(sub, T0 + SILENT_MS + 1)).toBe(false)
  })
})
