import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DuplicateKeySyncError } from '../src/errors.js'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleRuns,
} from './oracle-config.js'
import {
  historyRow,
  optimisticHistory,
  runOptimisticHistory,
} from './optimistic-history-oracle.js'
import type {
  RetainedRow,
  SyncActions,
} from './collection-state-retention-fixture.js'
import type { OptimisticStep } from './optimistic-history-oracle.js'
import type { Collection } from '../src/collection/index.js'

/**
 * Retained collection state is the last accepted source snapshot plus local
 * whole-row intent; restart changes ownership, not that value contract.
 *
 * A plain Map models source insert/update/delete and truncate-replace batches.
 * A separate lifecycle driver stops and restarts sync, including reentrant
 * commits before and after the old callback returns. The optimistic companion
 * model owns accepted local snapshots, rollback, and settlement. Neither model
 * borrows CollectionState's merge bookkeeping.
 *
 * The oracle compares retained source data, public rows, indexes, events, and
 * sync-run ownership after every cut. This makes stale-sync-run writes and rows
 * that vanish or reappear only after unrelated work observable. After a plain
 * restart, and while a reentrant restart's new transaction is still open, the
 * old run writes and commits a row. Cleanup ended that run, so the row never
 * appears and the commit returns `true`.
 */

type RetentionAction =
  | { type: `insert`; row: RetainedRow }
  | { type: `update`; row: RetainedRow }
  | { type: `delete`; key: number }
  | { type: `replace`; rows: ReadonlyArray<RetainedRow> }
  | { type: `restart` }
  | {
      type: `reentrantRestart`
      row: RetainedRow
      commitPhase: `insideListener` | `afterOldReturn`
    }

type RetentionHarness = {
  collection: Collection<RetainedRow, number>
  sync: SyncActions
}

const retainedRowArbitrary = fc.record({
  id: fc.integer({ min: 0, max: 3 }),
  value: fc.integer({ min: -2, max: 2 }),
})

function snapshotRetainedRow(row: RetainedRow): RetainedRow {
  return { id: row.id, value: row.value }
}

const retentionActionArbitrary: fc.Arbitrary<RetentionAction> = fc.oneof(
  {
    weight: 4,
    arbitrary: retainedRowArbitrary.map((row) => ({
      type: `insert` as const,
      row,
    })),
  },
  {
    weight: 4,
    arbitrary: retainedRowArbitrary.map((row) => ({
      type: `update` as const,
      row,
    })),
  },
  {
    weight: 4,
    arbitrary: fc
      .integer({ min: 0, max: 3 })
      .map((key) => ({ type: `delete` as const, key })),
  },
  {
    weight: 2,
    arbitrary: fc
      .uniqueArray(retainedRowArbitrary, {
        selector: (row) => row.id,
        maxLength: 4,
      })
      .map((rows) => ({ type: `replace` as const, rows })),
  },
  { weight: 1, arbitrary: fc.constant({ type: `restart` as const }) },
  {
    // Keep each phase at least as likely as the original unsplit restart arm.
    weight: 3,
    arbitrary: fc
      .tuple(
        retainedRowArbitrary,
        fc.constantFrom(`insideListener` as const, `afterOldReturn` as const),
      )
      .map(([row, commitPhase]) => ({
        type: `reentrantRestart` as const,
        row,
        commitPhase,
      })),
  },
)

function createRetentionHarness(): RetentionHarness {
  let sync!: SyncActions
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  return {
    collection,
    get sync() {
      return sync
    },
  }
}

function applyAction(
  action: RetentionAction,
  model: Map<number, RetainedRow>,
  sync: SyncActions,
): void {
  sync.begin()
  switch (action.type) {
    case `insert`: {
      const previous = model.get(action.row.id)
      if (previous !== undefined && previous.value !== action.row.value) {
        expect(() =>
          sync.write({
            type: `insert`,
            value: snapshotRetainedRow(action.row),
          }),
        ).toThrow(DuplicateKeySyncError)
        break
      }
      const expectedRow = snapshotRetainedRow(action.row)
      sync.write({ type: `insert`, value: snapshotRetainedRow(action.row) })
      model.set(expectedRow.id, expectedRow)
      break
    }
    case `update`: {
      const expectedRow = snapshotRetainedRow(action.row)
      sync.write({ type: action.type, value: snapshotRetainedRow(action.row) })
      model.set(expectedRow.id, expectedRow)
      break
    }
    case `delete`:
      sync.write({ type: `delete`, key: action.key })
      model.delete(action.key)
      break
    case `replace`:
      sync.truncate()
      model.clear()
      for (const row of action.rows) {
        const expectedRow = snapshotRetainedRow(row)
        sync.write({ type: `insert`, value: snapshotRetainedRow(row) })
        model.set(expectedRow.id, expectedRow)
      }
      break
    case `restart`:
    case `reentrantRestart`:
      throw new Error(`Restart actions require the lifecycle driver`)
  }
  expect(sync.commit()).toBe(true)
}

