/**
 * Ordinary regression tests for persisted source reconciliation, collection reset, and reload ordering with fixed scenarios. The oracle that owns these laws, including the reconciliation model, is persisted-oracle.test.ts; its generated and model-checked cases stay there.
 */
import { expect, it, vi } from 'vitest'
import {
  DbClient,
  collectionOptions,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import {
  IndeterminateCommitError,
  PersistedCollectionDurabilityError,
  persistedCollectionOptions,
} from '../src'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createCoordinatorHarness,
  createDeferred,
  createEventGate,
  createFailStopCoordinatorHarness,
  createRecordingAdapter,
  expectExactSnapshot,
  flushAsyncWork,
  observeSettlement,
  overrideBaselineRows,
  stripVirtualProps,
} from './persisted-support'
import type { LoadSubsetOptions, SyncMetadataApi } from '@tanstack/db'
import type { Todo, TodoSyncParams } from './persisted-support'

// A logical subset owner can retire while a managed cache claim is being
// renewed. The independent ownership law says only a retained demand may
// establish a physical remote acquisition. Hold renewal after the wrapper's
// admission check, then either retire or retain the request before releasing
// the gate. Compare coordinator acquisition work when the load settles; the
// retained neighbor proves this cut still permits one valid acquisition.
it.each([false, true])(
  `starts remote acquisition after claim renewal only when demand remains retained (retire=%s)`,
  async (retire) => {
    const adapter = createRecordingAdapter()
    const renewalEntered = createEventGate()
    const releaseRenewal = createEventGate()
    let holdRenewal = false
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `review-claim-storage`,
      claimId: `review-claim`,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.renewCacheGenerationClaim = async () => {
      if (holdRenewal) {
        renewalEntered.resolve()
        await releaseRenewal.promise
      }
      return Date.now() + 10_000
    }
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: `review-rotated-storage`,
      claimId: `review-claim`,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.releaseCacheGenerationClaim = async () => {}
    const coordinator = createFailStopCoordinatorHarness(`review-unload`)
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `review-unload`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            params.markReady()
            return {
              loadSubset: async () => {},
              restartAfterScopedRecovery: () => {},
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const options: LoadSubsetOptions = { limit: 1 }
    try {
      await collection.stateWhenReady()
      holdRenewal = true
      const load = Promise.resolve(collection._sync.loadSubset(options))
      await atPersistedOracleCheckpoint(
        renewalEntered.promise,
        `claim renewal entered`,
      )
      if (retire) collection._sync.unloadSubset(options)
      releaseRenewal.resolve()
      await atPersistedOracleCheckpoint(load, `late load settled`)
      expect(coordinator.remoteEnsureCalls).toHaveLength(retire ? 0 : 1)
    } finally {
      releaseRenewal.resolve()
      await collection.cleanup()
    }
  },
)

// A cache read can lose its claim at the post-read check. The reference
// ownership law keeps the admitted demand through rotation and gives it one
// replacement acquisition. Hold that acquisition to compare both its work
// count and the caller's settlement before and after source completion.
// The neighboring pre-read loss and peer-notice histories exercise different
// rotation cuts; this one specifically reaches the post-read renewal cut.
it(`does not request a rotated in-flight subset twice`, async () => {
  const adapter = createRecordingAdapter()
  const coordinator = createFailStopCoordinatorHarness(`review-duplicate`)
  const ensureStarted = createEventGate()
  const releaseEnsure = createEventGate()
  coordinator.requestEnsureRemoteSubset = async (_id, options) => {
    coordinator.remoteEnsureCalls.push(options)
    ensureStarted.resolve()
    await releaseEnsure.promise
  }
  let storageId = `review-duplicate-old`
  let loseClaim = false
  let loseAfterRead = false
  const originalLoadSubset = adapter.loadSubset.bind(adapter)
  adapter.loadSubset = async (...args) => {
    const rows = await originalLoadSubset(...args)
    if (loseAfterRead) {
      loseAfterRead = false
      loseClaim = true
    }
    return rows
  }
  adapter.claimCacheGeneration = async () => ({
    storageCollectionId: storageId,
    claimId: `review-duplicate-claim`,
    expiresAtMs: Date.now() + 10_000,
  })
  adapter.renewCacheGenerationClaim = async () =>
    loseClaim ? undefined : Date.now() + 10_000
  adapter.rotateCacheGeneration = async () => {
    loseClaim = false
    storageId = `review-duplicate-new`
    return {
      storageCollectionId: storageId,
      claimId: `review-duplicate-claim`,
      expiresAtMs: Date.now() + 10_000,
    }
  }
  adapter.releaseCacheGenerationClaim = async () => {}
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `review-duplicate`,
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: async () => {},
            restartAfterScopedRecovery: () => {},
          }
        },
      },
      persistence: { adapter, coordinator },
    }),
  )
  try {
    await collection.stateWhenReady()
    loseAfterRead = true
    const load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
    await atPersistedOracleCheckpoint(
      ensureStarted.promise,
      `replacement acquisition`,
    )
    await flushAsyncWork()
    expect(storageId).toBe(`review-duplicate-new`)
    expect(coordinator.remoteEnsureCalls).toHaveLength(1)
    let settled = false
    void load.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await flushAsyncWork()
    expect(settled).toBe(false)
    releaseEnsure.resolve()
    await atPersistedOracleCheckpoint(load, `replacement demand settlement`)
    expect(coordinator.remoteEnsureCalls).toHaveLength(1)
  } finally {
    releaseEnsure.resolve()
    await collection.cleanup()
  }
})

