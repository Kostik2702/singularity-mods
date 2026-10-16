import type { ElementTable } from 'claude-code'

import type { Action, AgentPhase, AgentRow } from '../../types'
import { cells, slateKit, stamp } from '../lib/frame'
import { fmtTokens } from '../lib/parse'
import { CLASSIC, bannerLine, themedRule } from '../lib/theme'
import type { Slate, Theme } from '../lib/theme'
import { fmtDur, plural } from '../lib/viz'
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
  /** Long actions running now that the Processes tab shows: a pointer to it. Absent counts as none. */
  jobsRunning?: number
}

type Mark = { icon: string; color: string; label: string }

/** Each phase's icon, colour and word, in the theme's palette and vocabulary. */
function marksOf(t: Theme): Record<AgentPhase, Mark> {
  const c = t.colors
  const color: Record<AgentPhase, string> = {
    starting: c.accent,
    thinking: c.accent,
    acting: c.accent,
    waiting: c.muted,
    idle: c.muted,
    done: c.good,
    failed: c.critical,
    aborted: c.warning,
    denied: c.warning,
  }
  const out = {} as Record<AgentPhase, Mark>
  for (const phase of Object.keys(color) as AgentPhase[]) out[phase] = { icon: t.icons.phase[phase], color: color[phase], label: t.words.phase[phase] }
  return out
}

function statusOf(t: Theme): Record<Action['status'], { icon: string; color: string }> {
  const c = t.colors
  return {
    run: { icon: t.icons.run, color: c.accent },
    ok: { icon: t.icons.ok, color: c.good },
    error: { icon: t.icons.error, color: c.critical },
    denied: { icon: t.icons.denied, color: c.warning },
  }
}

/** The feed keeps at least this many rows however tall the tree is. */
const FEED_MIN = 3

/**
 * After a label beside a wrapping box: the terminal trims a plain space at the end of a
 * flex child, and the live screen read "зачем:«…" (seen 2026-10-11).
 */
const NBSP = String.fromCharCode(0xa0)

/** How the person calls an agent: main is «главный» (or the theme's word); a named agent shows its name and type. */
export function agentName(row: AgentRow, t: Theme = CLASSIC): string {
  if (row.id === MAIN) return t.words.main
  return row.name !== null && row.name !== row.type ? `${row.name} (${row.type})` : row.type
}

function verbColor(kind: Action['kind'], c: Theme['colors']): string {
  if (kind === 'memory') return c.search
  if (kind === 'delete') return c.serious
  return c.ink2
}

/**
 * Cells for the feed's agent label: as long as the longest label, at least 7, never
 * more than 16 or a third of the column, so a narrow dock still shows the verb.
 */
export function feedLabelWidth(labels: readonly string[], inner: number): number {
  return Math.min(16, Math.max(4, Math.floor(inner / 3)), Math.max(7, ...labels.map(label => [...label].length)))
}

/**
 * Greedy word wrap into at most two lines of `width` cells; the second line is cut
 * with an ellipsis when the text runs on, a word wider than a line is cut. Ink's own
 * wrap overran a "2 × width" budget live (word breaks waste room), so the reason is
 * laid out here and each line drawn unwrapped.
 */
export function wrapTwo(text: string, width: number): string[] {
  const w = Math.max(4, width)
  const words = text.split(/\s+/).filter(word => word.length > 0)
  const lines: string[] = []
  let line = ''
  let next = 0
  for (; next < words.length; next += 1) {
    const word = words[next] ?? ''
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if ([...candidate].length <= w) {
      line = candidate
      continue
    }
    if (line.length === 0) {
      line = clip(word, w)
      continue
    }
    lines.push(line)
    line = ''
    if (lines.length === 2) break
    next -= 1
  }
  if (lines.length < 2 && line.length > 0) lines.push(line)
  const last = lines[1]
  if (next < words.length && last !== undefined) lines[1] = clip(`${last}…`, w)
  return lines
}

/** "сейчас" under 5 s, else 12с / 3м05с / 1ч02м. */
function ago(ms: number): string {
  return ms < 5000 ? 'сейчас' : fmtDur(ms)
}

