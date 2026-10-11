import { describe, expect, test } from 'claude-code/testing'

import {
  countDoctor,
  estimateTokens,
  findMbInvocations,
  matchesHitPath,
  parseSearchOutput,
} from '../hooks/parse'

// Real `mb search` rows, as the CLI printed them on 2026-10-02.
const MIXED = [
  '1. reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md | 0.68 | [memory] | CLAUDE-CODE-CLI-CUSTOMIZATION/Statusline | - Config: ...',
  '2. learnings/active/GENERAL.md | 0.51 | [learning] | GENERAL/2026-09-07 22:20 | Tooling: ...',
  '3. voice-text-recognition/src/infrastructure/render/MarkdownRenderer.ts | 0.52 | [function] | renderParagraph | function renderParagraph(',
  '  const anchor = `<!-- t=${x} -->`;',
  '4. learnings/active/CLI-FACADE.md | 0.53 | [learning@singularity] | CLI-FACADE/2026-08-04 23:36 | ...',
  '-- 970.6ms',
].join('\n')

describe('findMbInvocations', () => {
  test('a search behind cd and a pipe counts once, with its quoted query', () => {
    expect(findMbInvocations('cd /e/x && mb search "статус бар" --top 5 2>&1 | head -40')).toEqual([
      { kind: 'search', query: 'статус бар', isCodeOnly: false },
    ])
  })

  test('mb search inside another command argument is not a search', () => {
    expect(findMbInvocations('mb learn "use mb search first" --task X')).toEqual([])
    expect(findMbInvocations('echo "mb search later"')).toEqual([])
  })

  test('several searches, code-only flag and mb code are told apart', () => {
    const found = findMbInvocations('mb search "a" | head; echo ---; mb search \'b\' --code-only\nmb code callers Foo.bar')
    expect(found.map(f => [f.kind, f.query, f.isCodeOnly])).toEqual([
      ['search', 'a', false],
      ['search', 'b', true],
      ['code', 'callers', true],
    ])
  })

  test('a full path to the CLI and env prefixes still match', () => {
    expect(findMbInvocations('MB_HOME=/x /e/Singularity/bin/mb search q').length).toBe(1)
  })
})

describe('parseSearchOutput', () => {
  test('text rows: memory by note type, code otherwise, best score, unique paths', () => {
    const parsed = parseSearchOutput(MIXED, false)
    expect(parsed.hits).toBe(4)
    expect(parsed.memHits).toBe(3)
    expect(parsed.codeHits).toBe(1)
    expect(parsed.best).toBe(0.68)
    expect(parsed.paths[2]).toBe('voice-text-recognition/src/infrastructure/render/MarkdownRenderer.ts')
  })

  test('--code-only forces every row to code', () => {
    expect(parseSearchOutput(MIXED, true).codeHits).toBe(4)
  })

  test('--json document', () => {
    const json = JSON.stringify({
      results: [
        { meta: { file: 'reference/A.md' }, score: 0.49, source: 'memory' },
        { meta: { file: 'repo/a.ts' }, score: 0.61, source: 'code' },
      ],
    })
    const parsed = parseSearchOutput(json, false)
    expect([parsed.hits, parsed.memHits, parsed.codeHits, parsed.best]).toEqual([2, 1, 1, 0.61])
  })

  test('no rows: zero hits, no best', () => {
    expect(parseSearchOutput('mb: index is empty', false)).toEqual({ hits: 0, memHits: 0, codeHits: 0, best: null, paths: [] })
  })
})

test('estimateTokens: ASCII 4 chars per token, Cyrillic 2.5', () => {
  expect(estimateTokens('abcdefgh')).toBe(2)
  expect(estimateTokens('абвгд')).toBe(2)
})

test('matchesHitPath: a Windows absolute path matches a vault-relative hit', () => {
  const hit = matchesHitPath('E:\\obsidian\\memory brain\\reference\\CLAUDE-CODE-CLI-CUSTOMIZATION.md', [
    'learnings/active/GENERAL.md',
    'reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md',
  ])
  expect(hit).toBe('reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md')
  expect(matchesHitPath('E:/other/GENERAL.md.bak', ['learnings/active/GENERAL.md'])).toBeUndefined()
})

test('countDoctor counts WARN and FAIL checks', () => {
  const json = JSON.stringify({ checks: [{ status: 'PASS' }, { status: 'WARN' }, { status: 'WARN' }, { status: 'FAIL' }] })
  expect(countDoctor(json)).toEqual({ warn: 2, fail: 1 })
})
