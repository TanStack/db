import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import {
  DuplicateKeySyncError,
  SyncQueueInvariantError,
  SyncTransactionAlreadyCommittedWriteError,
} from '../src/errors.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
import { whenSyncAccepted } from '../src/sync-receipt.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { runOptimisticHistory } from './optimistic-history-oracle.js'
import type { OptimisticStep } from './optimistic-history-oracle.js'
import type { CollectionChangesManager } from '../src/collection/changes.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig, TransactionState } from '../src/types.js'

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

type RetainedRow = {
  id: number
  value: number
}

type SyncActions = Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]

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

it(`starts a new sync run without retained publication state`, async () => {
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
  const events: Array<{ type: string; key: string | number }> = []
  let subscription: ReturnType<typeof collection.subscribeChanges> | undefined

  try {
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 1 } })
    expect(sync.commit()).toBe(true)

    subscription = collection.subscribeChanges(
      (changes) => {
        events.push(
          ...changes.map((change) => ({
            type: change.type,
            key: change.key,
          })),
        )
      },
      { includeInitialState: false },
    )

    sync.begin()
    sync.write({ type: `update`, value: { id: 1, value: 2 } })
    // Stand in for an accepted transaction held behind a mutation; only
    // accepted transactions publish in a drain.
    collection._state.pendingSyncedTransactions.at(-1)!.committed = true
    collection._state.capturePreSyncVisibleState()
    expect(collection._state.preSyncVisibleState.size).toBe(1)
    expect(collection._state.recentlySyncedKeys).toEqual(new Set([1]))

    const cleanup = collection.cleanup()
    const retainedAfterCleanup = {
      visibleRows: collection._state.preSyncVisibleState.size,
      virtualRows: collection._state.preSyncVirtualState.size,
      recentKeys: collection._state.recentlySyncedKeys.size,
    }
    await cleanup

    events.length = 0
    collection.startSyncImmediate()
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 3 } })
    expect(sync.commit()).toBe(true)

    expect({ retainedAfterCleanup, events }).toEqual({
      retainedAfterCleanup: { visibleRows: 0, virtualRows: 0, recentKeys: 0 },
      events: [{ type: `insert`, key: 1 }],
    })
  } finally {
    subscription?.unsubscribe()
    await collection.cleanup()
  }
})

it(`keeps a restarted sync run's publication state after the old listener returns`, async () => {
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
  let cleanup: Promise<void> | undefined
  let restarted = false
  const subscription = collection.subscribeChanges(
    () => {
      if (restarted) return
      restarted = true
      cleanup = collection.cleanup()
      collection.startSyncImmediate()
      collection._state.preSyncVisibleState.set(2, { id: 2, value: 2 })
      collection._state.recentlySyncedKeys.add(2)
    },
    { includeInitialState: false },
  )

  try {
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 1 } })
    expect(sync.commit()).toBe(true)

    expect(restarted).toBe(true)
    expect(collection._state.preSyncVisibleState).toEqual(
      new Map([[2, { id: 2, value: 2 }]]),
    )
    expect(collection._state.recentlySyncedKeys).toEqual(new Set([2]))
    expect(collection._state.hasReceivedFirstCommit).toBe(false)

    sync.begin()
    sync.write({ type: `insert`, value: { id: 3, value: 3 } })
    expect(sync.commit()).toBe(true)
    expect(collection._state.preSyncVisibleState.size).toBe(0)
    expect(collection._state.preSyncVirtualState.size).toBe(0)
    expect(collection._state.hasReceivedFirstCommit).toBe(true)
    await Promise.resolve()
    expect(collection._state.recentlySyncedKeys.size).toBe(0)
    await cleanup
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`does not let an old publication microtask clear restarted sync state`, async () => {
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

  try {
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 1 } })
    expect(sync.commit()).toBe(true)

    const cleanup = collection.cleanup()
    collection.startSyncImmediate()
    sync.begin()
    sync.write({ type: `insert`, value: { id: 2, value: 2 } })
    // Stand in for an accepted transaction held behind a mutation.
    collection._state.pendingSyncedTransactions.at(-1)!.committed = true
    collection._state.capturePreSyncVisibleState()
    expect(collection._state.recentlySyncedKeys).toEqual(new Set([2]))

    await Promise.resolve()

    expect(collection._state.recentlySyncedKeys).toEqual(new Set([2]))

    collection._state.pendingSyncedTransactions.at(-1)!.committed = false
    expect(sync.commit()).toBe(true)
    expect(collection._state.hasReceivedFirstCommit).toBe(true)
    await Promise.resolve()
    expect(collection._state.preSyncVisibleState.size).toBe(0)
    expect(collection._state.preSyncVirtualState.size).toBe(0)
    expect(collection._state.recentlySyncedKeys.size).toBe(0)
    await cleanup
  } finally {
    await collection.cleanup()
  }
})

