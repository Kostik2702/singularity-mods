import { expect, test } from 'claude-code/testing'

import { MAIN } from '../hooks/mission/model'
import { complete, engineBeneath, snapshot, spawn, step, submit, toolCall } from './helpers'

test('a subagent’s life reaches the rows through the engine’s events', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'найди баг')
  await $.turn.start({ text: 'найди баг', turnId: 't1' })
  const spawned = await spawn($, {
    subagentType: 'investigator',
    description: 'корень бага в parse.ts',
    prompt: 'Найди корень бага в parse.ts. Отчитайся.',
  })
  expect(spawned.agentId).toBe('a1')
  engine.say('Смотрю парсер. Сверяю вывод mb search с регэкспом.')
  await step($, 'a1')
  await toolCall($, { tool: 'Glob', pattern: '*.ts' }, 'a1')
  await complete($, { agentId: 'a1', answer: 'Корень: регэксп не ловит минус. Детали ниже.' })

  const s = await snapshot($)
  const a1 = s.agents.find(r => r.id === 'a1')
  expect(a1).toMatchObject({
    type: 'investigator',
    parentId: MAIN,
    turn: 1,
    phase: 'done',
    steps: 1,
    tools: 1,
    intent: 'Сверяю вывод mb search с регэкспом.',
    report: 'Корень: регэксп не ловит минус.',
    task: 'Найди корень бага в parse.ts. Отчитайся.',
    tokens: 330,
  })
  expect(a1?.current).toMatchObject({ done: 'нашёл файлы', target: '*.ts', status: 'ok' })
  expect(s.actions.at(-1)).toMatchObject({ agentId: 'a1', done: 'нашёл файлы', status: 'ok' })
  expect(s.agents.find(r => r.id === MAIN)).toMatchObject({ phase: 'thinking', turn: 1 })
})

// The order seen live: the subagent's first request streams before agent.spawn settles.
test('a subagent’s first step, raised before its spawn settles, still counts with its reason', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  engine.say('Ищу README. Начну с корня папки.')
  await step($, 'a1')
  await spawn($, { subagentType: 'Explore', description: 'найти README' })
  await toolCall($, { tool: 'Glob', pattern: 'README.md' }, 'a1')
  const a1 = (await snapshot($)).agents.find(r => r.id === 'a1')
  expect(a1).toMatchObject({ type: 'Explore', isConfirmed: true, steps: 1, tools: 1, intent: 'Начну с корня папки.', phase: 'acting' })
})

test('main: a turn thinks, a tool makes it act with the reason it gave, the end leaves it waiting', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  engine.say('Проверю типы. Читаю claude-code.d.ts.')
  await step($)
  await toolCall($, { tool: 'Read', file_path: 'C:/x/claude-code.d.ts' })
  let main = (await snapshot($)).agents.find(r => r.id === MAIN)
  expect(main).toMatchObject({ phase: 'acting', steps: 1, tools: 1, intent: 'Читаю claude-code.d.ts.' })
  expect(main?.current).toMatchObject({ done: 'прочитал', target: 'claude-code.d.ts', status: 'ok' })
  await complete($, { answer: 'Готово. Утверждаешь?' })
  main = (await snapshot($)).agents.find(r => r.id === MAIN)
  expect(main).toMatchObject({ phase: 'idle', intent: 'Утверждаешь?' })
})

test('a refused spawn, a nested spawn and the engine list', async ($, on) => {
  const engine = engineBeneath(on, { spawns: ['a1', { deny: 'coder is not allowed here' }, 'a2'] })
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  await spawn($, { subagentType: 'coder', description: 'правка' })
  await spawn($, { subagentType: 'Explore', description: 'поиск вызовов', parentAgentId: 'a1' })
  let s = await snapshot($)
  expect(s.agents.find(r => r.type === 'coder')).toMatchObject({ phase: 'denied', report: 'coder is not allowed here' })
  expect(s.agents.find(r => r.id === 'a2')).toMatchObject({ parentId: 'a1', phase: 'starting' })

  // session.start registers the timers (the kit's mock clock answers $.clock.every). Then the
  // list changes, and the 2 s reconcile — not the start's one-off read — must pick it up.
  await $.session.start({ cwd: 'E:/Project/singularity-mods', surface: 'terminal', isInteractive: true })
  engine.list([
    { id: 'a1', type: 'investigator', description: 'корень', status: 'completed' },
    { id: 'x9', type: 'Plan', description: 'план до загрузки мода', status: 'running' },
  ])
  s = await snapshot($)
  expect(s.agents.find(r => r.id === 'x9')).toBeUndefined()
  await engine.clock.advance(2000)
  s = await snapshot($)
  expect(s.agents.find(r => r.id === 'a1')?.phase).toBe('done')
  expect(s.agents.find(r => r.id === 'x9')).toMatchObject({ type: 'Plan', phase: 'thinking', description: 'план до загрузки мода' })
  expect(s.agentsPaneStatus).toBe('placed')
})

test('a failing tool is recorded as an error and its result passes through unchanged', async ($, on) => {
  engineBeneath(on)
  const ran = (await $.tool.call({ tool: 'Bash', command: 'false' } as never)) as unknown as { text?: string; isError?: boolean }
  expect(ran).toMatchObject({ text: 'boom', isError: true })
  const s = await snapshot($)
  expect(s.actions.at(-1)).toMatchObject({ status: 'error', agentId: null })
  expect(s.agents.find(r => r.id === MAIN)?.current).toMatchObject({ status: 'error' })
})
