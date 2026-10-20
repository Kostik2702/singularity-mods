import type { ElementTable } from 'claude-code'

import type { JevState } from '../../types'
import { CLASSIC, themedRule } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { SIZES, figuresOf, fmtCost, fmtMoney, fmtTime } from './model'

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

export type JevPaneData = {
  /** Null until the first poll has answered. */
  jev: JevState | null
}

/** After a label: the terminal trims a plain space at the end of a flex child. */
const NBSP = String.fromCharCode(0xa0)

function yesNo(v: boolean | null, yes: string, no: string): string {
  return v === null ? 'неизвестно' : v ? yes : no
}

/**
 * The Jev tab: whether the router is on and a key is found, what this session and all
 * time cost, the balance left of the budget, the counts, and the journal's newest calls.
 */
export function drawJevPane(table: ElementTable, d: JevPaneData, cols: number, rows: number, t: Theme = CLASSIC) {
  const { Box, Text } = table
  const c = t.colors
  const inner = Math.max(20, cols - 2)
  const j = d.jev
  const rule = (title: string) => {
    const r = themedRule(t, title, inner)
    return (
      <Text wrap="truncate-end">
        <Text color={c.rule}>{r.lead}</Text>
        <Text color={c.muted} bold>
          {r.title}
        </Text>
        <Text color={c.rule}>{r.tail}</Text>
      </Text>
    )
  }
  const field = (label: string, value: string, color: string) => (
    <Text wrap="truncate-end">
      <Text color={c.muted}>
        {label}:{NBSP}
      </Text>
      <Text color={color}>{value}</Text>
    </Text>
  )
  const frame = (body: JSX.Element[]) => (
    <Box flexDirection="column" backgroundColor={c.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
      {body}
    </Box>
  )

  if (j === null) return frame([<Text color={c.muted}>Jev: читаю журнал…</Text>])

  const status = j.status
  const s = j.summary
  const { totalCost, sessionCost, balance } = figuresOf(s, status)
  const out: JSX.Element[] = []

  out.push(
    <Text wrap="truncate-end">
      <Text color={status?.enabled === true ? c.good : c.warning}>{yesNo(status?.enabled ?? null, 'Jev включён', 'Jev выключен')}</Text>
      <Text color={c.muted}> · </Text>
      <Text color={status?.keyFound === true ? c.good : c.warning}>{yesNo(status?.keyFound ?? null, 'ключ найден', 'ключ не найден')}</Text>
      <Text color={c.muted}> · модель: </Text>
      <Text color={c.ink}>{status?.model ?? '—'}</Text>
    </Text>,
  )
  if (j.problem !== null) {
    out.push(
      <Text color={c.warning} wrap="wrap">
        {j.problem}
      </Text>,
    )
  }

  out.push(<Box marginTop={1}>{rule('Расход')}</Box>)
  out.push(field('эта сессия', `${fmtCost(sessionCost)} · ${s.sessionCalls} выз.`, c.ink))
  out.push(field('всего', `${fmtCost(totalCost)} · ${s.calls} выз.`, c.ink))
  out.push(
    field(
      'остаток',
      balance === null ? 'неизвестно — задай jev_budget_usd' : fmtMoney(balance),
      balance === null ? c.muted : balance < 0 ? c.critical : c.good,
    ),
  )

  const sizes = SIZES.map(k => `${k} ${s.bySize[k] ?? 0}`)
  out.push(<Box marginTop={1}>{rule('Счётчики')}</Box>)
  out.push(
    <Text wrap="truncate-end" color={c.ink2}>
      {sizes.join(' · ')}
    </Text>,
  )
  out.push(
    <Text wrap="truncate-end">
      <Text color={c.ink2}>решил сам: {s.self}</Text>
      <Text color={c.muted}> · </Text>
      <Text color={s.errors > 0 ? c.critical : c.ink2}>ошибок: {s.errors}</Text>
    </Text>,
  )

  out.push(<Box marginTop={1}>{rule('Журнал')}</Box>)
  if (j.rows.length === 0) {
    out.push(
      <Text color={c.muted} wrap="wrap">
        Вызовов Jev пока нет.
      </Text>,
    )
  }
  for (const e of j.rows) {
    const conf = e.confidence === null ? '—' : e.confidence.toFixed(2)
    out.push(
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {e.test ? <Text color={c.warning}>[ТЕСТ] </Text> : ''}
          <Text color={e.error === null ? c.accent : c.critical}>{e.error === null ? t.icons.ok : t.icons.error} </Text>
          <Text color={c.muted}>{fmtTime(e.ts)} </Text>
          <Text color={c.ink} bold>
            {e.kind}
          </Text>
          <Text color={c.ink2}>
            {' '}
            {e.size ?? '—'} · уверенность {conf} · {e.decided ?? '—'} · {e.route ?? '—'} · {fmtCost(e.cost)} · {e.ms === null ? '—' : `${e.ms}мс`}
          </Text>
          {e.error === null ? '' : <Text color={c.critical}> · {e.error}</Text>}
        </Text>
        <Text wrap="truncate-end" color={c.muted}>
          {'  » '}
          {e.head}
        </Text>
      </Box>,
    )
  }
  return frame(out)
}
