/**
 * TrailBase Collection E2E Tests
 *
 * End-to-end tests using actual TrailBase server with sync
 */

import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
  isNull,
} from '@tanstack/db'
import { Client } from 'trailbase'
import { trailBaseCollectionOptions } from '../src/trailbase'
import type { Collection } from '@tanstack/db'

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
  }
}

/**
 * Test data schema types
 */
interface User {
  id: string
  name: string
  email: string | null
  age: number
  is_active: boolean
  created_at: string
  deleted_at: string | null
}

interface Post {
  id: string
  user_id: string
  title: string
  content: string | null
  view_count: number
  published_at: string | null
  deleted_at: string | null
}

// Helper to wait for a condition with timeout
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number
    interval?: number
    message?: string
  } = {},
): Promise<void> {
  const {
    timeout = 5000,
    interval = 50,
    message = `Condition not met`,
  } = options

  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(`${message} (timeout after ${timeout}ms)`)
}

// Helper to wait for collection to have data
async function waitForCollectionData<T extends object>(
  collection: Collection<T>,
  options: {
    minSize?: number
    timeout?: number
  } = {},
): Promise<void> {
  const { minSize = 1, timeout = 5000 } = options

  await waitFor(() => collection.size >= minSize, {
    timeout,
    interval: 50,
    message: `Collection did not load data (expected >= ${minSize}, got ${collection.size})`,
  })
}

// Helper to wait for query to have data
async function waitForQueryData<T extends object>(
  query: Collection<T>,
  options: {
    minSize?: number
    timeout?: number
  } = {},
): Promise<void> {
  const { minSize = 1, timeout = 5000 } = options

  await waitFor(() => query.size >= minSize, {
    timeout,
    interval: 50,
    message: `Query did not load data (expected >= ${minSize}, got ${query.size})`,
  })
}

