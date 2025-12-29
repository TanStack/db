import { describe, expect, it } from 'vitest'
import { buildCursor } from '../src/utils/cursor.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import type { OrderBy, OrderByClause } from '../src/query/ir.js'
import type { CompareOptions } from '../src/query/builder/types.js'

// Helper to create an OrderByClause for testing
function createOrderByClause(
  path: string,
  direction: `asc` | `desc`,
): OrderByClause {
  const compareOptions: CompareOptions = {
    direction,
    nulls: direction === `asc` ? `first` : `last`,
  }
  return {
    expression: new PropRef([`t`, path]),
    compareOptions,
  }
}

// Helper to check if a Func has the expected structure
function isFuncWithName(expr: unknown, name: string): expr is Func {
  return expr instanceof Func && expr.name === name
}

describe(`buildCursor`, () => {
  describe(`edge cases`, () => {
    it(`returns undefined for empty values array`, () => {
      const orderBy: OrderBy = [createOrderByClause(`col1`, `asc`)]
      expect(buildCursor(orderBy, [])).toBeUndefined()
    })

    it(`returns undefined for empty orderBy array`, () => {
      expect(buildCursor([], [1, 2, 3])).toBeUndefined()
    })

    it(`returns undefined for both empty`, () => {
      expect(buildCursor([], [])).toBeUndefined()
    })
  })

  describe(`single column`, () => {
    it(`produces gt() for ASC direction`, () => {
      const orderBy: OrderBy = [createOrderByClause(`col1`, `asc`)]
      const result = buildCursor(orderBy, [10])

      expect(result).toBeInstanceOf(Func)
      expect(isFuncWithName(result, `gt`)).toBe(true)

      const func = result as Func
      expect(func.args).toHaveLength(2)
      expect(func.args[0]).toBeInstanceOf(PropRef)
      expect((func.args[0] as PropRef).path).toEqual([`t`, `col1`])
      expect(func.args[1]).toBeInstanceOf(Value)
      expect((func.args[1] as Value).value).toBe(10)
    })

    it(`produces lt() for DESC direction`, () => {
      const orderBy: OrderBy = [createOrderByClause(`col1`, `desc`)]
      const result = buildCursor(orderBy, [10])

      expect(result).toBeInstanceOf(Func)
      expect(isFuncWithName(result, `lt`)).toBe(true)

      const func = result as Func
      expect(func.args).toHaveLength(2)
      expect(func.args[0]).toBeInstanceOf(PropRef)
      expect((func.args[0] as PropRef).path).toEqual([`t`, `col1`])
      expect(func.args[1]).toBeInstanceOf(Value)
      expect((func.args[1] as Value).value).toBe(10)
    })

    it(`handles string cursor values`, () => {
      const orderBy: OrderBy = [createOrderByClause(`name`, `asc`)]
      const result = buildCursor(orderBy, [`alice`])

      expect(result).toBeInstanceOf(Func)
      const func = result as Func
      expect(func.args[1]).toBeInstanceOf(Value)
      expect((func.args[1] as Value).value).toBe(`alice`)
    })

    it(`handles null cursor values`, () => {
      const orderBy: OrderBy = [createOrderByClause(`col1`, `asc`)]
      const result = buildCursor(orderBy, [null])

      expect(result).toBeInstanceOf(Func)
      const func = result as Func
      expect((func.args[1] as Value).value).toBeNull()
    })
  })

  describe(`multi-column composite cursor`, () => {
    it(`produces or(gt(col1), and(eq(col1), gt(col2))) for two ASC columns`, () => {
      const orderBy: OrderBy = [
        createOrderByClause(`col1`, `asc`),
        createOrderByClause(`col2`, `asc`),
      ]
      const result = buildCursor(orderBy, [10, 20])

      // Should be: or(gt(col1, 10), and(eq(col1, 10), gt(col2, 20)))
      expect(result).toBeInstanceOf(Func)
      expect(isFuncWithName(result, `or`)).toBe(true)

      const orFunc = result as Func
      expect(orFunc.args).toHaveLength(2)

      // First arg: gt(col1, 10)
      const gtCol1 = orFunc.args[0]
      expect(isFuncWithName(gtCol1, `gt`)).toBe(true)
      expect((gtCol1 as Func).args[0]).toBeInstanceOf(PropRef)
      expect(((gtCol1 as Func).args[0] as PropRef).path).toEqual([`t`, `col1`])
      expect(((gtCol1 as Func).args[1] as Value).value).toBe(10)

      // Second arg: and(eq(col1, 10), gt(col2, 20))
      const andClause = orFunc.args[1]
      expect(isFuncWithName(andClause, `and`)).toBe(true)
      const andFunc = andClause as Func
      expect(andFunc.args).toHaveLength(2)

      // eq(col1, 10)
      expect(isFuncWithName(andFunc.args[0], `eq`)).toBe(true)
      const eqCol1 = andFunc.args[0] as Func
      expect((eqCol1.args[0] as PropRef).path).toEqual([`t`, `col1`])
      expect((eqCol1.args[1] as Value).value).toBe(10)

      // gt(col2, 20)
      expect(isFuncWithName(andFunc.args[1], `gt`)).toBe(true)
      const gtCol2 = andFunc.args[1] as Func
      expect((gtCol2.args[0] as PropRef).path).toEqual([`t`, `col2`])
      expect((gtCol2.args[1] as Value).value).toBe(20)
    })

    it(`handles mixed ASC/DESC directions`, () => {
      const orderBy: OrderBy = [
        createOrderByClause(`col1`, `asc`),
        createOrderByClause(`col2`, `desc`),
      ]
      const result = buildCursor(orderBy, [10, 20])

      // Should be: or(gt(col1, 10), and(eq(col1, 10), lt(col2, 20)))
      expect(isFuncWithName(result, `or`)).toBe(true)

      const orFunc = result as Func
      const andClause = orFunc.args[1] as Func

      // Second column should use lt() for DESC
      expect(isFuncWithName(andClause.args[1], `lt`)).toBe(true)
    })

    it(`handles three columns correctly`, () => {
      const orderBy: OrderBy = [
        createOrderByClause(`col1`, `asc`),
        createOrderByClause(`col2`, `asc`),
        createOrderByClause(`col3`, `desc`),
      ]
      const result = buildCursor(orderBy, [1, 2, 3])

      // Should be: or(
      //   gt(col1, 1),
      //   and(eq(col1, 1), gt(col2, 2)),
      //   and(eq(col1, 1), eq(col2, 2), lt(col3, 3))
      // )
      expect(isFuncWithName(result, `or`)).toBe(true)

      const outerOr = result as Func
      // The structure is: or(or(gt, and), and) due to reduce
      expect(outerOr.args).toHaveLength(2)

      // First arg is or(gt(col1, 1), and(eq(col1, 1), gt(col2, 2)))
      const innerOr = outerOr.args[0]
      expect(isFuncWithName(innerOr, `or`)).toBe(true)

      // Second arg is and(and(eq(col1, 1), eq(col2, 2)), lt(col3, 3))
      const thirdClause = outerOr.args[1]
      expect(isFuncWithName(thirdClause, `and`)).toBe(true)

      // The innermost and should have eq conditions and lt for col3
      const innerAnd = thirdClause as Func
      // Due to reduce, the structure is nested: and(and(eq, eq), lt)
      expect(isFuncWithName(innerAnd.args[1], `lt`)).toBe(true)
      const ltCol3 = innerAnd.args[1] as Func
      expect((ltCol3.args[0] as PropRef).path).toEqual([`t`, `col3`])
      expect((ltCol3.args[1] as Value).value).toBe(3)
    })
  })

  describe(`partial values`, () => {
    it(`handles fewer values than orderBy columns`, () => {
      const orderBy: OrderBy = [
        createOrderByClause(`col1`, `asc`),
        createOrderByClause(`col2`, `asc`),
        createOrderByClause(`col3`, `asc`),
      ]
      const result = buildCursor(orderBy, [10, 20])

      // Should only use first two columns
      expect(isFuncWithName(result, `or`)).toBe(true)

      const orFunc = result as Func
      expect(orFunc.args).toHaveLength(2)

      // First clause: gt(col1, 10)
      expect(isFuncWithName(orFunc.args[0], `gt`)).toBe(true)

      // Second clause: and(eq(col1, 10), gt(col2, 20))
      expect(isFuncWithName(orFunc.args[1], `and`)).toBe(true)
    })

    it(`handles single value for multi-column orderBy`, () => {
      const orderBy: OrderBy = [
        createOrderByClause(`col1`, `asc`),
        createOrderByClause(`col2`, `asc`),
      ]
      const result = buildCursor(orderBy, [10])

      // Should just be gt(col1, 10) since only one value provided
      expect(isFuncWithName(result, `gt`)).toBe(true)

      const gtFunc = result as Func
      expect((gtFunc.args[0] as PropRef).path).toEqual([`t`, `col1`])
      expect((gtFunc.args[1] as Value).value).toBe(10)
    })
  })
})
