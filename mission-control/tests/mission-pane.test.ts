import { expect, test } from 'claude-code/testing'

import { feedLabelWidth } from '../hooks/mission/pane'
import { complete, engineBeneath, mountAgents, runCommand, spawn, step, submit, toolCall } from './helpers'

const SURFACES = ['terminal', 'desktop'] as const

test('a working subagent shows its task, its reason and what it does now, on every surface', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень бага в parse.ts' })
  engine.say('Смотрю парсер. Сверяю вывод mb search с регэкспом.')
  await step($, 'a1')
  await toolCall($, { tool: 'Glob', pattern: '*.ts' }, 'a1')
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /◌ главный · ход 1/ })).toBeDefined()
    expect(await ui.find({ text: /└─● investigator · 0с · 1 шаг/ })).toBeDefined()
    expect(await ui.find({ text: /задача: корень бага в parse\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /зачем: «Сверяю вывод mb search с регэкспом\.»/ })).toBeDefined()
    expect(await ui.find({ text: /✓ нашёл файлы \*\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /↳investigator\s+✓ нашёл файлы \*\.ts/ })).toBeDefined()
    await ui.unmount()
  }
})

test('main thinking shows its time; ended, refused and nested agents read at a glance', async ($, on) => {
  const engine = engineBeneath(on, { spawns: ['a1', { deny: 'coder is not allowed here' }, 'a2'] })
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  await spawn($, { subagentType: 'coder', description: 'правка' })
  await spawn($, { subagentType: 'Explore', description: 'вызовы', parentAgentId: 'a1' })
  await complete($, { agentId: 'a1', answer: 'Корень: регэксп. Детали ниже.' })
  await engine.clock.advance(12_000)
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /◌ главный · ход 1 · 12с/ })).toBeDefined()
    expect(await ui.find({ text: /думает 12с/ })).toBeDefined()
    // Ended at the clock's start: 0 s, its tokens, then the report's first sentence.
    expect(await ui.find({ text: /✓ investigator · 0с · 330 ток\. — Корень: регэксп\./ })).toBeDefined()
    expect(await ui.find({ text: /⊘ coder · отклонён — coder is not allowed here/ })).toBeDefined()
    expect(await ui.find({ text: /│ └─◌ Explore/ })).toBeDefined()
    await ui.unmount()
  }
})

test('main idle waits for the person and says what it answered', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  engine.say('Готово. Утверждаешь дизайн?')
  await step($)
  await complete($, { answer: 'Готово. Утверждаешь дизайн?' })
  await engine.clock.advance(65_000)
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /○ главный · ход 1 · ждёт тебя · 1м05с/ })).toBeDefined()
  expect(await ui.find({ text: /итог: «Утверждаешь дизайн\?»/ })).toBeDefined()
  await ui.unmount()
})

test('the agent whose transcript is open is marked ▶', async ($, on) => {
  engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  const ui = await mountAgents($, 'terminal', { viewAgentId: 'a1' })
  expect(await ui.find({ text: /▶◌ investigator/ })).toBeDefined()
  await ui.unmount()
})

test('a silent subagent reads "no news" after five minutes', async ($, on) => {
  const engine = engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  await step($, 'a1')
  await engine.clock.advance(6 * 60_000)
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /\? investigator · 6м00с · 1 шаг · нет вестей 6м00с/ })).toBeDefined()
  await ui.unmount()
})

test('ended agents of earlier turns fold into one line', async ($, on) => {
  engineBeneath(on)
  await submit($, 'one')
  await $.turn.start({ text: 'one', turnId: 't1' })
  await spawn($, { subagentType: 'Explore', description: 'старое' })
  await complete($, { agentId: 'a1', answer: 'ok' })
  await submit($, 'two')
  await $.turn.start({ text: 'two', turnId: 't2' })
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /… ещё 1 завершённый раньше/ })).toBeDefined()
  expect(await ui.find({ text: /Explore · / })).toBeUndefined()
  await ui.unmount()
})

test('an unknown loop’s call is labelled ↳фон in the feed', async ($, on) => {
  engineBeneath(on)
  await toolCall($, { tool: 'Glob', pattern: '*.md' }, 'compact-fork')
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /↳фон\s+✓ нашёл файлы \*\.md/ })).toBeDefined()
  await ui.unmount()
})

test('six working agents, nested, all visible', async ($, on) => {
  engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  const tree: readonly (readonly [string, string | undefined])[] = [
    ['A1', undefined],
    ['B2', undefined],
    ['C3', 'a1'],
    ['D4', 'a1'],
    ['E5', 'a3'],
    ['F6', undefined],
  ]
  for (const [type, parent] of tree) {
    await spawn($, { subagentType: type, description: `задача ${type}`, ...(parent === undefined ? {} : { parentAgentId: parent }) })
  }
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface, { rows: 40 })
    for (const [type] of tree) expect(await ui.find({ text: new RegExp(`◌ ${type}`) })).toBeDefined()
    expect(await ui.find({ text: /Лента/ })).toBeDefined()
    await ui.unmount()
  }
})

// Review #4: the reason wraps under its label, but never past two lines of the column.
test('a long reason is cut to two lines of a narrow column', async ($, on) => {
  const engine = engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  engine.say(`Причина: ${'очень длинное объяснение того, что агент делает дальше '.repeat(4)}конец.`)
  await step($, 'a1')
  const ui = await mountAgents($, 'terminal', { cols: 30, rows: 20 })
  const why = await ui.find({ text: /зачем: «/ })
  expect(why).toBeDefined()
  const said = /«(.*)»/.exec(why?.text ?? '')?.[1] ?? ''
  // 30 columns: inner 28, indent 4, "зачем: " 7, the quotes 2 → 15 a line, 30 for two lines.
  expect([...said].length).toBeLessThanOrEqual(30)
  expect(said.endsWith('…')).toBe(true)
  await ui.unmount()
})

test('the feed label never takes more than a third of the column', () => {
  expect(feedLabelWidth(['↳investigator-with-a-long-name'], 28)).toBe(9)
  expect(feedLabelWidth(['главный'], 120)).toBe(7)
  expect(feedLabelWidth(['↳investigator'], 120)).toBe(13)
})

test('a 30-column dock still draws every agent', async ($, on) => {
  engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'очень длинное описание задачи, которое не влезет в узкую колонку' })
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface, { cols: 30, rows: 20 })
    expect(await ui.find({ text: /investigator/ })).toBeDefined()
    expect(await ui.find({ text: /главный/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/mc clear drops ended agents and earlier feed; /mc with an unknown word explains itself', async ($, on) => {
  engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'Explore', description: 'старое' })
  await spawn($, { subagentType: 'investigator', description: 'идёт' })
  await complete($, { agentId: 'a1', answer: 'ok' })
  expect(await runCommand($, 'mc', 'clear')).toMatch(/убраны/)
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /Explore/ })).toBeUndefined()
  expect(await ui.find({ text: /investigator/ })).toBeDefined()
  await ui.unmount()
  expect(await runCommand($, 'mc', 'foo')).toMatch(/не знаю «foo»/)
  expect(await runCommand($, 'mc', '')).toMatch(/открыта/)
})
