import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import {
  DuplicateKeySyncError,
  SyncTransactionAbortedError,
} from '../src/errors.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
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
 * that vanish or reappear only after unrelated work observable.
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
        await collection.cleanup()
        collection.startSyncImmediate()
        model.clear()
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
    collection._state.capturePreSyncVisibleState()
    expect(collection._state.recentlySyncedKeys).toEqual(new Set([2]))

    await Promise.resolve()

    expect(collection._state.recentlySyncedKeys).toEqual(new Set([2]))

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
  let syncReceiptOutcome: Promise<void> | undefined
  let syncReceiptSettled = false
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
      if (syncReceipt !== true) {
        syncReceiptOutcome = syncReceipt.then((value) => {
          settlementTimeline.push(`receipt`)
          syncReceiptSettled = true
          return value
        })
      }
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

    expect(syncReceipt).toBeDefined()
    expect(syncReceipt).not.toBe(true)
    expect(syncReceiptSettled).toBe(false)
    if (syncReceipt === undefined || syncReceipt === true) {
      throw new Error(`restarted sync receipt was not parked`)
    }
    expect(syncReceipt).toBeInstanceOf(Promise)
    expect(syncReceiptOutcome).toBeDefined()
    expect(rollbackMutation).toBeDefined()
    await Promise.resolve()
    expect(syncReceiptSettled).toBe(false)
    expect(settlementTimeline).toEqual([])

    rollbackMutation?.()
    expect(publications).toEqual(expectedPublications)
    expect(syncReceiptSettled).toBe(false)
    await expect(syncReceiptOutcome).resolves.toBeUndefined()
    expect(syncReceiptSettled).toBe(true)
    expect(settlementTimeline).toEqual([`publication`, `receipt`])
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

it(`revalidates canceled-delete dependents in one queued-work pass`, async () => {
  const rowCount = 64
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: index + 10,
    value: 0,
  }))
  await withParkedSync(
    [...rows, { id: 5000, value: 0 }],
    async ({ collection, sync, releasePersistence }) => {
      const controller = new AbortController()
      sync.begin()
      for (const row of rows) sync.write({ type: `delete`, key: row.id })
      const deleteReceipt = sync.commit(controller.signal)
      if (deleteReceipt === true) throw new Error(`delete was not queued`)
      const deleteOutcome = deleteReceipt.then(
        () => `fulfilled` as const,
        (error: unknown) =>
          error instanceof SyncTransactionAbortedError
            ? (`aborted` as const)
            : (`other-error` as const),
      )

      const insertOutcomes: Array<Promise<`fulfilled` | `duplicate`>> = []
      for (const row of rows) {
        sync.begin()
        sync.write({ type: `update`, value: { id: 5000, value: row.id } })
        sync.write({
          type: `insert`,
          value: { id: row.id, value: row.value + 1 },
        })
        const receipt = sync.commit()
        if (receipt === true) throw new Error(`dependent insert was not queued`)
        insertOutcomes.push(
          receipt.then(
            () => `fulfilled` as const,
            (error: unknown) => {
              if (!(error instanceof DuplicateKeySyncError)) throw error
              return `duplicate` as const
            },
          ),
        )
      }

      sync.begin()
      sync.write({ type: `insert`, value: { id: 1000, value: 7 } })
      const siblingReceipt = sync.commit()
      if (siblingReceipt === true) throw new Error(`sibling was not queued`)

      let inspectedQueueEntries = 0
      const pending = collection._state.pendingSyncedTransactions
      collection._state.pendingSyncedTransactions = new Proxy(pending, {
        get(target, property, receiver) {
          if (typeof property === `string` && /^\d+$/.test(property)) {
            inspectedQueueEntries++
          }
          return Reflect.get(target, property, receiver)
        },
      })

      controller.abort()
      expect(inspectedQueueEntries).toBeLessThanOrEqual(rowCount * 8)
      await releasePersistence()
      expect(await deleteOutcome).toBe(`aborted`)
      expect(await Promise.all(insertOutcomes)).toEqual(
        Array(rowCount).fill(`duplicate`),
      )
      await siblingReceipt
      for (const row of rows) {
        expect(collection.get(row.id)?.value).toBe(row.value)
      }
      expect(collection.get(5000)?.value).toBe(0)
      expect(collection.get(1000)?.value).toBe(7)
    },
  )
})

