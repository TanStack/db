/**
 * TrailBase Collection E2E Tests
 *
 * End-to-end tests using actual TrailBase server with sync.
 * Uses shared test suites from @tanstack/db-collection-e2e.
 */

import { afterAll, afterEach, beforeAll, describe, inject } from 'vitest'
import { createCollection } from '@tanstack/db'
import { Client } from 'trailbase'
import { trailBaseCollectionOptions } from '../src/trailbase'
import type { TrailBaseSyncMode } from '../src/trailbase'
import {
  createCollationTestSuite,
  createDeduplicationTestSuite,
  createJoinsTestSuite,
  createLiveUpdatesTestSuite,
  createMutationsTestSuite,
  createPaginationTestSuite,
  createPredicatesTestSuite,
  generateSeedData,
} from '../../db-collection-e2e/src/index'
import { waitFor } from '../../db-collection-e2e/src/utils/helpers'
import type {
  E2ETestConfig,
  User,
  Post,
  Comment,
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

// Serialize functions: App type -> TrailBase record
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

// Parse config for User collection
const userParseConfig = {
  id: (v: string) => v,
  name: (v: string) => v,
  email: (v: string | null) => v,
  age: (v: number) => v,
  is_active: (v: boolean) => v,
  created_at: (v: string) => new Date(v),
  metadata: (v: string | null) => (v ? JSON.parse(v) : null),
  deleted_at: (v: string | null) => (v ? new Date(v) : null),
}

const userSerializeConfig = {
  id: (v: string) => v,
  name: (v: string) => v,
  email: (v: string | null) => v,
  age: (v: number) => v,
  isActive: (v: boolean) => v,
  createdAt: (v: Date) => v.toISOString(),
  metadata: (v: Record<string, unknown> | null) =>
    v ? JSON.stringify(v) : null,
  deletedAt: (v: Date | null) => (v ? v.toISOString() : null),
}

// Parse config for Post collection
const postParseConfig = {
  id: (v: string) => v,
  user_id: (v: string) => v,
  title: (v: string) => v,
  content: (v: string | null) => v,
  view_count: (v: number) => v,
  large_view_count: (v: string) => BigInt(v),
  published_at: (v: string | null) => (v ? new Date(v) : null),
  deleted_at: (v: string | null) => (v ? new Date(v) : null),
}

const postSerializeConfig = {
  id: (v: string) => v,
  userId: (v: string) => v,
  title: (v: string) => v,
  content: (v: string | null) => v,
  viewCount: (v: number) => v,
  largeViewCount: (v: bigint) => v.toString(),
  publishedAt: (v: Date | null) => (v ? v.toISOString() : null),
  deletedAt: (v: Date | null) => (v ? v.toISOString() : null),
}

// Parse config for Comment collection
const commentParseConfig = {
  id: (v: string) => v,
  post_id: (v: string) => v,
  user_id: (v: string) => v,
  text: (v: string) => v,
  created_at: (v: string) => new Date(v),
  deleted_at: (v: string | null) => (v ? new Date(v) : null),
}

const commentSerializeConfig = {
  id: (v: string) => v,
  postId: (v: string) => v,
  userId: (v: string) => v,
  text: (v: string) => v,
  createdAt: (v: Date) => v.toISOString(),
  deletedAt: (v: Date | null) => (v ? v.toISOString() : null),
}

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
      parse: userParseConfig,
      serialize: userSerializeConfig,
    }),
  )

  const postsCollection = createCollection(
    trailBaseCollectionOptions({
      id: `trailbase-e2e-posts-${suffix}-${testId}`,
      recordApi: postsRecordApi,
      getKey: (item: Post) => item.id,
      startSync: true,
      syncMode,
      parse: postParseConfig,
      serialize: postSerializeConfig,
    }),
  )

  const commentsCollection = createCollection(
    trailBaseCollectionOptions({
      id: `trailbase-e2e-comments-${suffix}-${testId}`,
      recordApi: commentsRecordApi,
      getKey: (item: Comment) => item.id,
      startSync: true,
      syncMode,
      parse: commentParseConfig,
      serialize: commentSerializeConfig,
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
  let client: Client
  let testId: string
  let seedData: ReturnType<typeof generateSeedData>

  // Collections for each sync mode
  let eagerCollections: ReturnType<typeof createCollectionsForSyncMode>
  let onDemandCollections: ReturnType<typeof createCollectionsForSyncMode>
  let progressiveCollections: ReturnType<typeof createCollectionsForSyncMode>

  beforeAll(async () => {
    const baseUrl = inject(`baseUrl`)
    seedData = generateSeedData()

    testId = Date.now().toString(16)

    // Initialize TrailBase client
    client = new Client(baseUrl)

    // Get record APIs for seeding
    const usersRecordApi = client.records<UserRecord>(`users_e2e`)
    const postsRecordApi = client.records<PostRecord>(`posts_e2e`)
    const commentsRecordApi = client.records<CommentRecord>(`comments_e2e`)

    // Insert seed data
    console.log(`Inserting ${seedData.users.length} users...`)
    for (const user of seedData.users) {
      try {
        await usersRecordApi.create(serializeUser(user))
      } catch {
        // Record may already exist
      }
    }
    console.log(`Inserted ${seedData.users.length} users successfully`)

    console.log(`Inserting ${seedData.posts.length} posts...`)
    for (const post of seedData.posts) {
      try {
        await postsRecordApi.create(serializePost(post))
      } catch {
        // Record may already exist
      }
    }
    console.log(`Inserted ${seedData.posts.length} posts successfully`)

    console.log(`Inserting ${seedData.comments.length} comments...`)
    for (const comment of seedData.comments) {
      try {
        await commentsRecordApi.create(serializeComment(comment))
      } catch {
        // Record may already exist
      }
    }
    console.log(`Inserted ${seedData.comments.length} comments successfully`)

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
    progressiveCollections = createCollectionsForSyncMode(
      client,
      testId,
      `progressive`,
      `progressive`,
    )

    // Wait for eager collections to sync (they need to fetch all data before marking ready)
    await Promise.all([
      eagerCollections.users.preload(),
      eagerCollections.posts.preload(),
      eagerCollections.comments.preload(),
    ])

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

    // On-demand and progressive collections are marked ready immediately
    // but start empty (will load data via loadSubset when queried)
    await Promise.all([
      onDemandCollections.users.preload(),
      onDemandCollections.posts.preload(),
      onDemandCollections.comments.preload(),
      progressiveCollections.users.preload(),
      progressiveCollections.posts.preload(),
      progressiveCollections.comments.preload(),
    ])

    // Wait a bit for progressive background sync to start
    await new Promise((resolve) => setTimeout(resolve, 100))

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
          users: progressiveCollections.users,
          posts: progressiveCollections.posts,
          comments: progressiveCollections.comments,
        },
      },
      hasReplicationLag: true, // TrailBase has async subscription-based sync
      mutations: {
        insertUser: async (user) => {
          await usersRecordApi.create(serializeUser(user))
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
          progressiveCollections.users.cleanup(),
          progressiveCollections.posts.cleanup(),
          progressiveCollections.comments.cleanup(),
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

  // Run shared test suites
  createPredicatesTestSuite(getConfig)
  createPaginationTestSuite(getConfig)
  createJoinsTestSuite(getConfig)
  createDeduplicationTestSuite(getConfig)
  createCollationTestSuite(getConfig)
  createMutationsTestSuite(getConfig)
  createLiveUpdatesTestSuite(getConfig)
  // Note: Progressive test suite from Electric is specific to Electric's snapshot phase behavior
  // TrailBase's progressive mode works differently (background full sync instead of buffered atomic swap)
})
