// Tool calls in plain Russian: what the agent is doing, as a person would say it.
// Pure: tool name + input in, words out; no `$`.

import { extractQuery } from './parse'

export type ActionKind = 'memory' | 'read' | 'edit' | 'delete' | 'run' | 'web' | 'agent' | 'ask' | 'other'

/** One action in two tenses: `run` while it goes, `done` once it finished. */
export type ActionText = { kind: ActionKind; run: string; done: string; target: string }

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  return typeof v === 'string' ? v : ''
}

export function basename(path: string): string {
  const parts = path.replace(/["']/g, '').split(/[\\/]/).filter(p => p.length > 0)
  return parts.at(-1) ?? path
}

function act(kind: ActionKind, run: string, done: string, target = ''): ActionText {
  return { kind, run, done, target }
}

/** Shell words that only set the stage (`cd x &&`, `echo ---`) and say nothing about the action. */
const STAGE = /^(cd|echo|date|export|set|sleep|true|clear|printf|for|done|if|then|else|fi)(\s|$)/

/** The meaningful segments of a shell command line (assignments and loop keywords dropped). */
function segments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\n|\|/)
    .map(s => s.trim().replace(/^(do|then|else)\s+/, ''))
    .filter(s => s.length > 0 && !STAGE.test(s) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(s))
}

function argsAfter(segment: string, words: number): string[] {
  return segment
    .split(/\s+/)
    .slice(words)
    .filter(a => a.length > 0 && !a.startsWith('-') && !a.startsWith('2>') && a !== '>')
}

/** One shell segment in words; null when it is not one we recognise. */
function shellSegment(seg: string): ActionText | null {
  const word = seg.split(/\s+/)[0]?.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '') ?? ''
  const rest = seg.slice(seg.indexOf(word) + word.length)
  const sub = argsAfter(seg, 1)[0] ?? ''

  if (word === 'mb') {
    if (sub === 'search') return act('memory', 'ищу в памяти', 'поискал в памяти', `«${extractQuery(rest.replace(/^\s*search/, ''))}»`)
    if (sub === 'code') return act('memory', 'смотрю граф кода', 'посмотрел граф кода', argsAfter(seg, 2).slice(0, 2).join(' '))
    if (sub === 'learn') return act('memory', 'записываю в память', 'записал в память')
    if (sub === 'note' || sub === 'ingest') return act('memory', 'пополняю память', 'пополнил память', `mb ${sub}`)
    return act('memory', 'проверяю память', 'проверил память', `mb ${sub}`.trim())
  }
  if (word === 'rm' || word === 'rmdir' || word === 'del' || word === 'Remove-Item' || word === 'rd') {
    return act('delete', 'удаляю', 'удалил', argsAfter(seg, 1).map(basename).join(', '))
  }
  if (word === 'cp' || word === 'Copy-Item') return act('edit', 'копирую', 'скопировал', argsAfter(seg, 1).map(basename).join(' → '))
  if (word === 'mv' || word === 'Move-Item') return act('edit', 'перемещаю', 'переместил', argsAfter(seg, 1).map(basename).join(' → '))
  if (word === 'mkdir' || word === 'New-Item') return act('edit', 'создаю', 'создал', argsAfter(seg, 1).map(basename).join(', '))
  if (word === 'git') return act(sub === 'commit' || sub === 'push' ? 'edit' : 'read', `git ${sub}`, `git ${sub}`)
  if (word === 'claude' && sub === 'plugin') return act('run', 'проверяю плагин', 'проверил плагин', argsAfter(seg, 2)[0] ?? '')
  if (word === 'npx' || word === 'npm' || word === 'node' || word === 'python' || word === 'python3' || word === 'pytest' || word === 'tsc' || word === 'bash') {
    return act('run', 'запускаю', 'запустил', `${word} ${argsAfter(seg, 1)[0] ?? ''}`.trim())
  }
  if (word === 'cat' || word === 'head' || word === 'tail' || word === 'sed' || word === 'ls' || word === 'grep' || word === 'jq' || word === 'wc' || word === 'Get-Content' || word === 'Get-ChildItem') {
    return act('read', 'смотрю', 'посмотрел', basename(argsAfter(seg, 1).at(-1) ?? word))
  }
  if (word === 'curl' || word === 'wget') return act('web', 'скачиваю', 'скачал', argsAfter(seg, 1)[0] ?? '')
  return null
}

function shell(input: Record<string, unknown>): ActionText {
  const command = str(input, 'command')
  const description = str(input, 'description')
  const segs = segments(command)
  // A chain of several commands: the author's own description says it better than its first step.
  if (segs.length > 2 && description.length > 0) return act('run', 'выполняю', 'выполнил', description)
  for (const seg of segs) {
    const known = shellSegment(seg)
    if (known !== null) return known
  }
  if (description.length > 0) return act('run', 'выполняю', 'выполнил', description)
  return act('run', 'выполняю', 'выполнил', segs[0] ?? command)
}

/**
 * What an Agent or Workflow call really did when it returned at once: it launched work
 * in the background (async_launched, remote_launched) or started a teammate. Null for
 * any other result, which keeps the call's own finished verb.
 */
export function launchedVerb(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const status = (result as { status?: unknown }).status
  if (status === 'async_launched') return 'запустил агента в фоне'
  if (status === 'remote_launched') return 'запустил в облаке'
  if (status === 'teammate_spawned') return 'запустил тиммейта'
  return null
}

/** A tool call in words, by tool name and its input. */
export function describeAction(tool: string, input: Record<string, unknown>): ActionText {
  switch (tool) {
    case 'Read':
      return act('read', 'читаю', 'прочитал', basename(str(input, 'file_path')))
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return act('edit', 'правлю', 'поправил', basename(str(input, 'file_path') || str(input, 'notebook_path')))
    case 'Write':
      return act('edit', 'пишу', 'записал', basename(str(input, 'file_path')))
    case 'Grep':
      return act('read', 'ищу в файлах', 'поискал в файлах', `«${str(input, 'pattern')}»`)
    case 'Glob':
      return act('read', 'ищу файлы', 'нашёл файлы', str(input, 'pattern'))
    case 'Bash':
    case 'PowerShell':
      return shell(input)
    case 'WebFetch': {
      const url = str(input, 'url')
      const host = /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? url
      return act('web', 'читаю страницу', 'прочитал страницу', host)
    }
    case 'WebSearch':
      return act('web', 'ищу в интернете', 'поискал в интернете', `«${str(input, 'query')}»`)
    case 'Agent':
    case 'Task':
      return act('agent', 'работает агент', 'агент закончил', [str(input, 'subagent_type'), str(input, 'description')].filter(Boolean).join(': '))
    case 'Skill':
      return act('other', 'загружаю скил', 'загрузил скил', str(input, 'skill'))
    case 'ToolSearch':
      return act('other', 'подгружаю инструменты', 'подгрузил инструменты')
    case 'AskUserQuestion':
      return act('ask', 'спрашиваю тебя', 'спросил тебя')
    case 'TodoWrite':
      return act('other', 'обновляю план', 'обновил план')
    case 'Artifact':
      return act('web', 'публикую страницу', 'опубликовал страницу')
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
      if (mcp !== null) return act('other', 'вызываю', 'вызвал', `${mcp[1]}/${mcp[2]}`)
      return act('other', 'вызываю', 'вызвал', tool)
    }
  }
}
