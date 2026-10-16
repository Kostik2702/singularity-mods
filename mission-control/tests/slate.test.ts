import { describe, expect, test } from 'claude-code/testing'

import { CREST, cells, crestLines, edgeBottom, edgeTop, wrapLines } from '../hooks/lib/frame'
import type { FrameStyle } from '../hooks/lib/frame'
import { TASKS_DIR, engineBeneath, fakeFs, mountAgents, mountJobs, spawn, step, submit, toolCall } from './helpers'
import { screen } from './paint'

const WARHAMMER_OPTIONS = { options: { theme: 'warhammer' } }
const SESSION = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const CURL = '  45  123M   45 55.6M    0     0  10.2M      0  0:00:12  0:00:05  0:00:07 10.5M'
const STYLES: FrameStyle[] = ['double', 'heavy', 'light']
const RIGHT_EDGE = /[║┃│╗┓┐╝┛┘]$/
const TOP_LEFT = /[╔┏┌]/

/**
 * Rows of a painted tab that break a frame: a row ending on a right edge must end on
 * the column's last cell (`cols - 1` cells, after the one-cell padding), and a row that
 * opens a frame must close it there too.
 */
function brokenFrames(shown: string, cols: number): string[] {
  return shown.split('\n').filter(row => {
    const n = [...row].length
    if (RIGHT_EDGE.test(row)) return n !== cols - 1
    return TOP_LEFT.test(row)
  })
}

describe('frame edges', () => {
  test('a top and a bottom edge are exactly as wide as asked, whatever the plates', () => {
    for (const style of STYLES) {
      for (const width of [8, 12, 20, 33, 54, 80]) {
        for (const [title, meta] of [['', ''], ['✠ МАГИСТР', ''], ['✠ МАГИСТР', 'ход 12 · 3м05с'], ['ОЧЕНЬ ДЛИННОЕ НАЗВАНИЕ ОБРЯДА ПРИЁМА ДАННЫХ', 'Магистр · 1ч02м · в фоне']] as const) {
          const top = edgeTop(style, width, title, meta).map(p => p.text).join('')
          expect(cells(top)).toBe(width)
        }
        for (const foot of ['', 'ВОКС 0x2A7F']) expect(cells(edgeBottom(style, width, foot).map(p => p.text).join(''))).toBe(width)
      }
    }
  })

  test('the meta plate gives way first, then the title is cut', () => {
    const top = edgeTop('double', 24, '✠ МАГИСТР', 'ход 12 · 3м05с · 7 шагов').map(p => p.text).join('')
    expect(top).toContain('МАГИСТР')
    expect(top).not.toContain('шагов')
  })
})

test('the aquila is symmetric and every row the same width', () => {
  const across = cells(CREST[0] ?? '')
  for (const row of CREST) expect(cells(row)).toBe(across)
  expect(crestLines(across - 1)).toBeNull()
  for (const row of crestLines(54) ?? []) expect(cells(row)).toBe(54)
})

test('wrapLines never makes a line wider than asked and marks a cut', () => {
  const lines = wrapLines('Обрядов нет. Здесь появятся фоновые команды и всё, что идёт дольше 5 с', 16, 2)
  expect(lines.length).toBe(2)
  for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(16)
  expect(lines[1]?.endsWith('…')).toBe(true)
})

test('the Agents slate: every frame closes on the column’s last cell, at any width', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень бага в parse.ts' })
  await spawn($, { subagentType: 'Explore', description: 'вызовы', parentAgentId: 'a1' })
  engine.say('Смотрю парсер. Сверяю вывод mb search с регэкспом, потому что подозреваю ошибку в разборе путей.')
  await step($, 'a1')
  await toolCall($, { tool: 'Glob', pattern: '*.ts' }, 'a1')
  for (const cols of [40, 56, 72]) {
    const ui = await mountAgents($, 'terminal', { cols, rows: 50 })
    const shown = screen(await ui.drawn())
    expect(brokenFrames(shown, cols)).toEqual([])
    expect(shown).toContain('╔═╡ ✠ МАГИСТР')
    expect(shown).toContain('┤ ВОКС-ЛОГ')
    await ui.unmount()
  }
})

test('the Processes slate: a rite card with its gauge closes on the column’s last cell', WARHAMMER_OPTIONS, async ($, on) => {
  const fs = fakeFs(on)
  fs.write(`${TASKS_DIR}/old.output`, '')
  const engine = engineBeneath(on, {
    bash: () => ({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
      text: `Command running in background with ID: b1. Output is being written to: ${TASKS_DIR}/b1.output. You will be notified when it completes.`,
    }),
  })
  await $.session.start(SESSION)
  await submit($, 'скачай веса')
  await $.turn.start({ text: 'скачай веса', turnId: 't1' })
  engine.say('Скачаю веса модели. Без них оценку не запустить.')
  await step($)
  await toolCall($, {
    tool: 'Bash',
    tool_use_id: 'tu-dl',
    command: 'curl -L -o model.bin https://huggingface.co/org/m/resolve/main/model.bin',
    description: 'Download model weights',
    run_in_background: true,
  })
  fs.write(`${TASKS_DIR}/b1.output`, `  % Total    % Received\n\r${CURL}`)
  await engine.clock.advance(1000)
  for (const cols of [40, 56]) {
    const ui = await mountJobs($, 'terminal', { cols, rows: 40 })
    const shown = screen(await ui.drawn())
    expect(brokenFrames(shown, cols)).toEqual([])
    expect(shown).toMatch(/┃ ▕█+▒+▏  45% ┃/)
    expect(shown).toContain('┫ ✠ ПРИЁМ ДАННЫХ ┣')
    await ui.unmount()
  }
})

test('the Memory slate: the dial and every reliquary close on the column’s last cell', WARHAMMER_OPTIONS, async ($, on) => {
  engineBeneath(on)
  for (const cols of [44, 56]) {
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'mem-meter',
      props: { title: 'Архивы', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    const shown = screen(await ui.drawn())
    expect(brokenFrames(shown, cols)).toEqual([])
    expect(shown).toContain('┤ ПРЕДЕЛ ├')
    await ui.unmount()
  }
})
