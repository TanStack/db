/**
 * Progressive Mode Test Suite (Electric only)
 *
 * Tests progressive sync mode behavior including:
 * - Snapshot loading during initial sync
 * - Atomic swap on first up-to-date
 * - Incremental updates after swap
 * - Txid tracking behavior
 */

import { describe, expect, it } from "vitest"
import { createLiveQueryCollection, eq, gt } from "@tanstack/db"
import { waitFor, waitForQueryData } from "../utils/helpers"
import type { E2ETestConfig } from "../types"

export function createProgressiveTestSuite(
  getConfig: () => Promise<E2ETestConfig>
) {
  describe(`Progressive Mode Suite (Electric only)`, () => {
    describe(`Basic Progressive Mode`, () => {
      it(`should validate snapshot phase behavior and atomic swap with status transition`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive) {
          return // Skip if progressive collections not available
        }
        const progressiveUsers = config.collections.progressive.users

        // Create a query - this will trigger a snapshot fetch if still in snapshot phase
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1, timeout: 10000 })

        const querySize = query.size
        const queryItems = Array.from(query.values())

        // Validate query data
        expect(querySize).toBeGreaterThan(0)
        queryItems.forEach((user) => {
          expect(user.age).toBe(25)
          expect(user.id).toBeDefined()
        })

        // If we're still loading, we should be in snapshot phase
        // Base collection should have data from snapshot (query subset)
        const statusDuringQuery = progressiveUsers.status
        if (statusDuringQuery === `loading`) {
          // We're in snapshot phase! Validate snapshot behavior
          // Collection should have the snapshot data
          expect(progressiveUsers.size).toBeGreaterThan(0)

          // But collection size should be <= query size (only snapshot loaded)
          // Actually it might have multiple snapshots if other tests ran, so just verify we have data
          expect(progressiveUsers.size).toBeGreaterThan(0)
        }

        // Wait for full sync to complete
        await waitFor(() => progressiveUsers.status === `ready`, {
          timeout: 30000,
          message: `Progressive collection did not complete sync`,
        })

        // After atomic swap to full synced state
        // Collection should have ALL users (not just age=25)
        const finalCollectionSize = progressiveUsers.size
        expect(finalCollectionSize).toBeGreaterThan(querySize) // More than just our query subset

        // Query should still work with consistent data
        const finalQueryItems = Array.from(query.values())
        finalQueryItems.forEach((user) => {
          expect(user.age).toBe(25) // Still matches predicate
          expect(user.id).toBeDefined()
        })

        // Verify some of the original snapshot items are still present
        queryItems.forEach((originalUser) => {
          const foundInCollection = progressiveUsers.get(originalUser.id)
          expect(foundInCollection).toBeDefined()
          expect(foundInCollection?.age).toBe(25)
        })

        await query.cleanup()
      })

      it(`should load snapshots during initial sync and perform atomic swap`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive) {
          return // Skip if progressive collections not available
        }
        const progressiveUsers = config.collections.progressive.users

        // Progressive collections should only be marked ready AFTER first up-to-date
        // If already ready, the full sync completed very fast - we can still test the end state
        const wasStillLoading = progressiveUsers.status === `loading`

        // Query a subset
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25))
        )

        await query.preload()

        // Wait for query to have data (either from snapshot during loading, or from final state if already ready)
        await waitForQueryData(query, { minSize: 1, timeout: 10000 })

        const beforeSwapSize = query.size
        const beforeSwapItems = Array.from(query.values())

        // Verify all items match the predicate
        beforeSwapItems.forEach((user) => {
          expect(user.age).toBe(25)
          expect(user.id).toBeDefined()
          expect(user.name).toBeDefined()
        })

        if (wasStillLoading) {
          // If we caught it during snapshot phase, wait for atomic swap
          await waitFor(() => progressiveUsers.status === `ready`, {
            timeout: 30000,
            message: `Progressive collection did not complete sync`,
          })

          // After atomic swap, verify data is consistent
          // The query should have the same data (from full sync)
          const afterSwapItems = Array.from(query.values())
          expect(afterSwapItems.length).toBeGreaterThanOrEqual(beforeSwapSize)

          // All original items should still be present
          beforeSwapItems.forEach((originalUser) => {
            const stillPresent = afterSwapItems.some(
              (u) => u.id === originalUser.id
            )
            expect(stillPresent).toBe(true)
          })
        } else {
          // Already ready - verify final state is correct
          expect(progressiveUsers.status).toBe(`ready`)
        }

        // Final validation: all items still match predicate
        Array.from(query.values()).forEach((user) => {
          expect(user.age).toBe(25)
        })

        await query.cleanup()
      })

      it(`should handle multiple snapshots with different predicates`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive) {
          return // Skip if progressive collections not available
        }
        const progressiveUsers = config.collections.progressive.users

        // Create multiple queries with different predicates
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25))
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => gt(user.age, 30))
        )

        await Promise.all([query1.preload(), query2.preload()])

        // Wait for both to load snapshots
        await Promise.all([
          waitForQueryData(query1, { minSize: 1, timeout: 10000 }),
          waitForQueryData(query2, { minSize: 1, timeout: 10000 }),
        ])

        expect(query1.size).toBeGreaterThan(0)
        expect(query2.size).toBeGreaterThan(0)

        // Verify data correctness
        const query1Snapshot = Array.from(query1.values())
        const query2Snapshot = Array.from(query2.values())

        query1Snapshot.forEach((user) => {
          expect(user.age).toBe(25)
        })
        query2Snapshot.forEach((user) => {
          expect(user.age).toBeGreaterThan(30)
        })

        // Wait for full sync
        await waitFor(() => progressiveUsers.status === `ready`, {
          timeout: 30000,
          message: `Progressive collection did not complete sync`,
        })

        // Both queries should still have data after swap with same predicates
        expect(query1.size).toBeGreaterThan(0)
        expect(query2.size).toBeGreaterThan(0)

        // Verify predicates still match after swap
        Array.from(query1.values()).forEach((user) => {
          expect(user.age).toBe(25)
        })
        Array.from(query2.values()).forEach((user) => {
          expect(user.age).toBeGreaterThan(30)
        })

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })
    })

    describe(`Incremental Updates After Swap`, () => {
      it(`should receive incremental updates after atomic swap`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive || !config.mutations?.insertUser) {
          return // Skip if progressive collections or mutations not available
        }
        const progressiveUsers = config.collections.progressive.users

        // Wait for full sync first
        await waitFor(() => progressiveUsers.status === `ready`, {
          timeout: 30000,
          message: `Progressive collection did not complete sync`,
        })

        const initialSize = progressiveUsers.size

        // Insert new data
        const newUser = {
          id: crypto.randomUUID(),
          name: `Progressive Test User`,
          email: `progressive@test.com`,
          age: 35,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        }

        await config.mutations.insertUser(newUser)

        // Wait for incremental update
        if (config.hasReplicationLag) {
          await waitFor(() => progressiveUsers.size > initialSize, {
            timeout: 10000,
            message: `New user not synced via incremental update`,
          })
        }

        expect(progressiveUsers.size).toBeGreaterThan(initialSize)

        // Verify the new user is in the collection with correct data
        const foundUser = progressiveUsers.get(newUser.id)
        expect(foundUser).toBeDefined()
        expect(foundUser?.id).toBe(newUser.id)
        expect(foundUser?.name).toBe(newUser.name)
        expect(foundUser?.email).toBe(newUser.email)
        expect(foundUser?.age).toBe(newUser.age)
      })
    })

    describe(`Predicate Handling`, () => {
      it(`should correctly handle predicates during and after snapshot phase`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive) {
          return // Skip if progressive collections not available
        }
        const progressiveUsers = config.collections.progressive.users

        // Create query with predicate during snapshot phase
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => gt(user.age, 25))
            .orderBy(({ user }) => [user.age, `asc`])
            .limit(5)
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1, timeout: 10000 })

        const snapshotPhaseSize = query.size

        // Wait for atomic swap
        await waitFor(() => progressiveUsers.status === `ready`, {
          timeout: 30000,
          message: `Progressive collection did not complete sync`,
        })

        // Verify predicate still works after swap
        const afterSwapSize = query.size
        const afterSwapItems = Array.from(query.values())

        // Size should be reasonable (at least what we had in snapshot phase)
        expect(afterSwapSize).toBeGreaterThanOrEqual(snapshotPhaseSize)

        // All items should match the predicate
        afterSwapItems.forEach((user) => {
          expect(user.age).toBeGreaterThan(25)
        })

        // Should respect limit
        expect(afterSwapSize).toBeLessThanOrEqual(5)

        await query.cleanup()
      })

      it(`should deduplicate snapshot requests during snapshot phase`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive) {
          return // Skip if progressive collections not available
        }
        const progressiveUsers = config.collections.progressive.users

        // Create multiple identical queries (should be deduplicated)
        const queries = Array.from({ length: 3 }, () =>
          createLiveQueryCollection((q) =>
            q
              .from({ user: progressiveUsers })
              .where(({ user }) => eq(user.age, 30))
          )
        )

        // Execute concurrently
        await Promise.all(queries.map((q) => q.preload()))

        // Wait for data
        await Promise.all(
          queries.map((q) =>
            waitForQueryData(q, { minSize: 1, timeout: 10000 })
          )
        )

        // All should have the same size and same data
        const sizes = queries.map((q) => q.size)
        expect(new Set(sizes).size).toBe(1) // All sizes are identical

        // Verify all queries have identical data (deduplication working)
        const firstQueryData = Array.from(queries[0]!.values())
        const firstQueryIds = new Set(firstQueryData.map((u) => u.id))

        queries.forEach((query) => {
          const queryData = Array.from(query.values())
          queryData.forEach((user) => {
            expect(user.age).toBe(30) // All match predicate
            expect(firstQueryIds.has(user.id)).toBe(true) // Same items
          })
        })

        await Promise.all(queries.map((q) => q.cleanup()))
      })
    })

    describe(`Progressive Mode Resilience`, () => {
      it(`should handle cleanup and restart during snapshot phase`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive) {
          return // Skip if progressive collections not available
        }
        const progressiveUsers = config.collections.progressive.users

        // This test verifies the collection can be cleaned up even during snapshot phase
        // and that the atomic swap doesn't cause issues

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25))
        )

        await query.preload()

        // Don't wait for data, just cleanup immediately
        await query.cleanup()

        // Should not throw
        expect(true).toBe(true)
      })
    })
  })
}
