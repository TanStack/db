/**
 * Ordinary regression tests for persisted reset reload failure, resume evidence, startup baselines, and key encoding, as fixed scenarios. The reset and startup laws are owned by persisted-oracle.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { test as fcTest } from '@fast-check/vitest'
import { BasicIndex, IR, coalesce, createCollection } from '@tanstack/db'
import {
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  SingleProcessCoordinator,
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
  persistedCollectionOptions,
} from '../src'
import {
  oraclePropertyOptions,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import { Temporal } from './temporal-value-oracle'
import {
  assertGenerationNoticeHistory,
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createCoordinatorHarness,
  createDeferred,
  createEventGate,
  createFailStopCoordinatorHarness,
  createNoopAdapter,
  createRecordingAdapter,
  createTerminalFailureHarness,
  flushAsyncWork,
  generationNoticeHistory,
  installHydrationRoutingProbe,
  observeSettlement,
  recordedStorageId,
  stripVirtualProps,
} from './persisted-support'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistedStorageTarget,
  PersistedTx,
  PersistenceAdapter,
  TxCommitted,
} from '../src'
import type { SyncConfig, SyncMetadataApi } from '@tanstack/db'
import type {
  RecordingAdapter,
  Todo,
  TodoSyncParams,
} from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  fcTest.prop([generationNoticeHistory], {
    seed: 2069,
    numRuns: oracleRuns(24),
  })(
    `checks generated cache-generation notice histories (fixed)`,
    assertGenerationNoticeHistory,
  )

  fcTest.prop(
    [generationNoticeHistory],
    oraclePropertyOptions(24, `persistence.generation-notice`),
  )(
    `checks generated cache-generation notice histories (random or replayed)`,
    assertGenerationNoticeHistory,
  )

  it(`fail-stops queued and later work when reset reload fails after truncation`, async () => {
    const seed = { id: `seed`, title: `durable baseline` }
    const adapter = createRecordingAdapter([seed])
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-reset-reload-failure`,
    )
    const reloadEntered = createEventGate()
    const reload = createEventGate()
    const reloadError = new Error(`reset reload failed exactly`)
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-reset-reload-failure`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sourceParams = params
            params.markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let queuedReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `reset reload collection ready`,
      )
      expect(stripVirtualProps(collection.get(seed.id))).toEqual(seed)
      adapter.loadSubset = async () => {
        reloadEntered.resolve()
        await reload.promise
        throw reloadError
      }
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
      await atPersistedOracleCheckpoint(
        reloadEntered.promise,
        `reset reload entered after memory truncate`,
      )
      expect(collection.get(seed.id)).toBeUndefined()

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `queued`, title: `must reject with reset failure` },
      })
      queuedReceipt = Promise.resolve(sourceParams.commit()).then(
        () => undefined,
      )
      void queuedReceipt.catch(() => undefined)
      const queuedSettlement = observeSettlement(queuedReceipt)
      expect(queuedSettlement.read()).toEqual({ status: `pending` })

      reload.reject(reloadError)
      await flushAsyncWork()
      await flushAsyncWork()

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `late`, title: `must not continue after reset failure` },
      })
      const lateOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(sourceParams.commit()).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-reset-reload-failure receipt`,
      )
      const queuedOutcome = queuedSettlement.read()

      expect({
        queuedStatus: queuedOutcome.status,
        queuedExact:
          queuedOutcome.status === `rejected` &&
          queuedOutcome.reason === reloadError,
        lateStatus: lateOutcome.status,
        lateExact:
          lateOutcome.status === `rejected` &&
          lateOutcome.reason === reloadError,
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === reloadError,
        visibleSeed: collection.get(seed.id),
        durableSeed: adapter.rows.get(seed.id),
        visibleQueued: collection.get(`queued`),
        durableQueued: adapter.rows.get(`queued`),
        visibleLate: collection.get(`late`),
        durableLate: adapter.rows.get(`late`),
        applyCalls: adapter.applyCommittedTxCalls.length,
        publishCalls: coordinator.publishCalls.length,
      }).toEqual({
        queuedStatus: `rejected`,
        queuedExact: true,
        lateStatus: `rejected`,
        lateExact: true,
        status: `crashed`,
        exactPublicError: true,
        visibleSeed: undefined,
        durableSeed: seed,
        visibleQueued: undefined,
        durableQueued: undefined,
        visibleLate: undefined,
        durableLate: undefined,
        applyCalls: 0,
        publishCalls: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      reload.reject(reloadError)
      warning.mockRestore()
      await cleanupPersistedOracle(
        [
          () => collection.cleanup(),
          () => queuedReceipt?.catch(() => undefined),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`fences coordinator delivery after terminal failure while allowing release and cleanup`, async () => {
    const harness = await createTerminalFailureHarness(
      `durability`,
      `terminal-coordinator-delivery-fence`,
    )
    const {
      adapter,
      collection,
      coordinator,
      initialLease,
      terminalError,
      upstreamLoads,
      upstreamUnloads,
    } = harness
    const adapterLoadsBefore = adapter.loadSubsetCalls.length
    const ensureCallsBefore = coordinator.remoteEnsureCalls.length
    const releaseCallsBefore = coordinator.remoteReleaseCalls.length
    const upstreamLoadsBefore = upstreamLoads.length
    const applyCallsBefore = adapter.applyCommittedTxCalls.length
    const publishCallsBefore = coordinator.publishCalls.length
    adapter.loadSubset = (collectionId, options, context) => {
      adapter.loadSubsetCalls.push({
        collectionId: recordedStorageId(collectionId),
        options,
        requiredIndexSignatures: context?.requiredIndexSignatures ?? [],
      })
      return Promise.resolve([
        {
          key: `coordinator-late`,
          value: { id: `coordinator-late`, title: `must not arrive` },
        },
      ])
    }
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `post-terminal-targeted`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          {
            key: `targeted-late`,
            value: { id: `targeted-late`, title: `must not arrive` },
          },
        ],
        deletedKeys: [],
      })
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `post-terminal-full-reload`,
        latestRowVersion: 2,
        requiresFullReload: true,
      })
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 2,
      })
      const remoteEnsureOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({ limit: 9 })).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-terminal remote ensure delivery`,
      )
      await flushAsyncWork()
      await flushAsyncWork()
      await flushAsyncWork()

      const beforeCleanup = {
        targetedVisible: collection.get(`targeted-late`),
        reloadVisible: collection.get(`coordinator-late`),
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
      }

      collection._sync.unloadSubset(initialLease)
      await flushAsyncWork()
      await flushAsyncWork()
      const unloadCount = upstreamUnloads.length
      await collection.cleanup()
      cleanedUp = true

      expect({
        remoteEnsureStatus: remoteEnsureOutcome.status,
        remoteEnsureExact:
          remoteEnsureOutcome.status === `rejected` &&
          remoteEnsureOutcome.reason === terminalError,
        adapterLoads: adapter.loadSubsetCalls.length,
        ensureCalls: coordinator.remoteEnsureCalls.length,
        releaseCalls: coordinator.remoteReleaseCalls.length,
        releasedExact: coordinator.remoteReleaseCalls.at(-1) === initialLease,
        upstreamLoads: upstreamLoads.length,
        unloadCount,
        unsubscribeCalls: coordinator.unsubscribeCalls,
        applyCalls: adapter.applyCommittedTxCalls.length,
        publishCalls: coordinator.publishCalls.length,
        targetedVisible: beforeCleanup.targetedVisible,
        reloadVisible: beforeCleanup.reloadVisible,
        targetedDurable: adapter.rows.get(`targeted-late`),
        reloadDurable: adapter.rows.get(`coordinator-late`),
        status: beforeCleanup.status,
        exactPublicError: beforeCleanup.exactPublicError,
      }).toEqual({
        remoteEnsureStatus: `rejected`,
        remoteEnsureExact: true,
        adapterLoads: adapterLoadsBefore,
        ensureCalls: ensureCallsBefore,
        releaseCalls: releaseCallsBefore + 1,
        releasedExact: true,
        upstreamLoads: upstreamLoadsBefore,
        unloadCount: 0,
        unsubscribeCalls: 1,
        applyCalls: applyCallsBefore,
        publishCalls: publishCallsBefore,
        targetedVisible: undefined,
        reloadVisible: undefined,
        targetedDurable: undefined,
        reloadDurable: undefined,
        status: `crashed`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => (cleanedUp ? undefined : collection.cleanup())],
        hasPrimaryFailure,
      )
    }
  })

  it(`keeps a hydrated resume baseline across narrow full reloads`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Narrow` },
      { id: `2`, title: `Baseline only` },
    ])
    const loadSubset = adapter.loadSubset.bind(adapter)
    adapter.loadSubset = async (...args) => {
      const rows = await loadSubset(...args)
      return args[1].where ? rows.filter((row) => row.key === `1`) : rows
    }
    const coordinator = createCoordinatorHarness()
    let hydrateBaseline: (() => Promise<void>) | undefined
    let persistenceCapability:
      NonNullable<SyncMetadataApi<string>[`persistence`]> | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady, metadata }) => {
            const capability = metadata?.persistence
            if (!capability) {
              throw new Error(`Expected persisted sync capability`)
            }
            persistenceCapability = capability
            hydrateBaseline = capability.hydrateBaseline
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(hydrateBaseline).toBeTypeOf(`function`))
    expect(persistenceCapability).toMatchObject({
      protocol: `@tanstack/db/sync-persistence`,
      version: 1,
    })
    expect(persistenceCapability?.scanPersistedRows).toBeTypeOf(`function`)
    expect(persistenceCapability?.resumeSnapshot.certify).toBeTypeOf(`function`)
    expect(persistenceCapability?.resumeSnapshot.getKeySetEvidence).toBeTypeOf(
      `function`,
    )
    expect(
      persistenceCapability?.resumeSnapshot.expectCurrentCommit,
    ).toBeTypeOf(`function`)
    await hydrateBaseline!()
    expect(collection.has(`2`)).toBe(true)

    await collection._sync.loadSubset({
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(`1`)]),
    })
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `full-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    await flushAsyncWork()
    await flushAsyncWork()

    expect(collection.has(`2`)).toBe(true)
    await collection.cleanup()
  })

  it(`keeps resume certification consistent after an owned no-op commit`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    let persistenceCapability:
      SyncMetadataApi<string>[`persistence`] | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `owned-no-op-generation`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, markReady, metadata }) => {
            remoteBegin = begin
            remoteCommit = commit
            persistenceCapability = metadata?.persistence
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await vi.waitFor(() =>
        expect(persistenceCapability).toMatchObject({
          protocol: `@tanstack/db/sync-persistence`,
          version: 1,
        }),
      )

      remoteBegin?.()
      persistenceCapability?.resumeSnapshot.expectCurrentCommit()
      const applied = remoteCommit?.()
      if (applied !== true) await applied

      expect(adapter.applyCommittedTxCalls).toHaveLength(0)
      await persistenceCapability?.resumeSnapshot.certify()
      expect(persistenceCapability?.resumeSnapshot.getKeySetEvidence()).toEqual(
        { status: `consistent` },
      )
    } finally {
      await collection.cleanup()
    }
  })

  // A no-write election reserves a new durable term but leaves the persisted
  // rows, source cursor, row version, and reset epoch intact. The atomic
  // snapshot still certifies the same baseline when on-demand Electric resumes.
  // The recording adapter supplies only this term transition; the SQLite owner
  // separately proves that term reservation leaves the row version unchanged.
  it(`keeps resume evidence across a no-write durable term reservation`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `cached` }])
    let durableGeneration = {
      latestTerm: 1,
      latestSeq: 1,
      latestRowVersion: 1,
      resetEpoch: 0,
    }
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => ({
      ...(await loadResumeSnapshot(...args)),
      ...durableGeneration,
    })
    let persistenceCapability:
      SyncMetadataApi<string>[`persistence`] | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `no-write-term-resume`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady, metadata }) => {
            persistenceCapability = metadata?.persistence
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await vi.waitFor(() =>
        expect(persistenceCapability).toMatchObject({
          protocol: `@tanstack/db/sync-persistence`,
          version: 1,
        }),
      )
      await vi.waitFor(() =>
        expect(
          persistenceCapability?.resumeSnapshot.getKeySetEvidence(),
        ).toEqual({ status: `consistent` }),
      )

      durableGeneration = {
        latestTerm: 2,
        latestSeq: 0,
        latestRowVersion: 1,
        resetEpoch: 0,
      }
      await persistenceCapability?.resumeSnapshot.certify()
      expect(persistenceCapability?.resumeSnapshot.getKeySetEvidence()).toEqual(
        {
          status: `consistent`,
        },
      )
    } finally {
      await collection.cleanup()
    }
  })

  it(`invalidates resume evidence when storage advances outside the owned commit generation`, async () => {
    const adapter = createRecordingAdapter()
    let durableGeneration = {
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
      resetEpoch: 0,
    }
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => ({
      ...(await loadResumeSnapshot(...args)),
      ...durableGeneration,
    })
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = async (collectionId, tx) => {
      await applyCommittedTx(collectionId, tx)
      durableGeneration = {
        latestTerm: tx.term,
        latestSeq: tx.seq,
        latestRowVersion: Math.max(
          durableGeneration.latestRowVersion + 1,
          tx.rowVersion,
        ),
        resetEpoch: durableGeneration.resetEpoch,
      }
    }

    let remoteBegin: (() => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    let remoteMetadata:
      Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`] | undefined
    let persistenceCapability:
      SyncMetadataApi<string>[`persistence`] | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `generation-fence`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, markReady, metadata }) => {
            remoteBegin = begin
            remoteCommit = commit
            remoteMetadata = metadata
            persistenceCapability = metadata?.persistence
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await vi.waitFor(() =>
        expect(persistenceCapability).toMatchObject({
          protocol: `@tanstack/db/sync-persistence`,
          version: 1,
        }),
      )

      // This is not a supported writer path. It models storage advancing
      // without the runtime observing the generation that now precedes its
      // commit. The exact-generation fence must reject that uncertainty.
      durableGeneration.latestRowVersion = 5

      remoteBegin?.()
      persistenceCapability?.resumeSnapshot.expectCurrentCommit()
      remoteMetadata?.collection.set(`cursor`, `next`)
      const applied = remoteCommit?.()
      if (applied !== true) await applied

      await persistenceCapability?.resumeSnapshot.certify()
      expect(persistenceCapability?.resumeSnapshot.getKeySetEvidence()).toEqual(
        { status: `incompatible` },
      )
    } finally {
      await collection.cleanup()
    }
  })

  it(`ignores late wrapped sync writes after cleanup`, async () => {
    let lateWrite!: (message: { type: `insert`; value: Todo }) => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `late-write-after-cleanup`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ write, markReady }) => {
            lateWrite = (message) => write(message)
            markReady()
          },
        },
        persistence: { adapter: createNoopAdapter() },
      }),
    )

    await collection.preload()
    await collection.cleanup()

    expect(() =>
      lateWrite({
        type: `insert`,
        value: { id: `late`, title: `Late` },
      }),
    ).not.toThrow()
    expect(collection.has(`late`)).toBe(false)
  })

  it(`keeps retired sync controls inert after cleanup and restart`, async () => {
    const adapter = createRecordingAdapter()
    const runs: Array<TodoSyncParams> = []
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `retired-controls-after-restart`,
        getKey: (item) => item.id,
        sync: {
          sync: (params) => {
            runs.push(params)
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      await collection.preload()
      expect(runs).toHaveLength(1)
      const retired = runs[0]!

      await collection.cleanup()
      const replacementReady = createEventGate()
      const unsubscribe = collection.on(`status:ready`, () =>
        replacementReady.resolve(),
      )
      collection.startSyncImmediate()
      await atPersistedOracleCheckpoint(
        replacementReady.promise,
        `replacement controls ready`,
      )
      unsubscribe()
      expect(runs).toHaveLength(2)

      retired.begin()
      retired.write({
        type: `insert`,
        value: { id: `retired`, title: `must stay retired` },
      })
      const retiredReceipt = retired.commit()
      if (retiredReceipt !== true) await retiredReceipt

      const replacement = runs[1]!
      replacement.begin()
      replacement.write({
        type: `insert`,
        value: { id: `replacement`, title: `new controls own this row` },
      })
      const replacementReceipt = replacement.commit()
      if (replacementReceipt !== true) await replacementReceipt

      // A retained capability from the cleaned-up run must not truncate the
      // new Collection, even when invoked after the replacement row applies.
      await retired.metadata!.persistence!.startScopedRecovery!()

      expect({
        retiredPublic: collection.get(`retired`),
        retiredDurable: adapter.rows.get(`retired`),
        replacementPublic: stripVirtualProps(collection.get(`replacement`)),
        replacementDurable: adapter.rows.get(`replacement`),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        retiredPublic: undefined,
        retiredDurable: undefined,
        replacementPublic: {
          id: `replacement`,
          title: `new controls own this row`,
        },
        replacementDurable: {
          id: `replacement`,
          title: `new controls own this row`,
        },
        status: `ready`,
        publicError: undefined,
      })
    } finally {
      await collection.cleanup()
    }
  })

  // Focused collection-reset refinement: metadata and rows must come from one
  // hydration scope. The adapter makes an interleaved v2 write possible only
  // outside that scope, so the public v1 metadata and row are the independent
  // coherence checkpoint. This fixed history does not model arbitrary resets.
  it(`rebases a managed reset from its claimed physical storage`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const physicalId = `managed-reset-physical`
    const claimId = `managed-reset-claim`
    const reads: Array<PersistedStorageTarget> = []
    const load = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = (target, context) => {
      reads.push(target)
      return load(target, context)
    }
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: physicalId,
      claimId,
      expiresAtMs: Date.now() + 60_000,
    })
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: physicalId,
      claimId,
      expiresAtMs: Date.now() + 60_000,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 60_000
    adapter.releaseCacheGenerationClaim = async () => {}
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `managed-reset-logical`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              restartAfterScopedRecovery: () => {},
              loadSubset: async () => {},
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      const before = reads.length
      coordinator.emit(
        { type: `collection:reset`, schemaVersion: 1, resetEpoch: 1 },
        `peer`,
        physicalId,
      )
      await vi.waitFor(() => expect(reads.length).toBeGreaterThan(before))
      expect(reads.slice(before)).toContainEqual({
        kind: `managed`,
        storageCollectionId: physicalId,
        claimId,
      })
      expect(reads.slice(before)).not.toContainEqual({
        kind: `eager`,
        collectionId: `managed-reset-logical`,
      })
    } finally {
      await collection.cleanup()
    }
  })

  it(`keeps a collection-reset reload inside one hydration scope`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial row` }])
    adapter.collectionMetadata.set(`snapshot`, `initial`)
    const coordinator = createCoordinatorHarness()
    const loadSubset = adapter.loadSubset.bind(adapter)
    let inHydrationScope = false
    let interleaveArmed = false
    let interleaveRan = false

    const runInterleavedWrite = () => {
      interleaveRan = true
      adapter.collectionMetadata.set(`snapshot`, `v2`)
      adapter.rows.set(`1`, { id: `1`, title: `v2 row` })
    }

    adapter.loadSubset = async (...args) => {
      if (interleaveArmed && !inHydrationScope && !interleaveRan) {
        runInterleavedWrite()
      }
      return loadSubset(...args)
    }
    adapter.runInHydrationScope = async (task) => {
      inHydrationScope = true
      try {
        return await task(adapter)
      } finally {
        inHydrationScope = false
        if (interleaveArmed && !interleaveRan) runInterleavedWrite()
      }
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    await collection.preload()
    adapter.collectionMetadata.set(`snapshot`, `v1`)
    adapter.rows.set(`1`, { id: `1`, title: `v1 row` })
    interleaveArmed = true

    coordinator.emit({
      type: `collection:reset`,
      schemaVersion: 1,
      resetEpoch: 1,
    })

    await vi.waitFor(() => expect(interleaveRan).toBe(true))
    expect(collection._state.syncedCollectionMetadata.get(`snapshot`)).toBe(
      `v1`,
    )
    expect(collection.get(`1`)?.title).toBe(`v1 row`)
    await collection.cleanup()
  })

  // A remote commit queued during startup must run after the local hydration
  // scope releases the shared driver. A reset racing an unscheduled startup
  // baseline may publish before or after that baseline, but must own the final
  // public snapshot and may never be overwritten by an older baseline.
  it(`does not let an unscheduled startup baseline overwrite a newer collection reset`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `old` }])
    const coordinator = createCoordinatorHarness()
    const baselineEntered = createEventGate()
    const releaseBaseline = createEventGate()
    const resetReloadEntered = createEventGate()
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    const loadSubset = adapter.loadSubset.bind(adapter)
    let heldBaseline = false
    adapter.loadResumeSnapshot = async (...args) => {
      const snapshot = await loadResumeSnapshot(...args)
      if (args[1]?.includeRows && !heldBaseline) {
        heldBaseline = true
        baselineEntered.resolve()
        await releaseBaseline.promise
      }
      return snapshot
    }
    adapter.loadSubset = (...args) => {
      resetReloadEntered.resolve()
      return loadSubset(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: { sync: ({ markReady }) => markReady() },
        persistence: { adapter, coordinator },
      }),
    )
    const preload = collection.preload()
    void preload.catch(() => undefined)
    const publishedTitles: Array<string | undefined> = []
    const subscription = collection.subscribeChanges(
      () => publishedTitles.push(collection.get(`1`)?.title),
      { includeInitialState: false },
    )

    try {
      await atPersistedOracleCheckpoint(
        baselineEntered.promise,
        `unscheduled baseline entered`,
      )
      adapter.rows.set(`1`, { id: `1`, title: `new` })
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
      // Give a concurrent reset its event-loop turn. Serialization may instead
      // hold it behind the baseline; both orders must converge without a
      // public new -> old reversion.
      await flushAsyncWork()
      expect([undefined, `new`]).toContain(collection.get(`1`)?.title)
      releaseBaseline.resolve()
      await atPersistedOracleCheckpoint(preload, `startup after reset`)
      await atPersistedOracleCheckpoint(
        resetReloadEntered.promise,
        `reset reload after startup`,
      )
      await vi.waitFor(() => expect(collection.get(`1`)?.title).toBe(`new`))
      const firstNew = publishedTitles.indexOf(`new`)
      expect(firstNew).toBeGreaterThanOrEqual(0)
      expect(publishedTitles.slice(firstNew)).not.toContain(`old`)
    } finally {
      releaseBaseline.resolve()
      await preload.catch(() => undefined)
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`contiguous-reload`, `sequence-gap`] as const)(
    `finishes queued %s after scheduled startup hydration releases its scope`,
    async (route) => {
      const adapter = createRecordingAdapter([{ id: `1`, title: `old` }])
      const coordinator = createCoordinatorHarness()
      const baselineEntered = createEventGate()
      const releaseBaseline = createEventGate()
      const nestedScopeRequested = createEventGate()
      const queuedScopes: Array<() => void> = []
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      let heldBaseline = false
      let scopeActive = false

      adapter.loadResumeSnapshot = async (...args) => {
        const snapshot = await loadResumeSnapshot(...args)
        if (args[1]?.includeRows && !heldBaseline) {
          heldBaseline = true
          baselineEntered.resolve()
          await releaseBaseline.promise
        }
        return snapshot
      }

      const scopedAdapter: RecordingAdapter = { ...adapter }
      scopedAdapter.runInHydrationScope = (task) => task(scopedAdapter)
      adapter.runInHydrationScope = (task) => {
        if (scopeActive) {
          nestedScopeRequested.resolve()
          return new Promise((resolve, reject) => {
            queuedScopes.push(() => {
              void task(scopedAdapter).then(resolve, reject)
            })
          })
        }
        scopeActive = true
        return Promise.resolve()
          .then(() => task(scopedAdapter))
          .finally(() => {
            scopeActive = false
            while (queuedScopes.length > 0) queuedScopes.shift()?.()
          })
      }

      if (route === `sequence-gap`) {
        coordinator.setPullSinceResponse({
          type: `rpc:pullSince:res`,
          rpcId: `review-gap`,
          ok: true,
          latestTerm: 1,
          latestSeq: 2,
          latestRowVersion: 2,
          requiresFullReload: true,
        })
      }
      const pullSince = coordinator.pullSince!.bind(coordinator)
      let coordinatorEnteredDuringScope: boolean | undefined
      coordinator.pullSince = (...args) => {
        coordinatorEnteredDuringScope = scopeActive
        return pullSince(...args)
      }

      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-present`,
          getKey: (item) => item.id,
          sync: { sync: ({ markReady }) => markReady() },
          persistence: { adapter, coordinator },
        }),
      )
      const preload = collection.preload()
      void preload.catch(() => undefined)

      try {
        await atPersistedOracleCheckpoint(
          baselineEntered.promise,
          `${route} baseline entered`,
        )
        adapter.rows.set(`1`, { id: `1`, title: `new` })
        const committed: TxCommitted =
          route === `sequence-gap`
            ? {
                type: `tx:committed`,
                term: 1,
                seq: 2,
                txId: `review-sequence-gap`,
                latestRowVersion: 2,
                requiresFullReload: false,
                changedRows: [],
                deletedKeys: [],
              }
            : {
                type: `tx:committed`,
                term: 1,
                seq: 1,
                txId: `review-contiguous-reload`,
                latestRowVersion: 1,
                requiresFullReload: true,
              }
        coordinator.emit(committed)
        releaseBaseline.resolve()
        const first = await atPersistedOracleCheckpoint(
          Promise.race([
            preload.then(() => `startup-settled` as const),
            nestedScopeRequested.promise.then(() => `nested-scope` as const),
          ]),
          `${route} startup or nested scope`,
        )
        expect(first).toBe(`startup-settled`)
        expect(collection.get(`1`)?.title).toBe(`new`)
        if (route === `sequence-gap`) {
          expect(coordinator.pullSinceCalls).toBe(1)
          expect(coordinatorEnteredDuringScope).toBe(false)
        }
      } finally {
        releaseBaseline.resolve()
        while (queuedScopes.length > 0) queuedScopes.shift()?.()
        await preload.catch(() => undefined)
        await collection.cleanup()
      }
    },
  )

  // Focused receipt-ownership refinements. A source receipt created by the
  // hydration operation belongs to its waiter even if it rejects before the
  // waiter snapshots; a receipt created after hydration work returns does not.
  // The public load result and exact rejection identity distinguish those two
  // boundaries without treating every pending source receipt as related.
  it(`propagates an operation-owned receipt rejection that settles before the hydration waiter snapshots`, async () => {
    const adapter = createRecordingAdapter()
    const hydrateLoadEntered = createDeferred()
    const allowHydrateLoad = createDeferred()
    let gateHydrationLoad = true
    adapter.loadSubset = async () => {
      if (gateHydrationLoad) {
        gateHydrationLoad = false
        hydrateLoadEntered.resolve()
        await allowHydrateLoad.promise
      }
      return []
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit:
      ((signal?: AbortSignal) => true | Promise<void>) | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-settled-receipt-boundary`,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<unknown> | undefined
    let receipt: Promise<void> | undefined
    const abortController = new AbortController()

    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      await hydrateLoadEntered.promise

      let keyReads = 0
      const establishingRow = {
        get id() {
          keyReads++
          if (keyReads === 2) abortController.abort()
          return `establishing`
        },
        title: `Abort during buffered replay`,
      }
      remoteBegin?.()
      remoteWrite?.({ type: `insert`, value: establishingRow })
      const applied = remoteCommit?.(abortController.signal)
      if (!(applied instanceof Promise)) {
        throw new Error(`expected a buffered establishing receipt`)
      }
      receipt = applied
      void receipt.catch(() => undefined)

      allowHydrateLoad.resolve()
      const [loadResult, receiptResult] = await Promise.allSettled([
        load,
        receipt,
      ])

      expect(keyReads).toBeGreaterThanOrEqual(2)
      expect(abortController.signal.aborted).toBe(true)
      expect(receiptResult.status).toBe(`rejected`)
      expect(loadResult.status).toBe(`rejected`)
      if (
        loadResult.status === `rejected` &&
        receiptResult.status === `rejected`
      ) {
        expect(loadResult.reason).toBe(receiptResult.reason)
      }
    } finally {
      abortController.abort()
      allowHydrateLoad.resolve()
      await receipt?.catch(() => undefined)
      await load?.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`does not adopt an unrelated source receipt created after hydration work returns`, async () => {
    const adapter = createRecordingAdapter()
    const mutationEntered = createDeferred()
    const releaseMutation = createDeferred()
    const unrelatedStarted = createDeferred<{
      abortController: AbortController
      receipt: Promise<void>
    }>()
    const trace: Array<string> = []
    let probeActive = false
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit:
      ((signal?: AbortSignal) => true | Promise<void>) | undefined

    adapter.runInHydrationScope = async (task) => {
      if (!probeActive) return task(adapter)
      probeActive = false

      const result = await task(adapter)
      trace.push(`hydrate-task-returned`)

      const abortController = new AbortController()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `unrelated`, title: `Outside hydrate boundary` },
      })
      const receipt = remoteCommit?.(abortController.signal)
      if (!(receipt instanceof Promise)) {
        throw new Error(`expected a pending unrelated receipt`)
      }
      trace.push(`unrelated-receipt-created`)
      unrelatedStarted.resolve({ abortController, receipt })
      return result
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-unrelated-receipt-boundary`,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
        onInsert: async () => {
          mutationEntered.resolve()
          await releaseMutation.promise
        },
      }),
    )
    let mutation: ReturnType<typeof collection.insert> | undefined
    let load: Promise<unknown> | undefined
    let unrelated:
      { abortController: AbortController; receipt: Promise<void> } | undefined

    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      mutation = collection.insert({ id: `local`, title: `Persisting gate` })
      await mutationEntered.promise

      probeActive = true
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      unrelated = await unrelatedStarted.promise
      expect(trace).toEqual([
        `hydrate-task-returned`,
        `unrelated-receipt-created`,
      ])

      // Give the public load continuation the opportunity to snapshot receipts.
      await flushAsyncWork()
      unrelated.abortController.abort()

      // The subset's own hydrated rows wait behind the persisting mutation,
      // so the load settles once that mutation does. It must not also wait
      // for the unrelated receipt.
      releaseMutation.resolve()
      await mutation.isPersisted.promise
      await expect(load).resolves.toBeUndefined()
      await unrelated.receipt.catch(() => undefined)
    } finally {
      unrelated?.abortController.abort()
      releaseMutation.resolve()
      await mutation?.isPersisted.promise.catch(() => undefined)
      await load?.catch(() => undefined)
      await collection.cleanup()
    }
  })

  // Persisted indexes are optional query accelerators: the existing adapter
  // failure law keeps rows and readiness available when an index cannot be
  // stored. Spec construction belongs to that same best-effort boundary.
  // These histories add real serialization rejection before adapter entry,
  // both at bootstrap and at index:added, with a healthy sibling and supported
  // native control. Rows use ordinary strings; no unsupported row write is
  // admitted. At settled index work, compare readiness, rows, warnings, and the
  // exact signatures that reached the adapter and coordinator.
  it.sequential.each(
    [`startup`, `runtime`].flatMap((phase) =>
      [
        `Instant`,
        `PlainDate`,
        `ZonedDateTime`,
        `Duration`,
        `missing-global`,
        `missing-global-date`,
      ].map((kind) => ({ phase, kind })),
    ),
  )(
    `keeps index serialization failure best-effort / $phase / $kind`,
    async ({ phase, kind }) => {
      const originalTemporal = Object.getOwnPropertyDescriptor(
        globalThis,
        `Temporal`,
      )
      Object.defineProperty(globalThis, `Temporal`, {
        value: kind.startsWith(`missing-global`) ? undefined : Temporal,
        configurable: true,
        writable: true,
      })
      const value =
        kind === `PlainDate` || kind === `missing-global-date`
          ? Temporal.PlainDate.from(`2026-01-02`)
          : kind === `ZonedDateTime`
            ? Temporal.ZonedDateTime.from(`2026-01-02T00:00:00+00:00[UTC]`)
            : kind === `Duration`
              ? Temporal.Duration.from(`PT1H`)
              : Temporal.Instant.from(`2026-01-02T00:00:00Z`)
      const accepted = kind === `Instant` || kind === `PlainDate`
      const row = { id: `persisted`, title: `ordinary row` }
      const adapter = createRecordingAdapter([row])
      const coordinator = createCoordinatorHarness()
      const remoteSignatures: Array<string> = []
      coordinator.requestEnsurePersistedIndex = (_id, signature) => {
        remoteSignatures.push(signature)
        return Promise.resolve()
      }
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `index-serialization-${phase}-${kind}`,
          getKey: (item) => item.id,
          defaultIndexType: BasicIndex,
          sync: { sync: ({ markReady }) => markReady() },
          persistence: { adapter, coordinator },
        }),
      )
      let hasPrimaryFailure = false
      try {
        if (phase === `runtime`) await collection.preload()
        const index = collection.createIndex((item) =>
          coalesce(item.title, new IR.Value(value)),
        )
        const healthy = collection.createIndex((item) => item.id)
        const metadata = collection.getIndexMetadata()
        const signature = metadata.find(
          (entry) => entry.indexId === index.id,
        )!.signature
        const healthySignature = metadata.find(
          (entry) => entry.indexId === healthy.id,
        )!.signature
        if (phase === `startup`)
          await expect(collection.preload()).resolves.toBeUndefined()
        await flushAsyncWork()
        expect(collection.status).toBe(`ready`)
        expect(stripVirtualProps(collection.get(row.id))).toEqual(row)
        const expectedSignatures = accepted
          ? [signature, healthySignature]
          : [healthySignature]
        expect(adapter.ensureIndexCalls.map((call) => call.signature)).toEqual(
          expectedSignatures,
        )
        expect(remoteSignatures).toEqual(expectedSignatures)
        expect(warning.mock.calls).toHaveLength(accepted ? 0 : 2)
        if (!accepted) {
          expect(warning.mock.calls.map(([message]) => message)).toEqual([
            `Failed to ensure persisted index in adapter:`,
            `Failed to ensure persisted index through coordinator:`,
          ])
          for (const [, error] of warning.mock.calls) {
            expect(error).toMatchObject({
              name: `InvalidPersistedCollectionConfigError`,
            })
          }
        }
        // A following ordinary subset load is still usable after the skipped index.
        await collection._sync.loadSubset({ limit: 1 })
        expect(stripVirtualProps(collection.get(row.id))).toEqual(row)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        await cleanupPersistedOracle(
          [
            () => warning.mockRestore(),
            () => collection.cleanup(),
            () => {
              if (originalTemporal)
                Object.defineProperty(globalThis, `Temporal`, originalTemporal)
              else Reflect.deleteProperty(globalThis, `Temporal`)
            },
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Optional index failure isolation also applies after serializer admission.
  // The model is a product of independent collaborator outcomes, not runtime
  // control flow: local success alone authorizes a completion marker; either
  // collaborator may fail without failing rows, readiness, or a healthy sibling.
  // A held local promise supplies the intermediate observation: its coordinator
  // request cannot claim completed work before that promise settles. Startup
  // visits indexes serially; runtime additions may overlap, so only per-index
  // causality and exact call multiplicity are promised, not global call order.
  it.sequential.each(
    [`startup`, `runtime`].flatMap((phase) =>
      [`local`, `coordinator`, `both`].flatMap((boundary) =>
        [`throw`, `held`].flatMap((settlement) =>
          [false, true].map((fails) => ({
            phase,
            boundary,
            settlement,
            fails,
          })),
        ),
      ),
    ),
  )(
    `isolates optional index outcomes / $phase / $boundary / $settlement / fails $fails`,
    async ({ phase, boundary, settlement, fails }) => {
      const row = { id: `row`, title: `available` }
      const adapter = createRecordingAdapter([row])
      const coordinator = createCoordinatorHarness()
      const entered = createDeferred()
      const gate = createDeferred()
      const failure = new Error(`optional index rejected`)
      const localNames: Array<string> = []
      const remote: Array<{ name: string; completed: boolean }> = []
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const settle = () => {
        entered.resolve()
        if (settlement === `held`)
          return gate.promise.then(() => {
            if (fails) throw failure
          })
        if (fails) throw failure
        return Promise.resolve()
      }
      adapter.ensureIndex = (_id, _signature, spec) => {
        const name = String(spec.metadata?.name)
        localNames.push(name)
        return name === `target` && boundary !== `coordinator`
          ? settle()
          : Promise.resolve()
      }
      coordinator.requestEnsurePersistedIndex = (
        _id,
        _signature,
        spec,
        completedAdapter,
        completed,
      ) => {
        const name = String(spec.metadata?.name)
        // The flag and adapter capability must agree, including failed locals.
        expect(completedAdapter).toBe(completed ? adapter : undefined)
        remote.push({ name, completed: completed === true })
        return name === `target` && boundary !== `local`
          ? settle()
          : Promise.resolve()
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `optional-index-${phase}-${boundary}-${settlement}-${fails}`,
          getKey: (item) => item.id,
          defaultIndexType: BasicIndex,
          sync: { sync: ({ markReady }) => markReady() },
          persistence: { adapter, coordinator },
        }),
      )
      let preload: Promise<void> | undefined
      let hasPrimaryFailure = false
      process.on(`unhandledRejection`, onUnhandled)
      try {
        if (phase === `runtime`) await collection.preload()
        collection.createIndex((item) => item.title, { name: `target` })
        collection.createIndex((item) => item.id, { name: `healthy` })
        if (phase === `startup`) {
          preload = Promise.resolve(collection.preload())
          void preload.catch(() => undefined)
        }
        await entered.promise
        await flushAsyncWork()
        expect(collection.status).not.toBe(`crashed`)
        if (phase === `runtime`) {
          expect(collection.status).toBe(`ready`)
          expect(stripVirtualProps(collection.get(row.id))).toEqual(row)
        }
        if (settlement === `held`) {
          expect(warning).not.toHaveBeenCalled()
          if (boundary !== `coordinator`)
            expect(remote.filter((entry) => entry.name === `target`)).toEqual(
              [],
            )
        }
        gate.resolve()
        await preload
        await flushAsyncWork()
        expect(collection.status).toBe(`ready`)
        expect(stripVirtualProps(collection.get(row.id))).toEqual(row)
        expect([...localNames].sort()).toEqual([`healthy`, `target`])
        expect(
          [...remote].sort((a, b) => a.name.localeCompare(b.name)),
        ).toEqual([
          { name: `healthy`, completed: true },
          { name: `target`, completed: !(fails && boundary !== `coordinator`) },
        ])
        expect(warning.mock.calls).toEqual(
          fails
            ? [
                ...(boundary !== `coordinator`
                  ? [[`Failed to ensure persisted index in adapter:`, failure]]
                  : []),
                ...(boundary !== `local`
                  ? [
                      [
                        `Failed to ensure persisted index through coordinator:`,
                        failure,
                      ],
                    ]
                  : []),
              ]
            : [],
        )
        for (const [, error] of warning.mock.calls) expect(error).toBe(failure)
        expect(unhandled).toEqual([])
        await collection._sync.loadSubset({ limit: 1 })
        expect(stripVirtualProps(collection.get(row.id))).toEqual(row)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        gate.resolve()
        await cleanupPersistedOracle(
          [
            () => preload?.catch(() => undefined),
            // Drain held rejection delivery before this case releases its observer.
            () => flushAsyncWork(),
            () => warning.mockRestore(),
            () => collection.cleanup(),
            () => {
              process.off(`unhandledRejection`, onUnhandled)
            },
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`only signals completed leader-local index work after local success`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const localFailure = new Error(`local index creation failed`)
    const completedLocalMarkers: Array<boolean> = []
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})

    adapter.ensureIndex = async (collectionId, signature) => {
      adapter.ensureIndexCalls.push({
        collectionId: recordedStorageId(collectionId),
        signature,
      })
      throw localFailure
    }
    coordinator.requestEnsurePersistedIndex = async (
      _collectionId,
      _signature,
      _spec,
      completedLocalAdapter,
      localEnsureCompleted,
    ) => {
      completedLocalMarkers.push(
        completedLocalAdapter !== undefined && localEnsureCompleted === true,
      )
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `failed-local-index-bootstrap`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.createIndex((row) => row.title, { name: `startup-title` })

    try {
      await collection.preload()
      expect(completedLocalMarkers).toEqual([false])
    } finally {
      await collection.cleanup()
      warn.mockRestore()
    }
  })

  it(`releases the hydration scope before invoking a coordinator that uses its own adapter`, async () => {
    const adapter = createRecordingAdapter()
    const coordinatorEntered = createDeferred()
    const breakSchedulerCycle = createDeferred()
    let hydrationScopeActive = false
    let coordinatorEnteredDuringHydration: boolean | undefined

    const publicEnsureIndex = adapter.ensureIndex.bind(adapter)
    const scopedAdapter: PersistenceAdapter = {
      ...adapter,
      ensureIndex: publicEnsureIndex,
    }
    adapter.runInHydrationScope = async (task) => {
      hydrationScopeActive = true
      try {
        return await task(scopedAdapter)
      } finally {
        hydrationScopeActive = false
      }
    }
    adapter.ensureIndex = async (...args) => {
      if (hydrationScopeActive) {
        // A public core-adapter call queues behind the active hydrate. The
        // hydrate cannot release until this coordinator call returns.
        await breakSchedulerCycle.promise
      }
      await publicEnsureIndex(...args)
    }

    const coordinator = createCoordinatorHarness()
    coordinator.requestEnsurePersistedIndex = async (
      collectionId,
      signature,
      spec,
    ) => {
      coordinatorEnteredDuringHydration = hydrationScopeActive
      coordinatorEntered.resolve()
      // Deliberately ignore the optional scoped adapter, as existing public
      // coordinator implementations are allowed to do.
      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        spec,
      )
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `custom-coordinator-hydration-scope`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.createIndex((row) => row.title, {
      name: `startup-title`,
    })
    const preload = Promise.resolve(collection.preload())
    void preload.catch(() => undefined)

    try {
      await coordinatorEntered.promise
      expect(coordinatorEnteredDuringHydration).toBe(false)
    } finally {
      breakSchedulerCycle.resolve()
      await preload.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`releases crossed follower hydration scopes before leader index RPC work`, async () => {
    const bothLocalIndexesEntered = createDeferred()
    const bothCoordinatorRequestsEntered = createDeferred()
    let localIndexEntries = 0
    let coordinatorEntries = 0

    const createTabAdapter = () => {
      const adapter = createRecordingAdapter()
      const breakSchedulerCycle = createDeferred()
      let hydrationScopeActive = false
      const remoteScopeObservations: Array<boolean> = []
      const publicEnsureIndex = adapter.ensureIndex.bind(adapter)
      const scopedAdapter: PersistenceAdapter = {
        ...adapter,
        ensureIndex: async (...args) => {
          localIndexEntries++
          if (localIndexEntries === 2) bothLocalIndexesEntered.resolve()
          await bothLocalIndexesEntered.promise
          await publicEnsureIndex(...args)
        },
      }
      adapter.runInHydrationScope = async (task) => {
        hydrationScopeActive = true
        try {
          return await task(scopedAdapter)
        } finally {
          hydrationScopeActive = false
        }
      }
      adapter.ensureIndex = async (...args) => {
        remoteScopeObservations.push(hydrationScopeActive)
        coordinatorEntries++
        if (coordinatorEntries === 2) bothCoordinatorRequestsEntered.resolve()
        if (hydrationScopeActive) await breakSchedulerCycle.promise
        await publicEnsureIndex(...args)
      }
      return {
        adapter,
        breakSchedulerCycle,
        remoteScopeObservations,
      }
    }

    const tab1 = createTabAdapter()
    const tab2 = createTabAdapter()
    const coordinator1 = createCoordinatorHarness()
    const coordinator2 = createCoordinatorHarness()
    coordinator1.isLeader = () => false
    coordinator2.isLeader = () => false
    coordinator1.requestEnsurePersistedIndex = (
      collectionId,
      signature,
      spec,
    ) =>
      tab2.adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        spec,
      )
    coordinator2.requestEnsurePersistedIndex = (
      collectionId,
      signature,
      spec,
    ) =>
      tab1.adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        signature,
        spec,
      )

    const createFollowerCollection = (
      id: string,
      persistence: PersistedCollectionPersistence,
    ) => {
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          getKey: (item) => item.id,
          defaultIndexType: BasicIndex,
          sync: {
            sync: ({ markReady }) => {
              markReady()
            },
          },
          persistence,
        }),
      )
      collection.createIndex((row) => row.title, { name: `${id}-title` })
      return collection
    }
    const followerA = createFollowerCollection(`follower-a`, {
      adapter: tab1.adapter,
      coordinator: coordinator1,
    })
    const followerB = createFollowerCollection(`follower-b`, {
      adapter: tab2.adapter,
      coordinator: coordinator2,
    })
    const preloadA = Promise.resolve(followerA.preload())
    const preloadB = Promise.resolve(followerB.preload())
    void preloadA.catch(() => undefined)
    void preloadB.catch(() => undefined)

    try {
      await bothCoordinatorRequestsEntered.promise
      expect({
        tab1: tab1.remoteScopeObservations,
        tab2: tab2.remoteScopeObservations,
      }).toEqual({ tab1: [false], tab2: [false] })
    } finally {
      tab1.breakSchedulerCycle.resolve()
      tab2.breakSchedulerCycle.resolve()
      await Promise.all([preloadA, preloadB]).catch(() => undefined)
      await Promise.all([followerA.cleanup(), followerB.cleanup()])
    }
  })

  it(`releases the hydration scope before a gap coordinator uses its own adapter`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const coordinatorEntered = createDeferred()
    const breakSchedulerCycle = createDeferred()
    let hydrationScopeActive = false
    let coordinatorEnteredDuringHydration: boolean | undefined

    const pullSince = async () => ({
      latestRowVersion: 0,
      requiresFullReload: false as const,
      changedKeys: [],
      deletedKeys: [],
      deltas: [],
    })
    const publicAdapter = adapter as RecordingAdapter & {
      pullSince: typeof pullSince
    }
    const scopedAdapter = {
      ...adapter,
      pullSince,
    }
    publicAdapter.pullSince = async () => {
      if (hydrationScopeActive) await breakSchedulerCycle.promise
      return pullSince()
    }
    adapter.runInHydrationScope = async (task) => {
      hydrationScopeActive = true
      try {
        return await task(scopedAdapter)
      } finally {
        hydrationScopeActive = false
      }
    }
    coordinator.pullSince = async (_collectionId, _fromRowVersion) => {
      coordinatorEnteredDuringHydration = hydrationScopeActive
      coordinatorEntered.resolve()
      const result = await publicAdapter.pullSince()
      return {
        type: `rpc:pullSince:res`,
        rpcId: `legacy-gap-coordinator`,
        ok: true,
        latestTerm: 1,
        latestSeq: 2,
        latestRowVersion: result.latestRowVersion,
        requiresFullReload: result.requiresFullReload,
        changedKeys: result.changedKeys,
        deletedKeys: result.deletedKeys,
        deltas: result.deltas,
      }
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    await collection.preload()

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 2,
      txId: `tx-gap-legacy-coordinator`,
      latestRowVersion: 2,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
    })

    try {
      await coordinatorEntered.promise
      expect(coordinatorEnteredDuringHydration).toBe(false)
    } finally {
      breakSchedulerCycle.resolve()
      await flushAsyncWork()
      await collection.cleanup()
    }
  })

  // Focused invalidation-reload refinements. Whether recovery follows a
  // sequence gap or a contiguous committed notification, metadata and rows
  // must be read inside one hydration scope. The adapter schedules v2 only
  // outside the scope; coherent public v1 state is the checkpoint.
  it(`keeps sequence-gap recovery inside one hydration scope`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial row` }])
    adapter.collectionMetadata.set(`snapshot`, `initial`)
    const coordinator = createCoordinatorHarness()
    coordinator.setPullSinceResponse({
      type: `rpc:pullSince:res`,
      rpcId: `pull-gap-scope`,
      ok: true,
      latestTerm: 1,
      latestSeq: 1,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    const loadSubset = adapter.loadSubset.bind(adapter)
    let inHydrationScope = false
    let interleaveArmed = false
    let interleaveRan = false

    const runInterleavedWrite = () => {
      interleaveRan = true
      adapter.collectionMetadata.set(`snapshot`, `v2`)
      adapter.rows.set(`1`, { id: `1`, title: `v2 row` })
    }

    adapter.loadSubset = async (...args) => {
      if (interleaveArmed && !inHydrationScope && !interleaveRan) {
        runInterleavedWrite()
      }
      return loadSubset(...args)
    }
    adapter.runInHydrationScope = async (task) => {
      inHydrationScope = true
      try {
        return await task(adapter)
      } finally {
        inHydrationScope = false
        if (interleaveArmed && !interleaveRan) runInterleavedWrite()
      }
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    await collection.preload()
    adapter.collectionMetadata.set(`snapshot`, `v1`)
    adapter.rows.set(`1`, { id: `1`, title: `v1 row` })
    interleaveArmed = true

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 2,
      txId: `tx-gap-scope`,
      latestRowVersion: 2,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
    })

    await vi.waitFor(() => expect(interleaveRan).toBe(true))
    expect(collection._state.syncedCollectionMetadata.get(`snapshot`)).toBe(
      `v1`,
    )
    expect(collection.get(`1`)?.title).toBe(`v1 row`)
    await collection.cleanup()
  })

  it(`keeps contiguous committed reload inside one hydration scope`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial row` }])
    adapter.collectionMetadata.set(`snapshot`, `initial`)
    const coordinator = createCoordinatorHarness()
    const loadSubset = adapter.loadSubset.bind(adapter)
    let inHydrationScope = false
    let interleaveArmed = false
    let interleaveRan = false

    const runInterleavedWrite = () => {
      interleaveRan = true
      adapter.collectionMetadata.set(`snapshot`, `v2`)
      adapter.rows.set(`1`, { id: `1`, title: `v2 row` })
    }

    adapter.loadSubset = async (...args) => {
      if (interleaveArmed && !inHydrationScope && !interleaveRan) {
        runInterleavedWrite()
      }
      return loadSubset(...args)
    }
    adapter.runInHydrationScope = async (task) => {
      inHydrationScope = true
      try {
        return await task(adapter)
      } finally {
        inHydrationScope = false
        if (interleaveArmed && !interleaveRan) runInterleavedWrite()
      }
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    await collection.preload()
    adapter.collectionMetadata.set(`snapshot`, `v1`)
    adapter.rows.set(`1`, { id: `1`, title: `v1 row` })
    interleaveArmed = true

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-contiguous-reload-scope`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })

    await vi.waitFor(() => expect(interleaveRan).toBe(true))
    expect(collection._state.syncedCollectionMetadata.get(`snapshot`)).toBe(
      `v1`,
    )
    expect(collection.get(`1`)?.title).toBe(`v1 row`)
    await collection.cleanup()
  })

  // Focused lifecycle-fencing witness: generation-zero startup is held across
  // cleanup and rebound, then released while generation one is still loading.
  // Zero ensure-index calls for the rebound signatures prove stale bootstrap
  // and listener work did not cross the public lifecycle boundary.
  it(`does not let stale startup install index work on a rebound lifecycle`, async () => {
    const adapter = createRecordingAdapter()
    const g0MetadataEntered = createDeferred()
    const allowG0Metadata = createDeferred()
    const g1MetadataEntered = createDeferred()
    const allowG1Metadata = createDeferred()
    let metadataCalls = 0
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (...args) => {
      if (args[1]?.includeRows === false) {
        metadataCalls++
        if (metadataCalls === 1) {
          g0MetadataEntered.resolve()
          await allowG0Metadata.promise
        } else if (metadataCalls === 2) {
          g1MetadataEntered.resolve()
          await allowG1Metadata.promise
        }
      }
      return loadResumeSnapshot(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-startup-index-generation`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const stalePreload = Promise.resolve(collection.preload())
    void stalePreload.catch(() => undefined)
    let freshReady: Promise<unknown> | undefined

    try {
      await g0MetadataEntered.promise
      await collection.cleanup()

      const reboundIndex = collection.createIndex((row) => row.title, {
        name: `rebound-bootstrap`,
      })
      const reboundSignature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === reboundIndex.id)?.signature
      expect(reboundSignature).toBeDefined()
      freshReady = collection.stateWhenReady()

      allowG0Metadata.resolve()
      await g1MetadataEntered.promise

      const staleBootstrapCalls = adapter.ensureIndexCalls.filter(
        (call) => call.signature === reboundSignature,
      )
      const listenerIndex = collection.createIndex((row) => row.id, {
        name: `rebound-listener`,
      })
      const listenerSignature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === listenerIndex.id)?.signature
      expect(listenerSignature).toBeDefined()
      const staleListenerCalls = adapter.ensureIndexCalls.filter(
        (call) => call.signature === listenerSignature,
      )

      expect({
        staleBootstrapCalls: staleBootstrapCalls.length,
        staleListenerCalls: staleListenerCalls.length,
      }).toEqual({
        staleBootstrapCalls: 0,
        staleListenerCalls: 0,
      })

      allowG1Metadata.resolve()
      await freshReady
    } finally {
      allowG0Metadata.resolve()
      allowG1Metadata.resolve()
      await stalePreload.catch(() => undefined)
      await freshReady?.catch(() => undefined)
      await collection.cleanup()
    }
  })
})

describe(`persisted key and identifier helpers`, () => {
  it(`encodes and decodes persisted storage keys without collisions`, () => {
    expect(encodePersistedStorageKey(1)).toBe(`n:1`)
    expect(encodePersistedStorageKey(`1`)).toBe(`s:1`)
    expect(decodePersistedStorageKey(`n:1`)).toBe(1)
    expect(decodePersistedStorageKey(`s:1`)).toBe(`1`)
    expect(Object.is(decodePersistedStorageKey(`n:-0`), -0)).toBe(true)
  })

  it(`throws for invalid persisted key values and encodings`, () => {
    expect(() => encodePersistedStorageKey(Number.POSITIVE_INFINITY)).toThrow(
      InvalidPersistedStorageKeyError,
    )
    expect(() => decodePersistedStorageKey(`legacy-key`)).toThrow(
      InvalidPersistedStorageKeyEncodingError,
    )
  })

  it(`creates deterministic safe table names`, () => {
    const first = createPersistedTableName(`todos`)
    const second = createPersistedTableName(`todos`)
    const tombstoneName = createPersistedTableName(`todos`, `t`)

    expect(first).toBe(second)
    expect(first).toMatch(/^c_[a-z2-7]+_[0-9a-z]+$/)
    expect(tombstoneName).toMatch(/^t_[a-z2-7]+_[0-9a-z]+$/)
  })
})

// Probe calibration uses an independently specified lifetime table. These are
// adapter-callback histories, not claims that a shared SQLite scheduler permits
// concurrent hydrates. Deliberately expired loans and public reentry must remain
// observable even when another callback exits; successful calls still forward.
describe(`hydration routing probe calibration`, () => {
  it.each([
    { history: `nested`, exitFirst: 1 },
    { history: `overlap, first exits first`, exitFirst: 0 },
    { history: `overlap, second exits first`, exitFirst: 1 },
  ])(
    `tracks each callback lifetime: $history`,
    async ({ history, exitFirst }) => {
      const adapter = createRecordingAdapter()
      const routing = installHydrationRoutingProbe(adapter)
      const release = [createEventGate(), createEventGate()]
      const loans: Array<PersistenceAdapter> = []
      const first = adapter.runInHydrationScope!(async (loan) => {
        loans[0] = loan
        await release[0]!.promise
      })
      const parent = history === `nested` ? loans[0]! : adapter
      const second = parent.runInHydrationScope!(async (loan) => {
        loans[1] = loan
        await release[1]!.promise
      })
      const scopes = [first, second]
      const tx: PersistedTx = {
        txId: `probe`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [],
      }
      const apply = (target: PersistenceAdapter) =>
        target.applyCommittedTx({ kind: `eager`, collectionId: `probe` }, tx)
      try {
        await apply(loans[0]!)
        await apply(loans[1]!)
        release[exitFirst]!.resolve()
        await scopes[exitFirst]
        await apply(loans[exitFirst]!)
        await apply(loans[1 - exitFirst]!)
        await apply(adapter)
        release[1 - exitFirst]!.resolve()
        await scopes[1 - exitFirst]
        await apply(loans[1 - exitFirst]!)
        await apply(adapter)
        expect(
          routing.calls.map(({ route, live }) => ({ route, live })),
        ).toEqual([
          { route: `scoped`, live: true },
          { route: `scoped`, live: true },
          { route: `scoped`, live: false },
          { route: `scoped`, live: true },
          { route: `public`, live: false },
          { route: `scoped`, live: false },
          { route: `public`, live: true },
        ])
      } finally {
        release.forEach((gate) => gate.resolve())
        await Promise.all(scopes)
      }
    },
  )

  // The explicit adapter is sufficient for this call; only ordinary work needs
  // a registered fallback. Collection construction registers that fallback.
  it(`uses an explicit adapter without registration and rejects missing ordinary routing`, async () => {
    const coordinator = new SingleProcessCoordinator()
    const adapter = createRecordingAdapter()
    const tx: PersistedTx = {
      txId: `explicit`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [],
    }
    await expect(
      coordinator.requestApplyCommittedTx(`explicit`, tx, adapter),
    ).resolves.toBeDefined()
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    await expect(
      coordinator.requestApplyCommittedTx(`explicit`, tx),
    ).rejects.toMatchObject({
      name: `InvalidPersistedCollectionConfigError`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    coordinator.setAdapterForCollection(`explicit`, adapter)
    await expect(
      coordinator.requestApplyCommittedTx(`explicit`, tx),
    ).resolves.toBeDefined()
    expect(adapter.applyCommittedTxCalls).toHaveLength(2)
  })

  // The adapter contract requires call-local forwarding through wrappers. This
  // positive/hostile pair reaches the real coordinator but lets the recorder
  // finish bad calls, so losing the loan is a routing assertion, not a timeout.
  it.each([true, false])(
    `detects a wrapper that forwards its loan=%s`,
    async (forward) => {
      const adapter = createRecordingAdapter()
      const routing = installHydrationRoutingProbe(adapter)
      const inner = new SingleProcessCoordinator()
      inner.setAdapterForCollection(`wrapper`, adapter)
      const wrapper: PersistedCollectionCoordinator[`requestApplyCommittedTx`] =
        (id, tx, scoped) =>
          inner.requestApplyCommittedTx(id, tx, forward ? scoped : undefined)
      await adapter.runInHydrationScope!(async (scoped) => {
        await wrapper(
          `wrapper`,
          { txId: `nested`, term: 1, seq: 1, rowVersion: 1, mutations: [] },
          scoped,
        )
      })
      expect(routing.calls.map(({ route, live }) => ({ route, live }))).toEqual(
        [{ route: forward ? `scoped` : `public`, live: forward }],
      )
      expect(routing.violations()).toHaveLength(forward ? 0 : 1)
    },
  )
})
