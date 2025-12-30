import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from '@tanstack/db'
import { StrictMode, Suspense } from 'react'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

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

// Wrapper component with Suspense
function SuspenseWrapper({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
}

describe(`useLiveSuspenseQuery`, () => {
  it(`should suspend while loading and return data when ready`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-1`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              age: persons.age,
            })),
        )
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })

    expect(result.current.data).toHaveLength(1)
    const johnSmith = result.current.data[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  it(`should return data that is always defined (type-safe)`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-2`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) => q.from({ persons: collection }))
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    // Data is always defined - no optional chaining needed
    expect(result.current.data.length).toBe(3)
    // TypeScript will guarantee data is Array<Person>, not Array<Person> | undefined
  })

  it(`should work with single result queries`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-3`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.id, `3`))
            .findOne(),
        )
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })

    expect(result.current.data).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  it(`should work with pre-created live query collection`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-4`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ persons: collection })
        .where(({ persons }) => gt(persons.age, 30)),
    )

    const { result } = renderHook(() => useLiveSuspenseQuery(liveQuery), {
      wrapper: SuspenseWrapper,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    expect(result.current.data[0]).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  it(`should re-suspend when deps change`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-5`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, rerender } = renderHook(
      ({ minAge }) => {
        return useLiveSuspenseQuery(
          (q) =>
            q
              .from({ persons: collection })
              .where(({ persons }) => gt(persons.age, minAge)),
          [minAge],
        )
      },
      {
        wrapper: SuspenseWrapper,
        initialProps: { minAge: 30 },
      },
    )

    // Initial load - age > 30
    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })
    expect(result.current.data[0]?.age).toBe(35)

    // Change deps - age > 20
    rerender({ minAge: 20 })

    // Should re-suspend and load new data
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })
  })

  it(`should reactively update data after initial load`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-6`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      },
    )

    // Wait for initial data
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    // Insert new person
    collection.insert({
      id: `4`,
      name: `New Person`,
      age: 40,
      email: `new@example.com`,
      isActive: true,
      team: `team1`,
    })

    // Should reactively update
    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })
  })

  it(`should throw error when query function returns undefined`, () => {
    expect(() => {
      renderHook(
        () => {
          return useLiveSuspenseQuery(() => undefined as any)
        },
        {
          wrapper: SuspenseWrapper,
        },
      )
    }).toThrow(/does not support disabled queries/)
  })

  it(`should work with config object`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-7`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery({
          query: (q) => q.from({ persons: collection }),
        })
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })
  })

  it(`should keep stable data references when data hasn't changed`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-8`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, rerender } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const data1 = result.current.data

    rerender()

    const data2 = result.current.data

    // Data objects should be stable
    expect(data1[0]).toBe(data2[0])
    expect(data1[1]).toBe(data2[1])
    expect(data1[2]).toBe(data2[2])
  })

  it(`should handle multiple queries in same component (serial execution)`, async () => {
    const personsCollection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-9`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        const persons = useLiveSuspenseQuery((q) =>
          q.from({ persons: personsCollection }),
        )
        const johnDoe = useLiveSuspenseQuery((q) =>
          q
            .from({ persons: personsCollection })
            .where(({ persons: p }) => eq(p.id, `1`))
            .findOne(),
        )
        return { persons, johnDoe }
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.persons.data).toHaveLength(3)
      expect(result.current.johnDoe.data).toBeDefined()
    })

    expect(result.current.johnDoe.data).toMatchObject({
      id: `1`,
      name: `John Doe`,
    })
  })

  it(`should cleanup collection when unmounted`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-10`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, unmount } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const liveQueryCollection = result.current.collection
    expect(liveQueryCollection.subscriberCount).toBeGreaterThan(0)

    unmount()

    // Collection should eventually be cleaned up (gcTime is 1ms)
    await waitFor(
      () => {
        expect(liveQueryCollection.status).toBe(`cleaned-up`)
      },
      { timeout: 1000 },
    )
  })

  it(`should NOT re-suspend on live updates after initial load`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-11`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    let suspenseCount = 0
    const SuspenseCounter = ({ children }: { children: ReactNode }) => {
      return (
        <Suspense
          fallback={
            <div>
              {(() => {
                suspenseCount++
                return `Loading...`
              })()}
            </div>
          }
        >
          {children}
        </Suspense>
      )
    }

    const { result } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseCounter,
      },
    )

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const initialSuspenseCount = suspenseCount

    // Make multiple live updates
    collection.insert({
      id: `4`,
      name: `New Person 1`,
      age: 40,
      email: `new1@example.com`,
      isActive: true,
      team: `team1`,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })

    collection.insert({
      id: `5`,
      name: `New Person 2`,
      age: 45,
      email: `new2@example.com`,
      isActive: true,
      team: `team2`,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(5)
    })

    collection.delete(`4`)

    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })

    // Verify suspense count hasn't increased (no re-suspension)
    expect(suspenseCount).toBe(initialSuspenseCount)
  })

  it(`should only suspend on deps change, not on every re-render`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-12`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, rerender } = renderHook(
      ({ minAge }) =>
        useLiveSuspenseQuery(
          (q) =>
            q
              .from({ persons: collection })
              .where(({ persons }) => gt(persons.age, minAge)),
          [minAge],
        ),
      {
        wrapper: SuspenseWrapper,
        initialProps: { minAge: 20 },
      },
    )

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const dataAfterInitial = result.current.data

    // Re-render with SAME deps - should NOT suspend (data stays available)
    rerender({ minAge: 20 })
    expect(result.current.data).toHaveLength(3)
    expect(result.current.data).toBe(dataAfterInitial)

    rerender({ minAge: 20 })
    expect(result.current.data).toHaveLength(3)

    rerender({ minAge: 20 })
    expect(result.current.data).toHaveLength(3)

    // Change deps - SHOULD suspend and get new data
    rerender({ minAge: 30 })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    expect(result.current.data[0]?.age).toBe(35)
  })

  it(`should work with pre-created SingleResult collection`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-single`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    // Pre-create a SingleResult live query collection
    const singlePersonQuery = createLiveQueryCollection((q) =>
      q
        .from({ persons: collection })
        .where(({ persons }) => eq(persons.id, `1`))
        .findOne(),
    )

    const { result } = renderHook(
      () => useLiveSuspenseQuery(singlePersonQuery),
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(result.current.data).toMatchObject({
      id: `1`,
      name: `John Doe`,
      age: 30,
    })
  })

  it(`should handle StrictMode double-invocation correctly`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-strict`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const StrictModeWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
      </StrictMode>
    )

    const { result } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: StrictModeWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    // Verify data is correct despite double-invocation
    expect(result.current.data).toHaveLength(3)
    expect(result.current.data[0]).toMatchObject({
      id: `1`,
      name: `John Doe`,
    })
  })

  it(`should not re-suspend after hasBeenReady when isLoadingSubset changes`, async () => {
    // This test verifies that after the initial ready state is reached,
    // subsequent isLoadingSubset changes don't cause re-suspension
    // (stale-while-revalidate behavior, matching TanStack Query)

    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-on-demand`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    let suspenseCount = 0

    const SuspenseTracker = ({ children }: { children: ReactNode }) => {
      return (
        <Suspense
          fallback={
            <div>
              {(() => {
                suspenseCount++
                return `Loading...`
              })()}
            </div>
          }
        >
          {children}
        </Suspense>
      )
    }

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) => q.from({ persons: collection }))
      },
      {
        wrapper: SuspenseTracker,
      },
    )

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const initialSuspenseCount = suspenseCount

    // Now simulate on-demand loading by tracking a load promise on the live query collection
    // This mimics what happens when a new subset query is made in on-demand mode
    let resolveLoadPromise: () => void
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoadPromise = resolve
    })

    // Track the load promise on the LIVE QUERY collection - this sets isLoadingSubset = true
    result.current.collection._sync.trackLoadPromise(loadPromise)

    // Verify isLoadingSubset is now true on the live query collection
    expect(result.current.collection.isLoadingSubset).toBe(true)

    // The collection is still ready, but isLoadingSubset is true
    expect(result.current.collection.status).toBe(`ready`)

    // Resolve the load promise to simulate data loading complete
    resolveLoadPromise!()

    // Wait for the loadingSubset:change event to propagate
    await waitFor(() => {
      expect(result.current.collection.isLoadingSubset).toBe(false)
    })

    // After hasBeenReadyRef is set, subsequent isLoadingSubset changes
    // should NOT cause re-suspension (stale-while-revalidate behavior)
    expect(suspenseCount).toBe(initialSuspenseCount)

    // Data should still be available
    expect(result.current.data).toHaveLength(3)
  })

  it(`should hold suspense until isLoadingSubset is false during initial load`, async () => {
    // This test specifically verifies the bug fix:
    // When the LIVE QUERY collection's status becomes 'ready' but its isLoadingSubset
    // is still true, suspense should NOT release until isLoadingSubset becomes false.
    //
    // We test this by creating a pre-made live query collection and tracking a load
    // promise on it BEFORE passing it to useLiveSuspenseQuery.

    let resolveLoadPromise: () => void
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoadPromise = resolve
    })

    const sourceCollection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-loading-subset-source`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    // Create a live query collection manually
    const liveQueryCollection = createLiveQueryCollection({
      query: (q) => q.from({ persons: sourceCollection }),
      startSync: true,
    })

    // Wait for the live query to be ready
    await liveQueryCollection.preload()
    expect(liveQueryCollection.status).toBe(`ready`)

    // Now track a load promise to simulate on-demand loading starting
    // This sets isLoadingSubset=true AFTER the collection is ready
    liveQueryCollection._sync.trackLoadPromise(loadPromise)
    expect(liveQueryCollection.isLoadingSubset).toBe(true)

    let suspenseReleased = false
    let dataWhenSuspenseReleased: Array<any> | undefined

    const SuspenseTracker = ({ children }: { children: ReactNode }) => {
      return (
        <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
      )
    }

    const { result } = renderHook(
      () => {
        const queryResult = useLiveSuspenseQuery(liveQueryCollection)

        // If we get here without throwing, suspense has released
        suspenseReleased = true
        dataWhenSuspenseReleased = queryResult.data
        return queryResult
      },
      {
        wrapper: SuspenseTracker,
      },
    )

    // Give React time to process - suspense should still be active
    // because isLoadingSubset is true on the live query collection
    await new Promise((r) => setTimeout(r, 50))

    // Verify state: ready but still loading subset
    expect(liveQueryCollection.status).toBe(`ready`)
    expect(liveQueryCollection.isLoadingSubset).toBe(true)

    // KEY ASSERTION: Suspense should NOT have released yet
    // This is the bug we're fixing - without the fix, suspense would release here
    expect(suspenseReleased).toBe(false)

    // Now resolve the load promise
    resolveLoadPromise!()

    // Wait for suspense to release
    await waitFor(() => {
      expect(suspenseReleased).toBe(true)
    })

    // Verify data is available when suspense releases
    expect(dataWhenSuspenseReleased).toHaveLength(3)

    // Wait for React to finish rendering
    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })
    expect(result.current.data).toHaveLength(3)
  })
})
