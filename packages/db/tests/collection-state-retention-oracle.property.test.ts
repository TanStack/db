import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DuplicateKeySyncError } from '../src/errors.js'
import { createTransaction } from '../src/transactions.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { runOptimisticHistory } from './optimistic-history-oracle.js'
import type { OptimisticStep } from './optimistic-history-oracle.js'
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
  const retainedRows = [...collection._state.syncedData.entries()].sort(
    ([a], [b]) => a - b,
  )

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
          throw new Error(`restarted sync session was not captured`)
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
            // earlier initial state. Restart retracts its known old-session row.
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

it.each(
  ([`insert`, `update`] as const).flatMap((triggerType) =>
    ([`insideListener`, `afterOldReturn`] as const).map(
      (commitPhase) => [triggerType, commitPhase] as const,
    ),
  ),
)(
  `retains an old-session %s and a restarted row committed %s`,
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
  type ObservedRow = RetainedRow & {
    $collectionId: string
    $key: number
    $origin: `local` | `remote`
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
      $synced: true,
    })
    const localRow = (id: number): ObservedRow => ({
      id,
      value: id,
      $collectionId: collection.id,
      $key: id,
      $origin: `local`,
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
    { includeInitialState: false },
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

it(`does not carry previous-value state across a failed sync session`, async () => {
  let sync!: Parameters<SyncConfig<LivePreviousRow, number>[`sync`]>[0]
  let session = 0
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
        session++
        actions.begin()
        if (session === 1) {
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
    expect(session, `replacement sync session started`).toBe(2)
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

fcTest.prop(
  [fc.array(retentionActionArbitrary, { minLength: 1, maxLength: 20 })],
  oraclePropertyOptions(100, `collection-state.retention`),
)(
  `matches retained authoritative state without optimistic overlays after every committed sync history`,
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
it.each(
  [`before delete`, `during delete`, `after rollback`].flatMap((timing) =>
    [86105, undefined].map((seed) => ({ timing, seed })),
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
      { seed, numRuns: oracleRuns(30) },
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
fcTest.prop([optimisticHistory], { numRuns: oracleRuns(60), seed: 86103 })(
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
