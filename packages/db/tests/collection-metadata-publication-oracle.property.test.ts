import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { SyncTransactionAbortedError } from '../src/errors.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { createTransaction } from '../src/transactions.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from './oracle-config.js'
import { withHistoryCleanup } from './optimistic-history-oracle.js'
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

// This grammar contains structured values only. Clone the whole scenario, not
// each write: aliases within one world stay intact, but cannot rewrite the
// other world's authority or the original replay input.
function metadataWorlds<T>(scenario: T): { model: T; driver: T } {
  return { model: structuredClone(scenario), driver: structuredClone(scenario) }
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
  $synced: boolean
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

const metadataOnlyProperty = `collection-publication.metadata-only`
const metadataCancellationProperty = `collection-publication.metadata-cancellation`
const requestedReplayProperty = readOracleRunConfig().replayProperty

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
    $hasPendingWrites: published.$hasPendingWrites,
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
  await transaction.isPersisted.promise

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
    synced: boolean,
  ): PublishedPublicationRow => ({
    ...row,
    $collectionId: harness.rows.id,
    $key: row.id,
    $origin: `local`,
    $hasPendingWrites: !synced,
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
  const expectedRows = [...model.values()].sort((a, b) => a.id - b.id)
  expect(harness.cuts.slice(cutCountBefore)).toEqual([
    { rows: expectedRows, metadata: metadataBefore },
    {
      rows: expectedRows,
      metadata: observableMetadata(metadataModel, [0, 1, 2]),
    },
  ])
  expectUniqueBatchKeys(harness.batches)
  expectPublishedRows(harness, model)
  expect(readMetadata(harness, [0, 1, 2])).toEqual(
    observableMetadata(metadataModel, [0, 1, 2]),
  )
  expect(harness.rows._state.preSyncVisibleState.size).toBe(0)
  expect(harness.rows._state.preSyncVirtualState.size).toBe(0)
  expect(harness.rows._state.recentlySyncedKeys.size).toBe(0)
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
      expect(heldTransaction.state).toBe(`persisting`)

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

          await expect(canceled).rejects.toBeInstanceOf(
            SyncTransactionAbortedError,
          )
          expect(harness.batches).toHaveLength(batchCountBefore)
          expect(harness.cuts).toHaveLength(cutCountBefore)
          expect([...harness.rows.values()]).toEqual(rowsBefore)
          expect(readMetadata(harness, [0, 1, 2])).toEqual(
            observableMetadata(expectedMetadata, [0, 1, 2]),
          )

          persistence.resolve()
          await heldTransaction.isPersisted.promise
          await expect(retained).resolves.toBeUndefined()
          expect(readMetadata(harness, [0, 1, 2])).toEqual(
            observableMetadata(expectedMetadata, [0, 1, 2]),
          )
          expectPublishedRows(
            harness,
            new Map([0, 1, 2].map((id) => [id, { id, position: id }] as const)),
          )
        },
        () => [
          () => persistence.resolve(),
          () => heldTransaction.isPersisted.promise.catch(() => undefined),
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

it(`keeps metadata aliases within each independent input world`, () => {
  const value = { nested: 1 }
  const input = {
    first: value,
    second: value,
    absentValue: undefined,
    nan: NaN,
  }
  const worlds = metadataWorlds(input)
  for (const world of [worlds.model, worlds.driver]) {
    expect(world.first).toBe(world.second)
    expect(world.first).not.toBe(value)
    expect(world).toEqual(input)
  }
  expect(worlds.model.first).not.toBe(worlds.driver.first)
  worlds.driver.first.nested = 2
  expect(worlds.model.first.nested).toBe(1)
  expect(value.nested).toBe(1)
})

const mutateDriverMetadata: MetadataDriver = (value) => {
  if (typeof value === `object` && value !== null && `nested` in value) {
    value.nested = `corrupted by driver`
  }
  return value
}

it(`detects driver mutation of committed metadata without rewriting its authority`, async () => {
  const rounds: Array<PublicationRound> = [
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: { nested: 1 } }],
      outcome: `commit`,
    },
  ]
  const original = structuredClone(rounds)
  await expect(
    runPublicationHistory(rounds, mutateDriverMetadata),
  ).rejects.toMatchObject({ name: `AssertionError` })
  expect(rounds).toEqual(original)
  await runPublicationHistory(rounds)
  await runPublicationHistory(
    rounds.map((round) => ({ ...round, outcome: `abort` })),
    mutateDriverMetadata,
  )
})

it(`rejects a torn callback-time metadata cut even when settled metadata is correct`, async () => {
  const rounds: Array<PublicationRound> = [
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: false }],
      outcome: `commit`,
    },
  ]
  await expect(
    runPublicationHistory(rounds, unchangedMetadata, (cuts) => {
      cuts[1]!.metadata.set(1, undefined)
    }),
  ).rejects.toMatchObject({ name: `AssertionError` })
  await runPublicationHistory(rounds)
})

