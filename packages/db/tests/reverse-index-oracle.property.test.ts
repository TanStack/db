import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { BasicIndex } from '../src/indexes/basic-index.js'
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
 *   group never calls the filter on a nullish key. A bounded read of `n` keys
 *   from an index of `N` keys does O(n + log N) work, not work proportional to
 *   the size `m` of a group of equal values: it copies no group and sorts no
 *   group, including the nullish group and including after a write to it.
 *   An index may order a group once, on its first ordered read.
 *
 * The model is a plain array of `[key, value]` pairs, sorted here by the order
 * above. It shares no code with the index. The grammar crosses the index type
 * (BTree or basic), its direction and null placement, values `null`, `undefined` and 0..4, read
 * sizes 0..6, cursors at every value and at `null`, and a filter that rejects
 * a generated key subset. A fixed witness checks the work law at 5,000
 * nullish keys. It counts work through two seams that need no production
 * hook: the keys the index's public `lookup` returns, and the comparator calls
 * of any `Array.prototype.sort` during the read. The witness uses the BTree
 * index. The basic index sorts a group on each read, so the group-work law
 * does not cover it.
 */

type Value = number | null | undefined
type Entry = [key: number, value: Value]
type Options = {
  direction: `asc` | `desc`
  nulls: `first` | `last`
  indexType?: `btree` | `basic`
}

function makeIndex(entries: ReadonlyArray<Entry>, options: Options) {
  const { indexType, ...compareOptions } = options
  const Index = indexType === `basic` ? BasicIndex : BTreeIndex
  const index = new Index<number>(1, new PropRef([`value`]), undefined, {
    compareOptions: { ...compareOptions, stringSort: `locale` },
  })
  for (const [key, value] of entries) index.add(key, { value })
  return index
}

/** Group copies and sort comparisons during `read`. */
function measureGroupWork<T>(index: BTreeIndex<number>, read: () => T) {
  let work = 0
  const lookup = index.lookup.bind(index)
  index.lookup = (operation, value) => {
    const keys = lookup(operation, value)
    work += keys.size
    return keys
  }
  const sort = Array.prototype.sort
  Array.prototype.sort = function (this: Array<unknown>, compare) {
    return sort.call(this, (left: unknown, right: unknown) => {
      work++
      return compare
        ? compare(left, right)
        : String(left) < String(right)
          ? -1
          : 1
    })
  } as typeof sort
  try {
    return { result: read(), work }
  } finally {
    Array.prototype.sort = sort
    index.lookup = lookup
  }
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
      : queryDirection * ((value as number) - from) > 0,
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
  /** Index writes between a first and a second read. */
  writes: Array<{ key: number; value: Value | `delete` }>
}

function checkRead({
  options,
  entries,
  n,
  cursor,
  rejected,
  writes,
}: ReadCase) {
  const index = makeIndex(entries, options)
  // The query runs opposite to the index and shares its null placement.
  const reader = new ReverseIndex(index, options.nulls === `first`)
  const rejectedKeys = new Set(rejected)
  const current = new Map(entries)
  const read = (label: string) => {
    let calls = 0
    const filter = (key: number) => {
      calls++
      return !rejectedKeys.has(key)
    }
    const order = modelOrder([...current], options)
    const stream = cursor ? after(order, cursor.from, options) : order
    const expected = expectedRead(stream, n, rejectedKeys)
    const actual = cursor
      ? reader.take(n, cursor.from, filter)
      : reader.takeFromStart(n, filter)
    expect(actual, `keys ${label}`).toEqual(expected.keys)
    expect(calls, `filter calls ${label}`).toBeLessThanOrEqual(expected.calls)
  }
  read(`before writes`)
  // Writes after an ordered read must keep each group in key order.
  for (const { key, value } of writes) {
    if (current.has(key)) index.remove(key, { value: current.get(key) })
    if (value === `delete`) current.delete(key)
    else {
      index.add(key, { value })
      current.set(key, value)
    }
  }
  read(`after writes`)
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
    indexType: fc.constantFrom(`btree` as const, `basic` as const),
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
  writes: fc.array(
    fc.record({
      key: fc.integer({ min: 0, max: 15 }),
      value: fc.oneof(
        { weight: 1, arbitrary: fc.constant(`delete` as const) },
        { weight: 3, arbitrary: value },
      ),
    }),
    { maxLength: 6 },
  ),
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
          writes: [],
        })
      }
    },
  )

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`first`, `last`] as const).map((nulls) => ({ direction, nulls })),
    ),
  )(
    `reads 50 keys among 5,000 nullish keys without group work ($direction index, nulls $nulls)`,
    (options) => {
      const entries: Array<Entry> = Array.from({ length: 10_000 }, (_, key) => [
        key,
        key % 4 === 0 ? null : key % 4 === 2 ? undefined : key,
      ])
      const index = makeIndex(entries, options) as BTreeIndex<number>
      const reader = new ReverseIndex(index, options.nulls === `first`)
      // The last cursor is one value before the reader's final value, so a
      // nulls-last read crosses into the nullish group.
      const nearEnd = options.direction === `asc` ? 3 : 9997
      const cursors: Array<Value | `start`> = [`start`, null, 5001, nearEnd]
      const reads = cursors.map(
        (cursor) => () =>
          cursor === `start`
            ? reader.takeFromStart(50)
            : reader.take(50, cursor),
      )
      const bound = 4 * (50 + Math.ceil(Math.log2(entries.length + 2)))
      for (const [position, read] of reads.entries()) {
        read()
        // A write to the nullish group must not make the next read sort it.
        const key = 20_000 + position
        index.add(key, { value: null })
        entries.push([key, null])
        const { result, work } = measureGroupWork(index, read)
        const order = modelOrder(entries, options)
        const cursor = cursors[position]!
        const stream =
          cursor === `start` ? order : after(order, cursor, options)
        expect(result, `keys of read ${position}`).toEqual(
          stream.slice(0, 50).map(([entryKey]) => entryKey),
        )
        expect(work, `group work of read ${position}`).toBeLessThanOrEqual(
          bound,
        )
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