// Reconciliation after a lost answer can arrive even when a peer already
// published the original tx:committed. A duplicate proof must not turn an
// unchanged durable snapshot into a second public change batch. This owner
// checks the persisted wrapper and mounted dependent graph, not SQLite or a
// browser transport. The notification's explicit flag reaches the equal-seq
// branch that ordinary tx deduplication would skip. An orphan row-metadata
// entry is not part of the loaded row snapshot; an unchanged-row shortcut
// must still remove it, as an ordinary full replacement does. The held subset
// read exposes the pending cut; the final comparison waits for the public
// metadata cleanup and checks that neither Collection published a row event.
it(`does not republish unchanged rows for a repeated reconciliation notice`, async () => {
  const adapter = createRecordingAdapter([{ id: `crossing`, title: `settled` }])
  const coordinator = createCoordinatorHarness()
  const collectionId = `source-reconciliation-repeat`
  const reloadEntered = createDeferred()
  const releaseReload = createDeferred()
  let source!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
        },
      },
      persistence: { adapter, coordinator },
    }),
  )
  const live = createLiveQueryCollection((q) => q.from({ row: collection }))
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
    await atPersistedOracleCheckpoint(live.preload(), `live query ready`)
    source.begin()
    source.metadata?.row.set(`ghost`, { stale: true })
    await atPersistedOracleCheckpoint(
      Promise.resolve(source.commit()),
      `orphan row metadata applied`,
    )
    expect(source.metadata?.row.get(`ghost`)).toEqual({ stale: true })
    const sourceEvents: Array<string> = []
    const liveEvents: Array<string> = []
    const sourceSubscription = collection.subscribeChanges((changes) => {
      sourceEvents.push(...changes.map(({ key }) => String(key)))
    })
    const liveSubscription = live.subscribeChanges((changes) => {
      liveEvents.push(...changes.map(({ key }) => String(key)))
    })
    try {
      const loadSubset = adapter.loadSubset
      adapter.loadSubset = async (...args) => {
        reloadEntered.resolve()
        await releaseReload.promise
        return loadSubset(...args)
      }
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `crossing`,
          latestRowVersion: 1,
          requiresFullReload: true,
          reconciliationReload: true,
        },
        `replacement`,
        collectionId,
      )
      await atPersistedOracleCheckpoint(
        reloadEntered.promise,
        `reconciliation reload entered`,
      )
      await flushAsyncWork()
      expect(source.metadata?.row.get(`ghost`)).toEqual({ stale: true })
      expect({ sourceEvents, liveEvents }).toEqual({
        sourceEvents: [],
        liveEvents: [],
      })
      releaseReload.resolve()
      await vi.waitFor(() =>
        expect(source.metadata?.row.get(`ghost`)).toBeUndefined(),
      )
      await flushAsyncWork()
      expect({
        sourceEvents,
        liveEvents,
        sourceIds: [...collection.keys()].sort(),
        liveIds: [...live.keys()].sort(),
        orphanMetadata: source.metadata?.row.get(`ghost`),
        status: collection.status,
        liveStatus: live.status,
      }).toEqual({
        sourceEvents: [],
        liveEvents: [],
        sourceIds: [`crossing`],
        liveIds: [`crossing`],
        orphanMetadata: undefined,
        status: `ready`,
        liveStatus: `ready`,
      })
    } finally {
      liveSubscription.unsubscribe()
      sourceSubscription.unsubscribe()
    }
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseReload.resolve()
    await cleanupPersistedOracle(
      [() => live.cleanup(), () => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// SQLite stores array holes as null and omits enumerable array properties
// outside the indexed elements. A source Collection can still hold the
// authored array shape before a reconciliation reload. The durable row below
// is the independent reference; the public source and live-query rows must
// publish it at this checkpoint, even when general change-event equality
// considers the arrays equal. The held subset read keeps the authored shape
// visible at the pending cut; the settled cut compares both public shapes.
it.each([`sparse slot`, `extra array property`] as const)(
  `publishes the durable array shape after a reconciliation reload: %s`,
  async (shape) => {
    const authoredValues: Array<string | null> =
      shape === `sparse slot`
        ? Array<string | null>(1)
        : Object.assign([`kept`], { extra: `not durable` })
    const durableValues: Array<string | null> =
      shape === `sparse slot` ? [null] : [`kept`]
    const adapter = createRecordingAdapter([
      { id: `crossing`, title: `source`, values: authoredValues },
    ])
    const coordinator = createCoordinatorHarness()
    const collectionId = `source-array-shape-${shape}`
    const reloadEntered = createDeferred()
    const releaseReload = createDeferred()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        getKey: (row) => row.id,
        sync: { sync: (params) => params.markReady() },
        persistence: { adapter, coordinator },
      }),
    )
    const live = createLiveQueryCollection((q) => q.from({ row: collection }))
    let hasPrimaryFailure = false
    const shapeOf = (values: Array<string | null> | undefined) => ({
      indexedKeys: values
        ? Object.keys(values).filter((key) => key === `0`)
        : [],
      firstValue: values?.[0],
      hasExtra: values ? Object.hasOwn(values, `extra`) : false,
    })
    try {
      await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
      await atPersistedOracleCheckpoint(live.preload(), `live query ready`)
      const loadSubset = adapter.loadSubset
      adapter.loadSubset = async (...args) => {
        reloadEntered.resolve()
        await releaseReload.promise
        return loadSubset(...args)
      }
      adapter.rows.set(`crossing`, {
        id: `crossing`,
        title: `source`,
        values: durableValues,
      })
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `crossing`,
          latestRowVersion: 1,
          requiresFullReload: true,
          reconciliationReload: true,
        },
        `replacement`,
        collectionId,
      )
      await atPersistedOracleCheckpoint(
        reloadEntered.promise,
        `durable array reload entered`,
      )
      await flushAsyncWork()
      const expectedShape = shapeOf(durableValues)
      const authoredShape = shapeOf(authoredValues)
      expect({
        source: shapeOf(collection.get(`crossing`)?.values),
        live: shapeOf(live.get(`crossing`)?.values),
        durable: shapeOf(adapter.rows.get(`crossing`)?.values),
      }).toEqual({
        source: authoredShape,
        live: authoredShape,
        durable: expectedShape,
      })
      releaseReload.resolve()
      await vi.waitFor(() =>
        expect({
          source: shapeOf(collection.get(`crossing`)?.values),
          live: shapeOf(live.get(`crossing`)?.values),
        }).toEqual({ source: expectedShape, live: expectedShape }),
      )
      await flushAsyncWork()
      expect({
        source: shapeOf(collection.get(`crossing`)?.values),
        live: shapeOf(live.get(`crossing`)?.values),
        durable: shapeOf(adapter.rows.get(`crossing`)?.values),
      }).toEqual({
        source: expectedShape,
        live: expectedShape,
        durable: expectedShape,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseReload.resolve()
      await cleanupPersistedOracle(
        [() => live.cleanup(), () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  },
)

// A reconciliation reload compares the resulting public snapshot, not the raw
// durable relation. A DbClient seed can be absent from storage or have an older
// durable value while an ordinary row is unchanged. The independent model
// overlays that seed on the durable relation, then expects zero new change
// batches at the settled reload checkpoint. The ordinary row makes a delete-
// then-reinsert shortcut observable even though final rows would match.
it.each([`absent`, `older`] as const)(
  `does not republish an unchanged row beside an %s hydrated seed`,
  async (seedCache) => {
    const ordinary = { id: `ordinary`, title: `Durable` }
    const seed = { id: `seed`, title: `Hydrated` }
    const olderSeed = { id: seed.id, title: `Older durable` }
    const adapter = createRecordingAdapter([
      ordinary,
      ...(seedCache === `older` ? [olderSeed] : []),
    ])
    const coordinator = createCoordinatorHarness()
    const collectionId = `reconciliation-seed-${seedCache}`
    let source!: TodoSyncParams
    const descriptor = collectionOptions(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const client = new DbClient()
    const seedMetadata = { owner: `hydrated` }
    client.hydrate({
      collections: [
        {
          collectionId,
          rows: [{ key: seed.id, value: seed, metadata: seedMetadata }],
        },
      ],
    })
    const collection = client.collection(descriptor)
    const demand = {}
    let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
    let hasPrimaryFailure = false
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      await collection._sync.loadSubset(demand)
      const expected = new Map<string, Todo>([
        [ordinary.id, ordinary],
        [seed.id, seed],
      ])
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      expectExactSnapshot(publicRows(), expected)
      expect(source.metadata?.row.get(seed.id)).toEqual(seedMetadata)
      const eventKeys: Array<string> = []
      subscription = collection.subscribeChanges(
        (changes) => {
          eventKeys.push(...changes.map(({ key }) => String(key)))
        },
        { includeInitialState: false },
      )
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId },
        { txId: `repeat`, term: 1, seq: 1, rowVersion: 1, mutations: [] },
      )
      const reloadSettled = createEventGate()
      adapter.runInHydrationScope = async (task) => {
        const result = await task(adapter)
        reloadSettled.resolve()
        return result
      }
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `repeat`,
          latestRowVersion: 1,
          requiresFullReload: true,
          reconciliationReload: true,
        },
        undefined,
        collectionId,
      )
      await atPersistedOracleCheckpoint(
        reloadSettled.promise,
        `seed reconciliation reload settled`,
      )
      await flushAsyncWork()
      expectExactSnapshot(publicRows(), expected)
      expect(source.metadata?.row.get(seed.id)).toEqual(seedMetadata)
      expect(eventKeys).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      subscription?.unsubscribe()
      collection._sync.unloadSubset(demand)
      await cleanupPersistedOracle([() => client.cleanup()], hasPrimaryFailure)
    }
  },
)

