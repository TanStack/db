import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { SyncTransactionAbortedError } from '../src/errors.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { createTransaction } from '../src/transactions.js'
import { declareOracle } from './oracle-declaration.js'
import { oracleAssertion } from './oracle-assertion-adapter.js'
import { withHistoryCleanup } from './optimistic-history-oracle.js'
import { metadataWorlds } from './metadata-publication-worlds.js'
import type { Collection } from '../src/collection/index.js'
import type { ChangeMessage, SyncConfig } from '../src/types.js'

/**
 * A metadata-only sync transaction can retire optimistic work. Its resulting
 * Collection publication must expose one coherent row/metadata world through
 * subscribeChanges. The established Collection sync metadata and change
 * subscription contracts supply this law.
 *
 * The model keeps rows and metadata as independent maps. Each round confirms
 * one optimistic row update, then commits its ordered metadata writes or
 * aborts them before acceptance; an accepted commit always applies. Repeated metadata writes use the last value; each row publication
 * has one keyed change message. Structured metadata is cloned once per world.
 * Aliases remain within each world, while production cannot rewrite the model.
 *
 * The driver observes direct Collection state, live-query rows, metadata,
 * exact change batches, callback-time row/metadata cuts, and cancellation.
 * The bounded grammar uses three existing numeric row keys, one to eight
 * rounds, structured metadata values, and two queued metadata owners. It does
 * not judge absent source rows, collection metadata, or other provider hosts.
 */

type PublicationRow = {
  id: number
  position: number
}

type SyncActions = Parameters<SyncConfig<PublicationRow, number>[`sync`]>[0]

type MetadataOperation = { type: `set`; value: unknown } | { type: `delete` }

type MetadataEntryState = { present: false } | { present: true; value: unknown }

type MetadataWrite = { key: number } & MetadataOperation

type MetadataDriver = (value: unknown) => unknown
const unchangedMetadata: MetadataDriver = (value) => value

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
  cuts: Array<{
    rows: Array<PublicationRow>
    metadata: Map<number, unknown>
  }>
  unsubscribe: () => void
  getSync: () => SyncActions
}

type PublicationCut = PublicationHarness[`cuts`][number]

type PublishedPublicationRow = PublicationRow & {
  $collectionId: string
  $key: number
  $origin: `local` | `remote`
  $hasPendingWrites: boolean
}

// Grammar controls: the fixed same-key and cancellation witnesses below are
// reconstructed by these bounded choices. Removing outcome loses abort;
// removing extra writes loses same-key overwrite and cross-key overlap;
// removing either cancellation order loses older/newer ownership; removing
// initial presence loses absent-base and stored-undefined histories. The value
// choices distinguish falsy, nullish, NaN, scalar, and structured metadata.
// Keys outside 0..2, zero row deltas, empty cancellation owners, and metadata
// operations without a sync transaction are excluded. Larger key spaces and
// longer histories are range extensions, not claims of this bounded grammar.
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
  const cuts: PublicationHarness[`cuts`] = []
  const subscription = rows.subscribeChanges((changes) => {
    batches.push(changes)
    cuts.push({
      rows: [...rows.values()]
        .map(({ id, position }) => ({ id, position }))
        .sort((a, b) => a.id - b.id),
      metadata: structuredClone(
        new Map([0, 1, 2].map((key) => [key, sync.metadata!.row.get(key)])),
      ),
    })
  })
  return {
    rows,
    liveRows,
    batches,
    cuts,
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
    oracleAssertion('expectUniqueBatchKeys', () =>
      expect(keys).toEqual([...new Set(keys)]),
    )
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
    $hasPendingWrites: published.$hasPendingWrites,
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

  oracleAssertion('expectPublishedRows', () =>
    expect(selectBaseRows(harness.rows)).toEqual(expected),
  )
  oracleAssertion('expectPublishedRows', () =>
    expect(selectBaseRows(harness.liveRows)).toEqual(expected),
  )
}

function readMetadata(
  harness: PublicationHarness,
  keys: Iterable<number>,
): Map<number, unknown> {
  const metadata = harness.getSync().metadata!.row
  return new Map([...keys].map((key) => [key, metadata.get(key)]))
}

function observableMetadata(
  model: ReadonlyMap<number, unknown>,
  keys: Iterable<number>,
): Map<number, unknown> {
  // The public API exposes get, not has. Stored undefined and absence are
  // intentionally indistinguishable here; this is a value observation.
  return new Map([...keys].map((key) => [key, model.get(key)]))
}

