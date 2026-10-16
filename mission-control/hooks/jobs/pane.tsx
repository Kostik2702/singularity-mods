import type { ElementTable } from 'claude-code'

import type { AgentRow, Job } from '../../types'
import { COG, slateKit, stamp, wrapLines } from '../lib/frame'
import { CLASSIC, bannerLine, themedRule } from '../lib/theme'
import type { Slate, Theme } from '../lib/theme'
import { fmtDur, meter, plural } from '../lib/viz'
import { clip } from '../mission/model'
import { whyRows, wrapTwo } from '../mission/pane'
import { SILENT_OUTPUT_MS, endedShown, runningShown } from './model'

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

export type JobsPaneData = {
  jobs: readonly Job[]
  agents: readonly AgentRow[]
  now: number
}

function endedMarks(t: Theme): Record<Exclude<Job['status'], 'run'>, { icon: string; color: string; label: string }> {
  return {
    ok: { icon: t.icons.ok, color: t.colors.good, label: t.words.jobOk },
    error: { icon: t.icons.error, color: t.colors.critical, label: t.words.jobError },
    killed: { icon: t.icons.denied, color: t.colors.warning, label: t.words.jobKilled },
  }
}

/** Ended jobs folded below the running ones. */
const ENDED_MAX = 5

/** After a label: the terminal trims a plain space at the end of a flex child (seen live 2026-10-11). */
const NBSP = String.fromCharCode(0xa0)

/** Who started it: the live agent row when there is one, else what was known at the start. */
function starter(job: Job, agents: readonly AgentRow[], t: Theme): string {
  if (job.agentId === null) return t.words.main
  const row = agents.find(r => r.id === job.agentId)
  if (row === undefined) return job.agentLabel
  return row.name !== null && row.name !== row.type ? `${row.name} (${row.type})` : row.type
}

