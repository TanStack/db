/**
 * # Which rows does a WHERE clause publish, and to which subscribers?
 *
 * Law and source: a WHERE clause keeps a row only when its predicate is TRUE
 * under SQL three-valued logic. The evaluator contract in
 * `src/query/compiler/evaluators.ts` states the operand rules: `eq` with a
 * null or undefined operand is UNKNOWN, `NaN` equals `NaN` (PostgreSQL float
 * semantics), a valid Date compares as its millisecond timestamp, and other
 * values of different types are unequal. `not`, `and`, and `or` follow Kleene
 * logic, so `not(UNKNOWN)` is UNKNOWN. Virtual row fields (`$synced`,
 * `$origin`, `$key`) are row fields for filtering; a pending optimistic insert
 * is `$synced: false` and `$origin: 'local'`, and a synced row from this
 * adapter is `$synced: true` and `$origin: 'remote'`.
 *
 * Filtered publication must agree with that predicate after every source
 * transaction. `Collection.subscribeChanges` with a `whereExpression` turns an
 * update into an insert when the row starts matching and into a delete when it
 * stops. A subscriber that requested the initial state sees every TRUE row.
 * A subscriber that did not sees a TRUE row once a later insert or update
 * touches it. A live query publishes every TRUE row.
 *
 * Why an example can miss the failure: a direct `eq` filter treats FALSE and
 * UNKNOWN alike, because both drop the row; the difference appears only under
 * `not`. A subscription may skip a source batch that cannot satisfy its
 * predicate. That shortcut is wrong for `or`, for literals that other types
 * normalize onto (a Date equals its timestamp), and for a row that moves out of
 * the predicate, yet non-negated single-row examples pass all of those.
 *
 * Model: `expectedTruth` is an independent Kleene evaluator over plain row
 * objects, and `expectedVisible` adds the touched-row rule for a subscriber
 * without initial state. Neither imports production comparison,
 * normalization, prefilter, or virtual-field helpers.
 *
 * History grammar: rows carry field `v` from a value domain of equal and
 * unequal strings, a string that begins with the internal normalization
 * prefix, booleans, numbers, `NaN`, a valid Date, `null`, and a missing field.
 * Predicates are `eq` leaves over `v`, a literal, or a virtual field, composed
 * with `not`, `and`, and `or` up to depth three. A snapshot history may hold
 * pending optimistic inserts and applies no source transactions: the
 * Collection holds synced commits while a user transaction persists, and the
 * optimistic-history oracle owns that law. A change history starts from synced
 * rows and applies up to six synced transactions of one to three operations.
 * Operations insert a new or previously deleted key, or update or delete an
 * existing key, so one transaction can move several rows across the predicate
 * boundary. An update
 * to an equivalent value, or a second update to one key in the same
 * transaction, is dropped from the history: whether a net no-op publishes is
 * change detection, which the change-event history oracle owns. Each history
 * runs with and without a `BasicIndex` on `v`.
 *
 * Production driver: a `mockSyncCollectionOptions` Collection; a live query
 * built with the public `eq`/`not`/`and`/`or` builder functions; direct
 * `subscribeChanges` subscribers with and without `includeInitialState` using
 * the equivalent IR; and the public `Collection.currentStateAsChanges`
 * snapshot.
 *
 * Refinement check: each consumer's exact key set equals the model after the
 * subscribers attach and after each sync transaction commits. Direct
 * subscribers are reconstructed from their callback batches. Two fixed
 * witnesses check boundaries outside the generated grammar: Collection
 * readiness reaches a filtered subscriber as one empty batch, and an eager
 * source restarted after cleanup retracts a vanished row even when its first
 * batch cannot satisfy the predicate.
 *
 * Calibration: pinned histories separate Kleene from two-valued logic, and a
 * checker test requires the two-valued answer to fail. Hostile production
 * mutants that returned FALSE for `eq(string, null)`, prefiltered on `or`
 * operands as if they were conjuncts, prefiltered number literals past Date or
 * NaN rows, skipped an empty
 * Collection-readiness batch, or skipped a batch while stale published rows awaited
 * reconciliation each passed the pre-existing `@tanstack/db` suite and fail
 * here.
 *
 * Known omissions: comparison operators other than `eq`, `in`, `like`,
 * Temporal and binary operands, joins, ordering, optimistic updates and
 * deletes, truncate, and failed replay are outside this owner. The structural
 * comparison, cold-join, and subscription replay oracles own those boundaries.
 * Generated cleanup and restart histories for filtered subscribers remain
 * open; the lifecycle publication owner needs a predicate dimension to reach
 * them.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { and, eq, not, or } from '../../src/query/builder/functions.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../utils.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { ChangeMessage } from '../../src/types.js'

const property = `where-predicate.publication`
const requestedReplayProperty = readOracleRunConfig().replayProperty

// A string whose content equals an internal normalized-key prefix must still
// compare as an ordinary string.
const PREFIXED = `\u0000tanstack-db:string:a`
const MISSING = Symbol(`missing field`)
// A valid Date equals the number of its timestamp.
const DATE_ONE = new Date(1)

type FieldValue = string | boolean | number | Date | null | typeof MISSING
type Row = { id: string; v?: unknown }
type Truth = boolean | null

const fieldValues: ReadonlyArray<FieldValue> = [
  `a`,
  `b`,
  PREFIXED,
  true,
  false,
  1,
  2,
  Number.NaN,
  DATE_ONE,
  null,
  MISSING,
]
const literalValues: ReadonlyArray<FieldValue> = [
  `a`,
  PREFIXED,
  true,
  1,
  Number.NaN,
  null,
]

type Operand =
  | { kind: `field` }
  | { kind: `literal`; value: FieldValue }
  | { kind: `virtual`; name: `$synced` | `$origin` | `$key` }

type Predicate =
  | { kind: `eq`; left: Operand; right: Operand }
  | { kind: `not`; arg: Predicate }
  | { kind: `and` | `or`; args: [Predicate, Predicate] }

type SeedRow = { v: FieldValue; optimistic: boolean }
type Operation =
  | { type: `insert`; v: FieldValue; reuse?: number }
  | { type: `update`; target: number; v: FieldValue }
  | { type: `delete`; target: number }
type History =
  | { kind: `snapshot`; rows: Array<SeedRow>; predicate: Predicate }
  | {
      kind: `changes`
      rows: Array<FieldValue>
      predicate: Predicate
      transactions: Array<Array<Operation>>
    }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type ModelRow = {
  id: string
  v: FieldValue
  $synced: boolean
  $origin: `local` | `remote`
  $key: string
}

function operandValue(operand: Operand, row: ModelRow): unknown {
  switch (operand.kind) {
    case `field`:
      return row.v === MISSING ? undefined : row.v
    case `literal`:
      return operand.value === MISSING ? undefined : operand.value
    case `virtual`:
      return row[operand.name]
  }
}

// SQL equality: nullish is UNKNOWN, NaN equals NaN, a Date compares as its
// timestamp, and other values compare by type and value.
function expectedEquality(a: unknown, b: unknown): Truth {
  if (a === null || a === undefined || b === null || b === undefined) {
    return null
  }
  const left = a instanceof Date ? a.getTime() : a
  const right = b instanceof Date ? b.getTime() : b
  if (Number.isNaN(left) && Number.isNaN(right)) return true
  return typeof left === typeof right && left === right
}

// Kleene logic: FALSE dominates AND, TRUE dominates OR, NOT keeps UNKNOWN.
function expectedTruth(predicate: Predicate, row: ModelRow): Truth {
  switch (predicate.kind) {
    case `eq`:
      return expectedEquality(
        operandValue(predicate.left, row),
        operandValue(predicate.right, row),
      )
    case `not`: {
      const value = expectedTruth(predicate.arg, row)
      return value === null ? null : !value
    }
    case `and`: {
      const values = predicate.args.map((arg) => expectedTruth(arg, row))
      if (values.includes(false)) return false
      return values.includes(null) ? null : true
    }
    case `or`: {
      const values = predicate.args.map((arg) => expectedTruth(arg, row))
      if (values.includes(true)) return true
      return values.includes(null) ? null : false
    }
  }
}

// A subscriber without initial state sees a TRUE row only after a later
// insert or update touches it.
function expectedVisible(
  predicate: Predicate,
  rows: ReadonlyMap<string, ModelRow>,
  touched?: ReadonlySet<string>,
): Array<string> {
  return [...rows.values()]
    .filter(
      (row) =>
        expectedTruth(predicate, row) === true &&
        (touched === undefined || touched.has(row.id)),
    )
    .map((row) => row.id)
    .sort()
}

// Updates between these values are no-ops outside this grammar.
function equivalentFieldValues(a: FieldValue, b: FieldValue): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  return Object.is(a, b)
}

function syncedModelRow(id: string, v: FieldValue): ModelRow {
  return { id, v, $synced: true, $origin: `remote`, $key: id }
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const fieldValueArbitrary = fc.constantFrom(...fieldValues)
const operandArbitrary: fc.Arbitrary<Operand> = fc.oneof(
  { weight: 4, arbitrary: fc.constant({ kind: `field` as const }) },
  {
    weight: 4,
    arbitrary: fc
      .constantFrom(...literalValues)
      .map((value): Operand => ({ kind: `literal`, value })),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(`$synced` as const, `$origin` as const, `$key` as const)
      .map((name): Operand => ({ kind: `virtual`, name })),
  },
)
const leafArbitrary: fc.Arbitrary<Predicate> = fc
  .tuple(operandArbitrary, operandArbitrary)
  .map(([left, right]) => ({ kind: `eq` as const, left, right }))

const predicateArbitrary: fc.Arbitrary<Predicate> = fc.letrec<{
  predicate: Predicate
}>((tie) => ({
  predicate: fc.oneof(
    { depthSize: `small`, maxDepth: 3 },
    leafArbitrary,
    tie(`predicate`).map((arg) => ({ kind: `not` as const, arg })),
    fc
      .tuple(
        fc.constantFrom(`and` as const, `or` as const),
        tie(`predicate`),
        tie(`predicate`),
      )
      .map(([kind, left, right]) => ({
        kind,
        args: [left, right] as [Predicate, Predicate],
      })),
  ),
})).predicate

// A top-level `eq(v, string | boolean)` conjunct lets a subscription skip
// batches that cannot match and lets an unindexed snapshot reject stored rows
// before copying them. Histories favor that shape so generated histories
// exercise both shortcuts, not only the full filter.
const prefilterablePredicateArbitrary: fc.Arbitrary<Predicate> = fc
  .tuple(
    fc.constantFrom<FieldValue>(`a`, PREFIXED, true),
    fc.option(predicateArbitrary, { nil: undefined }),
  )
  .map(([value, rest]): Predicate => {
    const conjunct: Predicate = {
      kind: `eq`,
      left: { kind: `field` },
      right: { kind: `literal`, value },
    }
    return rest === undefined
      ? conjunct
      : { kind: `and`, args: [conjunct, rest] }
  })

// Histories favor one matching and one non-matching string so rows cross the
// predicate boundary often; the full domain stays reachable.
const changeValueArbitrary = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom<FieldValue>(`a`, `b`) },
  fieldValueArbitrary,
)

const operationArbitrary: fc.Arbitrary<Operation> = fc.oneof(
  fc
    .tuple(
      changeValueArbitrary,
      fc.option(fc.nat({ max: 7 }), { nil: undefined }),
    )
    .map(
      ([v, reuse]): Operation =>
        reuse === undefined
          ? { type: `insert`, v }
          : { type: `insert`, v, reuse },
    ),
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.nat({ max: 7 }), changeValueArbitrary)
      .map(([target, v]): Operation => ({ type: `update`, target, v })),
  },
  fc.nat({ max: 7 }).map((target): Operation => ({ type: `delete`, target })),
)

const historyArbitrary: fc.Arbitrary<History> = fc.oneof(
  fc.record({
    kind: fc.constant(`snapshot` as const),
    rows: fc.array(
      fc.record({ v: changeValueArbitrary, optimistic: fc.boolean() }),
      { minLength: 1, maxLength: 6 },
    ),
    predicate: fc.oneof(predicateArbitrary, prefilterablePredicateArbitrary),
  }),
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant(`changes` as const),
      rows: fc.array(changeValueArbitrary, { maxLength: 5 }),
      predicate: fc.oneof(predicateArbitrary, {
        weight: 2,
        arbitrary: prefilterablePredicateArbitrary,
      }),
      transactions: fc.array(
        fc.array(operationArbitrary, { minLength: 1, maxLength: 3 }),
        { minLength: 1, maxLength: 6 },
      ),
    }),
  },
)

const fieldEq = (value: FieldValue): Predicate => ({
  kind: `eq`,
  left: { kind: `field` },
  right: { kind: `literal`, value },
})

// Kleene and two-valued logic disagree on each snapshot history. The first is
// the negated nullish comparison that a FALSE-for-UNKNOWN fast path misses.
const pinnedHistories: ReadonlyArray<History> = [
  {
    kind: `snapshot`,
    rows: [
      { v: `a`, optimistic: false },
      { v: `b`, optimistic: false },
      { v: null, optimistic: false },
      { v: MISSING, optimistic: false },
    ],
    predicate: { kind: `not`, arg: fieldEq(`a`) },
  },
  {
    kind: `snapshot`,
    rows: [
      { v: `a`, optimistic: true },
      { v: null, optimistic: false },
      { v: Number.NaN, optimistic: false },
      { v: PREFIXED, optimistic: true },
    ],
    predicate: {
      kind: `or`,
      args: [
        {
          kind: `not`,
          arg: {
            kind: `eq`,
            left: { kind: `literal`, value: true },
            right: { kind: `field` },
          },
        },
        {
          kind: `eq`,
          left: { kind: `virtual`, name: `$synced` },
          right: { kind: `literal`, value: false },
        },
      ],
    },
  },
  {
    kind: `snapshot`,
    rows: [
      { v: PREFIXED, optimistic: false },
      { v: `a`, optimistic: false },
      { v: Number.NaN, optimistic: false },
      { v: 1, optimistic: false },
      { v: MISSING, optimistic: false },
    ],
    predicate: {
      kind: `and`,
      args: [
        { kind: `not`, arg: fieldEq(PREFIXED) },
        { kind: `not`, arg: fieldEq(Number.NaN) },
      ],
    },
  },
]

// An unindexed snapshot may reject stored rows by one field before copying
// them. A pending optimistic row is visible although it is not yet synced.
const pinnedPrefilteredSnapshot: History = {
  kind: `snapshot`,
  rows: [
    { v: `a`, optimistic: true },
    { v: `a`, optimistic: false },
    { v: `b`, optimistic: true },
  ],
  predicate: fieldEq(`a`),
}

// Each change history moves rows across a predicate whose equality operand a
// skip-if-no-match shortcut can misread.
const pinnedChangeHistories: ReadonlyArray<History> = [
  {
    // `or` operands are alternatives, not conjuncts.
    kind: `changes`,
    rows: [`b`, `a`],
    predicate: { kind: `or`, args: [fieldEq(`a`), fieldEq(true)] },
    transactions: [
      [{ type: `update`, target: 0, v: true }],
      [
        { type: `update`, target: 1, v: false },
        { type: `insert`, v: true },
      ],
    ],
  },
  {
    // A valid Date equals its timestamp, so a number literal cannot prefilter
    // by identity.
    kind: `changes`,
    rows: [2, 2],
    predicate: fieldEq(1),
    transactions: [
      [{ type: `update`, target: 0, v: DATE_ONE }],
      [
        { type: `update`, target: 0, v: 2 },
        { type: `update`, target: 1, v: 1 },
      ],
    ],
  },
  {
    // NaN equals NaN, although NaN is not identical to itself.
    kind: `changes`,
    rows: [2],
    predicate: fieldEq(Number.NaN),
    transactions: [[{ type: `update`, target: 0, v: Number.NaN }]],
  },
  {
    // A subscriber without initial state records every unsent inserted key.
    // Deleting a key it never published must still clear that record, or a
    // later matching reinsertion looks like a duplicate insert.
    kind: `changes`,
    rows: [],
    predicate: fieldEq(`a`),
    transactions: [
      [
        { type: `insert`, v: `a` },
        { type: `insert`, v: `b` },
      ],
      [{ type: `delete`, target: 1 }],
      [{ type: `insert`, v: `a`, reuse: 0 }],
    ],
  },
  {
    // A row that moves out must be retracted, including inside one batch.
    kind: `changes`,
    rows: [`a`, `a`, `b`],
    predicate: {
      kind: `and`,
      args: [fieldEq(`a`), { kind: `not`, arg: fieldEq(PREFIXED) }],
    },
    transactions: [
      [
        { type: `update`, target: 0, v: `b` },
        { type: `update`, target: 2, v: `a` },
      ],
      [
        { type: `delete`, target: 1 },
        { type: `insert`, v: `a` },
        { type: `update`, target: 0, v: `a` },
      ],
    ],
  },
]

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

type RefLike = Record<string, unknown>

function builderOperand(operand: Operand, row: RefLike): unknown {
  switch (operand.kind) {
    case `field`:
      return row.v
    case `literal`:
      return operand.value === MISSING ? undefined : operand.value
    case `virtual`:
      return row[operand.name]
  }
}

function builderPredicate(
  predicate: Predicate,
  row: RefLike,
): BasicExpression<boolean> {
  switch (predicate.kind) {
    case `eq`:
      return eq(
        builderOperand(predicate.left, row) as never,
        builderOperand(predicate.right, row) as never,
      )
    case `not`:
      return not(builderPredicate(predicate.arg, row))
    case `and`:
      return and(
        builderPredicate(predicate.args[0], row),
        builderPredicate(predicate.args[1], row),
      )
    case `or`:
      return or(
        builderPredicate(predicate.args[0], row),
        builderPredicate(predicate.args[1], row),
      )
  }
}

function irOperand(operand: Operand): BasicExpression {
  switch (operand.kind) {
    case `field`:
      return new PropRef([`v`])
    case `literal`:
      return new Value(operand.value === MISSING ? undefined : operand.value)
    case `virtual`:
      return new PropRef([operand.name])
  }
}

function irPredicate(predicate: Predicate): BasicExpression<boolean> {
  switch (predicate.kind) {
    case `eq`:
      return new Func(`eq`, [
        irOperand(predicate.left),
        irOperand(predicate.right),
      ])
    case `not`:
      return new Func(`not`, [irPredicate(predicate.arg)])
    case `and`:
    case `or`:
      return new Func(predicate.kind, predicate.args.map(irPredicate))
  }
}

function sourceRow(id: string, v: FieldValue): Row {
  return v === MISSING ? { id } : { id, v }
}

type Consumer =
  | `live query`
  | `subscriber with initial state`
  | `subscriber without initial state`
  | `direct snapshot`

type Observation = {
  checkpoint: string
  consumer: Consumer
  keys: Array<string>
}

// Rebuild a subscriber's visible key set from its callback batches.
function recordVisibleKeys(visible: Set<string | number>) {
  return (changes: Array<ChangeMessage<Row>>) => {
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(change.key)
      else visible.add(change.key)
    }
  }
}

let collectionSerial = 0

async function observeHistory(
  history: History,
  indexed: boolean,
): Promise<{ observations: Array<Observation>; model: Array<Observation> }> {
  const seeds: Array<SeedRow & { id: string }> =
    history.kind === `snapshot`
      ? history.rows.map((seed, index) => ({ ...seed, id: `r${index}` }))
      : history.rows.map((v, index) => ({
          v,
          optimistic: false,
          id: `r${index}`,
        }))
  const collection = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `where-publication-${collectionSerial++}`,
      getKey: (row) => row.id,
      initialData: seeds
        .filter((seed) => !seed.optimistic)
        .map((seed) => sourceRow(seed.id, seed.v)),
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: collection })
      .where(({ row }) =>
        builderPredicate(history.predicate, row as unknown as RefLike),
      ),
  )
  const modelRows = new Map<string, ModelRow>(
    seeds.map((seed) => [
      seed.id,
      {
        ...syncedModelRow(seed.id, seed.v),
        $synced: !seed.optimistic,
        $origin: seed.optimistic ? `local` : `remote`,
      },
    ]),
  )
  const touched = new Set<string>()
  const withInitial = new Set<string | number>()
  const withoutInitial = new Set<string | number>()
  const observations: Array<Observation> = []
  const model: Array<Observation> = []
  const record = (
    checkpoint: string,
    consumer: Consumer,
    keys: Iterable<string | number>,
  ) => {
    observations.push({
      checkpoint,
      consumer,
      keys: [...keys].map(String).sort(),
    })
    model.push({
      checkpoint,
      consumer,
      keys: expectedVisible(
        history.predicate,
        modelRows,
        consumer === `subscriber without initial state` ? touched : undefined,
      ),
    })
  }
  const recordSubscribers = (checkpoint: string) => {
    record(checkpoint, `live query`, live.keys())
    record(checkpoint, `subscriber with initial state`, withInitial)
    record(checkpoint, `subscriber without initial state`, withoutInitial)
  }

  const subscriptions: Array<{ unsubscribe: () => void }> = []
  try {
    await collection.stateWhenReady()
    if (indexed) {
      collection.createIndex((row) => row.v, { indexType: BasicIndex })
    }
    // Pending optimistic inserts stay local: the adapter's onInsert awaits a
    // sync acknowledgement that this history never sends.
    for (const seed of seeds.filter((entry) => entry.optimistic)) {
      collection.insert(sourceRow(seed.id, seed.v))
    }
    await live.preload()
    subscriptions.push(
      collection.subscribeChanges(recordVisibleKeys(withInitial), {
        includeInitialState: true,
        whereExpression: irPredicate(history.predicate),
      }),
      collection.subscribeChanges(recordVisibleKeys(withoutInitial), {
        whereExpression: irPredicate(history.predicate),
      }),
    )
    recordSubscribers(`after subscribe`)
    const snapshot = collection.currentStateAsChanges({
      where: irPredicate(history.predicate),
    })
    if (!snapshot) throw new Error(`an unoptimized snapshot must return rows`)
    record(
      `after subscribe`,
      `direct snapshot`,
      snapshot.map((change) => change.key),
    )

    if (history.kind === `changes`) {
      let nextKey = 0
      // Keys deleted by an earlier transaction may be reinserted. Reinsertion
      // in the deleting transaction is a net change outside this grammar.
      const deletedKeys: Array<string> = []
      for (const [step, operations] of history.transactions.entries()) {
        collection.utils.begin()
        const updatedKeys = new Set<string>()
        const reusableKeys = [...deletedKeys]
        for (const operation of operations) {
          const keys = [...modelRows.keys()]
          if (operation.type === `insert`) {
            const reused =
              operation.reuse !== undefined && reusableKeys.length > 0
                ? reusableKeys.splice(
                    operation.reuse % reusableKeys.length,
                    1,
                  )[0]!
                : undefined
            if (reused !== undefined) {
              deletedKeys.splice(deletedKeys.indexOf(reused), 1)
            }
            const id = reused ?? `n${nextKey++}`
            collection.utils.write({
              type: `insert`,
              value: sourceRow(id, operation.v),
            })
            modelRows.set(id, syncedModelRow(id, operation.v))
            touched.add(id)
            continue
          }
          // Targets name a current key; an empty Collection has none.
          if (keys.length === 0) continue
          const id = keys[operation.target % keys.length]!
          if (operation.type === `delete`) {
            collection.utils.write({ type: `delete`, value: { id } })
            modelRows.delete(id)
            touched.delete(id)
            deletedKeys.push(id)
            continue
          }
          if (
            updatedKeys.has(id) ||
            equivalentFieldValues(modelRows.get(id)!.v, operation.v)
          ) {
            continue
          }
          updatedKeys.add(id)
          // Synced updates merge fields, so a missing field is written as an
          // explicit undefined; both are UNKNOWN operands.
          collection.utils.write({
            type: `update`,
            value: { id, v: operation.v === MISSING ? undefined : operation.v },
          })
          modelRows.set(id, syncedModelRow(id, operation.v))
          touched.add(id)
        }
        collection.utils.commit()
        recordSubscribers(`after transaction ${step}`)
      }
    }
  } finally {
    for (const subscription of subscriptions) subscription.unsubscribe()
    await live.cleanup()
    await collection.cleanup()
  }
  return { observations, model }
}

async function runHistory(history: History): Promise<void> {
  for (const indexed of [false, true]) {
    const { observations, model } = await observeHistory(history, indexed)
    const path = `${indexed ? `index` : `scan`} path for ${describePredicate(history.predicate)}`
    const listObservations = (list: Array<Observation>) =>
      list.map((o) => `${o.checkpoint} ${o.consumer}: [${o.keys.join(`,`)}]`)
    expect(listObservations(observations), path).toEqual(
      listObservations(model),
    )
  }
}

function describeValue(value: FieldValue): string {
  if (value === MISSING) return `<missing>`
  if (typeof value === `string`) return JSON.stringify(value)
  if (value instanceof Date) return `Date(${value.getTime()})`
  return String(value)
}

function describePredicate(predicate: Predicate): string {
  const operand = (o: Operand) =>
    o.kind === `field`
      ? `v`
      : o.kind === `virtual`
        ? o.name
        : describeValue(o.value)
  switch (predicate.kind) {
    case `eq`:
      return `eq(${operand(predicate.left)}, ${operand(predicate.right)})`
    case `not`:
      return `not(${describePredicate(predicate.arg)})`
    case `and`:
    case `or`:
      return `${predicate.kind}(${predicate.args.map(describePredicate).join(`, `)})`
  }
}

// ---------------------------------------------------------------------------
// Refinement check and calibration
// ---------------------------------------------------------------------------

describe(`WHERE predicate publication oracle`, () => {
  if (requestedReplayProperty === undefined) {
    it(`pinned snapshot histories distinguish Kleene logic from two-valued logic`, () => {
      // A checker that folds UNKNOWN into FALSE before NOT must disagree with
      // the model on each pinned snapshot, or the history does not calibrate.
      const twoValued = (predicate: Predicate, row: ModelRow): boolean => {
        switch (predicate.kind) {
          case `eq`:
            return (
              expectedEquality(
                operandValue(predicate.left, row),
                operandValue(predicate.right, row),
              ) === true
            )
          case `not`:
            return !twoValued(predicate.arg, row)
          case `and`:
            return predicate.args.every((arg) => twoValued(arg, row))
          case `or`:
            return predicate.args.some((arg) => twoValued(arg, row))
        }
      }
      for (const history of pinnedHistories) {
        if (history.kind !== `snapshot`) throw new Error(`expected a snapshot`)
        const rows = new Map(
          history.rows.map((seed, index): [string, ModelRow] => [
            `r${index}`,
            {
              ...syncedModelRow(`r${index}`, seed.v),
              $synced: !seed.optimistic,
              $origin: seed.optimistic ? `local` : `remote`,
            },
          ]),
        )
        const naive = [...rows.values()]
          .filter((row) => twoValued(history.predicate, row))
          .map((row) => row.id)
          .sort()
        expect(naive).not.toEqual(expectedVisible(history.predicate, rows))
      }
    })

    it(`Collection readiness reaches a filtered subscriber as one empty batch`, async () => {
      // `markReady` notifies subscribers of Collection readiness with an
      // empty batch. A subscriber
      // whose predicate no row can satisfy must still receive it.
      const collection = createCollection(
        mockSyncCollectionOptionsNoInitialState<Row>({
          id: `where-publication-ready-${collectionSerial++}`,
          getKey: (row) => row.id,
        }),
      )
      const batches: Array<number> = []
      const subscription = collection.subscribeChanges(
        (changes) => batches.push(changes.length),
        { whereExpression: irPredicate(fieldEq(`a`)) },
      )
      try {
        collection.utils.begin()
        collection.utils.commit()
        collection.utils.markReady()
        expect(batches).toEqual([0])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`a restarted source retracts a vanished row even when its first batch cannot match`, async () => {
      // Cleanup keeps the subscriber's published rows. The restarted eager
      // source's first publication must retract rows it no longer holds,
      // although no change in that batch satisfies the predicate. The check
      // runs before ready, whose empty batch would also reconcile them.
      let sourceRows: Array<Row> = [{ id: `r0`, v: `a` }]
      let markSourceReady = () => {}
      const collection = createCollection<Row>({
        id: `where-publication-restart-${collectionSerial++}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of sourceRows) write({ type: `insert`, value: row })
            commit()
            markSourceReady = markReady
          },
        },
      })
      const visible = new Set<string | number>()
      markSourceReady()
      await collection.stateWhenReady()
      const subscription = collection.subscribeChanges(
        recordVisibleKeys(visible),
        {
          includeInitialState: true,
          whereExpression: irPredicate(fieldEq(`a`)),
        },
      )
      try {
        expect([...visible]).toEqual([`r0`])
        sourceRows = [{ id: `r1`, v: `b` }]
        await collection.cleanup()
        collection.startSyncImmediate()
        expect([...visible]).toEqual([])
        markSourceReady()
        expect([...visible]).toEqual([])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    })

    for (const history of [
      ...pinnedHistories,
      pinnedPrefilteredSnapshot,
      ...pinnedChangeHistories,
    ]) {
      it(`publishes TRUE rows for ${history.kind} history ${describePredicate(history.predicate)}`, () =>
        runHistory(history))
    }

    fcTest.prop([historyArbitrary], {
      seed: 44_500_301,
      numRuns: oracleRuns(80),
    })(`publishes exactly the TRUE rows (fixed)`, runHistory)

    fcTest.prop([historyArbitrary], oraclePropertyOptions(80, property))(
      `publishes exactly the TRUE rows (random)`,
      runHistory,
    )
  } else if (requestedReplayProperty === property) {
    fcTest.prop([historyArbitrary], oraclePropertyOptions(80, property))(
      `publishes exactly the TRUE rows (replay)`,
      runHistory,
    )
  } else {
    it.skip(`runs only when its replay property is selected`, () => {})
  }
})
