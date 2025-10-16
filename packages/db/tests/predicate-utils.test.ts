import { describe, expect, it } from "vitest"
import {
  isLimitSubset,
  isOrderBySubset,
  isPredicateSubset,
  isWhereSubset,
  minusWherePredicates,
  unionWherePredicates,
} from "../src/query/predicate-utils"
import { Func, PropRef, Value } from "../src/query/ir"
import type { BasicExpression, OrderBy, OrderByClause } from "../src/query/ir"
import type { LoadSubsetOptions } from "../src/types"

// Helper functions to build expressions more easily
function ref(path: string | Array<string>): PropRef {
  return new PropRef(typeof path === `string` ? [path] : path)
}

function val(value: any): Value {
  return new Value(value)
}

function func(name: string, ...args: Array<BasicExpression>): Func {
  return new Func(name, args)
}

function eq(left: BasicExpression, right: BasicExpression): Func {
  return func(`eq`, left, right)
}

function gt(left: BasicExpression, right: BasicExpression): Func {
  return func(`gt`, left, right)
}

function gte(left: BasicExpression, right: BasicExpression): Func {
  return func(`gte`, left, right)
}

function lt(left: BasicExpression, right: BasicExpression): Func {
  return func(`lt`, left, right)
}

function lte(left: BasicExpression, right: BasicExpression): Func {
  return func(`lte`, left, right)
}

function and(...args: Array<BasicExpression>): Func {
  return func(`and`, ...args)
}

function or(...args: Array<BasicExpression>): Func {
  return func(`or`, ...args)
}

function inOp(left: BasicExpression, values: Array<any>): Func {
  return func(`in`, left, val(values))
}

function orderByClause(
  expression: BasicExpression,
  direction: `asc` | `desc` = `asc`
): OrderByClause {
  return {
    expression,
    compareOptions: {
      direction,
      nulls: `last`,
      stringSort: `lexical`,
    },
  }
}