/**
 * Write and commit from a sync run that cleanup ended. Key 9 is outside the
 * generated keys, so a leaked write shows as an extra row.
 */
function writeFromEndedRun(sync: SyncActions): void {
  sync.begin()
  sync.write({ type: `insert`, value: { id: 9, value: 9 } })
  expect(sync.commit(), `stale sync run commit`).toBe(true)
}

function expectRetainedState(
  collection: Collection<RetainedRow, number>,
  model: ReadonlyMap<number, RetainedRow>,
): void {
  const expectedRows = [...model.entries()].sort(([a], [b]) => a - b)
  const retainedRows = [...collection.base.entries()].sort(([a], [b]) => a - b)

  expect(retainedRows).toEqual(expectedRows)
  expect(
    [...collection._state.rowOrigins.keys()]
      .filter((key) => !model.has(key))
      .sort((a, b) => a - b),
  ).toEqual([])
  expect(
    [...collection.state.entries()]
      .map(([key, row]) => [key, { id: row.id, value: row.value }] as const)
      .sort(([a], [b]) => a - b),
  ).toEqual(expectedRows)
}

declareOracle({ check: [expectRetainedState] })

async function runRetentionHistory(
  actions: ReadonlyArray<RetentionAction>,
): Promise<void> {
  const harness = createRetentionHarness()
  const { collection } = harness
  const model = new Map<number, RetainedRow>()
  let primaryFailure: unknown
  let failed = false
  let cleanupFailure: unknown
  let cleanupFailed = false
  try {
    expectRetainedState(collection, model)
    for (const action of actions) {
      if (action.type === `restart`) {
        const oldSync = harness.sync
        await collection.cleanup()
        collection.startSyncImmediate()
        model.clear()
        // Cleanup ended the old run, so its retained actions are inert. Its
        // commit returns `true`: the caller has nothing to wait for.
        writeFromEndedRun(oldSync)
      } else if (action.type === `reentrantRestart`) {
        const oldSync = harness.sync
        const triggerType = model.has(action.row.id) ? `update` : `insert`
        const triggerRow = {
          id: action.row.id,
          value: (model.get(action.row.id)?.value ?? action.row.value) + 1,
        }
        const expectedTriggerRow = snapshotRetainedRow(triggerRow)
        const restartedRow = {
          id: (action.row.id + 1) % 4,
          value: action.row.value + 1,
        }
        const expectedRestartedRow = snapshotRetainedRow(restartedRow)
        let cleanup: Promise<void> | undefined
        let restarted = false
        let restartedSync: SyncActions | undefined
        let restartedReceipt: true | Promise<void> | undefined
        const batches: Array<{
          changes: Array<{
            type: string
            key: string | number
            row: RetainedRow
            previousRow: RetainedRow | undefined
          }>
          rows: Array<RetainedRow>
        }> = []
        const subscription = collection.subscribeChanges(
          (changes) => {
            batches.push({
              changes: changes.map(({ type, key, value, previousValue }) => ({
                type,
                key,
                row: { id: value.id, value: value.value },
                previousRow:
                  previousValue === undefined
                    ? undefined
                    : {
                        id: previousValue.id,
                        value: previousValue.value,
                      },
              })),
              rows: [...collection.values()]
                .map(({ id, value }) => ({ id, value }))
                .sort((left, right) => left.id - right.id),
            })
            if (restarted) return
            restarted = true
            cleanup = collection.cleanup()
            collection.startSyncImmediate()
            restartedSync = harness.sync
            restartedSync.begin()
            restartedSync.write({
              type: `insert`,
              value: snapshotRetainedRow(restartedRow),
            })
            if (action.commitPhase === `insideListener`) {
              restartedReceipt = restartedSync.commit()
            }
          },
          { includeInitialState: false },
        )

        oldSync.begin()
        oldSync.write({
          type: `update`,
          value: snapshotRetainedRow(triggerRow),
        })
        expect(oldSync.commit()).toBe(true)
        expect(restarted).toBe(true)
        expect(restartedSync).toBeDefined()
        if (restartedSync === undefined) {
          throw new Error(`restarted sync run was not captured`)
        }
        if (action.commitPhase === `insideListener`) {
          expect(restartedReceipt).toBeDefined()
          if (restartedReceipt !== true) await restartedReceipt
        } else {
          // The new run's transaction is open here, so a stale write that
          // reached it would apply with the new run's commit.
          writeFromEndedRun(oldSync)
          expect(restartedSync.commit()).toBe(true)
        }
        const triggerRows = new Map(model)
        triggerRows.set(expectedTriggerRow.id, expectedTriggerRow)
        expect(batches).toEqual([
          {
            changes: [
              {
                type: triggerType,
                key: expectedTriggerRow.id,
                row: expectedTriggerRow,
                previousRow: model.get(expectedTriggerRow.id),
              },
            ],
            rows: [...triggerRows.values()].sort(
              (left, right) => left.id - right.id,
            ),
          },
          {
            // This subscriber observed the trigger, but did not request the
            // earlier initial state. Restart retracts its known old-sync-run row.
            changes: [
              {
                type: `delete`,
                key: expectedTriggerRow.id,
                row: expectedTriggerRow,
                previousRow: undefined,
              },
            ],
            rows: [],
          },
          {
            changes: [
              {
                type: `insert`,
                key: expectedRestartedRow.id,
                row: expectedRestartedRow,
                previousRow: undefined,
              },
            ],
            rows: [expectedRestartedRow],
          },
        ])
        subscription.unsubscribe()

        await cleanup
        model.clear()
        model.set(expectedRestartedRow.id, expectedRestartedRow)
      } else {
        applyAction(action, model, harness.sync)
      }
      expectRetainedState(collection, model)
    }
  } catch (error) {
    primaryFailure = error
    failed = true
  } finally {
    try {
      await collection.cleanup()
    } catch (error) {
      cleanupFailure = error
      cleanupFailed = true
    }
  }
  if (cleanupFailed) {
    if (failed)
      throw new AggregateError(
        [cleanupFailure],
        `Retention history and cleanup both failed`,
        { cause: primaryFailure },
      )
    throw cleanupFailure
  }
  if (failed) throw primaryFailure
}

