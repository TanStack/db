import { DestroyRef, inject, signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { describe, expect, it } from "vitest"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from "@tanstack/db"
import { injectLiveQuery } from "../src/index"
import { mockSyncCollectionOptions } from "../../db/tests/utls"
import type {
  Collection,
  CollectionStatus,
  Context,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"

// Import the same test utilities as Vue

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

const initialPersons: Array<Person> = [
  {
    id: `1`,
    name: `John Doe`,
    age: 30,
    email: `john.doe@example.com`,
    isActive: true,
    team: `team1`,
  },
  {
    id: `2`,
    name: `Jane Doe`,
    age: 25,
    email: `jane.doe@example.com`,
    isActive: true,
    team: `team2`,
  },
  {
    id: `3`,
    name: `John Smith`,
    age: 35,
    email: `john.smith@example.com`,
    isActive: true,
    team: `team1`,
  },
]

// Helper function to wait for Angular effects and collection updates
async function waitForAngularUpdate() {
  // Wait for Angular change detection
  await new Promise((resolve) => setTimeout(resolve, 0))
  // Additional delay for collection updates
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function createMockCollection<T extends object, K extends string | number>(
  initial: Array<T & Record<`id`, K>> = [],
  initialStatus: CollectionStatus = `ready`
): Collection<T, K, Record<string, never>> & {
  __setStatus: (s: CollectionStatus) => void
  __replaceAll: (rows: Array<T & Record<`id`, K>>) => void
  __upsert: (row: T & Record<`id`, K>) => void
  __delete: (key: K) => void
} {
  const map = new Map<K, T>()
  for (const r of initial) {
    map.set(r.id, r)
  }

  let status: CollectionStatus = initialStatus
  const subs = new Set<(changes: Array<any>) => void>()
  const readySubs = new Set<() => void>()
  const id = `mock-col-` + Math.random().toString(36).slice(2)

  const notify = (changes: Array<any> = []) => {
    for (const cb of subs) cb(changes)
  }

  const notifyReady = () => {
    for (const cb of readySubs) cb()
  }

  const api: any = {
    id,
    get status() {
      return status
    },
    entries: () => Array.from(map.entries()),
    values: () => Array.from(map.values()),
    get: (key: K) => map.get(key),
    has: (key: K) => map.has(key),
    size: () => map.size,
    subscribeChanges: (cb: (changes: Array<any>) => void) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    onFirstReady: (cb: () => void) => {
      if (status === `ready`) {
        setTimeout(cb, 0)
      } else {
        readySubs.add(cb)
      }
      return () => readySubs.delete(cb)
    },
    preload: () => Promise.resolve(),
    startSyncImmediate: () => {
      const wasNotReady = status !== `ready`
      if (status === `idle`) {
        status = `ready`
      }
      if (wasNotReady && status === `ready`) {
        setTimeout(notifyReady, 0)
      }
    },
    __setStatus: (s: CollectionStatus) => {
      const wasNotReady = status !== `ready`
      status = s
      notify([])
      if (wasNotReady && status === `ready`) {
        setTimeout(notifyReady, 0)
      }
    },
    __replaceAll: (rows: Array<T & Record<`id`, K>>) => {
      map.clear()
      for (const r of rows) map.set(r.id, r)
      notify([])
    },
    __upsert: (row: T & Record<`id`, K>) => {
      const isUpdate = map.has(row.id)
      map.set(row.id, row)
      notify([
        {
          type: isUpdate ? `update` : `insert`,
          key: row.id,
          value: row,
        },
      ])
    },
    __delete: (key: K) => {
      map.delete(key)
      notify([
        {
          type: `delete`,
          key: key,
        },
      ])
    },
  }

  return api
}

describe(`injectLiveQuery`, () => {
  it(`throws if used outside injection context`, () => {
    expect(() => {
      injectLiveQuery(() => ({}) as unknown as QueryBuilder<Context>)
    }).toThrow(
      /NG0203:|injectLiveQuery\(\) can only be used within an injection context/i
    )
  })

  it(`should work with basic collection and select`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `test-persons-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { state, data } = injectLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            age: persons.age,
          }))
      )

      await waitForAngularUpdate()

      expect(state().size).toBe(1) // Only John Smith (age 35)
      expect(data()).toHaveLength(1)

      const johnSmith = data()[0]
      expect(johnSmith).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })
    })
  })

  it(`initializes with an existing collection and exposes signals`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const col = createMockCollection<{ id: number; name: string }, number>(
        [{ id: 1, name: `A` }],
        `ready`
      )

      const result = injectLiveQuery(col)

      await waitForAngularUpdate()

      expect(result.collection()).toBe(col)
      expect(result.state().get(1)).toEqual({ id: 1, name: `A` })
      expect(result.data()).toEqual([{ id: 1, name: `A` }])
      expect(result.status()).toBe(`ready`)
      expect(result.isReady()).toBe(true)
      expect(result.isLoading()).toBe(false)
      expect(result.isIdle()).toBe(false)
      expect(result.isError()).toBe(false)
      expect(result.isCleanedUp()).toBe(false)
    })
  })

  it(`subscribes to collection changes and updates signals`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const col = createMockCollection<{ id: number; name: string }, number>(
        [{ id: 1, name: `A` }],
        `ready`
      )
      const result = injectLiveQuery(col)

      await waitForAngularUpdate()

      col.__upsert({ id: 2, name: `B` })
      await waitForAngularUpdate()

      expect(result.state().get(2)).toEqual({ id: 2, name: `B` })
      expect(result.data()).toEqual([
        { id: 1, name: `A` },
        { id: 2, name: `B` },
      ])

      col.__delete(1)
      await waitForAngularUpdate()

      expect(result.state().has(1)).toBe(false)
      expect(result.data()).toEqual([{ id: 2, name: `B` }])

      col.__replaceAll([{ id: 3, name: `C` }])
      await waitForAngularUpdate()

      expect(Array.from(result.state().keys())).toEqual([3])
      expect(result.data()).toEqual([{ id: 3, name: `C` }])
    })
  })

  it(`reflects status changes in derived flags`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const col = createMockCollection<{ id: number; name: string }, number>(
        [],
        `idle`
      )
      const { status, isReady, isLoading, isError, isCleanedUp } =
        injectLiveQuery(col)

      await waitForAngularUpdate()

      expect(status()).toBe(`ready`) // Should be ready after startSyncImmediate
      expect(isReady()).toBe(true)

      col.__setStatus(`loading`)
      await waitForAngularUpdate()

      expect(status()).toBe(`loading`)
      expect(isLoading()).toBe(true)

      col.__setStatus(`error`)
      await waitForAngularUpdate()

      expect(status()).toBe(`error`)
      expect(isError()).toBe(true)

      col.__setStatus(`cleaned-up`)
      await waitForAngularUpdate()

      expect(status()).toBe(`cleaned-up`)
      expect(isCleanedUp()).toBe(true)
    })
  })

  it(`should be able to query a collection with live updates`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `test-persons-2-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { state, data } = injectLiveQuery((q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => gt(c.age, 30))
          .select(({ collection: c }) => ({
            id: c.id,
            name: c.name,
          }))
          .orderBy(({ collection: c }) => c.id, `asc`)
      )

      await waitForAngularUpdate()

      expect(state().size).toBe(1)
      expect(state().get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })

      expect(data().length).toBe(1)
      expect(data()[0]).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })

      // Insert a new person using the proper utils pattern
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `4`,
          name: `Kyle Doe`,
          age: 40,
          email: `kyle.doe@example.com`,
          isActive: true,
          team: `team1`,
        },
      })
      collection.utils.commit()

      await waitForAngularUpdate()

      expect(state().size).toBe(2)
      expect(state().get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })
      expect(state().get(`4`)).toMatchObject({
        id: `4`,
        name: `Kyle Doe`,
      })

      expect(data().length).toBe(2)
      expect(data()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `3`,
            name: `John Smith`,
          }),
          expect.objectContaining({
            id: `4`,
            name: `Kyle Doe`,
          }),
        ])
      )
    })
  })

  it.todo(
    `reuses collection when deps are unchanged and query/config are same`,
    async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `reuse-test-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const config: LiveQueryCollectionConfig<Context> = {
        query: (q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        startSync: true,
        gcTime: 0,
      }

      let col1: any
      let col2: any

      await TestBed.runInInjectionContext(async () => {
        const first = injectLiveQuery(config)
        await waitForAngularUpdate()
        col1 = first.collection()
      })

      await TestBed.runInInjectionContext(async () => {
        const second = injectLiveQuery(config)
        await waitForAngularUpdate()
        col2 = second.collection()
      })

      expect(col2).toBe(col1)
    }
  )

  it(`creates a new collection when deps change`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `deps-change-test-angular`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const config: LiveQueryCollectionConfig<Context> = {
      query: (q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
      startSync: true,
      gcTime: 0,
    }

    let col1: any
    let col2: any

    await TestBed.runInInjectionContext(async () => {
      const first = injectLiveQuery(config)
      await waitForAngularUpdate()
      col1 = first.collection()
    })

    await TestBed.runInInjectionContext(async () => {
      const second = injectLiveQuery({
        ...config,
        gcTime: 1,
      })
      await waitForAngularUpdate()
      col2 = second.collection()
    })

    expect(col2).not.toBe(col1)
  })

  it(`reuses exact same passed collection instance`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const col = createMockCollection<{ id: number; name: string }, number>(
        [],
        `ready`
      )

      const a = injectLiveQuery(col)
      const b = injectLiveQuery(col)

      await waitForAngularUpdate()

      expect(a.collection()).toBe(col)
      expect(b.collection()).toBe(col)
    })
  })

  it(`cleans up subscription on destroy`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const col = createMockCollection<{ id: number; name: string }, number>(
        [{ id: 1, name: `A` }],
        `ready`
      )

      const destroyRef = inject(DestroyRef)
      const res = injectLiveQuery(col)

      await waitForAngularUpdate()

      col.__upsert({ id: 2, name: `B` })
      await waitForAngularUpdate()

      expect(res.state().get(2)).toEqual({ id: 2, name: `B` })

      destroyRef.onDestroy(() => {})
    })

    await TestBed.runInInjectionContext(async () => {
      const col = createMockCollection<{ id: number; name: string }, number>(
        [],
        `ready`
      )
      const res = injectLiveQuery(col)

      await waitForAngularUpdate()

      expect(res.data()).toEqual([])
    })
  })

  it(`accepts a query function and initializes collection via createLiveQueryCollection`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `query-fn-test-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const res = injectLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          }))
      )

      await waitForAngularUpdate()

      expect(res.collection().id).toEqual(expect.any(String))
      expect(res.status()).toBe(`ready`)
      expect(Array.isArray(res.data())).toBe(true)
      expect(res.state() instanceof Map).toBe(true)
    })
  })

  it(`accepts a LiveQueryCollectionConfig object`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `config-test-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const config: LiveQueryCollectionConfig<Context> = {
        query: (q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        startSync: true,
        gcTime: 0,
      }

      const res = injectLiveQuery(config)
      await waitForAngularUpdate()

      expect(res.collection().id).toEqual(expect.any(String))
      expect(res.isReady()).toBe(true)
    })
  })

  it(`throws from computed collection if not initialized (defensive path)`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const col = createMockCollection<{ id: number; name: string }, number>(
        [],
        `ready`
      )
      const res = injectLiveQuery(col)

      await waitForAngularUpdate()

      expect(res.collection()).toBe(col)
    })
  })

  it(`accepts reactive params with query function`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `reactive-params-test-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const projectId = signal(1)

      const res = injectLiveQuery({
        params: () => ({ projectID: projectId() }),
        query: ({ params, q }) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => eq(persons.team, `team${params.projectID}`))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              team: persons.team,
            })),
      })

      await waitForAngularUpdate()

      expect(res.collection().id).toEqual(expect.any(String))
      expect(res.status()).toBe(`ready`)
      expect(Array.isArray(res.data())).toBe(true)
      expect(res.state() instanceof Map).toBe(true)

      // Should get team1 people (John Doe and John Smith) when projectID is 1
      expect(res.data()).toHaveLength(2)
      expect(res.data()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `1`,
            name: `John Doe`,
            team: `team1`,
          }),
          expect.objectContaining({
            id: `3`,
            name: `John Smith`,
            team: `team1`,
          }),
        ])
      )

      projectId.set(2)
      await waitForAngularUpdate()

      // Should get team2 person (Jane Doe) when projectID is 2
      expect(res.data()).toHaveLength(1)
      expect(res.data()[0]).toMatchObject({
        id: `2`,
        name: `Jane Doe`,
        team: `team2`,
      })
    })
  })

  it(`reactive params update when signal changes`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `reactive-update-test-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const selectedProjectId = signal(2)

      const res = injectLiveQuery({
        params: () => ({ projectID: selectedProjectId() }),
        query: ({ params, q }) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => eq(persons.team, `team${params.projectID}`))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              team: persons.team,
            })),
      })

      await waitForAngularUpdate()

      expect(res.isReady()).toBe(true)
      // Should initially show team2 data
      expect(res.data()).toHaveLength(1)
      expect(res.data()[0]).toMatchObject({
        id: `2`,
        name: `Jane Doe`,
        team: `team2`,
      })

      selectedProjectId.set(1)
      await waitForAngularUpdate()

      expect(selectedProjectId()).toBe(1)
      // Should now show team1 data (2 people)
      expect(res.data()).toHaveLength(2)
      expect(res.data()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `1`,
            name: `John Doe`,
            team: `team1`,
          }),
          expect.objectContaining({
            id: `3`,
            name: `John Smith`,
            team: `team1`,
          }),
        ])
      )
    })
  })

  it(`should accept pre-created live query collection`, async () => {
    await TestBed.runInInjectionContext(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `pre-created-collection-test-angular`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      // Create a live query collection beforehand
      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              age: persons.age,
            })),
        startSync: true,
      })

      const {
        state,
        data,
        collection: returnedCollection,
      } = injectLiveQuery(liveQueryCollection)

      await waitForAngularUpdate()

      expect(state().size).toBe(1) // Only John Smith (age 35)
      expect(data()).toHaveLength(1)

      const johnSmith = data()[0]
      expect(johnSmith).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Verify that the returned collection is the same instance
      expect(returnedCollection()).toBe(liveQueryCollection)
    })
  })
})
