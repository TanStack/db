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

// Mock operators - both sides can be expressions or values
declare function eq<T>(
  left: BasicExpression<T> | T,
  right: BasicExpression<T> | T
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
// Type assertion: this will fail to compile if inference is wrong
type BasicResult = typeof basicQuery._result
type _AssertBasicResult = BasicResult extends { name: string; email: string }
  ? { name: string; email: string } extends BasicResult
    ? true // Types are equal
    : "ERROR: BasicResult is too wide"
  : "ERROR: BasicResult doesn't have name/email as strings"
const _checkBasicResult: _AssertBasicResult = true

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
 * ALL sources (including joined tables) go in the first argument.
 * This gives you typed refs for everything - no "as any" hacks needed.
 *
 * The join() function just specifies HOW to join (ON condition, type),
 * not WHAT to join - since the collection is already in sources.
 */
const joinQuery = query(
  { users: usersCollection, posts: postsCollection },
  ({ users, posts }) => ({
    join: join({
      posts: { on: eq(posts.authorId, users.id), type: "left" },
    }),
    where: eq(users.active, true),
    select: {
      name: users.name,
      title: posts.title,
    },
  })
)

// Type assertion: join result should have { name: string, title: string }
type JoinResult = typeof joinQuery._result
type _AssertJoinResult = JoinResult extends { name: string; title: string }
  ? { name: string; title: string } extends JoinResult
    ? true
    : "ERROR: JoinResult is too wide"
  : "ERROR: JoinResult doesn't match expected type"
const _checkJoinResult: _AssertJoinResult = true

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
