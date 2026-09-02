import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DuplicateKeySyncError } from '../src/errors.js'
import { createTransaction } from '../src/transactions.js'
import { oraclePropertyOptions } from './oracle-config.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig, TransactionState } from '../src/types.js'

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
    weight: 1,
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
        expect(() => sync.write({ type: `insert`, value: action.row })).toThrow(
          DuplicateKeySyncError,
        )
        break
      }
      sync.write({ type: `insert`, value: action.row })
      model.set(action.row.id, action.row)
      break
    }
    case `update`: {
      sync.write({ type: action.type, value: action.row })
      model.set(action.row.id, action.row)
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
        sync.write({ type: `insert`, value: row })
        model.set(row.id, row)
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
  const retainedRows = [...collection._state.syncedData.entries()].sort(
    ([a], [b]) => a - b,
  )

  expect(retainedRows).toEqual(expectedRows)
  expect([...collection._state.syncedKeys].sort((a, b) => a - b)).toEqual(
    expectedRows.map(([key]) => key),
  )
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
        const restartedRow = {
          id: (action.row.id + 1) % 4,
          value: action.row.value + 1,
        }
        const retainedMarker = { id: -1, value: action.row.value }
        let cleanup: Promise<void> | undefined
        let restarted = false
        let restartedSync: SyncActions | undefined
        let restartedReceipt: true | Promise<void> | undefined
        let restartedReceiptSettled = false
        const events: Array<{
          type: string
          key: string | number
          row: RetainedRow
        }> = []
        const subscription = collection.subscribeChanges(
          (changes) => {
            events.push(
              ...changes.map(({ type, key, value }) => ({
                type,
                key,
                row: { id: value.id, value: value.value },
              })),
            )
            if (restarted) return
            restarted = true
            cleanup = collection.cleanup()
            collection.startSyncImmediate()
            restartedSync = harness.sync
            restartedSync.begin()
            restartedSync.write({ type: `insert`, value: restartedRow })
            if (action.commitPhase === `insideListener`) {
              restartedReceipt = restartedSync.commit()
              if (restartedReceipt !== true) {
                void restartedReceipt.then(() => {
                  restartedReceiptSettled = true
                })
              }
            } else {
              collection._state.preSyncVisibleState.set(-1, retainedMarker)
              collection._state.recentlySyncedKeys.add(restartedRow.id)
            }
          },
          { includeInitialState: false },
        )

        oldSync.begin()
        oldSync.write({ type: `update`, value: triggerRow })
        expect(oldSync.commit()).toBe(true)
        expect(restarted).toBe(true)
        expect(restartedSync).toBeDefined()
        if (restartedSync === undefined) {
          throw new Error(`restarted sync session was not captured`)
        }
        if (action.commitPhase === `insideListener`) {
          expect(restartedReceipt).toBeDefined()
          expect(restartedReceipt).not.toBe(true)
          expect(restartedReceiptSettled).toBe(false)
          if (restartedReceipt === undefined || restartedReceipt === true) {
            throw new Error(`restarted sync receipt was not parked`)
          }
          await restartedReceipt
          expect(restartedReceiptSettled).toBe(true)
        } else {
          expect(collection._state.preSyncVisibleState).toEqual(
            new Map([[-1, retainedMarker]]),
          )
          expect(collection._state.recentlySyncedKeys).toEqual(
            new Set([restartedRow.id]),
          )
          expect(collection._state.hasReceivedFirstCommit).toBe(false)

          await Promise.resolve()
          expect(collection._state.preSyncVisibleState).toEqual(
            new Map([[-1, retainedMarker]]),
          )
          expect(collection._state.recentlySyncedKeys).toEqual(
            new Set([restartedRow.id]),
          )
          expect(collection._state.hasReceivedFirstCommit).toBe(false)

          expect(restartedSync.commit()).toBe(true)
          expect(collection._state.preSyncVisibleState.size).toBe(0)
          expect(collection._state.hasReceivedFirstCommit).toBe(true)
          await Promise.resolve()
          expect(collection._state.recentlySyncedKeys.size).toBe(0)
        }
        expect(events).toEqual([
          { type: triggerType, key: triggerRow.id, row: triggerRow },
          { type: `insert`, key: restartedRow.id, row: restartedRow },
        ])
        subscription.unsubscribe()

        await cleanup
        model.clear()
        model.set(restartedRow.id, restartedRow)
      } else {
        applyAction(action, model, harness.sync)
      }
      expectRetainedState(collection, model)
    }
  } finally {
    await collection.cleanup()
  }
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

