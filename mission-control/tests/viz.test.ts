import { describe, expect, test } from 'claude-code/testing'

import { allocate, bigText, meter, sparkline } from '../hooks/viz'

describe('allocate', () => {
  test('fills the width exactly, gaps included, largest remainder first', () => {
    const cells = allocate([2942, 7319, 189, 0], 40)
    const live = cells.filter(c => c > 0).length
    expect(cells.reduce((a, b) => a + b, 0) + (live - 1)).toBe(40)
    expect(cells[3]).toBe(0)
  })

  test('a tiny non-zero source keeps one visible cell', () => {
    expect(allocate([100000, 1], 20)[1]).toBe(1)
  })

  test('nothing to draw draws nothing', () => {
    expect(allocate([0, 0], 20)).toEqual([0, 0])
  })
})

test('meter: fill + partial + track always add up to the width', () => {
  for (const f of [0, 0.01, 0.3, 0.5, 0.999, 1, 1.5, -1, Number.NaN]) {
    const m = meter(f, 24)
    expect([...m.fill].length + [...m.track].length).toBe(24)
  }
})

test('sparkline: one cell per turn, a dot for a turn with nothing', () => {
  expect(sparkline([189, 0, 0, 1200, 40])).toBe('▂··█▁')
  expect(sparkline([0, 0])).toBe('··')
})

test('bigText: three rows of equal width for every figure', () => {
  for (const s of ['0', '10.4k', '999', '1.2M']) {
    const rows = bigText(s)
    expect(rows[0].length).toBe(rows[1].length)
    expect(rows[1].length).toBe(rows[2].length)
  }
})
