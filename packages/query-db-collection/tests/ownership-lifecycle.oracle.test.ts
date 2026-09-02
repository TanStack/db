import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, hashKey } from '@tanstack/query-core'
import { createCollection, eq } from '@tanstack/db'
import { createDeferred } from '../../db/src/deferred.js'
import { TraceAssertionError } from '../../db/tests/trace-runner.js'
import { queryCollectionOptions } from '../src/query.js'
import type { Collection, SyncMetadataApi } from '@tanstack/db'
import type { NonSingleResult } from '../../db/src/types.js'
import type { QueryCollectionUtils } from '../src/query.js'

type Item = {
  id: string
  category: string
  name: string
}

type OwnershipMaps = {
  rowToQueries: Map<string | number, Set<string>>
  queryToRows: Map<string, Set<string | number>>
}

type MetadataRecorder = {
  rowWrites: Array<{
    type: `set` | `delete`
    key: string | number
  }>
}

type OwnershipFixtureOptions = {
  id: string
  results: Array<Array<Item> | Promise<Array<Item>>>
  syncMode?: `eager` | `on-demand`
  metadataRecorder?: MetadataRecorder
  setupMetadata?: (metadata: SyncMetadataApi<string | number>) => void
}

type OwnershipFixture = {
  collection: Collection<
    Item,
    string | number,
    QueryCollectionUtils<Item, string | number, Item, unknown>,
    never,
    Item
  > &
    NonSingleResult
  maps: OwnershipMaps
  queryClient: QueryClient
  queryFn: ReturnType<typeof vi.fn<() => Promise<Array<Item>>>>
}

const shared = { id: `shared`, category: `shared`, name: `Shared` }
const detailOnly = { id: `detail`, category: `detail`, name: `Detail` }
const listOnly = { id: `list`, category: `list`, name: `List` }
const cleanups: Array<() => Promise<void>> = []

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
}

function inspectOwnershipMaps(options: {
  sync: { sync: unknown }
}): OwnershipMaps {
  const sync = options.sync.sync as {
    __getOwnershipMapsForTests?: () => OwnershipMaps
  }
  const maps = sync.__getOwnershipMapsForTests?.()
  if (!maps) {
    throw new Error(`Ownership-map test inspection is unavailable`)
  }
  return maps
}

function sorted<T extends string | number>(values: Iterable<T>): Array<T> {
  return Array.from(values).sort()
}

function ownersOf(maps: OwnershipMaps, rowId: string): Array<string> {
  return sorted(maps.rowToQueries.get(rowId) ?? [])
}

function onlyOwner(maps: OwnershipMaps, rowId: string): string {
  const owners = ownersOf(maps, rowId)
  if (owners.length !== 1) {
    throw new Error(`Expected exactly one owner for ${rowId}`)
  }
  return owners[0]!
}

function otherOwner(
  maps: OwnershipMaps,
  rowId: string,
  knownOwner: string,
): string {
  const owners = ownersOf(maps, rowId).filter((owner) => owner !== knownOwner)
  if (owners.length !== 1) {
    throw new Error(`Expected one new owner for ${rowId}`)
  }
  return owners[0]!
}

function rowsOwnedBy(
  maps: OwnershipMaps,
  queryHash: string,
): Array<string | number> {
  return sorted(maps.queryToRows.get(queryHash) ?? [])
}

function observerCount(queryClient: QueryClient, queryHash: string): number {
  return (
    queryClient
      .getQueryCache()
      .getAll()
      .find((query) => query.queryHash === queryHash)
      ?.getObserversCount() ?? 0
  )
}

function collectionRows(collection: {
  keys: () => Iterable<string | number>
}): Array<string> {
  return sorted(collection.keys()).map(String)
}

function assertCheckpoint(
  checkpoint: number,
  actual: unknown,
  expected: unknown,
): void {
  try {
    expect(actual).toEqual(expected)
  } catch (error) {
    throw new TraceAssertionError(checkpoint, error)
  }
}

