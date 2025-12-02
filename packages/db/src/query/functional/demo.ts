/**
 * EdgeDB-style Functional Query API Demo
 *
 * This demonstrates the type inference pattern:
 * - First argument establishes type context
 * - Callback receives typed refs
 * - Tree-shakable clause functions (join, groupBy, having)
 */

import { query, join, groupBy } from "./index.js"
import type { Collection } from "../../collection/index.js"
import type { BasicExpression } from "../ir.js"

// =============================================================================
// Mock types for demonstration
// =============================================================================

interface User {
  id: string
  name: string
  email: string
  active: boolean
  createdAt: Date
  departmentId: string
}

interface Post {
  id: string
  title: string
  content: string
  authorId: string
  publishedAt: Date
}

// Mock collections (in real usage, these come from createCollection)
declare const usersCollection: Collection<User, "id", any, any, any>
declare const postsCollection: Collection<Post, "id", any, any, any>

// Mock operators
declare function eq<T>(
  left: BasicExpression<T>,
  right: T
): BasicExpression<boolean>

// =============================================================================
// Demo: Basic Query
// =============================================================================

/**
 * Simple query with where and select
 *
 * Type inference works:
 * 1. `{ users: usersCollection }` has type `{ users: Collection<User> }`
 * 2. Callback receives `{ users: RefProxy<User> }`
 * 3. `users.active`, `users.name` are typed!
 */
const basicQuery = query({ users: usersCollection }, ({ users }) => ({
  where: eq(users.active, true),
  select: {
    name: users.name,
    email: users.email,
  },
}))

// Result type is inferred: { name: string, email: string }
type BasicResult = typeof basicQuery._result

// =============================================================================
// Demo: Query with OrderBy and Limit
// =============================================================================

const paginatedQuery = query({ users: usersCollection }, ({ users }) => ({
  where: eq(users.active, true),
  select: {
    name: users.name,
  },
  orderBy: users.createdAt,
  limit: 10,
  offset: 0,
}))

// =============================================================================
// Demo: Query with complex orderBy
// =============================================================================

const complexOrderQuery = query({ users: usersCollection }, ({ users }) => ({
  select: { name: users.name },
  orderBy: [
    { expr: users.createdAt, direction: "desc" },
    { expr: users.name, direction: "asc" },
  ],
}))

// =============================================================================
// Demo: Full row selection (no select = return full row)
// =============================================================================

const fullRowQuery = query({ users: usersCollection }, ({ users }) => ({
  where: eq(users.active, true),
}))

// Result type is User (full row)
type FullRowResult = typeof fullRowQuery._result

// =============================================================================
// Demo: Tree-shakable JOIN clause
// =============================================================================

/**
 * Using join() - tree-shakable!
 *
 * If you don't import join from the barrel, the join processing code
 * won't be bundled. The join() function returns a ClauseResult with
 * embedded processing logic.
 */
const joinQuery = query({ users: usersCollection }, ({ users }) => ({
  join: join({
    posts: {
      collection: postsCollection,
      on: eq((postsCollection as any).authorId, users.id),
      type: "left",
    },
  }),
  where: eq(users.active, true),
  select: {
    name: users.name,
  },
}))

// =============================================================================
// Demo: Tree-shakable GROUP BY clause
// =============================================================================

/**
 * Using groupBy() - tree-shakable!
 */
const groupByQuery = query({ users: usersCollection }, ({ users }) => ({
  groupBy: groupBy(users.departmentId),
  select: {
    departmentId: users.departmentId,
  },
}))

// =============================================================================
// Export demos
// =============================================================================

export {
  basicQuery,
  paginatedQuery,
  complexOrderQuery,
  fullRowQuery,
  joinQuery,
  groupByQuery,
}