/** What a tab draws an agent with: its mark (silent wins over the phase) and the facts after its name. */
function agentFacts(row: AgentRow, d: AgentsPaneData, t: Theme): { mark: Mark; said: string[] } {
  const w = t.words
  const MARKS = marksOf(t)
  const silent = isSilent(row, d.now)
  const mark: Mark = silent ? { icon: t.icons.silent, color: t.colors.warning, label: w.silent } : MARKS[row.phase]
  if (row.id === MAIN) {
    const said: string[] = row.turn > 0 ? [`ход ${row.turn}`] : []
    if (isWorking(row.phase)) said.push(fmtDur(d.now - row.startedAt))
    else if (row.endedAt === null) said.push(w.notStarted)
    else if (row.phase === 'idle') said.push(`${w.waitsForYou} · ${ago(d.now - row.endedAt)}`)
    else said.push(`${MARKS[row.phase].label} · ${ago(d.now - row.endedAt)}`)
    return { mark, said }
  }
  if (row.phase === 'denied') return { mark, said: [MARKS.denied.label] }
  const said = [fmtDur((row.endedAt ?? d.now) - row.startedAt)]
  if (row.steps > 0) said.push(`${row.steps} ${plural(row.steps, ['шаг', 'шага', 'шагов'])}`)
  if (silent) said.push(`${w.silent} ${fmtDur(d.now - row.lastEventAt)}`)
  else if (row.phase === 'failed' || row.phase === 'aborted' || row.phase === 'waiting' || row.phase === 'idle') said.push(mark.label)
  if (isEnded(row.phase) && row.tokens > 0) said.push(`${fmtTokens(row.tokens)} ток.`)
  return { mark, said }
}

/** A labelled detail: «indent label: text», one row cut at its end. */
function detailRow(table: ElementTable, t: Theme, indent: string, label: string, text: string, color: string) {
  const { Text } = table
  return (
    <Text wrap="truncate-end">
      <Text color={t.colors.muted}>
        {indent}
        {label}:{' '}
      </Text>
      <Text color={color}>{text}</Text>
    </Text>
  )
}

/**
 * The reason, the point of the tab: it wraps under its label, but never past two lines
 * of `width`. Two plain lines, laid out by wrapTwo: no flex box, no Ink wrap (both
 * misbehaved live).
 */
export function whyRows(table: ElementTable, t: Theme, indent: string, label: string, text: string, width: number): JSX.Element[] {
  const { Text } = table
  const c = t.colors
  const head = `${indent}${label}:${NBSP}«`
  const lines = wrapTwo(text, Math.max(8, width - [...head].length - 1))
  const first = lines[0] ?? ''
  const second = lines[1]
  const lead = (
    <Text color={c.muted}>
      {indent}
      {label}:{NBSP}
    </Text>
  )
  if (second === undefined) {
    return [
      <Text wrap="truncate-end">
        {lead}
        <Text color={c.ink}>«{first}»</Text>
      </Text>,
    ]
  }
  return [
    <Text wrap="truncate-end">
      {lead}
      <Text color={c.ink}>«{first}</Text>
    </Text>,
    <Text wrap="truncate-end">
      <Text color={c.muted}>{' '.repeat([...head].length)}</Text>
      <Text color={c.ink}>{second}»</Text>
    </Text>,
  ]
}

/** What a working agent does now: the call it runs with its timer, or the phase it is in. */
function nowRow(table: ElementTable, t: Theme, d: AgentsPaneData, indent: string, row: AgentRow) {
  const { Text } = table
  const c = t.colors
  const w = t.words
  const cur = row.current
  if (row.phase === 'acting' && cur !== null) {
    const mark = statusOf(t)[cur.status]
    const verb = cur.status === 'run' ? cur.run : cur.done
    const dur = cur.status === 'run' ? d.now - cur.startedAt : (cur.ms ?? 0)
    return (
      <Text wrap="truncate-end">
        <Text color={c.muted}>{indent}</Text>
        <Text color={mark.color}>{mark.icon} </Text>
        <Text color={verbColor(cur.kind, c)}>{verb}</Text>
        {cur.target.length > 0 ? <Text color={c.ink}> {cur.target}</Text> : ''}
        {dur >= 1000 ? <Text color={c.muted}> {fmtDur(dur)}</Text> : ''}
      </Text>
    )
  }
  const label = row.phase === 'starting' ? w.starting : row.phase === 'waiting' ? w.waitingLong : w.thinking
  return (
    <Text wrap="truncate-end">
      <Text color={c.muted}>{indent}</Text>
      <Text color={c.accent}>{t.icons.run} </Text>
      <Text color={c.ink2}>{label}</Text>
      <Text color={c.muted}> {fmtDur(d.now - row.phaseAt)}</Text>
    </Text>
  )
}

