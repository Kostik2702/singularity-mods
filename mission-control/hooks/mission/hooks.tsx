import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { Action } from '../../types'
import { describeAction } from '../lib/actions'

const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
const MAX_ACTIONS = 300

// The engine's scan accepts only an atom made in the same file (see memory/hooks.tsx).
const actionsA = atom({ plugin: 'mission-control', key: 'actions' } as const, [])
const turnA = atom({ plugin: 'mission-control', key: 'turn' } as const, 0)

export function registerMission(on: On): void {
  // Every tool call, in plain words: logged as it starts, settled as it ends.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === SNAPSHOT_TOOL) return next(e)
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `${tool}-${startedAt}`
    const words = describeAction(tool, e as unknown as Record<string, unknown>)
    const action: Action = { id, turn: await read($, turnA), ...words, status: 'run', agentId: e.agentId ?? null, startedAt, ms: null }
    await update($, actionsA, list => [...list, action].slice(-MAX_ACTIONS))
    const ran = await next(e)
    const status: Action['status'] = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
    const ms = (await $.clock.now()) - startedAt
    await update($, actionsA, list => list.map(a => (a.id === id ? { ...a, status, ms } : a)))
    return ran
  }).catch(($, e, next) => next(e))
}