it(`publishes a virtual-state update when a restarted optimistic row is confirmed`, async () => {
  let sync!: SyncActions
  let syncRunCount = 0
  let releaseMutation!: () => void
  const mutationHold = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        syncRunCount++
        if (syncRunCount === 1) actions.markReady()
      },
    },
  })
  type ObservedRow = RetainedRow & {
    $collectionId: string
    $key: number
    $origin: `local` | `remote`
    $hasPendingWrites: boolean
    $synced: boolean
  }
  type ObservedChange = {
    type: string
    key: string | number
    value: ObservedRow
    previousValue?: ObservedRow
  }
  const snapshotRow = (row: ObservedRow): ObservedRow => ({
    id: row.id,
    value: row.value,
    $collectionId: row.$collectionId,
    $key: row.$key,
    $origin: row.$origin,
    $hasPendingWrites: row.$hasPendingWrites,
    $synced: row.$synced,
  })
  const publications: Array<{
    changes: Array<ObservedChange>
    rows: Array<ObservedRow>
  }> = []
  const restartStatuses: Array<string> = []
  const settlementTimeline: Array<`publication` | `receipt`> = []
  let restarted = false
  let readMutationState: (() => TransactionState) | undefined
  let rollbackMutation: (() => void) | undefined
  let mutationCommit: Promise<unknown> | undefined
  let syncReceipt: ReturnType<SyncActions[`commit`]> | undefined
  const subscription = collection.subscribeChanges(
    (changes) => {
      publications.push({
        changes: changes.map(({ type, key, value, previousValue }) => ({
          type,
          key,
          value: snapshotRow(value),
          ...(previousValue === undefined
            ? {}
            : { previousValue: snapshotRow(previousValue) }),
        })),
        rows: [...collection.state.values()].map(snapshotRow),
      })
      if (changes.some(({ type, key }) => type === `update` && key === 2)) {
        queueMicrotask(() => settlementTimeline.push(`publication`))
      }
      if (restarted || !changes.some(({ key }) => key === 1)) return

      restarted = true
      restartStatuses.push(collection.status)
      void collection.cleanup()
      restartStatuses.push(collection.status)
      collection.startSyncImmediate()
      restartStatuses.push(collection.status)
      sync.markReady()
      restartStatuses.push(collection.status)

      const transaction = createTransaction({
        autoCommit: false,
        mutationFn: () => mutationHold,
      })
      readMutationState = () => transaction.state
      rollbackMutation = () => transaction.rollback()
      void transaction.isPersisted.promise.catch(() => undefined)
      transaction.mutate(() => collection.insert({ id: 2, value: 2 }))
      mutationCommit = transaction.commit()

      sync.begin()
      sync.write({ type: `insert`, value: { id: 2, value: 2 } })
      syncReceipt = sync.commit()
    },
    { includeInitialState: false },
  )

  try {
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 1 } })
    expect(sync.commit()).toBe(true)

    const remoteRow = (id: number): ObservedRow => ({
      id,
      value: id,
      $collectionId: collection.id,
      $key: id,
      $origin: `remote`,
      $hasPendingWrites: false,
      $synced: true,
    })
    const localRow = (id: number): ObservedRow => ({
      id,
      value: id,
      $collectionId: collection.id,
      $key: id,
      $origin: `local`,
      $hasPendingWrites: true,
      $synced: false,
    })
    const expectedPublications = [
      {
        changes: [{ type: `insert`, key: 1, value: remoteRow(1) }],
        rows: [remoteRow(1)],
      },
      { changes: [{ type: `delete`, key: 1, value: remoteRow(1) }], rows: [] },
      {
        changes: [{ type: `insert`, key: 2, value: localRow(2) }],
        rows: [localRow(2)],
      },
      {
        changes: [
          {
            type: `update`,
            key: 2,
            value: remoteRow(2),
            previousValue: localRow(2),
          },
        ],
        rows: [remoteRow(2)],
      },
    ]
    expect(publications).toEqual(expectedPublications.slice(0, 3))
    expect([...collection.state.keys()]).toEqual([2])
    expect(restartStatuses).toEqual([`ready`, `cleaned-up`, `loading`, `ready`])
    expect(collection.status).toBe(`ready`)

    // The restarted sync run's commit is accepted at once and parked behind
    // the persisting mutation; the rollback publishes it.
    expect(syncReceipt).not.toBe(true)
    expect(collection._state.pendingSyncedTransactions.at(-1)?.committed).toBe(
      true,
    )
    expect(rollbackMutation).toBeDefined()
    await Promise.resolve()
    expect(settlementTimeline).toEqual([])

    rollbackMutation?.()
    expect(publications).toEqual(expectedPublications)
    await Promise.resolve()
    expect(settlementTimeline).toEqual([`publication`])
    expect(publications).toEqual(expectedPublications)
    expect([...collection.state.values()].map(snapshotRow)).toEqual([
      remoteRow(2),
    ])

    releaseMutation()
    await mutationCommit
    expect(readMutationState?.()).toBe(`failed`)
    expect(publications).toEqual(expectedPublications)
    expect([...collection.state.values()].map(snapshotRow)).toEqual([
      remoteRow(2),
    ])
  } finally {
    releaseMutation()
    await mutationCommit
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

type LivePreviousRow = {
  id: number
  value: number | null | undefined
}

function observeValuePublications(
  collection: Collection<LivePreviousRow, number>,
  includeInitialState = false,
) {
  const publications: Array<
    Array<{
      type: string
      key: string | number
      value: LivePreviousRow[`value`]
      previousValue: LivePreviousRow[`value`]
    }>
  > = []
  const subscription = collection.subscribeChanges(
    (changes) =>
      publications.push(
        changes.map((change) => ({
          type: change.type,
          key: change.key,
          value: change.value.value,
          previousValue: change.previousValue?.value,
        })),
      ),
    { includeInitialState },
  )
  return { publications, subscription }
}

async function runImmutablePreviousValuePublication(
  initial: LivePreviousRow[`value`],
  updates: ReadonlyArray<LivePreviousRow[`value`]>,
) {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  let liveValue = initial
  let writes = 0
  const liveRow = {
    id: 1,
    get value() {
      return liveValue
    },
  }
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: liveRow })
        actions.write({ type: `insert`, value: { id: 2, value: 10 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const { publications, subscription } = observeValuePublications(collection)
  try {
    sync.begin()
    let previousValue = initial
    for (const value of updates) {
      liveValue = value
      sync.write({
        type: `update`,
        value: liveRow,
        previousValue: { id: 1, value: previousValue },
      })
      writes++
      previousValue = value
    }
    sync.write({
      type: `update`,
      value: { id: 2, value: 11 },
      previousValue: { id: 2, value: 10 },
    })
    writes++
    expect(sync.commit(), `live-value sync commit reached`).toBe(true)
    expect(writes, `all live-value writes reached`).toBe(updates.length + 1)
    expect(publications).toStrictEqual([
      [
        {
          type: `update`,
          key: 1,
          value: updates.at(-1),
          previousValue: initial,
        },
        {
          type: `update`,
          key: 2,
          value: 11,
          previousValue: 10,
        },
      ],
    ])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
}

// Replay of a review probe. A transaction begun inside an open one commits
// and applies first; replay then invalidates the open transaction's insert.
// The accepted transaction's receipt resolves, and the open one's commit
// rejects with DuplicateKeySyncError.
it(`rejects an open transaction that a later nested commit invalidates`, async () => {
  let sync!: Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  try {
    await collection.stateWhenReady()
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 1 } })
    sync.begin()
    sync.write({ type: `update`, value: { id: 1, value: 2 } })
    expect(sync.commit()).toBe(true)
    const rejected = sync.commit()
    expect(rejected).toBeInstanceOf(Promise)
    await expect(rejected).rejects.toBeInstanceOf(DuplicateKeySyncError)
    // Core never accepted the transaction, so its acceptance moment rejects too.
    await expect(
      Promise.resolve(whenSyncAccepted(rejected)),
    ).rejects.toBeInstanceOf(DuplicateKeySyncError)
    expect(collection.get(1)?.value).toBe(2)
    expect(collection._state.pendingSyncedTransactions).toHaveLength(0)
  } finally {
    await collection.cleanup()
  }
})

