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
import type { E2ETestConfig, User, Post, Comment } from '../../db-collection-e2e/src/types'

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

// Parse functions: TrailBase record -> App type
const parseUser = (record: UserRecord): User => ({
  id: record.id,
  name: record.name,
  email: record.email,
  age: record.age,
  isActive: record.is_active,
  createdAt: new Date(record.created_at),
  metadata: record.metadata ? JSON.parse(record.metadata) : null,
  deletedAt: record.deleted_at ? new Date(record.deleted_at) : null,
})

const parsePost = (record: PostRecord): Post => ({
  id: record.id,
  userId: record.user_id,
  title: record.title,
  content: record.content,
  viewCount: record.view_count,
  largeViewCount: BigInt(record.large_view_count),
  publishedAt: record.published_at ? new Date(record.published_at) : null,
  deletedAt: record.deleted_at ? new Date(record.deleted_at) : null,
})

const parseComment = (record: CommentRecord): Comment => ({
  id: record.id,
  postId: record.post_id,
  userId: record.user_id,
  text: record.text,
  createdAt: new Date(record.created_at),
  deletedAt: record.deleted_at ? new Date(record.deleted_at) : null,
})

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

describe(`TrailBase Collection E2E Tests`, () => {
  let config: E2ETestConfig
  let client: Client
  let testId: string

  beforeAll(async () => {
    const baseUrl = inject(`baseUrl`)
    const seedData = generateSeedData()

    testId = Date.now().toString(16)

    // Initialize TrailBase client
    client = new Client(baseUrl)

    // Get record APIs
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

    // Create collections with sync enabled
    // TrailBase has a unified sync mode (initial fetch + subscription)
    // We create one set of collections and use them for both eager and onDemand
    // since TrailBase always syncs all data eagerly

    const usersCollection = createCollection(
      trailBaseCollectionOptions({
        id: `trailbase-e2e-users-${testId}`,
        recordApi: usersRecordApi,
        getKey: (item: User) => item.id,
        startSync: true,
        parse: {
          id: (v: string) => v,
          name: (v: string) => v,
          email: (v: string | null) => v,
          age: (v: number) => v,
          is_active: (v: boolean) => v,
          created_at: (v: string) => new Date(v),
          metadata: (v: string | null) => (v ? JSON.parse(v) : null),
          deleted_at: (v: string | null) => (v ? new Date(v) : null),
        },
        serialize: {
          id: (v: string) => v,
          name: (v: string) => v,
          email: (v: string | null) => v,
          age: (v: number) => v,
          isActive: (v: boolean) => v,
          createdAt: (v: Date) => v.toISOString(),
          metadata: (v: Record<string, unknown> | null) =>
            v ? JSON.stringify(v) : null,
          deletedAt: (v: Date | null) => (v ? v.toISOString() : null),
        },
      }),
    )

    const postsCollection = createCollection(
      trailBaseCollectionOptions({
        id: `trailbase-e2e-posts-${testId}`,
        recordApi: postsRecordApi,
        getKey: (item: Post) => item.id,
        startSync: true,
        parse: {
          id: (v: string) => v,
          user_id: (v: string) => v,
          title: (v: string) => v,
          content: (v: string | null) => v,
          view_count: (v: number) => v,
          large_view_count: (v: string) => BigInt(v),
          published_at: (v: string | null) => (v ? new Date(v) : null),
          deleted_at: (v: string | null) => (v ? new Date(v) : null),
        },
        serialize: {
          id: (v: string) => v,
          userId: (v: string) => v,
          title: (v: string) => v,
          content: (v: string | null) => v,
          viewCount: (v: number) => v,
          largeViewCount: (v: bigint) => v.toString(),
          publishedAt: (v: Date | null) => (v ? v.toISOString() : null),
          deletedAt: (v: Date | null) => (v ? v.toISOString() : null),
        },
      }),
    )

    const commentsCollection = createCollection(
      trailBaseCollectionOptions({
        id: `trailbase-e2e-comments-${testId}`,
        recordApi: commentsRecordApi,
        getKey: (item: Comment) => item.id,
        startSync: true,
        parse: {
          id: (v: string) => v,
          post_id: (v: string) => v,
          user_id: (v: string) => v,
          text: (v: string) => v,
          created_at: (v: string) => new Date(v),
          deleted_at: (v: string | null) => (v ? new Date(v) : null),
        },
        serialize: {
          id: (v: string) => v,
          postId: (v: string) => v,
          userId: (v: string) => v,
          text: (v: string) => v,
          createdAt: (v: Date) => v.toISOString(),
          deletedAt: (v: Date | null) => (v ? v.toISOString() : null),
        },
      }),
    )

    // Wait for initial sync to complete
    await Promise.all([
      usersCollection.preload(),
      postsCollection.preload(),
      commentsCollection.preload(),
    ])

    // Wait for data to be synced
    await Promise.all([
      waitFor(() => usersCollection.size >= seedData.users.length, {
        timeout: 30000,
        interval: 500,
        message: `TrailBase sync has not completed for users (got ${usersCollection.size}/${seedData.users.length})`,
      }),
      waitFor(() => postsCollection.size >= seedData.posts.length, {
        timeout: 30000,
        interval: 500,
        message: `TrailBase sync has not completed for posts (got ${postsCollection.size}/${seedData.posts.length})`,
      }),
      waitFor(() => commentsCollection.size >= seedData.comments.length, {
        timeout: 30000,
        interval: 500,
        message: `TrailBase sync has not completed for comments (got ${commentsCollection.size}/${seedData.comments.length})`,
      }),
    ])

    // TrailBase has unified sync mode, so we use the same collections for both eager and onDemand
    // The test suites will work because TrailBase always syncs all data
    config = {
      collections: {
        eager: {
          users: usersCollection as any,
          posts: postsCollection as any,
          comments: commentsCollection as any,
        },
        onDemand: {
          // TrailBase doesn't have on-demand mode, use the same collections
          // The tests that rely on on-demand behavior may need adjustment
          users: usersCollection as any,
          posts: postsCollection as any,
          comments: commentsCollection as any,
        },
        // TrailBase doesn't have progressive mode
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
          usersCollection.cleanup(),
          postsCollection.cleanup(),
          commentsCollection.cleanup(),
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

    const seedData = generateSeedData()

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
  // Note: Progressive test suite is skipped as TrailBase doesn't have progressive sync mode
})
