import { describe, expect, test } from 'claude-code/testing'

import { decorateMarkdown, decorateNotice, litanyFor, ritesEnd, translateHint, willOfTheMagister } from '../hooks/chrome/text'

describe('decorateMarkdown', () => {
  test('headings get a cross, bullets a dotted cross, quotes a dagger', () => {
    const md = ['## Итог', '', '- первый пункт', '  * вложенный', '> цитата', 'обычная строка', '1. нумерованный'].join('\n')
    expect(decorateMarkdown(md)).toBe(
      ['## ✠ Итог', '', '- ⁜ первый пункт', '  * ⁜ вложенный', '> ‡ цитата', 'обычная строка', '1. нумерованный'].join('\n'),
    )
  })

  test('fenced code, tables, rules and task boxes stay exactly as written', () => {
    const md = [
      '```ts',
      '# not a heading',
      '- not a bullet',
      '```',
      '| a | b |',
      '|---|---|',
      '- - -',
      '***',
      '- [ ] задача',
      '~~~',
      '> not a quote',
      '~~~',
    ].join('\n')
    expect(decorateMarkdown(md)).toBe(md)
  })

  test('a second pass adds nothing: a redraw never doubles the marks', () => {
    const once = decorateMarkdown('# Заголовок\n- пункт\n> цитата')
    expect(decorateMarkdown(once)).toBe(once)
  })
})

test('litanyFor keeps one litany per seed and covers several', () => {
  expect(litanyFor(12_000)).toBe(litanyFor(12_000))
  const seen = new Set([0, 1, 2, 3, 4, 5, 6].map(litanyFor))
  expect(seen.size).toBe(7)
})

describe('decorateNotice', () => {
  test('a plugin reload reads as the Machine Spirit woken again, every hook kept', () => {
    const line = 'mission-control: reloaded (11 hooks: session.start, turn.complete, ui.render)'
    expect(decorateNotice(line)).toBe(
      '✠ +++ mission-control: Дух Машины пробуждён заново · освящено обрядов: 11 (session.start, turn.complete, ui.render) +++',
    )
    expect(decorateNotice('x: reloaded (1 hook: ui.render)')).toContain('освящено обрядов: 1 (ui.render)')
  })

  test('the recap gets the chronicle plate; any other notice is left alone', () => {
    expect(decorateNotice('recap: Делаем оформление.')).toBe('✠ ЛЕТОПИСЬ КОГИТАТОРА: Делаем оформление.')
    expect(decorateNotice('※ recap: x')).toBe('✠ ЛЕТОПИСЬ КОГИТАТОРА: x')
    expect(decorateNotice('<local-command-stdout>ok</local-command-stdout>')).toBeNull()
    expect(decorateNotice('Compacted conversation')).toBeNull()
  })
})

test('translateHint: the mode and the keys in the cogitator’s words, the marks kept; unknown text is left', () => {
  expect(translateHint('⏵⏵ accept edits on (shift+tab to cycle) · ← for agents')).toBe('⏵⏵ правки дозволены (shift+tab — сменить) · ← к агентам')
  expect(translateHint('? for shortcuts')).toBe('? — руны клавиш')
  expect(translateHint('esc to interrupt')).toBe('esc — прервать обряд')
  expect(translateHint('something new')).toBeNull()
})

test('ritesEnd: heresy for an error, the Magister’s rejection for a refusal, a rite cut short for an abort', () => {
  expect(ritesEnd({ isErrored: false, isInterrupted: false })).toBeNull()
  expect(ritesEnd({ isErrored: true, isInterrupted: false, output: 'Exit code 1\nnot found' })?.kind).toBe('heresy')
  expect(ritesEnd({ isErrored: true, isInterrupted: false, output: "The user doesn't want to proceed with this tool use. The tool use was rejected" })?.kind).toBe('rejected')
  expect(ritesEnd({ isErrored: true, isInterrupted: true })?.plate).toBe('⊗ ОБРЯД ПРЕРВАН')
})

test('willOfTheMagister: a cross before each question and a short header; options, long headers and a second pass left alone', () => {
  const asked = [{ question: 'Какой цвет?', header: 'Палитра', options: [{ label: 'Янтарь', description: 'тёплый' }], multiSelect: false }, { question: 'Что ещё?', header: 'Очень длинный' }]
  const once = willOfTheMagister(asked)
  expect(once).toEqual([
    { question: '✠ Какой цвет?', header: '✠ Палитра', options: [{ label: 'Янтарь', description: 'тёплый' }], multiSelect: false },
    { question: '✠ Что ещё?', header: 'Очень длинный' },
  ])
  expect(willOfTheMagister(once)).toEqual(once)
  for (const q of once as { header: string }[]) expect([...q.header].length).toBeLessThanOrEqual(13)
})