/** 12345 → "12 КБ". */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`
}

/**
 * The Processes tab: every long action that runs now (a background shell, a
 * foreground command past a few seconds, a monitor) with what it is, its gist, who
 * started it and why, and how far it got; below, the ones that ended lately.
 */
export function drawJobsPane(table: ElementTable, d: JobsPaneData, cols: number, rows: number, t: Theme = CLASSIC) {
  if (t.slate !== null) return drawJobsSlate(table, d, cols, rows, t, t.slate)
  const { Box, Text } = table
  const c = t.colors
  const w = t.words
  const ENDED_MARK = endedMarks(t)
  const banner = bannerLine(t, 'jobs', Math.max(20, cols - 2))
  const inner = Math.max(20, cols - 2)
  const running = runningShown(d.jobs, d.now)
  const ended = endedShown(d.jobs, d.now).slice(0, ENDED_MAX)
  const out: JSX.Element[] = []

  const detail = (label: string, text: string, color: string) => (
    <Text wrap="truncate-end">
      <Text color={c.muted}>
        {'  '}
        {label}:{NBSP}
      </Text>
      <Text color={color}>{text}</Text>
    </Text>
  )

  const why = (text: string): JSX.Element[] => {
    const head = `  ${w.why}:${NBSP}«`
    const lines = wrapTwo(text, Math.max(8, inner - [...head].length - 1))
    const first = lines[0] ?? ''
    const second = lines[1]
    const lead = (
      <Text color={c.muted}>
        {'  '}
        {w.why}:{NBSP}
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

  const progress = (job: Job): JSX.Element[] => {
    const p = job.progress
    const lines: JSX.Element[] = []
    if (p !== null && p.fraction !== null) {
      const percent = `${Math.floor(p.fraction * 100)}%`
      const width = Math.max(6, inner - 2 - percent.length - 1)
      const bar = meter(p.fraction, width)
      lines.push(
        <Text wrap="truncate-end">
          <Text color={c.muted}>{'  '}</Text>
          <Text color={c.accent}>{bar.fill}</Text>
          <Text color={c.track}>{bar.track}</Text>
          <Text color={c.ink} bold>
            {' '}
            {percent}
          </Text>
        </Text>,
      )
    }
    const facts: string[] = []
    if (p !== null) {
      if (p.stage !== null) facts.push(p.stage)
      if (p.count !== null) facts.push(p.count)
      if (p.eta !== null) facts.push(`осталось ${p.eta}`)
      if (p.rate !== null) facts.push(p.rate)
      if (p.metric !== null) facts.push(p.metric)
    }
    if (p === null || p.fraction === null) {
      // No scale in the output: say what is known, so a quiet job never looks frozen by mistake.
      if (job.outputPath === null) facts.push('вывод пока не виден')
      else if (job.outputSize > 0) facts.push(`вывод ${fmtBytes(job.outputSize)}`)
      else facts.push('вывода пока нет')
    }
    const silent = job.outputAt !== null && d.now - job.outputAt >= SILENT_OUTPUT_MS
    lines.push(
      <Text wrap="truncate-end">
        <Text color={c.muted}>{'  '}</Text>
        <Text color={p !== null && p.fraction === null ? c.accent : c.ink2}>{p !== null && p.fraction === null ? `${t.icons.run} ` : ''}</Text>
        <Text color={c.ink2}>{facts.join(' · ')}</Text>
        {silent ? <Text color={c.warning}> · вывод молчит {fmtDur(d.now - (job.outputAt ?? d.now))}</Text> : ''}
      </Text>,
    )
    if (job.lastLine !== null && job.lastLine.length > 0) {
      lines.push(
        <Text wrap="truncate-end" color={c.muted}>
          {'  › '}
          {job.lastLine}
        </Text>,
      )
    }
    return lines
  }

  for (const [i, job] of running.entries()) {
    const where = job.isBackground ? 'в фоне' : 'на переднем плане'
    out.push(
      <Box flexDirection="column" marginTop={i === 0 ? 0 : 1}>
        <Text wrap="truncate-end">
          <Text color={c.accent}>{t.icons.job} </Text>
          <Text color={c.ink} bold>
            {w.kinds[job.kind]}
          </Text>
          <Text color={c.muted}>
            {' · '}
            {starter(job, d.agents, t)} · {fmtDur(d.now - job.startedAt)} · {where}
          </Text>
        </Text>
        {job.description.length > 0 ? (
          <Text wrap="truncate-end" color={c.ink}>
            {'  '}
            {job.description}
          </Text>
        ) : (
          ''
        )}
        {detail(w.gist, job.gist, c.ink2)}
        {job.intent !== null ? why(job.intent) : ''}
        {progress(job)}
      </Box>,
    )
  }

  if (running.length === 0) {
    out.push(
      <Text color={c.muted} wrap="wrap">
        {w.jobsNone}
      </Text>,
    )
  }

  const r = themedRule(t, w.jobsEnded, inner)
  const endedBlock =
    ended.length === 0 ? (
      ''
    ) : (
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={c.rule}>{r.lead}</Text>
          <Text color={c.muted} bold>
            {r.title}
          </Text>
          <Text color={c.rule}>{r.tail}</Text>
        </Text>
        {ended.map(job => {
          const mark = ENDED_MARK[job.status === 'run' ? 'ok' : job.status]
          const took = fmtDur((job.endedAt ?? d.now) - job.startedAt)
          const code = job.exitCode !== null && job.exitCode !== 0 ? ` · код ${job.exitCode}` : ''
          const what = job.description.length > 0 ? job.description : job.gist
          return (
            <Text wrap="truncate-end">
              <Text color={mark.color}>{mark.icon} </Text>
              <Text color={c.ink2}>{w.kinds[job.kind]}</Text>
              <Text color={c.muted}>
                {' · '}
                {starter(job, d.agents, t)} · {took}
                {code} · {clip(what, 80)}
              </Text>
            </Text>
          )
        })}
      </Box>
    )

  const head =
    running.length === 0
      ? ''
      : `${running.length} ${plural(running.length, w.jobsHead)}`

  return (
    <Box flexDirection="column" backgroundColor={c.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
      {banner !== null && (
        <Box marginBottom={1}>
          <Text color={c.accent} bold wrap="truncate-end">
            {banner}
          </Text>
        </Box>
      )}
      {head.length > 0 ? (
        <Box marginBottom={1}>
          <Text color={c.muted} wrap="truncate-end">
            {head}
          </Text>
        </Box>
      ) : (
        ''
      )}
      {out}
      {endedBlock}
      <Box marginTop={1}>
        <Text color={c.muted} wrap="truncate-end">
          /jobs close · clear · /mc
        </Text>
      </Box>
    </Box>
  )
}

/** What the output says of a job's progress: the scale (when it has one), the facts, and how long it has been silent. */
function progressOf(job: Job, now: number): { fraction: number | null; facts: string[]; silentFor: number | null } {
  const p = job.progress
  const facts: string[] = []
  if (p !== null) {
    if (p.stage !== null) facts.push(p.stage)
    if (p.count !== null) facts.push(p.count)
    if (p.eta !== null) facts.push(`осталось ${p.eta}`)
    if (p.rate !== null) facts.push(p.rate)
    if (p.metric !== null) facts.push(p.metric)
  }
  if (p === null || p.fraction === null) {
    if (job.outputPath === null) facts.push('вывод пока не виден')
    else if (job.outputSize > 0) facts.push(`вывод ${fmtBytes(job.outputSize)}`)
    else facts.push('вывода пока нет')
  }
  const silentFor = job.outputAt !== null && now - job.outputAt >= SILENT_OUTPUT_MS ? now - job.outputAt : null
  return { fraction: p === null ? null : p.fraction, facts, silentFor }
}

/** A stable number from a job's id, for the stamp on its card. */
function seedOf(id: string): number {
  let n = 7
  for (const ch of id) n = (n * 31 + (ch.codePointAt(0) ?? 0)) % 1_000_003
  return n
}

/**
 * The Processes tab as a data-slate: the litany and the forge's status strip, each
 * running rite a card of its own in a heavy frame (what, who, how long, gist, reason,
 * a gauge between brass stops, the facts, the last line of output), the rites ended
 * lately in a light frame, and the commands as key caps.
 */
function drawJobsSlate(table: ElementTable, d: JobsPaneData, cols: number, rows: number, t: Theme, slate: Slate) {
  const { Box, Text } = table
  const c = t.colors
  const w = t.words
  const kit = slateKit(table, t, slate)
  const inner = Math.max(24, cols - 2)
  const body = inner - 4
  const running = runningShown(d.jobs, d.now)
  const ended = endedShown(d.jobs, d.now).slice(0, ENDED_MAX)
  const ENDED_MARK = endedMarks(t)
  const out: JSX.Element[] = []

  const head = running.length === 0 ? 'в покое' : `${running.length} ${plural(running.length, w.jobsHead)}`
  // The forge's instruments: the cog turns while a rite runs, the furnace burns or cools.
  const block = kit.instruments({
    width: inner,
    now: d.now,
    litany: bannerLine(t, 'jobs', inner - COG.columns - 1),
    strip: [slate.strip.jobs, head],
    state: { label: 'ГОРН', awake: 'ПЫЛАЕТ', asleep: 'ОСТЫЛ' },
    awake: running.length > 0,
  })
  if (block !== null) out.push(block)
  else {
    const banner = bannerLine(t, 'jobs', inner)
    if (banner !== null) {
      out.push(
        <Text color={c.accent} bold wrap="truncate-end">
          {banner}
        </Text>,
      )
    }
    out.push(kit.strip(slate.strip.jobs, head, inner))
  }

  for (const job of running) {
    const lines: JSX.Element[] = []
    if (job.description.length > 0) {
      lines.push(
        <Text wrap="truncate-end" color={c.ink}>
          {job.description}
        </Text>,
      )
    }
    lines.push(
      <Text wrap="truncate-end">
        <Text color={c.muted}>
          {w.gist}:{NBSP}
        </Text>
        <Text color={c.ink2}>{job.gist}</Text>
      </Text>,
    )
    if (job.intent !== null) lines.push(...whyRows(table, t, '', w.why, job.intent, body))
    const pr = progressOf(job, d.now)
    if (pr.fraction !== null) {
      const percent = `${Math.floor(pr.fraction * 100)}%`.padStart(4)
      lines.push(
        <Text wrap="truncate-end">
          {kit.gauge(pr.fraction, body - percent.length - 1, c.accent)}
          <Text color={c.ink} bold>
            {' '}
            {percent}
          </Text>
        </Text>,
      )
    }
    lines.push(
      <Text wrap="truncate-end">
        {pr.fraction === null ? <Text color={c.accent}>{t.icons.run} </Text> : ''}
        <Text color={c.ink2}>{pr.facts.join(' · ')}</Text>
        {pr.silentFor !== null ? <Text color={c.warning}> · вывод молчит {fmtDur(pr.silentFor)}</Text> : ''}
      </Text>,
    )
    if (job.lastLine !== null && job.lastLine.length > 0) {
      lines.push(
        <Text wrap="truncate-end" color={c.muted}>
          {'› '}
          {job.lastLine}
        </Text>,
      )
    }
    out.push(
      ...kit.panel({
        style: 'heavy',
        width: inner,
        title: `${t.icons.job} ${w.kinds[job.kind].toUpperCase()}`,
        meta: `${starter(job, d.agents, t)} · ${fmtDur(d.now - job.startedAt)} · ${job.isBackground ? 'в фоне' : 'на виду'}`,
        foot: stamp('ОБРЯД', seedOf(job.id)),
        rows: lines,
      }),
    )
  }

  if (running.length === 0) {
    out.push(
      ...kit.panel({
        style: 'light',
        width: inner,
        title: slate.jobsPlate,
        meta: '▪▪▪',
        rows: wrapLines(w.jobsNone, body, Math.max(2, rows - 12)).map(line => <Text color={c.muted}>{line}</Text>),
        titleColor: c.ink2,
      }),
    )
  }

  if (ended.length > 0) {
    out.push(
      ...kit.panel({
        style: 'light',
        width: inner,
        title: w.jobsEnded.toUpperCase(),
        meta: String(ended.length),
        titleColor: c.ink2,
        rows: ended.map(job => {
          const mark = ENDED_MARK[job.status === 'run' ? 'ok' : job.status]
          const took = fmtDur((job.endedAt ?? d.now) - job.startedAt)
          const code = job.exitCode !== null && job.exitCode !== 0 ? ` · код ${job.exitCode}` : ''
          const what = job.description.length > 0 ? job.description : job.gist
          return (
            <Text wrap="truncate-end">
              <Text color={mark.color}>{mark.icon} </Text>
              <Text color={c.ink2}>{w.kinds[job.kind]}</Text>
              <Text color={c.muted}>
                {' · '}
                {starter(job, d.agents, t)} · {took}
                {code} · {clip(what, 80)}
              </Text>
            </Text>
          )
        }),
      }),
    )
  }

  return (
    <Box flexDirection="column" backgroundColor={c.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
      {out}
      <Box marginTop={1}>{kit.keys(['/jobs close', 'clear', '/mc'])}</Box>
    </Box>
  )
}