it(`retains only keys in the authoritative synced state`, async () => {
  await runRetentionHistory([
    { type: `insert`, row: { id: 1, value: 1 } },
    { type: `insert`, row: { id: 2, value: 2 } },
    { type: `delete`, key: 1 },
    { type: `update`, row: { id: 1, value: -1 } },
    { type: `replace`, rows: [{ id: 3, value: 0 }] },
    { type: `delete`, key: 3 },
  ])
})

it(`retains a missing row introduced by a sync update`, async () => {
  await runRetentionHistory([{ type: `update`, row: { id: 1, value: 1 } }])
})

it.each(
  ([`insert`, `update`] as const).flatMap((triggerType) =>
    ([`insideListener`, `afterOldReturn`] as const).map(
      (commitPhase) => [triggerType, commitPhase] as const,
    ),
  ),
)(
  `retains an old-sync-run %s and a restarted row committed %s`,
  async (triggerType, commitPhase) => {
    await runRetentionHistory([
      ...(triggerType === `update`
        ? ([{ type: `insert`, row: { id: 1, value: 1 } }] as const)
        : []),
      {
        type: `reentrantRestart`,
        row: { id: 1, value: 1 },
        commitPhase,
      },
    ])
  },
)

it(`releases retained keys after long unique-key churn`, async () => {
  const keyCount = 1_000
  const actions: Array<RetentionAction> = []
  for (let key = 0; key < keyCount; key++) {
    actions.push({ type: `insert`, row: { id: key, value: key } })
    actions.push({ type: `delete`, key })
  }

  await runRetentionHistory(actions)
})

const retentionHistory = fc.array(retentionActionArbitrary, {
  minLength: 1,
  maxLength: 20,
})

fcTest.prop([retentionHistory], { numRuns: oracleRuns(100), seed: 1_902 })(
  `matches retained authoritative state with a fixed seed`,
  async (actions) => {
    await runRetentionHistory(actions)
  },
)
fcTest.prop(
  [retentionHistory],
  oraclePropertyOptions(100, `collection-state.retention`),
)(
  `matches retained authoritative state with a random or replayed seed`,
  async (actions) => {
    await runRetentionHistory(actions)
  },
)

// The partial-update lane reuses those histories and marks source batches
// partial from a separate stream, so the full-mode campaigns keep their
// seeded histories. It runs with the default `partial` row update mode.
const markPartial = (step: OptimisticStep, partial: boolean): OptimisticStep =>
  step.type === `sync`
    ? { ...step, partial }
    : (step.type === `edit` || step.type === `delete`) && step.inHandler
      ? { ...step, inHandler: { ...step.inHandler, partial } }
      : step
