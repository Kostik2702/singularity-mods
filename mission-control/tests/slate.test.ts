import { describe, expect, test } from 'claude-code/testing'

import { cogCells } from '../hooks/lib/cog'
import { THOUGHTS, thoughtFor } from '../hooks/lib/thoughts'
import { CREST, binaryCant, cells, corruptCant, crestLines, edgeBottom, edgeTop, imperialDate, isWarped, wrapLines } from '../hooks/lib/frame'
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

describe('the instrument block', () => {
  const PAL = { light: 0xffd27a, mid: 0xa8823c, dark: 0x2a1d0c, hub: 0xf03a2e }
  const decode = (b64: string): number[] => {
    const bin = atob(b64)
    const out: number[] = []
    for (let i = 0; i < bin.length; i += 4) out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0)
    return out
  }

  test('a cog frame fills its box, one narrow glyph a cell, and turns between frames', () => {
    const words = decode(cogCells(10, 5, 0, PAL))
    expect(words.length).toBe(10 * 5 * 3)
    for (let i = 0; i < words.length; i += 3) expect([0x20, 0x2580, 0x2584]).toContain(words[i])
    expect(words.some((w, i) => i % 3 === 0 && w !== 0x20)).toBe(true)
    expect(cogCells(10, 5, 0.3, PAL)).not.toBe(cogCells(10, 5, 0, PAL))
  })

  test('the Imperial date: check number, thousandths of the year, year, millennium', () => {
    expect(imperialDate(Date.UTC(2026, 9, 16, 12))).toBe('0 790 026.M3')
    expect(imperialDate(Date.UTC(2026, 0, 1))).toBe('0 000 026.M3')
    expect(imperialDate(Date.UTC(2999, 11, 31, 23))).toMatch(/^0 999 999\.M3$/)
  })

  test('the binaric cant is exactly as wide as asked and crawls with its offset', () => {
    for (const width of [1, 17, 44]) expect(cells(binaryCant(width, 0))).toBe(width)
    expect(binaryCant(30, 2)).not.toBe(binaryCant(30, 0))
    expect(binaryCant(30, 2).slice(0, 28)).toBe(binaryCant(30, 0).slice(2, 30))
  })
})

test('the pictured aquila keeps its shape: 54 cells across take 9 rows', WARHAMMER_OPTIONS, async ($, on) => {
  engineBeneath(on, { env: { TERM_PROGRAM: 'ghostty' } })
  const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
  const shown = screen(await ui.drawn()).split('\n')
  const picture = shown.filter(row => row.includes('▒'.repeat(54)))
  expect(picture.length).toBe(9)
  await ui.unmount()
})

test('a crest picture the person chose is read from its file; without one, the mod’s own', { options: { theme: 'warhammer', aquilaImage: '/Users/me/aquila.png' } }, async ($, on) => {
  engineBeneath(on, { env: { TERM_PROGRAM: 'ghostty' } })
  const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('"file":"/Users/me/aquila.png"')
  expect(tree).not.toContain('"png":')
  await ui.unmount()
})

test('without a chosen crest the embedded aquila is drawn', WARHAMMER_OPTIONS, async ($, on) => {
  engineBeneath(on, { env: { TERM_PROGRAM: 'ghostty' } })
  const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('"png":')
  expect(tree).not.toContain('"file":')
  await ui.unmount()
})

const SKULL_OPTIONS = { options: { theme: 'warhammer', servoSkull: '/Users/me/servo-skull' } }

test('Обряды: a chosen servo-skull stands in the cog’s place where the terminal draws pictures', SKULL_OPTIONS, async ($, on) => {
  engineBeneath(on, { env: { TERM_PROGRAM: 'ghostty' } })
  const ui = await mountJobs($, 'terminal', { cols: 56, rows: 40 })
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toMatch(/"file":"\/Users\/me\/servo-skull\/frame-\d\d\.png"/)
  expect(tree).not.toContain('"type":"Raster"')
  await ui.unmount()
})

