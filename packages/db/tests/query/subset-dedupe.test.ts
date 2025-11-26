import { describe, expect, it, vi } from "vitest"
import {
  DeduplicatedLoadSubset,
  cloneOptions,
} from "../../src/query/subset-dedupe"
import { Func, PropRef, Value } from "../../src/query/ir"
import { minusWherePredicates } from "../../src/query/predicate-utils"
import type { BasicExpression, OrderBy } from "../../src/query/ir"
import type { LoadSubsetOptions } from "../../src/types"

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })

    expect(callCount).toBe(1)
  })

  it(`should return true immediately for subset unlimited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const whereClause = gt(ref(`age`), val(10))

    // First call: age > 10, orderBy age asc, limit 10
    await deduplicated.loadSubset({
      where: whereClause,
      orderBy: orderBy1,
      limit: 10,
    })
    expect(callCount).toBe(1)

    // Second call: SAME where clause, same orderBy, smaller limit (subset)
    // For limited queries, where clauses must be EQUAL for subset relationship
    const result = await deduplicated.loadSubset({
      where: whereClause, // Same where clause
      orderBy: orderBy1,
      limit: 5,
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - subset of first
  })

  it(`should NOT dedupe limited calls with different where clauses`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    // Second call: DIFFERENT where clause (age > 20) - should NOT be deduped
    // even though age > 20 is "more restrictive" than age > 10,
    // the top 5 of age > 20 might not be in the top 10 of age > 10
    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(20)),
      orderBy: orderBy1,
      limit: 5,
    })
    expect(callCount).toBe(2) // Should call - different where clause
  })

  it(`should call underlying for non-subset limited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = () => {
      callCount++
      return Promise.resolve()
    }

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: mockLoadSubset,
    })

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

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

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

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

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

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

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

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

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

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

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

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

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

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

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

  describe(`onDeduplicate callback`, () => {
    it(`should call onDeduplicate when all data already loaded`, async () => {
      let callCount = 0
      const mockLoadSubset = () => {
        callCount++
        return Promise.resolve()
      }

      const onDeduplicate = vi.fn()
      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
        onDeduplicate,
      })

      // Load all data
      await deduplicated.loadSubset({})
      expect(callCount).toBe(1)

      // Any subsequent request should be deduplicated
      const subsetOptions = { where: gt(ref(`age`), val(10)) }
      const result = await deduplicated.loadSubset(subsetOptions)
      expect(result).toBe(true)
      expect(callCount).toBe(1)
      expect(onDeduplicate).toHaveBeenCalledTimes(1)
      expect(onDeduplicate).toHaveBeenCalledWith(subsetOptions)
    })

    it(`should call onDeduplicate when unlimited superset already loaded`, async () => {
      let callCount = 0
      const mockLoadSubset = () => {
        callCount++
        return Promise.resolve()
      }

      const onDeduplicate = vi.fn()
      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
        onDeduplicate: onDeduplicate,
      })

      // First call loads a broader set
      await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })
      expect(callCount).toBe(1)

      // Second call is a subset of the first; should dedupe and call callback
      const subsetOptions = { where: gt(ref(`age`), val(20)) }
      const result = await deduplicated.loadSubset(subsetOptions)
      expect(result).toBe(true)
      expect(callCount).toBe(1)
      expect(onDeduplicate).toHaveBeenCalledTimes(1)
      expect(onDeduplicate).toHaveBeenCalledWith(subsetOptions)
    })

    it(`should call onDeduplicate for limited subset requests`, async () => {
      let callCount = 0
      const mockLoadSubset = () => {
        callCount++
        return Promise.resolve()
      }

      const onDeduplicate = vi.fn()
      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
        onDeduplicate,
      })

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

      const whereClause = gt(ref(`age`), val(10))

      // First limited call
      await deduplicated.loadSubset({
        where: whereClause,
        orderBy: orderBy1,
        limit: 10,
      })
      expect(callCount).toBe(1)

      // Second limited call is a subset (SAME where clause and smaller limit)
      // For limited queries, where clauses must be EQUAL for subset relationship
      const subsetOptions = {
        where: whereClause, // Same where clause
        orderBy: orderBy1,
        limit: 5,
      }
      const result = await deduplicated.loadSubset(subsetOptions)
      expect(result).toBe(true)
      expect(callCount).toBe(1)
      expect(onDeduplicate).toHaveBeenCalledTimes(1)
      expect(onDeduplicate).toHaveBeenCalledWith(subsetOptions)
    })

    it(`should delay onDeduplicate until covering in-flight request completes`, async () => {
      let resolveFirst: (() => void) | undefined
      let callCount = 0
      const firstPromise = new Promise<void>((resolve) => {
        resolveFirst = () => resolve()
      })

      // First call will remain in-flight until we resolve it
      let first = true
      const mockLoadSubset = (_options: LoadSubsetOptions) => {
        callCount++
        if (first) {
          first = false
          return firstPromise
        }
        return Promise.resolve()
      }

      const onDeduplicate = vi.fn()
      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
        onDeduplicate: onDeduplicate,
      })

      // Start a broad in-flight request
      const inflightOptions = { where: gt(ref(`age`), val(10)) }
      const inflight = deduplicated.loadSubset(inflightOptions)
      expect(inflight).toBeInstanceOf(Promise)
      expect(callCount).toBe(1)

      // Issue a subset request while first is still in-flight
      const subsetOptions = { where: gt(ref(`age`), val(20)) }
      const subsetPromise = deduplicated.loadSubset(subsetOptions)
      expect(subsetPromise).toBeInstanceOf(Promise)

      // onDeduplicate should NOT have fired yet
      expect(onDeduplicate).not.toHaveBeenCalled()

      // Complete the first request
      resolveFirst?.()

      // Wait for the subset promise to settle (which chains the first)
      await subsetPromise

      // Now the callback should have been called exactly once, with the subset options
      expect(onDeduplicate).toHaveBeenCalledTimes(1)
      expect(onDeduplicate).toHaveBeenCalledWith(subsetOptions)
    })
  })

  describe(`limited queries with different where clauses`, () => {
    // When a query has a limit, only the top N rows (by orderBy) are loaded.
    // A subsequent query with a different where clause cannot reuse that data,
    // even if the new where clause is "more restrictive", because the filtered
    // top N might include rows outside the original unfiltered top N.

    it(`should NOT dedupe when where clause differs on limited queries`, async () => {
      let callCount = 0
      const calls: Array<LoadSubsetOptions> = []
      const mockLoadSubset = (options: LoadSubsetOptions) => {
        callCount++
        calls.push(options)
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

      const orderByCreatedAt: OrderBy = [
        {
          expression: ref(`created_at`),
          compareOptions: {
            direction: `desc`,
            nulls: `last`,
            stringSort: `lexical`,
          },
        },
      ]

      // First query: top 10 items with no filter
      await deduplicated.loadSubset({
        where: undefined,
        orderBy: orderByCreatedAt,
        limit: 10,
      })
      expect(callCount).toBe(1)

      // Second query: top 10 items WITH a filter
      // This requires a separate request because the filtered top 10
      // might include items outside the unfiltered top 10
      const searchWhere = and(eq(ref(`title`), val(`test`)))
      await deduplicated.loadSubset({
        where: searchWhere,
        orderBy: orderByCreatedAt,
        limit: 10,
      })

      expect(callCount).toBe(2)
      expect(calls[1]?.where).toEqual(searchWhere)
    })

    it(`should dedupe when where clause is identical on limited queries`, async () => {
      let callCount = 0
      const mockLoadSubset = () => {
        callCount++
        return Promise.resolve()
      }

      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: mockLoadSubset,
      })

      const orderByCreatedAt: OrderBy = [
        {
          expression: ref(`created_at`),
          compareOptions: {
            direction: `desc`,
            nulls: `last`,
            stringSort: `lexical`,
          },
        },
      ]

      // First query: top 10 items with no filter
      await deduplicated.loadSubset({
        where: undefined,
        orderBy: orderByCreatedAt,
        limit: 10,
      })
      expect(callCount).toBe(1)

      // Second query: same where clause (undefined), smaller limit
      // The top 5 are contained within the already-loaded top 10
      const result = await deduplicated.loadSubset({
        where: undefined,
        orderBy: orderByCreatedAt,
        limit: 5,
      })
      expect(result).toBe(true)
      expect(callCount).toBe(1)
    })
  })
})
