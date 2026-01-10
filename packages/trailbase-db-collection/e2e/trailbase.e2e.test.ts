/**
 * TrailBase Collection E2E Tests
 *
 * End-to-end tests using actual TrailBase server with sync.
 * Uses shared test suites from @tanstack/db-collection-e2e.
 */

import { afterAll, afterEach, beforeAll, describe, inject } from 'vitest'
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
import { waitFor } from '../../db-collection-e2e/src/utils/helpers'
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

/**
 * Decode base64-encoded BLOB UUID to standard UUID string format
 * TrailBase stores UUIDs as BLOBs and returns them as base64
 */
function base64ToUuid(base64: string): string {
  // Decode base64 to bytes
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  // Convert bytes to UUID string format
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Encode UUID string to URL-safe base64 format for TrailBase API calls
 * TrailBase returns standard base64 from create, but API URLs need URL-safe base64
 */
function uuidToBase64(uuid: string): string {
  // Remove dashes and convert hex to bytes
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }

  // Convert bytes to URL-safe base64 (replace + with - and / with _)
  let binaryString = ''
  for (const byte of bytes) {
    binaryString += String.fromCharCode(byte)
  }
  return btoa(binaryString).replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * Parse TrailBase ID response - handles various formats:
 * - URL-safe base64 encoded UUID blob
 * - Standard base64 encoded UUID blob
 * - Plain UUID string
 * - Integer (for backwards compatibility)
 */
function parseTrailBaseId(rawId: unknown): string {
  const idStr = String(rawId)

  // Check if it's already a UUID string format
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idStr,
    )
  ) {
    return idStr
  }

  // Check if it's an integer
  if (/^\d+$/.test(idStr)) {
    return idStr
  }

  // Try URL-safe base64 decoding (with - and _ instead of + and /)
  try {
    // Convert URL-safe base64 to standard base64
    const standardBase64 = idStr.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding if needed
    const padded =
      standardBase64 + '=='.slice(0, (4 - (standardBase64.length % 4)) % 4)
    return base64ToUuid(padded)
  } catch {
    // If that fails, try standard base64
    try {
      return base64ToUuid(idStr)
    } catch {
      // If all else fails, return as-is
      console.warn(`Could not parse TrailBase ID: ${idStr}`)
      return idStr
    }
  }
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
 * Parse functions - only transform types that differ between DB and app
 */
const parseUser = (record: UserRecord): User => ({
  id: parseTrailBaseId(record.id),
  name: record.name,
  email: record.email,
  age: record.age,
  isActive: Boolean(record.isActive),
  createdAt: new Date(record.createdAt),
  metadata: record.metadata ? JSON.parse(record.metadata) : null,
  deletedAt: record.deletedAt ? new Date(record.deletedAt) : null,
})

const parsePost = (record: PostRecord): Post => ({
  id: parseTrailBaseId(record.id),
  userId: record.userId,
  title: record.title,
  content: record.content,
  viewCount: record.viewCount,
  largeViewCount: BigInt(record.largeViewCount),
  publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
  deletedAt: record.deletedAt ? new Date(record.deletedAt) : null,
})

const parseComment = (record: CommentRecord): Comment => ({
  id: parseTrailBaseId(record.id),
  postId: record.postId,
  userId: record.userId,
  text: record.text,
  createdAt: new Date(record.createdAt),
  deletedAt: record.deletedAt ? new Date(record.deletedAt) : null,
})

/**
 * Serialize functions - transform app types to DB storage types
 * ID is base64 encoded for TrailBase BLOB storage
 */
const serializeUser = (user: User): UserRecord => ({
  id: uuidToBase64(user.id),
  name: user.name,
  email: user.email,
  age: user.age,
  isActive: user.isActive ? 1 : 0,
  createdAt: user.createdAt.toISOString(),
  metadata: user.metadata ? JSON.stringify(user.metadata) : null,
  deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
})

const serializePost = (post: Post): PostRecord => ({
  id: uuidToBase64(post.id),
  userId: post.userId,
  title: post.title,
  content: post.content,
  viewCount: post.viewCount,
  largeViewCount: post.largeViewCount.toString(),
  publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
  deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
})

