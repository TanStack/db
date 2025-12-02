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
 * @example With tree-shakable clauses (join, groupBy, having)
 * ```ts
 * import { query, join, groupBy } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * // All sources (including joined tables) go in first argument
 * const q = query(
 *   { users: usersCollection, posts: postsCollection },
 *   ({ users, posts }) => ({
 *     join: join({
 *       posts: { on: eq(posts.authorId, users.id), type: 'left' }
 *     }),
 *     where: eq(users.active, true),
 *     select: { name: users.name, title: posts.title }
 *   })
 * )
 * ```
 *
 * Tree-shaking: If you don't import join(), groupBy(), or having(),
 * that code won't be bundled.
 *
 * ## Limitations
 *
 * - **First source is FROM**: The first key in the sources object becomes
 *   the primary FROM table. Additional sources are available for joins.
 *
 * - **Multi-source queries require select**: When using joins, you should
 *   always provide a `select` clause. Without it, the result type is a
 *   union of row types (e.g., `User | Post`), not a joined row.
 *
 * - **Join conditions**: Only binary comparisons like `eq(a, b)` are
 *   supported. Complex conditions like `and(eq(...), eq(...))` require
 *   IR changes and will throw an error.
 *
 * - **Join types**: Supports `inner`, `left`, `right`, `full`. The IR's
 *   `outer` and `cross` join types are not exposed in this API.
 */

// Core API (shapeRegistry is internal - not exported)
export { query, compileQuery, getQueryIR } from "./core.js"

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
