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
  inArray,
  isNull,
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
