import { describe, expect, it } from "vitest"
import { render, renderHook, waitFor } from "@testing-library/react"
import { createCollection, gt } from "@tanstack/db"
import { mockSyncCollectionOptions } from "../../db/tests/utils"
import {
  createServerContext,
  dehydrate,
  prefetchLiveQuery,
} from "../src/server"
import { HydrationBoundary } from "../src/hydration"
import { useLiveQuery } from "../src/useLiveQuery"

type Person = {
  id: string
  name: string
  age: number
  email: string
}

const initialPersons: Array<Person> = [
  {
    id: `1`,
    name: `John Doe`,
    age: 30,
    email: `john.doe@example.com`,
  },
  {
    id: `2`,
    name: `Jane Doe`,
    age: 25,
    email: `jane.doe@example.com`,
  },
  {
    id: `3`,
    name: `John Smith`,
    age: 35,
    email: `john.smith@example.com`,
  },
]

describe(`SSR/RSC Hydration`, () => {
  it(`should create a server context`, () => {
    const serverContext = createServerContext()
    expect(serverContext).toBeDefined()
    expect(serverContext.queries).toBeInstanceOf(Map)
    expect(serverContext.queries.size).toBe(0)
  })

  it(`should prefetch a live query and store result`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const serverContext = createServerContext()

    await prefetchLiveQuery(serverContext, {
      id: `persons-query`,
      query: (q) => q.from({ persons: collection }),
    })

    expect(serverContext.queries.size).toBe(1)
    const query = serverContext.queries.get(`persons-query`)
    expect(query).toBeDefined()
    expect(query?.id).toBe(`persons-query`)
    expect(query?.data).toHaveLength(3)
    expect(query?.timestamp).toBeGreaterThan(0)
  })

  it(`should prefetch a live query with filtering`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const serverContext = createServerContext()

    await prefetchLiveQuery(serverContext, {
      id: `filtered-persons`,
      query: (q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30)),
    })

    const query = serverContext.queries.get(`filtered-persons`)
    expect(query).toBeDefined()
    expect(query!.data).toHaveLength(1)
    expect((query!.data as Array<Person>)[0]!.name).toBe(`John Smith`)
  })

  it(`should dehydrate server context`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const serverContext = createServerContext()

    await prefetchLiveQuery(serverContext, {
      id: `persons-query`,
      query: (q) => q.from({ persons: collection }),
    })

    const dehydratedState = dehydrate(serverContext)

    expect(dehydratedState).toBeDefined()
    expect(dehydratedState.queries).toHaveLength(1)
    expect(dehydratedState.queries[0]!.id).toBe(`persons-query`)
    expect(dehydratedState.queries[0]!.data).toHaveLength(3)
  })

  it(`should use hydrated data in useLiveQuery`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-hydration`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
    )

    // Set up hydrated state
    const dehydratedState = {
      queries: [
        {
          id: `test-persons-hydration`,
          data: initialPersons,
          timestamp: Date.now(),
        },
      ],
    }

    // Render hook with HydrationBoundary wrapper
    const { result } = renderHook(
      () => {
        return useLiveQuery({
          id: `test-persons-hydration`,
          query: (q) => q.from({ persons: collection }),
        })
      },
      {
        wrapper: ({ children }) => (
          <HydrationBoundary state={dehydratedState}>
            {children}
          </HydrationBoundary>
        ),
      }
    )

    // Should immediately have hydrated data
    expect(result.current.data).toHaveLength(3)
    expect(result.current.isReady).toBe(true)
    expect((result.current.data as Array<Person>)[0]!.name).toBe(`John Doe`)
  })

  it(`should transition from hydrated data to live data`, async () => {
    // Set up hydrated state with different data
    const hydratedPerson = {
      id: `999`,
      name: `Hydrated Person`,
      age: 40,
      email: `hydrated@example.com`,
    }
    const dehydratedState = {
      queries: [
        {
          id: `test-persons-transition`,
          data: [hydratedPerson],
          timestamp: Date.now(),
        },
      ],
    }

    // Create collection WITHOUT initialData to simulate real SSR scenario
    // where collection data loads after component mounts
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-transition`,
        getKey: (person: Person) => person.id,
        initialData: [], // Empty initially, will be populated async
      })
    )

    const { result } = renderHook(
      () => {
        return useLiveQuery({
          id: `test-persons-transition`,
          query: (q) => q.from({ persons: collection }),
        })
      },
      {
        wrapper: ({ children }) => (
          <HydrationBoundary state={dehydratedState}>
            {children}
          </HydrationBoundary>
        ),
      }
    )

    // Initially should show hydrated data since collection is empty
    expect(result.current.data).toHaveLength(1)
    expect((result.current.data as Array<Person>)[0]!.name).toBe(
      `Hydrated Person`
    )

    // Simulate data loading into the collection
    collection.insert(initialPersons[0]!)
    collection.insert(initialPersons[1]!)
    collection.insert(initialPersons[2]!)

    // Wait for the collection to update with actual data
    await waitFor(
      () => {
        expect(result.current.data).toHaveLength(3)
      },
      { timeout: 2000 }
    )

    // After collection has data, should show actual collection data
    expect((result.current.data as Array<Person>)[0]!.name).toBe(`John Doe`)
  })

  it(`should work with HydrationBoundary component`, async () => {
    const dehydratedState = {
      queries: [
        {
          id: `test-persons-boundary`,
          data: [
            {
              id: `999`,
              name: `Boundary Person`,
              age: 40,
              email: `boundary@example.com`,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    }

    // Create collection without initialData to simulate SSR scenario
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-boundary`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
    )

    function TestComponent() {
      const { data, isReady } = useLiveQuery({
        id: `test-persons-boundary`,
        query: (q) => q.from({ persons: collection }),
      })

      if (!isReady) return <div>Loading...</div>

      return <div>{(data as Array<Person>)[0]?.name}</div>
    }

    const { container } = render(
      <HydrationBoundary state={dehydratedState}>
        <TestComponent />
      </HydrationBoundary>
    )

    // Should initially render with hydrated data
    await waitFor(() => {
      expect(container.textContent).toContain(`Boundary Person`)
    })

    // Simulate data loading into the collection
    collection.insert(initialPersons[0]!)
    collection.insert(initialPersons[1]!)
    collection.insert(initialPersons[2]!)

    // Wait for transition to real data
    await waitFor(
      () => {
        expect(container.textContent).toContain(`John Doe`)
      },
      { timeout: 2000 }
    )
  })

  it(`should handle multiple queries in server context`, async () => {
    const personsCollection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-multi`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const serverContext = createServerContext()

    await prefetchLiveQuery(serverContext, {
      id: `all-persons`,
      query: (q) => q.from({ persons: personsCollection }),
    })

    await prefetchLiveQuery(serverContext, {
      id: `old-persons`,
      query: (q) =>
        q
          .from({ persons: personsCollection })
          .where(({ persons }) => gt(persons.age, 30)),
    })

    expect(serverContext.queries.size).toBe(2)

    const dehydratedState = dehydrate(serverContext)
    expect(dehydratedState.queries).toHaveLength(2)

    const allPersonsQuery = dehydratedState.queries.find(
      (q) => q.id === `all-persons`
    )
    const oldPersonsQuery = dehydratedState.queries.find(
      (q) => q.id === `old-persons`
    )

    expect(allPersonsQuery?.data).toHaveLength(3)
    expect(oldPersonsQuery?.data).toHaveLength(1)
  })

  it(`should not use hydrated data if query has no id`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-no-id`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    // Set up hydrated state
    const dehydratedState = {
      queries: [
        {
          id: `some-query`,
          data: [
            { id: `999`, name: `Hydrated`, age: 40, email: `test@example.com` },
          ],
          timestamp: Date.now(),
        },
      ],
    }

    const { result } = renderHook(
      () => {
        // Query without an explicit id
        return useLiveQuery((q) => q.from({ persons: collection }))
      },
      {
        wrapper: ({ children }) => (
          <HydrationBoundary state={dehydratedState}>
            {children}
          </HydrationBoundary>
        ),
      }
    )

    // Wait for collection to be ready
    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Should have actual data, not hydrated data
    expect(result.current.data).toHaveLength(3)
    expect((result.current.data as Array<Person>)[0]!.name).toBe(`John Doe`)
  })

  it(`should respect singleResult with hydrated data`, () => {
    const singlePerson = {
      id: `1`,
      name: `Single Person`,
      age: 30,
      email: `single@example.com`,
    }

    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-single-person`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
    )

    // Set up hydrated state with a single-result query
    const dehydratedState = {
      queries: [
        {
          id: `test-single-person`,
          data: [singlePerson], // Server returns array, but client expects single object
          timestamp: Date.now(),
        },
      ],
    }

    const { result } = renderHook(
      () => {
        return useLiveQuery({
          id: `test-single-person`,
          query: (q) => q.from({ persons: collection }).findOne(),
        })
      },
      {
        wrapper: ({ children }) => (
          <HydrationBoundary state={dehydratedState}>
            {children}
          </HydrationBoundary>
        ),
      }
    )

    // With singleResult: true, data should be a single object, not an array
    expect(result.current.isReady).toBe(true)
    expect(Array.isArray(result.current.data)).toBe(false)
    expect((result.current.data as Person | undefined)?.name).toBe(
      `Single Person`
    )
  })

  it(`should handle nested HydrationBoundary (inner shadows outer)`, async () => {
    const outerPerson = {
      id: `1`,
      name: `Outer Person`,
      age: 40,
      email: `outer@example.com`,
    }
    const innerPerson = {
      id: `2`,
      name: `Inner Person`,
      age: 25,
      email: `inner@example.com`,
    }

    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-nested-boundary`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
    )

    const outerState = {
      queries: [
        {
          id: `person-query`,
          data: [outerPerson],
          timestamp: Date.now(),
        },
      ],
    }

    const innerState = {
      queries: [
        {
          id: `person-query`,
          data: [innerPerson],
          timestamp: Date.now(),
        },
      ],
    }

    const { result: outerResult } = renderHook(
      () => {
        return useLiveQuery({
          id: `person-query`,
          query: (q) => q.from({ persons: collection }).findOne(),
        })
      },
      {
        wrapper: ({ children }) => (
          <HydrationBoundary state={outerState}>{children}</HydrationBoundary>
        ),
      }
    )

    const { result: innerResult } = renderHook(
      () => {
        return useLiveQuery({
          id: `person-query`,
          query: (q) => q.from({ persons: collection }).findOne(),
        })
      },
      {
        wrapper: ({ children }) => (
          <HydrationBoundary state={outerState}>
            <HydrationBoundary state={innerState}>{children}</HydrationBoundary>
          </HydrationBoundary>
        ),
      }
    )

    // Outer boundary should use outer data
    expect((outerResult.current.data as Person | undefined)?.name).toBe(
      `Outer Person`
    )

    // Inner boundary should shadow outer and use inner data
    expect((innerResult.current.data as Person | undefined)?.name).toBe(
      `Inner Person`
    )
  })
})
