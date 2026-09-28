import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import {
  D2,
  MultiSet,
  groupBy,
  groupByOperators,
  output,
  serializeValue,
} from '../src/index.js'

/**
 * Temporal values are valid db-ivm group keys. The established hash key domain
 * distinguishes Temporal kind and string representation. Distinct keys form
 * distinct groups; fresh keys with the same kind and representation coalesce.
 * The public groupBy key is a record, so each Temporal value is nested in it.
 *
 * The model below counts independently by Temporal kind and value. The bounded
 * grammar crosses all Temporal kinds recognized by structural hashing with a
 * different value and a matching fresh value. One initial batch reaches the
 * public groupBy operator; its output is checked after graph.run(). This owner
 * does not decide whether alias-equivalent ZonedDateTimes that satisfy native
 * .equals() should coalesce. Symbols, cycles, and mutable RegExp state are out
 * of scope.
 */
const temporalCases = [
  {
    name: 'Duration',
    first: () => Temporal.Duration.from('P1D'),
    second: () => Temporal.Duration.from('P2D'),
  },
  {
    name: 'Instant',
    first: () => Temporal.Instant.from('2024-01-15T00:00:00Z'),
    second: () => Temporal.Instant.from('2024-06-15T00:00:00Z'),
  },
  {
    name: 'PlainDate',
    first: () => Temporal.PlainDate.from('2024-01-15'),
    second: () => Temporal.PlainDate.from('2024-06-15'),
  },
  {
    name: 'PlainDateTime',
    first: () => Temporal.PlainDateTime.from('2024-01-15T10:30:00'),
    second: () => Temporal.PlainDateTime.from('2024-06-15T10:30:00'),
  },
  {
    name: 'PlainMonthDay',
    first: () => Temporal.PlainMonthDay.from('--01-15'),
    second: () => Temporal.PlainMonthDay.from('--06-15'),
  },
  {
    name: 'PlainTime',
    first: () => Temporal.PlainTime.from('10:30:00'),
    second: () => Temporal.PlainTime.from('14:30:00'),
  },
  {
    name: 'PlainYearMonth',
    first: () => Temporal.PlainYearMonth.from('2024-01'),
    second: () => Temporal.PlainYearMonth.from('2024-06'),
  },
  {
    name: 'ZonedDateTime',
    first: () => Temporal.ZonedDateTime.from('2024-01-15T00:00:00+00:00[UTC]'),
    second: () => Temporal.ZonedDateTime.from('2024-06-15T00:00:00+00:00[UTC]'),
  },
] as const

function valueIdentity(value: object): string {
  return `${Object.prototype.toString.call(value)}:${value.toString()}`
}

function expectedGroups(rows: ReadonlyArray<{ date: object }>) {
  const counts = new Map<string, number>()
  for (const { date } of rows) {
    const identity = valueIdentity(date)
    counts.set(identity, (counts.get(identity) ?? 0) + 1)
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right))
}

function observedGroups(rows: Array<{ date: object }>) {
  const graph = new D2()
  const input = graph.newInput<{ date: object }>()
  const observed: Array<{
    key: string
    identity: string
    count: number
    weight: number
  }> = []
  input.pipe(
    groupBy(({ date }) => ({ date }), {
      count: groupByOperators.count(),
    }),
    output((message) => {
      for (const [[key, group], weight] of message.getInner()) {
        observed.push({
          key,
          identity: valueIdentity(group.date),
          count: group.count,
          weight,
        })
      }
    }),
  )
  graph.finalize()
  input.sendData(new MultiSet(rows.map((row) => [row, 1])))
  graph.run()
  expect(observed.every(({ weight }) => weight === 1)).toBe(true)
  expect(new Set(observed.map(({ key }) => key)).size).toBe(observed.length)
  return observed
    .map(({ identity, count }) => [identity, count] as const)
    .sort(([left], [right]) => left.localeCompare(right))
}

describe('Temporal group keys', () => {
  it.each(temporalCases)(
    '$name keeps distinct values in distinct groups',
    ({ first, second }) => {
      const rows = [{ date: first() }, { date: second() }]
      expect(observedGroups(rows)).toEqual(expectedGroups(rows))
      expect(serializeValue(rows[0]!.date)).not.toBe(
        serializeValue(rows[1]!.date),
      )
    },
  )

  it.each(temporalCases)(
    '$name groups matching fresh values together',
    ({ first }) => {
      const rows = [{ date: first() }, { date: first() }]
      expect(serializeValue(rows[0]!.date)).toBe(serializeValue(rows[1]!.date))
      expect(observedGroups(rows)).toEqual(expectedGroups(rows))
    },
  )

  it('keeps a Temporal value distinct from an empty object', () => {
    const date = Temporal.PlainDate.from('2024-01-15')
    const anotherDate = Temporal.PlainDate.from('2024-06-15')
    expect(serializeValue(date)).not.toBe(serializeValue({}))
    expect(serializeValue(date)).not.toBe(serializeValue(date.toString()))
    expect(serializeValue({ date })).not.toBe(serializeValue({ date: {} }))
    expect(serializeValue({ dates: [date] })).not.toBe(
      serializeValue({ dates: [anotherDate] }),
    )
    expect(serializeValue(new Map([['date', date]]))).not.toBe(
      serializeValue(new Map([['date', anotherDate]])),
    )
    expect(serializeValue(new Set([date]))).not.toBe(
      serializeValue(new Set([anotherDate])),
    )
  })
})
