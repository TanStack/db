/**
 * # Which rows does a WHERE clause publish?
 *
 * Law and source: a WHERE clause keeps a row only when its predicate is TRUE
 * under SQL three-valued logic. The evaluator contract in
 * `src/query/compiler/evaluators.ts` states the operand rules: `eq` with a
 * null or undefined operand is UNKNOWN, `NaN` equals `NaN` (PostgreSQL float
 * semantics), and values of different types are unequal. `not`, `and`, and
 * `or` follow Kleene logic, so `not(UNKNOWN)` is UNKNOWN. Virtual row fields
 * (`$synced`, `$origin`, `$key`) are row fields for filtering; a pending
 * optimistic insert is `$synced: false` and `$origin: 'local'`, and a synced
 * row from this adapter is `$synced: true` and `$origin: 'remote'`.
 *
 * Why an example can miss the failure: a direct `eq` filter treats FALSE and
 * UNKNOWN alike, because both drop the row. The difference appears only under
 * `not`, and only for rows whose operand is nullish. A fast path that returns
 * FALSE for `eq('a', null)` passes every non-negated example.
 *
 * Model: `expectedTruth` is an independent Kleene evaluator over plain row
 * objects. It does not import production comparison, normalization, or
 * virtual-field helpers.
 *
 * History grammar: rows carry field `v` from a value domain of equal and
 * unequal strings, a string that begins with the internal normalization
 * prefix, booleans, a number, `NaN`, `null`, and a missing field. Some rows are
 * pending optimistic inserts. Predicates are `eq` leaves over `v`, a literal,
 * or a virtual field, composed with `not`, `and`, and `or` up to depth three.
 * After the initial snapshot, a history without pending optimistic rows
 * applies up to three synced updates that move `v` to any domain value,
 * including across the predicate boundary. A history with a pending optimistic
 * row applies no synced updates: the Collection holds synced commits while a
 * user transaction persists, and the optimistic-history oracle owns that law.
 * Each history runs with and without a `BasicIndex` on `v`.
 *
 * Production driver: a `mockSyncCollectionOptions` Collection, a live query
 * built with the public `eq`/`not`/`and`/`or` builder functions, and the public
 * `Collection.currentStateAsChanges({ where })` snapshot with the equivalent IR.
 *
 * Refinement check: the exact published key set equals the model at two
 * checkpoints: after `preload` resolves, for both the live query and the
 * direct snapshot, and after each synced update commits, for the live query.
 *
 * Calibration: the fixed histories include rows where Kleene and two-valued
 * logic disagree, and a checker test requires the two-valued answer to fail.
 * A production mutant that returned FALSE for `eq(string, null)` survived the
 * pre-existing oracle campaign and fails here.
 *
 * Known omissions: comparison operators other than `eq`, `in`, `like`, Date,
 * Temporal and binary operands, joins, ordering, and optimistic updates or
 * deletes are outside this owner. The structural comparison and cold-join
 * oracles own those value domains.
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
import { mockSyncCollectionOptions } from '../utils.js'
import type { BasicExpression } from '../../src/query/ir.js'

const property = `where-predicate.three-valued`
const requestedReplayProperty = readOracleRunConfig().replayProperty

// A string whose content equals an internal normalized-key prefix must still
// compare as an ordinary string.
const PREFIXED = `\u0000tanstack-db:string:a`
const MISSING = Symbol(`missing field`)

type FieldValue = string | boolean | number | null | typeof MISSING
type Row = { id: string; v?: unknown }
type Truth = boolean | null

const fieldValues: ReadonlyArray<FieldValue> = [
  `a`,
  `b`,
  PREFIXED,
  true,
  false,
  1,
  Number.NaN,
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
type Update = { row: number; v: FieldValue }
type History = {
  rows: Array<SeedRow>
  predicate: Predicate
  updates: Array<Update>
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

// SQL equality: nullish is UNKNOWN, NaN equals NaN, other values compare by
// type and value.
function expectedEquality(a: unknown, b: unknown): Truth {
  if (a === null || a === undefined || b === null || b === undefined) {
    return null
  }
  if (Number.isNaN(a) && Number.isNaN(b)) return true
  return typeof a === typeof b && a === b
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

function expectedKeys(
  predicate: Predicate,
  rows: ReadonlyArray<ModelRow>,
): Array<string> {
  return rows
    .filter((row) => expectedTruth(predicate, row) === true)
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
      .map((value) => ({ kind: `literal` as const, value })),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(`$synced` as const, `$origin` as const, `$key` as const)
      .map((name) => ({ kind: `virtual` as const, name })),
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

const historyArbitrary: fc.Arbitrary<History> = fc
  .array(fc.record({ v: fieldValueArbitrary, optimistic: fc.boolean() }), {
    minLength: 1,
    maxLength: 6,
  })
  .chain((rows) =>
    fc.record({
      rows: fc.constant(rows),
      predicate: predicateArbitrary,
      updates: rows.some((row) => row.optimistic)
        ? fc.constant([])
        : fc.array(
            fc.record({
              row: fc.nat({ max: rows.length - 1 }),
              v: fieldValueArbitrary,
            }),
            { maxLength: 3 },
          ),
    }),
  )

// Kleene and two-valued logic disagree on these pinned histories. The first
// is the negated nullish comparison that a FALSE-for-UNKNOWN fast path misses.
const pinnedHistories: ReadonlyArray<History> = [
  {
    rows: [
      { v: `a`, optimistic: false },
      { v: `b`, optimistic: false },
      { v: null, optimistic: false },
      { v: MISSING, optimistic: false },
    ],
    predicate: {
      kind: `not`,
      arg: {
        kind: `eq`,
        left: { kind: `field` },
        right: { kind: `literal`, value: `a` },
      },
    },
    updates: [
      { row: 1, v: null },
      { row: 2, v: `b` },
    ],
  },
  {
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
    updates: [],
  },
  {
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
        {
          kind: `not`,
          arg: {
            kind: `eq`,
            left: { kind: `field` },
            right: { kind: `literal`, value: PREFIXED },
          },
        },
        {
          kind: `not`,
          arg: {
            kind: `eq`,
            left: { kind: `field` },
            right: { kind: `literal`, value: Number.NaN },
          },
        },
      ],
    },
    updates: [{ row: 3, v: Number.NaN }],
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

type Observation = {
  checkpoint: string
  route: `live query` | `direct snapshot`
  keys: Array<string>
}

let collectionSerial = 0

async function observeHistory(
  history: History,
  indexed: boolean,
): Promise<{ observations: Array<Observation>; model: Array<Observation> }> {
  const seeds = history.rows.map((seed, index) => ({
    ...seed,
    id: `r${index}`,
  }))
  const collection = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `where-three-valued-${collectionSerial++}`,
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
  const modelRows: Array<ModelRow> = seeds.map((seed) => ({
    id: seed.id,
    v: seed.v,
    $synced: !seed.optimistic,
    $origin: seed.optimistic ? `local` : `remote`,
    $key: seed.id,
  }))
  const observations: Array<Observation> = []
  const model: Array<Observation> = []
  const record = (
    checkpoint: string,
    route: Observation[`route`],
    keys: Array<string | number>,
  ) => {
    observations.push({ checkpoint, route, keys: keys.map(String).sort() })
    model.push({
      checkpoint,
      route,
      keys: expectedKeys(history.predicate, modelRows),
    })
  }

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
    record(`after preload`, `live query`, [...live.keys()])
    record(
      `after preload`,
      `direct snapshot`,
      collection
        .currentStateAsChanges({ where: irPredicate(history.predicate) })
        .map((change) => change.key),
    )

    for (const [step, update] of history.updates.entries()) {
      const target = modelRows[update.row]!
      collection.utils.begin()
      // Synced updates merge fields, so a missing field is written as an
      // explicit undefined; both are UNKNOWN operands.
      collection.utils.write({
        type: `update`,
        value: {
          id: target.id,
          v: update.v === MISSING ? undefined : update.v,
        },
      })
      collection.utils.commit()
      target.v = update.v
      record(`after update ${step}`, `live query`, [...live.keys()])
    }
  } finally {
    await live.cleanup()
    await collection.cleanup()
  }
  return { observations, model }
}

async function runHistory(history: History): Promise<void> {
  if (
    history.updates.length > 0 &&
    history.rows.some((row) => row.optimistic)
  ) {
    throw new Error(
      `synced updates behind a pending optimistic row are outside this grammar`,
    )
  }
  for (const indexed of [false, true]) {
    const { observations, model } = await observeHistory(history, indexed)
    const route = `${indexed ? `indexed` : `scan`} route for ${describePredicate(history.predicate)}`
    const listObservations = (list: Array<Observation>) =>
      list.map((o) => `${o.checkpoint} ${o.route}: [${o.keys.join(`,`)}]`)
    expect(listObservations(observations), route).toEqual(
      listObservations(model),
    )
  }
}

function describeValue(value: FieldValue): string {
  if (value === MISSING) return `<missing>`
  if (typeof value === `string`) return JSON.stringify(value)
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

describe(`WHERE three-valued logic oracle`, () => {
  if (requestedReplayProperty === undefined) {
    it(`pinned histories distinguish Kleene logic from two-valued logic`, () => {
      // A checker that folds UNKNOWN into FALSE before NOT must disagree with
      // the model on each pinned history, or the history does not calibrate.
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
        const rows: Array<ModelRow> = history.rows.map((seed, index) => ({
          id: `r${index}`,
          v: seed.v,
          $synced: !seed.optimistic,
          $origin: seed.optimistic ? `local` : `remote`,
          $key: `r${index}`,
        }))
        const kleene = expectedKeys(history.predicate, rows)
        const naive = rows
          .filter((row) => twoValued(history.predicate, row))
          .map((row) => row.id)
          .sort()
        expect(naive).not.toEqual(kleene)
      }
    })

    for (const history of pinnedHistories) {
      it(`publishes TRUE rows for ${describePredicate(history.predicate)}`, () =>
        runHistory(history))
    }

    fcTest.prop([historyArbitrary], {
      seed: 44_500_301,
      numRuns: oracleRuns(60),
    })(`publishes exactly the TRUE rows (fixed)`, runHistory)

    fcTest.prop([historyArbitrary], oraclePropertyOptions(60, property))(
      `publishes exactly the TRUE rows (random)`,
      runHistory,
    )
  } else if (requestedReplayProperty === property) {
    fcTest.prop([historyArbitrary], oraclePropertyOptions(60, property))(
      `publishes exactly the TRUE rows (replay)`,
      runHistory,
    )
  } else {
    it.skip(`runs only when its replay property is selected`, () => {})
  }
})