const serializeComment = (comment: Comment): CommentRecord => ({
  id: uuidToBase64(comment.id),
  postId: comment.postId,
  userId: comment.userId,
  text: comment.text,
  createdAt: comment.createdAt.toISOString(),
  deletedAt: comment.deletedAt ? comment.deletedAt.toISOString() : null,
})

/**
 * Partial serializers for updates
 */
const serializeUserPartial = (user: Partial<User>): Partial<UserRecord> => {
  const result: Partial<UserRecord> = {}
  if (user.id !== undefined) result.id = uuidToBase64(user.id)
  if (user.name !== undefined) result.name = user.name
  if (user.email !== undefined) result.email = user.email
  if (user.age !== undefined) result.age = user.age
  if (user.isActive !== undefined) result.isActive = user.isActive ? 1 : 0
  if (user.createdAt !== undefined)
    result.createdAt = user.createdAt.toISOString()
  if (user.metadata !== undefined)
    result.metadata = user.metadata ? JSON.stringify(user.metadata) : null
  if (user.deletedAt !== undefined)
    result.deletedAt = user.deletedAt ? user.deletedAt.toISOString() : null
  return result
}

const serializePostPartial = (post: Partial<Post>): Partial<PostRecord> => {
  const result: Partial<PostRecord> = {}
  if (post.id !== undefined) result.id = uuidToBase64(post.id)
  if (post.userId !== undefined) result.userId = post.userId
  if (post.title !== undefined) result.title = post.title
  if (post.content !== undefined) result.content = post.content
  if (post.viewCount !== undefined) result.viewCount = post.viewCount
  if (post.largeViewCount !== undefined)
    result.largeViewCount = post.largeViewCount.toString()
  if (post.publishedAt !== undefined)
    result.publishedAt = post.publishedAt
      ? post.publishedAt.toISOString()
      : null
  if (post.deletedAt !== undefined)
    result.deletedAt = post.deletedAt ? post.deletedAt.toISOString() : null
  return result
}

const serializeCommentPartial = (
  comment: Partial<Comment>,
): Partial<CommentRecord> => {
  const result: Partial<CommentRecord> = {}
  if (comment.id !== undefined) result.id = uuidToBase64(comment.id)
  if (comment.postId !== undefined) result.postId = comment.postId
  if (comment.userId !== undefined) result.userId = comment.userId
  if (comment.text !== undefined) result.text = comment.text
  if (comment.createdAt !== undefined)
    result.createdAt = comment.createdAt.toISOString()
  if (comment.deletedAt !== undefined)
    result.deletedAt = comment.deletedAt
      ? comment.deletedAt.toISOString()
      : null
  return result
}

/**
 * Helper to create a set of collections for a given sync mode
 */
function createCollectionsForSyncMode(
  client: ReturnType<typeof initClient>,
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
      parse: parseUser,
      serialize: serializeUser,
      serializePartial: serializeUserPartial,
    }),
  )

  const postsCollection = createCollection(
    trailBaseCollectionOptions({
      id: `trailbase-e2e-posts-${suffix}-${testId}`,
      recordApi: postsRecordApi,
      getKey: (item: Post) => item.id,
      startSync: true,
      syncMode,
      parse: parsePost,
      serialize: serializePost,
      serializePartial: serializePostPartial,
    }),
  )

  const commentsCollection = createCollection(
    trailBaseCollectionOptions({
      id: `trailbase-e2e-comments-${suffix}-${testId}`,
      recordApi: commentsRecordApi,
      getKey: (item: Comment) => item.id,
      startSync: true,
      syncMode,
      parse: parseComment,
      serialize: serializeComment,
      serializePartial: serializeCommentPartial,
    }),
  )

  return {
    users: usersCollection as Collection<User>,
    posts: postsCollection as Collection<Post>,
    comments: commentsCollection as Collection<Comment>,
  }
}

