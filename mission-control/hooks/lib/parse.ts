// Pure helpers: no `$`, so the tests exercise them directly.

/** Note types the vault index reports (`mb stats` by type), plus the generic tags `mb search` prints. */
const MEMORY_TAGS = new Set([
  'memory', 'learning', 'rule', 'decision', 'reference', 'howto', 'incident',
  'moc', 'project', 'changelog', 'task', 'epic', 'source', 'session',
])

/** One `mb search` / `mb code` invocation found inside a shell command. */
export type MbInvocation = { kind: 'search' | 'code'; query: string; isCodeOnly: boolean }

export type ParsedHits = {
  hits: number
  memHits: number
  codeHits: number
  best: number | null
  paths: string[]
}

const MB_SEGMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\S*[\\/])?mb(?:\.exe)?\s+(search|code)\b(.*)$/s

/**
 * Finds every `mb search` / `mb code` in a command line. Segments are split on
 * `&&`, `||`, `;`, `|` and newlines, so `cd x && mb search "q" | head` counts once,
 * and `mb learn "... mb search ..."` (mb search inside a quoted argument) does not.
 */
export function findMbInvocations(command: string): MbInvocation[] {
  const found: MbInvocation[] = []
  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    const match = MB_SEGMENT.exec(raw.trim())
    if (match === null) continue
    const kind = match[1] === 'code' ? 'code' : 'search'
    const rest = match[2] ?? ''
    found.push({ kind, query: extractQuery(rest), isCodeOnly: kind === 'code' || /--code-only\b/.test(rest) })
  }
  return found
}

/** The first quoted argument, else the first non-flag word. */
export function extractQuery(rest: string): string {
  const quoted = /"([^"]*)"|'([^']*)'/.exec(rest)
  if (quoted !== null) return (quoted[1] ?? quoted[2] ?? '').trim()
  const word = rest.trim().split(/\s+/).find(part => part.length > 0 && !part.startsWith('-'))
  return word ?? ''
}

const TEXT_ROW = /^\s*\d+\.\s+(.+?)\s+\|\s+(-?\d*\.?\d+)\s+\|\s+\[([^\]]+)\]/

type JsonHit = { score?: unknown; source?: unknown; meta?: { file?: unknown } }

/**
 * Parses `mb search` output: the text rows (`1. path | 0.61 | [memory] | ...`) or
 * the `--json` document. A row is memory when its tag is a vault note type,
 * code otherwise; `isCodeOnly` forces code.
 */
export function parseSearchOutput(text: string, isCodeOnly: boolean): ParsedHits {
  const acc: ParsedHits = { hits: 0, memHits: 0, codeHits: 0, best: null, paths: [] }
  const add = (path: string, score: number, isCode: boolean): void => {
    acc.hits += 1
    if (isCode) acc.codeHits += 1
    else acc.memHits += 1
    if (Number.isFinite(score) && (acc.best === null || score > acc.best)) acc.best = score
    if (!acc.paths.includes(path)) acc.paths.push(path)
  }

  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const doc = JSON.parse(trimmed) as { results?: JsonHit[] }
      for (const hit of doc.results ?? []) {
        const file = typeof hit.meta?.file === 'string' ? hit.meta.file : ''
        const score = typeof hit.score === 'number' ? hit.score : Number.NaN
        add(file, score, isCodeOnly || hit.source === 'code')
      }
      return acc
    } catch {
      // not one JSON document (several commands' output joined): fall through to rows
    }
  }

  for (const line of text.split('\n')) {
    const row = TEXT_ROW.exec(line)
    if (row === null) continue
    const tag = (row[3] ?? '').split('@')[0]?.trim().toLowerCase() ?? ''
    add((row[1] ?? '').trim(), Number(row[2]), isCodeOnly || !MEMORY_TAGS.has(tag))
  }
  return acc
}

/**
 * Rough token estimate for text the engine does not count for us: ~4 chars per
 * token for ASCII, ~2.5 for everything else (Cyrillic costs more per char).
 */
export function estimateTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4 + other / 2.5)
}

/** FNV-1a, 32 bit, hex: identity for an injection's text. */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 1234 -> "1.2k", 999 -> "999". */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** Short names for the settings-hook events the band shows side by side. */
export function shortEvent(event: string): string {
  const known: Record<string, string> = {
    SessionStart: 'SS',
    UserPromptSubmit: 'UPS',
    PreToolUse: 'PTU',
    PostToolUse: 'PoTU',
    SubagentStart: 'SubS',
  }
  return known[event] ?? event
}

/** Does a Read of `filePath` open one of the paths a search returned (vault- or repo-relative)? */
export function matchesHitPath(filePath: string, hitPaths: readonly string[]): string | undefined {
  const norm = filePath.replace(/\\/g, '/').toLowerCase()
  return hitPaths.find(p => {
    const hit = p.replace(/\\/g, '/').toLowerCase()
    return hit.length > 0 && (norm === hit || norm.endsWith(`/${hit}`))
  })
}

/** Counts WARN/FAIL checks in Singularity's cached `.mb/doctor-last.json`. */
export function countDoctor(json: string): { warn: number; fail: number } {
  const doc = JSON.parse(json) as { checks?: { status?: unknown }[] }
  let warn = 0
  let fail = 0
  for (const check of doc.checks ?? []) {
    if (check.status === 'WARN') warn += 1
    else if (check.status === 'FAIL') fail += 1
  }
  return { warn, fail }
}
