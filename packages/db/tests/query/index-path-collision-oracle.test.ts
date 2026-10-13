/**
 * # Distinct field paths in indexed compound predicates
 *
 * Contract: A source row matches an AND predicate according to each complete
 * property path. A scalar property named `a.b` and a nested `a.b` property are
 * distinct fields. Adding an index may change work, but not public rows.
 * Authority: `docs/guides/live-queries.md` documents AND filters, selected
 * fields, and computed `orderBy` values. The live-query architecture treats an
 * index as a physical query detail rather than a different result contract.
 *
 * Model: Plain JavaScript reads each field independently and intersects the
 * two comparisons. It does not use query expressions or index classifications.
 *
 * History grammar: A ready source Collection contains the bounded cross product
 * of three values for each field. Scan before adding a nested-field BTree index,
 * then query the same Collection after indexing. Also compile public Collection
 * subscription and live-query callbacks with and without that index. Vary
 * argument order, bound inclusivity, reversed operands, and bound field.
 * A selected-field ordering reads both paths through the public `$selected`
 * callback proxy.
 * A separate range history stores genuine Dates, a native Date subclass, and
 * an ordinary object with a borrowed Date subclass prototype. Its public
 * `gt` result must be the same before and after installing either index type.
 * Another range history uses the borrowed object as the predicate bound.
 * Both mixed domains require scan fallback after installation.
 * A foreign Date subclass is the adjacent valid-domain control: its native
 * timestamp keeps the range eligible for index lookup across realms.
 * A further valid-Date history overrides `valueOf` in local and foreign
 * subclasses while retaining native `getTime`. An ordinary Date bound and a
 * subclass bound each reach all four effective relations; the subclass bound
 * occupies both operand positions. The intrinsic-timestamp model compares
 * public scan and indexed snapshots, and both index types must remain eligible
 * for optimized-only reads. The reference captures each source timestamp
 * before the rows enter the Collection, so later source-Date changes cannot
 * change the expected answer. Date/number scan comparisons in both operand
 * orders use the same model; mixed-domain range indexes make no eligibility
 * claim here.
 *
 * Production driver: `currentStateAsChanges`, Collection subscriptions, and
 * live-query Collections run the real predicates and callback compilers.
 * Refinement check: At each checkpoint, exact public keys equal the model keys;
 * selected-field order equals a direct JavaScript sort over both field values.
 * The cross product contains rows that a merged range omits or adds; unchanged
 * scan results make index addition an explicit metamorphic control. The
 * nested index's lookup spy proves the indexed path ran after installation.
 * A wrong rule that joins path segments with `.` treats [`a.b`] and [`a`, `b`]
 * as the same field. In the first predicate case, it can add `0-10` or omit
 * `25-0`; the exact-key checks reject either result at the scan and indexed
 * checkpoints. The controlled source fixture makes no external-provider claim.
 *
 * Known omissions: This bounded owner does not claim arbitrary path segments,
 * nullish values, custom collation, or incremental publication histories.
 * Lazy demand target deduplication has a separate compiler-boundary witness.
 * The Date-domain histories cover a `valueOf` override but not other coercion
 * methods, invalid Dates, or publication after later writes.
 */
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  add,
  and,
  gt,
  gte,
  lt,
  lte,
} from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { BasicExpression } from '../../src/query/ir.js'

interface Row {
  id: string
  'a.b': number
  a: { b: number }
}

type Release = () => void | Promise<void>

async function checkWithCleanup(
  check: (register: (release: Release) => void) => void | Promise<void>,
) {
  const releases: Array<Release> = []
  let primaryFailure: { error: unknown } | undefined
  try {
    await check((release) => releases.unshift(release))
  } catch (error) {
    primaryFailure = { error }
  }

  const cleanupErrors: Array<unknown> = []
  for (const release of releases) {
    try {
      await release()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, `Path oracle cleanup failed`, {
      cause: primaryFailure?.error,
    })
  }
  if (primaryFailure) throw primaryFailure.error
}

const flat = new PropRef([`a.b`])
const nested = new PropRef([`a`, `b`])
const rows: Array<Row> = [0, 10, 25].flatMap((flatValue) =>
  [0, 10, 25].map((nestedValue) => ({
    id: `${flatValue}-${nestedValue}`,
    'a.b': flatValue,
    a: { b: nestedValue },
  })),
)