// After a replay invalidates the open transaction, its later writes must not
// change what a newer transaction sees. Each write below would leak into the
// projection: an insert of key 9 would make the newer insert of key 9 a
// duplicate, and a delete of key 1 would let the newer insert of key 1 pass.
// The newer transaction sees only the accepted row 1, as if the invalidated
// transaction wrote nothing after its invalidation.
it.each([
  {
    late: { type: `insert`, value: { id: 9, value: 1 } },
    newer: { id: 9, value: 3 },
    duplicate: false,
  },
  {
    late: { type: `delete`, key: 1 },
    newer: { id: 1, value: 3 },
    duplicate: true,
  },
] as const)(
  `ignores writes to an invalidated transaction: late $late.type`,
  async ({ late, newer, duplicate }) => {
    let sync!: Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]
    const collection = createCollection<RetainedRow, number>({
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.markReady()
        },
      },
    })
    try {
      await collection.stateWhenReady()
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 1 } })
      sync.begin()
      sync.write({ type: `update`, value: { id: 1, value: 2 } })
      expect(sync.commit()).toBe(true)
      // The premise: the replay has already invalidated the open transaction.
      expect(
        collection._state.pendingSyncedTransactions.at(-1)?.invalidationError,
      ).toBeInstanceOf(DuplicateKeySyncError)
      sync.write(late)
      sync.begin()
      const write = () => sync.write({ type: `insert`, value: newer })
      if (duplicate) expect(write).toThrow(DuplicateKeySyncError)
      else write()
      expect(sync.commit()).toBe(true)
      await expect(sync.commit()).rejects.toBeInstanceOf(DuplicateKeySyncError)
      expect(
        [...collection.state.values()].map(({ id, value }) => [id, value]),
      ).toEqual(
        duplicate
          ? [[1, 2]]
          : [
              [1, 2],
              [newer.id, newer.value],
            ],
      )
    } finally {
      await collection.cleanup()
    }
  },
)

