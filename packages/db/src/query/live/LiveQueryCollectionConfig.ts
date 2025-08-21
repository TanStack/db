import type { InitialQueryBuilder, QueryBuilder } from "../builder/index.js"
import type { CollectionConfig } from "../../types.js"
import type { Context, GetResult } from "../builder/types.js"

/**
 * Configuration interface for live query collection options
 *
 * @example
 * ```typescript
 * const config: LiveQueryCollectionConfig<any, any> = {
 *   // id is optional - will auto-generate "live-query-1", "live-query-2", etc.
 *   query: (q) => q
 *     .from({ comment: commentsCollection })
 *     .join(
 *       { user: usersCollection },
 *       ({ comment, user }) => eq(comment.user_id, user.id)
 *     )
 *     .where(({ comment }) => eq(comment.active, true))
 *     .select(({ comment, user }) => ({
 *       id: comment.id,
 *       content: comment.content,
 *       authorName: user.name,
 *     })),
 *   // getKey is optional - defaults to using stream key
 *   getKey: (item) => item.id,
 * }
 * ```
 */
export interface LiveQueryCollectionConfig<
  TContext extends Context,
  TResult extends object = GetResult<TContext> & object,
> {
  /**
   * Unique identifier for the collection
   * If not provided, defaults to `live-query-${number}` with auto-incrementing number
   */
  id?: string

  /**
   * Query builder function that defines the live query
   */
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>

  /**
   * Function to extract the key from result items
   * If not provided, defaults to using the key from the D2 stream
   */
  getKey?: (item: TResult) => string | number

  /**
   * Optional schema for validation
   */
  schema?: CollectionConfig<TResult>[`schema`]

  /**
   * Optional mutation handlers
   */
  onInsert?: CollectionConfig<TResult>[`onInsert`]
  onUpdate?: CollectionConfig<TResult>[`onUpdate`]
  onDelete?: CollectionConfig<TResult>[`onDelete`]

  /**
   * Start sync / the query immediately
   */
  startSync?: boolean

  /**
   * GC time for the collection
   */
  gcTime?: number
}
