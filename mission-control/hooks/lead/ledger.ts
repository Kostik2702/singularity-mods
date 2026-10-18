// The OE ledger of the team-lead layer. Pure: every function returns a new object, never mutates its input.

import type { Lead } from '../../types'
import type { LeadConfig } from './config'

export const EMPTY_LEAD: Lead = Object.freeze({
  byAgent: Object.freeze({}),
  byRun: Object.freeze({}),
  session: 0,
  extra: 0,
  fableCalls: 0,
  councilTurn: null,
  halted: false,
  solo: false,
  rewrites: 0,
  denials: 0,
  news: Object.freeze([]) as unknown as string[],
  alarmsSent: Object.freeze({}),
  lastWakeAt: null,
  flags: Object.freeze([]) as unknown as string[],
})

const NEWS_KEEP = 20

/**
 * Add one request's OE. Main (agentId null) counts into the session only; an agent counts into
 * itself, the session and, inside a workflow, its run. A bad oe adds 0: a NaN would make every
 * budget comparison false.
 */
export function addUsage(l: Lead, f: { agentId: string | null; runId: string | null; oe: number }): Lead {
  const oe = Number.isFinite(f.oe) && f.oe > 0 ? f.oe : 0
  const next: Lead = { ...l, session: l.session + oe }
  if (f.agentId === null) return next
  next.byAgent = { ...l.byAgent, [f.agentId]: (l.byAgent[f.agentId] ?? 0) + oe }
  if (f.runId !== null) next.byRun = { ...l.byRun, [f.runId]: (l.byRun[f.runId] ?? 0) + oe }
  return next
}

/** OE left under each limit; null = no limit. Never below 0. */
export function budgetLeft(
  l: Lead,
  c: LeadConfig,
  f: { agentId: string | null; runId: string | null },
): { session: number | null; run: number | null; agent: number | null } {
  const left = (limit: number | null, spent: number) => (limit === null ? null : Math.max(0, limit - spent))
  return {
    session: c.sessionBudget === null ? null : left(c.sessionBudget + l.extra, l.session),
    run: f.runId === null ? null : left(c.runBudget, l.byRun[f.runId] ?? 0),
    agent: f.agentId === null ? null : left(c.agentBudget, l.byAgent[f.agentId] ?? 0),
  }
}

export function isExhausted(left: { session: number | null; run: number | null; agent: number | null }): boolean {
  return [left.session, left.run, left.agent].some((v) => v !== null && v <= 0)
}

export function pushNews(l: Lead, line: string): Lead {
  return { ...l, news: [...l.news, line].slice(-NEWS_KEEP) }
}