/** Who made a call, as the feed labels it. */
function feedWho(d: AgentsPaneData, t: Theme): (agentId: string | null) => string {
  const byId = new Map(d.agents.map(r => [r.id, r]))
  return agentId => {
    if (agentId === null) return t.words.main
    const row = byId.get(agentId)
    return row === undefined || !isConfirmed(row) ? '↳фон' : `↳${row.name ?? row.type}`
  }
}

/** The feed's rows, newest first: as many as `room`, each cut to the column. */
function feedRows(table: ElementTable, t: Theme, d: AgentsPaneData, room: number, inner: number): JSX.Element[] {
  const { Text } = table
  const c = t.colors
  const STATUS = statusOf(t)
  const who = feedWho(d, t)
  const recent = d.actions.slice(-room).reverse()
  const width = feedLabelWidth(
    recent.map(a => who(a.agentId)),
    inner,
  )
  return recent.map(a => {
    const mark = STATUS[a.status]
    const verb = a.status === 'run' ? a.run : a.done
    const slow = a.status !== 'run' && a.ms !== null && a.ms >= 3000 ? ` ${fmtDur(a.ms)}` : ''
    return (
      <Text wrap="truncate-end">
        <Text color={c.muted}>{ago(d.now - a.startedAt).padStart(6)} </Text>
        <Text color={a.agentId === null ? c.ink2 : c.muted}>{clip(who(a.agentId), width).padEnd(width)} </Text>
        <Text color={mark.color}>{mark.icon} </Text>
        <Text color={verbColor(a.kind, c)}>{verb}</Text>
        {a.target.length > 0 ? <Text color={c.ink}> {a.target}</Text> : ''}
        <Text color={c.muted}>{slow}</Text>
      </Text>
    )
  })
}

function hiddenText(n: number): string {
  return `… ещё ${n} ${plural(n, ['завершённый', 'завершённых', 'завершённых'])} раньше`
}

/**
 * The Agents tab as one tree: main, then its agents nested by who spawned whom. A
 * working agent gets its task, its reason and what it does now; an ended one gets
 * one line with the start of its report. Below, the feed of recent calls of every
 * loop, newest first. `cols` is the body width, `rows` its visible height.
 */
