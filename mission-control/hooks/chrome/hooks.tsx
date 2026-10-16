import type { ElementTable, On, RenderElement } from 'claude-code'

import { fmtDur } from '../lib/viz'
import { rankOf } from '../lib/theme'
import type { Slate, Theme } from '../lib/theme'
import { decorateMarkdown, decorateNotice, litanyFor, ritesEnd, translateHint, willOfTheMagister } from './text'

// The transcript dressed as the slate: the person's prompt in an amber frame, each
// reply block in a brass frame with its markdown marked by crosses, each tool call a
// rite in a thin frame (a group of calls and a result on a rail), a slash command's
// output under a plate, the spinner and the closing line in the cogitator's words, the
// hint under the prompt with a litany. The engine still draws every row's body
// (markdown, diffs, highlighting): each hook wraps the tree `next(e)` resolves to and
// changes no stored text. Terminal only; any other surface draws the engine's own.
// Registered only for a theme with a slate, so the classic look never passes through.
// The engine's own notices have no render site; two of them (a plugin's "reloaded", the
// recap) are rewritten where they are kept, at session.append, so the screen reads them so.

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

/**
 * A row on a rail: a one-cell column in `color` the full height of the row (a Box with a
 * background stretches to its row's height), a space, then what the engine drew.
 */
function onRail(table: ElementTable, color: string, body: RenderElement): RenderElement {
  const { Box } = table
  return (
    <Box flexDirection="row">
      <Box width={1} flexShrink={0} backgroundColor={color} />
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
        {body}
      </Box>
    </Box>
  )
}

/** The plate halves per border style, so a plate sits in its frame's own line. */
const PLATE_ENDS: Record<'double' | 'bold' | 'single', readonly [string, string]> = {
  double: ['╡', '╞'],
  bold: ['┫', '┣'],
  single: ['┤', '├'],
}

/** The rite a tool call performs, as its plate names it; any other tool by its own name. */
const RITES: Record<string, string> = {
  Bash: 'ОБРЯД',
  PowerShell: 'ОБРЯД',
  Monitor: 'ДОЗОР',
  Read: 'ЧТЕНИЕ СВИТКА',
  Edit: 'ПРАВКА КОДЕКСА',
  Write: 'НАЧЕРТАНИЕ',
  NotebookEdit: 'ПРАВКА КОДЕКСА',
  Grep: 'ПОИСК',
  Glob: 'ПОИСК',
  Agent: 'ПРИЗЫВ',
  Skill: 'ЛИТАНИЯ',
  WebFetch: 'ВОКС-ЗАПРОС',
  WebSearch: 'ВОКС-ЗАПРОС',
  TodoWrite: 'ОБЕТЫ',
  AskUserQuestion: 'ВОПРОС МАГИСТРУ',
}

export function riteOf(tool: string): string {
  const rite = RITES[tool]
  if (rite !== undefined) return `${rite} · ${tool.toUpperCase()}`
  // An MCP tool: mcp__server__name, shown by its server and name.
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp === null ? tool.toUpperCase() : `ВОКС · ${mcp[1]?.toUpperCase()} · ${mcp[2]}`
}

/**
 * What the engine drew, in a frame of the terminal's own (`double`, `bold` or `single`,
 * so it spans any height), its name plate the frame's first row and a lamp laid over the
 * engine's dot. An element placed over the frame's edge is clipped to the frame's inside
 * (seen live 2026-10-16), so the plate is a row of its own. The engine draws its dot
 * (⏺ on macOS, ● elsewhere) in a two-cell column under a one-row margin and its text
 * from the third cell: under the plate the dot is the inside's row 2, cell 1, and a row
 * without the margin puts the lamp in that empty column, never on text.
 */
function framed(
  table: ElementTable,
  o: {
    border: 'double' | 'bold' | 'single'
    color: string
    plate: string
    plateInk: string
    lamp?: { glyph: string; color: string }
  },
  body: RenderElement,
): RenderElement {
  const { Box, Text } = table
  const [open, close] = PLATE_ENDS[o.border]
  return (
    <Box flexDirection="column" borderStyle={o.border} borderColor={o.color} paddingX={1}>
      <Text wrap="truncate-end">
        <Text color={o.color}>{open}</Text>
        <Text color={o.plateInk} bold>
          {` ✠ ${o.plate} `}
        </Text>
        <Text color={o.color}>{close}</Text>
      </Text>
      {body}
      {o.lamp !== undefined ? (
        <Box position="absolute" top={2} left={1}>
          <Text color={o.lamp.color} bold>
            {o.lamp.glyph}
          </Text>
        </Box>
      ) : (
        ''
      )}
    </Box>
  )
}

