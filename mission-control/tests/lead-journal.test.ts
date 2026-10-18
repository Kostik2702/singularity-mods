import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { JOURNAL_FILE, JOURNAL_PREV, ROTATE_BYTES, journalLine } from '../hooks/lead/journal'
import { complete, engineBeneath, fakeFs, spawn, step, submit } from './helpers'

const SONNET = 'claude-sonnet-5-5'
const DIR = '/data/mc'
const FILE = `${DIR}/${JOURNAL_FILE}`
const PREV = `${DIR}/${JOURNAL_PREV}`

const row = (o: Partial<AgentRow> = {}): AgentRow =>
  ({
    id: 'a1',
    parentId: 'main',
    turn: 1,
    type: 'scout',
    name: null,
    description: 'найти',
    task: 'найди',
    model: SONNET,
    requestedModel: null,
    isBackground: false,
    isTeammate: false,
    workflowRunId: null,
    phase: 'done',
    phaseAt: 5000,
    startedAt: 1000,
    endedAt: 5000,
    lastEventAt: 5000,
    steps: 7,
    tools: 3,
    intent: null,
    current: null,
    report: null,
    tokens: 100,
    effort: 'medium',
    oe: 1500,
    toolUseId: null,
    ...o,
  }) as AgentRow

describe('journal line', () => {
  test('journal line is one JSON object with the eight fields', () => {
    const line = journalLine(row())
    expect(line.includes('\n')).toBe(false)
    const o = JSON.parse(line) as Record<string, unknown>
    expect(Object.keys(o)).toEqual(['ts', 'type', 'tier', 'effort', 'turns', 'oe', 'ms', 'outcome'])
    expect(o).toEqual({ ts: 5000, type: 'scout', tier: 'sonnet', effort: 'medium', turns: 7, oe: 1500, ms: 4000, outcome: 'done' })
  })
  test('an unknown model is tier ?, no effort is null, a failed end says so', () => {
    const o = JSON.parse(journalLine(row({ model: 'claude-test', effort: null, phase: 'failed' }))) as Record<string, unknown>
    expect(o).toMatchObject({ tier: '?', effort: null, outcome: 'failed' })
  })
  test('a row with no end counts its time to the last event', () => {
    const o = JSON.parse(journalLine(row({ endedAt: null, lastEventAt: 3000 }))) as Record<string, unknown>
    expect(o).toMatchObject({ ts: 3000, ms: 2000 })
  })
})

async function endOne($: Parameters<typeof submit>[0], agentId: string): Promise<void> {
  await step($, agentId)
  await complete($, { agentId, answer: 'готово.' })
}

test('a subagent’s end appends one line to the data directory', async ($, on) => {
  const fs = fakeFs(on)
  engineBeneath(on, { env: { CLAUDE_PLUGIN_DATA: DIR }, spawnModel: SONNET })
  await submit($, 'прогон')
  await spawn($, { subagentType: 'scout', description: 'найти', model: 'sonnet' })
  await endOne($, 'a1')
  const lines = (fs.text(FILE) ?? '').split('\n').filter(l => l.length > 0)
  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0] ?? '')).toMatchObject({ type: 'scout', tier: 'sonnet', outcome: 'done' })
})

test('the main loop’s end is not journaled', async ($, on) => {
  const fs = fakeFs(on)
  engineBeneath(on, { env: { CLAUDE_PLUGIN_DATA: DIR } })
  await submit($, 'прогон')
  await complete($, { answer: 'готово.' })
  expect(fs.text(FILE)).toBeUndefined()
})

test('without CLAUDE_PLUGIN_DATA the file lives under the config directory’s plugins/data', async ($, on) => {
  const fs = fakeFs(on)
  engineBeneath(on, { env: { HOME: '/home/magos' } })
  await submit($, 'прогон')
  await spawn($, { subagentType: 'scout', description: 'найти' })
  await endOne($, 'a1')
  expect(fs.text(`/home/magos/.claude/plugins/data/mission-control/${JOURNAL_FILE}`)).toContain('"type":"scout"')
})

test('lines accumulate, and two ends at once lose neither', async ($, on) => {
  const fs = fakeFs(on)
  engineBeneath(on, { env: { CLAUDE_PLUGIN_DATA: DIR } })
  await submit($, 'прогон')
  await spawn($, { subagentType: 'scout', description: 'один' })
  await spawn($, { subagentType: 'scout', description: 'два' })
  await Promise.all([endOne($, 'a1'), endOne($, 'a2')])
  expect((fs.text(FILE) ?? '').split('\n').filter(l => l.length > 0)).toHaveLength(2)
})

test('a write failure is swallowed: the end still lands on the row', async ($, on) => {
  fakeFs(on, { failWrite: true })
  engineBeneath(on, { env: { CLAUDE_PLUGIN_DATA: DIR } })
  await submit($, 'прогон')
  await spawn($, { subagentType: 'scout', description: 'найти' })
  await endOne($, 'a1')
  const answer = (await $.tool.call({ tool: 'mcp__mission-control__snapshot' } as never)) as unknown as { result?: unknown }
  const agents = (JSON.parse(String(answer.result)) as { agents: AgentRow[] }).agents
  expect(agents.find(r => r.id === 'a1')?.phase).toBe('done')
})

test('a full file moves to the previous name and the new line starts a fresh one', async ($, on) => {
  const fs = fakeFs(on)
  engineBeneath(on, { env: { CLAUDE_PLUGIN_DATA: DIR } })
  const old = 'x'.repeat(ROTATE_BYTES + 1)
  fs.write(FILE, old)
  fs.write(PREV, 'older')
  await submit($, 'прогон')
  await spawn($, { subagentType: 'scout', description: 'найти' })
  await endOne($, 'a1')
  // A boolean, not the text: a failing comparison would print 3 MiB.
  expect(fs.text(PREV) === old).toBe(true)
  expect((fs.text(FILE) ?? '').split('\n').filter(l => l.length > 0)).toHaveLength(1)
})
