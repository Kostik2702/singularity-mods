import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { cells } from '../hooks/lib/frame'
import { HERALD_MAX_COLS, branchOf, homeShort, modelName } from '../hooks/lib/herald'
import { engineBeneath, fakeFs } from './helpers'
import { screen } from './paint'

const WARHAMMER_OPTIONS = { options: { theme: 'warhammer' } }
const SESSION = { cwd: '/home/magos/forge', surface: 'terminal' as const, isInteractive: true }

/**
 * The session the herald reads: how many prompts were sent, its root, model and version,
 * a repository whose HEAD names the branch. Records every process run (none is expected).
 */
function session(on: On, turns: () => number, root = '/home/magos/forge'): { ran: string[]; fs: ReturnType<typeof fakeFs> } {
  const ran: string[] = []
  const fs = fakeFs(on)
  fs.write('/home/magos/forge/.git/HEAD', 'ref: refs/heads/main\n')
  // A vault with nothing pending: the archives raise no alarm.
  fs.write('/home/magos/.singularity.json', '{"vault_path": "/home/magos/vault"}')
  on('session.turns', () => ({ value: turns() }))
  on('session.root', () => ({ value: root }))
  on('session.repo', () => ({ value: { root: '/home/magos/forge', remote: null, internal: false, name: null } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
  on('process.run', (_$, e) => {
    ran.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never }
  })
  return { ran, fs }
}

function band($: Engine, o: { cols?: number; rows?: number; isWorking?: boolean } = {}) {
  const rows = o.rows ?? 24
  return $.ui.mount({
    plugin: 'mission-control',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: o.isWorking ?? false, maxRows: rows, bodyColumns: o.cols ?? 160, scroll: { offset: 0, bodyRows: rows }, view: {} },
  })
}

test('the herald: under the logo, the aquila and the session in an exact frame while the conversation is empty', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on, { env: { HOME: '/home/magos' } })
  const { ran } = session(on, () => 0)
  await $.session.start(SESSION)
  await engine.clock.advance(6000)
  const ui = await band($)
  const shown = screen(await ui.drawn())
  expect(shown).toContain('✠ КОГИТАТОР ИМПЕРИУМА ✠')
  expect(shown).toContain('v2.1.300')
  expect(shown).toContain('ДУХ МАШИНЫ ▸ Opus 5.5')
  expect(shown).toContain('ПРИЧАЛ     ▸ ~/forge · ветвь main')
  expect(shown).toContain('ДУХ МАШИНЫ ПРОБУЖДЁН')
  expect(shown).toContain('ДАТА ИМПЕРИИ ')
  expect(shown).toContain(' /mc ')
  // Nothing counted before the first request: no «≈0 · ?» on the archives' row.
  expect(shown).toContain('АРХИВЫ     ▸ ☩ тревог нет')
  // The aquila in blocks over the frame (the terminal draws no pictures here).
  const lines = shown.split('\n')
  const top = lines.findIndex(l => l.startsWith('╔'))
  expect(top).toBeGreaterThanOrEqual(3)
  expect(lines.slice(0, top).some(l => /[▀-▟]/.test(l))).toBe(true)
  // Every row of the frame is exactly as wide as the card.
  for (const row of lines.slice(top).filter(l => /^[╔║╚]/.test(l))) expect(cells(row.trimEnd())).toBe(HERALD_MAX_COLS)
  await ui.unmount()
  // The branch comes from .git/HEAD: the drawing never waits on a git process.
  expect(ran.filter(r => r.startsWith('git ')).length).toBe(0)
})

test('the herald names a worktree’s own branch, from the folder its .git file points to', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on, { env: { HOME: '/home/magos' } })
  const { fs } = session(on, () => 0, '/home/magos/forge-wt')
  fs.write('/home/magos/forge-wt/.git', 'gitdir: /home/magos/forge/.git/worktrees/wt\n')
  fs.write('/home/magos/forge/.git/worktrees/wt/HEAD', 'ref: refs/heads/feature/herald\n')
  await $.session.start(SESSION)
  await engine.clock.advance(6000)
  const ui = await band($)
  expect(screen(await ui.drawn())).toContain('~/forge-wt · ветвь feature/herald')
  await ui.unmount()
})

test('the herald carries the awakening’s gauge while it plays', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on)
  session(on, () => 0)
  await $.session.start(SESSION)
  await engine.clock.advance(1300)
  const ui = await band($)
  const shown = screen(await ui.drawn())
  expect(shown).toContain('ИНИЦИАЦИЯ ДУХА МАШИНЫ')
  expect(shown).toContain('✠ КОГИТАТОР ИМПЕРИУМА ✠')
  await ui.unmount()
})

test('the herald gives way to the archives once a prompt is sent, and while a turn runs', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on)
  let turns = 0
  session(on, () => turns)
  await $.session.start(SESSION)
  await engine.clock.advance(6000)
  let ui = await band($, { isWorking: true })
  expect(screen(await ui.drawn())).not.toContain('КОГИТАТОР ИМПЕРИУМА')
  await ui.unmount()
  turns = 1
  ui = await band($)
  const shown = screen(await ui.drawn())
  expect(shown).not.toContain('КОГИТАТОР ИМПЕРИУМА')
  expect(shown).toContain(' АРХИВЫ  хуки ≈')
  await ui.unmount()
})

test('a short band keeps the card and leaves the aquila out', WARHAMMER_OPTIONS, async ($, on) => {
  const engine = engineBeneath(on)
  session(on, () => 0)
  await $.session.start(SESSION)
  await engine.clock.advance(6000)
  const ui = await band($, { rows: 10, cols: 70 })
  const lines = screen(await ui.drawn()).split('\n')
  expect(lines[0]?.startsWith('╔')).toBe(true)
  for (const row of lines.filter(l => /^[╔║╚]/.test(l))) expect(cells(row.trimEnd())).toBe(70)
  await ui.unmount()
})

test('the classic look has no herald', async ($, on) => {
  engineBeneath(on)
  session(on, () => 0)
  await $.session.start(SESSION)
  const ui = await band($)
  expect(screen(await ui.drawn())).not.toContain('КОГИТАТОР ИМПЕРИУМА')
  await ui.unmount()
})

test('homeShort writes the home folder as ~ and leaves other paths alone', () => {
  expect(homeShort('/home/magos/forge', '/home/magos')).toBe('~/forge')
  expect(homeShort('/home/magos', '/home/magos/')).toBe('~')
  expect(homeShort('/home/magosx/forge', '/home/magos')).toBe('/home/magosx/forge')
  expect(homeShort('/srv/forge', null)).toBe('/srv/forge')
})

test('modelName names a model as the engine’s logo does', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1 · 1M')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('Opus 5.5')).toBe('Opus 5.5')
})

test('branchOf reads a HEAD: a branch by name, a detached head by its hash', () => {
  expect(branchOf('ref: refs/heads/main\n')).toBe('main')
  expect(branchOf('ref: refs/heads/feature/x')).toBe('feature/x')
  expect(branchOf('83948bb0123456789abcdef0123456789abcdef0\n')).toBe('@83948bb')
  expect(branchOf('garbage')).toBeNull()
})
