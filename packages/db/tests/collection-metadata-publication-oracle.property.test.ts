import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { SyncTransactionAbortedError } from '../src/errors.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { createTransaction } from '../src/transactions.js'
import { oraclePropertyOptions } from './oracle-config.js'
import type { Collection } from '../src/collection/index.js'
import type { ChangeMessage, SyncConfig } from '../src/types.js'

type PublicationRow = {
  id: number
  position: number
}

type SyncActions = Parameters<SyncConfig<PublicationRow, number>[`sync`]>[0]

type MetadataOperation = { type: `set`; value: unknown } | { type: `delete` }

type MetadataEntryState = { present: false } | { present: true; value: unknown }

type MetadataWrite = { key: number } & MetadataOperation

type PublicationRound = {
  key: number
  delta: number
  metadata: ReadonlyArray<MetadataWrite>
  outcome: `commit` | `abort`
}

type ReadablePublicationCollection = {
  values: () => IterableIterator<PublicationRow>
  cleanup: () => Promise<void>
}

type PublicationHarness = {
  rows: Collection<PublicationRow, number>
  liveRows: ReadablePublicationCollection
  batches: Array<Array<ChangeMessage<PublicationRow, string | number>>>
  unsubscribe: () => void
  getSync: () => SyncActions
}

type PublishedPublicationRow = PublicationRow & {
  $collectionId: string
  $key: number
  $origin: `local` | `remote`
  $synced: boolean
}

const metadataValueArbitrary = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(false),
  fc.constant(true),
  fc.constant(0),
  fc.constant(Number.NaN),
  fc.constant(``),
  fc.integer(),
  fc.string(),
  fc.record({ nested: fc.integer() }),
)

const metadataOperationArbitrary: fc.Arbitrary<MetadataOperation> = fc.oneof(
  metadataValueArbitrary.map((value) => ({ type: `set` as const, value })),
  fc.constant({ type: `delete` as const }),
)

const metadataEntryStateArbitrary: fc.Arbitrary<MetadataEntryState> = fc.oneof(
  fc.constant({ present: false as const }),
  metadataValueArbitrary.map((value) => ({
    present: true as const,
    value,
  })),
)

const metadataWriteArbitrary = fc
  .tuple(fc.integer({ min: 0, max: 2 }), metadataOperationArbitrary)
  .map(([key, operation]) => ({ key, ...operation }))

const publicationRoundArbitrary: fc.Arbitrary<PublicationRound> = fc
  .record({
    key: fc.integer({ min: 0, max: 2 }),
    delta: fc.constantFrom(-2, -1, 1, 2),
    extraMetadata: fc.array(metadataWriteArbitrary, { maxLength: 2 }),
    outcome: fc.constantFrom(`commit` as const, `abort` as const),
    primaryMetadata: metadataOperationArbitrary,
  })
  .map(({ key, delta, extraMetadata, outcome, primaryMetadata }) => ({
    key,
    delta,
    outcome,
    metadata: [{ key, ...primaryMetadata }, ...extraMetadata],
  }))

const metadataCancellationArbitrary = fc.record({
  canceledKeys: fc.uniqueArray(fc.integer({ min: 0, max: 2 }), {
    minLength: 1,
    maxLength: 3,
  }),
  retainedKeys: fc.uniqueArray(fc.integer({ min: 0, max: 2 }), {
    minLength: 1,
    maxLength: 3,
  }),
  canceledOperation: metadataOperationArbitrary,
  retainedOperation: metadataOperationArbitrary,
  canceledFirst: fc.boolean(),
  initialMetadata: fc.array(metadataEntryStateArbitrary, {
    minLength: 3,
    maxLength: 3,
  }),
})

const metadataRollbackCaseArbitrary = fc.record({
  initialMetadata: metadataEntryStateArbitrary,
  pendingOperation: metadataOperationArbitrary,
})

const metadataRollbackArbitrary = fc
  .record({
    sourceKey: fc.integer({ min: 0, max: 2 }),
    metadataKeyOffset: fc.constantFrom(1, 2),
    sourceDelta: fc.integer({ min: 1, max: 10 }),
    metadataCase: metadataRollbackCaseArbitrary,
  })
  .map(({ sourceKey, metadataKeyOffset, sourceDelta, metadataCase }) => ({
    ...metadataCase,
    sourceKey,
    metadataKey: (sourceKey + metadataKeyOffset) % 3,
    sourceDelta,
  }))

