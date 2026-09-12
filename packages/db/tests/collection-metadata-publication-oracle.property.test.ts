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
    for (const write of expectedRound.metadata) {
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
): Promise<void> {
  const worlds = metadataWorlds(rounds)
  const harness = await createPublicationHarness()
  const model = new Map(
    [0, 1, 2].map((id) => [id, { id, position: id }] as const),
  )
  const metadataModel = new Map<number, unknown>()
  try {
    for (const [index, round] of worlds.driver.entries()) {
      await applyRound(
        harness,
        round,
        worlds.model[index]!,
        model,
        metadataModel,
        writeMetadata,
      )
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
  writeMetadata: MetadataDriver = unchangedMetadata,
): Promise<void> {
  const worlds = metadataWorlds({
    canceledOperation,
    retainedOperation,
    initialMetadataState,
  })
  const harness = await createPublicationHarness()
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
    const receipt = sync.commit(signal)
    if (receipt === true) {
      throw new Error(`Persisting optimistic work did not hold metadata sync`)
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

  try {
    const batchCountBefore = harness.batches.length
    const rowsBefore = [...harness.rows.values()]

    canceledController.abort()

    await expect(canceled).rejects.toBeInstanceOf(SyncTransactionAbortedError)
    expect(harness.batches).toHaveLength(batchCountBefore)
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
  } finally {
    persistence.resolve()
    await heldTransaction.isPersisted.promise.catch(() => undefined)
    await Promise.all([
      canceled.catch(() => undefined),
      retained.catch(() => undefined),
    ])
    harness.unsubscribe()
    await Promise.all([harness.liveRows.cleanup(), harness.rows.cleanup()])
  }
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
