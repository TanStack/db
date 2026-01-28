/**
 * TrailBase Collection E2E Tests
 *
 * End-to-end tests using actual TrailBase server with sync.
 * Uses shared test suites from @tanstack/db-collection-e2e.
 */

import { describe, expect, inject } from 'vitest'
import { parse as uuidParse, stringify as uuidStringify } from 'uuid'
import { createCollection } from '@tanstack/db'
import { initClient } from 'trailbase'
import { trailBaseCollectionOptions } from '../src/trailbase'
import {
  createCollationTestSuite,
  createDeduplicationTestSuite,
  createJoinsTestSuite,
  createLiveUpdatesTestSuite,
  createMutationsTestSuite,
  createPaginationTestSuite,
  createPredicatesTestSuite,
  createProgressiveTestSuite,
  generateSeedData,
} from '../../db-collection-e2e/src/index'
import type { Client } from 'trailbase'
import type { SeedDataResult } from '../../db-collection-e2e/src/index'
import type { TrailBaseSyncMode } from '../src/trailbase'
import type {
  Comment,
  E2ETestConfig,
  Post,
  User,
} from '../../db-collection-e2e/src/types'
import type { Collection } from '@tanstack/db'

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
  }
}

// / Decode a "url-safe" base64 string to bytes.
function urlSafeBase64Decode(base64: string): Uint8Array {
  return Uint8Array.from(
    atob(base64.replace(/_/g, '/').replace(/-/g, '+')),
    (c) => c.charCodeAt(0),
  )
}

// / Encode an arbitrary string input as a "url-safe" base64 string.
function urlSafeBase64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
}

function parseTrailBaseId(id: string): string {
  return uuidStringify(urlSafeBase64Decode(id))
}

function toTrailBaseId(id: string): string {
  return urlSafeBase64Encode(uuidParse(id))
}

/**
 * TrailBase record types matching the camelCase schema
 * Column names match the app types, only types differ for storage
 */
interface UserRecord {
  id: string // base64 encoded UUID
  name: string
  email: string | null
  age: number
  isActive: number // SQLite INTEGER (0/1) for boolean
  createdAt: string // ISO date string
  metadata: string | null // JSON stored as string
  deletedAt: string | null // ISO date string
}

interface PostRecord {
  id: string
  userId: string
  title: string
  content: string | null
  viewCount: number
  largeViewCount: string // BigInt as string
  publishedAt: string | null
  deletedAt: string | null
}

interface CommentRecord {
  id: string
  postId: string
  userId: string
  text: string
  createdAt: string
  deletedAt: string | null
}

/**
 * Serialize functions - transform app types to DB storage types
 * ID is base64 encoded for TrailBase BLOB storage
 */
const serializeUser = (user: User): UserRecord => ({
  ...user,
  isActive: user.isActive ? 1 : 0,
  createdAt: user.createdAt.toISOString(),
  metadata: user.metadata ? JSON.stringify(user.metadata) : null,
  deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
})

const serializePost = (post: Post): PostRecord => ({
  ...post,
  largeViewCount: post.largeViewCount.toString(),
  publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
  deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
})

const serializeComment = (comment: Comment): CommentRecord => ({
  ...comment,
  createdAt: comment.createdAt.toISOString(),
  deletedAt: comment.deletedAt ? comment.deletedAt.toISOString() : null,
})

/**
 * Helper to create a set of collections for a given sync mode
 */