function recordMetadataWrites(
  metadata: SyncMetadataApi<string | number>,
  recorder: MetadataRecorder,
): SyncMetadataApi<string | number> {
  return {
    row: {
      get: (key) => metadata.row.get(key),
      set: (key, value) => {
        recorder.rowWrites.push({ type: `set`, key })
        metadata.row.set(key, value)
      },
      delete: (key) => {
        recorder.rowWrites.push({ type: `delete`, key })
        metadata.row.delete(key)
      },
    },
    collection: {
      get: (key) => metadata.collection.get(key),
      set: (key, value) => metadata.collection.set(key, value),
      delete: (key) => metadata.collection.delete(key),
      list: (prefix) => metadata.collection.list(prefix),
    },
  }
}

function createOwnershipFixture({
  id,
  results,
  syncMode = `on-demand`,
  metadataRecorder,
  setupMetadata,
}: OwnershipFixtureOptions): OwnershipFixture {
  const queryClient = createQueryClient()
  const queryFn = vi.fn<() => Promise<Array<Item>>>()
  results.forEach((result) =>
    queryFn.mockImplementationOnce(() => Promise.resolve(result)),
  )
  queryFn.mockRejectedValue(new Error(`Unexpected ownership-oracle refetch`))
  const baseOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn,
    getKey: (item) => item.id,
    syncMode,
    startSync: true,
  })
  const maps = inspectOwnershipMaps(baseOptions)
  const originalSync = baseOptions.sync
  let pendingSetupMetadata = setupMetadata
  const collection = createCollection(
    metadataRecorder || setupMetadata
      ? {
          ...baseOptions,
          sync: {
            sync: (params: Parameters<typeof originalSync.sync>[0]) => {
              if (!params.metadata) {
                throw new Error(`Sync metadata API is unavailable`)
              }
              if (pendingSetupMetadata) {
                params.begin()
                pendingSetupMetadata(params.metadata)
                params.commit()
                pendingSetupMetadata = undefined
              }
              return originalSync.sync({
                ...params,
                metadata: metadataRecorder
                  ? recordMetadataWrites(params.metadata, metadataRecorder)
                  : params.metadata,
              })
            },
          },
        }
      : baseOptions,
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
  })

  return { collection, maps, queryClient, queryFn }
}

function persistedOwners(
  rowMetadata: ReadonlyMap<string | number, unknown>,
  rowId: string,
): Array<string> {
  const metadata = rowMetadata.get(rowId)
  if (!metadata || typeof metadata !== `object`) {
    return []
  }

  const queryCollection = (metadata as Record<string, unknown>).queryCollection
  if (!queryCollection || typeof queryCollection !== `object`) {
    return []
  }

  const owners = (queryCollection as Record<string, unknown>).owners
  if (!owners || typeof owners !== `object`) {
    return []
  }

  return sorted(Object.keys(owners))
}

function setMetadataKeys(recorder: MetadataRecorder): Array<string | number> {
  return sorted(
    new Set(
      recorder.rowWrites
        .filter((write) => write.type === `set`)
        .map((write) => write.key),
    ),
  )
}