let nextMetadataRollbackHarnessId = 0

async function createPublicationHarness(): Promise<PublicationHarness> {
  let sync!: SyncActions
  const rows = createCollection<PublicationRow, number>({
    id: `metadata-publication-source`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        for (let id = 0; id < 3; id++) {
          actions.write({ type: `insert`, value: { id, position: id } })
        }
        actions.commit()
        actions.markReady()
      },
    },
  })
  const liveRows = createLiveQueryCollection((query) =>
    query.from({ row: rows }),
  )
  await liveRows.preload()

  const batches: Array<Array<ChangeMessage<PublicationRow, string | number>>> =
    []
  const subscription = rows.subscribeChanges((changes) => {
    batches.push(changes)
  })
  return {
    rows,
    liveRows,
    batches,
    unsubscribe: () => subscription.unsubscribe(),
    getSync: () => sync,
  }
}

function expectUniqueBatchKeys(
  batches: ReadonlyArray<
    ReadonlyArray<ChangeMessage<PublicationRow, string | number>>
  >,
): void {
  for (const batch of batches) {
    const keys = batch.map((change) => change.key)
    expect(keys).toEqual([...new Set(keys)])
  }
}

function selectPublishedRow(
  row: PublicationRow | undefined,
): PublishedPublicationRow | undefined {
  if (row === undefined) return undefined
  const published = row as PublishedPublicationRow
  return {
    id: published.id,
    position: published.position,
    $collectionId: published.$collectionId,
    $key: published.$key,
    $origin: published.$origin,
    $synced: published.$synced,
  }
}

function selectPublishedChange(
  change: ChangeMessage<PublicationRow, string | number>,
) {
  return {
    type: change.type,
    key: change.key,
    value: selectPublishedRow(change.value),
    previousValue: selectPublishedRow(change.previousValue),
  }
}

function expectPublishedRows(
  harness: PublicationHarness,
  model: ReadonlyMap<number, PublicationRow>,
): void {
  const expected = [...model.values()].sort((a, b) => a.id - b.id)
  const selectBaseRows = (collection: ReadablePublicationCollection) =>
    [...collection.values()]
      .map((row) => ({ id: row.id, position: row.position }))
      .sort((a, b) => a.id - b.id)

  expect(selectBaseRows(harness.rows)).toEqual(expected)
  expect(selectBaseRows(harness.liveRows)).toEqual(expected)
}

