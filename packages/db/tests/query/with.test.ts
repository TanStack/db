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
  describe(`Common Table Expressions (WITH clause)`, () => {
    test(`basic CTE usage`, () => {
      // Define a query with a single CTE
      const query: Query<
        Context & {
          baseSchema: {
            users: User
            adult_users: User
          }
        }
      > = {
        with: [
          {
            select: [`@id`, `@name`, `@age`],
            from: `users`,
            where: [[`@age`, `>`, 20]],
            as: `adult_users`,
          },
        ],
        select: [`@id`, `@name`],
        from: `adult_users`,
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQueryPipeline(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send data to the input
      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      // Run the graph
      graph.run()

      // Check the results
      const results = messages[0]!.getInner().map(([data]) => data[1])

      // Should only include users over 20
      expect(results).toHaveLength(3)
      expect(results).toContainEqual({ id: 1, name: `Alice` })
      expect(results).toContainEqual({ id: 3, name: `Charlie` })
      expect(results).toContainEqual({ id: 4, name: `Dave` })
      expect(results).not.toContainEqual({ id: 2, name: `Bob` }) // Bob is 19
    })

    test(`multiple CTEs with references between them`, () => {
      // Define a query with multiple CTEs where the second references the first
      const query: Query<
        Context & {
          baseSchema: {
            users: User
            active_users: User
            active_adult_users: User
          }
        }
      > = {
        with: [
          {
            select: [`@id`, `@name`, `@age`],
            from: `users`,
            where: [[`@active`, `=`, true]],
            as: `active_users`,
          },
          {
            select: [`@id`, `@name`, `@age`],
            from: `active_users`,
            where: [[`@age`, `>`, 20]],
            as: `active_adult_users`,
          },
        ],
        select: [`@id`, `@name`],
        from: `active_adult_users`,
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQueryPipeline(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send data to the input
      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      // Run the graph
      graph.run()

      // Check the results
      const results = messages[0]!.getInner().map(([data]) => data[1])

      // Should only include active users over 20
      expect(results).toHaveLength(2)
      expect(results).toContainEqual({ id: 1, name: `Alice` }) // Active and 25
      expect(results).toContainEqual({ id: 4, name: `Dave` }) // Active and 22
      expect(results).not.toContainEqual({ id: 2, name: `Bob` }) // Active but 19
      expect(results).not.toContainEqual({ id: 3, name: `Charlie` }) // 30 but not active
    })

    test(`error handling - CTE without as property`, () => {
      // Define an invalid query with a CTE missing the 'as' property
      const invalidQuery = {
        with: [
          {
            select: [`@id`, `@name`],
            from: `users`,
            // Missing 'as' property
          },
        ],
        select: [`@id`, `@name`],
        from: `adult_users`,
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()

      // Should throw an error because the CTE is missing the 'as' property
      expect(() => {
        compileQueryPipeline(invalidQuery as any, { users: input })
      }).toThrow(`WITH query must have an "as" property`)
    })

    test(`error handling - duplicate CTE names`, () => {
      // Define an invalid query with duplicate CTE names
      const invalidQuery = {
        with: [
          {
            select: [`@id`, `@name`],
            from: `users`,
            where: [[`@age`, `>`, 20]],
            as: `filtered_users`,
          },
          {
            select: [`@id`, `@name`],
            from: `users`,
            where: [[`@active`, `=`, true]],
            as: `filtered_users`, // Duplicate name
          },
        ],
        select: [`@id`, `@name`],
        from: `filtered_users`,
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()

      // Should throw an error because of duplicate CTE names
      expect(() => {
        compileQueryPipeline(invalidQuery as any, { users: input })
      }).toThrow(`CTE with name "filtered_users" already exists`)
    })

    test(`error handling - reference to non-existent CTE`, () => {
      // Define an invalid query that references a non-existent CTE
      const invalidQuery = {
        with: [
          {
            select: [`@id`, `@name`],
            from: `users`,
            where: [[`@age`, `>`, 20]],
            as: `adult_users`,
          },
        ],
        select: [`@id`, `@name`],
        from: `non_existent_cte`, // This CTE doesn't exist
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()

      // Should throw an error because the referenced CTE doesn't exist
      expect(() => {
        compileQueryPipeline(invalidQuery as any, { users: input })
      }).toThrow(`Input for table "non_existent_cte" not found in inputs map`)
    })
  })
})
