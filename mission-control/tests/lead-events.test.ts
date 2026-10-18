import { expect, test } from 'claude-code/testing'

import { complete, engineBeneath, snapshot, spawn, step, submit } from './helpers'

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

test('a bare advisor with a reason counts toward the cap, a fourth is denied', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  for (let i = 0; i < 3; i += 1) {
    expect((await spawn($, { subagentType: 'advisor', description: `совет ${i}`, prompt: WHY })).deny).toBeUndefined()
  }
  expect((await spawn($, { subagentType: 'advisor', description: 'совет 4', prompt: WHY })).deny).toContain('3/3')
  expect(engine.reached).toHaveLength(3)
})

test('an advisor on an explicit sonnet and one rewritten to opus do not use the cap', async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  for (let i = 0; i < 2; i += 1) await spawn($, { subagentType: 'advisor', description: 'дешёвый', model: 'sonnet', prompt: 'Вопрос?' })
  for (let i = 0; i < 2; i += 1) await spawn($, { subagentType: 'advisor', description: 'в workflow', prompt: 'Вопрос?', workflow: 'wf_1' })
  for (let i = 0; i < 3; i += 1) {
    expect((await spawn($, { subagentType: 'advisor', description: `совет ${i}`, prompt: WHY })).deny).toBeUndefined()
  }
})

test('a deny stays a deny when the bookkeeping after it throws', async ($, on) => {
  const brokenClock = { down: false }
  const engine = engineBeneath(on, { brokenClock })
  await submit($, 'прогон')
  // Every later clock read fails: the row of the refusal cannot be written.
  brokenClock.down = true
  const res = await spawn($, { subagentType: 'coder', description: 'шаг', model: 'fable' })
  expect(res.deny).toBe('Fable только через advisor')
  expect(engine.reached).toHaveLength(0)
})

test('a refused /council submit does not open the window', async ($, on) => {
  const engine = engineBeneath(on, { refuseSubmit: true })
  await submitCommand($, 'council')
  const res = await spawn($, { subagentType: 'critic', description: 'член', prompt: 'COUNCIL MISSION: оцени' })
  expect(res.deny).toBe(DENIED_COUNCIL)
  expect(engine.reached).toHaveLength(0)
})

const SONNET = 'claude-sonnet-5-5'
const FABLE = 'claude-fable-5-1'
// 1000 input + 400 output tokens: sonnet (1000 x 2 + 400 x 10) / 4 = 1500 OE, fable (1000 x 10 + 400 x 50) / 4 = 7500 OE.
const used = (model: string) => ({
  model,
  input_tokens: 1000,
  output_tokens: 400,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
})
const BLOCK_BUDGET = '[mission-control] остановлен до запроса: бюджет исчерпан'
const ENFORCE = { budgetMode: 'enforce' }

const rowOf = async ($: Parameters<typeof snapshot>[0], id: string) => (await snapshot($)).agents.find(r => r.id === id)

test('main is never blocked, even with the session budget gone', { options: { ...ENFORCE, sessionBudgetOE: '1000' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, undefined, { model: SONNET })
  const second = await step($, undefined, { model: SONNET })
  expect(engine.stepsReached).toHaveLength(2)
  expect(second.answer).not.toBe(BLOCK_BUDGET)
  expect(engine.stepsReached.at(-1)?.effort).toBeUndefined()
})

test('spent subagent is blocked before the request', { options: { ...ENFORCE, agentBudgetOE: '1000' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  engine.stepAnswer({ usage: used(SONNET) })
  const first = await step($, 'a1', { model: SONNET })
  expect(first.usage).toMatchObject({ input_tokens: 1000 })
  expect(engine.stepsReached).toHaveLength(1)

  for (let i = 0; i < 2; i += 1) {
    const blocked = await step($, 'a1', { model: SONNET })
    expect(blocked.answer).toBe(BLOCK_BUDGET)
    expect(blocked.toolUses).toEqual([])
    expect(blocked.usage).toBeNull()
  }
  expect(engine.stepsReached).toHaveLength(1)

  // The budget is per agent: another agent is not spent.
  await spawn($, { subagentType: 'coder', description: 'другой' })
  await step($, 'a2', { model: SONNET })
  expect(engine.stepsReached).toHaveLength(2)
})

test('a spent run blocks its other agents too', { options: { ...ENFORCE, runBudgetOE: '1000' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'раз', workflow: 'wf_1' })
  await spawn($, { subagentType: 'coder', description: 'два', workflow: 'wf_1' })
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET })
  expect((await step($, 'a2', { model: SONNET })).answer).toBe(BLOCK_BUDGET)
  expect(engine.stepsReached).toHaveLength(1)
})

test('observe never blocks on numbers', { options: { agentBudgetOE: '1', sessionBudgetOE: '1' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET })
  const second = await step($, 'a1', { model: SONNET })
  expect(second.answer).not.toBe(BLOCK_BUDGET)
  expect(engine.stepsReached).toHaveLength(2)
})