async function readyCollection(
  name: string,
  register: (release: Release) => void,
) {
  const collection = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `index-path-collision-${name}`,
      getKey: (row) => row.id,
      initialData: rows,
      autoIndex: `off`,
      defaultIndexType: BTreeIndex,
    }),
  )
  register(() => collection.cleanup())
  await collection.stateWhenReady()
  return collection
}

const expectedKeys = rows
  .filter((row) => row[`a.b`] > 5 && row.a.b < 20)
  .map((row) => row.id)
  .sort()

const cases: Array<{
  name: string
  where: BasicExpression<boolean>
  accepts: (row: Row) => boolean
}> = [
  {
    name: `scalar lower and nested upper`,
    where: and(gt(flat, 5), lt(nested, 20)),
    accepts: (row) => row[`a.b`] > 5 && row.a.b < 20,
  },
  {
    name: `upper bound before lower bound`,
    where: and(lt(nested, 20), gt(flat, 5)),
    accepts: (row) => row.a.b < 20 && row[`a.b`] > 5,
  },
  {
    name: `reversed operand and inclusive upper bound`,
    where: and(lt(5, flat), lte(nested, 10)),
    accepts: (row) => 5 < row[`a.b`] && row.a.b <= 10,
  },
  {
    name: `nested lower and scalar upper`,
    where: and(gt(nested, 5), lt(flat, 20)),
    accepts: (row) => row.a.b > 5 && row[`a.b`] < 20,
  },
]

it.each(cases)(
  `keeps dotted scalar and nested predicates distinct: $name`,
  async ({ name, where, accepts }) => {
    await checkWithCleanup(async (register) => {
      const collection = await readyCollection(name, register)
      const expected = rows
        .filter(accepts)
        .map((row) => row.id)
        .sort()
      const queryKeys = () =>
        collection
          .currentStateAsChanges({ where })!
          .map((change) => change.key)
          .sort()

      expect(queryKeys(), `scan result`).toEqual(expected)
      const index = collection.createIndex((row) => row.a.b)
      const lookup = vi.spyOn(index, `lookup`)
      expect(queryKeys(), `indexed result`).toEqual(expected)
      expect(lookup, `indexed path reached`).toHaveBeenCalled()
    })
  },
)

it.each([
  { name: `BasicIndex`, indexType: BasicIndex },
  { name: `BTreeIndex`, indexType: BTreeIndex },
])(
  `keeps borrowed Date prototypes outside indexed range results: $name`,
  async ({ name, indexType }) => {
    await checkWithCleanup(async (register) => {
      class NativeDate extends Date {}
      const borrowed = Object.create(NativeDate.prototype) as object
      const bound = new Date(1)
      const dateRows: Array<{ id: string; v: object }> = [
        { id: `before`, v: new Date(0) },
        { id: `borrowed`, v: borrowed },
        { id: `after`, v: new Date(2) },
        { id: `subclass`, v: new NativeDate(3) },
      ]
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `index-borrowed-date-${name}`,
          getKey: (row: (typeof dateRows)[number]) => row.id,
          initialData: dateRows,
          autoIndex: `off`,
        }),
      )
      register(() => collection.cleanup())
      await collection.stateWhenReady()

      // The reference uses JavaScript numeric coercion for this Date bound.
      // Borrowing a Date prototype cannot supply its native timestamp, so the
      // coercion fails and that source row cannot satisfy `v > bound`.
      const expected = dateRows
        .filter(({ v }) => {
          try {
            return Number(v) > bound.getTime()
          } catch {
            return false
          }
        })
        .map(({ id }) => id)
        .sort()
      expect(expected).toEqual([`after`, `subclass`])

      const where = gt(new PropRef([`v`]), bound)
      const snapshotKeys = () =>
        collection
          .currentStateAsChanges({ where })!
          .map((change) => String(change.key))
          .sort()

      // An unindexed public snapshot establishes the first checkpoint. The
      // indexed snapshot must refine the same result; optimizedOnly may decline
      // this mixed-domain index rather than claiming a complete answer.
      expect(snapshotKeys(), `before ${name}`).toEqual(expected)
      const index = collection.createIndex((row) => row.v, { indexType })
      const lookup = vi.spyOn(index, `lookup`)
      expect(snapshotKeys(), `after ${name}`).toEqual(expected)
      expect(lookup, `unsafe range index not used`).not.toHaveBeenCalled()
      expect(
        collection.currentStateAsChanges({ where, optimizedOnly: true }),
      ).toBeUndefined()
    })
  },
)

