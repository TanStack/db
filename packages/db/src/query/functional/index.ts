/**
 * EdgeDB-style Functional Query API
 *
 * Tree-shakable query builder using the pattern:
 * - First argument establishes type context (sources)
 * - Second argument is a shape callback with typed refs
 *
 * @example Basic query
 * ```ts
 * import { query } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * const q = query(
 *   { users: usersCollection },
 *   ({ users }) => ({
 *     where: eq(users.active, true),
 *     select: { name: users.name },
 *     orderBy: users.createdAt,
 *     limit: 10
 *   })
 * )
 * ```
 *
 * @example With tree-shakable clauses
 * ```ts
 * import { query, join, groupBy } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * const q = query(
 *   { users: usersCollection },
 *   ({ users }) => ({
 *     join: join({
 *       posts: { collection: postsCollection, on: eq(posts.authorId, users.id) }
 *     }),
 *     where: eq(users.active, true),
 *     select: { name: users.name }
 *   })
 * )
 * ```
 *
 * Tree-shaking: If you don't import join(), groupBy(), or having(),
 * that code won't be bundled.
 */

// Core API
export { query, compileQuery, getQueryIR, shapeRegistry } from "./core.js"

// Tree-shakable clause functions
export { join } from "./join.js"
export { groupBy, having } from "./group-by.js"

// Types
export type {
  Sources,
  RefsFor,
  RefProxy,
  QueryShape,
  Query,
  InferResult,
  InferSchema,
  JoinShape,
  OrderByShape,
  ClauseResult,
  JoinClauseResult,
  GroupByClauseResult,
  HavingClauseResult,
  ProcessorContext,
} from "./types.js"

// Type guard
export { isClauseResult } from "./types.js"
