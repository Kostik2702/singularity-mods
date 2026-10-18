// The spawn and request guards of the team-lead layer (spec 6.3, 6.4, 6.7). Pure: facts in, one decision out.
// The model a spawn gets when none is named is the engine's business (CLAUDE_CODE_SUBAGENT_MODEL), not decided here.

import type { Lead } from '../../types'
import type { LeadConfig } from './config'
import { budgetLeft, isExhausted } from './ledger'
import { isFable, tierOf } from './price'
import type { Tier } from './price'

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
  /** `countsAsFable`: the spawn runs on Fable (explicitly or as a bare advisor), so it uses one of the cap's calls. */
  | { kind: 'pass'; countsAsFable?: true }
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
const DENY_HALT = 'заморожено владельцем — остановись и спроси владельца'

// A marker counts only at the start of a line (indentation allowed): prose that merely mentions one is not a mission.
const atLineStart = (marker: string): RegExp => new RegExp(`^[ \\t]*${marker}`, 'm')
const COUNCIL_PATTERNS: readonly RegExp[] = COUNCIL_MARKERS.map(atLineStart)
// A non-empty text must follow the reason marker on its own line.
const FABLE_REASON: RegExp = new RegExp(`^[ \\t]*${FABLE_REASON_MARKER}[ \\t]*\\S`, 'm')

const isCouncilPrompt = (prompt: string): boolean => COUNCIL_PATTERNS.some((p) => p.test(prompt))
const hasFableReason = (prompt: string): boolean => FABLE_REASON.test(prompt)

/**
 * Order: council, Fable, budget, fork. A deny of any step wins over a rewrite of an earlier one.
 * A fork or a resume is never rewritten: the engine ignores a fork's model and a resume keeps its own.
 * The council check also runs on workflow spawns (a superset of spec 6.7, which leaves them to the rubric).
 * An advisor with no model is Fable: its own definition names the model, so the guard treats it as asked for.
 */
export function decideSpawn(f: SpawnFacts, l: Lead, c: LeadConfig): SpawnDecision {
  // The owner's halt (R19) freezes in every mode, forks and resumes included: nothing new starts.
  if (l.halted) return { kind: 'deny', reason: DENY_HALT }
  const rewritable = !f.fork && !f.isResume
  let rewrite: { model: string; note: string } | null = null
  let countsAsFable = false

  if (isCouncilPrompt(f.prompt)) {
    if (l.councilTurn === null) return { kind: 'deny', reason: DENY_COUNCIL }
    if (rewritable && (f.model === undefined || isFable(f.model))) {
      rewrite = { model: 'opus', note: 'council: модель → opus' }
    }
  }

  const isFableSpawn = isFable(f.model) || (f.subagentType === 'advisor' && (f.model === undefined || f.model === ''))
  if (rewrite === null && rewritable && isFableSpawn) {
    if (f.isWorkflow) {
      rewrite = { model: 'opus', note: 'Fable в workflow → opus' }
    } else if (f.subagentType !== 'advisor') {
      return { kind: 'deny', reason: 'Fable только через advisor' }
    } else if (!hasFableReason(f.prompt)) {
      return { kind: 'deny', reason: `нет строки ${FABLE_REASON_MARKER}` }
    } else if (l.fableCalls >= c.fableCap) {
      return { kind: 'deny', reason: `лимит вызовов Fable исчерпан (${l.fableCalls}/${c.fableCap})` }
    } else {
      countsAsFable = true
    }
  }

  if (c.mode === 'enforce' && isExhausted(budgetLeft(l, c, { agentId: null, runId: f.runId }))) {
    return { kind: 'deny', reason: DENY_BUDGET }
  }

  if (rewrite !== null) return { kind: 'rewrite', ...rewrite }
  if (f.fork) return { kind: 'note', note: 'форк · модель лида' }
  return countsAsFable ? { kind: 'pass', countsAsFable: true } : { kind: 'pass' }
}
export type StepFacts = {
  /** The loop the request is made in; null = the lead's own (main). */
  agentId: string | null
  runId: string | null
  isWorkflow: boolean
  /** The model the request names. */
  model: string
  /** The effort the request already carries, if any. */
  effort?: string | number
}

/** The effort levels the guard itself sets (spec 6.7). */
export type StepEffort = 'low' | 'medium' | 'high'

export type StepDecision = { kind: 'send' } | { kind: 'send'; effort: StepEffort } | { kind: 'block'; answer: string }

const BLOCK_BUDGET = '[mission-control] остановлен до запроса: бюджет исчерпан'
const BLOCK_HALT = '[mission-control] остановлен до запроса: заморожено владельцем'

const EFFORT_ORDER: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
const WORKFLOW_EFFORT: Readonly<Partial<Record<Tier, StepEffort>>> = { haiku: 'low', sonnet: 'medium', opus: 'high' }

/**
 * The request guard (spec 6.4, 6.7). Main is never blocked and never rewritten: the lead must be able to
 * ask the owner. A subagent is blocked in enforce when it is frozen or its agent, run or session budget
 * is gone (the request in flight is never cut; only the next one is refused). A workflow agent's effort
 * is capped at its tier's (low < medium < high < xhigh < max; haiku low, sonnet medium, opus high): an
 * absent or higher effort becomes the tier's, a lower one stays. A number, a level not in that order,
 * Fable and a model the table does not know are left alone (R17: the engine fills in the session's effort).
 */
export function decideStep(f: StepFacts, l: Lead, c: LeadConfig): StepDecision {
  if (f.agentId === null) return { kind: 'send' }
  // The owner's halt (R19) freezes in every mode; only the numbers wait for enforce.
  if (l.halted) return { kind: 'block', answer: BLOCK_HALT }
  if (c.mode === 'enforce') {
    if (isExhausted(budgetLeft(l, c, { agentId: f.agentId, runId: f.runId }))) return { kind: 'block', answer: BLOCK_BUDGET }
  }
  if (f.isWorkflow) {
    const tier = tierOf(f.model)
    const cap = tier === null ? undefined : WORKFLOW_EFFORT[tier]
    if (cap !== undefined) {
      // The engine fills the session's effort in, so an absent one is rare: the cap is a ceiling, never a floor.
      if (f.effort === undefined) return { kind: 'send', effort: cap }
      // A number or a level this list does not know cannot be ranked: left as it is.
      if (typeof f.effort === 'string' && EFFORT_ORDER.indexOf(f.effort) > EFFORT_ORDER.indexOf(cap)) {
        return { kind: 'send', effort: cap }
      }
    }
  }
  return { kind: 'send' }
}
