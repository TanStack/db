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
 *
 * Production driver: `currentStateAsChanges`, Collection subscriptions, and
 * live-query Collections run the real predicates and callback compilers.
 * Refinement check: At each checkpoint, exact public keys equal the model keys;
 * selected-field order equals a direct JavaScript sort over both field values.
 * The cross product contains rows that a merged range omits or adds; unchanged
 * scan results make index addition an explicit metamorphic control. The
 * nested index's lookup spy proves the indexed path ran after installation.
 *
 * Known omissions: This bounded owner does not claim arbitrary path segments,
 * nullish values, custom collation, or incremental publication histories.
 * Lazy demand target deduplication has a separate compiler-boundary witness.
 */
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { add, and, gt, lt, lte } from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { BasicExpression } from '../../src/query/ir.js'

interface Row {
  id: string
  'a.b': number
  a: { b: number }
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

async function readyCollection(name: string) {
  const collection = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `index-path-collision-${name}`,
      getKey: (row) => row.id,
      initialData: rows,
      autoIndex: `off`,
      defaultIndexType: BTreeIndex,
    }),
  )
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
    const collection = await readyCollection(name)
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
  },
)

it.each([false, true])(
  `preserves distinct fields in a Collection subscription callback (indexed=%s)`,
  async (indexed) => {
    const collection = await readyCollection(`subscription-${indexed}`)
    if (indexed) collection.createIndex((row) => row.a.b)
    const changes: Array<string | number> = []
    const subscription = collection.subscribeChanges(
      (batch) => changes.push(...batch.map((change) => change.key)),
      {
        includeInitialState: true,
        where: (row) => and(gt(row[`a.b`], 5), lt(row.a.b, 20)),
      },
    )
    expect(changes.sort()).toEqual(expectedKeys)
    subscription.unsubscribe()
  },
)

it(`keeps selected dotted and nested paths distinct in a public order`, async () => {
  const collection = await readyCollection(`selected-order`)
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

  await result.stateWhenReady()
  const expected = [...rows]
    .sort(
      (left, right) =>
        left[`a.b`] + left.a.b - (right[`a.b`] + right.a.b) ||
        left.id.localeCompare(right.id),
    )
    .map((row) => row.id)
  expect(result.toArray.map((row) => row.id)).toEqual(expected)
  await result.cleanup()
})

it.each([false, true])(
  `preserves distinct fields in a live-query callback (indexed=%s)`,
  async (indexed) => {
    const collection = await readyCollection(`live-query-${indexed}`)
    if (indexed) collection.createIndex((row) => row.a.b)
    const result = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: collection })
          .where(({ item }) => and(gt(item[`a.b`], 5), lt(item.a.b, 20)))
          .select(({ item }) => ({ id: item.id })),
      startSync: true,
    })
    await result.stateWhenReady()
    expect(result.toArray.map((row) => row.id).sort()).toEqual(expectedKeys)
    await result.cleanup()
  },
)
