import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { JOURNAL_FILE, JOURNAL_PREV, ROTATE_BYTES, appendJournal, journalLine } from '../hooks/lead/journal'
import { complete, engineBeneath, fakeFs, snapshot, spawn, step, submit } from './helpers'

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

test('appends that overlap in time lose no line (the queue)', async () => {
  // A hand-made file system whose read yields, so a second append starts before the first has written.
  const files = new Map<string, string>([[FILE, '{"seed":1}\n']])
  const stub = {
    env: { get: async (name: string) => (name === 'CLAUDE_PLUGIN_DATA' ? DIR : undefined) },
    fs: {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => {
        const text = files.get(path) ?? ''
        for (let i = 0; i < 5; i += 1) await Promise.resolve()
        return text
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
    },
  }
  await Promise.all([1, 2, 3].map(n => appendJournal(stub as never, `{"n":${n}}`)))
  expect((files.get(FILE) ?? '').split('\n').filter(l => l.length > 0)).toHaveLength(4)
})

test('a resumed executor is journaled once per run: the second line holds only the second run', async ($, on) => {
  const fs = fakeFs(on)
  const engine = engineBeneath(on, { env: { CLAUDE_PLUGIN_DATA: DIR }, spawnModel: SONNET, spawns: ['a1', 'a1'] })
  const used = { model: SONNET, input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  await submit($, 'прогон')
  await spawn($, { subagentType: 'scout', description: 'найти' })
  engine.stepAnswer({ usage: used })
  await step($, 'a1')
  await engine.clock.advance(1000)
  await complete($, { agentId: 'a1', answer: 'готово.' })
  await engine.clock.advance(60_000)
  await spawn($, { subagentType: 'scout', description: 'найти ещё' })
  engine.stepAnswer({ usage: used })
  await step($, 'a1')
  engine.stepAnswer({ usage: used })
  await step($, 'a1')
  await engine.clock.advance(3000)
  await complete($, { agentId: 'a1', answer: 'готово снова.' })
  const lines = (fs.text(FILE) ?? '').split('\n').filter(l => l.length > 0).map(l => JSON.parse(l) as Record<string, number>)
  expect(lines).toHaveLength(2)
  expect(lines[0]).toMatchObject({ turns: 1, ms: 1000, oe: 1500 })
  expect(lines[1]).toMatchObject({ turns: 2, ms: 3000, oe: 3000 })
  const total = (await snapshot($)).agents.find(r => r.id === 'a1')?.oe
  expect((lines[0]?.oe ?? 0) + (lines[1]?.oe ?? 0)).toBe(total)
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