async function applyRound(
  harness: PublicationHarness,
  round: PublicationRound,
  expectedRound: PublicationRound,
  model: Map<number, PublicationRow>,
  metadataModel: Map<number, unknown>,
  writeMetadata: MetadataDriver,
  corruptCut?: (cuts: Array<PublicationCut>) => void,
): Promise<void> {
  const previous = model.get(round.key)!
  const next = { ...previous, position: previous.position + round.delta }
  const batchCountBefore = harness.batches.length
  const cutCountBefore = harness.cuts.length
  const metadataBefore = observableMetadata(metadataModel, [0, 1, 2])
  const keyWasPreviouslyPublished = harness.batches.some((batch) =>
    batch.some((change) => change.key === round.key),
  )
  const sync = harness.getSync()
  const transaction = createTransaction({
    mutationFn: async () => {
      sync.begin()
      sync.write({ type: `update`, value: { ...next } })
      sync.commit()

      sync.begin()
      for (const write of round.metadata) {
        if (write.type === `set`) {
          sync.metadata!.row.set(write.key, writeMetadata(write.value))
        } else {
          sync.metadata!.row.delete(write.key)
        }
      }
      if (round.outcome === `commit`) {
        sync.commit()
      } else {
        // An accepted commit always applies, so abort before acceptance.
        const controller = new AbortController()
        controller.abort()
        const receipt = sync.commit(controller.signal)
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
  await transaction.when(`settled`)

  model.set(round.key, next)
  if (round.outcome === `commit`) {
    for (const write of expectedRound.metadata) {
      if (write.type === `set`) {
        metadataModel.set(write.key, write.value)
      } else {
        metadataModel.delete(write.key)
      }
    }
  }
  await Promise.resolve()
  corruptCut?.(harness.cuts.slice(cutCountBefore))
  const virtualRow = (
    row: PublicationRow,
    hasPendingWrites: boolean,
  ): PublishedPublicationRow => ({
    ...row,
    $collectionId: harness.rows.id,
    $key: row.id,
    $origin: `local`,
    $hasPendingWrites: hasPendingWrites,
  })
  const expectedOptimisticChange = keyWasPreviouslyPublished
    ? {
        type: `update`,
        key: round.key,
        value: virtualRow(next, true),
        previousValue: virtualRow(previous, false),
      }
    : {
        type: `insert`,
        key: round.key,
        value: virtualRow(next, true),
        previousValue: undefined,
      }
  oracleAssertion('applyRound', () =>
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
          value: virtualRow(next, false),
          previousValue: virtualRow(next, true),
        },
      ],
    ]),
  )
  const expectedRows = [...model.values()].sort((a, b) => a.id - b.id)
  oracleAssertion('applyRound', () =>
    expect(harness.cuts.slice(cutCountBefore)).toEqual([
      { rows: expectedRows, metadata: metadataBefore },
      {
        rows: expectedRows,
        metadata: observableMetadata(metadataModel, [0, 1, 2]),
      },
    ]),
  )
  expectUniqueBatchKeys(harness.batches)
  expectPublishedRows(harness, model)
  oracleAssertion('applyRound', () =>
    expect(readMetadata(harness, [0, 1, 2])).toEqual(
      observableMetadata(metadataModel, [0, 1, 2]),
    ),
  )
  oracleAssertion('applyRound', () =>
    expect(harness.rows._state.preSyncVisibleState.size).toBe(0),
  )
  oracleAssertion('applyRound', () =>
    expect(harness.rows._state.preSyncVirtualState.size).toBe(0),
  )
  oracleAssertion('applyRound', () =>
    expect(harness.rows._state.recentlySyncedKeys.size).toBe(0),
  )
}

async function runPublicationHistory(
  rounds: ReadonlyArray<PublicationRound>,
  writeMetadata: MetadataDriver = unchangedMetadata,
  corruptCut?: (cuts: Array<PublicationCut>) => void,
): Promise<void> {
  const worlds = metadataWorlds(rounds)
  const harness = await createPublicationHarness()
  const model = new Map(
    [0, 1, 2].map((id) => [id, { id, position: id }] as const),
  )
  const metadataModel = new Map<number, unknown>()
  await withHistoryCleanup(
    async () => {
      for (const [index, round] of worlds.driver.entries()) {
        await applyRound(
          harness,
          round,
          worlds.model[index]!,
          model,
          metadataModel,
          writeMetadata,
          corruptCut,
        )
      }
    },
    () => [
      () => harness.unsubscribe(),
      () => harness.liveRows.cleanup(),
      () => harness.rows.cleanup(),
    ],
  )
}

