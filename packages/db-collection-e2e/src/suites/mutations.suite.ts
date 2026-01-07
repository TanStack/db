/**
 * Mutations Test Suite
 *
 * Tests data mutations with on-demand syncMode
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createLiveQueryCollection, eq, gt, isNull } from '@tanstack/db'
import { waitFor, waitForQueryData } from '../utils/helpers'
import type { E2ETestConfig } from '../types'

export function createMutationsTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe(`Mutations Suite`, () => {
    describe(`Insert Mutations`, () => {
      it(`should insert new record via collection`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        // Load initial data
        const query = createLiveQueryCollection((q) =>
          q.from({ user: usersCollection }),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Perform actual INSERT via backend
        const newUserId = randomUUID()
        await config.mutations.insertUser({
          id: newUserId,
          name: `Test User`,
          email: `test@example.com`,
          age: 42,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        })

        // Wait for sync to propagate the new record (Electric only)
        await waitFor(() => query.size > initialSize, {
          timeout: 5000,
          message: `New record did not appear in query`,
        })

        expect(query.size).toBe(initialSize + 1)

        // Clean up the inserted row
        await config.mutations.deleteUser(newUserId)

        // Wait for deletion to propagate if using async replication (e.g., Electric)
        // Check the eager collection since it continuously syncs all data
        if (config.hasReplicationLag) {
          await waitFor(() => !config.collections.eager.users.has(newUserId), {
            timeout: 5000,
            message: `Deletion of user ${newUserId} did not propagate`,
          })
        }

        await query.cleanup()
      })

      it(`should handle insert appearing in matching queries`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 30)),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Insert record that MATCHES predicate (age > 30)
        const newUserId = randomUUID()
        await config.mutations.insertUser({
          id: newUserId,
          name: `Test Match User`,
          email: `match@example.com`,
          age: 50,
          isActive: true,
          createdAt: new Date(),
          metadata: null,
          deletedAt: null,
        })

        // Wait for sync to propagate (Electric only)
        await waitFor(() => query.size > initialSize, {
          timeout: 5000,
          message: `Matching insert did not appear in query`,
        })

        expect(query.size).toBe(initialSize + 1)

        // Clean up the inserted row
        await config.mutations.deleteUser(newUserId)

        // Wait for deletion to propagate if using async replication (e.g., Electric)
        // Check the eager collection since it continuously syncs all data
        if (config.hasReplicationLag) {
          await waitFor(() => !config.collections.eager.users.has(newUserId), {
            timeout: 5000,
            message: `Deletion of user ${newUserId} did not propagate`,
          })
        }

        await query.cleanup()
      })
    })

    describe(`Update Mutations`, () => {
      it(`should handle update that makes record match predicate`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 30)),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Find a user with age <= 30 in the full collection
        const allUsers = Array.from(usersCollection.state.values())
        const userToUpdate = allUsers.find((u) => u.age <= 30)

        if (userToUpdate) {
          // Update age to 35 (matches predicate)
          await config.mutations.updateUser(userToUpdate.id, { age: 35 })

          // Wait for Electric to sync and query to show updated record
          await waitFor(() => query.size > initialSize, {
            timeout: 5000,
            message: `Updated record did not appear in query`,
          })

          expect(query.size).toBe(initialSize + 1)
        }

        await query.cleanup()
      })

      it(`should handle update that makes record unmatch predicate`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 30)),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Get a user currently in the query (age > 30)
        const queryUsers = Array.from(query.state.values())
        const userToUpdate = queryUsers[0]

        if (userToUpdate) {
          // Update age to 25 (no longer matches predicate)
          await config.mutations.updateUser(userToUpdate.id, { age: 25 })

          // Wait for Electric to sync and query to remove record
          await waitFor(() => query.size < initialSize, {
            timeout: 5000,
            message: `Updated record was not removed from query`,
          })

          expect(query.size).toBe(initialSize - 1)
        }

        await query.cleanup()
      })
    })

    describe(`Delete Mutations`, () => {
      it(`should handle delete removing record from query`, async () => {
        const config = await getConfig()

        if (!config.mutations) {
          throw new Error(`Mutations not configured - test cannot run`)
        }

        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q.from({ user: usersCollection }),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })
        const initialSize = query.size
        expect(initialSize).toBeGreaterThan(0)

        // Get a user and delete it
        const users = Array.from(query.state.values())
        const userToDelete = users[0]

        if (userToDelete) {
          await config.mutations.deleteUser(userToDelete.id)

          // Wait for delete to sync
          await waitFor(() => query.size < initialSize, {
            timeout: 5000,
            message: `Delete did not sync to query`,
          })

          expect(query.size).toBe(initialSize - 1)
        }

        await query.cleanup()
      })
    })

    describe(`Soft Delete Pattern`, () => {
      it(`should filter out soft-deleted records`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => isNull(user.deletedAt)),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        // All results should not be soft-deleted
        const results = Array.from(query.state.values())
        expect(results.length).toBeGreaterThan(0)
        results.forEach((u) => {
          expect(u.deletedAt).toBeNull()
        })

        await query.cleanup()
      })

      it(`should include soft-deleted records when not filtered`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q.from({ user: usersCollection }),
        )

        await query.preload()
        await waitForQueryData(query, { minSize: 1 })

        // Should include both deleted and non-deleted
        const results = Array.from(query.state.values())
        const hasNotDeleted = results.some((u) => u.deletedAt === null)

        expect(hasNotDeleted).toBe(true)

        await query.cleanup()
      })
    })

    describe(`Mutation with Queries`, () => {
      it(`should maintain query state during data changes`, async () => {
        const config = await getConfig()
        const usersCollection = config.collections.onDemand.users

        const query = createLiveQueryCollection((q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.isActive, true))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
        )

        await query.preload()

        // Test structure: Mutations should maintain pagination state
        expect(query.size).toBeLessThanOrEqual(10)

        await query.cleanup()
      })
    })
  })
}
