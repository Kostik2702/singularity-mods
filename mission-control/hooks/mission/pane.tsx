import type { ElementTable } from 'claude-code'

import type { Action, AgentPhase, AgentRow } from '../../types'
import { fmtTokens } from '../lib/parse'
import { COLORS, fmtDur, plural, rule } from '../lib/viz'
import { MAIN, buildTree, clip, isConfirmed, isEnded, isSilent, isWorking } from './model'
import type { TreeLine } from './model'

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

export type AgentsPaneData = {
  agents: readonly AgentRow[]
  actions: readonly Action[]
  /** The main loop's turn (prompt.submit counts them). */
  turn: number
  now: number
  /** The agent whose transcript the person has open beside the pane; null while main is in view. */
  viewAgentId: string | null
}

type Mark = { icon: string; color: string; label: string }

const MARKS: Record<AgentPhase, Mark> = {
  starting: { icon: '◌', color: COLORS.accent, label: 'запуск' },
  thinking: { icon: '◌', color: COLORS.accent, label: 'думает' },
  acting: { icon: '●', color: COLORS.accent, label: 'работает' },
  waiting: { icon: '◷', color: COLORS.muted, label: 'ждёт' },
  idle: { icon: '○', color: COLORS.muted, label: 'между ходами' },
  done: { icon: '✓', color: COLORS.good, label: 'готов' },
  failed: { icon: '✖', color: COLORS.critical, label: 'ошибка' },
  aborted: { icon: '⊘', color: COLORS.warning, label: 'прерван' },
  denied: { icon: '⊘', color: COLORS.warning, label: 'отклонён' },
}
const SILENT: Mark = { icon: '?', color: COLORS.warning, label: 'нет вестей' }

const STATUS: Record<Action['status'], { icon: string; color: string }> = {
  run: { icon: '◌', color: COLORS.accent },
  ok: { icon: '✓', color: COLORS.good },
  error: { icon: '✖', color: COLORS.critical },
  denied: { icon: '⊘', color: COLORS.warning },
}

/** The feed keeps at least this many rows however tall the tree is. */
const FEED_MIN = 3

/**
 * After a label beside a wrapping box: the terminal trims a plain space at the end of a
 * flex child, and the live screen read "зачем:«…" (seen 2026-10-11).
 */
const NBSP = String.fromCharCode(0xa0)

/** How the person calls an agent: main is «главный»; a named agent shows its name and type. */
export function agentName(row: AgentRow): string {
  if (row.id === MAIN) return 'главный'
  return row.name !== null && row.name !== row.type ? `${row.name} (${row.type})` : row.type
}

function verbColor(kind: Action['kind']): string {
  if (kind === 'memory') return COLORS.search
  if (kind === 'delete') return COLORS.serious
  return COLORS.ink2
}

/**
 * Cells for the feed's agent label: as long as the longest label, at least 7, never
 * more than 16 or a third of the column, so a narrow dock still shows the verb.
 */
export function feedLabelWidth(labels: readonly string[], inner: number): number {
  return Math.min(16, Math.max(4, Math.floor(inner / 3)), Math.max(7, ...labels.map(label => [...label].length)))
}

/** "сейчас" under 5 s, else 12с / 3м05с / 1ч02м. */
function ago(ms: number): string {
  return ms < 5000 ? 'сейчас' : fmtDur(ms)
}

/**
 * The Agents tab as one tree: main, then its agents nested by who spawned whom. A
 * working agent gets its task, its reason and what it does now; an ended one gets
 * one line with the start of its report. Below, the feed of recent calls of every
 * loop, newest first. `cols` is the body width, `rows` its visible height.
 */
