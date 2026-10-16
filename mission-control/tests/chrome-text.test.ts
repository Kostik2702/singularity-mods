import { describe, expect, test } from 'claude-code/testing'

import { decorateMarkdown, decorateNotice, litanyFor } from '../hooks/chrome/text'

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
