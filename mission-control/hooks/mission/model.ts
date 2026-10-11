// Mission control's model: pure functions from engine facts to agent rows, and the
// text helpers that say what an agent is doing and why. No `$` here: the hooks feed
// facts in, the tests call these directly.

export const INTENT_MAX = 160
export const TASK_MAX = 240
export const DESCRIPTION_MAX = 120

/** Cuts to `max` characters, counted in code points so no emoji is split; an ellipsis marks the cut. */
export function clip(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`
}

/** Markdown down to plain words: code blocks and table rows dropped, marks stripped, links to their text. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, '\n')
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|[\s(«"])[*_]([^*_\n]+)[*_](?=[\s).,!?:;»"]|$)/gm, '$1$2')
}

/** The plain sentences of a text, in order: split after . ! ? … followed by a space, and at line breaks. */
export function sentences(text: string): string[] {
  return plainText(text)
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[.!?…])\s+/))
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(part => /[\p{L}\p{N}]/u.test(part))
}

/** What a step's text says last: before a tool call that is what the agent does next, and why. */
export function lastSentence(text: string): string | null {
  const last = sentences(text).at(-1)
  return last === undefined ? null : clip(last, INTENT_MAX)
}

/** What a text says first: a subagent's report opens with its point. */
export function firstSentence(text: string): string | null {
  const first = sentences(text)[0]
  return first === undefined ? null : clip(first, INTENT_MAX)
}

/** A task prompt as one line of plain words from its start. */
export function taskLine(prompt: string): string {
  return clip(sentences(prompt).join(' '), TASK_MAX)
}