function createCollectionsForSyncMode(
  client: Client,
  testId: string,
  syncMode: TrailBaseSyncMode,
  suffix: string,
) {
  const usersRecordApi = client.records<UserRecord>(`users_e2e`)
  const postsRecordApi = client.records<PostRecord>(`posts_e2e`)
  const commentsRecordApi = client.records<CommentRecord>(`comments_e2e`)

  const usersCollection = createCollection(
    trailBaseCollectionOptions({
      id: `trailbase-e2e-users-${suffix}-${testId}`,
      recordApi: usersRecordApi,
      getKey: (item: User) => item.id,
      startSync: true,
      syncMode,
      parse: {
        id: parseTrailBaseId,
        isActive: (isActive) => Boolean(isActive),
        createdAt: (createdAt) => new Date(createdAt),
        metadata: (m) => (m ? JSON.parse(m) : null),
        deletedAt: (d) => (d ? new Date(d) : null),
      },
      serialize: {
        id: toTrailBaseId,
        isActive: (a) => (a ? 1 : 0),
        createdAt: (c) => c.toISOString(),
        metadata: (m) => (m ? JSON.stringify(m) : null),
        deletedAt: (d) => (d ? d.toISOString() : null),
      },
    }),
  )

  const postsCollection = createCollection(
    trailBaseCollectionOptions({
      id: `trailbase-e2e-posts-${suffix}-${testId}`,
      recordApi: postsRecordApi,
      getKey: (item: Post) => item.id,
      startSync: true,
      syncMode,
      parse: {
        id: parseTrailBaseId,
        largeViewCount: (l) => BigInt(l),
        publishedAt: (v) => (v ? new Date(v) : null),
        deletedAt: (d) => (d ? new Date(d) : null),
      },
      serialize: {
        id: toTrailBaseId,
        largeViewCount: (v) => v.toString(),
        publishedAt: (v) => (v ? v.toISOString() : null),
        deletedAt: (d) => (d ? d.toISOString() : null),
      },
    }),
  )

  const commentsCollection = createCollection(
    trailBaseCollectionOptions({
      id: `trailbase-e2e-comments-${suffix}-${testId}`,
      recordApi: commentsRecordApi,
      getKey: (item: Comment) => item.id,
      startSync: true,
      syncMode,
      parse: {
        id: parseTrailBaseId,
        createdAt: (v) => new Date(v),
        deletedAt: (d) => (d ? new Date(d) : null),
      },
      serialize: {
        id: toTrailBaseId,
        createdAt: (v) => v.toISOString(),
        deletedAt: (d) => (d ? d.toISOString() : null),
      },
    }),
  )

  return {
    users: usersCollection as Collection<User>,
    posts: postsCollection as Collection<Post>,
    comments: commentsCollection as Collection<Comment>,
  }
}

async function initialCleanup(client: Client) {
  console.log(`Cleaning up existing records...`)

  const commentsRecordApi = client.records<CommentRecord>(`comments_e2e`)
  const existingComments = await commentsRecordApi.list({})
  for (const comment of existingComments.records) {
    try {
      await commentsRecordApi.delete(comment.id)
    } catch {
      /* ignore */
    }
  }

  const postsRecordApi = client.records<PostRecord>(`posts_e2e`)
  const existingPosts = await postsRecordApi.list({})
  for (const post of existingPosts.records) {
    try {
      await postsRecordApi.delete(post.id)
    } catch {
      /* ignore */
    }
  }

  const usersRecordApi = client.records<UserRecord>(`users_e2e`)
  const existingUsers = await usersRecordApi.list({})
  for (const user of existingUsers.records) {
    try {
      await usersRecordApi.delete(user.id)
    } catch {
      /* ignore */
    }
  }

  console.log(`Cleanup complete`)
}

async function setupInitialData(client: Client, seedData: SeedDataResult) {
  const usersRecordApi = client.records<UserRecord>(`users_e2e`)
  const postsRecordApi = client.records<PostRecord>(`posts_e2e`)
  const commentsRecordApi = client.records<CommentRecord>(`comments_e2e`)

  // Insert seed data - we provide the ID so the original UUIDs are preserved
  console.log(`Inserting ${seedData.users.length} users...`)
  let userErrors = 0
  for (const user of seedData.users) {
    try {
      const serialized = serializeUser(user)
      if (userErrors === 0)
        console.log('First user data:', JSON.stringify(serialized))
      await usersRecordApi.create(serialized)
    } catch (e) {
      userErrors++
      if (userErrors <= 3) console.error('User insert error:', e)
    }
  }
  console.log(
    `Inserted users: ${seedData.users.length - userErrors} success, ${userErrors} errors`,
  )
  console.log(`First user ID: ${seedData.users.at(0)?.id}`)

  console.log(`Inserting ${seedData.posts.length} posts...`)
  let postErrors = 0
  for (const post of seedData.posts) {
    try {
      await postsRecordApi.create(serializePost(post))
    } catch (e) {
      postErrors++
      if (postErrors <= 3) console.error('Post insert error:', e)
    }
  }
  console.log(
    `Inserted posts: ${seedData.posts.length - postErrors} success, ${postErrors} errors`,
  )

  console.log(`Inserting ${seedData.comments.length} comments...`)
  let commentErrors = 0
  for (const comment of seedData.comments) {
    try {
      await commentsRecordApi.create(serializeComment(comment))
    } catch (e) {
      commentErrors++
      if (commentErrors <= 3) console.error('Comment insert error:', e)
    }
  }
  console.log(
    `Inserted comments: ${seedData.comments.length - commentErrors} success, ${commentErrors} errors`,
  )
}

