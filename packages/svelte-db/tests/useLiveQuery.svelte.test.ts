import { afterEach, describe, expect, it } from "vitest"
import {
  count,
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from "@tanstack/db"
import { flushSync } from "svelte"
import { useLiveQuery } from "../src/useLiveQuery.svelte.js"
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

describe(`Query Collections`, () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
  })

  it(`should work with basic collection and select`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    cleanup = $effect.root(() => {
      const query = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            age: persons.age,
          }))
      )

      flushSync()

      expect(query.state.size).toBe(1) // Only John Smith (age 35)
      expect(query.data).toHaveLength(1)

      const johnSmith = query.data[0]
      expect(johnSmith).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })
    })
  })

  it(`should be able to query a collection with live updates`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    cleanup = $effect.root(() => {
      const query = useLiveQuery((q) =>
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
      flushSync()

      expect(query.state.size).toBe(1)
      expect(query.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })

      expect(query.data.length).toBe(1)
      expect(query.data[0]).toMatchObject({
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

      flushSync()

      expect(query.state.size).toBe(2)
      expect(query.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })
      expect(query.state.get(`4`)).toMatchObject({
        id: `4`,
        name: `Kyle Doe`,
      })

      expect(query.data.length).toBe(2)
      expect(query.data).toEqual(
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

      flushSync()

      expect(query.state.size).toBe(2)
      expect(query.state.get(`4`)).toMatchObject({
        id: `4`,
        name: `Kyle Doe 2`,
      })

      expect(query.data.length).toBe(2)
      expect(query.data).toEqual(
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

      flushSync()

      expect(query.state.size).toBe(1)
      expect(query.state.get(`4`)).toBeUndefined()

      expect(query.data.length).toBe(1)
      expect(query.data[0]).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })
    })
  })

  it(`should join collections and return combined results with live updates`, () => {
    // Create person collection
    const personCollection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `person-collection-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    cleanup = $effect.root(() => {
      // Create issue collection
      const issueCollection = createCollection(
        mockSyncCollectionOptions<Issue>({
          id: `issue-collection-test`,
          getKey: (issue: Issue) => issue.id,
          initialData: initialIssues,
        })
      )

      const query = useLiveQuery((q) =>
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
      flushSync()

      // Verify that we have the expected joined results
      expect(query.state.size).toBe(3)

      expect(query.state.get(`[1,1]`)).toMatchObject({
        id: `1`,
        name: `John Doe`,
        title: `Issue 1`,
      })

      expect(query.state.get(`[2,2]`)).toMatchObject({
        id: `2`,
        name: `Jane Doe`,
        title: `Issue 2`,
      })

      expect(query.state.get(`[3,1]`)).toMatchObject({
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

      flushSync()

      expect(query.state.size).toBe(4)
      expect(query.state.get(`[4,2]`)).toMatchObject({
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

      flushSync()

      // The updated title should be reflected in the joined results
      expect(query.state.get(`[2,2]`)).toMatchObject({
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

      flushSync()

      // After deletion, issue 3 should no longer have a joined result
      expect(query.state.get(`[3,1]`)).toBeUndefined()
      expect(query.state.size).toBe(3)
    })
  })

  it(`should recompile query when parameters change and change results`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `params-change-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    cleanup = $effect.root(() => {
      let minAge = $state(30)

      const query = useLiveQuery(
        (q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => gt(c.age, minAge))
            .select(({ collection: c }) => ({
              id: c.id,
              name: c.name,
              age: c.age,
            })),
        [() => minAge]
      )

      // Wait for collection to sync
      flushSync()

      // Initially should return only people older than 30
      expect(query.state.size).toBe(1)
      expect(query.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Change the parameter to include more people
      minAge = 20

      flushSync()

      // Now should return all people as they're all older than 20
      expect(query.state.size).toBe(3)
      expect(query.state.get(`1`)).toMatchObject({
        id: `1`,
        name: `John Doe`,
        age: 30,
      })
      expect(query.state.get(`2`)).toMatchObject({
        id: `2`,
        name: `Jane Doe`,
        age: 25,
      })
      expect(query.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Change to exclude everyone
      minAge = 50

      flushSync()

      // Should now be empty
      expect(query.state.size).toBe(0)
    })
  })

  it(`should be able to query a result collection with live updates`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `optimistic-changes-test`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    cleanup = $effect.root(() => {
      // Initial query
      const query = useLiveQuery((q) =>
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
      flushSync()

      // Grouped query derived from initial query
      const groupedQuery = useLiveQuery((q) =>
        q
          .from({ queryResult: query.collection })
          .groupBy(({ queryResult }) => queryResult.team)
          .select(({ queryResult }) => ({
            team: queryResult.team,
            count: count(queryResult.id),
          }))
      )

      // Wait for grouped query to sync
      flushSync()

      // Verify initial grouped results
      expect(groupedQuery.state.size).toBe(1)
      const teamResult = Array.from(groupedQuery.state.values())[0]
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

      flushSync()

      // Verify the grouped results include the new team members
      expect(groupedQuery.state.size).toBe(2)

      const groupedResults = Array.from(groupedQuery.state.values())
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
  })

  it(`optimistic state is dropped after commit`, () => {
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

    cleanup = $effect.root(() => {
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

      // Wait for collections to sync and verify initial state
      flushSync()

      expect(queryResult.state.size).toBe(3)

      // Insert a new issue directly to test the query updates
      issueCollection.utils.begin()
      issueCollection.utils.write({
        type: `insert`,
        value: {
          id: `4`,
          title: `New Issue`,
          description: `New Issue Description`,
          userId: `1`,
        },
      })
      issueCollection.utils.commit()

      flushSync()

      // Verify the new issue is reflected in the query
      expect(queryResult.state.size).toBe(4)
      expect(queryResult.state.get(`[4,1]`)).toMatchObject({
        id: `4`,
        name: `John Doe`,
        title: `New Issue`,
      })
    })
  })

  it(`should accept pre-created live query collection`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `pre-created-collection-test-vue`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      })
    )

    cleanup = $effect.root(() => {
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

      const queryResult = useLiveQuery(liveQueryCollection)

      // Wait for collection to sync and state to update
      flushSync()

      expect(queryResult.state.size).toBe(1) // Only John Smith (age 35)
      expect(queryResult.data).toHaveLength(1)

      const johnSmith = queryResult.data[0]
      expect(johnSmith).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Verify that the returned collection is the same instance
      expect(queryResult.collection).toBe(liveQueryCollection)
    })
  })

  it(`should switch to a different pre-created live query collection when reactive ref changes`, () => {
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

    cleanup = $effect.root(() => {
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

      // Use a reactive state that can change - this is the proper Svelte pattern
      let currentCollection = $state(liveQueryCollection1)
      const queryResult = useLiveQuery(() => currentCollection)

      // Wait for first collection to sync
      flushSync()

      expect(queryResult.state.size).toBe(1) // Only John Smith from collection1
      expect(queryResult.state.get(`3`)).toMatchObject({
        id: `3`,
        name: `John Smith`,
      })
      expect(queryResult.collection.id).toBe(liveQueryCollection1.id)

      // Switch to the second collection by updating the reactive state
      currentCollection = liveQueryCollection2

      // Wait for the reactive change to propagate
      flushSync()

      expect(queryResult.state.size).toBe(2) // Alice and Bob from collection2
      expect(queryResult.state.get(`4`)).toMatchObject({
        id: `4`,
        name: `Alice Cooper`,
      })
      expect(queryResult.state.get(`5`)).toMatchObject({
        id: `5`,
        name: `Bob Dylan`,
      })
      expect(queryResult.collection.id).toBe(liveQueryCollection2.id)

      // Verify we no longer have data from the first collection
      expect(queryResult.state.get(`3`)).toBeUndefined()
    })
  })

  describe(`isReady property`, () => {
    it(`should be false initially and true after collection is ready`, () => {
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

      cleanup = $effect.root(() => {
        const queryResult = useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )

        // Initially isReady should be false (collection is in idle state)
        expect(queryResult.isReady).toBe(false)

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

        // Wait for the collection to be ready
        flushSync()
        expect(queryResult.isReady).toBe(true)
      })
    })

    it(`should be true for pre-created collections that are already syncing`, () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `pre-created-is-ready-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      cleanup = $effect.root(() => {
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

        flushSync()
        const queryResult = useLiveQuery(liveQueryCollection)
        expect(queryResult.isReady).toBe(true)
      })
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

      cleanup = $effect.root(() => {
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

        const queryResult = useLiveQuery(liveQueryCollection)
        expect(queryResult.isReady).toBe(false)
      })
    })

    it(`should update isReady when collection status changes`, () => {
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

      cleanup = $effect.root(() => {
        const query = useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )

        expect(query.isReady).toBe(false)
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
        flushSync()
        expect(query.isReady).toBe(true)
      })
    })

    it(`should maintain isReady state during live updates`, () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `live-updates-is-ready-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        })
      )

      cleanup = $effect.root(() => {
        const queryResult = useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        )

        flushSync()
        const initialIsReady = queryResult.isReady
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
        flushSync()
        expect(queryResult.isReady).toBe(true)
        expect(queryResult.isReady).toBe(initialIsReady)
      })
    })

    it(`should handle isReady with complex queries including joins`, () => {
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

      cleanup = $effect.root(() => {
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

        const query = useLiveQuery((q) =>
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

        expect(query.isReady).toBe(false)
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
        flushSync()
        expect(query.isReady).toBe(true)
      })
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

      cleanup = $effect.root(() => {
        let minAge = $state(30)
        const query = useLiveQuery(
          (q) =>
            q
              .from({ collection })
              .where(({ collection: c }) => gt(c.age, minAge))
              .select(({ collection: c }) => ({
                id: c.id,
                name: c.name,
              })),
          [() => minAge]
        )

        expect(query.isReady).toBe(false)
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
        flushSync()
        expect(query.isReady).toBe(true)
        minAge = 25
        flushSync()
        expect(query.isReady).toBe(true)
      })
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

    const { Query } = await import(`@tanstack/db`)

    cleanup = $effect.root(() => {
      // Create a pre-built QueryBuilder instance
      const queryBuilder = new Query()
        .from({ persons: collection })
        .where(({ persons }) => gt(persons.age, 30))
        .select(({ persons }) => ({
          id: persons.id,
          name: persons.name,
          age: persons.age,
        }))

      const queryResult = useLiveQuery({
        query: queryBuilder,
      })

      // Wait for collection to sync and state to update
      flushSync()

      expect(queryResult.state.size).toBe(1) // Only John Smith (age 35)
      expect(queryResult.data).toHaveLength(1)

      const johnSmith = queryResult.data[0]
      expect(johnSmith).toMatchObject({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })
    })
  })
})
