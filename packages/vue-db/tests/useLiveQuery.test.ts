import { describe, expect, it, vi } from "vitest"
import mitt from "mitt"
import { Collection, createTransaction } from "@tanstack/db"
import { ref, watch, watchEffect } from "vue"
import { useLiveQuery } from "../src/useLiveQuery"
import type { Ref } from "vue"
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
  it(`should be able to query a collection`, async () => {
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

    const { state, data } = useLiveQuery((q) =>
      q
        .from({ collection })
        .where(`@age`, `>`, 30)
        .select(`@id`, `@name`)
        .orderBy({ "@id": `asc` })
    )

    expect(state.value.size).toBe(1)
    expect(state.value.get(`3`)).toEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })

    expect(data.value.length).toBe(1)
    expect(data.value[0]).toEqual({
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

    await waitForChanges()

    expect(state.value.size).toBe(2)
    expect(state.value.get(`3`)).toEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })
    expect(state.value.get(`4`)).toEqual({
      _orderByIndex: 1,
      id: `4`,
      name: `Kyle Doe`,
    })

    expect(data.value.length).toBe(2)
    expect(data.value).toContainEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })
    expect(data.value).toContainEqual({
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

    await waitForChanges()

    expect(state.value.size).toBe(2)
    expect(state.value.get(`4`)).toEqual({
      _orderByIndex: 1,
      id: `4`,
      name: `Kyle Doe 2`,
    })

    expect(data.value.length).toBe(2)
    expect(data.value).toContainEqual({
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

    await waitForChanges()

    expect(state.value.size).toBe(1)
    expect(state.value.get(`4`)).toBeUndefined()

    expect(data.value.length).toBe(1)
    expect(data.value).toContainEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })
  })

  it(`should join collections and return combined results`, async () => {
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

    // Sync initial issue data
    emitter.emit(
      `sync-issue`,
      initialIssues.map((issue) => ({
        key: issue.id,
        type: `insert`,
        changes: issue,
      }))
    )

    const { state } = useLiveQuery((q) =>
      q
        .from({ issues: issueCollection })
        .join({
          type: `inner`,
          from: { persons: personCollection },
          on: [`@persons.id`, `=`, `@issues.userId`],
        })
        .select(`@issues.id`, `@issues.title`, `@persons.name`)
    )

    await waitForChanges()

    // Verify that we have the expected joined results
    expect(state.value.size).toBe(3)

    expect(state.value.get(`[1,1]`)).toEqual({
      id: `1`,
      name: `John Doe`,
      title: `Issue 1`,
    })

    expect(state.value.get(`[2,2]`)).toEqual({
      id: `2`,
      name: `Jane Doe`,
      title: `Issue 2`,
    })

    expect(state.value.get(`[3,1]`)).toEqual({
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

    await waitForChanges()

    expect(state.value.size).toBe(4)
    expect(state.value.get(`[4,2]`)).toEqual({
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

    await waitForChanges()

    // The updated title should be reflected in the joined results
    expect(state.value.get(`[2,2]`)).toEqual({
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

    await waitForChanges()

    // After deletion, user 3 should no longer have a joined result
    expect(state.value.get(`[3,1]`)).toBeUndefined()
  })

  it(`should recompile query when parameters change and change results`, async () => {
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

    const minAge = ref(30)

    const { state } = useLiveQuery((q) => {
      return q
        .from({ collection })
        .where(`@age`, `>`, minAge.value)
        .select(`@id`, `@name`, `@age`)
    })

    // Initially should return only people older than 30
    expect(state.value.size).toBe(1)
    expect(state.value.get(`3`)).toEqual({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change the parameter to include more people
    minAge.value = 20

    await waitForChanges()

    // Now should return all people as they're all older than 20
    expect(state.value.size).toBe(3)
    expect(state.value.get(`1`)).toEqual({
      id: `1`,
      name: `John Doe`,
      age: 30,
    })
    expect(state.value.get(`2`)).toEqual({
      id: `2`,
      name: `Jane Doe`,
      age: 25,
    })
    expect(state.value.get(`3`)).toEqual({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change to exclude everyone
    minAge.value = 50

    await waitForChanges()

    // Should now be empty
    expect(state.value.size).toBe(0)
  })

  it(`should stop old query when parameters change`, async () => {
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
      deps: Array<Ref<unknown>>
    ): T {
      const result = useLiveQuery(queryFn, deps)

      watch(
        () => deps.map((dep) => dep.value).join(`,`),
        (updatedDeps, _, fn) => {
          console.log(`Creating new query with deps`, updatedDeps)
          fn(() => console.log(`Stopping query with deps`, updatedDeps))
        },
        { immediate: true }
      )

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

    const minAge = ref(30)
    useTrackedLiveQuery(
      (q) =>
        q
          .from({ collection })
          .where(`@age`, `>`, minAge.value)
          .select(`@id`, `@name`),
      [minAge]
    )

    // Initial query should be created
    expect(
      logCalls.some((call) => call.includes(`Creating new query with deps 30`))
    ).toBe(true)

    // Clear log calls
    logCalls = []

    // Change the parameter
    minAge.value = 25

    await waitForChanges()

    // Old query should be stopped and new query created
    expect(
      logCalls.some((call) => call.includes(`Stopping query with deps 30`))
    ).toBe(true)
    expect(
      logCalls.some((call) => call.includes(`Creating new query with deps 25`))
    ).toBe(true)

    // Restore console.log
    console.log = originalConsoleLog
  })

  it(`should be able to query a result collection`, async () => {
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

    // Initial query
    const result = useLiveQuery((q) =>
      q
        .from({ collection })
        .where(`@age`, `>`, 30)
        .select(`@id`, `@name`, `@team`)
        .orderBy({ "@id": `asc` })
    )

    // Grouped query derived from initial query
    const groupedResult = useLiveQuery((q) =>
      q
        .from({ queryResult: result.collection.value })
        .groupBy(`@team`)
        .select(`@team`, { count: { COUNT: `@id` } })
    )

    // Verify initial grouped results
    expect(groupedResult.state.value.size).toBe(1)
    // the `{"team":"team1"}` key is generated by the groupBy operator
    expect(groupedResult.state.value.get(`{"team":"team1"}`)).toEqual({
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

    await waitForChanges()

    // Verify the grouped results include the new team members
    expect(groupedResult.state.value.size).toBe(2)
    expect(groupedResult.state.value.get(`{"team":"team1"}`)).toEqual({
      team: `team1`,
      count: 2,
    })
    expect(groupedResult.state.value.get(`{"team":"team2"}`)).toEqual({
      team: `team2`,
      count: 1,
    })
  })

  it(`optimistic state is dropped after commit`, async () => {
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

    // Sync initial issue data
    emitter.emit(
      `sync-issue`,
      initialIssues.map((issue) => ({
        key: issue.id,
        type: `insert`,
        changes: issue,
      }))
    )

    // Render the hook with a query that joins persons and issues
    const { state } = useLiveQuery((q) =>
      q
        .from({ issues: issueCollection })
        .join({
          type: `inner`,
          from: { persons: personCollection },
          on: [`@persons.id`, `=`, `@issues.userId`],
        })
        .select(`@issues.id`, `@issues.title`, `@persons.name`)
    )

    // Track each render state
    watchEffect(() => {
      renderStates.push({
        stateSize: state.value.size,
        hasTempKey: state.value.has(`temp-key`),
        hasPermKey: state.value.has(`4`),
        timestamp: Date.now(),
      })
    })

    await waitForChanges()

    // Verify initial state
    expect(state.value.size).toBe(3)

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
    expect(state.value.size).toBe(4)
    expect(state.value.get(`[temp-key,1]`)).toEqual({
      id: `temp-key`,
      name: `John Doe`,
      title: `New Issue`,
    })
    expect(state.value.get(`[4,1]`)).toBeUndefined()

    // Wait for the transaction to be committed
    await tx.isPersisted.promise
    await waitForChanges()

    // Check if we had any render where the temp key was removed but the permanent key wasn't added yet
    const hadFlicker = renderStates.some(
      (renderState) =>
        !renderState.hasTempKey &&
        !renderState.hasPermKey &&
        renderState.stateSize === 3
    )

    expect(hadFlicker).toBe(false)

    // Verify the temporary key is replaced by the permanent one
    expect(state.value.size).toBe(4)
    expect(state.value.get(`[temp-key,1]`)).toBeUndefined()
    expect(state.value.get(`[4,1]`)).toEqual({
      id: `4`,
      name: `John Doe`,
      title: `New Issue`,
    })
  })
})

async function waitForChanges(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