// No public path can make a committed queued transaction invalid on replay:
// only the open last transaction can be canceled. A replay that finds one is
// an invariant failure, not a recoverable rejection.
it(`throws an invariant error when replay finds an invalid committed transaction`, async () => {
  // Current callers cannot create this queue state. Exercise the internal
  // recovery boundary so a future refresh caller cannot strand its receipt.
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { id: 1, value: 0 } })
        commit()
        markReady()
      },
    },
  })
  const applied = createDeferred<void>()
  void applied.promise.catch(() => undefined)
  const pending = {
    committed: true,
    applicationStarted: false,
    layoutChanged: false,
    operations: [
      {
        type: `insert` as const,
        originalSyncType: `insert` as const,
        key: 1,
        value: { id: 1, value: 2 },
      },
    ],
    rowMetadataWrites: new Map(),
    explicitRowMetadataWrites: new Map(),
    collectionMetadataWrites: new Map(),
    applied,
  }
  const validApplied = createDeferred<void>()
  void validApplied.promise.catch(() => undefined)
  const valid = {
    ...pending,
    operations: [
      {
        ...pending.operations[0]!,
        key: 2,
        value: { id: 2, value: 2 },
      },
    ],
    applied: validApplied,
  }

  let primaryFailure: unknown
  let hasPrimaryFailure = false
  try {
    await collection.stateWhenReady()
    collection._state.pendingSyncedTransactions.push(valid, pending)
    expect(() => collection._state.refreshPendingSyncedProjection()).toThrow(
      SyncQueueInvariantError,
    )
    expect(collection.get(1)?.value).toBe(0)
  } catch (error) {
    primaryFailure = error
    hasPrimaryFailure = true
  }

  const cleanupFailures: Array<unknown> = []
  try {
    for (const transaction of [pending, valid]) {
      const index =
        collection._state.pendingSyncedTransactions.indexOf(transaction)
      if (index !== -1)
        collection._state.pendingSyncedTransactions.splice(index, 1)
    }
    if (applied.isPending()) applied.resolve()
    if (validApplied.isPending()) validApplied.resolve()
    collection._state.refreshPendingSyncedProjection()
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    await collection.cleanup()
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (hasPrimaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      `Projection refresh and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (hasPrimaryFailure) throw primaryFailure
  if (cleanupFailures.length > 0)
    throw new AggregateError(
      cleanupFailures,
      `Projection refresh cleanup failed`,
    )
})

it.each([
  { initial: 0, updates: [1] },
  { initial: 0, updates: [1, 2] },
  { initial: null, updates: [1] },
  { initial: undefined, updates: [1] },
] satisfies Array<{
  initial: LivePreviousRow[`value`]
  updates: Array<LivePreviousRow[`value`]>
}>)(
  `publishes a live value from immutable previous state: %j`,
  async ({ initial, updates }) => {
    await runImmutablePreviousValuePublication(initial, updates)
  },
)

it(`keeps the first queued before-image when metadata reserves the key`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  let liveValue: LivePreviousRow[`value`] = 0
  const liveRow = {
    id: 1,
    get value() {
      return liveValue
    },
  }
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: liveRow })
        actions.write({ type: `insert`, value: { id: 2, value: 0 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const blocker = createTransaction<LivePreviousRow>({
    autoCommit: false,
    mutationFn: () => hold,
  })
  await collection.stateWhenReady()
  const { publications, subscription } = observeValuePublications(collection)
  const receipts: Array<Promise<void>> = []
  let blockerCommit: Promise<unknown> | undefined

  const commitQueuedSync = () => {
    expect(sync.commit(), `persisting work queues sync`).not.toBe(true)
    expect(
      collection._state.pendingSyncedTransactions.at(-1)?.committed,
      `persisting work queues sync`,
    ).toBe(true)
  }

  try {
    blocker.mutate(() =>
      collection.update(2, (draft) => {
        draft.value = 20
      }),
    )
    publications.length = 0
    blockerCommit = blocker.commit()
    await Promise.resolve()

    sync.begin()
    sync.metadata!.row.set(1, { phase: `metadata-first` })
    commitQueuedSync()

    liveValue = 1
    sync.begin()
    sync.write({
      type: `update`,
      value: liveRow,
      previousValue: { id: 1, value: 0 },
    })
    commitQueuedSync()

    liveValue = 2
    sync.begin()
    sync.write({
      type: `update`,
      value: liveRow,
      previousValue: { id: 1, value: 1 },
    })
    commitQueuedSync()

    release()
    await blockerCommit
    await Promise.all(receipts)

    expect(
      publications.flat().filter(({ key }) => key === 1),
      `the queued drain publishes one complete key transition`,
    ).toStrictEqual([{ type: `update`, key: 1, value: 2, previousValue: 0 }])
    expect(collection._state.syncedMetadata.get(1)).toStrictEqual({
      phase: `metadata-first`,
    })
  } finally {
    release()
    if (blocker.state === `pending` || blocker.state === `persisting`)
      blocker.rollback()
    await blockerCommit?.catch(() => undefined)
    subscription.unsubscribe()
    await collection.cleanup()
    await Promise.allSettled(receipts)
  }
})

type ParkedSyncHarness = {
  collection: Collection<RetainedRow, number>
  sync: Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]
  releasePersistence: () => Promise<void>
}

async function withParkedSync(
  initialRows: ReadonlyArray<RetainedRow>,
  run: (harness: ParkedSyncHarness) => Promise<void>,
  rowUpdateMode: `partial` | `full` = `full`,
): Promise<void> {
  let sync!: ParkedSyncHarness[`sync`]
  let release!: () => void
  const persistence = new Promise<void>((resolve) => {
    release = resolve
  })
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode,
      sync: (actions) => {
        sync = actions
        actions.begin()
        for (const row of initialRows)
          actions.write({ type: `insert`, value: row })
        actions.write({ type: `insert`, value: { id: 2, value: 0 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const blocker = createTransaction<RetainedRow>({
    autoCommit: false,
    mutationFn: () => persistence,
  })
  let blockerCommit: Promise<unknown> | undefined
  let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
  const publicRows = () =>
    [...collection.state]
      .map(([key, row]) => [key, row.value] as const)
      .sort(([left], [right]) => left - right)
  const mirror = new Map<number, number>(
    initialRows.map(({ id, value }) => [id, value]),
  )
  mirror.set(2, 0)
  const publications: Array<{
    publicRows: Array<readonly [number, number]>
    mirrorRows: Array<[number, number]>
  }> = []
  const mirrorRows = () => [...mirror].sort(([left], [right]) => left - right)
  let primaryFailure: unknown
  let hasPrimaryFailure = false

  try {
    await collection.stateWhenReady()
    expect(publicRows()).toEqual(mirrorRows())
    subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) mirror.delete(change.key)
          else mirror.set(change.key, change.value.value)
        }
        publications.push({
          publicRows: publicRows(),
          mirrorRows: mirrorRows(),
        })
      },
      { includeInitialState: false },
    )
    blocker.mutate(() =>
      collection.update(2, (draft) => {
        draft.value = 1
      }),
    )
    blockerCommit = blocker.commit()
    await Promise.resolve()
    expect(blocker.state).toBe(`persisting`)
    await run({
      collection,
      sync,
      releasePersistence: async () => {
        release()
        await blockerCommit
      },
    })
    for (const publication of publications) {
      expect(publication.mirrorRows).toEqual(publication.publicRows)
    }
    expect(mirrorRows()).toEqual(publicRows())
  } catch (error) {
    primaryFailure = error
    hasPrimaryFailure = true
  }

  const cleanupFailures: Array<unknown> = []
  try {
    release()
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    if (blocker.state === `pending` || blocker.state === `persisting`)
      blocker.rollback()
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    await blockerCommit?.catch(() => undefined)
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    subscription?.unsubscribe()
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    await collection.cleanup()
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (hasPrimaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      `Queued sync oracle and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (hasPrimaryFailure) throw primaryFailure
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `Queued sync cleanup failed`, {
      cause: cleanupFailures[0],
    })
  }
}