it(`reports an invalidated open transaction on its applied receipt after another write`, async () => {
  await withParkedSync(
    [{ id: 1, value: 0 }],
    async ({ collection, sync, releasePersistence }) => {
      const controller = new AbortController()
      sync.begin()
      sync.write({ type: `delete`, key: 1 })
      const deleteReceipt = sync.commit(controller.signal)
      if (deleteReceipt === true) throw new Error(`delete was not queued`)

      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 2 } })
      controller.abort()

      expect(() =>
        sync.write({ type: `insert`, value: { id: 1, value: 3 } }),
      ).not.toThrow()
      const insertReceipt = sync.commit()
      if (insertReceipt === true)
        throw new Error(`invalidated insert did not return a receipt`)

      await releasePersistence()
      await expect(deleteReceipt).rejects.toBeInstanceOf(
        SyncTransactionAbortedError,
      )
      await expect(insertReceipt).rejects.toBeInstanceOf(DuplicateKeySyncError)
      expect(collection.get(1)?.value).toBe(0)
    },
  )
})

it(`retires a committed-invalid transaction found by projection refresh`, async () => {
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
    collectionMetadataWrites: new Map(),
    applied,
    duplicateKeyError: (key: number) =>
      new DuplicateKeySyncError(key, collection.id),
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
      DuplicateKeySyncError,
    )
    expect(collection._state.pendingSyncedTransactions).toContain(valid)
    expect(collection._state.pendingSyncedTransactions).not.toContain(pending)
    expect(applied.isPending()).toBe(false)
    await expect(applied.promise).rejects.toBeInstanceOf(DuplicateKeySyncError)
    expect(
      collection._state.classifyPendingSyncedInsert(2, { id: 2, value: 3 }),
    ).toBe(`duplicate`)
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
    const receipt = sync.commit()
    expect(receipt, `persisting work queues sync`).not.toBe(true)
    if (receipt === true) throw new Error(`sync was not queued`)
    void receipt.catch(() => undefined)
    receipts.push(receipt)
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

it.each([
  {
    label: `an identical echo`,
    insertedValue: 0,
    hydrationSeed: false,
  },
  {
    label: `a hydration replacement`,
    insertedValue: 2,
    hydrationSeed: true,
  },
] as const)(
  `keeps $label valid when its prerequisite delete is canceled`,
  async ({ insertedValue, hydrationSeed }) => {
    await withParkedSync(
      [{ id: 1, value: 0 }],
      async ({ collection, sync, releasePersistence }) => {
        if (hydrationSeed) collection._state.hydrationSeedKeys.add(1)
        collection._state.syncedMetadata.set(1, { source: `retained` })

        const deleteController = new AbortController()
        sync.begin()
        sync.write({ type: `delete`, key: 1 })
        const deleteReceipt = sync.commit(deleteController.signal)
        if (deleteReceipt === true) throw new Error(`delete was not queued`)

        sync.begin()
        sync.write({
          type: `insert`,
          value: { id: 1, value: insertedValue },
        })
        const insertReceipt = sync.commit()
        if (insertReceipt === true) throw new Error(`insert was not queued`)

        deleteController.abort()
        await releasePersistence()
        const [deleteOutcome, insertOutcome] = await Promise.all([
          deleteReceipt.then(
            () => `fulfilled` as const,
            (error: unknown) =>
              error instanceof SyncTransactionAbortedError
                ? (`aborted` as const)
                : (`other-error` as const),
          ),
          insertReceipt.then(
            () => `fulfilled` as const,
            () => `rejected` as const,
          ),
        ])

        expect({
          deleteOutcome,
          insertOutcome,
          retainedSourceValue: collection._state.syncedData.get(1)?.value,
          retainedMetadata: collection._state.syncedMetadata.get(1),
          publicValue: collection.get(1)?.value,
        }).toEqual({
          deleteOutcome: `aborted`,
          insertOutcome: `fulfilled`,
          retainedSourceValue: insertedValue,
          retainedMetadata: { source: `retained` },
          publicValue: insertedValue,
        })
      },
    )
  },
)

it(`keeps an invalidated active transaction addressable until commit`, async () => {
  await withParkedSync(
    [{ id: 1, value: 0 }],
    async ({ collection, sync, releasePersistence }) => {
      const deleteController = new AbortController()
      sync.begin()
      sync.write({ type: `delete`, key: 1 })
      const deleteReceipt = sync.commit(deleteController.signal)
      if (deleteReceipt === true) throw new Error(`delete was not queued`)

      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 2 } })
      deleteController.abort()

      let insertReceipt: true | Promise<void> | undefined
      expect(() => {
        insertReceipt = sync.commit()
      }).not.toThrow()
      if (insertReceipt === true || insertReceipt === undefined)
        throw new Error(`invalidated insert did not return a queued receipt`)

      await releasePersistence()
      const [deleteOutcome, insertOutcome] = await Promise.all([
        deleteReceipt.then(
          () => `fulfilled` as const,
          (error: unknown) =>
            error instanceof SyncTransactionAbortedError
              ? (`aborted` as const)
              : (`other-error` as const),
        ),
        insertReceipt.then(
          () => `fulfilled` as const,
          (error: unknown) =>
            error instanceof DuplicateKeySyncError
              ? (`duplicate` as const)
              : (`other-error` as const),
        ),
      ])

      expect({
        deleteOutcome,
        insertOutcome,
        retainedSourceValue: collection._state.syncedData.get(1)?.value,
        publicValue: collection.get(1)?.value,
      }).toEqual({
        deleteOutcome: `aborted`,
        insertOutcome: `duplicate`,
        retainedSourceValue: 0,
        publicValue: 0,
      })
    },
  )
})

