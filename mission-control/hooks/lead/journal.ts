// The week journal (spec 6.2): one JSON line per finished executor, in a file outside the repository, so the
// week's numbers (OE by tier, turns, time, outcome) can be read back and the quality check of spec 7 run on them.
// The engine's $.fs has no append and refuses a read or write over 4 MiB, so a line is added by reading the file and
// writing it whole; the file therefore rotates well under that limit.

import type { EngineInterface } from 'claude-code'

import type { AgentRow } from '../../types'
import { tierOf } from './price'

type $ = EngineInterface

export const JOURNAL_FILE = 'lead-journal.jsonl'
export const JOURNAL_PREV = 'lead-journal.1.jsonl'
/** A file that would pass this many bytes becomes the previous one (3 MiB: $.fs.read and $.fs.write reject over 4 MiB). */
export const ROTATE_BYTES = 3 * 1024 * 1024

const PLUGIN_DIR = 'plugins/data/mission-control'

/**
 * The journal line of a finished executor: exactly `ts, type, tier, effort, turns, oe, ms, outcome`.
 * `type` is the subagentType, `tier` the model family (`?` when the table does not know the model), `turns` the
 * model steps it made, `oe` its own Opus-equivalent spend, `ms` its run time, `outcome` its final phase. All
 * three numbers cover the run that just ended (since the spawn or the last resume), not the row's lifetime.
 */
export function journalLine(row: AgentRow): string {
  const ts = row.endedAt ?? row.lastEventAt
  return JSON.stringify({
    ts,
    type: row.type,
    tier: tierOf(row.model) ?? '?',
    effort: row.effort,
    // A resumed executor ends again: the line holds only the run that just ended, so lines sum to the row's total.
    turns: row.steps - (row.journaledSteps ?? 0),
    oe: row.oe - (row.journaledOe ?? 0),
    ms: Math.max(0, ts - (row.runStartedAt ?? row.startedAt)),
    outcome: row.phase,
  })
}

/** The plugin's data directory: CLAUDE_PLUGIN_DATA, else `<config dir>/plugins/data/mission-control`; null when no home is known. */
async function dataDir($: $): Promise<string | null> {
  const given = await $.env.get('CLAUDE_PLUGIN_DATA')
  if (given !== undefined && given.length > 0) return given.replace(/[\\/]+$/, '')
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config !== undefined && config.length > 0) return `${config.replace(/[\\/]+$/, '')}/${PLUGIN_DIR}`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined || home.length === 0) return null
  return `${home.replace(/[\\/]+$/, '')}/.claude/${PLUGIN_DIR}`
}

async function appendWhole($: $, line: string): Promise<void> {
  const dir = await dataDir($)
  if (dir === null) return
  const path = `${dir}/${JOURNAL_FILE}`
  const text = `${line}\n`
  if (!(await $.fs.exists(path))) {
    await $.fs.write(path, text)
    return
  }
  const old = await $.fs.read(path)
  if (typeof old !== 'string') return
  if (old.length + text.length > ROTATE_BYTES) {
    await $.fs.write(`${dir}/${JOURNAL_PREV}`, old)
    await $.fs.write(path, text)
    return
  }
  await $.fs.write(path, old + text)
}

// Two executors ending together would each read the same file and the later write would drop the other's line.
let queue: Promise<void> = Promise.resolve()

/** Adds the line to the journal. Never throws: a journal that cannot be written must not break turn.complete. */
export function appendJournal($: $, line: string): Promise<void> {
  queue = queue.then(
    () => appendWhole($, line).catch(() => undefined),
    () => undefined,
  )
  return queue
}
