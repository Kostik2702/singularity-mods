import { describe, expect, test } from 'claude-code/testing'

import { balanceOf, fmtCost, fmtMoney, fmtTime, journalPathOf, machineId, newest, figuresOf, parseJournal, parseLine, parseStatus, previousOf, summarize, vaultOf } from '../hooks/jev/model'

const line = (o: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ts: '2026-10-20T11:02:03.123+03:00',
    session: 'sess-1',
    kind: 'router',
    head: 'сделай  поиск\nпо базе',
    chars: 20,
    size: 'small',
    followup: 0.1,
    confidence: 0.71,
    decided: 'jev',
    route: 'haiku·low',
    cost: 0.000012,
    ms: 812,
    model: 'jev-1.13.0',
    error: null,
    test: false,
    ...o,
  })

const NONE = { enabled: null, keyFound: null, model: null, budget: null, journal: null, totalCost: null, sessionCost: null, balance: null }

describe('parsing the journal', () => {
  test('a line becomes an entry; whitespace in the head collapses', () => {
    expect(parseLine(line())).toMatchObject({ kind: 'router', head: 'сделай поиск по базе', size: 'small', decided: 'jev', cost: 0.000012, ms: 812, error: null, test: false })
  })

  test('a half-written last line is skipped, the whole lines before it stay', () => {
    const text = `${line()}\n${line({ kind: 'ask' })}\n{"ts":"2026-10-20T11:05`
    expect(parseJournal(text).map(e => e.kind)).toEqual(['router', 'ask'])
  })

  test('a last line without a newline that is whole is kept', () => {
    expect(parseJournal(`${line()}\n${line({ kind: 'pick' })}`).map(e => e.kind)).toEqual(['router', 'pick'])
  })

  test('a tail cut mid-file drops its first stump', () => {
    const text = `ts":"x","cost":9}\n${line({ cost: 1 })}\n`
    expect(parseJournal(text, true).map(e => e.cost)).toEqual([1])
  })

  test('an empty text, noise and non-objects give nothing and never throw', () => {
    expect(parseJournal('')).toEqual([])
    expect(parseJournal('\n\nnot json\n[1,2]\n"x"\n42\n')).toEqual([])
  })

  test('a cost that is not a number counts as zero, a negative one too', () => {
    expect(parseLine(line({ cost: 'lots' }))?.cost).toBe(0)
    expect(parseLine(line({ cost: -3 }))?.cost).toBe(0)
  })

  test('a test line is marked, an error line keeps its error', () => {
    expect(parseLine(line({ test: true }))?.test).toBe(true)
    expect(parseLine(line({ error: 'http:401', cost: 0 }))?.error).toBe('http:401')
  })

  test('the head is cut to 80 characters', () => {
    expect([...(parseLine(line({ head: 'я'.repeat(200) }))?.head ?? '')].length).toBe(80)
  })
})

describe('totals', () => {
  const entries = parseJournal(
    [
      line({ session: 'sess-1', cost: 0.5, size: 'small' }),
      line({ session: 'sess-2', cost: 0.25, size: 'large', decided: 'self', route: null }),
      line({ session: 'sess-1', cost: 0.125, size: 'small', kind: 'ask', error: 'http:429' }),
      line({ session: null, cost: 0.0625, size: null, kind: 'probe', test: true }),
    ].join('\n') + '\n',
  )

  test('the cost sums over all time and over the session only', () => {
    const s = summarize(entries, 'sess-1')
    expect(Math.abs(s.totalCost - 0.9375)).toBeLessThan(1e-9)
    expect(Math.abs(s.sessionCost - 0.625)).toBeLessThan(1e-9)
    expect(s.calls).toBe(4)
    expect(s.sessionCalls).toBe(2)
  })

  test('with no session known, the session figure is zero, not the total', () => {
    expect(summarize(entries, null)).toMatchObject({ sessionCost: 0, sessionCalls: 0 })
  })

  test('counts per size, decided by self and errors', () => {
    expect(summarize(entries, 'sess-1')).toMatchObject({ bySize: { small: 2, large: 1 }, self: 1, errors: 1 })
  })

  test('the journal newest first, the last N', () => {
    const many = parseJournal(Array.from({ length: 60 }, (_, i) => line({ ms: i })).join('\n'))
    const shown = newest(many, 50)
    expect(shown).toHaveLength(50)
    expect(shown[0]?.ms).toBe(59)
    expect(shown.at(-1)?.ms).toBe(10)
  })

  test('the balance is the budget less the total; none without a budget', () => {
    expect(Math.abs((balanceOf(5, 0.9375) ?? 0) - 4.0625)).toBeLessThan(1e-9)
    expect(balanceOf(null, 1)).toBeNull()
    expect(balanceOf(1, 3)).toBe(-2)
  })
})