it.each([`committed`, `open`] as const)(
  `cancels a %s update whose queued source insert is canceled`,
  async (updatePhase) => {
    // The update was admitted with a source row supplied by the queued insert.
    // Canceling that insert cancels its dependent update, rather than turning
    // the update into an unrelated missing-key upsert.
    await withParkedSync(
      [],
      async ({ collection, sync, releasePersistence }) => {
        const insertController = new AbortController()
        sync.begin()
        sync.write({ type: `insert`, value: { id: 1, value: 1 } })
        const insertReceipt = sync.commit(insertController.signal)
        if (insertReceipt === true) throw new Error(`insert was not queued`)

        sync.begin()
        sync.write({ type: `update`, value: { id: 1, value: 2 } })
        let updateReceipt: true | Promise<void> | undefined
        if (updatePhase === `committed`) {
          updateReceipt = sync.commit()
          if (updateReceipt === true) throw new Error(`update was not queued`)
        }

        insertController.abort()
        if (updatePhase === `open`) {
          updateReceipt = sync.commit()
          if (updateReceipt === true) throw new Error(`update was not queued`)
        }
        const pendingUpdateReceipt = updateReceipt
        if (pendingUpdateReceipt === undefined || pendingUpdateReceipt === true)
          throw new Error(`missing queued update receipt`)

        await releasePersistence()
        const [insertOutcome, updateOutcome] = await Promise.all([
          insertReceipt.then(
            () => `fulfilled` as const,
            (error: unknown) =>
              error instanceof SyncTransactionAbortedError
                ? (`aborted` as const)
                : (`other-error` as const),
          ),
          pendingUpdateReceipt.then(
            () => `fulfilled` as const,
            (error: unknown) =>
              error instanceof SyncTransactionAbortedError
                ? (`aborted` as const)
                : (`other-error` as const),
          ),
        ])
        expect({
          insertOutcome,
          updateOutcome,
          retainedRow: collection._state.syncedData.get(1),
          publicRow: collection.get(1),
        }).toEqual({
          insertOutcome: `aborted`,
          updateOutcome: `aborted`,
          retainedRow: undefined,
          publicRow: undefined,
        })

        sync.begin()
        sync.write({ type: `insert`, value: { id: 1, value: 3 } })
        expect(sync.commit()).toBe(true)
        expect(collection._state.syncedData.get(1)).toEqual({ id: 1, value: 3 })
        expect(collection.get(1)?.value).toBe(3)
      },
      `partial`,
    )
  },
)

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
      if (receipt === true) throw new Error(`sync was not queued`)
      await releasePersistence()
      await receipt
      expect(collection._state.syncedData.get(1)).toEqual({ id: 1, value: 2 })
      expect(collection.get(1)?.value).toBe(2)
    },
    `partial`,
  )
})