// A real version gap can arrive after a baseline row was published while the
// coordinator offers no pullSince capability. The independent durable ledger
// has versions 1, 2, and 3; the passive Collection sees only version 3's notice.
// The fallback must replace its rows in one public publication. Recording each
// change callback catches a transient empty snapshot that a final-only
// assertion would miss.
it(`publishes a durable gap reload without an empty intermediate snapshot`, async () => {
  const adapter = createRecordingAdapter()
  const coordinator = createCoordinatorHarness()
  coordinator.pullSince = undefined
  const collectionId = `source-atomic-gap-fallback`
  const durableWrite = (id: string, term: number, rowVersion: number) =>
    adapter.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      {
        txId: id,
        term,
        seq: 1,
        rowVersion,
        mutations: [{ type: `insert`, key: id, value: { id, title: id } }],
      },
    )
  await durableWrite(`old`, 1, 1)
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: { sync: (params) => params.markReady() },
      persistence: { adapter, coordinator },
    }),
  )
  const exposed: Array<Array<string>> = []
  let stopPublication = () => {}
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(collection.preload(), `baseline ready`)
    expect([...collection.keys()]).toEqual([`old`])
    const publication = collection.subscribeChanges(
      () => exposed.push([...collection.keys()].sort()),
      { includeInitialState: false },
    )
    stopPublication = () => publication.unsubscribe()
    await durableWrite(`missed`, 2, 2)
    await durableWrite(`received`, 3, 3)
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 3,
        seq: 1,
        txId: `received`,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedRows: [
          { key: `received`, value: { id: `received`, title: `received` } },
        ],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() =>
      expect([...collection.keys()].sort()).toEqual([
        `missed`,
        `old`,
        `received`,
      ]),
    )
    expect(exposed.length).toBeGreaterThan(0)
    const complete = [`missed`, `old`, `received`]
    for (const rows of exposed) {
      expect([[`old`], complete]).toContainEqual(rows)
    }
    expect(exposed.at(-1)).toEqual(complete)
    expect(coordinator.pullSinceCalls).toBe(0)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    stopPublication()
    await cleanupPersistedOracle(
      [() => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// Row versions cross election terms even when an owner commits no rows.
// The authored durable ledger has a missed term-1 row, an empty term-2
// election, and a term-3 row. The passive Collection only receives the final
// notification. Its public snapshot must contain both durable rows after that
// notification settles; applying only the term-3 delta is a false green if the
// oracle checks only the latest key. This controlled adapter supplies durable
// writes and the coordinator supplies the lost-notice schedule.
it(`recovers a missed commit across a no-write election`, async () => {
  const adapter = createRecordingAdapter()
  const coordinator = createCoordinatorHarness()
  const collectionId = `source-empty-election-gap`
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: { sync: (params) => params.markReady() },
      persistence: { adapter, coordinator },
    }),
  )
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
    const durableWrite = async (
      txId: string,
      term: number,
      rowVersion: number,
    ) => {
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId,
          term,
          seq: 1,
          rowVersion,
          mutations: [
            { type: `insert`, key: txId, value: { id: txId, title: txId } },
          ],
        },
      )
    }
    await durableWrite(`missed`, 1, 1)
    // The controlled ledger jumps over term 2 without simulating its election.
    // The real SQLite/OPFS owner checks durable no-write term reservation.
    await durableWrite(`received`, 3, 2)
    expect([...collection.keys()]).toEqual([])
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 3,
        seq: 1,
        txId: `received`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [
          { key: `received`, value: { id: `received`, title: `received` } },
        ],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() =>
      expect([...collection.keys()].sort()).toEqual([`missed`, `received`]),
    )
    expect(coordinator.pullSinceCalls).toBe(1)
    expect([...adapter.rows.keys()].sort()).toEqual([`missed`, `received`])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupPersistedOracle(
      [() => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// Metadata-only certification can observe a durable stream position without
// loading its rows. That evidence must not make a later same-position notice
// look publicly applied. The authored log again has two durable rows; the
// Collection is empty at the certification cut, then receives the term-3
// notice and must recover both rows at the settled public checkpoint.
it(`recovers missed rows after position-only resume certification`, async () => {
  const adapter = createRecordingAdapter()
  const coordinator = createCoordinatorHarness()
  const collectionId = `source-position-only-certification-gap`
  let persistenceCapability:
    NonNullable<SyncMetadataApi<string>[`persistence`]> | undefined
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady, metadata }) => {
          persistenceCapability = metadata?.persistence ?? undefined
          markReady()
          return { loadSubset: () => true }
        },
      },
      persistence: { adapter, coordinator },
    }),
  )
  let hasPrimaryFailure = false
  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(persistenceCapability).toBeDefined())
    await atPersistedOracleCheckpoint(
      Promise.resolve(collection._sync.loadSubset({})).then(() => undefined),
      `empty subset loaded before position certification`,
    )
    const durableWrite = async (
      txId: string,
      term: number,
      rowVersion: number,
    ) =>
      adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId,
          term,
          seq: 1,
          rowVersion,
          mutations: [
            { type: `insert`, key: txId, value: { id: txId, title: txId } },
          ],
        },
      )
    await durableWrite(`missed`, 1, 1)
    await durableWrite(`received`, 3, 2)
    await atPersistedOracleCheckpoint(
      persistenceCapability!.resumeSnapshot.certify(),
      `position-only certification`,
    )
    expect([...collection.keys()]).toEqual([])
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 3,
        seq: 1,
        txId: `received`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [
          { key: `received`, value: { id: `received`, title: `received` } },
        ],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() =>
      expect([...collection.keys()].sort()).toEqual([`missed`, `received`]),
    )
    expect(coordinator.pullSinceCalls).toBe(1)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupPersistedOracle(
      [() => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// A schema reset starts a new row-version series. The independent ledger is
// five published rows, a durable reset to an empty table at version 0, then a
// new leader's first version-1 row. The controlled snapshot supplies the
// reset epoch and position while the real wrapper handles the notification.
// At the settled cut, the public Collection must contain only the new row.
it(`accepts a lower row version after a collection reset`, async () => {
  const initial = Array.from({ length: 5 }, (_, index) => ({
    id: `old-${index + 1}`,
    title: `old`,
  }))
  const adapter = createRecordingAdapter(initial)
  const coordinator = createCoordinatorHarness()
  const collectionId = `source-reset-version-rebase`
  let position = { term: 1, seq: 5, rowVersion: 5, resetEpoch: 0 }
  const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
  adapter.loadResumeSnapshot = async (...args) => ({
    ...(await loadResumeSnapshot(...args)),
    latestTerm: position.term,
    latestSeq: position.seq,
    latestRowVersion: position.rowVersion,
    resetEpoch: position.resetEpoch,
  })
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: { sync: (params) => params.markReady() },
      persistence: { adapter, coordinator },
    }),
  )
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(
      collection.preload(),
      `reset source ready`,
    )
    expect([...collection.keys()].sort()).toEqual(initial.map((row) => row.id))

    const resetSettled = createEventGate()
    adapter.runInHydrationScope = async (task) => {
      const result = await task(adapter)
      resetSettled.resolve()
      return result
    }

    adapter.rows.clear()
    position = { term: 1, seq: 0, rowVersion: 0, resetEpoch: 1 }
    coordinator.emit(
      { type: `collection:reset`, schemaVersion: 2, resetEpoch: 1 },
      `replacement`,
      collectionId,
    )
    await atPersistedOracleCheckpoint(
      resetSettled.promise,
      `reset reload and position read settled`,
    )
    expect([...collection.keys()]).toEqual([])

    const newRow = { id: `new`, title: `after reset` }
    adapter.rows.set(newRow.id, newRow)
    position = { term: 2, seq: 1, rowVersion: 1, resetEpoch: 1 }
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 2,
        seq: 1,
        txId: `post-reset`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [{ key: newRow.id, value: newRow }],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() => expect([...collection.keys()]).toEqual([`new`]))
    expect(collection.get(`new`)).toMatchObject(newRow)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupPersistedOracle(
      [() => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// The reset envelope has an epoch, but tx:committed does not. This controlled
// ledger keeps the same term after reset, then delivers a current notice, an
// old-epoch notice, and another current notice. Their terms alone cannot
// authorize row deltas. At each settled cut, the public Collection must equal
// durable rows and never expose the old-epoch row. The load counter records
// the conservative cost of checking each ambiguous notice against storage.
it(`checks same-term post-reset notices against durable rows`, async () => {
  const adapter = createRecordingAdapter([{ id: `old`, title: `old epoch` }])
  const coordinator = createCoordinatorHarness()
  const collectionId = `source-reset-same-term`
  let position = { term: 1, seq: 1, rowVersion: 1, resetEpoch: 0 }
  const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
  adapter.loadResumeSnapshot = async (...args) => ({
    ...(await loadResumeSnapshot(...args)),
    latestTerm: position.term,
    latestSeq: position.seq,
    latestRowVersion: position.rowVersion,
    resetEpoch: position.resetEpoch,
  })
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: { sync: (params) => params.markReady() },
      persistence: { adapter, coordinator },
    }),
  )
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(collection.preload(), `baseline ready`)
    expect([...collection.keys()]).toEqual([`old`])
    adapter.rows.clear()
    position = { term: 1, seq: 0, rowVersion: 0, resetEpoch: 1 }
    coordinator.emit(
      { type: `collection:reset`, schemaVersion: 2, resetEpoch: 1 },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() => expect([...collection.keys()]).toEqual([]))
    const loadsAfterReset = adapter.loadSubsetCalls.length

    const first = { id: `first`, title: `new epoch` }
    adapter.rows.set(first.id, first)
    position = { term: 1, seq: 1, rowVersion: 1, resetEpoch: 1 }
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `new-first`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [{ key: first.id, value: first }],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() => expect([...collection.keys()]).toEqual([`first`]))

    const stale = { id: `stale`, title: `old epoch` }
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `old-delayed`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [{ key: stale.id, value: stale }],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await flushAsyncWork()
    expect([...collection.keys()]).toEqual([`first`])
    await vi.waitFor(() =>
      expect(adapter.loadSubsetCalls).toHaveLength(loadsAfterReset + 2),
    )

    const second = { id: `second`, title: `new epoch` }
    adapter.rows.set(second.id, second)
    position = { term: 1, seq: 2, rowVersion: 2, resetEpoch: 1 }
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `new-second`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [{ key: second.id, value: second }],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() =>
      expect([...collection.keys()].sort()).toEqual([`first`, `second`]),
    )
    expect(adapter.loadSubsetCalls).toHaveLength(loadsAfterReset + 3)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupPersistedOracle(
      [() => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// A delayed pre-reset notification can have the same row version as a new
// post-reset transaction. Term and sequence alone cannot certify its reset
// epoch. Reread the durable snapshot for an old term even after a newer term
// has appeared. Both notice orders must leave only post-reset rows public.
it.each([`stale-first`, `fresh-first`] as const)(
  `does not republish a delayed pre-reset row after collection reset / %s`,
  async (order) => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const collectionId = `source-reset-stale-notice`
    let position = { term: 0, seq: 0, rowVersion: 0, resetEpoch: 0 }
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => ({
      ...(await loadResumeSnapshot(...args)),
      latestTerm: position.term,
      latestSeq: position.seq,
      latestRowVersion: position.rowVersion,
      resetEpoch: position.resetEpoch,
    })
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        getKey: (row) => row.id,
        sync: { sync: (params) => params.markReady() },
        persistence: { adapter, coordinator },
      }),
    )
    let hasPrimaryFailure = false
    try {
      await atPersistedOracleCheckpoint(
        collection.preload(),
        `stale source ready`,
      )
      const resetSettled = createEventGate()
      const staleReloadSettled = createEventGate()
      let scopeCount = 0
      adapter.runInHydrationScope = async (task) => {
        const result = await task(adapter)
        scopeCount++
        if (scopeCount === 1) resetSettled.resolve()
        if (scopeCount === 2) staleReloadSettled.resolve()
        return result
      }
      const stale = { id: `stale`, title: `before reset` }
      adapter.rows.set(stale.id, stale)
      position = { term: 1, seq: 2, rowVersion: 2, resetEpoch: 0 }
      // The original notification is lost; only the durable ledger saw it.
      adapter.rows.clear()
      position = { term: 1, seq: 0, rowVersion: 0, resetEpoch: 1 }
      coordinator.emit(
        { type: `collection:reset`, schemaVersion: 2, resetEpoch: 1 },
        `replacement`,
        collectionId,
      )
      await atPersistedOracleCheckpoint(resetSettled.promise, `reset settled`)
      expect([...collection.keys()]).toEqual([])

      const fresh = { id: `fresh`, title: `after reset` }
      const emitStale = () =>
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 2,
            txId: `pre-reset`,
            latestRowVersion: 2,
            requiresFullReload: false,
            changedRows: [{ key: stale.id, value: stale }],
            deletedKeys: [],
          },
          `replacement`,
          collectionId,
        )
      const emitFresh = () =>
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 2,
            seq: 1,
            txId: `post-reset`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows: [{ key: fresh.id, value: fresh }],
            deletedKeys: [],
          },
          `replacement`,
          collectionId,
        )
      if (order === `fresh-first`) {
        adapter.rows.set(fresh.id, fresh)
        position = { term: 2, seq: 1, rowVersion: 1, resetEpoch: 1 }
        emitFresh()
        await vi.waitFor(() =>
          expect(collection.get(`fresh`)).toMatchObject(fresh),
        )
        emitStale()
      } else {
        emitStale()
      }
      await atPersistedOracleCheckpoint(
        staleReloadSettled.promise,
        `old-term reload settled`,
      )
      await flushAsyncWork()
      if (order === `stale-first`) {
        adapter.rows.set(fresh.id, fresh)
        position = { term: 2, seq: 1, rowVersion: 1, resetEpoch: 1 }
        emitFresh()
        await vi.waitFor(() =>
          expect(collection.get(`fresh`)).toMatchObject(fresh),
        )
      }
      expect([...collection.keys()]).toEqual([`fresh`])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  },
)

