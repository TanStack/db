/**
 * EdgeDB-style Functional Query API
 *
 * Tree-shakable query builder using the pattern:
 * - First argument establishes type context (sources)
 * - Second argument is a shape callback with typed refs
 *
 * @example
 * ```ts
 * import { query } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * const q = query(
 *   { users: usersCollection },
 *   ({ users }) => ({
 *     filter: eq(users.active, true),
 *     select: { name: users.name },
 *     orderBy: users.createdAt,
 *     limit: 10
 *   })
 * )
 * ```
 *
 * For joins, groupBy, or having - import the processors:
 * ```ts
 * import '@tanstack/db/query/functional/join'
 * import '@tanstack/db/query/functional/group-by'
 * ```
 */

// Core API
export { query, compileQuery, getQueryIR, shapeRegistry } from "./core.js"

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
  ShapeProcessor,
  ShapeRegistry,
  ProcessorContext,
} from "./types.js"

// Note: join.ts and group-by.ts are NOT exported here
// They must be explicitly imported to register their processors
// This enables tree-shaking