it(`keeps queued snapshot admission work linear in the row count`, async () => {
  let sync!: ParkedSyncHarness[`sync`]
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

  try {
    await collection.stateWhenReady()
    sync.begin()
    const pending = collection._state.pendingSyncedTransactions.at(-1)
    if (!pending) throw new Error(`missing active sync transaction`)

    let inspectedOperations = 0
    const operations = pending.operations
    pending.operations = new Proxy(operations, {
      get(target, property, receiver) {
        if (property !== Symbol.iterator)
          return Reflect.get(target, property, receiver)
        return function* () {
          for (const operation of target) {
            inspectedOperations++
            yield operation
          }
        }
      },
    })

    const rowCount = 64
    for (let id = 0; id < rowCount; id++) {
      sync.write({ type: `insert`, value: { id, value: id } })
    }
    const receipt = sync.commit()
    if (receipt !== true) await receipt

    // Application and publication each make one linear pass. Admission must
    // not add a triangular scan over the rows already staged in this batch.
    expect(inspectedOperations).toBeLessThanOrEqual(rowCount * 2)
  } finally {
    await collection.cleanup()
  }
})

// A committed source batch that waits for persistence is closed to writes.
// Without the check, a late write would join the queued batch.
it(`rejects a write to a committed batch that waits for persistence`, async () => {
  await withParkedSync(
    [{ id: 1, value: 0 }],
    async ({ collection, sync, releasePersistence }) => {
      sync.begin()
      sync.write({ type: `update`, value: { id: 1, value: 1 } })
      const receipt = sync.commit()
      expect(
        collection._state.pendingSyncedTransactions.at(-1)?.committed,
      ).toBe(true)

      expect(() =>
        sync.write({ type: `update`, value: { id: 1, value: 2 } }),
      ).toThrow(SyncTransactionAlreadyCommittedWriteError)

      await releasePersistence()
      await receipt
      expect(collection.get(1)?.value).toBe(1)
    },
  )
})

it.each([
  { label: `no source row`, base: `absent` },
  { label: `a same-transaction delete`, base: `deleted` },
  { label: `a same-transaction truncate`, base: `truncated` },
] as const)(
  `keeps an independent partial upsert after $label`,
  async ({ base }) => {
    await withParkedSync(
      base === `absent` ? [] : [{ id: 1, value: 0 }],
      async ({ collection, sync, releasePersistence }) => {
        sync.begin()
        if (base === `deleted`) sync.write({ type: `delete`, key: 1 })
        if (base === `truncated`) sync.truncate()
        sync.write({ type: `update`, value: { id: 1, value: 2 } })
        const receipt = sync.commit()
        await releasePersistence()
        if (receipt !== true) await receipt
        expect(collection._state.syncedData.get(1)).toEqual({ id: 1, value: 2 })
        expect(collection.get(1)?.value).toBe(2)
      },
      `partial`,
    )
  },
)

it(`applies a partial update after an insert in the same sync transaction`, async () => {
  await withParkedSync(
    [],
    async ({ collection, sync, releasePersistence }) => {
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 1 } })
      sync.write({ type: `update`, value: { id: 1, value: 2 } })
      const receipt = sync.commit()
      expect(
        collection._state.pendingSyncedTransactions.at(-1)?.committed,
      ).toBe(true)
      await releasePersistence()
      await receipt
      expect(collection._state.syncedData.get(1)).toEqual({ id: 1, value: 2 })
      expect(collection.get(1)?.value).toBe(2)
    },
    `partial`,
  )
})

it.each([
  { label: `an earlier queued insert`, predecessor: `earlier` },
  { label: `an insert in the same transaction`, predecessor: `same` },
] as const)(
  `rejects a duplicate insert after $label`,
  async ({ predecessor }) => {
    // The source Map contains the first queued insert before the second write is
    // admitted. The duplicate-key law is independent of whether the first row
    // has already crossed the public publication boundary.
    await withParkedSync(
      [],
      async ({ collection, sync, releasePersistence }) => {
        sync.begin()
        sync.write({ type: `insert`, value: { id: 1, value: 1 } })
        let firstReceipt: true | Promise<void> | undefined
        if (predecessor === `earlier`) {
          firstReceipt = sync.commit()
          expect(
            collection._state.pendingSyncedTransactions.at(-1)?.committed,
          ).toBe(true)
          sync.begin()
        }
        expect(() =>
          sync.write({ type: `insert`, value: { id: 1, value: 2 } }),
        ).toThrow(DuplicateKeySyncError)
        firstReceipt ??= sync.commit()

        await releasePersistence()
        if (firstReceipt !== true) await firstReceipt
        expect(collection._state.syncedData.get(1)).toEqual({ id: 1, value: 1 })
      },
    )
  },
)

