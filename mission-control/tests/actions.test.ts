import { describe, expect, test } from 'claude-code/testing'

import { describeAction } from '../hooks/lib/actions'
import { fmtDur, plural } from '../hooks/lib/viz'

const say = (tool: string, input: Record<string, unknown>) => {
  const a = describeAction(tool, input)
  return `${a.done} ${a.target}`.trim()
}

describe('describeAction', () => {
  test('files: read, edit, write by basename', () => {
    expect(say('Read', { file_path: 'E:\\obsidian\\memory brain\\reference\\X.md' })).toBe('прочитал X.md')
    expect(say('Edit', { file_path: 'C:/a/b/pane.tsx' })).toBe('поправил pane.tsx')
    expect(say('Write', { file_path: '/tmp/new.ts' })).toBe('записал new.ts')
    expect(describeAction('Edit', { file_path: 'x.ts' }).run).toBe('правлю')
  })

  test('memory: mb search behind cd and a pipe, mb learn, mb code', () => {
    expect(say('Bash', { command: 'cd /e/x && mb search "статус бар" --top 5 | head -40' })).toBe('поискал в памяти «статус бар»')
    expect(describeAction('Bash', { command: 'mb search "q"' }).kind).toBe('memory')
    expect(say('Bash', { command: 'mb learn "insight" --task X' })).toBe('записал в память')
    expect(say('PowerShell', { command: 'mb code callers Foo.bar' })).toBe('посмотрел граф кода callers Foo.bar')
  })

  test('shell: delete, run, look', () => {
    expect(say('Bash', { command: 'rm -rf /tmp/a/old.log' })).toBe('удалил old.log')
    expect(describeAction('Bash', { command: 'rm x' }).kind).toBe('delete')
    expect(say('Bash', { command: 'npx -y -p typescript tsc -p tsconfig.json' })).toBe('запустил npx typescript')
    expect(say('Bash', { command: 'cat ~/.claude/settings.json' })).toBe('посмотрел settings.json')
  })

  test('a long chain speaks with the author description', () => {
    const a = describeAction('Bash', { command: 'M=x; node a.js; tsc; claude plugin test m', description: 'Type-check and test the mod' })
    expect(`${a.done} ${a.target}`).toBe('выполнил Type-check and test the mod')
  })

  test('web, agents, skills, mcp', () => {
    expect(say('WebFetch', { url: 'https://claude.com/blog/claude-code-mods' })).toBe('прочитал страницу claude.com')
    expect(say('Agent', { subagent_type: 'Explore', description: 'find callers' })).toBe('агент закончил Explore: find callers')
    expect(say('Skill', { skill: 'dataviz' })).toBe('загрузил скил dataviz')
    expect(say('mcp__context7__query-docs', {})).toBe('вызвал context7/query-docs')
  })
})

test('fmtDur and plural', () => {
  expect([fmtDur(45_000), fmtDur(134_000), fmtDur(3_900_000)]).toEqual(['45с', '2м14с', '1ч05м'])
  expect([1, 2, 5, 11, 21, 22, 25].map(n => plural(n, ['шаг', 'шага', 'шагов']))).toEqual(['шаг', 'шага', 'шагов', 'шагов', 'шаг', 'шага', 'шагов'])
})
