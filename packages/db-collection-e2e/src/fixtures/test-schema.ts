/**
 * SQL schema definitions for test tables
 */

export const USERS_TABLE_SCHEMA = `
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  age INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB,
  "deletedAt" TIMESTAMP
`

export const POSTS_TABLE_SCHEMA = `
  id UUID PRIMARY KEY,
  "userId" UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP,
  "deletedAt" TIMESTAMP
`

export const COMMENTS_TABLE_SCHEMA = `
  id UUID PRIMARY KEY,
  "postId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  text TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMP
`

/**
 * Helper to create all test tables
 */
export async function createTestTables(
  dbClient: { query: (sql: string) => Promise<void> },
  tableNames: {
    users: string
    posts: string
    comments: string
  },
): Promise<void> {
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS ${tableNames.users} (${USERS_TABLE_SCHEMA});
  `)

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS ${tableNames.posts} (${POSTS_TABLE_SCHEMA});
  `)

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS ${tableNames.comments} (${COMMENTS_TABLE_SCHEMA});
  `)
}

/**
 * Helper to drop all test tables
 */
export async function dropTestTables(
  dbClient: { query: (sql: string) => Promise<void> },
  tableNames: {
    users: string
    posts: string
    comments: string
  },
): Promise<void> {
  await dbClient.query(`DROP TABLE IF EXISTS ${tableNames.comments}`)
  await dbClient.query(`DROP TABLE IF EXISTS ${tableNames.posts}`)
  await dbClient.query(`DROP TABLE IF EXISTS ${tableNames.users}`)
}

/**
 * Type-safe table column mappings
 */
export const USER_COLUMNS = {
  id: `id`,
  name: `name`,
  email: `email`,
  age: `age`,
  isActive: `isActive`,
  createdAt: `createdAt`,
  metadata: `metadata`,
  deletedAt: `deletedAt`,
} as const

export const POST_COLUMNS = {
  id: `id`,
  userId: `userId`,
  title: `title`,
  content: `content`,
  viewCount: `viewCount`,
  publishedAt: `publishedAt`,
  deletedAt: `deletedAt`,
} as const

export const COMMENT_COLUMNS = {
  id: `id`,
  postId: `postId`,
  userId: `userId`,
  text: `text`,
  createdAt: `createdAt`,
  deletedAt: `deletedAt`,
} as const
