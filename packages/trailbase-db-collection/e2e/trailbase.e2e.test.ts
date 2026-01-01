/**
 * TrailBase Collection E2E Tests
 *
 * End-to-end tests using actual TrailBase server with sync.
 * Uses shared test suites from @tanstack/db-collection-e2e.
 */

import { afterAll, afterEach, beforeAll, describe, inject } from 'vitest'
import { createCollection } from '@tanstack/db'
import { initClient } from 'trailbase'
import {
  TRAILBASE_TEST_HOOKS,
  trailBaseCollectionOptions,
} from '../src/trailbase'
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
 * TrailBase record types matching the shared schema
 * TrailBase uses snake_case column names
 */
interface UserRecord {
  id: string
  name: string
  email: string | null
  age: number
  is_active: boolean
  created_at: string
  metadata: string | null // JSON stored as string
  deleted_at: string | null
}

interface PostRecord {
  id: string
  user_id: string
  title: string
  content: string | null
  view_count: number
  large_view_count: string // BigInt as string
  published_at: string | null
  deleted_at: string | null
}

interface CommentRecord {
  id: string
  post_id: string
  user_id: string
  text: string
  created_at: string
  deleted_at: string | null
}

// Serialize functions for inserts (omit id - TrailBase auto-generates with INTEGER PRIMARY KEY)
const serializeUserForInsert = (user: User): Omit<UserRecord, 'id'> => ({
  name: user.name,
  email: user.email,
  age: user.age,
  is_active: user.isActive,
  created_at: user.createdAt.toISOString(),
  metadata: user.metadata ? JSON.stringify(user.metadata) : null,
  deleted_at: user.deletedAt ? user.deletedAt.toISOString() : null,
})

const serializePostForInsert = (post: Post): Omit<PostRecord, 'id'> => ({
  user_id: post.userId,
  title: post.title,
  content: post.content,
  view_count: post.viewCount,
  large_view_count: post.largeViewCount.toString(),
  published_at: post.publishedAt ? post.publishedAt.toISOString() : null,
  deleted_at: post.deletedAt ? post.deletedAt.toISOString() : null,
})

const serializeCommentForInsert = (comment: Comment): Omit<CommentRecord, 'id'> => ({
  post_id: comment.postId,
  user_id: comment.userId,
  text: comment.text,
  created_at: comment.createdAt.toISOString(),
  deleted_at: comment.deletedAt ? comment.deletedAt.toISOString() : null,
})

/**
 * Parse functions that transform TrailBase records (snake_case) to app types (camelCase)
 * These do proper key mapping and type conversion
 */
const parseUser = (record: UserRecord): User => ({
  id: String(record.id),
  name: record.name,
  email: record.email,
  age: record.age,
  isActive: Boolean(record.is_active),
  createdAt: new Date(record.created_at),
  metadata: record.metadata ? JSON.parse(record.metadata) : null,
  deletedAt: record.deleted_at ? new Date(record.deleted_at) : null,
})

const parsePost = (record: PostRecord): Post => ({
  id: String(record.id),
  userId: record.user_id,
  title: record.title,
  content: record.content,
  viewCount: record.view_count,
  largeViewCount: BigInt(record.large_view_count),
  publishedAt: record.published_at ? new Date(record.published_at) : null,
  deletedAt: record.deleted_at ? new Date(record.deleted_at) : null,
})

const parseComment = (record: CommentRecord): Comment => ({
  id: String(record.id),
  postId: record.post_id,
  userId: record.user_id,
  text: record.text,
  createdAt: new Date(record.created_at),
  deletedAt: record.deleted_at ? new Date(record.deleted_at) : null,
})

/**
 * Serialize functions that transform app types (camelCase) to TrailBase records (snake_case)
 */
const serializeUser = (user: User): UserRecord => ({
  id: user.id,
  name: user.name,
  email: user.email,
  age: user.age,
  is_active: user.isActive,
  created_at: user.createdAt.toISOString(),
  metadata: user.metadata ? JSON.stringify(user.metadata) : null,
  deleted_at: user.deletedAt ? user.deletedAt.toISOString() : null,
})

