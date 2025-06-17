import { describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Query } from "../../src/query/index.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
  joined_date: string
  preferences: string // JSON string for testing JSON_EXTRACT
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
  {
    id: 1,
    name: `Alice`,
    age: 25,
    email: `alice@example.com`,
    active: true,
    joined_date: `2023-01-15`,
    preferences: `{"theme":"dark","notifications":true,"language":"en"}`,
  },
  {
    id: 2,
    name: `Bob`,
    age: 19,
    email: `bob@example.com`,
    active: true,
    joined_date: `2023-02-20`,
    preferences: `{"theme":"light","notifications":false,"language":"fr"}`,
  },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
    joined_date: `2022-11-05`,
    preferences: `{"theme":"system","notifications":true,"language":"es"}`,
  },
  {
    id: 4,
    name: `Dave`,
    age: 22,
    email: `dave@example.com`,
    active: true,
    joined_date: `2023-03-10`,
    preferences: `{"theme":"dark","notifications":true,"language":"de"}`,
  },
]

describe(`Query Function Integration`, () => {
  /**
   * Helper function to run a query and return results
   */
  function runQuery(query: Query): Array<any> {
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

    // Return only the data (not the counts)
    if (messages.length === 0) return []

    return messages[0]!.getInner().map(([data]) => data)
  }

  describe(`String functions`, () => {
    test(`UPPER function`, () => {
      const query: Query<Context> = {
        select: [`@id`, { upper_name: { UPPER: `@name` } }],
        from: `users`,
      }

      const results = runQuery(query)

      expect(results).toHaveLength(4)
      expect(results).toContainEqual([
        1,
        {
          id: 1,
          upper_name: `ALICE`,
        },
      ])
      expect(results).toContainEqual([
        2,
        {
          id: 2,
          upper_name: `BOB`,
        },
      ])
    })

    test(`LOWER function`, () => {
      const query: Query<Context> = {
        select: [`@id`, { lower_email: { LOWER: `@email` } }],
        from: `users`,
      }

      const results = runQuery(query)

      expect(results).toHaveLength(4)
      expect(results).toContainEqual([
        1,
        {
          id: 1,
          lower_email: `alice@example.com`,
        },
      ])
    })

    test(`LENGTH function on string`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`, { name_length: { LENGTH: `@name` } }],
        from: `users`,
      }

      const results = runQuery(query)

      expect(results).toHaveLength(4)
      expect(results).toContainEqual([
        1,
        {
          id: 1,
          name: `Alice`,
          name_length: 5,
        },
      ])
      expect(results).toContainEqual([
        3,
        {
          id: 3,
          name: `Charlie`,
          name_length: 7,
        },
      ])
    })

    test(`CONCAT function`, () => {
      const query: Query<Context> = {
        select: [
          `@id`,
          { full_details: { CONCAT: [`@name`, ` (`, `@email`, `)`] } },
        ],
        from: `users`,
      }

      const results = runQuery(query)

      expect(results).toHaveLength(4)
      expect(results).toContainEqual([
        1,
        {
          id: 1,
          full_details: `Alice (alice@example.com)`,
        },
      ])
    })
  })

  describe(`Value processing functions`, () => {
    test(`COALESCE function`, () => {
      // For this test, create a query that would produce some null values
      const query: Query<Context> = {
        select: [
          `@id`,
          {
            status: {
              COALESCE: [
                {
                  CONCAT: [
                    {
                      UPPER: `@name`,
                    },
                    ` IS INACTIVE`,
                  ],
                },
                `UNKNOWN`,
              ],
            },
          },
        ],
        from: `users`,
        where: [[`@active`, `=`, false]],
      }

      const results = runQuery(query)

      expect(results).toHaveLength(1) // Only Charlie is inactive
      expect(results[0][1].status).toBe(`CHARLIE IS INACTIVE`)
    })

    test(`DATE function`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`, { joined: { DATE: `@joined_date` } }],
        from: `users`,
      }

      const results = runQuery(query)

      expect(results).toHaveLength(4)

      // Verify that each result has a joined field with a Date object
      results.forEach(([_, result]) => {
        expect(result.joined).toBeInstanceOf(Date)
      })

      // Check specific dates
      expect(results[0][0]).toBe(1) // Alice
      expect(results[0][1].joined.getFullYear()).toBe(2023)
      expect(results[0][1].joined.getMonth()).toBe(0) // January (0-indexed)
      expect(results[0][1].joined.getUTCDate()).toBe(15)
    })
  })

  describe(`JSON functions`, () => {
    test(`JSON_EXTRACT function`, () => {
      const query: Query<Context> = {
        select: [
          `@id`,
          `@name`,
          { theme: { JSON_EXTRACT: [`@preferences`, `theme`] } },
        ],
        from: `users`,
      }

      const results = runQuery(query)

      expect(results).toHaveLength(4)
      expect(results).toContainEqual([
        1,
        {
          id: 1,
          name: `Alice`,
          theme: `dark`,
        },
      ])
      expect(results).toContainEqual([
        2,
        {
          id: 2,
          name: `Bob`,
          theme: `light`,
        },
      ])
    })

    test(`JSON_EXTRACT_PATH function (alias)`, () => {
      const query: Query<Context> = {
        select: [
          `@id`,
          {
            notifications_enabled: {
              JSON_EXTRACT_PATH: [`@preferences`, `notifications`],
            },
          },
        ],
        from: `users`,
        where: [[`@active`, `=`, true]],
      }

      const results = runQuery(query)

      expect(results).toHaveLength(3) // Alice, Bob, Dave
      // Bob has notifications disabled
      expect(results).toContainEqual([
        2,
        {
          id: 2,
          notifications_enabled: false,
        },
      ])
      // Alice and Dave have notifications enabled
      expect(
        results.filter(([_, r]) => r.notifications_enabled === true).length
      ).toBe(2)
    })
  })

  describe(`Using functions in WHERE clauses`, () => {
    test(`Filter with UPPER function`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`],
        from: `users`,
        where: [[{ UPPER: `@name` }, `=`, `BOB`]],
      }

      const results = runQuery(query)

      expect(results).toHaveLength(1)
      expect(results[0][0]).toBe(2)
      expect(results[0][1].name).toBe(`Bob`)
    })

    test(`Filter with LENGTH function`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`],
        from: `users`,
        where: [[{ LENGTH: `@name` }, `>`, 5]],
      }

      const results = runQuery(query)

      expect(results).toHaveLength(1)
      expect(results[0][0]).toBe(3)
      expect(results[0][1].name).toBe(`Charlie`)
    })

    test(`Filter with JSON_EXTRACT function`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`],
        from: `users`,
        where: [[{ JSON_EXTRACT: [`@preferences`, `theme`] }, `=`, `dark`]],
      }

      const results = runQuery(query)

      expect(results).toHaveLength(2) // Alice and Dave
      expect(results.map(([id]) => id).sort()).toEqual([1, 4])
    })

    test(`Complex filter with multiple functions`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@email`],
        from: `users`,
        where: [
          [
            { LENGTH: `@name` },
            `<`,
            6,
            `and`,
            { JSON_EXTRACT_PATH: [`@preferences`, `notifications`] },
            `=`,
            true,
          ],
        ],
      }

      const results = runQuery(query)

      // It turns out both Alice and Dave match our criteria
      expect(results).toHaveLength(2)
      // Sort results by ID for consistent testing
      const sortedResults = [...results].sort((a, b) => a[1].id - b[1].id)

      // Check that Alice is included
      expect(sortedResults[0][0]).toBe(1)
      expect(sortedResults[0][1].name).toBe(`Alice`)

      // Check that Dave is included
      expect(sortedResults[1][0]).toBe(4)
      expect(sortedResults[1][1].name).toBe(`Dave`)

      // Verify that both users have name length < 6 and notifications enabled
      results.forEach(([_, result]) => {
        expect(result.name.length).toBeLessThan(6)
        // We could also verify the JSON data directly if needed
      })
    })
  })
})
