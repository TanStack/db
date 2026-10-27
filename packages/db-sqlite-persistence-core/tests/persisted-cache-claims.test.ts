/**
 * Ordinary regression tests for persisted cache-generation claims, scoped refresh, and seq-gap replay timing, as fixed scenarios. The claim and replay laws are owned by persisted-oracle.test.ts, which keeps its generated notice histories.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  IR,
  SyncTransactionAbortedError,
  createCollection,
  createLiveQueryCollection,
  eq,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  InvalidPersistedCollectionConfigError,
  persistedCollectionOptions,
} from '../src'
import {
  assertGenerationNoticeHistory,
  atPersistedOracleCheckpoint,
  createCoordinatorHarness,
  createDeferred,
  createEventGate,
  createFailStopCoordinatorHarness,
  createFollowerTab,
  createRecordingAdapter,
  flushAsyncWork,
  observeSettlement,
  recordedStorageId,
  within,
} from './persisted-support'
import type {
  LoadSubsetOptions,
  SyncConfig,
  SyncMetadataApi,
} from '@tanstack/db'
import type {
  PersistedCollectionCoordinator,
  PersistenceAdapter,
  ProtocolEnvelope,
  TxCommitted,
} from '../src'
import type { FollowerRow, Todo, TodoSyncParams } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  // Removing an index revokes its durable accelerator after all event work
  // settles. The independent index registry follows the Collection's current
  // declarations, even when an earlier add operation is held in the adapter.
  // At the removal checkpoint the index is absent; the late add must not
  // resurrect it at the final checkpoint.
  it(`keeps a removed persisted index retired after its add completes late`, async () => {
    const adapter = createRecordingAdapter()
    const ensureEntered = createEventGate()
    const releaseEnsure = createEventGate()
    const ensureSettled = createEventGate()
    const removeSettled = createEventGate()
    const durableIndexes = new Map<string, boolean>()
    const operations: Array<string> = []
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `index-remove-storage`,
      claimId: `index-remove-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: `index-remove-new`,
      claimId: `index-remove-claim`,
    })
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async (_id, signature) => {
      operations.push(`ensure-enter`)
      ensureEntered.resolve()
      await releaseEnsure.promise
      durableIndexes.set(signature, true)
      operations.push(`ensure-settled`)
      ensureSettled.resolve()
    }
    adapter.markIndexRemoved = async (_id, signature) => {
      durableIndexes.set(signature, false)
      operations.push(`remove-settled`)
      removeSettled.resolve()
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `late-index-add-after-removal`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: { sync: ({ markReady }) => markReady() },
        persistence: { adapter },
      }),
    )
    try {
      await collection.stateWhenReady()
      const index = collection.createIndex((row) => row.title, {
        name: `transient-index`,
      })
      const signature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === index.id)?.signature
      if (!signature) throw new Error(`Missing index signature`)
      await atPersistedOracleCheckpoint(
        ensureEntered.promise,
        `index add entered`,
      )
      expect(collection.removeIndex(index)).toBe(true)
      await atPersistedOracleCheckpoint(
        removeSettled.promise,
        `index removal settled`,
      )
      expect(durableIndexes.get(signature)).toBe(false)
      releaseEnsure.resolve()
      await atPersistedOracleCheckpoint(
        ensureSettled.promise,
        `late index add settled`,
      )
      await flushAsyncWork()
      expect(collection.getIndexMetadata()).toEqual([])
      expect(durableIndexes.get(signature)).toBe(false)
      expect(operations.slice(0, 3)).toEqual([
        `ensure-enter`,
        `remove-settled`,
        `ensure-settled`,
      ])
      expect(operations.at(-1)).toBe(`remove-settled`)
    } finally {
      releaseEnsure.resolve()
      await collection.cleanup()
    }
  })

  // Re-adding the same index signature reverses the expected final state.
  // A held removal from the old declaration cannot deactivate the current
  // declaration after its add has completed. Signature, rather than object
  // identity, names the durable SQLite accelerator in this history.
  it(`keeps a re-added persisted index active after its removal completes late`, async () => {
    const adapter = createRecordingAdapter()
    const removeEntered = createEventGate()
    const releaseRemove = createEventGate()
    const removeSettled = createEventGate()
    const durableIndexes = new Map<string, boolean>()
    let ensureCalls = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `index-readd-storage`,
      claimId: `index-readd-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: `index-readd-new`,
      claimId: `index-readd-claim`,
    })
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async (_id, signature) => {
      ensureCalls++
      durableIndexes.set(signature, true)
    }
    adapter.markIndexRemoved = async (_id, signature) => {
      removeEntered.resolve()
      await releaseRemove.promise
      durableIndexes.set(signature, false)
      removeSettled.resolve()
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `late-index-removal-after-readd`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: { sync: ({ markReady }) => markReady() },
        persistence: { adapter },
      }),
    )
    try {
      await collection.stateWhenReady()
      const first = collection.createIndex((row) => row.title)
      const signature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === first.id)?.signature
      if (!signature) throw new Error(`Missing index signature`)
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(ensureCalls).toBe(1)),
        `first index add`,
      )
      expect(collection.removeIndex(first)).toBe(true)
      await atPersistedOracleCheckpoint(
        removeEntered.promise,
        `old index removal entered`,
      )
      const second = collection.createIndex((row) => row.title)
      expect(
        collection
          .getIndexMetadata()
          .find((metadata) => metadata.indexId === second.id)?.signature,
      ).toBe(signature)
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(ensureCalls).toBe(2)),
        `replacement index add`,
      )
      releaseRemove.resolve()
      await atPersistedOracleCheckpoint(
        removeSettled.promise,
        `old removal settled`,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(durableIndexes.get(signature)).toBe(true)),
        `current index restored`,
      )
      expect(collection.getIndexMetadata()).toHaveLength(1)
    } finally {
      releaseRemove.resolve()
      await collection.cleanup()
    }
  })

  // Rotation rebuilds current index declarations on a new physical table.
  // Removing one while its new-table bootstrap call is held must leave that
  // table without the index once recovery and the removal event both settle.
  // This is the neighboring bootstrap route for the add/remove race above.
  it(`removes an index deleted during held cache-rotation bootstrap`, async () => {
    const adapter = createRecordingAdapter()
    const bootstrapEntered = createEventGate()
    const releaseBootstrap = createEventGate()
    const removalSettled = createEventGate()
    const durableIndexes = new Map<string, boolean>()
    let storageId = `bootstrap-removal-old`
    let recovery!: () => Promise<void>
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `bootstrap-removal-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: (storageId = `bootstrap-removal-new`),
      claimId: `bootstrap-removal-claim`,
    })
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async (id, signature) => {
      if (recordedStorageId(id) === `bootstrap-removal-new`) {
        bootstrapEntered.resolve()
        await releaseBootstrap.promise
      }
      durableIndexes.set(`${recordedStorageId(id)}:${signature}`, true)
    }
    adapter.markIndexRemoved = async (id, signature) => {
      durableIndexes.set(`${recordedStorageId(id)}:${signature}`, false)
      removalSettled.resolve()
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `bootstrap-index-removal`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: (params) => {
            recovery = params.metadata!.persistence!.startScopedRecovery!
            params.markReady()
            return { restartAfterScopedRecovery: (gate) => gate }
          },
        },
        persistence: { adapter },
      }),
    )
    const index = collection.createIndex((row) => row.title)
    const signature = collection
      .getIndexMetadata()
      .find((metadata) => metadata.indexId === index.id)?.signature
    if (!signature) throw new Error(`Missing index signature`)
    let activeRecovery: Promise<void> | undefined
    try {
      await collection.stateWhenReady()
      activeRecovery = recovery()
      await atPersistedOracleCheckpoint(
        bootstrapEntered.promise,
        `new-table index bootstrap`,
      )
      expect(collection.removeIndex(index)).toBe(true)
      expect(collection.getIndexMetadata()).toEqual([])
      // The removal finishes first; the old bootstrap call can still finish
      // afterward and must not recreate the retired physical index.
      await atPersistedOracleCheckpoint(
        removalSettled.promise,
        `index removal before late bootstrap ensure`,
      )
      expect(durableIndexes.get(`bootstrap-removal-new:${signature}`)).toBe(
        false,
      )
      releaseBootstrap.resolve()
      await atPersistedOracleCheckpoint(
        activeRecovery,
        `cache rotation after index removal`,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() =>
          expect(durableIndexes.get(`bootstrap-removal-new:${signature}`)).toBe(
            false,
          ),
        ),
        `new-table index removal`,
      )
    } finally {
      releaseBootstrap.resolve()
      await Promise.allSettled([activeRecovery])
      await collection.cleanup()
    }
  })

  // The same signature can be declared again while bootstrap repairs a late
  // ensure. After that held removal finishes, the current Collection registry
  // requires the physical index to be present. This is the reverse boundary
  // of the preceding witness: the final declaration, not the order in which
  // obsolete adapter calls finish, determines the durable accelerator.
  it(`restores an index re-added during cache-rotation reconciliation`, async () => {
    const adapter = createRecordingAdapter()
    const firstEnsureEntered = createEventGate()
    const releaseFirstEnsure = createEventGate()
    const firstRemovalSettled = createEventGate()
    const secondRemovalEntered = createEventGate()
    const releaseSecondRemoval = createEventGate()
    const durableIndexes = new Map<string, boolean>()
    let storageId = `bootstrap-readd-old`
    let recovery!: () => Promise<void>
    let newStorageEnsures = 0
    let removals = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `bootstrap-readd-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: (storageId = `bootstrap-readd-new`),
      claimId: `bootstrap-readd-claim`,
    })
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async (id, signature) => {
      if (
        recordedStorageId(id) === `bootstrap-readd-new` &&
        ++newStorageEnsures === 1
      ) {
        firstEnsureEntered.resolve()
        await releaseFirstEnsure.promise
      }
      durableIndexes.set(`${recordedStorageId(id)}:${signature}`, true)
    }
    adapter.markIndexRemoved = async (id, signature) => {
      if (++removals === 2) {
        secondRemovalEntered.resolve()
        await releaseSecondRemoval.promise
      }
      durableIndexes.set(`${recordedStorageId(id)}:${signature}`, false)
      firstRemovalSettled.resolve()
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `bootstrap-index-readd`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: (params) => {
            recovery = params.metadata!.persistence!.startScopedRecovery!
            params.markReady()
            return { restartAfterScopedRecovery: (gate) => gate }
          },
        },
        persistence: { adapter },
      }),
    )
    const initial = collection.createIndex((row) => row.title)
    const signature = collection
      .getIndexMetadata()
      .find((metadata) => metadata.indexId === initial.id)?.signature
    if (!signature) throw new Error(`Missing index signature`)
    let activeRecovery: Promise<void> | undefined
    try {
      await collection.stateWhenReady()
      activeRecovery = recovery()
      await atPersistedOracleCheckpoint(
        firstEnsureEntered.promise,
        `first new-table ensure`,
      )
      expect(collection.removeIndex(initial)).toBe(true)
      await atPersistedOracleCheckpoint(
        firstRemovalSettled.promise,
        `old declaration removed`,
      )
      releaseFirstEnsure.resolve()
      await atPersistedOracleCheckpoint(
        secondRemovalEntered.promise,
        `bootstrap reconciliation removal`,
      )
      const current = collection.createIndex((row) => row.title)
      expect(
        collection
          .getIndexMetadata()
          .find((metadata) => metadata.indexId === current.id)?.signature,
      ).toBe(signature)
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(newStorageEnsures).toBeGreaterThan(1)),
        `re-added index ensure`,
      )
      releaseSecondRemoval.resolve()
      await atPersistedOracleCheckpoint(
        activeRecovery,
        `reconciled cache rotation`,
      )
      expect(collection.getIndexMetadata()).toHaveLength(1)
      expect(durableIndexes.get(`bootstrap-readd-new:${signature}`)).toBe(true)
    } finally {
      releaseFirstEnsure.resolve()
      releaseSecondRemoval.resolve()
      await Promise.allSettled([activeRecovery])
      await collection.cleanup()
    }
  })

  // A second recovery may be requested while the first is still rebuilding
  // indexes. The first completion cannot reopen source commit admission while
  // the second rotation is held. The two storage IDs and held index/rotation
  // gates make that distinction visible before the final cache is accepted.
  it(`keeps source commits quarantined through overlapping cache rotations`, async () => {
    const adapter = createRecordingAdapter()
    const firstIndexEntered = createEventGate()
    const releaseFirstIndex = createEventGate()
    const secondRotationEntered = createEventGate()
    const releaseSecondRotation = createEventGate()
    let storageId = `overlap-old`
    let rotations = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `overlap-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      if (++rotations === 2) {
        secondRotationEntered.resolve()
        await releaseSecondRotation.promise
      }
      storageId = `overlap-new-${rotations}`
      return { storageCollectionId: storageId, claimId: `overlap-claim` }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async (id) => {
      if (recordedStorageId(id) === `overlap-new-1`) {
        firstIndexEntered.resolve()
        await releaseFirstIndex.promise
      }
    }
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `overlap-cache-rotation`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return { restartAfterScopedRecovery: (gate) => gate }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.createIndex((row) => row.title)
    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    try {
      await collection.stateWhenReady()
      first = source.metadata!.persistence!.startScopedRecovery!()
      await atPersistedOracleCheckpoint(
        firstIndexEntered.promise,
        `first rotation index bootstrap`,
      )
      second = source.metadata!.persistence!.startScopedRecovery!()
      releaseFirstIndex.resolve()
      await atPersistedOracleCheckpoint(
        secondRotationEntered.promise,
        `second cache rotation`,
      )
      await first
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `intermediate`, title: `Unaccepted` },
      })
      await expect(source.commit()).rejects.toBeInstanceOf(
        SyncTransactionAbortedError,
      )
      expect(collection.get(`intermediate`)).toBeUndefined()
      releaseSecondRotation.resolve()
      await second
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `final`, title: `Accepted` },
      })
      await whenSyncAccepted(source.commit())
      expect(collection.get(`final`)).toMatchObject({ id: `final` })
      expect(storageId).toBe(`overlap-new-2`)
    } finally {
      releaseFirstIndex.resolve()
      releaseSecondRotation.resolve()
      await Promise.allSettled([first, second])
      await collection.cleanup()
    }
  })

  // Indexes are optional accelerators. An index event whose claim check hits
  // a temporary adapter error must settle its asynchronous listener without
  // changing the Collection's ready state. The adapter is held until after
  // the event so the checkpoint observes the listener's rejection path.
  it(`keeps a failed runtime index check best-effort`, async () => {
    const adapter = createRecordingAdapter()
    const indexCheckEntered = createEventGate()
    const releaseIndexCheck = createEventGate()
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let failIndexCheck = false
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `index-check-storage`,
      claimId: `index-check-claim`,
    })
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: `index-check-replacement`,
      claimId: `index-check-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => {
      if (failIndexCheck) {
        indexCheckEntered.resolve()
        await releaseIndexCheck.promise
        throw new Error(`temporary index claim check failure`)
      }
      return Date.now() + 10_000
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `index-check-best-effort`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: { sync: ({ markReady }) => markReady() },
        persistence: { adapter },
      }),
    )
    try {
      await collection.stateWhenReady()
      failIndexCheck = true
      collection.createIndex((row) => row.title, { name: `optional-index` })
      await atPersistedOracleCheckpoint(
        indexCheckEntered.promise,
        `runtime index claim check`,
      )
      releaseIndexCheck.resolve()
      await flushAsyncWork()
      expect(collection.status).toBe(`ready`)
      expect(warning).toHaveBeenCalledWith(
        `Failed to ensure persisted index after index:added:`,
        expect.any(Error),
      )
    } finally {
      releaseIndexCheck.resolve()
      warning.mockRestore()
      await collection.cleanup()
    }
  })

  // A demand waiting for startup has not reached the source or cache. Its
  // caller may cancel while a private cache rotation is held. The canceled
  // demand must reject promptly with AbortError; a sibling keeps waiting and
  // obtains source rows after rotation. The model treats cancellation as one
  // demand's settlement, not cancellation of the shared startup or rotation.
  // The held rotation separates the abort checkpoint from source entry.
  it(`settles an aborted startup demand while a sibling waits for cache rotation`, async () => {
    const adapter = createRecordingAdapter()
    const firstIndexEntered = createEventGate()
    const releaseFirstIndex = createEventGate()
    const rotationEntered = createEventGate()
    const releaseRotation = createEventGate()
    const sourceStarted = createEventGate()
    let expired = false
    let storageId = `abort-startup-old`
    let indexCalls = 0
    let sourceLoads = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `abort-startup-claim`,
    })
    adapter.renewCacheGenerationClaim = async () =>
      expired ? undefined : Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      rotationEntered.resolve()
      await releaseRotation.promise
      expired = false
      storageId = `abort-startup-new`
      return { storageCollectionId: storageId, claimId: `abort-startup-claim` }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async () => {
      if (++indexCalls === 1) {
        firstIndexEntered.resolve()
        await releaseFirstIndex.promise
      }
    }
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `abort-startup-rotation`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            sourceStarted.resolve()
            return {
              restartAfterScopedRecovery: () => {},
              loadSubset: async () => {
                sourceLoads++
                source.begin()
                source.write({
                  type: `insert`,
                  value: { id: `fresh`, title: `New storage` },
                })
                await whenSyncAccepted(source.commit())
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.createIndex((row) => row.title, { name: `held-title` })
    const controller = new AbortController()
    try {
      collection.startSyncImmediate()
      await atPersistedOracleCheckpoint(
        firstIndexEntered.promise,
        `startup index`,
      )
      expired = true
      collection.createIndex((row) => row.id, { name: `dynamic-id` })
      await atPersistedOracleCheckpoint(
        rotationEntered.promise,
        `startup rotation`,
      )

      const canceled = Promise.resolve(
        collection._sync.loadSubset({ limit: 1, signal: controller.signal }),
      )
      void canceled.catch(() => undefined)
      const sibling = Promise.resolve(collection._sync.loadSubset({ limit: 2 }))
      let siblingSettled = false
      void sibling.then(
        () => {
          siblingSettled = true
        },
        () => {
          siblingSettled = true
        },
      )
      controller.abort()
      await expect(
        atPersistedOracleCheckpoint(canceled, `aborted startup demand`),
      ).rejects.toMatchObject({ name: `AbortError` })
      expect(siblingSettled).toBe(false)
      expect(sourceLoads).toBe(0)

      releaseFirstIndex.resolve()
      releaseRotation.resolve()
      await atPersistedOracleCheckpoint(sourceStarted.promise, `source entry`)
      await atPersistedOracleCheckpoint(sibling, `sibling startup demand`)
      expect(sourceLoads).toBe(1)
      expect(collection.get(`fresh`)).toMatchObject({ id: `fresh` })
    } finally {
      controller.abort()
      releaseFirstIndex.resolve()
      releaseRotation.resolve()
      await collection.cleanup()
    }
  })

  // Source entry may finish before a recovery rotation takes the apply mutex.
  // A demand admitted behind that mutex still belongs to its own caller: an
  // explicit abort must reject before rotation settles, while a sibling
  // remains pending and succeeds afterward. This cut differs from a demand
  // held before source entry, because the wrapper has already crossed its
  // startup promises and is waiting inside the persisted runtime.
  it(`settles an aborted demand behind a held recovery rotation`, async () => {
    const adapter = createRecordingAdapter()
    const rotationEntered = createEventGate()
    const releaseRotation = createEventGate()
    let storageId = `abort-recovery-old`
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `abort-recovery-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      rotationEntered.resolve()
      await releaseRotation.promise
      storageId = `abort-recovery-new`
      return { storageCollectionId: storageId, claimId: `abort-recovery-claim` }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const controller = new AbortController()
    let source!: TodoSyncParams
    const sourceLimits: Array<number | undefined> = []
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `abort-held-recovery`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return {
              restartAfterScopedRecovery: () => {},
              loadSubset: (options) => {
                sourceLimits.push(options.limit)
                return true
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    let recovery: Promise<void> | undefined
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      recovery = source.metadata!.persistence!.startScopedRecovery!()
      await atPersistedOracleCheckpoint(
        rotationEntered.promise,
        `held rotation`,
      )

      const canceled = Promise.resolve(
        collection._sync.loadSubset({ limit: 1, signal: controller.signal }),
      )
      void canceled.catch(() => undefined)
      const sibling = Promise.resolve(collection._sync.loadSubset({ limit: 2 }))
      let siblingSettled = false
      void sibling.then(
        () => {
          siblingSettled = true
        },
        () => {
          siblingSettled = true
        },
      )
      await flushAsyncWork()
      expect(siblingSettled).toBe(false)
      controller.abort()
      await expect(
        atPersistedOracleCheckpoint(canceled, `aborted recovery demand`),
      ).rejects.toMatchObject({ name: `AbortError` })
      expect(siblingSettled).toBe(false)

      releaseRotation.resolve()
      await atPersistedOracleCheckpoint(recovery, `rotation recovery`)
      await atPersistedOracleCheckpoint(sibling, `sibling recovery demand`)
      expect(sourceLimits).toContain(2)
      expect(sourceLimits).not.toContain(1)
      expect(collection.status).toBe(`ready`)
    } finally {
      controller.abort()
      releaseRotation.resolve()
      await Promise.allSettled([recovery])
      await collection.cleanup()
    }
  })

  // A custom adapter may opt into managed cache generations. Claiming alone
  // cannot enforce rotation, expiry, or release; accepting that partial bundle
  // would make stale durable rows appear authoritative on a later run. The
  // contract refuses the configuration before a claim or source load begins.
  it.each([
    `rotateCacheGeneration`,
    `renewCacheGenerationClaim`,
    `releaseCacheGenerationClaim`,
  ] as const)(`refuses a managed cache adapter without %s`, async (missing) => {
    const adapter = createRecordingAdapter()
    adapter.claimCacheGeneration = vi.fn(async () => ({
      storageCollectionId: `managed-storage`,
      claimId: `managed-claim`,
      expiresAtMs: Date.now() + 10_000,
    }))
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: `rotated-storage`,
      claimId: `managed-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.releaseCacheGenerationClaim = async () => {}
    delete adapter[missing]
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `partial-managed-adapter-${missing}`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: { sync: (params) => params.markReady() },
        persistence: { adapter },
      }),
    )
    try {
      await expect(collection.stateWhenReady()).rejects.toThrow(
        `managed cache generation adapter`,
      )
      expect(adapter.claimCacheGeneration).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
    }
  })

  // Losing a durable claim removes authority to hydrate its rows, not the
  // public demand. The model keeps that demand, clears the old source base,
  // and satisfies it from one new source snapshot. This driver lets renewal
  // fail just before demand admission; stale durable rows remain in the fake
  // adapter so the public row comparison rejects a missing recovery guard.
  it(`reloads a demanded subset after its persisted cache claim expires`, async () => {
    const adapter = createRecordingAdapter([
      { id: `stale`, title: `Old persisted row` },
    ])
    let storageId = `expired-old-storage`
    const claimId = `expiring-claim`
    let renewals = 0
    let revokeClaim = false
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.renewCacheGenerationClaim = async () => {
      renewals++
      if (revokeClaim) {
        revokeClaim = false
        return undefined
      }
      return Date.now() + 10_000
    }
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: (storageId = `expired-private-storage`),
      claimId,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.releaseCacheGenerationClaim = async () => {}
    let source!: TodoSyncParams
    let sourceLoads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `expired-demand-reload`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return {
              // Every source load is synchronous up to its tracked commit;
              // there is no old provider callback to deliver after restart.
              restartAfterScopedRecovery: () => {},
              loadSubset: async () => {
                sourceLoads++
                source.begin()
                source.write({
                  type: `insert`,
                  value: { id: `fresh`, title: `Fresh source row` },
                })
                await whenSyncAccepted(source.commit())
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      revokeClaim = true
      await collection._sync.loadSubset({ limit: 1 })
      expect(renewals).toBeGreaterThan(0)
      expect(sourceLoads).toBe(1)
      expect(collection.get(`stale`)).toBeUndefined()
      expect(collection.get(`fresh`)).toMatchObject({
        id: `fresh`,
        title: `Fresh source row`,
      })
      expect(
        adapter.applyCommittedTxCalls
          .filter((call) =>
            call.tx.mutations.some((mutation) => mutation.key === `fresh`),
          )
          .map((call) => call.collectionId),
      ).toEqual([`expired-private-storage`])
    } finally {
      await collection.cleanup()
    }
  })

  /**
   * A physical cache generation starts a new row-version history. The model
   * retains one active subset demand through rotation and requires a peer
   * commit in the replacement generation to reacquire source evidence while
   * scoped recovery quarantines durable rows. Its row version starts at one
   * even when the retired generation had reached ten. The zero-version
   * neighbor shows that the same notification reaches the refresh path when
   * no retired version can accidentally classify it as already published.
   * The coordinator records source reacquisition after each public cut; the
   * old durable row must be absent after rotation.
   */
  it.each([
    { retiredRowVersion: 0, oldRows: [] as Array<Todo> },
    {
      retiredRowVersion: 10,
      oldRows: [{ id: `retired`, title: `Retired cache row` }],
    },
  ])(
    `reacquires a scoped subset after a new-generation peer notice with retired row version $retiredRowVersion`,
    async ({ retiredRowVersion, oldRows }) => {
      const adapter = createRecordingAdapter(oldRows)
      const coordinator = createCoordinatorHarness()
      const oldStorageId = `peer-rotation-old-${retiredRowVersion}`
      const newStorageId = `peer-rotation-new-${retiredRowVersion}`
      let storageId = oldStorageId
      const remoteEnsures: Array<string> = []
      const originalLoadResumeSnapshot = adapter.loadResumeSnapshot
      adapter.loadResumeSnapshot = async (id, context) => {
        const snapshot = await originalLoadResumeSnapshot(id, context)
        return {
          ...snapshot,
          latestTerm: recordedStorageId(id) === oldStorageId ? 1 : 0,
          latestSeq:
            recordedStorageId(id) === oldStorageId ? retiredRowVersion : 0,
          latestRowVersion:
            recordedStorageId(id) === oldStorageId ? retiredRowVersion : 0,
        }
      }
      adapter.claimCacheGeneration = async () => ({
        storageCollectionId: storageId,
        claimId: `peer-rotation-claim-${retiredRowVersion}`,
        expiresAtMs: Date.now() + 60_000,
      })
      adapter.renewCacheGenerationClaim = async () => Date.now() + 60_000
      adapter.rotateCacheGeneration = async () => ({
        storageCollectionId: (storageId = newStorageId),
        claimId: `peer-rotation-claim-${retiredRowVersion}`,
        expiresAtMs: Date.now() + 60_000,
      })
      adapter.releaseCacheGenerationClaim = async () => {}
      coordinator.requestEnsureRemoteSubset = async (id) => {
        remoteEnsures.push(id)
      }

      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `peer-rotation-${retiredRowVersion}`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return {
                restartAfterScopedRecovery: async (cacheRotated) => {
                  await cacheRotated
                },
                loadSubset: async () => {},
                unloadSubset: async () => {},
              }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      try {
        collection.startSyncImmediate()
        await collection.stateWhenReady()
        await source.metadata!.persistence!.hydrateBaseline()
        expect(collection.get(`retired`)?.title).toBe(oldRows[0]?.title)

        const persistence = source.metadata?.persistence
        if (!persistence?.startScopedRecovery) {
          throw new Error(`Expected scoped recovery capability`)
        }
        await persistence.startScopedRecovery()
        await vi.waitFor(() => expect(remoteEnsures).toContain(newStorageId))
        expect(collection.get(`retired`)).toBeUndefined()
        const ensuresAfterRotation = remoteEnsures.length
        expect(ensuresAfterRotation).toBe(1)

        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `new-generation-peer-row`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows: [
              {
                key: `fresh`,
                value: { id: `fresh`, title: `Fresh source row` },
              },
            ],
            deletedKeys: [],
          },
          `peer`,
          newStorageId,
        )
        await atPersistedOracleCheckpoint(
          vi.waitFor(() =>
            expect(remoteEnsures).toHaveLength(ensuresAfterRotation + 1),
          ),
          `source reacquisition after a new-generation peer notice`,
        )
        expect(remoteEnsures.at(-1)).toBe(newStorageId)
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each([
    { retiredNotice: `commit`, retiredRowVersion: 1, newRowVersion: 3 },
    { retiredNotice: `reset`, retiredRowVersion: 1, newRowVersion: 3 },
    { retiredNotice: `commit`, retiredRowVersion: 10, newRowVersion: 1 },
    { retiredNotice: `reset`, retiredRowVersion: 10, newRowVersion: 1 },
  ] as const)(
    `does not let a queued retired-generation $retiredNotice at row version $retiredRowVersion affect a new-generation peer notice`,
    ({ retiredNotice, retiredRowVersion, newRowVersion }) =>
      assertGenerationNoticeHistory({
        retiredNotice,
        retiredRowVersion,
        newRowVersion,
        newNotice: true,
      }),
  )

  // A reset clears the owner's durable rows. Its rows return only when the
  // follower requests its demand again, so the model predicts one more
  // ensure, the owner's row visible again, and no further ensures: replacing
  // rows in place must not drop the replay that a reset owes. Only a node
  // that follows replaces rows in place. A node elected leader that still
  // routes demand through the coordinator truncates and replays as the
  // leader does; this follower-only cell does not exercise that path.
  // A renewal that fails after the owner replied does not establish claim
  // loss. The load cannot confirm its rows, so it rejects, as a failed ensure
  // does; the demand stays active and retries, so the owner's acquisition
  // is kept. The model predicts the rejected load, no release, one retried
  // ensure, the owner's row still visible, and a healthy source.
  it(`keeps a follower's demand when a renewal fails transiently at its reply`, async () => {
    const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
    const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const tab = createFollowerTab({
      placement: `direct`,
      apply: `ok`,
      consumer: `load`,
      renewal: `fails-at-reply`,
    })
    try {
      tab.releaseApply()
      let outcome: `pending` | `fulfilled` | `rejected` = `pending`
      const settled = Promise.resolve(
        tab.source._sync.loadSubset({
          where: new IR.Func(`eq`, [
            new IR.PropRef([`group`]),
            new IR.Value(`a`),
          ]),
        }),
      ).then(
        () => (outcome = `fulfilled`),
        () => (outcome = `rejected`),
      )
      await within(settled, 1_000)
      for (let i = 0; i < 5; i++)
        await new Promise((resolve) => setTimeout(resolve, 0))
      // Checkpoint: the load settled and any retry has run.
      expect({
        outcome,
        releases: tab.releases(),
        ensures: tab.ensures(),
        rows: Array.from(tab.source.values()).map((row) => row.id),
        status: tab.source.status === `error` ? `error` : `healthy`,
      }).toEqual({
        outcome: `rejected`,
        releases: 0,
        ensures: 2,
        rows: [`remote`],
        status: `healthy`,
      })
    } finally {
      await tab.source.cleanup()
      errors.mockRestore()
      warnings.mockRestore()
    }
  })

  it(`a follower requests its demand again after the owner resets, once`, async () => {
    const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
    const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const tab = createFollowerTab({
      placement: `direct`,
      apply: `ok`,
      consumer: `live-query`,
    })
    const query = createLiveQueryCollection((q) =>
      q.from({ row: tab.source }).where(({ row }) => eq(row.group, `a`)),
    )
    try {
      void query.preload()
      await within(tab.applyReadStarted)
      tab.releaseApply()
      await vi.waitFor(() => expect(query.size).toBe(1), { timeout: 1_000 })
      expect(tab.ensures()).toBe(1)

      tab.resetOwner()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect({
        ensures: tab.ensures(),
        rows: query.toArray.map((row) => (row as FollowerRow).id),
        status: query.status,
      }).toEqual({ ensures: 2, rows: [`remote`], status: `ready` })
    } finally {
      await query.cleanup()
      await tab.source.cleanup()
      errors.mockRestore()
      warnings.mockRestore()
    }
  })

  // The same law holds when no demand is active as recovery starts: with
  // nothing reacquired and no new generation, a later load must still not
  // hydrate the untrusted rows.
  it.each([`active demand`, `no active demand`] as const)(
    `does not trust untrusted durable rows after a recovery without rotation: %s`,
    async (activeAtRecovery) => {
      const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
      const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const durable: Array<FollowerRow> = [{ id: `stale`, group: `a` }]
      let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
      let seq = 0
      const notice = (collectionId: string, value: FollowerRow) => {
        seq++
        if (!durable.some((row) => row.id === value.id)) durable.push(value)
        const payload: TxCommitted = {
          type: `tx:committed`,
          term: 1,
          seq,
          txId: `owner-tx-${seq}`,
          latestRowVersion: seq,
          requiresFullReload: false,
          changedRows: [{ key: value.id, value }],
          deletedKeys: [],
        }
        subscriber?.({
          v: 1,
          dbName: `test-db`,
          collectionId,
          senderId: `owner`,
          ts: Date.now(),
          payload,
        })
      }
      let ensures = 0
      const adapter = {
        loadSubset: async () =>
          durable.map((value) => ({ key: value.id, value })),
        loadResumeSnapshot: () =>
          Promise.resolve({
            rows: [],
            keySet: { status: `consistent` },
            collectionMetadata: [],
            latestTerm: 0,
            latestSeq: 0,
            latestRowVersion: 0,
            resetEpoch: 0,
          }),
        applyCommittedTx: async () => {},
        ensureIndex: async () => {},
      } as unknown as PersistenceAdapter
      const coordinator = {
        getNodeId: () => `follower`,
        subscribe: (
          _collectionId: string,
          onMessage: (message: ProtocolEnvelope<unknown>) => void,
        ) => {
          subscriber = onMessage
          return () => {
            subscriber = undefined
          }
        },
        publish: () => {},
        isLeader: () => false,
        ensureLeadership: async () => {},
        requestEnsurePersistedIndex: async () => {},
        requestEnsureRemoteSubset: async (collectionId: string) => {
          if (++ensures === 1)
            notice(collectionId, { id: `remote`, group: `a` })
        },
        requestReleaseRemoteSubset: async () => {},
        registerRemoteSubsetOwner: () => () => {},
        requestApplyCommittedTx: (_collectionId: string, tx: TxCommitted) =>
          Promise.resolve({
            type: `rpc:applyCommittedTx:res`,
            rpcId: tx.txId,
            ok: true,
            term: tx.term,
            seq: tx.seq,
            latestRowVersion: seq,
          }),
        pullSince: () =>
          Promise.resolve({
            type: `rpc:pullSince:res`,
            rpcId: `unrotated-pull`,
            ok: true,
            latestTerm: 1,
            latestSeq: seq,
            latestRowVersion: seq,
            requiresFullReload: false,
            changedKeys: [],
            deletedKeys: [],
          }),
      } as unknown as PersistedCollectionCoordinator
      let sourceParams: SyncConfig<FollowerRow, string>[`sync`] extends (
        params: infer P,
      ) => unknown
        ? P
        : never
      const source = createCollection(
        persistedCollectionOptions<FollowerRow, string>({
          id: `follower-unrotated-${Math.random().toString(36).slice(2)}`,
          getKey: (row) => row.id,
          persistence: { adapter, coordinator },
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              sourceParams = params
              return {
                loadSubset: () => Promise.resolve(),
                restartAfterScopedRecovery: () => {},
              }
            },
          },
        }),
      )
      source.startSyncImmediate()
      const query = createLiveQueryCollection((q) =>
        q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
      )
      try {
        if (activeAtRecovery === `active demand`) {
          await query.preload()
          expect(Array.from(source.keys()).sort()).toEqual([`remote`, `stale`])
        } else {
          // Start the source without any demand.
          void source.preload().catch(() => undefined)
          await vi.waitFor(() => expect(sourceParams).toBeDefined())
        }

        // The source reports that the old durable rows are untrusted.
        await sourceParams!.metadata!.persistence!.startScopedRecovery!()
        await new Promise((resolve) => setTimeout(resolve, 50))
        if (activeAtRecovery === `no active demand`) {
          void query.preload().catch(() => undefined)
        }
        notice(source.id, { id: `fresh`, group: `a` })
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(Array.from(source.keys())).not.toContain(`stale`)
      } finally {
        await query.cleanup()
        await source.cleanup()
        errors.mockRestore()
        warnings.mockRestore()
      }
    },
  )

  // The model has one one-shot refresh lease. The grammar crosses cleanup
  // before and after source settlement. Whichever event wins releases the
  // lease once. The raw release log retains multiplicity at both checkpoints.
  it.each([false, true])(
    `releases a scoped refresh once when settlement precedes cleanup: %s`,
    async (settleBeforeCleanup) => {
      const adapter = createRecordingAdapter()
      const coordinator = createCoordinatorHarness()
      const logicalId = `scoped-refresh-cleanup`
      const oldStorageId = `scoped-refresh-old`
      const newStorageId = `scoped-refresh-new`
      const refreshEntered = createEventGate()
      const releaseRefresh = createEventGate()
      const releaseCalls: Array<LoadSubsetOptions> = []
      let watchRefresh = false
      let refreshOptions: LoadSubsetOptions | undefined
      adapter.claimCacheGeneration = async () => ({
        storageCollectionId: oldStorageId,
        claimId: `scoped-refresh-claim`,
        expiresAtMs: Date.now() + 60_000,
      })
      adapter.renewCacheGenerationClaim = async () => Date.now() + 60_000
      adapter.rotateCacheGeneration = async () => ({
        storageCollectionId: newStorageId,
        claimId: `scoped-refresh-claim`,
        expiresAtMs: Date.now() + 60_000,
      })
      adapter.releaseCacheGenerationClaim = async () => {}
      coordinator.requestEnsureRemoteSubset = async (_id, options) => {
        if (watchRefresh && options.refetch === true) {
          refreshOptions = options
          refreshEntered.resolve()
          await releaseRefresh.promise
        }
      }
      coordinator.requestReleaseRemoteSubset = async (_id, options) => {
        releaseCalls.push(options)
      }
      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return {
                restartAfterScopedRecovery: (cacheRotated) => cacheRotated,
                loadSubset: async () => {},
              }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      try {
        collection.startSyncImmediate()
        await atPersistedOracleCheckpoint(
          vi.waitFor(() => expect(source).toBeDefined()),
          `source sync entered`,
        )
        await collection._sync.loadSubset({ limit: 1 })
        await source.metadata!.persistence!.startScopedRecovery!()
        watchRefresh = true
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `scoped-refresh-notice`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows: [
              { key: `fresh`, value: { id: `fresh`, title: `Fresh` } },
            ],
            deletedKeys: [],
          },
          `peer`,
          newStorageId,
        )
        await atPersistedOracleCheckpoint(
          refreshEntered.promise,
          `scoped refresh acquisition entered`,
        )
        if (settleBeforeCleanup) {
          releaseRefresh.resolve()
          await atPersistedOracleCheckpoint(
            vi.waitFor(() =>
              expect(
                releaseCalls.filter((options) => options === refreshOptions),
              ).toHaveLength(1),
            ),
            `refresh settlement released its lease`,
          )
        }
        const cleanup = collection.cleanup()
        await atPersistedOracleCheckpoint(cleanup, `cleanup released refresh`)
        expect(
          releaseCalls.filter((options) => options === refreshOptions),
        ).toHaveLength(1)
        releaseRefresh.resolve()
        await flushAsyncWork()
        expect(
          releaseCalls.filter((options) => options === refreshOptions),
        ).toHaveLength(1)
      } finally {
        releaseRefresh.resolve()
        await collection.cleanup()
      }
    },
  )

  // A cached read may start under a live claim, then return after a paused
  // tab's claim expires while its renewal timer is still queued. The read's
  // old rows have no publication authority at that cut. The model discards
  // them, rotates privately, and completes the retained demand from a new
  // source snapshot. This gate holds the adapter result across the expiry;
  // public rows, durable destination, and demand settlement distinguish a
  // post-read fence from a check made only before the read.
  it.each([
    { outcome: `old rows returned`, expires: true },
    { outcome: `claim check rejected`, expires: true },
    { outcome: `live claim I/O failure`, expires: false },
  ] as const)(
    `handles a held subset read when $outcome`,
    async ({ outcome, expires }) => {
      const adapter = createRecordingAdapter()
      const readEntered = createEventGate()
      const releaseRead = createEventGate()
      let now = 1_000
      let storageId = `read-expiry-old`
      let sourceLoads = 0
      const ioFailure = new Error(`subset read I/O failure`)
      adapter.getCacheGenerationNow = () => now
      adapter.claimCacheGeneration = async () => ({
        storageCollectionId: storageId,
        claimId: `read-expiry-claim`,
        expiresAtMs: 11_000,
      })
      adapter.renewCacheGenerationClaim = async (id) =>
        id === `read-expiry-old` && now >= 11_000 ? undefined : now + 10_000
      adapter.rotateCacheGeneration = async () => {
        return {
          storageCollectionId: (storageId = `read-expiry-new`),
          claimId: `read-expiry-claim`,
          expiresAtMs: now + 10_000,
        }
      }
      adapter.releaseCacheGenerationClaim = async () => {}
      adapter.loadSubset = async (id) => {
        if (recordedStorageId(id) === `read-expiry-old`) {
          readEntered.resolve()
          await releaseRead.promise
          if (outcome === `claim check rejected`) {
            throw new InvalidPersistedCollectionConfigError(
              `Persisted cache claim is no longer active for collection "${id}"`,
            )
          }
          if (outcome === `live claim I/O failure`) throw ioFailure
          return [
            {
              key: `stale`,
              value: { id: `stale`, title: `Expired cached row` },
            },
          ]
        }
        return []
      }
      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `read-expiry-publication`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async () => {
                  expect(collection.get(`stale`)).toBeUndefined()
                  sourceLoads++
                  source.begin()
                  source.write({
                    type: `insert`,
                    value: { id: `fresh`, title: `New source row` },
                  })
                  await whenSyncAccepted(source.commit())
                },
              }
            },
          },
          persistence: { adapter },
        }),
      )
      try {
        await collection.stateWhenReady()
        const demand = Promise.resolve(
          collection._sync.loadSubset({ limit: 1 }),
        )
        void demand.catch(() => undefined)
        await atPersistedOracleCheckpoint(readEntered.promise, `old cache read`)
        if (expires) now = 11_001
        releaseRead.resolve()
        const [settlement] = await atPersistedOracleCheckpoint(
          Promise.allSettled([demand]),
          `held subset demand settlement`,
        )
        if (!expires) {
          expect(settlement).toEqual({ status: `rejected`, reason: ioFailure })
          expect(storageId).toBe(`read-expiry-old`)
          expect(sourceLoads).toBe(0)
          expect(collection.get(`stale`)).toBeUndefined()
          return
        }
        expect(settlement.status).toBe(`fulfilled`)
        expect(collection.get(`stale`)).toBeUndefined()
        expect(collection.get(`fresh`)).toMatchObject({ id: `fresh` })
        expect(storageId).toBe(`read-expiry-new`)
        expect(sourceLoads).toBe(1)
        expect(
          adapter.applyCommittedTxCalls
            .filter((call) =>
              call.tx.mutations.some((mutation) => mutation.key === `fresh`),
            )
            .map((call) => call.collectionId),
        ).toEqual([`read-expiry-new`])
      } finally {
        releaseRead.resolve()
        await collection.cleanup()
      }
    },
  )

  // Resume certification is another consumer of a persisted snapshot. A read
  // may pass SQLite's claim check while live, then return after expiry. The
  // independent rule gives neither its old answer nor its claim-check failure
  // authority to certify the old key set: the run moves to private storage.
  // A still-live claim with an unrelated I/O failure is terminal instead.
  // The history holds only certification, optionally expires the claim, then
  // compares settlement, evidence, storage route, and public status. Startup,
  // hydration, and replay have separate held-read witnesses; none exercises
  // this resume-certification boundary.
  it.each([
    { readOutcome: `old snapshot returned`, failure: `none`, expires: true },
    { readOutcome: `claim check rejected`, failure: `claim`, expires: true },
    { readOutcome: `live claim I/O failure`, failure: `io`, expires: false },
  ] as const)(
    `handles held resume certification when $readOutcome`,
    async ({ failure, expires }) => {
      const adapter = createRecordingAdapter()
      const readEntered = createEventGate()
      const releaseRead = createEventGate()
      const oldStorageId = `certification-expiry-old`
      const newStorageId = `certification-expiry-new`
      let storageId = oldStorageId
      let now = 1_000
      let rotations = 0
      let holdCertification = false
      const ioFailure = new Error(`certification read I/O failure`)
      adapter.getCacheGenerationNow = () => now
      adapter.claimCacheGeneration = async () => ({
        storageCollectionId: storageId,
        claimId: `certification-expiry-claim`,
        expiresAtMs: 11_000,
      })
      adapter.renewCacheGenerationClaim = async (id) =>
        id === oldStorageId && now >= 11_000 ? undefined : now + 10_000
      adapter.rotateCacheGeneration = async () => {
        rotations++
        storageId = newStorageId
        return {
          storageCollectionId: newStorageId,
          claimId: `certification-expiry-claim`,
          expiresAtMs: now + 10_000,
        }
      }
      adapter.releaseCacheGenerationClaim = async () => {}
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      adapter.loadResumeSnapshot = async (...args) => {
        const snapshot = await loadResumeSnapshot(...args)
        if (holdCertification && recordedStorageId(args[0]) === oldStorageId) {
          readEntered.resolve()
          await releaseRead.promise
          if (failure === `claim`) {
            throw new InvalidPersistedCollectionConfigError(
              `Persisted cache claim is no longer active for collection "${oldStorageId}"`,
            )
          }
          if (failure === `io`) throw ioFailure
        }
        return snapshot
      }
      let persistenceCapability:
        SyncMetadataApi<string>[`persistence`] | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `certification-expiry-public`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              persistenceCapability = params.metadata?.persistence
              params.markReady()
              return { restartAfterScopedRecovery: () => {} }
            },
          },
          persistence: { adapter },
        }),
      )
      let certification: Promise<void> | undefined
      try {
        await collection.stateWhenReady()
        expect(
          persistenceCapability?.resumeSnapshot.getKeySetEvidence(),
        ).toEqual({ status: `consistent` })
        holdCertification = true
        certification = persistenceCapability?.resumeSnapshot.certify()
        if (!certification) throw new Error(`Missing resume certification`)
        void certification.catch(() => undefined)
        await atPersistedOracleCheckpoint(
          readEntered.promise,
          `held resume certification`,
        )
        if (expires) now = 11_001
        releaseRead.resolve()
        const outcome = await atPersistedOracleCheckpoint(
          Promise.allSettled([certification]),
          `held resume certification settlement`,
        )
        if (expires) {
          expect(outcome[0].status).toBe(`fulfilled`)
          expect(rotations).toBe(1)
          expect(storageId).toBe(newStorageId)
          expect(
            persistenceCapability?.resumeSnapshot.getKeySetEvidence(),
          ).toEqual({ status: `incompatible` })
          expect(collection.status).not.toBe(`error`)
        } else {
          expect(outcome).toEqual([{ status: `rejected`, reason: ioFailure }])
          expect(rotations).toBe(0)
          expect(storageId).toBe(oldStorageId)
          expect(collection.status).toBe(`error`)
        }
      } finally {
        releaseRead.resolve()
        await Promise.allSettled([certification])
        await collection.cleanup()
      }
    },
  )

  // A peer notification may begin a full reload while the cache claim is
  // valid, then hold its persisted read until that claim expires. The cached
  // result loses publication authority at that cut. The independent rule is
  // the same as for a direct subset read: discard the old result, rotate this
  // run's cache, and reload its retained demand from the source. The adapter
  // may return the old rows or reject at its second claim check. A still-live
  // claim with an unrelated read failure is a control: it must remain terminal.
  // A check only when the notification arrives misses both expiry histories.
  // The held adapter read fixes the order; public rows and Collection status
  // after release are the comparison cut.
  it.each([
    { readOutcome: `old rows returned`, failure: `none`, expires: true },
    { readOutcome: `claim check rejected`, failure: `claim`, expires: true },
    { readOutcome: `live claim I/O error`, failure: `io`, expires: false },
  ])(
    `handles a peer full reload when $readOutcome`,
    async ({ failure, expires }) => {
      const adapter = createRecordingAdapter()
      const oldStorageId = `peer-reload-old`
      const newStorageId = `peer-reload-new`
      const coordinator = createFailStopCoordinatorHarness(oldStorageId)
      const readEntered = createEventGate()
      const releaseRead = createEventGate()
      const readError = new Error(`Persisted peer reload I/O failed`)
      let now = 1_000
      let expiresAtMs = 11_000
      let readCount = 0
      let rotations = 0
      adapter.claimCacheGeneration = async () => ({
        storageCollectionId: oldStorageId,
        claimId: `peer-reload-claim`,
        expiresAtMs,
      })
      adapter.getCacheGenerationNow = () => now
      adapter.renewCacheGenerationClaim = async () => {
        if (now >= expiresAtMs) return undefined
        expiresAtMs = now + 10_000
        return expiresAtMs
      }
      adapter.rotateCacheGeneration = async () => {
        rotations++
        return {
          storageCollectionId: newStorageId,
          claimId: `peer-reload-claim`,
          expiresAtMs: now + 10_000,
        }
      }
      adapter.releaseCacheGenerationClaim = async () => {}
      adapter.loadSubset = async (storageId) => {
        if (recordedStorageId(storageId) !== oldStorageId) return []
        if (++readCount === 1) {
          return [{ key: `old`, value: { id: `old`, title: `Initial row` } }]
        }
        readEntered.resolve()
        await releaseRead.promise
        if (failure === `claim`) {
          throw new InvalidPersistedCollectionConfigError(
            `Persisted cache claim is no longer active for collection "${oldStorageId}"`,
          )
        }
        if (failure === `io`) throw readError
        return [{ key: `old`, value: { id: `old`, title: `Expired peer row` } }]
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `peer-reload-expiry`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (source) => {
              source.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: () => true,
              }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      try {
        collection.startSyncImmediate()
        await collection.stateWhenReady()
        await collection._sync.loadSubset({ limit: 1 })
        expect(collection.get(`old`)?.title).toBe(`Initial row`)

        coordinator.emit({
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `peer-full-reload`,
          latestRowVersion: 1,
          requiresFullReload: true,
        })
        await atPersistedOracleCheckpoint(
          readEntered.promise,
          `peer reload read`,
        )
        if (expires) now = expiresAtMs + 1
        releaseRead.resolve()
        await flushAsyncWork()

        if (failure === `io`) {
          expect(collection.status).toBe(`error`)
          expect(collection.get(`old`)?.title).toBe(`Initial row`)
          expect(rotations).toBe(0)
          await expect(collection._sync.loadSubset({})).rejects.toBe(readError)
          return
        }
        expect(collection.get(`old`)?.title).not.toBe(`Expired peer row`)
        expect(collection.status).not.toBe(`error`)
        await vi.waitFor(() => expect(rotations).toBe(1))
        expect(collection.get(`old`)).toBeUndefined()
      } finally {
        releaseRead.resolve()
        await collection.cleanup()
      }
    },
  )

  // A persisted row scan is an exposed read, even though it does not publish
  // rows to the Collection. Two sync runs initially claim the same cache
  // generation. The model keeps the warm peer's claim and rows intact when the
  // other claim expires. A held old scan must not return those rows to its
  // caller; it retries against that run's private generation instead. The
  // adapter gate fixes expiry after the old read but before its result reaches
  // the caller. Both scan results and the peer's later read are observations.
  it(`retries a held persisted row scan after only its claim expires`, async () => {
    const adapter = createRecordingAdapter()
    const scanEntered = createEventGate()
    const releaseScan = createEventGate()
    const oldRow = { key: `old`, value: { id: `old`, title: `Warm peer row` } }
    const freshRow = {
      key: `fresh`,
      value: { id: `fresh`, title: `Private generation row` },
    }
    const scanRoutes: Array<{ storageId: string; claimId?: string }> = []
    let claims = 0
    let expired = false
    let rotations = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `scan-old-storage`,
      claimId: ++claims === 1 ? `scan-warm-claim` : `scan-expiring-claim`,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.renewCacheGenerationClaim = async (_storageId, claimId) =>
      expired && claimId === `scan-expiring-claim`
        ? undefined
        : Date.now() + 10_000
    adapter.rotateCacheGeneration = async (
      _collectionId,
      claimId,
      _resetMetadata,
      expectedStorageId,
    ) => {
      expect(claimId).toBe(`scan-expiring-claim`)
      expect(expectedStorageId).toBe(`scan-old-storage`)
      rotations++
      return {
        storageCollectionId: `scan-private-storage`,
        claimId: `scan-private-claim`,
        expiresAtMs: Date.now() + 10_000,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.scanRows = async (storageId, _options, context) => {
      scanRoutes.push({
        storageId: recordedStorageId(storageId),
        claimId: context?.cacheGenerationClaimId,
      })
      if (
        recordedStorageId(storageId) === `scan-old-storage` &&
        context?.cacheGenerationClaimId === `scan-expiring-claim`
      ) {
        scanEntered.resolve()
        await releaseScan.promise
      }
      return recordedStorageId(storageId) === `scan-private-storage`
        ? [freshRow]
        : [oldRow]
    }

    let warmSource!: TodoSyncParams
    let expiringSource!: TodoSyncParams
    const makePeer = (onStart: (source: TodoSyncParams) => void) =>
      createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `held-scan-peers`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              onStart(params)
              params.markReady()
              return { restartAfterScopedRecovery: () => {} }
            },
          },
          persistence: { adapter },
        }),
      )
    const warm = makePeer((source) => {
      warmSource = source
    })
    const expiring = makePeer((source) => {
      expiringSource = source
    })
    try {
      warm.startSyncImmediate()
      await warm.stateWhenReady()
      expiring.startSyncImmediate()
      await expiring.stateWhenReady()
      expect(
        await warmSource.metadata!.persistence!.scanPersistedRows(),
      ).toEqual([oldRow])

      const heldScan = expiringSource.metadata!.persistence!.scanPersistedRows()
      await atPersistedOracleCheckpoint(scanEntered.promise, `old row scan`)
      expired = true
      releaseScan.resolve()
      expect(
        await atPersistedOracleCheckpoint(heldScan, `private row scan`),
      ).toEqual([freshRow])
      expect(rotations).toBe(1)
      expect(scanRoutes).toContainEqual({
        storageId: `scan-private-storage`,
        claimId: `scan-private-claim`,
      })
      expect(
        await warmSource.metadata!.persistence!.scanPersistedRows(),
      ).toEqual([oldRow])
      expect(warm.status).toBe(`ready`)
    } finally {
      releaseScan.resolve()
      await expiring.cleanup()
      await warm.cleanup()
    }
  })

  // A coordinator replay may read a valid persisted cache generation, then
  // return after this sync run's claim expires. Its deltas cannot publish
  // under that expired claim. The independent model leaves the peer's head
  // intact and rotates only this run's cache before any old row is visible.
  // The held pull fixes the expiry cut; public rows and the private rotation
  // are checked after the response rather than at request admission.
  it(`discards a seq-gap replay returned after its cache claim expires`, async () => {
    const adapter = createRecordingAdapter()
    const id = `expired-seq-gap-replay`
    const coordinator = createFailStopCoordinatorHarness(`replay-old-storage`)
    const pullEntered = createEventGate()
    const releasePull = createEventGate()
    let expired = false
    let storageId = `replay-old-storage`
    let rotations = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `replay-claim`,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.renewCacheGenerationClaim = async () =>
      expired ? undefined : Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      rotations++
      return {
        storageCollectionId: (storageId = `replay-private-storage`),
        claimId: `replay-claim`,
        expiresAtMs: Date.now() + 10_000,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    coordinator.pullSince = async () => {
      pullEntered.resolve()
      await releasePull.promise
      return {
        type: `rpc:pullSince:res`,
        rpcId: `expired-pull`,
        ok: true,
        latestTerm: 1,
        latestSeq: 2,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedKeys: [`old`],
        deletedKeys: [],
        deltas: [
          {
            txId: `old-delta`,
            latestRowVersion: 2,
            changedRows: [
              {
                key: `old`,
                value: { id: `old`, title: `Expired replay row` },
              },
            ],
            deletedKeys: [],
            rowMetadataMutations: [],
            collectionMetadataMutations: [],
          },
        ],
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
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
      await collection._sync.loadSubset({})
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `gap-trigger`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(pullEntered.promise, `seq-gap pull`)
      expired = true
      releasePull.resolve()
      await flushAsyncWork()
      await flushAsyncWork()
      expect(collection.get(`old`)).toBeUndefined()
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(rotations).toBe(1)),
        `private replay recovery`,
      )
      expect(storageId).toBe(`replay-private-storage`)
    } finally {
      releasePull.resolve()
      await collection.cleanup()
    }
  })

  // A source commit that arrives before a paused tab's renewal timer runs
  // must not publish or persist under the expired claim. The independent
  // history expires the claim immediately before commit admission, then lets
  // recovery advance to private empty storage. The rejected receipt and
  // exact destination of the following commit are the observations.
  it(`rejects an old source commit after cache claim expiry and permits a new one`, async () => {
    const adapter = createRecordingAdapter()
    const claimId = `expired-write-claim`
    let storageId = `expired-write-old`
    let active = true
    let renewals = 0
    let rotations = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.renewCacheGenerationClaim = async () => {
      renewals++
      return active ? Date.now() + 10_000 : undefined
    }
    adapter.rotateCacheGeneration = async () => {
      rotations++
      active = true
      return {
        storageCollectionId: (storageId = `expired-write-new`),
        claimId,
        expiresAtMs: Date.now() + 10_000,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    let source!: TodoSyncParams
    const sourceRestarted = createEventGate()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `expired-source-write`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            // Both old commits have entered the wrapper before rotation.
            return {
              restartAfterScopedRecovery: (cacheRotated) =>
                cacheRotated.then(() => sourceRestarted.resolve()),
            }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      await source.metadata!.persistence!.hydrateBaseline()
      // Baseline hydration is still authorized; expiry starts at commit admission.
      active = false
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `old`, title: `Expired claim` },
      })
      const oldReceipt = source.commit()
      if (oldReceipt === true) throw new Error(`source receipt was not tracked`)
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `second-old`, title: `Queued expired claim` },
      })
      const secondOldReceipt = source.commit()
      if (secondOldReceipt === true)
        throw new Error(`second source receipt was not tracked`)
      await expect(oldReceipt).rejects.toBeInstanceOf(
        SyncTransactionAbortedError,
      )
      await expect(secondOldReceipt).rejects.toBeInstanceOf(
        SyncTransactionAbortedError,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(storageId).toBe(`expired-write-new`)),
        `claim expiry recovery`,
      )
      await atPersistedOracleCheckpoint(
        sourceRestarted.promise,
        `replacement source restart`,
      )
      expect(rotations).toBe(1)
      expect(renewals).toBeGreaterThan(0)
      expect(collection.get(`old`)).toBeUndefined()
      expect(collection.get(`second-old`)).toBeUndefined()
      expect(
        adapter.applyCommittedTxCalls.filter((call) =>
          call.tx.mutations.some(
            (mutation) =>
              mutation.key === `old` || mutation.key === `second-old`,
          ),
        ),
      ).toEqual([])
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `new`, title: `New private generation` },
      })
      await whenSyncAccepted(source.commit())
      expect(collection.get(`new`)).toMatchObject({ id: `new` })
      expect(
        adapter.applyCommittedTxCalls
          .filter((call) =>
            call.tx.mutations.some((mutation) => mutation.key === `new`),
          )
          .map((call) => call.collectionId),
      ).toEqual([`expired-write-new`])
    } finally {
      await collection.cleanup()
    }
  })

  // Claim expiry revokes durable source authority, but it does not settle a
  // local optimistic transaction. The model keeps that row visible until its
  // mutation function settles, clears the old source base, then accepts a
  // fresh source commit in the new generation. This checkpoint also detects
  // a recovery that waits for visibility of its truncate behind the mutation.
  it(`recovers an expired cache claim beneath a persisting optimistic mutation`, async () => {
    const adapter = createRecordingAdapter()
    let storageId = `optimistic-expiry-old`
    let expired = false
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `optimistic-expiry-claim`,
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.renewCacheGenerationClaim = async () =>
      expired ? undefined : Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      expired = false
      return {
        storageCollectionId: (storageId = `optimistic-expiry-new`),
        claimId: `optimistic-expiry-claim`,
        expiresAtMs: Date.now() + 10_000,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const entered = createDeferred()
    const release = createDeferred()
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `optimistic-expiry`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            // This controlled source delivers only explicit test writes.
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
        onInsert: async () => {
          entered.resolve()
          await release.promise
        },
      }),
    )
    let mutation: ReturnType<typeof collection.insert> | undefined
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      mutation = collection.insert({ id: `local`, title: `Pending` })
      await entered.promise
      expect(collection.get(`local`)).toMatchObject({ id: `local` })
      expired = true
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `old`, title: `Expired source` },
      })
      const staleReceipt = source.commit()
      if (staleReceipt === true)
        throw new Error(`source receipt was not tracked`)
      await expect(staleReceipt).rejects.toBeInstanceOf(
        SyncTransactionAbortedError,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(storageId).toBe(`optimistic-expiry-new`)),
        `expired optimistic recovery`,
      )
      expect(collection.get(`local`)).toMatchObject({ id: `local` })
      expect(collection.get(`old`)).toBeUndefined()
      release.resolve()
      await mutation.isPersisted.promise
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `fresh`, title: `New source` },
      })
      await whenSyncAccepted(source.commit())
      expect(collection.get(`fresh`)).toMatchObject({ id: `fresh` })
      expect(
        adapter.applyCommittedTxCalls
          .filter((call) =>
            call.tx.mutations.some((entry) => entry.key === `fresh`),
          )
          .map((call) => call.collectionId),
      ).toEqual([`optimistic-expiry-new`])
    } finally {
      release.resolve()
      await mutation?.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
    }
  })

  // A warm run with an active demand renews its claim while timers run. If a
  // long pause lets the claim expire, that timer must start scoped recovery
  // and reacquire the active subset from the source. The held wall-clock
  // interval is bounded; the source call log distinguishes a wakeup from a
  // run that silently stays on the old cache.
  it(`reloads an active subset when its renewal timer finds an expired claim`, async () => {
    const adapter = createRecordingAdapter()
    let storageId = `timer-old-storage`
    let renewals = 0
    let rotations = 0
    let expired = false
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `timer-claim`,
      expiresAtMs: Date.now() + 80,
    })
    adapter.renewCacheGenerationClaim = async () => {
      renewals++
      return expired ? undefined : Date.now() + 80
    }
    adapter.rotateCacheGeneration = async () => {
      rotations++
      return {
        storageCollectionId: (storageId = `timer-new-storage`),
        claimId: `timer-claim`,
        expiresAtMs: Date.now() + 10_000,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const sourceLoads: Array<{ refetch?: boolean }> = []
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `timer-claim-reload`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            params.markReady()
            return {
              // The first load has settled before the claim-expiry timer.
              restartAfterScopedRecovery: () => {},
              loadSubset: (options) => {
                sourceLoads.push({ refetch: options.refetch })
                return Promise.resolve()
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      await collection._sync.loadSubset({ limit: 1 })
      expect(sourceLoads).toEqual([{ refetch: undefined }])
      expired = true
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(rotations).toBe(1)),
        `expired timer recovery`,
      )
      expect(renewals).toBeGreaterThan(0)
      await atPersistedOracleCheckpoint(
        vi.waitFor(() => expect(sourceLoads).toHaveLength(2)),
        `active subset reload`,
      )
      expect(sourceLoads[1]).toEqual({ refetch: true })
    } finally {
      await collection.cleanup()
    }
  })

  // A live claim with more than one timer interval remaining needs no durable
  // renewal write for each source commit or subset read. The adapter checks
  // claim authority at its storage boundary, while the timer maintains an
  // otherwise idle run. The independent clock and call ledger require zero
  // foreground renewals far from expiry and one when less than a minute
  // remains. The row receipts and subset loads still complete at both cuts.
  it(`renews a live cache claim only near expiry during foreground work`, async () => {
    const adapter = createRecordingAdapter()
    let now = 1_000
    let expiresAtMs = 301_000
    let renewals = 0
    let rotations = 0
    adapter.getCacheGenerationNow = () => now
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `foreground-renewal-storage`,
      claimId: `foreground-renewal-claim`,
      expiresAtMs,
    })
    adapter.renewCacheGenerationClaim = async () => {
      renewals++
      if (now >= expiresAtMs) return undefined
      return (expiresAtMs = now + 300_000)
    }
    adapter.rotateCacheGeneration = async () => {
      rotations++
      return {
        storageCollectionId: `foreground-renewal-new`,
        claimId: `foreground-renewal-claim`,
        expiresAtMs: (expiresAtMs = now + 300_000),
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `foreground-claim-renewal`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    const commit = async (id: string) => {
      source.begin()
      source.write({ type: `insert`, value: { id, title: id } })
      await whenSyncAccepted(source.commit())
    }
    try {
      await collection.stateWhenReady()
      const startupRenewals = renewals
      for (let index = 0; index < 6; index++) {
        await commit(`far-${index}`)
        await collection._sync.loadSubset({ limit: index + 1 })
      }
      expect(renewals).toBe(startupRenewals)
      expect(collection.get(`far-5`)).toMatchObject({ id: `far-5` })
      expect(rotations).toBe(0)

      now = 251_000
      await commit(`near`)
      expect(renewals).toBe(startupRenewals + 1)
      expect(collection.get(`near`)).toMatchObject({ id: `near` })
      await collection._sync.loadSubset({ limit: 7 })
      expect(renewals).toBe(startupRenewals + 1)
      expect(rotations).toBe(0)
    } finally {
      await collection.cleanup()
    }
  })

  // Skipping a far-from-expiry timer check must arm its successor. This
  // virtual-clock history observes no durable renewal at the first minute,
  // then one renewal when the same idle claim enters the one-minute window.
  // It distinguishes a cheap timer wake from accidentally consuming the only
  // renewal opportunity.
  it(`reschedules a skipped cache-claim timer until renewal is due`, async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const adapter = createRecordingAdapter()
    let expiresAtMs = Date.now() + 180_000
    let renewals = 0
    let rotations = 0
    adapter.getCacheGenerationNow = () => Date.now()
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `idle-renewal-storage`,
      claimId: `idle-renewal-claim`,
      expiresAtMs,
    })
    adapter.renewCacheGenerationClaim = async () => {
      renewals++
      if (Date.now() >= expiresAtMs) return undefined
      return (expiresAtMs = Date.now() + 180_000)
    }
    adapter.rotateCacheGeneration = async () => {
      rotations++
      return {
        storageCollectionId: `idle-renewal-new`,
        claimId: `idle-renewal-claim`,
        expiresAtMs: (expiresAtMs = Date.now() + 180_000),
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `idle-claim-renewal`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      await collection.stateWhenReady()
      const startupRenewals = renewals
      await vi.advanceTimersByTimeAsync(60_000)
      expect(renewals).toBe(startupRenewals)
      expect(collection.status).toBe(`ready`)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(renewals).toBe(startupRenewals + 1)
      expect(rotations).toBe(0)
      expect(collection.status).toBe(`ready`)
    } finally {
      await collection.cleanup()
      vi.useRealTimers()
    }
  })

  // A timer's transient renewal failure does not prove that the claim has
  // expired. The independent clock model keeps the old claim through the
  // failed attempt, retries before expiry, and never publishes an error or
  // rotates storage. The scheduled retry, status and storage route are checked
  // after each virtual-clock cut; treating every rejection as terminal fails
  // at the first cut.
  it(`retries a transient cache-claim renewal error while the claim is live`, async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const adapter = createRecordingAdapter()
    let renewals = 0
    let rotations = 0
    let failNextRenewal = false
    adapter.getCacheGenerationNow = () => Date.now()
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `timer-transient-old`,
      claimId: `timer-transient-claim`,
      expiresAtMs: Date.now() + 1_000,
    })
    adapter.renewCacheGenerationClaim = async () => {
      renewals++
      if (failNextRenewal) {
        failNextRenewal = false
        throw new Error(`transient SQLITE_BUSY`)
      }
      return Date.now() + 1_000
    }
    adapter.rotateCacheGeneration = async () => {
      rotations++
      return {
        storageCollectionId: `timer-transient-new`,
        claimId: `timer-transient-claim`,
        expiresAtMs: Date.now() + 1_000,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `timer-transient-renewal`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            params.markReady()
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      await collection.stateWhenReady()
      failNextRenewal = true
      await vi.advanceTimersByTimeAsync(500)
      expect(collection.status).toBe(`ready`)
      expect(rotations).toBe(0)
      const countAfterFailure = renewals
      await vi.advanceTimersByTimeAsync(250)
      expect(renewals).toBeGreaterThan(countAfterFailure)
      expect(collection.status).toBe(`ready`)
      expect(rotations).toBe(0)
    } finally {
      await collection.cleanup()
      vi.useRealTimers()
    }
  })

  // Recovery can accept a new storage generation while its source restart is
  // still held. A renewal timer consumed during that hold cannot renew: its
  // own claim check joins the in-flight recovery. The independent clock model
  // therefore starts the new timer after source restart, then renews before
  // the replacement claim expires. No further demand drives this checkpoint.
  it(`renews a replacement cache claim after a held source restart`, async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const adapter = createRecordingAdapter()
    const sourceHeld = createEventGate()
    const releaseSource = createEventGate()
    const sourceFinished = createEventGate()
    let renewals = 0
    let rotations = 0
    adapter.getCacheGenerationNow = () => Date.now()
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `held-source-old`,
      claimId: `held-source-claim`,
      expiresAtMs: 2_000,
    })
    adapter.renewCacheGenerationClaim = async () => {
      renewals++
      return rotations === 0 && Date.now() >= 2_000
        ? undefined
        : Date.now() + 1_000
    }
    adapter.rotateCacheGeneration = async () => {
      rotations++
      return {
        storageCollectionId: `held-source-new`,
        claimId: `held-source-claim`,
        expiresAtMs: Date.now() + 1_000,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `held-source-renewal`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            params.markReady()
            return {
              restartAfterScopedRecovery: (cacheRotated) =>
                cacheRotated.then(async () => {
                  sourceHeld.resolve()
                  await releaseSource.promise
                  sourceFinished.resolve()
                }),
              loadSubset: () => Promise.resolve(),
            }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      await collection.stateWhenReady()
      vi.setSystemTime(2_100)
      await vi.advanceTimersByTimeAsync(500)
      await sourceHeld.promise
      expect(rotations).toBe(1)
      await vi.advanceTimersByTimeAsync(500)
      releaseSource.resolve()
      await sourceFinished.promise
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      const afterRecovery = renewals
      await vi.advanceTimersByTimeAsync(260)
      expect(renewals).toBeGreaterThan(afterRecovery)
      expect(collection.status).toBe(`ready`)
    } finally {
      releaseSource.resolve()
      await collection.cleanup()
      vi.useRealTimers()
    }
  })

  // A local cache clear supplies no source-readiness evidence. The model starts
  // loading, accepts the scoped truncate, and remains loading until the source
  // explicitly marks ready. This wrapper-path check observes status after the
  // truncate commit, where the core default could otherwise publish readiness.
  it(`keeps initial Collection loading through a scoped cache clear`, async () => {
    const adapter = createRecordingAdapter()
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `scoped-clear-readiness`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()
      expect(collection.status).toBe(`loading`)
      await source.metadata!.persistence!.startScopedRecovery!()
      expect(collection.status).toBe(`loading`)
      source.markReady()
      await flushAsyncWork()
      expect(collection.status).toBe(`ready`)
    } finally {
      await collection.cleanup()
    }
  })

  // Core applies an accepted truncate even while a local optimistic handler
  // persists. The source may continue after this accepted clear; a later subset
  // still waits for its own applied rows. This held-handler cut tests the
  // review's proposed acceptance/application cycle on the actual wrapper path.
  it(`accepts a scoped cache clear while an optimistic handler is held`, async () => {
    const adapter = createRecordingAdapter()
    const entered = createDeferred()
    const release = createDeferred()
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `scoped-clear-held-handler`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
          },
        },
        persistence: { adapter },
        onInsert: async () => {
          entered.resolve()
          await release.promise
        },
      }),
    )
    let mutation: ReturnType<typeof collection.insert> | undefined

    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      mutation = collection.insert({ id: `local`, title: `Pending` })
      await entered.promise
      const recovery = observeSettlement(
        source.metadata!.persistence!.startScopedRecovery!(),
      )
      await flushAsyncWork()
      expect(recovery.read()).toEqual({ status: `fulfilled` })
      expect(collection.get(`local`)).toBeDefined()
      release.resolve()
      await mutation.isPersisted.promise
    } finally {
      release.resolve()
      await mutation?.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
    }
  })
})
