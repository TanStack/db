import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { PropRef } from '../src/query/ir.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import type { IndexOperation } from '../src/indexes/base-index.js'

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
 * - **Work:** a read calls the filter on non-null keys only up to its `n`-th
 *   accepted key in that order. It may call the filter once on each nullish
 *   key, because the reader gathers the whole nullish group on each read.
 *   Large nullish groups are rare in ordered windows, so the reader keeps
 *   that cost for simpler code; it is not bounded by `n`.
 *
 * The model is a plain array of `[key, value]` pairs, sorted here by the order
 * above. It shares no code with the index. The grammar crosses the index's
 * direction and null placement, values `null`, `undefined` and 0..4, read
 * sizes 0..6, cursors at every value and at `null`, and a filter that rejects
 * a generated key subset. A fixed witness checks the work law at 5,000
 * nullish keys.
 *
 * Two further laws bound what the reader may assume:
 *
 * - **Legacy reversal:** `new ReverseIndex(index)` without a null placement
 *   is the reader `@tanstack/db` exported before query-aware placement. It
 *   reads the original index's reversed walk unchanged, so its nullish group
 *   sits wherever plain reversal puts it, for BTree and Basic indexes and for
 *   either null placement of the original. The pinned keys below are the
 *   results of the earlier release.
 * - **Capability:** ordered-query admission requires only range operations
 *   (`supports('gt')`). The reader may use the `equalityLookup` every index
 *   implements, but not an `eq` lookup the index does not advertise. A public
 *   witness orders a collection through an index that advertises only range
 *   operations.
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

/** Expected keys and the most non-null filter calls the work law allows. */
function expectedRead(stream: Array<Entry>, n: number, rejected: Set<number>) {
  const keys: Array<number> = []
  let calls = 0
  for (const [key, value] of stream) {
    if (keys.length >= n) break
    if (value != null) calls++
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
  const nullishKeys = new Set(
    entries.filter(([, value]) => value == null).map(([key]) => key),
  )
  let calls = 0
  const nullishCalls = new Map<number, number>()
  const filter = (key: number) => {
    if (nullishKeys.has(key)) {
      nullishCalls.set(key, (nullishCalls.get(key) ?? 0) + 1)
    } else {
      calls++
    }
    return !rejectedKeys.has(key)
  }
  const order = modelOrder(entries, options)
  const stream = cursor ? after(order, cursor.from, options) : order
  const expected = expectedRead(stream, n, rejectedKeys)
  const actual = cursor
    ? reader.take(n, cursor.from, filter)
    : reader.takeFromStart(n, filter)
  expect(actual, `keys`).toEqual(expected.keys)
  expect(calls, `non-null filter calls`).toBeLessThanOrEqual(expected.calls)
  expect(
    Math.max(0, ...nullishCalls.values()),
    `filter calls on one nullish key`,
  ).toBeLessThanOrEqual(1)
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

/** An order-capable index that advertises no equality lookup operation. */
class RangeOnlyIndex<TKey extends string | number> extends BTreeIndex<TKey> {
  public override readonly supportedOperations = new Set<IndexOperation>([
    `gt`,
    `gte`,
    `lt`,
    `lte`,
  ])

  override lookup(operation: IndexOperation, value: unknown): Set<TKey> {
    if (!this.supportedOperations.has(operation)) {
      throw new Error(`Unsupported operation: ${operation}`)
    }
    return super.lookup(operation, value)
  }
}

describe(`legacy reversed index reads`, () => {
  // An ascending index with nulls last over key 1 -> null, 2 -> 1, 3 -> 2.
  it.each([BTreeIndex, BasicIndex] as const)(
    `keeps plain reversal when no null placement is given (%o)`,
    (IndexType) => {
      const index = new IndexType<number>(
        1,
        new PropRef([`value`]),
        undefined,
        {
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `locale`,
          },
        },
      )
      for (const [key, value] of [
        [1, null],
        [2, 1],
        [3, 2],
      ] as const) {
        index.add(key, { value })
      }
      const reader = new ReverseIndex(index)
      expect(reader.takeFromStart(3)).toEqual([1, 3, 2])
      expect(reader.take(3, null)).toEqual([3, 2])
    },
  )
})

describe(`reversed reads through a range-only index`, () => {
  it.each([`first`, `last`] as const)(
    `reads with nulls %s without an equality lookup`,
    (nulls) => {
      const index = new RangeOnlyIndex<number>(
        1,
        new PropRef([`value`]),
        undefined,
        { compareOptions: { direction: `asc`, nulls, stringSort: `locale` } },
      )
      for (const [key, value] of [
        [1, null],
        [2, 1],
        [3, 2],
      ] as const) {
        index.add(key, { value })
      }
      const reader = new ReverseIndex(index, nulls === `first`)
      expect(reader.takeFromStart(3)).toEqual(
        nulls === `first` ? [1, 3, 2] : [3, 2, 1],
      )
    },
  )

  it(`orders a descending snapshot and a limited live query`, async () => {
    type Item = { id: number; rank: number }
    const source = createCollection<Item, number>({
      id: `range-only-${Math.random()}`,
      getKey: (item) => item.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, rank: 1 } })
          write({ type: `insert`, value: { id: 2, rank: 2 } })
          commit()
          markReady()
        },
      },
    })
    source.createIndex((item) => item.rank, { indexType: RangeOnlyIndex })
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ item: source })
          .orderBy(({ item }) => item.rank, `desc`)
          .limit(1),
    })
    try {
      const snapshot = source.currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: {
              direction: `desc`,
              nulls: `first`,
              stringSort: `locale`,
            },
          },
        ],
        limit: 1,
      })
      expect(snapshot?.map((change) => change.key)).toEqual([2])
      await query.preload()
      expect(query.toArray.map((item) => item.id)).toEqual([2])
    } finally {
      await query.cleanup()
      await source.cleanup()
    }
  })
})

describe(`reversed index reads`, () => {
  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 200 * multiplier

  it.each([`first`, `last`] as const)(
    `reads 50 keys among 5,000 nullish keys with nulls %s in bounded non-null work`,
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
