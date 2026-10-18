import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, Lead } from '../types'
import { afterOwnerPrompt, markCouncilAgent } from '../hooks/lead/council'
import { EMPTY_LEAD } from '../hooks/lead/ledger'

const open = (o: Partial<Lead> = {}): Lead => ({ ...EMPTY_LEAD, councilTurn: 'council', ...o })
const row = (id: string, phase: AgentRow['phase']): AgentRow => ({ id, phase }) as AgentRow
const composer = { origin: 'composer', command: undefined } as const

describe('markCouncilAgent', () => {
  test('remembers the member while the window is open, once', () => {
    const once = markCouncilAgent(open(), 'a1')
    expect(once.councilAgents).toEqual(['a1'])
    expect(markCouncilAgent(once, 'a1')).toBe(once)
  })
  test('a closed window remembers nothing', () => {
    expect(markCouncilAgent(EMPTY_LEAD, 'a1')).toBe(EMPTY_LEAD)
  })
})

describe('afterOwnerPrompt', () => {
  test('the owner’s own non-council prompt closes the window and forgets the members', () => {
    for (const origin of ['composer', 'bridge']) {
      const out = afterOwnerPrompt(open({ councilAgents: ['a1'] }), [row('a1', 'done')], { origin, command: undefined })
      expect(out).toMatchObject({ councilTurn: null, councilAgents: [] })
    }
  })
  test('a slash command that is not a council command closes it too', () => {
    expect(afterOwnerPrompt(open(), [], { origin: 'composer', command: 'tdd' }).councilTurn).toBeNull()
  })
  test('a council command never closes it', () => {
    const l = open()
    for (const command of ['council', 'planning-council', 'observation-council']) {
      expect(afterOwnerPrompt(l, [], { origin: 'composer', command })).toBe(l)
    }
  })
  test('prompts of other origins never close it', () => {
    const l = open()
    for (const origin of ['task-notification', 'plugin', 'sdk', 'scheduled-trigger', 'peer', 'hook', 'unclassified']) {
      expect(afterOwnerPrompt(l, [], { origin, command: undefined })).toBe(l)
    }
  })
  test('stays open while a marked member is still working, in any working phase', () => {
    for (const phase of ['starting', 'thinking', 'acting', 'waiting'] as const) {
      const l = open({ councilAgents: ['a1'] })
      expect(afterOwnerPrompt(l, [row('a1', phase)], composer)).toBe(l)
    }
  })
  test('an executor that is not a council member does not hold it open', () => {
    const l = open({ councilAgents: ['a1'] })
    expect(afterOwnerPrompt(l, [row('a1', 'done'), row('a2', 'acting')], composer).councilTurn).toBeNull()
  })
  test('a member with no row any more does not hold it open', () => {
    expect(afterOwnerPrompt(open({ councilAgents: ['gone'] }), [], composer).councilTurn).toBeNull()
  })
  test('a closed window stays as it is', () => {
    expect(afterOwnerPrompt(EMPTY_LEAD, [], composer)).toBe(EMPTY_LEAD)
  })
  test('a ledger from before the field (no councilAgents) closes like an empty one', () => {
    const old: Lead = { ...EMPTY_LEAD, councilTurn: 'council' }
    delete (old as { councilAgents?: unknown }).councilAgents
    expect(afterOwnerPrompt(old, [], composer).councilTurn).toBeNull()
  })
})
