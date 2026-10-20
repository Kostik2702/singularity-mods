import { expect, test } from 'claude-code/testing'

import { screen } from './paint'
import { SESSION_ID, engineBeneath, fakeFs, runCommand } from './helpers'

const SESSION = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const LOG = '/vault/.mb/machines/host1/jev/log.jsonl'
const PREV = '/vault/.mb/machines/host1/jev/log.1.jsonl'
/** The tab is open and HOME is known: the poll runs only while the tab is up. */
const OPEN = { env: { HOME: '/home/u' }, panes: [{ id: 'jev', title: 'Jev' }] }
const SURFACES = ['terminal', 'desktop'] as const

const line = (o: Record<string, unknown> = {}): string =>
  `${JSON.stringify({
    ts: '2026-10-20T11:02:03.123+03:00',
    session: SESSION_ID,
    kind: 'router',
    head: 'почини парсер',
    size: 'small',
    confidence: 0.71,
    decided: 'jev',
    route: 'haiku·low',
    cost: 0.000125,
    ms: 812,
    error: null,
    test: false,
    ...o,
  })}\n`

const result = (exitCode: number, stdout: string) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

/** `mb jev status --json` answered beneath the plugin; `mb` itself is never run. */
function cli(on: Parameters<typeof engineBeneath>[0], status: Record<string, unknown> | null, host = 'host1', log = '') {
  const asked: string[][] = []
  on('process.run', (_$, e) => {
    asked.push([...e.argv])
    const [bin] = e.argv
    if (bin === 'mb' && e.argv[2] === 'log') return { value: result(0, log) }
    if (bin === 'mb') {
      return { value: result(status === null ? 127 : 0, status === null ? '' : JSON.stringify(status)) }
    }
    return { value: result(0, `${host}\n`) }
  })
  return asked
}