it.each([
  { name: `BasicIndex`, indexType: BasicIndex },
  { name: `BTreeIndex`, indexType: BTreeIndex },
])(
  `does not treat a borrowed Date prototype as a range bound: $name`,
  async ({ name, indexType }) => {
    await checkWithCleanup(async (register) => {
      class NativeDate extends Date {}
      const borrowed = Object.create(NativeDate.prototype) as Date
      const dateRows = [
        { id: `before`, v: new Date(0) },
        { id: `after`, v: new NativeDate(2) },
      ]
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `index-borrowed-date-bound-${name}`,
          getKey: (row: (typeof dateRows)[number]) => row.id,
          initialData: dateRows,
          autoIndex: `off`,
        }),
      )
      register(() => collection.cleanup())
      await collection.stateWhenReady()

      // Numeric coercion of the borrowed bound throws. No source row can
      // satisfy the relational predicate, regardless of index availability.
      const expected = dateRows
        .filter(({ v }) => {
          try {
            return Number(v) < Number(borrowed)
          } catch {
            return false
          }
        })
        .map(({ id }) => id)
      expect(expected).toEqual([])

      const where = lt(new PropRef([`v`]), borrowed)
      const snapshotKeys = () =>
        collection
          .currentStateAsChanges({ where })!
          .map((change) => String(change.key))
          .sort()
      expect(snapshotKeys(), `before ${name}`).toEqual(expected)
      const index = collection.createIndex((row) => row.v, { indexType })
      const lookup = vi.spyOn(index, `lookup`)
      expect(snapshotKeys(), `after ${name}`).toEqual(expected)
      expect(lookup, `unsafe range index not used`).not.toHaveBeenCalled()
      expect(
        collection.currentStateAsChanges({ where, optimizedOnly: true }),
      ).toBeUndefined()
    })
  },
)

it.each([
  { name: `BasicIndex`, indexType: BasicIndex },
  { name: `BTreeIndex`, indexType: BTreeIndex },
])(
  `keeps foreign Date subclasses in the indexed Date domain: $name`,
  async ({ name, indexType }) => {
    await checkWithCleanup(async (register) => {
      const bound = new Date(1)
      const dateRows = [
        { id: `before`, v: new Date(0) },
        {
          id: `foreign-subclass`,
          v: runInNewContext(`new (class extends Date {})(2)`) as Date,
        },
      ]
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `index-foreign-date-${name}`,
          getKey: (row: (typeof dateRows)[number]) => row.id,
          initialData: dateRows,
          autoIndex: `off`,
        }),
      )
      register(() => collection.cleanup())
      await collection.stateWhenReady()

      // A foreign subclass has a native Date timestamp, so the direct numeric
      // relation predicts the same key on scans and both indexed paths.
      const expected = dateRows
        .filter(({ v }) => Number(v) > bound.getTime())
        .map(({ id }) => id)
      expect(expected).toEqual([`foreign-subclass`])
      const where = gt(new PropRef([`v`]), bound)
      const snapshotKeys = () =>
        collection.currentStateAsChanges({ where })!.map((change) => change.key)
      expect(snapshotKeys(), `before ${name}`).toEqual(expected)
      const index = collection.createIndex((row) => row.v, { indexType })
      const lookup = vi.spyOn(index, `lookup`)
      expect(snapshotKeys(), `after ${name}`).toEqual(expected)
      expect(lookup, `native Date range index reached`).toHaveBeenCalled()
      expect(
        collection
          .currentStateAsChanges({ where, optimizedOnly: true })
          ?.map((change) => change.key),
      ).toEqual(expected)
    })
  },
)

