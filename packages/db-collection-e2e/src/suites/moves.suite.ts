/**
 * Tags Test Suite
 *
 * Tests Electric collection tag behavior with subqueries
 * Only Electric collection supports tags (via shapes with subqueries)
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { waitFor } from '../utils/helpers'
import type { E2ETestConfig } from '../types'
import type { Client } from 'pg'
import type { Collection } from '@tanstack/db'
import type { ElectricCollectionUtils } from '@tanstack/electric-db-collection'

interface TagsTestConfig extends E2ETestConfig {
  tagsTestSetup: {
    dbClient: Client
    baseUrl: string
    testSchema: string
    usersTable: string
    postsTable: string
  }
}

type SyncMode = 'eager' | 'on-demand' | 'progressive'

export function createMovesTestSuite(getConfig: () => Promise<TagsTestConfig>) {
  describe(`Moves Suite`, () => {
    let usersTable: string
    let postsTable: string
    let dbClient: Client
    let baseUrl: string
    let testSchema: string
    let config: TagsTestConfig

    beforeAll(async () => {
      config = await getConfig()
      const setup = config.tagsTestSetup
      dbClient = setup.dbClient
      baseUrl = setup.baseUrl
      testSchema = setup.testSchema
      usersTable = setup.usersTable
      postsTable = setup.postsTable
    })

    // Helper to create a collection on posts table with WHERE clause that has nested subquery
    // This creates a shape: posts WHERE userId IN (SELECT id FROM users WHERE isActive = true)
    // When a user's isActive changes, posts will move in/out of this shape
    function createPostsByActiveUsersCollection(
      syncMode: SyncMode,
      id?: string,
    ): Collection<any, string, ElectricCollectionUtils, any, any> {
      // Remove quotes from table names for the WHERE clause SQL
      const usersTableUnquoted = usersTable.replace(/"/g, ``)
      const collectionId =
        id || `tags-posts-active-users-${syncMode}-${Date.now()}`

      return createCollection(
        electricCollectionOptions({
          id: collectionId,
          shapeOptions: {
            url: `${baseUrl}/v1/shape`,
            params: {
              table: `${testSchema}.${postsTable}`,
              // WHERE clause with nested subquery
              // Posts will move in/out when users' isActive changes
              // Column reference should be just the column name, not the full table path
              where: `"userId" IN (SELECT id FROM ${testSchema}.${usersTableUnquoted} WHERE "isActive" = true)`,
            },
          },
          syncMode,
          getKey: (item: any) => item.id,
          startSync: syncMode !== 'progressive',
        }),
      ) as any
    }

    // Helper to wait for collection to be ready
    async function waitForReady(
      collection: Collection<any, any, any, any, any>,
      syncMode: SyncMode,
    ) {
      if (syncMode === 'progressive') {
        // For progressive mode, start sync explicitly
        collection.startSyncImmediate()
      }
      await collection.preload()
      await waitFor(() => collection.status === `ready`, {
        timeout: 30000,
        message: `Collection did not become ready`,
      })
    }

    // Helper to wait for a specific item to appear
    async function waitForItem(
      collection: Collection<any, any, any, any, any>,
      itemId: string,
      timeout: number = 10000,
    ) {
      await waitFor(() => collection.has(itemId), {
        timeout,
        message: `Item ${itemId} did not appear in collection`,
      })
    }

    // Helper to wait for a specific item to disappear
    async function waitForItemRemoved(
      collection: Collection<any, any, any, any, any>,
      itemId: string,
      timeout: number = 2000,
    ) {
      await waitFor(() => !collection.has(itemId), {
        timeout,
        message: `Item ${itemId} was not removed from collection`,
      })
    }

    // Helper function to run all tests for a given sync mode
    function runTestsForSyncMode(syncMode: SyncMode) {
      describe(`${syncMode} mode`, () => {
        it(`Initial snapshot contains only posts from active users`, async () => {
          // Create collection on posts with WHERE clause: userId IN (SELECT id FROM users WHERE isActive = true)
          const collection = createPostsByActiveUsersCollection(syncMode)

          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Insert 2 active users and 1 inactive user
          const userId1 = randomUUID()
          const userId2 = randomUUID()
          const userId3 = randomUUID()

          await config.mutations.insertUser({
            id: userId1,
            name: `Active User 1`,
            email: `user1@test.com`,
            age: 25,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          await config.mutations.insertUser({
            id: userId2,
            name: `Active User 2`,
            email: `user2@test.com`,
            age: 30,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          await config.mutations.insertUser({
            id: userId3,
            name: `Inactive User`,
            email: `user3@test.com`,
            age: 42,
            isActive: false,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert posts for these users
          const postId1 = randomUUID()
          const postId2 = randomUUID()
          const postId3 = randomUUID()

          await config.mutations.insertPost({
            id: postId1,
            userId: userId1,
            title: `Post 1`,
            content: `Content 1`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await config.mutations.insertPost({
            id: postId2,
            userId: userId2,
            title: `Post 2`,
            content: `Content 2`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await config.mutations.insertPost({
            id: postId3,
            userId: userId3,
            title: `Post 3`,
            content: `Content 3`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          // Wait for collection to sync
          await waitForReady(collection, syncMode)

          // Wait for both posts to appear (users are active, so posts match the subquery)
          await waitForItem(collection, postId1)
          await waitForItem(collection, postId2)

          // Verify only posts 1 and 2 are in the collection
          expect(collection.has(postId1)).toBe(true)
          expect(collection.has(postId2)).toBe(true)
          expect(collection.has(postId3)).toBe(false)

          // Wait a bit to make sure post 3 is not coming in later
          await new Promise((resolve) => setTimeout(resolve, 50))
          expect(collection.has(postId3)).toBe(false)

          // Note: Tags are internal to Electric and may not be directly accessible
          // The test verifies that posts with matching conditions appear in snapshot

          // Clean up
          await dbClient.query(`DELETE FROM ${postsTable}`)
          await dbClient.query(`DELETE FROM ${usersTable}`)
          await collection.cleanup()
        })

        it(`Move-in: row becomes eligible for subquery`, async () => {
          const collection = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection, syncMode)

          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Insert user with isActive = false
          const userId = randomUUID()
          await config.mutations.insertUser({
            id: userId,
            name: `Inactive User`,
            email: `inactive@test.com`,
            age: 25,
            isActive: false,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert post for this user
          const postId = randomUUID()
          await config.mutations.insertPost({
            id: postId,
            userId,
            title: `Inactive User Post`,
            content: `Content`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          // Wait a bit to ensure post doesn't appear (user is inactive, so post doesn't match subquery)
          await new Promise((resolve) => setTimeout(resolve, 500))
          expect(collection.has(postId)).toBe(false)

          // Update user to isActive = true (move-in for the post)
          await config.mutations.updateUser(userId, { isActive: true })

          // Wait for post to appear (move-in)
          await waitForItem(collection, postId, 1000)
          expect(collection.has(postId)).toBe(true)
          expect(collection.get(postId)?.title).toBe(`Inactive User Post`)

          // Clean up
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId,
          ])
          await config.mutations.deleteUser(userId)
          await collection.cleanup()
        })

        it(`Move-out: row becomes ineligible for subquery`, async () => {
          const collection = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection, syncMode)

          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Insert user with isActive = true
          const userId = randomUUID()
          await config.mutations.insertUser({
            id: userId,
            name: `Active User`,
            email: `active@test.com`,
            age: 25,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert post for this user
          const postId = randomUUID()
          await config.mutations.insertPost({
            id: postId,
            userId,
            title: `Active User Post`,
            content: `Content`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          // Wait for post to appear (user is active, so post matches subquery)
          await waitForItem(collection, postId)
          expect(collection.has(postId)).toBe(true)

          // Update user to isActive = false (move-out for the post)
          await config.mutations.updateUser(userId, { isActive: false })

          // Wait for post to be removed (move-out)
          await waitForItemRemoved(collection, postId)
          expect(collection.has(postId)).toBe(false)

          // Clean up
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId,
          ])
          await config.mutations.deleteUser(userId)
          await collection.cleanup()
        })

        it(`Move-out → move-in cycle`, async () => {
          const collection = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection, syncMode)

          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Insert user with isActive = true
          const userId = randomUUID()
          await config.mutations.insertUser({
            id: userId,
            name: `Flapping User`,
            email: `flapping@test.com`,
            age: 25,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert post for this user
          const postId = randomUUID()
          await config.mutations.insertPost({
            id: postId,
            userId,
            title: `Flapping Post`,
            content: `Content`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await waitForItem(collection, postId)
          expect(collection.has(postId)).toBe(true)

          // Move-out: isActive = false
          await config.mutations.updateUser(userId, { isActive: false })
          await waitForItemRemoved(collection, postId, 15000)
          expect(collection.has(postId)).toBe(false)

          // Move-in: isActive = true
          await config.mutations.updateUser(userId, { isActive: true })
          await waitForItem(collection, postId, 15000)
          expect(collection.has(postId)).toBe(true)

          // Clean up
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId,
          ])
          await config.mutations.deleteUser(userId)
          await collection.cleanup()
        })

        it(`Tags-only update (row stays within subquery)`, async () => {
          const collection = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection, syncMode)

          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Insert user with isActive = true
          const userId = randomUUID()
          await config.mutations.insertUser({
            id: userId,
            name: `Active User`,
            email: `active@test.com`,
            age: 25,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert post for this user
          const postId = randomUUID()
          await config.mutations.insertPost({
            id: postId,
            userId,
            title: `Tagged Post`,
            content: `Content`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await waitForItem(collection, postId)
          expect(collection.has(postId)).toBe(true)

          // Update post title (tags might change but post stays in subquery since user is still active)
          await dbClient.query(
            `UPDATE ${postsTable} SET title = $1 WHERE id = $2`,
            [`Updated Tagged Post`, postId],
          )

          // Wait a bit and verify post still exists
          await new Promise((resolve) => setTimeout(resolve, 500))
          expect(collection.has(postId)).toBe(true)
          expect(collection.get(postId)?.title).toBe(`Updated Tagged Post`)

          // Clean up
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId,
          ])
          await config.mutations.deleteUser(userId)
          await collection.cleanup()
        })

        it(`Database DELETE leads to row being removed from collection`, async () => {
          const collection = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection, syncMode)

          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Insert user with isActive = true
          const userId = randomUUID()
          await config.mutations.insertUser({
            id: userId,
            name: `Active User`,
            email: `active@test.com`,
            age: 25,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert post for this user
          const postId = randomUUID()
          await config.mutations.insertPost({
            id: postId,
            userId,
            title: `To Be Deleted`,
            content: `Content`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await waitForItem(collection, postId)
          expect(collection.has(postId)).toBe(true)

          // Delete post in Postgres
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId,
          ])

          // Wait for post to be removed
          await waitForItemRemoved(collection, postId)
          expect(collection.has(postId)).toBe(false)

          // Clean up
          await config.mutations.deleteUser(userId)
          await collection.cleanup()
        })

        it(`Snapshot after move-out should not re-include removed rows`, async () => {
          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Create first collection
          const collection1 = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection1, syncMode)

          // Insert user with isActive = true
          const userId = randomUUID()
          await config.mutations.insertUser({
            id: userId,
            name: `Snapshot Test User`,
            email: `snapshot@test.com`,
            age: 25,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert post for this user
          const postId = randomUUID()
          await config.mutations.insertPost({
            id: postId,
            userId,
            title: `Snapshot Test Post`,
            content: `Content`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await waitForItem(collection1, postId)
          expect(collection1.has(postId)).toBe(true)

          // Update user → post moves out
          await config.mutations.updateUser(userId, { isActive: false })

          await waitForItemRemoved(collection1, postId)
          expect(collection1.has(postId)).toBe(false)

          // Clean up first collection
          await collection1.cleanup()

          // Create fresh collection (new subscription)
          const collection2 = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection2, syncMode)

          // Wait a bit to ensure snapshot is complete
          await new Promise((resolve) => setTimeout(resolve, 1000))

          // Snapshot should NOT include the removed post (user is inactive)
          expect(collection2.has(postId)).toBe(false)

          // Clean up
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId,
          ])
          await config.mutations.deleteUser(userId)
          await collection2.cleanup()
        })

        it(`Multi-row transaction: some rows move in, some move out`, async () => {
          const collection = createPostsByActiveUsersCollection(syncMode)
          await waitForReady(collection, syncMode)

          if (!config.mutations) {
            throw new Error(`Mutations not configured`)
          }

          // Insert 3 users all with isActive = true
          const userId1 = randomUUID()
          const userId2 = randomUUID()
          const userId3 = randomUUID()

          await config.mutations.insertUser({
            id: userId1,
            name: `User 1`,
            email: `user1@test.com`,
            age: 25,
            isActive: false,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          await config.mutations.insertUser({
            id: userId2,
            name: `User 2`,
            email: `user2@test.com`,
            age: 30,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          await config.mutations.insertUser({
            id: userId3,
            name: `User 3`,
            email: `user3@test.com`,
            age: 35,
            isActive: true,
            createdAt: new Date(),
            metadata: null,
            deletedAt: null,
          })

          // Insert posts for these users
          const postId1 = randomUUID()
          const postId2 = randomUUID()
          const postId3 = randomUUID()

          await config.mutations.insertPost({
            id: postId1,
            userId: userId1,
            title: `Post 1`,
            content: `Content 1`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await config.mutations.insertPost({
            id: postId2,
            userId: userId2,
            title: `Post 2`,
            content: `Content 2`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          await config.mutations.insertPost({
            id: postId3,
            userId: userId3,
            title: `Post 3`,
            content: `Content 3`,
            viewCount: 0,
            largeViewCount: BigInt(0),
            publishedAt: null,
            deletedAt: null,
          })

          // Wait for posts 2 and 3 to appear
          await waitForItem(collection, postId2)
          await waitForItem(collection, postId3)

          expect(collection.has(postId1)).toBe(false)

          // In one SQL transaction:
          // user1: isActive → true (post1 moves in)
          // post2: title change (stays in since user2 is still active)
          // user3: isActive → false (post3 moves out)
          await dbClient.query(`BEGIN`)
          try {
            await dbClient.query(
              `UPDATE ${usersTable} SET "isActive" = $1 WHERE id = $2`,
              [true, userId1],
            )
            await dbClient.query(
              `UPDATE ${postsTable} SET title = $1 WHERE id = $2`,
              [`Updated Post 2`, postId2],
            )
            await dbClient.query(
              `UPDATE ${usersTable} SET "isActive" = $1 WHERE id = $2`,
              [false, userId3],
            )
            await dbClient.query(`COMMIT`)
          } catch (error) {
            await dbClient.query(`ROLLBACK`)
            throw error
          }

          // Wait for changes to propagate
          await waitForItemRemoved(collection, postId3)
          await new Promise((resolve) => setTimeout(resolve, 1000))
          expect(collection.has(postId1)).toBe(true) // post1: moved in (user1 active)
          expect(collection.has(postId2)).toBe(true) // post2: still in (user2 active)
          expect(collection.get(postId2)?.title).toBe(`Updated Post 2`)
          expect(collection.has(postId3)).toBe(false) // post3: moved out (user3 inactive)

          // Clean up
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId1,
          ])
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId2,
          ])
          await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
            postId3,
          ])
          await config.mutations.deleteUser(userId1)
          await config.mutations.deleteUser(userId2)
          await config.mutations.deleteUser(userId3)
          await collection.cleanup()
        })
      })
    }

    // Run tests for each sync mode
    runTestsForSyncMode('eager')
    runTestsForSyncMode('on-demand')
    runTestsForSyncMode('progressive')
  })
}
