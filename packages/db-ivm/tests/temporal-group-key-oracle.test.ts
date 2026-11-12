import { Temporal } from 'temporal-polyfill'
import { describe, expect } from 'vitest'
import {
  D2,
  MultiSet,
  groupBy,
  groupByOperators,
  output,
  serializeValue,
} from '../src/index.js'
import { oracleProperty } from '../../db/tests/oracle-property.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter.js'

/**
 * Temporal values are valid db-ivm group keys. The established hash key domain
 * distinguishes Temporal kind and string representation. Distinct keys form
 * distinct groups; fresh keys with the same kind and representation coalesce.
 * The public groupBy key is a record, so each Temporal value is nested in it.
 *
 * The model below counts fixture-defined identity classes. The bounded
 * grammar crosses all Temporal kinds recognized by structural hashing with a
 * different value and a matching fresh value. One initial batch reaches the
 * public groupBy operator; its output is checked after graph.run(). This owner
 * keeps alternate string representations in separate groups. Values with
 * altered Temporal prototypes or methods and separately loaded polyfill copies
 * are outside this contract. Symbols, cycles, and mutable RegExp state are also
 * out of scope.
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

// The model: each identity class is one group, so its size is the number of
// values that the fixture labels with that class.
function expectedGroupCounts(classes: ReadonlyArray<string>): Array<number> {
  const counts = new Map<string, number>()
  for (const group of classes) {
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return [...counts.values()].sort((left, right) => left - right)
}
// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.

function observedGroupCounts(rows: Array<{ date: object }>): Array<number> {
  const graph = new D2()
  const input = graph.newInput<{ date: object }>()
  const observed: Array<{
    key: string
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
  return observed.map(({ count }) => count).sort((left, right) => left - right)
}

// Each enumerated history names one fixture. The two temporal laws run once
// per Temporal kind; the four remaining fixtures are the bounded tag and
// representation boundaries described above. Each body below is the former
// test body, unchanged, and is judged by the same model and assertions.
type TemporalKind = (typeof temporalCases)[number]['name']
type TemporalGroupKeyHistory =
  | { law: 'distinct values' | 'fresh values'; kind: TemporalKind }
  | {
      law:
        | 'equal-comparing Duration representations'
        | 'tagged plain object'
        | 'own-tagged empty plain object'
        | 'own matching tag'
    }

const temporalGroupKeyHistories: Array<TemporalGroupKeyHistory> = [
  ...temporalCases.map(({ name }) => ({
    law: 'distinct values' as const,
    kind: name,
  })),
  ...temporalCases.map(({ name }) => ({
    law: 'fresh values' as const,
    kind: name,
  })),
  { law: 'equal-comparing Duration representations' },
  { law: 'tagged plain object' },
  { law: 'own-tagged empty plain object' },
  { law: 'own matching tag' },
]

function temporalGroupKeyLabel(history: TemporalGroupKeyHistory): string {
  switch (history.law) {
    case 'distinct values':
      return `${history.kind} keeps distinct values in distinct groups`
    case 'fresh values':
      return `${history.kind} groups matching fresh values together`
    case 'equal-comparing Duration representations':
      return 'keeps equal-comparing Duration representations in separate groups'
    case 'tagged plain object':
      return 'keeps a plain object with a Temporal tag distinct from a Temporal value'
    case 'own-tagged empty plain object':
      return 'keeps an own-tagged plain object with no enumerable fields distinct'
    case 'own matching tag':
      return 'still groups a Temporal value with an own matching tag'
  }
}

function temporalCase(kind: TemporalKind) {
  return temporalCases.find(({ name }) => name === kind)!
}

function runDistinctValuesCase({
  first,
  second,
}: (typeof temporalCases)[number]): void {
  const rows = [{ date: first() }, { date: second() }]
  expect(observedGroupCounts(rows)).toEqual(
    expectedGroupCounts(['first', 'second']),
  )
  expect(serializeValue(rows[0]!.date)).not.toBe(serializeValue(rows[1]!.date))
}

function runFreshValuesCase({ first }: (typeof temporalCases)[number]): void {
  const rows = [{ date: first() }, { date: first() }]
  expect(serializeValue(rows[0]!.date)).toBe(serializeValue(rows[1]!.date))
  expect(observedGroupCounts(rows)).toEqual(
    expectedGroupCounts(['first', 'first']),
  )
}

function runDurationRepresentationsCase(): void {
  const hour = Temporal.Duration.from('PT1H')
  const minutes = Temporal.Duration.from('PT60M')
  expect(Temporal.Duration.compare(hour, minutes)).toBe(0)
  expect(observedGroupCounts([{ date: hour }, { date: minutes }])).toEqual(
    expectedGroupCounts(['hour', 'minutes']),
  )
}

function runTaggedPlainObjectCase(): void {
  const date = Temporal.PlainDate.from('2024-01-15')
  const taggedObject = {
    [Symbol.toStringTag]: 'Temporal.PlainDate',
    extra: 1,
  }
  Object.defineProperty(taggedObject, 'toString', {
    value: () => '2024-01-15',
  })
  expect(observedGroupCounts([{ date }, { date: taggedObject }])).toEqual(
    expectedGroupCounts(['Temporal', 'plain object']),
  )
  expect(serializeValue({ date })).not.toBe(
    serializeValue({ date: taggedObject }),
  )
}

function runOwnTaggedEmptyPlainObjectCase(): void {
  const date = Temporal.PlainDate.from('2024-01-15')
  const taggedObject = {}
  Object.defineProperty(taggedObject, Symbol.toStringTag, {
    value: 'Temporal.PlainDate',
  })
  Object.defineProperty(taggedObject, 'toString', {
    value: () => '2024-01-15',
  })

  expect(Object.keys(taggedObject)).toEqual([])
  expect(observedGroupCounts([{ date }, { date: taggedObject }])).toEqual(
    expectedGroupCounts(['Temporal', 'plain object']),
  )
}

function runOwnMatchingTagCase(): void {
  const date = Temporal.PlainDate.from('2024-01-15')
  const matchingDate = Temporal.PlainDate.from('2024-01-15')
  Object.defineProperty(matchingDate, Symbol.toStringTag, {
    value: 'Temporal.PlainDate',
  })

  expect(observedGroupCounts([{ date }, { date: matchingDate }])).toEqual(
    expectedGroupCounts(['same date', 'same date']),
  )
  expect(serializeValue({ date })).toBe(serializeValue({ date: matchingDate }))
}

function runTemporalGroupKeyCase(history: TemporalGroupKeyHistory): void {
  switch (history.law) {
    case 'distinct values':
      return runDistinctValuesCase(temporalCase(history.kind))
    case 'fresh values':
      return runFreshValuesCase(temporalCase(history.kind))
    case 'equal-comparing Duration representations':
      return runDurationRepresentationsCase()
    case 'tagged plain object':
      return runTaggedPlainObjectCase()
    case 'own-tagged empty plain object':
      return runOwnTaggedEmptyPlainObjectCase()
    case 'own matching tag':
      return runOwnMatchingTagCase()
  }
}

const TEMPORAL_GROUP_KEY_LAW =
  'Temporal group keys with distinct kind or representation form distinct groups; matching fresh values coalesce.'

describe('Temporal group keys', () => {
  oracleProperty({
    id: `ivm.temporal-group-key`,
    law: {
      statement: TEMPORAL_GROUP_KEY_LAW,
      authority: `The established hash key domain documented above: Temporal kind and string representation; expectedGroupCounts.`,
      limits: `One initial batch of two values per fixture; altered Temporal prototypes, separate polyfill copies, symbols, cycles, and mutable RegExp state are outside this contract.`,
    },
    owns: [`src/operators/groupBy.ts#groupBy`],
    histories: temporalGroupKeyHistories,
    label: temporalGroupKeyLabel,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(TEMPORAL_GROUP_KEY_LAW, plan, observe, () =>
        runTemporalGroupKeyCase(plan.history),
      ),
    check: forwardAssertionJudgment,
  })
})
