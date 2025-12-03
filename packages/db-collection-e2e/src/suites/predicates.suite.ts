/**
 * Predicates Test Suite
 *
 * Tests basic where clause functionality with all comparison operators
 * across different data types.
 */

import { describe, expect, it } from "vitest"
import {
  and,
  createLiveQueryCollection,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  like,
  lower,
  lt,
  lte,
  not,
  or,
} from "@tanstack/db"
import { assertAllItemsMatch, assertCollectionSize } from "../utils/assertions"
import { waitForQueryData } from "../utils/helpers"
import type { E2ETestConfig } from "../types"

export function createPredicatesTestSuite(
  getConfig: () => Promise<E2ETestConfig>
) {
  describe(`Predicates Suite`, () => {
    describe(`Equality Operators`, () => {
      it(`should filter with eq() on string field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.name, `Alice 0`))
        )

        await query.preload()

        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        expect(results.every((u) => u.name === `Alice 0`)).toBe(true)

        await query.cleanup()
      })

      it(`should filter with eq() on number field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 25))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age === 25)

        await query.cleanup()
      })

      it(`should filter with eq() on boolean field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.isActive, true))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.isActive === true)

        await query.cleanup()
      })

      it(`should filter with eq() on UUID field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const testUserId = `00000000-0000-4000-8000-000000000000` // User ID for index 0

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.id, testUserId))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        assertCollectionSize(query, 1)
        const result = Array.from(query.state.values())[0]
        expect(result?.id).toBe(testUserId)

        await query.cleanup()
      })

      it(`should filter with isNull() for null values`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.email))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.email === null)

        await query.cleanup()
      })
    })

    describe(`Inequality Operators`, () => {
      it(`should filter with not(eq()) on string field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(eq(user.name, `Alice 0`)))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.name !== `Alice 0`)

        await query.cleanup()
      })

      it(`should filter with not(isNull()) for non-null values`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(isNull(user.email)))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.email !== null)

        await query.cleanup()
      })
    })

    describe(`Comparison Operators`, () => {
      it(`should filter with gt() on number field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 50))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age > 50)

        await query.cleanup()
      })

      it(`should filter with gte() on number field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gte(user.age, 50))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age >= 50)

        await query.cleanup()
      })

      it(`should filter with lt() on number field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => lt(user.age, 30))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age < 30)

        await query.cleanup()
      })

      it(`should filter with lte() on number field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => lte(user.age, 30))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age <= 30)

        await query.cleanup()
      })

      it(`should filter with gt() on viewCount field`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => gt(post.viewCount, 100))
        )

        await query.preload()

        assertAllItemsMatch(query, (p) => p.viewCount > 100)

        await query.cleanup()
      })

      it(`should filter with eq() on BIGINT field using JavaScript BigInt`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // Target the first post which has largeViewCount = 9007199254740992n (MAX_SAFE_INTEGER + 1)
        const targetBigInt = BigInt(`9007199254740992`)

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => eq(post.largeViewCount, targetBigInt))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBe(1)
        // Post 0 has largeViewCount = 9007199254740992n
        // Database may return as bigint or string depending on driver
        assertAllItemsMatch(query, (p) => {
          const value = String(p.largeViewCount)
          return value === targetBigInt.toString()
        })

        await query.cleanup()
      })

      it(`should filter with gt() on BIGINT field using JavaScript BigInt`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // Filter for posts with largeViewCount > 9007199254740995
        // This should match posts 4-9 (indices 4,5,6,7,8,9 have values 9007199254740996-9007199254741001)
        const thresholdBigInt = BigInt(`9007199254740995`)

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => gt(post.largeViewCount, thresholdBigInt))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // All results should have largeViewCount > threshold
        assertAllItemsMatch(query, (p) => {
          const value =
            typeof p.largeViewCount === `bigint`
              ? p.largeViewCount
              : BigInt(p.largeViewCount)
          return value > thresholdBigInt
        })

        await query.cleanup()
      })
    })

    describe(`String Pattern Matching Operators`, () => {
      it(`should filter with like() operator (case-sensitive)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.name, `Alice%`))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // Should match names starting with "Alice" (case-sensitive)
        assertAllItemsMatch(query, (u) => u.name.startsWith(`Alice`))

        await query.cleanup()
      })

      it(`should filter with ilike() operator (case-insensitive)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => ilike(user.name, `alice%`))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // Should match names starting with "Alice" (case-insensitive)
        assertAllItemsMatch(query, (u) =>
          u.name.toLowerCase().startsWith(`alice`)
        )

        await query.cleanup()
      })

      it(`should filter with like() with wildcard pattern (% at end)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.email, `%@example.com`))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // Should match emails ending with @example.com
        assertAllItemsMatch(
          query,
          (u) => u.email?.endsWith(`@example.com`) ?? false
        )

        await query.cleanup()
      })

      it(`should filter with like() with wildcard pattern (% in middle)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.email, `user%0@example.com`))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // Should match emails like user0@example.com, user10@example.com, user20@example.com, etc.
        assertAllItemsMatch(
          query,
          (u) => (u.email?.match(/^user.*0@example\.com$/) ?? null) !== null
        )

        await query.cleanup()
      })

      it(`should filter with like() with lower() function`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(lower(user.name), `%alice%`))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // Should match names containing "alice" (case-insensitive via lower())
        assertAllItemsMatch(query, (u) =>
          u.name.toLowerCase().includes(`alice`)
        )

        await query.cleanup()
      })

      it(`should filter with ilike() with lower() function`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => ilike(lower(user.name), `%bob%`))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // Should match names containing "bob" (case-insensitive)
        assertAllItemsMatch(query, (u) => u.name.toLowerCase().includes(`bob`))

        await query.cleanup()
      })

      it(`should filter with or() combining multiple like() conditions (search pattern)`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // This mimics the user's exact query pattern with multiple fields
        // User's pattern: like(lower(offers.title), `%${searchLower}%`) OR like(lower(offers.human_id), `%${searchLower}%`)
        const searchTerm = `Introduction`
        const searchLower = searchTerm.toLowerCase()

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) =>
              or(
                like(lower(post.title), `%${searchLower}%`),
                like(lower(post.content ?? ``), `%${searchLower}%`)
              )
            )
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        // Should match posts with title or content containing "introduction" (case-insensitive)
        assertAllItemsMatch(
          query,
          (p) =>
            p.title.toLowerCase().includes(searchLower) ||
            (p.content?.toLowerCase().includes(searchLower) ?? false)
        )

        await query.cleanup()
      })

      it(`should filter with like() and orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(lower(user.name), `%alice%`))
            .orderBy(({ user }) => user.name, `asc`)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) =>
          u.name.toLowerCase().includes(`alice`)
        )

        // Verify ordering
        const names = results.map((u) => u.name)
        const sortedNames = [...names].sort((a, b) => a.localeCompare(b))
        expect(names).toEqual(sortedNames)

        await query.cleanup()
      })

      it(`should filter with like() and limit`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(lower(user.name), `%alice%`))
            .orderBy(({ user }) => user.name, `asc`) // Required when using LIMIT
            .limit(5)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        // Should respect limit
        expect(results.length).toBeLessThanOrEqual(5)
        assertAllItemsMatch(query, (u) =>
          u.name.toLowerCase().includes(`alice`)
        )

        await query.cleanup()
      })

      it(`should handle like() with pattern matching no records`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => like(user.name, `NonExistent%`))
        )

        await query.preload()

        assertCollectionSize(query, 0)

        await query.cleanup()
      })
    })

    describe(`In Operator`, () => {
      it(`should filter with inArray() on string array`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              inArray(user.name, [`Alice 0`, `bob 1`, `Charlie 2`])
            )
        )

        await query.preload()

        const validNames = new Set([`Alice 0`, `bob 1`, `Charlie 2`])
        assertAllItemsMatch(query, (u) => validNames.has(u.name))

        await query.cleanup()
      })

      it(`should filter with inArray() on number array`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => inArray(user.age, [25, 30, 35]))
        )

        await query.preload()

        const validAges = new Set([25, 30, 35])
        assertAllItemsMatch(query, (u) => validAges.has(u.age))

        await query.cleanup()
      })

      it(`should filter with inArray() on UUID array`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const userIds = [
          `00000000-0000-4000-8000-000000000000`, // User ID for index 0
          `00000001-0000-4000-8000-000000000001`, // User ID for index 1
          `00000002-0000-4000-8000-000000000002`, // User ID for index 2
        ]

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => inArray(user.id, userIds))
        )

        await query.preload()

        const validIds = new Set(userIds)
        assertAllItemsMatch(query, (u) => validIds.has(u.id))

        await query.cleanup()
      })

      it(`should handle empty inArray()`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => inArray(user.id, []))
        )

        await query.preload()

        assertCollectionSize(query, 0)

        await query.cleanup()
      })

      it(`should filter with inArray() on BIGINT array using JavaScript BigInt`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // Target posts 0 and 1 which have largeViewCount values:
        // Post 0: 9007199254740992n, Post 1: 9007199254740993n
        const targetBigInts = [
          BigInt(`9007199254740992`),
          BigInt(`9007199254740993`),
        ]

        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .where(({ post }) => inArray(post.largeViewCount, targetBigInts))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 2 })

        const results = Array.from(query.state.values())
        expect(results.length).toBe(2)

        // Verify both matching posts are returned
        const targetStrings = targetBigInts.map((b) => b.toString())
        assertAllItemsMatch(query, (p) => {
          const value =
            typeof p.largeViewCount === `bigint`
              ? p.largeViewCount.toString()
              : String(p.largeViewCount)
          return targetStrings.includes(value)
        })

        await query.cleanup()
      })
    })

    describe(`Null Operators`, () => {
      it(`should filter with isNull() on nullable field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.email))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.email === null)

        await query.cleanup()
      })

      it(`should filter with eq(col, null) same as isNull()`, async () => {
        // eq(col, null) should be transformed to IS NULL and work correctly
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.email, null))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.email === null)

        await query.cleanup()
      })

      it(`should filter with eq(col, null) in AND clause`, async () => {
        // Tests that eq(col, null) works correctly when combined with other predicates
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              and(eq(user.email, null), eq(user.isActive, true))
            )
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(
          query,
          (u) => u.email === null && u.isActive === true
        )

        await query.cleanup()
      })

      it(`should filter with eq(col, null) in OR clause`, async () => {
        // Tests that eq(col, null) works correctly in OR with other predicates
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              or(eq(user.email, null), eq(user.name, `Alice 0`))
            )
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(
          query,
          (u) => u.email === null || u.name === `Alice 0`
        )

        await query.cleanup()
      })

      it(`should filter with not(isNull()) on nullable field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(isNull(user.email)))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.email !== null)

        await query.cleanup()
      })

      it(`should filter with isNull() on deletedAt (soft delete pattern)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.deletedAt))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.deletedAt === null)

        await query.cleanup()
      })
    })

    describe(`Boolean Logic`, () => {
      it(`should combine predicates with and()`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => and(gt(user.age, 25), eq(user.isActive, true)))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age > 25 && u.isActive === true)

        await query.cleanup()
      })

      it(`should combine predicates with or()`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => or(eq(user.age, 25), eq(user.age, 30)))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age === 25 || u.age === 30)

        await query.cleanup()
      })

      it(`should handle complex nested logic`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              and(
                or(eq(user.age, 25), eq(user.age, 30)),
                eq(user.isActive, true)
              )
            )
        )

        await query.preload()

        assertAllItemsMatch(
          query,
          (u) => (u.age === 25 || u.age === 30) && u.isActive === true
        )

        await query.cleanup()
      })

      it(`should handle NOT operator`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => not(eq(user.isActive, true)))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.isActive !== true)

        await query.cleanup()
      })
    })

    describe(`Predicate Pushdown Verification`, () => {
      it(`should only load data matching predicate (no over-fetching)`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 25))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        // Verify that the underlying collection didn't load ALL users
        // In on-demand mode, it should only load age=25 users
        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        expect(results.length).toBeLessThan(100) // Shouldn't load all 100 users

        await query.cleanup()
      })

      it(`should not load deleted records when filtering them out`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.deletedAt))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        assertAllItemsMatch(query, (u) => u.deletedAt === null)

        await query.cleanup()
      })
    })

    describe(`Multiple where() Calls`, () => {
      it(`should AND multiple where() calls together`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 25))
            .where(({ user }) => eq(user.isActive, true))
        )

        await query.preload()

        assertAllItemsMatch(query, (u) => u.age > 25 && u.isActive === true)

        await query.cleanup()
      })
    })

    describe(`Edge Cases`, () => {
      it(`should handle query with no where clause on on-demand collection`, async () => {
        // NOTE: Electric has a bug where empty subset requests don't load data
        // We work around this by injecting "true = true" when there's no where clause
        // This is always true so doesn't filter data, just tricks Electric into loading

        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Query with NO where clause - loads all data
        const query = createLiveQueryCollection(
          (q) => q.from({ user: usersCollection })
          // No where, no limit, no orderBy
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 50 })

        // Should load significant data (true = true workaround for Electric)
        expect(query.size).toBeGreaterThan(0)
        expect(query.size).toBe(usersCollection.size) // Query shows all collection data

        await query.cleanup()
      })

      it(`should handle predicate matching no records`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.age, 999))
        )

        await query.preload()

        assertCollectionSize(query, 0)

        await query.cleanup()
      })

      it(`should handle complex AND with no matches`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q.from({ user: usersCollection }).where(({ user }) =>
            and(
              eq(user.age, 25),
              eq(user.age, 30) // Impossible: age can't be both 25 and 30
            )
          )
        )

        await query.preload()

        assertCollectionSize(query, 0)

        await query.cleanup()
      })
    })
  })
}
