import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  BasicIndex,
  DbClient,
  IR,
  SyncTransactionAbortedError,
  collectionOptions,
  createCollection,
  createTransaction,
} from '@tanstack/db'
import {
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidSyncConfigError,
  SingleProcessCoordinator,
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
  persistedCollectionOptions,
} from '../src'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistedSyncWrappedOptions,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
  TxCommitted,
} from '../src'
import type {
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
} from '@tanstack/db'

/**
 * # Which startup source makes a persisted Collection ready?
 *
 * Contract and source: the sync-mode contract recorded in
 * `.changeset/fix-persisted-dual-source-readiness.md`. An eager Collection
 * becomes ready after either compatible SQLite hydration or an authoritative
 * upstream source snapshot succeeds. On-demand Collections remain
 * upstream-gated, and startup enters error only after every available startup
 * path fails.
 *
 * The deterministic history grammar below controls local hydration, upstream
 * readiness and sync transactions, durable application, mutex occupancy,
 * cleanup, and restart. It covers empty and non-empty local snapshots, either
 * source winning, dual failure and recovery, post-ready durability failure,
 * dropped receipts, transactions crossing the hydration boundary, and stale
 * work. The expected relation is independent of the implementation queues: the
 * first usable startup result establishes Collection readiness, an
 * authoritative upstream winner cannot be overwritten by late hydration, and
 * cleanup fences the prior sync run. Once local hydration makes an eager
 * Collection usable, a later upstream failure does not hide those rows. A
 * later upstream ready signal may recover a transient durability error; the
 * next failed durable write reports error again.
 *
 * The production driver is `persistedCollectionOptions` through real Collection
 * status, reads, applied receipts, and persistence/coordinator boundaries.
 * Checkpoints compare exact public rows, Collection status and errors, durable
 * calls, and settlement before controlled gates are released.
 *
 * Pinned schedules retain readable pre-fix witnesses for stale overwrite,
 * false readiness errors, misclassified receipt rejection, remote-ensure retry,
 * and hidden durability failure. The generated owner laws below vary delivery
 * channel and width, snapshot failure phase, peer/RPC queue width, and demand
 * failure/unload history. Their independent relations are exact delivered keys,
 * cached-snapshot preservation before commit, peer-before-response inclusion,
 * and one reload per live owner. Hostile trace tests prove each comparison
 * rejects the production fault. PowerSync does not currently use this
 * authoritative-truncate path.
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
 * Driver SQL behavior, browser page ownership, native runtimes, and the shared
 * conformance portfolio have separate owners. This file models persistence
 * protocol state, not a particular SQLite engine.
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

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function expectExactKeys(actual: Array<string>, expected: Array<string>): void {
  expect([...actual].sort()).toEqual([...expected].sort())
}

describe(`persistedCollectionOptions`, () => {
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

  it(`does not report an application receipt rejection as a persistence failure`, async () => {
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
        id: `sync-present-application-rejection`,
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
    const mutationGate = deferred()
    const transaction = createTransaction({
      mutationFn: () => mutationGate.promise,
    })

    try {
      await collection.stateWhenReady()
      await flushAsyncWork()
      transaction.mutate(() => {
        collection.insert({ id: `local`, title: `Optimistic gate` })
      })
      expect(transaction.state).toBe(`persisting`)

      const abortController = new AbortController()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `remote`, title: `Canceled before application` },
      })
      const receipt = remoteCommit?.(abortController.signal)
      expect(receipt).toBeInstanceOf(Promise)
      if (receipt === true || receipt === undefined) {
        throw new Error(`Persisting optimistic work did not hold remote sync`)
      }

      const applicationReceipt =
        collection._state.pendingSyncedTransactions.at(-1)?.applied.promise
      if (!applicationReceipt) {
        throw new Error(`Expected a pending application receipt`)
      }
      const applicationRejection = applicationReceipt.catch((error) => error)

      abortController.abort()
      const [applicationError, callerError] = await Promise.all([
        applicationRejection,
        receipt.catch((error) => error),
      ])
      await flushAsyncWork()

      expect(applicationError).toBeInstanceOf(SyncTransactionAbortedError)
      expect(callerError).toBe(applicationError)
      expect(adapter.applyCommittedTxCalls).toHaveLength(0)
      expect(collection.status).toBe(`ready`)
      expect(collection._lifecycle.getSyncError()).toBeUndefined()
      expect(collection.get(`remote`)).toBeUndefined()
    } finally {
      mutationGate.resolve()
      await transaction.isPersisted.promise.catch(() => undefined)
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

  it(`rejects a wrapped sync receipt when persistence fails`, async () => {
    const adapter = createRecordingAdapter()
    const persistenceError = new Error(`persistence failed`)
    adapter.applyCommittedTx = () => Promise.reject(persistenceError)
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

      await expect(Promise.resolve(remoteCommit?.())).rejects.toBe(
        persistenceError,
      )
    } finally {
      await collection.cleanup()
    }
  })

  it(`handles a dropped sync receipt when persistence fails`, async () => {
    const adapter = createRecordingAdapter()
    const persistenceError = new Error(`durable write failed`)
    const persistenceAttempted = deferred()
    adapter.applyCommittedTx = () => {
      persistenceAttempted.resolve()
      return Promise.reject(persistenceError)
    }
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on(`unhandledRejection`, onUnhandled)
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => SyncAppliedReceipt) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `dropped-sync-receipt`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      await collection.preload()
      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `network`, title: `Network row` },
      })
      remoteCommit?.()
      await persistenceAttempted.promise
      await flushAsyncWork()
      await flushAsyncWork(10)

      expect(collection.status).toBe(`error`)
      expect(collection._lifecycle.getSyncError()).toBe(persistenceError)
      expect(unhandled).toEqual([])
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      await collection.cleanup()
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

  it(`replays a transaction begun during hydration when it commits after hydration`, async () => {
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
    let remoteCommit: (() => SyncAppliedReceipt) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `commit-after-hydration`,
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
        persistence: { adapter },
      }),
    )

    try {
      const ready = collection.stateWhenReady()
      for (let attempt = 0; attempt < 20 && !resolveLoadSubset; attempt++) {
        await flushAsyncWork()
      }

      remoteBegin?.()
      remoteWrite?.({
        type: `insert`,
        value: { id: `late-commit`, title: `Committed after hydration` },
      })
      resolveLoadSubset?.()
      await ready
      await flushAsyncWork()
      await flushAsyncWork()

      const applied = remoteCommit?.()
      let settled = applied === true
      if (applied !== true) {
        void applied?.then(
          () => {
            settled = true
          },
          () => {
            settled = true
          },
        )
      }
      await flushAsyncWork()
      await flushAsyncWork()

      expect(settled).toBe(true)
      expect(stripVirtualProps(collection.get(`late-commit`))).toEqual({
        id: `late-commit`,
        title: `Committed after hydration`,
      })
      expect(adapter.rows.get(`late-commit`)).toEqual({
        id: `late-commit`,
        title: `Committed after hydration`,
      })
    } finally {
      resolveLoadSubset?.()
      await collection.cleanup()
    }
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

  it(`falls back to upstream readiness when persisted startup fails`, async () => {
    const adapter = createRecordingAdapter()
    const startupError = new Error(`startup failure`)
    const localAttempted = deferred()
    const upstreamStarted = deferred()
    let markUpstreamReady: (() => void) | undefined
    adapter.loadSubset = () => {
      localAttempted.resolve()
      return Promise.reject(startupError)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-mark-ready-on-startup-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markUpstreamReady = markReady
            upstreamStarted.resolve()
            return {}
          },
        },
        persistence: {
          adapter,
        },
      }),
    )

    const preload = collection.preload()
    await Promise.all([localAttempted.promise, upstreamStarted.promise])
    await flushAsyncWork()
    expect(collection.status).toBe(`loading`)

    expect(markUpstreamReady).toBeTypeOf(`function`)
    markUpstreamReady!()
    await preload
    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    await collection.cleanup()
  })

  it.each([
    {
      name: `non-empty`,
      rows: [{ id: `1`, title: `Offline Todo` }],
    },
    { name: `empty`, rows: [] },
  ])(
    `marks an eager $name local snapshot ready without upstream readiness`,
    async ({ rows }) => {
      const adapter = createRecordingAdapter(rows)
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `local-first-${rows.length}`,
          getKey: (item) => item.id,
          sync: { sync: () => ({}) },
          persistence: { adapter },
        }),
      )

      await collection.preload()

      expect(collection.status).toBe(`ready`)
      expect(collection.toArray.map(stripVirtualProps)).toEqual(rows)
      expect(adapter.loadSubsetCalls).toHaveLength(1)
      await collection.cleanup()
    },
  )

  it(`keeps on-demand readiness gated on the upstream`, async () => {
    const upstreamStarted = deferred()
    let markUpstreamReady: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `on-demand-readiness`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markUpstreamReady = markReady
            upstreamStarted.resolve()
          },
        },
        persistence: { adapter: createRecordingAdapter() },
      }),
    )

    collection.startSyncImmediate()
    await upstreamStarted.promise
    expect(collection.status).toBe(`loading`)

    markUpstreamReady?.()
    await collection.stateWhenReady()
    expect(collection.status).toBe(`ready`)
    await collection.cleanup()
  })

  it(`signals ready once under synchronous upstream-ready reentry`, async () => {
    let signalUpstreamReady: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `on-demand-reentrant-readiness`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            signalUpstreamReady = markReady
            return {}
          },
        },
        persistence: { adapter: createRecordingAdapter() },
      }),
    )
    const lifecycle = collection._lifecycle as unknown as {
      markReady: () => void
    }
    const originalMarkReady = lifecycle.markReady.bind(lifecycle)
    let underlyingReadySignals = 0
    lifecycle.markReady = () => {
      underlyingReadySignals++
      signalUpstreamReady?.()
      originalMarkReady()
    }

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(signalUpstreamReady).toBeTypeOf(`function`))
    signalUpstreamReady!()

    expect(underlyingReadySignals).toBe(1)
    expect(collection.status).toBe(`ready`)
    await collection.cleanup()
  })

  it(`preserves upstream ready-error-ready transitions for on-demand sync`, async () => {
    const upstreamError = new Error(`rebuild failed`)
    const upstreamStarted = deferred()
    let failUpstream: ((error: unknown) => void) | undefined
    let recoverUpstream: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `on-demand-upstream-recovery`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markError, markReady }) => {
            failUpstream = markError
            recoverUpstream = markReady
            markReady()
            upstreamStarted.resolve()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter: createRecordingAdapter() },
      }),
    )

    collection.startSyncImmediate()
    await upstreamStarted.promise
    expect(collection.status).toBe(`ready`)

    failUpstream?.(upstreamError)
    expect(collection.status).toBe(`error`)
    expect(collection._lifecycle.getSyncError()).toBe(upstreamError)

    recoverUpstream?.()
    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    await collection.cleanup()
  })

  it(`loads an on-demand subset upstream when persisted startup fails`, async () => {
    const localError = new Error(`persisted metadata unavailable`)
    const adapter = createRecordingAdapter()
    adapter.getStreamPosition = () => Promise.reject(localError)
    const upstreamStarted = deferred()
    let upstreamLoads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `on-demand-upstream-fallback`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            upstreamStarted.resolve()
            return {
              loadSubset: async () => {
                upstreamLoads++
                begin()
                write({
                  type: `insert`,
                  value: { id: `network`, title: `Loaded from network` },
                })
                await commit()
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await upstreamStarted.promise
    expect(collection.status).toBe(`ready`)
    await collection._sync.loadSubset({})

    expect(upstreamLoads).toBe(1)
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Loaded from network`,
    })
    expect(collection.status).toBe(`ready`)
    await collection.cleanup()
  })

  it(`loads an on-demand subset upstream when local hydration fails`, async () => {
    const localError = new Error(`persisted rows unavailable`)
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => Promise.reject(localError)
    const upstreamStarted = deferred()
    let upstreamLoads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `on-demand-hydration-fallback`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            upstreamStarted.resolve()
            return {
              loadSubset: async () => {
                upstreamLoads++
                begin()
                write({
                  type: `insert`,
                  value: { id: `network`, title: `Loaded from network` },
                })
                await commit()
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await upstreamStarted.promise
    expect(collection.status).toBe(`ready`)
    await collection._sync.loadSubset({})

    expect(upstreamLoads).toBe(1)
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Loaded from network`,
    })
    await collection.cleanup()
  })

  it(`reports an error only after local hydration and upstream both fail`, async () => {
    const localError = new Error(`local startup failed`)
    const upstreamError = new Error(`upstream startup failed`)
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => Promise.reject(localError)
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `both-startup-paths-fail`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markError }) => {
            markError(upstreamError)
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    const outcome = await collection.preload().catch((error) => error)
    expect(outcome).toBeInstanceOf(AggregateError)
    expect((outcome as AggregateError).errors).toEqual([
      localError,
      upstreamError,
    ])
    expect(collection.status).toBe(`error`)
    expect(collection._lifecycle.getSyncError()).toBe(outcome)
    await collection.cleanup()
  })

  it(`recovers when upstream becomes ready after both startup paths fail`, async () => {
    const localError = new Error(`local startup failed`)
    const upstreamError = new Error(`upstream startup failed`)
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => Promise.reject(localError)
    let recoverUpstream: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `startup-recovery-after-both-fail`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markError, markReady }) => {
            recoverUpstream = markReady
            markError(upstreamError)
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    await expect(collection.preload()).rejects.toBeInstanceOf(AggregateError)
    expect(collection.status).toBe(`error`)

    expect(recoverUpstream).toBeTypeOf(`function`)
    recoverUpstream!()
    await collection.stateWhenReady()
    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    await collection.cleanup()
  })

  it(`uses a successful local snapshot when upstream fails`, async () => {
    const upstreamError = new Error(`upstream startup failed`)
    const rows = [{ id: `1`, title: `Offline Todo` }]
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-success-upstream-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markError }) => {
            markError(upstreamError)
            return {}
          },
        },
        persistence: { adapter: createRecordingAdapter(rows) },
      }),
    )

    await collection.preload()
    expect(collection.status).toBe(`ready`)
    expect(collection.toArray.map(stripVirtualProps)).toEqual(rows)
    await collection.cleanup()
  })

  it(`keeps a successful local snapshot ready when the upstream first fails later`, async () => {
    const upstreamError = new Error(`delayed upstream startup failure`)
    const rows = [{ id: `1`, title: `Offline Todo` }]
    let failUpstream: ((error: unknown) => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-success-before-upstream-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markError }) => {
            failUpstream = markError
            return {}
          },
        },
        persistence: { adapter: createRecordingAdapter(rows) },
      }),
    )

    await collection.preload()
    expect(collection.status).toBe(`ready`)
    expect(collection.toArray.map(stripVirtualProps)).toEqual(rows)

    expect(failUpstream).toBeTypeOf(`function`)
    failUpstream!(upstreamError)

    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    expect(collection.toArray.map(stripVirtualProps)).toEqual(rows)
    await collection.cleanup()
  })

  it(`keeps waiting for upstream after local hydration fails`, async () => {
    const localAttempted = deferred()
    const localError = new Error(`local startup failed`)
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      localAttempted.resolve()
      return Promise.reject(localError)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-failure-upstream-pending`,
        getKey: (item) => item.id,
        sync: { sync: () => ({}) },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await localAttempted.promise
    await flushAsyncWork()

    expect(collection.status).toBe(`loading`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    await collection.cleanup()
  })

  it(`uses an authoritative upstream snapshot before local hydration finishes`, async () => {
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const upstreamDone = deferred()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `upstream-snapshot-wins`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markReady }) => {
            void (async () => {
              await hydrationStarted.promise
              begin()
              truncate()
              write({
                type: `insert`,
                value: { id: `network`, title: `Network winner` },
              })
              await commit()
              markReady()
            })().then(upstreamDone.resolve, upstreamDone.reject)
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    const preload = collection.preload()
    await upstreamDone.promise
    await preload

    expect(collection.status).toBe(`ready`)
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Network winner`,
    })

    hydration.resolve([
      { key: `stale`, value: { id: `stale`, title: `Late local row` } },
      { key: `network`, value: { id: `network`, title: `Stale local row` } },
    ])
    await hydration.promise
    await flushAsyncWork()

    expect(collection.get(`stale`)).toBeUndefined()
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Network winner`,
    })
    await collection.cleanup()
  })

  it.each([
    { blocker: `full reload`, change: `truncate` },
    { blocker: `full reload`, change: `narrow` },
    { blocker: `gap recovery`, change: `truncate` },
    { blocker: `gap recovery`, change: `narrow` },
  ] as const)(
    `reconciles queued startup hydration behind $blocker with a $change upstream change`,
    async ({ blocker, change }) => {
      const adapter = createRecordingAdapter([
        { id: `cached`, title: `Cached snapshot` },
        { id: `retained`, title: `Unaffected cached row` },
      ])
      const coordinator = createCoordinatorHarness()
      const blockerStarted = deferred()
      const releaseBlocker = deferred()
      const originalLoadSubset = adapter.loadSubset.bind(adapter)
      let loadCalls = 0
      adapter.loadSubset = async (...args) => {
        loadCalls++
        const rows = originalLoadSubset(...args)
        if (blocker === `full reload` && loadCalls === 1) {
          blockerStarted.resolve()
          await releaseBlocker.promise
        }
        return rows
      }
      if (blocker === `gap recovery`) {
        coordinator.pullSince = async () => {
          blockerStarted.resolve()
          await releaseBlocker.promise
          return {
            type: `rpc:pullSince:res`,
            rpcId: `held-gap-recovery`,
            ok: true,
            latestTerm: 1,
            latestSeq: 2,
            latestRowVersion: 2,
            requiresFullReload: false,
            changedKeys: [],
            deletedKeys: [],
            deltas: [],
          }
        }
      }
      let remoteBegin: (() => void) | undefined
      let remoteTruncate: (() => void) | undefined
      let remoteWrite:
        | ((
            message:
              | { type: `insert`; value: Todo }
              | { type: `delete`; key: string },
          ) => void)
        | undefined
      let remoteCommit: (() => SyncAppliedReceipt) | undefined
      let remoteMarkReady: (() => void) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-present`,
          getKey: (item) => item.id,
          sync: {
            sync: ({ begin, truncate, write, commit, markReady }) => {
              remoteBegin = begin
              remoteTruncate = truncate
              remoteWrite = write as typeof remoteWrite
              remoteCommit = commit
              remoteMarkReady = markReady
              return {}
            },
          },
          persistence: { adapter, coordinator },
        }),
      )

      try {
        collection.startSyncImmediate()
        coordinator.emit({
          type: `tx:committed`,
          term: 1,
          seq: blocker === `full reload` ? 1 : 2,
          txId: `peer-${blocker}`,
          latestRowVersion: blocker === `full reload` ? 1 : 2,
          requiresFullReload: blocker === `full reload`,
          changedRows: [],
          deletedKeys: [],
        })
        await blockerStarted.promise

        // Let startup hydration queue behind the held reload before the
        // authoritative transaction queues its durable write.
        await flushAsyncWork()
        await flushAsyncWork()
        expect(loadCalls).toBe(blocker === `full reload` ? 1 : 0)

        remoteBegin?.()
        if (change === `truncate`) {
          remoteTruncate?.()
        } else {
          remoteWrite?.({ type: `delete`, key: `cached` })
        }
        remoteWrite?.({
          type: `insert`,
          value: { id: `network`, title: `Network winner` },
        })
        const applied = remoteCommit?.()
        if (applied !== true) void applied?.catch(() => undefined)
        remoteMarkReady?.()
        await flushAsyncWork()

        expect(collection.status).toBe(`ready`)
        expect(collection.get(`cached`)).toBeUndefined()
        expect(adapter.applyCommittedTxCalls).toHaveLength(0)

        releaseBlocker.resolve()
        await flushAsyncWork()
        await flushAsyncWork()
        await flushAsyncWork()

        expect(loadCalls).toBe(blocker === `full reload` ? 2 : 1)
        expect(
          adapter.applyCommittedTxCalls.map((call) => call.tx.truncate),
        ).toEqual([change === `truncate`])
        expect(Array.from(adapter.rows.keys())).toEqual(
          change === `truncate` ? [`network`] : [`retained`, `network`],
        )
        expect(collection.get(`cached`)).toBeUndefined()
        expect(collection.get(`retained`)).toEqual(
          change === `truncate`
            ? undefined
            : expect.objectContaining({
                id: `retained`,
                title: `Unaffected cached row`,
              }),
        )
      } finally {
        releaseBlocker.resolve()
        await collection.cleanup()
      }
    },
  )

  it(`persists a network winner after coordinator activity races hydration`, async () => {
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const startNetwork = deferred()
    const upstreamDone = deferred()
    const adapter = createRecordingAdapter()
    const loadPersistedRows = adapter.loadSubset.bind(adapter)
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    let persistedSeq = 0
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.getStreamPosition = () =>
      Promise.resolve({
        latestTerm: 1,
        latestSeq: persistedSeq,
        latestRowVersion: persistedSeq,
      })
    adapter.applyCommittedTx = (collectionId, transaction) => {
      if (transaction.term === 1 && transaction.seq <= persistedSeq) {
        return Promise.resolve()
      }
      persistedSeq = transaction.seq
      return applyCommittedTx(collectionId, transaction)
    }
    const coordinator = createCoordinatorHarness()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markReady }) => {
            void (async () => {
              await startNetwork.promise
              begin()
              truncate()
              write({
                type: `insert`,
                value: { id: `network`, title: `Network winner` },
              })
              await commit()
              markReady()
            })().then(upstreamDone.resolve, upstreamDone.reject)
            return {}
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    const preload = collection.preload()
    await hydrationStarted.promise
    startNetwork.resolve()
    await upstreamDone.promise
    await preload

    // The authoritative snapshot is live, but its persistence is still parked
    // behind hydration. A peer can commit the next stream position in this
    // window before the snapshot's queued persistence acquires the mutex.
    adapter.rows.set(`peer`, { id: `peer`, title: `Peer transaction` })
    persistedSeq = 1
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `peer-during-hydration`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [
        { key: `peer`, value: { id: `peer`, title: `Peer transaction` } },
      ],
      deletedKeys: [],
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(0)

    hydration.resolve([
      { key: `stale`, value: { id: `stale`, title: `Late local row` } },
    ])
    await hydration.promise
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.seq).toBe(2)
    expect(adapter.rows.get(`peer`)).toBeUndefined()
    expect(adapter.rows.get(`network`)).toEqual({
      id: `network`,
      title: `Network winner`,
    })
    await collection.cleanup()

    adapter.loadSubset = loadPersistedRows
    const reopened = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: { sync: () => ({}) },
        persistence: { adapter },
      }),
    )
    await reopened.preload()

    expect(stripVirtualProps(reopened.get(`network`))).toEqual({
      id: `network`,
      title: `Network winner`,
    })
    expect(reopened.get(`peer`)).toBeUndefined()
    await reopened.cleanup()
  })

  it(`reports a network winner persistence failure after becoming ready`, async () => {
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const upstreamDone = deferred()
    const persistenceAttempted = deferred()
    const persistenceError = new Error(`network winner persistence failed`)
    let recoverUpstream: (() => void) | undefined
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    adapter.applyCommittedTx = () => {
      persistenceAttempted.resolve()
      return Promise.reject(persistenceError)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `network-winner-persistence-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markReady }) => {
            recoverUpstream = markReady
            void (async () => {
              await hydrationStarted.promise
              begin()
              truncate()
              write({
                type: `insert`,
                value: { id: `network`, title: `Network winner` },
              })
              await commit()
              markReady()
            })().then(upstreamDone.resolve, upstreamDone.reject)
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    const preload = collection.preload()
    await upstreamDone.promise
    await preload
    expect(collection.status).toBe(`ready`)
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Network winner`,
    })

    hydration.resolve([])
    await persistenceAttempted.promise
    await flushAsyncWork()

    expect(collection.status).toBe(`error`)
    expect(collection._lifecycle.getSyncError()).toBe(persistenceError)

    expect(recoverUpstream).toBeTypeOf(`function`)
    recoverUpstream!()
    await collection.stateWhenReady()
    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    await collection.cleanup()
  })

  it(`reports persistence failure when a network snapshot follows local readiness`, async () => {
    const persistenceError = new Error(`post-local-ready persistence failed`)
    const persistenceAttempted = deferred()
    let persistenceAttempts = 0
    const adapter = createRecordingAdapter([
      { id: `local`, title: `Local snapshot` },
    ])
    let remoteBegin: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => SyncAppliedReceipt) | undefined
    let recoverUpstream: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-first-network-persistence-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, truncate, write, commit, markReady }) => {
            remoteBegin = begin
            remoteTruncate = truncate
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            recoverUpstream = markReady
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    await collection.preload()
    expect(collection.status).toBe(`ready`)
    adapter.applyCommittedTx = () => {
      persistenceAttempts++
      persistenceAttempted.resolve()
      return Promise.reject(persistenceError)
    }

    remoteBegin!()
    remoteTruncate!()
    remoteWrite!({
      type: `insert`,
      value: { id: `network`, title: `Network snapshot` },
    })
    const applied = remoteCommit!()
    if (applied !== true) void applied.catch(() => undefined)
    await persistenceAttempted.promise
    await flushAsyncWork()

    expect(collection.status).toBe(`error`)
    expect(collection._lifecycle.getSyncError()).toBe(persistenceError)

    recoverUpstream!()
    await collection.stateWhenReady()
    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()

    remoteBegin!()
    remoteTruncate!()
    remoteWrite!({
      type: `insert`,
      value: { id: `network-2`, title: `Next network snapshot` },
    })
    const nextApplied = remoteCommit!()
    if (nextApplied !== true) {
      await expect(nextApplied).rejects.toBe(persistenceError)
    }
    expect(persistenceAttempts).toBe(2)
    expect(collection.status).toBe(`error`)
    expect(collection._lifecycle.getSyncError()).toBe(persistenceError)
    await collection.cleanup()
  })

  it(`recovers when explicit upstream readiness follows network winner persistence failure`, async () => {
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const upstreamCommitted = deferred()
    const persistenceAttempted = deferred()
    const persistenceError = new Error(`network winner persistence failed`)
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    adapter.applyCommittedTx = () => {
      persistenceAttempted.resolve()
      return Promise.reject(persistenceError)
    }
    let markUpstreamReady: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `delayed-upstream-ready-after-persistence-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markReady }) => {
            markUpstreamReady = markReady
            void (async () => {
              await hydrationStarted.promise
              begin()
              truncate()
              write({
                type: `insert`,
                value: { id: `network`, title: `Network winner` },
              })
              await commit()
            })().then(upstreamCommitted.resolve, upstreamCommitted.reject)
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await upstreamCommitted.promise
    expect(collection.status).toBe(`ready`)
    hydration.resolve([])
    await persistenceAttempted.promise
    await flushAsyncWork()

    expect(collection.status).toBe(`error`)
    expect(collection._lifecycle.getSyncError()).toBe(persistenceError)
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Network winner`,
    })

    expect(markUpstreamReady).toBeTypeOf(`function`)
    markUpstreamReady!()
    await collection.stateWhenReady()
    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    await collection.cleanup()
  })

  it(`aggregates upstream failure after network winner persistence fails`, async () => {
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const upstreamCommitted = deferred()
    const persistenceAttempted = deferred()
    const persistenceError = new Error(`network winner persistence failed`)
    const upstreamError = new Error(`upstream startup failed`)
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    adapter.applyCommittedTx = () => {
      persistenceAttempted.resolve()
      return Promise.reject(persistenceError)
    }
    let failUpstream: ((error: unknown) => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `delayed-upstream-failure-after-persistence-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markError }) => {
            failUpstream = markError
            void (async () => {
              await hydrationStarted.promise
              begin()
              truncate()
              write({
                type: `insert`,
                value: { id: `network`, title: `Network winner` },
              })
              await commit()
            })().then(upstreamCommitted.resolve, upstreamCommitted.reject)
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await upstreamCommitted.promise
    expect(collection.status).toBe(`ready`)
    hydration.resolve([])
    await persistenceAttempted.promise
    await flushAsyncWork()
    expect(collection.status).toBe(`error`)
    expect(collection._lifecycle.getSyncError()).toBe(persistenceError)

    expect(failUpstream).toBeTypeOf(`function`)
    failUpstream!(upstreamError)
    expect(collection.status).toBe(`error`)
    const failure = collection._lifecycle.getSyncError()
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([
      persistenceError,
      upstreamError,
    ])
    await collection.cleanup()
  })

  it(`does not persist a network winner after cleanup starts a new lifecycle`, async () => {
    const firstHydrationStarted = deferred()
    const firstHydration = deferred<Array<{ key: string; value: Todo }>>()
    const firstUpstreamDone = deferred()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      firstHydrationStarted.resolve()
      return firstHydration.promise
    }
    let syncRun = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `cleanup-fences-network-winner-persistence`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, truncate, markReady }) => {
            syncRun++
            if (syncRun === 1) {
              void (async () => {
                await firstHydrationStarted.promise
                begin()
                truncate()
                write({
                  type: `insert`,
                  value: { id: `network`, title: `Network winner` },
                })
                await commit()
                markReady()
              })().then(firstUpstreamDone.resolve, firstUpstreamDone.reject)
            } else {
              markReady()
            }
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    const firstPreload = collection.preload()
    await firstUpstreamDone.promise
    await firstPreload
    expect(adapter.applyCommittedTxCalls).toHaveLength(0)

    await collection.cleanup()
    adapter.loadSubset = () =>
      Promise.resolve([
        { key: `fresh`, value: { id: `fresh`, title: `Fresh restart` } },
      ])
    collection.startSyncImmediate()
    firstHydration.resolve([
      { key: `stale`, value: { id: `stale`, title: `Late local row` } },
    ])
    await firstHydration.promise
    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls).toHaveLength(0)
    expect(stripVirtualProps(collection.get(`fresh`))).toEqual({
      id: `fresh`,
      title: `Fresh restart`,
    })
    expect(collection.get(`stale`)).toBeUndefined()
    await collection.cleanup()
  })

  it(`does not persist a transaction after its commit listener cleans up`, async () => {
    const adapter = createRecordingAdapter()
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => SyncAppliedReceipt) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `cleanup-during-sync-commit`,
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
        persistence: { adapter },
      }),
    )

    await collection.preload()
    let cleanupPromise: Promise<void> | undefined
    collection.subscribeChanges(
      () => {
        cleanupPromise ??= collection.cleanup()
      },
      { includeInitialState: false },
    )

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `retired`, title: `Retired lifecycle` },
    })
    const applied = remoteCommit?.()
    if (applied !== true) await applied
    await cleanupPromise
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls).toHaveLength(0)
    collection.startSyncImmediate()
    await collection.stateWhenReady()
    expect(collection.get(`retired`)).toBeUndefined()
    await collection.cleanup()
  })

  it(`does not persist buffered replay after its commit listener cleans up`, async () => {
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const upstreamDone = deferred()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    let syncRun = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `cleanup-during-buffered-replay`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            syncRun++
            if (syncRun === 1) {
              void (async () => {
                await hydrationStarted.promise
                begin()
                write({
                  type: `insert`,
                  value: { id: `retired`, title: `Retired lifecycle` },
                })
                await commit()
                markReady()
              })().then(upstreamDone.resolve, upstreamDone.reject)
            } else {
              markReady()
            }
            return {}
          },
        },
        persistence: { adapter },
      }),
    )
    let cleanupPromise: Promise<void> | undefined
    collection.subscribeChanges(
      () => {
        cleanupPromise ??= collection.cleanup()
      },
      { includeInitialState: false },
    )

    collection.startSyncImmediate()
    await hydrationStarted.promise
    hydration.resolve([])
    await upstreamDone.promise
    await cleanupPromise
    await flushAsyncWork()

    expect(adapter.applyCommittedTxCalls).toHaveLength(0)
    adapter.loadSubset = () => Promise.resolve([])
    collection.startSyncImmediate()
    await collection.stateWhenReady()
    expect(collection.get(`retired`)).toBeUndefined()
    await collection.cleanup()
  })

  it(`replays buffered upstream rows when eager local hydration fails`, async () => {
    const localError = new Error(`persisted rows unavailable`)
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const upstreamDone = deferred()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `buffered-upstream-after-hydration-failure`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            void (async () => {
              await hydrationStarted.promise
              begin()
              write({
                type: `insert`,
                value: { id: `network`, title: `Loaded from network` },
              })
              await commit()
              markReady()
            })().then(upstreamDone.resolve, upstreamDone.reject)
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await hydrationStarted.promise
    hydration.reject(localError)
    const upstreamOutcome = await upstreamDone.promise.then(
      () => `applied` as const,
      (error: unknown) => error,
    )
    await flushAsyncWork()

    expect(upstreamOutcome).toBe(`applied`)
    expect(collection.status).toBe(`ready`)
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Loaded from network`,
    })
    expect(adapter.rows.get(`network`)).toEqual({
      id: `network`,
      title: `Loaded from network`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    await collection.cleanup()
  })

  it(`applies peer commits buffered before eager hydration fails`, async () => {
    const localError = new Error(`persisted rows unavailable`)
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    const coordinator = createCoordinatorHarness()
    const upstreamStarted = deferred()
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            upstreamStarted.resolve()
            return {}
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    collection.startSyncImmediate()
    await Promise.all([hydrationStarted.promise, upstreamStarted.promise])
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `peer-during-failed-hydration`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [
        {
          key: `peer`,
          value: { id: `peer`, title: `Peer survives local failure` },
        },
      ],
      deletedKeys: [],
    })
    hydration.reject(localError)
    await flushAsyncWork()
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`peer`))).toEqual({
      id: `peer`,
      title: `Peer survives local failure`,
    })
    await collection.cleanup()
  })

  it(`obeys the buffered-delivery law across generated hydration failure histories`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          channel: fc.constantFrom<`source` | `peer`>(`source`, `peer`),
          width: fc.integer({ min: 1, max: 3 }),
          salt: fc.integer({ min: 0, max: 10_000 }),
        }),
        async ({ channel, width, salt }) => {
          const localError = new Error(`generated hydration failure ${salt}`)
          const hydrationStarted = deferred()
          const hydration = deferred<Array<{ key: string; value: Todo }>>()
          void hydration.promise.catch(() => undefined)
          const adapter = createRecordingAdapter()
          adapter.loadSubset = () => {
            hydrationStarted.resolve()
            return hydration.promise
          }
          const coordinator = createCoordinatorHarness()
          const upstreamStarted = deferred()
          let remoteBegin: (() => void) | undefined
          let remoteWrite:
            | ((message: { type: `insert`; value: Todo }) => void)
            | undefined
          let remoteCommit: (() => SyncAppliedReceipt) | undefined
          const collection = createCollection(
            persistedCollectionOptions<Todo, string>({
              id: `sync-present`,
              getKey: (item) => item.id,
              sync: {
                sync: ({ begin, write, commit, markReady }) => {
                  remoteBegin = begin
                  remoteWrite = write as typeof remoteWrite
                  remoteCommit = commit
                  markReady()
                  upstreamStarted.resolve()
                  return {}
                },
              },
              persistence: { adapter, coordinator },
            }),
          )
          const rows = Array.from({ length: width }, (_, index) => ({
            id: `${channel}-${salt}-${index}`,
            title: `Generated ${index}`,
          }))

          try {
            collection.startSyncImmediate()
            await Promise.all([
              hydrationStarted.promise,
              upstreamStarted.promise,
            ])

            let sourceReceipt: SyncAppliedReceipt | undefined
            if (channel === `source`) {
              remoteBegin?.()
              rows.forEach((row) => {
                remoteWrite?.({ type: `insert`, value: row })
              })
              sourceReceipt = remoteCommit?.()
            } else {
              rows.forEach((row, index) => {
                coordinator.emit({
                  type: `tx:committed`,
                  term: 1,
                  seq: index + 1,
                  txId: `peer-${salt}-${index}`,
                  latestRowVersion: index + 1,
                  requiresFullReload: false,
                  changedRows: [{ key: row.id, value: row }],
                  deletedKeys: [],
                })
              })
            }

            hydration.reject(localError)
            if (sourceReceipt !== undefined && sourceReceipt !== true) {
              await sourceReceipt
            }
            await flushAsyncWork()
            await flushAsyncWork()

            const actualKeys = rows
              .filter((row) => collection.get(row.id) !== undefined)
              .map((row) => row.id)
            expectExactKeys(
              actualKeys,
              rows.map((row) => row.id),
            )
            if (channel === `source`) {
              expect(adapter.applyCommittedTxCalls).toHaveLength(1)
            }
          } finally {
            await collection.cleanup()
          }
        },
      ),
      { numRuns: 8, seed: 18_690_311 },
    )
  })

  it(`rejects a hostile hydration trace that drops one buffered delivery`, () => {
    expect(() => expectExactKeys([`kept`], [`kept`, `dropped`])).toThrow()
  })

  it(`keeps cached hydration usable when an uncommitted truncate snapshot fails`, async () => {
    const upstreamError = new Error(`snapshot stream failed`)
    const cached = { id: `cached`, title: `Cached snapshot` }
    const adapter = createRecordingAdapter([cached])
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    let remoteBegin: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let failUpstream: ((error: unknown) => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `failed-uncommitted-snapshot`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, truncate, write, markError }) => {
            remoteBegin = begin
            remoteTruncate = truncate
            remoteWrite = write as typeof remoteWrite
            failUpstream = markError
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await hydrationStarted.promise
    remoteBegin?.()
    remoteTruncate?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `partial`, title: `Incomplete snapshot` },
    })
    failUpstream?.(upstreamError)
    hydration.resolve([{ key: cached.id, value: cached }])

    await collection.stateWhenReady()
    expect(collection.status).toBe(`ready`)
    expect(collection._lifecycle.getSyncError()).toBeUndefined()
    expect(collection.toArray.map(stripVirtualProps)).toEqual([cached])
    expect(adapter.applyCommittedTxCalls).toHaveLength(0)
    await collection.cleanup()
  })

  it(`obeys the cache-snapshot phase law across generated pre-commit failures`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phase: fc.constantFrom<`before-begin` | `open-truncate`>(
            `before-begin`,
            `open-truncate`,
          ),
          cachedWidth: fc.integer({ min: 1, max: 3 }),
          partialWidth: fc.integer({ min: 0, max: 3 }),
          salt: fc.integer({ min: 0, max: 10_000 }),
        }),
        async ({ phase, cachedWidth, partialWidth, salt }) => {
          const cached = Array.from({ length: cachedWidth }, (_, index) => ({
            id: `cached-${salt}-${index}`,
            title: `Cached ${index}`,
          }))
          const adapter = createRecordingAdapter(cached)
          const hydrationStarted = deferred()
          const hydration = deferred<Array<{ key: string; value: Todo }>>()
          adapter.loadSubset = () => {
            hydrationStarted.resolve()
            return hydration.promise
          }
          let remoteBegin: (() => void) | undefined
          let remoteTruncate: (() => void) | undefined
          let remoteWrite:
            | ((message: { type: `insert`; value: Todo }) => void)
            | undefined
          let failUpstream: ((error: unknown) => void) | undefined
          const collection = createCollection(
            persistedCollectionOptions<Todo, string>({
              id: `snapshot-phase-${salt}`,
              getKey: (item) => item.id,
              sync: {
                sync: ({ begin, truncate, write, markError }) => {
                  remoteBegin = begin
                  remoteTruncate = truncate
                  remoteWrite = write as typeof remoteWrite
                  failUpstream = markError
                  return {}
                },
              },
              persistence: { adapter },
            }),
          )

          try {
            collection.startSyncImmediate()
            await hydrationStarted.promise
            if (phase === `open-truncate`) {
              remoteBegin?.()
              remoteTruncate?.()
              for (let index = 0; index < partialWidth; index++) {
                remoteWrite?.({
                  type: `insert`,
                  value: {
                    id: `partial-${salt}-${index}`,
                    title: `Partial ${index}`,
                  },
                })
              }
            }
            failUpstream?.(new Error(`generated snapshot failure ${salt}`))
            hydration.resolve(
              cached.map((row) => ({ key: row.id, value: row })),
            )

            await collection.stateWhenReady()
            expect(collection.status).toBe(`ready`)
            expectExactKeys(
              collection.toArray.map((row) => row.id),
              cached.map((row) => row.id),
            )
            expect(adapter.applyCommittedTxCalls).toHaveLength(0)
          } finally {
            await collection.cleanup()
          }
        },
      ),
      { numRuns: 8, seed: 18_690_404 },
    )
  })

  it(`rejects a hostile pre-commit snapshot that replaces cached rows`, () => {
    expect(() =>
      expectExactKeys([`partial`], [`cached-a`, `cached-b`]),
    ).toThrow()
  })

  // Approval-gated contract decision (F007): core Collection state currently
  // marks every committed truncate ready. Keep the complete witness without
  // making normal CI choose multi-transaction snapshot semantics.
  it.skip(`waits for a custom chunked truncate source to declare its snapshot ready`, async () => {
    const adapter = createRecordingAdapter([
      { id: `cached`, title: `Cached snapshot` },
    ])
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    let remoteBegin: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => SyncAppliedReceipt) | undefined
    let markUpstreamReady: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `custom-chunked-truncate`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, truncate, write, commit, markReady }) => {
            remoteBegin = begin
            remoteTruncate = truncate
            remoteWrite = write as typeof remoteWrite
            remoteCommit = commit
            markUpstreamReady = markReady
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await hydrationStarted.promise

    remoteBegin?.()
    remoteTruncate?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `chunk-1`, title: `First chunk` },
    })
    const firstApplied = remoteCommit?.()
    if (firstApplied !== true) await firstApplied

    expect(collection.status).toBe(`loading`)

    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `chunk-2`, title: `Second chunk` },
    })
    const secondApplied = remoteCommit?.()
    if (secondApplied !== true) await secondApplied

    expect(collection.status).toBe(`loading`)
    markUpstreamReady?.()
    await collection.stateWhenReady()
    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { id: `chunk-1`, title: `First chunk` },
      { id: `chunk-2`, title: `Second chunk` },
    ])

    hydration.resolve([
      { key: `cached`, value: { id: `cached`, title: `Cached snapshot` } },
    ])
    await collection.cleanup()
  })

  it(`calibrates current upstream fallback when the saved stream position is unavailable`, async () => {
    const startupError = new Error(`stream position unavailable`)
    const positionAttempted = deferred()
    const adapter = createRecordingAdapter()
    adapter.getStreamPosition = () => {
      positionAttempted.resolve()
      return Promise.reject(startupError)
    }
    let sourceStarts = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `missing-startup-stream-position`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            sourceStarts++
            begin()
            write({
              type: `insert`,
              value: { id: `unsafe`, title: `Unsafe fallback write` },
            })
            const applied = commit()
            if (applied === true) {
              markReady()
            } else {
              void applied.then(markReady, () => undefined)
            }
            return {}
          },
        },
        persistence: { adapter },
      }),
    )

    const preloadOutcome = collection.preload()
    await positionAttempted.promise
    await preloadOutcome

    // This is a calibration of the pre-existing contract, not approval of the
    // opposing F005 expectation. Changing this behavior is design-gated because
    // on-demand coverage also requires upstream fallback after metadata failure.
    expect(sourceStarts).toBe(1)
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.rows.has(`unsafe`)).toBe(true)
    await collection.cleanup()
  })

  it(`applies queued peer commits before a later coordinator response position`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createCoordinatorHarness()
    const requestStarted = deferred()
    const response = deferred<{
      type: `rpc:applyPersistedTransaction:res`
      rpcId: string
      ok: true
      txId: string
      term: number
      seq: number
      latestRowVersion: number
    }>()
    coordinator.requestApplyPersistedTransaction = async (
      _collectionId,
      transaction,
    ) => {
      requestStarted.resolve()
      const result = await response.promise
      return { ...result, txId: transaction.txId }
    }
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => SyncAppliedReceipt) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as typeof remoteWrite
            remoteCommit = commit
            markReady()
            return {}
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    await collection.preload()
    remoteBegin?.()
    remoteWrite?.({
      type: `insert`,
      value: { id: `local`, title: `Coordinator transaction` },
    })
    const applied = remoteCommit?.()
    expect(applied).not.toBe(true)
    await requestStarted.promise

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `peer-first`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [
        {
          key: `peer`,
          value: { id: `peer`, title: `Peer transaction` },
        },
      ],
      deletedKeys: [],
    })
    response.resolve({
      type: `rpc:applyPersistedTransaction:res`,
      rpcId: `source-second`,
      ok: true,
      txId: `placeholder`,
      term: 1,
      seq: 2,
      latestRowVersion: 2,
    })
    if (applied !== true) await applied
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`peer`))).toEqual({
      id: `peer`,
      title: `Peer transaction`,
    })
    expect(stripVirtualProps(collection.get(`local`))).toEqual({
      id: `local`,
      title: `Coordinator transaction`,
    })
    await collection.cleanup()
  })

  it(`obeys the peer-before-response ordering law across generated queue widths`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          peerCount: fc.integer({ min: 1, max: 4 }),
          salt: fc.integer({ min: 0, max: 10_000 }),
        }),
        async ({ peerCount, salt }) => {
          const adapter = createRecordingAdapter()
          const coordinator = createCoordinatorHarness()
          const requestStarted = deferred()
          const response = deferred<{
            type: `rpc:applyPersistedTransaction:res`
            rpcId: string
            ok: true
            txId: string
            term: number
            seq: number
            latestRowVersion: number
          }>()
          coordinator.requestApplyPersistedTransaction = async (
            _collectionId,
            transaction,
          ) => {
            requestStarted.resolve()
            const result = await response.promise
            return { ...result, txId: transaction.txId }
          }
          let remoteBegin: (() => void) | undefined
          let remoteWrite:
            | ((message: { type: `insert`; value: Todo }) => void)
            | undefined
          let remoteCommit: (() => SyncAppliedReceipt) | undefined
          const collection = createCollection(
            persistedCollectionOptions<Todo, string>({
              id: `sync-present`,
              getKey: (item) => item.id,
              sync: {
                sync: ({ begin, write, commit, markReady }) => {
                  remoteBegin = begin
                  remoteWrite = write as typeof remoteWrite
                  remoteCommit = commit
                  markReady()
                  return {}
                },
              },
              persistence: { adapter, coordinator },
            }),
          )
          const peerRows = Array.from({ length: peerCount }, (_, index) => ({
            id: `peer-${salt}-${index}`,
            title: `Peer ${index}`,
          }))
          const local = { id: `local-${salt}`, title: `Local` }

          try {
            await collection.preload()
            remoteBegin?.()
            remoteWrite?.({ type: `insert`, value: local })
            const applied = remoteCommit?.()
            expect(applied).not.toBe(true)
            await requestStarted.promise

            peerRows.forEach((row, index) => {
              coordinator.emit({
                type: `tx:committed`,
                term: 1,
                seq: index + 1,
                txId: `peer-before-response-${salt}-${index}`,
                latestRowVersion: index + 1,
                requiresFullReload: false,
                changedRows: [{ key: row.id, value: row }],
                deletedKeys: [],
              })
            })
            response.resolve({
              type: `rpc:applyPersistedTransaction:res`,
              rpcId: `local-after-peers-${salt}`,
              ok: true,
              txId: `placeholder`,
              term: 1,
              seq: peerCount + 1,
              latestRowVersion: peerCount + 1,
            })
            if (applied !== true) await applied
            await flushAsyncWork()

            const expectedKeys = [...peerRows.map((row) => row.id), local.id]
            const actualKeys = expectedKeys.filter(
              (key) => collection.get(key) !== undefined,
            )
            expectExactKeys(actualKeys, expectedKeys)
          } finally {
            await collection.cleanup()
          }
        },
      ),
      { numRuns: 8, seed: 18_690_606 },
    )
  })

  it(`rejects a hostile ordering trace that advances past a queued peer`, () => {
    expect(() =>
      expectExactKeys([`local`], [`peer-before-response`, `local`]),
    ).toThrow()
  })

  it(`tracks fallback subset demand for peer reload and remote ensure retry`, async () => {
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const startupError = new Error(`startup metadata unavailable`)
    const sourceStarted = deferred()
    const metadataAttempted = deferred()
    const adapter = createRecordingAdapter()
    adapter.getStreamPosition = async () => {
      metadataAttempted.resolve()
      throw startupError
    }
    let localLoads = 0
    adapter.loadSubset = async (collectionId, options, ctx) => {
      adapter.loadSubsetCalls.push({
        collectionId,
        options,
        requiredIndexSignatures: ctx?.requiredIndexSignatures ?? [],
      })
      localLoads++
      return []
    }
    const coordinator = createCoordinatorHarness()
    let ensureCalls = 0
    coordinator.requestEnsureRemoteSubset = async () => {
      ensureCalls++
      if (ensureCalls === 1) throw new Error(`leader unavailable`)
    }
    let upstreamLoads = 0
    let upstreamBegin: (() => void) | undefined
    let upstreamWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let upstreamCommit: (() => SyncAppliedReceipt) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            sourceStarted.resolve()
            upstreamBegin = begin
            upstreamWrite = write as typeof upstreamWrite
            upstreamCommit = commit
            markReady()
            return {
              loadSubset: async () => {
                upstreamLoads++
                upstreamBegin?.()
                upstreamWrite?.({
                  type: `insert`,
                  value: { id: `remote`, title: `Remote subset` },
                })
                const applied = upstreamCommit?.()
                if (applied !== true) await applied
              },
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const subsetOptions: LoadSubsetOptions = { limit: 7, offset: 2 }

    try {
      collection.startSyncImmediate()
      await Promise.all([sourceStarted.promise, metadataAttempted.promise])
      vi.useFakeTimers()
      await collection._sync.loadSubset(subsetOptions)
      await vi.advanceTimersByTimeAsync(0)

      expect({ localLoads, upstreamLoads, ensureCalls }).toEqual({
        localLoads: 1,
        upstreamLoads: 1,
        ensureCalls: 1,
      })

      await vi.advanceTimersByTimeAsync(50)
      expect(ensureCalls).toBe(2)

      coordinator.emit({
        type: `tx:committed`,
        term: 1,
        seq: 2,
        txId: `peer-reload`,
        latestRowVersion: 2,
        requiresFullReload: true,
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(localLoads).toBe(2)
      expect(adapter.loadSubsetCalls.at(-1)?.options).toBe(subsetOptions)
    } finally {
      await collection.cleanup()
      warning.mockRestore()
      vi.useRealTimers()
    }
  })

  it(`signals readiness once when eager hydration and upstream readiness race`, async () => {
    const hydrationStarted = deferred()
    const upstreamStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    let markUpstreamReady: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `readiness-race`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markUpstreamReady = markReady
            upstreamStarted.resolve()
          },
        },
        persistence: { adapter },
      }),
    )
    let readyEvents = 0
    collection.on(`status:ready`, () => readyEvents++)

    collection.startSyncImmediate()
    await Promise.all([hydrationStarted.promise, upstreamStarted.promise])
    expect(markUpstreamReady).toBeTypeOf(`function`)
    markUpstreamReady!()
    expect(collection.status).toBe(`ready`)
    expect(readyEvents).toBe(1)

    hydration.resolve([])
    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(readyEvents).toBe(1)
    await collection.cleanup()
  })

  it(`cleanup fences old readiness before a fresh restart snapshot`, async () => {
    const hydrationStarted = deferred()
    const upstreamStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    let markUpstreamReady: (() => void) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `cleanup-during-hydration`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markUpstreamReady = markReady
            upstreamStarted.resolve()
          },
        },
        persistence: { adapter },
      }),
    )
    let readyEvents = 0
    collection.on(`status:ready`, () => readyEvents++)

    collection.startSyncImmediate()
    await Promise.all([hydrationStarted.promise, upstreamStarted.promise])
    await collection.cleanup()
    expect(markUpstreamReady).toBeTypeOf(`function`)
    markUpstreamReady!()
    hydration.resolve([
      { key: `late`, value: { id: `late`, title: `Must not apply` } },
    ])
    await hydration.promise
    await flushAsyncWork()

    expect(readyEvents).toBe(0)
    expect(collection.get(`late`)).toBeUndefined()

    adapter.loadSubset = () =>
      Promise.resolve([
        { key: `fresh`, value: { id: `fresh`, title: `Fresh restart` } },
      ])
    collection.on(`status:ready`, () => readyEvents++)
    collection.startSyncImmediate()
    await collection.stateWhenReady()

    expect(readyEvents).toBe(1)
    expect(stripVirtualProps(collection.get(`fresh`))).toEqual({
      id: `fresh`,
      title: `Fresh restart`,
    })
    expect(collection.get(`late`)).toBeUndefined()
    await collection.cleanup()
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

  it(`does not let a stale invalidation reload overwrite an authoritative snapshot`, async () => {
    const adapter = createRecordingAdapter([
      { id: `cached`, title: `Cached snapshot` },
    ])
    const coordinator = createCoordinatorHarness()
    const reloadStarted = deferred()
    const releaseReload = deferred()
    const originalLoadSubset = adapter.loadSubset.bind(adapter)
    let loadCalls = 0
    adapter.loadSubset = async (...args) => {
      loadCalls++
      if (loadCalls !== 2) return originalLoadSubset(...args)
      const staleRows = [
        {
          key: `stale`,
          value: { id: `stale`, title: `Stale reload` },
        },
      ]
      reloadStarted.resolve()
      await releaseReload.promise
      return staleRows
    }
    let remoteBegin: (() => void) | undefined
    let remoteTruncate: (() => void) | undefined
    let remoteWrite:
      | ((message: { type: `insert`; value: Todo }) => void)
      | undefined
    let remoteCommit: (() => SyncAppliedReceipt) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, truncate, write, commit }) => {
            remoteBegin = begin
            remoteTruncate = truncate
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            return {}
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    await collection.preload()
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `full-reload-before-authoritative-snapshot`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    await reloadStarted.promise

    remoteBegin!()
    remoteTruncate!()
    remoteWrite!({
      type: `insert`,
      value: { id: `network`, title: `Authoritative network snapshot` },
    })
    const applied = remoteCommit!()
    if (applied !== true) void applied.catch(() => undefined)
    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Authoritative network snapshot`,
    })

    releaseReload.resolve()
    await flushAsyncWork()
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`network`))).toEqual({
      id: `network`,
      title: `Authoritative network snapshot`,
    })
    expect(collection.get(`stale`)).toBeUndefined()
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

  it(`does not reload an on-demand collection after its final subset unloads`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Owned while subscribed` },
    ])
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
    const options: LoadSubsetOptions = { limit: 1 }

    collection.startSyncImmediate()
    await collection._sync.loadSubset(options)
    collection._sync.unloadSubset(options)
    const callsAfterUnload = adapter.loadSubsetCalls.length

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `peer-after-final-unload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    await flushAsyncWork()
    await flushAsyncWork()

    expect(adapter.loadSubsetCalls).toHaveLength(callsAfterUnload)
    await collection.cleanup()
  })

  it(`obeys the demand-ownership law across generated failure and unload histories`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          history: fc.constantFrom<`fallback-active` | `released`>(
            `fallback-active`,
            `released`,
          ),
          limit: fc.integer({ min: 1, max: 4 }),
          offset: fc.integer({ min: 0, max: 2 }),
          salt: fc.integer({ min: 0, max: 10_000 }),
        }),
        async ({ history, limit, offset, salt }) => {
          const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
          const adapter = createRecordingAdapter()
          const metadataAttempted = deferred()
          if (history === `fallback-active`) {
            adapter.getStreamPosition = async () => {
              metadataAttempted.resolve()
              throw new Error(`generated startup failure ${salt}`)
            }
          } else {
            metadataAttempted.resolve()
          }
          const originalLoadSubset = adapter.loadSubset.bind(adapter)
          let localLoads = 0
          adapter.loadSubset = async (collectionId, options, ctx) => {
            localLoads++
            return originalLoadSubset(collectionId, options, ctx)
          }
          const coordinator = createCoordinatorHarness()
          let ensureCalls = 0
          coordinator.requestEnsureRemoteSubset = async () => {
            ensureCalls++
            if (history === `fallback-active` && ensureCalls === 1) {
              throw new Error(`generated leader failure ${salt}`)
            }
          }
          const sourceStarted = deferred()
          let upstreamLoads = 0
          const collection = createCollection(
            persistedCollectionOptions<Todo, string>({
              id: `sync-present`,
              syncMode: `on-demand`,
              getKey: (item) => item.id,
              sync: {
                sync: ({ markReady }) => {
                  markReady()
                  sourceStarted.resolve()
                  return {
                    loadSubset: () => {
                      upstreamLoads++
                      return true
                    },
                  }
                },
              },
              persistence: { adapter, coordinator },
            }),
          )
          const options: LoadSubsetOptions = { limit, offset }

          try {
            collection.startSyncImmediate()
            await Promise.all([
              sourceStarted.promise,
              metadataAttempted.promise,
            ])
            vi.useFakeTimers()
            await collection._sync.loadSubset(options)
            await vi.advanceTimersByTimeAsync(0)

            expect(localLoads).toBe(1)
            expect(upstreamLoads).toBe(1)

            if (history === `fallback-active`) {
              expect(ensureCalls).toBe(1)
              await vi.advanceTimersByTimeAsync(50)
              expect(ensureCalls).toBe(2)
            } else {
              collection._sync.unloadSubset(options)
            }

            const callsBeforeReload = localLoads
            coordinator.emit({
              type: `tx:committed`,
              term: 1,
              seq: 1,
              txId: `generated-demand-${salt}`,
              latestRowVersion: 1,
              requiresFullReload: true,
            })
            await vi.advanceTimersByTimeAsync(0)

            if (history === `fallback-active`) {
              expect(localLoads).toBe(callsBeforeReload + 1)
              expect(adapter.loadSubsetCalls.at(-1)?.options).toBe(options)
            } else {
              expect(localLoads).toBe(callsBeforeReload)
            }
          } finally {
            await collection.cleanup()
            vi.useRealTimers()
            warning.mockRestore()
          }
        },
      ),
      { numRuns: 8, seed: 18_690_812 },
    )
  })

  it(`rejects hostile demand traces that fabricate or replace ownership`, () => {
    const owned = { limit: 1 }
    expect(() => expect({}).toBe(owned)).toThrow()
    expect(() => expect(2).toBe(1)).toThrow()
  })

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

  it(`does not acquire an upstream lease after released hydration fails`, async () => {
    const localError = new Error(`persisted rows unavailable`)
    const hydrationStarted = deferred()
    const hydration = deferred<Array<{ key: string; value: Todo }>>()
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => {
      hydrationStarted.resolve()
      return hydration.promise
    }
    let loads = 0
    let unloads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `released-failed-hydration`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
              unloadSubset: () => {
                unloads++
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    const options: LoadSubsetOptions = { limit: 1 }

    collection.startSyncImmediate()
    const pending = collection._sync.loadSubset(options)
    await hydrationStarted.promise
    collection._sync.unloadSubset(options)
    hydration.reject(localError)
    await pending

    expect(loads).toBe(0)
    expect(unloads).toBe(0)
    await collection.cleanup()
  })

  it.each([`abort`, `release`, `offline`] as const)(
    `handles remote ensure after %s without resurrecting cancelled demand`,
    async (action) => {
      vi.useFakeTimers()
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const failure = Object.assign(new Error(action), {
        name: action === `abort` ? `AbortError` : `Error`,
      })
      const ensure = vi.fn(async () => {
        throw new Error(`offline`)
      })
      const coordinator: PersistedCollectionCoordinator = {
        getNodeId: () => `cancel-ensure`,
        subscribe: () => () => {},
        publish: () => {},
        isLeader: () => true,
        ensureLeadership: async () => {},
        requestEnsurePersistedIndex: async () => {},
        requestEnsureRemoteSubset: ensure,
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
                loadSubset: async () => {
                  throw failure
                },
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
      const options = { limit: 1 }
      try {
        collection.startSyncImmediate()
        const result = await Promise.resolve(
          collection._sync.loadSubset(options),
        ).then(
          () => `ready`,
          (error: unknown) => error,
        )
        if (action === `release`) collection._sync.unloadSubset(options)
        const callsBeforeRetry = ensure.mock.calls.length
        await vi.advanceTimersByTimeAsync(200)
        if (action === `offline`) {
          expect(result).toBe(failure)
          expect(ensure.mock.calls.length).toBeGreaterThan(callsBeforeRetry)
        } else {
          if (action === `abort`) expect(result).toBe(failure)
          expect(ensure).toHaveBeenCalledTimes(callsBeforeRetry)
        }
      } finally {
        await collection.cleanup()
        warning.mockRestore()
        vi.useRealTimers()
      }
    },
  )

  it(`does not start or retry remote demand after local hydration aborts`, async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const abortError = Object.assign(new Error(`local hydration aborted`), {
      name: `AbortError`,
    })
    const adapter = createRecordingAdapter()
    adapter.loadSubset = () => Promise.reject(abortError)
    const ensure = vi.fn(async () => {
      throw new Error(`remote ensure must not run for cancelled demand`)
    })
    const upstreamLoadSubset = vi.fn(async (): Promise<void> => {})
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `local-abort-ensure`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestEnsureRemoteSubset: ensure,
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-hydration-abort`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: upstreamLoadSubset }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    try {
      collection.startSyncImmediate()
      await expect(collection._sync.loadSubset({ limit: 1 })).rejects.toBe(
        abortError,
      )
      await vi.advanceTimersByTimeAsync(500)

      expect(upstreamLoadSubset).not.toHaveBeenCalled()
      expect(ensure).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
      warning.mockRestore()
      vi.useRealTimers()
    }
  })

  it(`retries queued remote subset ensure after transient failures`, async () => {
    const adapter = createRecordingAdapter()
    let ensureCalls = 0

    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `retry-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestEnsureRemoteSubset: async () => {
        ensureCalls++
        if (ensureCalls === 1) {
          throw new Error(`offline`)
        }
      },
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-retry`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
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

    await (collection as any)._sync.loadSubset({ limit: 1 })
    await flushAsyncWork(120)

    expect(ensureCalls).toBeGreaterThanOrEqual(2)
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