describe(`TrailBase Collection E2E Tests`, async () => {
  const baseUrl = inject(`baseUrl`)
  const client = initClient(baseUrl)

  // Wipe all pre-existing data, e.g. when using a persistent TB instance.
  await initialCleanup(client)

  const seedData = generateSeedData()
  await setupInitialData(client, seedData)

  async function getConfig(): Promise<E2ETestConfig> {
    // Create collections with different sync modes
    const testId = Date.now().toString(16)

    const onDemandCollections = createCollectionsForSyncMode(
      client,
      testId,
      `on-demand`,
      `ondemand`,
    )

    // On-demand collections are marked ready immediately
    await Promise.all([
      onDemandCollections.users.preload(),
      onDemandCollections.posts.preload(),
      onDemandCollections.comments.preload(),
    ])

    const eagerCollections = createCollectionsForSyncMode(
      client,
      testId,
      `eager`,
      `eager`,
    )

    // Wait for eager collections to sync (they need to fetch all data before marking ready)
    // console.log('Calling preload on eager collections...')
    await Promise.all([
      eagerCollections.users.preload(),
      eagerCollections.posts.preload(),
      eagerCollections.comments.preload(),
    ])
    expect(eagerCollections.posts.size).toEqual(seedData.posts.length)
    expect(eagerCollections.comments.size).toEqual(seedData.comments.length)

    // NOTE: One of the tests deletes a user :/
    expect(eagerCollections.users.size).toBeGreaterThanOrEqual(
      seedData.users.length - 1,
    )

    const usersRecordApi = client.records<UserRecord>(`users_e2e`)
    const postsRecordApi = client.records<PostRecord>(`posts_e2e`)

    return {
      collections: {
        eager: {
          users: eagerCollections.users,
          posts: eagerCollections.posts,
          comments: eagerCollections.comments,
        },
        onDemand: {
          users: onDemandCollections.users,
          posts: onDemandCollections.posts,
          comments: onDemandCollections.comments,
        },
      },
      hasReplicationLag: true, // TrailBase has async subscription-based sync
      // Note: progressiveTestControl is not provided because the explicit snapshot/swap
      // transition tests require Electric-specific sync behavior that TrailBase doesn't support.
      // Tests that require this will be skipped.
      mutations: {
        insertUser: async (user) => {
          // Insert with the provided ID (base64-encoded UUID)
          await usersRecordApi.create(serializeUser(user))
          // ID is preserved from the user object
        },
        updateUser: async (id, updates) => {
          const partialRecord: Partial<UserRecord> = {}
          if (updates.age !== undefined) partialRecord.age = updates.age
          if (updates.name !== undefined) partialRecord.name = updates.name
          if (updates.email !== undefined) partialRecord.email = updates.email
          if (updates.isActive !== undefined)
            partialRecord.isActive = updates.isActive ? 1 : 0
          await usersRecordApi.update(id, partialRecord)
        },
        deleteUser: async (id) => {
          await usersRecordApi.delete(id)
        },
        insertPost: async (post) => {
          // Insert with the provided ID
          await postsRecordApi.create(serializePost(post))
        },
      },
      setup: async () => {},
      teardown: async () => {
        await Promise.all([
          eagerCollections.users.cleanup(),
          eagerCollections.posts.cleanup(),
          eagerCollections.comments.cleanup(),
          onDemandCollections.users.cleanup(),
          onDemandCollections.posts.cleanup(),
          onDemandCollections.comments.cleanup(),
        ])
      },
    }
  }

  // Run all shared test suites
  createPredicatesTestSuite(getConfig)
  createPaginationTestSuite(getConfig)
  createJoinsTestSuite(getConfig)
  createDeduplicationTestSuite(getConfig)
  createCollationTestSuite(getConfig)
  createMutationsTestSuite(getConfig)
  createLiveUpdatesTestSuite(getConfig)
  createProgressiveTestSuite(getConfig)
})