it.each([
  { name: `BasicIndex`, indexType: BasicIndex },
  { name: `BTreeIndex`, indexType: BTreeIndex },
])(
  `compares native Date subclasses by timestamp across scan and indexed ranges: $name`,
  async ({ name, indexType }) => {
    await checkWithCleanup(async (register) => {
      class LaterDate extends Date {
        override valueOf() {
          return -100
        }
      }
      const earlierForeign = runInNewContext(
        `new (class extends Date { valueOf() { return 100 } })(0)`,
      ) as Date
      const dateRows = [
        { id: `plain-before`, v: new Date(-1) },
        { id: `foreign-earlier`, v: earlierForeign },
        { id: `equal`, v: new Date(1) },
        { id: `local-later`, v: new LaterDate(2) },
        { id: `plain-after`, v: new Date(3) },
      ]
      const bound = new Date(1)
      const subclassBound = new LaterDate(1)
      const nativeGetTime = Date.prototype.getTime
      const boundTime = nativeGetTime.call(bound)
      const subclassBoundTime = nativeGetTime.call(subclassBound)
      // Capture the model before Collection admission. Neither the scan nor
      // the indexed checkpoint may rederive its answer from mutable source
      // Date objects handed to production.
      const referenceRows = Object.freeze(
        dateRows.map(({ id, v }) =>
          Object.freeze({ id, time: nativeGetTime.call(v) }),
        ),
      )
      const field = new PropRef([`v`])
      const predicates = [
        {
          name: `gt`,
          where: gt(field, bound),
          accepts: (time: number) => time > boundTime,
        },
        {
          name: `gte`,
          where: gte(field, bound),
          accepts: (time: number) => time >= boundTime,
        },
        {
          name: `lt`,
          where: lt(field, bound),
          accepts: (time: number) => time < boundTime,
        },
        {
          name: `lte`,
          where: lte(field, bound),
          accepts: (time: number) => time <= boundTime,
        },
        {
          name: `gt with subclass bound`,
          where: gt(field, subclassBound),
          accepts: (time: number) => time > subclassBoundTime,
        },
        {
          name: `gte with subclass bound`,
          where: gte(field, subclassBound),
          accepts: (time: number) => time >= subclassBoundTime,
        },
        {
          name: `lt with subclass bound`,
          where: lt(field, subclassBound),
          accepts: (time: number) => time < subclassBoundTime,
        },
        {
          name: `lte with subclass bound`,
          where: lte(field, subclassBound),
          accepts: (time: number) => time <= subclassBoundTime,
        },
        {
          name: `subclass bound less than field`,
          where: lt(subclassBound, field),
          accepts: (time: number) => subclassBoundTime < time,
        },
        {
          name: `subclass bound less than or equal to field`,
          where: lte(subclassBound, field),
          accepts: (time: number) => subclassBoundTime <= time,
        },
        {
          name: `subclass bound greater than field`,
          where: gt(subclassBound, field),
          accepts: (time: number) => subclassBoundTime > time,
        },
        {
          name: `subclass bound greater than or equal to field`,
          where: gte(subclassBound, field),
          accepts: (time: number) => subclassBoundTime >= time,
        },
      ]
      const mixedPredicates = [
        {
          name: `Date greater than number`,
          where: gt(field, 1),
          accepts: (time: number) => time > 1,
        },
        {
          name: `number less than Date`,
          where: lt(1, field),
          accepts: (time: number) => 1 < time,
        },
        {
          name: `Date less than number`,
          where: lt(field, 1),
          accepts: (time: number) => time < 1,
        },
        {
          name: `number greater than Date`,
          where: gt(1, field),
          accepts: (time: number) => 1 > time,
        },
      ]
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `index-valueof-date-${name}`,
          getKey: (row: (typeof dateRows)[number]) => row.id,
          initialData: dateRows,
          autoIndex: `off`,
        }),
      )
      register(() => collection.cleanup())
      await collection.stateWhenReady()

      // The model captured native timestamps, which ignore subclass valueOf.
      // The two overrides deliberately reverse their apparent native-operator
      // positions, while ordinary Dates control both sides and equality.
      expect(Number(earlierForeign)).toBe(100)
      expect(Number(dateRows[3]!.v)).toBe(-100)
      expect(Number(subclassBound)).toBe(-100)
      const expectedDateKeys = (accepts: (time: number) => boolean) =>
        referenceRows
          .filter(({ time }) => accepts(time))
          .map(({ id }) => id)
          .sort()
      const snapshotKeys = (
        where: BasicExpression<boolean>,
        optimizedOnly = false,
      ) =>
        collection
          .currentStateAsChanges({ where, optimizedOnly })
          ?.map((change) => String(change.key))
          .sort()

      // A ready Collection's public snapshots are the comparison cuts. Scan
      // first, then install one index and require both the ordinary and
      // optimized-only path to refine the same timestamp relation.
      for (const predicate of predicates) {
        expect(snapshotKeys(predicate.where), `scan ${predicate.name}`).toEqual(
          expectedDateKeys(predicate.accepts),
        )
        expect(
          snapshotKeys(predicate.where, true),
          `unindexed optimized-only ${predicate.name}`,
        ).toBeUndefined()
      }
      // Equality already normalizes native Dates to numbers. Relational scan
      // results must use the same timestamp when either operand is a number.
      for (const predicate of mixedPredicates) {
        expect(snapshotKeys(predicate.where), `scan ${predicate.name}`).toEqual(
          expectedDateKeys(predicate.accepts),
        )
      }
      const index = collection.createIndex((row) => row.v, { indexType })
      const lookup = vi.spyOn(index, `lookup`)
      for (const predicate of predicates) {
        expect(
          snapshotKeys(predicate.where),
          `indexed ${predicate.name}`,
        ).toEqual(expectedDateKeys(predicate.accepts))
        expect(lookup, `indexed ${predicate.name} reached`).toHaveBeenCalled()
        lookup.mockClear()
        expect(
          snapshotKeys(predicate.where, true),
          `optimized-only ${predicate.name}`,
        ).toEqual(expectedDateKeys(predicate.accepts))
        expect(
          lookup,
          `optimized-only ${predicate.name} reached`,
        ).toHaveBeenCalled()
        lookup.mockClear()
      }

      // This hostile mutation crosses the bound after every public check.
      // The expected keys stay fixed because the model recorded the original
      // timestamps before production received the source rows.
      const greaterKeys = expectedDateKeys((time) => time > boundTime)
      expect(greaterKeys).toContain(`local-later`)
      dateRows[3]!.v.setTime(-2)
      expect(nativeGetTime.call(dateRows[3]!.v)).toBe(-2)
      expect(expectedDateKeys((time) => time > boundTime)).toEqual(greaterKeys)
    })
  },
)