/**
 * A queued partial update depends on the row it observed at admission. If that
 * row came only from canceled queued work, the update's whole transaction is
 * canceled. An absent-row upsert and a full-row update remain independent.
 *
 * The reference below uses only the declared source history: a retained row
 * survives cancellation, while a queued insert or upsert does not. It does
 * not inspect the collection's pending projection or operation classifier.
 * The grammar varies source ownership, update mode, cancellation timing,
 * receipt phase, and row values. The driver parks adapter transactions behind
 * an unrelated persisting mutation; the refinement compares both receipts,
 * retained source rows, and public rows after the drain. It does not claim
 * arbitrary nested begin/commit behavior or persistence-wrapper replay.
 */
type QueuedUpdateDependencyScenario = {
  source: `queued-insert` | `queued-upsert` | `retained`
  updateMode: `partial` | `full`
  cancelSource: boolean
  updatePhase: `committed` | `open`
  sourceValue: number
  updateValue: number
}

const queuedUpdateDependencyScenario = fc.record({
  source: fc.constantFrom(
    `queued-insert` as const,
    `queued-upsert` as const,
    `retained` as const,
  ),
  updateMode: fc.constantFrom(`partial` as const, `full` as const),
  cancelSource: fc.boolean(),
  updatePhase: fc.constantFrom(`committed` as const, `open` as const),
  sourceValue: fc.integer({ min: -2, max: 2 }),
  updateValue: fc.integer({ min: -2, max: 2 }),
})

async function runQueuedUpdateDependencyScenario(
  scenario: QueuedUpdateDependencyScenario,
): Promise<void> {
  const sourceRow = {
    id: 1,
    value: scenario.sourceValue,
    stable: `base`,
  }
  const losesRequiredRow =
    scenario.cancelSource &&
    scenario.source !== `retained` &&
    scenario.updateMode === `partial`
  const expectedRow = losesRequiredRow
    ? undefined
    : {
        id: 1,
        value: scenario.updateValue,
        stable: scenario.updateMode === `full` ? `replacement` : `base`,
      }

  await withParkedSync(
    scenario.source === `retained` ? [sourceRow] : [],
    async ({ collection, sync, releasePersistence }) => {
      const sourceController = new AbortController()
      sync.begin()
      sync.write({
        type: scenario.source === `queued-insert` ? `insert` : `update`,
        value: sourceRow,
      })
      const sourceReceipt = sync.commit(sourceController.signal)
      if (sourceReceipt === true) throw new Error(`source was not queued`)

      sync.begin()
      const updateRow =
        scenario.updateMode === `full`
          ? { id: 1, value: scenario.updateValue, stable: `replacement` }
          : { id: 1, value: scenario.updateValue }
      sync.write({ type: `update`, value: updateRow })
      let updateReceipt: true | Promise<void> | undefined
      if (scenario.updatePhase === `committed`) {
        updateReceipt = sync.commit()
        if (updateReceipt === true) throw new Error(`update was not queued`)
      }

      if (scenario.cancelSource) sourceController.abort()
      if (scenario.updatePhase === `open`) {
        updateReceipt = sync.commit()
        if (updateReceipt === true) throw new Error(`update was not queued`)
      }
      const pendingUpdateReceipt = updateReceipt
      if (pendingUpdateReceipt === undefined || pendingUpdateReceipt === true)
        throw new Error(`missing queued update receipt`)

      await releasePersistence()
      const [sourceOutcome, updateOutcome] = await Promise.all([
        sourceReceipt.then(
          () => `fulfilled` as const,
          (error: unknown) =>
            error instanceof SyncTransactionAbortedError
              ? (`aborted` as const)
              : (`other-error` as const),
        ),
        pendingUpdateReceipt.then(
          () => `fulfilled` as const,
          (error: unknown) =>
            error instanceof SyncTransactionAbortedError
              ? (`aborted` as const)
              : (`other-error` as const),
        ),
      ])
      const publicRow = collection.get(1)

      expect({
        sourceOutcome,
        updateOutcome,
        retainedRow: collection._state.syncedData.get(1),
        publicRow:
          publicRow === undefined
            ? undefined
            : {
                id: publicRow.id,
                value: publicRow.value,
                stable: `stable` in publicRow ? publicRow.stable : undefined,
              },
      }).toEqual({
        sourceOutcome: scenario.cancelSource ? `aborted` : `fulfilled`,
        updateOutcome: losesRequiredRow ? `aborted` : `fulfilled`,
        retainedRow: expectedRow,
        publicRow: expectedRow,
      })
    },
    scenario.updateMode,
  )
}