async function applyRound(
  harness: PublicationHarness,
  round: PublicationRound,
  model: Map<number, PublicationRow>,
  metadataModel: Map<number, unknown>,
): Promise<void> {
  const previous = model.get(round.key)!
  const next = { ...previous, position: previous.position + round.delta }
  const batchCountBefore = harness.batches.length
  const keyWasPreviouslyPublished = harness.batches.some((batch) =>
    batch.some((change) => change.key === round.key),
  )
  const sync = harness.getSync()
  const transaction = createTransaction({
    mutationFn: async () => {
      sync.begin({ immediate: true })
      sync.write({ type: `update`, value: next })
      sync.commit()

      sync.begin()
      for (const write of round.metadata) {
        if (write.type === `set`) {
          sync.metadata!.row.set(write.key, write.value)
        } else {
          sync.metadata!.row.delete(write.key)
        }
      }
      if (round.outcome === `commit`) {
        sync.commit()
      } else {
        const controller = new AbortController()
        const receipt = sync.commit(controller.signal)
        controller.abort()
        if (receipt !== true) {
          await receipt.catch((error: unknown) => {
            if (!(error instanceof SyncTransactionAbortedError)) throw error
          })
        }
      }
    },
  })
  transaction.mutate(() => {
    harness.rows.update(round.key, (draft) => {
      draft.position = next.position
    })
  })
  await transaction.isPersisted.promise

  model.set(round.key, next)
  if (round.outcome === `commit`) {
    for (const write of round.metadata) {
      if (write.type === `set`) {
        metadataModel.set(write.key, write.value)
      } else {
        metadataModel.delete(write.key)
      }
    }
  }
  await Promise.resolve()
  const virtualRow = (
    row: PublicationRow,
    synced: boolean,
  ): PublishedPublicationRow => ({
    ...row,
    $collectionId: harness.rows.id,
    $key: row.id,
    $origin: `local`,
    $synced: synced,
  })
  const expectedOptimisticChange = keyWasPreviouslyPublished
    ? {
        type: `update`,
        key: round.key,
        value: virtualRow(next, false),
        previousValue: virtualRow(previous, true),
      }
    : {
        type: `insert`,
        key: round.key,
        value: virtualRow(next, false),
        previousValue: undefined,
      }
  expect(
    harness.batches
      .slice(batchCountBefore)
      .map((batch) => batch.map(selectPublishedChange)),
  ).toEqual([
    [expectedOptimisticChange],
    [
      {
        type: `update`,
        key: round.key,
        value: virtualRow(next, true),
        previousValue: virtualRow(next, false),
      },
    ],
  ])
  expectUniqueBatchKeys(harness.batches)
  expectPublishedRows(harness, model)
  const byKey = (
    [a]: readonly [number, unknown],
    [b]: readonly [number, unknown],
  ) => a - b
  expect([...harness.rows._state.syncedMetadata.entries()].sort(byKey)).toEqual(
    [...metadataModel.entries()].sort(byKey),
  )
  expect(harness.rows._state.preSyncVisibleState.size).toBe(0)
  expect(harness.rows._state.preSyncVirtualState.size).toBe(0)
  expect(harness.rows._state.recentlySyncedKeys.size).toBe(0)
}

async function runPublicationHistory(
  rounds: ReadonlyArray<PublicationRound>,
): Promise<void> {
  const harness = await createPublicationHarness()
  const model = new Map(
    [0, 1, 2].map((id) => [id, { id, position: id }] as const),
  )
  const metadataModel = new Map<number, unknown>()
  try {
    for (const round of rounds) {
      await applyRound(harness, round, model, metadataModel)
    }
  } finally {
    harness.unsubscribe()
    await Promise.all([harness.liveRows.cleanup(), harness.rows.cleanup()])
  }
}

