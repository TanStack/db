import { describe, expect, it } from "vitest"
import {
  DeduplicatedLoadSubset,
  cloneOptions,
} from "../src/query/subset-dedupe"
import { Func, PropRef, Value } from "../src/query/ir"
import { minusWherePredicates } from "../src/query/predicate-utils"
import type { BasicExpression, OrderBy } from "../src/query/ir"
import type { LoadSubsetOptions } from "../src/types"

// Helper functions to build expressions more easily
function ref(path: string | Array<string>): PropRef {
  return new PropRef(typeof path === `string` ? [path] : path)
}

function val<T>(value: T): Value<T> {
  return new Value(value)
}

function gt(left: BasicExpression<any>, right: BasicExpression<any>): Func {
  return new Func(`gt`, [left, right])
}

function lt(left: BasicExpression<any>, right: BasicExpression<any>): Func {
  return new Func(`lt`, [left, right])
}

function eq(left: BasicExpression<any>, right: BasicExpression<any>): Func {
  return new Func(`eq`, [left, right])
}

function and(...expressions: Array<BasicExpression<boolean>>): Func {
  return new Func(`and`, expressions)
}

function inOp(left: BasicExpression<any>, values: Array<any>): Func {
  return new Func(`in`, [left, new Value(values)])
}

function lte(left: BasicExpression<any>, right: BasicExpression<any>): Func {
  return new Func(`lte`, [left, right])
}

function not(expression: BasicExpression<boolean>): Func {
  return new Func(`not`, [expression])
}

