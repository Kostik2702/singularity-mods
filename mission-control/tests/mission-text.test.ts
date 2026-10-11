import { describe, expect, test } from 'claude-code/testing'

import { clip, firstSentence, lastSentence, plainText, taskLine } from '../hooks/mission/model'

describe('lastSentence', () => {
  test('takes the last sentence: what the agent does next', () => {
    expect(lastSentence('Факты собраны. Мульти-панели в доке становятся табами. Проверю, как размещаются панели.')).toBe(
      'Проверю, как размещаются панели.',
    )
  })

  test('English, and a question at the end', () => {
    expect(lastSentence('Found the parser. Now checking the regex?')).toBe('Now checking the regex?')
  })

  test('markdown marks, inline code, emphasis and links are reduced to their words', () => {
    expect(lastSentence('**Итог:** читаю `parse.ts` и [доку](https://x.y/z).')).toBe('Итог: читаю parse.ts и доку.')
    expect(lastSentence('Это *важно* сейчас.')).toBe('Это важно сейчас.')
  })

  test('a fenced code block and a table never become the reason', () => {
    const text = 'Сверяю вывод mb search с регэкспом.\n\n```ts\nconst x = 1.\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    expect(lastSentence(text)).toBe('Сверяю вывод mb search с регэкспом.')
  })

  test('a line break ends a sentence; a list item is a sentence', () => {
    expect(lastSentence('План:\n- прочитать types\n- проверить test')).toBe('проверить test')
  })

  test('decimals and paths do not split a sentence', () => {
    expect(lastSentence('Лучший балл 0.68 у reference/A.md. Открываю E:/x/y.ts сейчас')).toBe('Открываю E:/x/y.ts сейчас')
  })

  test('nothing worth saying gives null', () => {
    expect(lastSentence('')).toBeNull()
    expect(lastSentence('   \n\n  ')).toBeNull()
    expect(lastSentence('```\ncode only\n```')).toBeNull()
    expect(lastSentence('---')).toBeNull()
  })

  test('a 5000-character answer gives one clipped sentence', () => {
    const out = lastSentence(`Начало. ${'слово '.repeat(1000)}конец.`) ?? ''
    expect([...out].length).toBe(160)
    expect(out.endsWith('…')).toBe(true)
    expect(out.includes('\n')).toBe(false)
  })
})

test('firstSentence takes the point a report opens with', () => {
  expect(firstSentence('Корень: регэксп не ловит отрицательные баллы. Детали ниже.\n\n## Детали\n...')).toBe(
    'Корень: регэксп не ловит отрицательные баллы.',
  )
  expect(firstSentence('')).toBeNull()
})

test('taskLine: a prompt as one line of words, code dropped, cut to 240', () => {
  expect(taskLine('## Задача\nНайди корень бага в parse.ts.\n```\nstack\n```\nОтчитайся кратко.')).toBe(
    'Задача Найди корень бага в parse.ts. Отчитайся кратко.',
  )
  expect([...taskLine('x '.repeat(500))].length).toBe(240)
})

test('plainText drops table rows and keeps the words of a heading', () => {
  expect(plainText('## Итог\n| a | b |\n|---|---|\nготово').split('\n').filter(Boolean)).toEqual(['Итог', 'готово'])
})

test('clip counts code points, so an emoji is never split', () => {
  expect(clip('ab🙂cd', 4)).toBe('ab🙂…')
  expect(clip('abc', 4)).toBe('abc')
})