it(`snapshots a buffered delete before its row object is reused`, async () => {
  const reusedRow: LivePreviousRow = { id: 1, value: 0 }
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        actions.begin()
        actions.write({ type: `insert`, value: reusedRow })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const publications: Array<
    Array<{
      type: string
      value: LivePreviousRow[`value`]
      previousValue: LivePreviousRow[`value`]
      previousSynced: boolean | undefined
      previousOrigin: string | undefined
    }>
  > = []
  const subscription = collection.subscribeChanges(
    (changes) =>
      publications.push(
        changes.map((change) => {
          const previous = change.previousValue as
            | (LivePreviousRow & { $synced: boolean; $origin: string })
            | undefined
          return {
            type: change.type,
            value: change.value.value,
            previousValue: previous?.value,
            previousSynced: previous?.$synced,
            previousOrigin: previous?.$origin,
          }
        }),
      ),
    { includeInitialState: true },
  )
  const changes = (
    collection as unknown as {
      _changes: CollectionChangesManager<LivePreviousRow, number>
    }
  )._changes

  try {
    await collection.stateWhenReady()
    publications.length = 0
    changes.shouldBatchEvents = true
    changes.emitEvents([{ type: `delete`, key: 1, value: reusedRow }])
    expect(publications, `delete remains buffered`).toStrictEqual([])

    reusedRow.value = 1
    collection._state.optimisticUpserts.set(1, reusedRow)
    changes.emitEvents(
      [{ type: `insert`, key: 1, value: { ...reusedRow } }],
      true,
    )
    expect(publications).toStrictEqual([
      [
        {
          type: `update`,
          value: 1,
          previousValue: 0,
          previousSynced: true,
          previousOrigin: `remote`,
        },
      ],
    ])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`uses the preserved visible row when rollback releases a queued sync`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  let rejectPersistence!: (error: Error) => void
  const persistenceGate = new Promise<void>((_resolve, reject) => {
    rejectPersistence = reject
  })
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, value: 0 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const transaction = createTransaction<LivePreviousRow>({
    autoCommit: false,
    mutationFn: () => persistenceGate,
  })
  const publications = observeValuePublications(collection)

  try {
    await collection.stateWhenReady()
    const index = collection.createIndex((row) => row.value, {
      indexType: BTreeIndex,
    })
    transaction.mutate(() =>
      collection.update(1, (draft) => {
        draft.value = 1
      }),
    )
    publications.publications.length = 0
    const commit = transaction.commit()
    await Promise.resolve()

    sync.begin()
    sync.write({
      type: `update`,
      value: { id: 1, value: 2 },
      previousValue: { id: 1, value: 0 },
    })
    const receipt = sync.commit()
    expect(receipt).not.toBe(true)
    expect(collection._state.pendingSyncedTransactions.at(-1)?.committed).toBe(
      true,
    )

    const failure = new Error(`queued mutation failed`)
    rejectPersistence(failure)
    await expect(commit).rejects.toBe(failure)
    if (receipt !== true) await receipt

    expect(collection.get(1)?.value).toBe(2)
    expect(publications.publications).toStrictEqual([
      [{ type: `update`, key: 1, value: 2, previousValue: 1 }],
    ])
    expect(index.lookup(`eq`, 0)).toEqual(new Set())
    expect(index.lookup(`eq`, 1)).toEqual(new Set())
    expect(index.lookup(`eq`, 2)).toEqual(new Set([1]))
  } finally {
    publications.subscription.unsubscribe()
    if (transaction.state === `pending` || transaction.state === `persisting`)
      transaction.rollback()
    await collection.cleanup()
  }
})

it(`publishes a provider update for an unseen key as an insert`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  const collection = createCollection<LivePreviousRow, number>({
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
  const publications = observeValuePublications(collection, true)

  try {
    await collection.stateWhenReady()
    sync.begin()
    sync.write({
      type: `update`,
      value: { id: 1, value: 1 },
      previousValue: { id: 1, value: 0 },
    })
    expect(sync.commit()).toBe(true)
    expect(publications.publications).toStrictEqual([
      [],
      [{ type: `insert`, key: 1, value: 1, previousValue: undefined }],
    ])
  } finally {
    publications.subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`suppresses a replacement-object redelivery with a stale before-image`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, value: 1 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const publications = observeValuePublications(collection)

  try {
    await collection.stateWhenReady()
    sync.begin()
    sync.write({
      type: `update`,
      value: { id: 1, value: 1 },
      previousValue: { id: 1, value: 0 },
    })
    expect(sync.commit()).toBe(true)
    expect(publications.publications).toStrictEqual([])
  } finally {
    publications.subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`suppresses a replacement object's partial before-image without index drift`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, value: 1 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const publications = observeValuePublications(collection)

  try {
    await collection.stateWhenReady()
    const index = collection.createIndex((row) => row.value, {
      indexType: BTreeIndex,
    })
    sync.begin()
    sync.write({
      type: `update`,
      value: { id: 1, value: 1 },
      previousValue: { id: 1 } as LivePreviousRow,
    })
    expect(sync.commit()).toBe(true)

    expect(
      {
        publications: publications.publications,
        indexed: index.lookup(`eq`, 1),
        rangeDomains: (
          index as unknown as {
            rangeValueDomains: Map<string, number>
          }
        ).rangeValueDomains,
      },
      `partial before-image observation`,
    ).toStrictEqual({
      publications: [],
      indexed: new Set([1]),
      rangeDomains: new Map([[`number`, 1]]),
    })
  } finally {
    publications.subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`retains the pre-batch value when a later update supplies an intermediate snapshot`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, value: 0 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const { publications, subscription } = observeValuePublications(collection)
  try {
    await collection.stateWhenReady()
    sync.begin()
    sync.write({ type: `update`, value: { id: 1, value: 1 } })
    sync.write({
      type: `update`,
      value: { id: 1, value: 2 },
      previousValue: { id: 1, value: 1 },
    })
    expect(sync.commit(), `repeated update batch applies`).toBe(true)
    expect(publications).toStrictEqual([
      [{ type: `update`, key: 1, value: 2, previousValue: 0 }],
    ])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`publishes an insert when only its following update supplies a previous value`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  const collection = createCollection<LivePreviousRow, number>({
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
  const { publications, subscription } = observeValuePublications(collection)
  try {
    await collection.stateWhenReady()
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 1 } })
    sync.write({
      type: `update`,
      value: { id: 1, value: 2 },
      previousValue: { id: 1, value: 1 },
    })
    expect(sync.commit(), `insert then update batch applies`).toBe(true)
    expect(publications).toStrictEqual([
      [{ type: `insert`, key: 1, value: 2, previousValue: undefined }],
    ])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`publishes a truncate rebuild as an insert despite an update snapshot`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, value: 0 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const { publications, subscription } = observeValuePublications(collection)
  try {
    await collection.stateWhenReady()
    sync.begin()
    sync.truncate()
    sync.write({
      type: `update`,
      value: { id: 1, value: 1 },
      previousValue: { id: 1, value: 0 },
    })
    expect(sync.commit(), `truncate rebuild applies`).toBe(true)
    expect(publications).toStrictEqual([
      [
        { type: `delete`, key: 1, value: 0, previousValue: undefined },
        { type: `insert`, key: 1, value: 1, previousValue: undefined },
      ],
    ])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`does not publish an authoritative update hidden by an optimistic overlay`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, value: 0 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const transaction = createTransaction<LivePreviousRow>({
    autoCommit: false,
    mutationFn: () => hold,
  })
  let commit: Promise<unknown> | undefined
  const { publications, subscription } = observeValuePublications(collection)
  try {
    await collection.stateWhenReady()
    transaction.mutate(() =>
      collection.update(1, (draft) => {
        draft.value = 100
      }),
    )
    publications.length = 0
    commit = transaction.commit()
    await Promise.resolve()

    sync.begin()
    sync.write({
      type: `update`,
      value: { id: 1, value: 1 },
      previousValue: { id: 1, value: 0 },
    })
    expect(sync.commit(), `hidden authoritative update is held`).not.toBe(true)
    expect(collection.get(1)?.value, `optimistic overlay remains visible`).toBe(
      100,
    )
    expect(publications, `hidden update is not published`).toStrictEqual([])
  } finally {
    subscription.unsubscribe()
    release()
    await commit
    await collection.cleanup()
  }
})

it(`does not carry previous-value state across a failed sync run`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  let syncRunCount = 0
  let liveValue: LivePreviousRow[`value`] = 0
  const failure = new Error(`live value read failed`)
  const liveRow = {
    id: 1,
    get value() {
      return liveValue
    },
  }
  const collection = createCollection<LivePreviousRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        syncRunCount++
        actions.begin()
        if (syncRunCount === 1) {
          actions.write({ type: `insert`, value: liveRow })
          actions.write({ type: `insert`, value: { id: 2, value: 0 } })
        } else {
          actions.write({ type: `insert`, value: { id: 1, value: 10 } })
        }
        actions.commit()
        actions.markReady()
      },
    },
  })
  let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
  try {
    liveValue = 1
    sync.begin()
    sync.write({
      type: `update`,
      value: liveRow,
      previousValue: { id: 1, value: 0 },
    })
    sync.write({
      type: `update`,
      value: {
        id: 2,
        get value(): number {
          throw failure
        },
      },
      previousValue: { id: 2, value: 0 },
    })
    let thrown: unknown
    try {
      sync.commit()
    } catch (error) {
      thrown = error
    }
    expect(thrown, `the poisoned batch reached value comparison`).toBe(failure)

    const optimisticFailure = new Error(`optimistic mutation failed`)
    const optimistic = createTransaction<LivePreviousRow>({
      autoCommit: false,
      mutationFn: () => {
        throw optimisticFailure
      },
    })
    const persistence = optimistic.isPersisted.promise.catch((error) => error)
    optimistic.mutate(() => collection.insert({ id: 3, value: 30 }))
    expect(collection.has(3), `failed-sync optimistic overlay appears`).toBe(
      true,
    )
    await expect(optimistic.commit()).rejects.toBe(optimisticFailure)
    expect(await persistence, `failed optimistic receipt`).toBe(
      optimisticFailure,
    )
    expect(
      collection.has(3),
      `failed-sync optimistic overlay rolls back before restart`,
    ).toBe(false)

    await collection.cleanup()
    collection.startSyncImmediate()
    expect(syncRunCount, `replacement sync run started`).toBe(2)
    const observation = observeValuePublications(collection)
    subscription = observation.subscription
    sync.begin()
    sync.write({ type: `update`, value: { id: 1, value: 11 } })
    expect(sync.commit(), `clean replacement batch applies`).toBe(true)
    expect(observation.publications).toStrictEqual([
      [{ type: `update`, key: 1, value: 11, previousValue: 10 }],
    ])
  } finally {
    subscription?.unsubscribe()
    await collection.cleanup()
  }
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

const historyRow = fc.record({
  id: fc.integer({ min: 1, max: 3 }),
  a: fc.integer({ min: -2, max: 2 }),
  b: fc.integer({ min: -2, max: 2 }),
  c: fc.integer({ min: -2, max: 2 }),
})
const sourceBatch = fc.record({
  type: fc.constant(`sync` as const),
  rows: fc.uniqueArray(historyRow, {
    selector: (row) => row.id,
    maxLength: 3,
  }),
  // The source may also delete keys, including keys it does not hold.
  deletes: fc.oneof(
    { weight: 3, arbitrary: fc.constant([]) },
    {
      weight: 1,
      arbitrary: fc.uniqueArray(fc.integer({ min: 1, max: 3 }), {
        minLength: 1,
        maxLength: 2,
      }),
    },
  ),
  truncate: fc.boolean(),
  copies: fc.integer({ min: 1, max: 2 }),
})
// A mutation handler may write a source batch before it returns, and may
// await that batch's commit receipt.
const handlerBatch = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(sourceBatch, fc.boolean())
      .map(([batch, awaitReceipt]) => ({ ...batch, awaitReceipt })),
  },
)
const optimisticStep: fc.Arbitrary<OptimisticStep> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`delete` as const),
      key: fc.integer({ min: 1, max: 3 }),
      optimistic: fc.boolean(),
      inHandler: handlerBatch,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant(`edit` as const),
      key: fc.integer({ min: 1, max: 3 }),
      fields: fc
        .record(
          {
            a: fc.integer({ min: -2, max: 2 }),
            b: fc.integer({ min: -2, max: 2 }),
            c: fc.integer({ min: -2, max: 2 }),
          },
          { requiredKeys: [] },
        )
        .filter((fields) => Object.keys(fields).length > 0),
      optimistic: fc.boolean(),
      inHandler: handlerBatch,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      slot: fc.nat(5),
      success: fc.boolean(),
      cascade: fc.boolean(),
    }),
  },
  { weight: 3, arbitrary: sourceBatch },
  // A sync transaction can still be open when an optimistic transaction
  // settles, then commit or abort later.
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`open` as const),
      batch: sourceBatch,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`close` as const),
      commit: fc.boolean(),
    }),
  },
)
const optimisticHistory = fc.record({
  initial: fc.uniqueArray(historyRow, {
    selector: (row) => row.id,
    maxLength: 3,
  }),
  steps: fc.array(optimisticStep, { minLength: 2, maxLength: 24 }),
})
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
it(`generates open, committed, and aborted sync transactions`, () => {
  const commands = fc.sample(optimisticStep, { seed: 86104, numRuns: 200 })
  expect(commands.some((step) => step.type === `open`)).toBe(true)
  expect(commands.some((step) => step.type === `close` && step.commit)).toBe(
    true,
  )
  expect(commands.some((step) => step.type === `close` && !step.commit)).toBe(
    true,
  )
})