// A metadata-only read after a reset reload cannot certify rows that were
// committed between the two reads. The controlled adapter holds that exact
// boundary: the public snapshot is empty, then a new term commits row 1 before
// the position-only read returns. When row 2 is announced, recovery must load
// both rows rather than treating the observed position as public coverage.
it(`recovers a row committed between reset reload and position observation`, async () => {
  const adapter = createRecordingAdapter()
  const coordinator = createCoordinatorHarness()
  const collectionId = `source-reset-position-race`
  let position = { term: 1, seq: 0, rowVersion: 0, resetEpoch: 0 }
  let holdResetPositionRead = false
  const positionReadEntered = createEventGate()
  const releasePositionRead = createEventGate()
  const resetSettled = createEventGate()
  const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
  adapter.loadResumeSnapshot = async (...args) => {
    if (holdResetPositionRead && args[1]?.includeRows === false) {
      holdResetPositionRead = false
      positionReadEntered.resolve()
      await releasePositionRead.promise
    }
    return {
      ...(await loadResumeSnapshot(...args)),
      latestTerm: position.term,
      latestSeq: position.seq,
      latestRowVersion: position.rowVersion,
      resetEpoch: position.resetEpoch,
    }
  }
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: { sync: (params) => params.markReady() },
      persistence: { adapter, coordinator },
    }),
  )
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(collection.preload(), `race source ready`)
    adapter.runInHydrationScope = async (task) => {
      const result = await task(adapter)
      resetSettled.resolve()
      return result
    }
    position = { term: 1, seq: 0, rowVersion: 0, resetEpoch: 1 }
    holdResetPositionRead = true
    coordinator.emit(
      { type: `collection:reset`, schemaVersion: 2, resetEpoch: 1 },
      `replacement`,
      collectionId,
    )
    await atPersistedOracleCheckpoint(
      positionReadEntered.promise,
      `position read held after empty reload`,
    )
    expect([...collection.keys()]).toEqual([])

    const missed = { id: `missed`, title: `committed during reset` }
    adapter.rows.set(missed.id, missed)
    position = { term: 2, seq: 1, rowVersion: 1, resetEpoch: 1 }
    releasePositionRead.resolve()
    await atPersistedOracleCheckpoint(resetSettled.promise, `reset settled`)
    expect([...collection.keys()]).toEqual([])

    const received = { id: `received`, title: `later commit` }
    adapter.rows.set(received.id, received)
    position = { term: 3, seq: 1, rowVersion: 2, resetEpoch: 1 }
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 3,
        seq: 1,
        txId: `received`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [{ key: received.id, value: received }],
        deletedKeys: [],
      },
      `replacement`,
      collectionId,
    )
    await vi.waitFor(() =>
      expect([...collection.keys()].sort()).toEqual([`missed`, `received`]),
    )
    expect(coordinator.pullSinceCalls).toBe(1)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releasePositionRead.resolve()
    await cleanupPersistedOracle(
      [() => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// SQLite encodes a nested class value as a plain durable record. The
// independent reference is the durable row's prototype category: after a
// reconciliation reload settles, the public source row must have that shape.
// An equal keyed class is a distinguishing wrong answer because ordinary
// change-event equality accepts it as equal to a plain record. The held read
// exposes the authored intermediate cut; this controlled adapter does not
// itself establish the real SQLite serialization premise.
it(`replaces an equal nested class with its durable plain record`, async () => {
  class DetailBox {
    constructor(public rank: number) {}
  }
  const adapter = createRecordingAdapter()
  const coordinator = createCoordinatorHarness()
  const collectionId = `source-nested-prototype-reload`
  const reloadEntered = createDeferred()
  const releaseReload = createDeferred()
  let source!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
        },
      },
      persistence: { adapter, coordinator },
    }),
  )
  const live = createLiveQueryCollection((q) => q.from({ row: collection }))
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
    await atPersistedOracleCheckpoint(live.preload(), `live query ready`)
    source.begin()
    source.write({
      type: `insert`,
      value: { id: `crossing`, title: `source`, payload: new DetailBox(7) },
    })
    await atPersistedOracleCheckpoint(
      Promise.resolve(source.commit()),
      `authored source receipt`,
    )
    expect(collection.get(`crossing`)?.payload).toBeInstanceOf(DetailBox)
    await vi.waitFor(() =>
      expect(live.get(`crossing`)?.payload).toBeInstanceOf(DetailBox),
    )
    const loadSubset = adapter.loadSubset
    adapter.loadSubset = async (...args) => {
      reloadEntered.resolve()
      await releaseReload.promise
      return loadSubset(...args)
    }
    adapter.rows.set(`crossing`, {
      id: `crossing`,
      title: `source`,
      payload: { rank: 7 },
    })
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `crossing`,
        latestRowVersion: 1,
        requiresFullReload: true,
        reconciliationReload: true,
      },
      `replacement`,
      collectionId,
    )
    await atPersistedOracleCheckpoint(
      reloadEntered.promise,
      `nested shape reload entered`,
    )
    expect(collection.get(`crossing`)?.payload).toBeInstanceOf(DetailBox)
    expect(live.get(`crossing`)?.payload).toBeInstanceOf(DetailBox)
    releaseReload.resolve()
    await vi.waitFor(() => {
      expect(Object.getPrototypeOf(collection.get(`crossing`)?.payload)).toBe(
        Object.prototype,
      )
      expect(Object.getPrototypeOf(live.get(`crossing`)?.payload)).toBe(
        Object.prototype,
      )
    })
    expect(collection.get(`crossing`)?.payload).toEqual({ rank: 7 })
    expect(live.get(`crossing`)?.payload).toEqual({ rank: 7 })
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseReload.resolve()
    await cleanupPersistedOracle(
      [() => live.cleanup(), () => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// A source commit accepted while persisted restore is reading waits behind the
// hydration baseline. Its queued applied receipt remains one obligation when
// the coordinator answer is lost. The independent authored ledger is baseline
// → crossing → later; no second source sync run or queue re-admission exists in
// that model. The controlled adapter holds the baseline and then the exact-ID
// decision so both pending checkpoints are observable.
it(`reconciles a source receipt queued behind persisted hydration`, async () => {
  const adapter = createRecordingAdapter([{ id: `shared`, title: `baseline` }])
  const hydrationEntered = createEventGate()
  const releaseHydration = createEventGate()
  overrideBaselineRows(adapter, async () => {
    hydrationEntered.resolve()
    await releaseHydration.promise
    return [
      {
        key: `shared`,
        value: { id: `shared`, title: `baseline` },
      },
    ]
  })
  const coordinator = createCoordinatorHarness()
  const reconcileEntered = createEventGate()
  const releaseReconcile = createEventGate()
  const uncertain = new IndeterminateCommitError({
    collectionId: `queued-reconciliation`,
    requestType: `rpc:applyCommittedTx:req`,
    previousLeaderId: `retired`,
    previousTerm: 1,
    currentLeaderId: `replacement`,
    currentTerm: 2,
    cause: new Error(`lost answer`),
  })
  let first = true
  coordinator.requestApplyCommittedTx = async (
    collectionId,
    tx,
    scopedAdapter,
  ) => {
    if (first) {
      first = false
      expect(scopedAdapter).toBeDefined()
      throw uncertain
    }
    await (scopedAdapter ?? adapter).applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      tx,
    )
    return {
      type: `rpc:applyCommittedTx:res`,
      rpcId: tx.txId,
      ok: true,
      term: tx.term,
      seq: tx.seq,
      latestRowVersion: tx.rowVersion,
    }
  }
  coordinator.reconcileCommittedTx = async (
    collectionId,
    tx,
    anchor,
    scopedAdapter,
  ) => {
    expect(anchor).toEqual({ latestRowVersion: 0, resetEpoch: 0 })
    expect(scopedAdapter).toBeDefined()
    reconcileEntered.resolve()
    await releaseReconcile.promise
    const committed = { ...tx, term: 2, seq: 1, rowVersion: 1 }
    await (scopedAdapter ?? adapter).applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      committed,
    )
    return {
      type: `rpc:reconcileCommittedTx:res`,
      rpcId: tx.txId,
      ok: true,
      alreadyApplied: false,
      committed: { term: 2, seq: 1, rowVersion: 1 },
    }
  }
  let source!: TodoSyncParams
  let syncRuns = 0
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `queued-reconciliation`,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          source = params
          syncRuns++
          params.markReady()
        },
      },
      persistence: { adapter, coordinator },
    }),
  )
  const ready = collection.stateWhenReady()
  let firstReceipt: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await atPersistedOracleCheckpoint(hydrationEntered.promise, `held baseline`)
    source.begin()
    source.write({
      type: `update`,
      value: { id: `shared`, title: `crossing` },
    })
    source.metadata?.collection.set(`probe:cursor`, `crossing`)
    firstReceipt = Promise.resolve(source.commit()).then(() => undefined)
    const settlement = observeSettlement(firstReceipt)
    expect(settlement.read()).toEqual({ status: `pending` })
    expect(adapter.applyCommittedTxCalls).toHaveLength(0)
    releaseHydration.resolve()
    await atPersistedOracleCheckpoint(
      reconcileEntered.promise,
      `queued reconciliation entered`,
    )
    expect(settlement.read()).toEqual({ status: `pending` })
    expect(adapter.rows.get(`shared`)?.title).toBe(`baseline`)
    releaseReconcile.resolve()
    await atPersistedOracleCheckpoint(firstReceipt, `queued source receipt`)
    await atPersistedOracleCheckpoint(ready, `persisted restore ready`)
    expect({
      receipt: settlement.read(),
      status: collection.status,
      syncRuns,
      publicTitle: collection.get(`shared`)?.title,
      durableTitle: adapter.rows.get(`shared`)?.title,
      cursor: adapter.collectionMetadata.get(`probe:cursor`),
      durableTxCount: adapter.applyCommittedTxCalls.length,
    }).toEqual({
      receipt: { status: `fulfilled` },
      status: `ready`,
      syncRuns: 1,
      publicTitle: `crossing`,
      durableTitle: `crossing`,
      cursor: `crossing`,
      durableTxCount: 1,
    })
    source.begin()
    source.write({
      type: `update`,
      value: { id: `shared`, title: `later` },
    })
    source.metadata?.collection.set(`probe:cursor`, `later`)
    await atPersistedOracleCheckpoint(
      Promise.resolve(source.commit()),
      `queued source suffix`,
    )
    expect({
      status: collection.status,
      syncRuns,
      publicTitle: collection.get(`shared`)?.title,
      durableTitle: adapter.rows.get(`shared`)?.title,
      cursor: adapter.collectionMetadata.get(`probe:cursor`),
      durableTxCount: adapter.applyCommittedTxCalls.length,
    }).toEqual({
      status: `ready`,
      syncRuns: 1,
      publicTitle: `later`,
      durableTitle: `later`,
      cursor: `later`,
      durableTxCount: 2,
    })
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseHydration.resolve()
    releaseReconcile.resolve()
    await cleanupPersistedOracle(
      [
        () => ready.catch(() => undefined),
        () => firstReceipt?.catch(() => undefined),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
})

