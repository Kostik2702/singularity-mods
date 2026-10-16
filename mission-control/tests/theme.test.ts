import { describe, expect, test } from 'claude-code/testing'

import { CLASSIC, WARHAMMER, bannerLine, themeOf, themedRule } from '../hooks/lib/theme'
import { COLORS } from '../hooks/lib/viz'
import { engineBeneath, mountAgents, mountJobs, spawn, step, submit, toolCall } from './helpers'
import { screen } from './paint'

const SURFACES = ['terminal', 'desktop'] as const
const WARHAMMER_OPTIONS = { options: { theme: 'warhammer' } }

describe('themeOf', () => {
  test('picks a theme by its name and falls back to classic', () => {
    expect(themeOf('warhammer')).toBe(WARHAMMER)
    expect(themeOf('classic')).toBe(CLASSIC)
    expect(themeOf(undefined)).toBe(CLASSIC)
    expect(themeOf('nope')).toBe(CLASSIC)
    expect(themeOf('toString')).toBe(CLASSIC)
    expect(themeOf(42)).toBe(CLASSIC)
  })
})

test('classic keeps the old palette and the old "── Title ───" rule', () => {
  expect(CLASSIC.colors).toBe(COLORS)
  const r = themedRule(CLASSIC, 'Лента', 20)
  expect(r.lead + r.title + r.tail).toBe('── Лента ───────────')
})

test('a themed rule and a banner fill the width exactly', () => {
  for (const width of [24, 40, 63]) {
    const r = themedRule(WARHAMMER, 'Хроника', width)
    expect([...(r.lead + r.title + r.tail)].length).toBe(width)
    const banner = bannerLine(WARHAMMER, 'agents', width) ?? ''
    expect([...banner].length).toBe(width)
    expect(banner).toContain('✠ ИМПЕРАТОР ЗАЩИЩАЕТ ✠')
  }
  expect(bannerLine(CLASSIC, 'agents', 40)).toBeNull()
})

// A glyph a terminal may draw two cells wide (emoji presentation, East Asian wide) would
// push every row it sits on past the column: each icon is one code point from ranges
// with neither, and each tree connector two.
test('every warhammer glyph is one narrow cell', () => {
  const icons = [...Object.values(WARHAMMER.icons.phase), ...Object.values(WARHAMMER.icons).filter((v): v is string => typeof v === 'string')]
  for (const icon of icons) {
    expect([...icon].length).toBe(1)
    expect(/\p{Emoji_Presentation}/u.test(icon)).toBe(false)
    const cp = icon.codePointAt(0) ?? 0
    // Wide blocks: CJK, Hangul, fullwidth forms, and the pictographs from U+1F300 up.
    expect(cp >= 0x1100 && cp <= 0x115f).toBe(false)
    expect(cp >= 0x2e80 && cp <= 0xa4cf).toBe(false)
    expect(cp >= 0xff00 && cp <= 0xff60).toBe(false)
    expect(cp >= 0x1f300).toBe(false)
  }
  for (const glyph of Object.values(WARHAMMER.tree)) expect([...glyph].length).toBe(2)
  for (const rank of Object.values(WARHAMMER.slate?.ranks ?? {})) {
    expect([...rank.icon].length).toBe(1)
    expect(/\p{Emoji_Presentation}/u.test(rank.icon)).toBe(false)
    expect(rank.icon.codePointAt(0) ?? 0).toBeLessThan(0x2e80)
  }
})

