import { expect, test } from 'claude-code/testing'

import { TEAM_TOOL } from '../hooks/lead/team'
import { complete, engineBeneath, runCommand, spawn, step, submit } from './helpers'

const SESSION = { cwd: '/home/magos/forge', surface: 'terminal' as const, isInteractive: true }
const SONNET = 'claude-sonnet-5-5'
// 1000 input + 400 output tokens on sonnet: (1000 x 2 + 400 x 10) / 4 = 1500 OE.
const used = (model: string) => ({
  model,
  input_tokens: 1000,
  output_tokens: 400,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
})
const BLOCK_HALT = '[mission-control] остановлен до запроса: заморожено владельцем'
const BAD_INCREMENT = 'mission-control: /mc budget +N — N целое больше нуля'
const NO_LIMIT = 'mission-control: лимит сессии не задан — добавлять не к чему (задай sessionBudgetOE)'

/** The `team` tool's text, read through the engine. */
async function team($: Parameters<typeof submit>[0]): Promise<string> {
  const answer = (await $.tool.call({ tool: TEAM_TOOL } as never)) as unknown as { result?: unknown }
  return String(answer.result)
}

const newsOf = (text: string): string[] => {
  const at = text.indexOf('новости:')
  if (at < 0) return []
  return text
    .slice(at)
    .split('\n')
    .slice(1)
    .filter(line => line.length > 0 && !line.startsWith('флаги:'))
}

test('the tool has a stable name', () => {
  expect(TEAM_TOOL).toBe('mcp__mission-control__team')
})

test('team lists tier, effort and OE', { options: { sessionBudgetOE: '10000', agentBudgetOE: '5000' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'разобрать парсер', model: 'sonnet', workflow: 'wf_1' })
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET, effort: 'high' })
  const text = await team($)
  const header = text.split('\n')[0] ?? ''
  expect(header).toContain('наблюдение')
  expect(header).toContain('сессия 1500/10000 OE')
  expect(header).toContain('Fable 0/3')
  const line = text.split('\n').find(l => l.startsWith('a1')) ?? ''
  expect(line.split(' · ')).toEqual(['a1', 'sonnet', 'medium', 'Задача: разобрать парсер.', '1', '1500/5000', 'думает'])
  expect(text).toContain('флаги:')
  expect(text).not.toContain(' ')
})

test('without limits the table shows no slash', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'sonnet' })
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET })
  const text = await team($)
  expect(text.split('\n')[0]).toContain('сессия 1500 OE')
  expect(text.split('\n')[0]).not.toMatch(/\d\/\d+ OE/)
  const line = text.split('\n').find(l => l.startsWith('a1')) ?? ''
  expect(line).toContain(' · 1500 · ')
})

test('a long task is cut to 60 characters', async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг', prompt: `${'я'.repeat(100)}.` })
  const line = (await team($)).split('\n').find(l => l.startsWith('a1')) ?? ''
  const task = line.split(' · ')[3] ?? ''
  expect(Array.from(task).length).toBeLessThanOrEqual(60)
  expect(task.endsWith('…')).toBe(true)
})

test('team is read-only: news stays until the digest takes it', async ($, on) => {
  engineBeneath(on)
  await $.session.start(SESSION)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'coder', description: 'форк', fork: true })
  expect(newsOf(await team($)).join('\n')).toContain('форк')
  expect(newsOf(await team($)).join('\n')).toContain('форк')
  const batch = await $.classic.PostToolBatch({ tool_calls: [] })
  expect(batch.additionalContext?.join('\n')).toContain('форк')
  expect(newsOf(await team($))).toEqual([])
})

test('a fable spawn rewritten in a workflow appears in news', async ($, on) => {
  engineBeneath(on)
  await submit($, 'прогон')
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'fable', workflow: 'wf_1' })
  expect(newsOf(await team($))).toContain('Fable в workflow → opus')
})

