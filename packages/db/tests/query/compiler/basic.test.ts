import { describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@tanstack/db-ivm"
import { compileQuery } from "../../../src/query/compiler/index.js"
import { CollectionRef, Func, PropRef, Value } from "../../../src/query/ir.js"
import type { QueryIR } from "../../../src/query/ir.js"
import type { CollectionImpl } from "../../../src/collection.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
}

// Sample data for tests
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 25, email: `alice@example.com`, active: true },
  { id: 2, name: `Bob`, age: 19, email: `bob@example.com`, active: true },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
  },
  { id: 4, name: `Dave`, age: 22, email: `dave@example.com`, active: true },
]

describe(`Query2 Compiler`, () => {
  describe(`Basic Compilation`, () => {
    test(`compiles a simple FROM query`, () => {
      // Create a mock collection
      const usersCollection = {
        id: `users`,
      } as CollectionImpl

      // Create the IR query
      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `users`),
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const { pipeline } = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      // Check that we have 4 users in the result
      expect(messages).toHaveLength(1)

      const collection = messages[0]!
      expect(collection.getInner()).toHaveLength(4)

      // Check the structure of the results - should be the raw user objects in tuple format
      const results = collection.getInner().map(([data]) => data)
      expect(results).toContainEqual([1, [sampleUsers[0], undefined]])
      expect(results).toContainEqual([2, [sampleUsers[1], undefined]])
      expect(results).toContainEqual([3, [sampleUsers[2], undefined]])
      expect(results).toContainEqual([4, [sampleUsers[3], undefined]])
    })

    test(`compiles a simple SELECT query`, () => {
      const usersCollection = {
        id: `users`,
      } as CollectionImpl

      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new PropRef([`users`, `id`]),
          name: new PropRef([`users`, `name`]),
          age: new PropRef([`users`, `age`]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const { pipeline } = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      // Check the structure of the results
      const results = messages[0]!.getInner().map(([data]) => data)

      expect(results).toContainEqual([
        1,
        [
          {
            id: 1,
            name: `Alice`,
            age: 25,
          },
          undefined,
        ],
      ])

      expect(results).toContainEqual([
        2,
        [
          {
            id: 2,
            name: `Bob`,
            age: 19,
          },
          undefined,
        ],
      ])

      // Check that all users are included and have the correct structure
      expect(results).toHaveLength(4)
      results.forEach(([_key, [result, orderByIndex]]) => {
        expect(Object.keys(result).sort()).toEqual([`id`, `name`, `age`].sort())
        expect(orderByIndex).toBeUndefined()
      })
    })

    test(`compiles a query with WHERE clause`, () => {
      const usersCollection = {
        id: `users`,
      } as CollectionImpl

      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new PropRef([`users`, `id`]),
          name: new PropRef([`users`, `name`]),
          age: new PropRef([`users`, `age`]),
        },
        where: [new Func(`gt`, [new PropRef([`users`, `age`]), new Value(20)])],
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const { pipeline } = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      // Check the filtered results
      const results = messages[0]!.getInner().map(([data]) => data)

      // Should only include users with age > 20
      expect(results).toHaveLength(3) // Alice, Charlie, Dave

      // Check that all results have age > 20
      results.forEach(([_key, [result, orderByIndex]]) => {
        expect(result.age).toBeGreaterThan(20)
        expect(orderByIndex).toBeUndefined()
      })

      // Check that specific users are included
      const includedIds = results
        .map(([_key, [r, _orderByIndex]]) => r.id)
        .sort()
      expect(includedIds).toEqual([1, 3, 4]) // Alice, Charlie, Dave
    })

    test(`compiles a query with complex WHERE clause`, () => {
      const usersCollection = {
        id: `users`,
      } as CollectionImpl

      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new PropRef([`users`, `id`]),
          name: new PropRef([`users`, `name`]),
        },
        where: [
          new Func(`and`, [
            new Func(`gt`, [new PropRef([`users`, `age`]), new Value(20)]),
            new Func(`eq`, [new PropRef([`users`, `active`]), new Value(true)]),
          ]),
        ],
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const { pipeline } = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      // Check the filtered results
      const results = messages[0]!.getInner().map(([data]) => data)

      // Should only include active users with age > 20
      expect(results).toHaveLength(2) // Alice, Dave

      // Check that all results meet the criteria
      results.forEach(([_key, [result, orderByIndex]]) => {
        const originalUser = sampleUsers.find((u) => u.id === result.id)!
        expect(originalUser.age).toBeGreaterThan(20)
        expect(originalUser.active).toBe(true)
        expect(orderByIndex).toBeUndefined()
      })

      // Check that specific users are included
      const includedIds = results
        .map(([_key, [r, _orderByIndex]]) => r.id)
        .sort()
      expect(includedIds).toEqual([1, 4]) // Alice, Dave
    })
  })
})
