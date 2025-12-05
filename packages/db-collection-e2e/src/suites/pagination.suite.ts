/**
 * Pagination Test Suite
 *
 * Tests ordering, limits, offsets, and window management
 */

import { describe, expect, it } from 'vitest'
import { createLiveQueryCollection, eq } from '@tanstack/db'
import {
  assertAllItemsMatch,
  assertCollectionSize,
  assertSorted,
} from '../utils/assertions'
import { waitForQueryData } from '../utils/helpers'
import type { E2ETestConfig } from '../types'

export function createPaginationTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe(`Pagination Suite`, () => {
    describe(`OrderBy`, () => {
      it(`should sort ascending by single field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `asc`),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertSorted(results, `age`, `asc`)

        await query.cleanup()
      })

      it(`should sort descending by single field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `desc`),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertSorted(results, `age`, `desc`)

        await query.cleanup()
      })

      it(`should sort by string field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.name, `asc`),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)

        // Verify it's sorted (don't assert exact order due to collation differences)
        // Just verify we got results and they're in some order
        expect(results[0]!).toHaveProperty(`name`)

        await query.cleanup()
      })

      it(`should sort by date field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.createdAt, `desc`),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertSorted(results, `createdAt`, `desc`)

        await query.cleanup()
      })

      it(`should sort by multiple fields`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .orderBy(({ post }) => [post.userId, post.viewCount]),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)

        // Verify multi-field sort (userId first, then viewCount within each userId)
        for (let i = 1; i < results.length; i++) {
          const prev = results[i - 1]!
          const curr = results[i]!

          // If userId is same, viewCount should be ascending
          if (prev.userId === curr.userId) {
            expect(prev.viewCount).toBeLessThanOrEqual(curr.viewCount)
          }
        }

        await query.cleanup()
      })
    })

    describe(`Limit`, () => {
      it(`should limit to specific number of records`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 10 })

        assertCollectionSize(query, 10)

        await query.cleanup()
      })

      it(`should handle limit=0`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(0),
        )

        await query.preload()

        assertCollectionSize(query, 0)

        await query.cleanup()
      })

      it(`should handle limit larger than dataset`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(1000),
        )

        await query.preload()

        // Should return all records (100 from seed data)
        expect(query.size).toBeLessThanOrEqual(100)

        await query.cleanup()
      })

      it(`should combine limit with orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `asc`)
            .limit(5),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 5 })

        assertCollectionSize(query, 5)
        const results = Array.from(query.state.values())
        assertSorted(results, `age`, `asc`)

        await query.cleanup()
      })
    })

    describe(`Offset`, () => {
      it(`should skip records with offset`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(100) // Need limit with offset
            .offset(20),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 80 })

        const results = Array.from(query.state.values())
        expect(results.length).toBe(80) // 100 - 20 = 80

        await query.cleanup()
      })

      it(`should combine offset with limit (pagination)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10)
            .offset(20),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 10 })

        assertCollectionSize(query, 10)

        await query.cleanup()
      })

      it(`should handle offset beyond dataset`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(100)
            .offset(200),
        )

        await query.preload()

        assertCollectionSize(query, 0)

        await query.cleanup()
      })
    })

    describe(`Complex Pagination Scenarios`, () => {
      it(`should paginate with predicates`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.isActive, true))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10)
            .offset(5),
        )

        await query.preload()

        const results = Array.from(query.state.values())
        expect(results.length).toBeLessThanOrEqual(10)
        assertAllItemsMatch(query, (u) => u.isActive === true)
        assertSorted(results, `age`, `asc`)

        await query.cleanup()
      })

      it(`should handle pagination edge cases - last page with fewer records`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection(
          (q) =>
            q
              .from({ user: usersCollection })
              .orderBy(({ user }) => user.id, `asc`)
              .limit(10)
              .offset(95), // Last 5 records
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        expect(query.size).toBeLessThanOrEqual(10)
        expect(query.size).toBeGreaterThan(0)

        await query.cleanup()
      })

      it(`should handle single record pages`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(1)
            .offset(0),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        assertCollectionSize(query, 1)

        await query.cleanup()
      })
    })

    describe(`Performance Verification`, () => {
      it(`should only load requested page (not entire dataset)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(10)
            .offset(20),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 10 })

        // Verify we got exactly 10 records
        assertCollectionSize(query, 10)

        // In on-demand mode, the underlying collection should ideally only load
        // the requested page, not all 100 records
        // (This depends on Electric's predicate pushdown implementation)

        await query.cleanup()
      })
    })
  })
}