test('the guard-error line appears exactly once', async ($, on) => {
  engineBeneath(on)
  await submit($, 'прогон')
  for (let i = 0; i < 2; i += 1) {
    await $.agent.spawn({
      tool_use_id: `tu-bad-${i}`,
      prompt: 'Задача.',
      // A model that is not a string makes the guard throw.
      model: 5 as never,
      description: 'сломанный',
      subagentType: 'coder',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-test',
      background: false,
      fork: false,
    })
  }
  const text = await team($)
  const lines = newsOf(text).filter(l => l.startsWith('ограждение упало'))
  expect(lines).toHaveLength(1)
  expect(lines[0]).not.toContain('×')
  expect(text).toContain('guard-error')
})

test('budget +500 raises the limit', { options: { sessionBudgetOE: '1000' } }, async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  expect(await runCommand($, 'mc', 'budget +500')).toBe('mission-control: лимит сессии: 1500 OE (+500)')
  expect((await team($)).split('\n')[0]).toContain('сессия 0/1500 OE')
  expect(await runCommand($, 'mc', 'budget +500')).toContain('2000 OE')
  expect((await team($)).split('\n')[0]).toContain('0/2000 OE')
})

test('budget +N without a session limit changes nothing', async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  expect(await runCommand($, 'mc', 'budget +500')).toBe(NO_LIMIT)
  const header = (await team($)).split('\n')[0] ?? ''
  expect(header).not.toContain('500')
  expect(header).not.toMatch(/\d\/\d+ OE/)
})

test('bad budget increment is refused', { options: { sessionBudgetOE: '1000' } }, async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  for (const arg of ['budget +abc', 'budget +0', 'budget 5', 'budget +1.5', 'budget -5', 'budget +', 'budget +5 +5']) {
    expect(await runCommand($, 'mc', arg)).toBe(BAD_INCREMENT)
  }
  expect((await team($)).split('\n')[0]).toContain('0/1000 OE')
})

test('plain /mc budget answers with the table', { options: { sessionBudgetOE: '1000' } }, async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  const text = await runCommand($, 'mc', 'budget')
  expect(text).toContain('сессия 0/1000 OE')
  expect(text).toContain('Fable 0/3')
})

test('budget +N drops the flags the new limit no longer justifies', { options: { sessionBudgetOE: '1000' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(SESSION)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'sonnet' })
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET })
  // 1500 of 1000: exhausted, the digest says so once and settles both flags.
  const first = await $.classic.PostToolBatch({ tool_calls: [] })
  expect(first.additionalContext?.join('\n')).toContain('бюджет сессии исчерпан')
  expect(await team($)).toMatch(/флаги:.*budget100/)

  // 1500 of 1600: not exhausted, but still at 80 %: only budget100 goes.
  await runCommand($, 'mc', 'budget +600')
  const mid = await team($)
  expect(mid).toMatch(/флаги:.*budget80/)
  expect(mid).not.toMatch(/флаги:.*budget100/)

  // 1500 of 4000: under 80 %: budget80 goes too.
  await runCommand($, 'mc', 'budget +2400')
  const low = await team($)
  expect(low).not.toMatch(/флаги:.*budget80/)
  expect(low).not.toMatch(/флаги:.*budget100/)

  // Crossing again is announced again.
  engine.stepAnswer({ usage: used(SONNET) })
  engine.stepAnswer({ usage: used(SONNET) })
  engine.stepAnswer({ usage: used(SONNET) })
  await step($, 'a1', { model: SONNET })
  await step($, 'a1', { model: SONNET })
  await step($, 'a1', { model: SONNET })
  const again = await $.classic.PostToolBatch({ tool_calls: [] })
  expect(again.additionalContext?.join('\n')).toContain('бюджет сессии исчерпан')
})

