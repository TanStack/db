// Scenario tests for the per-collection coordinator: wire and acknowledgement
// partitioning, persisted cache generation routing, remote subset lease
// bookkeeping, per-collection adapter routing, SQLite state, sync-ingested
// ownership, and follower settlement across real tabs. Each test pins one
// scenario with hand-written expectations. The laws these scenarios touch are
// owned by per-collection-coordinator-oracle.test.ts, which generates histories
// and compares production with independent models.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
  whenSyncAccepted,
} from '@tanstack/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import {
  ControlledBroadcastChannel,
  DEFAULT_RUNS,
  captureCleanup,
  complexSubsetDemand,
  coordinatorFixtureSnapshot,
  createCoordinator,
  createRealTab,
  createRecordingAdapter,
  disposeCoordinator,
  durableTerms,
  envelopeCollection,
  heldLocks,
  installControlledBrowserSeams,
  liveCoordinators,
  payloadType,
  pumpNetwork,
  queuedLocks,
  readCoordinatorOracleConfig,
  registerCollectionAdapter,
  remoteLeaseGrammarPlan,
  restoreControlledBrowserSeams,
  routingGrammarPlan,
  routingHistoryFromAxes,
  semanticValue,
  storageId,
  subsetSemantics,
  waitFor,
  waitForWithoutDelivery,
  withFailurePreservingCleanup,
  withNativeBrowserTransport,
} from './per-collection-coordinator-support'
import type { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import type {
  PersistedTx,
  PersistenceAdapter,
} from '@tanstack/db-sqlite-persistence-core'
import type { Collection, LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type {
  CleanupDiagnostic,
  RealTabRow,
  RecordingAdapter,
  RemoteLeaseGrammarPlan,
  RemoteLeaseHistory,
  RoutingGrammarPlan,
  RoutingHistory,
  RoutingHistoryAxes,
} from './per-collection-coordinator-support'

// The storage oracle exercises the SQLite generation catalog. This small
// adapter supplies only its public claim/rotation result so the Browser owner
// oracle can judge the separate coordinator boundary with two live sync runs.
function createGenerationRecordingAdapter(
  id: string,
  claimExpired: () => boolean = () => false,
): RecordingAdapter & { currentStorageId: () => string } {
  const adapter = createRecordingAdapter({ id })
  let currentStorageId = `cache-generation-0`
  let nextGeneration = 1
  let nextClaim = 0
  const claims = new Map<string, string>()
  adapter.claimCacheGeneration = () => {
    const claimId = `${id}-claim-${++nextClaim}`
    claims.set(claimId, currentStorageId)
    return Promise.resolve({ storageCollectionId: currentStorageId, claimId })
  }
  adapter.rotateCacheGeneration = (_collectionId, claimId) => {
    if (claims.get(claimId) !== currentStorageId && !claimExpired()) {
      return Promise.reject(new Error(`recovery lost its cache claim`))
    }
    const storageCollectionId = `cache-generation-${nextGeneration++}`
    if (!claimExpired()) currentStorageId = storageCollectionId
    claims.set(claimId, storageCollectionId)
    return Promise.resolve({ storageCollectionId, claimId })
  }
  adapter.renewCacheGenerationClaim = (storageCollectionId, claimId) =>
    Promise.resolve(
      !claimExpired() && claims.get(claimId) === storageCollectionId
        ? Date.now() + 10_000
        : undefined,
    )
  adapter.releaseCacheGenerationClaim = (claimId) => {
    claims.delete(claimId)
    return Promise.resolve()
  }
  return Object.assign(adapter, { currentStorageId: () => currentStorageId })
}

beforeEach(() => {
  durableTerms.clear()
  installControlledBrowserSeams()
})

afterEach(async () => {
  const cleanupDiagnostics: Array<CleanupDiagnostic> = []
  for (const coordinator of liveCoordinators) {
    await captureCleanup(cleanupDiagnostics, `afterEach live coordinator`, () =>
      coordinator.dispose(),
    )
  }
  liveCoordinators.clear()
  await captureCleanup(
    cleanupDiagnostics,
    `afterEach lock release`,
    async () => {
      await waitForWithoutDelivery(
        () => heldLocks.size === 0 && queuedLocks.size === 0,
        `afterEach lock release`,
      )
    },
  )
  const cleanupSnapshot = coordinatorFixtureSnapshot()
  expect.soft(cleanupSnapshot).toEqual({
    delayed: 0,
    endpoints: 0,
    heldLocks: 0,
    queuedLocks: 0,
  })
  await captureCleanup(
    cleanupDiagnostics,
    `global browser descriptors`,
    restoreControlledBrowserSeams,
  )
  await captureCleanup(cleanupDiagnostics, `vitest timers and mocks`, () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  ControlledBroadcastChannel.reset()
  heldLocks.clear()
  queuedLocks.clear()
  expect.soft(cleanupDiagnostics).toEqual([])
})

describe(`per-collection coordinator wire and acknowledgement oracle`, () => {
  it(`round-trips supported subset semantics across the emitted message partition`, async () => {
    const leaderAdapter = createRecordingAdapter({
      id: `partition-leader`,
      remoteSubsetOwner: () => Promise.resolve(),
    })
    const followerAdapter = createRecordingAdapter({ id: `partition-follower` })
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      leader = createCoordinator(`wire-partition`, leaderAdapter)
      follower = createCoordinator(`wire-partition`, followerAdapter)
      registerCollectionAdapter(leader, `alpha`, leaderAdapter)
      registerCollectionAdapter(follower, `alpha`, followerAdapter)
      leader.subscribe(`alpha`, () => {})
      follower.subscribe(`alpha`, () => {})
      await waitFor(
        () => leader!.isLeader(`alpha`) && !follower!.isLeader(`alpha`),
        `wire partition leader/follower topology`,
      )

      const demand = complexSubsetDemand(false)
      const subsetRequest = follower.requestEnsureRemoteSubset(`alpha`, demand)
      const queuedSubset = ControlledBroadcastChannel.delayed.find(
        ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:req`,
      )?.data as { payload?: { options?: LoadSubsetOptions } } | undefined
      expect(subsetSemantics(queuedSubset?.payload?.options ?? {})).toEqual(
        subsetSemantics(demand),
      )
      await pumpNetwork()
      await subsetRequest

      const mutationValue = {
        id: `native-values`,
        at: new Date(`2026-09-16T12:34:56.000Z`),
        bytes: new Uint8Array([0, 127, 255]),
      }
      const mutationRequest = follower.requestApplyLocalMutations(`alpha`, [
        {
          mutationId: `native-values`,
          type: `insert`,
          key: `native-values`,
          value: mutationValue,
        },
      ])
      const queuedMutation = ControlledBroadcastChannel.delayed.find(
        ({ data }) => payloadType(data) === `rpc:applyLocalMutations:req`,
      )?.data as
        | {
            payload?: {
              mutations?: Array<{ value?: unknown }>
            }
          }
        | undefined
      expect(
        semanticValue(queuedMutation?.payload?.mutations?.[0]?.value),
      ).toEqual(semanticValue(mutationValue))
      await pumpNetwork()
      await mutationRequest

      const committedTx: PersistedTx = {
        txId: `committed-native-values`,
        term: 0,
        seq: 0,
        rowVersion: 0,
        mutations: [
          {
            type: `update`,
            key: `native-values`,
            value: mutationValue,
          },
        ],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `native-values`,
            value: { source: `wire-partition` },
          },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `resume`, value: { offset: 4 } },
        ],
      }
      const committedRequest = follower.requestApplyCommittedTx(
        `alpha`,
        committedTx,
      )
      const queuedCommitted = ControlledBroadcastChannel.delayed.find(
        ({ data }) => payloadType(data) === `rpc:applyCommittedTx:req`,
      )?.data as { payload?: { tx?: PersistedTx } } | undefined
      expect(semanticValue(queuedCommitted?.payload?.tx)).toEqual(
        semanticValue(committedTx),
      )
      await pumpNetwork()
      const committedResponse = await committedRequest
      expect(committedResponse).toEqual({
        type: `rpc:applyCommittedTx:res`,
        rpcId: expect.any(String),
        ok: true,
        term: 1,
        seq: 2,
        latestRowVersion: 2,
      })

      const successfulPayloads = ControlledBroadcastChannel.cloneAttempts
        .filter(({ errorName }) => errorName === undefined)
        .map(({ data }) =>
          data && typeof data === `object` && `payload` in data
            ? (data as { payload?: unknown }).payload
            : undefined,
        )
      const matchingCommittedResponses = successfulPayloads.filter(
        (payload) =>
          payload !== undefined &&
          payload !== null &&
          typeof payload === `object` &&
          `type` in payload &&
          payload.type === `rpc:applyCommittedTx:res` &&
          `rpcId` in payload &&
          payload.rpcId === committedResponse.rpcId,
      )
      const matchingCommittedEvents = successfulPayloads.filter(
        (payload) =>
          payload !== undefined &&
          payload !== null &&
          typeof payload === `object` &&
          `type` in payload &&
          payload.type === `tx:committed` &&
          `txId` in payload &&
          payload.txId === committedTx.txId,
      )
      expect(matchingCommittedResponses).toEqual([committedResponse])
      expect(matchingCommittedEvents).toEqual([
        {
          type: `tx:committed`,
          term: 1,
          seq: 2,
          txId: `committed-native-values`,
          latestRowVersion: 2,
          requiresFullReload: false,
          changedRows: [{ key: `native-values`, value: mutationValue }],
          deletedKeys: [],
          rowMetadataMutations: [
            {
              type: `set`,
              key: `native-values`,
              value: { source: `wire-partition` },
            },
          ],
          collectionMetadataMutations: [
            { type: `set`, key: `resume`, value: { offset: 4 } },
          ],
        },
      ])

      const indexRequest = follower.requestEnsurePersistedIndex(
        `alpha`,
        `score-index`,
        { expressionSql: [`score`] },
      )
      await pumpNetwork()
      await indexRequest
      const pullRequest = follower.pullSince(`alpha`, 0)
      await pumpNetwork()
      await pullRequest

      const successfulTypes = new Set(
        ControlledBroadcastChannel.cloneAttempts
          .filter(({ errorName }) => errorName === undefined)
          .map(({ data }) => payloadType(data))
          .filter((type): type is string => type !== undefined),
      )
      expect(successfulTypes).toEqual(
        new Set([
          `leader:heartbeat`,
          `rpc:ensureRemoteSubset:req`,
          `rpc:ensureRemoteSubset:res`,
          `rpc:applyLocalMutations:req`,
          `rpc:applyLocalMutations:res`,
          `rpc:applyCommittedTx:req`,
          `rpc:applyCommittedTx:res`,
          `tx:committed`,
          `rpc:ensurePersistedIndex:req`,
          `rpc:ensurePersistedIndex:res`,
          `rpc:pullSince:req`,
          `rpc:pullSince:res`,
        ]),
      )
    }, [
      [
        `wire partition leader`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `wire partition follower`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
    ])
  })
})

describe(`persisted cache generation routing oracle`, () => {
  // A cache generation is a routing boundary, while the public Collection ID
  // remains the same. The independent model has two run-local source owners:
  // after the second run loses its resume authority, its demand belongs to
  // its new generation; the warm run retains its old source row and owner.
  // The legal history is warm start, source commit, second start, scoped
  // recovery, then one retained demand and one new demand. Real persisted
  // wrappers and Browser coordinators drive that history. At each demand
  // settlement, compare source-call counts, old acquisition release, and the
  // warm public row. The controlled browser seam
  // does not establish native multi-tab or OPFS behavior; the SQLite owner
  // separately proves durable generation separation.
  it(`routes a recovering run's demand to its own source while a warm run keeps its row`, async () => {
    type Row = { id: string; title: string }
    const collectionId = `shared-public-collection`
    const adapter = createGenerationRecordingAdapter(`shared-cache`)
    const warmCoordinator = createCoordinator(`generation-routing`, adapter)
    const recoveringCoordinator = createCoordinator(
      `generation-routing`,
      adapter,
    )
    let warmSource!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    let recoveringSource!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    let warmStarted = false
    let recoveringStarted = false
    let warmLoads = 0
    let warmUnloads = 0
    let recoveringLoads = 0
    let recoveringRefetches = 0
    let releaseWarmLoad!: () => void
    const warmLoadGate = new Promise<void>((resolve) => {
      releaseWarmLoad = resolve
    })
    let warmCollection: Collection<Row, string> | undefined
    let recoveringCollection: Collection<Row, string> | undefined
    const cleanupCollection = async (
      collection: Collection<Row, string> | undefined,
      checkpoint: string,
    ) => {
      if (!collection) return
      let settled = false
      const cleanup = collection.cleanup().finally(() => {
        settled = true
      })
      await waitFor(() => settled, checkpoint)
      await cleanup
    }

    await withFailurePreservingCleanup(async () => {
      warmCollection = createCollection(
        persistedCollectionOptions<Row, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              warmSource = params
              warmStarted = true
              params.markReady()
              return {
                loadSubset: () => {
                  warmLoads++
                  return warmLoadGate
                },
                unloadSubset: () => {
                  warmUnloads++
                  releaseWarmLoad()
                },
              }
            },
          },
          persistence: { adapter, coordinator: warmCoordinator },
        }),
      )
      warmCollection.startSyncImmediate()
      await waitFor(() => warmStarted, `warm source start`)
      const warmRow = { id: `warm`, title: `Source-backed row` }
      warmSource.begin()
      warmSource.write({ type: `insert`, value: warmRow })
      let warmCommitted = false
      const warmCommit = Promise.resolve(
        whenSyncAccepted(warmSource.commit()),
      ).then(() => {
        warmCommitted = true
      })
      await waitFor(() => warmCommitted, `warm source commit`)
      await warmCommit

      recoveringCollection = createCollection(
        persistedCollectionOptions<Row, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              recoveringSource = params
              recoveringStarted = true
              params.markReady()
              return {
                // This controlled source has no delayed provider callback.
                restartAfterScopedRecovery: () => {},
                loadSubset: (options) => {
                  recoveringLoads++
                  if (options.refetch) recoveringRefetches++
                  return Promise.resolve()
                },
              }
            },
          },
          persistence: { adapter, coordinator: recoveringCoordinator },
        }),
      )
      recoveringCollection.startSyncImmediate()
      await waitFor(() => recoveringStarted, `recovering source`)
      const retainedDemand = { limit: 1 }
      let firstSettled = false
      const firstLoad = Promise.resolve(
        recoveringCollection._sync.loadSubset(retainedDemand),
      ).then(() => {
        firstSettled = true
      })
      await waitFor(() => warmLoads === 1, `held pre-recovery demand`)
      expect(firstSettled).toBe(false)
      expect({ warmLoads, recoveringLoads }).toEqual({
        warmLoads: 1,
        recoveringLoads: 0,
      })

      let recoverySettled = false
      const oldStorageId = adapter.currentStorageId()
      const recovery = recoveringSource.metadata!.persistence!
        .startScopedRecovery!().then(() => {
        recoverySettled = true
      })
      // Hold the old leader's release acknowledgement while delivering every
      // other message. The new cache has its own route, so its source demand
      // must start before that old leader resumes.
      const isOldRelease = (data: unknown) =>
        payloadType(data) === `rpc:releaseRemoteSubset:req` &&
        envelopeCollection(data) === oldStorageId
      let heldOldRelease = false
      for (let pass = 0; pass < 100; pass++) {
        heldOldRelease ||= ControlledBroadcastChannel.delayed.some((delivery) =>
          isOldRelease(delivery.data),
        )
        while (
          ControlledBroadcastChannel.deliverWhere((data) => !isOldRelease(data))
        ) {
          await Promise.resolve()
        }
        if (heldOldRelease && recoveringLoads > 0) break
        await nextTurn()
      }
      const loadsBeforeOldRelease = recoveringLoads
      ControlledBroadcastChannel.deliverWhere(isOldRelease)
      await pumpNetwork()
      expect(heldOldRelease).toBe(true)
      expect(loadsBeforeOldRelease).toBe(1)
      await waitFor(() => recoverySettled, `scoped recovery with active demand`)
      await recovery
      await firstLoad
      await waitFor(
        () => recoveringLoads === 1,
        `retained demand reacquisition`,
      )
      expect(recoveringRefetches).toBe(1)
      expect(warmUnloads).toBe(1)

      // The checkpoint is the settled physical acquisition. A wrong design
      // using the public ID for both runs sends this request to the warm
      // leader; a generation-qualified route sends it to the new owner.
      let settled = false
      const load = Promise.resolve(
        recoveringCollection._sync.loadSubset({ limit: 2 }),
      ).then(() => {
        settled = true
      })
      await waitFor(() => settled, `recovering demand settlement`)
      await load
      expect({ warmLoads, recoveringLoads }).toEqual({
        warmLoads: 1,
        recoveringLoads: 2,
      })
      expect(warmCollection.get(`warm`)).toMatchObject(warmRow)

      // A later committed-cache notification in the new generation cannot
      // reload from its uncertified SQLite rows. The active demand gets a
      // fresh source snapshot over the real Browser coordinator wire.
      const storageId = adapter.currentStorageId()
      warmCoordinator.publish(storageId, {
        v: 1,
        dbName: `generation-routing`,
        collectionId: storageId,
        senderId: warmCoordinator.getNodeId(),
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `peer-new-generation-change`,
          latestRowVersion: 1,
          requiresFullReload: true,
        },
      })
      await waitFor(() => recoveringLoads > 2, `new-generation source refresh`)
      expect(recoveringRefetches).toBeGreaterThan(0)
      expect(warmLoads).toBe(1)
      expect(warmCollection.get(`warm`)).toMatchObject(warmRow)
    }, [
      [`held warm source`, () => Promise.resolve(releaseWarmLoad())],
      [
        `recovering Collection`,
        () => cleanupCollection(recoveringCollection, `recovering cleanup`),
      ],
      [
        `warm Collection`,
        () => cleanupCollection(warmCollection, `warm cleanup`),
      ],
      [
        `recovering coordinator`,
        () => disposeCoordinator(recoveringCoordinator),
      ],
      [`warm coordinator`, () => disposeCoordinator(warmCoordinator)],
    ])
  })

  // A paused follower may receive a coordinator commit before its renewal
  // timer runs. Its expired claim cannot authorize that message to reload
  // cached rows. The independent history expires one claim, delivers a peer
  // notification, then keeps the demand: the old source row disappears and
  // the demand obtains a fresh source snapshot in another cache generation.
  it(`recovers an expired follower claim before applying a peer notification`, async () => {
    type Row = { id: string; title: string }
    let expired = false
    const adapter = createGenerationRecordingAdapter(
      `expired-receiver`,
      () => expired,
    )
    const originalClaim = adapter.claimCacheGeneration!
    const originalRotate = adapter.rotateCacheGeneration!
    adapter.claimCacheGeneration = async (collectionId) => ({
      ...(await originalClaim(collectionId)),
      expiresAtMs: Date.now() + 10_000,
    })
    adapter.renewCacheGenerationClaim = async () =>
      expired ? undefined : Date.now() + 10_000
    adapter.rotateCacheGeneration = async (...args) => {
      const claim = await originalRotate(...args)
      expired = false
      return { ...claim, expiresAtMs: Date.now() + 10_000 }
    }
    const receiver = createCoordinator(`expired-receiver`, adapter)
    const peer = createCoordinator(`expired-receiver`, adapter)
    let source!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    const loads: Array<boolean | undefined> = []
    let collection: Collection<Row, string> | undefined
    await withFailurePreservingCleanup(async () => {
      collection = createCollection(
        persistedCollectionOptions<Row, string>({
          id: `expired-public-collection`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async (options) => {
                  loads.push(options.refetch)
                  if (options.refetch) {
                    source.begin()
                    source.write({
                      type: `insert`,
                      value: { id: `fresh`, title: `New source` },
                    })
                    await whenSyncAccepted(source.commit())
                  }
                },
              }
            },
          },
          persistence: { adapter, coordinator: receiver },
        }),
      )
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `old`, title: `Old source` },
      })
      await whenSyncAccepted(source.commit())
      await collection._sync.loadSubset({ limit: 1 })
      expect(collection.get(`old`)).toMatchObject({ id: `old` })
      expect(loads).toEqual([undefined])

      const oldStorageId = adapter.currentStorageId()
      expired = true
      peer.publish(oldStorageId, {
        v: 1,
        dbName: `expired-receiver`,
        collectionId: oldStorageId,
        senderId: peer.getNodeId(),
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: 2,
          txId: `peer-change-after-pause`,
          latestRowVersion: 2,
          requiresFullReload: true,
        },
      })
      // Deliver the queued message at the paused tab's later wall-clock cut,
      // before JavaScript gets an opportunity to run its renewal timer.
      const wallNow = Date.now
      const clock = vi
        .spyOn(Date, `now`)
        .mockImplementation(() => wallNow() + 20_000)
      try {
        expect(
          ControlledBroadcastChannel.deliverWhere(
            (data) =>
              envelopeCollection(data) === oldStorageId &&
              payloadType(data) === `tx:committed` &&
              (data as { payload?: { txId?: string } }).payload?.txId ===
                `peer-change-after-pause`,
          ),
        ).toBe(true)
      } finally {
        clock.mockRestore()
      }
      await waitFor(() => loads.length > 1, `retained demand reload`)
      expect(adapter.currentStorageId()).toBe(oldStorageId)
      expect(loads).toEqual([undefined, true])
      expect(collection.get(`old`)).toBeUndefined()
      expect(collection.get(`fresh`)).toMatchObject({ id: `fresh` })
    }, [
      [`receiver Collection`, () => collection?.cleanup() ?? Promise.resolve()],
      [`receiver coordinator`, () => disposeCoordinator(receiver)],
      [`peer coordinator`, () => disposeCoordinator(peer)],
    ])
  })

  // One host clock defines claim expiry for both SQLite and the receiving
  // runtime. The independent history expires a live claim using the clock
  // supplied through the public Browser factory, then delivers a targeted
  // peer commit. Because the old generation is no longer readable, its
  // notification cannot publish a row. The active demand instead obtains a
  // fresh source snapshot after rotation. Real SQLite and the composed
  // Browser coordinator carry the claim and message at this checkpoint.
  it(`uses the configured host clock before applying a peer notification`, async () => {
    type Row = { id: string; title: string }
    const directory = mkdtempSync(join(tmpdir(), `db-claim-clock-`))
    const database = createWASQLiteTestDatabase({
      filename: join(directory, `claim.sqlite`),
    })
    const receiver = createCoordinator(
      `claim-clock`,
      createRecordingAdapter({ id: `clock-receiver-bootstrap` }),
    )
    const peer = createCoordinator(
      `claim-clock`,
      createRecordingAdapter({ id: `clock-peer` }),
    )
    let hostNow = Date.now() + 86_400_000
    const persistence = createBrowserWASQLitePersistence({
      database,
      coordinator: receiver,
      cacheGenerationClaimTtlMs: 10_000,
      now: () => hostNow,
    })
    let source!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    let collection: Collection<Row, string> | undefined
    const loads: Array<boolean | undefined> = []

    await withFailurePreservingCleanup(async () => {
      collection = createCollection(
        persistedCollectionOptions<Row, string>({
          id: `claim-clock-collection`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async (options) => {
                  loads.push(options.refetch)
                  if (options.refetch) {
                    source.begin()
                    source.write({
                      type: `insert`,
                      value: { id: `fresh`, title: `Fresh source` },
                    })
                    await whenSyncAccepted(source.commit())
                  }
                },
              }
            },
          },
          persistence,
        }),
      )
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `old`, title: `Old source` },
      })
      await whenSyncAccepted(source.commit())
      await collection._sync.loadSubset({})
      expect(collection.get(`old`)).toMatchObject({ title: `Old source` })
      expect(loads).toEqual([undefined])

      const head = await database.execute<{ physical_id: string }>(
        `SELECT physical_id FROM cache_generation
         WHERE logical_id = ? AND retired = 0`,
        [`claim-clock-collection`],
      )
      const oldStorageId = head[0]?.physical_id
      if (!oldStorageId) throw new Error(`missing claimed cache generation`)
      hostNow += 20_000
      peer.publish(oldStorageId, {
        v: 1,
        dbName: `claim-clock`,
        collectionId: oldStorageId,
        senderId: peer.getNodeId(),
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 2,
          seq: 1,
          txId: `peer-change-after-clock-expiry`,
          latestRowVersion: 2,
          requiresFullReload: false,
          changedRows: [
            {
              key: `old`,
              value: { id: `old`, title: `Stale peer notification` },
            },
          ],
          deletedKeys: [],
        },
      })
      expect(
        ControlledBroadcastChannel.deliverWhere(
          (data) =>
            envelopeCollection(data) === oldStorageId &&
            payloadType(data) === `tx:committed` &&
            (data as { payload?: { txId?: string } }).payload?.txId ===
              `peer-change-after-clock-expiry`,
        ),
      ).toBe(true)
      await pumpNetwork()
      for (let pass = 0; pass < 10; pass++) await nextTurn()
      expect(collection.get(`old`)?.title).not.toBe(`Stale peer notification`)
      await waitFor(() => loads.includes(true), `expired-claim source reload`)
      expect(collection.get(`old`)).toBeUndefined()
      expect(collection.get(`fresh`)).toMatchObject({ title: `Fresh source` })
    }, [
      [`receiver Collection`, () => collection?.cleanup() ?? Promise.resolve()],
      [`receiver coordinator`, () => disposeCoordinator(receiver)],
      [`peer coordinator`, () => disposeCoordinator(peer)],
      [`real SQLite database`, () => Promise.resolve(database.close?.())],
      [
        `real SQLite directory`,
        () => rmSync(directory, { recursive: true, force: true }),
      ],
    ])
  })

  // Two sync runs can claim one physical cache generation at different clock
  // cuts. The independent claim rule lets the later warm peer keep that
  // generation when only the earlier run expires. A commit notification sent
  // to the expired run before its renewal timer cannot authorize its old row;
  // its active demand must refetch into private storage. The warm peer keeps
  // its public row, source ownership, and exact SQLite row at the settled cut.
  // This receiver crosses the Browser coordinator wire and real wa-sqlite;
  // the durable peer write is real, but the notice delivery order is controlled
  // rather than native multi-tab scheduling or coordinator emission.
  it(`keeps a warm Browser peer while an expired run reloads after a notification`, async () => {
    type Row = { id: string; title: string }
    const directory = mkdtempSync(join(tmpdir(), `db-warm-peer-claim-`))
    const database = createWASQLiteTestDatabase({
      filename: join(directory, `warm-peer.sqlite`),
    })
    const expiredCoordinator = createCoordinator(
      `warm-peer-claim`,
      createRecordingAdapter({ id: `expired-bootstrap` }),
    )
    const warmCoordinator = createCoordinator(
      `warm-peer-claim`,
      createRecordingAdapter({ id: `warm-bootstrap` }),
    )
    let hostNow = Date.now() + 86_400_000
    const makePersistence = (coordinator: BrowserCollectionCoordinator) =>
      createBrowserWASQLitePersistence({
        database,
        coordinator,
        cacheGenerationClaimTtlMs: 10_000,
        now: () => hostNow,
      })
    const expiredPersistence = makePersistence(expiredCoordinator)
    const warmPersistence = makePersistence(warmCoordinator)
    const logicalId = `warm-peer-claim-collection`
    const expiredAdapter = expiredPersistence.resolvePersistenceForCollection!({
      collectionId: logicalId,
      mode: `sync-present`,
    }).adapter
    const rotate = expiredAdapter.rotateCacheGeneration!.bind(expiredAdapter)
    const rotations: Array<{ storageCollectionId: string; claimId: string }> =
      []
    expiredAdapter.rotateCacheGeneration = async (...args) => {
      const next = await rotate(...args)
      rotations.push(next)
      return next
    }
    const old = { id: `old`, title: `Warm source row` }
    const fresh = { id: `fresh`, title: `Expired run's fresh row` }
    let source!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
    let expiredCollection: Collection<Row, string> | undefined
    let warmCollection: Collection<Row, string> | undefined
    const expiredLoads: Array<boolean | undefined> = []
    let expiredRefetchSettled = false
    const warmLoads: Array<number | undefined> = []

    await withFailurePreservingCleanup(async () => {
      expiredCollection = createCollection(
        persistedCollectionOptions<Row, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async (options) => {
                  expiredLoads.push(options.refetch)
                  if (options.refetch) {
                    source.begin()
                    source.write({ type: `insert`, value: fresh })
                    await whenSyncAccepted(source.commit())
                    expiredRefetchSettled = true
                  }
                },
              }
            },
          },
          persistence: expiredPersistence,
        }),
      )
      expiredCollection.startSyncImmediate()
      await expiredCollection.stateWhenReady()
      source.begin()
      source.write({ type: `insert`, value: old })
      await whenSyncAccepted(source.commit())
      await expiredCollection._sync.loadSubset({ limit: 1 })
      expect(expiredCollection.get(old.id)).toMatchObject(old)

      const headRows = await database.execute<{ physical_id: string }>(
        `SELECT physical_id FROM cache_generation
         WHERE logical_id = ? AND retired = 0`,
        [logicalId],
      )
      const sharedStorageId = headRows[0]?.physical_id
      if (!sharedStorageId) throw new Error(`missing shared cache generation`)
      const firstClaims = await database.execute<{
        claim_id: string
        expires_at_ms: number
      }>(
        `SELECT claim_id, expires_at_ms FROM cache_generation_claim
         WHERE physical_id = ?`,
        [sharedStorageId],
      )
      expect(firstClaims).toHaveLength(1)
      const firstClaim = firstClaims[0]!

      hostNow += 5_000
      warmCollection = createCollection(
        persistedCollectionOptions<Row, string>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              params.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: (options) => {
                  warmLoads.push(options.limit)
                  return Promise.resolve()
                },
              }
            },
          },
          persistence: warmPersistence,
        }),
      )
      warmCollection.startSyncImmediate()
      await warmCollection.stateWhenReady()
      let warmLoadSettled = false
      const warmLoad = Promise.resolve(
        warmCollection._sync.loadSubset({ limit: 1 }),
      ).finally(() => {
        warmLoadSettled = true
      })
      void warmLoad.catch(() => undefined)
      await waitFor(() => warmLoadSettled, `warm peer subset settlement`)
      await warmLoad
      expect(warmCollection.get(old.id)).toMatchObject(old)
      const sharedClaims = await database.execute<{
        claim_id: string
        expires_at_ms: number
      }>(
        `SELECT claim_id, expires_at_ms FROM cache_generation_claim
         WHERE physical_id = ? ORDER BY expires_at_ms`,
        [sharedStorageId],
      )
      expect(sharedClaims).toHaveLength(2)
      expect(sharedClaims[0]).toEqual(firstClaim)
      const warmClaim = sharedClaims[1]!
      expect(warmClaim.claim_id).not.toBe(firstClaim.claim_id)
      expect(warmClaim.expires_at_ms).toBeGreaterThan(firstClaim.expires_at_ms)

      // The controlled notice below describes a committed SQLite transaction.
      // Read its position, apply the peer write under the warm claim, then use
      // those exact values in the delivered envelope.
      const warmAdapter = warmPersistence.resolvePersistenceForCollection!({
        collectionId: logicalId,
        mode: `sync-present`,
      }).adapter
      const beforePeerWrite = await warmAdapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: sharedStorageId,
          claimId: warmClaim.claim_id,
        },
        { cacheGenerationClaimId: warmClaim.claim_id },
      )
      const peerTerm = beforePeerWrite.latestTerm
      const peerSeq = beforePeerWrite.latestSeq + 1
      const peerRowVersion = beforePeerWrite.latestRowVersion + 1
      const peerTxId = `notice-after-one-claim-expires`
      await warmAdapter.applyCommittedTx(
        {
          kind: `managed`,
          storageCollectionId: sharedStorageId,
          claimId: warmClaim.claim_id,
        },
        {
          txId: peerTxId,
          term: peerTerm,
          seq: peerSeq,
          rowVersion: peerRowVersion,
          cacheGenerationClaimId: warmClaim.claim_id,
          mutations: [{ type: `update`, key: old.id, value: old }],
        },
      )
      const afterPeerWrite = await warmAdapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: sharedStorageId,
          claimId: warmClaim.claim_id,
        },
        { cacheGenerationClaimId: warmClaim.claim_id },
      )
      expect(afterPeerWrite.latestRowVersion).toBe(peerRowVersion)
      expect(afterPeerWrite.rows.map(({ value }) => value)).toEqual([old])

      hostNow += 5_001
      warmCoordinator.publish(sharedStorageId, {
        v: 1,
        dbName: `warm-peer-claim`,
        collectionId: sharedStorageId,
        senderId: warmCoordinator.getNodeId(),
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: peerTerm,
          seq: peerSeq,
          txId: peerTxId,
          latestRowVersion: peerRowVersion,
          requiresFullReload: false,
          changedRows: [{ key: old.id, value: old }],
          deletedKeys: [],
        },
      })
      expect(
        ControlledBroadcastChannel.deliverWhere(
          (data) =>
            envelopeCollection(data) === sharedStorageId &&
            payloadType(data) === `tx:committed` &&
            (data as { payload?: { txId?: string } }).payload?.txId ===
              peerTxId,
        ),
      ).toBe(true)
      await waitFor(
        () => expiredLoads.includes(true) && expiredRefetchSettled,
        `expired run's settled source refetch`,
      )
      await waitFor(
        () => expiredCollection?.get(fresh.id)?.title === fresh.title,
        `fresh public row after source refetch`,
      )
      expect(expiredCollection.get(old.id)).toBeUndefined()
      expect(expiredCollection.get(fresh.id)).toMatchObject(fresh)
      expect(warmCollection.get(old.id)).toMatchObject(old)
      expect(warmCollection.get(fresh.id)).toBeUndefined()
      const warmLoadsBeforeNextDemand = warmLoads.length
      const expiredLoadsBeforeWarmDemand = [...expiredLoads]
      await warmCollection._sync.loadSubset({ limit: 2 })
      expect(warmLoads.slice(warmLoadsBeforeNextDemand)).toEqual([2])
      expect(expiredLoads).toEqual(expiredLoadsBeforeWarmDemand)
      expect(rotations).toHaveLength(1)
      const privateClaim = rotations[0]!
      expect(privateClaim.storageCollectionId).not.toBe(sharedStorageId)

      const currentHead = await database.execute<{ physical_id: string }>(
        `SELECT physical_id FROM cache_generation
         WHERE logical_id = ? AND retired = 0`,
        [logicalId],
      )
      expect(currentHead).toEqual([{ physical_id: sharedStorageId }])
      const warmClaims = await database.execute<{ claim_id: string }>(
        `SELECT claim_id FROM cache_generation_claim
         WHERE physical_id = ? AND expires_at_ms > ?`,
        [sharedStorageId, hostNow],
      )
      expect(warmClaims).toEqual([{ claim_id: warmClaim.claim_id }])
      const durable = await warmAdapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: sharedStorageId,
          claimId: warmClaim.claim_id,
        },
        {
          cacheGenerationClaimId: warmClaim.claim_id,
        },
      )
      expect(durable.rows.map(({ value }) => value)).toEqual([old])
      const privateRows = await expiredAdapter.loadResumeSnapshot(
        {
          kind: `managed`,
          storageCollectionId: privateClaim.storageCollectionId,
          claimId: privateClaim.claimId,
        },
        { cacheGenerationClaimId: privateClaim.claimId },
      )
      expect(privateRows.rows.map(({ value }) => value)).toEqual([fresh])
    }, [
      [
        `expired Collection`,
        () => expiredCollection?.cleanup() ?? Promise.resolve(),
      ],
      [`warm Collection`, () => warmCollection?.cleanup() ?? Promise.resolve()],
      [`expired coordinator`, () => disposeCoordinator(expiredCoordinator)],
      [`warm coordinator`, () => disposeCoordinator(warmCoordinator)],
      [`real SQLite database`, () => Promise.resolve(database.close?.())],
      [
        `real SQLite directory`,
        () => rmSync(directory, { recursive: true, force: true }),
      ],
    ])
  })
})

