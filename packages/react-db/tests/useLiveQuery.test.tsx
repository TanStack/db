import { describe, expect, it } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import {
  Query,
  count,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  eq,
  gt,
  lte,
} from "@tanstack/db"
import { useEffect } from "react"
import { useLiveQuery } from "../src/useLiveQuery"
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from "../../db/tests/utils"

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

type Issue = {
  id: string
  title: string
  description: string
  userId: string
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

const initialIssues: Array<Issue> = [
  {
    id: `1`,
    title: `Issue 1`,
    description: `Issue 1 description`,
    userId: `1`,
  },
  {
    id: `2`,
    title: `Issue 2`,
    description: `Issue 2 description`,
    userId: `2`,
  },
  {
    id: `3`,
    title: `Issue 3`,
    description: `Issue 3 description`,
    userId: `1`,
  },
]

describe(`Query Collections`, () => {
  it(`should work with basic collection and select`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            age: persons.age,
          }))
      )
    })

    // Wait for collection to sync and state to update
    await waitFor(() => {
      expect(result.current.state.size).toBe(1) // Only John Smith (age 35)
    })
    expect(result.current.data).toHaveLength(1)

    const johnSmith = result.current.data[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  it(`should keep stable ref`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result, rerender } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            age: persons.age,
          }))
      )
    })

    // Wait for collection to sync and state to update
    await waitFor(() => {
      expect(result.current.state.size).toBe(1) // Only John Smith (age 35)
    })

    const data1 = result.current.data
    expect(result.current.data).toHaveLength(1)

    rerender()

    const data2 = result.current.data

    // Passes cause the underlying objects are stable
    expect(data1).toEqual(data2)
    expect(data1[0]).toBe(data2[0])

    // Fails cause array isn't
    expect(data1).toBe(data2)
  })

  it(`should be able to return a single row with query builder`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne()
      )
    })

    // Wait for collection to sync
    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })

    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    expect(result.current.data).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
  })

  it(`should be able to return a single row with config object`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result } = renderHook(() => {
      return useLiveQuery({
        query: (q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.id, `3`))
            .findOne(),
      })
    })

    // Wait for collection to sync
    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })

    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    expect(result.current.data).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
  })

  it(`should be able to return a single row with collection`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const liveQueryCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
    })

    const { result } = renderHook(() => {
      return useLiveQuery(liveQueryCollection)
    })

    // Wait for collection to sync
    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })

    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    expect(result.current.data).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
  })

  it(`should be able to query a collection with live updates`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => gt(c.age, 30))
          .select(({ collection: c }) => ({
            id: c.id,
            name: c.name,
          }))
          .orderBy(({ collection: c }) => c.id, `asc`)
      )
    })

    // Wait for collection to sync
    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })
    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    expect(result.current.data.length).toBe(1)
    expect(result.current.data[0]).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    // Insert a new person using the proper utils pattern
    act(() => {
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
    })

    await waitFor(() => {
      expect(result.current.state.size).toBe(2)
    })
    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
    expect(result.current.state.get(`4`)).toMatchObject({
      id: `4`,
      name: `Kyle Doe`,
    })

    expect(result.current.data.length).toBe(2)
    expect(result.current.data).toEqual(
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

    // Update the person
    act(() => {
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        value: {
          id: `4`,
          name: `Kyle Doe 2`,
          age: 40,
          email: `kyle.doe@example.com`,
          isActive: true,
          team: `team1`,
        },
      })
      collection.utils.commit()
    })

    await waitFor(() => {
      expect(result.current.state.size).toBe(2)
    })
    expect(result.current.state.get(`4`)).toMatchObject({
      id: `4`,
      name: `Kyle Doe 2`,
    })

    expect(result.current.data.length).toBe(2)
    expect(result.current.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `3`,
          name: `John Smith`,
        }),
        expect.objectContaining({
          id: `4`,
          name: `Kyle Doe 2`,
        }),
      ])
    )

    // Delete the person
    act(() => {
      collection.utils.begin()
      collection.utils.write({
        type: `delete`,
        value: {
          id: `4`,
          name: `Kyle Doe 2`,
          age: 40,
          email: `kyle.doe@example.com`,
          isActive: true,
          team: `team1`,
        },
      })
      collection.utils.commit()
    })

    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })
    expect(result.current.state.get(`4`)).toBeUndefined()

    expect(result.current.data.length).toBe(1)
    expect(result.current.data[0]).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
  })

  it(`should join collections and return combined results with live updates`, async () => {
    // Create person collection
    const personCollection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `person-collection-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    // Create issue collection
    const issueCollection = createCollection(
      mockSyncCollectionOptions<Issue>({
        id: `issue-collection-test`,
        getKey: (issue: Issue) => issue.id,
        initialData: initialIssues,
      })
    )

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ issues: issueCollection })
          .join({ persons: personCollection }, ({ issues, persons }) =>
            eq(issues.userId, persons.id)
          )
          .select(({ issues, persons }) => ({
            id: issues.id,
            title: issues.title,
            name: persons?.name,
          }))
      )
    })

    // Wait for collections to sync
    await waitFor(() => {
      expect(result.current.state.size).toBe(3)
    })

    // Verify that we have the expected joined results

    expect(result.current.state.get(`[1,1]`)).toMatchObject({
      id: `1`,
      name: `John Doe`,
      title: `Issue 1`,
    })

    expect(result.current.state.get(`[2,2]`)).toMatchObject({
      id: `2`,
      name: `Jane Doe`,
      title: `Issue 2`,
    })

    expect(result.current.state.get(`[3,1]`)).toMatchObject({
      id: `3`,
      name: `John Doe`,
      title: `Issue 3`,
    })

    // Add a new issue for user 2
    act(() => {
      issueCollection.utils.begin()
      issueCollection.utils.write({
        type: `insert`,
        value: {
          id: `4`,
          title: `Issue 4`,
          description: `Issue 4 description`,
          userId: `2`,
        },
      })
      issueCollection.utils.commit()
    })

    await waitFor(() => {
      expect(result.current.state.size).toBe(4)
    })
    expect(result.current.state.get(`[4,2]`)).toMatchObject({
      id: `4`,
      name: `Jane Doe`,
      title: `Issue 4`,
    })

    // Update an issue we're already joined with
    act(() => {
      issueCollection.utils.begin()
      issueCollection.utils.write({
        type: `update`,
        value: {
          id: `2`,
          title: `Updated Issue 2`,
          description: `Issue 2 description`,
          userId: `2`,
        },
      })
      issueCollection.utils.commit()
    })

    await waitFor(() => {
      // The updated title should be reflected in the joined results
      expect(result.current.state.get(`[2,2]`)).toMatchObject({
        id: `2`,
        name: `Jane Doe`,
        title: `Updated Issue 2`,
      })
    })

    // Delete an issue
    act(() => {
      issueCollection.utils.begin()
      issueCollection.utils.write({
        type: `delete`,
        value: {
          id: `3`,
          title: `Issue 3`,
          description: `Issue 3 description`,
          userId: `1`,
        },
      })
      issueCollection.utils.commit()
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // After deletion, issue 3 should no longer have a joined result
    expect(result.current.state.get(`[3,1]`)).toBeUndefined()
    expect(result.current.state.size).toBe(3)
  })

  it(`should recompile query when parameters change and change results`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `params-change-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result, rerender } = renderHook(
      ({ minAge }: { minAge: number }) => {
        return useLiveQuery(
          (q) =>
            q
              .from({ collection })
              .where(({ collection: c }) => gt(c.age, minAge))
              .select(({ collection: c }) => ({
                id: c.id,
                name: c.name,
                age: c.age,
              })),
          [minAge]
        )
      },
      { initialProps: { minAge: 30 } }
    )

    // Wait for collection to sync
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Initially should return only people older than 30
    expect(result.current.state.size).toBe(1)
    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change the parameter to include more people
    act(() => {
      rerender({ minAge: 20 })
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Now should return all people as they're all older than 20
    expect(result.current.state.size).toBe(3)
    expect(result.current.state.get(`1`)).toMatchObject({
      id: `1`,
      name: `John Doe`,
      age: 30,
    })
    expect(result.current.state.get(`2`)).toMatchObject({
      id: `2`,
      name: `Jane Doe`,
      age: 25,
    })
    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change to exclude everyone
    act(() => {
      rerender({ minAge: 50 })
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should now be empty
    expect(result.current.state.size).toBe(0)
  })

  it(`should stop old query when parameters change`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `stop-query-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { result, rerender } = renderHook(
      ({ minAge }: { minAge: number }) => {
        return useLiveQuery(
          (q) =>
            q
              .from({ collection })
              .where(({ collection: c }) => gt(c.age, minAge))
              .select(({ collection: c }) => ({
                id: c.id,
                name: c.name,
              })),
          [minAge]
        )
      },
      { initialProps: { minAge: 30 } }
    )

    // Wait for collection to sync
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Initial query should return only people older than 30
    expect(result.current.state.size).toBe(1)
    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    // Change the parameter to include more people
    act(() => {
      rerender({ minAge: 25 })
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Query should now return all people older than 25
    expect(result.current.state.size).toBe(2)
    expect(result.current.state.get(`1`)).toMatchObject({
      id: `1`,
      name: `John Doe`,
    })
    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    // Change to a value that excludes everyone
    act(() => {
      rerender({ minAge: 50 })
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should now be empty
    expect(result.current.state.size).toBe(0)
  })

  it(`should be able to query a result collection with live updates`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `optimistic-changes-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    // Initial query
    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => gt(c.age, 30))
          .select(({ collection: c }) => ({
            id: c.id,
            name: c.name,
            team: c.team,
          }))
          .orderBy(({ collection: c }) => c.id, `asc`)
      )
    })

    // Wait for collection to sync
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Grouped query derived from initial query
    const { result: groupedResult } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ queryResult: result.current.collection })
          .groupBy(({ queryResult }) => queryResult.team)
          .select(({ queryResult }) => ({
            team: queryResult.team,
            count: count(queryResult.id),
          }))
      )
    })

    // Wait for grouped query to sync
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Verify initial grouped results
    expect(groupedResult.current.state.size).toBe(1)
    const teamResult = Array.from(groupedResult.current.state.values())[0]
    expect(teamResult).toMatchObject({
      team: `team1`,
      count: 1,
    })

    // Insert two new users in different teams
    act(() => {
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `5`,
          name: `Sarah Jones`,
          age: 32,
          email: `sarah.jones@example.com`,
          isActive: true,
          team: `team1`,
        },
      })
      collection.utils.write({
        type: `insert`,
        value: {
          id: `6`,
          name: `Mike Wilson`,
          age: 38,
          email: `mike.wilson@example.com`,
          isActive: true,
          team: `team2`,
        },
      })
      collection.utils.commit()
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Verify the grouped results include the new team members
    expect(groupedResult.current.state.size).toBe(2)

    const groupedResults = Array.from(groupedResult.current.state.values())
    const team1Result = groupedResults.find((r) => r.team === `team1`)
    const team2Result = groupedResults.find((r) => r.team === `team2`)

    expect(team1Result).toMatchObject({
      team: `team1`,
      count: 2, // John Smith + Sarah Jones
    })
    expect(team2Result).toMatchObject({
      team: `team2`,
      count: 1, // Mike Wilson
    })
  })

  it(`optimistic state is dropped after commit`, async () => {
    // Track renders and states
    const renderStates: Array<{
      stateSize: number
      hasTempKey: boolean
      hasPermKey: boolean
      timestamp: number
    }> = []

    // Create person collection
    const personCollection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `person-collection-test-bug`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    // Create issue collection
    const issueCollection = createCollection(
      mockSyncCollectionOptions<Issue>({
        id: `issue-collection-test-bug`,
        getKey: (issue: Issue) => issue.id,
        initialData: initialIssues,
      })
    )

    // Render the hook with a query that joins persons and issues
    const { result } = renderHook(() => {
      const queryResult = useLiveQuery((q) =>
        q
          .from({ issues: issueCollection })
          .join({ persons: personCollection }, ({ issues, persons }) =>
            eq(issues.userId, persons.id)
          )
          .select(({ issues, persons }) => ({
            id: issues.id,
            title: issues.title,
            name: persons?.name,
          }))
      )

      // Track each render state
      useEffect(() => {
        renderStates.push({
          stateSize: queryResult.state.size,
          hasTempKey: queryResult.state.has(`[temp-key,1]`),
          hasPermKey: queryResult.state.has(`[4,1]`),
          timestamp: Date.now(),
        })
      }, [queryResult.state])

      return queryResult
    })

    // Wait for collections to sync and verify initial state
    await waitFor(() => {
      expect(result.current.state.size).toBe(3)
    })

    // Reset render states array for clarity in the remaining test
    renderStates.length = 0

    // Create an optimistic action for adding issues
    type AddIssueInput = {
      title: string
      description: string
      userId: string
    }

    const addIssue = createOptimisticAction<AddIssueInput>({
      onMutate: (issueInput) => {
        // Optimistically insert with temporary key
        issueCollection.insert({
          id: `temp-key`,
          title: issueInput.title,
          description: issueInput.description,
          userId: issueInput.userId,
        })
      },
      mutationFn: async (issueInput) => {
        // Simulate server persistence - in a real app, this would be an API call
        await new Promise((resolve) => setTimeout(resolve, 10)) // Simulate network delay

        // After "server" responds, update the collection with permanent ID using utils
        // Note: This act() is inside the mutationFn and handles the async server response
        act(() => {
          issueCollection.utils.begin()
          issueCollection.utils.write({
            type: `delete`,
            value: {
              id: `temp-key`,
              title: issueInput.title,
              description: issueInput.description,
              userId: issueInput.userId,
            },
          })
          issueCollection.utils.write({
            type: `insert`,
            value: {
              id: `4`, // Use the permanent ID
              title: issueInput.title,
              description: issueInput.description,
              userId: issueInput.userId,
            },
          })
          issueCollection.utils.commit()
        })

        return { success: true, id: `4` }
      },
    })

    // Perform optimistic insert of a new issue
    let transaction: any
    act(() => {
      transaction = addIssue({
        title: `New Issue`,
        description: `New Issue Description`,
        userId: `1`,
      })
    })

    await waitFor(() => {
      // Verify optimistic state is immediately reflected
      expect(result.current.state.size).toBe(4)
      expect(result.current.state.get(`[temp-key,1]`)).toMatchObject({
        id: `temp-key`,
        name: `John Doe`,
        title: `New Issue`,
      })
      expect(result.current.state.get(`[4,1]`)).toBeUndefined()
    })

    // Wait for the transaction to be committed
    await transaction.isPersisted.promise

    await waitFor(() => {
      // Wait for the permanent key to appear
      expect(result.current.state.get(`[4,1]`)).toBeDefined()
    })

    // Check if we had any render where the temp key was removed but the permanent key wasn't added yet
    const hadFlicker = renderStates.some(
      (state) => !state.hasTempKey && !state.hasPermKey && state.stateSize === 3
    )

    expect(hadFlicker).toBe(false)

    // Verify the temporary key is replaced by the permanent one
    expect(result.current.state.size).toBe(4)
    expect(result.current.state.get(`[temp-key,1]`)).toBeUndefined()
    expect(result.current.state.get(`[4,1]`)).toMatchObject({
      id: `4`,
      name: `John Doe`,
      title: `New Issue`,
    })
  })

  it(`should accept pre-created live query collection`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `pre-created-collection-test`,
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

    const { result } = renderHook(() => {
      return useLiveQuery(liveQueryCollection)
    })

    // Wait for collection to sync and state to update
    await waitFor(() => {
      expect(result.current.state.size).toBe(1) // Only John Smith (age 35)
    })
    expect(result.current.data).toHaveLength(1)

    const johnSmith = result.current.data[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Verify that the returned collection is the same instance
    expect(result.current.collection).toBe(liveQueryCollection)
  })

  it(`should switch to a different pre-created live query collection when changed`, async () => {
    const collection1 = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `collection-1`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const collection2 = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `collection-2`,
        getKey: (person: Person) => person.id,
        initialData: [
          {
            id: `4`,
            name: `Alice Cooper`,
            age: 45,
            email: `alice.cooper@example.com`,
            isActive: true,
            team: `team3`,
          },
          {
            id: `5`,
            name: `Bob Dylan`,
            age: 50,
            email: `bob.dylan@example.com`,
            isActive: true,
            team: `team3`,
          },
        ],
      })
    )

    // Create two different live query collections
    const liveQueryCollection1 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ persons: collection1 })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
      startSync: true,
    })

    const liveQueryCollection2 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ persons: collection2 })
          .where(({ persons }) => gt(persons.age, 40))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
      startSync: true,
    })

    const { result, rerender } = renderHook(
      ({ collection }: { collection: any }) => {
        return useLiveQuery(collection)
      },
      { initialProps: { collection: liveQueryCollection1 } }
    )

    // Wait for first collection to sync
    await waitFor(() => {
      expect(result.current.state.size).toBe(1) // Only John Smith from collection1
    })
    expect(result.current.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
    expect(result.current.collection).toBe(liveQueryCollection1)

    // Switch to the second collection
    act(() => {
      rerender({ collection: liveQueryCollection2 })
    })

    // Wait for second collection to sync
    await waitFor(() => {
      expect(result.current.state.size).toBe(2) // Alice and Bob from collection2
    })
    expect(result.current.state.get(`4`)).toMatchObject({
      id: `4`,
      name: `Alice Cooper`,
    })
    expect(result.current.state.get(`5`)).toMatchObject({
      id: `5`,
      name: `Bob Dylan`,
    })
    expect(result.current.collection).toBe(liveQueryCollection2)

    // Verify we no longer have data from the first collection
    expect(result.current.state.get(`3`)).toBeUndefined()
  })

  it(`should accept a config object with a pre-built QueryBuilder instance`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-config-querybuilder`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    // Create a QueryBuilder instance beforehand
    const queryBuilder = new Query()
      .from({ persons: collection })
      .where(({ persons }) => gt(persons.age, 30))
      .select(({ persons }) => ({
        id: persons.id,
        name: persons.name,
        age: persons.age,
      }))

    const { result } = renderHook(() => {
      return useLiveQuery({ query: queryBuilder })
    })

    // Wait for collection to sync and state to update
    await waitFor(() => {
      expect(result.current.state.size).toBe(1) // Only John Smith (age 35)
    })
    expect(result.current.data).toHaveLength(1)

    const johnSmith = result.current.data[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  describe(`isLoaded property`, () => {
    it(`should be true initially and false after collection is ready`, async () => {
      let beginFn: (() => void) | undefined
      let commitFn: (() => void) | undefined

      // Create a collection that doesn't start sync immediately
      const collection = createCollection<Person>({
        id: `has-loaded-test`,
        getKey: (person: Person) => person.id,
        startSync: false, // Don't start sync immediately
        sync: {
          sync: ({ begin, commit, markReady }) => {
            beginFn = begin
            commitFn = () => {
              commit()
              markReady()
            }
            // Don't call begin/commit immediately
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )
      })

      // Initially isLoading should be true
      expect(result.current.isLoading).toBe(true)

      // Start sync manually
      act(() => {
        collection.preload()
      })

      // Trigger the first commit to make collection ready
      act(() => {
        if (beginFn && commitFn) {
          beginFn()
          commitFn()
        }
      })

      // Insert data
      act(() => {
        collection.insert({
          id: `1`,
          name: `John Doe`,
          age: 35,
          email: `john.doe@example.com`,
          isActive: true,
          team: `team1`,
        })
      })

      // Wait for collection to become ready
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      // Note: Data may not appear immediately due to live query evaluation timing
      // The main test is that isLoading transitions from true to false
    })

    it(`should be false for pre-created collections that are already syncing`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `pre-created-has-loaded-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      // Create a live query collection that's already syncing
      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        startSync: true,
      })

      // Wait a bit for the collection to start syncing
      await new Promise((resolve) => setTimeout(resolve, 10))

      const { result } = renderHook(() => {
        return useLiveQuery(liveQueryCollection)
      })

      // For pre-created collections that are already syncing, isLoading should be true
      expect(result.current.isLoading).toBe(false)
      expect(result.current.state.size).toBe(1)
    })

    it(`should update isLoading when collection status changes`, async () => {
      let beginFn: (() => void) | undefined
      let commitFn: (() => void) | undefined
      let markReadyFn: (() => void) | undefined

      const collection = createCollection<Person>({
        id: `status-change-has-loaded-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            beginFn = begin
            commitFn = commit
            markReadyFn = markReady
            // Don't sync immediately
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )
      })

      // Initially should be true
      expect(result.current.isLoading).toBe(true)

      // Start sync manually
      act(() => {
        collection.preload()
      })

      // Trigger the first commit to make collection ready
      act(() => {
        if (beginFn && commitFn && markReadyFn) {
          beginFn()
          commitFn()
          markReadyFn()
        }
      })

      // Insert data
      act(() => {
        collection.insert({
          id: `1`,
          name: `John Doe`,
          age: 35,
          email: `john.doe@example.com`,
          isActive: true,
          team: `team1`,
        })
      })

      expect(result.current.isLoading).toBe(false)
      expect(result.current.isReady).toBe(true)

      // Wait for collection to become ready
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.status).toBe(`ready`)
    })

    it(`should maintain isReady state during live updates`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `live-updates-has-loaded-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )
      })

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initialIsReady = result.current.isReady

      // Perform live updates
      act(() => {
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
      })

      // Wait for update to process
      await waitFor(() => {
        expect(result.current.state.size).toBe(2)
      })

      // isReady should remain true during live updates
      expect(result.current.isReady).toBe(true)
      expect(result.current.isReady).toBe(initialIsReady)
    })

    it(`should handle isLoading with complex queries including joins`, async () => {
      let personBeginFn: (() => void) | undefined
      let personCommitFn: (() => void) | undefined
      let personMarkReadyFn: (() => void) | undefined
      let issueBeginFn: (() => void) | undefined
      let issueCommitFn: (() => void) | undefined
      let issueMarkReadyFn: (() => void) | undefined

      const personCollection = createCollection<Person>({
        id: `join-has-loaded-persons`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            personBeginFn = begin
            personCommitFn = commit
            personMarkReadyFn = markReady
            // Don't sync immediately
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const issueCollection = createCollection<Issue>({
        id: `join-has-loaded-issues`,
        getKey: (issue: Issue) => issue.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            issueBeginFn = begin
            issueCommitFn = commit
            issueMarkReadyFn = markReady
            // Don't sync immediately
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ issues: issueCollection })
            .join({ persons: personCollection }, ({ issues, persons }) =>
              eq(issues.userId, persons.id)
            )
            .select(({ issues, persons }) => ({
              id: issues.id,
              title: issues.title,
              name: persons?.name,
            }))
        )
      })

      // Initially should be true
      expect(result.current.isLoading).toBe(true)

      // Start sync for both collections
      act(() => {
        personCollection.preload()
        issueCollection.preload()
      })

      // Trigger the first commit for both collections to make them ready
      act(() => {
        if (personBeginFn && personCommitFn && personMarkReadyFn) {
          personBeginFn()
          personCommitFn()
          personMarkReadyFn()
        }
        if (issueBeginFn && issueCommitFn && issueMarkReadyFn) {
          issueBeginFn()
          issueCommitFn()
          issueMarkReadyFn()
        }
      })

      // Insert data into both collections
      act(() => {
        personCollection.insert({
          id: `1`,
          name: `John Doe`,
          age: 30,
          email: `john.doe@example.com`,
          isActive: true,
          team: `team1`,
        })
        issueCollection.insert({
          id: `1`,
          title: `Issue 1`,
          description: `Issue 1 description`,
          userId: `1`,
        })
      })

      // Wait for both collections to sync
      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })
      // Note: Joined data may not appear immediately due to live query evaluation timing
      // The main test is that isLoading transitions from false to true
    })

    it(`should handle isLoading with parameterized queries`, async () => {
      let beginFn: (() => void) | undefined
      let commitFn: (() => void) | undefined

      const collection = createCollection<Person>({
        id: `params-has-loaded-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            beginFn = begin
            commitFn = () => {
              commit()
              markReady()
            }
            // Don't sync immediately
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result, rerender } = renderHook(
        ({ minAge }: { minAge: number }) => {
          return useLiveQuery(
            (q) =>
              q
                .from({ collection })
                .where(({ collection: c }) => gt(c.age, minAge))
                .select(({ collection: c }) => ({
                  id: c.id,
                  name: c.name,
                })),
            [minAge]
          )
        },
        { initialProps: { minAge: 30 } }
      )

      // Initially should be false
      expect(result.current.isLoading).toBe(true)

      // Start sync manually
      act(() => {
        collection.preload()
      })

      // Trigger the first commit to make collection ready
      act(() => {
        if (beginFn && commitFn) {
          beginFn()
          commitFn()
        }
      })

      // Insert data
      act(() => {
        collection.insert({
          id: `1`,
          name: `John Doe`,
          age: 35,
          email: `john.doe@example.com`,
          isActive: true,
          team: `team1`,
        })
        collection.insert({
          id: `2`,
          name: `Jane Doe`,
          age: 25,
          email: `jane.doe@example.com`,
          isActive: true,
          team: `team2`,
        })
      })

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Change parameters
      act(() => {
        rerender({ minAge: 25 })
      })

      // isReady should remain true even when parameters change
      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })
      // Note: Data size may not change immediately due to live query evaluation timing
      // The main test is that isReady remains true when parameters change
    })
  })

  describe(`eager execution during sync`, () => {
    it(`should show state while isLoading is true during sync`, async () => {
      let syncBegin: (() => void) | undefined
      let syncWrite: ((op: any) => void) | undefined
      let syncCommit: (() => void) | undefined
      let syncMarkReady: (() => void) | undefined

      // Create a collection that doesn't auto-start syncing
      const collection = createCollection<Person>({
        id: `eager-execution-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            syncBegin = begin
            syncWrite = write
            syncCommit = commit
            syncMarkReady = markReady
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )
      })

      // Initially isLoading should be true
      expect(result.current.isLoading).toBe(true)
      expect(result.current.state.size).toBe(0)
      expect(result.current.data).toEqual([])

      // Start sync manually
      act(() => {
        collection.preload()
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Still loading
      expect(result.current.isLoading).toBe(true)

      // Add first batch of data (but don't mark ready yet)
      act(() => {
        syncBegin!()
        syncWrite!({
          type: `insert`,
          value: {
            id: `1`,
            name: `John Smith`,
            age: 35,
            email: `john.smith@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        syncCommit!()
      })

      // Data should be visible even though still loading
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })
      expect(result.current.isLoading).toBe(true) // Still loading
      expect(result.current.data).toHaveLength(1)
      expect(result.current.data[0]).toMatchObject({
        id: `1`,
        name: `John Smith`,
      })

      // Add second batch of data
      act(() => {
        syncBegin!()
        syncWrite!({
          type: `insert`,
          value: {
            id: `2`,
            name: `Jane Doe`,
            age: 32,
            email: `jane.doe@example.com`,
            isActive: true,
            team: `team2`,
          },
        })
        syncCommit!()
      })

      // More data should be visible
      await waitFor(() => {
        expect(result.current.state.size).toBe(2)
      })
      expect(result.current.isLoading).toBe(true) // Still loading
      expect(result.current.data).toHaveLength(2)

      // Now mark as ready
      act(() => {
        syncMarkReady!()
      })

      // Should now be ready
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.isReady).toBe(true)
      expect(result.current.state.size).toBe(2)
      expect(result.current.data).toHaveLength(2)
    })

    it(`should show filtered results during sync with isLoading true`, async () => {
      let syncBegin: (() => void) | undefined
      let syncWrite: ((op: any) => void) | undefined
      let syncCommit: (() => void) | undefined
      let syncMarkReady: (() => void) | undefined

      const collection = createCollection<Person>({
        id: `eager-filter-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            syncBegin = begin
            syncWrite = write
            syncCommit = commit
            syncMarkReady = markReady
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => eq(persons.team, `team1`))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              team: persons.team,
            }))
        )
      })

      // Start sync
      act(() => {
        collection.preload()
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(result.current.isLoading).toBe(true)

      // Add items from different teams
      act(() => {
        syncBegin!()
        syncWrite!({
          type: `insert`,
          value: {
            id: `1`,
            name: `Alice`,
            age: 30,
            email: `alice@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        syncWrite!({
          type: `insert`,
          value: {
            id: `2`,
            name: `Bob`,
            age: 25,
            email: `bob@example.com`,
            isActive: true,
            team: `team2`,
          },
        })
        syncWrite!({
          type: `insert`,
          value: {
            id: `3`,
            name: `Charlie`,
            age: 35,
            email: `charlie@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        syncCommit!()
      })

      // Should only show team1 members, even while loading
      await waitFor(() => {
        expect(result.current.state.size).toBe(2)
      })
      expect(result.current.isLoading).toBe(true)
      expect(result.current.data).toHaveLength(2)
      expect(result.current.data.every((p) => p.team === `team1`)).toBe(true)

      // Mark ready
      act(() => {
        syncMarkReady!()
      })

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.state.size).toBe(2)
    })

    it(`should show join results during sync with isLoading true`, async () => {
      let userSyncBegin: (() => void) | undefined
      let userSyncWrite: ((op: any) => void) | undefined
      let userSyncCommit: (() => void) | undefined
      let userSyncMarkReady: (() => void) | undefined

      let issueSyncBegin: (() => void) | undefined
      let issueSyncWrite: ((op: any) => void) | undefined
      let issueSyncCommit: (() => void) | undefined
      let issueSyncMarkReady: (() => void) | undefined

      const personCollection = createCollection<Person>({
        id: `eager-join-persons`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            userSyncBegin = begin
            userSyncWrite = write
            userSyncCommit = commit
            userSyncMarkReady = markReady
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const issueCollection = createCollection<Issue>({
        id: `eager-join-issues`,
        getKey: (issue: Issue) => issue.id,
        startSync: false,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            issueSyncBegin = begin
            issueSyncWrite = write
            issueSyncCommit = commit
            issueSyncMarkReady = markReady
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ issues: issueCollection })
            .join({ persons: personCollection }, ({ issues, persons }) =>
              eq(issues.userId, persons.id)
            )
            .select(({ issues, persons }) => ({
              id: issues.id,
              title: issues.title,
              userName: persons?.name,
            }))
        )
      })

      // Start sync for both
      act(() => {
        personCollection.preload()
        issueCollection.preload()
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(result.current.isLoading).toBe(true)

      // Add a person first
      act(() => {
        userSyncBegin!()
        userSyncWrite!({
          type: `insert`,
          value: {
            id: `1`,
            name: `John Doe`,
            age: 30,
            email: `john@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        userSyncCommit!()
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(result.current.isLoading).toBe(true)
      expect(result.current.state.size).toBe(0) // No joins yet

      // Add an issue for that person
      act(() => {
        issueSyncBegin!()
        issueSyncWrite!({
          type: `insert`,
          value: {
            id: `1`,
            title: `First Issue`,
            description: `Description`,
            userId: `1`,
          },
        })
        issueSyncCommit!()
      })

      // Should see join result even while loading
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })
      expect(result.current.isLoading).toBe(true)
      expect(result.current.data).toHaveLength(1)
      expect(result.current.data[0]).toMatchObject({
        id: `1`,
        title: `First Issue`,
        userName: `John Doe`,
      })

      // Mark both as ready
      act(() => {
        userSyncMarkReady!()
        issueSyncMarkReady!()
      })

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.state.size).toBe(1)
    })

    it(`should update isReady when source collection is marked ready with no data`, async () => {
      let syncMarkReady: (() => void) | undefined

      const collection = createCollection<Person>({
        id: `ready-no-data-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ markReady }) => {
            syncMarkReady = markReady
            // Don't call begin/commit - just provide markReady
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const { result } = renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )
      })

      // Initially isLoading should be true
      expect(result.current.isLoading).toBe(true)
      expect(result.current.isReady).toBe(false)
      expect(result.current.state.size).toBe(0)
      expect(result.current.data).toEqual([])

      // Start sync manually
      act(() => {
        collection.preload()
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Still loading
      expect(result.current.isLoading).toBe(true)
      expect(result.current.isReady).toBe(false)

      // Mark ready without any data commits
      act(() => {
        syncMarkReady!()
      })

      // Should now be ready, even with no data
      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.state.size).toBe(0) // Still no data
      expect(result.current.data).toEqual([]) // Empty array
      expect(result.current.status).toBe(`ready`)
    })
  })

  describe(`callback variants with conditional returns`, () => {
    it(`should handle callback returning undefined with proper state`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `undefined-callback-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => {
          return useLiveQuery(
            (q) => {
              if (!enabled) return undefined
              return q
                .from({ persons: collection })
                .where(({ persons }) => gt(persons.age, 30))
                .select(({ persons }) => ({
                  id: persons.id,
                  name: persons.name,
                  age: persons.age,
                }))
            },
            [enabled]
          )
        },
        { initialProps: { enabled: false } }
      )

      // When callback returns undefined, should return the specified state
      expect(result.current.state).toBeUndefined()
      expect(result.current.data).toBeUndefined()
      expect(result.current.collection).toBeUndefined()
      expect(result.current.status).toBe(`disabled`)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isReady).toBe(false)
      expect(result.current.isIdle).toBe(false)
      expect(result.current.isError).toBe(false)
      expect(result.current.isCleanedUp).toBe(false)

      // Enable the query
      act(() => {
        rerender({ enabled: true })
      })

      // Wait for collection to sync and state to update
      await waitFor(() => {
        expect(result.current.state?.size).toBe(1) // Only John Smith (age 35)
      })
      expect(result.current.data).toHaveLength(1)
      expect(result.current.collection).toBeDefined()
      expect(result.current.status).toBeDefined()
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isReady).toBe(true)
      expect(result.current.isIdle).toBe(false)

      const johnSmith = result.current.data![0]
      expect(johnSmith).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Disable the query again
      act(() => {
        rerender({ enabled: false })
      })

      // Should return to undefined state
      expect(result.current.state).toBeUndefined()
      expect(result.current.data).toBeUndefined()
      expect(result.current.collection).toBeUndefined()
      expect(result.current.status).toBe(`disabled`)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isReady).toBe(false)
      expect(result.current.isIdle).toBe(false)
      expect(result.current.isError).toBe(false)
      expect(result.current.isCleanedUp).toBe(false)
    })

    it(`should handle callback returning null with proper state`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `null-callback-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => {
          return useLiveQuery(
            (q) => {
              if (!enabled) return null
              return q
                .from({ persons: collection })
                .where(({ persons }) => gt(persons.age, 30))
                .select(({ persons }) => ({
                  id: persons.id,
                  name: persons.name,
                  age: persons.age,
                }))
            },
            [enabled]
          )
        },
        { initialProps: { enabled: false } }
      )

      // When callback returns null, should return the specified state
      expect(result.current.state).toBeUndefined()
      expect(result.current.data).toBeUndefined()
      expect(result.current.collection).toBeUndefined()
      expect(result.current.status).toBe(`disabled`)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isReady).toBe(false)
      expect(result.current.isIdle).toBe(false)
      expect(result.current.isError).toBe(false)
      expect(result.current.isCleanedUp).toBe(false)

      // Enable the query
      act(() => {
        rerender({ enabled: true })
      })

      // Wait for collection to sync and state to update
      await waitFor(() => {
        expect(result.current.state?.size).toBe(1) // Only John Smith (age 35)
      })
      expect(result.current.data).toHaveLength(1)
      expect(result.current.collection).toBeDefined()
      expect(result.current.status).toBeDefined()
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isReady).toBe(true)
      expect(result.current.isIdle).toBe(false)
    })

    it(`should handle callback returning LiveQueryCollectionConfig`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `config-callback-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result, rerender } = renderHook(
        ({ useConfig }: { useConfig: boolean }) => {
          return useLiveQuery(
            (q) => {
              if (useConfig) {
                return {
                  query: q
                    .from({ persons: collection })
                    .where(({ persons }) => gt(persons.age, 30))
                    .select(({ persons }) => ({
                      id: persons.id,
                      name: persons.name,
                      age: persons.age,
                    })),
                  startSync: true,
                  gcTime: 0,
                }
              }
              return q
                .from({ persons: collection })
                .where(({ persons }) => lte(persons.age, 30))
                .select(({ persons }) => ({
                  id: persons.id,
                  name: persons.name,
                  age: persons.age,
                }))
                .orderBy(({ persons }) => persons.age)
            },
            [useConfig]
          )
        },
        { initialProps: { useConfig: false } }
      )

      // Wait for collection to sync and state to update
      await waitFor(() => {
        expect(result.current.state?.size).toBe(2) // John Smith (age 35) and Jane Doe (age 25)
      })
      expect(result.current.data).toHaveLength(2)
      expect(result.current.collection).toBeDefined()
      expect(result.current.status).toBeDefined()

      expect(result.current.data).toMatchObject([
        {
          id: `2`,
          name: `Jane Doe`,
          age: 25,
        },
        {
          id: `1`,
          name: `John Doe`,
          age: 30,
        },
      ])

      // Switch to using config
      act(() => {
        rerender({ useConfig: true })
      })

      // Should still work with config
      await waitFor(() => {
        expect(result.current.state?.size).toBe(1)
      })
      expect(result.current.data).toHaveLength(1)
      expect(result.current.collection).toBeDefined()
      expect(result.current.status).toBeDefined()

      expect(result.current.data).toMatchObject([
        {
          id: `3`,
          name: `John Smith`,
          age: 35,
        },
      ])
    })

    it(`should handle callback returning Collection`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `collection-callback-test`,
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

      const { result, rerender } = renderHook(
        ({ useCollection }: { useCollection: boolean }) => {
          return useLiveQuery(
            (q) => {
              if (useCollection) {
                return liveQueryCollection
              }
              return q
                .from({ persons: collection })
                .where(({ persons }) => lte(persons.age, 30))
                .select(({ persons }) => ({
                  id: persons.id,
                  name: persons.name,
                  age: persons.age,
                }))
            },
            [useCollection]
          )
        },
        { initialProps: { useCollection: false } }
      )

      // Wait for collection to sync and state to update
      await waitFor(() => {
        expect(result.current.state?.size).toBe(2) // Only John Smith (age 35)
      })
      expect(result.current.data).toHaveLength(2)
      expect(result.current.collection).toBeDefined()
      expect(result.current.status).toBeDefined()

      expect(result.current.data).toMatchObject([
        {
          id: `2`,
          name: `Jane Doe`,
          age: 25,
        },
        {
          id: `1`,
          name: `John Doe`,
          age: 30,
        },
      ])

      // Switch to using pre-created collection
      act(() => {
        rerender({ useCollection: true })
      })

      // Should still work with pre-created collection
      await waitFor(() => {
        expect(result.current.state?.size).toBe(1) // Only John Smith (age 35)
      })
      expect(result.current.data).toHaveLength(1)
      expect(result.current.collection).toBeDefined()
      expect(result.current.status).toBeDefined()
      expect(result.current.collection).toBe(liveQueryCollection)

      expect(result.current.data).toMatchObject([
        {
          id: `3`,
          name: `John Smith`,
          age: 35,
        },
      ])
    })

    it(`should handle conditional returns with dependencies`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `conditional-deps-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result, rerender } = renderHook(
        ({ minAge, enabled }: { minAge: number; enabled: boolean }) => {
          return useLiveQuery(
            (q) => {
              if (!enabled) return undefined
              return q
                .from({ persons: collection })
                .where(({ persons }) => gt(persons.age, minAge))
                .select(({ persons }) => ({
                  id: persons.id,
                  name: persons.name,
                  age: persons.age,
                }))
            },
            [minAge, enabled]
          )
        },
        { initialProps: { minAge: 30, enabled: false } }
      )

      // Initially disabled
      expect(result.current.state).toBeUndefined()
      expect(result.current.data).toBeUndefined()
      expect(result.current.status).toBe(`disabled`)
      expect(result.current.isEnabled).toBe(false)

      // Enable with minAge 30
      act(() => {
        rerender({ minAge: 30, enabled: true })
      })

      await waitFor(() => {
        expect(result.current.state?.size).toBe(1) // Only John Smith (age 35)
      })
      expect(result.current.data).toHaveLength(1)
      expect(result.current.isIdle).toBe(false)

      // Change minAge to 25 (should include more people)
      act(() => {
        rerender({ minAge: 25, enabled: true })
      })

      await waitFor(() => {
        expect(result.current.state?.size).toBe(2) // People with age > 25 (ages 30, 35)
      })
      expect(result.current.data).toHaveLength(2)

      // Disable again
      act(() => {
        rerender({ minAge: 25, enabled: false })
      })

      expect(result.current.state).toBeUndefined()
      expect(result.current.data).toBeUndefined()
      expect(result.current.status).toBe(`disabled`)
      expect(result.current.isEnabled).toBe(false)
    })
  })

  describe(`count query re-render optimization`, () => {
    it(`should not re-render when count result hasn't changed`, async () => {
      // Track render count
      let renderCount = 0
      // Track change events emitted by the live query collection
      const changeEvents: Array<{ type: string; value: any }> = []

      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `count-rerender-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result } = renderHook(() => {
        renderCount++
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              activeCount: count(persons.id),
            }))
        )
      })

      // Wait for initial sync
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })

      // Subscribe to track change events from the live query collection
      const subscription = result.current.collection.subscribeChanges(
        (changes: Array<any>) => {
          changes.forEach((change) => {
            changeEvents.push({ type: change.type, value: change.value })
          })
        }
      )

      const initialRenderCount = renderCount
      const initialCount = result.current.data[0]?.activeCount

      // Verify initial count is correct (only John Smith age 35 matches)
      expect(initialCount).toBe(1)

      // Clear any initial change events
      changeEvents.length = 0

      // Update a person's email (a field NOT used in the query output)
      // This should NOT trigger a re-render since the count doesn't change
      act(() => {
        collection.utils.begin()
        collection.utils.write({
          type: `update`,
          value: {
            id: `3`, // John Smith - the one matching the filter
            name: `John Smith`,
            age: 35,
            email: `john.smith.updated@example.com`, // Changed email
            isActive: true,
            team: `team1`,
          },
        })
        collection.utils.commit()
      })

      // Wait a bit for any potential re-renders
      await new Promise((resolve) => setTimeout(resolve, 50))

      // The count should still be the same
      expect(result.current.data[0]?.activeCount).toBe(1)

      // CRITICAL: No change events should be emitted since the count didn't change
      expect(changeEvents.length).toBe(0)

      // CRITICAL: Render count should NOT have increased since the count didn't change
      expect(renderCount).toBe(initialRenderCount)

      subscription.unsubscribe()
    })

    it(`should not re-render when updating a field not in the count query result`, async () => {
      // Track renders with their data values
      const renderSnapshots: Array<{ count: number; timestamp: number }> = []

      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `count-field-update-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result } = renderHook(() => {
        const queryResult = useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => eq(persons.isActive, true))
            .select(({ persons }) => ({
              totalActive: count(persons.id),
            }))
        )

        // Track each render
        useEffect(() => {
          if (queryResult.data[0]) {
            renderSnapshots.push({
              count: queryResult.data[0].totalActive,
              timestamp: Date.now(),
            })
          }
        }, [queryResult.data])

        return queryResult
      })

      // Wait for initial sync
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })

      // All 3 initial persons are active, so count should be 3
      expect(result.current.data[0]?.totalActive).toBe(3)

      // Clear snapshots after initial load
      renderSnapshots.length = 0

      // Update the name of a person (doesn't affect count)
      act(() => {
        collection.utils.begin()
        collection.utils.write({
          type: `update`,
          value: {
            id: `1`,
            name: `John Doe Updated`, // Changed name
            age: 30,
            email: `john.doe@example.com`,
            isActive: true, // Still active - count shouldn't change
            team: `team1`,
          },
        })
        collection.utils.commit()
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Count should still be 3
      expect(result.current.data[0]?.totalActive).toBe(3)

      // Should NOT have any new renders since count didn't change
      expect(renderSnapshots.length).toBe(0)
    })

    it(`should not re-render count query when sync updates unrelated fields`, async () => {
      // This test simulates the bug where sync operations trigger re-renders
      // even when the count result hasn't changed
      let renderCount = 0
      const changeEvents: Array<{ type: string; value: any }> = []

      // Use mockSyncCollectionOptionsNoInitialState to have full control over sync
      const config = mockSyncCollectionOptionsNoInitialState<Person>({
        id: `count-sync-test`,
        getKey: (person: Person) => person.id,
      })
      const collection = createCollection(config)

      const { result } = renderHook(() => {
        renderCount++
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              activeCount: count(persons.id),
            }))
        )
      })

      // Start sync and write initial data
      act(() => {
        collection.preload()
      })

      act(() => {
        config.utils.begin()
        config.utils.write({
          type: `insert`,
          value: {
            id: `1`,
            name: `Young Person`,
            age: 25,
            email: `young@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `2`,
            name: `Old Person`,
            age: 40, // Matches filter age > 30
            email: `old@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        config.utils.commit()
        config.utils.markReady()
      })

      // Wait for initial sync
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })

      // Count should be 1 (only Old Person matches)
      expect(result.current.data[0]?.activeCount).toBe(1)

      // Subscribe to track change events
      const subscription = result.current.collection.subscribeChanges(
        (changes: Array<any>) => {
          changes.forEach((change) => {
            changeEvents.push({ type: change.type, value: change.value })
          })
        }
      )

      const initialRenderCount = renderCount
      changeEvents.length = 0

      // Simulate a sync update - the old person's email changes
      // This is what happens when sync refetches and the row has changed
      // but the count-relevant fields haven't
      act(() => {
        config.utils.begin()
        config.utils.write({
          type: `update`,
          value: {
            id: `2`,
            name: `Old Person`,
            age: 40, // Still matches filter
            email: `old.updated@example.com`, // Email changed - simulates lastUpdated changing
            isActive: true,
            team: `team1`,
          },
        })
        config.utils.commit()
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Count should still be 1
      expect(result.current.data[0]?.activeCount).toBe(1)

      // CRITICAL: No change events should be emitted since count didn't change
      expect(changeEvents.length).toBe(0)

      // CRITICAL: Render count should NOT have increased
      expect(renderCount).toBe(initialRenderCount)

      subscription.unsubscribe()
    })

    it(`should re-render only when count actually changes`, async () => {
      let renderCount = 0

      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `count-change-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { result } = renderHook(() => {
        renderCount++
        return useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              count: count(persons.id),
            }))
        )
      })

      // Wait for initial sync
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })

      const renderCountAfterInitial = renderCount
      expect(result.current.data[0]?.count).toBe(1) // Only John Smith (age 35)

      // Update email (should NOT cause re-render - count unchanged)
      act(() => {
        collection.utils.begin()
        collection.utils.write({
          type: `update`,
          value: {
            id: `3`,
            name: `John Smith`,
            age: 35,
            email: `new.email@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        collection.utils.commit()
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Count still 1, render count should be unchanged
      expect(result.current.data[0]?.count).toBe(1)
      expect(renderCount).toBe(renderCountAfterInitial)

      // NOW add a new person who matches the filter (should cause re-render)
      const renderCountBeforeInsert = renderCount
      act(() => {
        collection.utils.begin()
        collection.utils.write({
          type: `insert`,
          value: {
            id: `4`,
            name: `New Person`,
            age: 40, // Matches age > 30
            email: `new@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        collection.utils.commit()
      })

      await waitFor(() => {
        expect(result.current.data[0]?.count).toBe(2)
      })

      // This SHOULD have caused a re-render since count changed
      expect(renderCount).toBeGreaterThan(renderCountBeforeInsert)
    })

    it(`should not re-render count when optimistic update changes unrelated field`, async () => {
      // This test simulates:
      // 1. User has a count query
      // 2. An optimistic action updates a row's "updatedAt" field
      // 3. Count stays the same - should not trigger re-render
      let renderCount = 0
      const changeEvents: Array<{ type: string; value: any }> = []

      type Session = {
        id: string
        name: string
        status: string
        lastUpdated: number
      }

      const config = mockSyncCollectionOptionsNoInitialState<Session>({
        id: `count-optimistic-test`,
        getKey: (session) => session.id,
      })
      const sessionCollection = createCollection(config)

      const { result } = renderHook(() => {
        renderCount++
        return useLiveQuery((q) =>
          q
            .from({ sessions: sessionCollection })
            .where(({ sessions }) => eq(sessions.status, `active`))
            .select(({ sessions }) => ({
              activeCount: count(sessions.id),
            }))
        )
      })

      // Initialize with some sessions
      act(() => {
        sessionCollection.preload()
      })

      act(() => {
        config.utils.begin()
        config.utils.write({
          type: `insert`,
          value: {
            id: `session-1`,
            name: `Session 1`,
            status: `active`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `session-2`,
            name: `Session 2`,
            status: `active`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `session-3`,
            name: `Session 3`,
            status: `draft`, // Not active - shouldn't be counted
            lastUpdated: 1000,
          },
        })
        config.utils.commit()
        config.utils.markReady()
      })

      // Wait for initial sync
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })

      // Count should be 2 (two active sessions)
      expect(result.current.data[0]?.activeCount).toBe(2)

      // Subscribe to track change events
      const subscription = result.current.collection.subscribeChanges(
        (changes: Array<any>) => {
          changes.forEach((change) => {
            changeEvents.push({ type: change.type, value: change.value })
          })
        }
      )

      const initialRenderCount = renderCount
      changeEvents.length = 0

      // Simulate an optimistic update that only changes lastUpdated
      // This is the scenario where user launches a session and it updates the lastUpdated field
      act(() => {
        sessionCollection.update(`session-1`, (draft) => {
          draft.lastUpdated = 2000 // Only this field changed
        })
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Count should still be 2
      expect(result.current.data[0]?.activeCount).toBe(2)

      // CRITICAL: No change events should be emitted for the count query
      // since the count didn't change
      expect(changeEvents.length).toBe(0)

      // CRITICAL: Render count should NOT have increased
      expect(renderCount).toBe(initialRenderCount)

      subscription.unsubscribe()
    })

    it(`should not re-render count when sync refetches same data with updated timestamp`, async () => {
      // This test simulates the user's exact scenario:
      // 1. They have a count query for active sessions
      // 2. Sync refetches every 2 seconds
      // 3. The data is the same except for updatedAt
      // 4. Count should NOT cause re-render
      let renderCount = 0
      const changeEvents: Array<{ type: string; value: any }> = []

      type Session = {
        id: string
        name: string
        status: string
        lastUpdated: number
      }

      const config = mockSyncCollectionOptionsNoInitialState<Session>({
        id: `count-refetch-test`,
        getKey: (session) => session.id,
      })
      const sessionCollection = createCollection(config)

      const { result } = renderHook(() => {
        renderCount++
        return useLiveQuery((q) =>
          q
            .from({ sessions: sessionCollection })
            .where(({ sessions }) => eq(sessions.status, `active`))
            .select(({ sessions }) => ({
              activeCount: count(sessions.id),
            }))
        )
      })

      // Initialize with some sessions (first sync)
      act(() => {
        sessionCollection.preload()
      })

      act(() => {
        config.utils.begin()
        config.utils.write({
          type: `insert`,
          value: {
            id: `session-1`,
            name: `Session 1`,
            status: `active`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `session-2`,
            name: `Session 2`,
            status: `active`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `session-3`,
            name: `Session 3`,
            status: `draft`, // Not active
            lastUpdated: 1000,
          },
        })
        config.utils.commit()
        config.utils.markReady()
      })

      // Wait for initial sync
      await waitFor(() => {
        expect(result.current.state.size).toBe(1)
      })

      expect(result.current.data[0]?.activeCount).toBe(2)

      // Subscribe to track change events
      const subscription = result.current.collection.subscribeChanges(
        (changes: Array<any>) => {
          changes.forEach((change) => {
            changeEvents.push({ type: change.type, value: change.value })
          })
        }
      )

      const initialRenderCount = renderCount
      changeEvents.length = 0

      // Simulate a sync refetch - same data but with updated timestamps
      // This is what happens when polling refetches the same data
      act(() => {
        config.utils.begin()
        // Sync sends ALL data again (like a full refetch/poll)
        config.utils.write({
          type: `update`,
          value: {
            id: `session-1`,
            name: `Session 1`,
            status: `active`,
            lastUpdated: 2000, // Timestamp updated
          },
        })
        config.utils.write({
          type: `update`,
          value: {
            id: `session-2`,
            name: `Session 2`,
            status: `active`,
            lastUpdated: 2000, // Timestamp updated
          },
        })
        config.utils.write({
          type: `update`,
          value: {
            id: `session-3`,
            name: `Session 3`,
            status: `draft`,
            lastUpdated: 2000, // Timestamp updated
          },
        })
        config.utils.commit()
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Count should still be 2
      expect(result.current.data[0]?.activeCount).toBe(2)

      // CRITICAL: No change events should be emitted since count didn't change
      expect(changeEvents.length).toBe(0)

      // CRITICAL: Render count should NOT have increased
      expect(renderCount).toBe(initialRenderCount)

      subscription.unsubscribe()
    })

    it(`should not re-render count queries when three queries exist and unrelated data changes`, async () => {
      // This test simulates the user's exact scenario:
      // - Three count queries (activeCount, draftCount, archivedCount)
      // - When a session is touched (lastUpdated changes), none should re-render
      let activeCountRenderCount = 0
      let draftCountRenderCount = 0
      let archivedCountRenderCount = 0
      const activeCountChangeEvents: Array<any> = []
      const draftCountChangeEvents: Array<any> = []
      const archivedCountChangeEvents: Array<any> = []

      type Session = {
        id: string
        name: string
        status: `active` | `draft` | `archived`
        lastUpdated: number
      }

      const config = mockSyncCollectionOptionsNoInitialState<Session>({
        id: `three-count-test`,
        getKey: (session) => session.id,
      })
      const sessionCollection = createCollection(config)

      // Render three count queries simultaneously (like user's scenario)
      const { result: activeResult } = renderHook(() => {
        activeCountRenderCount++
        return useLiveQuery((q) =>
          q
            .from({ sessions: sessionCollection })
            .where(({ sessions }) => eq(sessions.status, `active`))
            .select(({ sessions }) => ({
              activeCount: count(sessions.id),
            }))
        )
      })

      const { result: draftResult } = renderHook(() => {
        draftCountRenderCount++
        return useLiveQuery((q) =>
          q
            .from({ sessions: sessionCollection })
            .where(({ sessions }) => eq(sessions.status, `draft`))
            .select(({ sessions }) => ({
              draftCount: count(sessions.id),
            }))
        )
      })

      const { result: archivedResult } = renderHook(() => {
        archivedCountRenderCount++
        return useLiveQuery((q) =>
          q
            .from({ sessions: sessionCollection })
            .where(({ sessions }) => eq(sessions.status, `archived`))
            .select(({ sessions }) => ({
              archivedCount: count(sessions.id),
            }))
        )
      })

      // Initialize with some sessions
      act(() => {
        sessionCollection.preload()
      })

      act(() => {
        config.utils.begin()
        config.utils.write({
          type: `insert`,
          value: {
            id: `1`,
            name: `Session 1`,
            status: `active`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `2`,
            name: `Session 2`,
            status: `active`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `3`,
            name: `Session 3`,
            status: `draft`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `4`,
            name: `Session 4`,
            status: `archived`,
            lastUpdated: 1000,
          },
        })
        config.utils.write({
          type: `insert`,
          value: {
            id: `5`,
            name: `Session 5`,
            status: `archived`,
            lastUpdated: 1000,
          },
        })
        config.utils.commit()
        config.utils.markReady()
      })

      // Wait for initial sync
      await waitFor(() => {
        expect(activeResult.current.state.size).toBe(1)
        expect(draftResult.current.state.size).toBe(1)
        expect(archivedResult.current.state.size).toBe(1)
      })

      expect(activeResult.current.data[0]?.activeCount).toBe(2)
      expect(draftResult.current.data[0]?.draftCount).toBe(1)
      expect(archivedResult.current.data[0]?.archivedCount).toBe(2)

      // Subscribe to track change events
      const activeSubscription =
        activeResult.current.collection.subscribeChanges(
          (changes: Array<any>) => {
            changes.forEach((change) => activeCountChangeEvents.push(change))
          }
        )
      const draftSubscription = draftResult.current.collection.subscribeChanges(
        (changes: Array<any>) => {
          changes.forEach((change) => draftCountChangeEvents.push(change))
        }
      )
      const archivedSubscription =
        archivedResult.current.collection.subscribeChanges(
          (changes: Array<any>) => {
            changes.forEach((change) => archivedCountChangeEvents.push(change))
          }
        )

      const initialActiveRenderCount = activeCountRenderCount
      const initialDraftRenderCount = draftCountRenderCount
      const initialArchivedRenderCount = archivedCountRenderCount
      activeCountChangeEvents.length = 0
      draftCountChangeEvents.length = 0
      archivedCountChangeEvents.length = 0

      // Simulate an action that updates lastUpdated on an active session
      // This is the scenario the user described - launching a session updates its lastUpdated
      act(() => {
        config.utils.begin()
        config.utils.write({
          type: `update`,
          value: {
            id: `1`,
            name: `Session 1`,
            status: `active`, // Still active
            lastUpdated: 2000, // Timestamp updated
          },
        })
        config.utils.commit()
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Counts should still be the same
      expect(activeResult.current.data[0]?.activeCount).toBe(2)
      expect(draftResult.current.data[0]?.draftCount).toBe(1)
      expect(archivedResult.current.data[0]?.archivedCount).toBe(2)

      // CRITICAL: No query should have re-rendered since counts didn't change
      expect(activeCountChangeEvents.length).toBe(0)
      expect(draftCountChangeEvents.length).toBe(0)
      expect(archivedCountChangeEvents.length).toBe(0)
      expect(activeCountRenderCount).toBe(initialActiveRenderCount)
      expect(draftCountRenderCount).toBe(initialDraftRenderCount)
      expect(archivedCountRenderCount).toBe(initialArchivedRenderCount)

      activeSubscription.unsubscribe()
      draftSubscription.unsubscribe()
      archivedSubscription.unsubscribe()
    })
  })
})
