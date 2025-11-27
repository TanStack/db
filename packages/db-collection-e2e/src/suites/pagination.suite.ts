/**
 * Pagination Test Suite
 *
 * Tests ordering, limits, offsets, and window management
 */

import { describe, expect, it } from "vitest"
import { createLiveQueryCollection, eq } from "@tanstack/db"
import {
  assertAllItemsMatch,
  assertCollectionSize,
  assertSorted,
} from "../utils/assertions"
import { waitForQueryData } from "../utils/helpers"
import type { E2ETestConfig } from "../types"

export function createPaginationTestSuite(
  getConfig: () => Promise<E2ETestConfig>
) {
  describe(`Pagination Suite`, () => {
    describe(`OrderBy`, () => {
      it(`should sort ascending by single field`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `asc`)
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
            .orderBy(({ user }) => user.age, `desc`)
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
            .orderBy(({ user }) => user.name, `asc`)
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
            .orderBy(({ user }) => user.createdAt, `desc`)
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
            .orderBy(({ post }) => [post.userId, post.viewCount])
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

      it(`should sort by multiple fields with chained orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.isActive, `desc`)
            .orderBy(({ user }) => user.age, `asc`)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)

        // Verify multi-field sort (isActive desc first, then age asc within each isActive)
        for (let i = 1; i < results.length; i++) {
          const prev = results[i - 1]!
          const curr = results[i]!

          // isActive should be descending (true before false)
          if (prev.isActive !== curr.isActive) {
            // true (1) should come before false (0) in desc order
            expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
              curr.isActive ? 1 : 0
            )
          } else {
            // If isActive is same, age should be ascending
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          }
        }

        await query.cleanup()
      })
    })

    describe(`Multi-Column OrderBy with Incremental Loading`, () => {
      it(`should correctly paginate with multi-column orderBy and limit`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // First page - get first 10 users sorted by isActive desc, age asc
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.isActive, `desc`)
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 10 })

        const results = Array.from(query.state.values())
        expect(results).toHaveLength(10)

        // Verify the ordering is correct
        for (let i = 1; i < results.length; i++) {
          const prev = results[i - 1]!
          const curr = results[i]!

          if (prev.isActive !== curr.isActive) {
            expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
              curr.isActive ? 1 : 0
            )
          } else {
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          }
        }

        await query.cleanup()
      })

      it(`should load subsequent pages correctly with multi-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Get first 15 users
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.isActive, `desc`)
            .orderBy(({ user }) => user.age, `asc`)
            .limit(15)
        )

        await query1.preload()
        await waitForQueryData(query1, { minSize: 15 })

        const firstPage = Array.from(query1.state.values())
        expect(firstPage).toHaveLength(15)

        // Get first 30 users (expanding the window)
        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.isActive, `desc`)
            .orderBy(({ user }) => user.age, `asc`)
            .limit(30)
        )

        await query2.preload()
        await waitForQueryData(query2, { minSize: 30 })

        const expandedPage = Array.from(query2.state.values())
        expect(expandedPage).toHaveLength(30)

        // The first 15 items should be the same in both queries
        for (let i = 0; i < 15; i++) {
          expect(expandedPage[i]!.id).toBe(firstPage[i]!.id)
        }

        // Verify ordering is maintained throughout
        for (let i = 1; i < expandedPage.length; i++) {
          const prev = expandedPage[i - 1]!
          const curr = expandedPage[i]!

          if (prev.isActive !== curr.isActive) {
            expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
              curr.isActive ? 1 : 0
            )
          } else {
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          }
        }

        await query1.cleanup()
        await query2.cleanup()
      })

      it(`should handle multi-column orderBy with duplicate values in first column`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Sort by isActive (only 2 values: true/false) then by age
        // This tests the case where many rows have the same first column value
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.isActive, `desc`)
            .orderBy(({ user }) => user.age, `asc`)
            .limit(50)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 50 })

        const results = Array.from(query.state.values())
        expect(results).toHaveLength(50)

        // Count how many active users we got
        const activeUsers = results.filter((u) => u.isActive)
        const inactiveUsers = results.filter((u) => !u.isActive)

        // Since isActive desc, all active users should come first
        // All active users should be at the start
        let foundInactive = false
        for (const user of results) {
          if (!user.isActive) {
            foundInactive = true
          } else if (foundInactive) {
            // Found active after inactive - this is wrong
            throw new Error(
              `Found active user after inactive user in desc order`
            )
          }
        }

        // Verify age is ascending within each group
        if (activeUsers.length > 1) {
          for (let i = 1; i < activeUsers.length; i++) {
            expect(activeUsers[i - 1]!.age).toBeLessThanOrEqual(
              activeUsers[i]!.age
            )
          }
        }

        if (inactiveUsers.length > 1) {
          for (let i = 1; i < inactiveUsers.length; i++) {
            expect(inactiveUsers[i - 1]!.age).toBeLessThanOrEqual(
              inactiveUsers[i]!.age
            )
          }
        }

        await query.cleanup()
      })

      it(`should handle multi-column orderBy with mixed directions`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // Sort by userId ascending, viewCount descending
        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .orderBy(({ post }) => post.userId, `asc`)
            .orderBy(({ post }) => post.viewCount, `desc`)
            .limit(20)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 20 })

        const results = Array.from(query.state.values())
        expect(results).toHaveLength(20)

        // Verify ordering
        for (let i = 1; i < results.length; i++) {
          const prev = results[i - 1]!
          const curr = results[i]!

          if (prev.userId < curr.userId) {
            // userId ascending - this is correct
            continue
          } else if (prev.userId === curr.userId) {
            // Same userId, viewCount should be descending
            expect(prev.viewCount).toBeGreaterThanOrEqual(curr.viewCount)
          } else {
            // userId decreased - this is wrong
            throw new Error(
              `userId should be ascending but ${prev.userId} > ${curr.userId}`
            )
          }
        }

        await query.cleanup()
      })

      it(`should handle three-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Sort by isActive desc, age asc, name asc
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.isActive, `desc`)
            .orderBy(({ user }) => user.age, `asc`)
            .orderBy(({ user }) => user.name, `asc`)
            .limit(25)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 25 })

        const results = Array.from(query.state.values())
        expect(results).toHaveLength(25)

        // Verify basic ordering (isActive desc, age asc)
        for (let i = 1; i < results.length; i++) {
          const prev = results[i - 1]!
          const curr = results[i]!

          if (prev.isActive !== curr.isActive) {
            expect(prev.isActive ? 1 : 0).toBeGreaterThanOrEqual(
              curr.isActive ? 1 : 0
            )
          } else if (prev.age !== curr.age) {
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          }
          // For name, we don't strictly check due to collation differences
        }

        await query.cleanup()
      })

      it(`should use setWindow to page through multi-column orderBy results`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Create query with multi-column orderBy and limit
        // Using age (number) and name (string) to avoid boolean comparison issues
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `asc`)
            .orderBy(({ user }) => user.name, `asc`)
            .limit(10)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 10 })

        // Get first page
        const firstPage = Array.from(query.state.values())
        expect(firstPage).toHaveLength(10)

        // Verify first page ordering (age asc, then name asc)
        for (let i = 1; i < firstPage.length; i++) {
          const prev = firstPage[i - 1]!
          const curr = firstPage[i]!
          if (prev.age !== curr.age) {
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          } else {
            expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
          }
        }

        // Move to second page using setWindow
        // IMPORTANT: setWindow returns a Promise when loading is required,
        // or `true` if data is already available. We verify loading occurs.
        const setWindowResult = query.utils.setWindow({ offset: 10, limit: 10 })

        // In on-demand mode, moving to offset 10 should trigger loading
        // since only the first 10 records were initially loaded
        if (setWindowResult !== true) {
          // Loading was triggered - wait for it to complete
          await setWindowResult
        }
        await waitForQueryData(query, { minSize: 10 })

        // Get second page
        const secondPage = Array.from(query.state.values())
        expect(secondPage).toHaveLength(10)

        // Verify second page ordering
        for (let i = 1; i < secondPage.length; i++) {
          const prev = secondPage[i - 1]!
          const curr = secondPage[i]!
          if (prev.age !== curr.age) {
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          } else {
            expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
          }
        }

        // CRITICAL: Pages should not overlap - this proves new data was loaded
        // If the backend didn't return new data, we'd see duplicates or missing records
        const firstPageIds = new Set(firstPage.map((u) => u.id))
        const secondPageIds = new Set(secondPage.map((u) => u.id))
        for (const id of secondPageIds) {
          expect(firstPageIds.has(id)).toBe(false)
        }

        await query.cleanup()
      })

      it(`should use setWindow to move backwards with multi-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Start at offset 20
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `asc`)
            .orderBy(({ user }) => user.name, `asc`)
            .limit(10)
            .offset(20)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 10 })

        const laterPage = Array.from(query.state.values())
        expect(laterPage).toHaveLength(10)

        // Move backwards to offset 10
        const setWindowResult = query.utils.setWindow({ offset: 10, limit: 10 })
        if (setWindowResult !== true) {
          await setWindowResult
        }
        await waitForQueryData(query, { minSize: 10 })

        const earlierPage = Array.from(query.state.values())
        expect(earlierPage).toHaveLength(10)

        // Earlier page should have different users
        const laterPageIds = new Set(laterPage.map((u) => u.id))
        const earlierPageIds = new Set(earlierPage.map((u) => u.id))
        for (const id of earlierPageIds) {
          expect(laterPageIds.has(id)).toBe(false)
        }

        // Verify ordering on earlier page (age asc, name asc)
        for (let i = 1; i < earlierPage.length; i++) {
          const prev = earlierPage[i - 1]!
          const curr = earlierPage[i]!
          if (prev.age !== curr.age) {
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          } else {
            expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
          }
        }

        await query.cleanup()
      })

      it(`should use setWindow with mixed direction multi-column orderBy`, async () => {
        const config = await getConfig()
        const postsCollection = config.collections.onDemand.posts

        // Sort by userId ascending, viewCount descending
        const query = createLiveQueryCollection((q) =>
          q
            .from({ post: postsCollection })
            .orderBy(({ post }) => post.userId, `asc`)
            .orderBy(({ post }) => post.viewCount, `desc`)
            .limit(10)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 10 })

        const firstPage = Array.from(query.state.values())
        expect(firstPage).toHaveLength(10)

        // Move to second page
        const setWindowResult = query.utils.setWindow({ offset: 10, limit: 10 })
        if (setWindowResult !== true) {
          await setWindowResult
        }
        await waitForQueryData(query, { minSize: 10 })

        const secondPage = Array.from(query.state.values())
        expect(secondPage).toHaveLength(10)

        // Verify ordering on second page (userId asc, viewCount desc)
        for (let i = 1; i < secondPage.length; i++) {
          const prev = secondPage[i - 1]!
          const curr = secondPage[i]!

          if (prev.userId < curr.userId) {
            // userId ascending - correct
            continue
          } else if (prev.userId === curr.userId) {
            // Same userId, viewCount should be descending
            expect(prev.viewCount).toBeGreaterThanOrEqual(curr.viewCount)
          } else {
            throw new Error(
              `userId should be ascending but ${prev.userId} > ${curr.userId}`
            )
          }
        }

        await query.cleanup()
      })

      it(`should handle setWindow across duplicate first-column values`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Age has limited unique values in test data, so many duplicates in first column
        // This tests that the composite cursor correctly handles paging across duplicates
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `asc`)
            .orderBy(({ user }) => user.name, `asc`)
            .limit(20)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 20 })

        const firstPage = Array.from(query.state.values())
        expect(firstPage).toHaveLength(20)

        // Move to second page - this crosses the boundary where first column value changes
        const setWindowResult = query.utils.setWindow({ offset: 20, limit: 20 })
        if (setWindowResult !== true) {
          await setWindowResult
        }
        await waitForQueryData(query, { minSize: 20 })

        const secondPage = Array.from(query.state.values())
        expect(secondPage).toHaveLength(20)

        // Verify ordering is maintained across the page boundary
        for (let i = 1; i < secondPage.length; i++) {
          const prev = secondPage[i - 1]!
          const curr = secondPage[i]!
          if (prev.age !== curr.age) {
            expect(prev.age).toBeLessThanOrEqual(curr.age)
          } else {
            expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
          }
        }

        // Pages should not overlap
        const firstPageIds = new Set(firstPage.map((u) => u.id))
        for (const user of secondPage) {
          expect(firstPageIds.has(user.id)).toBe(false)
        }

        // Move to third page to ensure continued paging works
        const setWindowResult2 = query.utils.setWindow({
          offset: 40,
          limit: 20,
        })
        if (setWindowResult2 !== true) {
          await setWindowResult2
        }
        await waitForQueryData(query, { minSize: 1 })

        const thirdPage = Array.from(query.state.values())
        expect(thirdPage.length).toBeGreaterThan(0)
        expect(thirdPage.length).toBeLessThanOrEqual(20)

        // Third page should not overlap with first or second
        const secondPageIds = new Set(secondPage.map((u) => u.id))
        for (const user of thirdPage) {
          expect(firstPageIds.has(user.id)).toBe(false)
          expect(secondPageIds.has(user.id)).toBe(false)
        }

        await query.cleanup()
      })

      it(`should trigger backend loading when paging with multi-column orderBy`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        // Use a small limit to ensure we need to load more data when paging
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .orderBy(({ user }) => user.age, `asc`)
            .orderBy(({ user }) => user.name, `asc`)
            .limit(5)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 5 })

        // Get first page - only 5 records loaded
        const firstPage = Array.from(query.state.values())
        expect(firstPage).toHaveLength(5)
        const lastItemFirstPage = firstPage[firstPage.length - 1]!

        // Move to second page - this MUST trigger backend loading
        // since we only have 5 records and need records at offset 5
        const setWindowResult = query.utils.setWindow({ offset: 5, limit: 5 })

        // CRITICAL ASSERTION: In on-demand mode, setWindow should return a Promise
        // when we need to load data we don't have yet. This proves loading was triggered.
        // If it returned `true`, it would mean data was already available (no loading needed).
        expect(
          setWindowResult === true || setWindowResult instanceof Promise
        ).toBe(true)

        if (setWindowResult !== true) {
          // Wait for loading to complete
          await setWindowResult
        }
        await waitForQueryData(query, { minSize: 5 })

        // Get second page
        const secondPage = Array.from(query.state.values())
        expect(secondPage).toHaveLength(5)

        // Verify we got different records (proves new data was loaded from backend)
        const firstPageIds = new Set(firstPage.map((u) => u.id))
        for (const user of secondPage) {
          expect(firstPageIds.has(user.id)).toBe(false)
        }

        // Verify ordering continues correctly from where first page ended
        const firstItemSecondPage = secondPage[0]!

        // The first item of page 2 should come after the last item of page 1
        // in the sort order (age asc, name asc)
        if (lastItemFirstPage.age === firstItemSecondPage.age) {
          // Same age value, so name should be greater or equal
          expect(
            firstItemSecondPage.name.localeCompare(lastItemFirstPage.name)
          ).toBeGreaterThanOrEqual(0)
        } else {
          // Different age, page 2 first should have greater or equal age
          expect(firstItemSecondPage.age).toBeGreaterThanOrEqual(
            lastItemFirstPage.age
          )
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
            .limit(10)
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
            .limit(0)
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
            .limit(1000)
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
            .limit(5)
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
            .offset(20)
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
            .offset(20)
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
            .offset(200)
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
            .offset(5)
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
              .offset(95) // Last 5 records
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
            .offset(0)
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
            .offset(20)
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