const partialHistory = fc
  .record({
    history: optimisticHistory,
    marks: fc.array(fc.boolean(), { minLength: 24, maxLength: 24 }),
  })
  .map(({ history, marks }) => ({
    initial: history.initial,
    steps: history.steps.map((step, index) => markPartial(step, marks[index]!)),
  }))

// These are replay programs for the same model and driver as randomized runs,
// not separate assertions that only know the reported final state.
it.each(
  [false, true].flatMap((acceptBeforeTruncate) =>
    [false, true].flatMap((replacementHasKey) =>
      [false, true].map((reinsert) => ({
        acceptBeforeTruncate,
        replacementHasKey,
        reinsert,
      })),
    ),
  ),
)(
  `drops a direct deletion at settlement across replacement and later sync: %j`,
  async ({ acceptBeforeTruncate, replacementHasKey, reinsert }) => {
    const row = { id: 1, a: 1, b: 2, c: 3 }
    const steps: Array<OptimisticStep> = [
      { type: `delete`, key: 1, optimistic: true },
      ...(acceptBeforeTruncate
        ? [{ type: `settle`, slot: 0, success: true, cascade: false } as const]
        : []),
      ...(reinsert
        ? [
            {
              type: `edit`,
              key: 1,
              fields: { a: 4 },
              optimistic: true,
            } as const,
          ]
        : []),
      {
        type: `sync`,
        rows: replacementHasKey ? [row] : [],
        truncate: true,
        copies: 1,
      },
      ...(!acceptBeforeTruncate
        ? [{ type: `settle`, slot: 0, success: true, cascade: false } as const]
        : []),
      ...(reinsert
        ? [{ type: `settle`, slot: 0, success: true, cascade: false } as const]
        : []),
      {
        type: `sync`,
        rows: [{ id: 2, a: 2, b: 2, c: 2 }],
        truncate: false,
        copies: 1,
      },
    ]
    const counts = await runOptimisticHistory([row], steps)
    expect(counts.deletes).toBe(1)
    expect(counts.settlements).toBe(reinsert ? 2 : 1)
  },
)

// Replays of review probes. A sync transaction still open when the mutation
// settles is not accepted, so it holds nothing and attributes nothing: after
// it commits or aborts, a later remote write is remote. A completed key that
// no queued sync touches stays remote while another key's sync is held.
it.each(
  [false, true].flatMap((optimistic) =>
    [false, true].map((commit) => ({ optimistic, commit })),
  ),
)(
  `attributes nothing to a sync transaction open at settlement: %j`,
  async ({ optimistic, commit }) => {
    const counts = await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 0 }],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic },
        {
          type: `open`,
          batch: {
            type: `sync`,
            rows: [{ id: 1, a: 2, b: 0, c: 0 }],
            truncate: false,
            copies: 1,
          },
        },
        { type: `settle`, slot: 0, success: true, cascade: false },
        { type: `close`, commit },
        {
          type: `sync`,
          rows: [{ id: 1, a: 3, b: 0, c: 0 }],
          truncate: false,
          copies: 1,
        },
      ],
    )
    expect(counts.openBatches).toBe(1)
    expect(counts.abortedBatches).toBe(Number(!commit))
  },
)
it(`keeps an unrelated completed key remote while another key's sync is held`, async () => {
  await runOptimisticHistory(
    [
      { id: 1, a: 0, b: 0, c: 0 },
      { id: 2, a: 0, b: 0, c: 0 },
    ],
    [
      { type: `edit`, key: 2, fields: { a: 2 }, optimistic: true },
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      {
        type: `sync`,
        rows: [{ id: 2, a: 5, b: 0, c: 0 }],
        truncate: false,
        copies: 1,
      },
      { type: `settle`, slot: 1, success: true, cascade: false },
      { type: `settle`, slot: 0, success: true, cascade: false },
      {
        type: `sync`,
        rows: [{ id: 1, a: 9, b: 0, c: 0 }],
        truncate: false,
        copies: 1,
      },
    ],
  )
})
// Replays of random-campaign counterexamples. A rollback while a sync
// transaction on its key is still open must publish the drop. When two
// completed transactions are held on one key, the newer one's row shows.
it(`publishes a rollback while a sync transaction on its key is open`, async () => {
  await runOptimisticHistory(
    [],
    [
      {
        type: `open`,
        batch: {
          type: `sync`,
          rows: [],
          deletes: [],
          truncate: false,
          copies: 1,
        },
      },
      { type: `edit`, key: 2, fields: { c: 0 }, optimistic: true },
      { type: `close`, commit: true },
      {
        type: `open`,
        batch: {
          type: `sync`,
          rows: [{ id: 2, a: 0, b: 0, c: 0 }],
          deletes: [],
          truncate: false,
          copies: 1,
        },
      },
      { type: `settle`, slot: 0, success: false, cascade: false },
      { type: `sync`, rows: [], deletes: [1], truncate: false, copies: 1 },
    ],
  )
})
it(`shows the newer of two held completed rows on one key`, async () => {
  await runOptimisticHistory(
    [],
    [
      {
        type: `edit`,
        key: 1,
        fields: { c: 0 },
        optimistic: true,
        inHandler: {
          type: `sync`,
          rows: [],
          deletes: [],
          truncate: false,
          copies: 1,
        },
      },
      {
        type: `delete`,
        key: 1,
        optimistic: false,
        inHandler: {
          type: `sync`,
          rows: [],
          deletes: [1],
          truncate: false,
          copies: 1,
        },
      },
      {
        type: `sync`,
        rows: [{ id: 1, a: 0, b: 0, c: 0 }],
        deletes: [1],
        truncate: false,
        copies: 1,
      },
      { type: `edit`, key: 1, fields: { c: 1 }, optimistic: true },
      { type: `settle`, slot: 2, success: true, cascade: false },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `delete`, key: 1, optimistic: false },
    ],
  )
})

