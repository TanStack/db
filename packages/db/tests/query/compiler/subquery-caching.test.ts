import { describe, expect, it } from "vitest"
import { D2 } from "@tanstack/db-ivm"
import { compileQuery } from "../../../src/query/compiler/index.js"
import { CollectionRef, PropRef, QueryRef } from "../../../src/query/ir.js"
import type { QueryIR } from "../../../src/query/ir.js"
import type { CollectionImpl } from "../../../src/collection.js"

describe(`Subquery Caching`, () => {
  it(`should cache compiled subqueries and avoid duplicate compilation`, () => {
    // Create a mock collection
    const usersCollection = {
      id: `users`,
    } as CollectionImpl

    // Create a subquery that will be used in multiple places
    const subquery: QueryIR = {
      from: new CollectionRef(usersCollection, `u`),
      select: {
        id: new PropRef([`u`, `id`]),
        name: new PropRef([`u`, `name`]),
      },
    }

    // Create a main query that uses the same subquery object in multiple places
    const mainQuery: QueryIR = {
      from: new QueryRef(subquery, `main_users`),
      join: [
        {
          type: `inner`,
          from: new QueryRef(subquery, `joined_users`), // Same subquery object reference
          left: new PropRef([`main_users`, `id`]),
          right: new PropRef([`joined_users`, `id`]),
        },
      ],
      select: {
        mainId: new PropRef([`main_users`, `id`]),
        joinedId: new PropRef([`joined_users`, `id`]),
      },
    }

    // Set up D2 inputs
    const graph = new D2()
    const userInput = graph.newInput<[number, any]>()
    const inputs = { users: userInput }

    // Test: Compile the main query twice - first without shared cache, then with shared cache

    // First compilation without shared cache
    const cache1 = new WeakMap()
    const result1 = compileQuery(mainQuery, inputs, cache1)

    // Verify subquery is in first cache
    expect(cache1.has(subquery)).toBe(true)
    expect(cache1.has(mainQuery)).toBe(true)

    // Second compilation with different cache (should recompile everything)
    const cache2 = new WeakMap()
    const result2 = compileQuery(mainQuery, inputs, cache2)

    // Results should be different objects (different compilation)
    expect(result1).not.toBe(result2)

    // Both caches should have the queries
    expect(cache2.has(subquery)).toBe(true)
    expect(cache2.has(mainQuery)).toBe(true)

    // Third compilation with the same cache as #2 (should reuse cached results)
    const result3 = compileQuery(mainQuery, inputs, cache2)

    // Result should be the same object as #2 (reused from cache)
    expect(result3).toBe(result2)

    // Cache contents should be unchanged
    expect(cache2.has(subquery)).toBe(true)
    expect(cache2.has(mainQuery)).toBe(true)

    // Fourth compilation: compile just the subquery with cache2 (should reuse)
    const subqueryResult1 = compileQuery(subquery, inputs, cache2)
    const subqueryResult2 = compileQuery(subquery, inputs, cache2)

    // Both subquery compilations should return the same cached result
    expect(subqueryResult1).toBe(subqueryResult2)
  })

  it(`should reuse cached results for the same query object`, () => {
    const usersCollection = {
      id: `users`,
    } as CollectionImpl

    const subquery: QueryIR = {
      from: new CollectionRef(usersCollection, `u`),
      select: {
        id: new PropRef([`u`, `id`]),
        name: new PropRef([`u`, `name`]),
      },
    }

    const graph = new D2()
    const userInput = graph.newInput<[number, any]>()
    const inputs = { users: userInput }

    // Create a shared cache
    const sharedCache = new WeakMap()

    // First compilation - should add to cache
    const result1 = compileQuery(subquery, inputs, sharedCache)
    expect(sharedCache.has(subquery)).toBe(true)

    // Second compilation with same cache - should return cached result
    const result2 = compileQuery(subquery, inputs, sharedCache)
    expect(result1).toBe(result2) // Should be the exact same object reference
  })

  it(`should compile different query objects separately even with shared cache`, () => {
    const usersCollection = {
      id: `users`,
    } as CollectionImpl

    // Create two structurally identical but different query objects
    const subquery1: QueryIR = {
      from: new CollectionRef(usersCollection, `u`),
      select: {
        id: new PropRef([`u`, `id`]),
        name: new PropRef([`u`, `name`]),
      },
    }

    const subquery: QueryIR = {
      from: new CollectionRef(usersCollection, `u`),
      select: {
        id: new PropRef([`u`, `id`]),
        name: new PropRef([`u`, `name`]),
      },
    }

    // Verify they are different objects
    expect(subquery1).not.toBe(subquery)

    const graph = new D2()
    const userInput = graph.newInput<[number, any]>()
    const inputs = { users: userInput }

    const sharedCache = new WeakMap()

    // Compile both queries
    const result1 = compileQuery(subquery1, inputs, sharedCache)
    const result2 = compileQuery(subquery, inputs, sharedCache)

    // Should have different results since they are different objects
    expect(result1).not.toBe(result2)

    // Both should be in the cache
    expect(sharedCache.has(subquery1)).toBe(true)
    expect(sharedCache.has(subquery)).toBe(true)
  })

  it(`should use cache to avoid recompilation in nested subqueries`, () => {
    const usersCollection = {
      id: `users`,
    } as CollectionImpl

    // Create a deeply nested subquery that references the same query multiple times
    const innerSubquery: QueryIR = {
      from: new CollectionRef(usersCollection, `u`),
      select: {
        id: new PropRef([`u`, `id`]),
      },
    }

    const middleSubquery: QueryIR = {
      from: new QueryRef(innerSubquery, `inner1`),
      join: [
        {
          type: `left`,
          from: new QueryRef(innerSubquery, `inner2`), // Same innerSubquery
          left: new PropRef([`inner1`, `id`]),
          right: new PropRef([`inner2`, `id`]),
        },
      ],
    }

    const outerQuery: QueryIR = {
      from: new QueryRef(middleSubquery, `middle`),
      join: [
        {
          type: `inner`,
          from: new QueryRef(innerSubquery, `direct`), // innerSubquery again at top level
          left: new PropRef([`middle`, `id`]),
          right: new PropRef([`direct`, `id`]),
        },
      ],
    }

    const graph = new D2()
    const userInput = graph.newInput<[number, any]>()
    const inputs = { users: userInput }

    const sharedCache = new WeakMap()

    // Compile the outer query - should cache innerSubquery and reuse it
    const result = compileQuery(outerQuery, inputs, sharedCache)
    expect(result).toBeDefined()

    // Verify that innerSubquery is cached
    expect(sharedCache.has(innerSubquery)).toBe(true)
    expect(sharedCache.has(middleSubquery)).toBe(true)
    expect(sharedCache.has(outerQuery)).toBe(true)
  })
})
