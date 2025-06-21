import { describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQuery } from "../../../src/query2/compiler/index.js"
import { CollectionRef, Func, Ref, Value } from "../../../src/query2/ir.js"
import type { Query } from "../../../src/query2/ir.js"
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
      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

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

      // Check the structure of the results - should be the raw user objects
      const results = collection.getInner().map(([data]) => data)
      expect(results).toContainEqual([1, sampleUsers[0]])
      expect(results).toContainEqual([2, sampleUsers[1]])
      expect(results).toContainEqual([3, sampleUsers[2]])
      expect(results).toContainEqual([4, sampleUsers[3]])
    })

    test(`compiles a simple SELECT query`, () => {
      const usersCollection = {
        id: `users`,
      } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          name: new Ref([`users`, `name`]),
          age: new Ref([`users`, `age`]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

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
        {
          id: 1,
          name: `Alice`,
          age: 25,
        },
      ])

      expect(results).toContainEqual([
        2,
        {
          id: 2,
          name: `Bob`,
          age: 19,
        },
      ])

      // Check that all users are included and have the correct structure
      expect(results).toHaveLength(4)
      results.forEach(([_key, result]) => {
        expect(Object.keys(result).sort()).toEqual([`id`, `name`, `age`].sort())
      })
    })

    test(`compiles a query with WHERE clause`, () => {
      const usersCollection = {
        id: `users`,
      } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          name: new Ref([`users`, `name`]),
          age: new Ref([`users`, `age`]),
        },
        where: new Func(`gt`, [new Ref([`users`, `age`]), new Value(20)]),
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

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
      results.forEach(([_key, result]) => {
        expect(result.age).toBeGreaterThan(20)
      })

      // Check that specific users are included
      const includedIds = results.map(([_key, r]) => r.id).sort()
      expect(includedIds).toEqual([1, 3, 4]) // Alice, Charlie, Dave
    })

    test(`compiles a query with complex WHERE clause`, () => {
      const usersCollection = {
        id: `users`,
      } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          name: new Ref([`users`, `name`]),
        },
        where: new Func(`and`, [
          new Func(`gt`, [new Ref([`users`, `age`]), new Value(20)]),
          new Func(`eq`, [new Ref([`users`, `active`]), new Value(true)]),
        ]),
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

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
      results.forEach(([_key, result]) => {
        const originalUser = sampleUsers.find((u) => u.id === result.id)!
        expect(originalUser.age).toBeGreaterThan(20)
        expect(originalUser.active).toBe(true)
      })

      // Check that specific users are included
      const includedIds = results.map(([_key, r]) => r.id).sort()
      expect(includedIds).toEqual([1, 4]) // Alice, Dave
    })
  })
})
