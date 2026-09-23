import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  DbClient,
  IR,
  collectionOptions,
  createCollection,
  createTransaction,
} from '@tanstack/db'
import {
  IndeterminateCommitError,
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidSyncConfigError,
  SingleProcessCoordinator,
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
  persistedCollectionOptions,
  toTransportedLoadSubsetOptions,
} from '../src'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistedSyncWrappedOptions,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
  RemoteSubsetOwner,
  TxCommitted,
} from '../src'
import type {
  Collection,
  LoadSubsetOptions,
  Subscription,
  SyncConfig,
} from '@tanstack/db'

/**
 * # Does persisted wrapping preserve one Collection history?
 *
 * Persistence adds a durable replica beneath an optional upstream sync source.
 * Startup hydrates rows and metadata, buffers concurrent remote work, then
 * publishes one coherent public snapshot. Complete committed transactions
 * route through the configured collection owner. Publication may precede
 * durability settlement, but a later failure must stay observable.
 *
 * The recording adapter is a plain durable-state model: Maps for rows and
 * metadata plus ordered transaction, index, load, and reload calls. Histories
 * vary hydration, source commits, applied receipts, remote subset demand,
 * acquisition release, retry, failure, cleanup, and restart. The driver uses
 * the real persisted wrapper, Collection, coordinator, transactions, and
 * indexes.
 *
 * Refinement checkpoints compare public rows, durable state, metadata, request
 * data, sequence evidence, exact errors, and late-work fencing. Fixed hostile
 * values challenge wire admission. Controlled failures challenge publication
 * and durability classification. Focused Browser and Electron suites own the
 * multiprocess transport and host-specific replay partitions.
 *
 * Known omissions: driver SQL behavior, native host ownership, and the shared
 * conformance portfolio have separate owners. This file proves the role
 * partition for non-single-process remote demand: an ownerless elected node
 * does not route, while a follower may route to the elected owner's registered
 * source.
 */

/**
 * # Does persisted wrapping preserve one Collection history?
 *
 * Persistence adds a durable replica beneath an optional upstream sync source.
 * Startup hydrates rows and metadata, buffers concurrent remote work, then
 * publishes one coherent state. Committed transactions persist in sequence;
 * gaps recover through deltas or reload. Subset demands keep local and upstream
 * ownership separate so cancellation, release, offline mode, and retry cannot
 * steal a sibling acquisition lease.
 *
 * The recording adapter is a plain durable-state model: Maps for rows and
 * metadata plus ordered transaction, index, load, and reload calls. Tests drive
 * the real wrapper, Collection, coordinator, receipts, transactions, indexes,
 * cleanup, and restart. They compare durable state, public rows, metadata,
 * request options, sequence evidence, errors, and late-work fencing.
 *
 * Known omissions: driver SQL behavior, browser page ownership, native
 * runtimes, and the shared conformance portfolio have separate owners. This
 * file models persistence protocol state, not a particular SQLite engine.
 */

type Todo = {
  id: string
  title: string
}

type RecordingAdapter = PersistenceAdapter & {
  applyCommittedTxCalls: Array<{
    collectionId: string
    tx: {
      term: number
      seq: number
      rowVersion: number
      truncate?: boolean
      mutations: Array<{
        type: `insert` | `update` | `delete`
        key: string | number
      }>
    }
  }>
  ensureIndexCalls: Array<{ collectionId: string; signature: string }>
  markIndexRemovedCalls: Array<{ collectionId: string; signature: string }>
  loadSubsetCalls: Array<{
    collectionId: string
    options: LoadSubsetOptions
    requiredIndexSignatures: ReadonlyArray<string>
  }>
  loadCollectionMetadataCalls: Array<string>
  rows: Map<string, Todo>
  rowMetadata: Map<string, unknown>
  collectionMetadata: Map<string, unknown>
}

function createRecordingAdapter(
  initialRows: Array<Todo> = [],
): RecordingAdapter {
  const rows = new Map(initialRows.map((row) => [row.id, row]))
  const rowMetadata = new Map<string, unknown>()

  const adapter: RecordingAdapter = {
    rows,
    rowMetadata,
    collectionMetadata: new Map(),
    applyCommittedTxCalls: [],
    ensureIndexCalls: [],
    markIndexRemovedCalls: [],
    loadSubsetCalls: [],
    loadCollectionMetadataCalls: [],
    loadSubset: (collectionId, options, ctx) => {
      adapter.loadSubsetCalls.push({
        collectionId,
        options,
        requiredIndexSignatures: ctx?.requiredIndexSignatures ?? [],
      })
      return Promise.resolve(
        Array.from(rows.values()).map((value) => ({
          key: value.id,
          value,
          metadata: rowMetadata.get(value.id),
        })),
      )
    },
    loadCollectionMetadata: (collectionId) => {
      adapter.loadCollectionMetadataCalls.push(collectionId)
      return Promise.resolve(
        Array.from(adapter.collectionMetadata.entries()).map(
          ([key, value]) => ({
            key,
            value,
          }),
        ),
      )
    },
    scanRows: () =>
      Promise.resolve(
        Array.from(rows.values()).map((value) => ({
          key: value.id,
          value,
          metadata: rowMetadata.get(value.id),
        })),
      ),
    applyCommittedTx: (collectionId, tx) => {
      adapter.applyCommittedTxCalls.push({
        collectionId,
        tx: {
          term: tx.term,
          seq: tx.seq,
          rowVersion: tx.rowVersion,
          truncate: tx.truncate,
          mutations: tx.mutations.map((mutation) => ({
            type: mutation.type,
            key: mutation.key,
          })),
        },
      })

      if (tx.truncate) {
        rows.clear()
        rowMetadata.clear()
      }

      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key as string)
          rowMetadata.delete(mutation.key as string)
        } else {
          rows.set(mutation.key as string, mutation.value as Todo)
          if (mutation.metadataChanged) {
            rowMetadata.set(mutation.key as string, mutation.metadata)
          }
        }
      }
      for (const rowMetadataMutation of tx.rowMetadataMutations ?? []) {
        if (rowMetadataMutation.type === `delete`) {
          rowMetadata.delete(rowMetadataMutation.key as string)
        } else {
          rowMetadata.set(
            rowMetadataMutation.key as string,
            rowMetadataMutation.value,
          )
        }
      }
      for (const metadataMutation of tx.collectionMetadataMutations ?? []) {
        if (metadataMutation.type === `delete`) {
          adapter.collectionMetadata.delete(metadataMutation.key)
        } else {
          adapter.collectionMetadata.set(
            metadataMutation.key,
            metadataMutation.value,
          )
        }
      }
      return Promise.resolve()
    },
    ensureIndex: (collectionId, signature) => {
      adapter.ensureIndexCalls.push({ collectionId, signature })
      return Promise.resolve()
    },
    markIndexRemoved: (collectionId, signature) => {
      adapter.markIndexRemovedCalls.push({ collectionId, signature })
      return Promise.resolve()
    },
  }

  return adapter
}

function createNoopAdapter(): PersistenceAdapter {
  return {
    loadSubset: () => Promise.resolve([]),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
}

type CoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (payload: TxCommitted, senderId?: string) => void
  pullSinceCalls: number
  setPullSinceResponse: (response: PullSinceResponse) => void
}

function createCoordinatorHarness(): CoordinatorHarness {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined =
    undefined
  let pullSinceResponse: PullSinceResponse = {
    type: `rpc:pullSince:res`,
    rpcId: `pull-0`,
    ok: true,
    latestTerm: 1,
    latestSeq: 0,
    latestRowVersion: 0,
    requiresFullReload: false,
    changedKeys: [],
    deletedKeys: [],
  }

  const harness: CoordinatorHarness = {
    pullSinceCalls: 0,
    getNodeId: () => `coordinator-node`,
    subscribe: (_collectionId, onMessage) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    publish: () => {},
    isLeader: () => true,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    requestEnsureRemoteSubset: async () => {},
    // Remote subset ownership is outside this protocol-delivery harness.
    requestReleaseRemoteSubset: async () => {},
    registerRemoteSubsetOwner: () => () => {},
    requestApplyCommittedTx: (_collectionId, tx) =>
      Promise.resolve({
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }),
    pullSince: () => {
      harness.pullSinceCalls++
      return Promise.resolve(pullSinceResponse)
    },
    emit: (payload, senderId = `remote-node`) => {
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId: `sync-present`,
        senderId,
        ts: Date.now(),
        payload,
      })
    },
    setPullSinceResponse: (response) => {
      pullSinceResponse = response
    },
  }

  return harness
}

