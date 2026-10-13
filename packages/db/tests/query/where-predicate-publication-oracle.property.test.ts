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
 * touches it. A live-query Collection publishes every TRUE row.
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
 * pending optimistic inserts and applies no sync transactions: the
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
 * Production driver: a `mockSyncCollectionOptions` Collection; a live-query
 * Collection built with the public `eq`/`not`/`and`/`or` builder functions;
 * direct `subscribeChanges` subscribers with and without `includeInitialState`
 * using the equivalent IR (a subscriber is the callback of one subscription); peer subscribers whose `eq` predicates share one field
 * with different literals, plus one on a virtual field, so published changes
 * must be routed to exactly the subscribers they can satisfy; and the public
 * `Collection.currentStateAsChanges` snapshot.
 *
 * Refinement check: live-query and subscriber key sets equal the model after
 * attachment and after each sync transaction commits. The generated history
 * checks a direct snapshot at attachment. Direct subscribers are reconstructed
 * from their callback batches. The fixed Date matrix checks direct snapshots
 * before and after its sync transaction. Two fixed
 * witnesses check boundaries outside the generated grammar: Collection
 * readiness reaches a filtered subscriber as one empty batch, and an eager
 * source restarted after cleanup retracts a vanished row even when its first
 * batch cannot satisfy the predicate. A third witness checks that a same-key
 * update which stays TRUE publishes its new row and exact subscriber payload.
 * A focused tagged-Date matrix checks native Dates from this and another
 * JavaScript realm. It compares direct snapshot, filtered subscriber, and live
 * query keys after preload and one sync transaction; an explicit BasicIndex
 * lookup checks the indexed equality key when an index is present. Fixed local
 * and foreign Date subclasses with inherited `getTime` join the same
 * timestamp classes. A forged object with a borrowed subclass prototype does
 * not join a Date class. A separate unindexed public query checks the local
 * borrowed-prototype case against Date inequality and object identity,
 * including the zero timestamp class.
 *
 * Captured-list law: a caller-owned array passed to `inArray` remains live
 * input. Editing that array alone does not publish. At the next delivered
 * source event, the entire retained result, including untouched rows, uses
 * its current members. The fixed model starts with authored source rows and
 * filters them against the list at that checkpoint; it does not reuse the
 * compiled predicate, source index, or emitted delta. The direct Collection
 * snapshot, retained live query, ordered limit, on-demand source, join,
 * filtered QueryRef, and correlated include witnesses compare public results
 * with that model. On-demand ordered, joined, and include receivers check that
 * the first acquisition is unfiltered when the captured list is mutable. An
 * unbounded ordered receiver also requires no source order hint, checks local
 * order after unsorted delivery, and checks readiness when its full-source
 * request settles while the source is loading.
 * An Effect receiver checks that the same acquisition rule reaches its source.
 * The retained direct query also checks that a list edit alone preserves the
 * old public snapshot and sends no callback, including after a microtask turn.
 * At the next source transaction, one subscriber callback contains the
 * complete insert/delete batch and reads the new whole result. It checks no
 * duplicate event when the list did not change. Separate fixed
 * Date and byte-item cases change contents inside the captured list, then
 * check the next source event. An ordered limit witness deletes a source row
 * outside the old loaded prefix after a list edit; it requires the newly
 * matching row to appear, so ordered acquisition must retain all source rows
 * while this live list is captured. Joined and included on-demand sources use
 * an unrelated source delete to prove that keyed lazy demand cannot hide the
 * event. A 40-row work witness requires an unchanged
 * list to inspect fewer than ten list slots and a changed list to revisit
 * retained candidates; a constant-key all-row rescan fails the first bound.
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
 * Known omissions: the generated WHERE grammar still covers `eq`, `not`,
 * `and`, and `or`, not other comparison operators, `like`, or arbitrary
 * `inArray` histories. The fixed captured-list witnesses cover the named
 * scalar, Date, byte, ordered (including unseen deletion), on-demand, joined,
 * QueryRef, and include cuts;
 * they do not establish those paths for all list values, source schedules,
 * optimizers, or real providers. Temporal operands, general join and ordering
 * laws, optimistic updates and deletes, truncate, and failed replay remain
 * with their structural comparison, cold-join, ordered, and subscription
 * replay owners.
 * Generated cleanup and restart histories for filtered subscribers remain
 * open; the lifecycle publication owner needs a predicate dimension to reach
 * them. The mock sync source is a controlled provider; this oracle claims only
 * how the Collection filters and routes the sync transactions it supplies.
 * The tagged-Date matrix covers native `node:vm` Dates with ordinary Date
 * prototypes, including own display tags, and fixed local and foreign Date
 * subclasses with inherited `getTime`. It excludes proxies, prototype swaps,
 * replaced `getTime` methods, other hosts, and generated subclass histories.
 * The local borrowed-prototype query uses one row and observes keys after
 * preload. It does not claim indexed publication for that forged object.
 * A pinned mixed-scalar history checks an indexed source after deleting and
 * replacing rows. Its WHERE result still follows `eq` truth; the index's
 * private order must not lose an equality member or interrupt publication.
 */
import { runInNewContext } from 'node:vm'
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import {
  and,
  eq,
  inArray,
  materialize,
  not,
  or,
} from '../../src/query/builder/functions.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createEffect } from '../../src/query/effect.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
  withOracleCleanup,
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
  false,
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

// This focused model starts from tags, not runtime Date classification. A
// native Date and a number with the same finite timestamp are equal. Invalid
// Dates and NaN occupy one equality class under the documented float rule.
// An own display tag or a subclass does not change a native Date's equality
// class. A borrowed prototype without the native Date slot matches no Date.
type DateEqualityTag =
  | {
      kind: `date`
      realm: `local` | `foreign`
      timestamp: number | `invalid`
      ownTag?: boolean
      subclass?: boolean
    }
  | { kind: `number`; value: number | `NaN` }

type TaggedDateRow = {
  id: string
  tag: DateEqualityTag | { kind: `forged` }
}

function dateEqualityClass(tag: DateEqualityTag): number | `unordered` {
  if (tag.kind === `date`) {
    return tag.timestamp === `invalid` ? `unordered` : tag.timestamp
  }
  return tag.value === `NaN` ? `unordered` : tag.value
}

