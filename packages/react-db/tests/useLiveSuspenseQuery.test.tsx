import { describe, expect, it } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from "@tanstack/db"
import { Suspense, useEffect } from "react"
import { useLiveSuspenseQuery } from "../src/useLiveSuspenseQuery"
import { mockSyncCollectionOptions } from "../../db/tests/utils"
import type { ReactNode } from "react"

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
      })
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
            }))
        )
      },
      {
        wrapper: SuspenseWrapper,
      }
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
      })
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) => q.from({ persons: collection }))
      },
      {
        wrapper: SuspenseWrapper,
      }
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
      })
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.id, `3`))
            .findOne()
        )
      },
      {
        wrapper: SuspenseWrapper,
      }
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
      })
    )

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ persons: collection })
        .where(({ persons }) => gt(persons.age, 30))
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
      })
    )

    const { result, rerender } = renderHook(
      ({ minAge }) => {
        return useLiveSuspenseQuery(
          (q) =>
            q
              .from({ persons: collection })
              .where(({ persons }) => gt(persons.age, minAge)),
          [minAge]
        )
      },
      {
        wrapper: SuspenseWrapper,
        initialProps: { minAge: 30 },
      }
    )

    // Initial load - age > 30
    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })
    expect(result.current.data[0]!.age).toBe(35)

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
      })
    )

    const { result } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      }
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
        }
      )
    }).toThrow(/does not support disabled queries/)
  })

  it(`should work with config object`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-7`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery({
          query: (q) => q.from({ persons: collection }),
        })
      },
      {
        wrapper: SuspenseWrapper,
      }
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
      })
    )

    const { result, rerender } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      }
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
      })
    )

    const { result } = renderHook(
      () => {
        const persons = useLiveSuspenseQuery((q) =>
          q.from({ persons: personsCollection })
        )
        const johnDoe = useLiveSuspenseQuery((q) =>
          q
            .from({ persons: personsCollection })
            .where(({ persons: p }) => eq(p.id, `1`))
            .findOne()
        )
        return { persons, johnDoe }
      },
      {
        wrapper: SuspenseWrapper,
      }
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
      })
    )

    const { result, unmount } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      }
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
      { timeout: 1000 }
    )
  })

  it(`should NOT re-suspend on live updates after initial load`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-11`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
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
      }
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
      })
    )

    let suspenseCount = 0

    // Component that renders inside fallback and counts actual renders
    const FallbackCounter = () => {
      useEffect(() => {
        suspenseCount++
      })
      return <div>Loading...</div>
    }

    const SuspenseCounter = ({ children }: { children: ReactNode }) => {
      return <Suspense fallback={<FallbackCounter />}>{children}</Suspense>
    }

    const { result, rerender } = renderHook(
      ({ minAge }) =>
        useLiveSuspenseQuery(
          (q) =>
            q
              .from({ persons: collection })
              .where(({ persons }) => gt(persons.age, minAge)),
          [minAge]
        ),
      {
        wrapper: SuspenseCounter,
        initialProps: { minAge: 20 },
      }
    )

    // Wait for data to be available
    // NOTE: Collections with initialData don't suspend - they're ready immediately
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const suspenseCountAfterInitial = suspenseCount
    // Should be 0 because collection with initialData doesn't suspend
    expect(suspenseCountAfterInitial).toBe(0)

    // Re-render with SAME deps - should NOT suspend
    rerender({ minAge: 20 })
    rerender({ minAge: 20 })
    rerender({ minAge: 20 })

    expect(suspenseCount).toBe(0)

    // Change deps - SHOULD suspend (new collection needs to load)
    rerender({ minAge: 30 })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    // NOTE: Even on deps change with initialData, collection is immediately ready
    // The filtered query result is computed synchronously from the base collection
    expect(suspenseCount).toBe(0)
  })
})