describe(`remote subset ownership lease oracle`, () => {
  it(`reconstructs the remote-lease grammar and ablates every declared axis`, () => {
    const witness: RemoteLeaseHistory = {
      siblingCount: 3,
      releasePrefix: 1,
      identical: false,
      duplicateRelease: true,
      reverseFinalRelease: true,
    }
    const reconstructed = remoteLeaseGrammarPlan(witness)
    expect(reconstructed).toEqual({
      demands: [
        { limit: 1, offset: 0 },
        { limit: 1, offset: 1 },
        { limit: 1, offset: 2 },
      ],
      releaseCount: 1,
      prefixReleaseIndexes: [0],
      finalReleaseIndexes: [2, 1],
      releasePasses: 2,
    })

    const ablations: Array<{
      axis: keyof RemoteLeaseHistory
      history: RemoteLeaseHistory
      observe: (plan: RemoteLeaseGrammarPlan) => unknown
    }> = [
      {
        axis: `siblingCount`,
        history: { ...witness, siblingCount: 1 },
        observe: ({ demands }) => demands.length,
      },
      {
        axis: `releasePrefix`,
        history: { ...witness, releasePrefix: 0 },
        observe: ({ prefixReleaseIndexes }) => prefixReleaseIndexes,
      },
      {
        axis: `identical`,
        history: { ...witness, identical: true },
        observe: ({ demands }) => demands,
      },
      {
        axis: `duplicateRelease`,
        history: { ...witness, duplicateRelease: false },
        observe: ({ releasePasses }) => releasePasses,
      },
      {
        axis: `reverseFinalRelease`,
        history: { ...witness, reverseFinalRelease: false },
        observe: ({ finalReleaseIndexes }) => finalReleaseIndexes,
      },
    ]
    expect(ablations.map(({ axis }) => axis).sort()).toEqual(
      (Object.keys(witness) as Array<keyof RemoteLeaseHistory>).sort(),
    )
    for (const { history, observe } of ablations) {
      expect(observe(remoteLeaseGrammarPlan(history))).not.toEqual(
        observe(reconstructed),
      )
    }
  })
})

