/**
 * Electric Collection E2E Tests
 *
 * end-to-end tests using actual Postgres + Electric sync
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from "vitest"
import { createCollection } from "@tanstack/db"
import { ELECTRIC_TEST_HOOKS, electricCollectionOptions } from "../src/electric"
import { makePgClient } from "../../db-collection-e2e/support/global-setup"
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
} from "../../db-collection-e2e/src/index"
import { waitFor } from "../../db-collection-e2e/src/utils/helpers"
import type { E2ETestConfig } from "../../db-collection-e2e/src/types"
import type { Client } from "pg"

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string
    testSchema: string
  }
}

describe(`Electric Collection E2E Tests`, () => {
  let config: E2ETestConfig
  let dbClient: Client
  let usersTable: string
  let postsTable: string
  let commentsTable: string

  beforeAll(async () => {
    const baseUrl = inject(`baseUrl`)
    const testSchema = inject(`testSchema`)
    const seedData = generateSeedData()

    // Create unique table names (quoted for Electric)
    const testId = Date.now().toString(16)
    usersTable = `"users_e2e_${testId}"`
    postsTable = `"posts_e2e_${testId}"`
    commentsTable = `"comments_e2e_${testId}"`

    // Connect to database
    dbClient = makePgClient({ options: `-csearch_path=${testSchema}` })
    await dbClient.connect()
    await dbClient.query(`SET search_path TO ${testSchema}`)

    // Create tables
    await dbClient.query(`
      CREATE TABLE ${usersTable} (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        age INTEGER NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB,
        "deletedAt" TIMESTAMP
      )
    `)

    await dbClient.query(`
      CREATE TABLE ${postsTable} (
        id UUID PRIMARY KEY,
        "userId" UUID NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        "viewCount" INTEGER NOT NULL DEFAULT 0,
        "publishedAt" TIMESTAMP,
        "deletedAt" TIMESTAMP
      )
    `)

    await dbClient.query(`
      CREATE TABLE ${commentsTable} (
        id UUID PRIMARY KEY,
        "postId" UUID NOT NULL,
        "userId" UUID NOT NULL,
        text TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "deletedAt" TIMESTAMP
      )
    `)

    // Insert seed data
    console.log(`Inserting ${seedData.users.length} users...`)
    for (const user of seedData.users) {
      await dbClient.query(
        `INSERT INTO ${usersTable} (id, name, email, age, "isActive", "createdAt", metadata, "deletedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          user.id,
          user.name,
          user.email,
          user.age,
          user.isActive,
          user.createdAt,
          user.metadata ? JSON.stringify(user.metadata) : null,
          user.deletedAt,
        ]
      )
    }
    console.log(`Inserted ${seedData.users.length} users successfully`)

    for (const post of seedData.posts) {
      await dbClient.query(
        `INSERT INTO ${postsTable} (id, "userId", title, content, "viewCount", "publishedAt", "deletedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          post.id,
          post.userId,
          post.title,
          post.content,
          post.viewCount,
          post.publishedAt,
          post.deletedAt,
        ]
      )
    }

    for (const comment of seedData.comments) {
      await dbClient.query(
        `INSERT INTO ${commentsTable} (id, "postId", "userId", text, "createdAt", "deletedAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          comment.id,
          comment.postId,
          comment.userId,
          comment.text,
          comment.createdAt,
          comment.deletedAt,
        ]
      )
    }

    // Wait for Electric to see the data because Electric's logical replication
    // slot may be lagging a bit behind so we need to ensure that Electric has seen the data
    // before we start the tests otherwise the tests are faster than the replication slot
    // and won't see any data.
    const tempUsersCollection = createCollection(
      electricCollectionOptions({
        id: `temp-verify-users-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${usersTable}`,
          },
        },
        syncMode: `eager`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    const tempPostsCollection = createCollection(
      electricCollectionOptions({
        id: `temp-verify-posts-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${postsTable}`,
          },
        },
        syncMode: `eager`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    const tempCommentsCollection = createCollection(
      electricCollectionOptions({
        id: `temp-verify-comments-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${commentsTable}`,
          },
        },
        syncMode: `eager`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    await Promise.all([
      tempUsersCollection.preload(),
      tempPostsCollection.preload(),
      tempCommentsCollection.preload(),
    ])

    await Promise.all([
      waitFor(() => tempUsersCollection.size >= seedData.users.length, {
        timeout: 30000,
        interval: 500,
        message: `Electric replication has not processed WAL entries for users (got ${tempUsersCollection.size}/${seedData.users.length})`,
      }),
      waitFor(() => tempPostsCollection.size >= seedData.posts.length, {
        timeout: 30000,
        interval: 500,
        message: `Electric replication has not processed WAL entries for posts (got ${tempPostsCollection.size}/${seedData.posts.length})`,
      }),
      waitFor(() => tempCommentsCollection.size >= seedData.comments.length, {
        timeout: 30000,
        interval: 500,
        message: `Electric replication has not processed WAL entries for comments (got ${tempCommentsCollection.size}/${seedData.comments.length})`,
      }),
    ])

    // Clean up the temporary collections
    await Promise.all([
      tempUsersCollection.cleanup(),
      tempPostsCollection.cleanup(),
      tempCommentsCollection.cleanup(),
    ])

    // Create REAL Electric collections
    const eagerUsers = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-users-eager-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${usersTable}`,
          },
        },
        syncMode: `eager`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    const eagerPosts = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-posts-eager-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${postsTable}`,
          },
        },
        syncMode: `eager`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    const eagerComments = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-comments-eager-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${commentsTable}`,
          },
        },
        syncMode: `eager`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    const onDemandUsers = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-users-ondemand-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${usersTable}`,
          },
        },
        syncMode: `on-demand`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    const onDemandPosts = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-posts-ondemand-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${postsTable}`,
          },
        },
        syncMode: `on-demand`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    const onDemandComments = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-comments-ondemand-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${commentsTable}`,
          },
        },
        syncMode: `on-demand`,
        getKey: (item: any) => item.id,
        startSync: true,
      })
    )

    // Create control mechanisms for progressive collections
    // These allow tests to explicitly control when the atomic swap happens
    // We use a ref object so each test can get a fresh promise
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

    const progressiveUsers = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-users-progressive-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${usersTable}`,
          },
        },
        syncMode: `progressive`,
        getKey: (item: any) => item.id,
        startSync: false, // Don't start immediately - tests will start when ready
        [ELECTRIC_TEST_HOOKS]: {
          beforeMarkingReady: () => usersUpToDateControl.createPromise(),
        },
      })
    )

    const progressivePosts = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-posts-progressive-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${postsTable}`,
          },
        },
        syncMode: `progressive`,
        getKey: (item: any) => item.id,
        startSync: false, // Don't start immediately - tests will start when ready
        [ELECTRIC_TEST_HOOKS]: {
          beforeMarkingReady: () => postsUpToDateControl.createPromise(),
        },
      })
    )

    const progressiveComments = createCollection(
      electricCollectionOptions({
        id: `electric-e2e-comments-progressive-${testId}`,
        shapeOptions: {
          url: `${baseUrl}/v1/shape`,
          params: {
            table: `${testSchema}.${commentsTable}`,
          },
        },
        syncMode: `progressive`,
        getKey: (item: any) => item.id,
        startSync: false, // Don't start immediately - tests will start when ready
        [ELECTRIC_TEST_HOOKS]: {
          beforeMarkingReady: () => commentsUpToDateControl.createPromise(),
        },
      })
    )

    // Wait for eager collections to sync all data
    await eagerUsers.preload()
    await eagerPosts.preload()
    await eagerComments.preload()

    // Wait for on-demand collections to be ready (they start empty)
    await onDemandUsers.preload()
    await onDemandPosts.preload()
    await onDemandComments.preload()

    // Progressive collections start syncing in background
    // Note: We DON'T call preload() here because the test hooks will block
    // Individual progressive tests will handle preload and release as needed

    config = {
      collections: {
        eager: {
          users: eagerUsers as any,
          posts: eagerPosts as any,
          comments: eagerComments as any,
        },
        onDemand: {
          users: onDemandUsers as any,
          posts: onDemandPosts as any,
          comments: onDemandComments as any,
        },
        progressive: {
          users: progressiveUsers as any,
          posts: progressivePosts as any,
          comments: progressiveComments as any,
        },
      },
      hasReplicationLag: true, // Electric has async replication lag
      progressiveTestControl: {
        releaseInitialSync: () => {
          usersUpToDateControl.current?.()
          postsUpToDateControl.current?.()
          commentsUpToDateControl.current?.()
        },
      },
      getTxid: async () => {
        // Get the current transaction ID from the last operation
        // This uses pg_current_xact_id_if_assigned() which returns the txid
        // Note: This gets the CURRENT transaction's ID, so must be called
        // immediately after an insert in the same transaction context
        const result = await dbClient.query(
          `SELECT pg_current_xact_id_if_assigned()::text::bigint as txid`
        )
        return result.rows[0]?.txid || null
      },
      mutations: {
        // Use direct SQL for Electric tests (simulates external changes)
        // This tests that Electric sync picks up database changes
        insertUser: async (user) => {
          await dbClient.query(
            `INSERT INTO ${usersTable} (id, name, email, age, "isActive", "createdAt", metadata, "deletedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              user.id,
              user.name,
              user.email || null,
              user.age,
              user.isActive,
              user.createdAt,
              user.metadata ? JSON.stringify(user.metadata) : null,
              user.deletedAt || null,
            ]
          )
        },
        updateUser: async (id, updates) => {
          const setClauses: Array<string> = []
          const values: Array<any> = []
          let paramIndex = 1

          if (updates.age !== undefined) {
            setClauses.push(`age = $${paramIndex++}`)
            values.push(updates.age)
          }
          if (updates.name !== undefined) {
            setClauses.push(`name = $${paramIndex++}`)
            values.push(updates.name)
          }
          if (updates.email !== undefined) {
            setClauses.push(`email = $${paramIndex++}`)
            values.push(updates.email)
          }
          if (updates.isActive !== undefined) {
            setClauses.push(`"isActive" = $${paramIndex++}`)
            values.push(updates.isActive)
          }

          values.push(id)
          await dbClient.query(
            `UPDATE ${usersTable} SET ${setClauses.join(`, `)} WHERE id = $${paramIndex}`,
            values
          )
        },
        deleteUser: async (id) => {
          await dbClient.query(`DELETE FROM ${usersTable} WHERE id = $1`, [id])
        },
        insertPost: async (post) => {
          await dbClient.query(
            `INSERT INTO ${postsTable} (id, "userId", title, content, "viewCount", "publishedAt", "deletedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              post.id,
              post.userId,
              post.title,
              post.content || null,
              post.viewCount,
              post.publishedAt || null,
              post.deletedAt || null,
            ]
          )
        },
      },
      setup: async () => {},
      afterEach: async () => {
        // Clean up and restart on-demand collections
        // This validates cleanup() works and each test starts fresh
        await onDemandUsers.cleanup()
        await onDemandPosts.cleanup()
        await onDemandComments.cleanup()

        // Restart sync after cleanup
        onDemandUsers.startSyncImmediate()
        onDemandPosts.startSyncImmediate()
        onDemandComments.startSyncImmediate()

        // Wait for collections to be ready
        await onDemandUsers.preload()
        await onDemandPosts.preload()
        await onDemandComments.preload()
      },
      teardown: async () => {
        await Promise.all([
          eagerUsers.cleanup(),
          eagerPosts.cleanup(),
          eagerComments.cleanup(),
          onDemandUsers.cleanup(),
          onDemandPosts.cleanup(),
          onDemandComments.cleanup(),
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

    // Drop tables
    try {
      await dbClient.query(`DROP TABLE IF EXISTS ${commentsTable}`)
      await dbClient.query(`DROP TABLE IF EXISTS ${postsTable}`)
      await dbClient.query(`DROP TABLE IF EXISTS ${usersTable}`)
    } catch (e) {
      console.error(`Error dropping tables:`, e)
    }
    await dbClient.end()
  })

  // Helper to get config
  function getConfig() {
    return Promise.resolve(config)
  }

  // Run all test suites
  createPredicatesTestSuite(getConfig)
  createPaginationTestSuite(getConfig)
  createJoinsTestSuite(getConfig)
  createDeduplicationTestSuite(getConfig)
  createCollationTestSuite(getConfig)
  createMutationsTestSuite(getConfig)
  createLiveUpdatesTestSuite(getConfig)
  createProgressiveTestSuite(getConfig)

  // BigInt predicate pushdown tests
  describe(`BigInt Predicate Pushdown`, () => {
    it(`should filter with eq() on BIGINT field using JavaScript BigInt`, async () => {
      const baseUrl = inject(`baseUrl`)
      const testSchema = inject(`testSchema`)
      const testId = Date.now().toString(16)
      const bigintTable = `"bigint_test_${testId}"`

      // Create a table with BIGINT column
      await dbClient.query(`
        CREATE TABLE ${bigintTable} (
          id UUID PRIMARY KEY,
          large_number BIGINT NOT NULL,
          name TEXT NOT NULL
        )
      `)

      // Insert test data with large numbers that exceed Number.MAX_SAFE_INTEGER
      const testData = [
        {
          id: `00000000-0000-4000-8000-000000000001`,
          large_number: BigInt(`9007199254740993`), // MAX_SAFE_INTEGER + 2
          name: `Large 1`,
        },
        {
          id: `00000000-0000-4000-8000-000000000002`,
          large_number: BigInt(`9007199254740994`), // MAX_SAFE_INTEGER + 3
          name: `Large 2`,
        },
        {
          id: `00000000-0000-4000-8000-000000000003`,
          large_number: BigInt(`100`), // Small number for comparison
          name: `Small`,
        },
      ]

      for (const item of testData) {
        await dbClient.query(
          `INSERT INTO ${bigintTable} (id, large_number, name) VALUES ($1, $2, $3)`,
          [item.id, item.large_number.toString(), item.name]
        )
      }

      // Create collection for bigint table
      const bigintCollection = createCollection(
        electricCollectionOptions({
          id: `bigint-test-${testId}`,
          shapeOptions: {
            url: `${baseUrl}/v1/shape`,
            params: {
              table: `${testSchema}.${bigintTable}`,
            },
          },
          syncMode: `on-demand`,
          getKey: (item: any) => item.id,
          startSync: true,
        })
      )

      try {
        await bigintCollection.preload()

        // Test filtering with BigInt predicate
        const { createLiveQueryCollection, eq } = await import(`@tanstack/db`)
        const targetBigInt = BigInt(`9007199254740993`)

        const query = createLiveQueryCollection((q: any) =>
          q
            .from({ item: bigintCollection })
            .where(({ item }: any) => eq(item.large_number, targetBigInt))
        )

        await query.preload()
        await waitFor(() => query.size >= 1, {
          timeout: 10000,
          interval: 100,
          message: `BigInt predicate query did not return expected results`,
        })

        const results = Array.from(query.state.values())
        expect(results.length).toBe(1)
        expect(results[0]?.name).toBe(`Large 1`)

        await query.cleanup()
      } finally {
        await bigintCollection.cleanup()
        await dbClient.query(`DROP TABLE IF EXISTS ${bigintTable}`)
      }
    })

    it(`should filter with inArray() on BIGINT field using JavaScript BigInt array`, async () => {
      const baseUrl = inject(`baseUrl`)
      const testSchema = inject(`testSchema`)
      const testId = Date.now().toString(16)
      const bigintTable = `"bigint_inarray_test_${testId}"`

      // Create a table with BIGINT column
      await dbClient.query(`
        CREATE TABLE ${bigintTable} (
          id UUID PRIMARY KEY,
          large_number BIGINT NOT NULL,
          name TEXT NOT NULL
        )
      `)

      // Insert test data
      const testData = [
        {
          id: `00000000-0000-4000-8000-000000000001`,
          large_number: BigInt(`9007199254740993`),
          name: `Match 1`,
        },
        {
          id: `00000000-0000-4000-8000-000000000002`,
          large_number: BigInt(`9007199254740994`),
          name: `Match 2`,
        },
        {
          id: `00000000-0000-4000-8000-000000000003`,
          large_number: BigInt(`100`),
          name: `No Match`,
        },
      ]

      for (const item of testData) {
        await dbClient.query(
          `INSERT INTO ${bigintTable} (id, large_number, name) VALUES ($1, $2, $3)`,
          [item.id, item.large_number.toString(), item.name]
        )
      }

      // Create collection
      const bigintCollection = createCollection(
        electricCollectionOptions({
          id: `bigint-inarray-test-${testId}`,
          shapeOptions: {
            url: `${baseUrl}/v1/shape`,
            params: {
              table: `${testSchema}.${bigintTable}`,
            },
          },
          syncMode: `on-demand`,
          getKey: (item: any) => item.id,
          startSync: true,
        })
      )

      try {
        await bigintCollection.preload()

        const { createLiveQueryCollection, inArray } = await import(
          `@tanstack/db`
        )
        const targetBigInts = [
          BigInt(`9007199254740993`),
          BigInt(`9007199254740994`),
        ]

        const query = createLiveQueryCollection((q: any) =>
          q
            .from({ item: bigintCollection })
            .where(({ item }: any) => inArray(item.large_number, targetBigInts))
        )

        await query.preload()
        await waitFor(() => query.size >= 2, {
          timeout: 10000,
          interval: 100,
          message: `BigInt inArray query did not return expected results`,
        })

        const results = Array.from(query.state.values())
        expect(results.length).toBe(2)

        const names = results.map((r: any) => r.name).sort()
        expect(names).toEqual([`Match 1`, `Match 2`])

        await query.cleanup()
      } finally {
        await bigintCollection.cleanup()
        await dbClient.query(`DROP TABLE IF EXISTS ${bigintTable}`)
      }
    })
  })
})