it(`covers the queued-update dependency grammar's source, mode, cancel, and receipt cuts`, async () => {
  for (const source of [
    `queued-insert`,
    `queued-upsert`,
    `retained`,
  ] as const) {
    for (const updateMode of [`partial`, `full`] as const) {
      for (const cancelSource of [false, true]) {
        for (const updatePhase of [`committed`, `open`] as const) {
          await runQueuedUpdateDependencyScenario({
            source,
            updateMode,
            cancelSource,
            updatePhase,
            sourceValue: 1,
            updateValue: 2,
          })
        }
      }
    }
  }
})

fcTest.prop([queuedUpdateDependencyScenario], {
  numRuns: oracleRuns(100),
  seed: 190_201,
})(
  `preserves queued update dependencies with a fixed seed`,
  async (scenario) => {
    await runQueuedUpdateDependencyScenario(scenario)
  },
)
fcTest.prop(
  [queuedUpdateDependencyScenario],
  oraclePropertyOptions(100, `collection-state.queued-update-dependency`),
)(
  `preserves queued update dependencies with a random or replayed seed`,
  async (scenario) => {
    await runQueuedUpdateDependencyScenario(scenario)
  },
)

it(`cancels a dependent transaction atomically and its downstream update`, async () => {
  await withParkedSync(
    [],
    async ({ collection, sync, releasePersistence }) => {
      const sourceController = new AbortController()
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 1 } })
      const sourceReceipt = sync.commit(sourceController.signal)
      if (sourceReceipt === true) throw new Error(`source was not queued`)

      sync.begin()
      sync.write({ type: `update`, value: { id: 1, value: 2 } })
      sync.write({ type: `insert`, value: { id: 3, value: 3 } })
      const dependentReceipt = sync.commit()
      if (dependentReceipt === true) throw new Error(`dependent was not queued`)

      sync.begin()
      sync.write({ type: `update`, value: { id: 3, value: 4 } })
      const downstreamReceipt = sync.commit()
      if (downstreamReceipt === true)
        throw new Error(`downstream was not queued`)

      sourceController.abort()
      await releasePersistence()
      const outcomes = await Promise.all(
        [sourceReceipt, dependentReceipt, downstreamReceipt].map((receipt) =>
          receipt.then(
            () => `fulfilled` as const,
            (error: unknown) =>
              error instanceof SyncTransactionAbortedError
                ? (`aborted` as const)
                : (`other-error` as const),
          ),
        ),
      )
      expect(outcomes).toEqual([`aborted`, `aborted`, `aborted`])
      expect(collection._state.syncedData.has(1)).toBe(false)
      expect(collection._state.syncedData.has(3)).toBe(false)
      expect(collection.has(1)).toBe(false)
      expect(collection.has(3)).toBe(false)

      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 5 } })
      sync.write({ type: `insert`, value: { id: 3, value: 6 } })
      expect(sync.commit()).toBe(true)
      expect(collection._state.syncedData.get(1)?.value).toBe(5)
      expect(collection._state.syncedData.get(3)?.value).toBe(6)
    },
    `partial`,
  )
})

it(`keeps an update when a surviving insert echo replaces its canceled base`, async () => {
  await withParkedSync(
    [],
    async ({ collection, sync, releasePersistence }) => {
      const firstController = new AbortController()
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 1 } })
      const firstReceipt = sync.commit(firstController.signal)
      if (firstReceipt === true) throw new Error(`first insert was not queued`)

      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 1 } })
      const echoReceipt = sync.commit()
      if (echoReceipt === true) throw new Error(`echo was not queued`)

      sync.begin()
      sync.write({ type: `update`, value: { id: 1, value: 2 } })
      const updateReceipt = sync.commit()
      if (updateReceipt === true) throw new Error(`update was not queued`)

      firstController.abort()
      await releasePersistence()
      await expect(firstReceipt).rejects.toBeInstanceOf(
        SyncTransactionAbortedError,
      )
      await Promise.all([echoReceipt, updateReceipt])
      expect(collection._state.syncedData.get(1)).toEqual({ id: 1, value: 2 })
      expect(collection.get(1)?.value).toBe(2)
    },
    `partial`,
  )
})