describe(`per-collection adapter and SQLite-state oracle`, () => {
  // The coordinator constructs a transaction for local mutations. A managed
  // Collection's claim must survive that construction and the Browser route.
  // The real SQLite row is the receiving observation: an eager target with a
  // physical cache ID is rejected, even if a recording adapter accepts it.
  it(`persists a managed local mutation through its claimed Browser route`, async () => {
    const directory = mkdtempSync(join(tmpdir(), `db-managed-local-route-`))
    const database = createWASQLiteTestDatabase({
      filename: join(directory, `local.sqlite`),
    })
    const coordinator = createCoordinator(
      `managed-local-route`,
      createRecordingAdapter({ id: `bootstrap` }),
    )
    const logicalId = `managed-local-route-collection`
    const persistence = createBrowserWASQLitePersistence({
      database,
      coordinator,
    })
    const adapter = persistence.resolvePersistenceForCollection!({
      collectionId: logicalId,
      mode: `sync-present`,
    }).adapter
    let claim:
      | Awaited<ReturnType<NonNullable<typeof adapter.claimCacheGeneration>>>
      | undefined
    let replacement:
      | Awaited<ReturnType<NonNullable<typeof adapter.rotateCacheGeneration>>>
      | undefined
    await withFailurePreservingCleanup(async () => {
      claim = await adapter.claimCacheGeneration!(logicalId)
      coordinator.setAdapterForCollection(
        claim.storageCollectionId,
        adapter,
        claim.claimId,
      )
      coordinator.subscribe(claim.storageCollectionId, () => {})
      await waitFor(
        () => coordinator.isLeader(claim!.storageCollectionId),
        `claimed local-mutation route`,
      )
      const result = await coordinator.requestApplyLocalMutations(
        claim.storageCollectionId,
        [
          {
            mutationId: `managed-local-row`,
            type: `insert`,
            key: `row`,
            value: { id: `row` },
          },
        ],
        claim.claimId,
      )
      expect(result.ok).toBe(true)
      const snapshot = await adapter.loadResumeSnapshot({
        kind: `managed`,
        storageCollectionId: claim.storageCollectionId,
        claimId: claim.claimId,
      })
      expect(snapshot.rows).toMatchObject([
        { key: `row`, value: { id: `row` } },
      ])
      const oldRegistry = await database.execute<{ table_name: string }>(
        `SELECT table_name FROM collection_registry WHERE collection_id = ?`,
        [claim.storageCollectionId],
      )
      expect(oldRegistry).toHaveLength(1)
      const oldTable = oldRegistry[0]?.table_name
      if (!oldTable) throw new Error(`missing managed row table`)
      replacement = await adapter.rotateCacheGeneration!(
        logicalId,
        claim.claimId,
      )
      await expect(
        coordinator.requestApplyLocalMutations(
          claim.storageCollectionId,
          [
            {
              mutationId: `late-managed-local-row`,
              type: `insert`,
              key: `late`,
              value: { id: `late` },
            },
          ],
          claim.claimId,
        ),
      ).rejects.toThrow(`Persisted cache claim`)
      expect(
        await database.execute(
          `SELECT name FROM sqlite_master WHERE name = ?`,
          [oldTable],
        ),
      ).toEqual([])
      expect(
        await database.execute(
          `SELECT collection_id FROM collection_registry WHERE collection_id = ?`,
          [claim.storageCollectionId],
        ),
      ).toEqual([])
    }, [
      [
        `replacement claim`,
        async () => {
          if (replacement) {
            await adapter.releaseCacheGenerationClaim?.(replacement.claimId)
          }
        },
      ],
      [
        `claim`,
        async () => {
          if (claim) await adapter.releaseCacheGenerationClaim?.(claim.claimId)
        },
      ],
      [`coordinator`, () => disposeCoordinator(coordinator)],
      [`database`, () => Promise.resolve(database.close?.())],
      [`directory`, () => rmSync(directory, { recursive: true, force: true })],
    ])
  })

  // A host factory promises the same configured claim lifetime as its core
  // adapter. The supplied clock makes the claim's expiry exact; this catches
  // options accepted by the public type but dropped before adapter creation.
  it(`forwards the configured cache claim lifetime to its SQLite adapter`, async () => {
    const directory = mkdtempSync(join(tmpdir(), `db-claim-options-`))
    const database = createWASQLiteTestDatabase({
      filename: join(directory, `claim.sqlite`),
    })
    try {
      const persistence = createBrowserWASQLitePersistence({
        database,
        cacheGenerationClaimTtlMs: 1_234,
        now: () => 5_000,
      })
      const resolve = persistence.resolvePersistenceForCollection
      if (!resolve) throw new Error(`missing per-collection resolver`)
      const adapter = resolve({
        collectionId: `claim-options`,
        mode: `sync-present`,
      }).adapter
      const claim = await adapter.claimCacheGeneration!(`claim-options`)
      expect(claim.expiresAtMs).toBe(6_234)
      await adapter.releaseCacheGenerationClaim!(claim.claimId)
    } finally {
      await Promise.resolve(database.close?.())
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe(`generated collection-route histories`, () => {
  it(`requires a complete property, seed, and shrink path for replay`, () => {
    expect(readCoordinatorOracleConfig({})).toEqual({ runs: DEFAULT_RUNS })
    for (const environment of [
      { TANSTACK_DB_COORDINATOR_ORACLE_SEED: `123` },
      { TANSTACK_DB_COORDINATOR_ORACLE_PATH: `0:1` },
      { TANSTACK_DB_COORDINATOR_ORACLE_PROPERTY: `routing` },
      {
        TANSTACK_DB_COORDINATOR_ORACLE_SEED: `123`,
        TANSTACK_DB_COORDINATOR_ORACLE_PATH: `0:1`,
      },
    ]) {
      expect(() => readCoordinatorOracleConfig(environment)).toThrow(
        /requires SEED, PATH, and PROPERTY together/,
      )
    }
    expect(() =>
      readCoordinatorOracleConfig({
        TANSTACK_DB_COORDINATOR_ORACLE_SEED: `123`,
        TANSTACK_DB_COORDINATOR_ORACLE_PATH: `not-a-path`,
        TANSTACK_DB_COORDINATOR_ORACLE_PROPERTY: `routing`,
      }),
    ).toThrow(/numeric shrink path/)
    expect(() =>
      readCoordinatorOracleConfig({
        TANSTACK_DB_COORDINATOR_ORACLE_SEED: `123`,
        TANSTACK_DB_COORDINATOR_ORACLE_PATH: `0:1`,
        TANSTACK_DB_COORDINATOR_ORACLE_PROPERTY: `unknown`,
      }),
    ).toThrow(/remote-lease or routing/)
    expect(
      readCoordinatorOracleConfig({
        TANSTACK_DB_COORDINATOR_ORACLE_RUNS: `7`,
        TANSTACK_DB_COORDINATOR_ORACLE_SEED: `123`,
        TANSTACK_DB_COORDINATOR_ORACLE_PATH: `0:1`,
        TANSTACK_DB_COORDINATOR_ORACLE_PROPERTY: `routing`,
      }),
    ).toEqual({
      runs: 7,
      replay: { property: `routing`, seed: 123, path: `0:1` },
    })
  })

  it(`reconstructs the routing grammar and ablates every declared axis`, () => {
    const witnessAxes: RoutingHistoryAxes = {
      alphaVersion: 11,
      versionDelta: 18,
      registrationOrder: [`beta`, `alpha`],
      firstDeliveryOrder: [`alpha`, `beta`],
      secondDeliveryOrder: [`beta`, `alpha`],
    }
    const witness = routingHistoryFromAxes(witnessAxes)
    expect(witness).toEqual({
      alphaVersion: 11,
      betaVersion: 29,
      registrationOrder: [`beta`, `alpha`],
      firstDeliveryOrder: [`alpha`, `beta`],
      secondDeliveryOrder: [`beta`, `alpha`],
    })
    const reconstructed = routingGrammarPlan(witness)
    expect(reconstructed).toEqual({
      initialCollection: `beta`,
      registrationOrder: [`beta`, `alpha`],
      firstDeliveryOrder: [`alpha`, `beta`],
      secondDeliveryOrder: [`beta`, `alpha`],
      adapterIds: {
        leader: {
          alpha: `leader-alpha-v11-reset`,
          beta: `leader-beta-v29-error`,
        },
        follower: {
          alpha: `follower-alpha-v11-reset`,
          beta: `follower-beta-v29-error`,
        },
      },
    })

    const ablations: Array<{
      axis: keyof RoutingHistoryAxes
      history: RoutingHistory
      observe: (plan: RoutingGrammarPlan) => unknown
    }> = [
      {
        axis: `alphaVersion`,
        history: routingHistoryFromAxes({
          ...witnessAxes,
          alphaVersion: 12,
        }),
        observe: ({ adapterIds }) => adapterIds.leader.alpha,
      },
      {
        axis: `versionDelta`,
        history: routingHistoryFromAxes({
          ...witnessAxes,
          versionDelta: 19,
        }),
        observe: ({ adapterIds }) => adapterIds.leader.beta,
      },
      {
        axis: `registrationOrder`,
        history: routingHistoryFromAxes({
          ...witnessAxes,
          registrationOrder: [`alpha`, `beta`],
        }),
        observe: ({ initialCollection, registrationOrder }) => ({
          initialCollection,
          registrationOrder,
        }),
      },
      {
        axis: `firstDeliveryOrder`,
        history: routingHistoryFromAxes({
          ...witnessAxes,
          firstDeliveryOrder: [`beta`, `alpha`],
        }),
        observe: ({ firstDeliveryOrder }) => firstDeliveryOrder,
      },
      {
        axis: `secondDeliveryOrder`,
        history: routingHistoryFromAxes({
          ...witnessAxes,
          secondDeliveryOrder: [`alpha`, `beta`],
        }),
        observe: ({ secondDeliveryOrder }) => secondDeliveryOrder,
      },
    ]
    expect(ablations.map(({ axis }) => axis).sort()).toEqual(
      (Object.keys(witnessAxes) as Array<keyof RoutingHistoryAxes>).sort(),
    )
    for (const { history, observe } of ablations) {
      expect(observe(routingGrammarPlan(history))).not.toEqual(
        observe(reconstructed),
      )
    }
  })
})

describe(`sync-ingested write ownership oracle`, () => {
  it(`routes a rich source commit through the new elected Browser owner`, async () => {
    type Todo = { id: string; title: string }
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]
    type TxAdapter = PersistenceAdapter & { applied: Array<PersistedTx> }

    const createTxAdapter = (): TxAdapter => {
      const applied: Array<PersistedTx> = []
      return {
        applied,
        loadSubset: () => Promise.resolve([]),
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
        applyCommittedTx: (_collectionId, tx) => {
          applied.push(structuredClone(tx))
          return Promise.resolve()
        },
        ensureIndex: () => Promise.resolve(),
        getStreamPosition: () =>
          Promise.resolve({
            latestTerm: 0,
            latestSeq: 0,
            latestRowVersion: 0,
          }),
        reserveLeadershipTerm: async (collectionId, observedTerm) => {
          const id = storageId(collectionId)
          const latestTerm =
            Math.max(durableTerms.get(id) ?? 0, observedTerm) + 1
          durableTerms.set(id, latestTerm)
          return { latestTerm, latestSeq: 0, latestRowVersion: 0 }
        },
      }
    }

    const retiredAdapter = createTxAdapter()
    const electedAdapter = createTxAdapter()
    const requesterAdapter = createTxAdapter()
    const originalElectedApply =
      electedAdapter.applyCommittedTx.bind(electedAdapter)
    let electedApplyEntered = false
    let releaseElectedApply = (): void => {}
    const electedApplyGate = new Promise<void>((resolve) => {
      releaseElectedApply = resolve
    })
    electedAdapter.applyCommittedTx = async (collectionId, tx) => {
      electedApplyEntered = true
      await electedApplyGate
      await originalElectedApply(collectionId, tx)
    }
    let retired: BrowserCollectionCoordinator | undefined
    let elected: BrowserCollectionCoordinator | undefined
    let requester: BrowserCollectionCoordinator | undefined
    let cleanupCollection: (() => Promise<void>) | undefined
    const electedCommitted: Array<unknown> = []
    const requesterCommitted: Array<unknown> = []

    await withFailurePreservingCleanup(async () => {
      const dbName = `source-owner-transfer`
      retired = createCoordinator(dbName, retiredAdapter)
      elected = createCoordinator(dbName, electedAdapter)
      requester = createCoordinator(dbName, requesterAdapter)
      retired.subscribe(`todos`, () => {})
      elected.subscribe(`todos`, (message) => {
        const payload = message.payload as { type?: string }
        if (payload.type === `tx:committed`) {
          electedCommitted.push(structuredClone(payload))
        }
      })
      requester.subscribe(`todos`, (message) => {
        const payload = message.payload as { type?: string }
        if (payload.type === `tx:committed`) {
          requesterCommitted.push(structuredClone(payload))
        }
      })
      await waitFor(
        () =>
          retired!.isLeader(`todos`) &&
          !elected!.isLeader(`todos`) &&
          !requester!.isLeader(`todos`),
        `initial source owner`,
      )

      await disposeCoordinator(retired)
      await waitFor(
        () => elected!.isLeader(`todos`) && !requester!.isLeader(`todos`),
        `transferred source owner`,
      )

      let sourceParams: SourceParams | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `todos`,
          getKey: (todo) => todo.id,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter: requesterAdapter, coordinator: requester },
        }),
      )
      cleanupCollection = () => collection.cleanup()
      collection.startSyncImmediate()
      await waitForWithoutDelivery(
        () => sourceParams !== undefined,
        `Browser source controls`,
      )

      sourceParams!.begin()
      sourceParams!.metadata?.collection.set(`resume`, { offset: 11 })
      sourceParams!.truncate()
      sourceParams!.write({
        type: `insert`,
        value: { id: `rich`, title: `through Browser owner` },
        metadata: { source: `browser-sync` },
      })
      const receipt = sourceParams!.commit()
      let receiptSettled = receipt === true
      const receiptPromise = receipt === true ? Promise.resolve() : receipt
      void receiptPromise.then(
        () => {
          receiptSettled = true
        },
        () => {
          receiptSettled = true
        },
      )

      await pumpNetwork()
      await waitForWithoutDelivery(
        () => electedApplyEntered,
        `elected Browser source apply entry`,
      )
      expect({
        receiptSettled,
        electedApplies: electedAdapter.applied.length,
        requesterInvalidations: requesterCommitted.length,
      }).toEqual({
        receiptSettled: false,
        electedApplies: 0,
        requesterInvalidations: 0,
      })

      releaseElectedApply()
      await pumpNetwork()
      await receiptPromise
      await pumpNetwork()

      expect(collection.get(`rich`)).toMatchObject({
        id: `rich`,
        title: `through Browser owner`,
      })
      expect(retiredAdapter.applied).toEqual([])
      expect(requesterAdapter.applied).toEqual([])
      expect(electedAdapter.applied).toHaveLength(1)
      expect(electedAdapter.applied[0]).toMatchObject({
        truncate: true,
        mutations: [
          {
            type: `update`,
            key: `rich`,
            value: { id: `rich`, title: `through Browser owner` },
          },
        ],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `rich`,
            value: { source: `browser-sync` },
          },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `resume`, value: { offset: 11 } },
        ],
      })
      const committedTxId = electedAdapter.applied[0]!.txId
      const expectedCommitted = {
        type: `tx:committed`,
        term: 2,
        seq: 1,
        txId: committedTxId,
        latestRowVersion: 1,
        requiresFullReload: true,
      }
      expect(electedCommitted).toEqual([expectedCommitted])
      expect(requesterCommitted).toEqual([expectedCommitted])
    }, [
      [
        `elected Browser source apply gate`,
        () => {
          releaseElectedApply()
        },
      ],
      [
        `Browser source collection`,
        async () => {
          await cleanupCollection?.()
        },
      ],
      [
        `retired Browser source owner`,
        async () => {
          await disposeCoordinator(retired)
        },
      ],
      [
        `elected Browser source owner`,
        async () => {
          await disposeCoordinator(elected)
        },
      ],
      [
        `Browser source requester`,
        async () => {
          await disposeCoordinator(requester)
        },
      ],
    ])
  })
})