test('Обряды: without pictures the cog stays, whatever was chosen', SKULL_OPTIONS, async ($, on) => {
  engineBeneath(on)
  const ui = await mountJobs($, 'terminal', { cols: 56, rows: 40 })
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('"type":"Raster"')
  expect(tree).not.toContain('servo-skull')
  await ui.unmount()
})

test('Архивы: a chosen purity seal hangs in the top left corner, beside every block down to the vault', { options: { theme: 'warhammer', puritySeal: '/Users/me/purity-seal.png' } }, async ($, on) => {
  engineBeneath(on, { env: { TERM_PROGRAM: 'ghostty' } })
  const ui = await $.ui.mount({
    plugin: 'mission-control',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'mem-meter',
    props: { title: 'Архивы', isFocused: false, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  const drawn = await ui.drawn()
  expect(JSON.stringify(drawn)).toContain('"file":"/Users/me/purity-seal.png"')
  const shown = screen(drawn).split('\n')
  // The seal (painted ▒) opens every row down to the vault; each frame beside it, and the
  // vault under it at the whole width, closes on the column's last cell.
  for (const title of ['ПРИНЯТО ИЗ АРХИВОВ', 'ИСТОЧНИКИ', 'КЭШ КОГИТАТОРА', 'ПОИСК В АРХИВАХ', 'ЛЕТОПИСЬ ХОДОВ', 'ПРЕДЕЛ']) {
    const row = shown.find(r => r.includes(title)) ?? ''
    expect(row.startsWith(' ▒▒▒▒▒▒')).toBe(true)
    expect([...row.trimEnd()].length).toBe(56 - 1)
  }
  const vault = shown.find(r => r.includes('ЛИБРАРИУМ')) ?? ''
  expect(vault.startsWith(' ┌')).toBe(true)
  expect([...vault.trimEnd()].length).toBe(56 - 1)
  // As tall as the blocks: the row above the vault still has the seal, the vault's does not.
  expect(shown[shown.indexOf(vault) - 1]?.startsWith(' ▒')).toBe(true)
  await ui.unmount()
})

test('the transcript: a failed rite reads as heresy found, a refused one as the Magister’s rejection', WARHAMMER_OPTIONS, async ($, on) => {
  engineBeneath(on)
  // Beneath the plugin, standing for the engine's own row.
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text' as const, children: ['Bash(make)'] }))
  const row = (output: string) =>
    $.ui.mount({
      plugin: 'mission-control',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'tu-1',
      props: { tool_use_id: 'tu-1', tool: 'Bash', input: { command: 'make' }, isRunning: false, isErrored: true, isInterrupted: false, output },
    })
  const failed = await row('Exit code 2')
  expect(screen(await failed.drawn())).toContain('‡ ЕРЕСЬ ОБНАРУЖЕНА · ОБРЯД · BASH')
  await failed.unmount()
  const refused = await row("The user doesn't want to proceed with this tool use. The tool use was rejected")
  expect(screen(await refused.drawn())).toContain('⊘ ОТВЕРГНУТО МАГИСТРОМ · ОБРЯД · BASH')
  await refused.unmount()
})

test('thought for the day: the same all day, another the next, every one short enough for a line', () => {
  const day = Date.UTC(2026, 9, 16)
  expect(thoughtFor(day + 1000)).toBe(thoughtFor(day + 23 * 3_600_000))
  expect(thoughtFor(day)).not.toBe(thoughtFor(day + 86_400_000))
  expect(new Set(THOUGHTS).size).toBe(THOUGHTS.length)
  for (const thought of THOUGHTS) expect([...thought].length).toBeLessThanOrEqual(60)
})

describe('the warp’s taint', () => {
  test('from 80% of the context; the cant breaks a third of its cells, the same within a second', () => {
    expect(isWarped(79)).toBe(false)
    expect(isWarped(80)).toBe(true)
    expect(isWarped(null)).toBe(false)
    const cant = binaryCant(40, 0)
    const broken = corruptCant(cant, 7)
    expect(cells(broken)).toBe(40)
    expect(broken).not.toBe(cant)
    expect(corruptCant(cant, 7)).toBe(broken)
  })

  const measure = (percent: number) => ({ context: { tokens: percent * 10_000, percent, window: 1_000_000 }, rateLimits: [] })

  test('Архивы: past 80% the dial turns scarlet under «‡ ВАРП-ПОРЧА»', WARHAMMER_OPTIONS, async ($, on) => {
    engineBeneath(on)
    on('session.measure', () => ({ changed: [] }))
    await $.session.measure(measure(86) as never)
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'mem-meter',
      props: { title: 'x', isFocused: false, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    const shown = screen(await ui.drawn())
    expect(shown).toContain('‡ ВАРП-ПОРЧА · ДУХ ПЕРЕГРУЖЕН')
    expect(shown).not.toContain('ПРИНЯТО ИЗ АРХИВОВ')
    await ui.unmount()
  })

  test('Легион: past 80% the Machine Spirit is overloaded', WARHAMMER_OPTIONS, async ($, on) => {
    engineBeneath(on)
    on('session.measure', () => ({ changed: [] }))
    await $.session.measure(measure(91) as never)
    const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
    expect(screen(await ui.drawn())).toContain('ДУХ МАШИНЫ ▸ ПЕРЕГРУЖЕН ‡ ВАРП-ПОРЧА')
    await ui.unmount()
  })
})

test('Легион: a rank’s portrait hangs on the branch before its card; a rank with none keeps the plain card', { options: { theme: 'warhammer', rankPortraits: '/Users/me/portraits' } }, async ($, on) => {
  const fs = fakeFs(on)
  fs.write('/Users/me/portraits/inquisitor.png', 'png')
  const engine = engineBeneath(on, { env: { TERM_PROGRAM: 'ghostty' } })
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень бага' })
  await spawn($, { subagentType: 'coder', description: 'правка' })
  engine.say('Смотрю парсер.')
  await step($, 'a1')
  const ui = await mountAgents($, 'terminal', { cols: 64, rows: 50 })
  const drawn = await ui.drawn()
  const tree = JSON.stringify(drawn)
  expect(tree).toContain('"file":"/Users/me/portraits/inquisitor.png"')
  expect(tree).not.toContain('techpriest.png')
  const shown = screen(drawn)
  expect(brokenFrames(shown, 64)).toEqual([])
  expect(shown).toMatch(/▒{6} ┏━┫ ℑ ИНКВИЗИТОР · INVESTIGATOR ┣/)
  expect(shown).toMatch(/┏━┫ ⌬ ТЕХНОЖРЕЦ · CODER ┣/)
  await ui.unmount()
})

test('the servo-skull holds still at rest and hovers only while a rite runs', SKULL_OPTIONS, async ($, on) => {
  let finish: (() => void) | undefined
  const ran = new Promise<void>(resolve => {
    finish = resolve
  })
  const engine = engineBeneath(on, {
    env: { TERM_PROGRAM: 'ghostty' },
    bash: async () => {
      await ran
      return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
    },
  })
  const blits: string[] = []
  on('ui.blit', (_$, e) => {
    blits.push((e as { key: string }).key)
    return { value: {} }
  })
  await $.session.start(SESSION)
  await engine.clock.advance(3000)
  expect(blits.filter(k => k === 'skull')).toEqual([])
  await submit($, 'собери')
  await $.turn.start({ text: 'собери', turnId: 't1' })
  const call = toolCall($, { tool: 'Bash', tool_use_id: 'tu-b', command: 'npm run build', description: 'Build' })
  await engine.clock.advance(8000)
  expect(blits.filter(k => k === 'skull').length).toBeGreaterThan(0)
  finish?.()
  await call
})

// A 2 x 2 pixmap, every pixel an opaque amber: what tools/make-art.py writes beside a picture.
const PIX = JSON.stringify({ w: 2, h: 2, rgba: btoa(String.fromCharCode(...Array.from({ length: 4 }, () => [255, 191, 77, 255]).flat())) })

describe('pictures where the terminal draws none (Windows Terminal and the like)', () => {
  test('Легион: the aquila in braille, from the mod’s own pixmap', WARHAMMER_OPTIONS, async ($, on) => {
    engineBeneath(on)
    const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
    const shown = screen(await ui.drawn())
    expect(shown).toMatch(/[⠁-⣿]{6}/)
    expect(shown).not.toContain('▗▄▖ ▗▄▖')
    await ui.unmount()
  })

  test('Обряды: the servo-skull’s frame in half blocks, from the pixmap beside it', SKULL_OPTIONS, async ($, on) => {
    const fs = fakeFs(on)
    for (let k = 0; k < 12; k += 1) fs.write(`/Users/me/servo-skull/frame-${String(k).padStart(2, '0')}.pix.json`, PIX)
    engineBeneath(on)
    const ui = await mountJobs($, 'terminal', { cols: 56, rows: 40 })
    const drawn = await ui.drawn()
    expect(JSON.stringify(drawn)).toContain('"key":"skull"')
    expect(screen(drawn)).toContain('▀'.repeat(12))
    await ui.unmount()
  })

  test('Архивы: the purity seal in half blocks, beside the blocks as the picture would be', { options: { theme: 'warhammer', puritySeal: '/Users/me/purity-seal.png' } }, async ($, on) => {
    const fs = fakeFs(on)
    fs.write('/Users/me/purity-seal.pix.json', PIX)
    engineBeneath(on)
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'mem-meter',
      props: { title: 'x', isFocused: false, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    const drawn = await ui.drawn()
    expect(JSON.stringify(drawn)).toContain('"key":"seal"')
    const dial = screen(drawn).split('\n').find(r => r.includes('ПРИНЯТО ИЗ АРХИВОВ')) ?? ''
    expect(dial.startsWith(' ▀')).toBe(true)
    expect([...dial.trimEnd()].length).toBe(56 - 1)
    await ui.unmount()
  })
})

describe('WezTerm draws pictures; where the engine says otherwise, the cells come back', () => {
  test('WezTerm: the aquila as a picture', WARHAMMER_OPTIONS, async ($, on) => {
    engineBeneath(on, { env: { TERM_PROGRAM: 'WezTerm' } })
    const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
    expect(JSON.stringify(await ui.drawn())).toContain('"png":')
    await ui.unmount()
  })

  test('a blit refused as an alt turns the slate back to its braille aquila', WARHAMMER_OPTIONS, async ($, on) => {
    const engine = engineBeneath(on, { env: { TERM_PROGRAM: 'WezTerm' } })
    on('ui.blit', () => ({ value: { deny: 'the Image draws its alt there: no placeholder images' } }))
    await $.session.start(SESSION)
    await engine.clock.advance(2500)
    const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
    const drawn = await ui.drawn()
    expect(JSON.stringify(drawn)).not.toContain('"png":')
    expect(screen(drawn)).toMatch(/[⠁-⣿]{6}/)
    await ui.unmount()
  })

  test('the probe blits the crest the person chose, never the mod’s own over it', { options: { theme: 'warhammer', aquilaImage: '/Users/me/aquila-custom.png' } }, async ($, on) => {
    const engine = engineBeneath(on, { env: { TERM_PROGRAM: 'ghostty' } })
    const sources: unknown[] = []
    on('ui.blit', (_$, e) => {
      const blit = e as { key: string; source?: unknown }
      if (blit.key === 'crest') sources.push(blit.source)
      return { value: {} }
    })
    await $.session.start(SESSION)
    await engine.clock.advance(2500)
    expect(sources).toEqual([{ file: '/Users/me/aquila-custom.png', format: 'png' }])
  })

  test('a blit refused because the tab is not on screen changes nothing', WARHAMMER_OPTIONS, async ($, on) => {
    const engine = engineBeneath(on, { env: { TERM_PROGRAM: 'WezTerm' } })
    on('ui.blit', () => ({ value: { deny: 'nothing of this plugin is mounted there' } }))
    await $.session.start(SESSION)
    await engine.clock.advance(2500)
    const ui = await mountAgents($, 'terminal', { cols: 56, rows: 50 })
    expect(JSON.stringify(await ui.drawn())).toContain('"png":')
    await ui.unmount()
  })
})