function expectedTaggedDateKeys(
  rows: ReadonlyArray<TaggedDateRow>,
  literal: DateEqualityTag,
): Array<string> {
  const expectedClass = dateEqualityClass(literal)
  return rows
    .filter(
      (row) =>
        row.tag.kind !== `forged` &&
        dateEqualityClass(row.tag) === expectedClass,
    )
    .map((row) => row.id)
    .sort()
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
    .map(([v, reuse]): Operation =>
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
    // The default ordered index must keep distinct string and number rows
    // available to exact equality after a delete and two same-key updates.
    kind: `changes`,
    rows: [`b`, 1, `a`],
    predicate: fieldEq(`a`),
    transactions: [
      [{ type: `delete`, target: 0 }],
      [{ type: `update`, target: 0, v: `b` }],
      [{ type: `update`, target: 0, v: 2 }],
    ],
  },
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
    // A subscriber without initial state never saw the dropped `b` row.
    // Deleting it and reinserting its key with a matching value must publish
    // the new row, not treat it as a duplicate insert.
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

// The fixed realm grammar crosses the Date constructor's realm with equal,
// unequal, and invalid timestamps, plus foreign Dates with an own display tag.
// Fixed subclass rows and literals exercise inherited getTime on both sides of
// eq; the forged row controls against trusting only the borrowed prototype.
// Number literals test the Date/number and invalid-Date/NaN equality classes.
// A later sync transaction moves four rows between those classes.
const taggedDateRows: ReadonlyArray<TaggedDateRow> = [
  { id: `local-one`, tag: { kind: `date`, realm: `local`, timestamp: 1 } },
  { id: `foreign-one`, tag: { kind: `date`, realm: `foreign`, timestamp: 1 } },
  {
    id: `foreign-tagged-one`,
    tag: { kind: `date`, realm: `foreign`, timestamp: 1, ownTag: true },
  },
  { id: `foreign-two`, tag: { kind: `date`, realm: `foreign`, timestamp: 2 } },
  {
    id: `local-invalid`,
    tag: { kind: `date`, realm: `local`, timestamp: `invalid` },
  },
  {
    id: `foreign-invalid`,
    tag: { kind: `date`, realm: `foreign`, timestamp: `invalid` },
  },
  {
    id: `foreign-tagged-invalid`,
    tag: { kind: `date`, realm: `foreign`, timestamp: `invalid`, ownTag: true },
  },
  { id: `number-one`, tag: { kind: `number`, value: 1 } },
  { id: `number-nan`, tag: { kind: `number`, value: `NaN` } },
  {
    id: `local-subclass-one`,
    tag: {
      kind: `date`,
      realm: `local`,
      timestamp: 1,
      subclass: true,
      ownTag: true,
    },
  },
  {
    id: `foreign-subclass-one`,
    tag: {
      kind: `date`,
      realm: `foreign`,
      timestamp: 1,
      subclass: true,
      ownTag: true,
    },
  },
  {
    id: `foreign-subclass-two`,
    tag: {
      kind: `date`,
      realm: `foreign`,
      timestamp: 2,
      subclass: true,
      ownTag: true,
    },
  },
  {
    id: `foreign-subclass-invalid`,
    tag: {
      kind: `date`,
      realm: `foreign`,
      timestamp: `invalid`,
      subclass: true,
      ownTag: true,
    },
  },
  { id: `borrowed-prototype-object`, tag: { kind: `forged` } },
]

const taggedDateLiterals: ReadonlyArray<DateEqualityTag> = [
  { kind: `date`, realm: `local`, timestamp: 1 },
  { kind: `date`, realm: `foreign`, timestamp: 1 },
  { kind: `date`, realm: `foreign`, timestamp: 1, ownTag: true },
  { kind: `date`, realm: `foreign`, timestamp: 2 },
  { kind: `date`, realm: `local`, timestamp: `invalid` },
  { kind: `date`, realm: `foreign`, timestamp: `invalid` },
  { kind: `date`, realm: `foreign`, timestamp: `invalid`, ownTag: true },
  { kind: `number`, value: 1 },
  { kind: `number`, value: `NaN` },
  {
    kind: `date`,
    realm: `local`,
    timestamp: 1,
    subclass: true,
    ownTag: true,
  },
  {
    kind: `date`,
    realm: `foreign`,
    timestamp: 1,
    subclass: true,
    ownTag: true,
  },
  {
    kind: `date`,
    realm: `foreign`,
    timestamp: `invalid`,
    subclass: true,
    ownTag: true,
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

function runtimeTaggedDateValue(
  tag: TaggedDateRow[`tag`],
): Date | number | object {
  if (tag.kind === `forged`) {
    const foreignSubclass = runInNewContext(
      `class D extends Date {}; new D(1)`,
    ) as Date
    const forged = Object.create(
      Object.getPrototypeOf(foreignSubclass),
    ) as object
    Object.defineProperty(forged, Symbol.toStringTag, { value: `Other` })
    return forged
  }
  if (tag.kind === `number`) {
    return tag.value === `NaN` ? Number.NaN : tag.value
  }
  const timestamp = tag.timestamp === `invalid` ? Number.NaN : tag.timestamp
  class LocalDate extends Date {}
  const date =
    tag.realm === `foreign`
      ? (runInNewContext(
          tag.subclass
            ? `class D extends Date {}; new D(timestamp)`
            : `new Date(timestamp)`,
          { timestamp },
        ) as Date)
      : tag.subclass
        ? new LocalDate(timestamp)
        : new Date(timestamp)
  if (tag.ownTag) {
    Object.defineProperty(date, Symbol.toStringTag, { value: `Other` })
  }
  return date
}

type TaggedValueRow = { id: string; v: Date | number | object }

// The tag model predicts keys before the runtime values are constructed. The
// driver observes the public live query, filtered subscription, and direct
// Collection snapshot after preload and after a committed source transaction.
// The explicit index lookup checks the physical equality key at both cuts.
async function observeTaggedDateEquality(
  literal: DateEqualityTag,
  indexed: boolean,
): Promise<void> {
  const rows = taggedDateRows.map((row) => ({ ...row }))
  const literalValue = runtimeTaggedDateValue(literal)
  const collection = createCollection(
    mockSyncCollectionOptions<TaggedValueRow>({
      id: `where-publication-date-${collectionSerial++}`,
      getKey: (row) => row.id,
      autoIndex: `off`,
      initialData: rows.map((row) => ({
        id: row.id,
        v: runtimeTaggedDateValue(row.tag),
      })),
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q.from({ row: collection }).where(({ row }) => eq(row.v, literalValue)),
  )
  const predicate = new Func(`eq`, [
    new PropRef([`v`]),
    new Value(literalValue),
  ])
  const visible = new Set<string | number>()
  let subscription: { unsubscribe: () => void } | undefined

  await withOracleCleanup(async () => {
    await collection.stateWhenReady()
    const index = indexed
      ? collection.createIndex((row) => row.v, { indexType: BasicIndex })
      : undefined
    await live.preload()
    subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else visible.add(change.key)
        }
      },
      { includeInitialState: true, whereExpression: predicate },
    )

    const check = (checkpoint: string) => {
      const expected = expectedTaggedDateKeys(rows, literal)
      const label = `${checkpoint}, ${indexed ? `indexed` : `unindexed`}, ${JSON.stringify(literal)}`
      expect(
        [...live.keys()].map(String).sort(),
        `${label}: live query`,
      ).toEqual(expected)
      expect(
        [...visible].map(String).sort(),
        `${label}: filtered subscriber`,
      ).toEqual(expected)
      const snapshot = collection.currentStateAsChanges({ where: predicate })
      expect(
        snapshot?.map((change) => String(change.key)).sort(),
        `${label}: direct snapshot`,
      ).toEqual(expected)
      if (index) {
        expect(
          [...index.lookup(`eq`, literalValue)].map(String).sort(),
          `${label}: BasicIndex equality lookup`,
        ).toEqual(expected)
        const optimized = collection.currentStateAsChanges({
          where: predicate,
          optimizedOnly: true,
        })
        expect(
          optimized?.map((change) => String(change.key)).sort(),
          `${label}: optimized public snapshot`,
        ).toEqual(expected)
      }
    }

    check(`after subscribe`)
    const transitions: ReadonlyArray<{ index: number; tag: DateEqualityTag }> =
      [
        {
          index: 0,
          tag: { kind: `date`, realm: `foreign`, timestamp: `invalid` },
        },
        {
          index: 3,
          tag: { kind: `date`, realm: `foreign`, timestamp: 1, ownTag: true },
        },
        { index: 4, tag: { kind: `date`, realm: `foreign`, timestamp: 2 } },
        {
          index: 10,
          tag: {
            kind: `date`,
            realm: `foreign`,
            timestamp: 2,
            subclass: true,
            ownTag: true,
          },
        },
      ]
    collection.utils.begin()
    for (const transition of transitions) {
      collection.utils.write({
        type: `update`,
        value: {
          id: rows[transition.index]!.id,
          v: runtimeTaggedDateValue(transition.tag),
        },
      })
    }
    collection.utils.commit()
    for (const transition of transitions) {
      rows[transition.index] = {
        id: rows[transition.index]!.id,
        tag: transition.tag,
      }
    }
    check(`after transaction`)
  }, [
    () => subscription?.unsubscribe(),
    () => live.cleanup(),
    () => collection.cleanup(),
  ])
}

type Consumer =
  | `live query`
  | `subscriber with initial state`
  | `subscriber without initial state`
  | `direct snapshot`
  | `peer ${string}`

// Peers share one field with different literals, plus one on a second field,
// so each change must reach exactly the peers whose predicate it can satisfy.
const peerPredicates: ReadonlyArray<Predicate> = [
  ...[`a`, `b`, PREFIXED, true, false].map(fieldEq),
  {
    kind: `eq`,
    left: { kind: `virtual`, name: `$synced` },
    right: { kind: `literal`, value: true },
  },
]

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
    predicate: Predicate = history.predicate,
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
        predicate,
        modelRows,
        consumer === `subscriber without initial state` ? touched : undefined,
      ),
    })
  }
  const peers = peerPredicates.map((predicate) => ({
    predicate,
    visible: new Set<string | number>(),
  }))
  const recordSubscribers = (checkpoint: string) => {
    record(checkpoint, `live query`, live.keys())
    record(checkpoint, `subscriber with initial state`, withInitial)
    record(checkpoint, `subscriber without initial state`, withoutInitial)
    for (const peer of peers) {
      record(
        checkpoint,
        `peer ${describePredicate(peer.predicate)}`,
        peer.visible,
        peer.predicate,
      )
    }
  }

  const subscriptions: Array<{ unsubscribe: () => void }> = []
  await withOracleCleanup(async () => {
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
      ...peers.map((peer) =>
        collection.subscribeChanges(recordVisibleKeys(peer.visible), {
          includeInitialState: true,
          whereExpression: irPredicate(peer.predicate),
        }),
      ),
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
  }, [
    () => {
      for (const subscription of subscriptions) subscription.unsubscribe()
    },
    () => live.cleanup(),
    () => collection.cleanup(),
  ])
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
      await withOracleCleanup(() => {
        collection.utils.begin()
        collection.utils.commit()
        collection.utils.markReady()
        expect(batches).toEqual([0])
      }, [() => subscription.unsubscribe(), () => collection.cleanup()])
    })

    it(`publishes the new payload for a same-key update that stays TRUE`, async () => {
      type PayloadRow = { id: string; v: string; n: number }
      const collection = createCollection(
        mockSyncCollectionOptions<PayloadRow>({
          id: `where-publication-payload-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [{ id: `r0`, v: `a`, n: 1 }],
        }),
      )
      const live = createLiveQueryCollection((q) =>
        q.from({ row: collection }).where(({ row }) => eq(row.v, `a`)),
      )
      const events: Array<{
        type: string
        key: string | number
        n: number
        previousN: number | undefined
      }> = []
      await collection.stateWhenReady()
      await live.preload()
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            events.push({
              type: change.type,
              key: change.key,
              n: change.value.n,
              previousN: change.previousValue?.n,
            })
          }
        },
        {
          includeInitialState: true,
          whereExpression: irPredicate(fieldEq(`a`)),
        },
      )
      await withOracleCleanup(() => {
        events.length = 0
        expect(live.get(`r0`)?.n).toBe(1)
        collection.utils.begin()
        collection.utils.write({
          type: `update`,
          value: { id: `r0`, v: `a`, n: 2 },
        })
        collection.utils.commit()
        expect(live.get(`r0`)?.n).toBe(2)
        expect(events).toEqual([
          { type: `update`, key: `r0`, n: 2, previousN: 1 },
        ])
      }, [
        () => subscription.unsubscribe(),
        () => live.cleanup(),
        () => collection.cleanup(),
      ])
    })

    it(`direct snapshots read current inArray members after a source update`, async () => {
      type MembershipRow = { id: string; v: number; revision: number }
      const source = createCollection(
        mockSyncCollectionOptions<MembershipRow>({
          id: `where-publication-snapshot-in-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `one`, v: 1, revision: 0 },
            { id: `two`, v: 2, revision: 0 },
          ],
        }),
      )
      const members = [1]
      const where = inArray(new PropRef([`v`]), members)
      await withOracleCleanup(async () => {
        await source.stateWhenReady()
        const expected = (rows: ReadonlyArray<MembershipRow>) =>
          rows.filter((row) => members.includes(row.v)).map((row) => row.id)
        const initialRows = [
          { id: `one`, v: 1, revision: 0 },
          { id: `two`, v: 2, revision: 0 },
        ]
        const snapshotKeys = () =>
          source
            .currentStateAsChanges({ where })
            ?.map((change) => change.key)
            .sort()
        expect(snapshotKeys()).toEqual(expected(initialRows))

        members[0] = 2
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `one`, v: 1, revision: 1 },
        })
        source.utils.write({
          type: `update`,
          value: { id: `two`, v: 2, revision: 1 },
        })
        source.utils.commit()
        expect(snapshotKeys()).toEqual(
          expected(initialRows.map((row) => ({ ...row, revision: 1 }))),
        )
      }, [() => source.cleanup()])
    })

    it(`a source event refreshes untouched rows after a captured inArray list changes`, async () => {
      type MembershipRow = { id: string; v: number; revision: number }
      const source = createCollection(
        mockSyncCollectionOptions<MembershipRow>({
          id: `where-publication-live-in-${collectionSerial++}`,
          getKey: (row) => row.id,
          autoIndex: `off`,
          initialData: [
            { id: `one`, v: 1, revision: 0 },
            { id: `two`, v: 2, revision: 0 },
            { id: `trigger`, v: 3, revision: 0 },
          ],
        }),
      )
      const members = [1]
      const modelRows = [
        { id: `one`, v: 1 },
        { id: `two`, v: 2 },
        { id: `trigger`, v: 3 },
      ]
      const live = createLiveQueryCollection((q) =>
        q.from({ row: source }).where(({ row }) => inArray(row.v, members)),
      )
      // Retain callback boundaries and read the Collection while each callback
      // runs. Flattening changes would accept two partial publications with the
      // right eventual keys, even though one source transaction owes one
      // coherent public result.
      const batches: Array<{
        changes: Array<{ type: string; key: string }>
        visibleKeys: Array<string>
      }> = []
      let unsubscribe: (() => void) | undefined
      await withOracleCleanup(async () => {
        await live.preload()
        const subscription = live.subscribeChanges(
          (changes) => {
            batches.push({
              changes: changes
                .map((change) => ({
                  type: change.type,
                  key: String(change.key),
                }))
                .sort((left, right) => left.key.localeCompare(right.key)),
              visibleKeys: [...live.keys()].map(String).sort(),
            })
          },
          { includeInitialState: false },
        )
        unsubscribe = () => subscription.unsubscribe()
        const expected = () =>
          modelRows
            .filter((row) => members.includes(row.v))
            .map((row) => row.id)
            .sort()
        const check = () => expect([...live.keys()].sort()).toEqual(expected())
        check()
        expect(batches).toEqual([])

        members[0] = 2
        // A list edit is only an input change. The previous public snapshot
        // remains in place until a source event clocks the retained query.
        expect([...live.keys()].sort()).toEqual([`one`])
        expect(batches).toEqual([])
        await Promise.resolve()
        expect([...live.keys()].sort()).toEqual([`one`])
        expect(batches).toEqual([])
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `trigger`, v: 3, revision: 1 },
        })
        source.utils.commit()
        check()
        expect(batches).toEqual([
          {
            changes: [
              { type: `delete`, key: `one` },
              { type: `insert`, key: `two` },
            ],
            visibleKeys: [`two`],
          },
        ])
        batches.length = 0

        members.push(1)
        expect([...live.keys()].sort()).toEqual([`two`])
        expect(batches).toEqual([])
        await Promise.resolve()
        expect([...live.keys()].sort()).toEqual([`two`])
        expect(batches).toEqual([])
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `trigger`, v: 3, revision: 2 },
        })
        source.utils.commit()
        check()
        expect(batches).toEqual([
          {
            changes: [{ type: `insert`, key: `one` }],
            visibleKeys: [`one`, `two`],
          },
        ])
        batches.length = 0

        // A source update with no further list edit cannot republish the
        // unchanged result merely because the reduction revisits every row.
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `trigger`, v: 3, revision: 3 },
        })
        source.utils.commit()
        check()
        expect(batches).toEqual([])

        source.utils.begin()
        source.utils.write({ type: `delete`, key: `two` })
        source.utils.commit()
        modelRows.splice(
          modelRows.findIndex((row) => row.id === `two`),
          1,
        )
        check()
        expect(batches).toEqual([
          {
            changes: [{ type: `delete`, key: `two` }],
            visibleKeys: [`one`],
          },
        ])
      }, [() => unsubscribe?.(), () => live.cleanup(), () => source.cleanup()])
    })

    it(`a source event reads current Date and byte list-item contents`, async () => {
      type MembershipRow = {
        id: string
        date: Date
        bytes: Uint8Array
        revision: number
      }
      const source = createCollection(
        mockSyncCollectionOptions<MembershipRow>({
          id: `where-publication-mutable-items-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [1, 2, 3].map((value) => ({
            id: String(value),
            date: new Date(value),
            bytes: new Uint8Array([value]),
            revision: 0,
          })),
        }),
      )
      const dateMembers = [new Date(1)]
      const byteMembers = [new Uint8Array([1])]
      const dates = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => inArray(row.date, dateMembers)),
      )
      const bytes = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => inArray(row.bytes, byteMembers)),
      )
      await withOracleCleanup(async () => {
        await Promise.all([dates.preload(), bytes.preload()])
        expect([...dates.keys()]).toEqual([`1`])
        expect([...bytes.keys()]).toEqual([`1`])

        dateMembers[0]!.setTime(2)
        byteMembers[0]![0] = 2
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: {
            id: `3`,
            date: new Date(3),
            bytes: new Uint8Array([3]),
            revision: 1,
          },
        })
        source.utils.commit()
        expect([...dates.keys()]).toEqual([`2`])
        expect([...bytes.keys()]).toEqual([`2`])
      }, [() => dates.cleanup(), () => bytes.cleanup(), () => source.cleanup()])
    })

    it(`an ordered limit can admit an untouched row from a changed inArray list`, async () => {
      type MembershipRow = {
        id: string
        v: number
        rank: number
        revision: number
      }
      const source = createCollection(
        mockSyncCollectionOptions<MembershipRow>({
          id: `where-publication-ordered-in-${collectionSerial++}`,
          getKey: (row) => row.id,
          autoIndex: `eager`,
          initialData: [0, 1, 2, 3, 4].map((v) => ({
            id: String(v),
            v,
            rank: v,
            revision: 0,
          })),
        }),
      )
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => inArray(row.v, members))
          .orderBy(({ row }) => row.rank)
          .limit(1),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        const expected = () =>
          [0, 1, 2, 3, 4]
            .filter((value) => members.includes(value))
            .sort((left, right) => left - right)
            .slice(0, 1)
            .map(String)
        const check = () => expect([...live.keys()]).toEqual(expected())
        check()
        // The previously excluded row 0 is before the old top row. An
        // unfiltered ordered prefix must already hold it.
        members.push(0)
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `2`, v: 2, rank: 2, revision: 1 },
        })
        source.utils.commit()
        check()
        // Removing every prefix match requires the loader to continue until
        // it finds the next current member.
        members.splice(0, members.length, 4)
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `2`, v: 2, rank: 2, revision: 2 },
        })
        source.utils.commit()
        check()
      }, [() => live.cleanup(), () => source.cleanup()])
    })

    it(`an unseen ordered-source delete refreshes changed inArray members`, async () => {
      type MembershipRow = { id: string; v: number; rank: number }
      const source = createCollection(
        mockSyncCollectionOptions<MembershipRow>({
          id: `where-publication-unseen-ordered-delete-${collectionSerial++}`,
          getKey: (row) => row.id,
          autoIndex: `eager`,
          initialData: [0, 1, 2, 3, 4].map((v) => ({
            id: String(v),
            v,
            rank: v,
          })),
        }),
      )
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => inArray(row.v, members))
          .orderBy(({ row }) => row.rank)
          .limit(1),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        expect([...live.keys()]).toEqual([`1`])
        members[0] = 0
        // The deleted rank-4 row is outside the acquired prefix. The event
        // still clocks the complete result to the list's current membership.
        source.utils.begin()
        source.utils.write({ type: `delete`, key: `4` })
        source.utils.commit()
        expect([...live.keys()]).toEqual([`0`])
      }, [() => live.cleanup(), () => source.cleanup()])
    })

    it(`an ordered on-demand query requests the full source for a mutable inArray list`, async () => {
      type MembershipRow = { id: string; v: number; rank: number }
      const rows = [0, 1, 2, 3, 4].map((v) => ({
        id: String(v),
        v,
        rank: v,
      }))
      const requests: Array<{
        hasWhere: boolean
        hasOrder: boolean
        hasLimit: boolean
      }> = []
      let begin!: () => void
      let write!: (message: { type: `delete`; key: string }) => void
      let commit!: () => unknown
      const source = createCollection<MembershipRow>({
        id: `where-publication-ordered-demand-in-${collectionSerial++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BasicIndex,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            params.markReady()
            return {
              loadSubset: (options) => {
                requests.push({
                  hasWhere: options.where !== undefined,
                  hasOrder: options.orderBy !== undefined,
                  hasLimit: options.limit !== undefined,
                })
                params.begin()
                for (const row of rows) {
                  params.write({ type: `insert`, value: row })
                }
                params.commit()
                return true
              },
            }
          },
        },
      })
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => inArray(row.v, members))
          .orderBy(({ row }) => row.rank)
          .limit(1),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        expect(requests[0]).toEqual({
          hasWhere: false,
          hasOrder: false,
          hasLimit: false,
        })
        expect([...live.keys()]).toEqual([`1`])

        members[0] = 0
        begin()
        write({ type: `delete`, key: `4` })
        commit()
        expect([...live.keys()]).toEqual([`0`])
      }, [() => live.cleanup(), () => source.cleanup()])
    })

    it(`an unbounded ordered inArray query requests unsorted full source and readies at subset settlement`, async () => {
      type MembershipRow = { id: string; v: number; revision: number }
      const rows: Array<MembershipRow> = [
        { id: `a-two`, v: 2, revision: 0 },
        { id: `z-one`, v: 1, revision: 0 },
        { id: `trigger`, v: 3, revision: 0 },
      ]
      const requests: Array<{
        hasWhere: boolean
        hasOrder: boolean
        hasLimit: boolean
      }> = []
      let settleLoad!: () => void
      let begin!: () => void
      let write!: (message: { type: `update`; value: MembershipRow }) => void
      let commit!: () => unknown
      const source = createCollection<MembershipRow>({
        id: `where-publication-unbounded-ordered-demand-${collectionSerial++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            // This source deliberately stays loading. Its full-source subset
            // receipt, rather than source readiness, releases the live query.
            return {
              loadSubset: (options) => {
                requests.push({
                  hasWhere: options.where !== undefined,
                  hasOrder: options.orderBy !== undefined,
                  hasLimit: options.limit !== undefined,
                })
                if (
                  options.where !== undefined ||
                  options.orderBy !== undefined ||
                  options.limit !== undefined
                ) {
                  return Promise.reject(new Error(`full-source-only adapter`))
                }
                params.begin()
                for (const row of rows) {
                  params.write({ type: `insert`, value: row })
                }
                params.commit()
                return new Promise<void>((resolve) => {
                  settleLoad = resolve
                })
              },
            }
          },
        },
      })
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => inArray(row.v, members))
          .orderBy(({ row }) => row.v),
      )
      await withOracleCleanup(async () => {
        const preload = live.preload()
        let preloadSettled = false
        void preload.then(
          () => {
            preloadSettled = true
          },
          () => {
            preloadSettled = true
          },
        )
        void preload.catch(() => {})
        await Promise.resolve()
        expect(requests).toEqual([
          { hasWhere: false, hasOrder: false, hasLimit: false },
        ])
        expect(live.status).toBe(`loading`)

        // The independent model filters every retained source row against
        // the current list when an unrelated source update clocks the graph.
        members.splice(0, members.length, 2, 1)
        begin()
        write({ type: `update`, value: { id: `trigger`, v: 3, revision: 1 } })
        commit()
        await Promise.resolve()
        expect(live.status).toBe(`loading`)
        expect(source.status).toBe(`loading`)
        expect(preloadSettled).toBe(false)
        settleLoad()
        await preload
        expect(preloadSettled).toBe(true)
        expect(source.status).toBe(`loading`)
        expect(live.status).toBe(`ready`)
        expect([...live.keys()]).toEqual([`z-one`, `a-two`])
      }, [() => live.cleanup(), () => source.cleanup()])
    })

    it(`an Effect with captured inArray membership requests unsorted full source`, async () => {
      type MembershipRow = { id: string; v: number }
      const rows: Array<MembershipRow> = [
        { id: `one`, v: 1 },
        { id: `two`, v: 2 },
      ]
      const requests: Array<{
        hasWhere: boolean
        hasOrder: boolean
        hasLimit: boolean
      }> = []
      const source = createCollection<MembershipRow>({
        id: `where-publication-effect-demand-${collectionSerial++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            params.markReady()
            return {
              loadSubset: (options) => {
                requests.push({
                  hasWhere: options.where !== undefined,
                  hasOrder: options.orderBy !== undefined,
                  hasLimit: options.limit !== undefined,
                })
                params.begin()
                for (const row of rows) {
                  params.write({ type: `insert`, value: row })
                }
                params.commit()
                return true
              },
            }
          },
        },
      })
      const members = [2]
      const entered: Array<string> = []
      let effect: ReturnType<typeof createEffect> | undefined
      await withOracleCleanup(async () => {
        effect = createEffect<MembershipRow>({
          query: (q) =>
            q
              .from({ row: source })
              .where(({ row }) => inArray(row.v, members))
              .orderBy(({ row }) => row.v),
          onEnter: ({ value }) => {
            entered.push(value.id)
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(requests).toEqual([
          { hasWhere: false, hasOrder: false, hasLimit: false },
        ])
        expect(entered).toEqual([`two`])
      }, [() => effect?.dispose(), () => source.cleanup()])
    })

    it(`an on-demand query acquires rows for a captured inArray list's future members`, async () => {
      type MembershipRow = { id: string; v: number; revision: number }
      const rows: Array<MembershipRow> = [
        { id: `one`, v: 1, revision: 0 },
        { id: `two`, v: 2, revision: 0 },
        { id: `trigger`, v: 3, revision: 0 },
      ]
      let begin!: () => void
      let write!: (message: { type: `update`; value: MembershipRow }) => void
      let commit!: () => unknown
      const source = createCollection<MembershipRow>({
        id: `where-publication-demand-in-${collectionSerial++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            params.markReady()
            return {
              loadSubset: ({ where }) => {
                params.begin()
                for (const row of where ? rows.slice(0, 1) : rows) {
                  params.write({ type: `insert`, value: row })
                }
                params.commit()
                return true
              },
            }
          },
        },
      })
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q.from({ row: source }).where(({ row }) => inArray(row.v, members)),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        const expected = () =>
          rows.filter((row) => members.includes(row.v)).map((row) => row.id)
        const check = () => expect([...live.keys()].sort()).toEqual(expected())
        check()

        members[0] = 2
        begin()
        write({
          type: `update`,
          value: { id: `trigger`, v: 3, revision: 1 },
        })
        commit()
        check()
      }, [() => live.cleanup(), () => source.cleanup()])
    })

    it(`a source event with no joined-row delta refreshes a changed inArray list`, async () => {
      type MemberRow = {
        id: string
        v: number
        groupId: string
        revision: number
      }
      const rows = createCollection(
        mockSyncCollectionOptions<MemberRow>({
          id: `where-publication-join-in-rows-${collectionSerial++}`,
          getKey: (row) => row.id,
          autoIndex: `eager`,
          initialData: [
            { id: `one`, v: 1, groupId: `g`, revision: 0 },
            { id: `two`, v: 2, groupId: `g`, revision: 0 },
            { id: `trigger`, v: 3, groupId: `missing`, revision: 0 },
          ],
        }),
      )
      const groups = createCollection(
        mockSyncCollectionOptions<{ id: string; revision: number }>({
          id: `where-publication-join-in-groups-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `g`, revision: 0 },
            { id: `spare`, revision: 0 },
          ],
        }),
      )
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: rows })
          .innerJoin({ group: groups }, ({ row, group }) =>
            eq(row.groupId, group.id),
          )
          .where(({ row }) => inArray(row.v, members)),
      )
      const batches: Array<Array<{ type: string; id: string }>> = []
      let unsubscribe: (() => void) | undefined
      await withOracleCleanup(async () => {
        await live.preload()
        const subscription = live.subscribeChanges(
          (changes) =>
            batches.push(
              changes.map((change) => ({
                type: change.type,
                id: change.value.row.id,
              })),
            ),
          { includeInitialState: false },
        )
        unsubscribe = () => subscription.unsubscribe()
        const expected = () =>
          [
            { id: `one`, v: 1 },
            { id: `two`, v: 2 },
          ]
            .filter((row) => members.includes(row.v))
            .map((row) => row.id)
        const check = () =>
          expect(live.toArray.map((result) => result.row.id).sort()).toEqual(
            expected(),
          )
        check()

        members[0] = 2
        rows.utils.begin()
        rows.utils.write({
          type: `update`,
          value: { id: `trigger`, v: 3, groupId: `missing`, revision: 1 },
        })
        rows.utils.commit()
        check()
        expect(batches).toHaveLength(1)
        expect(batches[0]!.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
          { type: `delete`, id: `one` },
          { type: `insert`, id: `two` },
        ])
        batches.length = 0

        rows.utils.begin()
        rows.utils.write({
          type: `update`,
          value: { id: `trigger`, v: 3, groupId: `missing`, revision: 2 },
        })
        rows.utils.commit()
        check()
        expect(batches).toEqual([])

        // A pulse must also come from the joined source. The spare group has
        // no joined row, so this write cannot reach the WHERE through the
        // joined relation itself.
        members[0] = 1
        groups.utils.begin()
        groups.utils.write({
          type: `update`,
          value: { id: `spare`, revision: 1 },
        })
        groups.utils.commit()
        check()
        expect(batches).toHaveLength(1)
        expect(batches[0]!.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
          { type: `insert`, id: `one` },
          { type: `delete`, id: `two` },
        ])
      }, [
        () => unsubscribe?.(),
        () => live.cleanup(),
        () => rows.cleanup(),
        () => groups.cleanup(),
      ])
    })

    it(`a lazy joined source must deliver unrelated events to refresh inArray membership`, async () => {
      type MemberRow = { id: string; groupId: string; v: number }
      type GroupRow = { id: string; revision: number }
      const membersSource = createCollection(
        mockSyncCollectionOptions<MemberRow>({
          id: `where-publication-lazy-join-main-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `one`, groupId: `g`, v: 1 },
            { id: `two`, groupId: `g`, v: 2 },
          ],
        }),
      )
      const requests: Array<boolean> = []
      let begin!: () => void
      let write!: (message: { type: `delete`; key: string }) => void
      let commit!: () => unknown
      const groups = createCollection<GroupRow>({
        id: `where-publication-lazy-join-groups-${collectionSerial++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            params.begin()
            params.write({ type: `insert`, value: { id: `g`, revision: 0 } })
            params.write({ type: `insert`, value: { id: `h`, revision: 0 } })
            params.commit()
            params.markReady()
            return {
              loadSubset: ({ where }) => {
                requests.push(where !== undefined)
                return true
              },
            }
          },
        },
      })
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: membersSource })
          .leftJoin({ group: groups }, ({ row, group }) =>
            eq(row.groupId, group.id),
          )
          .where(({ row }) => inArray(row.v, members)),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        expect(requests[0]).toBe(false)
        const expected = () =>
          [
            { id: `one`, v: 1 },
            { id: `two`, v: 2 },
          ]
            .filter((row) => members.includes(row.v))
            .map((row) => row.id)
        const check = () =>
          expect(live.toArray.map((result) => result.row.id)).toEqual(
            expected(),
          )
        check()

        members[0] = 2
        begin()
        write({ type: `delete`, key: `h` })
        commit()
        check()
      }, [
        () => live.cleanup(),
        () => groups.cleanup(),
        () => membersSource.cleanup(),
      ])
    })

    it(`an outer QueryRef filter refreshes after an inner filter suppresses a source event`, async () => {
      type MembershipRow = {
        id: string
        v: number
        groupId: string
        revision: number
      }
      const source = createCollection(
        mockSyncCollectionOptions<MembershipRow>({
          id: `where-publication-queryref-in-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `one`, v: 1, groupId: `g`, revision: 0 },
            { id: `two`, v: 2, groupId: `g`, revision: 0 },
            { id: `trigger`, v: 3, groupId: `other`, revision: 0 },
          ],
        }),
      )
      const members = [1]
      const live = createLiveQueryCollection((q) => {
        const inner = q
          .from({ item: source })
          .where(({ item }) => eq(item.groupId, `g`))
          .select(({ item }) => ({ id: item.id, v: item.v }))
        return q
          .from({ row: inner })
          .where(({ row }) => inArray(row.v, members))
          .select(({ row }) => ({ id: row.id }))
      })
      await withOracleCleanup(async () => {
        await live.preload()
        const expected = () =>
          [
            { id: `one`, v: 1 },
            { id: `two`, v: 2 },
          ]
            .filter((row) => members.includes(row.v))
            .map((row) => row.id)
        const check = () =>
          expect(live.toArray.map((row) => row.id).sort()).toEqual(expected())
        check()
        members[0] = 2
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `trigger`, v: 3, groupId: `other`, revision: 1 },
        })
        source.utils.commit()
        check()
      }, [() => live.cleanup(), () => source.cleanup()])
    })

    it(`a correlated include reads current inArray members after an unrelated child event`, async () => {
      type ParentRow = { id: string; groupId: string }
      type ChildRow = {
        id: string
        groupId: string
        v: number
        revision: number
      }
      const parents = createCollection(
        mockSyncCollectionOptions<ParentRow>({
          id: `where-publication-include-parents-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [{ id: `parent`, groupId: `g` }],
        }),
      )
      const children = createCollection(
        mockSyncCollectionOptions<ChildRow>({
          id: `where-publication-include-children-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `one`, groupId: `g`, v: 1, revision: 0 },
            { id: `two`, groupId: `g`, v: 2, revision: 0 },
            { id: `trigger`, groupId: `other`, v: 3, revision: 0 },
          ],
        }),
      )
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents }).select(({ parent }) => ({
          id: parent.id,
          children: materialize(
            q
              .from({ child: children })
              .where(({ child }) =>
                and(
                  eq(child.groupId, parent.groupId),
                  inArray(child.v, members),
                ),
              )
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({ id: child.id })),
          ),
        })),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        const expected = () =>
          [
            { id: `one`, v: 1 },
            { id: `two`, v: 2 },
          ]
            .filter((row) => members.includes(row.v))
            .map((row) => row.id)
        const check = () =>
          expect(live.toArray[0]?.children.map((child) => child.id)).toEqual(
            expected(),
          )
        check()

        members[0] = 2
        children.utils.begin()
        children.utils.write({
          type: `update`,
          value: { id: `trigger`, groupId: `other`, v: 3, revision: 1 },
        })
        children.utils.commit()
        check()
      }, [
        () => live.cleanup(),
        () => children.cleanup(),
        () => parents.cleanup(),
      ])
    })

    it(`an on-demand include acquires unfiltered children for mutable inArray membership`, async () => {
      type ParentRow = { id: string; groupId: string }
      type ChildRow = { id: string; groupId: string; v: number }
      const parents = createCollection(
        mockSyncCollectionOptions<ParentRow>({
          id: `where-publication-demand-include-parents-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [{ id: `parent`, groupId: `g` }],
        }),
      )
      const requests: Array<boolean> = []
      let begin!: () => void
      let write!: (message: { type: `delete`; key: string }) => void
      let commit!: () => unknown
      const children = createCollection<ChildRow>({
        id: `where-publication-demand-include-children-${collectionSerial++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            params.begin()
            params.write({
              type: `insert`,
              value: { id: `one`, groupId: `g`, v: 1 },
            })
            params.write({
              type: `insert`,
              value: { id: `two`, groupId: `g`, v: 2 },
            })
            params.write({
              type: `insert`,
              value: { id: `spare`, groupId: `h`, v: 3 },
            })
            params.commit()
            params.markReady()
            return {
              loadSubset: ({ where }) => {
                requests.push(where !== undefined)
                return true
              },
            }
          },
        },
      })
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents }).select(({ parent }) => ({
          id: parent.id,
          children: materialize(
            q
              .from({ child: children })
              .where(({ child }) =>
                and(
                  eq(child.groupId, parent.groupId),
                  inArray(child.v, members),
                ),
              )
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({ id: child.id })),
          ),
        })),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        expect(requests[0]).toBe(false)
        const expected = () =>
          [
            { id: `one`, v: 1 },
            { id: `two`, v: 2 },
          ]
            .filter((row) => members.includes(row.v))
            .map((row) => row.id)
        const check = () =>
          expect(live.toArray[0]?.children.map((child) => child.id)).toEqual(
            expected(),
          )
        check()

        members[0] = 2
        begin()
        write({ type: `delete`, key: `spare` })
        commit()
        check()
      }, [
        () => live.cleanup(),
        () => children.cleanup(),
        () => parents.cleanup(),
      ])
    })

    it(`checks only changed rows until captured inArray members change`, async () => {
      type MembershipRow = { id: string; v: number; revision: number }
      let listReads = 0
      const row = (v: number, revision: number): MembershipRow => ({
        id: String(v),
        v,
        revision,
      })
      const source = createCollection(
        mockSyncCollectionOptions<MembershipRow>({
          id: `where-publication-in-work-${collectionSerial++}`,
          getKey: (item) => item.id,
          autoIndex: `off`,
          initialData: Array.from({ length: 40 }, (_, v) => row(v, 0)),
        }),
      )
      const members = new Proxy([1], {
        get(target, slotKey, receiver) {
          if (slotKey === `0`) listReads++
          return Reflect.get(target, slotKey, receiver)
        },
      })
      const live = createLiveQueryCollection((q) =>
        q.from({ item: source }).where(({ item }) => inArray(item.v, members)),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        expect([...live.keys()]).toEqual([`1`])

        listReads = 0
        source.utils.begin()
        source.utils.write({ type: `update`, value: row(39, 1) })
        source.utils.commit()
        expect([...live.keys()]).toEqual([`1`])
        expect(listReads).toBeLessThan(10)

        members[0] = 2
        listReads = 0
        source.utils.begin()
        source.utils.write({ type: `update`, value: row(39, 2) })
        source.utils.commit()
        expect([...live.keys()]).toEqual([`2`])
        expect(listReads).toBeGreaterThanOrEqual(40)
      }, [() => live.cleanup(), () => source.cleanup()])
    })

    it(`a pending optimistic delete hides a row from a prefiltered unindexed scan`, async () => {
      // The scan may read synced rows directly only when no optimistic state
      // changes visibility. A pending delete removes a synced row.
      const collection = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `where-publication-optimistic-delete-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, v: `a` },
            { id: `r1`, v: `a` },
            { id: `r2`, v: `b` },
          ],
        }),
      )
      const visible = new Set<string | number>()
      let subscription: { unsubscribe: () => void } | undefined
      await withOracleCleanup(async () => {
        await collection.stateWhenReady()
        // The adapter's onDelete awaits a sync acknowledgement that this test
        // never sends, so the delete stays pending.
        collection.delete(`r1`)
        subscription = collection.subscribeChanges(recordVisibleKeys(visible), {
          includeInitialState: true,
          whereExpression: irPredicate(fieldEq(`a`)),
        })
        const snapshot = collection.currentStateAsChanges({
          where: irPredicate(fieldEq(`a`)),
        })
        expect(snapshot?.map((change) => change.key)).toEqual([`r0`])
        expect([...visible]).toEqual([`r0`])
      }, [() => subscription?.unsubscribe(), () => collection.cleanup()])
    })

    it(`a layout-only publication reaches a filtered subscriber as one empty batch`, async () => {
      // An ordered live query whose rows move without changing their selected
      // values publishes no rows, only a layout change. Every subscriber still
      // learns that the layout changed, whatever its predicate.
      type RankedRow = { id: string; rank: number }
      const source = createCollection(
        mockSyncCollectionOptions<RankedRow>({
          id: `where-publication-layout-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, rank: 1 },
            { id: `r1`, rank: 2 },
          ],
        }),
      )
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .select(({ row }) => ({ id: row.id })),
      )
      const batches: Array<number> = []
      let subscription: { unsubscribe: () => void } | undefined
      await withOracleCleanup(async () => {
        await live.preload()
        subscription = live.subscribeChanges(
          (changes) => batches.push(changes.length),
          {
            whereExpression: new Func(`eq`, [
              new PropRef([`id`]),
              new Value(`missing`),
            ]),
          },
        )
        source.utils.begin()
        source.utils.write({ type: `update`, value: { id: `r0`, rank: 3 } })
        source.utils.commit()
        expect([...live.keys()]).toEqual([`r1`, `r0`])
        expect(batches).toEqual([0])
      }, [
        () => subscription?.unsubscribe(),
        () => live.cleanup(),
        () => source.cleanup(),
      ])
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
      await withOracleCleanup(async () => {
        expect([...visible]).toEqual([`r0`])
        sourceRows = [{ id: `r1`, v: `b` }]
        await collection.cleanup()
        collection.startSyncImmediate()
        expect([...visible]).toEqual([])
        markSourceReady()
        expect([...visible]).toEqual([])
      }, [() => subscription.unsubscribe(), () => collection.cleanup()])
    })

    it(`native Dates and subclasses publish by timestamp and invalid-Date equality`, async () => {
      const foreign = runtimeTaggedDateValue({
        kind: `date`,
        realm: `foreign`,
        timestamp: 1,
      })
      // This checks the host premise: a native Date can fail local instanceof.
      expect(foreign instanceof Date).toBe(false)
      expect(Date.prototype.getTime.call(foreign)).toBe(1)
      const foreignSubclass = runtimeTaggedDateValue({
        kind: `date`,
        realm: `foreign`,
        timestamp: 1,
        subclass: true,
        ownTag: true,
      })
      expect(Date.prototype.getTime.call(foreignSubclass)).toBe(1)
      expect(foreignSubclass instanceof Date).toBe(false)

      for (const indexed of [false, true]) {
        for (const literal of taggedDateLiterals) {
          await observeTaggedDateEquality(literal, indexed)
        }
      }
    })

    it(`keeps a forged local Date subclass prototype outside Date equality`, async () => {
      class LocalDate extends Date {}
      const forged = Object.create(LocalDate.prototype) as object
      // The native-slot check establishes that this is an ordinary object,
      // despite local instanceof reporting Date.
      expect(forged instanceof Date).toBe(true)
      expect(() => Date.prototype.getTime.call(forged)).toThrow(TypeError)
      let collectionCleanup: (() => unknown) | undefined
      let notDateCleanup: (() => unknown) | undefined
      let sameObjectCleanup: (() => unknown) | undefined
      let invalidDateCleanup: (() => unknown) | undefined
      let zeroDateCleanup: (() => unknown) | undefined
      let zeroNumberCleanup: (() => unknown) | undefined
      await withOracleCleanup(async () => {
        const collection = createCollection(
          mockSyncCollectionOptions<{ id: string; v: object }>({
            id: `where-publication-forged-date-${collectionSerial++}`,
            getKey: (row) => row.id,
            autoIndex: `off`,
            initialData: [{ id: `forged`, v: forged }],
          }),
        )
        collectionCleanup = () => collection.cleanup()
        const notDate = createLiveQueryCollection((q) =>
          q
            .from({ row: collection })
            .where(({ row }) => not(eq(row.v, new Date(1)))),
        )
        notDateCleanup = () => notDate.cleanup()
        const sameObject = createLiveQueryCollection((q) =>
          q.from({ row: collection }).where(({ row }) => eq(row.v, forged)),
        )
        sameObjectCleanup = () => sameObject.cleanup()
        const invalidDate = createLiveQueryCollection((q) =>
          q
            .from({ row: collection })
            .where(({ row }) => eq(row.v, new Date(Number.NaN))),
        )
        invalidDateCleanup = () => invalidDate.cleanup()
        const zeroDate = createLiveQueryCollection((q) =>
          q
            .from({ row: collection })
            .where(({ row }) => eq(row.v, new Date(0))),
        )
        zeroDateCleanup = () => zeroDate.cleanup()
        const zeroNumber = createLiveQueryCollection((q) =>
          q
            .from({ row: collection })
            .where(
              () => new Func(`eq`, [new PropRef([`row`, `v`]), new Value(0)]),
            ),
        )
        zeroNumberCleanup = () => zeroNumber.cleanup()
        await notDate.preload()
        // A distinct Date is unequal to this object. The same object remains
        // equal by identity at the public query publication checkpoint. It
        // also cannot join the invalid-Date/NaN equality class.
        expect([...notDate.keys()]).toEqual([`forged`])
        await sameObject.preload()
        expect([...sameObject.keys()]).toEqual([`forged`])
        await invalidDate.preload()
        expect([...invalidDate.keys()]).toEqual([])
        await zeroDate.preload()
        expect([...zeroDate.keys()]).toEqual([])
        await zeroNumber.preload()
        expect([...zeroNumber.keys()]).toEqual([])
      }, [
        () => notDateCleanup?.(),
        () => sameObjectCleanup?.(),
        () => invalidDateCleanup?.(),
        () => zeroDateCleanup?.(),
        () => zeroNumberCleanup?.(),
        () => collectionCleanup?.(),
      ])
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
