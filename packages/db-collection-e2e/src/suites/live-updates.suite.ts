/**
 * Live Updates Test Suite (Optional, Electric-specific)
 *
 * Tests reactive updates for sync-enabled collections
 */

import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { createLiveQueryCollection, gt, lt } from "@tanstack/db"
import { waitFor, waitForQueryData } from "../utils/helpers"
import type { E2ETestConfig } from "../types"

export function createLiveUpdatesTestSuite(
  getConfig: () => Promise<E2ETestConfig>
) {
  describe(`Live Updates Suite`, () => {
    describe(`Reactive Updates`, () => {
      it(`should receive updates when backend data changes`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 30))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Insert a new user with age > 30
        const newUserId = randomUUID()
        await config.mutations.insertUser({
          id: newUserId,
          name: `Live Update User`,
          email: null,
          age: 45,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        })

        // Query should reactively update
        await waitFor(() => query.size > initialSize, {
          timeout: 5000,
          message: `Query did not receive live update`,
        })

        expect(query.size).toBe(initialSize + 1)

        // Clean up the inserted row
        await config.mutations.deleteUser(newUserId)

        // Wait for deletion to propagate if using async replication (e.g., Electric)
        if (config.hasReplicationLag) {
          await waitFor(
            () => !config.collections.onDemand.users.has(newUserId),
            {
              timeout: 5000,
              message: `Deletion of user ${newUserId} did not propagate`,
            }
          )
        }

        await query.cleanup()
      })

      it(`should add new records that match query predicate`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 30))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Insert record with age=35 (matches predicate)
        const newUserId = randomUUID()
        await config.mutations.insertUser({
          id: newUserId,
          name: `Matching User`,
          email: null,
          age: 35,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        })

        // Should appear in query results reactively
        await waitFor(() => query.size > initialSize, {
          timeout: 5000,
          message: `New matching record did not appear`,
        })

        expect(query.size).toBe(initialSize + 1)

        // Clean up the inserted row
        await config.mutations.deleteUser(newUserId)

        // Wait for deletion to propagate if using async replication (e.g., Electric)
        if (config.hasReplicationLag) {
          await waitFor(
            () => !config.collections.onDemand.users.has(newUserId),
            {
              timeout: 5000,
              message: `Deletion of user ${newUserId} did not propagate`,
            }
          )
        }

        await query.cleanup()
      })

      it(`should remove records that no longer match predicate`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 30))
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Get a user currently in the query and update to not match
        const queryUsers = Array.from(query.state.values())
        const userToUpdate = queryUsers[0]

        if (userToUpdate) {
          // Update age to 25 (no longer matches age > 30)
          await config.mutations.updateUser(userToUpdate.id, { age: 25 })

          // Should be removed from query results
          await waitFor(() => query.size < initialSize, {
            timeout: 5000,
            message: `Updated record was not removed from query`,
          })

          expect(query.size).toBe(initialSize - 1)
        }

        await query.cleanup()
      })
    })

    describe(`Subscription Lifecycle`, () => {
      it(`should receive updates when subscribed`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q.from({ user: usersCollection })
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        let changeCount = 0
        const subscription = query.subscribeChanges(() => {
          changeCount++
        })

        // Insert a new user
        const newUserId = randomUUID()
        await config.mutations.insertUser({
          id: newUserId,
          name: `Subscription Test User`,
          email: `sub@example.com`,
          age: 28,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        })

        // Should receive change notification
        await waitFor(() => changeCount > 0, {
          timeout: 5000,
          message: `No change notifications received`,
        })

        expect(changeCount).toBeGreaterThan(0)

        subscription.unsubscribe()

        // Clean up the inserted row
        await config.mutations.deleteUser(newUserId)

        // Wait for deletion to propagate if using async replication (e.g., Electric)
        if (config.hasReplicationLag) {
          await waitFor(
            () => !config.collections.onDemand.users.has(newUserId),
            {
              timeout: 5000,
              message: `Deletion of user ${newUserId} did not propagate`,
            }
          )
        }

        await query.cleanup()
      })
    })

    describe(`Multiple Watchers`, () => {
      it(`should update all queries watching same data`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 25))
        )

        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => lt(user.age, 50))
        )

        await Promise.all([query1.preload(), query2.preload()])
        await waitForQueryData(query1, { minSize: 1 })
        await waitForQueryData(query2, { minSize: 1 })

        // Wait for collections to stabilize (especially important for async replication)
        // This ensures any leftover data from previous tests has been cleaned up
        if (config.hasReplicationLag) {
          let stableSize1 = query1.size
          let stableSize2 = query2.size
          await waitFor(
            () => {
              const currentSize1 = query1.size
              const currentSize2 = query2.size
              const stable =
                currentSize1 === stableSize1 && currentSize2 === stableSize2
              stableSize1 = currentSize1
              stableSize2 = currentSize2
              return stable
            },
            {
              timeout: 10000,
              interval: 200,
              message: `Collections did not stabilize`,
            }
          )
        }

        const initialSize1 = query1.size
        const initialSize2 = query2.size
        expect(initialSize1).toBeGreaterThan(0)
        expect(initialSize2).toBeGreaterThan(0)

        // Insert user with age=35 (matches BOTH queries: 35 > 25 AND 35 < 50)
        const newUserId = randomUUID()
        await config.mutations.insertUser({
          id: newUserId,
          name: `Multi Watch User`,
          email: `multi@example.com`,
          age: 35,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        })

        // Wait for both queries to have exactly the expected size
        await waitFor(
          () =>
            query1.size === initialSize1 + 1 &&
            query2.size === initialSize2 + 1,
          { timeout: 5000, message: `Not all queries received the update` }
        )

        expect(query1.size).toBe(initialSize1 + 1)
        expect(query2.size).toBe(initialSize2 + 1)

        // Clean up the inserted row
        await config.mutations.deleteUser(newUserId)

        // Wait for deletion to propagate if using async replication (e.g., Electric)
        // This prevents the next test from seeing this user when collections restart
        // Check the eager collection since it continuously syncs all data
        if (config.hasReplicationLag) {
          await waitFor(() => !config.collections.eager.users.has(newUserId), {
            timeout: 5000,
            message: `Deletion of user ${newUserId} did not propagate`,
          })
        }

        await Promise.all([query1.cleanup(), query2.cleanup()])
      })
    })

    describe(`Update Existing Records`, () => {
      it(`should update existing records in query results`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q.from({ user: usersCollection })
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        // Get a user and update it
        const users = Array.from(query.state.values())
        const userToUpdate = users[0]

        if (userToUpdate) {
          const originalAge = userToUpdate.age

          // Update the user's age
          await config.mutations.updateUser(userToUpdate.id, {
            age: originalAge + 10,
          })

          // Wait for update to sync
          await waitFor(
            () => {
              const updated = query.get(userToUpdate.id)
              return updated?.age === originalAge + 10
            },
            { timeout: 5000, message: `Update did not sync to query` }
          )

          // Verify the update
          const updatedUser = query.get(userToUpdate.id)
          expect(updatedUser?.age).toBe(originalAge + 10)
        }

        await query.cleanup()
      })
    })
  })
}
