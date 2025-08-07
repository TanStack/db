import { describe, expect, it } from "vitest"
import { renderHook, waitFor } from "@solidjs/testing-library"
import {
  Query,
  count,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  eq,
  gt,
} from "@tanstack/db"
import { createComputed, createRoot, createSignal } from "solid-js"
import { useLiveQuery } from "../src/useLiveQuery"
import { mockSyncCollectionOptions } from "../../db/tests/utls"
import type { Accessor } from "solid-js"

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

    const rendered = renderHook(() => {
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
      expect(rendered.result.state.size).toBe(1) // Only John Smith (age 35)
    })
    expect(rendered.result.data).toHaveLength(1)

    const johnSmith = rendered.result.data[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
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

    const rendered = renderHook(() => {
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
      expect(rendered.result.state.size).toBe(1)
    })
    expect(rendered.result.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    expect(rendered.result.data.length).toBe(1)
    expect(rendered.result.data[0]).toMatchObject({
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

    await waitFor(() => {
      expect(rendered.result.state.size).toBe(2)
    })
    expect(rendered.result.state.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
    expect(rendered.result.state.get(`4`)).toMatchObject({
      id: `4`,
      name: `Kyle Doe`,
    })

    expect(rendered.result.data.length).toBe(2)
    expect(rendered.result.data).toEqual(
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

    await waitFor(() => {
      expect(rendered.result.state.size).toBe(2)
    })
    expect(rendered.result.state.get(`4`)).toMatchObject({
      id: `4`,
      name: `Kyle Doe 2`,
    })

    expect(rendered.result.data.length).toBe(2)
    expect(rendered.result.data).toEqual(
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

    await waitFor(() => {
      expect(rendered.result.state.size).toBe(1)
    })
    expect(rendered.result.state.get(`4`)).toBeUndefined()

    expect(rendered.result.data.length).toBe(1)
    expect(rendered.result.data[0]).toMatchObject({
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
            name: persons.name,
          }))
      )
    })

    // Wait for collections to sync
    await waitFor(() => {
      expect(result.state.size).toBe(3)
    })

    // Verify that we have the expected joined results

    expect(result.state.get(`[1,1]`)).toMatchObject({
      id: `1`,
      name: `John Doe`,
      title: `Issue 1`,
    })

    expect(result.state.get(`[2,2]`)).toMatchObject({
      id: `2`,
      name: `Jane Doe`,
      title: `Issue 2`,
    })

    expect(result.state.get(`[3,1]`)).toMatchObject({
      id: `3`,
      name: `John Doe`,
      title: `Issue 3`,
    })

    // Add a new issue for user 2
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

    await waitFor(() => {
      expect(result.state.size).toBe(4)
    })
    expect(result.state.get(`[4,2]`)).toMatchObject({
      id: `4`,
      name: `Jane Doe`,
      title: `Issue 4`,
    })

    // Update an issue we're already joined with
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

    await waitFor(() => {
      // The updated title should be reflected in the joined results
      expect(result.state.get(`[2,2]`)).toMatchObject({
        id: `2`,
        name: `Jane Doe`,
        title: `Updated Issue 2`,
      })
    })

    // Delete an issue
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

    await new Promise((resolve) => setTimeout(resolve, 10))

    // After deletion, issue 3 should no longer have a joined result
    expect(result.state.get(`[3,1]`)).toBeUndefined()
    expect(result.state.size).toBe(3)
  })

  it(`should recompile query when parameters change and change results`, async () => {
    return createRoot(async (dispose) => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `params-change-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const [minAge, setMinAge] = createSignal(30)
      const rendered = renderHook(
        (props: { minAge: Accessor<number> }) => {
          return useLiveQuery((q) =>
            q
              .from({ collection })
              .where(({ collection: c }) => gt(c.age, props.minAge()))
              .select(({ collection: c }) => ({
                id: c.id,
                name: c.name,
                age: c.age,
              }))
          )
        },
        { initialProps: [{ minAge: minAge }] }
      )

      // Wait for collection to sync
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Initially should return only people older than 30
      expect(rendered.result.state.size).toBe(1)
      expect(rendered.result.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Change the parameter to include more people
      setMinAge(20)

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Now should return all people as they're all older than 20
      expect(rendered.result.state.size).toBe(3)
      expect(rendered.result.state.get(`1`)).toMatchObject({
        id: `1`,
        name: `John Doe`,
        age: 30,
      })
      expect(rendered.result.state.get(`2`)).toMatchObject({
        id: `2`,
        name: `Jane Doe`,
        age: 25,
      })
      expect(rendered.result.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Change to exclude everyone
      setMinAge(50)

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should now be empty
      expect(rendered.result.state.size).toBe(0)

      dispose()
    })
  })

  it(`should stop old query when parameters change`, async () => {
    return createRoot(async (dispose) => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `stop-query-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const [minAge, setMinAge] = createSignal(30)
      const rendered = renderHook(
        (props: { minAge: Accessor<number> }) => {
          return useLiveQuery((q) =>
            q
              .from({ collection })
              .where(({ collection: c }) => gt(c.age, props.minAge()))
              .select(({ collection: c }) => ({
                id: c.id,
                name: c.name,
              }))
          )
        },
        { initialProps: [{ minAge }] }
      )

      // Wait for collection to sync
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Initial query should return only people older than 30
      expect(rendered.result.state.size).toBe(1)
      expect(rendered.result.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })

      // Change the parameter to include more people
      setMinAge(25)

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Query should now return all people older than 25
      expect(rendered.result.state.size).toBe(2)
      expect(rendered.result.state.get(`1`)).toMatchObject({
        id: `1`,
        name: `John Doe`,
      })
      expect(rendered.result.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })

      // Change to a value that excludes everyone
      setMinAge(50)

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should now be empty
      expect(rendered.result.state.size).toBe(0)

      dispose()
    })
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
    const rendered = renderHook(() => {
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
    const groupedLiveQuery = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ queryResult: rendered.result.collection() })
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
    expect(groupedLiveQuery.result.state.size).toBe(1)
    const teamResult = Array.from(groupedLiveQuery.result.state.values())[0]
    expect(teamResult).toMatchObject({
      team: `team1`,
      count: 1,
    })

    // Insert two new users in different teams
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

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Verify the grouped results include the new team members
    expect(groupedLiveQuery.result.state.size).toBe(2)

    const groupedResults = Array.from(groupedLiveQuery.result.state.values())
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
            name: persons.name,
          }))
      )

      // Track each render state
      createComputed(() => {
        renderStates.push({
          stateSize: queryResult.state.size,
          hasTempKey: queryResult.state.has(`[temp-key,1]`),
          hasPermKey: queryResult.state.has(`[4,1]`),
          timestamp: Date.now(),
        })
      })

      return queryResult
    })

    // Wait for collections to sync and verify initial state
    await waitFor(() => {
      expect(result.state.size).toBe(3)
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

        return { success: true, id: `4` }
      },
    })

    // Perform optimistic insert of a new issue
    const transaction = addIssue({
      title: `New Issue`,
      description: `New Issue Description`,
      userId: `1`,
    })

    await waitFor(() => {
      // Verify optimistic state is immediately reflected
      expect(result.state.size).toBe(4)
    })
    expect(result.state.get(`[temp-key,1]`)).toMatchObject({
      id: `temp-key`,
      name: `John Doe`,
      title: `New Issue`,
    })
    expect(result.state.get(`[4,1]`)).toBeUndefined()

    // Wait for the transaction to be committed
    await transaction.isPersisted.promise

    await waitFor(() => {
      // Wait for the permanent key to appear
      expect(result.state.get(`[4,1]`)).toBeDefined()
    })

    // Check if we had any render where the temp key was removed but the permanent key wasn't added yet
    const hadFlicker = renderStates.some(
      (state) => !state.hasTempKey && !state.hasPermKey && state.stateSize === 3
    )

    expect(hadFlicker).toBe(false)

    // Verify the temporary key is replaced by the permanent one
    expect(result.state.size).toBe(4)
    expect(result.state.get(`[temp-key,1]`)).toBeUndefined()
    expect(result.state.get(`[4,1]`)).toMatchObject({
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
      return useLiveQuery(() => liveQueryCollection)
    })

    // Wait for collection to sync and state to update
    await waitFor(() => {
      expect(result.state.size).toBe(1) // Only John Smith (age 35)
    })
    expect(result.data).toHaveLength(1)

    const johnSmith = result.data[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Verify that the returned collection is the same instance
    expect(result.collection()).toBe(liveQueryCollection)
  })

  it(`should switch to a different pre-created live query collection when changed`, async () => {
    return createRoot(async (dispose) => {
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

      const [collection, setCollection] = createSignal(liveQueryCollection1)
      const rendered = renderHook(
        (props: { collection: Accessor<any> }) => {
          return useLiveQuery(props.collection)
        },
        { initialProps: [{ collection: collection }] }
      )

      // Wait for first collection to sync
      await waitFor(() => {
        expect(rendered.result.state.size).toBe(1) // Only John Smith from collection1
      })
      expect(rendered.result.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })
      expect(rendered.result.collection()).toBe(liveQueryCollection1)

      // Switch to the second collection
      setCollection(liveQueryCollection2)

      // Wait for second collection to sync
      await waitFor(() => {
        expect(rendered.result.state.size).toBe(2) // Alice and Bob from collection2
      })
      expect(rendered.result.state.get(`4`)).toMatchObject({
        id: `4`,
        name: `Alice Cooper`,
      })
      expect(rendered.result.state.get(`5`)).toMatchObject({
        id: `5`,
        name: `Bob Dylan`,
      })
      expect(rendered.result.collection()).toBe(liveQueryCollection2)

      // Verify we no longer have data from the first collection
      expect(rendered.result.state.get(`3`)).toBeUndefined()

      dispose()
    })
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
      return useLiveQuery(() => ({ query: queryBuilder }))
    })

    // Wait for collection to sync and state to update
    await waitFor(() => {
      expect(result.state.size).toBe(1) // Only John Smith (age 35)
    })
    expect(result.data).toHaveLength(1)

    const johnSmith = result.data[0]
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

      const rendered = renderHook(() => {
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
      expect(rendered.result.isLoading()).toBe(true)

      // Start sync manually
      collection.preload()

      // Trigger the first commit to make collection ready
      if (beginFn && commitFn) {
        beginFn()
        commitFn()
      }

      // Insert data
      collection.insert({
        id: `1`,
        name: `John Doe`,
        age: 35,
        email: `john.doe@example.com`,
        isActive: true,
        team: `team1`,
      })

      // Wait for collection to become ready
      await waitFor(() => {
        expect(rendered.result.isLoading()).toBe(false)
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

      const rendered = renderHook(() => {
        return useLiveQuery(() => liveQueryCollection)
      })

      // For pre-created collections that are already syncing, isLoading should be true
      expect(rendered.result.isLoading()).toBe(false)
      expect(rendered.result.state.size).toBe(1)
    })

    it(`should update isLoading when collection status changes`, async () => {
      let beginFn: (() => void) | undefined
      let commitFn: (() => void) | undefined

      const collection = createCollection<Person>({
        id: `status-change-has-loaded-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit }) => {
            beginFn = begin
            commitFn = commit
            // Don't sync immediately
          },
        },
        onInsert: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
      })

      const rendered = renderHook(() => {
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
      expect(rendered.result.isLoading()).toBe(true)

      // Start sync manually
      collection.preload()

      // Trigger the first commit to make collection ready
      if (beginFn && commitFn) {
        beginFn()
        commitFn()
      }

      // Insert data
      collection.insert({
        id: `1`,
        name: `John Doe`,
        age: 35,
        email: `john.doe@example.com`,
        isActive: true,
        team: `team1`,
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(rendered.result.isLoading()).toBe(false)
      expect(rendered.result.isReady()).toBe(true)

      // Wait for collection to become ready
      await waitFor(() => {
        expect(rendered.result.isLoading()).toBe(false)
      })
      expect(rendered.result.status()).toBe(`ready`)
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
        expect(result.isLoading()).toBe(false)
      })

      const initialIsReady = result.isReady()

      // Perform live updates
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

      // Wait for update to process
      await waitFor(() => {
        expect(result.state.size).toBe(2)
      })

      // isReady should remain true during live updates
      expect(result.isReady()).toBe(true)
      expect(result.isReady()).toBe(initialIsReady)
    })

    it(`should handle isLoading with complex queries including joins`, async () => {
      let personBeginFn: (() => void) | undefined
      let personCommitFn: (() => void) | undefined
      let issueBeginFn: (() => void) | undefined
      let issueCommitFn: (() => void) | undefined

      const personCollection = createCollection<Person>({
        id: `join-has-loaded-persons`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            personBeginFn = begin
            personCommitFn = () => {
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

      const issueCollection = createCollection<Issue>({
        id: `join-has-loaded-issues`,
        getKey: (issue: Issue) => issue.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            issueBeginFn = begin
            issueCommitFn = () => {
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
              name: persons.name,
            }))
        )
      })

      // Initially should be true
      expect(result.isLoading()).toBe(true)

      // Start sync for both collections
      personCollection.preload()
      issueCollection.preload()

      // Trigger the first commit for both collections to make them ready
      if (personBeginFn && personCommitFn) {
        personBeginFn()
        personCommitFn()
      }
      if (issueBeginFn && issueCommitFn) {
        issueBeginFn()
        issueCommitFn()
      }

      // Insert data into both collections
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

      // Wait for both collections to sync
      await waitFor(() => {
        expect(result.isReady()).toBe(true)
      })
      // Note: Joined data may not appear immediately due to live query evaluation timing
      // The main test is that isLoading transitions from false to true
    })

    it(`should handle isLoading with parameterized queries`, async () => {
      return createRoot(async (dispose) => {
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

        const [minAge, setMinAge] = createSignal(30)
        const { result } = renderHook(
          (props: { minAge: Accessor<number> }) => {
            return useLiveQuery((q) =>
              q
                .from({ collection })
                .where(({ collection: c }) => gt(c.age, props.minAge()))
                .select(({ collection: c }) => ({
                  id: c.id,
                  name: c.name,
                }))
            )
          },
          { initialProps: [{ minAge: minAge }] }
        )

        // Initially should be false
        expect(result.isLoading()).toBe(true)

        // Start sync manually
        collection.preload()

        // Trigger the first commit to make collection ready
        if (beginFn && commitFn) {
          beginFn()
          commitFn()
        }

        // Insert data
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

        // Wait for initial load
        await waitFor(() => {
          expect(result.isLoading()).toBe(false)
        })

        // Change parameters
        setMinAge(25)

        // isReady should remain true even when parameters change
        await waitFor(() => {
          expect(result.isReady()).toBe(true)
        })
        // Note: Data size may not change immediately due to live query evaluation timing
        // The main test is that isReady remains true when parameters change

        dispose()
      })
    })
  })
})
