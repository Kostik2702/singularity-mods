import { describe, expect, test } from 'claude-code/testing'

import { CLASSIC, WARHAMMER, bannerLine, themeOf, themedRule } from '../hooks/lib/theme'
import { COLORS } from '../hooks/lib/viz'
import { engineBeneath, mountAgents, mountJobs, spawn, step, submit, toolCall } from './helpers'

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
})

test('the warhammer Agents tab: litany, Магистр, the vow, «во имя» and the chronicle', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on)
  await submit($, 'go')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень бага в parse.ts' })
  engine.say('Смотрю парсер. Сверяю вывод mb search с регэкспом.')
  await step($, 'a1')
  await toolCall($, { tool: 'Glob', pattern: '*.ts' }, 'a1')
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /═ ✠ ИМПЕРАТОР ЗАЩИЩАЕТ ✠ ═/ })).toBeDefined()
    expect(await ui.find({ text: /◈ Магистр · ход 1/ })).toBeDefined()
    expect(await ui.find({ text: /╚═✠ investigator · 0с · 1 шаг/ })).toBeDefined()
    expect(await ui.find({ text: /обет: корень бага в parse\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /во имя:\s«Сверяю вывод mb search с регэкспом\.»/ })).toBeDefined()
    expect(await ui.find({ text: /══ ✠ Хроника ✠ ═/ })).toBeDefined()
    expect(await ui.find({ text: /↳investigator\s+☩ нашёл файлы \*\.ts/ })).toBeDefined()
    // None of the classic labels leaks through.
    expect(await ui.find({ text: /главный|зачем:|задача:|Лента/ })).toBeUndefined()
    await ui.unmount()
  }
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
  expect(await ui.find({ text: /✠ Ковка · Магистр · 6с · на переднем плане/ })).toBeDefined()
  expect(await ui.find({ text: /во имя:\s«Нужен свежий бандл\.»/ })).toBeDefined()
  await ui.unmount()
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
    expect(await ui.find({ text: /══ ✠ Источники ✠ ═/ })).toBeDefined()
    expect(await ui.find({ text: /══ ✠ Либрариум ✠ ═/ })).toBeDefined()
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