// Replay of a random-campaign counterexample. A confirmed delete must clear the
// key's local attribution, so a later source reinsert is remote.
it(`attributes a source reinsert after a confirmed delete to the source`, async () => {
  const row = { id: 2, a: 0, b: 0, c: 0 }
  const counts = await runOptimisticHistory(
    [],
    [
      {
        type: `sync`,
        rows: [row],
        truncate: false,
        copies: 1,
      },
      {
        type: `delete`,
        key: 2,
        optimistic: false,
        inHandler: {
          type: `sync`,
          rows: [],
          deletes: [2],
          truncate: false,
          copies: 1,
        },
      },
      {
        type: `edit`,
        key: 1,
        fields: { b: 0 },
        optimistic: false,
        inHandler: {
          type: `sync`,
          rows: [row],
          truncate: false,
          copies: 1,
        },
      },
    ],
  )
  expect(counts.sourceDeletes).toBe(1)
})

it(`writes source inserts and deletes in the fixed campaign`, async () => {
  const histories = fc.sample(optimisticHistory, { seed: 86103, numRuns: 40 })
  let inserts = 0
  let deletes = 0
  let absentDeletes = 0
  for (const { initial, steps } of histories) {
    const counts = await runOptimisticHistory(initial, steps)
    inserts += counts.sourceInserts
    deletes += counts.sourceDeletes
    absentDeletes += counts.absentSourceDeletes
  }
  expect(inserts).toBeGreaterThan(0)
  expect(deletes).toBeGreaterThan(absentDeletes)
  expect(absentDeletes).toBeGreaterThan(0)
})

it(`writes distinguishing partial updates in the fixed partial campaign`, async () => {
  const histories = fc.sample(partialHistory, { seed: 86104, numRuns: 40 })
  let distinguishing = 0
  for (const { initial, steps } of histories) {
    const counts = await runOptimisticHistory(initial, steps, undefined, {
      partialUpdates: true,
    })
    distinguishing += counts.distinguishingPartialUpdates
  }
  expect(distinguishing).toBeGreaterThan(0)
})

// Pinned replays for a source delete of a key the source never held. The
// backend accepted an optimistic insert, then deleted the row before the
// source streamed it. The model's drain applies the delete to the applied
// synced rows, where it changes nothing, so the visible result follows from
// the settlement-drop law alone. The driver compares every step with the
// model; each count below proves the replay reached its premise.
function absentKeyDelete(truncate = false) {
  return {
    type: `sync` as const,
    rows: [],
    deletes: [1],
    truncate,
    copies: 1,
  }
}

// Committed while the insert persists, or inside its handler, the delete is
// queued. The settled insert's row is held with it, and the drop and the
// delete publish together, so the row is gone after settlement.
it.each([`while persisting`, `inside the handler`] as const)(
  `removes a settled insert in its drop publication when the source deletes a key it never held %s`,
  async (delivery) => {
    const inHandler = delivery === `inside the handler`
    const counts = await runOptimisticHistory(
      [{ id: 2, a: 0, b: 0, c: 0 }],
      [
        {
          type: `edit`,
          key: 1,
          fields: { a: 1 },
          optimistic: true,
          ...(inHandler ? { inHandler: absentKeyDelete() } : {}),
        },
        ...(inHandler ? [] : [absentKeyDelete()]),
        { type: `settle`, slot: 0, success: true, cascade: false },
      ],
    )
    expect(counts.absentSourceDeletes).toBe(1)
    expect(counts.queued).toBe(1)
    expect(counts.handlerBatches).toBe(inHandler ? 1 : 0)
  },
)