it.each([false, true])(
  `preserves distinct fields in a Collection subscription callback (indexed=%s)`,
  async (indexed) => {
    await checkWithCleanup(async (register) => {
      const collection = await readyCollection(
        `subscription-${indexed}`,
        register,
      )
      if (indexed) collection.createIndex((row) => row.a.b)
      const changes: Array<string | number> = []
      const subscription = collection.subscribeChanges(
        (batch) => changes.push(...batch.map((change) => change.key)),
        {
          includeInitialState: true,
          where: (row) => and(gt(row[`a.b`], 5), lt(row.a.b, 20)),
        },
      )
      register(() => subscription.unsubscribe())
      expect(changes.sort()).toEqual(expectedKeys)
    })
  },
)

it(`keeps selected dotted and nested paths distinct in a public order`, async () => {
  await checkWithCleanup(async (register) => {
    const collection = await readyCollection(`selected-order`, register)
    const result = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: collection })
          .fn.select(({ item }) => ({
            id: item.id,
            'a.b': item[`a.b`],
            a: { b: item.a.b },
          }))
          .orderBy(({ $selected }) => add($selected[`a.b`], $selected.a.b))
          .orderBy(({ $selected }) => $selected.id),
      startSync: true,
    })
    register(() => result.cleanup())

    await result.stateWhenReady()
    const expected = [...rows]
      .sort(
        (left, right) =>
          left[`a.b`] + left.a.b - (right[`a.b`] + right.a.b) ||
          left.id.localeCompare(right.id),
      )
      .map((row) => row.id)
    expect(result.toArray.map((row) => row.id)).toEqual(expected)
  })
})

it.each([false, true])(
  `preserves distinct fields in a live-query callback (indexed=%s)`,
  async (indexed) => {
    await checkWithCleanup(async (register) => {
      const collection = await readyCollection(
        `live-query-${indexed}`,
        register,
      )
      if (indexed) collection.createIndex((row) => row.a.b)
      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: collection })
            .where(({ item }) => and(gt(item[`a.b`], 5), lt(item.a.b, 20)))
            .select(({ item }) => ({ id: item.id })),
        startSync: true,
      })
      register(() => result.cleanup())
      await result.stateWhenReady()
      expect(result.toArray.map((row) => row.id).sort()).toEqual(expectedKeys)
    })
  },
)

it(`preserves a mismatch and secondary cleanup error`, async () => {
  const primary = new Error(`wrong public rows`)
  const cleanup = new Error(`cleanup failed`)
  const released: Array<string> = []
  let failure: unknown

  try {
    await checkWithCleanup((register) => {
      register(() => {
        released.push(`source`)
        throw cleanup
      })
      register(() => {
        released.push(`query`)
      })
      throw primary
    })
  } catch (error) {
    failure = error
  }

  expect(released).toEqual([`query`, `source`])
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).cause).toBe(primary)
  expect((failure as AggregateError).errors).toEqual([cleanup])
})
