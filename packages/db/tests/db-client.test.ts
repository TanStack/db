import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  DbClient,
  collectionOptions,
  createLiveQueryCollection,
  createTransaction,
  eq,
  liveQueryCollectionOptions,
  localOnlyCollectionOptions,
} from '../src'
import { mockSyncCollectionOptions } from './utils'
import type {
  DehydratedLiveQueryResult,
  InitialQueryBuilder,
  LoadSubsetOptions,
} from '../src'

type Person = {
  id: string
  name: string
  status?: string
}

const people: Array<Person> = [
  { id: `1`, name: `Tanner`, status: `active` },
  { id: `2`, name: `Kyle`, status: `inactive` },
]

describe(`DbClient`, () => {
  it(`memoizes materialized collections per client and isolates clients`, () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )

    const clientA = new DbClient()
    const clientB = new DbClient()

    const peopleA1 = clientA.collection(descriptor)
    const peopleA2 = clientA.collection(descriptor)
    const peopleB = clientB.collection(descriptor)

    expect(peopleA1).toBe(peopleA2)
    expect(peopleA1).not.toBe(peopleB)
    expect(peopleA1.toArray).toHaveLength(2)
    expect(peopleB.toArray).toHaveLength(2)
  })

  it(`materializes independent adapter state for each client`, async () => {
    const descriptor = collectionOptions(
      localOnlyCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
      }),
    )
    const clientA = new DbClient()
    const clientB = new DbClient()
    const peopleA = clientA.collection(descriptor)
    const peopleB = clientB.collection(descriptor)

    const transaction = peopleA.insert(people[0]!)
    await transaction.isPersisted.promise

    expect(peopleA.get(`1`)).toMatchObject(people[0]!)
    expect(peopleB.get(`1`)).toBeUndefined()
  })

  it(`does not reuse concrete configs across clients`, () => {
    const descriptor = collectionOptions({
      id: `people`,
      getKey: (person: Person) => person.id,
      sync: { sync: () => {} },
    })

    new DbClient().collection(descriptor)

    expect(() => new DbClient().collection(descriptor)).toThrow(
      /cannot be safely reused across DbClient instances/,
    )
  })

  it(`isolates ambient transactions between clients`, async () => {
    const descriptor = collectionOptions(
      localOnlyCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
      }),
    )
    const clientA = new DbClient()
    const clientB = new DbClient()
    const peopleA = clientA.collection(descriptor)
    const peopleB = clientB.collection(descriptor)
    const transactionA = clientA.createTransaction<Person>({
      autoCommit: false,
      mutationFn: async () => {},
    })
    const rolledBack = transactionA.isPersisted.promise.catch(() => undefined)
    let transactionB: ReturnType<typeof peopleB.insert> | undefined

    transactionA.mutate(() => {
      expect(peopleA.insert(people[0]!)).toBe(transactionA)
      transactionB = peopleB.insert(people[1]!)
      expect(transactionB).not.toBe(transactionA)
      expect(clientA.activeTransaction).toBe(transactionA)
      expect(clientB.activeTransaction).toBeUndefined()
    })

    await transactionB!.isPersisted.promise
    transactionA.rollback()
    await rolledBack

    expect(peopleA.get(`1`)).toBeUndefined()
    expect(peopleB.get(`2`)).toMatchObject(people[1]!)
  })

  it(`binds the backwards-compatible createTransaction API to one client`, async () => {
    const descriptor = collectionOptions(
      localOnlyCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
      }),
    )
    const clientA = new DbClient()
    const clientB = new DbClient()
    const peopleA = clientA.collection(descriptor)
    const peopleB = clientB.collection(descriptor)
    const transaction = createTransaction<Person>({
      autoCommit: false,
      mutationFn: async () => {},
    })
    const rolledBack = transaction.isPersisted.promise.catch(() => undefined)

    transaction.mutate(() => {
      expect(peopleA.insert(people[0]!)).toBe(transaction)
      expect(() => peopleB.insert(people[1]!)).toThrow(
        /cannot mutate collections from multiple DbClient instances/,
      )
    })

    transaction.rollback()
    await rolledBack

    expect(peopleA.get(`1`)).toBeUndefined()
    expect(peopleB.get(`2`)).toBeUndefined()
  })

  it(`cleans up materialized collections and allows rematerialization`, async () => {
    const cleanup = vi.fn()
    const descriptor = collectionOptions(`people`, () => ({
      id: `people`,
      getKey: (person: Person) => person.id,
      startSync: true,
      sync: {
        sync: () => ({ cleanup }),
      },
    }))
    const client = new DbClient()
    const first = client.collection(descriptor)

    await client.cleanup()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(client.dehydrate()).toEqual({ collections: [] })
    expect(client.collection(descriptor)).not.toBe(first)
  })

  it(`serializes collection rows and sync metadata from explicit ids`, () => {
    let syncMeta = { version: 1, cursor: `a` }
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: people,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({
              type: `insert`,
              value: people[0]!,
              metadata: { source: `server` },
            })
            commit()
            markReady()
          },
          exportSyncMeta: () => syncMeta,
          importSyncMeta: (meta) => {
            syncMeta = meta as typeof syncMeta
          },
          mergeSyncMeta: (_current, incoming) => incoming,
        },
      }),
    )

    const client = new DbClient()
    client.collection(descriptor)

    const dehydrated = client.dehydrate()

    expect(dehydrated).toEqual({
      collections: [
        {
          collectionId: `people`,
          rows: [
            {
              key: `1`,
              value: people[0],
              metadata: { source: `server` },
            },
          ],
          syncMeta: { version: 1, cursor: `a` },
        },
      ],
    })
  })

  it(`serializes only collections materialized through the client`, () => {
    const peopleDescriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )
    collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `unused-people`,
        getKey: (person) => person.id,
        initialData: [{ id: `3`, name: `Unused` }],
      }),
    )

    const client = new DbClient()

    expect(client.dehydrate()).toEqual({ collections: [] })

    client.collection(peopleDescriptor)

    expect(
      client.dehydrate().collections.map((chunk) => chunk.collectionId),
    ).toEqual([`people`])
  })

  it(`uses the collection id to reuse separately-created descriptors`, () => {
    const firstFactory = vi.fn(() =>
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [people[0]!],
      }),
    )
    const secondFactory = vi.fn(() =>
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [people[1]!],
      }),
    )
    const firstDescriptor = collectionOptions(`people`, firstFactory)
    const secondDescriptor = collectionOptions(`people`, secondFactory)

    const client = new DbClient()
    const first = client.collection(firstDescriptor)
    const second = client.collection(secondDescriptor)

    expect(second).toBe(first)
    expect(firstFactory).toHaveBeenCalledOnce()
    expect(secondFactory).not.toHaveBeenCalled()
    expect(second.toArray).toHaveLength(1)
    expect(second.toArray[0]).toMatchObject(people[0]!)
  })

  it(`reuses a same-id collection materialized by a descriptor factory`, () => {
    const client = new DbClient()
    const nestedDescriptor = collectionOptions(`people`, () =>
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [people[0]!],
      }),
    )
    const nestedCollections: Array<unknown> = []
    const outerDescriptor = collectionOptions(`people`, () => {
      nestedCollections.push(client.collection(nestedDescriptor))
      return mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [people[1]!],
      })
    })

    const collection = client.collection(outerDescriptor)

    expect(collection).toBe(nestedCollections[0])
    expect(collection.toArray).toHaveLength(1)
    expect(collection.toArray[0]).toMatchObject(people[0]!)
  })

  it(`requires a stable explicit collection id when creating a descriptor`, () => {
    expect(() =>
      collectionOptions(
        mockSyncCollectionOptions<Person>({
          id: undefined as unknown as string,
          getKey: (person) => person.id,
          initialData: people,
        }),
      ),
    ).toThrow(/collectionOptions requires a non-empty explicit id/)
  })

  it(`rejects an empty collection descriptor id`, () => {
    expect(() =>
      collectionOptions(
        mockSyncCollectionOptions<Person>({
          id: ``,
          getKey: (person) => person.id,
          initialData: people,
        }),
      ),
    ).toThrow(/collectionOptions requires a non-empty explicit id/)
  })

  it(`requires a factory when using the explicit id overload`, () => {
    expect(() =>
      Reflect.apply(collectionOptions, undefined, [`people`]),
    ).toThrow(/collectionOptions\("people"\) requires a factory/)
  })

  it(`hydrates pending collection rows when the collection materializes`, () => {
    const importedMeta = vi.fn()
    const lifecycleOrder: Array<string> = []
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [],
        sync: {
          sync: ({ markReady }) => {
            lifecycleOrder.push(`sync`)
            markReady()
          },
          importSyncMeta: (meta) => {
            lifecycleOrder.push(`import`)
            importedMeta(meta)
          },
        },
      }),
    )

    const client = new DbClient()
    client.hydrate({
      collections: [
        {
          collectionId: `people`,
          rows: [
            {
              key: `1`,
              value: people[0]!,
              metadata: { source: `ssr` },
            },
          ],
          syncMeta: { version: 1, cursor: `ssr` },
        },
      ],
    })

    const collection = client.collection(descriptor)

    expect(collection.get(`1`)).toMatchObject(people[0]!)
    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `ssr`,
    })
    expect(importedMeta).toHaveBeenCalledWith({ version: 1, cursor: `ssr` })
    expect(lifecycleOrder).toEqual([`import`, `sync`])
    expect(collection.status).toBe(`ready`)
  })

  it(`defers adapter sync and replays subset loads after hydrated rows render`, () => {
    const lifecycleOrder: Array<string> = []
    const descriptor = collectionOptions(`people`, () => ({
      id: `people`,
      getKey: (person: Person) => person.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          lifecycleOrder.push(`sync`)
          markReady()
          return {
            loadSubset: () => {
              lifecycleOrder.push(`load`)
              begin({ immediate: true })
              write({
                type: `insert`,
                value: { id: `1`, name: `fresh` },
              })
              commit()
              return true
            },
          }
        },
      },
    }))
    const client = new DbClient()

    client.hydrate({
      collections: [
        {
          collectionId: `people`,
          rows: [{ key: `1`, value: { id: `1`, name: `stale` } }],
        },
      ],
    })

    const collection = client._materializeCollectionForRender(descriptor)
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: true,
    })

    expect(collection.get(`1`)).toMatchObject({ id: `1`, name: `stale` })
    expect(lifecycleOrder).toEqual([])

    collection._resumeSyncStart()

    expect(lifecycleOrder).toEqual([`sync`, `load`])
    expect(collection.get(`1`)).toMatchObject({ id: `1`, name: `fresh` })
    subscription.unsubscribe()
  })

  it(`keeps deferred subset loads pending until the replayed adapter load finishes`, async () => {
    let resolveLoad!: () => void
    const adapterLoad = new Promise<void>((resolve) => {
      resolveLoad = resolve
    })
    const loadSubset = vi.fn(() => adapterLoad)
    const descriptor = collectionOptions(`people`, () => ({
      id: `people`,
      getKey: (person: Person) => person.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset }
        },
      },
    }))
    const client = new DbClient()
    const collection = client._materializeCollectionForRender(descriptor)

    const deferredLoad = collection._sync.loadSubset({})
    expect(deferredLoad).toBeInstanceOf(Promise)
    expect(collection.isLoadingSubset).toBe(true)
    expect(loadSubset).not.toHaveBeenCalled()

    collection._resumeSyncStart()
    expect(loadSubset).toHaveBeenCalledOnce()
    expect(collection.isLoadingSubset).toBe(true)

    resolveLoad()
    await deferredLoad
    expect(collection.isLoadingSubset).toBe(false)
  })

  it(`releases a deferred subset with the adapter's acquired options`, async () => {
    const loadSubset = vi.fn((_options: LoadSubsetOptions) =>
      Promise.resolve(undefined),
    )
    const unloadSubset = vi.fn()
    const descriptor = collectionOptions(`people`, () => ({
      id: `people`,
      getKey: (person: Person) => person.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset, unloadSubset }
        },
      },
    }))
    const client = new DbClient()
    const collection = client._materializeCollectionForRender(descriptor)
    const ownerOptions = { limit: 1 }
    const deferredLoad = collection._sync.loadSubset(ownerOptions)

    collection._resumeSyncStart()
    await deferredLoad

    const adapterOptions = loadSubset.mock.calls[0]![0]
    expect(adapterOptions).toEqual(ownerOptions)
    expect(adapterOptions).not.toBe(ownerOptions)

    collection._sync.unloadSubset(ownerOptions)

    expect(unloadSubset.mock.calls[0]![0]).toBe(adapterOptions)
  })

  it(`lets the first sync snapshot replace stale hydrated rows`, () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [{ id: `1`, name: `fresh` }],
      }),
    )
    const client = new DbClient()

    client.hydrate({
      collections: [
        {
          collectionId: `people`,
          rows: [{ key: `1`, value: { id: `1`, name: `stale` } }],
        },
      ],
    })

    const collection = client.collection(descriptor)

    expect(collection.get(`1`)).toMatchObject({ id: `1`, name: `fresh` })
  })

  it(`merges sync metadata before importing hydration metadata`, () => {
    let syncMeta: unknown = { version: 1, cursor: `client` }
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [],
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
          exportSyncMeta: () => syncMeta,
          importSyncMeta: (meta) => {
            syncMeta = meta
          },
          mergeSyncMeta: (current, incoming) => ({ current, incoming }),
        },
      }),
    )

    const client = new DbClient()
    client.collection(descriptor)

    client.hydrate({
      collections: [
        {
          collectionId: `people`,
          rows: [],
          syncMeta: { version: 1, cursor: `server` },
        },
      ],
    })

    expect(syncMeta).toEqual({
      current: { version: 1, cursor: `client` },
      incoming: { version: 1, cursor: `server` },
    })
  })

  it(`applies streaming collection chunks and live queries react from collection state`, async () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [],
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
      }),
    )

    const client = new DbClient()
    const collection = client.collection(descriptor)
    const activePeople = createLiveQueryCollection((q) =>
      q
        .from({ person: collection })
        .where(({ person }) => eq(person.status, `active`)),
    )
    await activePeople.preload()

    client.applyCollectionChunk({
      collectionId: `people`,
      rows: [{ key: `1`, value: people[0]! }],
    })

    expect(activePeople.toArray.map((person) => person.id)).toEqual([`1`])
  })

  it(`streams pending live queries as result snapshots`, async () => {
    const descriptor = collectionOptions(`people`, () => ({
      id: `people`,
      getKey: (person: Person) => person.id,
      sync: {
        sync: ({ markReady }) => markReady(),
      },
    }))
    const serverClient = new DbClient()
    serverClient.collection(descriptor)
    const listener = vi.fn()
    serverClient.subscribe(listener)

    let resolveLoad!: (snapshot: {
      rows: Array<{ key: string; value: Person }>
    }) => void
    const loadPromise = new Promise<{
      rows: Array<{ key: string; value: Person }>
    }>((resolve) => {
      resolveLoad = resolve
    })
    serverClient._registerLiveQuery(`active-people`, loadPromise)

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: `liveQueryAdded`,
        query: expect.objectContaining({
          queryHash: `active-people`,
          status: `pending`,
        }),
      }),
    )
    expect(serverClient.dehydrate().liveQueries).toBeUndefined()

    const dehydrated = serverClient.dehydrate({
      shouldDehydrateCollection: () => false,
      shouldDehydrateLiveQuery: () => true,
    })
    expect(dehydrated.collections).toEqual([])
    expect(dehydrated.liveQueries).toHaveLength(1)

    const browserClient = new DbClient()
    browserClient.hydrate(dehydrated)
    const browserQuery = browserClient._getLiveQuery(`active-people`)
    expect(browserQuery?.status).toBe(`pending`)

    resolveLoad({
      rows: [{ key: `1`, value: people[0]! }],
    })
    await browserQuery?.promise

    expect(browserClient._getLiveQuery(`active-people`)?.status).toBe(`success`)
    expect(browserQuery?.snapshot).toEqual({
      rows: [{ key: `1`, value: people[0]! }],
    })
    expect(browserClient.collection(descriptor).get(`1`)).toBeUndefined()
  })

  it(`propagates streamed live query failures to the hydrated client`, async () => {
    const serverClient = new DbClient()
    let rejectLoad!: (error: Error) => void
    const loadPromise = new Promise<{
      rows: Array<{ key: string; value: Person }>
    }>((_resolve, reject) => {
      rejectLoad = reject
    })
    serverClient._registerLiveQuery(`active-people`, loadPromise)
    const dehydrated = serverClient.dehydrate({
      shouldDehydrateLiveQuery: () => true,
    })
    const browserClient = new DbClient()

    browserClient.hydrate(dehydrated)
    const browserQuery = browserClient._getLiveQuery(`active-people`)
    const error = new Error(`Server load failed`)
    rejectLoad(error)

    await expect(browserQuery?.promise).rejects.toBe(error)
    expect(browserQuery?.status).toBe(`error`)
    expect(browserQuery?.error).toBe(error)
  })

  it(`settles waiters when newer hydration supersedes a pending live query`, async () => {
    const client = new DbClient()
    let resolveOriginal!: (snapshot: {
      rows: Array<{ key: string; value: Person }>
    }) => void
    const originalResult = new Promise<{
      rows: Array<{ key: string; value: Person }>
    }>((resolve) => {
      resolveOriginal = resolve
    })
    const originalPromise = client._registerLiveQuery(
      `active-people`,
      originalResult,
    )
    const originalRecord = client._getLiveQuery(`active-people`)!

    client.hydrate({
      collections: [],
      liveQueries: [
        {
          queryHash: `active-people`,
          dehydratedAt: originalRecord.dehydratedAt + 1,
          snapshot: {
            rows: [{ key: `1`, value: people[0]! }],
          },
        },
      ],
    })

    await expect(originalPromise).resolves.toBeUndefined()
    expect(client._getLiveQuery(`active-people`)).toMatchObject({
      status: `success`,
      snapshot: { rows: [{ key: `1`, value: people[0]! }] },
    })

    resolveOriginal({ rows: [] })
  })

  it(`handles a rejected duplicate live-query registration`, async () => {
    const client = new DbClient()
    await client._registerLiveQuery(
      `active-people`,
      Promise.resolve({ rows: [] }),
    )

    let rejectDuplicate!: (error: Error) => void
    const duplicate = new Promise<DehydratedLiveQueryResult>(
      (_resolve, reject) => {
        rejectDuplicate = reject
      },
    )

    await expect(
      client._registerLiveQuery(`active-people`, duplicate),
    ).resolves.toBeUndefined()
    rejectDuplicate(new Error(`duplicate failed`))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it(`explicit collection preload dehydrates source collection rows`, async () => {
    const descriptor = collectionOptions({
      id: `people`,
      getKey: (person: Person) => person.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()

          return {
            loadSubset: () => {
              begin({ immediate: true })
              for (const person of people) {
                write({
                  type: `insert`,
                  value: person,
                })
              }
              commit()
              return true
            },
          }
        },
      },
    })

    const client = new DbClient()
    const collection = client.collection(descriptor)
    const activePeople = createLiveQueryCollection((q) =>
      q
        .from({ person: collection })
        .where(({ person }) => eq(person.status, `active`)),
    )

    await activePeople.preload()

    expect(activePeople.toArray.map((person) => person.id)).toEqual([`1`])
    expect(client.dehydrate()).toEqual({
      collections: [
        {
          collectionId: `people`,
          rows: people.map((person) => ({
            key: person.id,
            value: person,
          })),
          syncMeta: undefined,
        },
      ],
    })
  })

  it(`does not dehydrate collections materialized only as query sources`, () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )
    const client = new DbClient()

    client._materializeCollectionForRender(descriptor)
    expect(client.dehydrate()).toEqual({ collections: [] })

    client.collection(descriptor)
    expect(client.dehydrate().collections).toHaveLength(1)
  })

  it(`preloads and dehydrates a live query result without its source rows`, async () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )
    const client = new DbClient()

    await client.preloadLiveQuery({
      query: (q) =>
        q
          .from({ person: descriptor })
          .where(({ person }) => eq(person.status, `active`)),
    })

    const dehydrated = client.dehydrate()
    expect(dehydrated.collections).toEqual([])
    expect(dehydrated.liveQueries).toHaveLength(1)
    expect(dehydrated.liveQueries![0]!.promise).toBeUndefined()
    expect(dehydrated.liveQueries![0]!.snapshot?.rows).toEqual([
      {
        key: `1`,
        value: expect.objectContaining(people[0]!),
      },
    ])
    expect(
      client.dehydrate({ shouldDehydrateLiveQuery: () => false }).liveQueries,
    ).toBeUndefined()
  })

  it(`cleans up a failed live-query preload before retrying it`, async () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `retry-people`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )
    const client = new DbClient()
    const options = {
      query: (q: InitialQueryBuilder) =>
        q
          .from({ person: descriptor })
          .where(({ person }) => eq(person.status, `active`)),
    }

    await client.preloadLiveQuery(options)
    const internals = client as unknown as {
      liveQueries: Map<string, { status: string; error?: unknown }>
      preloadedLiveQueries: Map<
        string,
        { collection: { cleanup: () => Promise<void> } }
      >
    }
    const failedQuery = Array.from(internals.liveQueries.values())[0]!
    failedQuery.status = `error`
    failedQuery.error = new Error(`failed`)
    const failedCollection = Array.from(
      internals.preloadedLiveQueries.values(),
    )[0]!.collection
    const originalCleanup = failedCollection.cleanup.bind(failedCollection)
    const cleanup = vi
      .spyOn(failedCollection, `cleanup`)
      .mockImplementationOnce(async () => {
        await originalCleanup()
        throw new Error(`cleanup failed`)
      })

    await expect(client.preloadLiveQuery(options)).resolves.toBeUndefined()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(client.dehydrate().liveQueries?.[0]?.snapshot?.rows).toHaveLength(1)
  })

  it(`releases source deferrals when preload returns an existing result`, async () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `preload-existing-source`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )
    const client = new DbClient()
    const options = {
      query: (q: InitialQueryBuilder) => q.from({ person: descriptor }),
    }

    await client.preloadLiveQuery(options)
    const source = client.collection(descriptor)
    await source.cleanup()
    await client.preloadLiveQuery(options)

    await expect(
      Promise.race([
        source.preload().then(() => `ready`),
        new Promise<`timeout`>((resolve) =>
          setTimeout(() => resolve(`timeout`), 20),
        ),
      ]),
    ).resolves.toBe(`ready`)
  })

  it(`cleans up live queries before their source collections`, async () => {
    const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `cleanup-order-source`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )
    const client = new DbClient()

    try {
      await client.preloadLiveQuery({
        query: (q: InitialQueryBuilder) => q.from({ person: descriptor }),
      })
      await client.cleanup()

      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(`was manually cleaned up while live query`),
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it(`does not dehydrate explicitly client-bound live query result collections`, async () => {
    const peopleDescriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )
    const activePeopleDescriptor = collectionOptions(
      `active-people`,
      (client) =>
        liveQueryCollectionOptions({
          id: `active-people`,
          query: (q) =>
            q
              .from({ person: client.collection(peopleDescriptor) })
              .where(({ person }) => eq(person.status, `active`)),
        }),
    )
    const client = new DbClient()
    const activePeople = client.collection(activePeopleDescriptor)

    await activePeople.preload()

    expect(activePeople.toArray.map((person) => person.id)).toEqual([`1`])
    expect(
      client.dehydrate().collections.map((chunk) => chunk.collectionId),
    ).toEqual([`people`])
  })

  it(`hydrates rows without running mutation handlers or creating optimistic state`, () => {
    const onInsert = vi.fn()
    const descriptor = collectionOptions({
      id: `people`,
      getKey: (person: Person) => person.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      onInsert,
    })

    const client = new DbClient()
    const collection = client.collection(descriptor)

    client.hydrate({
      collections: [
        {
          collectionId: `people`,
          rows: [{ key: `1`, value: people[0]! }],
        },
      ],
    })

    expect(onInsert).not.toHaveBeenCalled()
    expect(collection._state.optimisticUpserts.size).toBe(0)
    expect(collection._state.optimisticDeletes.size).toBe(0)
    expect(collection.get(`1`)).toMatchObject(people[0]!)
  })

  it(`validates and transforms hydrated rows through the collection schema`, () => {
    const descriptor = collectionOptions({
      id: `schema-hydration`,
      schema: z.object({
        id: z.string().transform((id) => `person:${id}`),
        createdAt: z.coerce.date(),
      }),
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const client = new DbClient()
    const collection = client.collection(descriptor)

    client.hydrate({
      collections: [
        {
          collectionId: `schema-hydration`,
          rows: [
            {
              key: `1`,
              value: { id: `1`, createdAt: `2026-08-14T00:00:00.000Z` },
            },
          ],
        },
      ],
    })

    expect(collection.get(`person:1`)?.createdAt).toBeInstanceOf(Date)
    expect(collection.get(`1`)).toBeUndefined()
  })

  it(`lets adapter inserts replace hydration applied to a ready collection`, async () => {
    let adapterWrite!: (person: Person) => void
    const descriptor = collectionOptions({
      id: `ready-hydration-seed`,
      getKey: (person: Person) => person.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          adapterWrite = (person) => {
            begin()
            write({ type: `insert`, value: person })
            commit()
          }
          markReady()
        },
      },
    })
    const client = new DbClient()
    const collection = client.collection(descriptor)
    await collection.preload()

    client.hydrate({
      collections: [
        {
          collectionId: `ready-hydration-seed`,
          rows: [{ key: `1`, value: { id: `1`, name: `hydrated` } }],
        },
      ],
    })

    expect(() => adapterWrite({ id: `1`, name: `adapter` })).not.toThrow()
    expect(collection.get(`1`)?.name).toBe(`adapter`)
  })

  it(`does not let a late stream chunk overwrite adapter rows or metadata`, async () => {
    const descriptor = collectionOptions({
      id: `adapter-authority`,
      getKey: (person: Person) => person.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: { id: `1`, name: `adapter` },
            metadata: { source: `adapter` },
          })
          commit()
          markReady()
        },
      },
    })
    const client = new DbClient()
    const collection = client.collection(descriptor)
    await collection.preload()

    expect(collection._state.syncedData.has(`1`)).toBe(true)
    expect(collection._state.hydrationSeedKeys.has(`1`)).toBe(false)

    client.applyCollectionChunk({
      collectionId: `adapter-authority`,
      rows: [{ key: `1`, value: { id: `1`, name: `stale stream` } }],
    })

    expect(collection.get(`1`)?.name).toBe(`adapter`)
    expect(collection._state.syncedMetadata.get(`1`)).toEqual({
      source: `adapter`,
    })
  })

  it(`does not serialize optimistic pending mutations`, async () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [people[0]!],
      }),
    )

    const client = new DbClient()
    const collection = client.collection(descriptor)
    const tx = collection.insert({ id: `3`, name: `Pending` })

    expect(collection._state.optimisticUpserts.has(`3`)).toBe(true)
    expect(client.dehydrate()).toEqual({
      collections: [
        {
          collectionId: `people`,
          rows: [
            {
              key: `1`,
              value: people[0],
            },
          ],
          syncMeta: undefined,
        },
      ],
    })

    collection.utils.resolveSync()
    await tx.isPersisted.promise
  })

  it(`applies initialData precedence before hydrated rows`, () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [],
      }),
    )

    const client = new DbClient()
    const collection = client.collection(descriptor, {
      initialData: [{ id: `1`, name: `materialized` }],
    })

    expect(collection.get(`1`)).toMatchObject({
      id: `1`,
      name: `materialized`,
    })

    client.hydrate({
      collections: [
        {
          collectionId: `people`,
          rows: [{ key: `1`, value: { id: `1`, name: `hydrated` } }],
        },
      ],
    })

    expect(collection.get(`1`)).toMatchObject({
      id: `1`,
      name: `hydrated`,
    })
  })

  it(`seeds initialData without marking adapter sync as ready`, () => {
    const descriptor = collectionOptions<Person, string>({
      id: `people`,
      getKey: (person) => person.id,
      sync: {
        sync: () => {},
      },
    })

    const client = new DbClient()
    const collection = client.collection(descriptor, {
      initialData: [people[0]!],
    })

    expect(collection.get(`1`)).toMatchObject(people[0]!)
    expect(collection.status).not.toBe(`ready`)
  })

  it(`validates and transforms materialization initialData before keying`, () => {
    const personSchema = z.object({
      id: z.string().transform((id) => `person:${id}`),
      name: z.string(),
    })
    const descriptor = collectionOptions({
      id: `people`,
      schema: personSchema,
      getKey: (person) => person.id,
      sync: {
        sync: () => {},
      },
    })

    const collection = new DbClient().collection(descriptor, {
      initialData: [{ id: `1`, name: `Tanner` }],
    })

    expect(collection.get(`person:1`)).toMatchObject({
      id: `person:1`,
      name: `Tanner`,
    })
    expect(collection.get(`1`)).toBeUndefined()
  })
})