// Generate deterministic UUIDs for testing
function generateId(prefix: string, index: number): string {
  const hex = index.toString(16).padStart(8, `0`)
  return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, `0`)}`
}

describe(`TrailBase Collection E2E Tests`, () => {
  let baseUrl: string
  let client: Client
  let usersCollection: Collection<User>
  let postsCollection: Collection<Post>
  let testId: string
  const createdUserIds: Array<string> = []
  const createdPostIds: Array<string> = []

  // Seed data
  const seedUsers: Array<User> = []
  const seedPosts: Array<Post> = []

  beforeAll(async () => {
    baseUrl = inject(`baseUrl`)
    testId = Date.now().toString(16)

    // Initialize TrailBase client
    client = new Client(baseUrl)

    // Generate seed data
    const now = new Date().toISOString()
    for (let i = 0; i < 20; i++) {
      const userId = generateId(`user`, i)
      seedUsers.push({
        id: userId,
        name: `Test User ${i}`,
        email: i % 3 === 0 ? null : `user${i}@example.com`,
        age: 20 + (i % 50),
        is_active: i % 4 !== 0,
        created_at: now,
        deleted_at: i % 10 === 0 ? now : null,
      })
    }

    for (let i = 0; i < 20; i++) {
      const postId = generateId(`post`, i)
      const userId = seedUsers[i % seedUsers.length]!.id
      seedPosts.push({
        id: postId,
        user_id: userId,
        title: `Test Post ${i}`,
        content: i % 2 === 0 ? `Content for post ${i}` : null,
        view_count: i * 10,
        published_at: i % 3 === 0 ? null : now,
        deleted_at: i % 8 === 0 ? now : null,
      })
    }

    // Insert seed data via TrailBase API
    const usersApi = client.records<User>(`users_e2e`)
    const postsApi = client.records<Post>(`posts_e2e`)

    for (const user of seedUsers) {
      try {
        await usersApi.create(user)
        createdUserIds.push(user.id)
      } catch {
        // Record may already exist
      }
    }

    for (const post of seedPosts) {
      try {
        await postsApi.create(post)
        createdPostIds.push(post.id)
      } catch {
        // Record may already exist
      }
    }

    // Create collections with sync enabled
    const usersRecordApi = client.records<User>(`users_e2e`)
    const postsRecordApi = client.records<Post>(`posts_e2e`)

    const usersOptions = trailBaseCollectionOptions({
      id: `trailbase-e2e-users-${testId}`,
      recordApi: usersRecordApi,
      getKey: (item: User) => item.id,
      startSync: true,
      parse: {
        // Parse dates if needed
      },
      serialize: {
        // Serialize dates if needed
      },
    })

    const postsOptions = trailBaseCollectionOptions({
      id: `trailbase-e2e-posts-${testId}`,
      recordApi: postsRecordApi,
      getKey: (item: Post) => item.id,
      startSync: true,
      parse: {},
      serialize: {},
    })

    usersCollection = createCollection(usersOptions)
    postsCollection = createCollection(postsOptions)

    // Wait for initial sync to complete
    await usersCollection.preload()
    await postsCollection.preload()

    // Wait for data to be synced
    await waitForCollectionData(usersCollection, {
      minSize: seedUsers.length,
      timeout: 30000,
    })
    await waitForCollectionData(postsCollection, {
      minSize: seedPosts.length,
      timeout: 30000,
    })
  }, 60000)

  afterEach(async () => {
    // Clean up any test-created records
  })

  afterAll(async () => {
    // Clean up collections
    await usersCollection.cleanup()
    await postsCollection.cleanup()

    // Clean up seed data
    const usersApi = client.records<User>(`users_e2e`)
    const postsApi = client.records<Post>(`posts_e2e`)

    for (const postId of createdPostIds) {
      try {
        await postsApi.delete(postId)
      } catch {
        // Ignore errors
      }
    }

    for (const userId of createdUserIds) {
      try {
        await usersApi.delete(userId)
      } catch {
        // Ignore errors
      }
    }
  })

  describe(`Initial Sync`, () => {
    it(`should sync all users on initial load`, async () => {
      expect(usersCollection.size).toBeGreaterThanOrEqual(seedUsers.length)
    })

    it(`should sync all posts on initial load`, async () => {
      expect(postsCollection.size).toBeGreaterThanOrEqual(seedPosts.length)
    })

    it(`should have collection status as ready after preload`, async () => {
      expect(usersCollection.status).toBe(`ready`)
      expect(postsCollection.status).toBe(`ready`)
    })

    it(`should contain correct user data`, async () => {
      const firstUser = seedUsers[0]!
      const syncedUser = usersCollection.get(firstUser.id)

      expect(syncedUser).toBeDefined()
      expect(syncedUser?.name).toBe(firstUser.name)
      expect(syncedUser?.age).toBe(firstUser.age)
    })
  })

  describe(`Live Queries`, () => {
    it(`should filter users with eq() on string field`, async () => {
      const targetName = `Test User 0`

      const query = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).where(({ user }) => eq(user.name, targetName)),
      )

      await query.preload()
      await waitForQueryData(query, { minSize: 1 })

      const results = Array.from(query.state.values())
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((u) => u.name === targetName)).toBe(true)

      await query.cleanup()
    })

    it(`should filter users with eq() on number field`, async () => {
      const query = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).where(({ user }) => eq(user.age, 25)),
      )

      await query.preload()

      const results = Array.from(query.state.values())
      expect(results.every((u) => u.age === 25)).toBe(true)

      await query.cleanup()
    })

    it(`should filter users with gt() on number field`, async () => {
      const query = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).where(({ user }) => gt(user.age, 40)),
      )

      await query.preload()

      const results = Array.from(query.state.values())
      expect(results.every((u) => u.age > 40)).toBe(true)

      await query.cleanup()
    })

    it(`should filter users with isNull() on nullable field`, async () => {
      const query = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).where(({ user }) => isNull(user.email)),
      )

      await query.preload()
      await waitForQueryData(query, { minSize: 1 })

      const results = Array.from(query.state.values())
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((u) => u.email === null)).toBe(true)

      await query.cleanup()
    })

    it(`should filter posts with eq() on FK field`, async () => {
      const targetUserId = seedUsers[0]!.id

      const query = createLiveQueryCollection((q) =>
        q.from({ post: postsCollection }).where(({ post }) => eq(post.user_id, targetUserId)),
      )

      await query.preload()
      await waitForQueryData(query, { minSize: 1 })

      const results = Array.from(query.state.values())
      expect(results.every((p) => p.user_id === targetUserId)).toBe(true)

      await query.cleanup()
    })
  })

  describe(`Live Updates`, () => {
    it(`should receive insert updates in collection`, async () => {
      const initialSize = usersCollection.size

      // Insert a new user via the API
      const usersApi = client.records<User>(`users_e2e`)
      const newUserId = randomUUID()
      const newUser: User = {
        id: newUserId,
        name: `Live Insert User`,
        email: `liveinsert@example.com`,
        age: 35,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      }

      await usersApi.create(newUser)
      createdUserIds.push(newUserId)

      // Wait for the insert to sync
      await waitFor(() => usersCollection.size > initialSize, {
        timeout: 10000,
        message: `Insert did not sync to collection`,
      })

      expect(usersCollection.size).toBe(initialSize + 1)
      expect(usersCollection.has(newUserId)).toBe(true)

      const syncedUser = usersCollection.get(newUserId)
      expect(syncedUser?.name).toBe(newUser.name)
    })

    it(`should receive update events in collection`, async () => {
      // Get a user to update
      const userToUpdate = seedUsers[1]!
      const originalAge = userToUpdate.age
      const newAge = originalAge + 100

      // Update via the API
      const usersApi = client.records<User>(`users_e2e`)
      await usersApi.update(userToUpdate.id, { age: newAge })

      // Wait for the update to sync
      await waitFor(
        () => {
          const user = usersCollection.get(userToUpdate.id)
          return user?.age === newAge
        },
        {
          timeout: 10000,
          message: `Update did not sync to collection`,
        },
      )

      const syncedUser = usersCollection.get(userToUpdate.id)
      expect(syncedUser?.age).toBe(newAge)
    })

    it(`should receive delete events in collection`, async () => {
      // Create a user to delete
      const usersApi = client.records<User>(`users_e2e`)
      const userToDeleteId = randomUUID()
      const userToDelete: User = {
        id: userToDeleteId,
        name: `User To Delete`,
        email: `delete@example.com`,
        age: 99,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      }

      await usersApi.create(userToDelete)

      // Wait for insert to sync
      await waitFor(() => usersCollection.has(userToDeleteId), {
        timeout: 10000,
        message: `Insert did not sync before delete test`,
      })

      const sizeBeforeDelete = usersCollection.size

      // Delete the user
      await usersApi.delete(userToDeleteId)

      // Wait for delete to sync
      await waitFor(() => !usersCollection.has(userToDeleteId), {
        timeout: 10000,
        message: `Delete did not sync to collection`,
      })

      expect(usersCollection.size).toBe(sizeBeforeDelete - 1)
      expect(usersCollection.has(userToDeleteId)).toBe(false)
    })

    it(`should update live query results when data changes`, async () => {
      const query = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).where(({ user }) => gt(user.age, 50)),
      )

      await query.preload()
      const initialQuerySize = query.size

      // Insert a user with age > 50
      const usersApi = client.records<User>(`users_e2e`)
      const newUserId = randomUUID()
      const newUser: User = {
        id: newUserId,
        name: `Query Update User`,
        email: `queryupdate@example.com`,
        age: 60,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      }

      await usersApi.create(newUser)
      createdUserIds.push(newUserId)

      // Wait for query to update
      await waitFor(() => query.size > initialQuerySize, {
        timeout: 10000,
        message: `Query did not receive live update`,
      })

      expect(query.size).toBe(initialQuerySize + 1)
      expect(query.has(newUserId)).toBe(true)

      await query.cleanup()
    })
  })

  describe(`Collection Mutations`, () => {
    it(`should insert via collection and sync`, async () => {
      const initialSize = usersCollection.size
      const newUserId = randomUUID()

      const newUser: User = {
        id: newUserId,
        name: `Collection Insert User`,
        email: `collectioninsert@example.com`,
        age: 28,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      }

      // Insert via collection
      usersCollection.insert(newUser)
      createdUserIds.push(newUserId)

      // The record should appear immediately (optimistic)
      expect(usersCollection.has(newUserId)).toBe(true)

      // Wait for the insert to be confirmed
      await waitFor(() => usersCollection.size > initialSize, {
        timeout: 10000,
        message: `Collection insert did not complete`,
      })
    })

    it(`should update via collection and sync`, async () => {
      // Get a user to update
      const users = Array.from(usersCollection.state.values())
      const userToUpdate = users.find((u) => u.age < 90)!

      const newAge = userToUpdate.age + 1

      // Update via collection
      usersCollection.update(userToUpdate.id, (user) => {
        user.age = newAge
      })

      // The update should appear immediately (optimistic)
      expect(usersCollection.get(userToUpdate.id)?.age).toBe(newAge)

      // Wait for sync confirmation
      await waitFor(
        () => {
          const user = usersCollection.get(userToUpdate.id)
          return user?.age === newAge
        },
        {
          timeout: 10000,
          message: `Collection update did not sync`,
        },
      )
    })

    it(`should delete via collection and sync`, async () => {
      // Create a user to delete
      const userToDeleteId = randomUUID()
      const userToDelete: User = {
        id: userToDeleteId,
        name: `Collection Delete User`,
        email: `collectiondelete@example.com`,
        age: 50,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      }

      // Insert first
      usersCollection.insert(userToDelete)

      // Wait for insert to complete
      await waitFor(() => usersCollection.has(userToDeleteId), {
        timeout: 10000,
      })

      const sizeBeforeDelete = usersCollection.size

      // Delete via collection
      usersCollection.delete(userToDeleteId)

      // The delete should appear immediately (optimistic)
      expect(usersCollection.has(userToDeleteId)).toBe(false)

      // Wait for sync confirmation
      await waitFor(() => usersCollection.size < sizeBeforeDelete, {
        timeout: 10000,
        message: `Collection delete did not sync`,
      })
    })
  })

  describe(`Subscription Lifecycle`, () => {
    it(`should receive change notifications via subscription`, async () => {
      const query = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }),
      )

      await query.preload()
      await waitForQueryData(query, { minSize: 1 })

      let changeCount = 0
      const subscription = query.subscribeChanges(() => {
        changeCount++
      })

      // Insert a new user to trigger change
      const usersApi = client.records<User>(`users_e2e`)
      const newUserId = randomUUID()
      await usersApi.create({
        id: newUserId,
        name: `Subscription Test User`,
        email: `subscription@example.com`,
        age: 42,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      })
      createdUserIds.push(newUserId)

      // Wait for change notification
      await waitFor(() => changeCount > 0, {
        timeout: 10000,
        message: `No change notifications received`,
      })

      expect(changeCount).toBeGreaterThan(0)

      subscription.unsubscribe()
      await query.cleanup()
    })

    it(`should stop receiving updates after cleanup`, async () => {
      // Create a separate collection to test cleanup
      const usersApi = client.records<User>(`users_e2e`)

      const tempOptions = trailBaseCollectionOptions({
        id: `trailbase-e2e-temp-${testId}`,
        recordApi: usersApi,
        getKey: (item: User) => item.id,
        startSync: true,
        parse: {},
        serialize: {},
      })

      const tempCollection = createCollection(tempOptions)
      await tempCollection.preload()

      const sizeAtCleanup = tempCollection.size

      // Cleanup the collection
      await tempCollection.cleanup()

      // Insert a new user
      const newUserId = randomUUID()
      await usersApi.create({
        id: newUserId,
        name: `After Cleanup User`,
        email: `aftercleanup@example.com`,
        age: 33,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      })
      createdUserIds.push(newUserId)

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // The temp collection should not have received the update
      expect(tempCollection.size).toBe(sizeAtCleanup)
    })
  })

  describe(`Error Handling`, () => {
    it(`should handle concurrent mutations gracefully`, async () => {
      const promises: Array<Promise<void>> = []

      // Perform multiple concurrent inserts
      for (let i = 0; i < 5; i++) {
        const newUserId = randomUUID()
        const newUser: User = {
          id: newUserId,
          name: `Concurrent User ${i}`,
          email: `concurrent${i}@example.com`,
          age: 30 + i,
          is_active: true,
          created_at: new Date().toISOString(),
          deleted_at: null,
        }

        promises.push(
          (async () => {
            usersCollection.insert(newUser)
            createdUserIds.push(newUserId)
          })(),
        )
      }

      await Promise.all(promises)

      // All inserts should complete without error
      // The collection should have grown
      await waitFor(() => createdUserIds.every((id) => usersCollection.has(id)), {
        timeout: 15000,
        message: `Not all concurrent inserts completed`,
      })
    })
  })

  describe(`Data Integrity`, () => {
    it(`should maintain data consistency after multiple operations`, async () => {
      const usersApi = client.records<User>(`users_e2e`)
      const testUserId = randomUUID()

      // Insert
      await usersApi.create({
        id: testUserId,
        name: `Integrity Test User`,
        email: `integrity@example.com`,
        age: 25,
        is_active: true,
        created_at: new Date().toISOString(),
        deleted_at: null,
      })
      createdUserIds.push(testUserId)

      await waitFor(() => usersCollection.has(testUserId), { timeout: 10000 })

      // Update multiple times
      await usersApi.update(testUserId, { age: 26 })
      await waitFor(() => usersCollection.get(testUserId)?.age === 26, {
        timeout: 10000,
      })

      await usersApi.update(testUserId, { age: 27 })
      await waitFor(() => usersCollection.get(testUserId)?.age === 27, {
        timeout: 10000,
      })

      await usersApi.update(testUserId, { name: `Updated Integrity User` })
      await waitFor(
        () => usersCollection.get(testUserId)?.name === `Updated Integrity User`,
        { timeout: 10000 },
      )

      // Verify final state
      const finalUser = usersCollection.get(testUserId)
      expect(finalUser?.age).toBe(27)
      expect(finalUser?.name).toBe(`Updated Integrity User`)
      expect(finalUser?.email).toBe(`integrity@example.com`)
    })
  })
})