test('workflow sonnet agent gets medium effort; an effort already set and an Agent call are left alone', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'прогон')
  await spawn($, { subagentType: 'coder', description: 'в workflow', model: 'sonnet', workflow: 'wf_1' })
  await spawn($, { subagentType: 'coder', description: 'через Agent', model: 'sonnet' })

  await step($, 'a1', { model: SONNET })
  expect(engine.stepsReached.at(-1)?.effort).toBe('medium')
  expect((await rowOf($, 'a1'))?.effort).toBe('medium')

  await step($, 'a1', { model: SONNET, effort: 'xhigh' })
  expect(engine.stepsReached.at(-1)?.effort).toBe('xhigh')
  expect((await rowOf($, 'a1'))?.effort).toBe('xhigh')

  await step($, 'a2', { model: SONNET })
  expect(engine.stepsReached.at(-1)?.effort).toBeUndefined()
  expect((await rowOf($, 'a2'))?.effort).toBeNull()
})

test('a step’s usage lands in the row as OE', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  engine.stepAnswer({ usage: used(SONNET) })
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET })
  expect(await rowOf($, 'a1')).toMatchObject({ oe: 1500, model: SONNET })
  await step($, 'a1', { model: SONNET })
  expect((await rowOf($, 'a1'))?.oe).toBe(3000)
})

test('usage without a model is priced by the request model', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  engine.stepAnswer({ usage: { ...used(SONNET), model: undefined } as never })
  await step($, 'a1', { model: SONNET })
  expect((await rowOf($, 'a1'))?.oe).toBe(1500)
})

test('an unknown model is priced as fable', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  engine.stepAnswer({ usage: used('claude-test') })
  await step($, 'a1', { model: 'claude-test' })
  expect((await rowOf($, 'a1'))?.oe).toBe(7500)
})

test('main’s own requests are credited on the main row', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, undefined, { model: SONNET })
  expect(await rowOf($, 'main')).toMatchObject({ oe: 1500, model: SONNET })
})

test('forced model is reported: the row shows the model that answered', async ($, on) => {
  const engine = engineBeneath(on, { spawnModel: 'haiku' })
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'haiku' })
  expect((await rowOf($, 'a1'))?.model).toBe('haiku')
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: 'haiku' })
  expect((await rowOf($, 'a1'))?.model).toBe(SONNET)
})

test('fable lead is toasted once', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await step($, undefined, { model: FABLE })
  await step($, undefined, { model: FABLE })
  expect(engine.toasts).toEqual(['лид на Fable — всё без явной модели унаследовало бы Fable'])
  // The lead's request goes out as it was.
  expect(engine.stepsReached.map(s => s.model)).toEqual([FABLE, FABLE])
})

test('a lead on another model, and a subagent on fable, are not toasted', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'advisor', description: 'совет', prompt: WHY })
  await step($, undefined, { model: SONNET })
  await step($, 'a1', { model: FABLE })
  expect(engine.toasts).toEqual([])
})

test('an advisor call and other server tools pass through the step result untouched', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  const serverToolUses = [
    { id: 's1', name: 'advisor', input: {}, startedAt: 1, endedAt: 2 },
    { id: 's2', name: 'web_search', input: {}, startedAt: 2, endedAt: 3 },
  ]
  engine.stepAnswer({ usage: used(SONNET), serverToolUses })
  const res = await step($, 'a1', { model: SONNET })
  expect(res.serverToolUses).toEqual(serverToolUses)
  expect((await rowOf($, 'a1'))?.oe).toBe(1500)
})

test('a thrown accounting error leaves the step result intact and later steps working', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  // A model that is not a string makes the pricing throw.
  const bad = { ...used(SONNET), model: 5 } as never
  engine.stepAnswer({ usage: bad })
  engine.say('Сделал. Готово.')
  const res = await step($, 'a1', { model: SONNET })
  expect(res.answer).toBe('Сделал. Готово.')
  expect(res.usage).toEqual(bad)
  expect((await rowOf($, 'a1'))?.steps).toBe(1)
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET })
  expect(engine.stepsReached).toHaveLength(2)
  expect((await rowOf($, 'a1'))?.oe).toBe(1500)
})

test('existing observer behaviour: phases and the answer sentence are unchanged', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг' })
  engine.say('Смотрю парсер. Сверяю вывод.')
  await step($, 'a1')
  expect(await rowOf($, 'a1')).toMatchObject({ phase: 'thinking', steps: 1, intent: 'Сверяю вывод.' })
})

test('a stale deny does not touch a later spawn with the same tool_use_id', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'прогон')
  const call = (model: string) =>
    $.agent.spawn({
      tool_use_id: 'tu-shared',
      prompt: 'Задача.',
      description: 'общий вызов',
      subagentType: 'coder',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-test',
      background: false,
      fork: false,
      model,
    })
  expect((await call('fable')).deny).toBe('Fable только через advisor')
  const later = await call('sonnet')
  expect(later.deny).toBeUndefined()
  expect(later.agentId).toBe('a1')
  expect(engine.reached).toHaveLength(1)
})
