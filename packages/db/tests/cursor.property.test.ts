import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { buildCursor } from '../src/utils/cursor'
import { Func, PropRef, Value } from '../src/query/ir'
import type { OrderBy, OrderByClause } from '../src/query/ir'
import type { CompareOptions } from '../src/query/builder/types'

/**
 * Property-based tests for cursor building
 *
 * Key properties:
 * 1. Empty inputs return undefined
 * 2. Single column produces simple gt/lt based on direction
 * 3. Direction affects operator choice (asc = gt, desc = lt)
 * 4. Determinism - same inputs always produce same output
 * 5. Result structure is always valid
 */

// Arbitraries for generating test data
const arbitraryDirection = fc.constantFrom(`asc`, `desc`)

const arbitraryNulls = fc.constantFrom(`first`, `last`)

const arbitraryStringSort = fc.constantFrom(`locale`, `lexical`)

const arbitraryCompareOptions = fc.record({
  direction: arbitraryDirection,
  nulls: arbitraryNulls,
  stringSort: arbitraryStringSort,
}) as fc.Arbitrary<CompareOptions>

const arbitraryPropRef = fc
  .array(fc.string({ minLength: 1, maxLength: 10 }), {
    minLength: 1,
    maxLength: 3,
  })
  .map((path) => new PropRef(path))

const arbitraryOrderByClause = fc
  .tuple(arbitraryPropRef, arbitraryCompareOptions)
  .map(
    ([expr, compareOptions]): OrderByClause => ({
      expression: expr,
      compareOptions,
    }),
  )

const arbitraryOrderBy = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<OrderBy> =>
  fc.array(arbitraryOrderByClause, { minLength, maxLength })

const arbitraryValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null),
)

const arbitraryValues = (
  minLength: number,
  maxLength: number,
): fc.Arbitrary<Array<unknown>> =>
  fc.array(arbitraryValue, { minLength, maxLength })

// Helper to check if result is a Func
function isFunc(expr: unknown): expr is Func {
  return expr instanceof Func
}

// Helper to get operator name from Func
function getFuncName(expr: Func): string {
  return expr.name
}

// Helper to recursively count operators in an expression
function countOperators(expr: unknown, name: string): number {
  if (!isFunc(expr)) return 0
  const selfCount = expr.name === name ? 1 : 0
  return (
    selfCount +
    expr.args.reduce((sum, arg) => sum + countOperators(arg, name), 0)
  )
}

