// The «запущен» and «закончил» lines of the lead's digest (spec 6.6). Pure: facts in, one line out.
// Several of them in one digest are of one type and merge into one line («однотипные строки сливаются»).

import type { AgentRow } from '../../types'

const STARTED = 'запущен: '
const ENDED = 'закончил: '
const FOREGROUND = ' · не в фоне'
const SEP = ' · '
const DASH = '—'

/** A whole number of OE, as the team table writes it. */
const whole = (n: number): string => String(Math.round(n))

/** How the news names an agent: its task, else its name or type, else the fallback (its id). */
export function agentLabel(parts: { description: string; name: string | null; type: string }, fallback: string): string {
  return [parts.description, parts.name ?? '', parts.type].find(t => t.length > 0) ?? fallback
}

/** The same for a row. */
export const rowLabel = (row: AgentRow): string => agentLabel(row, row.id)

/**
 * An executor started: «запущен: задача · ярус · effort». A tier or an effort not known yet is «—» (a spawn
 * carries no effort: the row learns it from the first request). A spawn that does not run in the background is
 * marked, because the watchdog cannot help a foreground one; `background` is true for a workflow agent, to which
 * the engine's `background` does not apply.
 */
export function startedLine(f: { label: string; tier: string | null; effort: string | null; background: boolean }): string {
  const line = `${STARTED}${f.label}${SEP}${f.tier ?? DASH}${SEP}${f.effort ?? DASH}`
  return f.background ? line : `${line}${FOREGROUND}`
}

/** An executor's run ended: «закончил: задача · исход · N OE», N the OE of that run, a whole number. */
export function endedLine(f: { label: string; outcome: string; oe: number }): string {
  return `${ENDED}${f.label}${SEP}${f.outcome}${SEP}${whole(f.oe)} OE`
}

type Started = { label: string; tier: string; effort: string; foreground: boolean }
type Ended = { label: string; outcome: string; oe: number }

/** Reads a start line back; the label may hold the separator, so the fields are taken from the right. */
function parseStarted(line: string): Started | null {
  if (!line.startsWith(STARTED)) return null
  let rest = line.slice(STARTED.length)
  const foreground = rest.endsWith(FOREGROUND)
  if (foreground) rest = rest.slice(0, -FOREGROUND.length)
  const parts = rest.split(SEP)
  const effort = parts.pop()
  const tier = parts.pop()
  if (effort === undefined || tier === undefined || parts.length === 0) return null
  return { label: parts.join(SEP), tier, effort, foreground }
}

function parseEnded(line: string): Ended | null {
  if (!line.startsWith(ENDED)) return null
  const parts = line.slice(ENDED.length).split(SEP)
  const spent = /^(\d+) OE$/.exec(parts.pop() ?? '')
  const outcome = parts.pop()
  if (spent === null || outcome === undefined || parts.length === 0) return null
  return { label: parts.join(SEP), outcome, oe: Number(spent[1]) }
}

/** A start or an end line (one the cap may drop before any other news, and the digest merges). */
export const isRoutine = (line: string): boolean => parseStarted(line) !== null || parseEnded(line) !== null

/** «entry», «entry ×N» for the same entry told N times, in the order they first appeared. */
function counted(entries: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e, (counts.get(e) ?? 0) + 1)
  return [...counts].map(([e, n]) => (n > 1 ? `${e} ×${n}` : e)).join('; ')
}

function startedGroup(all: readonly Started[]): string {
  const outside = all.filter(s => s.foreground).length
  const entries = all.map(s => {
    const marks = [s.tier, s.effort].filter(t => t !== DASH)
    if (s.foreground) marks.push(FOREGROUND.slice(SEP.length))
    return marks.length === 0 ? s.label : `${s.label} (${marks.join(', ')})`
  })
  return `запущены: ${all.length}${outside > 0 ? ` (${FOREGROUND.slice(SEP.length)}: ${outside})` : ''} — ${counted(entries)}`
}

function endedGroup(all: readonly Ended[]): string {
  const total = all.reduce((sum, e) => sum + e.oe, 0)
  return `закончили: ${all.length} (${whole(total)} OE) — ${counted(all.map(e => `${e.label} (${e.outcome}, ${whole(e.oe)} OE)`))}`
}

/**
 * The news with its start lines made one line and its end lines made one line. The merged line stands where the
 * first of its kind stood. Exactly one line of a kind keeps its own format; a line that does not read back stays.
 */
export function mergedRoutine(news: readonly string[]): string[] {
  const started = news.map(parseStarted)
  const ended = news.map(parseEnded)
  const starts = started.filter((s): s is Started => s !== null)
  const ends = ended.filter((e): e is Ended => e !== null)
  const out: string[] = []
  let startsDone = false
  let endsDone = false
  for (const [i, line] of news.entries()) {
    if (started[i] !== null && starts.length > 1) {
      if (!startsDone) out.push(startedGroup(starts))
      startsDone = true
    } else if (ended[i] !== null && ends.length > 1) {
      if (!endsDone) out.push(endedGroup(ends))
      endsDone = true
    } else {
      out.push(line)
    }
  }
  return out
}