it(`keeps an update begun after an earlier insert was canceled as an upsert`, async () => {
  await withParkedSync(
    [],
    async ({ collection, sync, releasePersistence }) => {
      const firstController = new AbortController()
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 1 } })
      const firstReceipt = sync.commit(firstController.signal)
      if (firstReceipt === true) throw new Error(`first insert was not queued`)

      firstController.abort()
      sync.begin()
      sync.write({ type: `update`, value: { id: 1, value: 2 } })
      const updateReceipt = sync.commit()
      if (updateReceipt === true) throw new Error(`update was not queued`)

      await releasePersistence()
      await expect(firstReceipt).rejects.toBeInstanceOf(
        SyncTransactionAbortedError,
      )
      await updateReceipt
      expect(collection._state.syncedData.get(1)).toEqual({ id: 1, value: 2 })
      expect(collection.get(1)?.value).toBe(2)
    },
    `partial`,
  )
})

it.each([`retained source row`, `earlier queued insert`] as const)(
  `revalidates a queued insert when its prerequisite delete is canceled: %s`,
  async (predecessor) => {
    // Law: canceling a sync transaction before application abandons its writes.
    // The independent source Map therefore retains row 1, making the later
    // insert a duplicate. The production driver parks both receipts behind an
    // unrelated mutation, cancels the delete, then observes receipt settlement
    // and retained source/public rows after the mutation releases the drain.
    await withParkedSync(
      predecessor === `retained source row` ? [{ id: 1, value: 0 }] : [],
      async ({ collection, sync, releasePersistence }) => {
        let predecessorReceipt: Promise<void> | undefined
        if (predecessor === `earlier queued insert`) {
          sync.begin()
          sync.write({ type: `insert`, value: { id: 1, value: 0 } })
          const pendingPredecessor = sync.commit()
          if (pendingPredecessor === true)
            throw new Error(`predecessor was not queued`)
          predecessorReceipt = pendingPredecessor
        }

        const deleteController = new AbortController()
        sync.begin()
        sync.write({ type: `delete`, key: 1 })
        const deleteReceipt = sync.commit(deleteController.signal)
        if (deleteReceipt === true) throw new Error(`delete was not queued`)

        sync.begin()
        sync.write({ type: `insert`, value: { id: 1, value: 2 } })
        const insertReceipt = sync.commit()
        if (insertReceipt === true) throw new Error(`insert was not queued`)

        deleteController.abort()
        await releasePersistence()
        await predecessorReceipt
        const [deleteOutcome, insertOutcome] = await Promise.all([
          deleteReceipt.then(
            () => `fulfilled` as const,
            (error: unknown) =>
              error instanceof SyncTransactionAbortedError
                ? (`aborted` as const)
                : (`other-error` as const),
          ),
          insertReceipt.then(
            () => `fulfilled` as const,
            (error: unknown) =>
              error instanceof DuplicateKeySyncError
                ? (`duplicate` as const)
                : (`other-error` as const),
          ),
        ])

        expect({
          deleteOutcome,
          insertOutcome,
          retainedSourceValue: collection._state.syncedData.get(1)?.value,
          publicValue: collection.get(1)?.value,
        }).toEqual({
          deleteOutcome: `aborted`,
          insertOutcome: `duplicate`,
          retainedSourceValue: 0,
          publicValue: 0,
        })
      },
    )
  },
)

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
          if (firstReceipt === true)
            throw new Error(`first insert was not queued`)
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

    sync.begin({ immediate: true })
    sync.write({
      type: `update`,
      value: { id: 1, value: 1 },
      previousValue: { id: 1, value: 0 },
    })
    expect(sync.commit(), `hidden authoritative update applies`).toBe(true)
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
const optimisticStep: fc.Arbitrary<OptimisticStep> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`delete` as const),
      key: fc.integer({ min: 1, max: 3 }),
      optimistic: fc.boolean(),
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
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`sync` as const),
      rows: fc.uniqueArray(historyRow, {
        selector: (row) => row.id,
        maxLength: 3,
      }),
      truncate: fc.boolean(),
      immediate: fc.boolean(),
      copies: fc.integer({ min: 1, max: 2 }),
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
  `retains direct deletion across replacement and later sync: %j`,
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
        immediate: false,
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
        immediate: false,
        copies: 1,
      },
    ]
    const counts = await runOptimisticHistory([row], steps)
    expect(counts.deletes).toBe(1)
    expect(counts.settlements).toBe(reinsert ? 2 : 1)
  },
)

