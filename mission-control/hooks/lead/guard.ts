// The spawn guard of the team-lead layer (spec 6.3, 6.7). Pure: facts in, one decision out.
// The model a spawn gets when none is named is the engine's business (CLAUDE_CODE_SUBAGENT_MODEL), not decided here.

import type { Lead } from '../../types'
import type { LeadConfig } from './config'
import { budgetLeft, isExhausted } from './ledger'
import { isFable } from './price'

export type SpawnFacts = {
  model?: string
  prompt: string
  subagentType: string
  fork: boolean
  isWorkflow: boolean
  isResume: boolean
  runId: string | null
}

export type SpawnDecision =
  | { kind: 'pass' }
  | { kind: 'rewrite'; model: string; note: string }
  | { kind: 'deny'; reason: string }
  | { kind: 'note'; note: string }

/** The three council skills put one of these in the prompt of every member they spawn (checked in the engine's skills). */
export const COUNCIL_MARKERS: readonly string[] = ['COUNCIL MISSION', 'PLANNING MISSION', 'SRE MISSION']
/** The commands that open the council window. */
export const COUNCIL_COMMANDS: readonly string[] = ['council', 'planning-council', 'observation-council']

export const FABLE_REASON_MARKER = 'ПОЧЕМУ FABLE:'

const DENY_COUNCIL = 'Council запускается только командой владельца — попроси его'
const DENY_BUDGET = 'бюджет исчерпан — остановись и спроси владельца'

const isCouncilPrompt = (prompt: string): boolean => COUNCIL_MARKERS.some((m) => prompt.includes(m))

// A non-empty text must follow the marker on its own line.
const hasFableReason = (prompt: string): boolean => new RegExp(`${FABLE_REASON_MARKER}[ \\t]*\\S`).test(prompt)

/**
 * Order: council, Fable, budget, fork. A deny of any step wins over a rewrite of an earlier one.
 * A fork or a resume is never rewritten: the engine ignores a fork's model and a resume keeps its own.
 */
export function decideSpawn(f: SpawnFacts, l: Lead, c: LeadConfig): SpawnDecision {
  const rewritable = !f.fork && !f.isResume
  let rewrite: { model: string; note: string } | null = null

  if (isCouncilPrompt(f.prompt)) {
    if (l.councilTurn === null) return { kind: 'deny', reason: DENY_COUNCIL }
    if (rewritable && (f.model === undefined || isFable(f.model))) {
      rewrite = { model: 'opus', note: 'council: модель → opus' }
    }
  }

  if (rewrite === null && rewritable && isFable(f.model)) {
    if (f.isWorkflow) {
      rewrite = { model: 'opus', note: 'Fable в workflow → opus' }
    } else if (f.subagentType !== 'advisor') {
      return { kind: 'deny', reason: 'Fable только через advisor' }
    } else if (!hasFableReason(f.prompt)) {
      return { kind: 'deny', reason: `нет строки ${FABLE_REASON_MARKER}` }
    } else if (l.fableCalls >= c.fableCap) {
      return { kind: 'deny', reason: `лимит вызовов Fable исчерпан (${l.fableCalls}/${c.fableCap})` }
    }
  }

  if (c.mode === 'enforce' && (l.halted || isExhausted(budgetLeft(l, c, { agentId: null, runId: f.runId })))) {
    return { kind: 'deny', reason: DENY_BUDGET }
  }

  if (rewrite !== null) return { kind: 'rewrite', ...rewrite }
  if (f.fork) return { kind: 'note', note: 'форк · модель лида' }
  return { kind: 'pass' }
}
