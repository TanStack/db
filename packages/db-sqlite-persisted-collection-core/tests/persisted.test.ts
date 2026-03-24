import { describe, expect, it } from 'vitest'
import { IR, createCollection, createTransaction } from '@tanstack/db'
import { BasicIndex } from '@tanstack/db/indexing'
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
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'

type Todo = {
  id: string
  title: string
}

type RecordingAdapter = PersistenceAdapter<Todo, string> & {
  applyCommittedTxCalls: Array<{
    collectionId: string
    tx: {
      term: number
      seq: number
      rowVersion: number
      truncate?: boolean
      mutations: Array<{ type: `insert` | `update` | `delete`; key: string }>
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
          rows.delete(mutation.key)
          rowMetadata.delete(mutation.key)
        } else {
          rows.set(mutation.key, mutation.value)
          if (mutation.metadataChanged) {
            rowMetadata.set(mutation.key, mutation.metadata)
          }
        }
      }
      for (const rowMetadataMutation of tx.rowMetadataMutations ?? []) {
        if (rowMetadataMutation.type === `delete`) {
          rowMetadata.delete(rowMetadataMutation.key)
        } else {
          rowMetadata.set(rowMetadataMutation.key, rowMetadataMutation.value)
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

function createNoopAdapter(): PersistenceAdapter<Todo, string> {
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

    const persistence: PersistedCollectionPersistence<Todo, string> = {
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