describe(`follower remote-demand settlement across real tabs`, () => {
  // Rotation across real tabs. When only the follower's cache claim expires,
  // it rotates into a new generation that no other tab participates in, so
  // it becomes that generation's owner and serves new demand from its own
  // source. The model owes the same applied settlement there: the rows it
  // already showed stay visible, and a new demand settles with its rows.
  // This topology never routes to another tab's owner, so the
  // elected-owner notice path stays with the single-runtime follower
  // generation-notice cells in persisted-oracle.test.ts. Their rotation cell
  // is pinned as failing under the known gap #2139.
  it(
    `keeps a rotated follower's rows and serves its new demand from its own generation`,
    () =>
      withNativeBrowserTransport(async () => {
        const directory = mkdtempSync(join(tmpdir(), `db-real-tab-rotation-`))
        const filename = join(directory, `tabs.sqlite`)
        const dbName = `real-tab-rotation-${Math.random().toString(36).slice(2)}`
        const upstream = new Map<string, RealTabRow>([
          [`remote`, { id: `remote`, group: `a` }],
          [`other`, { id: `other`, group: `b` }],
        ])
        let followerNow = Date.now()
        const tabs: Array<ReturnType<typeof createRealTab>> = []
        const where = (id: string): LoadSubsetOptions => ({
          where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
        })
        try {
          const leader = createRealTab({
            dbName,
            filename,
            source: `receipt`,
            upstream,
          })
          tabs.push(leader)
          leader.collection.startSyncImmediate()
          await leader.collection.stateWhenReady()
          const follower = createRealTab({
            dbName,
            filename,
            source: `receipt`,
            upstream,
            now: () => followerNow,
          })
          tabs.push(follower)
          follower.collection.startSyncImmediate()
          await vi.waitFor(() =>
            expect(follower.storageCollectionId()).toBeDefined(),
          )
          await follower.collection._sync.loadSubset(where(`remote`))
          const original = follower.storageCollectionId()
          expect(follower.coordinator.isLeader(original!)).toBe(false)
          expect(follower.collection.has(`remote`)).toBe(true)

          followerNow += 20_000
          await follower.collection._sync.loadSubset(where(`other`))
          const rotated = follower.storageCollectionId()
          expect(rotated).not.toBe(original)
          expect(follower.coordinator.isLeader(rotated!)).toBe(true)
          expect({
            remote: follower.collection.has(`remote`),
            other: follower.collection.has(`other`),
            status: follower.collection.status,
          }).toEqual({ remote: true, other: true, status: `ready` })
        } finally {
          for (const tab of tabs.reverse())
            await tab.cleanup().catch(() => undefined)
          rmSync(directory, { recursive: true, force: true })
        }
      }),
    30_000,
  )
})