describe(`isWhereSubset`, () => {
  describe(`basic cases`, () => {
    it(`should return true for both undefined (all data is subset of all data)`, () => {
      expect(isWhereSubset(undefined, undefined)).toBe(true)
    })

    it(`should return false for undefined subset with constrained superset`, () => {
      // Requesting ALL data but only loaded SOME data = NOT subset
      expect(isWhereSubset(undefined, gt(ref(`age`), val(10)))).toBe(false)
    })

    it(`should return true for constrained subset with undefined superset`, () => {
      // Loaded ALL data, so any constrained subset is covered
      expect(isWhereSubset(gt(ref(`age`), val(20)), undefined)).toBe(true)
    })

    it(`should return true for identical expressions`, () => {
      const expr = gt(ref(`age`), val(10))
      expect(isWhereSubset(expr, expr)).toBe(true)
    })

    it(`should return true for structurally equal expressions`, () => {
      expect(
        isWhereSubset(gt(ref(`age`), val(10)), gt(ref(`age`), val(10)))
      ).toBe(true)
    })
  })

  describe(`comparison operators`, () => {
    it(`should handle gt: age > 20 is subset of age > 10`, () => {
      expect(
        isWhereSubset(gt(ref(`age`), val(20)), gt(ref(`age`), val(10)))
      ).toBe(true)
    })

    it(`should handle gt: age > 10 is NOT subset of age > 20`, () => {
      expect(
        isWhereSubset(gt(ref(`age`), val(10)), gt(ref(`age`), val(20)))
      ).toBe(false)
    })

    it(`should handle gte: age >= 20 is subset of age >= 10`, () => {
      expect(
        isWhereSubset(gte(ref(`age`), val(20)), gte(ref(`age`), val(10)))
      ).toBe(true)
    })

    it(`should handle lt: age < 10 is subset of age < 20`, () => {
      expect(
        isWhereSubset(lt(ref(`age`), val(10)), lt(ref(`age`), val(20)))
      ).toBe(true)
    })

    it(`should handle lt: age < 20 is NOT subset of age < 10`, () => {
      expect(
        isWhereSubset(lt(ref(`age`), val(20)), lt(ref(`age`), val(10)))
      ).toBe(false)
    })

    it(`should handle lte: age <= 10 is subset of age <= 20`, () => {
      expect(
        isWhereSubset(lte(ref(`age`), val(10)), lte(ref(`age`), val(20)))
      ).toBe(true)
    })

    it(`should handle eq: age = 15 is subset of age > 10`, () => {
      expect(
        isWhereSubset(eq(ref(`age`), val(15)), gt(ref(`age`), val(10)))
      ).toBe(true)
    })

    it(`should handle eq: age = 5 is NOT subset of age > 10`, () => {
      expect(
        isWhereSubset(eq(ref(`age`), val(5)), gt(ref(`age`), val(10)))
      ).toBe(false)
    })

    it(`should handle eq: age = 15 is subset of age >= 15`, () => {
      expect(
        isWhereSubset(eq(ref(`age`), val(15)), gte(ref(`age`), val(15)))
      ).toBe(true)
    })

    it(`should handle eq: age = 15 is subset of age < 20`, () => {
      expect(
        isWhereSubset(eq(ref(`age`), val(15)), lt(ref(`age`), val(20)))
      ).toBe(true)
    })

    it(`should handle mixed operators: gt vs gte`, () => {
      expect(
        isWhereSubset(gt(ref(`age`), val(10)), gte(ref(`age`), val(10)))
      ).toBe(true)
    })

    it(`should handle mixed operators: gte vs gt`, () => {
      expect(
        isWhereSubset(gte(ref(`age`), val(11)), gt(ref(`age`), val(10)))
      ).toBe(true)
      expect(
        isWhereSubset(gte(ref(`age`), val(10)), gt(ref(`age`), val(10)))
      ).toBe(false)
    })
  })

  describe(`IN operator`, () => {
    it(`should handle eq vs in: age = 5 is subset of age IN [5, 10, 15]`, () => {
      expect(
        isWhereSubset(eq(ref(`age`), val(5)), inOp(ref(`age`), [5, 10, 15]))
      ).toBe(true)
    })

    it(`should handle eq vs in: age = 20 is NOT subset of age IN [5, 10, 15]`, () => {
      expect(
        isWhereSubset(eq(ref(`age`), val(20)), inOp(ref(`age`), [5, 10, 15]))
      ).toBe(false)
    })

    it(`should handle in vs in: [5, 10] is subset of [5, 10, 15]`, () => {
      expect(
        isWhereSubset(inOp(ref(`age`), [5, 10]), inOp(ref(`age`), [5, 10, 15]))
      ).toBe(true)
    })

    it(`should handle in vs in: [5, 20] is NOT subset of [5, 10, 15]`, () => {
      expect(
        isWhereSubset(inOp(ref(`age`), [5, 20]), inOp(ref(`age`), [5, 10, 15]))
      ).toBe(false)
    })
  })

  describe(`AND combinations`, () => {
    it(`should handle AND in subset: (A AND B) is subset of A`, () => {
      expect(
        isWhereSubset(
          and(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`))),
          gt(ref(`age`), val(10))
        )
      ).toBe(true)
    })

    it(`should handle AND in subset: (A AND B) is NOT subset of C (different field)`, () => {
      expect(
        isWhereSubset(
          and(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`))),
          eq(ref(`name`), val(`John`))
        )
      ).toBe(false)
    })

    it(`should handle AND in superset: A is subset of (A AND B) is false (superset is more restrictive)`, () => {
      expect(
        isWhereSubset(
          gt(ref(`age`), val(10)),
          and(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`)))
        )
      ).toBe(false)
    })

    it(`should handle AND in both: (age > 20 AND status = 'active') is subset of (age > 10 AND status = 'active')`, () => {
      expect(
        isWhereSubset(
          and(gt(ref(`age`), val(20)), eq(ref(`status`), val(`active`))),
          and(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`)))
        )
      ).toBe(true)
    })
  })

  describe(`OR combinations`, () => {
    it(`should handle OR in superset: A is subset of (A OR B)`, () => {
      expect(
        isWhereSubset(
          gt(ref(`age`), val(10)),
          or(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`)))
        )
      ).toBe(true)
    })

    it(`should return false when subset doesn't imply any branch of OR superset`, () => {
      expect(
        isWhereSubset(
          eq(ref(`age`), val(10)),
          or(gt(ref(`age`), val(10)), lt(ref(`age`), val(5)))
        )
      ).toBe(false)
    })

    it(`should handle OR in subset: (A OR B) is subset of C only if both A and B are subsets of C`, () => {
      expect(
        isWhereSubset(
          or(gt(ref(`age`), val(20)), gt(ref(`age`), val(30))),
          gt(ref(`age`), val(10))
        )
      ).toBe(true)
    })

    it(`should handle OR in both: (age > 20 OR status = 'active') is subset of (age > 10 OR status = 'active')`, () => {
      expect(
        isWhereSubset(
          or(gt(ref(`age`), val(20)), eq(ref(`status`), val(`active`))),
          or(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`)))
        )
      ).toBe(true)
    })

    it(`should handle OR in subset: (A OR B) is NOT subset of C if either is not a subset`, () => {
      expect(
        isWhereSubset(
          or(gt(ref(`age`), val(20)), lt(ref(`age`), val(5))),
          gt(ref(`age`), val(10))
        )
      ).toBe(false)
    })
  })

  describe(`different fields`, () => {
    it(`should return false for different fields with no relationship`, () => {
      expect(
        isWhereSubset(gt(ref(`age`), val(20)), gt(ref(`salary`), val(1000)))
      ).toBe(false)
    })
  })

  describe(`Date support`, () => {
    const date1 = new Date(`2024-01-01`)
    const date2 = new Date(`2024-01-15`)
    const date3 = new Date(`2024-02-01`)

    it(`should handle Date equality`, () => {
      expect(
        isWhereSubset(
          eq(ref(`createdAt`), val(date2)),
          eq(ref(`createdAt`), val(date2))
        )
      ).toBe(true)
    })

    it(`should handle Date range comparisons: date > 2024-01-15 is subset of date > 2024-01-01`, () => {
      expect(
        isWhereSubset(
          gt(ref(`createdAt`), val(date2)),
          gt(ref(`createdAt`), val(date1))
        )
      ).toBe(true)
    })

    it(`should handle Date range comparisons: date < 2024-01-15 is subset of date < 2024-02-01`, () => {
      expect(
        isWhereSubset(
          lt(ref(`createdAt`), val(date2)),
          lt(ref(`createdAt`), val(date3))
        )
      ).toBe(true)
    })

    it(`should handle Date equality vs range: date = 2024-01-15 is subset of date > 2024-01-01`, () => {
      expect(
        isWhereSubset(
          eq(ref(`createdAt`), val(date2)),
          gt(ref(`createdAt`), val(date1))
        )
      ).toBe(true)
    })

    it(`should handle Date equality vs IN: date = 2024-01-15 is subset of date IN [2024-01-01, 2024-01-15, 2024-02-01]`, () => {
      expect(
        isWhereSubset(
          eq(ref(`createdAt`), val(date2)),
          inOp(ref(`createdAt`), [date1, date2, date3])
        )
      ).toBe(true)
    })

    it(`should handle Date IN subset: date IN [2024-01-01, 2024-01-15] is subset of date IN [2024-01-01, 2024-01-15, 2024-02-01]`, () => {
      expect(
        isWhereSubset(
          inOp(ref(`createdAt`), [date1, date2]),
          inOp(ref(`createdAt`), [date1, date2, date3])
        )
      ).toBe(true)
    })

    it(`should return false when Date not in IN set`, () => {
      expect(
        isWhereSubset(
          eq(ref(`createdAt`), val(date1)),
          inOp(ref(`createdAt`), [date2, date3])
        )
      ).toBe(false)
    })
  })
})

describe(`unionWherePredicates`, () => {
  describe(`basic cases`, () => {
    it(`should return false for empty array`, () => {
      const result = unionWherePredicates([])
      expect(result.type).toBe(`val`)
      expect((result as Value).value).toBe(false)
    })

    it(`should return the single predicate as-is`, () => {
      const pred = gt(ref(`age`), val(10))
      const result = unionWherePredicates([pred])
      expect(result).toBe(pred)
    })
  })

  describe(`same field comparisons`, () => {
    it(`should take least restrictive for gt: age > 10 OR age > 20 → age > 10`, () => {
      const result = unionWherePredicates([
        gt(ref(`age`), val(10)),
        gt(ref(`age`), val(20)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`gt`)
      const field = (result as Func).args[1] as Value
      expect(field.value).toBe(10)
    })

    it(`should take least restrictive for gte: age >= 10 OR age >= 20 → age >= 10`, () => {
      const result = unionWherePredicates([
        gte(ref(`age`), val(10)),
        gte(ref(`age`), val(20)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`gte`)
      const field = (result as Func).args[1] as Value
      expect(field.value).toBe(10)
    })

    it(`should take least restrictive for lt: age < 20 OR age < 10 → age < 20`, () => {
      const result = unionWherePredicates([
        lt(ref(`age`), val(20)),
        lt(ref(`age`), val(10)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`lt`)
      const field = (result as Func).args[1] as Value
      expect(field.value).toBe(20)
    })

    it(`should combine eq into IN: age = 5 OR age = 10 → age IN [5, 10]`, () => {
      const result = unionWherePredicates([
        eq(ref(`age`), val(5)),
        eq(ref(`age`), val(10)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`in`)
      const values = ((result as Func).args[1] as Value).value
      expect(values).toContain(5)
      expect(values).toContain(10)
      expect(values.length).toBe(2)
    })

    it(`should fold IN and equality into single IN: age IN [1,2] OR age = 3 → age IN [1,2,3]`, () => {
      const result = unionWherePredicates([
        inOp(ref(`age`), [1, 2]),
        eq(ref(`age`), val(3)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`in`)
      const values = ((result as Func).args[1] as Value).value
      expect(values).toContain(1)
      expect(values).toContain(2)
      expect(values).toContain(3)
      expect(values.length).toBe(3)
    })

    it(`should handle gte and gt together: age > 10 OR age >= 15 → age > 10`, () => {
      const result = unionWherePredicates([
        gt(ref(`age`), val(10)),
        gte(ref(`age`), val(15)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`gt`)
      const field = (result as Func).args[1] as Value
      expect(field.value).toBe(10)
    })
  })

  describe(`different fields`, () => {
    it(`should combine with OR: age > 10 OR status = 'active'`, () => {
      const result = unionWherePredicates([
        gt(ref(`age`), val(10)),
        eq(ref(`status`), val(`active`)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`or`)
      expect((result as Func).args.length).toBe(2)
    })
  })

  describe(`flatten OR`, () => {
    it(`should flatten nested ORs`, () => {
      const result = unionWherePredicates([
        or(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`))),
        eq(ref(`name`), val(`John`)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`or`)
      expect((result as Func).args.length).toBe(3)
    })
  })

  describe(`Date support`, () => {
    const date1 = new Date(`2024-01-01`)
    const date2 = new Date(`2024-01-15`)
    const date3 = new Date(`2024-02-01`)

    it(`should combine Date equalities into IN: date = date1 OR date = date2 → date IN [date1, date2]`, () => {
      const result = unionWherePredicates([
        eq(ref(`createdAt`), val(date1)),
        eq(ref(`createdAt`), val(date2)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`in`)
      const values = ((result as Func).args[1] as Value).value
      expect(values.length).toBe(2)
      expect(values).toContainEqual(date1)
      expect(values).toContainEqual(date2)
    })

    it(`should fold Date IN and equality: date IN [date1,date2] OR date = date3 → date IN [date1,date2,date3]`, () => {
      const result = unionWherePredicates([
        inOp(ref(`createdAt`), [date1, date2]),
        eq(ref(`createdAt`), val(date3)),
      ])
      expect(result.type).toBe(`func`)
      expect((result as Func).name).toBe(`in`)
      const values = ((result as Func).args[1] as Value).value
      expect(values.length).toBe(3)
      expect(values).toContainEqual(date1)
      expect(values).toContainEqual(date2)
      expect(values).toContainEqual(date3)
    })
  })
})

describe(`isOrderBySubset`, () => {
  it(`should return true for undefined subset`, () => {
    const orderBy: OrderBy = [orderByClause(ref(`age`), `asc`)]
    expect(isOrderBySubset(undefined, orderBy)).toBe(true)
    expect(isOrderBySubset([], orderBy)).toBe(true)
  })

  it(`should return false for undefined superset with non-empty subset`, () => {
    const orderBy: OrderBy = [orderByClause(ref(`age`), `asc`)]
    expect(isOrderBySubset(orderBy, undefined)).toBe(false)
    expect(isOrderBySubset(orderBy, [])).toBe(false)
  })

  it(`should return true for identical orderBy`, () => {
    const orderBy: OrderBy = [orderByClause(ref(`age`), `asc`)]
    expect(isOrderBySubset(orderBy, orderBy)).toBe(true)
  })

  it(`should return true when subset is prefix of superset`, () => {
    const subset: OrderBy = [orderByClause(ref(`age`), `asc`)]
    const superset: OrderBy = [
      orderByClause(ref(`age`), `asc`),
      orderByClause(ref(`name`), `desc`),
    ]
    expect(isOrderBySubset(subset, superset)).toBe(true)
  })

  it(`should return false when subset is not a prefix`, () => {
    const subset: OrderBy = [orderByClause(ref(`name`), `desc`)]
    const superset: OrderBy = [
      orderByClause(ref(`age`), `asc`),
      orderByClause(ref(`name`), `desc`),
    ]
    expect(isOrderBySubset(subset, superset)).toBe(false)
  })

  it(`should return false when directions differ`, () => {
    const subset: OrderBy = [orderByClause(ref(`age`), `desc`)]
    const superset: OrderBy = [orderByClause(ref(`age`), `asc`)]
    expect(isOrderBySubset(subset, superset)).toBe(false)
  })

  it(`should return false when subset is longer than superset`, () => {
    const subset: OrderBy = [
      orderByClause(ref(`age`), `asc`),
      orderByClause(ref(`name`), `desc`),
      orderByClause(ref(`status`), `asc`),
    ]
    const superset: OrderBy = [
      orderByClause(ref(`age`), `asc`),
      orderByClause(ref(`name`), `desc`),
    ]
    expect(isOrderBySubset(subset, superset)).toBe(false)
  })
})

describe(`isLimitSubset`, () => {
  it(`should return true for undefined subset`, () => {
    expect(isLimitSubset(undefined, 10)).toBe(true)
  })

  it(`should return true for undefined superset`, () => {
    expect(isLimitSubset(10, undefined)).toBe(true)
  })

  it(`should return true when subset <= superset`, () => {
    expect(isLimitSubset(10, 20)).toBe(true)
    expect(isLimitSubset(10, 10)).toBe(true)
  })

  it(`should return false when subset > superset`, () => {
    expect(isLimitSubset(20, 10)).toBe(false)
  })
})

describe(`isPredicateSubset`, () => {
  it(`should check all components`, () => {
    const subset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(20)),
      orderBy: [orderByClause(ref(`age`), `asc`)],
      limit: 10,
    }
    const superset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(10)),
      orderBy: [
        orderByClause(ref(`age`), `asc`),
        orderByClause(ref(`name`), `desc`),
      ],
      limit: 20,
    }
    expect(isPredicateSubset(subset, superset)).toBe(true)
  })

  it(`should return false if where is not subset`, () => {
    const subset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(5)),
      limit: 10,
    }
    const superset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(10)),
      limit: 20,
    }
    expect(isPredicateSubset(subset, superset)).toBe(false)
  })

  it(`should return false if orderBy is not subset`, () => {
    const subset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(20)),
      orderBy: [orderByClause(ref(`name`), `desc`)],
    }
    const superset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(10)),
      orderBy: [orderByClause(ref(`age`), `asc`)],
    }
    expect(isPredicateSubset(subset, superset)).toBe(false)
  })

  it(`should return false if limit is not subset`, () => {
    const subset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(20)),
      limit: 30,
    }
    const superset: LoadSubsetOptions = {
      where: gt(ref(`age`), val(10)),
      limit: 20,
    }
    expect(isPredicateSubset(subset, superset)).toBe(false)
  })
})