test('halt freezes, resume releases', { options: { budgetMode: 'enforce' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'sonnet' })
  expect(await runCommand($, 'mc', 'halt')).toContain('остановлены')
  expect(newsOf(await team($))).toContain('владелец остановил исполнителей')
  expect(await team($)).toContain('заморозка')
  const blocked = await step($, 'a1', { model: SONNET })
  expect(blocked.answer).toBe(BLOCK_HALT)
  // main is never frozen
  const main = await step($, undefined, { model: SONNET })
  expect(main.answer).not.toBe(BLOCK_HALT)
  expect(engine.stepsReached.map(s => s.agentId)).toEqual([undefined])

  expect(await runCommand($, 'mc', 'resume')).toContain('снята')
  expect(newsOf(await team($))).toContain('владелец снял заморозку')
  expect(await team($)).not.toContain('заморозка')
  const passed = await step($, 'a1', { model: SONNET })
  expect(passed.answer).not.toBe(BLOCK_HALT)
  expect(engine.stepsReached.map(s => s.agentId)).toEqual([undefined, 'a1'])
})

test('halt freezes in observe mode too: steps blocked, spawns denied, resume releases both', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'sonnet' })
  const said = await runCommand($, 'mc', 'halt')
  expect(said).not.toContain('наблюдени')
  expect((await step($, 'a1', { model: SONNET })).answer).toBe(BLOCK_HALT)
  const denied = await spawn($, { subagentType: 'coder', description: 'ещё', model: 'sonnet' })
  expect(denied.deny).toBe('заморожено владельцем — остановись и спроси владельца')
  expect((await step($, undefined, { model: SONNET })).answer).not.toBe(BLOCK_HALT)
  expect(engine.stepsReached.map(s => s.agentId)).toEqual([undefined])

  await runCommand($, 'mc', 'resume')
  expect((await step($, 'a1', { model: SONNET })).answer).not.toBe(BLOCK_HALT)
  expect((await spawn($, { subagentType: 'coder', description: 'ещё', model: 'sonnet' })).deny).toBeUndefined()
})

test('halt and resume are idempotent: no repeated news, resume when not frozen says so', async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  expect(await runCommand($, 'mc', 'resume')).toBe('mission-control: исполнители не заморожены')
  expect(newsOf(await team($))).toEqual([])
  await runCommand($, 'mc', 'halt')
  await runCommand($, 'mc', 'halt')
  expect(newsOf(await team($))).toEqual(['владелец остановил исполнителей'])
  await runCommand($, 'mc', 'resume')
  expect(newsOf(await team($))).toEqual(['владелец остановил исполнителей', 'владелец снял заморозку'])
})

test('solo reaches the next digest once', async ($, on) => {
  engineBeneath(on)
  await $.session.start(SESSION)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await runCommand($, 'mc', 'solo')).toContain('solo')
  expect(await team($)).toMatch(/флаги:.*solo/)
  const first = await $.classic.PostToolBatch({ tool_calls: [] })
  expect(first.additionalContext?.join('\n')).toContain('владелец: дальше делай сам, не делегируй')
  const second = await $.classic.PostToolBatch({ tool_calls: [] })
  expect(second.additionalContext).toBeUndefined()
  expect(await team($)).not.toMatch(/флаги:.*solo/)
})

test('an ended agent stays in the table, denied rows and main do not', async ($, on) => {
  engineBeneath(on)
  await submit($, 'вопрос')
  await spawn($, { subagentType: 'coder', description: 'готовый', model: 'sonnet' })
  await complete($, { agentId: 'a1', answer: 'Готово.' })
  await spawn($, { subagentType: 'coder', description: 'отказ', model: 'fable' })
  const lines = (await team($)).split('\n')
  expect(lines.some(l => l.startsWith('a1') && l.endsWith('готов'))).toBe(true)
  expect(lines.some(l => l.startsWith('main'))).toBe(false)
  expect(lines.some(l => l.startsWith('denied:'))).toBe(false)
})

test('unknown words after /mc name the new commands', async ($, on) => {
  engineBeneath(on)
  const text = await runCommand($, 'mc', 'foo')
  for (const word of ['budget', 'halt', 'resume', 'solo']) expect(text).toContain(word)
})