it(`generates direct delete actions`, () => {
  const commands = fc.sample(optimisticStep, { seed: 86104, numRuns: 100 })
  expect(commands.some((step) => step.type === `delete`)).toBe(true)
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

it(`generates source batches inside insert, update, and delete handlers`, () => {
  const histories = fc.sample(optimisticHistory, { seed: 86103, numRuns: 100 })
  const inHandler = histories.flatMap(({ steps }) =>
    steps.flatMap((step) =>
      (step.type === `edit` || step.type === `delete`) && step.inHandler
        ? [{ type: step.type, batch: step.inHandler }]
        : [],
    ),
  )
  expect(inHandler.some((entry) => entry.type === `edit`)).toBe(true)
  expect(inHandler.some((entry) => entry.type === `delete`)).toBe(true)
  expect(inHandler.some((entry) => entry.batch.awaitReceipt)).toBe(true)
  expect(inHandler.some((entry) => !entry.batch.awaitReceipt)).toBe(true)
  expect(inHandler.some((entry) => entry.batch.rows.length > 0)).toBe(true)
})

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

it(`drops a completed direct insert whose handler wrote no sync row`, async () => {
  // Law: settlement drops the optimistic state. An open truncate does not
  // touch the inserted key, so nothing holds the completed row.
  let sync!: Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]
  const events: Array<string> = []
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
    onInsert: () => Promise.resolve(),
  })
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) events.push(`${change.type}:${change.key}`)
    },
    { includeInitialState: false },
  )
  try {
    await collection.stateWhenReady()
    sync.begin()
    sync.truncate()
    await collection.insert({ id: 1, value: 1 }).isPersisted.promise
    expect(sync.commit()).toBe(true)
    await collection.insert({ id: 2, value: 2 }).isPersisted.promise

    expect(events).toEqual([`insert:1`, `delete:1`, `insert:2`, `delete:2`])
    expect([...collection.state.keys()]).toEqual([])
    expect([...collection._state.syncedData.keys()]).toEqual([])
    expect([...collection._state.heldOptimisticRows.keys()]).toEqual([])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

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