async function mountJev($: Parameters<typeof runCommand>[0], surface: 'terminal' | 'desktop') {
  return $.ui.mount({
    plugin: 'mission-control',
    surface,
    component: 'Pane',
    requestId: 'jev',
    props: { title: 'Jev', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
}

const STATUS = { enabled: true, key_found: true, model: 'jev-1.13.0', budget_usd: 1, journal: LOG }

test('the tab shows the header, the session and all-time cost, the balance, the counts and the journal newest first', async ($, on) => {
  const fs = fakeFs(on)
  fs.write(PREV, line({ session: 'old', cost: 0.25, head: 'вчерашний вызов' }))
  fs.write(
    LOG,
    line({ head: 'первый', cost: 0.5 }) +
      line({ head: 'второй, сам', kind: 'ask', decided: 'self', route: null, size: 'large', cost: 0.125, session: 'other' }) +
      line({ head: 'третий упал', error: 'http:401', cost: 0, test: true, size: 'tiny' }),
  )
  engineBeneath(on, OPEN)
  cli(on, STATUS)
  await $.session.start(SESSION)
  for (const surface of SURFACES) {
    const ui = await mountJev($, surface)
    expect(await ui.find({ text: /Jev включён · ключ найден · модель: jev-1\.13\.0/ })).toBeDefined()
    expect(await ui.find({ text: /эта сессия:\s\$0\.500000 · 2 выз\./ })).toBeDefined()
    expect(await ui.find({ text: /всего:\s\$0\.875000 · 4 выз\./ })).toBeDefined()
    expect(await ui.find({ text: /остаток:\s\$0\.125000/ })).toBeDefined()
    expect(await ui.find({ text: /tiny 1 · small 2 · medium 0 · large 1/ })).toBeDefined()
    expect(await ui.find({ text: /решил сам: 1 · ошибок: 1/ })).toBeDefined()
    const text = screen(await ui.drawn())
    expect(text).toMatch(/\[ТЕСТ\].*router tiny.*http:401/)
    expect(text.indexOf('третий упал')).toBeLessThan(text.indexOf('второй, сам'))
    expect(text.indexOf('второй, сам')).toBeLessThan(text.indexOf('вчерашний вызов'))
    await ui.unmount()
  }
})

test('no budget: the balance is unknown and says what to set; the key is never shown', async ($, on) => {
  const fs = fakeFs(on)
  fs.write(LOG, line())
  engineBeneath(on, OPEN)
  cli(on, { enabled: false, key_found: false, journal: LOG, api_key: 'SECRET-KEY-VALUE' })
  await $.session.start(SESSION)
  const ui = await mountJev($, 'terminal')
  expect(await ui.find({ text: /Jev выключен · ключ не найден/ })).toBeDefined()
  expect(await ui.find({ text: /остаток:\sнеизвестно — задай jev_budget_usd/ })).toBeDefined()
  expect(screen(await ui.drawn())).not.toContain('SECRET-KEY-VALUE')
  await ui.unmount()
})

test('no mb on the PATH: the path is derived from ~/.singularity.json and the host', async ($, on) => {
  const fs = fakeFs(on)
  fs.write('/home/u/.singularity.json', '{"vault_path":"/vault"}')
  fs.write(LOG, line({ cost: 0.5 }))
  engineBeneath(on, OPEN)
  const asked = cli(on, null)
  await $.session.start(SESSION)
  const ui = await mountJev($, 'terminal')
  expect(await ui.find({ text: /всего:\s\$0\.500000 · 1 выз\./ })).toBeDefined()
  expect(await ui.find({ text: /неизвестно · неизвестно · модель: —/ })).toBeDefined()
  expect(asked.some(a => a[0] === 'hostname')).toBe(true)
  await ui.unmount()
})

test('a missing journal is a normal empty tab; it fills once the first call is logged, and a half line waits', async ($, on) => {
  const fs = fakeFs(on)
  const engine = engineBeneath(on, OPEN)
  cli(on, STATUS)
  await $.session.start(SESSION)
  let ui = await mountJev($, 'terminal')
  expect(await ui.find({ text: /журнала пока нет/ })).toBeDefined()
  expect(await ui.find({ text: /Вызовов Jev пока нет\./ })).toBeDefined()
  await ui.unmount()
  fs.write(LOG, line({ cost: 0.5 }) + '{"ts":"2026-10-20T11:0')
  await engine.clock.advance(3000)
  ui = await mountJev($, 'terminal')
  expect(await ui.find({ text: /всего:\s\$0\.500000 · 1 выз\./ })).toBeDefined()
  fs.append(LOG, '5:00","session":"x","kind":"ask","cost":1}\n')
  await engine.clock.advance(3000)
  await ui.unmount()
  ui = await mountJev($, 'terminal')
  expect(await ui.find({ text: /всего:\s\$1\.500000 · 2 выз\./ })).toBeDefined()
  await ui.unmount()
})

test('/jev opens the tab and /jev close closes it; unasked, the tab is not opened and nothing is run', async ($, on) => {
  fakeFs(on)
  const engine = engineBeneath(on, { env: { HOME: '/home/u' } })
  const asked = cli(on, STATUS)
  await $.session.start(SESSION)
  await engine.clock.advance(6000)
  expect(engine.opened).not.toContain('jev')
  expect(asked).toEqual([])
  expect(await runCommand($, 'jev', '')).toMatch(/открыта/)
  expect(engine.titles.jev).toBe('Jev')
  expect(asked[0]).toEqual(['mb', 'jev', 'status', '--json'])
  expect(await runCommand($, 'jev', 'close')).toMatch(/закрыта/)
  expect(engine.closed).toContain('jev')
  expect(await runCommand($, 'jev', 'x')).toMatch(/не знаю/)
})

test('/jev status shows the text of `mb jev status`; when mb fails or is missing, one fallback line', async ($, on) => {
  fakeFs(on)
  engineBeneath(on, { env: { HOME: '/home/u' } })
  let mode: 'ok' | 'fail' | 'throw' = 'ok'
  const asked: string[][] = []
  on('process.run', (_$, e) => {
    asked.push([...e.argv])
    if (mode === 'throw') throw new Error('spawn mb ENOENT')
    return { value: mode === 'ok' ? result(0, 'Jev: enabled yes\nkey: found\n') : { ...result(1, ''), stderr: 'no vault configured\nmore' } }
  })
  await $.session.start(SESSION)
  expect(await runCommand($, 'jev', 'status')).toBe('Jev: enabled yes\nkey: found')
  expect(asked.at(-1)).toEqual(['mb', 'jev', 'status'])
  mode = 'fail'
  expect(await runCommand($, 'jev', 'status')).toBe('mb jev status недоступен: no vault configured')
  mode = 'throw'
  expect(await runCommand($, 'jev', 'status')).toMatch(/^mb jev status недоступен: \S/)
})

test("the engine's own figures are shown when the status gives them, ours otherwise", async ($, on) => {
  const fs = fakeFs(on)
  fs.write(LOG, line({ cost: 0.5 }))
  engineBeneath(on, OPEN)
  cli(on, { ...STATUS, total_cost: 7.5, session_cost: 1.25, balance_usd: 2.5 })
  await $.session.start(SESSION)
  const ui = await mountJev($, 'terminal')
  expect(await ui.find({ text: /эта сессия:\s\$1\.250000/ })).toBeDefined()
  expect(await ui.find({ text: /всего:\s\$7\.500000/ })).toBeDefined()
  expect(await ui.find({ text: /остаток:\s\$2\.500000/ })).toBeDefined()
  await ui.unmount()
})

test('a journal past the read limit is not read: the newest lines come from `mb jev log --tail 50`, and the tab says so', async ($, on) => {
  const fs = fakeFs(on)
  fs.write(LOG, line({ head: 'старый' }).padEnd(4_100_000, ' '))
  engineBeneath(on, OPEN)
  const asked = cli(on, { ...STATUS, total_cost: 3, session_cost: 1, balance_usd: -2 }, 'host1', line({ head: 'из хвоста CLI', cost: 0.5 }))
  await $.session.start(SESSION)
  const ui = await mountJev($, 'terminal')
  expect(await ui.find({ text: /журнал больше 4 МБ: показаны последние 50 строк/ })).toBeDefined()
  expect(await ui.find({ text: /из хвоста CLI/ })).toBeDefined()
  expect(await ui.find({ text: /всего:\s\$3\.000000/ })).toBeDefined()
  expect(asked.some(a => a.join(' ') === 'mb jev log --tail 50')).toBe(true)
  expect(screen(await ui.drawn())).not.toContain('старый')
  await ui.unmount()
})