describe(`query collection ownership lifecycle oracle`, () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  it(`keeps query ownership while a reused subset still has an acquisition`, async () => {
    const { collection, maps, queryFn } = createOwnershipFixture({
      id: `ownership-shared-acquisition`,
      results: [[shared, detailOnly]],
    })
    const subset = { where: eq(`category`, `detail`) }

    await collection._sync.loadSubset(subset)
    const queryHash = onlyOwner(maps, shared.id)
    assertCheckpoint(
      0,
      {
        fetches: queryFn.mock.calls.length,
        owners: ownersOf(maps, shared.id),
        ownedRows: rowsOwnedBy(maps, queryHash),
      },
      {
        fetches: 1,
        owners: [queryHash],
        ownedRows: [detailOnly.id, shared.id],
      },
    )

    await collection._sync.loadSubset(subset)
    assertCheckpoint(
      1,
      {
        fetches: queryFn.mock.calls.length,
        owners: ownersOf(maps, shared.id),
      },
      { fetches: 1, owners: [queryHash] },
    )

    collection._sync.unloadSubset(subset)
    assertCheckpoint(
      2,
      {
        rows: collectionRows(collection),
        owners: ownersOf(maps, shared.id),
      },
      {
        rows: [detailOnly.id, shared.id],
        owners: [queryHash],
      },
    )

    collection._sync.unloadSubset(subset)
    assertCheckpoint(
      3,
      {
        rows: collectionRows(collection),
        ownershipRows: maps.rowToQueries.size,
        ownershipQueries: maps.queryToRows.size,
      },
      { rows: [], ownershipRows: 0, ownershipQueries: 0 },
    )

    await collection._sync.loadSubset(subset)
    assertCheckpoint(
      4,
      {
        fetches: queryFn.mock.calls.length,
        rows: collectionRows(collection),
        owners: ownersOf(maps, shared.id),
      },
      {
        fetches: 1,
        rows: [detailOnly.id, shared.id],
        owners: [queryHash],
      },
    )
  })

  it(`#1488 retires ownership with its observer and reacquires it from cached data`, async () => {
    const { collection, maps, queryClient, queryFn } = createOwnershipFixture({
      id: `ownership-observer-reuse-1488`,
      results: [
        [shared, detailOnly],
        [shared, listOnly],
      ],
    })
    const detailSubset = { where: eq(`category`, `detail`) }
    const listSubset = { where: eq(`category`, `list`) }

    await collection._sync.loadSubset(detailSubset)
    const detailHash = onlyOwner(maps, shared.id)
    await collection._sync.loadSubset(listSubset)
    const listHash = otherOwner(maps, shared.id, detailHash)
    assertCheckpoint(
      0,
      ownersOf(maps, shared.id),
      sorted([detailHash, listHash]),
    )

    collection._sync.unloadSubset(detailSubset)
    assertCheckpoint(
      1,
      {
        rows: collectionRows(collection),
        owners: ownersOf(maps, shared.id),
        tracksDetail: maps.queryToRows.has(detailHash),
        detailObservers: observerCount(queryClient, detailHash),
        detailCached: queryClient
          .getQueryCache()
          .getAll()
          .some((query) => query.queryHash === detailHash),
      },
      {
        rows: [listOnly.id, shared.id],
        owners: [listHash],
        tracksDetail: false,
        detailObservers: 0,
        detailCached: true,
      },
    )

    // The ownerless existing-observer state reported by #1488 is not reachable
    // here: observer and ownership retire together. Reacquisition creates a new
    // observer over cached data, which must register ownership again.
    await collection._sync.loadSubset(detailSubset)
    assertCheckpoint(
      2,
      {
        fetches: queryFn.mock.calls.length,
        owners: ownersOf(maps, shared.id),
        tracksDetail: maps.queryToRows.has(detailHash),
        detailObservers: observerCount(queryClient, detailHash),
      },
      {
        fetches: 2,
        owners: sorted([detailHash, listHash]),
        tracksDetail: true,
        detailObservers: 1,
      },
    )

    collection._sync.unloadSubset(listSubset)
    assertCheckpoint(
      3,
      {
        rows: collectionRows(collection),
        owners: ownersOf(maps, shared.id),
      },
      { rows: [detailOnly.id, shared.id], owners: [detailHash] },
    )
  })

  it(`keeps overlapping row ownership while acquisition and owner counts differ`, async () => {
    const { collection, maps, queryFn } = createOwnershipFixture({
      id: `ownership-count-boundaries`,
      results: [
        [shared, detailOnly],
        [shared, listOnly],
      ],
    })
    const detailSubset = { where: eq(`category`, `detail`) }
    const listSubset = { where: eq(`category`, `list`) }
    let activeAcquisitions = 0
    const acquire = async (subset: typeof detailSubset) => {
      activeAcquisitions += 1
      await collection._sync.loadSubset(subset)
    }
    const release = (subset: typeof detailSubset) => {
      activeAcquisitions -= 1
      collection._sync.unloadSubset(subset)
    }

    await acquire(detailSubset)
    const detailHash = onlyOwner(maps, shared.id)
    await acquire(detailSubset)
    await acquire(listSubset)
    const listHash = otherOwner(maps, shared.id, detailHash)
    assertCheckpoint(
      0,
      {
        acquisitions: activeAcquisitions,
        queryOwners: ownersOf(maps, shared.id),
        fetches: queryFn.mock.calls.length,
        rows: collectionRows(collection),
      },
      {
        acquisitions: 3,
        queryOwners: sorted([detailHash, listHash]),
        fetches: 2,
        rows: [detailOnly.id, listOnly.id, shared.id],
      },
    )

    release(detailSubset)
    release(listSubset)
    assertCheckpoint(
      1,
      {
        rows: collectionRows(collection),
        owners: ownersOf(maps, shared.id),
      },
      { rows: [detailOnly.id, shared.id], owners: [detailHash] },
    )

    release(detailSubset)
    assertCheckpoint(
      2,
      {
        rows: collectionRows(collection),
        ownershipRows: maps.rowToQueries.size,
        ownershipQueries: maps.queryToRows.size,
      },
      { rows: [], ownershipRows: 0, ownershipQueries: 0 },
    )
  })

  it(`keeps the eager owner when its last collection listener departs`, async () => {
    const id = `ownership-eager-listener`
    const { collection, maps, queryClient, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [[shared], [{ ...shared, name: `Refetched` }]],
    })

    await collection.stateWhenReady()
    onlyOwner(maps, shared.id)
    const subscription = collection.subscribeChanges(() => {})
    assertCheckpoint(
      0,
      {
        status: collection.status,
        listeners: collection.subscriberCount,
        rows: collectionRows(collection),
        owners: ownersOf(maps, shared.id).length,
      },
      { status: `ready`, listeners: 1, rows: [shared.id], owners: 1 },
    )

    subscription.unsubscribe()
    assertCheckpoint(1, collection.subscriberCount, 0)
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    try {
      // Removing the cache entry emits the same synchronous signal as gcTime,
      // without making the defect boundary depend on a timer.
      queryClient.removeQueries({ queryKey: [id], exact: true })

      assertCheckpoint(
        2,
        {
          status: collection.status,
          rows: collectionRows(collection),
          owners: ownersOf(maps, shared.id).length,
        },
        { status: `ready`, rows: [shared.id], owners: 1 },
      )
      expect(warning).not.toHaveBeenCalled()

      await vi.waitFor(() => {
        expect(observerCount(queryClient, onlyOwner(maps, shared.id))).toBe(1)
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(collection.get(shared.id)?.name).toBe(`Refetched`)
      })

      const remounted = collection.subscribeChanges(() => {})
      assertCheckpoint(
        3,
        {
          status: collection.status,
          rows: collectionRows(collection),
          owners: ownersOf(maps, shared.id).length,
        },
        { status: `ready`, rows: [shared.id], owners: 1 },
      )
      remounted.unsubscribe()
    } finally {
      warning.mockRestore()
    }
  })

  it(`keeps an active on-demand owner when its cache entry is removed`, async () => {
    const id = `ownership-active-cache-removal`
    const { collection, maps, queryClient } = createOwnershipFixture({
      id,
      results: [[shared]],
    })
    const subset = { where: eq(`category`, `detail`) }

    await collection._sync.loadSubset(subset)
    const queryHash = onlyOwner(maps, shared.id)
    const subscription = collection.subscribeChanges(() => {})
    subscription.unsubscribe()
    assertCheckpoint(0, collection.subscriberCount, 0)

    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    try {
      queryClient.removeQueries({ queryKey: [id] })

      assertCheckpoint(
        1,
        {
          rows: collectionRows(collection),
          owners: ownersOf(maps, shared.id),
          ownedRows: rowsOwnedBy(maps, queryHash),
        },
        {
          rows: [shared.id],
          owners: [queryHash],
          ownedRows: [shared.id],
        },
      )
      expect(warning).not.toHaveBeenCalled()
    } finally {
      warning.mockRestore()
    }

    collection._sync.unloadSubset(subset)
    assertCheckpoint(
      2,
      {
        rows: collectionRows(collection),
        ownershipRows: maps.rowToQueries.size,
        ownershipQueries: maps.queryToRows.size,
      },
      { rows: [], ownershipRows: 0, ownershipQueries: 0 },
    )
  })

  it(`keeps every persisted owner when overlapping queries insert rows`, async () => {
    const metadataRecorder: MetadataRecorder = { rowWrites: [] }
    const { collection, maps } = createOwnershipFixture({
      id: `ownership-persisted-baseline`,
      results: [[shared], [shared, listOnly]],
      metadataRecorder,
    })
    const detailSubset = { where: eq(`category`, `detail`) }
    const listSubset = { where: eq(`category`, `list`) }

    await collection._sync.loadSubset(detailSubset)
    const detailHash = onlyOwner(maps, shared.id)
    assertCheckpoint(
      0,
      {
        persistedOwners: persistedOwners(
          collection._state.syncedMetadata,
          shared.id,
        ),
        metadataSetKeys: setMetadataKeys(metadataRecorder),
      },
      { persistedOwners: [detailHash], metadataSetKeys: [shared.id] },
    )

    await collection._sync.loadSubset(listSubset)
    const listHash = otherOwner(maps, shared.id, detailHash)
    assertCheckpoint(
      1,
      {
        liveOwners: ownersOf(maps, shared.id),
        persistedOwners: persistedOwners(
          collection._state.syncedMetadata,
          shared.id,
        ),
        insertedOwners: persistedOwners(
          collection._state.syncedMetadata,
          listOnly.id,
        ),
        metadataSetKeys: setMetadataKeys(metadataRecorder),
      },
      {
        liveOwners: sorted([detailHash, listHash]),
        persistedOwners: sorted([detailHash, listHash]),
        insertedOwners: [listHash],
        metadataSetKeys: [listOnly.id, shared.id],
      },
    )

    collection._sync.unloadSubset(listSubset)
    assertCheckpoint(
      2,
      {
        rows: collectionRows(collection),
        liveOwners: ownersOf(maps, shared.id),
        persistedOwners: persistedOwners(
          collection._state.syncedMetadata,
          shared.id,
        ),
      },
      {
        rows: [shared.id],
        liveOwners: [detailHash],
        persistedOwners: [detailHash],
      },
    )
  })

  it(`restages an existing persisted owner when its absent row is inserted`, async () => {
    const id = `ownership-existing-metadata-before-insert`
    const queryHash = hashKey([id])
    const result = createDeferred<Array<Item>>()
    const { collection, maps, queryFn } = createOwnershipFixture({
      id,
      syncMode: `eager`,
      results: [result.promise],
      setupMetadata: (metadata) => {
        metadata.row.set(shared.id, {
          queryCollection: { owners: { [queryHash]: true } },
        })
      },
    })

    expect(queryFn).toHaveBeenCalledTimes(1)
    assertCheckpoint(
      0,
      {
        rows: collectionRows(collection),
        liveOwners: ownersOf(maps, shared.id),
        persistedOwners: persistedOwners(
          collection._state.syncedMetadata,
          shared.id,
        ),
      },
      {
        rows: [],
        liveOwners: [],
        persistedOwners: [queryHash],
      },
    )

    result.resolve([shared])
    await collection.stateWhenReady()
    assertCheckpoint(
      1,
      {
        rows: collectionRows(collection),
        liveOwners: ownersOf(maps, shared.id),
        persistedOwners: persistedOwners(
          collection._state.syncedMetadata,
          shared.id,
        ),
      },
      {
        rows: [shared.id],
        liveOwners: [queryHash],
        persistedOwners: [queryHash],
      },
    )
  })
})
