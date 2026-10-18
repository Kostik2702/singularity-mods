// The «запущен» and «закончил» lines of the lead's digest (spec 6.6). Pure: facts in, one line out.

import type { AgentRow } from '../../types'
import { int } from './team'

/** How the news names an agent: its task, else its name or type, else the fallback (its id). */
export function agentLabel(parts: { description: string; name: string | null; type: string }, fallback: string): string {
  return [parts.description, parts.name ?? '', parts.type].find(t => t.length > 0) ?? fallback
}

/** The same for a row. */
export const rowLabel = (row: AgentRow): string => agentLabel(row, row.id)

/**
 * An executor started: «запущен: задача · ярус · effort». A tier or an effort not known yet is «—» (a spawn
 * carries no effort: the row learns it from the first request). A spawn that does not run in the background is
 * marked, because the watchdog cannot help a foreground one.
 */
export function startedLine(f: { label: string; tier: string | null; effort: string | null; background: boolean }): string {
  const line = `запущен: ${f.label} · ${f.tier ?? '—'} · ${f.effort ?? '—'}`
  return f.background ? line : `${line} · не в фоне`
}

/** An executor's run ended: «закончил: задача · исход · N OE», N the OE of that run, a whole number. */
export function endedLine(f: { label: string; outcome: string; oe: number }): string {
  return `закончил: ${f.label} · ${f.outcome} · ${int(f.oe)} OE`
}
