import { expect, mock, test } from 'claude-code/testing'

const SEARCH_OUT = [
  '1. reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md | 0.68 | [memory] | CLAUDE-CODE-CLI-CUSTOMIZATION/Statusline | ...',
  '2. voice-text-recognition/src/render/MarkdownRenderer.ts | 0.52 | [function] | renderParagraph | ...',
].join('\n')

const BAND = {
  plugin: 'mem-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 220,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

// A `ui.panes` answer is `{ value }` (OpEventResult); `$.ui.panes()` in the plugin resolves the array inside.
const NO_PANE = { value: [] }
const PANE_UP = {
  value: [{ id: 'mem-meter', title: 'Память → контекст', isShown: true, isFocused: false, isPlaced: true }],
}
// What the engine draws in the band when no plugin does: an empty Box stands for it.
const ENGINE_BAND = { type: 'Box' as const, children: [] }

test('an mb search, then a Read of one hit, shows on the band on every surface', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  // Beneath the plugin, standing for the engine: no pane open, Bash prints the search rows, Read returns a file.
  on('ui.panes', () => NO_PANE)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: SEARCH_OUT, stderr: '', interrupted: false },
    text: SEARCH_OUT,
  }))
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: 'x', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
    text: 'x',
  }))

  await $.tool.call({ tool: 'Bash', command: 'echo hi' })
  await $.tool.call({ tool: 'Bash', command: 'cd /e/x && mb search "statusline" --with-code | head -40' })
  await $.tool.call({ tool: 'Read', file_path: 'E:\\obsidian\\memory brain\\reference\\CLAUDE-CODE-CLI-CUSTOMIZATION.md' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /поиск ×1/ })).toBeDefined()
    expect(await ui.find({ text: /2 hits · best 0\.68/ })).toBeDefined()
    expect(await ui.find({ text: /прочит 1\/2/ })).toBeDefined()
    expect(await ui.find({ text: /код ×1/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the sidebar pane lists the search, its query and the hit read', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: SEARCH_OUT, stderr: '', interrupted: false },
    text: SEARCH_OUT,
  }))
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: 'x', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
    text: 'x',
  }))
  await $.tool.call({ tool: 'Bash', command: 'mb search "statusline effort"' })
  await $.tool.call({ tool: 'Read', file_path: 'E:/obsidian/memory brain/reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mem-meter',
      surface,
      component: 'Pane',
      requestId: 'mem-meter',
      props: {
        title: 'Память → контекст',
        isFocused: false,
        bodyColumns: 44,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ text: /запросов 1 · найдено 2 · лучший 0\.68/ })).toBeDefined()
    expect(await ui.find({ text: /прочитано.* 1\/2/ })).toBeDefined()
    expect(await ui.find({ text: /statusline effort/ })).toBeDefined()
    expect(await ui.find({ text: /Поиск mb/ })).toBeDefined()
    expect(await ui.find({ text: /токенов из памяти за сессию/ })).toBeDefined()
    await ui.unmount()
  }
})

// Regression 2026-10-02: the pane drew grey and nothing else live. A `.map(h => <Text/>)` callback
// shadowed the JSX factory `h`; no test had a hook injection, so that callback never ran here.
test('the pane draws hook injections (a settings hook context reached the model)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.panes', () => NO_PANE)
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  await $.prompt.attachment({
    type: 'hook_additional_context',
    text: 'SessionStart hook additional context: [Singularity memory] 2026-10-02 18:03 (Friday).',
    origin: { kind: 'hook', event: 'SessionStart' },
  })
  await $.prompt.attachment({
    type: 'hook_additional_context',
    text: 'UserPromptSubmit hook additional context: [mb route] Name this task class.',
    origin: { kind: 'hook', event: 'UserPromptSubmit' },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mem-meter',
      surface,
      component: 'Pane',
      requestId: 'mem-meter',
      props: {
        title: 'Память → контекст',
        isFocused: false,
        bodyColumns: 44,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ text: /SessionStart \d+ · UserPromptSubmit \d+/ })).toBeDefined()
    expect(await ui.find({ text: /модель ещё не искала в памяти/ })).toBeDefined()
    await ui.unmount()
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ text: /SS \d/ })).toBeDefined()
    await band.unmount()
  }
})

test('with the pane up and nothing alarming, the band leaves its slot to the engine', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.panes', () => PANE_UP)
  on('ui.render', { component: 'AbovePrompt' }, () => ENGINE_BAND)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: SEARCH_OUT, stderr: '', interrupted: false },
    text: SEARCH_OUT,
  }))
  await $.tool.call({ tool: 'Bash', command: 'mb search "statusline"' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /поиск ×/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane logs actions in words and shows cache use after a turn', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.panes', () => NO_PANE)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: SEARCH_OUT, stderr: '', interrupted: false },
    text: SEARCH_OUT,
  }))
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: 'x', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
    text: 'x',
  }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  await $.tool.call({ tool: 'Bash', command: 'mb search "кэш промпта"' })
  await $.tool.call({ tool: 'Read', file_path: 'E:/obsidian/memory brain/reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md' })
  await $.turn.complete({
    answer: 'готово',
    durationMs: 134_000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 9_800, cache_creation_input_tokens: 198, model: 'm' },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mem-meter',
      surface,
      component: 'Pane',
      requestId: 'mem-meter',
      props: {
        title: 'Память → контекст',
        isFocused: false,
        bodyColumns: 48,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 60 },
        view: {},
      },
    })
    expect(await ui.find({ text: /поискал в памяти «кэш промпта»/ })).toBeDefined()
    expect(await ui.find({ text: /прочитал CLAUDE-CODE-CLI-CUSTOMIZATION\.md/ })).toBeDefined()
    expect(await ui.find({ text: /из кэша.* 98%/ })).toBeDefined()
    expect(await ui.find({ text: /прочитано\s+9\.8k · записано 198 · без 2/ })).toBeDefined()
    expect(await ui.find({ text: /2м14с · 2 шага · поиск 1 · кэш 98%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a command with no mb search records nothing', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.panes', () => NO_PANE)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false },
    text: '',
  }))
  await $.tool.call({ tool: 'Bash', command: 'mb learn "use mb search first" --task X' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /поиск ×0/ })).toBeDefined()
  await ui.unmount()
})
