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
 * A wrong rule that joins path segments with `.` treats [`a.b`] and [`a`, `b`]
 * as the same field. In the first predicate case, it can add `0-10` or omit
 * `25-0`; the exact-key checks reject either result at the scan and indexed
 * checkpoints. The controlled source fixture makes no external-provider claim.
 *
 * Known omissions: This bounded owner does not claim arbitrary path segments,
 * nullish values, custom collation, or incremental publication histories.
 * Lazy demand target deduplication has a separate compiler-boundary witness.
 */
import { expect, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { add, and, gt, lt, lte } from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { checkWithCleanup } from './index-path-collision-support.js'
import type { Release } from './index-path-collision-support.js'
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

// Model: plain JavaScript keeps the rows that a predicate accepts, then sorts
// their ids. The predicate is the only input, so every query shape shares it.
function modelKeys(accepts: (row: Row) => boolean): Array<string> {
  return rows
    .filter(accepts)
    .map((row) => row.id)
    .sort()
}

// Model: the selected-field order is a JavaScript sort of both path values,
// with ids breaking ties.
function modelSelectedOrder(): Array<string> {
  return [...rows]
    .sort(
      (left, right) =>
        left[`a.b`] + left.a.b - (right[`a.b`] + right.a.b) ||
        left.id.localeCompare(right.id),
    )
    .map((row) => row.id)
}

const expectedKeys = modelKeys((row) => row[`a.b`] > 5 && row.a.b < 20)

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

async function runPredicateCase({
  name,
  where,
  accepts,
}: (typeof cases)[number]): Promise<void> {
  await checkWithCleanup(async (register) => {
    const collection = await readyCollection(name, register)
    const expected = modelKeys(accepts)
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
}

async function runSubscriptionCase(indexed: boolean): Promise<void> {
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
}

async function runSelectedOrderHistory(): Promise<void> {
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
    const expected = modelSelectedOrder()
    expect(result.toArray.map((row) => row.id)).toEqual(expected)
  })
}

async function runLiveQueryCase(indexed: boolean): Promise<void> {
  await checkWithCleanup(async (register) => {
    const collection = await readyCollection(`live-query-${indexed}`, register)
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
}

// Each production path above runs as its own property. The rows of `cases`
// hold functions, so a predicate history is the case's name.
const pathLaw = {
  statement: `A source row matches an AND predicate according to each complete property path, so a scalar property named a.b and a nested a.b property are distinct fields; adding an index may change work, but not public rows.`,
  authority: `docs/guides/live-queries.md (AND filters, selected fields, computed orderBy values) and the live-query architecture's treatment of an index as a physical query detail.`,
}
const casesByName = new Map(cases.map((row) => [row.name, row]))

oracleProperty({
  id: `index-path-collision.predicate`,
  law: {
    ...pathLaw,
    limits: `The four bounded predicate shapes, scanned and then indexed, through currentStateAsChanges.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: cases.map(({ name }) => name),
  label: (name) =>
    `keeps dotted scalar and nested predicates distinct: ${name}`,
  resolve: (name) => ({ row: casesByName.get(name)! }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`distinct field paths`, plan, observe, () =>
      runPredicateCase(plan.row),
    ),
  check: forwardAssertionJudgment,
})

oracleProperty({
  id: `index-path-collision.subscription`,
  law: {
    ...pathLaw,
    limits: `A Collection subscription callback with and without the nested-field index.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: [false, true],
  label: (indexed) =>
    `preserves distinct fields in a Collection subscription callback (indexed=${indexed})`,
  resolve: (indexed) => ({ indexed }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`distinct field paths`, plan, observe, () =>
      runSubscriptionCase(plan.indexed),
    ),
  check: forwardAssertionJudgment,
})

oracleProperty({
  id: `index-path-collision.selected-order`,
  law: {
    ...pathLaw,
    limits: `One selected-field ordering through the public $selected callback proxy.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: [
    `keeps selected dotted and nested paths distinct in a public order`,
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`distinct field paths`, plan, observe, () =>
      runSelectedOrderHistory(),
    ),
  check: forwardAssertionJudgment,
})

oracleProperty({
  id: `index-path-collision.live-query`,
  law: {
    ...pathLaw,
    limits: `A live-query callback with and without the nested-field index.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: [false, true],
  label: (indexed) =>
    `preserves distinct fields in a live-query callback (indexed=${indexed})`,
  resolve: (indexed) => ({ indexed }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`distinct field paths`, plan, observe, () =>
      runLiveQueryCase(plan.indexed),
    ),
  check: forwardAssertionJudgment,
})
