/**
 * Progressive Mode Test Suite
 *
 * Tests progressive sync mode behavior including:
 * - Snapshot loading during initial sync
 * - Atomic swap on first up-to-date
 * - Incremental updates after swap
 * - Txid tracking behavior
 */

import { describe, expect, it } from 'vitest'
import { createLiveQueryCollection, eq, gt } from '@tanstack/db'
import { waitFor, waitForQueryData } from '../utils/helpers'
import type { E2ETestConfig, User } from '../types'
import type { Collection } from '@tanstack/db'
import type { ElectricCollectionUtils } from '@tanstack/electric-db-collection'

export function createProgressiveTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe(`Progressive Mode Suite`, () => {
    describe(`Basic Progressive Mode`, () => {
      it(`should explicitly validate snapshot phase and atomic swap transition`, async () => {
        const config = await getConfig()
        if (!config.collections.progressive || !config.progressiveTestControl) {
          return // Skip if progressive collections or test control not available
        }
        const progressiveUsers = config.collections.progressive.users

        // Start sync for this test
        progressiveUsers.startSyncImmediate()

        // === PHASE 1: SNAPSHOT PHASE ===
        // Collection might already be ready from a previous test
        // (progressive collections are shared and not cleaned up between tests)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const initialStatus = progressiveUsers.status

        // If already ready, we can't test the explicit transition
        if (initialStatus === `ready`) {
          console.log(
            `Progressive collection already ready, skipping explicit transition test`,
          )
          return
        }

        // Should be loading or idle (hook prevents marking ready)
        expect([`idle`, `loading`]).toContain(initialStatus)

        // Create a query - this triggers fetchSnapshot
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25)),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1, timeout: 10000 })

        // Validate snapshot data
        const snapshotQuerySize = query.size
        const snapshotItems = Array.from(query.values())

        expect(snapshotQuerySize).toBeGreaterThan(0)
        snapshotItems.forEach((user) => {
          expect(user.age).toBe(25)
          expect(user.id).toBeDefined()
          expect(user.name).toBeDefined()
        })

        // Collection should STILL be loading (paused before atomic swap)
        expect(progressiveUsers.status).toBe(`loading`)

        // Collection has snapshot data
        const snapshotCollectionSize = progressiveUsers.size
        expect(snapshotCollectionSize).toBeGreaterThan(0)

        // === PHASE 2: TRIGGER ATOMIC SWAP ===
        config.progressiveTestControl.releaseInitialSync()

        // === PHASE 3: POST-SWAP (FULLY SYNCED) ===
        // Wait for ready (atomic swap complete)
        await waitFor(() => progressiveUsers.status === `ready`, {
          timeout: 30000,
          message: `Progressive collection did not complete sync`,
        })

        // Collection now has full dataset (more than just snapshot)
        const finalCollectionSize = progressiveUsers.size
        expect(finalCollectionSize).toBeGreaterThan(snapshotQuerySize)

        // Query still works with consistent data
        const finalQueryItems = Array.from(query.values())
        finalQueryItems.forEach((user) => {
          expect(user.age).toBe(25) // Still matches predicate
          expect(user.id).toBeDefined()
        })

        // Verify original snapshot items are still present after swap
        snapshotItems.forEach((originalUser) => {
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

        // Start sync for this test
        progressiveUsers.startSyncImmediate()

        // Query a subset (triggers snapshot fetch)
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25)),
        )

        await query.preload()

        // Wait for query to have snapshot data
        await waitForQueryData(query, { minSize: 1, timeout: 10000 })

        // Collection should still be loading if test control is active
        const wasStillLoading = progressiveUsers.status === `loading`

        // Release the initial sync to allow atomic swap
        if (config.progressiveTestControl) {
          config.progressiveTestControl.releaseInitialSync()
        }

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
              (u) => u.id === originalUser.id,
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

        // Start sync for this test
        progressiveUsers.startSyncImmediate()

        // Create multiple queries with different predicates
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25)),
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => gt(user.age, 30)),
        )

        await Promise.all([query1.preload(), query2.preload()])

        // Wait for both to load snapshots
        await Promise.all([
          waitForQueryData(query1, { minSize: 1, timeout: 10000 }),
          waitForQueryData(query2, { minSize: 1, timeout: 10000 }),
        ])

        // Release initial sync to allow atomic swap
        if (config.progressiveTestControl) {
          config.progressiveTestControl.releaseInitialSync()
        }

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

        // Release initial sync immediately (we don't care about snapshot phase for this test)
        if (config.progressiveTestControl) {
          config.progressiveTestControl.releaseInitialSync()
        }

        // Wait for full sync
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
            .limit(5),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1, timeout: 10000 })

        const snapshotPhaseSize = query.size

        // Release initial sync to allow atomic swap
        if (config.progressiveTestControl) {
          config.progressiveTestControl.releaseInitialSync()
        }

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
              .where(({ user }) => eq(user.age, 30)),
          ),
        )

        // Execute concurrently
        await Promise.all(queries.map((q) => q.preload()))

        // Wait for data
        await Promise.all(
          queries.map((q) =>
            waitForQueryData(q, { minSize: 1, timeout: 10000 }),
          ),
        )

        // Release initial sync to allow completion
        if (config.progressiveTestControl) {
          config.progressiveTestControl.releaseInitialSync()
        }

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

    describe(`Txid Tracking Behavior (Electric only)`, () => {
      it(`should not track txids during snapshot phase but track them after atomic swap`, async () => {
        const config = await getConfig()
        if (
          !config.collections.progressive ||
          !config.mutations?.insertUser ||
          !config.getTxid
        ) {
          return // Skip if progressive collections, mutations, or getTxid not available
        }
        const progressiveUsers = config.collections.progressive
          .users as Collection<User, string, ElectricCollectionUtils>

        // awaitTxId is guaranteed to exist on ElectricCollectionUtils
        // This test is Electric-only via the describe block name

        // Start sync but don't release yet (stay in snapshot phase)
        progressiveUsers.startSyncImmediate()
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Should be in loading state (snapshot phase)
        if (progressiveUsers.status !== `loading`) {
          console.log(
            `Collection already ready, cannot test snapshot phase txid behavior`,
          )
          return
        }

        // === PHASE 1: INSERT DURING SNAPSHOT PHASE ===
        const snapshotPhaseUser = {
          id: crypto.randomUUID(),
          name: `Snapshot Phase User`,
          email: `snapshot@test.com`,
          age: 28,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        }

        // Insert user and track when awaitTxId completes
        let txidResolved = false

        // Start the insert
        await config.mutations.insertUser(snapshotPhaseUser)

        // Get the txid from postgres
        const txid = await config.getTxid()

        if (!txid) {
          console.log(`Could not get txid, skipping txid tracking validation`)
          config.progressiveTestControl?.releaseInitialSync()
          return
        }

        // Start awaiting the txid (should NOT resolve during snapshot phase)
        progressiveUsers.utils.awaitTxId(txid, 60000).then(() => {
          txidResolved = true
        })

        // Wait a moment for sync to process
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Txid should NOT have resolved yet (snapshot phase, txids not tracked)
        expect(txidResolved).toBe(false)

        // Query for the user (triggers fetchSnapshot with this user)
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.id, snapshotPhaseUser.id)),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1, timeout: 10000 })

        // User should be in snapshot data
        expect(query.size).toBe(1)
        expect(query.get(snapshotPhaseUser.id)).toBeDefined()

        // But collection is still in snapshot phase
        expect(progressiveUsers.status).toBe(`loading`)

        // Txid should STILL not have resolved (snapshot doesn't track txids)
        expect(txidResolved).toBe(false)

        // === PHASE 2: TRIGGER ATOMIC SWAP ===
        if (config.progressiveTestControl) {
          config.progressiveTestControl.releaseInitialSync()
        }

        // Wait for atomic swap to complete
        await waitFor(() => progressiveUsers.status === `ready`, {
          timeout: 30000,
          message: `Progressive collection did not complete sync`,
        })

        // NOW txid should resolve (buffered messages include txids)
        await waitFor(() => txidResolved, {
          timeout: 5000,
          message: `Txid did not resolve after atomic swap`,
        })

        expect(txidResolved).toBe(true)

        // === PHASE 3: VERIFY TXID TRACKING POST-SWAP ===
        // User should still be present after atomic swap
        expect(progressiveUsers.get(snapshotPhaseUser.id)).toBeDefined()

        // Now insert another user and verify txid tracking works
        const postSwapUser = {
          id: crypto.randomUUID(),
          name: `Post Swap User`,
          email: `postswap@test.com`,
          age: 29,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        }

        await config.mutations.insertUser(postSwapUser)

        // Wait for incremental update (txid tracking should work now)
        if (config.hasReplicationLag) {
          await waitFor(() => progressiveUsers.has(postSwapUser.id), {
            timeout: 10000,
            message: `Post-swap user not synced via incremental update`,
          })
        }

        // Both users should be present
        expect(progressiveUsers.get(snapshotPhaseUser.id)).toBeDefined()
        expect(progressiveUsers.get(postSwapUser.id)).toBeDefined()

        await query.cleanup()
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
        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: progressiveUsers })
            .where(({ user }) => eq(user.age, 25)),
        )

        await query.preload()

        // Release initial sync
        if (config.progressiveTestControl) {
          config.progressiveTestControl.releaseInitialSync()
        }

        // Don't wait for data, just cleanup immediately
        await query.cleanup()

        // Should not throw
        expect(true).toBe(true)
      })
    })
  })
}
