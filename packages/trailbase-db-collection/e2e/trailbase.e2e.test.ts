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

    // Create progressive collections with test hooks
    // These use startSync: false so tests can control when sync starts
    progressiveUsers = createCollection(
      trailBaseCollectionOptions({
        id: `trailbase-e2e-users-progressive-${testId}`,
        recordApi: usersRecordApi,
        getKey: (item: User) => item.id,
        startSync: false, // Don't start immediately - tests will start when ready
        syncMode: `progressive`,
        parse: userParseConfig,
        serialize: userSerializeConfig,
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
        parse: postParseConfig,
        serialize: postSerializeConfig,
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
        parse: commentParseConfig,
        serialize: commentSerializeConfig,
        [TRAILBASE_TEST_HOOKS]: {
          beforeMarkingReady: () => commentsUpToDateControl.createPromise(),
        },
      }),
    ) as Collection<Comment>

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
