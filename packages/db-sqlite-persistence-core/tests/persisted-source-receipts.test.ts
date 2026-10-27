/**
 * Ordinary regression tests for persisted source receipts, terminal persistence failures, and hydration-buffer rejection, as fixed scenarios. The laws they exercise are owned by persisted-oracle.test.ts, which keeps the generated durability drivers and the reconciliation model.
 */
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  IndeterminateCommitError,
  PersistedCollectionDurabilityError,
  SingleProcessCoordinator,
  persistedCollectionOptions,
} from '../src'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createCoordinatorHarness,
  createEventGate,
  createFailStopCoordinatorHarness,
  createRecordingAdapter,
  createTerminalFailureHarness,
  flushAsyncWork,
  observeSettlement,
  overrideBaselineRows,
  recordedStorageId,
  stripVirtualProps,
} from './persisted-support'
import type {
  Collection,
  PendingMutation,
  SyncConfig,
  SyncMetadataApi,
} from '@tanstack/db'
import type { PersistedTx } from '../src'
import type { Todo, TodoSyncParams } from './persisted-support'

// The design grammar's X-then-Y history joins two previously separate facts:
// exact-ID reconciliation acknowledges X at version 1 after a same-key peer
// write advances durable storage to version 2, and resume certification must
// fail closed when the wrapper's owned generation is not the latest durable
// generation. The controlled coordinator supplies the two durable writes and
// the original-position response. The real persisted wrapper owns the source
// receipt, public row, and resume-evidence checkpoint. SQLite separately owns
// the atomic exact-ID proof; this test does not emulate its SQL decision.
it(`keeps the original receipt position after a peer write and fails closed on resume evidence`, async () => {
  const collectionId = `reconciled-peer-resume-generation`
  const adapter = createRecordingAdapter()
  const coordinator = createCoordinatorHarness()
  const error = new IndeterminateCommitError({
    collectionId,
    requestType: `rpc:applyCommittedTx:req`,
    previousLeaderId: `retired`,
    previousTerm: 1,
    currentLeaderId: `replacement`,
    currentTerm: 2,
    cause: new Error(`lost response`),
  })
  let source!: TodoSyncParams
  let capability: SyncMetadataApi<string>[`persistence`] | undefined
  let originalTx: PersistedTx | undefined
  let syncRuns = 0

  coordinator.requestApplyCommittedTx = async (id, tx) => {
    originalTx = { ...tx, term: 1, seq: 1, rowVersion: 1 }
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: id },
      originalTx,
    )
    const peerTx: PersistedTx = {
      ...tx,
      txId: `peer-after-original`,
      term: 2,
      seq: 1,
      rowVersion: 2,
      mutations: [
        {
          type: `update`,
          key: `shared`,
          value: { id: `shared`, title: `peer` },
        },
      ],
      rowMetadataMutations: [],
      collectionMetadataMutations: [
        { type: `set`, key: `cursor`, value: `peer` },
      ],
    }
    await adapter.applyCommittedTx({ kind: `eager`, collectionId: id }, peerTx)
    throw error
  }
  coordinator.reconcileCommittedTx = (id, tx, anchor) => {
    expect(id).toBe(collectionId)
    expect(tx.txId).toBe(originalTx?.txId)
    expect(anchor).toEqual({ latestRowVersion: 0, resetEpoch: 0 })
    return Promise.resolve({
      type: `rpc:reconcileCommittedTx:res`,
      rpcId: `exact-after-peer`,
      ok: true,
      alreadyApplied: true,
      committed: { term: 1, seq: 1, rowVersion: 1 },
    })
  }

  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: collectionId,
      syncMode: `on-demand`,
      getKey: (item) => item.id,
      sync: {
        sync: (params) => {
          source = params
          capability = params.metadata?.persistence
          syncRuns++
          params.markReady()
        },
      },
      persistence: { adapter, coordinator },
    }),
  )

  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(capability).toBeDefined())
    source.begin()
    capability?.resumeSnapshot.expectCurrentCommit()
    source.write({
      type: `insert`,
      value: { id: `shared`, title: `source` },
    })
    source.metadata?.collection.set(`cursor`, `source`)
    await atPersistedOracleCheckpoint(
      Promise.resolve(source.commit()),
      `exact-ID source receipt after peer write`,
    )

    expect(syncRuns).toBe(1)
    expect(adapter.applyCommittedTxCalls).toHaveLength(2)
    expect(collection.get(`shared`)?.title).toBe(`source`)
    expect(adapter.rows.get(`shared`)?.title).toBe(`peer`)
    expect(adapter.collectionMetadata.get(`cursor`)).toBe(`peer`)

    await capability?.resumeSnapshot.certify()
    expect(adapter.loadResumeSnapshotCalls.at(-1)?.includeRows).toBe(false)
    expect(capability?.resumeSnapshot.getKeySetEvidence()).toEqual({
      status: `incompatible`,
    })
  } finally {
    await collection.cleanup()
  }
})

