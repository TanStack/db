import { describe, expect, it } from "vitest"
import {
  count,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  eq,
  gt,
} from "@tanstack/db"
import { nextTick, ref, watchEffect } from "vue"
import { useLiveQuery } from "../src/useLiveQuery"
import { mockSyncCollectionOptions } from "../../db/tests/utls"

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

// Helper function to wait for Vue reactivity
async function waitForVueUpdate() {
  await nextTick()
  // Additional small delay to ensure collection updates are processed
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// Helper function to poll for a condition until it passes or times out
async function waitFor(fn: () => void, timeout = 2000, interval = 20) {
  const start = Date.now()

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    try {
      fn()
      return
    } catch (err) {
      if (Date.now() - start > timeout) throw err
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }
}

describe(`Query Collections`, () => {
  it(`should work with basic collection and select`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const { state, data } = useLiveQuery((q) =>
      q
        .from({ persons: collection })
        .where(({ persons }) => gt(persons.age, 30))
        .select(({ persons }) => ({
          id: persons.id,
          name: persons.name,
          age: persons.age,
        }))
    )

    // Wait for Vue reactivity to update
    await waitForVueUpdate()

    expect(state.value.size).toBe(1) // Only John Smith (age 35)
    expect(data.value).toHaveLength(1)

    const johnSmith = data.value[0]
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

    const { state, data } = useLiveQuery((q) =>
      q
        .from({ collection })
        .where(({ collection: c }) => gt(c.age, 30))
        .select(({ collection: c }) => ({
          id: c.id,
          name: c.name,
        }))
        .orderBy(({ collection: c }) => c.id, `asc`)
    )

    // Wait for collection to sync
    await waitForVueUpdate()

    expect(state.value.size).toBe(1)
    expect(state.value.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })

    expect(data.value.length).toBe(1)
    expect(data.value[0]).toMatchObject({
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

    await waitForVueUpdate()

    expect(state.value.size).toBe(2)
    expect(state.value.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
    expect(state.value.get(`4`)).toMatchObject({
      id: `4`,
      name: `Kyle Doe`,
    })

    expect(data.value.length).toBe(2)
    expect(data.value).toEqual(
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

    await waitForVueUpdate()

    expect(state.value.size).toBe(2)
    expect(state.value.get(`4`)).toMatchObject({
      id: `4`,
      name: `Kyle Doe 2`,
    })

    expect(data.value.length).toBe(2)
    expect(data.value).toEqual(
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

    await waitForVueUpdate()

    expect(state.value.size).toBe(1)
    expect(state.value.get(`4`)).toBeUndefined()

    expect(data.value.length).toBe(1)
    expect(data.value[0]).toMatchObject({
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

    const { state } = useLiveQuery((q) =>
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

    // Wait for collections to sync
    await waitForVueUpdate()

    // Verify that we have the expected joined results
    expect(state.value.size).toBe(3)

    expect(state.value.get(`[1,1]`)).toMatchObject({
      id: `1`,
      name: `John Doe`,
      title: `Issue 1`,
    })

    expect(state.value.get(`[2,2]`)).toMatchObject({
      id: `2`,
      name: `Jane Doe`,
      title: `Issue 2`,
    })

    expect(state.value.get(`[3,1]`)).toMatchObject({
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

    await waitForVueUpdate()

    expect(state.value.size).toBe(4)
    expect(state.value.get(`[4,2]`)).toMatchObject({
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

    await waitForVueUpdate()

    // The updated title should be reflected in the joined results
    expect(state.value.get(`[2,2]`)).toMatchObject({
      id: `2`,
      name: `Jane Doe`,
      title: `Updated Issue 2`,
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

    await waitForVueUpdate()

    // After deletion, issue 3 should no longer have a joined result
    expect(state.value.get(`[3,1]`)).toBeUndefined()
    expect(state.value.size).toBe(3)
  })

  it(`should recompile query when parameters change and change results`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `params-change-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const minAge = ref(30)

    const { state } = useLiveQuery(
      (q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => gt(c.age, minAge.value))
          .select(({ collection: c }) => ({
            id: c.id,
            name: c.name,
            age: c.age,
          })),
      [minAge]
    )

    // Wait for collection to sync
    await waitForVueUpdate()

    // Initially should return only people older than 30
    expect(state.value.size).toBe(1)
    expect(state.value.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change the parameter to include more people
    minAge.value = 20

    await waitForVueUpdate()

    // Now should return all people as they're all older than 20
    expect(state.value.size).toBe(3)
    expect(state.value.get(`1`)).toMatchObject({
      id: `1`,
      name: `John Doe`,
      age: 30,
    })
    expect(state.value.get(`2`)).toMatchObject({
      id: `2`,
      name: `Jane Doe`,
      age: 25,
    })
    expect(state.value.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change to exclude everyone
    minAge.value = 50

    await waitForVueUpdate()

    // Should now be empty
    expect(state.value.size).toBe(0)
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
    const { state: _initialState, collection: initialCollection } =
      useLiveQuery((q) =>
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

    // Wait for collection to sync
    await waitForVueUpdate()

    // Grouped query derived from initial query
    const { state: groupedState } = useLiveQuery((q) =>
      q
        .from({ queryResult: initialCollection.value })
        .groupBy(({ queryResult }) => queryResult.team)
        .select(({ queryResult }) => ({
          team: queryResult.team,
          count: count(queryResult.id),
        }))
    )

    // Wait for grouped query to sync
    await waitForVueUpdate()

    // Verify initial grouped results
    expect(groupedState.value.size).toBe(1)
    const teamResult = Array.from(groupedState.value.values())[0]
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

    await waitForVueUpdate()

    // Verify the grouped results include the new team members
    expect(groupedState.value.size).toBe(2)

    const groupedResults = Array.from(groupedState.value.values())
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

    const { state } = queryResult

    // Track each state change like React does with useEffect
    watchEffect(() => {
      renderStates.push({
        stateSize: state.value.size,
        hasTempKey: state.value.has(`[temp-key,1]`),
        hasPermKey: state.value.has(`[4,1]`),
        timestamp: Date.now(),
      })
    })

    // Wait for collections to sync and verify initial state
    await waitForVueUpdate()

    expect(state.value.size).toBe(3)

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

    // Give Vue one tick to process the optimistic change
    await nextTick()

    // Verify optimistic state is immediately reflected (should be synchronous)
    expect(state.value.size).toBe(4)
    expect(state.value.get(`[temp-key,1]`)).toMatchObject({
      id: `temp-key`,
      name: `John Doe`,
      title: `New Issue`,
    })
    expect(state.value.get(`[4,1]`)).toBeUndefined()

    // Wait for the transaction to be committed
    await transaction.isPersisted.promise

    await waitForVueUpdate()

    // Verify the temporary key is replaced by the permanent one
    expect(state.value.size).toBe(4)
    expect(state.value.get(`[temp-key,1]`)).toBeUndefined()
    expect(state.value.get(`[4,1]`)).toMatchObject({
      id: `4`,
      name: `John Doe`,
      title: `New Issue`,
    })
  })

  it(`should accept pre-created live query collection`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `pre-created-collection-test-vue`,
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
    } = useLiveQuery(liveQueryCollection)

    // Wait for collection to sync and state to update
    await waitForVueUpdate()

    expect(state.value.size).toBe(1) // Only John Smith (age 35)
    expect(data.value).toHaveLength(1)

    const johnSmith = data.value[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Verify that the returned collection is the same instance
    expect(returnedCollection.value).toBe(liveQueryCollection)
  })

  it(`should switch to a different pre-created live query collection when reactive ref changes`, async () => {
    const collection1 = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `collection-1-vue`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    const collection2 = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `collection-2-vue`,
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

    // Use a reactive ref that can change - this is the proper Vue pattern
    const currentCollection = ref(liveQueryCollection1 as any)
    const { state, collection: returnedCollection } =
      useLiveQuery(currentCollection)

    // Wait for first collection to sync
    await waitForVueUpdate()

    expect(state.value.size).toBe(1) // Only John Smith from collection1
    expect(state.value.get(`3`)).toMatchObject({
      id: `3`,
      name: `John Smith`,
    })
    expect(returnedCollection.value.id).toBe(liveQueryCollection1.id)

    // Switch to the second collection by updating the reactive ref
    currentCollection.value = liveQueryCollection2 as any

    // Wait for the reactive change to propagate
    await waitForVueUpdate()

    expect(state.value.size).toBe(2) // Alice and Bob from collection2
    expect(state.value.get(`4`)).toMatchObject({
      id: `4`,
      name: `Alice Cooper`,
    })
    expect(state.value.get(`5`)).toMatchObject({
      id: `5`,
      name: `Bob Dylan`,
    })
    expect(returnedCollection.value.id).toBe(liveQueryCollection2.id)

    // Verify we no longer have data from the first collection
    expect(state.value.get(`3`)).toBeUndefined()
  })

  describe(`isReady property`, () => {
    it(`should be false initially and true after collection is ready`, async () => {
      let beginFn: (() => void) | undefined
      let commitFn: (() => void) | undefined

      // Create a collection that doesn't start sync immediately
      const collection = createCollection<Person>({
        id: `is-ready-test`,
        getKey: (person: Person) => person.id,
        startSync: false, // Don't start sync immediately
        sync: {
          sync: ({ begin, commit }) => {
            beginFn = begin
            commitFn = commit
            // Don't call begin/commit immediately
          },
        },
        onInsert: () => Promise.resolve(),
        onUpdate: () => Promise.resolve(),
        onDelete: () => Promise.resolve(),
      })

      const { isReady } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          }))
      )

      // Initially isReady should be false (collection is in idle state)
      expect(isReady.value).toBe(false)

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

      await waitFor(() => expect(isReady.value).toBe(true))
    })

    it(`should be true for pre-created collections that are already syncing`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `pre-created-is-ready-test`,
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

      await waitForVueUpdate()
      const { isReady } = useLiveQuery(liveQueryCollection)
      expect(isReady.value).toBe(true)
    })

    it(`should be false for pre-created collections that are not syncing`, () => {
      const collection = createCollection<Person>({
        id: `not-syncing-is-ready-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: () => {
            // Don't sync immediately
          },
        },
        onInsert: () => Promise.resolve(),
        onUpdate: () => Promise.resolve(),
        onDelete: () => Promise.resolve(),
      })

      // Create a live query collection that's NOT syncing
      const liveQueryCollection = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        startSync: false, // Not syncing
      })

      const { isReady } = useLiveQuery(liveQueryCollection)
      expect(isReady.value).toBe(false)
    })

    it(`should update isReady when collection status changes`, async () => {
      let beginFn: (() => void) | undefined
      let commitFn: (() => void) | undefined

      const collection = createCollection<Person>({
        id: `status-change-is-ready-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit }) => {
            beginFn = begin
            commitFn = commit
            // Don't sync immediately
          },
        },
        onInsert: () => Promise.resolve(),
        onUpdate: () => Promise.resolve(),
        onDelete: () => Promise.resolve(),
      })

      const { isReady } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          }))
      )

      expect(isReady.value).toBe(false)
      collection.preload()
      if (beginFn && commitFn) {
        beginFn()
        commitFn()
      }
      collection.insert({
        id: `1`,
        name: `John Doe`,
        age: 35,
        email: `john.doe@example.com`,
        isActive: true,
        team: `team1`,
      })
      await waitFor(() => expect(isReady.value).toBe(true))
    })

    it(`should maintain isReady state during live updates`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `live-updates-is-ready-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      const { isReady } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          }))
      )

      await waitForVueUpdate()
      const initialIsReady = isReady.value
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
      await waitForVueUpdate()
      expect(isReady.value).toBe(true)
      expect(isReady.value).toBe(initialIsReady)
    })

    it(`should handle isReady with complex queries including joins`, async () => {
      let personBeginFn: (() => void) | undefined
      let personCommitFn: (() => void) | undefined
      let issueBeginFn: (() => void) | undefined
      let issueCommitFn: (() => void) | undefined

      const personCollection = createCollection<Person>({
        id: `join-is-ready-persons`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit }) => {
            personBeginFn = begin
            personCommitFn = commit
            // Don't sync immediately
          },
        },
        onInsert: () => Promise.resolve(),
        onUpdate: () => Promise.resolve(),
        onDelete: () => Promise.resolve(),
      })

      const issueCollection = createCollection<Issue>({
        id: `join-is-ready-issues`,
        getKey: (issue: Issue) => issue.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit }) => {
            issueBeginFn = begin
            issueCommitFn = commit
            // Don't sync immediately
          },
        },
        onInsert: () => Promise.resolve(),
        onUpdate: () => Promise.resolve(),
        onDelete: () => Promise.resolve(),
      })

      const { isReady } = useLiveQuery((q) =>
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

      expect(isReady.value).toBe(false)
      personCollection.preload()
      issueCollection.preload()
      if (personBeginFn && personCommitFn) {
        personBeginFn()
        personCommitFn()
      }
      if (issueBeginFn && issueCommitFn) {
        issueBeginFn()
        issueCommitFn()
      }
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
      await waitFor(() => expect(isReady.value).toBe(true))
    })

    it(`should handle isReady with parameterized queries`, async () => {
      let beginFn: (() => void) | undefined
      let commitFn: (() => void) | undefined

      const collection = createCollection<Person>({
        id: `params-is-ready-test`,
        getKey: (person: Person) => person.id,
        startSync: false,
        sync: {
          sync: ({ begin, commit }) => {
            beginFn = begin
            commitFn = commit
            // Don't sync immediately
          },
        },
        onInsert: () => Promise.resolve(),
        onUpdate: () => Promise.resolve(),
        onDelete: () => Promise.resolve(),
      })

      const minAge = ref(30)
      const { isReady } = useLiveQuery(
        (q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => gt(c.age, minAge.value))
            .select(({ collection: c }) => ({
              id: c.id,
              name: c.name,
            })),
        [minAge]
      )

      expect(isReady.value).toBe(false)
      collection.preload()
      if (beginFn && commitFn) {
        beginFn()
        commitFn()
      }
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
      await waitFor(() => expect(isReady.value).toBe(true))
      minAge.value = 25
      await waitFor(() => expect(isReady.value).toBe(true))
    })
  })

  it(`should accept config object with pre-built QueryBuilder instance`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `config-querybuilder-test-vue`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    // Create a pre-built QueryBuilder instance
    const { Query } = await import(`@tanstack/db`)
    const queryBuilder = new Query()
      .from({ persons: collection })
      .where(({ persons }) => gt(persons.age, 30))
      .select(({ persons }) => ({
        id: persons.id,
        name: persons.name,
        age: persons.age,
      }))

    const { state, data } = useLiveQuery({
      query: queryBuilder,
    })

    // Wait for collection to sync and state to update
    await waitForVueUpdate()

    expect(state.value.size).toBe(1) // Only John Smith (age 35)
    expect(data.value).toHaveLength(1)

    const johnSmith = data.value[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })
})