export function drawAgentsPane(table: ElementTable, d: AgentsPaneData, cols: number, rows: number) {
  const { Box, Text } = table
  const inner = Math.max(20, cols - 2)
  const tree = buildTree(d.agents, d.turn, d.now)
  const out: JSX.Element[] = []
  // Rows on screen beyond one per element (a reason wrapped to its second line).
  let extraRows = 0

  const facts = (row: AgentRow, mark: Mark): string[] => {
    if (row.id === MAIN) {
      const said: string[] = row.turn > 0 ? [`ход ${row.turn}`] : []
      if (isWorking(row.phase)) said.push(fmtDur(d.now - row.startedAt))
      else if (row.endedAt === null) said.push('ещё не начинал')
      else if (row.phase === 'idle') said.push(`ждёт тебя · ${ago(d.now - row.endedAt)}`)
      else said.push(`${MARKS[row.phase].label} · ${ago(d.now - row.endedAt)}`)
      return said
    }
    if (row.phase === 'denied') return ['отклонён']
    const said = [fmtDur((row.endedAt ?? d.now) - row.startedAt)]
    if (row.steps > 0) said.push(`${row.steps} ${plural(row.steps, ['шаг', 'шага', 'шагов'])}`)
    if (mark === SILENT) said.push(`нет вестей ${fmtDur(d.now - row.lastEventAt)}`)
    else if (row.phase === 'failed' || row.phase === 'aborted' || row.phase === 'waiting' || row.phase === 'idle') said.push(mark.label)
    if (isEnded(row.phase) && row.tokens > 0) said.push(`${fmtTokens(row.tokens)} ток.`)
    return said
  }

  const detail = (indent: string, label: string, text: string, color: string) => (
    <Text wrap="truncate-end">
      <Text color={COLORS.muted}>
        {indent}
        {label}:{' '}
      </Text>
      <Text color={color}>{text}</Text>
    </Text>
  )

  // The reason is the point of the tab: it wraps under its label, but never past two
  // lines of the column, so a block stays five rows at most and the feed keeps its room.
  const why = (indent: string, label: string, text: string) => {
    const line = Math.max(8, inner - indent.length - label.length - 2 - 2)
    const said = clip(text, line * 2)
    if ([...said].length > line) extraRows += 1
    return (
      <Box flexDirection="row">
        <Text color={COLORS.muted}>
          {indent}
          {label}:{NBSP}
        </Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text color={COLORS.ink} wrap="wrap">
            «{said}»
          </Text>
        </Box>
      </Box>
    )
  }

  const nowLine = (indent: string, row: AgentRow) => {
    const cur = row.current
    if (row.phase === 'acting' && cur !== null) {
      const mark = STATUS[cur.status]
      const verb = cur.status === 'run' ? cur.run : cur.done
      const dur = cur.status === 'run' ? d.now - cur.startedAt : (cur.ms ?? 0)
      return (
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>{indent}</Text>
          <Text color={mark.color}>{mark.icon} </Text>
          <Text color={verbColor(cur.kind)}>{verb}</Text>
          {cur.target.length > 0 ? <Text color={COLORS.ink}> {cur.target}</Text> : ''}
          {dur >= 1000 ? <Text color={COLORS.muted}> {fmtDur(dur)}</Text> : ''}
        </Text>
      )
    }
    const label = row.phase === 'starting' ? 'запускается' : row.phase === 'waiting' ? 'ждёт фоновую работу или одобрение' : 'думает'
    return (
      <Text wrap="truncate-end">
        <Text color={COLORS.muted}>{indent}</Text>
        <Text color={COLORS.accent}>◌ </Text>
        <Text color={COLORS.ink2}>{label}</Text>
        <Text color={COLORS.muted}> {fmtDur(d.now - row.phaseAt)}</Text>
      </Text>
    )
  }

  const drawRow = ({ row, lead, indent }: TreeLine): void => {
    const isMain = row.id === MAIN
    const mark = isSilent(row, d.now) ? SILENT : MARKS[row.phase]
    const ended = isEnded(row.phase)
    const viewed = !isMain && d.viewAgentId === row.id
    const said = facts(row, mark)
    const tail = ended && row.report !== null ? ` — ${row.report}` : ''
    out.push(
      <Text wrap="truncate-end">
        <Text color={COLORS.muted}>{lead}</Text>
        {viewed ? (
          <Text color={COLORS.ink} bold>
            ▶
          </Text>
        ) : (
          ''
        )}
        <Text color={mark.color}>{mark.icon} </Text>
        <Text color={ended ? COLORS.ink2 : COLORS.ink} bold={!ended}>
          {agentName(row)}
        </Text>
        <Text color={COLORS.muted}>
          {said.length > 0 ? ` · ${said.join(' · ')}` : ''}
          {tail}
        </Text>
      </Text>,
    )
    if (ended) return
    if (!isMain) {
      const task = row.description.length > 0 ? row.description : row.task
      if (task.length > 0) out.push(detail(indent, 'задача', task, COLORS.ink2))
    }
    if (row.intent !== null) out.push(why(indent, isMain && !isWorking(row.phase) ? 'итог' : 'зачем', row.intent))
    if (isWorking(row.phase)) out.push(nowLine(indent, row))
  }

  for (const line of tree.lines) drawRow(line)

  // ── Feed: the newest calls of every loop, as many as the tab has room for ──
  const byId = new Map(d.agents.map(r => [r.id, r]))
  const who = (agentId: string | null): string => {
    if (agentId === null) return 'главный'
    const row = byId.get(agentId)
    return row === undefined || !isConfirmed(row) ? '↳фон' : `↳${row.name ?? row.type}`
  }
  const used = out.length + extraRows + (tree.hidden > 0 ? 1 : 0)
  const room = Math.max(FEED_MIN, rows - used - 6)
  const recent = d.actions.slice(-room).reverse()
  const width = feedLabelWidth(
    recent.map(a => who(a.agentId)),
    inner,
  )
  const feed =
    recent.length === 0 ? (
      <Text color={COLORS.muted}>пока без действий</Text>
    ) : (
      <Box flexDirection="column">
        {recent.map(a => {
          const mark = STATUS[a.status]
          const verb = a.status === 'run' ? a.run : a.done
          const slow = a.status !== 'run' && a.ms !== null && a.ms >= 3000 ? ` ${fmtDur(a.ms)}` : ''
          return (
            <Text wrap="truncate-end">
              <Text color={COLORS.muted}>{ago(d.now - a.startedAt).padStart(6)} </Text>
              <Text color={a.agentId === null ? COLORS.ink2 : COLORS.muted}>{clip(who(a.agentId), width).padEnd(width)} </Text>
              <Text color={mark.color}>{mark.icon} </Text>
              <Text color={verbColor(a.kind)}>{verb}</Text>
              {a.target.length > 0 ? <Text color={COLORS.ink}> {a.target}</Text> : ''}
              <Text color={COLORS.muted}>{slow}</Text>
            </Text>
          )
        })}
      </Box>
    )
  const r = rule('Лента', inner)

  return (
    <Box flexDirection="column" backgroundColor={COLORS.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
      {out}
      {tree.hidden > 0 && (
        <Text color={COLORS.muted}>
          … ещё {tree.hidden} {plural(tree.hidden, ['завершённый', 'завершённых', 'завершённых'])} раньше
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={COLORS.rule}>{r.lead}</Text>
          <Text color={COLORS.muted} bold>
            {r.title}
          </Text>
          <Text color={COLORS.rule}>{r.tail}</Text>
        </Text>
        {feed}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.muted} wrap="truncate-end">
          /mc close · clear · /mem
        </Text>
      </Box>
    </Box>
  )
}
