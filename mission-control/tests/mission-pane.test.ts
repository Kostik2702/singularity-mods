import { describe, expect, test } from 'claude-code/testing'

import { feedLabelWidth, wrapTwo } from '../hooks/mission/pane'
import { screen } from './paint'
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
    // A no-break space after the label: the terminal trims a plain one at the end of a flex
    // child, and the live screen read "зачем:«…" (seen 2026-10-11 in a PTY).
    expect(await ui.find({ text: /зачем: «Сверяю вывод mb search с регэкспом\.»/ })).toBeDefined()
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
    expect(await ui.find({ text: /✓ investigator · 0с · 30 ток\. — Корень: регэксп\./ })).toBeDefined()
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
  expect(await ui.find({ text: /итог: «Утверждаешь дизайн\?»/ })).toBeDefined()
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

test('ended agents of earlier turns fold into one line once their reports are stale', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'one')
  await $.turn.start({ text: 'one', turnId: 't1' })
  await spawn($, { subagentType: 'Explore', description: 'старое' })
  await complete($, { agentId: 'a1', answer: 'ok' })
  await engine.clock.advance(11 * 60_000)
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

// Review #4, then seen live: Ink's word wrap overran a "2 × width" budget (3 lines). The reason
// is laid out by wrapTwo into at most two lines, each drawn as its own unwrapped line.
test('a long reason is cut to two lines of a narrow column', async ($, on) => {
  const engine = engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  engine.say(`Причина: ${'очень длинное объяснение того, что агент делает дальше '.repeat(4)}конец.`)
  await step($, 'a1')
  const ui = await mountAgents($, 'terminal', { cols: 30, rows: 20 })
  expect(await ui.find({ text: /зачем: «Причина:/ })).toBeDefined()
  expect(await ui.find({ text: /…»$/ })).toBeDefined()
  await ui.unmount()
})

describe('wrapTwo', () => {
  test('a short text stays on one line', () => {
    expect(wrapTwo('один два три', 20)).toEqual(['один два три'])
  })

  test('word wrap into two lines, the second cut with an ellipsis', () => {
    expect(wrapTwo('aaa bbb ccc ddd eee', 8)).toEqual(['aaa bbb', 'ccc ddd…'])
    expect(wrapTwo('aaa bbb ccc', 8)).toEqual(['aaa bbb', 'ccc'])
  })

  test('a word wider than the line is cut, never overflows', () => {
    expect(wrapTwo('x'.repeat(30), 10)).toEqual([`${'x'.repeat(9)}…`])
  })

  test('never more than two lines, never a line wider than asked', () => {
    const text = 'Запускаю субагента Explore, потому что вы прямо попросили делегировать поиск и чтение README.md ему: так его вывод остаётся в стороне'
    for (const width of [8, 15, 23, 40, 62, 200]) {
      const lines = wrapTwo(text, width)
      expect(lines.length).toBeLessThanOrEqual(2)
      for (const line of lines) expect([...line].length).toBeLessThanOrEqual(width)
    }
  })
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

// ── Team lead on the Agents tab (spec 6.6): tier, effort, OE and the budget ──

const SONNET = 'claude-sonnet-5-5'
const THEMES = [
  ['classic', {}],
  ['warhammer', { theme: 'warhammer' }],
] as const
// 600 input tokens on sonnet: 600 x 2 / 4 = 300 OE.
const SPENT_300 = { model: SONNET, input_tokens: 600, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
// 1000 input + 400 output on sonnet: 1500 OE.
const SPENT_1500 = { model: SONNET, input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('a working sonnet row shows tier, effort and OE, on every surface', async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'coder', description: 'парсер', model: 'sonnet' })
  engine.stepAnswer({ usage: SPENT_1500 })
  await step($, 'a1', { model: SONNET, effort: 'medium' })
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /sonnet · medium · 1500 OE/ })).toBeDefined()
    expect(await ui.find({ text: /null|undefined/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a row with nothing known keeps its old line', async ($, on) => {
  engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /investigator · 0с$/ })).toBeDefined()
    expect(await ui.find({ text: /OE/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the header names the observe mode', async ($, on) => {
  engineBeneath(on)
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /наблюдение/ })).toBeDefined()
    expect(await ui.find({ text: /контроль/ })).toBeUndefined()
    expect(await ui.find({ text: /ЗАМОРОЖЕНО/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the header shows the enforce mode and spent/limit', { options: { budgetMode: 'enforce', sessionBudgetOE: '1000' } }, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  engine.stepAnswer({ usage: SPENT_300 })
  await step($, undefined, { model: SONNET })
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /контроль · 300\/1 000 OE/ })).toBeDefined()
    await ui.unmount()
  }
  // The owner adds to the limit: the header follows.
  await runCommand($, 'mc', 'budget +500')
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /контроль · 300\/1 500 OE/ })).toBeDefined()
  await ui.unmount()
})

test('the halt is shown in observe and in enforce', async ($, on) => {
  engineBeneath(on)
  await spawn($, { subagentType: 'coder', description: 'шаг', model: 'sonnet' })
  await runCommand($, 'mc', 'halt')
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /наблюдение · ЗАМОРОЖЕНО/ })).toBeDefined()
    await ui.unmount()
  }
  await runCommand($, 'mc', 'resume')
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /ЗАМОРОЖЕНО/ })).toBeUndefined()
  await ui.unmount()
})

test('enforce shows the halt after the budget', { options: { budgetMode: 'enforce', sessionBudgetOE: '1000' } }, async ($, on) => {
  engineBeneath(on)
  await runCommand($, 'mc', 'halt')
  const ui = await mountAgents($, 'desktop')
  expect(await ui.find({ text: /контроль · 0\/1 000 OE · ЗАМОРОЖЕНО/ })).toBeDefined()
  await ui.unmount()
})

for (const [name, options] of THEMES) {
  test(`${name} theme: card facts and header on every surface`, { options: { ...options, budgetMode: 'enforce', sessionBudgetOE: '1000' } }, async ($, on) => {
    const engine = engineBeneath(on)
    await submit($, 'go')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, { subagentType: 'coder', description: 'парсер', model: 'sonnet' })
    engine.stepAnswer({ usage: SPENT_300 })
    await step($, 'a1', { model: SONNET, effort: 'medium' })
    await runCommand($, 'mc', 'halt')
    for (const surface of SURFACES) {
      const ui = await mountAgents($, surface)
      expect(await ui.find({ text: /sonnet · medium · 300 OE/ })).toBeDefined()
      expect(await ui.find({ text: /контроль · 300\/1 000 OE · ЗАМОРОЖЕНО/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`${name} theme: a narrow dock keeps its width`, { options: { ...options, budgetMode: 'enforce', sessionBudgetOE: '1000000' } }, async ($, on) => {
    const engine = engineBeneath(on)
    await submit($, 'go')
    await spawn($, { subagentType: 'coder', description: 'парсер', model: 'sonnet' })
    engine.stepAnswer({ usage: SPENT_1500 })
    await step($, 'a1', { model: SONNET, effort: 'medium' })
    await runCommand($, 'mc', 'halt')
    for (const cols of [30, 40]) {
      const ui = await mountAgents($, 'terminal', { cols, rows: 20 })
      const lines = screen(await ui.drawn()).split('\n')
      // The painter does not clip a Text, so only the rows this feature adds are measured.
      const header = lines.filter(l => l.includes('контроль'))
      expect(header).toHaveLength(1)
      expect([...(header[0] ?? '').trim()].length).toBeLessThanOrEqual(cols - 2)
      await ui.unmount()
    }
  })
}