export function drawAgentsPane(table: ElementTable, d: AgentsPaneData, cols: number, rows: number, t: Theme = CLASSIC) {
  if (t.slate !== null) return drawAgentsSlate(table, d, cols, rows, t, t.slate)
  const { Box, Text } = table
  const c = t.colors
  const w = t.words
  const inner = Math.max(20, cols - 2)
  const tree = buildTree(d.agents, d.turn, d.now, t.tree)
  const banner = bannerLine(t, 'agents', inner)
  // One element per row on screen: `room` for the feed counts them.
  const out: JSX.Element[] = []

  const drawRow = ({ row, lead, indent }: TreeLine): void => {
    const isMain = row.id === MAIN
    const { mark, said } = agentFacts(row, d, t)
    const ended = isEnded(row.phase)
    const viewed = !isMain && d.viewAgentId === row.id
    const tail = ended && row.report !== null ? ` — ${row.report}` : ''
    out.push(
      <Text wrap="truncate-end">
        <Text color={c.muted}>{lead}</Text>
        {viewed ? (
          <Text color={c.ink} bold>
            {t.icons.viewed}
          </Text>
        ) : (
          ''
        )}
        <Text color={mark.color}>{mark.icon} </Text>
        <Text color={ended ? c.ink2 : c.ink} bold={!ended}>
          {agentName(row, t)}
        </Text>
        <Text color={c.muted}>
          {said.length > 0 ? ` · ${said.join(' · ')}` : ''}
          {tail}
        </Text>
      </Text>,
    )
    if (ended) return
    if (!isMain) {
      const task = row.description.length > 0 ? row.description : row.task
      if (task.length > 0) out.push(detailRow(table, t, indent, w.task, task, c.ink2))
    }
    if (row.intent !== null) out.push(...whyRows(table, t, indent, isMain && !isWorking(row.phase) ? w.outcome : w.why, row.intent, inner))
    if (isWorking(row.phase)) out.push(nowRow(table, t, d, indent, row))
  }

  for (const line of tree.lines) drawRow(line)

  // ── Feed: the newest calls of every loop, as many as the tab has room for ──
  const jobs = d.jobsRunning ?? 0
  const used = out.length + (tree.hidden > 0 ? 1 : 0) + (jobs > 0 ? 2 : 0) + (banner === null ? 0 : 2)
  const room = Math.max(FEED_MIN, rows - used - 6)
  const recent = feedRows(table, t, d, room, inner)
  const feed =
    recent.length === 0 ? (
      <Text color={c.muted}>{w.feedEmpty}</Text>
    ) : (
      <Box flexDirection="column">{recent}</Box>
    )
  const r = themedRule(t, w.feed, inner)

  return (
    <Box flexDirection="column" backgroundColor={c.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
      {banner !== null && (
        <Box marginBottom={1}>
          <Text color={c.accent} bold wrap="truncate-end">
            {banner}
          </Text>
        </Box>
      )}
      {out}
      {tree.hidden > 0 && <Text color={c.muted}>{hiddenText(tree.hidden)}</Text>}
      {jobs > 0 && (
        <Box marginTop={1}>
          <Text wrap="truncate-end">
            <Text color={c.accent}>{t.icons.jobs} </Text>
            <Text color={c.ink2}>
              {jobs} {plural(jobs, w.jobsRunning)}
            </Text>
            <Text color={c.muted}> — {w.jobsPointer}</Text>
          </Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={c.rule}>{r.lead}</Text>
          <Text color={c.muted} bold>
            {r.title}
          </Text>
          <Text color={c.rule}>{r.tail}</Text>
        </Text>
        {feed}
      </Box>
      <Box marginTop={1}>
        <Text color={c.muted} wrap="truncate-end">
          /mc close · clear · /mem
        </Text>
      </Box>
    </Box>
  )
}

/** Rows the crest takes with the gap under it; the crest shows only on a tab this tall. */
const CREST_MIN_ROWS = 34

/**
 * The Agents tab as a data-slate: the crest and the litany, an inverse status strip,
 * then every agent as a card of its own (main in a double frame, a subagent in a heavy
 * one on its branch of the tree), an ended agent as one line on its branch, the jobs
 * pointer, the vox-log of calls in a light frame, and the commands as key caps.
 */
function drawAgentsSlate(table: ElementTable, d: AgentsPaneData, cols: number, rows: number, t: Theme, slate: Slate) {
  const { Box, Text } = table
  const c = t.colors
  const w = t.words
  const kit = slateKit(table, t, slate)
  const inner = Math.max(24, cols - 2)
  const tree = buildTree(d.agents, d.turn, d.now, t.tree)
  const out: JSX.Element[] = []

  if (rows >= CREST_MIN_ROWS) out.push(...kit.crest(inner))
  const banner = bannerLine(t, 'agents', inner)
  if (banner !== null) {
    out.push(
      <Text color={c.accent} bold wrap="truncate-end">
        {banner}
      </Text>,
    )
  }
  const inLine = d.agents.filter(r => r.id !== MAIN && isConfirmed(r) && isWorking(r.phase)).length
  out.push(kit.strip(slate.strip.agents, `ход ${d.turn} · в строю ${inLine}`, inner))

  for (const { row, lead, indent } of tree.lines) {
    const isMain = row.id === MAIN
    const { mark, said } = agentFacts(row, d, t)
    const ended = isEnded(row.phase)
    const viewed = !isMain && d.viewAgentId === row.id
    if (ended && !isMain) {
      const tail = row.report !== null ? ` — ${row.report}` : ''
      out.push(
        <Text wrap="truncate-end">
          <Text color={c.muted}>{lead} </Text>
          <Text color={mark.color}>{mark.icon} </Text>
          <Text color={c.ink2}>{agentName(row, t)}</Text>
          <Text color={c.muted}>
            {said.length > 0 ? ` · ${said.join(' · ')}` : ''}
            {tail}
          </Text>
        </Text>,
      )
      continue
    }
    // The tree's connectors sit left of the card: the branch on its top edge, the stem
    // (two cells per level) down its side, so a nested card hangs off its parent's line.
    const pad = isMain ? '' : indent.slice(0, Math.max(0, cells(indent) - 2))
    const width = inner - cells(pad)
    const body = width - 4
    // A working agent: its phase on the first row, its timer and steps on the top plate.
    // A resting one (main between turns): what it waits for on the row, its turn on the plate.
    const working = isWorking(row.phase)
    const others = said.filter(s => s !== mark.label)
    const first = working ? mark.label : others.filter(s => !s.startsWith('ход ')).join(' · ') || mark.label
    const meta = working ? others.join(' · ') : others.filter(s => s.startsWith('ход ')).join(' · ')
    const lines: JSX.Element[] = []
    // A working agent not in a call says its phase on the "now" row, with the timer: no row twice.
    const nowSaysIt = working && (row.phase !== 'acting' || row.current === null) && mark.label !== w.silent
    if (!nowSaysIt) lines.push(
      <Text wrap="truncate-end">
        <Text color={mark.color}>{mark.icon} </Text>
        <Text color={c.ink2}>{first}</Text>
      </Text>,
    )
    if (!isMain) {
      const task = row.description.length > 0 ? row.description : row.task
      if (task.length > 0) lines.push(detailRow(table, t, '', w.task, task, c.ink2))
    }
    if (row.intent !== null) lines.push(...whyRows(table, t, '', isMain && !working ? w.outcome : w.why, row.intent, body))
    if (working) lines.push(nowRow(table, t, d, '', row))
    out.push(
      ...kit.panel({
        style: isMain ? 'double' : 'heavy',
        width,
        title: `${isMain ? '✠ ' : viewed ? `${t.icons.viewed} ` : ''}${agentName(row, t).toUpperCase()}`,
        meta,
        rows: lines,
        titleColor: isMain ? c.accent : c.ink,
        lead: isMain ? '' : lead,
        stem: pad,
      }),
    )
  }

  if (tree.hidden > 0) out.push(<Text color={c.muted}>{hiddenText(tree.hidden)}</Text>)
  const jobs = d.jobsRunning ?? 0
  if (jobs > 0) {
    out.push(
      <Text wrap="truncate-end">
        <Text backgroundColor={c.warning} color={c.surface} bold>
          {` ${t.icons.jobs} ${slate.jobsPlate} `}
        </Text>
        <Text color={c.ink2}>
          {' '}
          {jobs} {plural(jobs, w.jobsRunning)}
        </Text>
        <Text color={c.muted}> — {w.jobsPointer}</Text>
      </Text>,
    )
  }

  // The vox-log: as many calls as the tab has room for under everything above.
  const room = Math.max(FEED_MIN, rows - out.length - 2 - 3 - 1)
  const recent = feedRows(table, t, d, room, inner - 4)
  const feed = kit.panel({
    style: 'light',
    width: inner,
    title: slate.feed,
    meta: '▪▪▪',
    foot: stamp(slate.feedCode, d.turn * 131 + d.actions.length),
    rows: recent.length === 0 ? [<Text color={c.muted}>{w.feedEmpty}</Text>] : recent,
    titleColor: c.ink2,
  })

  return (
    <Box flexDirection="column" backgroundColor={c.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
      {out}
      <Box flexDirection="column" marginTop={1}>
        {feed}
      </Box>
      <Box marginTop={1}>{kit.keys(['/mc close', 'clear', '/mem', '/jobs'])}</Box>
    </Box>
  )
}
