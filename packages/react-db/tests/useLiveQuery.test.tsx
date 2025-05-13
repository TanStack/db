import { describe, expect, it, vi } from "vitest"
import mitt from "mitt"
import { act, renderHook } from "@testing-library/react"
import { Collection } from "@tanstack/db"
import { useEffect } from "react"
import { useLiveQuery } from "../src/useLiveQuery"
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
    act(() => {
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )
    })

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(`@age`, `>`, 30)
          .keyBy(`@id`)
          .select(`@id`, `@name`)
          .orderBy({ "@id": `asc` })
      )
    })

    expect(result.current.state.size).toBe(1)
    expect(result.current.state.get(`3`)).toEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })

    expect(result.current.data.length).toBe(1)
    expect(result.current.data[0]).toEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })

    // Insert a new person
    act(() => {
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
    })

    await waitForChanges()

    expect(result.current.state.size).toBe(2)
    expect(result.current.state.get(`3`)).toEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })
    expect(result.current.state.get(`4`)).toEqual({
      _orderByIndex: 1,
      id: `4`,
      name: `Kyle Doe`,
    })

    expect(result.current.data.length).toBe(2)
    expect(result.current.data).toContainEqual({
      _orderByIndex: 0,
      id: `3`,
      name: `John Smith`,
    })
    expect(result.current.data).toContainEqual({
      _orderByIndex: 1,
      id: `4`,
      name: `Kyle Doe`,
    })

    // Update the person
    act(() => {
      emitter.emit(`sync`, [
        {
          key: `4`,
          type: `update`,
          changes: {
            name: `Kyle Doe 2`,
          },
        },
      ])
    })

    await waitForChanges()

    expect(result.current.state.size).toBe(2)
    expect(result.current.state.get(`4`)).toEqual({
      _orderByIndex: 1,
      id: `4`,
      name: `Kyle Doe 2`,
    })

    expect(result.current.data.length).toBe(2)
    expect(result.current.data).toContainEqual({
      _orderByIndex: 1,
      id: `4`,
      name: `Kyle Doe 2`,
    })

    // Delete the person
    act(() => {
      emitter.emit(`sync`, [
        {
          key: `4`,
          type: `delete`,
        },
      ])
    })

    await waitForChanges()

    expect(result.current.state.size).toBe(1)
    expect(result.current.state.get(`4`)).toBeUndefined()

    expect(result.current.data.length).toBe(1)
    expect(result.current.data).toContainEqual({
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
    act(() => {
      emitter.emit(
        `sync-person`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )
    })

    // Sync initial issue data
    act(() => {
      emitter.emit(
        `sync-issue`,
        initialIssues.map((issue) => ({
          key: issue.id,
          type: `insert`,
          changes: issue,
        }))
      )
    })

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
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
    })

    await waitForChanges()

    // Verify that we have the expected joined results
    expect(result.current.state.size).toBe(3)

    expect(result.current.state.get(`1`)).toEqual({
      id: `1`,
      name: `John Doe`,
      title: `Issue 1`,
    })

    expect(result.current.state.get(`2`)).toEqual({
      id: `2`,
      name: `Jane Doe`,
      title: `Issue 2`,
    })

    expect(result.current.state.get(`3`)).toEqual({
      id: `3`,
      name: `John Doe`,
      title: `Issue 3`,
    })

    // Add a new issue for user 1
    act(() => {
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
    })

    await waitForChanges()

    expect(result.current.state.size).toBe(4)
    expect(result.current.state.get(`4`)).toEqual({
      id: `4`,
      name: `Jane Doe`,
      title: `Issue 4`,
    })

    // Update an issue we're already joined with
    act(() => {
      emitter.emit(`sync-issue`, [
        {
          key: `2`,
          type: `update`,
          changes: {
            title: `Updated Issue 2`,
          },
        },
      ])
    })

    await waitForChanges()

    // The updated title should be reflected in the joined results
    expect(result.current.state.get(`2`)).toEqual({
      id: `2`,
      name: `Jane Doe`,
      title: `Updated Issue 2`,
    })

    // Delete an issue
    act(() => {
      emitter.emit(`sync-issue`, [
        {
          key: `3`,
          type: `delete`,
        },
      ])
    })

    await waitForChanges()

    // After deletion, user 3 should no longer have a joined result
    expect(result.current.state.get(`3`)).toBeUndefined()
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
    act(() => {
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )
    })

    const { result, rerender } = renderHook(
      ({ minAge }: { minAge: number }) => {
        return useLiveQuery(
          (q) =>
            q
              .from({ collection })
              .where(`@age`, `>`, minAge)
              .keyBy(`@id`)
              .select(`@id`, `@name`, `@age`),
          [minAge]
        )
      },
      { initialProps: { minAge: 30 } }
    )

    // Initially should return only people older than 30
    expect(result.current.state.size).toBe(1)
    expect(result.current.state.get(`3`)).toEqual({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change the parameter to include more people
    act(() => {
      rerender({ minAge: 20 })
    })

    await waitForChanges()

    // Now should return all people as they're all older than 20
    expect(result.current.state.size).toBe(3)
    expect(result.current.state.get(`1`)).toEqual({
      id: `1`,
      name: `John Doe`,
      age: 30,
    })
    expect(result.current.state.get(`2`)).toEqual({
      id: `2`,
      name: `Jane Doe`,
      age: 25,
    })
    expect(result.current.state.get(`3`)).toEqual({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })

    // Change to exclude everyone
    act(() => {
      rerender({ minAge: 50 })
    })

    await waitForChanges()

    // Should now be empty
    expect(result.current.state.size).toBe(0)
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
      deps: Array<unknown>
    ): T {
      console.log(`Creating new query with deps`, deps.join(`,`))
      const result = useLiveQuery(queryFn, deps)

      // Will be called during cleanup
      useEffect(() => {
        return () => {
          console.log(`Stopping query with deps`, deps.join(`,`))
        }
      }, deps)

      return result as T
    }

    // Sync initial state
    act(() => {
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )
    })

    const { rerender } = renderHook(
      ({ minAge }: { minAge: number }) => {
        return useTrackedLiveQuery(
          (q) =>
            q
              .from({ collection })
              .where(`@age`, `>`, minAge)
              .keyBy(`@id`)
              .select(`@id`, `@name`),
          [minAge]
        )
      },
      { initialProps: { minAge: 30 } }
    )

    // Initial query should be created
    expect(
      logCalls.some((call) => call.includes(`Creating new query with deps 30`))
    ).toBe(true)

    // Clear log calls
    logCalls = []

    // Change the parameter
    act(() => {
      rerender({ minAge: 25 })
    })

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
    act(() => {
      emitter.emit(
        `sync`,
        initialPersons.map((person) => ({
          key: person.id,
          type: `insert`,
          changes: person,
        }))
      )
    })

    // Initial query
    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(`@age`, `>`, 30)
          .keyBy(`@id`)
          .select(`@id`, `@name`, `@team`)
          .orderBy({ "@id": `asc` })
      )
    })

    // Grouped query derived from initial query
    const { result: groupedResult } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ queryResult: result.current.collection })
          .groupBy(`@team`)
          .keyBy(`@team`)
          .select(`@team`, { count: { COUNT: `@id` } })
      )
    })

    // Verify initial grouped results
    expect(groupedResult.current.state.size).toBe(1)
    expect(groupedResult.current.state.get(`team1`)).toEqual({
      team: `team1`,
      count: 1,
    })

    // Insert two new users in different teams
    act(() => {
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
    })

    await waitForChanges()

    // Verify the grouped results include the new team members
    expect(groupedResult.current.state.size).toBe(2)
    expect(groupedResult.current.state.get(`team1`)).toEqual({
      team: `team1`,
      count: 2,
    })
    expect(groupedResult.current.state.get(`team2`)).toEqual({
      team: `team2`,
      count: 1,
    })
  })
})

async function waitForChanges(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
