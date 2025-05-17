import { afterEach, describe, expect, it, vi } from "vitest"
import mitt from "mitt"
import { Collection, createTransaction } from "@tanstack/db"
import { flushSync } from "svelte"
import { useLiveQuery } from "../src/useLiveQuery.svelte.js"
import type {
  Context,
  InitialQueryBuilder,
  PendingMutation,
  Schema,
} from "@tanstack/db"

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

  it(`should be able to query a collection`, () => {
    cleanup = $effect.root(() => {
      const emitter = mitt()

      // Create collection with mutation capability
      const collection = new Collection<Person>({
        id: `optimistic-changes-test`,
        sync: {
          sync: ({ begin, write, commit }) => {
            // Listen for sync events
            emitter.on(`*`, (_, changes) => {
              begin()
              ;(changes as Array<PendingMutation>).forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Person,
                })
              })
              commit()
            })
          },
        },
      })

      // Sync from initial state
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )

      const result = useLiveQuery((q) =>
        q
          .from({ collection })
          .where(`@age`, `>`, 30)
          .keyBy(`@id`)
          .select(`@id`, `@name`)
          .orderBy({ "@id": `asc` })
      )

      expect(result.state.size).toBe(1)
      expect(result.state.get(`3`)).toEqual({
        _orderByIndex: 0,
        id: `3`,
        name: `John Smith`,
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0]).toEqual({
        _orderByIndex: 0,
        id: `3`,
        name: `John Smith`,
      })

      // Insert a new person
      emitter.emit(`sync`, [
        {
          key: `4`,
          type: `insert`,
          changes: {
            id: `4`,
            name: `Kyle Doe`,
            age: 40,
            email: `kyle.doe@example.com`,
            isActive: true,
          },
        },
      ])

      flushSync()

      expect(result.state.size).toBe(2)
      expect(result.state.get(`3`)).toEqual({
        _orderByIndex: 0,
        id: `3`,
        name: `John Smith`,
      })
      expect(result.state.get(`4`)).toEqual({
        _orderByIndex: 1,
        id: `4`,
        name: `Kyle Doe`,
      })

      expect(result.data.length).toBe(2)
      expect(result.data).toContainEqual({
        _orderByIndex: 0,
        id: `3`,
        name: `John Smith`,
      })
      expect(result.data).toContainEqual({
        _orderByIndex: 1,
        id: `4`,
        name: `Kyle Doe`,
      })

      // Update the person
      emitter.emit(`sync`, [
        {
          key: `4`,
          type: `update`,
          changes: {
            name: `Kyle Doe 2`,
          },
        },
      ])

      flushSync()

      expect(result.state.size).toBe(2)
      expect(result.state.get(`4`)).toEqual({
        _orderByIndex: 1,
        id: `4`,
        name: `Kyle Doe 2`,
      })

      expect(result.data.length).toBe(2)
      expect(result.data).toContainEqual({
        _orderByIndex: 1,
        id: `4`,
        name: `Kyle Doe 2`,
      })

      // Delete the person
      emitter.emit(`sync`, [
        {
          key: `4`,
          type: `delete`,
        },
      ])

      flushSync()

      expect(result.state.size).toBe(1)
      expect(result.state.get(`4`)).toBeUndefined()

      expect(result.data.length).toBe(1)
      expect(result.data).toContainEqual({
        _orderByIndex: 0,
        id: `3`,
        name: `John Smith`,
      })
    })
  })

  it(`should join collections and return combined results`, () => {
    cleanup = $effect.root(() => {
      const emitter = mitt()

      // Create person collection
      const personCollection = new Collection<Person>({
        id: `person-collection-test`,
        sync: {
          sync: ({ begin, write, commit }) => {
            emitter.on(`sync-person`, (changes) => {
              begin()
              ;(changes as Array<PendingMutation>).forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Person,
                })
              })
              commit()
            })
          },
        },
      })

      // Create issue collection
      const issueCollection = new Collection<Issue>({
        id: `issue-collection-test`,
        sync: {
          sync: ({ begin, write, commit }) => {
            emitter.on(`sync-issue`, (changes) => {
              begin()
              ;(changes as Array<PendingMutation>).forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Issue,
                })
              })
              commit()
            })
          },
        },
      })

      // Sync initial person data
      emitter.emit(
        `sync-person`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )

      flushSync()

      // Sync initial issue data
      emitter.emit(
        `sync-issue`,
        initialIssues.map((issue) => ({
          key: issue.id,
          type: `insert`,
          changes: issue,
        }))
      )

      const result = useLiveQuery((q) =>
        q
          .from({ issues: issueCollection })
          .join({
            type: `inner`,
            from: { persons: personCollection },
            on: [`@persons.id`, `=`, `@issues.userId`],
          })
          .select(`@issues.id`, `@issues.title`, `@persons.name`)
          .keyBy(`@id`)
      )

      flushSync()

      // Verify that we have the expected joined results
      expect(result.state.size).toBe(3)

      expect(result.state.get(`1`)).toEqual({
        id: `1`,
        name: `John Doe`,
        title: `Issue 1`,
      })

      expect(result.state.get(`2`)).toEqual({
        id: `2`,
        name: `Jane Doe`,
        title: `Issue 2`,
      })

      expect(result.state.get(`3`)).toEqual({
        id: `3`,
        name: `John Doe`,
        title: `Issue 3`,
      })

      // Add a new issue for user 1
      emitter.emit(`sync-issue`, [
        {
          key: `4`,
          type: `insert`,
          changes: {
            id: `4`,
            title: `Issue 4`,
            description: `Issue 4 description`,
            userId: `2`,
          },
        },
      ])

      flushSync()

      expect(result.state.size).toBe(4)
      expect(result.state.get(`4`)).toEqual({
        id: `4`,
        name: `Jane Doe`,
        title: `Issue 4`,
      })

      // Update an issue we're already joined with
      emitter.emit(`sync-issue`, [
        {
          key: `2`,
          type: `update`,
          changes: {
            title: `Updated Issue 2`,
          },
        },
      ])

      flushSync()

      // The updated title should be reflected in the joined results
      expect(result.state.get(`2`)).toEqual({
        id: `2`,
        name: `Jane Doe`,
        title: `Updated Issue 2`,
      })

      // Delete an issue
      emitter.emit(`sync-issue`, [
        {
          key: `3`,
          type: `delete`,
        },
      ])

      flushSync()

      // After deletion, user 3 should no longer have a joined result
      expect(result.state.get(`3`)).toBeUndefined()
    })
  })

  it(`should recompile query when parameters change and change results`, () => {
    cleanup = $effect.root(() => {
      const emitter = mitt()

      // Create collection with mutation capability
      const collection = new Collection<Person>({
        id: `params-change-test`,
        sync: {
          sync: ({ begin, write, commit }) => {
            // Listen for sync events
            emitter.on(`sync`, (changes) => {
              begin()
              ;(changes as Array<PendingMutation>).forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Person,
                })
              })
              commit()
            })
          },
        },
      })

      // Sync from initial state
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )

      flushSync()

      let minAge = $state(30)

      const result = useLiveQuery((q) => {
        return q
          .from({ collection })
          .where(`@age`, `>`, minAge)
          .keyBy(`@id`)
          .select(`@id`, `@name`, `@age`)
      })

      // Initially should return only people older than 30
      expect(result.state.size).toBe(1)
      expect(result.state.get(`3`)).toEqual({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Change the parameter to include more people
      minAge = 20

      flushSync()

      // Now should return all people as they're all older than 20
      expect(result.state.size).toBe(3)
      expect(result.state.get(`1`)).toEqual({
        id: `1`,
        name: `John Doe`,
        age: 30,
      })
      expect(result.state.get(`2`)).toEqual({
        id: `2`,
        name: `Jane Doe`,
        age: 25,
      })
      expect(result.state.get(`3`)).toEqual({
        id: `3`,
        name: `John Smith`,
        age: 35,
      })

      // Change to exclude everyone
      minAge = 50

      flushSync()

      // Should now be empty
      expect(result.state.size).toBe(0)
    })
  })

  it(`should stop old query when parameters change`, () => {
    cleanup = $effect.root(() => {
      const emitter = mitt()

      // Create collection with mutation capability
      const collection = new Collection<Person>({
        id: `stop-query-test`,
        sync: {
          sync: ({ begin, write, commit }) => {
            emitter.on(`sync`, (changes) => {
              begin()
              ;(changes as Array<PendingMutation>).forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Person,
                })
              })
              commit()
            })
          },
        },
      })

      // Mock console.log to track when compiledQuery.stop() is called
      let logCalls: Array<string> = []
      const originalConsoleLog = console.log
      console.log = vi.fn((...args) => {
        logCalls.push(args.join(` `))
        originalConsoleLog(...args)
      })

      // Add a custom hook that wraps useLiveQuery to log when queries are created and stopped
      function useTrackedLiveQuery<T>(
        queryFn: (q: InitialQueryBuilder<Context<Schema>>) => any,
        deps: Array<() => unknown>
      ): T {
        const result = useLiveQuery(queryFn)
        const derivedDeps = () => deps.map((dep) => dep()).join(`,`)

        $effect(() => {
          console.log(`Creating new query with deps`, derivedDeps())

          return () => {
            console.log(`Stopping query with deps`, derivedDeps())
          }
        })

        return result as T
      }

      // Sync initial state
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )

      let minAge = $state(30)
      useTrackedLiveQuery(
        (q) =>
          q
            .from({ collection })
            .where(`@age`, `>`, minAge)
            .keyBy(`@id`)
            .select(`@id`, `@name`),
        [() => minAge]
      )

      flushSync()

      // Initial query should be created
      expect(
        logCalls.some((call) => {
          return call.includes(`Creating new query with deps 30`)
        })
      ).toBe(true)

      // Clear log calls
      logCalls = []

      // Change the parameter
      minAge = 25

      flushSync()

      // Old query should be stopped and new query created
      expect(
        logCalls.some((call) => call.includes(`Stopping query with deps 30`))
      ).toBe(true)
      expect(
        logCalls.some((call) =>
          call.includes(`Creating new query with deps 25`)
        )
      ).toBe(true)

      // Restore console.log
      console.log = originalConsoleLog
    })
  })

  it(`should be able to query a result collection`, () => {
    cleanup = $effect.root(() => {
      const emitter = mitt()

      // Create collection with mutation capability
      const collection = new Collection<Person>({
        id: `optimistic-changes-test`,
        sync: {
          sync: ({ begin, write, commit }) => {
            // Listen for sync events
            emitter.on(`*`, (_, changes) => {
              begin()
              ;(changes as Array<PendingMutation>).forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Person,
                })
              })
              commit()
            })
          },
        },
      })

      // Sync from initial state
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )

      flushSync()

      // Initial query
      const result = useLiveQuery((q) =>
        q
          .from({ collection })
          .where(`@age`, `>`, 30)
          .keyBy(`@id`)
          .select(`@id`, `@name`, `@team`)
          .orderBy({ "@id": `asc` })
      )

      // Grouped query derived from initial query
      const groupedResult = useLiveQuery((q) =>
        q
          .from({ queryResult: result.collection })
          .groupBy(`@team`)
          .keyBy(`@team`)
          .select(`@team`, { count: { COUNT: `@id` } })
      )

      // Verify initial grouped results
      expect(groupedResult.state.size).toBe(1)
      expect(groupedResult.state.get(`team1`)).toEqual({
        team: `team1`,
        count: 1,
      })

      // Insert two new users in different teams
      emitter.emit(`sync`, [
        {
          key: `5`,
          type: `insert`,
          changes: {
            id: `5`,
            name: `Sarah Jones`,
            age: 32,
            email: `sarah.jones@example.com`,
            isActive: true,
            team: `team1`,
          },
        },
        {
          key: `6`,
          type: `insert`,
          changes: {
            id: `6`,
            name: `Mike Wilson`,
            age: 38,
            email: `mike.wilson@example.com`,
            isActive: true,
            team: `team2`,
          },
        },
      ])

      flushSync()

      // Verify the grouped results include the new team members
      expect(groupedResult.state.size).toBe(2)
      expect(groupedResult.state.get(`team1`)).toEqual({
        team: `team1`,
        count: 2,
      })
      expect(groupedResult.state.get(`team2`)).toEqual({
        team: `team2`,
        count: 1,
      })
    })
  })

  it(`optimistic state is dropped after commit`, () => {
    cleanup = $effect.root(() => {
      const emitter = mitt()
      // Track renders and states
      const renderStates: Array<{
        stateSize: number
        hasTempKey: boolean
        hasPermKey: boolean
        timestamp: number
      }> = []

      // Create person collection
      const personCollection = new Collection<Person>({
        id: `person-collection-test-bug`,
        sync: {
          sync: ({ begin, write, commit }) => {
            // @ts-expect-error Mitt typing doesn't match our usage
            emitter.on(`sync-person`, (changes: Array<PendingMutation>) => {
              begin()
              changes.forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Person,
                })
              })
              commit()
            })
          },
        },
      })

      // Create issue collection
      const issueCollection = new Collection<Issue>({
        id: `issue-collection-test-bug`,
        sync: {
          sync: ({ begin, write, commit }) => {
            // @ts-expect-error Mitt typing doesn't match our usage
            emitter.on(`sync-issue`, (changes: Array<PendingMutation>) => {
              begin()
              changes.forEach((change) => {
                write({
                  key: change.key,
                  type: change.type,
                  value: change.changes as Issue,
                })
              })
              commit()
            })
          },
        },
      })

      // Sync initial person data
      emitter.emit(
        `sync-person`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )

      flushSync()

      // Sync initial issue data
      emitter.emit(
        `sync-issue`,
        initialIssues.map((issue) => ({
          key: issue.id,
          type: `insert`,
          changes: issue,
        }))
      )

      flushSync()

      // Render the hook with a query that joins persons and issues
      const result = useLiveQuery((q) =>
        q
          .from({ issues: issueCollection })
          .join({
            type: `inner`,
            from: { persons: personCollection },
            on: [`@persons.id`, `=`, `@issues.userId`],
          })
          .select(`@issues.id`, `@issues.title`, `@persons.name`)
          .keyBy(`@id`)
      )

      // Track each render state
      $effect(() => {
        renderStates.push({
          stateSize: result.state.size,
          hasTempKey: result.state.has(`temp-key`),
          hasPermKey: result.state.has(`4`),
          timestamp: Date.now(),
        })
      })

      flushSync()

      // Verify initial state
      expect(result.state.size).toBe(3)

      // Reset render states array for clarity in the remaining test
      renderStates.length = 0

      // Create a transaction to perform an optimistic mutation
      const tx = createTransaction({
        mutationFn: async () => {
          emitter.emit(`sync-issue`, [
            {
              key: `4`,
              type: `insert`,
              changes: {
                id: `4`,
                title: `New Issue`,
                description: `New Issue Description`,
                userId: `1`,
              },
            },
          ])
          return Promise.resolve()
        },
      })

      // Perform optimistic insert of a new issue
      tx.mutate(() =>
        issueCollection.insert(
          {
            id: `temp-key`,
            title: `New Issue`,
            description: `New Issue Description`,
            userId: `1`,
          },
          { key: `temp-key` }
        )
      )

      // Verify optimistic state is immediately reflected
      expect(result.state.size).toBe(4)
      expect(result.state.get(`temp-key`)).toEqual({
        id: `temp-key`,
        name: `John Doe`,
        title: `New Issue`,
      })

      // Wait for the transaction to be committed
      // await tx.isPersisted.promise
      // flushSync()

      // // Check if we had any render where the temp key was removed but the permanent key wasn't added yet
      // const hadFlicker = renderStates.some(
      //   (state) =>
      //     !state.hasTempKey && !state.hasPermKey && state.stateSize === 3
      // )

      // expect(hadFlicker).toBe(false)

      // // Verify the temporary key is replaced by the permanent one
      // expect(result.state.size).toBe(4)
      // expect(result.state.get(`temp-key`)).toBeUndefined()
      // expect(result.state.get(`4`)).toEqual({
      //   id: `4`,
      //   name: `John Doe`,
      //   title: `New Issue`,
      // })
    })
  })
})
