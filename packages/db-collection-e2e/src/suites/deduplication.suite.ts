/**
 * Deduplication Test Suite
 *
 * Tests concurrent loadSubset calls and deduplication behavior
 */

import { describe, expect, it } from "vitest"
import { createLiveQueryCollection, eq, gt, isNull, lt } from "@tanstack/db"
import { waitForQueryData } from "../utils/helpers"
import type { E2ETestConfig } from "../types"

export function createDeduplicationTestSuite(
  getConfig: () => Promise<E2ETestConfig>
) {
  describe(`Deduplication Suite`, () => {
    describe(`Identical Predicates`, () => {
      it(`should deduplicate identical concurrent queries`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Create two identical queries
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 25))
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 25))
        )

        // Execute concurrently
        await Promise.all([query1.preload(), query2.preload()])
        await Promise.all([
          waitForQueryData(query1, { minSize: 1 }),
          waitForQueryData(query2, { minSize: 1 }),
        ])

        // Both should have same results
        expect(query1.size).toBe(query2.size)
        expect(query1.size).toBeGreaterThan(0)

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })

      it(`should deduplicate multiple identical queries`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Create 5 identical queries
        const queries = Array.from({ length: 5 }, () =>
          createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => gt(user.age, 30))
          )
        )

        // Execute all concurrently
        await Promise.all(queries.map((q) => q.preload()))

        // All should have same results
        const firstSize = queries[0]?.size
        expect(firstSize).toBeDefined()
        queries.forEach((q) => {
          expect(q.size).toBe(firstSize!)
        })

        await Promise.all(queries.map((q) => q.cleanup()))
      })
    })

    describe(`Overlapping Predicates`, () => {
      it(`should handle subset predicates correctly`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Query 1: age > 25 (superset)
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 25))
        )

        // Query 2: age > 30 (subset of Query 1)
        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 30))
        )

        // Execute concurrently
        await Promise.all([query1.preload(), query2.preload()])

        // Query 2 results should be subset of Query 1
        expect(query2.size).toBeLessThanOrEqual(query1.size)

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })

      it(`should handle non-overlapping predicates correctly`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Query 1: age > 50
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 50))
        )

        // Query 2: age < 30
        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => lt(user.age, 30))
        )

        // Execute concurrently
        await Promise.all([query1.preload(), query2.preload()])
        await Promise.all([
          waitForQueryData(query1, { minSize: 1 }),
          waitForQueryData(query2, { minSize: 1 }),
        ])

        // Both should execute independently
        expect(query1.size).toBeGreaterThan(0)
        expect(query2.size).toBeGreaterThan(0)

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })
    })

    describe(`Queries During Loading`, () => {
      it(`should handle queries arriving during active load`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Start first query
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.isActive, true))
        )

        // Immediately start identical second query
        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.isActive, true))
        )

        // Both should complete successfully
        await Promise.all([query1.preload(), query2.preload()])

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })

      it(`should handle query arriving mid-flight with different predicate`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 25))
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 50))
        )

        await Promise.all([query1.preload(), query2.preload()])

        // Both execute correctly
        expect(query1.size).toBeGreaterThanOrEqual(query2.size)

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })
    })

    describe(`Deduplication with Limit/Offset`, () => {
      it(`should handle queries with same limit/offset`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10)
            .offset(0)
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10)
            .offset(0)
        )

        await Promise.all([query1.preload(), query2.preload()])
        await waitForQueryData(query1, { minSize: 10 })
        await waitForQueryData(query2, { minSize: 10 })

        expect(query1.size).toBe(query2.size)
        expect(query1.size).toBe(10)

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })

      it(`should handle queries with different limits`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10)
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(20)
        )

        await Promise.all([query1.preload(), query2.preload()])
        await waitForQueryData(query1, { minSize: 10 })
        await waitForQueryData(query2, { minSize: 20 })

        expect(query1.size).toBe(10)
        expect(query2.size).toBe(20)

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })

      it(`should handle queries with different offsets`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10)
            .offset(0)
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10)
            .offset(10)
        )

        await Promise.all([query1.preload(), query2.preload()])
        await waitForQueryData(query1, { minSize: 10 })
        await waitForQueryData(query2, { minSize: 10 })

        expect(query1.size).toBe(10)
        expect(query2.size).toBe(10)

        // Results should be different
        const ids1 = Array.from(query1.state.values()).map((u) => u.id)
        const ids2 = Array.from(query2.state.values()).map((u) => u.id)
        expect(ids1).not.toEqual(ids2)

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })
    })

    describe(`Race Conditions`, () => {
      it(`should handle rapid concurrent query bursts`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Create 20 identical queries
        const queries = Array.from({ length: 20 }, () =>
          createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.isActive, true))
          )
        )

        // Execute all simultaneously
        await Promise.all(queries.map((q) => q.preload()))

        // All should have same results
        const firstSize = queries[0]?.size
        expect(firstSize).toBeDefined()
        queries.forEach((q) => {
          expect(q.size).toBe(firstSize!)
        })

        await Promise.all(queries.map((q) => q.cleanup()))
      })

      it(`should not corrupt data with concurrent queries`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Execute many concurrent queries with different predicates
        const queries = [
          createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.age, 25))
          ),
          createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => gt(user.age, 50))
          ),
          createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.isActive, true))
          ),
          createLiveQueryCollection((q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => isNull(user.email))
          ),
        ]

        await Promise.all(queries.map((q) => q.preload()))
        await Promise.all(
          queries.map((q) => waitForQueryData(q, { minSize: 1 }))
        )

        // Each query should have valid results
        queries.forEach((q) => {
          expect(q.size).toBeGreaterThan(0)
        })

        await Promise.all(queries.map((q) => q.cleanup()))
      })
    })
  })
}