/*
A leader source may commit on every load: a legal update with a new value, or
an equal-value insert of a row it already delivered, which core reconciles as
an update. A follower applies the leader's commit notice from durable rows.
That apply must not release and request the follower's demand again: a new
request makes the leader's source load and commit again, and the follower
would never settle. The model: the follower's query is first ready with the
leader's row, the follower sends at most two ensures (its demand, and at most
one replay), and a later leader commit still reaches the follower with the
leader's current value.
*/
describe(`follower stays bounded when the leader commits on every load`, () => {
  it.each([`update`, `reinsert`] as const)(
    `settles and stays bounded: commit on every load as $0`,
    (commitEachLoad) =>
      withNativeBrowserTransport(async () => {
        const directory = mkdtempSync(join(tmpdir(), `db-real-tab-each-load-`))
        const filename = join(directory, `tabs.sqlite`)
        const dbName = `real-tab-each-load-${Math.random().toString(36).slice(2)}`
        const upstream = new Map<string, RealTabRow>([
          [`remote`, { id: `remote`, group: `a` }],
        ])
        const tabs: Array<ReturnType<typeof createRealTab>> = []
        const queries: Array<{ cleanup: () => Promise<void> }> = []
        const remote: LoadSubsetOptions = {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`id`]),
            new IR.Value(`remote`),
          ]),
        }
        try {
          const leader = createRealTab({
            dbName,
            filename,
            source: `receipt`,
            upstream,
            commitEachLoad,
          })
          tabs.push(leader)
          leader.collection.startSyncImmediate()
          await leader.collection.stateWhenReady()
          const follower = createRealTab({
            dbName,
            filename,
            source: `receipt`,
            upstream,
            commitEachLoad,
          })
          tabs.push(follower)
          follower.collection.startSyncImmediate()
          await vi.waitFor(() =>
            expect(follower.storageCollectionId()).toBeDefined(),
          )
          const items: Collection<RealTabRow, string> = follower.collection
          const query = createLiveQueryCollection((q) =>
            q.from({ item: items }).where(({ item }) => eq(item.id, `remote`)),
          )
          queries.push(query)
          let rowsAtFirstReady: Array<string> | undefined
          query.onFirstReady(() => {
            rowsAtFirstReady = query.toArray.map((row) => row.id)
          })
          void query.preload().catch(() => undefined)
          await vi.waitFor(() => expect(query.isReady()).toBe(true), {
            timeout: 8_000,
          })
          expect(rowsAtFirstReady).toEqual([`remote`])
          for (let turn = 0; turn < 200; turn++) await nextTurn()
          const ensures = () =>
            follower.trace.filter((entry) => entry === `ensure`).length
          expect(ensures()).toBeLessThanOrEqual(2)

          // A later leader commit still reaches the follower.
          await leader.collection._sync.loadSubset(remote)
          await vi.waitFor(
            () =>
              expect(follower.collection.get(`remote`)?.group).toBe(
                upstream.get(`remote`)!.group,
              ),
            { timeout: 8_000 },
          )
          for (let turn = 0; turn < 200; turn++) await nextTurn()
          expect(ensures()).toBeLessThanOrEqual(2)
        } finally {
          for (const query of queries)
            await query.cleanup().catch(() => undefined)
          for (const tab of tabs.reverse())
            await tab.cleanup().catch(() => undefined)
          rmSync(directory, { recursive: true, force: true })
        }
      }),
    30_000,
  )
})