async function expectMetadataCancellationOwnership(
  canceledKeys: ReadonlyArray<number>,
  retainedKeys: ReadonlyArray<number>,
  canceledOperation: MetadataOperation,
  retainedOperation: MetadataOperation,
  canceledFirst: boolean,
  initialMetadataState: ReadonlyArray<MetadataEntryState>,
  writeMetadata: MetadataDriver = unchangedMetadata,
): Promise<void> {
  const worlds = metadataWorlds({
    canceledOperation,
    retainedOperation,
    initialMetadataState,
  })
  const harness = await createPublicationHarness()
  await withHistoryCleanup(
    async () => {
      const initialMetadata = new Map<number, unknown>()
      for (const [key, state] of worlds.model.initialMetadataState.entries()) {
        if (state.present) initialMetadata.set(key, state.value)
      }
      const initialSync = harness.getSync()
      initialSync.begin()
      for (const [key, state] of worlds.driver.initialMetadataState.entries()) {
        if (state.present) {
          initialSync.metadata!.row.set(key, writeMetadata(state.value))
        }
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
      oracleAssertion('expectMetadataCancellationOwnership', () =>
        expect(heldTransaction.state).toBe(`persisting`),
      )

      const stageMetadata = (
        keys: ReadonlyArray<number>,
        operation: MetadataOperation,
        signal?: AbortSignal,
      ) => {
        const sync = harness.getSync()
        sync.begin()
        for (const key of keys) {
          if (operation.type === `set`) {
            sync.metadata!.row.set(key, writeMetadata(operation.value))
          } else {
            sync.metadata!.row.delete(key)
          }
        }
        // An accepted commit always applies, so a canceled owner aborts
        // before acceptance.
        if (signal) canceledController.abort()
        const receipt = sync.commit(signal)
        if (receipt === true) {
          throw new Error(
            `Persisting optimistic work did not hold metadata sync`,
          )
        }
        void receipt.catch(() => undefined)
        return receipt
      }

      const canceledController = new AbortController()
      const first = canceledFirst
        ? stageMetadata(
            canceledKeys,
            worlds.driver.canceledOperation,
            canceledController.signal,
          )
        : stageMetadata(retainedKeys, worlds.driver.retainedOperation)
      const second = canceledFirst
        ? stageMetadata(retainedKeys, worlds.driver.retainedOperation)
        : stageMetadata(
            canceledKeys,
            worlds.driver.canceledOperation,
            canceledController.signal,
          )
      const canceled = canceledFirst ? first : second
      const retained = canceledFirst ? second : first
      const expectedMetadata = new Map(initialMetadata)
      for (const key of retainedKeys) {
        if (worlds.model.retainedOperation.type === `set`) {
          expectedMetadata.set(key, worlds.model.retainedOperation.value)
        } else {
          expectedMetadata.delete(key)
        }
      }

      await withHistoryCleanup(
        async () => {
          const batchCountBefore = harness.batches.length
          const cutCountBefore = harness.cuts.length
          const rowsBefore = [...harness.rows.values()]

          canceledController.abort()

          await oracleAssertion('expectMetadataCancellationOwnership', () =>
            expect(canceled).rejects.toBeInstanceOf(
              SyncTransactionAbortedError,
            ),
          )
          oracleAssertion('expectMetadataCancellationOwnership', () =>
            expect(harness.batches).toHaveLength(batchCountBefore),
          )
          oracleAssertion('expectMetadataCancellationOwnership', () =>
            expect(harness.cuts).toHaveLength(cutCountBefore),
          )
          oracleAssertion('expectMetadataCancellationOwnership', () =>
            expect([...harness.rows.values()]).toEqual(rowsBefore),
          )
          oracleAssertion('expectMetadataCancellationOwnership', () =>
            expect(readMetadata(harness, [0, 1, 2])).toEqual(
              observableMetadata(expectedMetadata, [0, 1, 2]),
            ),
          )

          persistence.resolve()
          await heldTransaction.when(`settled`)
          await oracleAssertion('expectMetadataCancellationOwnership', () =>
            expect(retained).resolves.toBeUndefined(),
          )
          oracleAssertion('expectMetadataCancellationOwnership', () =>
            expect(readMetadata(harness, [0, 1, 2])).toEqual(
              observableMetadata(expectedMetadata, [0, 1, 2]),
            ),
          )
          expectPublishedRows(
            harness,
            new Map([0, 1, 2].map((id) => [id, { id, position: id }] as const)),
          )
        },
        () => [
          () => persistence.resolve(),
          () => heldTransaction.when(`settled`).catch(() => undefined),
          () => canceled.catch(() => undefined),
          () => retained.catch(() => undefined),
        ],
      )
    },
    () => [
      () => harness.unsubscribe(),
      () => harness.liveRows.cleanup(),
      () => harness.rows.cleanup(),
    ],
  )
}

const mutateDriverMetadata: MetadataDriver = (value) => {
  if (typeof value === `object` && value !== null && `nested` in value) {
    value.nested = `corrupted by driver`
  }
  return value
}

// Both the generated campaign and its shrink/replay calibration use these
// unchanged independent comparisons and production histories.
declareOracle({
  owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
  check: [applyRound, expectMetadataCancellationOwnership],
  grammar: [publicationRoundArbitrary, metadataCancellationArbitrary],
})

export {
  applyRound,
  expectMetadataCancellationOwnership,
  metadataCancellationArbitrary,
  mutateDriverMetadata,
  publicationRoundArbitrary,
  runPublicationHistory,
  unchangedMetadata,
}
export type {
  MetadataDriver,
  MetadataEntryState,
  MetadataOperation,
  PublicationRound,
}