async function expectMetadataCancellationOwnership(
  canceledKeys: ReadonlyArray<number>,
  retainedKeys: ReadonlyArray<number>,
  canceledOperation: MetadataOperation,
  retainedOperation: MetadataOperation,
  canceledFirst: boolean,
  initialMetadataState: ReadonlyArray<MetadataEntryState>,
): Promise<void> {
  const harness = await createPublicationHarness()
  const initialMetadata = new Map<number, unknown>()
  for (const [key, state] of initialMetadataState.entries()) {
    if (state.present) initialMetadata.set(key, state.value)
  }
  const initialSync = harness.getSync()
  initialSync.begin()
  for (const [key, value] of initialMetadata) {
    initialSync.metadata!.row.set(key, value)
  }
  initialSync.commit()
  await Promise.resolve()

  const persistence = createDeferred<void>()
  const heldTransaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  heldTransaction.mutate(() => {
    harness.rows.insert({ id: 99, position: 99 })
  })
  expect(heldTransaction.state).toBe(`persisting`)

  const stageMetadata = (
    keys: ReadonlyArray<number>,
    operation: MetadataOperation,
  ) => {
    const sync = harness.getSync()
    sync.begin()
    for (const key of keys) {
      if (operation.type === `set`) {
        sync.metadata!.row.set(key, operation.value)
      } else {
        sync.metadata!.row.delete(key)
      }
    }
    const receipt = sync.commit()
    if (receipt === true) {
      throw new Error(`Persisting optimistic work did not hold metadata sync`)
    }
    const transaction = harness.rows._state.pendingSyncedTransactions.at(-1)!
    void receipt.catch(() => undefined)
    return { receipt, transaction }
  }

  const first = canceledFirst
    ? stageMetadata(canceledKeys, canceledOperation)
    : stageMetadata(retainedKeys, retainedOperation)
  const second = canceledFirst
    ? stageMetadata(retainedKeys, retainedOperation)
    : stageMetadata(canceledKeys, canceledOperation)
  const canceled = canceledFirst ? first : second
  const retained = canceledFirst ? second : first

  try {
    harness.rows._state.capturePreSyncVisibleState()
    const expectedBefore = new Set([...canceledKeys, ...retainedKeys])
    expect(harness.rows._state.recentlySyncedKeys).toEqual(expectedBefore)
    expect(new Set(harness.rows._state.preSyncVisibleState.keys())).toEqual(
      expectedBefore,
    )
    expect(new Set(harness.rows._state.preSyncVirtualState.keys())).toEqual(
      expectedBefore,
    )
    const batchCountBefore = harness.batches.length

    harness.rows._state.cancelPendingSyncedTransaction(canceled.transaction)

    const expectedAfter = new Set(retainedKeys)
    expect(harness.rows._state.pendingSyncedTransactions).toEqual([
      retained.transaction,
    ])
    expect(retained.transaction.rowMetadataWrites).toEqual(
      new Map(retainedKeys.map((key) => [key, retainedOperation])),
    )
    expect(harness.rows._state.recentlySyncedKeys).toEqual(expectedAfter)
    expect(new Set(harness.rows._state.preSyncVisibleState.keys())).toEqual(
      expectedAfter,
    )
    expect(new Set(harness.rows._state.preSyncVirtualState.keys())).toEqual(
      expectedAfter,
    )
    expect(harness.batches).toHaveLength(batchCountBefore)
    expect(harness.rows._state.syncedMetadata).toEqual(initialMetadata)
    await expect(canceled.receipt).rejects.toBeInstanceOf(
      SyncTransactionAbortedError,
    )

    persistence.resolve()
    await heldTransaction.isPersisted.promise
    await expect(retained.receipt).resolves.toBeUndefined()
    const expectedMetadata = new Map(initialMetadata)
    for (const key of retainedKeys) {
      if (retainedOperation.type === `set`) {
        expectedMetadata.set(key, retainedOperation.value)
      } else {
        expectedMetadata.delete(key)
      }
    }
    expect(harness.rows._state.syncedMetadata).toEqual(expectedMetadata)
  } finally {
    if (retained.transaction.applied.isPending()) {
      harness.rows._state.cancelPendingSyncedTransaction(retained.transaction)
      await retained.receipt.catch(() => undefined)
    }
    persistence.resolve()
    await heldTransaction.isPersisted.promise.catch(() => undefined)
    harness.unsubscribe()
    await Promise.all([harness.liveRows.cleanup(), harness.rows.cleanup()])
  }
}

