/**
 * Ordinary regression tests for retained collection state: sync-run
 * restarts, publication state, queued transactions, and live previous values.
 * The law of retained state is owned by
 * collection-state-retention-oracle.property.test.ts, which runs the
 * generated and replayed histories against its model.
 */

import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import {
  DuplicateKeySyncError,
  SyncTransactionAlreadyCommittedWriteError,
} from '../src/errors.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createTransaction } from '../src/transactions.js'
import { whenSyncAccepted } from '../src/sync-receipt.js'
import {
  optimisticHistory,
  optimisticStep,
} from './optimistic-history-oracle.js'
import type {
  RetainedRow,
  SyncActions,
} from './collection-state-retention-fixture.js'
import type { CollectionChangesManager } from '../src/collection/changes.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig, TransactionState } from '../src/types.js'

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
      void transaction.when('settled').catch(() => undefined)
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
    })
    const localRow = (id: number): ObservedRow => ({
      id,
      value: id,
      $collectionId: collection.id,
      $key: id,
      $origin: `local`,
      $hasPendingWrites: true,
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

// A transaction begun inside an open one is independent and applies in
// commit order (maintainer decision B of 2026-10-23, recorded in
// docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md). When
// it commits first, it is accepted ahead of the open transaction, and replay
// keeps the operation kinds it was accepted with. Here the inner insert of
// row 1 was written over the open transaction's truncate. In commit order it
// lands over the applied row 1, and it still names the whole row: replay must
// not make it a duplicate, with or without a hold.
it.each([false, true])(
  `keeps an accepted insert when it commits ahead of an open truncate (held: %s)`,
  async (held) => {
    let sync!: Parameters<SyncConfig<RetainedRow, number>[`sync`]>[0]
    let release!: () => void
    const collection = createCollection<RetainedRow, number>({
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.write({ type: `insert`, value: { id: 1, value: 0 } })
          actions.write({ type: `insert`, value: { id: 2, value: 0 } })
          actions.commit()
          actions.markReady()
        },
      },
      onUpdate: () => new Promise<void>((resolve) => (release = resolve)),
    })
    try {
      await collection.stateWhenReady()
      const blocker = held
        ? collection.update(2, (draft) => {
            draft.value = 9
          })
        : undefined
      sync.begin()
      sync.truncate()
      sync.write({ type: `insert`, value: { id: 3, value: 1 } })
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 2 } })
      const inner = sync.commit()
      expect(collection._state.syncedData.get(1)?.value).toBe(held ? 0 : 2)
      // The truncate applies at once, after the inner transaction.
      expect(sync.commit()).toBe(true)
      await expect(Promise.resolve(inner)).resolves.not.toThrow()
      if (blocker) {
        release()
        await blocker.when('settled')
      }
      expect([...collection._state.syncedData.keys()]).toEqual([3])
      expect(collection._state.pendingSyncedTransactions).toHaveLength(0)
    } finally {
      await collection.cleanup()
    }
  },
)

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
            | (LivePreviousRow & {
                $hasPendingWrites: boolean
                $origin: string
              })
            | undefined
          return {
            type: change.type,
            value: change.value.value,
            previousValue: previous?.value,
            previousSynced: previous ? !previous.$hasPendingWrites : undefined,
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
    const persistence = optimistic.when('settled').catch((error) => error)
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
    await collection.insert({ id: 1, value: 1 }).when('settled')
    expect(sync.commit()).toBe(true)
    await collection.insert({ id: 2, value: 2 }).when('settled')

    expect(events).toEqual([`insert:1`, `delete:1`, `insert:2`, `delete:2`])
    expect([...collection.state.keys()]).toEqual([])
    expect([...collection._state.syncedData.keys()]).toEqual([])
    expect([...collection._state.heldOptimisticRows.keys()]).toEqual([])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})
