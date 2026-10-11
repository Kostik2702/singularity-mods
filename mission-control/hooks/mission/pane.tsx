import type { ElementTable } from 'claude-code'

import type { Action, AgentRow } from '../../types'

export type AgentsPaneData = {
  agents: readonly AgentRow[]
  actions: readonly Action[]
  turn: number
  now: number
  viewAgentId: string | null
}

export function drawAgentsPane(table: ElementTable, d: AgentsPaneData, cols: number, rows: number) {
  const { Text } = table
  return (
    <Text>
      агентов: {d.agents.length} ({cols}×{rows})
    </Text>
  )
}