// Once the optimistic state has dropped, the key is absent from the visible
// rows, and the delete changes nothing a reader can see.
it(`leaves the visible rows unchanged when the source deletes a never-held key after the drop`, async () => {
  const counts = await runOptimisticHistory(
    [{ id: 2, a: 0, b: 0, c: 0 }],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      { type: `settle`, slot: 0, success: true, cascade: false },
      absentKeyDelete(),
    ],
  )
  expect(counts.absentSourceDeletes).toBe(1)
  expect(counts.queued).toBe(0)
})

// The nearby boundary: a persisting request keeps its optimistic row. A
// queued delete waits for settlement. A truncate that carries the delete
// applies at once, and the persisting insert overlays the replacement.
it.each([false, true])(
  `keeps a persisting insert's optimistic row when the source deletes a key it never held, truncate=%s`,
  async (truncate) => {
    const counts = await runOptimisticHistory(
      [{ id: 2, a: 0, b: 0, c: 0 }],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
        absentKeyDelete(truncate),
        { type: `settle`, slot: 0, success: true, cascade: false },
      ],
    )
    expect(counts.absentSourceDeletes).toBe(1)
    expect(truncate ? counts.snapshotOverrides : counts.queued).toBe(1)
  },
)

// A handler that confirms its own request through sync, before it returns,
// optionally awaiting the commit receipt. The batch waits for settlement and
// publishes together with the drop of the request's optimistic state.
it.each(
  [`insert`, `update`, `delete`].flatMap((kind) =>
    [false, true].map((awaitReceipt) => ({ kind, awaitReceipt })),
  ),
)(
  `publishes a request confirmed inside its own handler at settlement: %j`,
  async ({ kind, awaitReceipt }) => {
    const existing = { id: 1, a: 0, b: 0, c: 0 }
    const confirmed = { id: 1, a: 1, b: 1, c: 1 }
    const batch = {
      type: `sync`,
      rows: kind === `delete` ? [] : [confirmed],
      truncate: false,
      copies: 1,
      awaitReceipt,
    } as const
    const counts = await runOptimisticHistory(
      kind === `insert` ? [] : [existing],
      [
        kind === `delete`
          ? { type: `delete`, key: 1, optimistic: true, inHandler: batch }
          : {
              type: `edit`,
              key: 1,
              fields: { a: 1, b: 1, c: 1 },
              optimistic: true,
              inHandler: batch,
            },
        { type: `settle`, slot: 0, success: true, cascade: false },
        {
          type: `sync`,
          rows: [{ id: 1, a: 2, b: 2, c: 2 }],
          truncate: false,
          copies: 1,
        },
      ],
    )
    expect(counts.handlerBatches).toBe(1)
    expect(counts.awaitedReceipts).toBe(Number(awaitReceipt))
  },
)

const defaultHistory = (
  truncate: boolean,
  success: boolean,
): Array<OptimisticStep> => [
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  { type: `edit`, key: 1, fields: { b: 2 }, optimistic: true },
  { type: `settle`, slot: 1, success: true, cascade: false },
  { type: `sync`, rows: [], truncate, copies: 1 },
  { type: `settle`, slot: 0, success, cascade: false },
]
it.each(
  [false, true].flatMap((truncate) =>
    [false, true].map((success) => ({ truncate, success })),
  ),
)(
  `keeps validated defaults with authored fields until settlement: %j`,
  async ({ truncate, success }) => {
    for (const insertDefault of [3, 11])
      await runOptimisticHistory(
        [],
        defaultHistory(truncate, success),
        undefined,
        { insertDefault },
      )
  },
)
// A partial source update merges into the source row, not into an optimistic
// row. Here the source holds key 1 with c = 7. An optimistic delete and a
// re-insert that took the schema default for `c` both persist when the partial
// update arrives, so the update is held. When both settle, their optimistic
// state drops and the held update publishes with the drop. The row keeps
// c = 7, the source's merged value.
const partialOverPersistingDefault = (
  insertDefault: number,
): Array<OptimisticStep> => [
  { type: `delete`, key: 1, optimistic: true },
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  {
    type: `sync`,
    rows: [{ id: 1, a: 2, b: 2, c: insertDefault + 5 }],
    truncate: false,
    copies: 1,
    partial: true,
  },
  { type: `settle`, slot: 0, success: true, cascade: false },
  { type: `settle`, slot: 0, success: true, cascade: false },
]
it.each([3, 11])(
  `merges a held partial update into the source row under a persisting schema default (%i)`,
  async (insertDefault) => {
    const counts = await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 7 }],
      partialOverPersistingDefault(insertDefault),
      undefined,
      { insertDefault, partialUpdates: true },
    )
    expect(counts.distinguishingPartialUpdates).toBe(1)
    expect(counts.queued).toBe(1)
  },
)
it(`rejects a partial update applied as a full replacement`, async () => {
  const steps = partialOverPersistingDefault(3)
  await runOptimisticHistory([{ id: 1, a: 0, b: 0, c: 7 }], steps, undefined, {
    insertDefault: 3,
    partialUpdates: true,
  })
  await expect(
    runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 7 }],
      steps,
      `partial-as-full`,
      { insertDefault: 3, partialUpdates: true },
    ),
    // A row observation must reject the replaced row, not the mutant checkpoint.
  ).rejects.toThrow(
    /whole forward publication|: reads .* expected |rows visible when isPersisted settled/,
  )
})
it(`rejects a default lost only after settlement`, async () => {
  const steps = defaultHistory(true, true)
  await runOptimisticHistory([], steps, undefined, { insertDefault: 3 })
  await expect(
    runOptimisticHistory([], steps, `retained-default`, { insertDefault: 3 }),
  ).rejects.toMatchObject({ name: `AssertionError` })
})