describe(`buildCursor property-based tests`, () => {
  describe(`empty input handling`, () => {
    fcTest.prop([arbitraryOrderBy(0, 5)])(
      `returns undefined for empty values array`,
      (orderBy) => {
        const result = buildCursor(orderBy, [])
        expect(result).toBeUndefined()
      },
    )

    fcTest.prop([arbitraryValues(0, 5)])(
      `returns undefined for empty orderBy array`,
      (values) => {
        const result = buildCursor([], values)
        expect(result).toBeUndefined()
      },
    )

    it(`returns undefined for both empty`, () => {
      expect(buildCursor([], [])).toBeUndefined()
    })
  })

  describe(`single column cursor`, () => {
    fcTest.prop([arbitraryOrderByClause, arbitraryValue])(
      `produces a simple comparison for single column`,
      (clause, value) => {
        const result = buildCursor([clause], [value])

        expect(result).toBeDefined()
        expect(isFunc(result!)).toBe(true)

        // Should be either 'gt' or 'lt' based on direction
        const func = result as Func
        expect([`gt`, `lt`]).toContain(getFuncName(func))
      },
    )

    fcTest.prop([
      arbitraryPropRef,
      arbitraryNulls,
      arbitraryStringSort,
      arbitraryValue,
    ])(
      `ascending direction produces gt operator`,
      (expr, nulls, stringSort, value) => {
        const clause: OrderByClause = {
          expression: expr,
          compareOptions: {
            direction: `asc`,
            nulls: nulls as `first` | `last`,
            stringSort: stringSort as `locale` | `lexical`,
          },
        }
        const result = buildCursor([clause], [value])

        expect(result).toBeDefined()
        expect(getFuncName(result as Func)).toBe(`gt`)
      },
    )

    fcTest.prop([
      arbitraryPropRef,
      arbitraryNulls,
      arbitraryStringSort,
      arbitraryValue,
    ])(
      `descending direction produces lt operator`,
      (expr, nulls, stringSort, value) => {
        const clause: OrderByClause = {
          expression: expr,
          compareOptions: {
            direction: `desc`,
            nulls: nulls as `first` | `last`,
            stringSort: stringSort as `locale` | `lexical`,
          },
        }
        const result = buildCursor([clause], [value])

        expect(result).toBeDefined()
        expect(getFuncName(result as Func)).toBe(`lt`)
      },
    )
  })

  describe(`multi-column cursor structure`, () => {
    fcTest.prop([arbitraryOrderBy(2, 4), arbitraryValues(2, 4)])(
      `multi-column produces or at top level when matching lengths`,
      (orderBy, values) => {
        // Ensure we have matching lengths for a valid multi-column cursor
        const minLen = Math.min(orderBy.length, values.length)
        if (minLen < 2) return // Skip if not enough for multi-column

        const trimmedOrderBy = orderBy.slice(0, minLen)
        const trimmedValues = values.slice(0, minLen)

        const result = buildCursor(trimmedOrderBy, trimmedValues)

        expect(result).toBeDefined()
        expect(isFunc(result!)).toBe(true)

        // For 2+ columns, top level should be 'or'
        const func = result as Func
        expect(getFuncName(func)).toBe(`or`)
      },
    )

    fcTest.prop([
      fc.tuple(arbitraryOrderByClause, arbitraryOrderByClause),
      fc.tuple(arbitraryValue, arbitraryValue),
    ])(
      `two columns produces correct structure`,
      ([clause1, clause2], [val1, val2]) => {
        const result = buildCursor([clause1, clause2], [val1, val2])

        expect(result).toBeDefined()
        const func = result as Func

        // Top level should be 'or'
        expect(getFuncName(func)).toBe(`or`)

        // Should have structure: or(comparison1, and(eq, comparison2))
        expect(func.args).toHaveLength(2)

        // First arg should be direct gt/lt
        expect(isFunc(func.args[0])).toBe(true)
        expect([`gt`, `lt`]).toContain(getFuncName(func.args[0] as Func))

        // Second arg should be 'and' combining eq and comparison
        expect(isFunc(func.args[1])).toBe(true)
        expect(getFuncName(func.args[1] as Func)).toBe(`and`)
      },
    )
  })

  describe(`determinism`, () => {
    fcTest.prop([arbitraryOrderBy(1, 3), arbitraryValues(1, 3)])(
      `buildCursor is deterministic`,
      (orderBy, values) => {
        const result1 = buildCursor(orderBy, values)
        const result2 = buildCursor(orderBy, values)

        // Both should be defined or both undefined
        expect(result1 === undefined).toBe(result2 === undefined)

        if (result1 !== undefined && result2 !== undefined) {
          // Compare structure by JSON representation
          expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
        }
      },
    )
  })

  describe(`value preservation`, () => {
    fcTest.prop([arbitraryOrderByClause, arbitraryValue])(
      `cursor contains the provided value`,
      (clause, value) => {
        const result = buildCursor([clause], [value])

        expect(result).toBeDefined()
        const func = result as Func

        // Second argument should be a Value containing our value
        expect(func.args[1]).toBeInstanceOf(Value)
        expect((func.args[1] as Value).value).toBe(value)
      },
    )

    fcTest.prop([arbitraryOrderByClause, arbitraryValue])(
      `cursor references the correct property`,
      (clause, value) => {
        const result = buildCursor([clause], [value])

        expect(result).toBeDefined()
        const func = result as Func

        // First argument should be the same PropRef
        expect(func.args[0]).toBeInstanceOf(PropRef)
        expect((func.args[0] as PropRef).path).toEqual(
          (clause.expression as PropRef).path,
        )
      },
    )
  })

  describe(`length mismatch handling`, () => {
    fcTest.prop([arbitraryOrderBy(3, 5), arbitraryValues(1, 2)])(
      `handles more orderBy columns than values gracefully`,
      (orderBy, values) => {
        // Should use the minimum of the two lengths
        const result = buildCursor(orderBy, values)

        if (values.length === 0) {
          expect(result).toBeUndefined()
        } else {
          expect(result).toBeDefined()
          expect(isFunc(result!)).toBe(true)
        }
      },
    )

    fcTest.prop([arbitraryOrderBy(1, 2), arbitraryValues(3, 5)])(
      `handles more values than orderBy columns gracefully`,
      (orderBy, values) => {
        // Should use the minimum of the two lengths
        const result = buildCursor(orderBy, values)

        if (orderBy.length === 0) {
          expect(result).toBeUndefined()
        } else {
          expect(result).toBeDefined()
          expect(isFunc(result!)).toBe(true)
        }
      },
    )
  })

  describe(`operator consistency`, () => {
    fcTest.prop([
      fc.array(
        fc.tuple(arbitraryPropRef, arbitraryNulls, arbitraryStringSort),
        { minLength: 2, maxLength: 4 },
      ),
      arbitraryValues(2, 4),
    ])(`all ascending columns use gt operators`, (clauseParts, values) => {
      const orderBy: OrderBy = clauseParts.map(([expr, nulls, stringSort]) => ({
        expression: expr,
        compareOptions: {
          direction: `asc` as const,
          nulls: nulls as `first` | `last`,
          stringSort: stringSort as `locale` | `lexical`,
        },
      }))

      const minLen = Math.min(orderBy.length, values.length)
      const result = buildCursor(
        orderBy.slice(0, minLen),
        values.slice(0, minLen),
      )

      if (result) {
        // Count gt operators - should equal number of columns
        const gtCount = countOperators(result, `gt`)
        expect(gtCount).toBe(minLen)
        // Should have no lt operators
        const ltCount = countOperators(result, `lt`)
        expect(ltCount).toBe(0)
      }
    })

    fcTest.prop([
      fc.array(
        fc.tuple(arbitraryPropRef, arbitraryNulls, arbitraryStringSort),
        { minLength: 2, maxLength: 4 },
      ),
      arbitraryValues(2, 4),
    ])(`all descending columns use lt operators`, (clauseParts, values) => {
      const orderBy: OrderBy = clauseParts.map(([expr, nulls, stringSort]) => ({
        expression: expr,
        compareOptions: {
          direction: `desc` as const,
          nulls: nulls as `first` | `last`,
          stringSort: stringSort as `locale` | `lexical`,
        },
      }))

      const minLen = Math.min(orderBy.length, values.length)
      const result = buildCursor(
        orderBy.slice(0, minLen),
        values.slice(0, minLen),
      )

      if (result) {
        // Count lt operators - should equal number of columns
        const ltCount = countOperators(result, `lt`)
        expect(ltCount).toBe(minLen)
        // Should have no gt operators
        const gtCount = countOperators(result, `gt`)
        expect(gtCount).toBe(0)
      }
    })
  })
})