describe(`createDeduplicatedLoadSubset`, () => {
  it(`should call underlying loadSubset on first call`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })

    expect(callCount).toBe(1)
  })

  it(`should return true immediately for subset unlimited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    // First call: age > 10
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })
    expect(callCount).toBe(1)

    // Second call: age > 20 (subset of age > 10)
    const result = await deduplicated.loadSubset({
      where: gt(ref(`age`), val(20)),
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call underlying function
  })

  it(`should call underlying loadSubset for non-subset unlimited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    // First call: age > 20
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(20)) })
    expect(callCount).toBe(1)

    // Second call: age > 10 (NOT a subset of age > 20)
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })
    expect(callCount).toBe(2) // Should call underlying function
  })

  it(`should combine unlimited calls with union`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    // First call: age > 20
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(20)) })
    expect(callCount).toBe(1)

    // Second call: age < 10 (different range)
    await deduplicated.loadSubset({ where: lt(ref(`age`), val(10)) })
    expect(callCount).toBe(2)

    // Third call: age > 25 (subset of age > 20)
    const result = await deduplicated.loadSubset({
      where: gt(ref(`age`), val(25)),
    })
    expect(result).toBe(true)
    expect(callCount).toBe(2) // Should not call - covered by first call
  })

  it(`should track limited calls separately`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    const orderBy1: OrderBy = [
      {
        expression: ref(`age`),
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `lexical`,
        },
      },
    ]

    // First call: age > 10, orderBy age asc, limit 10
    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(callCount).toBe(1)

    // Second call: age > 20, orderBy age asc, limit 5 (subset)
    const result = await deduplicated.loadSubset({
      where: gt(ref(`age`), val(20)),
      orderBy: orderBy1,
      limit: 5,
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - subset of first
  })

  it(`should call underlying for non-subset limited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    const orderBy1: OrderBy = [
      {
        expression: ref(`age`),
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `lexical`,
        },
      },
    ]

    // First call: age > 10, orderBy age asc, limit 10
    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(callCount).toBe(1)

    // Second call: age > 10, orderBy age asc, limit 20 (NOT a subset)
    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
      limit: 20,
    })
    expect(callCount).toBe(2) // Should call - limit is larger
  })

  it(`should check limited calls against unlimited combined predicate`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    const orderBy1: OrderBy = [
      {
        expression: ref(`age`),
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `lexical`,
        },
      },
    ]

    // First call: unlimited age > 10
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })
    expect(callCount).toBe(1)

    // Second call: limited age > 20 with orderBy + limit
    // Even though it has a limit, it's covered by the unlimited call
    const result = await deduplicated.loadSubset({
      where: gt(ref(`age`), val(20)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - covered by unlimited
  })

  it(`should ignore orderBy for unlimited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    const orderBy1: OrderBy = [
      {
        expression: ref(`age`),
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `lexical`,
        },
      },
    ]

    // First call: unlimited with orderBy
    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
    })
    expect(callCount).toBe(1)

    // Second call: subset where, different orderBy, no limit
    const result = await deduplicated.loadSubset({
      where: gt(ref(`age`), val(20)),
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - orderBy ignored for unlimited
  })

  it(`should handle undefined where clauses`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    // First call: no where clause (all data)
    await deduplicated.loadSubset({})
    expect(callCount).toBe(1)

    // Second call: with where clause (should be covered)
    const result = await deduplicated.loadSubset({
      where: gt(ref(`age`), val(10)),
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - all data already loaded
  })

  it(`should handle complex real-world scenario`, async () => {
    let callCount = 0
    const calls: Array<LoadSubsetOptions> = []
    const mockLoadSubset = (options: LoadSubsetOptions) => {
      callCount++
      calls.push(options)
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

    const orderBy1: OrderBy = [
      {
        expression: ref(`createdAt`),
        compareOptions: {
          direction: `desc`,
          nulls: `last`,
          stringSort: `lexical`,
        },
      },
    ]

    // Load all active users
    await deduplicated.loadSubset({ where: eq(ref(`status`), val(`active`)) })
    expect(callCount).toBe(1)

    // Load top 10 active users by createdAt
    const result1 = await deduplicated.loadSubset({
      where: eq(ref(`status`), val(`active`)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(result1).toBe(true) // Covered by unlimited call
    expect(callCount).toBe(1)

    // Load all inactive users
    await deduplicated.loadSubset({ where: eq(ref(`status`), val(`inactive`)) })
    expect(callCount).toBe(2)

    // Load top 5 inactive users
    const result2 = await deduplicated.loadSubset({
      where: eq(ref(`status`), val(`inactive`)),
      orderBy: orderBy1,
      limit: 5,
    })
    expect(result2).toBe(true) // Covered by unlimited inactive call
    expect(callCount).toBe(2)

    // Verify only 2 actual calls were made
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ where: eq(ref(`status`), val(`active`)) })
    expect(calls[1]).toEqual({ where: eq(ref(`status`), val(`inactive`)) })
  })

  describe(`subset deduplication with minusWherePredicates`, () => {
    it(`should request only the difference for range predicates`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(cloneOptions(options))
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

      // First call: age > 20 (loads data for age > 20)
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(20)) })
      expect(callCount).toBe(1)
      expect(calls[0]).toEqual({ where: gt(ref(`age`), val(20)) })

      // Second call: age > 10 (should request only age > 10 AND age <= 20)
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })
      expect(callCount).toBe(2)
      expect(calls[1]).toEqual({
        where: and(gt(ref(`age`), val(10)), lte(ref(`age`), val(20))),
      })
    })

    it(`should request only the difference for set predicates`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(cloneOptions(options))
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

      // First call: status IN ['B', 'C'] (loads data for B and C)
      await deduplicated.loadSubset({
        where: inOp(ref(`status`), [`B`, `C`]),
      })
      expect(callCount).toBe(1)
      expect(calls[0]).toEqual({ where: inOp(ref(`status`), [`B`, `C`]) })

      // Second call: status IN ['A', 'B', 'C', 'D'] (should request only A and D)
      await deduplicated.loadSubset({
        where: inOp(ref(`status`), [`A`, `B`, `C`, `D`]),
      })
      expect(callCount).toBe(2)
      expect(calls[1]).toEqual({
        where: inOp(ref(`status`), [`A`, `D`]),
      })
    })

    it(`should return true immediately for complete overlap`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(cloneOptions(options))
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

      // First call: age > 10 (loads data for age > 10)
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })
      expect(callCount).toBe(1)

      // Second call: age > 20 (completely covered by first call)
      const result = await deduplicated.loadSubset({
        where: gt(ref(`age`), val(20)),
      })
      expect(result).toBe(true)
      expect(callCount).toBe(1) // Should not make additional call
    })

    it(`should handle complex predicate differences`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(cloneOptions(options))
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

      // First call: age > 20 AND status = 'active'
      const firstPredicate = and(
        gt(ref(`age`), val(20)),
        eq(ref(`status`), val(`active`))
      )
      await deduplicated.loadSubset({ where: firstPredicate })
      expect(callCount).toBe(1)
      expect(calls[0]).toEqual({ where: firstPredicate })

      // Second call: age > 10 AND status = 'active' (should request only age > 10 AND age <= 20 AND status = 'active')
      const secondPredicate = and(
        gt(ref(`age`), val(10)),
        eq(ref(`status`), val(`active`))
      )

      const test = minusWherePredicates(secondPredicate, firstPredicate)
      console.log(`test`, test)

      await deduplicated.loadSubset({ where: secondPredicate })
      expect(callCount).toBe(2)
      expect(calls[1]).toEqual({
        where: and(
          eq(ref(`status`), val(`active`)),
          gt(ref(`age`), val(10)),
          lte(ref(`age`), val(20))
        ),
      })
    })

    it(`should not apply subset logic to limited calls`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(cloneOptions(options))
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

      const orderBy1: OrderBy = [
        {
          expression: ref(`age`),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `lexical`,
          },
        },
      ]

      // First call: unlimited age > 20
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(20)) })
      expect(callCount).toBe(1)

      // Second call: limited age > 10 with orderBy + limit
      // Should request the full predicate, not the difference, because it's limited
      await deduplicated.loadSubset({
        where: gt(ref(`age`), val(10)),
        orderBy: orderBy1,
        limit: 10,
      })
      expect(callCount).toBe(2)
      expect(calls[1]).toEqual({
        where: gt(ref(`age`), val(10)),
        orderBy: orderBy1,
        limit: 10,
      })
    })

    it(`should handle undefined where clauses in subset logic`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(cloneOptions(options))
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

      // First call: age > 20
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(20)) })
      expect(callCount).toBe(1)

      // Second call: no where clause (all data)
      // Should request all data except what we already loaded
      // i.e. should request NOT (age > 20)
      await deduplicated.loadSubset({})
      expect(callCount).toBe(2)
      expect(calls[1]).toEqual({ where: not(gt(ref(`age`), val(20))) }) // Should request all data except what we already loaded
    })

    it(`should handle multiple overlapping unlimited calls`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(cloneOptions(options))
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset(mockLoadSubset)

      // First call: age > 20
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(20)) })
      expect(callCount).toBe(1)

      // Second call: age < 10 (different range)
      await deduplicated.loadSubset({ where: lt(ref(`age`), val(10)) })
      expect(callCount).toBe(2)

      // Third call: age > 5 (should request only age >= 10 AND age <= 20, since age < 10 is already covered)
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(5)) })
      expect(callCount).toBe(3)

      // Ideally it would be smart enough to optimize it to request only age >= 10 AND age <= 20, since age < 10 is already covered
      // However, it doesn't do that currently, so it will not optimize and execute the original query
      expect(calls[2]).toEqual({
        where: gt(ref(`age`), val(5)),
      })

      /*
      expect(calls[2]).toEqual({
        where: and(gte(ref(`age`), val(10)), lte(ref(`age`), val(20))),
      })
      */
    })
  })
})
