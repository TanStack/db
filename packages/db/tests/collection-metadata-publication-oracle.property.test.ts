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

type MetadataWrite = {
  key: number
  type: `set` | `delete`
}

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

const metadataWriteArbitrary = fc.record({
  key: fc.integer({ min: 0, max: 2 }),
  type: fc.constantFrom(`set` as const, `delete` as const),
})

const publicationRoundArbitrary: fc.Arbitrary<PublicationRound> = fc
  .record({
    key: fc.integer({ min: 0, max: 2 }),
    delta: fc.constantFrom(-2, -1, 1, 2),
    extraMetadata: fc.array(metadataWriteArbitrary, { maxLength: 2 }),
    outcome: fc.constantFrom(`commit` as const, `abort` as const),
    primaryMetadataType: fc.constantFrom(`set` as const, `delete` as const),
  })
  .map(({ key, delta, extraMetadata, outcome, primaryMetadataType }) => ({
    key,
    delta,
    outcome,
    metadata: [{ key, type: primaryMetadataType }, ...extraMetadata],
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
})

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
  roundIndex: number,
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
          const metadata = { round: roundIndex, owner: round.key }
          sync.metadata!.row.set(write.key, metadata)
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
        metadataModel.set(write.key, {
          round: roundIndex,
          owner: round.key,
        })
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
    for (const [index, round] of rounds.entries()) {
      await applyRound(harness, round, index, model, metadataModel)
    }
  } finally {
    harness.unsubscribe()
    await Promise.all([harness.liveRows.cleanup(), harness.rows.cleanup()])
  }
}

async function expectMetadataCancellationOwnership(
  canceledKeys: ReadonlyArray<number>,
  retainedKeys: ReadonlyArray<number>,
): Promise<void> {
  const harness = await createPublicationHarness()
  const persistence = createDeferred<void>()
  const heldTransaction = createTransaction({
    mutationFn: () => persistence.promise,
  })
  heldTransaction.mutate(() => {
    harness.rows.insert({ id: 99, position: 99 })
  })
  expect(heldTransaction.state).toBe(`persisting`)

  const stageMetadata = (keys: ReadonlyArray<number>, owner: string) => {
    const sync = harness.getSync()
    sync.begin()
    for (const key of keys) {
      sync.metadata!.row.set(key, { owner })
    }
    const receipt = sync.commit()
    if (receipt === true) {
      throw new Error(`Persisting optimistic work did not hold metadata sync`)
    }
    const transaction = harness.rows._state.pendingSyncedTransactions.at(-1)!
    void receipt.catch(() => undefined)
    return { receipt, transaction }
  }

  const canceled = stageMetadata(canceledKeys, `canceled`)
  const retained = stageMetadata(retainedKeys, `retained`)

  try {
    harness.rows._state.capturePreSyncVisibleState()
    const expectedBefore = new Set([...canceledKeys, ...retainedKeys])
    expect(harness.rows._state.recentlySyncedKeys).toEqual(expectedBefore)
    expect(new Set(harness.rows._state.preSyncVisibleState.keys())).toEqual(
      expectedBefore,
    )
    const batchCountBefore = harness.batches.length

    harness.rows._state.cancelPendingSyncedTransaction(canceled.transaction)

    const expectedAfter = new Set(retainedKeys)
    expect(harness.rows._state.pendingSyncedTransactions).toEqual([
      retained.transaction,
    ])
    expect(harness.rows._state.recentlySyncedKeys).toEqual(expectedAfter)
    expect(new Set(harness.rows._state.preSyncVisibleState.keys())).toEqual(
      expectedAfter,
    )
    expect(harness.batches).toHaveLength(batchCountBefore)
    expect(harness.rows._state.syncedMetadata.size).toBe(0)
    await expect(canceled.receipt).rejects.toBeInstanceOf(
      SyncTransactionAbortedError,
    )
  } finally {
    harness.rows._state.cancelPendingSyncedTransaction(retained.transaction)
    await retained.receipt.catch(() => undefined)
    persistence.resolve()
    await heldTransaction.isPersisted.promise.catch(() => undefined)
    harness.unsubscribe()
    await Promise.all([harness.liveRows.cleanup(), harness.rows.cleanup()])
  }
}

it(`publishes one event per key when metadata-only sync retires optimistic work`, async () => {
  await runPublicationHistory([
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set` }],
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

it(`releases only canceled metadata keys while another sync remains pending`, async () => {
  await expectMetadataCancellationOwnership([0, 1], [1, 2])
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
  ({ canceledKeys, retainedKeys }) =>
    expectMetadataCancellationOwnership(canceledKeys, retainedKeys),
)