it.each(
  ([`initial`, `retained`] as const).flatMap((placement) =>
    [true, false].map((canceledFirst) => ({ placement, canceledFirst })),
  ),
)(
  `detects $placement metadata mutation with canceledFirst=$canceledFirst`,
  async ({ placement, canceledFirst }) => {
    const initial: Array<MetadataEntryState> =
      placement === `initial`
        ? [
            { present: true, value: { nested: 1 } },
            { present: false },
            { present: false },
          ]
        : [{ present: false }, { present: false }, { present: false }]
    const retained: MetadataOperation = {
      type: `set`,
      value: placement === `retained` ? { nested: 2 } : false,
    }
    const original = structuredClone({ initial, retained })
    const run = (driver: MetadataDriver) =>
      expectMetadataCancellationOwnership(
        [1],
        [2],
        { type: `delete` },
        retained,
        canceledFirst,
        initial,
        driver,
      )
    await expect(run(mutateDriverMetadata)).rejects.toMatchObject({
      name: `AssertionError`,
    })
    expect({ initial, retained }).toEqual(original)
    await run(unchangedMetadata)
  },
)

it(`shrinks and replays a driver-only metadata corruption`, async () => {
  const roundsFor = (nested: number): Array<PublicationRound> => [
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: { nested } }],
      outcome: `commit`,
    },
  ]
  const property = fc.asyncProperty(fc.integer(), (nested) =>
    runPublicationHistory(roundsFor(nested), mutateDriverMetadata),
  )
  const failure = await fc.check(property, { seed: 505101, numRuns: 10 })
  expect(failure.failed).toBe(true)
  expect(failure.errorInstance).toMatchObject({ name: `AssertionError` })
  if (failure.counterexample === null) {
    throw new Error(`Missing metadata corruption replay`)
  }
  const replay = await fc.check(property, {
    seed: failure.seed,
    path: failure.counterexamplePath,
    endOnFailure: true,
  })
  expect(replay.failed).toBe(true)
  expect(replay.counterexample).toEqual(failure.counterexample)
  expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
  await runPublicationHistory(roundsFor(failure.counterexample[0]))
})

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

it(`applies the last committed metadata write and discards aborted writes`, async () => {
  await runPublicationHistory([
    {
      key: 1,
      delta: 2,
      metadata: [
        { key: 1, type: `set`, value: `superseded` },
        { key: 0, type: `set`, value: Number.NaN },
        { key: 1, type: `set`, value: false },
      ],
      outcome: `commit`,
    },
    {
      key: 1,
      delta: -1,
      metadata: [
        { key: 1, type: `delete` },
        { key: 2, type: `set`, value: `canceled` },
      ],
      outcome: `abort`,
    },
  ])
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

const publicationHistoryArbitrary = fc.array(publicationRoundArbitrary, {
  minLength: 1,
  maxLength: 8,
})

type MetadataCancellationHistory =
  typeof metadataCancellationArbitrary extends fc.Arbitrary<infer THistory>
    ? THistory
    : never

const runCancellationHistory = ({
  canceledKeys,
  retainedKeys,
  canceledOperation,
  retainedOperation,
  canceledFirst,
  initialMetadata,
}: MetadataCancellationHistory) =>
  expectMetadataCancellationOwnership(
    canceledKeys,
    retainedKeys,
    canceledOperation,
    retainedOperation,
    canceledFirst,
    initialMetadata,
  )

describe(`generated metadata publication histories`, () => {
  if (requestedReplayProperty === undefined) {
    fcTest.prop([publicationHistoryArbitrary], {
      numRuns: oracleRuns(50),
      seed: 1_805_001,
    })(
      `keeps metadata-only optimistic settlement a valid keyed diff (fixed)`,
      runPublicationHistory,
    )
    fcTest.prop(
      [publicationHistoryArbitrary],
      oraclePropertyOptions(50, metadataOnlyProperty),
    )(
      `keeps metadata-only optimistic settlement a valid keyed diff (random)`,
      runPublicationHistory,
    )

    fcTest.prop([metadataCancellationArbitrary], {
      numRuns: oracleRuns(50),
      seed: 1_805_002,
    })(
      `keeps metadata suppression owned by pending transactions (fixed)`,
      runCancellationHistory,
    )
    fcTest.prop(
      [metadataCancellationArbitrary],
      oraclePropertyOptions(50, metadataCancellationProperty),
    )(
      `keeps metadata suppression owned by pending transactions (random)`,
      runCancellationHistory,
    )
  } else if (requestedReplayProperty === metadataOnlyProperty) {
    fcTest.prop(
      [publicationHistoryArbitrary],
      oraclePropertyOptions(50, metadataOnlyProperty),
    )(`replays metadata-only optimistic settlement`, runPublicationHistory)
  } else if (requestedReplayProperty === metadataCancellationProperty) {
    fcTest.prop(
      [metadataCancellationArbitrary],
      oraclePropertyOptions(50, metadataCancellationProperty),
    )(`replays metadata cancellation ownership`, runCancellationHistory)
  }
})