test('the warhammer Agents tab: litany, Магистр, the vow, «во имя» and the chronicle', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень бага в parse.ts' })
  engine.say('Смотрю парсер. Сверяю вывод mb search с регэкспом.')
  await step($, 'a1')
  await toolCall($, { tool: 'Glob', pattern: '*.ts' }, 'a1')
  // The terminal draws the slate: every agent a card in its frame, the feed a vox-log.
  const term = await mountAgents($, 'terminal')
  const shown = screen(await term.drawn())
  expect(shown).toContain('═ ✠ ИМПЕРАТОР ЗАЩИЩАЕТ ✠ ═')
  expect(shown).toContain('✠ КОГИТАТОР ЛЕГИОНА')
  expect(shown).toMatch(/╔═╡ ✠ МАГИСТР ╞═+╡ ход 1 · 0с ╞═╗/)
  // A known type is called by its Imperial rank, its heraldic mark first, the type kept after it.
  expect(shown).toMatch(/╚═┏━┫ ℑ ИНКВИЗИТОР · INVESTIGATOR ┣━+┫ 0с · 1 шаг ┣━┓/)
  expect(shown).toContain('┃ обет: корень бага в parse.ts')
  expect(shown).toMatch(/┃ во имя:\s«Сверяю вывод mb search с регэкспом\.»/)
  expect(shown).toContain('┤ ВОКС-ЛОГ · ХРОНИКА ├')
  expect(shown).toMatch(/ℑИнквизитор\s+☩ нашёл файлы \*\.ts/)
  expect(shown).not.toMatch(/главный|зачем:|задача:|Лента/)
  await term.unmount()
  // The desktop draws no frames (they line up only in one-width cells): the plain layout in the theme's words.
  const desk = await mountAgents($, 'desktop')
  expect(await desk.find({ text: /═ ✠ ИМПЕРАТОР ЗАЩИЩАЕТ ✠ ═/ })).toBeDefined()
  expect(await desk.find({ text: /◈ Магистр · ход 1/ })).toBeDefined()
  expect(await desk.find({ text: /╚═✠ investigator · 0с · 1 шаг/ })).toBeDefined()
  expect(await desk.find({ text: /══ ✠ Хроника ✠ ═/ })).toBeDefined()
  expect(await desk.find({ text: /╔═╡/ })).toBeUndefined()
  await desk.unmount()
})

