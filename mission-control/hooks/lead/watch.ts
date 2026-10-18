// The watchdog of the team-lead layer (spec 6.5). Pure: rows and the ledger in, a new ledger and a wake text out.
// A short silence is the engine's own stall restart and not ours (mission/model.ts SILENT_MS is a display
// threshold and is not reused); the watchdog speaks only after SILENCE_MS and for a call over LONG_CALL_MS.

import type { AgentRow, Lead } from '../../types'
import { MAIN, isConfirmed, isWorking } from '../mission/model'
import { LONG_CALL_MS, SILENCE_MS } from './config'
import { pushNews } from './ledger'

export type Alarm = { agentId: string; kind: 'silent' | 'long-call'; minutes: number }

/** The lead is woken at most once per this long (spec 6.7). */
export const WAKE_GAP_MS = 10 * 60_000
/** The wake text stays within this many characters. */
export const WAKE_MAX = 600

const MIN_MS = 60_000
const LABEL_MAX = 40
const WAKE_HEAD = '[mission-control] тревога: '
const WAKE_TAIL = '. Реши: TaskStop, SendMessage или ждать.'

const keyOf = (a: Alarm): string => `${a.agentId}:${a.kind}`

/** Every alarm whose condition holds now, sent or not. */
function holding(rows: readonly AgentRow[], now: number): Alarm[] {
  const out: Alarm[] = []
  for (const r of rows) {
    if (r.id === MAIN || !isConfirmed(r) || !isWorking(r.phase)) continue
    if (r.phase !== 'waiting' && now - r.lastEventAt >= SILENCE_MS) {
      out.push({ agentId: r.id, kind: 'silent', minutes: Math.floor((now - r.lastEventAt) / MIN_MS) })
    }
    if (r.current !== null && r.current.status === 'run' && now - r.current.startedAt > LONG_CALL_MS) {
      out.push({ agentId: r.id, kind: 'long-call', minutes: Math.floor((now - r.current.startedAt) / MIN_MS) })
    }
  }
  return out
}

/**
 * New alarms: a working, confirmed, non-main agent silent for SILENCE_MS (a waiting one never is), or whose
 * running call started more than LONG_CALL_MS ago. One already in `sent` under `${agentId}:${kind}` is not repeated.
 */
export function alarmsOf(rows: readonly AgentRow[], now: number, sent: Record<string, number>): Alarm[] {
  return holding(rows, now).filter(a => !(keyOf(a) in sent))
}

/**
 * `sent` without the alarms whose condition is gone (the agent showed a new event, the call ended, the agent
 * ended): the next silence or long call of that agent alarms again. The same object when nothing is dropped.
 */
export function rearmed(rows: readonly AgentRow[], now: number, sent: Record<string, number>): Record<string, number> {
  const live = new Set(holding(rows, now).map(keyOf))
  const keys = Object.keys(sent)
  if (keys.every(k => live.has(k))) return sent
  return Object.fromEntries(keys.filter(k => live.has(k)).map(k => [k, sent[k] ?? 0]))
}

/** The lead's last event was the end of its turn: it waits for the person (main phase idle or done). */
export function leadIdle(rows: readonly AgentRow[]): boolean {
  const main = rows.find(r => r.id === MAIN)
  return main === undefined || main.phase === 'idle' || main.phase === 'done'
}

/** A wake is allowed when none was sent yet or the last one is WAKE_GAP_MS old. */
export function mayWake(l: Lead, now: number): boolean {
  return l.lastWakeAt === null || now - l.lastWakeAt >= WAKE_GAP_MS
}

function labelOf(rows: readonly AgentRow[], agentId: string): string {
  const row = rows.find(r => r.id === agentId)
  if (row === undefined) return agentId
  const text = [row.description, row.name ?? '', row.type].find(t => t.length > 0) ?? agentId
  const chars = [...text]
  return chars.length <= LABEL_MAX ? text : `${chars.slice(0, LABEL_MAX - 1).join('').trimEnd()}…`
}

function phrase(a: Alarm): string {
  return a.kind === 'silent' ? `нет вестей ${a.minutes} мин` : `вызов идёт ${a.minutes} мин`
}

/** One wake text for all the alarms, within WAKE_MAX; what does not fit is counted. */
function wakeText(rows: readonly AgentRow[], alarms: readonly Alarm[]): string {
  const parts = alarms.map(a => `${labelOf(rows, a.agentId)} — ${phrase(a)}`)
  const fit: string[] = []
  for (const [i, part] of parts.entries()) {
    const rest = parts.length - i - 1
    const tail = rest > 0 ? `; и ещё ${rest}` : ''
    if ((WAKE_HEAD + [...fit, part].join('; ') + tail + WAKE_TAIL).length > WAKE_MAX && fit.length > 0) {
      const left = parts.length - i
      return `${WAKE_HEAD}${fit.join('; ')}; и ещё ${left}${WAKE_TAIL}`
    }
    fit.push(part)
  }
  return `${WAKE_HEAD}${fit.join('; ')}${WAKE_TAIL}`
}

/**
 * One watchdog pass. Every new alarm goes to the news and into `alarmsSent`; when the lead is idle and a wake
 * is allowed, all of them make one wake text and `lastWakeAt` is set. The same `l` when there is nothing to do.
 */
export function watchStep(l: Lead, rows: readonly AgentRow[], now: number): { lead: Lead; wake: string | null } {
  const sent = rearmed(rows, now, l.alarmsSent)
  const alarms = alarmsOf(rows, now, sent)
  if (alarms.length === 0) return { lead: sent === l.alarmsSent ? l : { ...l, alarmsSent: sent }, wake: null }
  let lead: Lead = { ...l, alarmsSent: { ...sent, ...Object.fromEntries(alarms.map(a => [keyOf(a), now])) } }
  for (const a of alarms) lead = pushNews(lead, `${labelOf(rows, a.agentId)} — ${phrase(a)}`)
  if (!leadIdle(rows) || !mayWake(l, now)) return { lead, wake: null }
  return { lead: { ...lead, lastWakeAt: now }, wake: wakeText(rows, alarms) }
}