async function expectMetadataRollbackRecovery({
  sourceKey,
  metadataKey,
  sourceDelta,
  initialMetadata,
  pendingOperation,
  additionalMetadata = [],
}: {
  sourceKey: number
  metadataKey: number
  sourceDelta: number
  initialMetadata: MetadataEntryState
  pendingOperation: MetadataOperation
  additionalMetadata?: ReadonlyArray<{
    key: number
    initialMetadata: MetadataEntryState
    pendingOperation: MetadataOperation
  }>
}): Promise<void> {
  const harnessId = nextMetadataRollbackHarnessId++
  const source = await createPublicationHarness()
  const { rows, getSync } = source
  const derived = createLiveQueryCollection({
    id: `metadata-rollback-derived-${harnessId}`,
    query: (query) =>
      query.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        position: row.position,
      })),
    getKey: (row) => row.id,
  })
  await derived.preload()

  const metadataCases = [
    { key: metadataKey, initialMetadata, pendingOperation },
    ...additionalMetadata,
  ]
  const stageMetadata = (
    writes: ReadonlyArray<{ key: number; operation: MetadataOperation }>,
  ) => {
    const applied = createDeferred<void>()
    void applied.promise.catch(() => undefined)
    const transaction = {
      committed: true,
      applicationStarted: false,
      layoutChanged: false,
      operations: [],
      deletedKeys: new Set<string | number>(),
      rowMetadataWrites: new Map(
        writes.map(({ key, operation }) => [key, operation]),
      ),
      collectionMetadataWrites: new Map(),
      applied,
    }
    derived._state.pendingSyncedTransactions.push(transaction)
    return transaction
  }

  const initialWrites = metadataCases.flatMap(
    ({ key, initialMetadata: state }) =>
      state.present
        ? [
            {
              key,
              operation: {
                type: `set` as const,
                value: state.value,
              },
            },
          ]
        : [],
  )
  if (initialWrites.length > 0) {
    stageMetadata(initialWrites)
    derived._state.commitPendingTransactions()
  }

  const pending = stageMetadata(
    metadataCases.map(({ key, pendingOperation: operation }) => ({
      key,
      operation,
    })),
  )
  const sourceRowsBefore = [...rows.values()].map((row) => ({ ...row }))
  const rowsBefore = [...derived.values()].map((row) => ({ ...row }))
  const originBefore = new Map(derived._state.rowOrigins)
  const hydrationSeedsBefore = new Set(derived._state.hydrationSeedKeys)
  const hydratedBefore = new Set(derived._state.hydratedKeys)
  const syncedBefore = new Set(derived._state.syncedKeys)
  const preSyncBefore = new Map(derived._state.preSyncVisibleState)
  const preSyncVirtualBefore = new Map(derived._state.preSyncVirtualState)
  const recentlySyncedBefore = new Set(derived._state.recentlySyncedKeys)
  const published: Array<
    ReadonlyArray<ChangeMessage<PublicationRow, string | number>>
  > = []
  const subscription = derived.subscribeChanges((changes) => {
    published.push(changes)
  })

  const publicationFailure = new Error(`metadata rollback publication failed`)
  const commitPendingTransactions = derived._state.commitPendingTransactions
  let shouldFail = true
  derived._state.commitPendingTransactions = () => {
    commitPendingTransactions()
    if (shouldFail) {
      shouldFail = false
      throw publicationFailure
    }
  }

  try {
    const previousSourceRow = rows.get(sourceKey)!
    let thrown: unknown
    try {
      getSync().begin()
      getSync().write({
        type: `update`,
        value: {
          ...previousSourceRow,
          position: previousSourceRow.position + sourceDelta,
        },
      })
      getSync().commit()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(publicationFailure)

    expect(rows.get(sourceKey)?.position).toBe(
      previousSourceRow.position + sourceDelta,
    )
    expect([...rows.values()].map((row) => ({ ...row }))).toEqual(
      sourceRowsBefore.map((row) =>
        row.id === sourceKey
          ? { ...row, position: row.position + sourceDelta }
          : row,
      ),
    )
    expect([...derived.values()].map((row) => ({ ...row }))).toEqual(rowsBefore)
    expect(derived._state.syncedMetadata).toEqual(
      new Map(
        metadataCases.flatMap(({ key, initialMetadata: state }) =>
          state.present ? [[key, state.value]] : [],
        ),
      ),
    )
    expect(derived._state.pendingSyncedTransactions).toHaveLength(1)
    expect(derived._state.pendingSyncedTransactions[0]).toBe(pending)
    expect(pending.applicationStarted).toBe(false)
    expect(derived._state.rowOrigins).toEqual(originBefore)
    expect(derived._state.hydrationSeedKeys).toEqual(hydrationSeedsBefore)
    expect(derived._state.hydratedKeys).toEqual(hydratedBefore)
    expect(derived._state.syncedKeys).toEqual(syncedBefore)
    expect(derived._state.preSyncVisibleState).toEqual(preSyncBefore)
    expect(derived._state.preSyncVirtualState).toEqual(preSyncVirtualBefore)
    expect(derived._state.recentlySyncedKeys).toEqual(recentlySyncedBefore)
    expect(published).toEqual([])
  } finally {
    derived._state.commitPendingTransactions = commitPendingTransactions
    derived._state.cancelPendingSyncedTransaction(pending)
    subscription.unsubscribe()
    source.unsubscribe()
    await Promise.all([
      derived.cleanup(),
      source.liveRows.cleanup(),
      rows.cleanup(),
    ])
  }
}

it(`publishes one event per key when metadata-only sync retires optimistic work`, async () => {
  await runPublicationHistory([
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: false }],
      outcome: `commit`,
    },
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `delete` }],
      outcome: `commit`,
    },
  ])
})

