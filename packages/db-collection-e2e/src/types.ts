import type { Collection } from "@tanstack/db"

/**
 * Test data schema types
 */
export interface User {
  id: string // UUID
  name: string // For collation testing
  email: string | null
  age: number
  isActive: boolean
  createdAt: Date
  metadata: Record<string, unknown> | null // JSON field
  deletedAt: Date | null // Soft delete
}

export interface Post {
  id: string
  userId: string // FK to User
  title: string
  content: string | null
  viewCount: number
  publishedAt: Date | null
  deletedAt: Date | null
}

export interface Comment {
  id: string
  postId: string // FK to Post
  userId: string // FK to User
  text: string
  createdAt: Date
  deletedAt: Date | null
}

/**
 * Seed data result
 */
export interface SeedDataResult {
  users: Array<User>
  posts: Array<Post>
  comments: Array<Comment>
  userIds: Array<string>
  postIds: Array<string>
  commentIds: Array<string>
}

/**
 * Test configuration for e2e tests
 */
export interface E2ETestConfig {
  collections: {
    eager: {
      users: Collection<User>
      posts: Collection<Post>
      comments: Collection<Comment>
    }
    onDemand: {
      users: Collection<User>
      posts: Collection<Post>
      comments: Collection<Comment>
    }
    progressive?: {
      users: Collection<User>
      posts: Collection<Post>
      comments: Collection<Comment>
    }
  }

  // Mutation helpers using collection APIs (works for both Electric and Query)
  // Note: Requires collections to have onInsert/onUpdate/onDelete handlers configured
  mutations?: {
    insertUser: (user: User) => Promise<void>
    updateUser: (id: string, updates: Partial<User>) => Promise<void>
    deleteUser: (id: string) => Promise<void>
    insertPost: (post: Post) => Promise<void>
  }

  // Indicates if the backend has replication lag (e.g., Electric sync)
  // When true, tests will wait for mutations to propagate before proceeding
  hasReplicationLag?: boolean

  // Test control for progressive mode (Electric only)
  // Allows explicit control over when initial sync completes for deterministic testing
  progressiveTestControl?: {
    releaseInitialSync: () => void
  }

  // Lifecycle hooks
  setup: () => Promise<void>
  teardown: () => Promise<void>
  beforeEach?: () => Promise<void>
  afterEach?: () => Promise<void>
}

/**
 * Database client interface (pg Client)
 */
export interface DbClient {
  connect: () => Promise<void>
  end: () => Promise<void>
  query: (
    sql: string,
    values?: Array<unknown>
  ) => Promise<{ rows: Array<unknown> }>
}