/** The indicator lamp over the engine's dot: one glyph, a narrow cell. */
const LAMP = '◉'
/** A lamp gone cold: a rite done. */
const LAMP_COLD = '#7a2418'

/** A name plate on its own row: `▐█ ✠ PLATE ✠ █▌ ────── note`, the plate inverse. */
function plateRow(table: ElementTable, t: Theme, slate: Slate, plate: string, color: string, note = ''): RenderElement {
  const { Text } = table
  return (
    <Text wrap="truncate-end">
      <Text backgroundColor={color} color={t.colors.surface} bold>
        {` ✠ ${plate} `}
      </Text>
      <Text color={slate.frame}> ═══</Text>
      {note.length > 0 ? <Text color={t.colors.muted}> {note}</Text> : ''}
    </Text>
  )
}

/** Who speaks in a user-role row, by where the message came from. */
function speaker(origin: string, slate: Slate, from: string | undefined): string | null {
  if (origin === 'composer' || origin === 'bridge' || origin === 'sdk') return slate.user
  if (origin === 'task-notification') return 'ВЕСТЬ ОБ ОБРЯДЕ'
  if (from !== undefined) return `ВОКС: ${from.toUpperCase()}`
  return null
}

export function registerChrome(on: On, theme: Theme): void {
  const slate = theme.slate
  if (slate === null) return
  const c = theme.colors

  /** An Agent call's plate names the rank it summons: «ПРИЗЫВ · ☩ ИНКВИЗИТОР». */
  const summoned = (p: { tool: string; input: unknown }): string | null => {
    if (p.tool !== 'Agent' || typeof p.input !== 'object' || p.input === null) return null
    const type = (p.input as { subagent_type?: unknown }).subagent_type
    const rank = typeof type === 'string' ? rankOf(theme, type) : null
    return rank === null ? null : `ПРИЗЫВ · ${rank.icon} ${rank.title.toUpperCase()}`
  }

  // A notice is kept as one text block and never read by the model: the reload notice and
  // the recap are rewritten in the cogitator's words before they are kept and drawn.
  on('session.append', { door: 'notice' }, async ($, e, next) => {
    if (e.message.type !== 'system') return next(e)
    let changed = false
    const content = e.message.content.map(block => {
      if (block.type !== 'text' || typeof block.text !== 'string') return block
      const text = decorateNotice(block.text)
      if (text === null) return block
      changed = true
      return { ...block, text }
    })
    return changed ? next({ ...e, message: { ...e.message, content } }) : next(e)
  }).catch(($, e, next) => next(e))

  // The spinner: the cogitator's phrase for what the turn does, the engine's timer after it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null) return next(e)
    return next({ ...e, props: { ...e.props, word: slate.spinner[e.props.mode] } })
  }).catch(($, e, next) => next(e))

  // The line that closes a turn: «═══╡ ☩ Обряд свершён · 12с ╞═══ +++ Император защищает +++».
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text wrap="truncate-end">
        <Text color={slate.frame}>═══╡ </Text>
        <Text color={c.good}>{theme.icons.ok} </Text>
        <Text color={c.ink2}>
          {slate.turnDone} · {fmtDur(e.props.durationMs)}
        </Text>
        <Text color={slate.frame}> ╞═══ </Text>
        <Text color={c.muted}>+++ {litanyFor(e.props.durationMs)} +++</Text>
      </Text>
    )
  }).catch(($, e, next) => next(e))

  // The person's prompt, a task's notification, another party's message: in a bold amber
  // frame under the speaker's plate. A compact row (not expanded) keeps the engine's line.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const body = await next(e)
    const plate = speaker(e.props.origin.kind, slate, e.props.from?.name)
    if (plate === null) return body
    const color = e.props.origin.kind === 'task-notification' ? c.warning : c.accent
    return framed($.ui.resolve(e), { border: 'bold', color, plate, plateInk: c.accent }, body)
  }).catch(($, e, next) => next(e))

  // A reply block: its markdown marked with the slate's crosses, in a double brass frame
  // under the plate «✠ ДОНЕСЕНИЕ», a red lamp over the dot. Each block (the text
  // between two tool calls) is a dispatch of its own.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const body = await next({ ...e, props: { ...e.props, text: decorateMarkdown(e.props.text) } })
    return framed(
      $.ui.resolve(e),
      { border: 'double', color: slate.frame, plate: slate.reply, plateInk: c.accent, lamp: { glyph: LAMP, color: c.critical } },
      body,
    )
  }).catch(($, e, next) => next(e))

  // A tool call is a rite: a thin brass frame, its kind and state on the plate (✦ runs,
  // ☩ done); the accent while it runs. A failure is heresy found: a heavy scarlet frame
  // and its own plate, a refusal at the dialog is the Magister's rejection, a cut call a
  // rite cut short.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const body = await next(e)
    const p = e.props
    const rite = summoned(p) ?? riteOf(p.tool)
    const verdict = ritesEnd({ isErrored: p.isErrored, isInterrupted: p.isInterrupted, output: p.output })
    if (verdict !== null) {
      const color = verdict.kind === 'interrupted' ? c.warning : c.critical
      return framed(
        $.ui.resolve(e),
        { border: verdict.kind === 'heresy' ? 'bold' : 'single', color, plate: `${verdict.plate} · ${rite}`, plateInk: color, lamp: { glyph: LAMP, color } },
        body,
      )
    }
    return framed(
      $.ui.resolve(e),
      {
        border: 'single',
        color: p.isRunning ? c.accent : c.rule,
        plate: `${rite} ${p.isRunning ? theme.icons.run : theme.icons.ok}`,
        plateInk: c.ink2,
        lamp: { glyph: LAMP, color: p.isRunning ? c.critical : LAMP_COLD },
      },
      body,
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const body = await next(e)
    return onRail($.ui.resolve(e), e.props.isErrored ? c.critical : c.rule, body)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const body = await next(e)
    return onRail($.ui.resolve(e), e.props.isActive ? c.accent : c.rule, body)
  }).catch(($, e, next) => next(e))

  // A slash command's output: under the plate «ОТВЕТ КОГИТАТОРА · /cmd», on a rail.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const body = await next(e)
    const table = $.ui.resolve(e)
    const { Box } = table
    const color = e.props.isErrored ? c.critical : c.ink2
    return (
      <Box flexDirection="column">
        {plateRow(table, theme, slate, slate.command, color, `/${e.props.command}`)}
        {onRail(table, color, body)}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // A question to the person is a request for the Magister's will: the dialog in a bold
  // amber frame under its plate, each question and header after a cross.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const body = await next({ ...e, props: { ...e.props, questions: willOfTheMagister(e.props.questions) } })
    return framed($.ui.resolve(e), { border: 'bold', color: c.accent, plate: 'ЗАПРОС ВОЛИ МАГИСТРА', plateInk: c.accent }, body)
  }).catch(($, e, next) => next(e))

  // A status line under the logo: «+++ text +++».
  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    return next({ ...e, props: { ...e.props, text: `${slate.notice} ${e.props.text} ${slate.notice}` } })
  }).catch(($, e, next) => next(e))

  // The hint under the prompt in the cogitator's words, the litany at its end. A hint with
  // no phrase known keeps the engine's line (its pills live) and gets the litany as a tail.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isDraft) return next(e)
    const litany = e.props.isWorking ? slate.hintWorking : slate.hintIdle
    const words = translateHint(e.props.hint)
    if (words === null) return next({ ...e, props: { ...e.props, tail: `  ${litany}` } })
    return next({ ...e, props: { ...e.props, hint: `${words}  ${litany}` } })
  }).catch(($, e, next) => next(e))

  // The run-in-background pill keeps the person's own key binding.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.kind !== 'background_hint') return next(e)
    const hint = e.props.hint.replace(/to run in background/i, `— ${slate.backgroundHint}`)
    return next({ ...e, props: { ...e.props, hint } })
  }).catch(($, e, next) => next(e))
}