const insertionPrefix: Array<OptimisticStep> = [
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  { type: `edit`, key: 1, fields: { b: 2 }, optimistic: true },
  { type: `settle`, slot: 1, success: true, cascade: false },
]
const acceptedSnapshotReplayProperty = {
  'before delete': `collection-state.accepted-snapshot.before-delete`,
  'during delete': `collection-state.accepted-snapshot.during-delete`,
  'after rollback': `collection-state.accepted-snapshot.after-rollback`,
} as const
it.each(
  ([`before delete`, `during delete`, `after rollback`] as const).flatMap(
    (timing) => [86105, undefined].map((seed) => ({ timing, seed })),
  ),
)(
  `drops a completed row at settlement around truncate $timing (seed $seed)`,
  async ({ timing, seed }) => {
    await fc.assert(
      fc.asyncProperty(historyRow, fc.boolean(), async (row, reject) => {
        const truncate: OptimisticStep = {
          type: `sync`,
          rows: [],
          truncate: true,
          copies: 1,
        }
        const counts = await runOptimisticHistory(
          [{ id: row.id, a: 9, b: 9, c: 9 }],
          [
            {
              type: `edit`,
              key: row.id,
              fields: { a: row.a, b: row.b, c: row.c },
              optimistic: true,
            },
            { type: `settle`, slot: 0, success: true, cascade: false },
            ...(timing === `before delete` ? [truncate] : []),
            { type: `delete`, key: row.id, optimistic: true },
            ...(timing === `during delete` ? [truncate] : []),
            {
              type: `settle`,
              slot: 0,
              success: false,
              cascade: false,
              failure: reject ? `reject` : `rollback`,
            },
            ...(timing === `after rollback` ? [truncate] : []),
            // The completed row already dropped at settlement. Preserve later
            // key reuse after an ordinary sync.
            {
              type: `sync`,
              rows: [],
              truncate: false,
              copies: 1,
            },
            {
              type: `edit`,
              key: row.id,
              fields: { a: row.a + 1 },
              optimistic: true,
            },
            { type: `settle`, slot: 0, success: true, cascade: false },
          ],
        )
        // A truncate before the delete removes the row the delete would name.
        const deletes = timing === `before delete` ? 0 : 1
        expect(counts.deletes).toBe(deletes)
        expect(counts.settlements).toBe(2 + deletes)
      }),
      seed === undefined
        ? oraclePropertyOptions(30, acceptedSnapshotReplayProperty[timing])
        : { seed, numRuns: oracleRuns(30) },
    )
  },
)

