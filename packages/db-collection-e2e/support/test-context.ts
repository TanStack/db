import { test, inject } from 'vitest'
import { Client } from 'pg'
import { makePgClient } from './global-setup'
import type { SeedDataResult } from '../src/types'
import { generateSeedData } from '../src/fixtures/seed-data'

/**
 * Base fixture with database client and abort controller
 */
export const testWithDb = test.extend<{
  dbClient: Client
  aborter: AbortController
  baseUrl: string
  testSchema: string
  tableName: (base: string) => string
}>({
  dbClient: async ({}, use) => {
    const schema = inject('testSchema')
    const client = makePgClient({
      options: `-csearch_path=${schema}`,
    })
    await client.connect()

    // Ensure schema is set
    await client.query(`SET search_path TO ${schema}`)

    await use(client)
    await client.end()
  },

  aborter: async ({}, use) => {
    const controller = new AbortController()
    await use(controller)
    controller.abort('Test complete')
  },

  baseUrl: async ({}, use) => {
    await use(inject('baseUrl'))
  },

  testSchema: async ({}, use) => {
    await use(inject('testSchema'))
  },

  tableName: async ({ task }, use) => {
    // Generate unique table names based on task ID and random suffix
    await use((base: string) => {
      const taskId = task.id.replace(/[^a-zA-Z0-9]/g, '_')
      const random = Math.random().toString(16).slice(2, 8)
      return `"${base}_${taskId}_${random}"`
    })
  },
})

/**
 * Extended fixture with test tables (Users, Posts, Comments)
 */
export const testWithTables = testWithDb.extend<{
  usersTable: string
  postsTable: string
  commentsTable: string
  dropTables: () => Promise<void>
}>({
  usersTable: async ({ dbClient, tableName, task }, use) => {
    const name = tableName('users')
    const taskFile = task.file?.name.replace(/'/g, '`') ?? 'unknown'
    const taskName = task.name.replace(/'/g, '`')

    await dbClient.query(`
      DROP TABLE IF EXISTS ${name};
      CREATE TABLE ${name} (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        age INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB,
        deleted_at TIMESTAMP
      );
      COMMENT ON TABLE ${name} IS 'Created for ${taskFile} - ${taskName}';
    `)

    await use(name)

    try {
      await dbClient.query(`DROP TABLE IF EXISTS ${name}`)
    } catch (error) {
      console.error(`Error dropping table ${name}:`, error)
    }
  },

  postsTable: async ({ dbClient, tableName, usersTable, task }, use) => {
    const name = tableName('posts')
    const taskFile = task.file?.name.replace(/'/g, '`') ?? 'unknown'
    const taskName = task.name.replace(/'/g, '`')

    await dbClient.query(`
      DROP TABLE IF EXISTS ${name};
      CREATE TABLE ${name} (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        view_count INTEGER NOT NULL DEFAULT 0,
        published_at TIMESTAMP,
        deleted_at TIMESTAMP
      );
      COMMENT ON TABLE ${name} IS 'Created for ${taskFile} - ${taskName}';
    `)

    await use(name)

    try {
      await dbClient.query(`DROP TABLE IF EXISTS ${name}`)
    } catch (error) {
      console.error(`Error dropping table ${name}:`, error)
    }
  },

  commentsTable: async (
    { dbClient, tableName, postsTable, usersTable, task },
    use,
  ) => {
    const name = tableName('comments')
    const taskFile = task.file?.name.replace(/'/g, '`') ?? 'unknown'
    const taskName = task.name.replace(/'/g, '`')

    await dbClient.query(`
      DROP TABLE IF EXISTS ${name};
      CREATE TABLE ${name} (
        id UUID PRIMARY KEY,
        post_id UUID NOT NULL,
        user_id UUID NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      COMMENT ON TABLE ${name} IS 'Created for ${taskFile} - ${taskName}';
    `)

    await use(name)

    try {
      await dbClient.query(`DROP TABLE IF EXISTS ${name}`)
    } catch (error) {
      console.error(`Error dropping table ${name}:`, error)
    }
  },

  dropTables: async (
    { dbClient, usersTable, postsTable, commentsTable },
    use,
  ) => {
    await use(async () => {
      try {
        await dbClient.query(`DROP TABLE IF EXISTS ${commentsTable}`)
        await dbClient.query(`DROP TABLE IF EXISTS ${postsTable}`)
        await dbClient.query(`DROP TABLE IF EXISTS ${usersTable}`)
      } catch (error) {
        console.error('Error dropping tables:', error)
      }
    })
  },
})

/**
 * Extended fixture with seeded test data
 */
export const testWithSeedData = testWithTables.extend<{
  seedData: SeedDataResult
  insertSeedData: () => Promise<void>
}>({
  seedData: async ({}, use) => {
    const seed = generateSeedData()
    await use(seed)
  },

  insertSeedData: async (
    { dbClient, usersTable, postsTable, commentsTable, seedData },
    use,
  ) => {
    await use(async () => {
      // Insert users
      for (const user of seedData.users) {
        await dbClient.query(
          `INSERT INTO ${usersTable} (id, name, email, age, is_active, created_at, metadata, deleted_at)
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
          ],
        )
      }

      // Insert posts
      for (const post of seedData.posts) {
        await dbClient.query(
          `INSERT INTO ${postsTable} (id, user_id, title, content, view_count, published_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            post.id,
            post.userId,
            post.title,
            post.content,
            post.viewCount,
            post.publishedAt,
            post.deletedAt,
          ],
        )
      }

      // Insert comments
      for (const comment of seedData.comments) {
        await dbClient.query(
          `INSERT INTO ${commentsTable} (id, post_id, user_id, text, created_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            comment.id,
            comment.postId,
            comment.userId,
            comment.text,
            comment.createdAt,
            comment.deletedAt,
          ],
        )
      }
    })
  },
})