describe(`minusWherePredicates`, () => {
  describe(`basic cases`, () => {
    it(`should return original predicate when nothing to subtract`, () => {
      const pred = gt(ref(`age`), val(10))
      const result = minusWherePredicates(pred, undefined)

      expect(result).toEqual(pred)
    })

    it(`should return null when from is undefined (can't simplify NOT(B))`, () => {
      const subtract = gt(ref(`age`), val(10))
      const result = minusWherePredicates(undefined, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `not`,
        args: [subtract],
      })
    })

    it(`should return empty set when from is subset of subtract`, () => {
      const from = gt(ref(`age`), val(20)) // age > 20
      const subtract = gt(ref(`age`), val(10)) // age > 10
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({ type: `val`, value: false })
    })

    it(`should return null when predicates are on different fields`, () => {
      const from = gt(ref(`age`), val(10))
      const subtract = eq(ref(`status`), val(`active`))
      const result = minusWherePredicates(from, subtract)

      expect(result).toBeNull()
    })
  })

  describe(`IN minus IN`, () => {
    it(`should compute set difference: IN [A,B,C,D] - IN [B,C] = IN [A,D]`, () => {
      const from = inOp(ref(`status`), [`A`, `B`, `C`, `D`])
      const subtract = inOp(ref(`status`), [`B`, `C`])
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `in`,
        args: [ref(`status`), val([`A`, `D`])],
      })
    })

    it(`should return empty set when all values are subtracted`, () => {
      const from = inOp(ref(`status`), [`A`, `B`])
      const subtract = inOp(ref(`status`), [`A`, `B`])
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({ type: `val`, value: false })
    })

    it(`should return original when no overlap`, () => {
      const from = inOp(ref(`status`), [`A`, `B`])
      const subtract = inOp(ref(`status`), [`C`, `D`])
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual(from)
    })

    it(`should collapse to equality when one value remains`, () => {
      const from = inOp(ref(`status`), [`A`, `B`])
      const subtract = inOp(ref(`status`), [`B`])
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `eq`,
        args: [ref(`status`), val(`A`)],
      })
    })
  })

  describe(`IN minus equality`, () => {
    it(`should remove value from IN: IN [A,B,C] - eq(B) = IN [A,C]`, () => {
      const from = inOp(ref(`status`), [`A`, `B`, `C`])
      const subtract = eq(ref(`status`), val(`B`))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `in`,
        args: [ref(`status`), val([`A`, `C`])],
      })
    })

    it(`should collapse to equality when one value remains`, () => {
      const from = inOp(ref(`status`), [`A`, `B`])
      const subtract = eq(ref(`status`), val(`A`))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `eq`,
        args: [ref(`status`), val(`B`)],
      })
    })

    it(`should return empty set when removing last value`, () => {
      const from = inOp(ref(`status`), [`A`])
      const subtract = eq(ref(`status`), val(`A`))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({ type: `val`, value: false })
    })
  })

  describe(`equality minus equality`, () => {
    it(`should return empty set when same value`, () => {
      const from = eq(ref(`age`), val(15))
      const subtract = eq(ref(`age`), val(15))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({ type: `val`, value: false })
    })

    it(`should return original when different values`, () => {
      const from = eq(ref(`age`), val(15))
      const subtract = eq(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual(from)
    })
  })

  describe(`range minus range - gt/gte`, () => {
    it(`should compute difference: age > 10 - age > 20 = (age > 10 AND age <= 20)`, () => {
      const from = gt(ref(`age`), val(10))
      const subtract = gt(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gt(ref(`age`), val(10)), lte(ref(`age`), val(20))],
      })
    })

    it(`should return original when no overlap: age > 20 - age > 10`, () => {
      const from = gt(ref(`age`), val(20))
      const subtract = gt(ref(`age`), val(10))
      const result = minusWherePredicates(from, subtract)

      // age > 20 is subset of age > 10, so result is empty
      expect(result).toEqual({ type: `val`, value: false })
    })

    it(`should compute difference: age >= 10 - age >= 20 = (age >= 10 AND age < 20)`, () => {
      const from = gte(ref(`age`), val(10))
      const subtract = gte(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gte(ref(`age`), val(10)), lt(ref(`age`), val(20))],
      })
    })

    it(`should compute difference: age > 10 - age >= 20 = (age > 10 AND age < 20)`, () => {
      const from = gt(ref(`age`), val(10))
      const subtract = gte(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gt(ref(`age`), val(10)), lt(ref(`age`), val(20))],
      })
    })

    it(`should compute difference: age >= 10 - age > 20 = (age >= 10 AND age <= 20)`, () => {
      const from = gte(ref(`age`), val(10))
      const subtract = gt(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gte(ref(`age`), val(10)), lte(ref(`age`), val(20))],
      })
    })
  })

  describe(`range minus range - lt/lte`, () => {
    it(`should compute difference: age < 30 - age < 20 = (age >= 20 AND age < 30)`, () => {
      const from = lt(ref(`age`), val(30))
      const subtract = lt(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gte(ref(`age`), val(20)), lt(ref(`age`), val(30))],
      })
    })

    it(`should return original when no overlap: age < 20 - age < 30`, () => {
      const from = lt(ref(`age`), val(20))
      const subtract = lt(ref(`age`), val(30))
      const result = minusWherePredicates(from, subtract)

      // age < 20 is subset of age < 30, so result is empty
      expect(result).toEqual({ type: `val`, value: false })
    })

    it(`should compute difference: age <= 30 - age <= 20 = (age > 20 AND age <= 30)`, () => {
      const from = lte(ref(`age`), val(30))
      const subtract = lte(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gt(ref(`age`), val(20)), lte(ref(`age`), val(30))],
      })
    })

    it(`should compute difference: age < 30 - age <= 20 = (age > 20 AND age < 30)`, () => {
      const from = lt(ref(`age`), val(30))
      const subtract = lte(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gt(ref(`age`), val(20)), lt(ref(`age`), val(30))],
      })
    })

    it(`should compute difference: age <= 30 - age < 20 = (age >= 20 AND age <= 30)`, () => {
      const from = lte(ref(`age`), val(30))
      const subtract = lt(ref(`age`), val(20))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [gte(ref(`age`), val(20)), lte(ref(`age`), val(30))],
      })
    })
  })

  describe(`common conditions`, () => {
    it(`should handle common conditions: (age > 10 AND status = 'active') - (age > 20 AND status = 'active') = (age > 10 AND age <= 20 AND status = 'active')`, () => {
      const from = and(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`)))
      const subtract = and(gt(ref(`age`), val(20)), eq(ref(`status`), val(`active`)))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [
          eq(ref(`status`), val(`active`)), // common condition
          gt(ref(`age`), val(10)),
          lte(ref(`age`), val(20)),
        ],
      })
    })

    it(`should handle multiple common conditions`, () => {
      const from = and(
        gt(ref(`age`), val(10)),
        eq(ref(`status`), val(`active`)),
        eq(ref(`department`), val(`engineering`))
      )
      const subtract = and(
        gt(ref(`age`), val(20)),
        eq(ref(`status`), val(`active`)),
        eq(ref(`department`), val(`engineering`))
      )
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [
          eq(ref(`status`), val(`active`)), // common condition
          eq(ref(`department`), val(`engineering`)), // common condition
          gt(ref(`age`), val(10)),
          lte(ref(`age`), val(20)),
        ],
      })
    })

    it(`should handle IN with common conditions: (age IN [10,20,30] AND status = 'active') - (age IN [20,30] AND status = 'active') = (age IN [10] AND status = 'active')`, () => {
      const from = and(inOp(ref(`age`), [10, 20, 30]), eq(ref(`status`), val(`active`)))
      const subtract = and(inOp(ref(`age`), [20, 30]), eq(ref(`status`), val(`active`)))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [
          eq(ref(`status`), val(`active`)), // common condition
          {
            type: `func`,
            name: `eq`,
            args: [ref(`age`), val(10)],
          },
        ],
      })
    })

    it(`should return null when common conditions exist but remaining difference cannot be simplified`, () => {
      const from = and(gt(ref(`age`), val(10)), eq(ref(`status`), val(`active`)))
      const subtract = and(gt(ref(`name`), val(`Z`)), eq(ref(`status`), val(`active`)))
      const result = minusWherePredicates(from, subtract)

      // Can't simplify age > 10 - name > 'Z' (different fields), so returns null
      expect(result).toBeNull()
    })
  })

  describe(`Date support`, () => {
    it(`should handle Date IN minus Date IN`, () => {
      const date1 = new Date(`2024-01-01`)
      const date2 = new Date(`2024-01-15`)
      const date3 = new Date(`2024-02-01`)

      const from = inOp(ref(`createdAt`), [date1, date2, date3])
      const subtract = inOp(ref(`createdAt`), [date2])
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `in`,
        args: [ref(`createdAt`), val([date1, date3])],
      })
    })

    it(`should handle Date range difference: date > 2024-01-01 - date > 2024-01-15`, () => {
      const date1 = new Date(`2024-01-01`)
      const date15 = new Date(`2024-01-15`)

      const from = gt(ref(`createdAt`), val(date1))
      const subtract = gt(ref(`createdAt`), val(date15))
      const result = minusWherePredicates(from, subtract)

      expect(result).toEqual({
        type: `func`,
        name: `and`,
        args: [
          gt(ref(`createdAt`), val(date1)),
          lte(ref(`createdAt`), val(date15)),
        ],
      })
    })
  })

  describe(`real-world sync scenarios`, () => {
    it(`should compute missing data range: need age > 10, already have age > 20`, () => {
      const requested = gt(ref(`age`), val(10))
      const alreadyLoaded = gt(ref(`age`), val(20))
      const needToFetch = minusWherePredicates(requested, alreadyLoaded)

      // Need to fetch: 10 < age <= 20
      expect(needToFetch).toEqual({
        type: `func`,
        name: `and`,
        args: [gt(ref(`age`), val(10)), lte(ref(`age`), val(20))],
      })
    })

    it(`should compute missing IDs: need IN [1..100], already have IN [50..100]`, () => {
      const allIds = Array.from({ length: 100 }, (_, i) => i + 1)
      const loadedIds = Array.from({ length: 51 }, (_, i) => i + 50)

      const requested = inOp(ref(`id`), allIds)
      const alreadyLoaded = inOp(ref(`id`), loadedIds)
      const needToFetch = minusWherePredicates(requested, alreadyLoaded)

      // Need to fetch: ids 1..49
      const expectedIds = Array.from({ length: 49 }, (_, i) => i + 1)
      expect(needToFetch).toEqual({
        type: `func`,
        name: `in`,
        args: [ref(`id`), val(expectedIds)],
      })
    })

    it(`should return empty when all requested data is already loaded`, () => {
      const requested = gt(ref(`age`), val(20))
      const alreadyLoaded = gt(ref(`age`), val(10))
      const needToFetch = minusWherePredicates(requested, alreadyLoaded)

      // Requested is subset of already loaded - nothing more to fetch
      expect(needToFetch).toEqual({ type: `val`, value: false })
    })
  })
})