it.each([true, false])(
  `replays an insert and its update across settlement, accepted=%s`,
  async (success) => {
    await runOptimisticHistory(
      [],
      [
        ...insertionPrefix,
        { type: `settle`, slot: 0, success, cascade: false },
      ],
    )
  },
)
it.each([true, false])(
  `hides a sync row behind an optimistic row until settlement, truncate=%s`,
  async (truncate) => {
    await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 0 }],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
        {
          type: `sync`,
          rows: [{ id: 1, a: 0, b: 2, c: 3 }],
          truncate,
          copies: 1,
        },
        { type: `settle`, slot: 0, success: true, cascade: false },
      ],
    )
  },
)
it(`publishes prior optimistic ownership when rollback reveals an identical authoritative row`, async () => {
  await runOptimisticHistory(
    [{ id: 3, a: 0, b: 0, c: 0 }],
    [
      { type: `delete`, key: 3, optimistic: true },
      { type: `edit`, key: 3, fields: { c: 0 }, optimistic: true },
      { type: `sync`, rows: [], truncate: false, copies: 1 },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `settle`, slot: 0, success: false, cascade: false },
    ],
  )
})
it(`publishes the subscriber-visible row when a buffered optimistic update becomes a delete`, async () => {
  const counts = await runOptimisticHistory(
    [],
    [
      { type: `edit`, key: 1, fields: { c: 0 }, optimistic: true },
      { type: `edit`, key: 1, fields: { b: 1 }, optimistic: true },
      { type: `sync`, rows: [], truncate: false, copies: 1 },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `settle`, slot: 0, success: false, cascade: false },
    ],
  )
  expect(counts).toMatchObject({
    edits: 2,
    settlements: 2,
    failures: 1,
    queued: 1,
  })
})
// Each settled delete or edit drops its optimistic state, whatever order the
// requests settle in. A truncate between settlements does not revive them.
it.each(
  [false, true].flatMap((truncate) =>
    [false, true].flatMap((editSettlesFirst) =>
      [false, true].map((insertAccepted) => ({
        truncate,
        editSettlesFirst,
        insertAccepted,
      })),
    ),
  ),
)(
  `drops each settled delete and edit across settlement orders: %j`,
  async ({ truncate, editSettlesFirst, insertAccepted }) => {
    const replacement: OptimisticStep = {
      type: `sync`,
      rows: [],
      truncate: true,
      copies: 1,
    }
    const acceptedSettlements: Array<OptimisticStep> = editSettlesFirst
      ? [
          { type: `settle`, slot: 2, success: true, cascade: false },
          { type: `settle`, slot: 0, success: true, cascade: false },
        ]
      : [
          { type: `settle`, slot: 0, success: true, cascade: false },
          { type: `settle`, slot: 1, success: true, cascade: false },
        ]
    const counts = await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 0 }],
      [
        { type: `delete`, key: 1, optimistic: true },
        { type: `edit`, key: 1, fields: { c: 0 }, optimistic: true },
        { type: `edit`, key: 1, fields: { c: 1 }, optimistic: true },
        ...acceptedSettlements,
        ...(truncate ? [replacement] : []),
        { type: `settle`, slot: 0, success: insertAccepted, cascade: false },
      ],
    )
    expect(counts).toMatchObject({
      edits: 3,
      deletes: 1,
      settlements: 3,
      failures: Number(!insertAccepted),
      replacements: Number(truncate),
    })
  },
)
fcTest.prop([optimisticHistory], { numRuns: oracleRuns(100), seed: 86103 })(
  `matches optimistic ownership and publication histories with a fixed seed`,
  async ({ initial, steps }) => {
    await runOptimisticHistory(initial, steps)
  },
)
fcTest.prop(
  [optimisticHistory],
  oraclePropertyOptions(100, `collection-state.optimistic-history`),
)(
  `matches optimistic ownership and publication histories with a random or replayed seed`,
  async ({ initial, steps }) => {
    await runOptimisticHistory(initial, steps)
  },
)
// An aborted open batch never applies, so the source's own rows must return
// to their state before it. A later partial update then omits `c` again, and
// the Collection keeps the held `c`. Shrunk from seed -526998278.
it(`merges a partial update after an aborted source delete`, async () => {
  const counts = await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 0 }],
    [
      {
        type: `open`,
        batch: {
          type: `sync`,
          rows: [],
          deletes: [1],
          truncate: false,
          copies: 1,
        },
      },
      { type: `close`, commit: false },
      {
        type: `sync`,
        rows: [{ id: 1, a: 0, b: 0, c: -1 }],
        deletes: [],
        truncate: false,
        copies: 1,
        partial: true,
      },
    ],
    undefined,
    { partialUpdates: true },
  )
  expect(counts).toMatchObject({
    openBatches: 1,
    abortedBatches: 1,
    distinguishingPartialUpdates: 1,
  })
})
fcTest.prop([partialHistory], { numRuns: oracleRuns(100), seed: 86104 })(
  `matches partial-update histories with a fixed seed`,
  async ({ initial, steps }) => {
    await runOptimisticHistory(initial, steps, undefined, {
      partialUpdates: true,
    })
  },
)
fcTest.prop(
  [partialHistory],
  oraclePropertyOptions(100, `collection-state.optimistic-history-partial`),
)(
  `matches partial-update histories with a random or replayed seed`,
  async ({ initial, steps }) => {
    await runOptimisticHistory(initial, steps, undefined, {
      partialUpdates: true,
    })
  },
)