describe(`persistedCollectionOptions`, () => {
  it(`does not apply or persist a wrapped sync transaction committed with an aborted signal`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit:
      ((signal?: AbortSignal) => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-aborted-commit`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      await collection.stateWhenReady()
      const abortController = new AbortController()
      abortController.abort()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `aborted`, title: `Must not publish` },
      })
      await expect(
        remoteCommit?.(abortController.signal),
      ).rejects.toMatchObject({ name: `AbortError` })
      await flushAsyncWork()

      expect(collection.get(`aborted`)).toBeUndefined()
      expect(adapter.applyCommittedTxCalls).toHaveLength(0)
      expect(collection._state.pendingSyncedTransactions).toHaveLength(0)

      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `recovered`, title: `Later transaction` },
      })
      await remoteCommit?.()

      expect(stripVirtualProps(collection.get(`recovered`))).toEqual({
        id: `recovered`,
        title: `Later transaction`,
      })
      expect(adapter.rows.get(`recovered`)).toEqual({
        id: `recovered`,
        title: `Later transaction`,
      })
      expect(collection._state.pendingSyncedTransactions).toHaveLength(0)
    } finally {
      await collection.cleanup()
    }
  })

  it(`does not deliver coordinator work accepted before lifecycle replacement into the new owner`, async () => {
    const id = `queued-coordinator-lifecycle`
    const adapter = createRecordingAdapter()
    const oldReloadEntered = createEventGate()
    const releaseOldReload = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `new owner baseline` },
          },
        ]
      }
      return []
    })
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 1) {
        oldReloadEntered.resolve()
        await releaseOldReload.promise
      }
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    const replacementControlsReady = createEventGate()
    let sourceRuns = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            sourceRuns++
            if (sourceRuns === 2) replacementControlsReady.resolve()
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `queued coordinator initial owner ready`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `old-reload-gate`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await atPersistedOracleCheckpoint(
        oldReloadEntered.promise,
        `old coordinator reload entered`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `queued-before-restart`,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedRows: [
          {
            key: `stale`,
            value: { id: `stale`, title: `must stay with old owner` },
          },
        ],
        deletedKeys: [],
      })

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        replacementControlsReady.promise,
        `replacement sync controls installed`,
      )
      releaseOldReload.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after queued coordinator work`,
      )

      expect({
        sourceRuns,
        baselineCalls,
        subsetCalls,
        staleVisible: collection.get(`stale`),
        staleDurable: adapter.rows.get(`stale`),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        sourceRuns: 2,
        baselineCalls: 2,
        subsetCalls: 1,
        staleVisible: undefined,
        staleDurable: undefined,
        replacementPublicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldReload.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`discards a queued collection reset when its owner is cleaned up`, async () => {
    const id = `queued-reset-lifecycle`
    const adapter = createRecordingAdapter()
    const oldReloadEntered = createEventGate()
    const releaseOldReload = createEventGate()
    let subsetCalls = 0
    adapter.loadSubset = async () => {
      subsetCalls++
      if (subsetCalls === 1) {
        oldReloadEntered.resolve()
        await releaseOldReload.promise
      }
      return []
    }
    const coordinator = createFailStopCoordinatorHarness(id)
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `queued reset initial owner ready`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `old-reset-gate`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await atPersistedOracleCheckpoint(
        oldReloadEntered.promise,
        `old reload entered before queued reset`,
      )
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })

      await collection.cleanup()
      cleanedUp = true
      releaseOldReload.resolve()
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        subsetCalls,
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        subsetCalls: 1,
        status: `cleaned-up`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldReload.resolve()
      await cleanupPersistedOracle(
        [() => (cleanedUp ? undefined : collection.cleanup())],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not apply a delayed seq-gap replay response into a restarted lifecycle`, async () => {
    const id = `delayed-pull-since-lifecycle`
    const adapter = createRecordingAdapter()
    const pullEntered = createEventGate()
    const releasePull = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `new owner baseline` },
          },
        ]
      }
      return []
    })
    const coordinator = createFailStopCoordinatorHarness(id)
    coordinator.pullSince = async () => {
      pullEntered.resolve()
      await releasePull.promise
      return {
        type: `rpc:pullSince:res`,
        rpcId: `old-delayed-pull`,
        ok: true,
        latestTerm: 1,
        latestSeq: 2,
        latestRowVersion: 2,
        requiresFullReload: false,
        changedKeys: [`stale`],
        deletedKeys: [],
        deltas: [
          {
            txId: `old-delayed-delta`,
            latestRowVersion: 2,
            changedRows: [
              {
                key: `stale`,
                value: { id: `stale`, title: `must stay with old owner` },
              },
            ],
            deletedKeys: [],
            rowMetadataMutations: [],
            collectionMetadataMutations: [],
          },
        ],
      }
    }
    const replacementControlsReady = createEventGate()
    let sourceRuns = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            sourceRuns++
            if (sourceRuns === 2) replacementControlsReady.resolve()
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `delayed pull initial owner ready`,
      )
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
      await atPersistedOracleCheckpoint(
        pullEntered.promise,
        `old pullSince entered`,
      )

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        replacementControlsReady.promise,
        `delayed pull replacement controls installed`,
      )
      releasePull.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after delayed pull replay`,
      )

      expect({
        sourceRuns,
        baselineCalls,
        staleVisible: collection.get(`stale`),
        staleDurable: adapter.rows.get(`stale`),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        sourceRuns: 2,
        baselineCalls: 2,
        staleVisible: undefined,
        staleDurable: undefined,
        replacementPublicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releasePull.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not apply a later seq-gap replay delta through replacement controls`, async () => {
    const id = `two-delta-replay-lifecycle`
    const firstReceiptEntered = createEventGate()
    const releaseFirstReceipt = createEventGate()
    const replacementControlsInstalled = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let baselineCalls = 0
    const adapter = createRecordingAdapter()
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `B baseline` },
          },
        ]
      }
      return []
    })
    const coordinator = createFailStopCoordinatorHarness(id)
    const pullArguments: Array<{
      collectionId: string
      fromRowVersion: number
    }> = []
    coordinator.pullSince = async (collectionId, fromRowVersion) => {
      pullArguments.push({ collectionId, fromRowVersion })
      return {
        type: `rpc:pullSince:res`,
        rpcId: `two-delta-replay`,
        ok: true,
        latestTerm: 1,
        latestSeq: 3,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedKeys: [`first`, `second`],
        deletedKeys: [],
        deltas: [
          {
            txId: `A-delta-1`,
            latestRowVersion: 1,
            changedRows: [
              {
                key: `first`,
                value: { id: `first`, title: `A first delta` },
              },
            ],
            deletedKeys: [],
            rowMetadataMutations: [
              { type: `set`, key: `first`, value: { owner: `A-first` } },
            ],
            collectionMetadataMutations: [
              { type: `set`, key: `replay:first`, value: `A-first` },
            ],
          },
          {
            txId: `A-delta-2`,
            latestRowVersion: 2,
            changedRows: [
              {
                key: `second`,
                value: { id: `second`, title: `A second delta` },
              },
            ],
            deletedKeys: [],
            rowMetadataMutations: [
              { type: `set`, key: `second`, value: { owner: `A-second` } },
            ],
            collectionMetadataMutations: [
              { type: `set`, key: `replay:second`, value: `A-second` },
            ],
          },
        ],
      }
    }

    let gateNextApplicationReceipt = false
    let controlsRun = 0
    const applicationReceipts: Array<{
      controlsOwner: `A` | `B`
      returnedReceipt: `actual` | `held`
      rowMetadataKeys: Array<string>
      collectionMetadataKeys: Array<string>
    }> = []
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) => {
          controlsRun++
          const controlsOwner =
            controlsRun === 1 ? (`A` as const) : (`B` as const)
          if (controlsOwner === `B`) replacementControlsInstalled.resolve()
          let rowMetadataKeys: Array<string> = []
          let collectionMetadataKeys: Array<string> = []
          return baseSync({
            ...params,
            begin: () => {
              rowMetadataKeys = []
              collectionMetadataKeys = []
              return params.begin()
            },
            metadata: {
              persistence: params.metadata!.persistence,
              row: {
                ...params.metadata!.row,
                set: (key, value) => {
                  rowMetadataKeys.push(String(key))
                  params.metadata!.row.set(key, value)
                },
                delete: (key) => {
                  rowMetadataKeys.push(String(key))
                  params.metadata!.row.delete(key)
                },
              },
              collection: {
                ...params.metadata!.collection,
                set: (key, value) => {
                  collectionMetadataKeys.push(key)
                  params.metadata!.collection.set(key, value)
                },
                delete: (key) => {
                  collectionMetadataKeys.push(key)
                  params.metadata!.collection.delete(key)
                },
              },
            },
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (
                !gateNextApplicationReceipt &&
                applicationReceipts.length === 0
              ) {
                return actualReceipt
              }
              const trace = {
                controlsOwner,
                returnedReceipt: `actual` as `actual` | `held`,
                rowMetadataKeys: [...rowMetadataKeys],
                collectionMetadataKeys: [...collectionMetadataKeys],
              }
              applicationReceipts.push(trace)
              if (gateNextApplicationReceipt) {
                gateNextApplicationReceipt = false
                trace.returnedReceipt = `held`
                firstReceiptEntered.resolve()
                void Promise.resolve(actualReceipt).catch(() => undefined)
                return releaseFirstReceipt.promise
              }
              return actualReceipt
            },
          })
        },
      },
    })
    let replacementReady: Promise<unknown> | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `two-delta A lifecycle ready`,
      )
      applicationReceipts.length = 0
      gateNextApplicationReceipt = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 3,
        txId: `gap-trigger`,
        latestRowVersion: 3,
        requiresFullReload: false,
        changedRows: [],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        firstReceiptEntered.promise,
        `two-delta first A receipt held`,
      )
      expect(collection.get(`first`)?.title).toBe(`A first delta`)

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        replacementControlsInstalled.promise,
        `two-delta B controls installed`,
      )

      releaseFirstReceipt.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `two-delta B hydration held`,
      )
      await Promise.resolve()

      const secondReceipts = applicationReceipts.filter(
        (receipt) =>
          receipt.rowMetadataKeys.includes(`second`) ||
          receipt.collectionMetadataKeys.includes(`replay:second`),
      )
      expect({
        controlsRun,
        pullArguments,
        secondReceipts,
        secondRowMetadata: collection._state.syncedMetadata.get(`second`),
        secondCollectionMetadata:
          collection._state.syncedCollectionMetadata.get(`replay:second`),
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        controlsRun: 2,
        pullArguments: [{ collectionId: id, fromRowVersion: 0 }],
        secondReceipts: [],
        secondRowMetadata: undefined,
        secondCollectionMetadata: undefined,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseFirstReceipt.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not confirm a delayed local coordinator response through a restarted owner`, async () => {
    const id = `delayed-local-confirmation-lifecycle`
    const adapter = createRecordingAdapter()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 2) {
        replacementHydrationEntered.resolve()
        await releaseReplacementHydration.promise
        return [
          {
            key: `replacement`,
            value: { id: `replacement`, title: `new owner baseline` },
          },
        ]
      }
      return []
    })
    const coordinator = createFailStopCoordinatorHarness(id)
    const requestEntered = createEventGate()
    const releaseRequest = createEventGate()
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      requestEntered.resolve()
      await releaseRequest.promise
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `old-delayed-local`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        persistence: { adapter, coordinator },
      }),
    )
    const oldRow = { id: `old-local`, title: `must stay with old owner` }
    let localTransaction: ReturnType<typeof collection.insert> | undefined
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `delayed local initial owner ready`,
      )
      localTransaction = collection.insert(oldRow)
      await atPersistedOracleCheckpoint(
        requestEntered.promise,
        `old local coordinator request entered`,
      )

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      releaseRequest.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after delayed local confirmation`,
      )

      expect({
        baselineCalls,
        staleVisible: collection.get(oldRow.id),
        staleDurable: adapter.rows.get(oldRow.id),
        replacementPublicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        baselineCalls: 2,
        staleVisible: undefined,
        staleDurable: undefined,
        replacementPublicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseRequest.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => localTransaction?.isPersisted.promise.catch(() => undefined),
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not admit an old pending user hook through a restarted coordinator`, async () => {
    const id = `pending-user-hook-lifecycle`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const hookEntered = createEventGate()
    const releaseHook = createEventGate()
    let coordinatorRequests = 0
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      coordinatorRequests++
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `stale-user-hook-request`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        onInsert: async () => {
          hookEntered.resolve()
          await releaseHook.promise
          return {}
        },
        persistence: { adapter, coordinator },
      }),
    )
    let transaction: ReturnType<typeof collection.insert> | undefined
    let transactionOutcome:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `pending user hook initial owner ready`,
      )
      transaction = collection.insert({
        id: `old-hook`,
        title: `must not enter replacement coordinator`,
      })
      transactionOutcome = transaction.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        hookEntered.promise,
        `old user hook entered before coordinator admission`,
      )
      expect(coordinatorRequests).toBe(0)

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      // Readiness counts the replacement's accepted startup rows, which the
      // old hook's still-persisting transaction holds.
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementReady,
        `pending user hook replacement owner ready`,
      )
      releaseHook.resolve()
      const outcome = await atPersistedOracleCheckpoint(
        transactionOutcome,
        `pending user hook transaction settled`,
      )

      expect({
        replacementStatus: replacementOutcome.status,
        transactionStatus: outcome.status,
        coordinatorRequests,
        durableOldRow: adapter.rows.get(`old-hook`),
      }).toEqual({
        replacementStatus: `fulfilled`,
        transactionStatus: `rejected`,
        coordinatorRequests: 0,
        durableOldRow: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseHook.resolve()
      await cleanupPersistedOracle(
        [
          () => transactionOutcome,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not let old loopback readiness complete a restarted hydration`, async () => {
    const adapter = createRecordingAdapter()
    const oldHydrationEntered = createEventGate()
    const releaseOldHydration = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 1) {
        oldHydrationEntered.resolve()
        await releaseOldHydration.promise
        return []
      }
      replacementHydrationEntered.resolve()
      await releaseReplacementHydration.promise
      return [
        {
          key: `replacement`,
          value: { id: `replacement`, title: `new owner baseline` },
        },
      ]
    })
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `loopback-late-readiness-lifecycle`,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )
    const oldReady = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        oldHydrationEntered.promise,
        `old loopback hydration entered`,
      )
      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )

      releaseOldHydration.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement loopback hydration entered`,
      )
      await flushAsyncWork()

      expect({
        baselineCalls,
        replacementIsReady: collection.isReady(),
        replacementVisible: collection.get(`replacement`),
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        baselineCalls: 2,
        replacementIsReady: false,
        replacementVisible: undefined,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseOldHydration.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => oldReady,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it.each([`fulfill`, `reject`] as const)(
    `keeps retired loopback startup inert after cleanup: %s`,
    async (outcome) => {
      const adapter = createRecordingAdapter()
      const hydrationEntered = createEventGate()
      const hydrationGate = createEventGate()
      const startupError = new Error(`retired loopback startup failed`)
      const restoreBaselineRows = overrideBaselineRows(adapter, async () => {
        hydrationEntered.resolve()
        await hydrationGate.promise
        if (outcome === `reject`) throw startupError
        return []
      })
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `retired-loopback-startup-${outcome}`,
          getKey: (row) => row.id,
          persistence: { adapter },
        }),
      )
      const readiness = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const unhandled: Array<unknown> = []
      const captureUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, captureUnhandled)
      const peer = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `retired-loopback-peer-${outcome}`,
          getKey: (row) => row.id,
          persistence: { adapter: createRecordingAdapter() },
        }),
      )
      let hasPrimaryFailure = false

      try {
        await atPersistedOracleCheckpoint(
          hydrationEntered.promise,
          `retired loopback hydration entered`,
        )
        await collection.cleanup()
        const retiredStatus = collection.status

        hydrationGate.resolve()
        await flushAsyncWork()
        await flushAsyncWork()
        const readinessOutcome = await readiness
        await atPersistedOracleCheckpoint(
          peer.stateWhenReady(),
          `independent loopback peer ready`,
        )

        expect({
          retiredStatus,
          finalStatus: collection.status,
          readinessStatus: readinessOutcome.status,
          readinessErrorName:
            readinessOutcome.status === `rejected` &&
            readinessOutcome.reason instanceof Error
              ? readinessOutcome.reason.name
              : undefined,
          publicError: collection._lifecycle.getSyncError(),
          warnings: warnings.mock.calls,
          unhandled,
          peerStatus: peer.status,
        }).toEqual({
          retiredStatus: `cleaned-up`,
          finalStatus: `cleaned-up`,
          readinessStatus: `rejected`,
          readinessErrorName: `AbortError`,
          publicError: undefined,
          warnings: [],
          unhandled: [],
          peerStatus: `ready`,
        })

        // This hostile control bypasses the sync-run-owned callback. It proves
        // the status observation above would reject an unfenced late ready.
        expect(() => collection._lifecycle.markReady()).toThrowError(
          expect.objectContaining({ name: `CollectionStateError` }),
        )
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        restoreBaselineRows()
        hydrationGate.resolve()
        process.off(`unhandledRejection`, captureUnhandled)
        warnings.mockRestore()
        await cleanupPersistedOracle(
          [() => readiness, () => collection.cleanup(), () => peer.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`settles old source cleanup before hydrating a same-resource replacement`, async () => {
    const id = `same-resource-cleanup-settlement`
    const adapter = createRecordingAdapter()
    adapter.rows.set(`retired`, {
      id: `retired`,
      title: `must not survive old cleanup`,
    })
    const cleanupGate = createEventGate()
    let sourceCleanupSettled = false
    const create = (withCleanup: boolean) =>
      createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return withCleanup
                ? {
                    cleanup: () =>
                      cleanupGate.promise.then(() => {
                        adapter.rows.delete(`retired`)
                        sourceCleanupSettled = true
                      }),
                  }
                : undefined
            },
          },
          persistence: { adapter },
        }),
      )
    const oldCollection = create(true)
    let replacement: ReturnType<typeof create> | undefined
    let replacementReady: Promise<unknown> | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        oldCollection.stateWhenReady(),
        `old same-resource owner ready`,
      )
      expect(stripVirtualProps(oldCollection.get(`retired`))).toEqual({
        id: `retired`,
        title: `must not survive old cleanup`,
      })

      const replacementStarted = oldCollection.cleanup().then(() => {
        replacement = create(false)
        replacementReady = replacement.stateWhenReady()
        return replacementReady
      })
      await flushAsyncWork()

      expect(sourceCleanupSettled).toBe(false)
      expect(replacement).toBeUndefined()

      cleanupGate.resolve()
      await atPersistedOracleCheckpoint(
        replacementStarted,
        `same-resource replacement ready after cleanup`,
      )

      expect(sourceCleanupSettled).toBe(true)
      expect(adapter.rows.has(`retired`)).toBe(false)
      expect(replacement?.get(`retired`)).toBeUndefined()
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      cleanupGate.resolve()
      await cleanupPersistedOracle(
        [
          () => replacementReady,
          () => oldCollection.cleanup(),
          () => replacement?.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it.each([`fulfill`, `reject`] as const)(
    `awaits cleanup returned after reentrant persisted source retirement: %s`,
    async (outcome) => {
      const adapter = createRecordingAdapter()
      const sourceEntered = createEventGate()
      const cleanupGate = createEventGate()
      const sourceError = new Error(`reentrant source cleanup failed`)
      let cleanupCalls = 0
      let cleanupFromReentry: Promise<void> | undefined
      let reenterCleanup = true
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `reentrant-persisted-source-cleanup-${outcome}`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ collection: publicCollection, markReady }) => {
              if (!reenterCleanup) {
                markReady()
                return
              }
              reenterCleanup = false
              cleanupFromReentry = publicCollection.cleanup()
              sourceEntered.resolve()
              return {
                cleanup: () => {
                  cleanupCalls++
                  return cleanupGate.promise.then(() => {
                    if (outcome === `reject`) throw sourceError
                  })
                },
              }
            },
          },
          persistence: { adapter },
        }),
      )
      let cleanupSettled = false
      let hasPrimaryFailure = false

      try {
        collection.startSyncImmediate()
        await atPersistedOracleCheckpoint(
          sourceEntered.promise,
          `reentrant persisted source entered`,
        )
        if (!cleanupFromReentry) {
          throw new Error(`reentrant cleanup was not captured`)
        }
        void cleanupFromReentry.then(
          () => {
            cleanupSettled = true
          },
          () => {
            cleanupSettled = true
          },
        )
        await flushAsyncWork()

        expect({ cleanupCalls, cleanupSettled }).toEqual({
          cleanupCalls: 1,
          cleanupSettled: false,
        })

        cleanupGate.resolve()
        if (outcome === `reject`) {
          await expect(cleanupFromReentry).rejects.toMatchObject({
            name: `SyncCleanupError`,
            cause: sourceError,
          })
        } else {
          await expect(cleanupFromReentry).resolves.toBeUndefined()
        }
        expect(collection.status).toBe(`cleaned-up`)
        expect(cleanupCalls).toBe(1)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        cleanupGate.resolve()
        await cleanupPersistedOracle(
          [
            () => cleanupFromReentry?.catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`does not register remote ownership returned by a retired source sync`, async () => {
    const id = `reentrant-retired-remote-owner`
    const adapter = createRecordingAdapter()
    const coordinator = new SingleProcessCoordinator()
    const sourceEntered = createEventGate()
    let cleanupFromReentry: Promise<void> | undefined
    let retiredSourceLoads = 0
    const oldCollection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ collection: publicCollection }) => {
            cleanupFromReentry = publicCollection.cleanup()
            sourceEntered.resolve()
            return {
              loadSubset: () => {
                retiredSourceLoads++
                return true
              },
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacement: Collection<Todo, string> | undefined
    let replacementReady: Promise<unknown> | undefined
    let hasPrimaryFailure = false

    try {
      oldCollection.startSyncImmediate()
      await atPersistedOracleCheckpoint(
        sourceEntered.promise,
        `retired remote-owner source entered`,
      )
      if (!cleanupFromReentry) {
        throw new Error(`reentrant cleanup was not captured`)
      }
      await atPersistedOracleCheckpoint(
        cleanupFromReentry,
        `retired remote-owner cleanup settled`,
      )

      replacement = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      replacementReady = replacement.stateWhenReady()
      await atPersistedOracleCheckpoint(
        replacementReady,
        `same-id replacement ready after retired source entry`,
      )

      expect({
        oldStatus: oldCollection.status,
        replacementStatus: replacement.status,
        retiredSourceLoads,
      }).toEqual({
        oldStatus: `cleaned-up`,
        replacementStatus: `ready`,
        retiredSourceLoads: 0,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [
          () => cleanupFromReentry,
          () => replacementReady,
          () => oldCollection.cleanup(),
          () => replacement?.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`settles every cleanup task after synchronous runtime teardown failures`, async () => {
    const id = `synchronous-runtime-cleanup-failure`
    const adapter = createRecordingAdapter()
    const coordinator = new SingleProcessCoordinator()
    const sourceCleanupGate = createEventGate()
    const firstRuntimeError = new Error(`coordinator unsubscribe failed`)
    const laterRuntimeError = new Error(`remote owner unsubscribe failed`)
    const cleanupEvents: Array<string> = []
    let subscriptionCount = 0
    let ownerCount = 0
    const subscribe = coordinator.subscribe.bind(coordinator)
    coordinator.subscribe = () => {
      const unsubscribe = subscribe()
      const fail = subscriptionCount++ === 0
      return () => {
        unsubscribe()
        cleanupEvents.push(`coordinator`)
        if (fail) throw firstRuntimeError
      }
    }
    const registerRemoteSubsetOwner =
      coordinator.registerRemoteSubsetOwner.bind(coordinator)
    coordinator.registerRemoteSubsetOwner = (collectionId, owner) => {
      const unregister = registerRemoteSubsetOwner(collectionId, owner)
      const fail = ownerCount++ === 0
      return () => {
        unregister()
        cleanupEvents.push(`remote-owner`)
        if (fail) throw laterRuntimeError
      }
    }
    let sourceCleanupCalls = 0
    const oldCollection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              cleanup: () => {
                sourceCleanupCalls++
                return sourceCleanupGate.promise
              },
              loadSubset: () => true,
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let replacement: Collection<Todo, string> | undefined
    let replacementReady: Promise<unknown> | undefined
    let cleanupSettled = false
    let cleanupOutcome:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; error: unknown }
        >
      | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        oldCollection.stateWhenReady(),
        `runtime-cleanup source ready`,
      )
      cleanupOutcome = oldCollection.cleanup().then(
        () => ({ status: `fulfilled` as const }),
        (error: unknown) => ({ status: `rejected` as const, error }),
      )
      void cleanupOutcome.then(() => {
        cleanupSettled = true
      })
      await flushAsyncWork()

      expect({ sourceCleanupCalls, cleanupSettled }).toEqual({
        sourceCleanupCalls: 1,
        cleanupSettled: false,
      })

      sourceCleanupGate.resolve()
      const outcome = await atPersistedOracleCheckpoint(
        cleanupOutcome,
        `runtime cleanup tasks settled`,
      )
      expect(outcome.status).toBe(`rejected`)
      if (outcome.status !== `rejected`) {
        throw new Error(`expected runtime cleanup to reject`)
      }
      expect(outcome.error).toMatchObject({ name: `SyncCleanupError` })
      const syncCleanupError = outcome.error as { cause?: unknown }
      expect(syncCleanupError.cause).toBeInstanceOf(AggregateError)
      const aggregate = syncCleanupError.cause as AggregateError
      expect(aggregate.cause).toBe(firstRuntimeError)
      expect(aggregate.errors).toEqual([firstRuntimeError, laterRuntimeError])
      expect(cleanupEvents).toEqual([`coordinator`, `remote-owner`])

      replacement = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      replacementReady = replacement.stateWhenReady()
      await atPersistedOracleCheckpoint(
        replacementReady,
        `replacement ready after failed runtime cleanup`,
      )
      expect(replacement.status).toBe(`ready`)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      sourceCleanupGate.resolve()
      await cleanupPersistedOracle(
        [
          () => cleanupOutcome,
          () => replacementReady,
          () => oldCollection.cleanup(),
          () => replacement?.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`preserves source and runtime failures when persisted cleanup has both`, async () => {
    const id = `source-and-runtime-cleanup-failures`
    const adapter = createRecordingAdapter()
    const coordinator = new SingleProcessCoordinator()
    const sourceCleanupGate = createEventGate()
    const sourceError = new Error(`source cleanup failed exactly`)
    const runtimeError = new Error(`runtime cleanup failed exactly`)
    let sourceCleanupCalls = 0
    let runtimeCleanupCalls = 0
    const subscribe = coordinator.subscribe.bind(coordinator)
    coordinator.subscribe = () => {
      const unsubscribe = subscribe()
      return () => {
        unsubscribe()
        runtimeCleanupCalls++
        throw runtimeError
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              cleanup: () => {
                sourceCleanupCalls++
                return sourceCleanupGate.promise
              },
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    let cleanupOutcome:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; error: unknown }
        >
      | undefined
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `dual-failure persisted collection ready`,
      )
      cleanupOutcome = collection.cleanup().then(
        () => ({ status: `fulfilled` as const }),
        (error: unknown) => ({ status: `rejected` as const, error }),
      )
      await flushAsyncWork()

      expect({ sourceCleanupCalls, runtimeCleanupCalls }).toEqual({
        sourceCleanupCalls: 1,
        runtimeCleanupCalls: 1,
      })

      sourceCleanupGate.reject(sourceError)
      const outcome = await atPersistedOracleCheckpoint(
        cleanupOutcome,
        `source and runtime cleanup failures settled`,
      )
      expect(outcome.status).toBe(`rejected`)
      if (outcome.status !== `rejected`) {
        throw new Error(`expected persisted cleanup to reject`)
      }
      expect(outcome.error).toMatchObject({ name: `SyncCleanupError` })
      const syncCleanupError = outcome.error as { cause?: unknown }
      expect(syncCleanupError.cause).toBeInstanceOf(AggregateError)
      const aggregate = syncCleanupError.cause as AggregateError
      expect(aggregate.cause).toBe(sourceError)
      expect(aggregate.errors).toEqual([sourceError, runtimeError])
      expect(collection.status).toBe(`cleaned-up`)
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      sourceCleanupGate.resolve()
      await cleanupPersistedOracle(
        [() => cleanupOutcome, () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`marks a targeted invalidation commit-receipt rejection terminal`, async () => {
    const id = `targeted-invalidation-receipt`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const rejectedReceipt = createEventGate()
    const receiptError = new Error(
      `targeted invalidation receipt failed exactly`,
    )
    let rejectNextCommit = false
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (!rejectNextCommit) return actualReceipt
              rejectNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return rejectedReceipt.promise
            },
          }),
      },
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `targeted receipt collection ready`,
      )
      rejectNextCommit = true
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `targeted-receipt-failure`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          {
            key: `targeted`,
            value: { id: `targeted`, title: `publication attempted` },
          },
        ],
        deletedKeys: [],
      })
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `targeted invalidation receipt entered`,
      )
      rejectedReceipt.reject(receiptError)
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === receiptError,
      }).toEqual({
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectedReceipt.reject(receiptError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`waits for a reset truncate receipt before reloading`, async () => {
    const id = `reset-truncate-receipt`
    const seed = { id: `seed`, title: `must survive a failed reset` }
    const adapter = createRecordingAdapter([seed])
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const rejectedReceipt = createEventGate()
    const receiptError = new Error(`reset truncate receipt failed exactly`)
    let rejectNextCommit = false
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (!rejectNextCommit) return actualReceipt
              rejectNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return rejectedReceipt.promise
            },
          }),
      },
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `reset receipt collection ready`,
      )
      const baselineLoadCount = adapter.loadSubsetCalls.length
      rejectNextCommit = true
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `reset truncate receipt entered`,
      )
      await flushAsyncWork()
      await flushAsyncWork()

      expect(adapter.loadSubsetCalls.length).toBe(baselineLoadCount)

      rejectedReceipt.reject(receiptError)
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === receiptError,
      }).toEqual({
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectedReceipt.reject(receiptError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`keeps local persistence pending through confirmation receipt settlement`, async () => {
    const id = `local-confirmation-receipt`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const rejectedReceipt = createEventGate()
    const receiptError = new Error(`local confirmation receipt failed exactly`)
    let rejectNextCommit = false
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      rejectNextCommit = true
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `local-confirmation`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (!rejectNextCommit) return actualReceipt
              rejectNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return rejectedReceipt.promise
            },
          }),
      },
    })
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `local confirmation receipt collection ready`,
      )
      const transaction = collection.insert({
        id: `local`,
        title: `durable before confirmation settles`,
      })
      const transactionOutcome = transaction.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `local confirmation receipt entered`,
      )
      const pending = observeSettlement(
        transactionOutcome.then(() => undefined),
      )
      await Promise.resolve()
      expect(pending.read()).toEqual({ status: `pending` })

      rejectedReceipt.reject(receiptError)
      const outcome = await atPersistedOracleCheckpoint(
        transactionOutcome,
        `local confirmation transaction settled`,
      )
      await flushAsyncWork()

      expect({
        transactionStatus: outcome.status,
        transactionExact:
          outcome.status === `rejected` && outcome.reason === receiptError,
        status: collection.status,
        exactPublicError: collection._lifecycle.getSyncError() === receiptError,
      }).toEqual({
        transactionStatus: `rejected`,
        transactionExact: true,
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      rejectedReceipt.reject(receiptError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not continue an old hydration into a replacement after its applied receipt settles`, async () => {
    const id = `hydration-applied-receipt-lifecycle`
    const adapter = createRecordingAdapter()
    const receiptEntered = createEventGate()
    const releaseReceipt = createEventGate()
    let gateNextCommit = false
    let baselineCalls = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 1) {
        gateNextCommit = true
        return [
          {
            key: `old`,
            value: { id: `old`, title: `old owner hydration` },
          },
        ]
      }
      return [
        {
          key: `replacement`,
          value: { id: `replacement`, title: `new owner hydration` },
        },
      ]
    })
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (!gateNextCommit) return actualReceipt
              gateNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return releaseReceipt.promise
            },
          }),
      },
    })
    const oldReady = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `old hydration applied receipt entered`,
      )
      expect(stripVirtualProps(collection.get(`old`))).toEqual({
        id: `old`,
        title: `old owner hydration`,
      })

      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      releaseReceipt.resolve()
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementReady,
        `replacement hydration after old applied receipt`,
      )

      expect({
        replacementStatus: replacementOutcome.status,
        baselineCalls,
        oldVisible: collection.get(`old`),
        replacementVisible: stripVirtualProps(collection.get(`replacement`)),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        replacementStatus: `fulfilled`,
        baselineCalls: 2,
        oldVisible: undefined,
        replacementVisible: {
          id: `replacement`,
          title: `new owner hydration`,
        },
        status: `ready`,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseReceipt.resolve()
      await cleanupPersistedOracle(
        [
          () => oldReady,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`does not let an old post-receipt continuation flush replacement coordinator work`, async () => {
    const id = `post-receipt-queue-lifecycle`
    const adapter = createRecordingAdapter()
    const coordinator = createFailStopCoordinatorHarness(id)
    const receiptEntered = createEventGate()
    const releaseReceipt = createEventGate()
    const replacementSourceStarted = createEventGate()
    const replacementHydrationEntered = createEventGate()
    const releaseReplacementHydration = createEventGate()
    let gateNextCommit = false
    let baselineCalls = 0
    let sourceRuns = 0
    overrideBaselineRows(adapter, async () => {
      baselineCalls++
      if (baselineCalls === 1) {
        gateNextCommit = true
        return [
          {
            key: `old`,
            value: { id: `old`, title: `old owner hydration` },
          },
        ]
      }
      replacementHydrationEntered.resolve()
      await releaseReplacementHydration.promise
      return [
        {
          key: `replacement`,
          value: { id: `replacement`, title: `new owner hydration` },
        },
      ]
    })
    const baseOptions = persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          sourceRuns++
          if (sourceRuns === 2) replacementSourceStarted.resolve()
          markReady()
        },
      },
      persistence: { adapter, coordinator },
    })
    const baseSync = baseOptions.sync.sync
    const collection = createCollection({
      ...baseOptions,
      sync: {
        ...baseOptions.sync,
        sync: (params) =>
          baseSync({
            ...params,
            commit: (signal) => {
              const actualReceipt = params.commit(signal)
              if (!gateNextCommit) return actualReceipt
              gateNextCommit = false
              receiptEntered.resolve()
              void Promise.resolve(actualReceipt).catch(() => undefined)
              return releaseReceipt.promise
            },
          }),
      },
    })
    const oldReady = collection.stateWhenReady().then(
      () => ({ status: `fulfilled` as const }),
      (reason: unknown) => ({ status: `rejected` as const, reason }),
    )
    let replacementReady:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        receiptEntered.promise,
        `old post-receipt hydration entered`,
      )
      await collection.cleanup()
      cleanedUp = true
      collection.startSyncImmediate()
      cleanedUp = false
      replacementReady = collection.stateWhenReady().then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        replacementSourceStarted.promise,
        `replacement source subscribed behind old receipt`,
      )
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `replacement-queued-work`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [
          {
            key: `queued`,
            value: {
              id: `queued`,
              title: `belongs after replacement hydrate`,
            },
          },
        ],
        deletedKeys: [],
      })

      releaseReceipt.resolve()
      await atPersistedOracleCheckpoint(
        replacementHydrationEntered.promise,
        `replacement hydration entered after old receipt`,
      )
      await flushAsyncWork()

      expect({
        sourceRuns,
        baselineCalls,
        queuedVisible: collection.get(`queued`),
      }).toEqual({
        sourceRuns: 2,
        baselineCalls: 2,
        queuedVisible: undefined,
      })

      releaseReplacementHydration.resolve()
      const replacementOutcome = await atPersistedOracleCheckpoint(
        replacementReady,
        `replacement hydration settled before coordinator work`,
      )
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        replacementStatus: replacementOutcome.status,
        oldVisible: collection.get(`old`),
        replacementVisible: stripVirtualProps(collection.get(`replacement`)),
        queuedVisible: stripVirtualProps(collection.get(`queued`)),
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        replacementStatus: `fulfilled`,
        oldVisible: undefined,
        replacementVisible: {
          id: `replacement`,
          title: `new owner hydration`,
        },
        queuedVisible: {
          id: `queued`,
          title: `belongs after replacement hydrate`,
        },
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseReceipt.resolve()
      releaseReplacementHydration.resolve()
      await cleanupPersistedOracle(
        [
          () => oldReady,
          () => replacementReady,
          () => (cleanedUp ? undefined : collection.cleanup()),
        ],
        hasPrimaryFailure,
      )
    }
  })

  it(`rejects new source transactions after a terminal persistence failure`, async () => {
    const adapter = createRecordingAdapter()
    const adapterError = Object.assign(
      new Error(`terminal adapter write failed exactly`),
      {
        code: `SQLITE_FULL`,
        path: `adapter.applyCommittedTx`,
      },
    )
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    let applyCalls = 0
    adapter.applyCommittedTx = async (collectionId, tx) => {
      applyCalls++
      if (applyCalls === 1) throw adapterError
      await successfulApply(collectionId, tx)
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-terminal-persistence-admission`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `terminal persistence admission collection ready`,
      )
      remoteBegin!()
      remoteWrite!({
        type: `insert`,
        value: { id: `first`, title: `published before persistence` },
      })
      const firstOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(remoteCommit!()).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `first terminal persistence receipt`,
      )
      const terminalError =
        firstOutcome.status === `rejected` ? firstOutcome.reason : undefined

      expect({
        receiptStatus: firstOutcome.status,
        errorName:
          terminalError instanceof Error ? terminalError.name : undefined,
        cause: terminalError instanceof Error ? terminalError.cause : undefined,
        publicErrorIsReceipt:
          collection._lifecycle.getSyncError() === terminalError,
        status: collection.status,
        firstVisible: stripVirtualProps(collection.get(`first`)),
        firstDurable: adapter.rows.get(`first`),
        applyCalls,
      }).toEqual({
        receiptStatus: `rejected`,
        errorName: `PersistedCollectionDurabilityError`,
        cause: adapterError,
        publicErrorIsReceipt: true,
        status: `error`,
        firstVisible: {
          id: `first`,
          title: `published before persistence`,
        },
        firstDurable: undefined,
        applyCalls: 1,
      })

      remoteBegin!()
      remoteWrite!({
        type: `insert`,
        value: { id: `late`, title: `must not be admitted` },
      })
      const lateOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(remoteCommit!()).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `late terminal persistence receipt`,
      )

      expect({
        receiptStatus: lateOutcome.status,
        exactReceipt:
          lateOutcome.status === `rejected` &&
          lateOutcome.reason === terminalError,
        publicErrorIsTerminal:
          collection._lifecycle.getSyncError() === terminalError,
        status: collection.status,
        lateVisible: collection.get(`late`),
        lateDurable: adapter.rows.get(`late`),
        applyCalls,
      }).toEqual({
        receiptStatus: `rejected`,
        exactReceipt: true,
        publicErrorIsTerminal: true,
        status: `error`,
        lateVisible: undefined,
        lateDurable: undefined,
        applyCalls: 1,
      })
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

  it.each([`hydration`, `durability`] as const)(
    `fences metadata and truncate transactions after a terminal %s failure`,
    async (failureKind) => {
      const harness = await createTerminalFailureHarness(
        failureKind,
        `terminal-transaction-surface-${failureKind}`,
      )
      const {
        adapter,
        collection,
        coordinator,
        seed,
        sourceParams,
        terminalError,
      } = harness
      const applyCallsBefore = adapter.applyCommittedTxCalls.length
      const publishCallsBefore = coordinator.publishCalls.length
      const operations: Array<{ name: string; apply: () => void }> = [
        {
          name: `row metadata set`,
          apply: () =>
            sourceParams.metadata!.row.set(seed.id, `must-not-replace-row`),
        },
        {
          name: `row metadata delete`,
          apply: () => sourceParams.metadata!.row.delete(seed.id),
        },
        {
          name: `collection metadata set`,
          apply: () =>
            sourceParams.metadata!.collection.set(
              `resume`,
              `must-not-replace-collection`,
            ),
        },
        {
          name: `collection metadata delete`,
          apply: () => sourceParams.metadata!.collection.delete(`resume`),
        },
        {
          name: `truncate`,
          apply: () => sourceParams.truncate(),
        },
      ]
      let hasPrimaryFailure = false

      try {
        for (const operation of operations) {
          sourceParams.begin()
          const operationOutcome = await Promise.resolve()
            .then(operation.apply)
            .then(
              () => ({ status: `fulfilled` as const }),
              (reason: unknown) => ({ status: `rejected` as const, reason }),
            )
          const receiptOutcome = await atPersistedOracleCheckpoint(
            Promise.resolve(sourceParams.commit()).then(
              () => ({ status: `fulfilled` as const }),
              (reason: unknown) => ({ status: `rejected` as const, reason }),
            ),
            `${failureKind} ${operation.name} terminal receipt`,
          )

          expect({
            operation: operationOutcome.status,
            receipt: receiptOutcome.status,
            exactReceipt:
              receiptOutcome.status === `rejected` &&
              receiptOutcome.reason === terminalError,
            visibleSeed: stripVirtualProps(collection.get(seed.id)),
            durableSeed: adapter.rows.get(seed.id),
            rowMetadata: sourceParams.metadata!.row.get(seed.id),
            collectionMetadata: sourceParams.metadata!.collection.get(`resume`),
            applyCalls: adapter.applyCommittedTxCalls.length,
            publishCalls: coordinator.publishCalls.length,
            status: collection.status,
            exactPublicError:
              collection._lifecycle.getSyncError() === terminalError,
          }).toEqual({
            operation: `fulfilled`,
            receipt: `rejected`,
            exactReceipt: true,
            visibleSeed: seed,
            durableSeed: seed,
            rowMetadata: `row-metadata-before-failure`,
            collectionMetadata: `collection-metadata-before-failure`,
            applyCalls: applyCallsBefore,
            publishCalls: publishCallsBefore,
            status: `error`,
            exactPublicError: true,
          })
        }
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

  it(`fences reload, upstream hydration, and late readiness after terminal persistence failure`, async () => {
    const harness = await createTerminalFailureHarness(
      `durability`,
      `terminal-persistence-reload-surfaces`,
    )
    const {
      adapter,
      collection,
      coordinator,
      sourceParams,
      terminalError,
      upstreamLoads,
    } = harness
    const late = { id: `late-reload`, title: `must not hydrate` }
    const loadCallsBefore = adapter.loadSubsetCalls.length
    const upstreamCallsBefore = upstreamLoads.length
    const publishCallsBefore = coordinator.publishCalls.length
    adapter.loadSubset = (collectionId, options, context) => {
      adapter.loadSubsetCalls.push({
        collectionId: recordedStorageId(collectionId),
        options,
        requiredIndexSignatures: context?.requiredIndexSignatures ?? [],
      })
      return Promise.resolve([{ key: late.id, value: late }])
    }
    let hasPrimaryFailure = false

    try {
      const loadOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({ limit: 3 })).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `post-persistence terminal loadSubset`,
      )
      sourceParams.markReady()
      await flushAsyncWork()

      expect({
        loadStatus: loadOutcome.status,
        loadExact:
          loadOutcome.status === `rejected` &&
          loadOutcome.reason === terminalError,
        adapterLoads: adapter.loadSubsetCalls.length,
        upstreamLoads: upstreamLoads.length,
        publishCalls: coordinator.publishCalls.length,
        visibleLate: collection.get(late.id),
        durableLate: adapter.rows.get(late.id),
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
      }).toEqual({
        loadStatus: `rejected`,
        loadExact: true,
        adapterLoads: loadCallsBefore,
        upstreamLoads: upstreamCallsBefore,
        publishCalls: publishCallsBefore,
        visibleLate: undefined,
        durableLate: undefined,
        status: `error`,
        exactPublicError: true,
      })
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

  it(`rejects an already-admitted sibling when the preceding persistence fails`, async () => {
    const adapter = createRecordingAdapter()
    const firstPersistenceEntered = createEventGate()
    const firstPersistence = createEventGate()
    const adapterError = new Error(`first pending persistence failed exactly`)
    const coordinator = createFailStopCoordinatorHarness(
      `terminal-pending-sibling`,
    )
    let applyCalls = 0
    coordinator.requestApplyCommittedTx = async (_collectionId, tx) => {
      applyCalls++
      if (applyCalls === 1) {
        firstPersistenceEntered.resolve()
        try {
          await firstPersistence.promise
        } catch (error) {
          throw new PersistedCollectionDurabilityError(
            `first pending persistence failed`,
            { cause: error },
          )
        }
      }
      return {
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }
    }
    let sourceParams!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-pending-sibling`,
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
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `pending sibling collection ready`,
      )
      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `a`, title: `first publishes before persistence` },
      })
      const firstReceipt = Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        firstPersistenceEntered.promise,
        `first persistence entered before sibling admission`,
      )

      sourceParams.begin()
      sourceParams.write({
        type: `insert`,
        value: { id: `b`, title: `must not publish or persist` },
      })
      const secondReceipt = Promise.resolve(sourceParams.commit()).then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const secondSettlement = observeSettlement(
        secondReceipt.then(
          () => undefined,
          () => undefined,
        ),
      )
      expect(secondSettlement.read()).toEqual({ status: `pending` })

      firstPersistence.reject(adapterError)
      const firstOutcome = await atPersistedOracleCheckpoint(
        firstReceipt,
        `first failed persistence receipt`,
      )
      const terminalError =
        firstOutcome.status === `rejected` ? firstOutcome.reason : undefined
      const secondOutcome = await atPersistedOracleCheckpoint(
        secondReceipt,
        `already-admitted sibling terminal receipt`,
      )

      expect({
        firstStatus: firstOutcome.status,
        terminalName:
          terminalError instanceof Error ? terminalError.name : undefined,
        terminalCause:
          terminalError instanceof Error ? terminalError.cause : undefined,
        secondStatus: secondOutcome.status,
        secondExact:
          secondOutcome.status === `rejected` &&
          secondOutcome.reason === terminalError,
        applyCalls,
        firstVisible: stripVirtualProps(collection.get(`a`)),
        firstDurable: adapter.rows.get(`a`),
        secondVisible: collection.get(`b`),
        secondDurable: adapter.rows.get(`b`),
        publishCalls: coordinator.publishCalls.length,
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
      }).toEqual({
        firstStatus: `rejected`,
        terminalName: `PersistedCollectionDurabilityError`,
        terminalCause: adapterError,
        secondStatus: `rejected`,
        secondExact: true,
        applyCalls: 1,
        firstVisible: {
          id: `a`,
          title: `first publishes before persistence`,
        },
        firstDurable: undefined,
        secondVisible: undefined,
        secondDurable: undefined,
        publishCalls: 0,
        status: `error`,
        exactPublicError: true,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      firstPersistence.reject(adapterError)
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`marks direct adapter failure terminal and fences later local mutations`, async () => {
    const adapter = createRecordingAdapter()
    const adapterError = Object.assign(
      new Error(`local adapter failed exactly`),
      {
        code: `SQLITE_IOERR`,
        path: `adapter.applyCommittedTx`,
      },
    )
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    let applyCalls = 0
    adapter.applyCommittedTx = async (...args) => {
      applyCalls++
      if (applyCalls === 1) throw adapterError
      await successfulApply(...args)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-loopback-local-durability`,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `local durability collection ready`,
      )
      const firstTransaction = collection.insert({
        id: `first-local`,
        title: `must roll back`,
      })
      const firstOutcome = await atPersistedOracleCheckpoint(
        firstTransaction.isPersisted.promise.then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `first local durability failure`,
      )
      const terminalError =
        firstOutcome.status === `rejected` ? firstOutcome.reason : undefined

      const loadCallsBefore = adapter.loadSubsetCalls.length
      adapter.loadSubset = (collectionId, options, context) => {
        adapter.loadSubsetCalls.push({
          collectionId: recordedStorageId(collectionId),
          options,
          requiredIndexSignatures: context?.requiredIndexSignatures ?? [],
        })
        return Promise.resolve([
          {
            key: `forced-late`,
            value: { id: `forced-late`, title: `must not hydrate` },
          },
        ])
      }
      const forceOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(collection.utils.forceReloadSubset!({ limit: 4 })).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `force reload after local durability failure`,
      )

      const lateOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve()
          .then(async () => {
            const lateTransaction = collection.insert({
              id: `late-local`,
              title: `must not be admitted`,
            })
            await lateTransaction.isPersisted.promise
          })
          .then(
            () => ({ status: `fulfilled` as const }),
            (reason: unknown) => ({ status: `rejected` as const, reason }),
          ),
        `late local terminal receipt`,
      )

      expect({
        firstStatus: firstOutcome.status,
        errorName:
          terminalError instanceof Error ? terminalError.name : undefined,
        errorCause:
          terminalError instanceof Error ? terminalError.cause : undefined,
        errorCode:
          terminalError instanceof Error
            ? (terminalError as Error & { code?: unknown }).code
            : undefined,
        forceStatus: forceOutcome.status,
        forceExact:
          forceOutcome.status === `rejected` &&
          forceOutcome.reason === terminalError,
        loadCalls: adapter.loadSubsetCalls.length,
        forceVisible: collection.get(`forced-late`),
        lateStatus: lateOutcome.status,
        lateErrorName:
          lateOutcome.status === `rejected` &&
          lateOutcome.reason instanceof Error
            ? lateOutcome.reason.name
            : undefined,
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
        applyCalls,
        firstVisible: collection.get(`first-local`),
        firstDurable: adapter.rows.get(`first-local`),
        lateVisible: collection.get(`late-local`),
        lateDurable: adapter.rows.get(`late-local`),
      }).toEqual({
        firstStatus: `rejected`,
        errorName: `PersistedCollectionDurabilityError`,
        errorCause: adapterError,
        errorCode: `SQLITE_IOERR`,
        forceStatus: `rejected`,
        forceExact: true,
        loadCalls: loadCallsBefore,
        forceVisible: undefined,
        lateStatus: `rejected`,
        lateErrorName: `CollectionStateError`,
        status: `error`,
        exactPublicError: true,
        applyCalls: 1,
        firstVisible: undefined,
        firstDurable: undefined,
        lateVisible: undefined,
        lateDurable: undefined,
      })
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

  it(`fences direct acceptMutations and local mutations after hydration failure`, async () => {
    const adapter = createRecordingAdapter()
    const hydrationError = new Error(`loopback hydration failed exactly`)
    const restoreBaselineRows = overrideBaselineRows(adapter, () =>
      Promise.reject(hydrationError),
    )
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `terminal-loopback-hydration`,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )
    let hasPrimaryFailure = false

    try {
      await expect(
        atPersistedOracleCheckpoint(
          collection.stateWhenReady(),
          `loopback hydration rejected`,
        ),
      ).rejects.toBe(hydrationError)
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(hydrationError)

      restoreBaselineRows()
      const now = new Date()
      const directRow = { id: `direct`, title: `must not be accepted` }
      const directMutation: PendingMutation<Todo, `insert`> = {
        mutationId: `direct-after-hydration`,
        original: {},
        modified: directRow,
        changes: directRow,
        globalKey: `terminal-loopback-hydration:direct`,
        key: directRow.id,
        type: `insert`,
        metadata: undefined,
        syncMetadata: {},
        optimistic: true,
        createdAt: now,
        updatedAt: now,
        collection,
      }
      const directOutcome = await atPersistedOracleCheckpoint(
        Promise.resolve(
          collection.utils.acceptMutations({
            mutations: [
              directMutation as unknown as PendingMutation<
                Record<string, unknown>
              >,
            ],
          }),
        ).then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        ),
        `direct acceptMutations after hydration failure`,
      )
      const localOutcome = await Promise.resolve()
        .then(() =>
          collection.insert({
            id: `late-local-hydration`,
            title: `must not be admitted`,
          }),
        )
        .then(
          () => ({ status: `fulfilled` as const }),
          (reason: unknown) => ({ status: `rejected` as const, reason }),
        )

      expect({
        directStatus: directOutcome.status,
        directExact:
          directOutcome.status === `rejected` &&
          directOutcome.reason === hydrationError,
        localStatus: localOutcome.status,
        localErrorName:
          localOutcome.status === `rejected` &&
          localOutcome.reason instanceof Error
            ? localOutcome.reason.name
            : undefined,
        status: collection.status,
        exactPublicError:
          collection._lifecycle.getSyncError() === hydrationError,
        applyCalls: adapter.applyCommittedTxCalls.length,
        directVisible: collection.get(directRow.id),
        directDurable: adapter.rows.get(directRow.id),
        localVisible: collection.get(`late-local-hydration`),
        localDurable: adapter.rows.get(`late-local-hydration`),
      }).toEqual({
        directStatus: `rejected`,
        directExact: true,
        localStatus: `rejected`,
        localErrorName: `CollectionStateError`,
        status: `error`,
        exactPublicError: true,
        applyCalls: 0,
        directVisible: undefined,
        directDurable: undefined,
        localVisible: undefined,
        localDurable: undefined,
      })
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

  it(`replays a hydration-buffered write before its named durability rejection`, async () => {
    const adapter = createRecordingAdapter()
    let releaseHydration: (() => void) | undefined
    adapter.loadResumeSnapshot = (_collectionId, options) => {
      const snapshot = {
        rows: [],
        keySet: { status: `consistent` as const },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }
      if (options?.includeRows === false) {
        return Promise.resolve(snapshot)
      }
      return new Promise((resolve) => {
        releaseHydration = () => resolve(snapshot)
      })
    }
    const persistenceError = Object.assign(
      new Error(`buffered persistence failed`),
      {
        code: `SQLITE_FULL`,
        path: `todos.sqlite`,
      },
    )
    let rejectPersistence: ((error: unknown) => void) | undefined
    adapter.applyCommittedTx = () =>
      new Promise<void>((_resolve, reject) => {
        rejectPersistence = reject
      })

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-buffered-persistence-error`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      void collection.stateWhenReady().catch(() => undefined)
      await vi.waitFor(() => {
        expect(releaseHydration).toBeTypeOf(`function`)
        expect(remoteCommit).toBeTypeOf(`function`)
      })
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `buffered`, title: `Published before failure` },
      })
      const receipt = Promise.resolve(remoteCommit?.())
      let settled = false
      void receipt.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )

      expect(collection.get(`buffered`)).toBeUndefined()
      expect(settled).toBe(false)
      releaseHydration!()
      await vi.waitFor(() => expect(rejectPersistence).toBeTypeOf(`function`))

      expect(stripVirtualProps(collection.get(`buffered`))).toEqual({
        id: `buffered`,
        title: `Published before failure`,
      })
      expect(settled).toBe(false)

      rejectPersistence!(persistenceError)
      const rejection = await receipt.then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(rejection).not.toBe(persistenceError)
      expect(rejection).toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        code: `SQLITE_FULL`,
        path: `todos.sqlite`,
        cause: persistenceError,
      })
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(rejection)
    } finally {
      releaseHydration?.()
      rejectPersistence?.(persistenceError)
      await collection.cleanup()
      warning.mockRestore()
    }
  })

  it(`preserves row metadata set before a metadata-less insert in the same sync transaction`, async () => {
    const adapter = createRecordingAdapter()
    const ownership = { queryCollection: { owners: [`gc:q1`] } }
    const sync: SyncConfig<Todo, string> = {
      sync: ({ begin, write, commit, markReady, metadata }) => {
        begin()
        metadata?.row.set(`remote-1`, ownership)
        write({
          type: `insert`,
          value: {
            id: `remote-1`,
            title: `From remote`,
          },
        })
        commit()
        markReady()
      },
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item: Todo) => item.id,
        sync,
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(adapter.rowMetadata.get(`remote-1`)).toEqual(ownership)
    expect(collection._state.syncedMetadata.get(`remote-1`)).toEqual(ownership)
  })

  it(`resets stale row metadata for a metadata-less insert with no queued metadata`, async () => {
    const adapter = createRecordingAdapter()
    adapter.rowMetadata.set(`remote-1`, { stale: true })
    const sync: SyncConfig<Todo, string> = {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: {
            id: `remote-1`,
            title: `From remote`,
          },
        })
        commit()
        markReady()
      },
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item: Todo) => item.id,
        sync,
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(adapter.rowMetadata.has(`remote-1`)).toBe(false)
  })

  it(`uses a stable generated collection id in sync-present mode when id is omitted`, async () => {
    const adapter = createRecordingAdapter()
    const options = persistedCollectionOptions<Todo, string>({
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: {
        adapter,
      },
    })

    expect(options.id).toBeDefined()

    const collection = createCollection(options)
    await collection.preload()
    await flushAsyncWork()

    expect(collection.id).toBe(options.id)
    expect(adapter.loadResumeSnapshotCalls[0]?.collectionId).toBe(collection.id)
  })
})
