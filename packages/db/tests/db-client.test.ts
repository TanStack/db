import { describe, expect, it, vi } from 'vitest'
import {
  DbClient,
  collectionOptions,
  createLiveQueryCollection,
  eq,
} from '../src'
import { mockSyncCollectionOptions } from './utils'

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

  it(`requires stable explicit collection ids for dehydration`, () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: undefined as unknown as string,
        getKey: (person) => person.id,
        initialData: people,
      }),
    )

    const client = new DbClient()
    client.collection(descriptor)

    expect(() => client.dehydrate()).toThrow(
      /SSR hydration requires stable collection ids/,
    )
  })

  it(`hydrates pending collection rows when the collection materializes`, () => {
    const importedMeta = vi.fn()
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `people`,
        getKey: (person) => person.id,
        initialData: [],
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
          importSyncMeta: importedMeta,
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
    expect(collection.status).toBe(`ready`)
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

  it(`live query preload dehydrates source collection rows instead of live query snapshots`, async () => {
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
        initialData: [{ id: `1`, name: `descriptor` }],
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
})