describe('what is shown', () => {
  test('costs have six decimals, zero is $0, a negative balance keeps its sign', () => {
    expect(fmtCost(0.0000123)).toBe('$0.000012')
    expect(fmtCost(0)).toBe('$0')
    expect(fmtMoney(-2)).toBe('-$2.000000')
  })

  test('the time reads as month-day and clock', () => {
    expect(fmtTime('2026-10-20T11:02:03.123+03:00')).toBe('10-20 11:02:03')
    expect(fmtTime('garbage')).toBe('garbage')
  })
})

describe('where the journal is', () => {
  test('the status JSON gives the flags, the model, the budget and the journal path by the engine\'s names', () => {
    expect(parseStatus('{"enabled":true,"key_found":false,"model":"jev-1","budget_usd":5,"journal":"/v/log.jsonl"}')).toEqual({
      ...NONE,
      enabled: true,
      keyFound: false,
      model: 'jev-1',
      budget: 5,
      journal: '/v/log.jsonl',
    })
    // Only the engine's names count: other spellings read as absent.
    expect(parseStatus('{"jev_enabled":false,"key":{"found":true},"jev_budget_usd":2,"journal_path":"/x"}')).toEqual(NONE)
    expect(parseStatus('{"enabled":false,"key_found":true,"key_backend":"keychain","model":"m","journal":"/x","budget_usd":null,"total_cost":1,"session_cost":null,"session":null,"balance_usd":null,"by_size":{},"decided_self":0,"errors":0,"calls":2,"cost_by_kind":{}}')).toEqual({ enabled: false, keyFound: true, model: 'm', budget: null, journal: '/x', totalCost: 1, sessionCost: null, balance: null })
  })

  test('a status that is not JSON or not an object is null; absent fields are null', () => {
    expect(parseStatus('enabled: yes')).toBeNull()
    expect(parseStatus('[]')).toBeNull()
    expect(parseStatus('{}')).toEqual(NONE)
  })

  test('the derived path is the engine\'s: vault_path, .mb/machines/<host>/jev/log.jsonl', () => {
    expect(vaultOf('{"schema_version":2,"vault_path":"/Users/k/memory-vault"}')).toBe('/Users/k/memory-vault')
    expect(vaultOf('{"vault":"x"}')).toBeNull()
    expect(vaultOf('broken')).toBeNull()
    expect(journalPathOf('/v/', 'My Mac.local')).toBe('/v/.mb/machines/My_Mac.local/jev/log.jsonl')
    expect(machineId('')).toBe('unknown')
  })

  test('the rotated generation sits beside the journal', () => {
    expect(previousOf('/v/jev/log.jsonl')).toBe('/v/jev/log.1.jsonl')
  })
})

describe('the figures', () => {
  const own = summarize(parseJournal(`${line({ cost: 0.5 })}\n`), 'sess-1')

  test("the engine's total, session and balance win when the status gives them", () => {
    expect(figuresOf(own, { ...NONE, totalCost: 9, sessionCost: 2, balance: 1 })).toEqual({ totalCost: 9, sessionCost: 2, balance: 1 })
  })

  test('without them our own sums stand, the balance from the budget', () => {
    expect(figuresOf(own, null)).toEqual({ totalCost: 0.5, sessionCost: 0.5, balance: null })
    expect(figuresOf(own, { ...NONE, budget: 2 })).toEqual({ totalCost: 0.5, sessionCost: 0.5, balance: 1.5 })
  })
})
