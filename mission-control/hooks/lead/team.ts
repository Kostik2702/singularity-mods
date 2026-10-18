// The `team` tool and the owner's `/mc budget|halt|resume|solo` of the team-lead layer (spec 6.6). Pure: no atoms.

import type { AgentPhase, AgentRow, Lead } from '../../types'
import { MAIN, RECENT_MS, clip, isWorking } from '../mission/model'
import type { LeadConfig } from './config'
import { mergedNews } from './digest'
import { pushNews } from './ledger'
import { tierOf } from './price'

export const TEAM_TOOL = 'mcp__mission-control__team'

/** Longest task in a table line, in code points. */
export const TEAM_TASK_MAX = 60
/** Most news lines the tool lists. */
const NEWS_MAX = 30

export const BUDGET_BAD = 'mission-control: /mc budget +N — N целое больше нуля'
export const BUDGET_NO_LIMIT = 'mission-control: лимит сессии не задан — добавлять не к чему (задай sessionBudgetOE)'

const FLAG_80 = 'budget80'
const FLAG_100 = 'budget100'

// The words the Agents tab uses for a row's phase. Deliberately theme-independent: these are read by the
// model, so they stay the same words whatever theme the owner picked.
const PHASE_WORDS: Readonly<Record<AgentPhase, string>> = {
  starting: 'запуск',
  thinking: 'думает',
  acting: 'работает',
  waiting: 'ждёт',
  idle: 'между ходами',
  done: 'готов',
  failed: 'ошибка',
  aborted: 'прерван',
  denied: 'отклонён',
}

const int = (n: number): string => String(Math.round(n))

/** The mode, as the Agents tab names it. */
const modeWord = (c: LeadConfig): string => (c.mode === 'enforce' ? 'контроль' : 'наблюдение')

/** The session's OE limit with what the owner added; null = no limit. */
export function sessionLimit(l: Lead, c: LeadConfig): number | null {
  return c.sessionBudget === null ? null : c.sessionBudget + l.extra
}

function headerOf(l: Lead, c: LeadConfig): string {
  const limit = sessionLimit(l, c)
  const session = limit === null ? `сессия ${int(l.session)} OE` : `сессия ${int(l.session)}/${int(limit)} OE`
  return `${modeWord(c)} · ${session} · Fable ${l.fableCalls}/${c.fableCap}`
}

/** Working agents, and those that ended within RECENT_MS of `now` (all ended ones without `now`). Never main, never a refusal. */
function listed(rows: readonly AgentRow[], now: number | undefined): AgentRow[] {
  return rows.filter(r => {
    if (r.id === MAIN || r.phase === 'denied' || r.isConfirmed === false) return false
    if (isWorking(r.phase)) return true
    return now === undefined || r.endedAt === null || now - r.endedAt <= RECENT_MS
  })
}

function lineOf(r: AgentRow, c: LeadConfig): string {
  const tier = tierOf(r.model) ?? '?'
  const spent = c.agentBudget === null ? int(r.oe) : `${int(r.oe)}/${int(c.agentBudget)}`
  const task = clip(r.task.length > 0 ? r.task : r.description, TEAM_TASK_MAX)
  return [r.id, tier, r.effort ?? '—', task, String(r.steps), spent, PHASE_WORDS[r.phase]].join(' · ')
}

/** The header line and one line per working or recently ended agent: id · ярус · effort · задача · ходы · OE[/лимит] · состояние. */
export function teamTable(rows: readonly AgentRow[], l: Lead, c: LeadConfig, now?: number): string {
  return [headerOf(l, c), ...listed(rows, now).map(r => lineOf(r, c))].join('\n')
}

/** What the `team` tool answers: the table, the news not yet delivered (read-only) and the flags. */
export function teamReport(rows: readonly AgentRow[], l: Lead, c: LeadConfig, now?: number): string {
  const news = mergedNews(l.news).slice(0, NEWS_MAX)
  const flags = [...(l.halted ? ['заморозка'] : []), ...(l.solo ? ['solo'] : []), ...l.flags]
  return [
    teamTable(rows, l, c, now),
    '',
    news.length === 0 ? 'новости: нет' : ['новости:', ...news].join('\n'),
    `флаги: ${flags.length === 0 ? 'нет' : flags.join(', ')}`,
  ].join('\n')
}

/** `+N` with N a positive safe integer, and nothing else after `budget`; otherwise null. */
export function budgetIncrement(words: readonly string[]): number | null {
  const [word, ...more] = words
  if (more.length > 0 || word === undefined || !/^\+\d+$/.test(word)) return null
  const n = Number(word.slice(1))
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * The ledger after `/mc budget +N`. A flag that the new limit no longer justifies is dropped, so the
 * next crossing is announced again: budget100 once the session is under the limit, budget80 once
 * spending is under 80 % of it. No session limit: nothing changes.
 */
export function raiseBudget(l: Lead, c: LeadConfig, n: number): Lead {
  if (c.sessionBudget === null) return l
  const extra = l.extra + n
  const limit = c.sessionBudget + extra
  const flags = l.flags.filter(f => !(f === FLAG_100 && l.session < limit) && !(f === FLAG_80 && l.session * 100 < limit * 80))
  return { ...l, extra, flags }
}

/** Idempotent: freezing a frozen session changes nothing and tells the lead nothing. */
export const haltLead = (l: Lead): Lead => (l.halted ? l : pushNews({ ...l, halted: true }, 'владелец остановил исполнителей'))
export const resumeLead = (l: Lead): Lead => (l.halted ? pushNews({ ...l, halted: false }, 'владелец снял заморозку') : l)
export const soloLead = (l: Lead): Lead => ({ ...l, solo: true })
