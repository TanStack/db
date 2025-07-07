import { describe, expect, it } from "vitest"
import { processArgument } from "../../../src/query/compiler/select.js"
import { Aggregate, Func, PropRef, Value } from "../../../src/query/ir.js"

describe(`select compiler`, () => {
  // Note: Most of the select compilation logic is tested through the full integration
  // tests in basic.test.ts and other compiler tests. Here we focus on the standalone
  // functions that can be tested in isolation.

  describe(`processArgument`, () => {
    it(`processes non-aggregate expressions correctly`, () => {
      const arg = new PropRef([`users`, `name`])
      const namespacedRow = { users: { name: `John` } }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(`John`)
    })

    it(`processes value expressions correctly`, () => {
      const arg = new Value(42)
      const namespacedRow = {}

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(42)
    })

    it(`processes function expressions correctly`, () => {
      const arg = new Func(`upper`, [new Value(`hello`)])
      const namespacedRow = {}

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(`HELLO`)
    })

    it(`throws error for aggregate expressions`, () => {
      const arg = new Aggregate(`count`, [new PropRef([`users`, `id`])])
      const namespacedRow = { users: { id: 1 } }

      expect(() => {
        processArgument(arg, namespacedRow)
      }).toThrow(
        `Aggregate expressions are not supported in this context. Use GROUP BY clause for aggregates.`
      )
    })

    it(`processes reference expressions from different tables`, () => {
      const arg = new PropRef([`orders`, `amount`])
      const namespacedRow = {
        users: { name: `John` },
        orders: { amount: 100.5 },
      }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(100.5)
    })

    it(`processes nested reference expressions`, () => {
      const arg = new PropRef([`profile`, `address`, `city`])
      const namespacedRow = {
        profile: {
          address: {
            city: `New York`,
          },
        },
      }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(`New York`)
    })

    it(`processes function expressions with references`, () => {
      const arg = new Func(`length`, [new PropRef([`users`, `name`])])
      const namespacedRow = { users: { name: `Alice` } }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(5)
    })

    it(`processes function expressions with multiple arguments`, () => {
      const arg = new Func(`concat`, [
        new PropRef([`users`, `firstName`]),
        new Value(` `),
        new PropRef([`users`, `lastName`]),
      ])
      const namespacedRow = {
        users: {
          firstName: `John`,
          lastName: `Doe`,
        },
      }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(`John Doe`)
    })

    it(`handles null and undefined values in references`, () => {
      const arg = new PropRef([`users`, `middleName`])
      const namespacedRow = { users: { name: `John`, middleName: null } }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(null)
    })

    it(`handles missing table references`, () => {
      const arg = new PropRef([`nonexistent`, `field`])
      const namespacedRow = { users: { name: `John` } }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(undefined)
    })

    it(`handles missing field references`, () => {
      const arg = new PropRef([`users`, `nonexistent`])
      const namespacedRow = { users: { name: `John` } }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(undefined)
    })

    it(`processes complex value expressions`, () => {
      const arg = new Value({ nested: { value: 42 } })
      const namespacedRow = {}

      const result = processArgument(arg, namespacedRow)
      expect(result).toEqual({ nested: { value: 42 } })
    })

    it(`processes boolean function expressions`, () => {
      const arg = new Func(`and`, [new Value(true), new Value(false)])
      const namespacedRow = {}

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(false)
    })

    it(`processes comparison function expressions`, () => {
      const arg = new Func(`gt`, [new PropRef([`users`, `age`]), new Value(18)])
      const namespacedRow = { users: { age: 25 } }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(true)
    })

    it(`processes mathematical function expressions`, () => {
      const arg = new Func(`add`, [
        new PropRef([`order`, `subtotal`]),
        new PropRef([`order`, `tax`]),
      ])
      const namespacedRow = {
        order: {
          subtotal: 100,
          tax: 8.5,
        },
      }

      const result = processArgument(arg, namespacedRow)
      expect(result).toBe(108.5)
    })
  })

  describe(`helper functions`, () => {
    // Test the helper function that can be imported and tested directly
    it(`correctly identifies aggregate expressions`, () => {
      // This test would require accessing the isAggregateExpression function
      // which is private. Since we can't test it directly, we test it indirectly
      // through the processArgument function's error handling.

      const aggregateExpressions = [
        new Aggregate(`count`, [new PropRef([`users`, `id`])]),
        new Aggregate(`sum`, [new PropRef([`orders`, `amount`])]),
        new Aggregate(`avg`, [new PropRef([`products`, `price`])]),
        new Aggregate(`min`, [new PropRef([`dates`, `created`])]),
        new Aggregate(`max`, [new PropRef([`dates`, `updated`])]),
      ]

      const namespacedRow = {
        users: { id: 1 },
        orders: { amount: 100 },
        products: { price: 50 },
        dates: { created: `2023-01-01`, updated: `2023-12-31` },
      }

      // All of these should throw errors since they're aggregates
      aggregateExpressions.forEach((expr) => {
        expect(() => {
          processArgument(expr, namespacedRow)
        }).toThrow(`Aggregate expressions are not supported in this context`)
      })
    })

    it(`correctly identifies non-aggregate expressions`, () => {
      const nonAggregateExpressions = [
        new PropRef([`users`, `name`]),
        new Value(42),
        new Func(`upper`, [new Value(`hello`)]),
        new Func(`length`, [new PropRef([`users`, `name`])]),
      ]

      const namespacedRow = { users: { name: `John` } }

      // None of these should throw errors since they're not aggregates
      nonAggregateExpressions.forEach((expr) => {
        expect(() => {
          processArgument(expr, namespacedRow)
        }).not.toThrow()
      })
    })
  })
})
