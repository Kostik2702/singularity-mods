// The Jev tab's model: pure functions from the journal's text and `mb jev status --json`
// to rows and totals. No `$` here: the poll feeds text in, the tests call these directly.
//
// The contract is the engine's journal (jev-plan §4): one JSON object per line, append-only,
// at `<vault>/.mb/machines/<host>/jev/log.jsonl`, rotated to `log.1.jsonl` past 5 MiB.
// A line the engine is still writing, or one that is not an object, is skipped, never fatal.

import type { JevEntry, JevStatus, JevSummary } from '../../types'
import { clip } from '../mission/model'

/** The journal lines shown, newest first. */
export const SHOWN = 50
/** `$.fs.read` has no range and stops at 4 MiB: a larger journal is not read, its newest lines come from `mb jev log --tail`. */
export const FULL_READ_MAX = 4_000_000
/** The journal is looked at again this often. */
export const POLL_MS = 3000
export const HEAD_MAX = 80
/** The size classes the engine writes, in the order they are counted. */
export const SIZES = ['tiny', 'small', 'medium', 'large'] as const

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** One journal line as an entry; null when it is not a JSON object (a half-written line). */
export function parseLine(line: string): JevEntry | null {
  const s = line.trim()
  if (s.length === 0 || !s.startsWith('{')) return null
  let o: unknown
  try {
    o = JSON.parse(s)
  } catch {
    return null
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  const decided = r.decided === 'jev' || r.decided === 'self' ? r.decided : null
  return {
    ts: str(r.ts) ?? '',
    session: str(r.session),
    kind: str(r.kind) ?? '?',
    head: clip((str(r.head) ?? '').replace(/\s+/g, ' ').trim(), HEAD_MAX),
    size: str(r.size),
    confidence: num(r.confidence),
    decided,
    route: str(r.route),
    // A cost that is not a number is no cost: it never poisons the sum.
    cost: Math.max(0, num(r.cost) ?? 0),
    ms: num(r.ms),
    error: str(r.error),
    test: r.test === true,
  }
}

/**
 * The entries of a journal's text, oldest first. `isCut` says the text begins mid-file
 * (a tail), so its first line may be a stump and is dropped. A last line without a
 * newline is kept only when it parses whole.
 */
export function parseJournal(text: string, isCut = false): JevEntry[] {
  const lines = text.split('\n')
  if (isCut) lines.shift()
  const out: JevEntry[] = []
  for (const line of lines) {
    const e = parseLine(line)
    if (e !== null) out.push(e)
  }
  return out
}

/** Totals over entries; `session` limits the session figure to that id (null: no session known). */
export function summarize(entries: readonly JevEntry[], session: string | null): JevSummary {
  const bySize: Record<string, number> = {}
  let total = 0
  let current = 0
  let self = 0
  let errors = 0
  let sessionCalls = 0
  for (const e of entries) {
    total += e.cost
    if (session !== null && e.session === session) {
      current += e.cost
      sessionCalls += 1
    }
    if (e.size !== null) bySize[e.size] = (bySize[e.size] ?? 0) + 1
    if (e.decided === 'self') self += 1
    if (e.error !== null) errors += 1
  }
  return { calls: entries.length, sessionCalls, sessionCost: current, totalCost: total, bySize, self, errors }
}

/** The newest `limit` entries, newest first. */
export function newest(entries: readonly JevEntry[], limit = SHOWN): JevEntry[] {
  return entries.slice(-limit).reverse()
}

/** Budget minus what was spent; null when no budget is set. */
export function balanceOf(budget: number | null, totalCost: number): number | null {
  return budget === null ? null : budget - totalCost
}

/** A cost in dollars: six decimals; zero is `$0`. */
export function fmtCost(usd: number): string {
  return usd === 0 ? '$0' : `$${usd.toFixed(6)}`
}

/** A balance can be negative; two decimals would hide the small calls, so it has six as well. */
export function fmtMoney(usd: number): string {
  return `${usd < 0 ? '-' : ''}$${Math.abs(usd).toFixed(6)}`
}

/** `2026-10-20T11:02:03.123+03:00` → `10-20 11:02:03`; what is not that stays as it is. */
export function fmtTime(ts: string): string {
  const m = /^\d{4}-(\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(ts)
  return m === null ? ts : `${m[1]} ${m[2]}`
}

/** The first of `keys` present in `o` as a value of the wanted type. */
function pick<T>(o: Record<string, unknown>, keys: readonly string[], ok: (v: unknown) => v is T): T | null {
  for (const k of keys) {
    const v = o[k]
    if (ok(v)) return v
  }
  return null
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** `mb jev status --json`, by the engine's names. A key is only ever a yes/no here. */
export function parseStatus(text: string): JevStatus | null {
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  return {
    enabled: pick(r, ['enabled'], isBool),
    keyFound: pick(r, ['key_found'], isBool),
    model: pick(r, ['model'], isStr),
    budget: pick(r, ['budget_usd'], isNum),
    journal: pick(r, ['journal'], isStr),
    totalCost: pick(r, ['total_cost'], isNum),
    sessionCost: pick(r, ['session_cost'], isNum),
    balance: pick(r, ['balance_usd'], isNum),
  }
}

/** The three figures: the engine's (`mb jev status --json`) when it gives them, else our own sums. */
export function figuresOf(summary: JevSummary, status: JevStatus | null): { totalCost: number; sessionCost: number; balance: number | null } {
  const totalCost = status?.totalCost ?? summary.totalCost
  return {
    totalCost,
    sessionCost: status?.sessionCost ?? summary.sessionCost,
    balance: status?.balance ?? balanceOf(status?.budget ?? null, totalCost),
  }
}

/** The vault from `~/.singularity.json` (key `vault_path`); null when absent. */
export function vaultOf(configText: string): string | null {
  try {
    const o = JSON.parse(configText) as Record<string, unknown>
    return isStr(o.vault_path) ? o.vault_path : null
  } catch {
    return null
  }
}

/** The engine's machine id (config.machine_id): the host name, anything outside `A-Za-z0-9_.-` an underscore, 64 at most. */
export function machineId(host: string): string {
  return host.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'unknown'
}

/** Where the engine writes the journal, derived the way it does. */
export function journalPathOf(vault: string, host: string): string {
  return `${vault.replace(/[\\/]+$/, '')}/.mb/machines/${machineId(host)}/jev/log.jsonl`
}

/** The rotated generation beside a journal. */
export function previousOf(path: string): string {
  return path.replace(/log\.jsonl$/, 'log.1.jsonl')
}