it(`generates direct delete actions`, () => {
  const commands = fc.sample(optimisticStep, { seed: 86104, numRuns: 100 })
  expect(commands.some((step) => step.type === `delete`)).toBe(true)
})

const defaultHistory = (
  truncate: boolean,
  success: boolean,
): Array<OptimisticStep> => [
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  { type: `edit`, key: 1, fields: { b: 2 }, optimistic: true },
  { type: `settle`, slot: 1, success: true, cascade: false },
  { type: `sync`, rows: [], truncate, immediate: false, copies: 1 },
  { type: `settle`, slot: 0, success, cascade: false },
]
it.each(
  [false, true].flatMap((truncate) =>
    [false, true].map((success) => ({ truncate, success })),
  ),
)(
  `retains validated defaults independently from authored fields: %j`,
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
  `retains an accepted snapshot with truncate $timing (seed $seed)`,
  async ({ timing, seed }) => {
    await fc.assert(
      fc.asyncProperty(historyRow, fc.boolean(), async (row, reject) => {
        const truncate: OptimisticStep = {
          type: `sync`,
          rows: [],
          truncate: true,
          immediate: false,
          copies: 1,
        }
        const counts = await runOptimisticHistory(
          [],
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
            // Ordinary sync may retire the completed local snapshot. Preserve
            // that boundary and later key reuse, not an immortal local row.
            {
              type: `sync`,
              rows: [],
              truncate: false,
              immediate: false,
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
        expect(counts.deletes).toBe(1)
        expect(counts.settlements).toBe(3)
      }),
      seed === undefined
        ? oraclePropertyOptions(30, acceptedSnapshotReplayProperty[timing])
        : { seed, numRuns: oracleRuns(30) },
    )
  },
)

it(`retires a completed direct insert that started after truncate capture`, async () => {
  // Law: truncate may preserve only optimistic state present in its captured
  // snapshot. A later completed direct insert has no support in the rebuilt
  // source and must not return during an unrelated recomputation.
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

    expect(events).toEqual([`insert:1`, `delete:1`, `insert:2`])
    expect([...collection.state.keys()]).toEqual([2])
    expect([...collection._state.syncedData.keys()]).toEqual([])
    expect([...collection._state.pendingOptimisticUpserts.keys()]).toEqual([2])
    expect([...collection._state.pendingOptimisticDirectUpserts]).toEqual([2])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it.each([true, false])(
  `replays insert dependency settlement, accepted=%s`,
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
  `preserves a whole-row mutation snapshot across sync, truncate=%s`,
  async (truncate) => {
    await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 0 }],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
        {
          type: `sync`,
          rows: [{ id: 1, a: 0, b: 2, c: 3 }],
          immediate: !truncate,
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
      { type: `sync`, rows: [], truncate: false, immediate: false, copies: 1 },
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
      { type: `sync`, rows: [], truncate: false, immediate: false, copies: 1 },
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
// The accepted delete survives a dependent reinsert's failure regardless of
// whether the delete or the dependent edit settles first. A successful reinsert
// instead leaves the accepted edit visible. Truncate must preserve both laws.
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
  `retains accepted delete and dependent edit across settlement orders: %j`,
  async ({ truncate, editSettlesFirst, insertAccepted }) => {
    const replacement: OptimisticStep = {
      type: `sync`,
      rows: [],
      truncate: true,
      immediate: false,
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
      dependencies: 1,
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
