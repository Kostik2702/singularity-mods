import { expect, test } from 'claude-code/testing'

import { complete, engineBeneath, snapshot, spawn, submit } from './helpers'

const WHY = 'ПОЧЕМУ FABLE: решение необратимо\nВопрос: как делить схему?'
const DENIED_COUNCIL = 'Council запускается только командой владельца — попроси его'

// The kit's $.prompt.submit omits `command`; the engine sets it for a slash command, so the test passes it through.
async function submitCommand($: Parameters<typeof submit>[0], name: string): Promise<void> {
  await $.prompt.submit({ text: `/${name}`, wait: false, origin: { kind: 'composer' }, command: { name, args: '' } } as never)
}

test('a workflow agent asking for fable reaches the engine as opus', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'прогон')
  const res = await spawn($, { subagentType: 'coder', description: 'шаг', model: 'fable', workflow: 'wf_1' })
  expect(res.agentId).toBe('a1')
  expect(engine.reached.at(-1)?.model).toBe('opus')
})

test('a spawn the guard has no quarrel with reaches the engine unchanged', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'прогон')
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'sonnet' })
  await spawn($, { subagentType: 'coder', description: 'без модели' })
  expect(engine.reached.map(r => r.model)).toEqual(['sonnet', undefined])
})

test('fable outside advisor is denied, its row says why, and the engine is not reached', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'прогон')
  const res = await spawn($, { subagentType: 'coder', description: 'шаг', model: 'fable' })
  expect(res.deny).toBe('Fable только через advisor')
  expect(engine.reached).toHaveLength(0)
  const row = (await snapshot($)).agents.find(r => r.id.startsWith('denied:'))
  expect(row).toMatchObject({ phase: 'denied', report: 'Fable только через advisor', effort: null, oe: 0 })
})

test('an advisor with a reason passes until the cap, then the next one is denied', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  for (let i = 0; i < 3; i += 1) {
    const res = await spawn($, { subagentType: 'advisor', description: `совет ${i}`, model: 'fable', prompt: WHY })
    expect(res.deny).toBeUndefined()
  }
  const fourth = await spawn($, { subagentType: 'advisor', description: 'совет 4', model: 'fable', prompt: WHY })
  expect(fourth.deny).toContain('3/3')
  expect(engine.reached).toHaveLength(3)
})

test('council: a command opens the window, main’s turn.complete closes it', async ($, on) => {
  const engine = engineBeneath(on)
  const prompt = 'COUNCIL MISSION: оцени план'
  const before = await spawn($, { subagentType: 'critic', description: 'до', prompt })
  expect(before.deny).toBe(DENIED_COUNCIL)

  await submitCommand($, 'council')
  const inside = await spawn($, { subagentType: 'critic', description: 'внутри', prompt })
  expect(inside.deny).toBeUndefined()
  expect(engine.reached.at(-1)?.model).toBe('opus')

  await complete($, { answer: 'готово' })
  const after = await spawn($, { subagentType: 'critic', description: 'после', prompt })
  expect(after.deny).toBe(DENIED_COUNCIL)
})

test('a subagent’s turn.complete does not close the council window', async ($, on) => {
  engineBeneath(on)
  await submitCommand($, 'planning-council')
  await complete($, { agentId: 'a1', answer: 'член совета закончил' })
  const res = await spawn($, { subagentType: 'critic', description: 'второй', prompt: 'PLANNING MISSION: план' })
  expect(res.deny).toBeUndefined()
})

test('a guard that throws lets the spawn through and says so once', async ($, on) => {
  const engine = engineBeneath(on)
  // A prompt that is not a string makes the guard throw.
  for (let i = 0; i < 2; i += 1) {
    const res = await $.agent.spawn({
      tool_use_id: `tu-bad-${i}`,
      prompt: undefined as never,
      description: 'сломанный',
      subagentType: 'coder',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-test',
      background: false,
      fork: false,
    })
    expect(res.deny).toBeUndefined()
  }
  expect(engine.reached).toHaveLength(2)
})
