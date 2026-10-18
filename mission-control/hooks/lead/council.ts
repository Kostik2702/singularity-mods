// The council window of the team-lead layer (spec 6.7, ruling R25). Pure: facts in, the next ledger out.
//
// A council command (`/council`, `/planning-council`, `/observation-council`) opens the window. The councils run
// several rounds, and their members run in the background, so the lead's turn ends while a round is out and the
// next round starts in a turn a notification woke. The window therefore does not end with a turn: it ends when
// the owner speaks again with something that is not a council command, unless a member is still working.

import type { AgentRow, Lead } from '../../types'
import { isWorking } from '../mission/model'
import { COUNCIL_COMMANDS } from './guard'

/** The prompt origins that mean a person typed it (PromptOrigin `composer`, the terminal; `bridge`, a phone or web client). */
const OWNER_ORIGINS: readonly string[] = ['composer', 'bridge']

/** A council member just spawned inside the window: remembered, so the window outlives the turns until the member ends. */
export function markCouncilAgent(l: Lead, agentId: string): Lead {
  if (l.councilTurn === null) return l
  const members = l.councilAgents ?? []
  return members.includes(agentId) ? l : { ...l, councilAgents: [...members, agentId] }
}

/**
 * The ledger after a prompt. The window closes on the owner's own prompt (composer or bridge) that is not a council
 * command, and only when no member of the council is still working; every other prompt leaves it as it is.
 */
export function afterOwnerPrompt(
  l: Lead,
  rows: readonly AgentRow[],
  p: { origin: string; command: string | undefined },
): Lead {
  if (l.councilTurn === null || !OWNER_ORIGINS.includes(p.origin)) return l
  if (p.command !== undefined && COUNCIL_COMMANDS.includes(p.command)) return l
  const working = (l.councilAgents ?? []).some(id => rows.some(r => r.id === id && isWorking(r.phase)))
  return working ? l : { ...l, councilTurn: null, councilAgents: [] }
}