// A missing exact-ID proof leaves the original uncertainty visible. A known
// SQLite failure keeps its durability class and details, whether it arrived as
// a remote response or a direct local throw. In all three histories the source
// has no safe suffix: a later commit cannot advance durable rows or cursor.
it.each([`unknown`, `remote-durability`, `local-durability`] as const)(
  `fails the source run after %s reconciliation`,
  async (failureMode) => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const uncertain = new IndeterminateCommitError({
      collectionId: `failed-reconciliation`,
      requestType: `rpc:applyCommittedTx:req`,
      previousLeaderId: `retired`,
      previousTerm: 1,
      currentLeaderId: `replacement`,
      currentTerm: 2,
      cause: new Error(`lost answer`),
    })
    const localFailure = new PersistedCollectionDurabilityError(
      `SQLite reconciliation failed`,
      { code: `SQLITE_IOERR_FSYNC`, path: [`database`, `wal`] },
    )
    coordinator.requestApplyCommittedTx = async () => {
      throw uncertain
    }
    coordinator.reconcileCommittedTx = async () => {
      if (failureMode === `local-durability`) throw localFailure
      if (failureMode === `remote-durability`) {
        return {
          type: `rpc:reconcileCommittedTx:res`,
          rpcId: `known-failure`,
          ok: false,
          code: `PERSISTENCE_ERROR`,
          error: `disk write failed`,
          sourceCode: `SQLITE_IOERR_FSYNC`,
          path: [`database`, `wal`],
        }
      }
      return {
        type: `rpc:reconcileCommittedTx:res`,
        rpcId: `unknown`,
        ok: false,
        code: `UNDETERMINED`,
        error: `newer write exists`,
      }
    }
    let source!: TodoSyncParams
    let syncRuns = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `failed-reconciliation`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            syncRuns++
            params.markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const live = createLiveQueryCollection((q) => q.from({ row: collection }))
    const subscription = live.subscribeChanges(() => {})
    let hasPrimaryFailure = false
    try {
      await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
      await atPersistedOracleCheckpoint(live.preload(), `live ready`)
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `crossing`, title: `source` },
      })
      source.metadata?.collection.set(`probe:cursor`, `crossing`)
      let firstFailure: unknown
      try {
        await atPersistedOracleCheckpoint(
          Promise.resolve(source.commit()),
          `failed source receipt`,
        )
      } catch (error) {
        firstFailure = error
      }
      if (failureMode === `unknown`) {
        expect(firstFailure).toBe(uncertain)
      } else if (failureMode === `local-durability`) {
        expect(firstFailure).toBe(localFailure)
      } else {
        expect(firstFailure).toMatchObject({
          name: `PersistedCollectionDurabilityError`,
          code: `SQLITE_IOERR_FSYNC`,
          path: [`database`, `wal`],
        })
      }
      let suffixFailure: unknown
      try {
        source.begin()
        source.write({ type: `insert`, value: { id: `later`, title: `later` } })
        await Promise.resolve(source.commit())
      } catch (error) {
        suffixFailure = error
      }
      expect(suffixFailure).toBe(firstFailure)
      expect({
        sourceStatus: collection.status,
        liveStatus: live.status,
        syncRuns,
        durableIds: [...adapter.rows.keys()],
        durableCursor: adapter.collectionMetadata.get(`probe:cursor`),
        durableTxCount: adapter.applyCommittedTxCalls.length,
      }).toEqual({
        sourceStatus: `error`,
        liveStatus: `error`,
        syncRuns: 1,
        durableIds: [],
        durableCursor: undefined,
        durableTxCount: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      subscription.unsubscribe()
      await cleanupPersistedOracle(
        [() => live.cleanup(), () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  },
)
