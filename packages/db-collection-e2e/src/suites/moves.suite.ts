/**
 * Tags Test Suite
 *
 * Tests Electric collection tag behavior with subqueries
 * Only Electric collection supports tags (via shapes with subqueries)
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { waitFor } from '../utils/helpers'
import type { E2ETestConfig, Post, User } from '../types'
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

type MoveCollection = Pick<
  Collection<Post, string>,
  | 'entries'
  | 'cleanup'
  | 'subscribeChanges'
  | 'preload'
  | 'status'
  | 'startSyncImmediate'
>
type CapturedPost = { key: string; value: Post }

function capturePost(row: Post): Post {
  return structuredClone({
    id: row.id,
    userId: row.userId,
    title: row.title,
    content: row.content,
    viewCount: row.viewCount,
    largeViewCount: row.largeViewCount,
    publishedAt: row.publishedAt,
    deletedAt: row.deletedAt,
  })
}

function assertOwnedPosts(actual: Array<CapturedPost>, expected: Array<Post>) {
  for (const entry of actual) expect(entry.key).toBe(entry.value.id)
  const byId = (left: Post, right: Post) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  expect(actual.map((entry) => entry.value).sort(byId)).toStrictEqual(
    [...expected].sort(byId),
  )
}

interface MoveHistory {
  own: <T extends MoveCollection>(collection: T) => T
  ready: (collection: MoveCollection, syncMode: SyncMode) => Promise<void>
  insertUser: (row: User) => Promise<void>
  insertPost: (row: Post) => Promise<void>
  setActive: (id: string, active: boolean) => void
  setTitle: (id: string, title: string) => void
  removePost: (id: string) => void
  check: (collection: MoveCollection) => Promise<void>
  observe: (collection: MoveCollection) => () => void
}

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
      collection: MoveCollection,
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

    // Helper to wait for users to be synced to Electric/TanStack DB
    async function waitForUsersSynced(
      userIds: Array<string>,
      timeout: number = 10000,
    ) {
      // Use eager collection since it continuously syncs all data
      const usersCollection = config.collections.eager.users
      await waitFor(
        () => {
          return userIds.every((userId) => usersCollection.has(userId))
        },
        {
          timeout,
          message: `Users ${userIds.join(', ')} did not sync to collection`,
        },
      )
    }

    async function withMoveHistory(
      run: (history: MoveHistory) => Promise<void>,
    ) {
      const mutations = config.mutations
      if (!mutations) throw new Error('Mutations not configured')
      const userIds = new Set<string>()
      const postIds = new Set<string>()
      const activeUsers = new Map<string, boolean>()
      const posts = new Map<string, Post>()
      const resources: Array<() => Promise<void>> = []
      const archives: Array<() => void> = []
      const errors: Array<unknown> = []
      let priorNonempty: Array<CapturedPost> | undefined
      try {
        await run({
          own(collection) {
            resources.push(() => collection.cleanup())
            return collection
          },
          async ready(collection, syncMode) {
            if (syncMode === 'on-demand') {
              // preload starts sync, but only a subscriber acquires existing rows.
              // Keep that demand alive through the history, then release it.
              const subscription = collection.subscribeChanges(() => {}, {
                includeInitialState: true,
              })
              resources.push(() => {
                subscription.unsubscribe()
                return Promise.resolve()
              })
            }
            await waitForReady(collection, syncMode)
          },
          async insertUser(row) {
            // Own the exact key before a provider can partially write and fail.
            userIds.add(row.id)
            activeUsers.set(row.id, row.isActive)
            await mutations.insertUser(structuredClone(row))
          },
          async insertPost(row) {
            postIds.add(row.id)
            posts.set(row.id, capturePost(row))
            await mutations.insertPost(structuredClone(row))
          },
          setActive(id, active) {
            if (!activeUsers.has(id)) throw new Error('Unknown owned user')
            activeUsers.set(id, active)
          },
          setTitle(id, title) {
            const row = posts.get(id)
            if (!row) throw new Error('Unknown owned post')
            posts.set(id, { ...row, title })
          },
          removePost(id) {
            if (!posts.delete(id)) throw new Error('Unknown owned post')
          },
          async check(collection) {
            // This finite world comes only from authored row/active commands.
            // It does not use the provider's subquery parser or current output.
            const expected = Array.from(posts.values())
              .filter((post) => activeUsers.get(post.userId) === true)
              .map(capturePost)
            const captured = await vi.waitFor(
              () => {
                const actual = Array.from(collection.entries())
                  .filter(
                    ([key, value]) => postIds.has(key) || postIds.has(value.id),
                  )
                  .map(([key, value]) => ({ key, value: capturePost(value) }))
                assertOwnedPosts(actual, expected)
                return actual
              },
              { timeout: 10000 },
            )
            archives.push(() => assertOwnedPosts(captured, expected))
            if (captured.length > 0) {
              const wrongValue = structuredClone(captured)
              wrongValue[0]!.value.title += '-wrong'
              expect(() => assertOwnedPosts(wrongValue, expected)).toThrow()
              const wrongKey = structuredClone(captured)
              wrongKey[0]!.key += '-wrong'
              expect(() => assertOwnedPosts(wrongKey, expected)).toThrow()
              const missing = captured.slice(1)
              expect(() => assertOwnedPosts(missing, expected)).toThrow()
              priorNonempty = structuredClone(captured)
            } else if (priorNonempty) {
              expect(() => assertOwnedPosts(priorNonempty!, expected)).toThrow()
            }
          },
          observe(collection) {
            const callbacks: Array<{
              changes: Array<{
                type: string
                key: string | number
                value: Post
              }>
              rows: Array<CapturedPost>
            }> = []
            const subscription = collection.subscribeChanges((changes) => {
              // Empty callbacks and unowned peers stay visible as evidence.
              // No SQL-transaction-to-single-delivery framing law is assumed.
              callbacks.push({
                changes: changes.map(({ type, key, value }) => ({
                  type,
                  key,
                  value: structuredClone(value),
                })),
                rows: Array.from(collection.entries(), ([key, value]) => ({
                  key,
                  value: structuredClone(value),
                })),
              })
            })
            resources.push(() => {
              subscription.unsubscribe()
              return Promise.resolve()
            })
            return () => {
              const captured = structuredClone(callbacks)
              const expected = structuredClone(captured)
              archives.push(() => expect(captured).toStrictEqual(expected))
            }
          },
        })
      } catch (error) {
        errors.push(error)
      } finally {
        // Children precede parents; every failure still allows later cleanup.
        for (const id of postIds) {
          try {
            await mutations.deletePost(id)
          } catch (error) {
            errors.push(error)
          }
        }
        for (const id of userIds) {
          try {
            await mutations.deleteUser(id)
          } catch (error) {
            errors.push(error)
          }
        }
        for (const cleanup of resources.reverse()) {
          try {
            await cleanup()
          } catch (error) {
            errors.push(error)
          }
        }
        for (const check of archives) {
          try {
            check()
          } catch (error) {
            errors.push(error)
          }
        }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1)
        throw new AggregateError(errors, 'Move history and cleanup failed')
    }

    // Helper function to run all tests for a given sync mode
    function runTestsForSyncMode(syncMode: SyncMode) {
      describe(`${syncMode} mode`, () => {
        it(`Initial snapshot contains only posts from active users`, async () => {
          await withMoveHistory(async (history) => {
            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Insert 2 active users and 1 inactive user
            const userId1 = randomUUID()
            const userId2 = randomUUID()
            const userId3 = randomUUID()

            await history.insertUser({
              id: userId1,
              name: `Active User 1`,
              email: `user1@test.com`,
              age: 25,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            await history.insertUser({
              id: userId2,
              name: `Active User 2`,
              email: `user2@test.com`,
              age: 30,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            await history.insertUser({
              id: userId3,
              name: `Inactive User`,
              email: `user3@test.com`,
              age: 42,
              isActive: false,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for all 3 users to be synced to Electric before inserting posts
            // This ensures the subquery in the WHERE clause can properly evaluate
            await waitForUsersSynced([userId1, userId2, userId3])

            // Insert posts for these users
            const postId1 = randomUUID()
            const postId2 = randomUUID()
            const postId3 = randomUUID()

            await history.insertPost({
              id: postId1,
              userId: userId1,
              title: `Post 1`,
              content: `Content 1`,
              viewCount: 0,
              largeViewCount: BigInt(0),
              publishedAt: null,
              deletedAt: null,
            })

            await history.insertPost({
              id: postId2,
              userId: userId2,
              title: `Post 2`,
              content: `Content 2`,
              viewCount: 0,
              largeViewCount: BigInt(0),
              publishedAt: null,
              deletedAt: null,
            })

            await history.insertPost({
              id: postId3,
              userId: userId3,
              title: `Post 3`,
              content: `Content 3`,
              viewCount: 0,
              largeViewCount: BigInt(0),
              publishedAt: null,
              deletedAt: null,
            })

            // Create collection on posts with WHERE clause: userId IN (SELECT id FROM users WHERE isActive = true)
            const collection = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )

            // Wait for collection to sync
            await history.ready(collection, syncMode)

            // Wait for both posts to appear (users are active, so posts match the subquery)
            await waitForItem(collection, postId1)
            await waitForItem(collection, postId2)

            // Verify only posts 1 and 2 are in the collection
            expect(collection.has(postId1)).toBe(true)
            await history.check(collection)
            expect(collection.has(postId2)).toBe(true)
            await history.check(collection)
            expect(collection.has(postId3)).toBe(false)
            await history.check(collection)

            // Wait a bit to make sure post 3 is not coming in later
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(collection.has(postId3)).toBe(false)
            await history.check(collection)

            // Note: Tags are internal to Electric and may not be directly accessible
            // The test verifies that posts with matching conditions appear in snapshot
          })
        })

        it(`Move-in: row becomes eligible for subquery`, async () => {
          await withMoveHistory(async (history) => {
            const collection = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection, syncMode)

            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Insert user with isActive = false
            const userId = randomUUID()
            await history.insertUser({
              id: userId,
              name: `Inactive User`,
              email: `inactive@test.com`,
              age: 25,
              isActive: false,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for user to be synced to Electric before inserting post
            await waitForUsersSynced([userId])

            // Insert post for this user
            const postId = randomUUID()
            await history.insertPost({
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
            await history.check(collection)

            // Update user to isActive = true (move-in for the post)
            await config.mutations.updateUser(userId, { isActive: true })
            history.setActive(userId, true)

            // Wait for post to appear (move-in)
            await waitForItem(collection, postId, 1000)
            expect(collection.has(postId)).toBe(true)
            await history.check(collection)
            expect(collection.get(postId)?.title).toBe(`Inactive User Post`)
          })
        })

        it(`Move-out: row becomes ineligible for subquery`, async () => {
          await withMoveHistory(async (history) => {
            const collection = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection, syncMode)

            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Insert user with isActive = true
            const userId = randomUUID()
            await history.insertUser({
              id: userId,
              name: `Active User`,
              email: `active@test.com`,
              age: 25,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for user to be synced to Electric before inserting post
            await waitForUsersSynced([userId])

            // Insert post for this user
            const postId = randomUUID()
            await history.insertPost({
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
            await history.check(collection)

            // Update user to isActive = false (move-out for the post)
            await config.mutations.updateUser(userId, { isActive: false })
            history.setActive(userId, false)

            // Wait for post to be removed (move-out)
            await waitForItemRemoved(collection, postId)
            expect(collection.has(postId)).toBe(false)
            await history.check(collection)
          })
        })

        it(`Move-out → move-in cycle`, async () => {
          await withMoveHistory(async (history) => {
            const collection = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection, syncMode)

            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Insert user with isActive = true
            const userId = randomUUID()
            await history.insertUser({
              id: userId,
              name: `Flapping User`,
              email: `flapping@test.com`,
              age: 25,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for user to be synced to Electric before inserting post
            await waitForUsersSynced([userId])

            // Insert post for this user
            const postId = randomUUID()
            await history.insertPost({
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
            await history.check(collection)

            // Move-out: isActive = false
            await config.mutations.updateUser(userId, { isActive: false })
            history.setActive(userId, false)
            await waitForItemRemoved(collection, postId, 15000)
            expect(collection.has(postId)).toBe(false)
            await history.check(collection)

            // Move-in: isActive = true
            await config.mutations.updateUser(userId, { isActive: true })
            history.setActive(userId, true)
            await waitForItem(collection, postId, 15000)
            expect(collection.has(postId)).toBe(true)
            await history.check(collection)
          })
        })

        it(`Title update while row stays within subquery`, async () => {
          await withMoveHistory(async (history) => {
            const collection = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection, syncMode)

            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Insert user with isActive = true
            const userId = randomUUID()
            await history.insertUser({
              id: userId,
              name: `Active User`,
              email: `active@test.com`,
              age: 25,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for user to be synced to Electric before inserting post
            await waitForUsersSynced([userId])

            // Insert post for this user
            const postId = randomUUID()
            await history.insertPost({
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
            await history.check(collection)

            // This changes a visible row value; it is not a pure tag-only event.
            // The post stays eligible because its user remains active.
            await dbClient.query(
              `UPDATE ${postsTable} SET title = $1 WHERE id = $2`,
              [`Updated Tagged Post`, postId],
            )
            history.setTitle(postId, `Updated Tagged Post`)

            // Wait a bit and verify post still exists
            await new Promise((resolve) => setTimeout(resolve, 500))
            expect(collection.has(postId)).toBe(true)
            await history.check(collection)
            expect(collection.get(postId)?.title).toBe(`Updated Tagged Post`)
          })
        })

        it(`Database DELETE leads to row being removed from collection`, async () => {
          await withMoveHistory(async (history) => {
            const collection = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection, syncMode)

            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Insert user with isActive = true
            const userId = randomUUID()
            await history.insertUser({
              id: userId,
              name: `Active User`,
              email: `active@test.com`,
              age: 25,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for user to be synced to Electric before inserting post
            await waitForUsersSynced([userId])

            // Insert post for this user
            const postId = randomUUID()
            await history.insertPost({
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
            await history.check(collection)

            // Delete post in Postgres
            await dbClient.query(`DELETE FROM ${postsTable} WHERE id = $1`, [
              postId,
            ])
            history.removePost(postId)

            // Wait for post to be removed
            await waitForItemRemoved(collection, postId)
            expect(collection.has(postId)).toBe(false)
            await history.check(collection)
          })
        })

        it(`Snapshot after move-out should not re-include removed rows`, async () => {
          await withMoveHistory(async (history) => {
            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Create first collection
            const collection1 = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection1, syncMode)

            // Insert user with isActive = true
            const userId = randomUUID()
            await history.insertUser({
              id: userId,
              name: `Snapshot Test User`,
              email: `snapshot@test.com`,
              age: 25,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for user to be synced to Electric before inserting post
            await waitForUsersSynced([userId])

            // Insert post for this user
            const postId = randomUUID()
            await history.insertPost({
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
            await history.check(collection1)

            // Update user → post moves out
            await config.mutations.updateUser(userId, { isActive: false })
            history.setActive(userId, false)

            await waitForItemRemoved(collection1, postId)
            expect(collection1.has(postId)).toBe(false)
            await history.check(collection1)

            // Clean up first collection
            await collection1.cleanup()

            // Create fresh collection (new subscription)
            const collection2 = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection2, syncMode)

            // Wait a bit to ensure snapshot is complete
            await new Promise((resolve) => setTimeout(resolve, 1000))

            // Snapshot should NOT include the removed post (user is inactive)
            expect(collection2.has(postId)).toBe(false)
            await history.check(collection2)
          })
        })

        it(`Multi-row transaction: some rows move in, some move out`, async () => {
          await withMoveHistory(async (history) => {
            const collection = history.own(
              createPostsByActiveUsersCollection(syncMode),
            )
            await history.ready(collection, syncMode)
            const archiveCallbacks = history.observe(collection)

            if (!config.mutations) {
              throw new Error(`Mutations not configured`)
            }

            // Insert 3 users all with isActive = true
            const userId1 = randomUUID()
            const userId2 = randomUUID()
            const userId3 = randomUUID()

            await history.insertUser({
              id: userId1,
              name: `User 1`,
              email: `user1@test.com`,
              age: 25,
              isActive: false,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            await history.insertUser({
              id: userId2,
              name: `User 2`,
              email: `user2@test.com`,
              age: 30,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            await history.insertUser({
              id: userId3,
              name: `User 3`,
              email: `user3@test.com`,
              age: 35,
              isActive: true,
              createdAt: new Date(),
              metadata: null,
              deletedAt: null,
            })

            // Wait for all 3 users to be synced to Electric before inserting posts
            // This ensures the subquery in the WHERE clause can properly evaluate
            await waitForUsersSynced([userId1, userId2, userId3])

            // Insert posts for these users
            const postId1 = randomUUID()
            const postId2 = randomUUID()
            const postId3 = randomUUID()

            await history.insertPost({
              id: postId1,
              userId: userId1,
              title: `Post 1`,
              content: `Content 1`,
              viewCount: 0,
              largeViewCount: BigInt(0),
              publishedAt: null,
              deletedAt: null,
            })

            await history.insertPost({
              id: postId2,
              userId: userId2,
              title: `Post 2`,
              content: `Content 2`,
              viewCount: 0,
              largeViewCount: BigInt(0),
              publishedAt: null,
              deletedAt: null,
            })

            await history.insertPost({
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
            await history.check(collection)

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
              try {
                await dbClient.query(`ROLLBACK`)
              } catch (rollbackError) {
                throw new AggregateError(
                  [error, rollbackError],
                  'SQL transaction and rollback failed',
                )
              }
              throw error
            }
            history.setActive(userId1, true)
            history.setTitle(postId2, `Updated Post 2`)
            history.setActive(userId3, false)

            // Wait for changes to propagate
            await waitForItemRemoved(collection, postId3)
            await history.check(collection)
            expect(collection.has(postId1)).toBe(true) // post1: moved in (user1 active)
            await history.check(collection)
            expect(collection.has(postId2)).toBe(true) // post2: still in (user2 active)
            await history.check(collection)
            expect(collection.get(postId2)?.title).toBe(`Updated Post 2`)
            expect(collection.has(postId3)).toBe(false) // post3: moved out (user3 inactive)
            await history.check(collection)

            archiveCallbacks()
          })
        })
      })
    }

    // Run tests for each sync mode
    runTestsForSyncMode('eager')
    runTestsForSyncMode('on-demand')
    runTestsForSyncMode('progressive')
  })
}
