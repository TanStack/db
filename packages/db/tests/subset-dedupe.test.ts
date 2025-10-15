import { describe, expect, it } from "vitest"
import { createDeduplicatedLoadSubset } from "../src/query/subset-dedupe"
import { Func, PropRef, Value } from "../src/query/ir"
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

describe(`createDeduplicatedLoadSubset`, () => {
  it(`should call underlying loadSubset on first call`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)
    await deduplicated({ where: gt(ref(`age`), val(10)) })

    expect(callCount).toBe(1)
  })

  it(`should return true immediately for subset unlimited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

    // First call: age > 10
    await deduplicated({ where: gt(ref(`age`), val(10)) })
    expect(callCount).toBe(1)

    // Second call: age > 20 (subset of age > 10)
    const result = await deduplicated({ where: gt(ref(`age`), val(20)) })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call underlying function
  })

  it(`should call underlying loadSubset for non-subset unlimited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

    // First call: age > 20
    await deduplicated({ where: gt(ref(`age`), val(20)) })
    expect(callCount).toBe(1)

    // Second call: age > 10 (NOT a subset of age > 20)
    await deduplicated({ where: gt(ref(`age`), val(10)) })
    expect(callCount).toBe(2) // Should call underlying function
  })

  it(`should combine unlimited calls with union`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

    // First call: age > 20
    await deduplicated({ where: gt(ref(`age`), val(20)) })
    expect(callCount).toBe(1)

    // Second call: age < 10 (different range)
    await deduplicated({ where: lt(ref(`age`), val(10)) })
    expect(callCount).toBe(2)

    // Third call: age > 25 (subset of age > 20)
    const result = await deduplicated({ where: gt(ref(`age`), val(25)) })
    expect(result).toBe(true)
    expect(callCount).toBe(2) // Should not call - covered by first call
  })

  it(`should track limited calls separately`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

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
    await deduplicated({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(callCount).toBe(1)

    // Second call: age > 20, orderBy age asc, limit 5 (subset)
    const result = await deduplicated({
      where: gt(ref(`age`), val(20)),
      orderBy: orderBy1,
      limit: 5,
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - subset of first
  })

  it(`should call underlying for non-subset limited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

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
    await deduplicated({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(callCount).toBe(1)

    // Second call: age > 10, orderBy age asc, limit 20 (NOT a subset)
    await deduplicated({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
      limit: 20,
    })
    expect(callCount).toBe(2) // Should call - limit is larger
  })

  it(`should check limited calls against unlimited combined predicate`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

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
    await deduplicated({ where: gt(ref(`age`), val(10)) })
    expect(callCount).toBe(1)

    // Second call: limited age > 20 with orderBy + limit
    // Even though it has a limit, it's covered by the unlimited call
    const result = await deduplicated({
      where: gt(ref(`age`), val(20)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - covered by unlimited
  })

  it(`should ignore orderBy for unlimited calls`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

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
    await deduplicated({
      where: gt(ref(`age`), val(10)),
      orderBy: orderBy1,
    })
    expect(callCount).toBe(1)

    // Second call: subset where, different orderBy, no limit
    const result = await deduplicated({
      where: gt(ref(`age`), val(20)),
    })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - orderBy ignored for unlimited
  })

  it(`should handle undefined where clauses`, async () => {
    let callCount = 0
    const mockLoadSubset = async () => {
      callCount++
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

    // First call: no where clause (all data)
    await deduplicated({})
    expect(callCount).toBe(1)

    // Second call: with where clause (should be covered)
    const result = await deduplicated({ where: gt(ref(`age`), val(10)) })
    expect(result).toBe(true)
    expect(callCount).toBe(1) // Should not call - all data already loaded
  })

  it(`should handle complex real-world scenario`, async () => {
    let callCount = 0
    const calls: Array<LoadSubsetOptions> = []
    const mockLoadSubset = async (options: LoadSubsetOptions) => {
      callCount++
      calls.push(options)
    }

    const deduplicated = createDeduplicatedLoadSubset(mockLoadSubset)

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
    await deduplicated({ where: eq(ref(`status`), val(`active`)) })
    expect(callCount).toBe(1)

    // Load top 10 active users by createdAt
    const result1 = await deduplicated({
      where: eq(ref(`status`), val(`active`)),
      orderBy: orderBy1,
      limit: 10,
    })
    expect(result1).toBe(true) // Covered by unlimited call
    expect(callCount).toBe(1)

    // Load all inactive users
    await deduplicated({ where: eq(ref(`status`), val(`inactive`)) })
    expect(callCount).toBe(2)

    // Load top 5 inactive users
    const result2 = await deduplicated({
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
})