const serializePost = (post: Post): PostRecord => ({
  id: post.id,
  user_id: post.userId,
  title: post.title,
  content: post.content,
  view_count: post.viewCount,
  large_view_count: post.largeViewCount.toString(),
  published_at: post.publishedAt ? post.publishedAt.toISOString() : null,
  deleted_at: post.deletedAt ? post.deletedAt.toISOString() : null,
})

const serializeComment = (comment: Comment): CommentRecord => ({
  id: comment.id,
  post_id: comment.postId,
  user_id: comment.userId,
  text: comment.text,
  created_at: comment.createdAt.toISOString(),
  deleted_at: comment.deletedAt ? comment.deletedAt.toISOString() : null,
})

/**
 * Partial serializers for updates (maps camelCase keys to snake_case)
 */
const serializeUserPartial = (user: Partial<User>): Partial<UserRecord> => {
  const result: Partial<UserRecord> = {}
  if (user.id !== undefined) result.id = user.id
  if (user.name !== undefined) result.name = user.name
  if (user.email !== undefined) result.email = user.email
  if (user.age !== undefined) result.age = user.age
  if (user.isActive !== undefined) result.is_active = user.isActive
  if (user.createdAt !== undefined) result.created_at = user.createdAt.toISOString()
  if (user.metadata !== undefined) result.metadata = user.metadata ? JSON.stringify(user.metadata) : null
  if (user.deletedAt !== undefined) result.deleted_at = user.deletedAt ? user.deletedAt.toISOString() : null
  return result
}

const serializePostPartial = (post: Partial<Post>): Partial<PostRecord> => {
  const result: Partial<PostRecord> = {}
  if (post.id !== undefined) result.id = post.id
  if (post.userId !== undefined) result.user_id = post.userId
  if (post.title !== undefined) result.title = post.title
  if (post.content !== undefined) result.content = post.content
  if (post.viewCount !== undefined) result.view_count = post.viewCount
  if (post.largeViewCount !== undefined) result.large_view_count = post.largeViewCount.toString()
  if (post.publishedAt !== undefined) result.published_at = post.publishedAt ? post.publishedAt.toISOString() : null
  if (post.deletedAt !== undefined) result.deleted_at = post.deletedAt ? post.deletedAt.toISOString() : null
  return result
}