it.each([`insideListener`, `afterOldReturn`] as const)(
  `retains a restarted row committed %s`,
  async (commitPhase) => {
    await runRetentionHistory([
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

it(`starts a new sync session without retained publication state`, async () => {
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
      recentKeys: collection._state.recentlySyncedKeys.size,
    }
    await cleanup

    events.length = 0
    collection.startSyncImmediate()
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 3 } })
    expect(sync.commit()).toBe(true)

    expect({ retainedAfterCleanup, events }).toEqual({
      retainedAfterCleanup: { visibleRows: 0, recentKeys: 0 },
      events: [{ type: `insert`, key: 1 }],
    })
  } finally {
    subscription?.unsubscribe()
    await collection.cleanup()
  }
})

it(`keeps a restarted session's publication state after the old listener returns`, async () => {
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
    expect(collection._state.recentlySyncedKeys.size).toBe(0)
    await cleanup
  } finally {
    await collection.cleanup()
  }
})

it(`publishes one insert when a restarted optimistic row is confirmed and rolled back`, async () => {
  let sync!: SyncActions
  let syncSession = 0
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
        syncSession++
        if (syncSession === 1) actions.markReady()
      },
    },
  })
  const events: Array<{ type: string; key: string | number }> = []
  const restartStatuses: Array<string> = []
  let restarted = false
  let readMutationState: (() => TransactionState) | undefined
  let mutationCommit: Promise<unknown> | undefined
  let syncReceipt: ReturnType<SyncActions[`commit`]> | undefined
  let syncReceiptSettled = false
  const subscription = collection.subscribeChanges(
    (changes) => {
      events.push(...changes.map(({ type, key }) => ({ type, key })))
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
      void transaction.isPersisted.promise.catch(() => undefined)
      transaction.mutate(() => collection.insert({ id: 2, value: 2 }))
      mutationCommit = transaction.commit()

      sync.begin()
      sync.write({ type: `insert`, value: { id: 2, value: 2 } })
      syncReceipt = sync.commit()
      if (syncReceipt !== true) {
        void syncReceipt.then(() => {
          syncReceiptSettled = true
        })
      }
      transaction.rollback()
    },
    { includeInitialState: false },
  )

  try {
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, value: 1 } })
    expect(sync.commit()).toBe(true)

    expect(events).toEqual([
      { type: `insert`, key: 1 },
      { type: `insert`, key: 2 },
    ])
    expect([...collection.state.keys()]).toEqual([2])
    expect(restartStatuses).toEqual([`ready`, `cleaned-up`, `loading`, `ready`])
    expect(collection.status).toBe(`ready`)

    expect(syncReceipt).toBeDefined()
    expect(syncReceipt).not.toBe(true)
    expect(syncReceiptSettled).toBe(false)
    if (syncReceipt === undefined || syncReceipt === true) {
      throw new Error(`restarted sync receipt was not parked`)
    }
    await syncReceipt
    expect(syncReceiptSettled).toBe(true)
    expect(events).toEqual([
      { type: `insert`, key: 1 },
      { type: `insert`, key: 2 },
    ])
    expect([...collection.state.keys()]).toEqual([2])

    releaseMutation()
    await mutationCommit
    expect(readMutationState?.()).toBe(`failed`)
    expect(events).toEqual([
      { type: `insert`, key: 1 },
      { type: `insert`, key: 2 },
    ])
    expect([...collection.state.keys()]).toEqual([2])
  } finally {
    releaseMutation()
    await mutationCommit
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

fcTest.prop(
  [fc.array(retentionActionArbitrary, { minLength: 1, maxLength: 20 })],
  oraclePropertyOptions(100, `collection-state.retention`),
)(
  `matches retained authoritative state without optimistic overlays after every committed sync history`,
  async (actions) => {
    await runRetentionHistory(actions)
  },
)