it(`includes metadata-only keys in a publication snapshot`, async () => {
  const harness = await createPublicationHarness()
  const applied = createDeferred<void>()
  void applied.promise.catch(() => undefined)
  const transaction = {
    committed: true,
    applicationStarted: false,
    layoutChanged: false,
    operations: [],
    deletedKeys: new Set<string | number>(),
    rowMetadataWrites: new Map([[1, { type: `set` as const, value: false }]]),
    collectionMetadataWrites: new Map(),
    applied,
  }
  harness.rows._state.pendingSyncedTransactions.push(transaction)

  try {
    const snapshot = harness.rows._state.snapshotPublicationState([])
    expect([...snapshot.keys.keys()]).toEqual([1])
    expect(snapshot.keys.get(1)?.syncedMetadata).toEqual({
      present: false,
      value: undefined,
    })
    expect(snapshot.pendingSyncedTransactions).toEqual([transaction])
  } finally {
    harness.rows._state.cancelPendingSyncedTransaction(transaction)
    harness.unsubscribe()
    await Promise.all([harness.liveRows.cleanup(), harness.rows.cleanup()])
  }
})

it(`releases only canceled metadata keys while another sync remains pending`, async () => {
  await expectMetadataCancellationOwnership(
    [0, 1],
    [1, 2],
    { type: `delete` },
    { type: `set`, value: false },
    true,
    [
      { present: true, value: undefined },
      { present: true, value: false },
      { present: true, value: null },
    ],
  )
})

it(`does not apply canceled metadata to an absent base key`, async () => {
  await expectMetadataCancellationOwnership(
    [0, 1],
    [1, 2],
    { type: `set`, value: `canceled` },
    { type: `set`, value: `retained` },
    true,
    [{ present: false }, { present: false }, { present: false }],
  )
})

it(`settles an older metadata owner after canceling the newer owner`, async () => {
  await expectMetadataCancellationOwnership(
    [0, 1],
    [1, 2],
    { type: `delete` },
    { type: `set`, value: `retained` },
    false,
    [
      { present: true, value: undefined },
      { present: false },
      { present: true, value: false },
    ],
  )
})

it(`restores pending metadata when a derived publication fails`, async () => {
  await expectMetadataRollbackRecovery({
    sourceKey: 0,
    metadataKey: 1,
    sourceDelta: 1,
    initialMetadata: { present: true, value: false },
    pendingOperation: { type: `delete` },
  })
})

it(`restores an existing metadata value after a failed replacement`, async () => {
  await expectMetadataRollbackRecovery({
    sourceKey: 0,
    metadataKey: 1,
    sourceDelta: 1,
    initialMetadata: { present: true, value: `before` },
    pendingOperation: { type: `set`, value: `after` },
  })
})

it(`restores every metadata key after one failed publication`, async () => {
  await expectMetadataRollbackRecovery({
    sourceKey: 0,
    metadataKey: 1,
    sourceDelta: 1,
    initialMetadata: { present: true, value: `before` },
    pendingOperation: { type: `set`, value: `after` },
    additionalMetadata: [
      {
        key: 2,
        initialMetadata: { present: true, value: false },
        pendingOperation: { type: `delete` },
      },
    ],
  })
})

fcTest.prop(
  [fc.array(publicationRoundArbitrary, { minLength: 1, maxLength: 8 })],
  oraclePropertyOptions(50, `collection-publication.metadata-only`),
)(
  `keeps metadata-only optimistic settlement a valid keyed diff across histories`,
  runPublicationHistory,
)

fcTest.prop(
  [metadataCancellationArbitrary],
  oraclePropertyOptions(50, `collection-publication.metadata-cancellation`),
)(
  `keeps metadata suppression owned by the remaining pending transactions`,
  ({
    canceledKeys,
    retainedKeys,
    canceledOperation,
    retainedOperation,
    canceledFirst,
    initialMetadata,
  }) =>
    expectMetadataCancellationOwnership(
      canceledKeys,
      retainedKeys,
      canceledOperation,
      retainedOperation,
      canceledFirst,
      initialMetadata,
    ),
)
fcTest.prop(
  [metadataRollbackArbitrary],
  oraclePropertyOptions(30, `collection-publication.metadata-rollback`),
)(
  `restores metadata-only state after failed derived publications`,
  expectMetadataRollbackRecovery,
)
