/**
 * # Which rows does a WHERE clause publish, and to which subscribers?
 *
 * Law and source: a WHERE clause keeps a row only when its predicate is TRUE
 * under SQL three-valued logic. The evaluator contract in
 * `src/query/compiler/evaluators.ts` states the operand rules: `eq` with a
 * null or undefined operand is UNKNOWN, `NaN` equals `NaN` (PostgreSQL float
 * semantics), a valid Date compares as its millisecond timestamp, and other
 * values of different types are unequal. `not`, `and`, and `or` follow Kleene
 * logic, so `not(UNKNOWN)` is UNKNOWN. Virtual row fields
 * (`$hasPendingWrites`, `$origin`, `$key`) are row fields for filtering; a
 * pending optimistic insert has `$hasPendingWrites: true` and local origin.
 * A settled source row has `$hasPendingWrites: false` and remote origin.
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
 * Refinement check: each consumer's exact key set equals the model after the
 * subscribers attach and after each sync transaction commits. Direct
 * subscribers are reconstructed from their callback batches. Fixed witnesses
 * for boundaries outside the generated grammar (Collection readiness, a
 * same-key update that stays TRUE, a pending optimistic delete, a layout-only
 * publication, and a restarted source) compare with written values, so they
 * are unit tests in where-predicate-publication.test.ts.
 *
 * Calibration: fixed histories separate Kleene from two-valued logic, and a
 * checker test requires the two-valued answer to fail. Production
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
 * them. The mock sync source is a controlled provider; this oracle claims only
 * how the Collection filters and routes the sync transactions it supplies.
 */
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { and, eq, not, or } from '../../src/query/builder/functions.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { oracleProperty } from '../oracle-config.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import {
  MISSING,
  fieldEq,
  irPredicate,
  recordVisibleKeys,
} from './where-predicate-support.js'
import {
  PREFIXED,
  equivalentFieldValues,
  expectedVisible,
  fixedChangeHistories,
  fixedHistories,
  fixedPrefilteredSnapshot,
  historyArbitrary,
  settledModelRow,
} from './where-predicate-publication-model-oracle.js'
import type {
  FieldValue,
  Operand,
  Predicate,
  Row,
} from './where-predicate-support.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type {
  History,
  ModelRow,
  SeedRow,
} from './where-predicate-publication-model-oracle.js'

const property = `where-predicate.publication`

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

function sourceRow(id: string, v: FieldValue): Row {
  return v === MISSING ? { id } : { id, v }
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
    left: { kind: `virtual`, name: `$hasPendingWrites` },
    right: { kind: `literal`, value: false },
  },
]

type Observation = {
  checkpoint: string
  consumer: Consumer
  keys: Array<string>
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
        ...settledModelRow(seed.id, seed.v),
        $hasPendingWrites: seed.optimistic,
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
            modelRows.set(id, settledModelRow(id, operation.v))
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
          modelRows.set(id, settledModelRow(id, operation.v))
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
    oracleAssertion(path, () =>
      expect(listObservations(observations), path).toEqual(
        listObservations(model),
      ),
    )
  }
}

// The check is `runHistory`: it runs each generated history with and without a
// BasicIndex, and compares every consumer's observed key set with the model's
// keys after each checkpoint. The model is `expectedTruth`, the Kleene
// evaluator, and `expectedVisible`, which adds the touched-row rule for a
// subscriber without initial state. The named and generated properties reach
// them; the witness tests in where-predicate-publication.test.ts do not. The
// model calibration, which runs no production, is in
// where-predicate-publication-model.test.ts. The model, grammar, and named
// histories live in where-predicate-publication-model-oracle.ts.

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

const namedFixedHistories = new Map(
  [...fixedHistories, fixedPrefilteredSnapshot, ...fixedChangeHistories].map(
    (history): [string, History] => [
      `publishes TRUE rows for ${history.kind} history ${describePredicate(history.predicate)}`,
      history,
    ],
  ),
)

describe(`WHERE predicate publication oracle`, () => {
  // The complete existing helper keeps its independent Kleene model and all
  // consumer comparisons. The adapter records data and retains assertion
  // diagnostics separately; setup and cleanup errors remain driver errors.
  oracleProperty({
    id: property,
    law: {
      statement: `Every filtered consumer publishes exactly the TRUE rows at each original comparison checkpoint.`,
      authority: `The SQL three-valued filtering and subscription contract stated at the start of this owner.`,
      limits: `The unchanged bounded predicate and source-transaction grammar, on scan and BasicIndex paths; cleanup and restart remain outside generated histories.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/basic-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
    ],
    histories: {
      arbitrary: historyArbitrary,
      runs: 80,
      fixedSeeds: [44_500_301],
      states: [],
      constructed: [],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: History }, observe) =>
      recordAssertionJudgment(property, plan, observe, () =>
        runHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  // The named histories hold `MISSING` and Date values, which the generated
  // grammar cannot take back and which are not enumerated history data. Each
  // is named by its old test name and replays through the same `runHistory`.
  oracleProperty({
    id: `where-predicate.publication-fixed`,
    law: {
      statement: `Every filtered consumer publishes exactly the TRUE rows at each original comparison checkpoint.`,
      authority: `The SQL three-valued filtering and subscription contract stated at the start of this owner.`,
      limits: `Named regressions that the generated predicate grammar cannot take back; each is replayed through the same driver and comparison.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/basic-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
    ],
    histories: [...namedFixedHistories.keys()],
    label: (name) => name,
    resolve: (name) => ({ history: namedFixedHistories.get(name)! }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: History }, observe) =>
      recordAssertionJudgment(property, plan, observe, () =>
        runHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })
})
