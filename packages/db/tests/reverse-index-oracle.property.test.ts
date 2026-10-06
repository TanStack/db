import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { PropRef } from '../src/query/ir.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'

/**
 * # Does a reversed index read in its query's order, in bounded work?
 *
 * A query whose direction is opposite to an index's reads that index through
 * `ReverseIndex`. The index and the query share their null placement, so
 * reversing the index alone would move nullish values to the wrong end. The
 * reader puts them back (`findIndexForField`).
 *
 * Two laws hold for every read:
 *
 * - **Order:** `takeFromStart(n)` returns the first `n` accepted keys in the
 *   query's order, and `take(n, from)` returns the first `n` accepted keys
 *   whose value comes strictly after `from` in that order. The null and
 *   `undefined` values form one group at the query's null end. A cursor at
 *   `null` is past that group. Inside a group of equal values, the reader
 *   returns nullish keys in ascending key order and non-null keys in
 *   descending key order (the reversed index walk). Callers that need a
 *   different tie order resolve ties with their own boundary request.
 * - **Work:** a read calls the filter only on keys up to its `n`-th accepted
 *   key in that order. A read that resolves its result before the nullish
 *   group never calls the filter on a nullish key.
 *
 * The model is a plain array of `[key, value]` pairs, sorted here by the order
 * above. It shares no code with the index. The grammar crosses the index's
 * direction and null placement, values `null`, `undefined` and 0..4, read
 * sizes 0..6, cursors at every value and at `null`, and a filter that rejects
 * a generated key subset. A fixed witness checks the work law at 5,000
 * nullish keys.
 */

type Value = number | null | undefined
type Entry = [key: number, value: Value]
type Options = { direction: `asc` | `desc`; nulls: `first` | `last` }

function makeReader(entries: ReadonlyArray<Entry>, options: Options) {
  const index = new BTreeIndex<number>(1, new PropRef([`value`]), undefined, {
    compareOptions: { ...options, stringSort: `locale` },
  })
  for (const [key, value] of entries) index.add(key, { value })
  // The query runs opposite to the index and shares its null placement.
  return new ReverseIndex(index, options.nulls === `first`)
}

/** The query's order: reversed direction, same null end. */
function modelOrder(
  entries: ReadonlyArray<Entry>,
  options: Options,
): Array<Entry> {
  const queryDirection = options.direction === `asc` ? -1 : 1
  const nullish = entries
    .filter(([, value]) => value == null)
    .sort(([left], [right]) => left - right)
  const values = entries
    .filter(([, value]) => value != null)
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        queryDirection * ((left as number) - (right as number)) ||
        rightKey - leftKey,
    )
  return options.nulls === `first`
    ? [...nullish, ...values]
    : [...values, ...nullish]
}

function after(order: Array<Entry>, from: Value, options: Options) {
  const queryDirection = options.direction === `asc` ? -1 : 1
  if (from == null) {
    return options.nulls === `first`
      ? order.filter(([, value]) => value != null)
      : []
  }
  return order.filter(([, value]) =>
    value == null
      ? options.nulls === `last`
      : queryDirection * (value - from) > 0,
  )
}

/** Expected keys and the most filter calls the work law allows. */
function expectedRead(stream: Array<Entry>, n: number, rejected: Set<number>) {
  const keys: Array<number> = []
  let calls = 0
  for (const [key] of stream) {
    if (keys.length >= n) break
    calls++
    if (!rejected.has(key)) keys.push(key)
  }
  return { keys, calls }
}

type ReadCase = {
  options: Options
  entries: Array<Entry>
  n: number
  cursor: { from: Value } | undefined
  rejected: Array<number>
}

function checkRead({ options, entries, n, cursor, rejected }: ReadCase) {
  const reader = makeReader(entries, options)
  const rejectedKeys = new Set(rejected)
  let calls = 0
  const filter = (key: number) => {
    calls++
    return !rejectedKeys.has(key)
  }
  const order = modelOrder(entries, options)
  const stream = cursor ? after(order, cursor.from, options) : order
  const expected = expectedRead(stream, n, rejectedKeys)
  const actual = cursor
    ? reader.take(n, cursor.from, filter)
    : reader.takeFromStart(n, filter)
  expect(actual, `keys`).toEqual(expected.keys)
  expect(calls, `filter calls`).toBeLessThanOrEqual(expected.calls)
}

const value: fc.Arbitrary<Value> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 4 }) },
)

const readCase: fc.Arbitrary<ReadCase> = fc.record({
  options: fc.record({
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    nulls: fc.constantFrom(`first` as const, `last` as const),
  }),
  entries: fc
    .uniqueArray(fc.integer({ min: 0, max: 15 }), { maxLength: 12 })
    .chain((keys) =>
      fc.tuple(...keys.map((key) => fc.tuple(fc.constant(key), value))),
    )
    .map((pairs) => pairs as Array<Entry>),
  n: fc.integer({ min: 0, max: 6 }),
  cursor: fc.option(fc.record({ from: value }), { nil: undefined }),
  rejected: fc.uniqueArray(fc.integer({ min: 0, max: 15 }), { maxLength: 6 }),
})

describe(`reversed index reads`, () => {
  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 200 * multiplier

  it.each([`first`, `last`] as const)(
    `reads 50 keys among 5,000 nullish keys with nulls %s in bounded filter calls`,
    (nulls) => {
      const entries: Array<Entry> = Array.from({ length: 10_000 }, (_, key) => [
        key,
        key % 2 === 0 ? null : key,
      ])
      for (const cursor of [undefined, { from: 5001 }]) {
        checkRead({
          options: { direction: `asc`, nulls },
          entries,
          n: 50,
          cursor,
          rejected: [],
        })
      }
    },
  )

  fcTest.prop([readCase], { numRuns: runs, seed: 2045 })(
    `matches the query order in bounded work for a fixed seed`,
    checkRead,
  )

  fcTest.prop(
    [readCase],
    oracleRandomParameters(runs, replay, `reverse-index.reads`),
  )(
    `matches the query order in bounded work for a random or replayed seed`,
    checkRead,
  )
})
