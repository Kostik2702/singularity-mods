// What the slate adds to a reply's markdown before the engine draws it: a cross before
// each heading, a dotted cross before each list item, a dagger before a quote. Fenced
// code, tables, thematic breaks and task boxes are left exactly as written, and so is
// every other line; only the drawing changes, never the stored message.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const HEADING = /^(\s{0,3}#{1,6})\s+(?!✠)(\S.*)$/
// A thematic break (`---`, `- - -`, `***`, `___`): never a bullet.
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
// A bullet item, not a task box (`- [ ]`).
const BULLET = /^(\s*)([-*+])\s+(?!\[[ xX]\]\s)(?!⁜)(\S.*)$/
const QUOTE = /^(\s{0,3}>\s?)(?!‡)(\S.*)$/

/** The reply's markdown with the slate's marks added outside code. */
export function decorateMarkdown(text: string): string {
  let fence: string | null = null
  return text
    .split('\n')
    .map(line => {
      const open = FENCE.exec(line)
      if (fence !== null) {
        if (open !== null && open[1] !== undefined && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null
        return line
      }
      if (open !== null && open[1] !== undefined) {
        fence = open[1]
        return line
      }
      if (/^\s*\|/.test(line) || RULE.test(line)) return line
      const heading = HEADING.exec(line)
      if (heading !== null) return `${heading[1]} ✠ ${heading[2]}`
      const bullet = BULLET.exec(line)
      if (bullet !== null) return `${bullet[1]}${bullet[2]} ⁜ ${bullet[3]}`
      const quote = QUOTE.exec(line)
      if (quote !== null) return `${quote[1]}‡ ${quote[2]}`
      return line
    })
    .join('\n')
}

const LITANIES = [
  'Император защищает',
  'Хвала Омниссии',
  'Знание — сила, храни его',
  'Дух Машины доволен',
  'Без сомнений — без страха',
  'Плоть слаба, металл вечен',
  'Во тьме — лишь свет Его',
] as const

/** A litany for the line that closes a turn, picked by `seed` so a redraw keeps it. */
export function litanyFor(seed: number): string {
  const i = Math.abs(Math.floor(seed)) % LITANIES.length
  return LITANIES[i] ?? LITANIES[0]
}

const RELOADED = /^(\S+): reloaded \((\d+) hooks?: ([\s\S]+)\)\s*$/
const RECAP = /^(※\s*)?recap:\s*/i

/**
 * The engine's notice that a plugin reloaded, and the recap of a session left idle, in
 * the cogitator's words; null for any other notice, which stays as the engine wrote it
 * (some carry markup their own drawing reads, a command's output among them).
 */
export function decorateNotice(text: string): string | null {
  const reload = RELOADED.exec(text)
  if (reload !== null) {
    return `✠ +++ ${reload[1]}: Дух Машины пробуждён заново · освящено обрядов: ${reload[2]} (${reload[3]}) +++`
  }
  if (RECAP.test(text)) return text.replace(RECAP, '✠ ЛЕТОПИСЬ КОГИТАТОРА: ')
  return null
}

/** The engine's hint under the prompt, in the cogitator's words; its keys and mode marks kept. */
const HINT_WORDS: readonly (readonly [RegExp, string])[] = [
  [/accept edits on/i, 'правки дозволены'],
  [/plan mode on/i, 'режим замысла'],
  [/bypass permissions on/i, 'без дозволений'],
  [/auto mode on/i, 'самоход'],
  [/\(shift\+tab to cycle\)/i, '(shift+tab — сменить)'],
  [/for agents/i, 'к агентам'],
  [/\? for shortcuts/i, '? — руны клавиш'],
  [/esc to interrupt/i, 'esc — прервать обряд'],
  [/to run in background/i, '— в фон'],
]

/** The hint translated; null when no phrase of it is known, so the engine's line stays. */
export function translateHint(hint: string): string | null {
  let out = hint
  for (const [phrase, words] of HINT_WORDS) out = out.replace(phrase, words)
  return out === hint ? null : out
}

/** What a refusal at the permission dialog leaves as the call's output. */
const REFUSED = /doesn't want to proceed|was rejected|user (?:rejected|denied)|permission (?:was )?denied/i

/**
 * How a failed or cut rite reads, or null for one that ran: heresy found (an error), the
 * Magister's rejection (a refusal at the dialog, told by the text the model read), a rite
 * cut short (an abort).
 */
export function ritesEnd(p: { isErrored: boolean; isInterrupted: boolean; output?: unknown }): { kind: 'heresy' | 'rejected' | 'interrupted'; plate: string } | null {
  if (p.isInterrupted) return { kind: 'interrupted', plate: '⊗ ОБРЯД ПРЕРВАН' }
  if (!p.isErrored) return null
  const said = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
  if (REFUSED.test(said)) return { kind: 'rejected', plate: '⊘ ОТВЕРГНУТО МАГИСТРОМ' }
  return { kind: 'heresy', plate: '‡ ЕРЕСЬ ОБНАРУЖЕНА' }
}