describe(`coordinator fixture lifecycle`, () => {
  it(`releases delayed transport and leadership state before a fresh lifecycle`, async () => {
    let first: BrowserCollectionCoordinator | undefined
    let peer: BrowserCollectionCoordinator | undefined
    let fresh: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      first = createCoordinator(
        `cleanup-first`,
        createRecordingAdapter({ id: `first` }),
      )
      peer = createCoordinator(
        `cleanup-first`,
        createRecordingAdapter({ id: `peer` }),
      )
      first.subscribe(`alpha`, () => {})
      peer.subscribe(`alpha`, () => {})
      await waitFor(
        () => first!.isLeader(`alpha`) && !peer!.isLeader(`alpha`),
        `first lifecycle leadership`,
      )

      const retiredBefore = ControlledBroadcastChannel.retiredDeliveries
      first.publish(`alpha`, {
        v: 1,
        dbName: `cleanup-first`,
        collectionId: `alpha`,
        senderId: first.getNodeId(),
        ts: Date.now(),
        payload: { type: `lifecycle:pending` },
      })
      expect(ControlledBroadcastChannel.delayed.length).toBeGreaterThan(0)
      await disposeCoordinator(first)
      await disposeCoordinator(peer)
      await waitForWithoutDelivery(
        () => heldLocks.size === 0 && queuedLocks.size === 0,
        `first lifecycle release`,
      )
      expect(ControlledBroadcastChannel.retiredDeliveries).toBeGreaterThan(
        retiredBefore,
      )
      expect(coordinatorFixtureSnapshot()).toEqual({
        delayed: 0,
        endpoints: 0,
        heldLocks: 0,
        queuedLocks: 0,
      })

      fresh = createCoordinator(
        `cleanup-fresh`,
        createRecordingAdapter({ id: `fresh` }),
      )
      fresh.subscribe(`alpha`, () => {})
      await waitFor(
        () => fresh!.isLeader(`alpha`),
        `fresh lifecycle leadership`,
      )
      expect(fresh.isLeader(`alpha`)).toBe(true)
      await disposeCoordinator(fresh)
      await waitForWithoutDelivery(
        () => heldLocks.size === 0 && queuedLocks.size === 0,
        `fresh lifecycle release`,
      )
      expect(coordinatorFixtureSnapshot()).toEqual({
        delayed: 0,
        endpoints: 0,
        heldLocks: 0,
        queuedLocks: 0,
      })
    }, [
      [
        `first lifecycle coordinator`,
        async () => {
          await disposeCoordinator(first)
        },
      ],
      [
        `first lifecycle peer`,
        async () => {
          await disposeCoordinator(peer)
        },
      ],
      [
        `fresh lifecycle coordinator`,
        async () => {
          await disposeCoordinator(fresh)
        },
      ],
    ])
  })
})
