/**
 * Electric Collection E2E Tests
 *
 * end-to-end tests using actual Postgres + Electric sync
 */

import { afterAll, afterEach, beforeAll, describe, inject } from "vitest"
import { createCollection } from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import { makePgClient } from "../../db-collection-e2e/support/global-setup"
import {
  createCollationTestSuite,
  createDeduplicationTestSuite,
  createJoinsTestSuite,
  createLiveUpdatesTestSuite,
  createMutationsTestSuite,
  createPaginationTestSuite,
  createPredicatesTestSuite,
  generateSeedData,
} from "../../db-collection-e2e/src/index"
import { waitFor } from "../../db-collection-e2e/src/utils/helpers"
import type { E2ETestConfig } from "../../db-collection-e2e/src/types"
import type { Client } from "pg"

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

    // Wait for eager collections to sync all data
    await eagerUsers.preload()
    await eagerPosts.preload()
    await eagerComments.preload()

    // Wait for on-demand collections to be ready (they start empty)
    await onDemandUsers.preload()
    await onDemandPosts.preload()
    await onDemandComments.preload()

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
      },
      hasReplicationLag: true, // Electric has async replication lag
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
})
