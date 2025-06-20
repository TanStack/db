import { describe, expect, it } from "vitest"
import mitt from "mitt"
import { createCollection } from "../../src/collection.js"
import { queryBuilder } from "../../src/query/query-builder.js"
import { compileQuery } from "../../src/query/compiled-query.js"
import { createTransaction } from "../../src/transactions.js"
import type { PendingMutation } from "../../src/types.js"

type Person = {
  id: string
  name: string
  age: number | null
  email: string
  isActive: boolean
  createdAt?: Date
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
    createdAt: new Date(`2024-01-02`),
  },
  {
    id: `2`,
    name: `Jane Doe`,
    age: 25,
    email: `jane.doe@example.com`,
    isActive: true,
    createdAt: new Date(`2024-01-01`),
  },
  {
    id: `3`,
    name: `John Smith`,
    age: 35,
    email: `john.smith@example.com`,
    isActive: false,
    createdAt: new Date(`2024-01-03`),
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
    const collection = createCollection<Person>({
      id: `optimistic-changes-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Listen for sync events
          emitter.on(`sync`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    const query = queryBuilder()
      .from({ collection })
      .where(`@age`, `>`, 30)
      .select(`@id`, `@name`)

    const compiledQuery = compileQuery(query)

    compiledQuery.start()

    const result = compiledQuery.results

    expect(result.state.size).toBe(1)
    expect(result.state.get(`3`)).toEqual({
      _key: `3`,
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

    expect(result.state.size).toBe(2)
    expect(result.state.get(`3`)).toEqual({
      _key: `3`,
      id: `3`,
      name: `John Smith`,
    })
    expect(result.state.get(`4`)).toEqual({
      _key: `4`,
      id: `4`,
      name: `Kyle Doe`,
    })

    // Update the person
    emitter.emit(`sync`, [
      {
        type: `update`,
        changes: {
          id: `4`,
          name: `Kyle Doe 2`,
        },
      },
    ])

    await waitForChanges()

    expect(result.state.size).toBe(2)
    expect(result.state.get(`4`)).toEqual({
      _key: `4`,
      id: `4`,
      name: `Kyle Doe 2`,
    })

    // Delete the person
    emitter.emit(`sync`, [
      {
        type: `delete`,
        changes: {
          id: `4`,
        },
      },
    ])

    await waitForChanges()

    expect(result.state.size).toBe(1)
    expect(result.state.get(`4`)).toBeUndefined()
  })

  it(`should handle deletes`, async () => {
    const emitter = mitt()

    // Create collection with mutation capability
    const collection = createCollection<Person>({
      id: `optimistic-changes-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Listen for sync events
          emitter.on(`sync`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    const query = queryBuilder().from({ person: collection })

    const compiledQuery = compileQuery(query)

    compiledQuery.start()

    const result = compiledQuery.results

    expect(result.state.size).toBe(3)
    expect(result.state.get(`3`)).toEqual({
      _key: `3`,
      age: 35,
      email: `john.smith@example.com`,
      id: `3`,
      isActive: false,
      name: `John Smith`,
      createdAt: new Date(`2024-01-03`),
    })

    // Insert a new person and then delete it
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
      {
        type: `delete`,
        changes: {
          id: `4`,
        },
      },
      {
        key: `5`,
        type: `insert`,
        changes: {
          id: `5`,
          name: `Kyle Doe5`,
          age: 40,
          email: `kyle.doe@example.com`,
          isActive: true,
        },
      },
      {
        type: `update`,
        changes: {
          id: `5`,
          name: `Kyle Doe 5`,
        },
      },
    ])

    await waitForChanges()

    expect(result.state.size).toBe(4)
    expect(result.asStoreArray().state.length).toBe(4)
    expect(result.state.get(`4`)).toBeUndefined()
  })

  it(`should be able to query a collection without a select using a callback for the where clause`, async () => {
    const emitter = mitt()

    // Create collection with mutation capability
    const collection = createCollection<Person>({
      id: `optimistic-changes-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Listen for sync events
          emitter.on(`sync`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    const query = queryBuilder()
      .from({ person: collection })
      .where(({ person }) => (person.age ?? 0) > 30)

    const compiledQuery = compileQuery(query)

    compiledQuery.start()

    const result = compiledQuery.results

    expect(result.state.size).toBe(1)
    expect(result.state.get(`3`)).toEqual({
      _key: `3`,
      age: 35,
      email: `john.smith@example.com`,
      id: `3`,
      isActive: false,
      name: `John Smith`,
      createdAt: new Date(`2024-01-03`),
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

    expect(result.state.size).toBe(2)
    expect(result.state.get(`3`)).toEqual({
      _key: `3`,
      age: 35,
      email: `john.smith@example.com`,
      id: `3`,
      isActive: false,
      name: `John Smith`,
      createdAt: new Date(`2024-01-03`),
    })
    expect(result.state.get(`4`)).toEqual({
      _key: `4`,
      age: 40,
      email: `kyle.doe@example.com`,
      id: `4`,
      isActive: true,
      name: `Kyle Doe`,
    })

    // Update the person
    emitter.emit(`sync`, [
      {
        type: `update`,
        changes: {
          id: `4`,
          name: `Kyle Doe 2`,
        },
      },
    ])

    await waitForChanges()

    expect(result.state.size).toBe(2)
    expect(result.state.get(`4`)).toEqual({
      _key: `4`,
      age: 40,
      email: `kyle.doe@example.com`,
      id: `4`,
      isActive: true,
      name: `Kyle Doe 2`,
    })

    // Delete the person
    emitter.emit(`sync`, [
      {
        type: `delete`,
        changes: {
          id: `4`,
        },
      },
    ])

    await waitForChanges()

    expect(result.state.size).toBe(1)
    expect(result.asStoreArray().state.length).toBe(1)
    expect(result.state.get(`4`)).toBeUndefined()
  })

  it(`should join collections and return combined results`, async () => {
    const emitter = mitt()

    // Create person collection
    const personCollection = createCollection<Person>({
      id: `person-collection-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          emitter.on(`sync-person`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
    const issueCollection = createCollection<Issue>({
      id: `issue-collection-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          emitter.on(`sync-issue`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    // Sync initial issue data
    emitter.emit(
      `sync-issue`,
      initialIssues.map((issue) => ({
        type: `insert`,
        changes: issue,
      }))
    )

    // Create a query with a join between persons and issues
    const query = queryBuilder()
      .from({ issues: issueCollection })
      .join({
        type: `inner`,
        from: { persons: personCollection },
        on: [`@persons.id`, `=`, `@issues.userId`],
      })
      .select(`@issues.id`, `@issues.title`, `@persons.name`)

    const compiledQuery = compileQuery(query)
    compiledQuery.start()

    const result = compiledQuery.results

    await waitForChanges()

    // Verify that we have the expected joined results
    expect(result.state.size).toBe(3)

    expect(result.state.get(`[1,1]`)).toEqual({
      _key: `[1,1]`,
      id: `1`,
      name: `John Doe`,
      title: `Issue 1`,
    })

    expect(result.state.get(`[2,2]`)).toEqual({
      _key: `[2,2]`,
      id: `2`,
      name: `Jane Doe`,
      title: `Issue 2`,
    })

    expect(result.state.get(`[3,1]`)).toEqual({
      _key: `[3,1]`,
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

    expect(result.state.size).toBe(4)
    expect(result.state.get(`[4,2]`)).toEqual({
      _key: `[4,2]`,
      id: `4`,
      name: `Jane Doe`,
      title: `Issue 4`,
    })

    // Update an issue we're already joined with
    emitter.emit(`sync-issue`, [
      {
        type: `update`,
        changes: {
          id: `2`,
          title: `Updated Issue 2`,
        },
      },
    ])

    await waitForChanges()

    // The updated title should be reflected in the joined results
    expect(result.state.get(`[2,2]`)).toEqual({
      _key: `[2,2]`,
      id: `2`,
      name: `Jane Doe`,
      title: `Updated Issue 2`,
    })

    // Delete an issue
    emitter.emit(`sync-issue`, [
      {
        changes: { id: `3` },
        type: `delete`,
      },
    ])

    await waitForChanges()

    // After deletion, user 3 should no longer have a joined result
    expect(result.state.get(`[3,1]`)).toBeUndefined()
  })

  it(`should join collections and return combined results with no select`, async () => {
    const emitter = mitt()

    // Create person collection
    const personCollection = createCollection<Person>({
      id: `person-collection-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          emitter.on(`sync-person`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
    const issueCollection = createCollection<Issue>({
      id: `issue-collection-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          emitter.on(`sync-issue`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    // Sync initial issue data
    emitter.emit(
      `sync-issue`,
      initialIssues.map((issue) => ({
        type: `insert`,
        changes: issue,
      }))
    )

    // Create a query with a join between persons and issues
    const query = queryBuilder()
      .from({ issues: issueCollection })
      .join({
        type: `inner`,
        from: { persons: personCollection },
        on: [`@persons.id`, `=`, `@issues.userId`],
      })

    const compiledQuery = compileQuery(query)
    compiledQuery.start()

    const result = compiledQuery.results

    await waitForChanges()

    // Verify that we have the expected joined results
    expect(result.state.size).toBe(3)

    expect(result.state.get(`[1,1]`)).toEqual({
      _key: `[1,1]`,
      issues: {
        description: `Issue 1 description`,
        id: `1`,
        title: `Issue 1`,
        userId: `1`,
      },
      persons: {
        age: 30,
        email: `john.doe@example.com`,
        id: `1`,
        isActive: true,
        name: `John Doe`,
        createdAt: new Date(`2024-01-02`),
      },
    })

    expect(result.state.get(`[2,2]`)).toEqual({
      _key: `[2,2]`,
      issues: {
        description: `Issue 2 description`,
        id: `2`,
        title: `Issue 2`,
        userId: `2`,
      },
      persons: {
        age: 25,
        email: `jane.doe@example.com`,
        id: `2`,
        isActive: true,
        name: `Jane Doe`,
        createdAt: new Date(`2024-01-01`),
      },
    })

    expect(result.state.get(`[3,1]`)).toEqual({
      _key: `[3,1]`,
      issues: {
        description: `Issue 3 description`,
        id: `3`,
        title: `Issue 3`,
        userId: `1`,
      },
      persons: {
        age: 30,
        email: `john.doe@example.com`,
        id: `1`,
        isActive: true,
        name: `John Doe`,
        createdAt: new Date(`2024-01-02`),
      },
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

    expect(result.state.size).toBe(4)
    expect(result.state.get(`[4,2]`)).toEqual({
      _key: `[4,2]`,
      issues: {
        description: `Issue 4 description`,
        id: `4`,
        title: `Issue 4`,
        userId: `2`,
      },
      persons: {
        age: 25,
        email: `jane.doe@example.com`,
        id: `2`,
        isActive: true,
        name: `Jane Doe`,
        createdAt: new Date(`2024-01-01`),
      },
    })

    // Update an issue we're already joined with
    emitter.emit(`sync-issue`, [
      {
        type: `update`,
        changes: {
          id: `2`,
          title: `Updated Issue 2`,
        },
      },
    ])

    await waitForChanges()

    // The updated title should be reflected in the joined results
    expect(result.state.get(`[2,2]`)).toEqual({
      _key: `[2,2]`,
      issues: {
        description: `Issue 2 description`,
        id: `2`,
        title: `Updated Issue 2`,
        userId: `2`,
      },
      persons: {
        age: 25,
        email: `jane.doe@example.com`,
        id: `2`,
        isActive: true,
        name: `Jane Doe`,
        createdAt: new Date(`2024-01-01`),
      },
    })

    // Delete an issue
    emitter.emit(`sync-issue`, [
      {
        changes: { id: `3` },
        type: `delete`,
      },
    ])

    await waitForChanges()

    // After deletion, user 3 should no longer have a joined result
    expect(result.state.get(`[3,1]`)).toBeUndefined()
  })

  it(`should order results by specified fields`, async () => {
    const emitter = mitt()

    // Create collection with mutation capability
    const collection = createCollection<Person>({
      id: `order-by-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          emitter.on(`sync`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    // Test ascending order by age
    const ascendingQuery = queryBuilder()
      .from({ collection })
      .orderBy(`@age`)
      .select(`@id`, `@name`, `@age`)

    const compiledAscendingQuery = compileQuery(ascendingQuery)
    compiledAscendingQuery.start()

    const ascendingResult = compiledAscendingQuery.results

    await waitForChanges()

    // Verify ascending order
    const ascendingArray = Array.from(ascendingResult.toArray)
    expect(ascendingArray).toEqual([
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 0 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 30, _orderByIndex: 1 },
      { _key: `3`, id: `3`, name: `John Smith`, age: 35, _orderByIndex: 2 },
    ])

    // Test descending order by age
    const descendingQuery = queryBuilder()
      .from({ collection })
      .orderBy({ "@age": `desc` })
      .select(`@id`, `@name`, `@age`)

    const compiledDescendingQuery = compileQuery(descendingQuery)
    compiledDescendingQuery.start()

    const descendingResult = compiledDescendingQuery.results

    await waitForChanges()

    // Verify descending order
    const descendingArray = Array.from(descendingResult.toArray)
    expect(descendingArray).toEqual([
      { _key: `3`, id: `3`, name: `John Smith`, age: 35, _orderByIndex: 0 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 30, _orderByIndex: 1 },
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 2 },
    ])

    // Test descending order by name
    const descendingNameQuery = queryBuilder()
      .from({ collection })
      .orderBy({ "@name": `desc` })
      .select(`@id`, `@name`, `@age`)

    const compiledDescendingNameQuery = compileQuery(descendingNameQuery)
    compiledDescendingNameQuery.start()

    const descendingNameResult = compiledDescendingNameQuery.results

    await waitForChanges()

    // Verify descending order by name
    const descendingNameArray = Array.from(descendingNameResult.toArray)
    expect(descendingNameArray).toEqual([
      { _key: `3`, id: `3`, name: `John Smith`, age: 35, _orderByIndex: 0 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 30, _orderByIndex: 1 },
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 2 },
    ])

    // Test reverse chronological order by createdAt
    const reverseChronologicalQuery = queryBuilder()
      .from({ collection })
      .orderBy({ "@createdAt": `desc` })
      .select(`@id`, `@name`, `@createdAt`)

    const compiledReverseChronologicalQuery = compileQuery(
      reverseChronologicalQuery
    )
    compiledReverseChronologicalQuery.start()

    const reverseChronologicalResult = compiledReverseChronologicalQuery.results

    await waitForChanges()

    // Verify reverse chronological order
    const reverseChronologicalArray = Array.from(
      reverseChronologicalResult.toArray
    )
    expect(reverseChronologicalArray).toEqual([
      {
        _key: `3`,
        id: `3`,
        name: `John Smith`,
        createdAt: new Date(`2024-01-03`),
        _orderByIndex: 0,
      },
      {
        _key: `1`,
        id: `1`,
        name: `John Doe`,
        createdAt: new Date(`2024-01-02`),
        _orderByIndex: 1,
      },
      {
        _key: `2`,
        id: `2`,
        name: `Jane Doe`,
        createdAt: new Date(`2024-01-01`),
        _orderByIndex: 2,
      },
    ])

    // Test multiple order by fields
    const multiOrderQuery = queryBuilder()
      .from({ collection })
      .orderBy([`@isActive`, { "@name": `desc` }])
      .select(`@id`, `@name`, `@age`, `@isActive`)

    const compiledMultiOrderQuery = compileQuery(multiOrderQuery)
    compiledMultiOrderQuery.start()

    const multiOrderResult = compiledMultiOrderQuery.results

    await waitForChanges()

    // Verify multiple field ordering
    const multiOrderArray = Array.from(multiOrderResult.toArray)
    expect(multiOrderArray).toEqual([
      {
        _key: `3`,
        id: `3`,
        name: `John Smith`,
        age: 35,
        isActive: false,
        _orderByIndex: 0,
      },
      {
        _key: `1`,
        id: `1`,
        name: `John Doe`,
        age: 30,
        isActive: true,
        _orderByIndex: 1,
      },
      {
        _key: `2`,
        id: `2`,
        name: `Jane Doe`,
        age: 25,
        isActive: true,
        _orderByIndex: 2,
      },
    ])
  })

  it(`should maintain correct ordering when items are added, updated, or deleted`, async () => {
    const emitter = mitt()

    // Create collection with mutation capability
    const collection = createCollection<Person>({
      id: `order-update-test`,
      getKey: (val) => val.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          emitter.on(`sync`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    // Create a query that orders by age in ascending order
    const query = queryBuilder()
      .from({ collection })
      .orderBy(`@age`)
      .select(`@id`, `@name`, `@age`)

    const compiledQuery = compileQuery(query)
    compiledQuery.start()

    await waitForChanges()

    // Verify initial ordering
    let currentOrder = Array.from(compiledQuery.results.toArray)
    expect(currentOrder).toEqual([
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 0 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 30, _orderByIndex: 1 },
      { _key: `3`, id: `3`, name: `John Smith`, age: 35, _orderByIndex: 2 },
    ])

    // Add a new person with the youngest age
    emitter.emit(`sync`, [
      {
        type: `insert`,
        changes: {
          id: `4`,
          name: `Alice Young`,
          age: 22,
          email: `alice.young@example.com`,
          isActive: true,
        },
      },
    ])

    await waitForChanges()

    // Verify order is updated with the new person at the beginning
    currentOrder = Array.from(compiledQuery.results.toArray)
    expect(currentOrder).toEqual([
      { _key: `4`, id: `4`, name: `Alice Young`, age: 22, _orderByIndex: 0 },
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 1 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 30, _orderByIndex: 2 },
      { _key: `3`, id: `3`, name: `John Smith`, age: 35, _orderByIndex: 3 },
    ])

    // Update a person's age to move them in the ordering
    emitter.emit(`sync`, [
      {
        type: `update`,
        changes: {
          id: `1`,
          age: 40, // Update John Doe to be the oldest
        },
      },
    ])

    await waitForChanges()

    // Verify order is updated with John Doe now at the end
    currentOrder = Array.from(compiledQuery.results.toArray)
    expect(currentOrder).toEqual([
      { _key: `4`, id: `4`, name: `Alice Young`, age: 22, _orderByIndex: 0 },
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 1 },
      { _key: `3`, id: `3`, name: `John Smith`, age: 35, _orderByIndex: 2 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 40, _orderByIndex: 3 },
    ])

    // Add a new person with age null
    emitter.emit(`sync`, [
      {
        type: `insert`,
        changes: {
          id: `5`,
          name: `Bob Null`,
          age: null,
          email: `bob.null@example.com`,
          isActive: true,
        },
      },
    ])

    await waitForChanges()

    // Verify order is updated with Bob Null at the end
    currentOrder = Array.from(compiledQuery.results.toArray)
    expect(currentOrder).toEqual([
      { _key: `5`, id: `5`, name: `Bob Null`, age: null, _orderByIndex: 0 },
      { _key: `4`, id: `4`, name: `Alice Young`, age: 22, _orderByIndex: 1 },
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 2 },
      { _key: `3`, id: `3`, name: `John Smith`, age: 35, _orderByIndex: 3 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 40, _orderByIndex: 4 },
    ])

    // Delete a person in the middle of the ordering
    emitter.emit(`sync`, [
      {
        changes: { id: `3` },
        type: `delete`,
      },
    ])

    await waitForChanges()

    // Verify order is updated with John Smith removed
    currentOrder = Array.from(compiledQuery.results.toArray)
    expect(currentOrder).toEqual([
      { _key: `5`, id: `5`, name: `Bob Null`, age: null, _orderByIndex: 0 },
      { _key: `4`, id: `4`, name: `Alice Young`, age: 22, _orderByIndex: 1 },
      { _key: `2`, id: `2`, name: `Jane Doe`, age: 25, _orderByIndex: 2 },
      { _key: `1`, id: `1`, name: `John Doe`, age: 40, _orderByIndex: 3 },
    ])
  })

  it(`optimistic state is dropped after commit`, async () => {
    const emitter = mitt()

    // Create person collection
    const personCollection = createCollection<Person>({
      id: `person-collection-test-bug`,
      getKey: (val) => val.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // @ts-expect-error Mitt typing doesn't match our usage
          emitter.on(`sync-person`, (changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
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
    const issueCollection = createCollection<Issue>({
      id: `issue-collection-test-bug`,
      getKey: (val) => val.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // @ts-expect-error Mitt typing doesn't match our usage
          emitter.on(`sync-issue`, (changes: Array<PendingMutation>) => {
            begin()
            changes.forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    // Sync initial issue data
    emitter.emit(
      `sync-issue`,
      initialIssues.map((issue) => ({
        type: `insert`,
        changes: issue,
      }))
    )

    // Create a query with a join between persons and issues
    const query = queryBuilder()
      .from({ issues: issueCollection })
      .join({
        type: `inner`,
        from: { persons: personCollection },
        on: [`@persons.id`, `=`, `@issues.userId`],
      })
      .select(`@issues.id`, `@issues.title`, `@persons.name`)

    const compiledQuery = compileQuery(query)
    compiledQuery.start()

    const result = compiledQuery.results

    await waitForChanges()

    // Verify initial state
    expect(result.state.size).toBe(3)

    // Create a transaction to perform an optimistic mutation
    const tx = createTransaction({
      mutationFn: async () => {
        emitter.emit(`sync-issue`, [
          {
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
      issueCollection.insert({
        id: `temp-key`,
        title: `New Issue`,
        description: `New Issue Description`,
        userId: `1`,
      })
    )

    // Verify optimistic state is immediately reflected
    expect(result.state.size).toBe(4)

    // `[temp-key,1]` is the optimistic state for the new issue, its a composite key
    // from the join in the query
    expect(result.state.get(`[temp-key,1]`)).toEqual({
      id: `temp-key`,
      _key: `[temp-key,1]`,
      name: `John Doe`,
      title: `New Issue`,
    })

    // `[4,1]` would be the synced state for the new issue, but it's not in the
    // optimistic state because the transaction synced back yet
    expect(result.state.get(`[4,1]`)).toBeUndefined()

    // Wait for the transaction to be committed
    await tx.isPersisted.promise

    expect(result.state.size).toBe(4)
    expect(result.state.get(`[temp-key,1]`)).toBeUndefined()
    expect(result.state.get(`[4,1]`)).toBeDefined()
  })

  it(`should transform data using a select callback`, async () => {
    const emitter = mitt()

    // Create collection with mutation capability
    const collection = createCollection<Person>({
      id: `select-callback-test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Listen for sync events
          emitter.on(`sync`, (changes) => {
            begin()
            ;(changes as Array<PendingMutation>).forEach((change) => {
              write({
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
        type: `insert`,
        changes: person,
      }))
    )

    const query = queryBuilder()
      .from({ collection })
      .select(({ collection: result }) => {
        return {
          displayName: `${result.name} (Age: ${result.age})`,
          status: result.isActive ? `Active` : `Inactive`,
          ageGroup: result.age
            ? result.age < 30
              ? `Young`
              : result.age < 40
                ? `Middle`
                : `Senior`
            : `missing age`,
          emailDomain: result.email.split(`@`)[1],
        }
      })

    const compiledQuery = compileQuery(query)

    compiledQuery.start()

    const result = compiledQuery.results

    await waitForChanges()

    expect(result.state.size).toBe(3)

    // Verify transformed data for John Doe
    expect(result.state.get(`1`)).toEqual({
      _key: `1`,
      displayName: `John Doe (Age: 30)`,
      status: `Active`,
      ageGroup: `Middle`,
      emailDomain: `example.com`,
    })

    // Verify transformed data for Jane Doe
    expect(result.state.get(`2`)).toEqual({
      _key: `2`,
      displayName: `Jane Doe (Age: 25)`,
      status: `Active`,
      ageGroup: `Young`,
      emailDomain: `example.com`,
    })

    // Verify transformed data for John Smith
    expect(result.state.get(`3`)).toEqual({
      _key: `3`,
      displayName: `John Smith (Age: 35)`,
      status: `Inactive`,
      ageGroup: `Middle`,
      emailDomain: `example.com`,
    })

    // Insert a new person and verify transformation
    emitter.emit(`sync`, [
      {
        key: `4`,
        type: `insert`,
        changes: {
          id: `4`,
          name: `Senior Person`,
          age: 65,
          email: `senior@company.org`,
          isActive: true,
        },
      },
    ])

    await waitForChanges()

    expect(result.state.size).toBe(4)
    expect(result.state.get(`4`)).toEqual({
      _key: `4`,
      displayName: `Senior Person (Age: 65)`,
      status: `Active`,
      ageGroup: `Senior`,
      emailDomain: `company.org`,
    })

    // Update a person and verify transformation updates
    emitter.emit(`sync`, [
      {
        type: `update`,
        changes: {
          id: `2`,
          isActive: false,
        },
      },
    ])

    await waitForChanges()

    // Verify the transformation reflects the update
    expect(result.state.get(`2`)).toEqual({
      _key: `2`,
      displayName: `Jane Doe (Age: 25)`,
      status: `Inactive`, // Should now be inactive
      ageGroup: `Young`,
      emailDomain: `example.com`,
    })
  })
})

async function waitForChanges(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