const stripVirtualProps = <T extends Record<string, any> | undefined>(
  value: T,
): T => {
  if (!value || typeof value !== `object`) return value
  const {
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = value as Record<string, unknown>
  return rest as T
}

async function flushAsyncWork(delayMs: number = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

describe(`persistedCollectionOptions`, () => {
  it(`preserves exact reconciliation context for an indeterminate commit`, () => {
    const cause = new Error(`response channel closed`)
    const error = new IndeterminateCommitError({
      collectionId: `todos`,
      requestType: `rpc:applyCommittedTx:req`,
      previousLeaderId: `leader-a`,
      previousTerm: 4,
      currentLeaderId: `leader-b`,
      currentTerm: 5,
      cause,
    })

    expect(error).toMatchObject({
      name: `IndeterminateCommitError`,
      code: `INDETERMINATE_COMMIT`,
      collectionId: `todos`,
      requestType: `rpc:applyCommittedTx:req`,
      previousLeaderId: `leader-a`,
      previousTerm: 4,
      currentLeaderId: `leader-b`,
      currentTerm: 5,
      cause,
    })
    expect(error.message).toContain(
      `rpc:applyCommittedTx:req crossed leadership from leader-a (term 4) to leader-b (term 5)`,
    )
  })

  it(`provides a sync-absent loopback configuration with persisted utils`, async () => {
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-loopback`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
        },
      }),
    )

    const insertTx = collection.insert({
      id: `1`,
      title: `Phase 0`,
    })

    await insertTx.isPersisted.promise

    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Phase 0`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.mutations[0]?.type).toBe(
      `insert`,
    )
    expect(typeof collection.utils.acceptMutations).toBe(`function`)
    expect(collection.utils.getLeadershipState?.().isLeader).toBe(true)
  })

  it(`supports acceptMutations for manual transactions`, async () => {
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-manual`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
        },
      }),
    )

    const tx = createTransaction({
      autoCommit: false,
      mutationFn: async ({ transaction }) => {
        await collection.utils.acceptMutations(transaction)
      },
    })

    tx.mutate(() => {
      collection.insert({
        id: `manual-1`,
        title: `Manual`,
      })
    })

    await tx.commit()

    expect(stripVirtualProps(collection.get(`manual-1`))).toEqual({
      id: `manual-1`,
      title: `Manual`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
  })

  it(`loads collection metadata into collection state during startup`, async () => {
    const adapter = createRecordingAdapter()
    adapter.collectionMetadata.set(`electric:resume`, {
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-startup-metadata`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()

    expect(adapter.loadCollectionMetadataCalls).toEqual([
      `persisted-startup-metadata`,
    ])
    expect(
      collection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })
  })

  it(`restores row and collection metadata after metadata-bearing full reload`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Tracked`,
      },
    ])
    adapter.rowMetadata.set(`1`, {
      source: `initial`,
    })
    adapter.collectionMetadata.set(`electric:resume`, {
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()
    await flushAsyncWork()

    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `initial`,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `resume`,
      offset: `10_0`,
      handle: `handle-1`,
      shapeId: `shape-1`,
      updatedAt: 1,
    })

    adapter.rowMetadata.set(`1`, {
      source: `reloaded`,
    })
    adapter.collectionMetadata.delete(`electric:resume`)
    adapter.collectionMetadata.set(`queryCollection:gc:q1`, {
      queryHash: `q1`,
      mode: `until-revalidated`,
    })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `reloaded`,
    })
    expect(
      collection._state.syncedCollectionMetadata.has(`electric:resume`),
    ).toBe(false)
    expect(
      collection._state.syncedCollectionMetadata.get(`queryCollection:gc:q1`),
    ).toEqual({
      queryHash: `q1`,
      mode: `until-revalidated`,
    })
  })

  it(`persists metadata-only wrapped sync transactions`, async () => {
    const adapter = createRecordingAdapter()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-metadata-only`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, markReady, metadata }) => {
            begin()
            metadata?.collection.set(`runtime:key`, { persisted: true })
            commit()
            markReady()
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.mutations).toEqual([])
    expect(adapter.collectionMetadata.get(`runtime:key`)).toEqual({
      persisted: true,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`runtime:key`),
    ).toEqual({
      persisted: true,
    })
  })

  it(`replays metadata-only tx:committed deltas without full reload`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Tracked`,
      },
    ])
    adapter.rowMetadata.set(`1`, { source: `initial` })
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    const loadSubsetCallsAfterPreload = adapter.loadSubsetCalls.length

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-metadata-only`,
      latestRowVersion: 2,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
      rowMetadataMutations: [
        {
          type: `set`,
          key: `1`,
          value: { source: `replayed` },
        },
      ],
      collectionMetadataMutations: [
        {
          type: `set`,
          key: `electric:resume`,
          value: {
            kind: `reset`,
            updatedAt: 2,
          },
        },
      ],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(adapter.loadSubsetCalls.length).toBe(loadSubsetCallsAfterPreload)
    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `replayed`,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `reset`,
      updatedAt: 2,
    })
  })

  it(`uses pullSince replay deltas for metadata-bearing seq-gap recovery`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Tracked`,
      },
    ])
    adapter.rowMetadata.set(`1`, { source: `initial` })
    const coordinator = createCoordinatorHarness()
    coordinator.setPullSinceResponse({
      type: `rpc:pullSince:res`,
      rpcId: `pull-metadata`,
      ok: true,
      latestTerm: 1,
      latestSeq: 3,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedKeys: [],
      deletedKeys: [],
      deltas: [
        {
          txId: `tx-gap-1`,
          latestRowVersion: 2,
          changedRows: [],
          deletedKeys: [],
          rowMetadataMutations: [
            {
              type: `set`,
              key: `1`,
              value: { source: `gap-replayed` },
            },
          ],
          collectionMetadataMutations: [],
        },
        {
          txId: `tx-gap-2`,
          latestRowVersion: 3,
          changedRows: [],
          deletedKeys: [],
          rowMetadataMutations: [],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `queryCollection:gc:q1`,
              value: {
                queryHash: `q1`,
                mode: `until-revalidated`,
              },
            },
          ],
        },
      ],
    })

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    const loadSubsetCallsAfterPreload = adapter.loadSubsetCalls.length

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 3,
      txId: `tx-gap-trigger`,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(coordinator.pullSinceCalls).toBe(1)
    expect(adapter.loadSubsetCalls.length).toBe(loadSubsetCallsAfterPreload)
    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `gap-replayed`,
    })
    expect(
      collection._state.syncedCollectionMetadata.get(`queryCollection:gc:q1`),
    ).toEqual({
      queryHash: `q1`,
      mode: `until-revalidated`,
    })
  })

  it(`throws InvalidSyncConfigError when sync key is present but null`, () => {
    const invalidOptions = {
      id: `invalid-sync-null`,
      getKey: (item: Todo) => item.id,
      sync: null,
      persistence: {
        adapter: createNoopAdapter(),
      },
    } as unknown as PersistedSyncWrappedOptions<Todo, string>

    expect(() => persistedCollectionOptions(invalidOptions)).toThrow(
      InvalidSyncConfigError,
    )
  })

  it(`throws InvalidSyncConfigError when sync key is present but invalid`, () => {
    const invalidOptions = {
      id: `invalid-sync-shape`,
      getKey: (item: Todo) => item.id,
      sync: {} as unknown as SyncConfig<Todo, string>,
      persistence: {
        adapter: createNoopAdapter(),
      },
    } as PersistedSyncWrappedOptions<Todo, string>

    expect(() => persistedCollectionOptions(invalidOptions)).toThrow(
      InvalidSyncConfigError,
    )
  })

  it(`uses SingleProcessCoordinator when coordinator is omitted`, () => {
    const options = persistedCollectionOptions<Todo, string>({
      id: `default-coordinator`,
      getKey: (item) => item.id,
      persistence: {
        adapter: createNoopAdapter(),
      },
    })

    expect(options.persistence.coordinator).toBeInstanceOf(
      SingleProcessCoordinator,
    )
  })

  it(`coalesces duplicate single-process subset acknowledgements until owner work finishes`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-coalesced`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const owner = Object.assign(
      vi.fn(() => loadGate),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      let firstSettled = false
      let duplicateSettled = false
      const first = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          firstSettled = true
        })
      await Promise.resolve()
      const duplicate = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          duplicateSettled = true
        })
      await Promise.resolve()

      expect({
        ownerCalls: owner.mock.calls.length,
        firstSettled,
        duplicateSettled,
      }).toEqual({
        ownerCalls: 1,
        firstSettled: false,
        duplicateSettled: false,
      })

      releaseLoad()
      await Promise.all([first, duplicate])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`preserves process-local subset lifecycle fields for owner load and unload`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-live-fields`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const signal = new AbortController().signal
    const subscription = {
      on: () => () => {},
    } as unknown as Subscription
    const options: LoadSubsetOptions = { limit: 1, signal, subscription }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      expect(owner).toHaveBeenCalledTimes(1)
      const delivered = owner.mock.calls[0]![0] as LoadSubsetOptions
      expect(delivered).toMatchObject({ limit: 1 })
      expect(delivered.signal).toBe(signal)
      expect(delivered.subscription).toBe(subscription)

      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      expect(owner.unloadSubset).toHaveBeenCalledTimes(1)
      expect(owner.unloadSubset).toHaveBeenCalledWith(delivered)
    } finally {
      unregisterOwner()
    }
  })

  it(`coalesces same-stack single-process subset reentry until owner work finishes`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-reentrant`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const options: LoadSubsetOptions = { limit: 1 }
    let duplicate: Promise<void> | undefined
    let didReenter = false
    const owner = Object.assign(
      vi.fn(() => {
        if (!didReenter) {
          didReenter = true
          duplicate = coordinator.requestEnsureRemoteSubset(`todos`, options)
        }
        return loadGate
      }),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )

    try {
      let firstSettled = false
      let duplicateSettled = false
      const first = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          firstSettled = true
        })
      await Promise.resolve()
      const duplicateResult = duplicate!.then(() => {
        duplicateSettled = true
      })
      await Promise.resolve()

      expect({
        ownerCalls: owner.mock.calls.length,
        firstSettled,
        duplicateSettled,
      }).toEqual({
        ownerCalls: 1,
        firstSettled: false,
        duplicateSettled: false,
      })

      releaseLoad()
      await Promise.all([first, duplicateResult])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`waits for a pending single-process subset load before unloading it`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-release-order`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const events: Array<string> = []
    const owner = Object.assign(
      vi.fn(async () => {
        events.push(`load-start`)
        await loadGate
        events.push(`load-finish`)
      }),
      {
        unloadSubset: vi.fn(() => {
          events.push(`unload`)
        }),
        onError: vi.fn(),
      },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      const load = coordinator.requestEnsureRemoteSubset(`todos`, options)
      await Promise.resolve()
      let releaseSettled = false
      const release = coordinator
        .requestReleaseRemoteSubset(`todos`, options)
        .then(() => {
          releaseSettled = true
        })
      await Promise.resolve()

      const beforeLoadRelease = { events: [...events], releaseSettled }
      expect(beforeLoadRelease).toEqual({
        events: [`load-start`],
        releaseSettled: false,
      })

      releaseLoad()
      await Promise.all([load, release])
      expect(events).toEqual([`load-start`, `load-finish`, `unload`])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`rejects unsupported single-process subset values before owner work`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-domain`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )

    try {
      await expect(
        coordinator.requestEnsureRemoteSubset(`todos`, {
          where: new IR.Func(`in`, [
            new IR.PropRef([`todos`, `status`]),
            new IR.Value([`kept`, () => {}]),
          ]),
        }),
      ).rejects.toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path: `options.where.args[1].value[1]`,
      })
      expect(owner).not.toHaveBeenCalled()
    } finally {
      unregisterOwner()
    }
  })

  it(`rejects a sparse function argument at its exact expression path`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-hole`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const args = [new IR.PropRef([`todos`, `status`])]
    args.length = 2

    try {
      await expect(
        coordinator.requestEnsureRemoteSubset(`todos`, {
          where: new IR.Func(`eq`, args),
        }),
      ).rejects.toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path: `options.where.args[1]`,
      })
      expect(owner).not.toHaveBeenCalled()
    } finally {
      unregisterOwner()
    }
  })

  it(`projects lexical comparison options without locale-only wire fields`, () => {
    const projected = toTransportedLoadSubsetOptions({
      orderBy: [
        {
          expression: new IR.PropRef([`todos`, `title`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `lexical`,
            locale: `en`,
            localeOptions: { sensitivity: `base` },
          },
        },
      ],
    } as unknown as LoadSubsetOptions)

    expect(projected.orderBy?.[0]?.compareOptions).toEqual({
      direction: `asc`,
      nulls: `last`,
      stringSort: `lexical`,
    })
  })

  it(`preserves locale comparison fields when the optional sort mode is omitted`, () => {
    const projected = toTransportedLoadSubsetOptions({
      orderBy: [
        {
          expression: new IR.PropRef([`todos`, `title`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            locale: `en`,
            localeOptions: { sensitivity: `base` },
          },
        },
      ],
    } as LoadSubsetOptions)

    expect(projected.orderBy?.[0]?.compareOptions).toEqual({
      direction: `asc`,
      nulls: `last`,
      locale: `en`,
      localeOptions: { sensitivity: `base` },
    })
  })

  it.each([
    [`limit`, { limit: Number.NaN }, `options.limit`],
    [`limit`, { limit: Number.POSITIVE_INFINITY }, `options.limit`],
    [`limit`, { limit: -1 }, `options.limit`],
    [`limit`, { limit: 0.5 }, `options.limit`],
    [`limit`, { limit: Number.MAX_SAFE_INTEGER + 1 }, `options.limit`],
    [`offset`, { offset: Number.NaN }, `options.offset`],
    [`offset`, { offset: Number.NEGATIVE_INFINITY }, `options.offset`],
    [`offset`, { offset: -1 }, `options.offset`],
    [`offset`, { offset: 0.5 }, `options.offset`],
    [`offset`, { offset: Number.MAX_SAFE_INTEGER + 1 }, `options.offset`],
  ] as const)(
    `rejects an invalid transported subset %s before owner work`,
    (_field, options, path) => {
      let error: unknown
      try {
        toTransportedLoadSubsetOptions(options)
      } catch (caught) {
        error = caught
      }
      expect(error).toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path,
      })
    },
  )

  it(`preserves valid transported subset window boundaries`, () => {
    expect(
      toTransportedLoadSubsetOptions({
        limit: 0,
        offset: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ limit: 0, offset: Number.MAX_SAFE_INTEGER })
  })

  it(`reports and rethrows a single-process owner unload rejection`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-unload-error`)
    const unloadError = new Error(`single-process owner unload failed`)
    const ownerErrors: Array<unknown> = []
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(() =>
        Promise.reject(unloadError),
      ) as unknown as RemoteSubsetOwner[`unloadSubset`],
      onError: (error: unknown) => ownerErrors.push(error),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      await expect(
        coordinator.requestReleaseRemoteSubset(`todos`, options),
      ).rejects.toBe(unloadError)
      expect(ownerErrors).toEqual([unloadError])
    } finally {
      unregisterOwner()
    }
  })

  it(`reports one fail-stop lifecycle error when a single-process async unload rejects`, async () => {
    const unloadError = new Error(`remote owner unload failed`)
    let unloadThenCalls = 0
    const rejectingThenable = {
      then: (
        _resolve: (value?: void) => void,
        reject: (error: unknown) => void,
      ) => {
        unloadThenCalls++
        queueMicrotask(() => reject(unloadError))
      },
    }
    const sourceUnloadMock = vi.fn((options: LoadSubsetOptions) =>
      options.limit === 1 ? rejectingThenable : undefined,
    )
    const sourceUnload = sourceUnloadMock as unknown as (
      options: LoadSubsetOptions,
    ) => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `owner-unload-error`,
        getKey: (todo) => todo.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => true,
              unloadSubset: sourceUnload,
            }
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
        },
      }),
    )
    const failing: LoadSubsetOptions = { limit: 1 }
    const sibling: LoadSubsetOptions = { limit: 2 }
    const markError = vi.spyOn(collection._lifecycle, `markError`)
    const unhandled: Array<unknown> = []
    const captureUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, captureUnhandled)

    try {
      collection.startSyncImmediate()
      await collection._sync.loadSubset(failing)
      await collection._sync.loadSubset(sibling)
      collection._sync.unloadSubset(failing)
      collection._sync.unloadSubset(sibling)
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        status: collection.status,
        error: collection._lifecycle.getSyncError(),
        unloadThenCalls,
        unloadOptions: sourceUnloadMock.mock.calls.map(([options]) => options),
        lifecycleErrors: markError.mock.calls.map(([error]) => error),
        unhandled,
      }).toEqual({
        status: `error`,
        error: unloadError,
        unloadThenCalls: 1,
        unloadOptions: [failing, sibling],
        lifecycleErrors: [unloadError],
        unhandled: [],
      })

      await flushAsyncWork()
      expect(sourceUnloadMock).toHaveBeenCalledTimes(2)
      expect(markError).toHaveBeenCalledTimes(1)
    } finally {
      process.off(`unhandledRejection`, captureUnhandled)
      await collection.cleanup()
    }
  })

  it(`surfaces duplicate remote-subset owner registration through the collection lifecycle`, async () => {
    const coordinator = new SingleProcessCoordinator()
    const unhandled: Array<unknown> = []
    const sourceLoads: Array<string> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const create = (label: string) =>
      createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `duplicate-owner-lifecycle`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: () => {
                  sourceLoads.push(label)
                  return true
                },
                unloadSubset: () => {},
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
    const first = create(`first`)
    let duplicate: ReturnType<typeof create> | undefined

    try {
      first.startSyncImmediate()
      await first.stateWhenReady()
      await vi.waitFor(() =>
        expect(
          (
            coordinator as unknown as {
              remoteSubsetOwners: Map<string, RemoteSubsetOwner>
            }
          ).remoteSubsetOwners.size,
        ).toBe(1),
      )
      duplicate = create(`duplicate`)
      duplicate.startSyncImmediate()
      const readinessError = await duplicate.stateWhenReady().then(
        () => undefined,
        (error: unknown) => error,
      )
      await flushAsyncWork()

      expect(readinessError).toMatchObject({
        name: `DuplicateRemoteSubsetOwnerError`,
        collectionId: `duplicate-owner-lifecycle`,
      })
      expect(duplicate.status).toBe(`error`)
      expect(sourceLoads).toEqual([])
      expect(unhandled).toEqual([])
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      await duplicate?.cleanup()
      await first.cleanup()
    }
  })

  it(`resolves persistence per collection and forwards schemaVersion`, () => {
    const baseAdapter = createNoopAdapter()
    const syncAdapter = createNoopAdapter()
    const localAdapter = createNoopAdapter()
    const resolverCalls: Array<{
      collectionId: string
      mode: `sync-present` | `sync-absent`
      schemaVersion?: number
    }> = []

    const persistence: PersistedCollectionPersistence = {
      adapter: baseAdapter,
      resolvePersistenceForCollection: (options) => {
        resolverCalls.push(options)
        return {
          adapter: options.mode === `sync-present` ? syncAdapter : localAdapter,
        }
      },
    }

    const syncOptions = persistedCollectionOptions<Todo, string>({
      id: `sync-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      schemaVersion: 7,
      persistence,
    })
    expect(syncOptions.persistence.adapter).toBe(syncAdapter)

    const localOptions = persistedCollectionOptions<Todo, string>({
      id: `local-collection`,
      getKey: (item) => item.id,
      schemaVersion: 3,
      persistence,
    })
    expect(localOptions.persistence.adapter).toBe(localAdapter)

    expect(resolverCalls).toEqual([
      {
        collectionId: `sync-collection`,
        mode: `sync-present`,
        schemaVersion: 7,
      },
      {
        collectionId: `local-collection`,
        mode: `sync-absent`,
        schemaVersion: 3,
      },
    ])
  })

  it(`throws for invalid coordinator implementations`, () => {
    const invalidCoordinator = {
      getNodeId: () => `node-1`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      // requestEnsurePersistedIndex is intentionally missing
    } as unknown as PersistedCollectionCoordinator

    expect(() =>
      persistedCollectionOptions<Todo, string>({
        id: `invalid-coordinator`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createNoopAdapter(),
          coordinator: invalidCoordinator,
        },
      }),
    ).toThrow(InvalidPersistedCollectionCoordinatorError)
  })

  it(`rejects an incomplete coordinator before starting a rich sync source`, async () => {
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

    const adapter = createRecordingAdapter()
    const applyCommittedTx = adapter.applyCommittedTx
    let adapterApplies = 0
    adapter.applyCommittedTx = (...args) => {
      adapterApplies++
      return applyCommittedTx(...args)
    }
    let sourceCalls = 0
    let legacyCalls = 0
    let sourceParams: SourceParams | undefined
    let collectionConstructed = false
    let visible = false
    let configurationError: { name: string; message: string } | null = null
    let collection: Collection<Todo, string> | undefined

    const incompleteCoordinator = {
      getNodeId: () => `incomplete-rich-sync`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: () => Promise.resolve(),
      requestEnsurePersistedIndex: () => Promise.resolve(),
      // Remote subset routing is complete so this fixture isolates the
      // required committed-transaction method named by the assertion.
      requestEnsureRemoteSubset: () => Promise.resolve(),
      requestReleaseRemoteSubset: () => Promise.resolve(),
      registerRemoteSubsetOwner: () => () => {},
      requestApplyLocalMutations: () => {
        legacyCalls++
        return Promise.resolve({
          type: `rpc:applyLocalMutations:res` as const,
          rpcId: `legacy`,
          ok: true as const,
          term: 1,
          seq: 1,
          latestRowVersion: 1,
          acceptedMutationIds: [],
        })
      },
    } as unknown as PersistedCollectionCoordinator

    try {
      try {
        const options = persistedCollectionOptions<Todo, string>({
          id: `incomplete-rich-sync`,
          getKey: (todo) => todo.id,
          sync: {
            sync: (params) => {
              sourceCalls++
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter, coordinator: incompleteCoordinator },
        })
        collection = createCollection(options)
        collectionConstructed = true
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error))
        configurationError = {
          name: resolvedError.name,
          message: resolvedError.message,
        }
      }

      if (collection) {
        collection.startSyncImmediate()
        await vi.waitFor(() => expect(sourceParams).toBeDefined())
        sourceParams!.begin()
        sourceParams!.metadata?.collection.set(`resume`, { offset: 7 })
        sourceParams!.truncate()
        sourceParams!.write({
          type: `insert`,
          value: { id: `rich`, title: `Visible before rejection` },
          metadata: { source: `remote` },
        })
        await Promise.resolve(sourceParams!.commit()).catch(() => undefined)
        visible = collection.has(`rich`)
      }
    } finally {
      await collection?.cleanup()
    }

    expect({
      configurationError,
      sourceCalls,
      collectionConstructed,
      visible,
      adapterApplies,
      legacyCalls,
    }).toEqual({
      configurationError: {
        name: `InvalidPersistedCollectionCoordinatorError`,
        message:
          'Invalid persisted collection coordinator: missing required "requestApplyCommittedTx" method',
      },
      sourceCalls: 0,
      collectionConstructed: false,
      visible: false,
      adapterApplies: 0,
      legacyCalls: 0,
    })
  })

  it(`preserves valid sync config in sync-present mode`, async () => {
    const adapter = createRecordingAdapter()
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

    const options = persistedCollectionOptions<Todo, string>({
      id: `sync-present`,
      getKey: (item: Todo) => item.id,
      sync,
      persistence: {
        adapter,
      },
    })

    const collection = createCollection(options)
    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`remote-1`))).toEqual({
      id: `remote-1`,
      title: `From remote`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.mutations[0]?.type).toBe(
      `update`,
    )
  })

  it(`does not apply or persist a wrapped sync transaction committed with an aborted signal`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
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
    } finally {
      await collection.cleanup()
    }
  })

  it(`does not publish or allocate a sequence for an empty external source transaction`, async () => {
    const adapter = Object.assign(createRecordingAdapter(), {
      getStreamPosition: () =>
        Promise.resolve({
          latestTerm: 1,
          latestSeq: 10,
          latestRowVersion: 10,
        }),
    })
    let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
    const published: Array<ProtocolEnvelope<unknown>> = []
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `empty-source-follower`,
      subscribe: (_collectionId, onMessage) => {
        subscriber = onMessage
        return () => {
          subscriber = undefined
        }
      },
      publish: (_collectionId, message) => published.push(message),
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
    }
    let sourceBegin: (() => void) | undefined
    let sourceCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `empty-source-sequence`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            sourceBegin = begin
            sourceCommit = commit
            markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    try {
      await collection.stateWhenReady()
      sourceBegin?.()
      await sourceCommit?.()
      await flushAsyncWork()

      expect(published).toEqual([])

      subscriber?.({
        v: 1,
        dbName: `empty-source-sequence`,
        collectionId: `empty-source-sequence`,
        senderId: `elected-owner`,
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: 11,
          txId: `first-real-coordinator-sequence`,
          latestRowVersion: 11,
          requiresFullReload: false,
          changedRows: [
            {
              key: `kept`,
              value: { id: `kept`, title: `First real write` },
            },
          ],
          deletedKeys: [],
        },
      })
      await flushAsyncWork()

      expect(stripVirtualProps(collection.get(`kept`))).toEqual({
        id: `kept`,
        title: `First real write`,
      })
    } finally {
      await collection.cleanup()
    }
  })

  it(`persists a wrapped sync transaction when abort follows application`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-abort-after-application`,
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
    let releaseMutation!: () => void
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    const transaction = createTransaction({
      mutationFn: () => mutationGate,
    })

    try {
      await collection.stateWhenReady()
      transaction.mutate(() => {
        collection.insert({ id: `local`, title: `Optimistic gate` })
      })

      const abortController = new AbortController()
      let appliedPublications = 0
      const subscription = collection.subscribeChanges((changes) => {
        if (changes.some((change) => change.key === `remote`)) {
          appliedPublications++
          abortController.abort()
        }
      })
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `remote`, title: `Already visible` },
      })
      const receipt = remoteCommit?.(abortController.signal)
      expect(receipt).toBeInstanceOf(Promise)

      releaseMutation()
      await transaction.isPersisted.promise
      await receipt
      subscription.unsubscribe()

      expect(appliedPublications).toBe(1)
      expect(abortController.signal.aborted).toBe(true)
      expect(stripVirtualProps(collection.get(`remote`))).toEqual({
        id: `remote`,
        title: `Already visible`,
      })
      expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    } finally {
      releaseMutation()
      await transaction.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
    }
  })

  it(`publishes before persistence settles, then fails with the named durability error`, async () => {
    const adapter = createRecordingAdapter()
    const persistenceError = Object.assign(new Error(`persistence failed`), {
      code: `SQLITE_IOERR_WRITE`,
      path: `todos.sqlite-wal`,
    })
    let rejectPersistence: ((error: unknown) => void) | undefined
    adapter.applyCommittedTx = () =>
      new Promise<void>((_resolve, reject) => {
        rejectPersistence = reject
      })
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-persistence-error`,
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
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `failed`, title: `Not durable` },
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

      expect(stripVirtualProps(collection.get(`failed`))).toEqual({
        id: `failed`,
        title: `Not durable`,
      })
      expect(settled).toBe(false)
      await vi.waitFor(() => expect(rejectPersistence).toBeTypeOf(`function`))

      rejectPersistence!(persistenceError)
      const rejection = await receipt.then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(rejection).not.toBe(persistenceError)
      expect(rejection).toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        code: `SQLITE_IOERR_WRITE`,
        path: `todos.sqlite-wal`,
        cause: persistenceError,
      })
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(rejection)
    } finally {
      rejectPersistence?.(persistenceError)
      await collection.cleanup()
    }
  })

  it(`preserves a coordinator persistence classification without converting it to conflict`, async () => {
    const coordinator = createCoordinatorHarness()
    const persistenceResponse = {
      type: `rpc:applyCommittedTx:res` as const,
      rpcId: `persistence-response`,
      ok: false as const,
      code: `PERSISTENCE_ERROR` as const,
      error: `disk write failed`,
      sourceCode: `SQLITE_IOERR_FSYNC`,
      path: [`database`, `wal`] as const,
    }
    coordinator.requestApplyCommittedTx = () =>
      Promise.resolve(persistenceResponse)
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `coordinator-persistence-error`,
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
        persistence: { adapter: createRecordingAdapter(), coordinator },
      }),
    )

    try {
      await collection.stateWhenReady()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `remote-failure`, title: `Published once` },
      })
      const rejection = await Promise.resolve(remoteCommit?.()).then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(rejection).toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        code: `SQLITE_IOERR_FSYNC`,
        path: [`database`, `wal`],
        cause: persistenceResponse,
      })
      expect(String(rejection)).not.toContain(`CONFLICT`)
      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(rejection)
    } finally {
      await collection.cleanup()
    }
  })

  it(`replays a hydration-buffered write before its named durability rejection`, async () => {
    const adapter = createRecordingAdapter()
    let releaseHydration: (() => void) | undefined
    adapter.loadSubset = () =>
      new Promise<Array<{ key: string; value: Todo }>>((resolve) => {
        releaseHydration = () => resolve([])
      })
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
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
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
    expect(adapter.loadSubsetCalls[0]?.collectionId).toBe(collection.id)
  })

  it(`keeps hydrated rows ahead of persisted startup rows`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Persisted title` },
    ])
    const descriptor = collectionOptions(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-precedence`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
        },
      }),
    )
    const client = new DbClient()
    client.hydrate({
      collections: [
        {
          collectionId: descriptor.id,
          rows: [
            {
              key: `1`,
              value: { id: `1`, title: `SSR title` },
            },
          ],
        },
      ],
    })

    const collection = client.collection(descriptor)
    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(collection.get(`1`)).toMatchObject({
      id: `1`,
      title: `SSR title`,
    })

    await client.cleanup()
  })

  it(`bootstraps and tracks persisted index lifecycle in sync-present mode`, async () => {
    const adapter = createRecordingAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-indexes`,
        getKey: (item) => item.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const preSyncIndex = collection.createIndex((row) => row.title, {
      name: `pre-sync-title`,
    })
    const expectedPreSyncSignature = collection.getIndexMetadata()[0]?.signature

    await collection.preload()
    await flushAsyncWork()

    expect(expectedPreSyncSignature).toBeDefined()
    expect(
      adapter.ensureIndexCalls.some(
        (call) => call.signature === expectedPreSyncSignature,
      ),
    ).toBe(true)

    const runtimeIndex = collection.createIndex((row) => row.id, {
      name: `runtime-id`,
    })
    await flushAsyncWork()

    const runtimeSignature = collection
      .getIndexMetadata()
      .find((index) => index.indexId === runtimeIndex.id)?.signature
    expect(runtimeSignature).toBeDefined()
    expect(
      adapter.ensureIndexCalls.some(
        (call) => call.signature === runtimeSignature,
      ),
    ).toBe(true)

    collection.removeIndex(preSyncIndex)
    await flushAsyncWork()
    expect(
      adapter.markIndexRemovedCalls.some(
        (call) => call.signature === expectedPreSyncSignature,
      ),
    ).toBe(true)
  })

  it(`queues remote sync writes that arrive during hydration`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `cached-1`,
        title: `Cached row`,
      },
    ])
    let resolveLoadSubset: (() => void) | undefined
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return [
        {
          key: `cached-1`,
          value: {
            id: `cached-1`,
            title: `Cached row`,
          },
        },
      ]
    }

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => void) | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
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
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const readyPromise = collection.stateWhenReady()
    for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
      await flushAsyncWork()
    }

    expect(resolveLoadSubset).toBeDefined()
    expect(remoteBegin).toBeDefined()

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: {
        id: `during-hydrate`,
        title: `During hydrate`,
      },
    })
    remoteCommit?.()

    resolveLoadSubset?.()
    await readyPromise
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`cached-1`))).toEqual({
      id: `cached-1`,
      title: `Cached row`,
    })
    expect(stripVirtualProps(collection.get(`during-hydrate`))).toEqual({
      id: `during-hydrate`,
      title: `During hydrate`,
    })
  })

  it(`discards a hydration-buffered transaction aborted before replay`, async () => {
    const adapter = createRecordingAdapter()
    let resolveLoadSubset: (() => void) | undefined
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return []
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit:
      | ((signal?: AbortSignal) => true | Promise<void>)
      | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-aborted-hydration-queue`,
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
      const ready = collection.stateWhenReady()
      for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
        await flushAsyncWork()
      }
      const abortController = new AbortController()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `aborted`, title: `Must not replay` },
      })
      const applied = remoteCommit?.(abortController.signal)
      abortController.abort()
      resolveLoadSubset?.()
      await ready
      if (applied !== true) {
        await expect(applied).rejects.toMatchObject({ name: `AbortError` })
      }
      await flushAsyncWork()

      expect(collection.get(`aborted`)).toBeUndefined()
      expect(adapter.applyCommittedTxCalls).toHaveLength(0)
    } finally {
      resolveLoadSubset?.()
      await collection.cleanup()
    }
  })

  it(`rejects every hydration-buffered receipt when replay fails`, async () => {
    const adapter = createRecordingAdapter()
    let resolveLoadSubset: (() => void) | undefined
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return []
    }

    const replayError = new Error(`replay key failed`)
    let bufferedRowKeyReads = 0
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-replay-failure-receipt`,
        getKey: (item) => {
          if (item.id === `during-hydrate`) {
            bufferedRowKeyReads++
            if (bufferedRowKeyReads === 2) {
              throw replayError
            }
          }
          return item.id
        },
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const readyPromise = collection.stateWhenReady()
    for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
      await flushAsyncWork()
    }

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `during-hydrate`, title: `During hydrate` },
    })
    const failingReceipt = remoteCommit?.()
    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `sibling`, title: `Sibling` },
    })
    const siblingReceipt = remoteCommit?.()
    expect(failingReceipt).toBeInstanceOf(Promise)
    expect(siblingReceipt).toBeInstanceOf(Promise)
    const failingExpectation = expect(
      Promise.resolve(failingReceipt),
    ).rejects.toBe(replayError)
    const siblingExpectation = expect(
      Promise.resolve(siblingReceipt),
    ).rejects.toBe(replayError)

    resolveLoadSubset?.()
    await readyPromise
    await failingExpectation
    await siblingExpectation

    await collection.cleanup()
  })

  it(`marks ready even when persisted startup fails before markReady`, async () => {
    const adapter = createRecordingAdapter()
    adapter.loadSubset = async () => {
      throw new Error(`startup failure`)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-mark-ready-on-startup-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()
    expect(collection.status).toBe(`ready`)
  })

  it(`reads staged metadata writes during hydration-queued transactions`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `cached-1`,
        title: `Cached row`,
      },
    ])
    adapter.rowMetadata.set(`cached-1`, { source: `persisted` })
    adapter.collectionMetadata.set(`startup:key`, { ready: true })

    let resolveLoadSubset: (() => void) | undefined
    adapter.loadSubset = async () => {
      await new Promise<void>((resolve) => {
        resolveLoadSubset = resolve
      })
      return [
        {
          key: `cached-1`,
          value: {
            id: `cached-1`,
            title: `Cached row`,
          },
          metadata: adapter.rowMetadata.get(`cached-1`),
        },
      ]
    }

    let remoteBegin: (() => void) | undefined
    let remoteCommit: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteMetadata:
      | Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`]
      | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-metadata-read`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, truncate, markReady, metadata }) => {
            remoteBegin = begin
            remoteCommit = commit
            remoteTruncate = truncate
            remoteMetadata = metadata
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const readyPromise = collection.stateWhenReady()
    for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
      await flushAsyncWork()
    }

    expect(resolveLoadSubset).toBeDefined()
    expect(remoteBegin).toBeDefined()
    expect(remoteMetadata).toBeDefined()

    remoteBegin?.()
    remoteMetadata?.row.set(`cached-1`, { source: `staged` })
    remoteMetadata?.collection.set(`runtime:key`, { persisted: true })

    expect(remoteMetadata?.row.get(`cached-1`)).toEqual({ source: `staged` })
    expect(remoteMetadata?.collection.get(`runtime:key`)).toEqual({
      persisted: true,
    })
    expect(remoteMetadata?.collection.list()).toContainEqual({
      key: `runtime:key`,
      value: { persisted: true },
    })

    remoteTruncate?.()

    expect(remoteMetadata?.row.get(`cached-1`)).toBeUndefined()
    expect(remoteMetadata?.collection.get(`startup:key`)).toEqual({
      ready: true,
    })

    remoteCommit?.()
    resolveLoadSubset?.()
    await readyPromise
  })

  it(`persists truncate transactions and preserves intended collection metadata`, async () => {
    const adapter = createRecordingAdapter()

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteMetadata:
      | Parameters<SyncConfig<Todo, string>[`sync`]>[0][`metadata`]
      | undefined

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-truncate`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markReady, metadata }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            remoteTruncate = truncate
            remoteMetadata = metadata
            markReady()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork()

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: {
        id: `pre-truncate`,
        title: `Pre truncate`,
      },
    })
    remoteMetadata?.collection.set(`electric:resume`, {
      kind: `reset`,
      updatedAt: 1,
    })
    remoteTruncate?.()
    remoteWrite?.({
      type: `insert`,
      value: {
        id: `post-truncate`,
        title: `Post truncate`,
      },
    })
    remoteCommit?.()
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls.at(-1)?.tx.truncate).toBe(true)

    const reloadedCollection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-truncate`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    await reloadedCollection.preload()
    await flushAsyncWork()

    expect(reloadedCollection.get(`pre-truncate`)).toBeUndefined()
    expect(stripVirtualProps(reloadedCollection.get(`post-truncate`))).toEqual({
      id: `post-truncate`,
      title: `Post truncate`,
    })
    expect(
      reloadedCollection._state.syncedCollectionMetadata.get(`electric:resume`),
    ).toEqual({
      kind: `reset`,
      updatedAt: 1,
    })
  })

  it(`uses pullSince recovery when tx sequence gaps are detected`, async () => {
    const adapter = createRecordingAdapter([
      {
        id: `1`,
        title: `Initial`,
      },
    ])
    const coordinator = createCoordinatorHarness()
    coordinator.setPullSinceResponse({
      type: `rpc:pullSince:res`,
      rpcId: `pull-1`,
      ok: true,
      latestTerm: 1,
      latestSeq: 3,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedKeys: [`2`],
      deletedKeys: [],
    })

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()

    adapter.rows.set(`2`, {
      id: `2`,
      title: `Recovered`,
    })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-1`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Initial` } }],
      deletedKeys: [],
    })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 3,
      txId: `tx-3`,
      latestRowVersion: 3,
      requiresFullReload: false,
      changedRows: [{ key: `2`, value: { id: `2`, title: `Recovered` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(coordinator.pullSinceCalls).toBe(1)
    expect(stripVirtualProps(collection.get(`2`))).toEqual({
      id: `2`,
      title: `Recovered`,
    })
  })

  it(`removes deleted rows after tx:committed invalidation reload`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Keep` },
      { id: `2`, title: `Delete` },
    ])
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    expect(stripVirtualProps(collection.get(`2`))).toEqual({
      id: `2`,
      title: `Delete`,
    })

    adapter.rows.delete(`2`)

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-delete`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [],
      deletedKeys: [`2`],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(collection.get(`2`)).toBeUndefined()
  })

  it(`does not let a stale invalidation reload overwrite a restarted lifecycle`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial` }])
    const coordinator = createCoordinatorHarness()
    const originalLoadSubset = adapter.loadSubset.bind(adapter)
    let loadCalls = 0
    let releaseStaleReload!: () => void
    let releaseFreshReload!: () => void
    const staleReloadGate = new Promise<void>((resolve) => {
      releaseStaleReload = resolve
    })
    const freshReloadGate = new Promise<void>((resolve) => {
      releaseFreshReload = resolve
    })
    adapter.loadSubset = async (...args) => {
      loadCalls++
      if (loadCalls === 2) {
        await staleReloadGate
        return [
          {
            key: `1`,
            value: { id: `1`, title: `Stale reload` },
          },
        ]
      }
      if (loadCalls === 3) await freshReloadGate
      return originalLoadSubset(...args)
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
    await flushAsyncWork()
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-stale-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    for (let attempt = 0; attempt < 20 && loadCalls < 2; attempt++) {
      await flushAsyncWork()
    }
    expect(loadCalls).toBe(2)

    await collection.cleanup()
    adapter.rows.set(`1`, { id: `1`, title: `Restarted` })
    collection.startSyncImmediate()
    releaseStaleReload()
    for (let attempt = 0; attempt < 20 && loadCalls < 3; attempt++) {
      await flushAsyncWork()
    }
    expect(loadCalls).toBe(3)
    expect(collection.get(`1`)?.title).not.toBe(`Stale reload`)

    releaseFreshReload()
    for (
      let attempt = 0;
      attempt < 20 && collection.get(`1`)?.title !== `Restarted`;
      attempt++
    ) {
      await flushAsyncWork()
    }
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Restarted`,
    })
    await collection.cleanup()
  })

  it(`does not let stale reload metadata start row loading after restart`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Initial` }])
    const coordinator = createCoordinatorHarness()
    const originalLoadCollectionMetadata =
      adapter.loadCollectionMetadata!.bind(adapter)
    const originalLoadSubset = adapter.loadSubset.bind(adapter)
    let metadataCalls = 0
    let subsetCalls = 0
    let releaseStaleMetadata!: () => void
    const staleMetadataGate = new Promise<void>((resolve) => {
      releaseStaleMetadata = resolve
    })
    adapter.loadCollectionMetadata = async (...args) => {
      metadataCalls++
      if (metadataCalls === 2) await staleMetadataGate
      return originalLoadCollectionMetadata(...args)
    }
    adapter.loadSubset = async (...args) => {
      subsetCalls++
      return originalLoadSubset(...args)
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
    await flushAsyncWork()
    expect(metadataCalls).toBe(1)
    expect(subsetCalls).toBe(1)

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-stale-metadata`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    for (let attempt = 0; attempt < 20 && metadataCalls < 2; attempt++) {
      await flushAsyncWork()
    }
    expect(metadataCalls).toBe(2)

    await collection.cleanup()
    adapter.rows.set(`1`, { id: `1`, title: `Restarted` })
    collection.startSyncImmediate()
    releaseStaleMetadata()
    for (
      let attempt = 0;
      attempt < 20 && (metadataCalls < 3 || subsetCalls < 2);
      attempt++
    ) {
      await flushAsyncWork()
    }

    expect(metadataCalls).toBe(3)
    expect(subsetCalls).toBe(2)
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Restarted`,
    })
    await collection.cleanup()
  })

  it.each(
    [false, true].flatMap((sharedSubscription) =>
      [false, true].map((identical) => ({ sharedSubscription, identical })),
    ),
  )(
    `keeps sibling requests owned after one release: %j`,
    async ({ sharedSubscription, identical }) => {
      const adapter = createRecordingAdapter([
        { id: `1`, title: `Page row` },
        { id: `2`, title: `All-only row` },
      ])
      // This finite provider honors the only selection this law generates.
      const loadRows = adapter.loadSubset
      adapter.loadSubset = async (...args) => {
        const rows = await loadRows(...args)
        return rows.slice(0, args[1].limit)
      }
      const coordinator = createCoordinatorHarness()
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-present`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      collection.startSyncImmediate()
      const subscription = collection.subscribeChanges(() => {})
      const owner = sharedSubscription ? { subscription } : {}
      const page: LoadSubsetOptions = {
        ...owner,
        ...(identical ? {} : { limit: 1 }),
      }
      const all: LoadSubsetOptions = { ...owner }
      try {
        await collection._sync.loadSubset(page)
        expect([...collection.keys()]).toEqual(identical ? [`1`, `2`] : [`1`])
        await collection._sync.loadSubset(all)
        expect([...collection.keys()]).toEqual([`1`, `2`])
        collection._sync.unloadSubset(page)
        adapter.rows.set(`2`, { id: `2`, title: `After page release` })
        const beforeReload = adapter.loadSubsetCalls.length
        coordinator.emit({
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `sibling-update`,
          latestRowVersion: 1,
          requiresFullReload: true,
        })
        await flushAsyncWork()
        await flushAsyncWork()
        expect(
          adapter.loadSubsetCalls
            .slice(beforeReload)
            .map(({ options }) => options.limit),
        ).toEqual([undefined])
        expect([...collection.values()].map(stripVirtualProps)).toEqual([
          { id: `1`, title: `Page row` },
          { id: `2`, title: `After page release` },
        ])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`does not retain refresh history as permanent subset demand`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Before` }])
    const coordinator = createCoordinatorHarness()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        persistence: { adapter, coordinator },
      }),
    )
    collection.startSyncImmediate()
    try {
      await collection._sync.loadSubset({ limit: 1 })
      for (let i = 0; i < 20; i++)
        await collection.utils.forceReloadSubset!({ limit: 1 })
      const before = adapter.loadSubsetCalls.length
      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `refresh-invalidation`,
        latestRowVersion: 1,
        requiresFullReload: true,
      })
      await flushAsyncWork()
      await flushAsyncWork()
      expect(adapter.loadSubsetCalls.length - before).toBe(1)
    } finally {
      await collection.cleanup()
    }
  })

  it(`reports a non-abort upstream failure rather than treating hydration as remote success`, async () => {
    const failure = new Error(`remote acquisition failed`)
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `remote-acquisition-failure`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => Promise.reject(failure),
            }
          },
        },
        persistence: {
          adapter: createRecordingAdapter([
            { id: `cached`, title: `Last known row` },
          ]),
        },
      }),
    )
    collection.startSyncImmediate()
    try {
      await expect(
        Promise.resolve(collection._sync.loadSubset({})),
      ).rejects.toBe(failure)
      expect(stripVirtualProps(collection.get(`cached`))).toEqual({
        id: `cached`,
        title: `Last known row`,
      })
    } finally {
      warn.mockRestore()
      await collection.cleanup()
    }
  })

  it.each([`throw`, `reject`] as const)(
    `releases only transferred upstream ownership after a load %s`,
    async (mode) => {
      const failure = new Error(`failed upstream load`)
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const peer: LoadSubsetOptions = { limit: 1 }
      const failed: LoadSubsetOptions = { limit: 1 }
      const leases = new Set<LoadSubsetOptions>()
      let publish!: (title: string) => Promise<void>
      const unload = vi.fn((options: LoadSubsetOptions) => {
        leases.delete(options)
      })
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `failed-load-ownership-${mode}`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              publish = async (title) => {
                if (!leases.has(peer)) return
                begin()
                write({
                  type: collection.has(`live`) ? `update` : `insert`,
                  value: { id: `live`, title },
                })
                await commit()
              }
              markReady()
              return {
                loadSubset: (options) => {
                  if (options === failed && mode === `throw`) throw failure
                  // Returning a promise transfers the ongoing lease, even if
                  // fetching its initial snapshot subsequently fails.
                  leases.add(options)
                  return options === failed ? Promise.reject(failure) : true
                },
                unloadSubset: unload,
              }
            },
          },
          persistence: { adapter: createRecordingAdapter() },
        }),
      )
      collection.startSyncImmediate()
      try {
        await collection._sync.loadSubset(peer)
        await expect(collection._sync.loadSubset(failed)).rejects.toBe(failure)
        expect(leases.has(failed)).toBe(mode === `reject`)
        collection._sync.unloadSubset(failed)
        expect(unload.mock.calls.map(([options]) => options)).toEqual(
          mode === `reject` ? [failed] : [],
        )
        expect(leases).toEqual(new Set([peer]))
        await publish(`Peer still live`)
        expect(collection.get(`live`)?.title).toBe(`Peer still live`)
        collection._sync.unloadSubset(peer)
        expect(leases.size).toBe(0)
        await publish(`Must not arrive`)
        expect(collection.get(`live`)?.title).toBe(`Peer still live`)
      } finally {
        warn.mockRestore()
        await collection.cleanup()
      }
    },
  )

  it(`does not release or acquire an upstream lease cancelled during hydration`, async () => {
    const adapter = createRecordingAdapter()
    const hydrate = adapter.loadSubset
    let blocked = false
    let enterHydration!: () => void
    let finishHydration!: () => void
    const entered = new Promise<void>((resolve) => {
      enterHydration = resolve
    })
    const gate = new Promise<void>((resolve) => {
      finishHydration = resolve
    })
    adapter.loadSubset = async (...args) => {
      if (blocked) {
        enterHydration()
        await gate
      }
      return hydrate(...args)
    }
    let leases = 0
    let loads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `cancelled-hydration-lease`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                leases++
                return true
              },
              unloadSubset: () => {
                leases--
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.startSyncImmediate()
    const first: LoadSubsetOptions = { limit: 1 }
    const second: LoadSubsetOptions = { limit: 1 }
    try {
      await collection._sync.loadSubset(first)
      expect(leases).toBe(1)
      blocked = true
      const pending = collection._sync.loadSubset(second)
      await entered
      collection._sync.unloadSubset(second)
      expect(leases).toBe(1)
      finishHydration()
      await pending
      expect(loads).toBe(1)
      collection._sync.unloadSubset(first)
      expect(leases).toBe(0)
    } finally {
      finishHydration()
      await collection.cleanup()
    }
  })

  it.each([
    {
      action: `retain` as const,
      expectedEnsures: 1,
      expectedReleases: 0,
    },
    {
      action: `unload` as const,
      expectedEnsures: 0,
      expectedReleases: 1,
    },
    {
      action: `abort` as const,
      expectedEnsures: 0,
      expectedReleases: 0,
    },
  ])(
    `acquires coordinator demand after hydration iff it remains active: $action`,
    async ({ action, expectedEnsures, expectedReleases }) => {
      const adapter = createRecordingAdapter()
      const hydrate = adapter.loadSubset
      let enterHydration!: () => void
      let finishHydration!: () => void
      const entered = new Promise<void>((resolve) => {
        enterHydration = resolve
      })
      const gate = new Promise<void>((resolve) => {
        finishHydration = resolve
      })
      adapter.loadSubset = async (...args) => {
        enterHydration()
        await gate
        return hydrate(...args)
      }
      const ensure = vi.fn(async () => {})
      const release = vi.fn(async () => {})
      const coordinator = createCoordinatorHarness()
      coordinator.isLeader = () => false
      coordinator.requestEnsureRemoteSubset = ensure
      coordinator.requestReleaseRemoteSubset = release
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `coordinator-hydration-demand-${action}`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {}
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const controller = new AbortController()
      const options: LoadSubsetOptions = {
        limit: 1,
        signal: controller.signal,
      }

      try {
        collection.startSyncImmediate()
        const pending = collection._sync.loadSubset(options)
        await entered
        if (action === `unload`) collection._sync.unloadSubset(options)
        if (action === `abort`) controller.abort()
        finishHydration()
        await pending

        // The earlier history law cancelled only after remote acquisition had
        // begun. Holding the real adapter hydration seam exposes the distinct
        // post-hydration transfer boundary. `retain` is the hostile control:
        // the cancellation guard must not suppress live demand.
        expect({
          ensures: ensure.mock.calls.length,
          releases: release.mock.calls.length,
        }).toEqual({
          ensures: expectedEnsures,
          releases: expectedReleases,
        })
      } finally {
        finishHydration()
        await collection.cleanup()
      }
    },
  )

  it(`hydrates a multiprocess follower locally while only the elected owner acquires remote demand`, async () => {
    const adapter = createRecordingAdapter([
      { id: `persisted`, title: `Persisted follower row` },
    ])
    let releaseRemoteLoad = (): void => {}
    const remoteLoadGate = new Promise<void>((resolve) => {
      releaseRemoteLoad = resolve
    })
    let registeredOwner: RemoteSubsetOwner | undefined
    const ensureRemote = vi.fn(() => remoteLoadGate)
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `follower-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensureRemote,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: (_collectionId, owner) => {
        registeredOwner = owner
        return () => {
          if (registeredOwner === owner) registeredOwner = undefined
        }
      },
    }
    const followerUpstreamLoad = vi.fn(() => Promise.resolve())
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `multiprocess-follower-subset`,
        getKey: (todo) => todo.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: followerUpstreamLoad,
              unloadSubset: vi.fn(),
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      collection.startSyncImmediate()
      let settled = false
      const load = Promise.resolve(collection._sync.loadSubset(options)).then(
        () => {
          settled = true
        },
      )

      await vi.waitFor(() => {
        expect(adapter.loadSubsetCalls.length).toBeGreaterThan(0)
        expect(ensureRemote).toHaveBeenCalledWith(
          `multiprocess-follower-subset`,
          options,
        )
      })
      const persistedRow = collection.get(`persisted`)
      expect({
        persistedRow: persistedRow
          ? { id: persistedRow.id, title: persistedRow.title }
          : undefined,
        followerUpstreamCalls: followerUpstreamLoad.mock.calls.length,
        registeredOwner: registeredOwner !== undefined,
        settled,
      }).toEqual({
        persistedRow: { id: `persisted`, title: `Persisted follower row` },
        followerUpstreamCalls: 0,
        registeredOwner: true,
        settled: false,
      })

      releaseRemoteLoad()
      await load
      expect({
        routedEnsures: ensureRemote.mock.calls.length,
        followerUpstreamCalls: followerUpstreamLoad.mock.calls.length,
      }).toEqual({
        routedEnsures: 1,
        followerUpstreamCalls: 0,
      })
    } finally {
      releaseRemoteLoad()
      await collection.cleanup()
    }
  })

  it.each([`abort`, `signal-abort`, `release`, `offline`] as const)(
    `handles remote ensure after %s without resurrecting cancelled demand`,
    async (action) => {
      vi.useFakeTimers()
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const failure = Object.assign(new Error(action), {
        name: action === `abort` ? `AbortError` : `Error`,
      })
      const ensure = vi.fn(async () => {
        throw failure
      })
      const followerUpstreamLoad = vi.fn(async () => {
        throw new Error(`follower-local source must not own remote demand`)
      })
      const coordinator: PersistedCollectionCoordinator = {
        getNodeId: () => `cancel-ensure`,
        subscribe: () => () => {},
        publish: () => {},
        isLeader: () => true,
        ensureLeadership: async () => {},
        requestEnsurePersistedIndex: async () => {},
        requestApplyCommittedTx: (_collectionId, tx) =>
          Promise.resolve({
            type: `rpc:applyCommittedTx:res`,
            rpcId: tx.txId,
            ok: true,
            term: tx.term,
            seq: tx.seq,
            latestRowVersion: tx.rowVersion,
          }),
        requestEnsureRemoteSubset: ensure,
        // This fixture isolates ensure retry/cancellation, not ownership.
        requestReleaseRemoteSubset: async () => {},
        registerRemoteSubsetOwner: () => () => {},
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `cancel-ensure-${action}`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: followerUpstreamLoad,
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
      const controller = new AbortController()
      const options: LoadSubsetOptions = {
        limit: 1,
        ...(action === `signal-abort` ? { signal: controller.signal } : {}),
      }
      try {
        collection.startSyncImmediate()
        const result = await Promise.resolve(
          collection._sync.loadSubset(options),
        ).then(
          () => `ready`,
          (error: unknown) => error,
        )
        if (action === `release`) collection._sync.unloadSubset(options)
        if (action === `signal-abort`) controller.abort()
        const callsBeforeRetry = ensure.mock.calls.length
        await vi.advanceTimersByTimeAsync(200)
        // The old matrix supplied an AbortError or explicitly unloaded demand,
        // but never aborted an already-queued retry. The signal row owns that
        // distinct boundary; offline is its hostile liveness control.
        expect(result).toBe(failure)
        expect(followerUpstreamLoad).not.toHaveBeenCalled()
        if (action === `offline`) {
          expect(ensure.mock.calls.length).toBeGreaterThan(callsBeforeRetry)
        } else {
          expect(ensure).toHaveBeenCalledTimes(callsBeforeRetry)
        }
      } finally {
        await collection.cleanup()
        warning.mockRestore()
        vi.useRealTimers()
      }
    },
  )

  it(`retries queued remote subset ensure after transient failures`, async () => {
    const adapter = createRecordingAdapter()
    let ensureCalls = 0
    const offline = new Error(`offline`)

    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `retry-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: async () => {
        ensureCalls++
        if (ensureCalls === 1) {
          throw offline
        }
      },
      // This fixture isolates ensure retry behavior, not ownership.
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-retry`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: vi.fn() }
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()

    const firstResult = await Promise.resolve(
      (collection as any)._sync.loadSubset({ limit: 1 }),
    ).then(
      () => `ready`,
      (error: unknown) => error,
    )
    await flushAsyncWork(120)

    expect(firstResult).toBe(offline)
    expect(ensureCalls).toBeGreaterThanOrEqual(2)
  })

  it(`does not route remote demand from an ownerless elected leader`, async () => {
    const ensure = vi.fn(async () => {
      throw new Error(`no remote subset owner registered`)
    })
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `ownerless-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `ownerless-on-demand-source`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()

      await expect(
        Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
      ).resolves.toBeUndefined()
      await flushAsyncWork(120)

      expect(ensure).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
    }
  })

  it(`uses dispatch-time ownership after follower hydration becomes ownerless leader`, async () => {
    const adapter = createRecordingAdapter()
    const loadSubset = adapter.loadSubset
    let markHydrationStarted = (): void => {}
    const hydrationStarted = new Promise<void>((resolve) => {
      markHydrationStarted = resolve
    })
    let releaseHydration = (): void => {}
    const hydrationGate = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })
    adapter.loadSubset = async (...args) => {
      markHydrationStarted()
      await hydrationGate
      return loadSubset(...args)
    }

    let isLeader = false
    const staleEnsure = new Error(`ownerless leader must not route demand`)
    const ensure = vi.fn(() => Promise.reject(staleEnsure))
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `transitioning-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => isLeader,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `dispatch-time-ownerless-leader`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()
      const load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      await hydrationStarted
      isLeader = true
      releaseHydration()

      await expect(load).resolves.toBeUndefined()
      expect(ensure).not.toHaveBeenCalled()
    } finally {
      releaseHydration()
      await collection.cleanup()
    }
  })

  it(`routes follower demand without a local subset owner`, async () => {
    const ensure = vi.fn(async () => {})
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `ownerless-follower`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collectionId = `ownerless-on-demand-follower`
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )
    const options = { limit: 1 }

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()

      await expect(
        Promise.resolve(collection._sync.loadSubset(options)),
      ).resolves.toBeUndefined()

      expect(ensure).toHaveBeenCalledTimes(1)
      expect(ensure).toHaveBeenCalledWith(collectionId, options)
    } finally {
      await collection.cleanup()
    }
  })

  it(`fails sync-absent persistence when follower ack omits mutation ids`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `follower-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      // This fixture isolates follower transaction acknowledgements.
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyLocalMutations: async () => ({
        type: `rpc:applyLocalMutations:res`,
        rpcId: `ack-1`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: [],
      }),
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-absent-ack`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    const tx = collection.insert({
      id: `ack-mismatch`,
      title: `Ack mismatch`,
    })

    await expect(tx.isPersisted.promise).rejects.toThrow(
      /partial acceptance is not supported/,
    )
    expect(collection.get(`ack-mismatch`)).toBeUndefined()
  })

  it.each([
    {
      boundary: `follower` as const,
      responseCode: `PERSISTENCE_ERROR` as const,
      expectedDurabilityError: true,
    },
    {
      boundary: `elected-leader` as const,
      responseCode: `PERSISTENCE_ERROR` as const,
      expectedDurabilityError: true,
    },
    {
      boundary: `follower` as const,
      responseCode: `NOT_LEADER` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `VALIDATION_ERROR` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `CONFLICT` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `TIMEOUT` as const,
      expectedDurabilityError: false,
    },
  ])(
    `classifies public local-mutation failure at the $boundary boundary: $responseCode`,
    async ({ boundary, responseCode, expectedDurabilityError }) => {
      const persistenceResponse =
        responseCode === `PERSISTENCE_ERROR`
          ? {
              type: `rpc:applyLocalMutations:res` as const,
              rpcId: `local-${boundary}-persistence-response`,
              ok: false as const,
              code: `PERSISTENCE_ERROR` as const,
              error: `disk write failed`,
              sourceCode: `SQLITE_IOERR_FSYNC`,
              path: [`database`, `wal`] as const,
            }
          : {
              type: `rpc:applyLocalMutations:res` as const,
              rpcId: `local-${boundary}-failure-response`,
              ok: false as const,
              code: responseCode,
              error: `mutation route changed`,
            }
      const coordinator = createCoordinatorHarness()
      coordinator.isLeader = () => boundary === `elected-leader`
      coordinator.requestApplyLocalMutations = () =>
        Promise.resolve(persistenceResponse)
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `local-mutation-${boundary}-${responseCode}`,
          getKey: (item) => item.id,
          persistence: {
            adapter: createRecordingAdapter(),
            coordinator,
          },
        }),
      )

      try {
        const tx = collection.insert({
          id: `local-failure`,
          title: `Must not persist`,
        })
        const rejection = await tx.isPersisted.promise.then(
          () => undefined,
          (error: unknown) => error,
        )

        // Earlier laws covered external-sync commit classification and a
        // successful follower mutation acknowledgement. They never varied a
        // serialized applyLocalMutations failure by route. The elected-leader
        // and non-durability rows are hostile controls for topology parity and
        // for avoiding an over-broad fail-stop classifier.
        if (expectedDurabilityError) {
          expect(rejection).toMatchObject({
            name: `PersistedCollectionDurabilityError`,
            code: `SQLITE_IOERR_FSYNC`,
            path: [`database`, `wal`],
            cause: persistenceResponse,
          })
          expect(collection.status).toBe(`error`)
          expect(collection._lifecycle.getSyncError()).toBe(rejection)
        } else {
          expect(rejection).toMatchObject({
            name: `Error`,
            message:
              `failed to apply local mutations through coordinator: ` +
              `mutation route changed`,
          })
          expect(collection._lifecycle.getSyncError()).toBeUndefined()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`targeted update avoids full loadSubset call`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Original` }])
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    const loadSubsetCallsAfterPreload = adapter.loadSubsetCalls.length

    // Update the row in the adapter backing store
    adapter.rows.set(`1`, { id: `1`, title: `Updated` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-targeted`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Updated` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // Targeted path should NOT have called loadSubset again
    expect(adapter.loadSubsetCalls.length).toBe(loadSubsetCallsAfterPreload)
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Updated`,
    })
  })

  it(`targeted update removes row that no longer matches WHERE`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Keep` },
      { id: `2`, title: `Keep` },
    ])
    const coordinator = createCoordinatorHarness()

    const whereExpr = new IR.Func(`eq`, [
      new IR.PropRef([`title`]),
      new IR.Value(`Keep`),
    ])

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()

    // Load a filtered subset with WHERE title = 'Keep'
    await (collection as any)._sync.loadSubset({ where: whereExpr })
    await flushAsyncWork()
    expect(stripVirtualProps(collection.get(`2`))).toEqual({
      id: `2`,
      title: `Keep`,
    })

    // Change the row so it no longer matches WHERE title = 'Keep'
    adapter.rows.set(`2`, { id: `2`, title: `Changed` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-where`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `2`, value: { id: `2`, title: `Changed` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // Row no longer matches WHERE — should be removed from collection
    expect(collection.get(`2`)).toBeUndefined()
  })

  it(`paginated subset falls back to full reload`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Row 1` }])
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()

    // Add a paginated subset (limit)
    await (collection as any)._sync.loadSubset({ limit: 10 })
    await flushAsyncWork()
    const loadSubsetCallsAfterPaginated = adapter.loadSubsetCalls.length

    // Update the row in the adapter backing store
    adapter.rows.set(`1`, { id: `1`, title: `Updated` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-paginated`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Updated` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // With a paginated subset active, should fall back to full reload
    expect(adapter.loadSubsetCalls.length).toBeGreaterThan(
      loadSubsetCallsAfterPaginated,
    )
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Updated`,
    })
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
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady, metadata }) => {
            hydrateBaseline = (
              metadata?.row as
                | { whenHydrated?: () => Promise<void> }
                | undefined
            )?.whenHydrated
            markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(hydrateBaseline).toBeTypeOf(`function`))
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
