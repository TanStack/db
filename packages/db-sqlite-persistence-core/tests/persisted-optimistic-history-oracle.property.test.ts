import {
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  checkOptimisticHistory,
  optimisticHistoryCalibrations,
  optimisticHistoryDriver,
  optimisticHistoryModel,
  optimisticHistoryReach,
  optimisticHistoryStates,
  resolveOptimisticHistory,
  wrappingSteps,
  wrappingSyncHistory,
} from '../../db/tests/optimistic-history-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleProperty } from '../../db/tests/oracle-property'
import { persistedCollectionOptions } from '../src'
import type { CollectionConfig } from '@tanstack/db'
import type {
  HistoryRow,
  OptimisticStep,
  WrappingSyncPath,
} from '../../db/tests/optimistic-history-oracle'
import type { PersistedTx, PersistenceAdapter } from '../src'

/**
 * # Persisted Collections keep the optimistic-history laws
 *
 * The optimistic-history oracle states which rows optimistic and sync
 * histories expose. Persistence is one production path for those laws: a
 * wrapping sync between the source and the Collection. This property runs the
 * oracle's model, check, and calibrations through `persistedCollectionOptions`
 * with an in-memory adapter, over the wrapping-sync grammar.
 *
 * The persisted wrapper stores source transactions one at a time. The
 * `hold-store` step holds the next stored source transaction; source
 * transactions committed after it reach the Collection only after
 * `release-store`. That is the model's `deferred` state. The two laws under
 * test are the oracle's own: an optimistic mutation is visible in the tick
 * that makes it, and a settled optimistic row stays over the synced rows while
 * a committed sync transaction for its key has not applied, deferred or not.
 *
 * `abort-deferred` aborts one deferred transaction's signal. It never applies:
 * the wrapper discards it when its turn comes, and every settled row it alone
 * held drops in that publication. The model fixes that drop at the turn; an
 * implementation that dropped the hold at abort time would also be legal, and
 * this wrapping-sync path would reject it.
 *
 * Reach: two constructed histories make the wrapping-sync path's own states required on every run. A
 * hold across a drain (`deferred-hold`) comes after a generated history, so
 * the hold meets whatever that history left; an abort that releases a held
 * row (`abort-release`) comes first and releases the store itself, because a
 * later settle could pick a transaction the generated part left active.
 *
 * Grammar limits: a handler cannot await acceptance while a hold is
 * outstanding, because acceptance follows the held durable step; the grammar
 * clears `awaitReceipt` there, and its unmapper admits only such histories.
 * The schema, partial-update, and reentrant grammars stay core-only. The adapter
 * is a Map, so SQLite timing and coordinator messages are outside this wrapping-sync path.
 */
function createHoldingAdapter() {
  const rows = new Map<string | number, HistoryRow>()
  let holdNext = false
  let release: (() => void) | undefined
  let latest = { term: 0, seq: 0, rowVersion: 0 }
  const adapter: PersistenceAdapter = {
    loadSubset: () =>
      Promise.resolve(
        Array.from(rows, ([key, value]) => ({ key, value: { ...value } })),
      ),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: latest.term,
        latestSeq: latest.seq,
        latestRowVersion: latest.rowVersion,
        resetEpoch: 0,
      }),
    loadCollectionMetadata: () => Promise.resolve([]),
    applyCommittedTx: async (_target, tx: PersistedTx) => {
      if (holdNext && (tx.truncate || tx.mutations.length > 0)) {
        holdNext = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...mutation.value,
          } as HistoryRow)
      }
      latest = { term: tx.term, seq: tx.seq, rowVersion: tx.rowVersion }
    },
    ensureIndex: () => Promise.resolve(),
  }
  return {
    adapter,
    rows,
    holdNextStore: () => {
      holdNext = true
    },
    releaseStore: () => {
      holdNext = false
      release?.()
      release = undefined
    },
  }
}

let productionPathRun = 0