test('the warhammer Processes tab: an empty one says there are no rites', WARHAMMER_OPTIONS, async ($, on) => {
  engineBeneath(on)
  for (const surface of SURFACES) {
    const ui = await mountJobs($, surface)
    expect(await ui.find({ text: /ХВАЛА ОМНИССИИ/ })).toBeDefined()
    expect(await ui.find({ text: /Обрядов нет/ })).toBeDefined()
    expect(await ui.find({ text: /Долгих процессов нет/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the warhammer Processes tab: a foreground build is «Ковка», started by Магистр', WARHAMMER_OPTIONS, async ($, on) => {
  let finish: (() => void) | undefined
  const ran = new Promise<void>(resolve => {
    finish = resolve
  })
  const engine = engineBeneath(on, {
    bash: async () => {
      await ran
      return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
    },
  })
  await submit($, 'собери')
  await $.turn.start({ text: 'собери', turnId: 't1' })
  engine.say('Соберу проект. Нужен свежий бандл.')
  await step($)
  const call = toolCall($, { tool: 'Bash', tool_use_id: 'tu-b', command: 'npm run build', description: 'Build the bundle' })
  await engine.clock.advance(6000)
  const ui = await mountJobs($, 'terminal')
  const shown = screen(await ui.drawn())
  expect(shown).toMatch(/┏━┫ ✠ КОВКА ┣━+┫ Магистр · 6с · на виду ┣━┓/)
  expect(shown).toMatch(/┃ во имя:\s«Нужен свежий бандл\.»/)
  expect(shown).toMatch(/┗━+┫ ОБРЯД 0x[0-9A-F]{4} ┣━┛/)
  await ui.unmount()
  const desk = await mountJobs($, 'desktop')
  expect(await desk.find({ text: /✠ Ковка · Магистр · 6с · на переднем плане/ })).toBeDefined()
  await desk.unmount()
  finish?.()
  await call
})

test('the warhammer Memory tab: the archives, under their own litany', WARHAMMER_OPTIONS, async ($, on) => {
  engineBeneath(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface,
      component: 'Pane',
      requestId: 'mem-meter',
      props: { title: 'Архивы', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    expect(await ui.find({ text: /ЗНАНИЕ — СИЛА, ХРАНИ ЕГО/ })).toBeDefined()
    expect(await ui.find({ text: /токенов из архивов за сессию/ })).toBeDefined()
    if (surface === 'terminal') {
      const shown = screen(await ui.drawn())
      expect(shown).toContain('╔═╡ ✠ ПРИНЯТО ИЗ АРХИВОВ ╞')
      expect(shown).toContain('┤ ИСТОЧНИКИ ├')
      expect(shown).toContain('┤ ЛИБРАРИУМ ├')
    } else {
      expect(await ui.find({ text: /══ ✠ Источники ✠ ═/ })).toBeDefined()
      expect(await ui.find({ text: /══ ✠ Либрариум ✠ ═/ })).toBeDefined()
    }
    await ui.unmount()
  }
})

const SESSION = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const CLASSIC_PANES = [
  { id: 'mem-meter', title: 'Память' },
  { id: 'jobs', title: 'Процессы' },
  { id: 'agents', title: 'Агенты' },
]

// A change in /config reloads the module, and session.start fires again with the tabs
// still up under the old theme's titles: each is opened again under its new one,
// Агенты last, so it stays the tab on screen.
test('a theme switch reopens the open tabs under the new titles', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on, { panes: CLASSIC_PANES })
  await $.session.start(SESSION)
  expect(engine.closed).toEqual(['mem-meter', 'jobs', 'agents'])
  expect(engine.opened).toEqual(['mem-meter', 'jobs', 'agents'])
  expect(engine.titles).toEqual({ 'mem-meter': 'Архивы', jobs: 'Обряды', agents: 'Легион' })
})

test('a reload under the same theme leaves the open tabs alone', async ($, on) => {
  const engine = engineBeneath(on, { panes: CLASSIC_PANES })
  await $.session.start(SESSION)
  expect(engine.closed).toEqual([])
  expect(engine.opened).toEqual([])
})

test('the warhammer band above the prompt opens on plates, in the status line’s manner', WARHAMMER_OPTIONS, async ($, on) => {
  // No tab is open beneath (engineBeneath answers ui.panes with none), so the band draws.
  engineBeneath(on)
  const ui = await $.ui.mount({
    plugin: 'mission-control',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  const shown = screen(await ui.drawn())
  expect(shown).toContain(' АРХИВЫ  хуки ≈')
  expect(shown).toContain(' · CLAUDE.md ')
  expect(shown).not.toContain('│')
  await ui.unmount()
})

test('the awakening: the band plays the cogitator’s boot after the session starts, then the archives', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal' as const, isInteractive: true })
  const band = () =>
    $.ui.mount({
      plugin: 'mission-control',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
  await engine.clock.advance(1300)
  let ui = await band()
  let shown = screen(await ui.drawn())
  expect(shown).toContain('+++ ИНИЦИАЦИЯ ДУХА МАШИНЫ +++')
  expect(shown).toContain('литания пуска прочитана · ☩ архивы вскрыты')
  expect(shown).not.toContain('легион построен')
  await ui.unmount()
  await engine.clock.advance(2500)
  ui = await band()
  shown = screen(await ui.drawn())
  expect(shown).toContain('✠ ОМНИССИЯ БЛАГОСЛОВЛЯЕТ ✠')
  expect(shown).toContain('легион построен')
  await ui.unmount()
  await engine.clock.advance(2000)
  ui = await band()
  expect(screen(await ui.drawn())).toContain(' АРХИВЫ  хуки ≈')
  await ui.unmount()
})

test('the classic look has no awakening', async ($, on) => {
  engineBeneath(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal' as const, isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'mission-control',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  expect(screen(await ui.drawn())).not.toContain('ИНИЦИАЦИЯ')
  await ui.unmount()
})

const SESSION_START = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }

/** Records which of the plugin's clips play, answering beneath it as the player would. */
function listen(on: Parameters<typeof engineBeneath>[0]): string[] {
  const played: string[] = []
  on('audio.play', (_$, e) => {
    played.push(JSON.stringify(e))
    return { value: undefined }
  })
  return played
}

test('sounds: the awakening at the start, the vox when a main turn ends; none for a subagent’s', { options: { theme: 'warhammer', sound: 'full' } }, async ($, on) => {
  engineBeneath(on)
  const played = listen(on)
  await $.session.start(SESSION_START)
  expect(played.some(p => p.includes('sounds/awake.wav'))).toBe(true)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ reason: 'end', answer: 'готово', agentId: 'a1' } as never)
  expect(played.some(p => p.includes('sounds/vox.wav'))).toBe(false)
  await $.turn.complete({ reason: 'end', answer: 'готово' } as never)
  expect(played.some(p => p.includes('sounds/vox.wav'))).toBe(true)
})

test('sounds: off is silence, and the classic look never sounds', { options: { theme: 'warhammer', sound: 'off' } }, async ($, on) => {
  engineBeneath(on)
  const played = listen(on)
  await $.session.start(SESSION_START)
  await $.turn.complete({ reason: 'end', answer: 'готово' } as never)
  expect(played).toEqual([])
})

test('sounds: the classic look is silent whatever the option', { options: { sound: 'full' } }, async ($, on) => {
  engineBeneath(on)
  const played = listen(on)
  await $.session.start(SESSION_START)
  await $.turn.complete({ reason: 'end', answer: 'готово' } as never)
  expect(played).toEqual([])
})