describe(`TrailBase Collection E2E Tests`, () => {
  let config: E2ETestConfig
  let client: ReturnType<typeof initClient>
  let testId: string
  let seedData: ReturnType<typeof generateSeedData>

  // Collections for each sync mode
  let eagerCollections: ReturnType<typeof createCollectionsForSyncMode>
  let onDemandCollections: ReturnType<typeof createCollectionsForSyncMode>

  // Progressive collections with test hooks (created separately)
  let progressiveUsers: Collection<User>
  let progressivePosts: Collection<Post>
  let progressiveComments: Collection<Comment>

  // Control mechanisms for progressive collections test hooks
  const usersUpToDateControl = {
    current: null as (() => void) | null,
    createPromise: () =>
      new Promise<void>((resolve) => {
        usersUpToDateControl.current = resolve
      }),
  }
  const postsUpToDateControl = {
    current: null as (() => void) | null,
    createPromise: () =>
      new Promise<void>((resolve) => {
        postsUpToDateControl.current = resolve
      }),
  }
  const commentsUpToDateControl = {
    current: null as (() => void) | null,
    createPromise: () =>
      new Promise<void>((resolve) => {
        commentsUpToDateControl.current = resolve
      }),
  }

  beforeAll(async () => {
    const baseUrl = inject(`baseUrl`)
    seedData = generateSeedData()

    testId = Date.now().toString(16)

    // Initialize TrailBase client
    client = initClient(baseUrl)

    // Get record APIs for seeding
    const usersRecordApi = client.records<UserRecord>(`users_e2e`)
    const postsRecordApi = client.records<PostRecord>(`posts_e2e`)
    const commentsRecordApi = client.records<CommentRecord>(`comments_e2e`)

    // Clean up any existing records (from previous test runs or mutations)
    console.log(`Cleaning up existing records...`)
    try {
      const existingComments = await commentsRecordApi.list({})
      for (const comment of existingComments.records) {
        try {
          await commentsRecordApi.delete(comment.id)
        } catch {
          /* ignore */
        }
      }
      const existingPosts = await postsRecordApi.list({})
      for (const post of existingPosts.records) {
        try {
          await postsRecordApi.delete(post.id)
        } catch {
          /* ignore */
        }
      }
      const existingUsers = await usersRecordApi.list({})
      for (const user of existingUsers.records) {
        try {
          await usersRecordApi.delete(user.id)
        } catch {
          /* ignore */
        }
      }
      console.log(`Cleanup complete`)
    } catch (e) {
      console.log(`Cleanup skipped (tables might be empty):`, e)
    }

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
    if (seedData.users.length > 0)
      console.log(`First user ID: ${seedData.users[0].id}`)

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

    // Create collections with different sync modes
    eagerCollections = createCollectionsForSyncMode(
      client,
      testId,
      `eager`,
      `eager`,
    )
    onDemandCollections = createCollectionsForSyncMode(
      client,
      testId,
      `on-demand`,
      `ondemand`,
    )

    // Create progressive collections with test hooks
    // These use startSync: false so tests can control when sync starts
    progressiveUsers = createCollection(
      trailBaseCollectionOptions({
        id: `trailbase-e2e-users-progressive-${testId}`,
        recordApi: usersRecordApi,
        getKey: (item: User) => item.id,
        startSync: false, // Don't start immediately - tests will start when ready
        syncMode: `progressive`,
        parse: parseUser,
        serialize: serializeUser,
        serializePartial: serializeUserPartial,
      }),
    ) as Collection<User>

    progressivePosts = createCollection(
      trailBaseCollectionOptions({
        id: `trailbase-e2e-posts-progressive-${testId}`,
        recordApi: postsRecordApi,
        getKey: (item: Post) => item.id,
        startSync: false,
        syncMode: `progressive`,
        parse: parsePost,
        serialize: serializePost,
        serializePartial: serializePostPartial,
      }),
    ) as Collection<Post>

    progressiveComments = createCollection(
      trailBaseCollectionOptions({
        id: `trailbase-e2e-comments-progressive-${testId}`,
        recordApi: commentsRecordApi,
        getKey: (item: Comment) => item.id,
        startSync: false,
        syncMode: `progressive`,
        parse: parseComment,
        serialize: serializeComment,
        serializePartial: serializeCommentPartial,
      }),
    ) as Collection<Comment>

    // Wait for eager collections to sync (they need to fetch all data before marking ready)
    console.log('Calling preload on eager collections...')
    await Promise.all([
      eagerCollections.users.preload(),
      eagerCollections.posts.preload(),
      eagerCollections.comments.preload(),
    ])
    console.log('Preload complete, checking sizes...')
    console.log(
      `Users size: ${eagerCollections.users.size}, expected: ${seedData.users.length}`,
    )
    console.log(
      `Posts size: ${eagerCollections.posts.size}, expected: ${seedData.posts.length}`,
    )
    console.log(
      `Comments size: ${eagerCollections.comments.size}, expected: ${seedData.comments.length}`,
    )

    // Debug: try direct list API call
    const testList = await usersRecordApi.list({ pagination: { limit: 10 } })
    console.log(
      `Direct list API returned ${testList.records.length} records:`,
      testList.records.slice(0, 2),
    )

    // Wait for eager collections to have all data
    await Promise.all([
      waitFor(() => eagerCollections.users.size >= seedData.users.length, {
        timeout: 30000,
        interval: 500,
        message: `TrailBase eager sync has not completed for users`,
      }),
      waitFor(() => eagerCollections.posts.size >= seedData.posts.length, {
        timeout: 30000,
        interval: 500,
        message: `TrailBase eager sync has not completed for posts`,
      }),
      waitFor(
        () => eagerCollections.comments.size >= seedData.comments.length,
        {
          timeout: 30000,
          interval: 500,
          message: `TrailBase eager sync has not completed for comments`,
        },
      ),
    ])

    // On-demand collections are marked ready immediately
    await Promise.all([
      onDemandCollections.users.preload(),
      onDemandCollections.posts.preload(),
      onDemandCollections.comments.preload(),
    ])

    // Note: We DON'T call preload() on progressive collections here
    // because the test hooks will block. Individual progressive tests
    // will handle preload and release as needed.

    config = {
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
        progressive: {
          users: progressiveUsers,
          posts: progressivePosts,
          comments: progressiveComments,
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
          const encodedId = uuidToBase64(id)
          await usersRecordApi.update(encodedId, partialRecord)
        },
        deleteUser: async (id) => {
          const encodedId = uuidToBase64(id)
          await usersRecordApi.delete(encodedId)
        },
        insertPost: async (post) => {
          // Insert with the provided ID
          await postsRecordApi.create(serializePost(post))
        },
      },
      setup: async () => {},
      afterEach: async () => {
        // TrailBase doesn't need collection restart like Electric's on-demand mode
      },
      teardown: async () => {
        await Promise.all([
          eagerCollections.users.cleanup(),
          eagerCollections.posts.cleanup(),
          eagerCollections.comments.cleanup(),
          onDemandCollections.users.cleanup(),
          onDemandCollections.posts.cleanup(),
          onDemandCollections.comments.cleanup(),
          progressiveUsers.cleanup(),
          progressivePosts.cleanup(),
          progressiveComments.cleanup(),
        ])
      },
    }
  }, 60000) // 60 second timeout for setup

  afterEach(async () => {
    if (config.afterEach) {
      await config.afterEach()
    }
  })

  afterAll(async () => {
    await config.teardown()

    // Clean up seed data
    const usersRecordApi = client.records<UserRecord>(`users_e2e`)
    const postsRecordApi = client.records<PostRecord>(`posts_e2e`)
    const commentsRecordApi = client.records<CommentRecord>(`comments_e2e`)

    // Delete in reverse order due to FK constraints
    // IDs need to be encoded as base64 for TrailBase API
    for (const comment of seedData.comments) {
      try {
        await commentsRecordApi.delete(uuidToBase64(comment.id))
      } catch {
        // Ignore errors
      }
    }

    for (const post of seedData.posts) {
      try {
        await postsRecordApi.delete(uuidToBase64(post.id))
      } catch {
        // Ignore errors
      }
    }

    for (const user of seedData.users) {
      try {
        await usersRecordApi.delete(uuidToBase64(user.id))
      } catch {
        // Ignore errors
      }
    }
  })

  // Helper to get config
  function getConfig() {
    return Promise.resolve(config)
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