const serializeCommentPartial = (comment: Partial<Comment>): Partial<CommentRecord> => {
  const result: Partial<CommentRecord> = {}
  if (comment.id !== undefined) result.id = comment.id
  if (comment.postId !== undefined) result.post_id = comment.postId
  if (comment.userId !== undefined) result.user_id = comment.userId
  if (comment.text !== undefined) result.text = comment.text
  if (comment.createdAt !== undefined) result.created_at = comment.createdAt.toISOString()
  if (comment.deletedAt !== undefined) result.deleted_at = comment.deletedAt ? comment.deletedAt.toISOString() : null
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

    // Insert seed data and capture returned IDs
    // TrailBase auto-generates INTEGER PRIMARY KEY, so we need to update seed data with actual IDs
    console.log(`Inserting ${seedData.users.length} users...`)
    let userErrors = 0
    const userIdMap = new Map<string, string>() // Maps original UUID to TrailBase integer ID
    for (const user of seedData.users) {
      try {
        const serialized = serializeUserForInsert(user)
        if (userErrors === 0) console.log('First user data:', JSON.stringify(serialized))
        const newId = await usersRecordApi.create(serialized)
        // Store the mapping and update the user's ID
        userIdMap.set(user.id, String(newId))
        user.id = String(newId)
      } catch (e) {
        userErrors++
        if (userErrors <= 3) console.error('User insert error:', e)
      }
    }
    // Update seedData.userIds with the new IDs
    seedData.userIds = seedData.users.map(u => u.id)
    console.log(`Inserted users: ${seedData.users.length - userErrors} success, ${userErrors} errors`)

    console.log(`Inserting ${seedData.posts.length} posts...`)
    let postErrors = 0
    const postIdMap = new Map<string, string>() // Maps original UUID to TrailBase integer ID
    for (const post of seedData.posts) {
      try {
        // Store original post ID for mapping
        const originalPostId = post.id
        // Update the userId reference to use the new TrailBase ID
        if (userIdMap.has(post.userId)) {
          post.userId = userIdMap.get(post.userId)!
        }
        const newId = await postsRecordApi.create(serializePostForInsert(post))
        postIdMap.set(originalPostId, String(newId))
        post.id = String(newId)
      } catch (e) {
        postErrors++
        if (postErrors <= 3) console.error('Post insert error:', e)
      }
    }
    // Update seedData.postIds with the new IDs
    seedData.postIds = seedData.posts.map(p => p.id)
    console.log(`Inserted posts: ${seedData.posts.length - postErrors} success, ${postErrors} errors`)

    console.log(`Inserting ${seedData.comments.length} comments...`)
    let commentErrors = 0
    for (const comment of seedData.comments) {
      try {
        // Update the userId and postId references using the maps
        if (userIdMap.has(comment.userId)) {
          comment.userId = userIdMap.get(comment.userId)!
        }
        if (postIdMap.has(comment.postId)) {
          comment.postId = postIdMap.get(comment.postId)!
        }
        const newId = await commentsRecordApi.create(serializeCommentForInsert(comment))
        comment.id = String(newId)
      } catch (e) {
        commentErrors++
        if (commentErrors <= 3) console.error('Comment insert error:', e)
      }
    }
    // Update seedData.commentIds with the new IDs
    seedData.commentIds = seedData.comments.map(c => c.id)
    console.log(`Inserted comments: ${seedData.comments.length - commentErrors} success, ${commentErrors} errors`)

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
        [TRAILBASE_TEST_HOOKS]: {
          beforeMarkingReady: () => usersUpToDateControl.createPromise(),
        },
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
        [TRAILBASE_TEST_HOOKS]: {
          beforeMarkingReady: () => postsUpToDateControl.createPromise(),
        },
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
        [TRAILBASE_TEST_HOOKS]: {
          beforeMarkingReady: () => commentsUpToDateControl.createPromise(),
        },
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
    console.log(`Users size: ${eagerCollections.users.size}, expected: ${seedData.users.length}`)
    console.log(`Posts size: ${eagerCollections.posts.size}, expected: ${seedData.posts.length}`)
    console.log(`Comments size: ${eagerCollections.comments.size}, expected: ${seedData.comments.length}`)

    // Debug: try direct list API call
    const testList = await usersRecordApi.list({ pagination: { limit: 10 } })
    console.log(`Direct list API returned ${testList.records.length} records:`, testList.records.slice(0, 2))

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
      progressiveTestControl: {
        releaseInitialSync: () => {
          usersUpToDateControl.current?.()
          postsUpToDateControl.current?.()
          commentsUpToDateControl.current?.()
        },
      },
      mutations: {
        insertUser: async (user) => {
          // TrailBase returns the auto-generated integer ID
          const newId = await usersRecordApi.create(serializeUserForInsert(user))
          // Update the user object with the actual ID so the test can reference it
          ;(user as any).id = String(newId)
        },
        updateUser: async (id, updates) => {
          const partialRecord: Partial<UserRecord> = {}
          if (updates.age !== undefined) partialRecord.age = updates.age
          if (updates.name !== undefined) partialRecord.name = updates.name
          if (updates.email !== undefined) partialRecord.email = updates.email
          if (updates.isActive !== undefined)
            partialRecord.is_active = updates.isActive
          await usersRecordApi.update(id, partialRecord)
        },
        deleteUser: async (id) => {
          await usersRecordApi.delete(id)
        },
        insertPost: async (post) => {
          // TrailBase returns the auto-generated integer ID
          const newId = await postsRecordApi.create(serializePostForInsert(post))
          // Update the post object with the actual ID
          ;(post as any).id = String(newId)
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
    for (const comment of seedData.comments) {
      try {
        await commentsRecordApi.delete(comment.id)
      } catch {
        // Ignore errors
      }
    }

    for (const post of seedData.posts) {
      try {
        await postsRecordApi.delete(post.id)
      } catch {
        // Ignore errors
      }
    }

    for (const user of seedData.users) {
      try {
        await usersRecordApi.delete(user.id)
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