function persistedProductionPath(): WrappingSyncPath & {
  rows: Map<string | number, HistoryRow>
} {
  const store = createHoldingAdapter()
  const id = `persisted-optimistic-history-${++productionPathRun}`
  return {
    db: {
      createCollection,
      createLiveQueryCollection,
      createTransaction,
      whenSyncAccepted,
    },
    rows: store.rows,
    wrap: (config) =>
      persistedCollectionOptions<HistoryRow, number>({
        ...(config as CollectionConfig<HistoryRow, number>),
        id,
        persistence: { adapter: store.adapter },
      }) as unknown as CollectionConfig<HistoryRow>,
    holdNextStore: store.holdNextStore,
    releaseStore: store.releaseStore,
    // The wrapper's turns are promise and timer continuations.
    settle: async () => {
      for (let turn = 0; turn < 10; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    },
  }
}

// A handler commits its server row and returns without awaiting acceptance;
// the source's acknowledgement came at commit. Each edit's fields are its
// whole server row, as the grammar's acknowledged edits are. The insert's stored row holds
// the store, so the update's server row is deferred when both settle.
const insertThenUpdateBehindHeldStore: Array<OptimisticStep> = [
  { type: `hold-store` },
  {
    type: `edit`,
    key: 1,
    fields: { a: 1, b: 0, c: 0 },
    optimistic: true,
    inHandler: {
      type: `sync`,
      rows: [{ id: 1, a: 1, b: 0, c: 0 }],
      truncate: false,
      copies: 1,
    },
  },
  {
    type: `edit`,
    key: 1,
    fields: { a: 2, b: 0, c: 0 },
    optimistic: true,
    inHandler: {
      type: `sync`,
      rows: [{ id: 1, a: 2, b: 0, c: 0 }],
      truncate: false,
      copies: 1,
    },
  },
  { type: `settle`, slot: 0, success: true, cascade: false },
  { type: `settle`, slot: 0, success: true, cascade: false },
  { type: `release-store` },
]

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

/** A wrapping history's generated body, without its settle-and-observe tail. */
const bodyOf = (history: { steps: Array<OptimisticStep> }) =>
  history.steps.slice(0, history.steps.length - wrappingSteps([]).length)
const row = (id: number, a: number): HistoryRow => ({ id, a, b: 0, c: 0 })

// A hold across a drain: the store holds a truncating source transaction, an
// optimistic edit commits its server row in its handler, and that row waits
// behind the held store when the tail settles.
const holdAcrossDrain: Array<OptimisticStep> = [
  { type: `hold-store` },
  { type: `close`, commit: false },
  {
    type: `sync`,
    rows: [
      { id: 3, a: 1, b: -2, c: 0 },
      { id: 1, a: -2, b: 1, c: 0 },
    ],
    deletes: [1, 3],
    truncate: true,
    copies: 1,
  },
  {
    type: `edit`,
    key: 3,
    fields: { a: 1 },
    optimistic: true,
    inHandler: undefined,
  },
  {
    type: `edit`,
    key: 1,
    fields: { a: 2, b: -1, c: 0 },
    optimistic: true,
    inHandler: {
      type: `sync`,
      rows: [{ id: 1, a: 2, b: -1, c: 0 }],
      truncate: false,
      copies: 1,
    },
  },
]

// An abort that releases a held row: the store holds key 2's source
// transaction, key 1's handler commits its server row behind it, the edit
// settles (its row is held by that deferred row), and aborting the deferred
// row releases the hold at its turn. The edit's value differs from the
// initial row 1, so the edit always changes the row.
const abortReleasingHold = (
  initial: Array<HistoryRow>,
): Array<OptimisticStep> => {
  const a = initial.find((entry) => entry.id === 1)?.a === 1 ? 2 : 1
  return [
    { type: `hold-store` },
    {
      type: `sync`,
      rows: [row(2, 1)],
      deletes: [],
      truncate: false,
      copies: 1,
    },
    {
      type: `edit`,
      key: 1,
      fields: { a, b: 0, c: 0 },
      optimistic: true,
      inHandler: {
        type: `sync`,
        rows: [row(1, a)],
        truncate: false,
        copies: 1,
      },
    },
    { type: `settle`, slot: 0, success: true, cascade: false },
    { type: `abort-deferred`, slot: 0 },
    { type: `release-store` },
  ]
}

declareOracle({
  owns: [`src/persisted.ts`],
  check: [checkOptimisticHistory],
  model: [optimisticHistoryModel],
})

oracleProperty({
  id: `sqlite-persistence.optimistic-history`,
  law: {
    statement: `A persisted Collection exposes the rows, publications, request outcomes, receipts, and tracked transactions that the optimistic-history model owes at every step, including while a durable store step is held and after a deferred source transaction aborts.`,
    authority: `packages/db/tests/optimistic-history-oracle.ts header (the optimistic and sync history contract, held rows behind a wrapping sync)`,
    limits: `An in-memory adapter, not SQLite timing or coordinator messages; no awaited acceptance during a hold; no schema, partial-update, or reentrant grammar.`,
  },
  histories: {
    arbitrary: wrappingSyncHistory,
    states: [`deferred-hold`, `abort-release`],
    measured: optimisticHistoryStates.filter(
      (state) => state !== `deferred-hold` && state !== `abort-release`,
    ),
    runs: 40,
    fixedSeeds: [22012],
    constructed: [
      {
        name: `a hold across a drain`,
        enters: [`deferred-hold`],
        build: (generated) => ({
          initial: generated.initial,
          steps: wrappingSteps([
            ...bodyOf(generated).slice(0, 24 - holdAcrossDrain.length),
            ...holdAcrossDrain,
          ]),
        }),
      },
      {
        name: `an abort that releases a held row`,
        enters: [`abort-release`],
        build: (generated) => ({
          initial: generated.initial,
          steps: wrappingSteps(
            [
              ...abortReleasingHold(generated.initial),
              ...bodyOf(generated),
            ].slice(0, 24),
          ),
        }),
      },
    ],
    fixed: [
      {
        // The same history with partial optimistic fields, written as core
        // edits whose handler batches do not await acceptance.
        name: `a partial insert and update stay over their server rows behind a held store`,
        history: {
          initial: [],
          steps: wrappingSteps(
            insertThenUpdateBehindHeldStore.map((step) =>
              step.type === `edit` && step.inHandler
                ? {
                    ...step,
                    fields: { a: step.fields.a },
                    inHandler: {
                      ...step.inHandler,
                      deletes: [],
                      awaitReceipt: false,
                    },
                  }
                : step,
            ),
          ),
        },
      },
      {
        name: `a settled update stays over its insert while the update's server row waits behind a held store`,
        history: {
          initial: [],
          steps: wrappingSteps(insertThenUpdateBehindHeldStore),
        },
      },
    ],
  },
  resolve: resolveOptimisticHistory,
  model: optimisticHistoryModel,
  reached: optimisticHistoryReach,
  // Each history gets its own adapter and Collection id.
  driver: (plan, observe) =>
    optimisticHistoryDriver({ wrapping: persistedProductionPath() })(
      plan,
      observe,
    ),
  check: checkOptimisticHistory,
  calibrations: optimisticHistoryCalibrations,
  timeout: 60_000,
})
