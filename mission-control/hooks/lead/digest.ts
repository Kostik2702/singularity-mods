// The change-only digest for the lead (spec 6.6). Pure: no atoms. `digestOf` says what is new since the
// last digest; `afterDigest` is the ledger once that text has been delivered.

import type { Lead } from '../../types'
import type { LeadConfig } from './config'
import { budgetLeft } from './ledger'

/** The whole digest, in characters. */
export const DIGEST_MAX = 600
/** One line never takes more than this, so a single long news line cannot eat the whole digest. */
const LINE_MAX = 200

const FLAG_80 = 'budget80'
const FLAG_100 = 'budget100'
const SOLO_LINE = 'владелец: дальше делай сам, не делегируй'
const LINE_80 = 'бюджет сессии: 80 %'
const LINE_100 = 'бюджет сессии исчерпан'

const oe = (n: number): string => String(Math.round(n))

function clip(line: string): string {
  return line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX - 1)}…`
}

/** Identical lines in one, «×N», in the order they first appeared. */
function merged(news: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const line of news) counts.set(line, (counts.get(line) ?? 0) + 1)
  return [...counts].map(([line, n]) => clip(n > 1 ? `${line} ×${n}` : line))
}

/** The budget and solo lines that are due, in the order the lead must read them. */
function headOf(l: Lead, c: LeadConfig): string[] {
  const head: string[] = []
  const left = budgetLeft(l, c, { agentId: null, runId: null }).session
  if (left !== null && c.sessionBudget !== null) {
    const limit = c.sessionBudget + l.extra
    if (left <= 0) {
      if (!l.flags.includes(FLAG_100)) {
        head.push(`${LINE_100}: потрачено ${oe(l.session)} OE — остановись и спроси владельца`)
      }
    } else if (l.session * 100 >= limit * 80 && !l.flags.includes(FLAG_80)) {
      head.push(`${LINE_80} (потрачено ${oe(l.session)} из ${oe(limit)} OE)`)
    }
  }
  if (l.solo) head.push(SOLO_LINE)
  return head
}

/**
 * What the lead has not heard yet, or null when nothing changed. Budget and solo lines go first and are
 * never cut; the news follows, merged, and is cut on a line boundary with «…и ещё N» to stay within
 * DIGEST_MAX.
 */
export function digestOf(l: Lead, c: LeadConfig): string | null {
  const head = headOf(l, c)
  const news = merged(l.news)
  if (head.length === 0 && news.length === 0) return null
  const join = (lines: string[], rest: number): string =>
    (rest > 0 ? [...lines, `…и ещё ${rest}`] : lines).join('\n')
  for (let shown = news.length; shown >= 0; shown -= 1) {
    const text = join([...head, ...news.slice(0, shown)], news.length - shown)
    if (text.length <= DIGEST_MAX) return text
  }
  return join(head, 0).slice(0, DIGEST_MAX)
}

/**
 * The ledger once `text` (a digest) has reached the lead: the news and the solo line are spent, and the
 * budget lines that were in it are not said again. Exhausted settles the 80 % line too.
 */
export function afterDigest(l: Lead, text: string): Lead {
  const flags = [...l.flags]
  const add = (f: string): void => {
    if (!flags.includes(f)) flags.push(f)
  }
  // Budget lines are the first lines of a digest; a news line that merely mentions them does not count.
  const lines = text.split('\n')
  if (lines.some(line => line.startsWith(LINE_100))) {
    add(FLAG_80)
    add(FLAG_100)
  } else if (lines.some(line => line.startsWith(LINE_80))) {
    add(FLAG_80)
  }
  return { ...l, news: [], solo: false, flags }
}

/** One atomic take: the digest due now (or null, lead unchanged) and the ledger after delivering it. */
export function takeDigest(l: Lead, c: LeadConfig): { lead: Lead; text: string | null } {
  const text = digestOf(l, c)
  return text === null ? { lead: l, text: null } : { lead: afterDigest(l, text), text }
}
