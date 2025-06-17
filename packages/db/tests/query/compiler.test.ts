import { describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Query } from "../../src/query/schema.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
}

type Context = {
  baseSchema: {
    users: User
  }
  schema: {
    users: User
  }
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

describe(`Query`, () => {
  describe(`Compiler`, () => {
    test(`basic select with all columns`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@age`, `@email`, `@active`],
        from: `users`,
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQueryPipeline(query, { [query.from]: input })

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

      // Check the structure of the results
      const results = collection.getInner().map(([data]) => data)

      // The results should contain objects with only the selected columns
      expect(results).toContainEqual([
        1,
        {
          id: 1,
          name: `Alice`,
          age: 25,
          email: `alice@example.com`,
          active: true,
        },
      ])
    })

    test(`select with aliased columns`, () => {
      const query: Query<Context> = {
        select: [`@id`, { user_name: `@name` }, { years_old: `@age` }],
        from: `users`,
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQueryPipeline(query, { [query.from]: input })

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

      // The results should contain objects with only the selected columns and aliases
      expect(results).toContainEqual([
        1,
        {
          id: 1,
          user_name: `Alice`,
          years_old: 25,
        },
      ])

      // Check that all users are included and have the correct structure
      expect(results).toHaveLength(4)
      results.forEach(([_key, result]) => {
        expect(Object.keys(result).sort()).toEqual(
          [`id`, `user_name`, `years_old`].sort()
        )
      })
    })

    test(`select with where clause`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@age`],
        from: `users`,
        where: [[`@age`, `>`, 20]],
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQueryPipeline(query, { [query.from]: input })

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

    test(`select with where clause using multiple conditions`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`],
        from: `users`,
        where: [[`@age`, `>`, 20, `and`, `@active`, `=`, true]],
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQueryPipeline(query, { [query.from]: input })

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

      // Should only include users with age > 20 AND active = true
      expect(results).toHaveLength(2) // Alice and Dave

      // Check that specific users are included
      const includedIds = results.map(([_key, r]) => r.id).sort()
      expect(includedIds).toEqual([1, 4]) // Alice and Dave
    })
  })
})
