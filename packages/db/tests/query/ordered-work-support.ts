// Shared request and window checkers for the ordered source work tests. The
// oracle file ordered-work-oracle.property.test.ts owns the laws these helpers
// are used to state; ordinary tests here import them and do not state a law.
import { expect } from 'vitest'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import type { LoadSubsetOptions } from '../../src/types.js'

export type Row = {
  id: number
  rank: number
  eligible: boolean
  label: string
  // The marker key a joined plan matches; the row's id unless eligibility is
  // held on the join key (EagerCase.via).
  link?: number
}

export type Marker = { id: number; rowId: number }

export type Scenario = {
  middleCount: number
  middleEligible: boolean
  lastEligible: boolean
  tied: boolean
  direction: `asc` | `desc`
}

export function compareRows(direction: Scenario[`direction`]) {
  return (left: Row, right: Row): number => {
    const rank = left.rank - right.rank
    return (direction === `asc` ? rank : -rank) || left.id - right.id
  }
}

export function rowsForScenario(scenario: Scenario): Array<Row> {
  return [
    { id: 1, rank: 0, eligible: true, label: `first` },
    ...Array.from({ length: scenario.middleCount }, (_, index) => ({
      id: index + 3,
      rank: scenario.tied ? 0 : index + 1,
      eligible: scenario.middleEligible,
      label: `middle-${index}`,
    })),
    {
      id: 2,
      rank: scenario.middleCount + 1,
      eligible: scenario.lastEligible,
      label: `last`,
    },
  ]
}

// A finite request recorder, not another production identity implementation.
// Preserve fields and primitive kinds; reject opaque values rather than merging
// them into an empty object. Signals/subscriptions are ownership, while
// refetch controls the attempt; none of the three changes demand identity.
export function requestFingerprint(options: LoadSubsetOptions): string {
  const semantic = new Set([`where`, `orderBy`, `limit`, `offset`, `cursor`])
  for (const key of Reflect.ownKeys(options)) {
    if (
      !semantic.has(String(key)) &&
      key !== `signal` &&
      key !== `subscription` &&
      key !== `refetch`
    )
      throw new Error(`Unsupported request field ${String(key)}`)
  }
  const encode = (value: unknown): unknown => {
    if (value === undefined) return [`undefined`]
    if (value === null) return [`null`]
    if (typeof value === `number`) {
      if (!Number.isFinite(value)) throw new Error(`Nonfinite request value`)
      return [`number`, Object.is(value, -0) ? `-0` : value]
    }
    if (typeof value === `boolean` || typeof value === `string`)
      return [typeof value, value]
    if (Array.isArray(value)) return [`array`, value.map(encode)]
    if (typeof value !== `object`) throw new Error(`Opaque request value`)
    const prototype = Object.getPrototypeOf(value)
    if (
      prototype !== Object.prototype &&
      prototype !== null &&
      !(value instanceof Func) &&
      !(value instanceof PropRef) &&
      !(value instanceof Value)
    )
      throw new Error(`Opaque request object`)
    if (Reflect.ownKeys(value).some((key) => typeof key !== `string`))
      throw new Error(`Symbol request field`)
    // Absent optional compare fields and explicit undefined mean the same option.
    return [
      `object`,
      Object.entries(value)
        .filter(([, field]) => field !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, field]) => [key, encode(field)]),
    ]
  }
  return JSON.stringify(
    encode(
      Object.fromEntries(
        [...semantic].map((key) => [
          key,
          options[key as keyof LoadSubsetOptions],
        ]),
      ),
    ),
  )
}

export function expectRawWindow(
  actual: ReadonlyArray<Row>,
  expected: ReadonlyArray<Row>,
  direction: Scenario[`direction`],
  idTieBreak: boolean,
) {
  expect([...actual].sort(compareRows(direction))).toStrictEqual(
    [...expected].sort(compareRows(direction)),
  )
  for (let index = 1; index < actual.length; index++) {
    const left = actual[index - 1]!
    const right = actual[index]!
    const rank =
      direction === `asc` ? left.rank - right.rank : right.rank - left.rank
    expect(rank || (idTieBreak ? left.id - right.id : 0)).toBeLessThanOrEqual(0)
  }
}

export function expectInitialWindows(
  publications: ReadonlyArray<ReadonlyArray<Row>>,
  expected: ReadonlyArray<Row>,
  direction: Scenario[`direction`],
  idTieBreak: boolean,
) {
  let published = expected.length === 0
  for (const rows of publications) {
    if (!published && rows.length === 0) continue
    expectRawWindow(rows, expected, direction, idTieBreak)
    published = true
  }
  expect(published, `complete initial public window reached`).toBe(true)
}

export function expectNoProviderStart(before: number, after: number) {
  expect(after, `no provider start during disposal`).toBe(before)
}

export function expectDistinctRequests(
  requests: ReadonlyArray<{ fingerprint: string }>,
) {
  expect(new Set(requests.map(({ fingerprint }) => fingerprint)).size).toBe(
    requests.length,
  )
}
