import { createCollection } from "../collection/index.js"
import { CollectionConfigBuilder } from "./live/collection-config-builder.js"
import type { LiveQueryCollectionConfig } from "./live/types.js"
import type { InitialQueryBuilder, QueryBuilder } from "./builder/index.js"
import type { Collection } from "../collection/index.js"
import type {
  CollectionConfig,
  CollectionConfigSingleRowOption,
  NonSingleResult,
  SingleResult,
  UtilsRecord,
} from "../types.js"
import type { Context, GetResult } from "./builder/types.js"

type CollectionConfigForContext<
  TContext extends Context,
  TResult extends object,
> = TContext extends SingleResult
  ? CollectionConfigSingleRowOption<TResult> & SingleResult
  : CollectionConfigSingleRowOption<TResult> & NonSingleResult

type CollectionForContext<
  TContext extends Context,
  TResult extends object,
> = TContext extends SingleResult
  ? Collection<TResult> & SingleResult
  : Collection<TResult> & NonSingleResult

/**
 * Creates live query collection options for use with createCollection
 *
 * @example
 * ```typescript
 * const options = liveQueryCollectionOptions({
 *   // id is optional - will auto-generate if not provided
 *   query: (q) => q
 *     .from({ post: postsCollection })
 *     .where(({ post }) => eq(post.published, true))
 *     .select(({ post }) => ({
 *       id: post.id,
 *       title: post.title,
 *       content: post.content,
 *     })),
 *   // getKey is optional - will use stream key if not provided
 * })
 *
 * const collection = createCollection(options)
 * ```
 *
 * @param config - Configuration options for the live query collection
 * @returns Collection options that can be passed to createCollection
 */
export function liveQueryCollectionOptions<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
>(
  config: LiveQueryCollectionConfig<TContext, TResult>
): CollectionConfigForContext<TContext, TResult> {
  const collectionConfigBuilder = new CollectionConfigBuilder<
    TContext,
    TResult
  >(config)
  return collectionConfigBuilder.getConfig() as CollectionConfigForContext<
    TContext,
    TResult
  >
}

/**
 * Creates a live query collection directly
 *
 * @example
 * ```typescript
 * // Minimal usage - just pass a query function
 * const activeUsers = createLiveQueryCollection(
 *   (q) => q
 *     .from({ user: usersCollection })
 *     .where(({ user }) => eq(user.active, true))
 *     .select(({ user }) => ({ id: user.id, name: user.name }))
 * )
 *
 * // Full configuration with custom options
 * const searchResults = createLiveQueryCollection({
 *   id: "search-results", // Custom ID (auto-generated if omitted)
 *   query: (q) => q
 *     .from({ post: postsCollection })
 *     .where(({ post }) => like(post.title, `%${searchTerm}%`))
 *     .select(({ post }) => ({
 *       id: post.id,
 *       title: post.title,
 *       excerpt: post.excerpt,
 *     })),
 *   getKey: (item) => item.id, // Custom key function (uses stream key if omitted)
 *   utils: {
 *     updateSearchTerm: (newTerm: string) => {
 *       // Custom utility functions
 *     }
 *   }
 * })
 * ```
 */

// Overload 1: Accept just the query function
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
>(
  query: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): CollectionForContext<TContext, TResult>

// Overload 2: Accept full config object with optional utilities
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
  TUtils extends UtilsRecord = {},
>(
  config: LiveQueryCollectionConfig<TContext, TResult> & { utils?: TUtils }
): CollectionForContext<TContext, TResult>

// Implementation
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
  TUtils extends UtilsRecord = {},
>(
  configOrQuery:
    | (LiveQueryCollectionConfig<TContext, TResult> & { utils?: TUtils })
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
): CollectionForContext<TContext, TResult> {
  // Determine if the argument is a function (query) or a config object
  if (typeof configOrQuery === `function`) {
    // Simple query function case
    const config: LiveQueryCollectionConfig<TContext, TResult> = {
      query: configOrQuery as (
        q: InitialQueryBuilder
      ) => QueryBuilder<TContext>,
    }
    const options = liveQueryCollectionOptions<TContext, TResult>(config)
    return bridgeToCreateCollection(options) as CollectionForContext<
      TContext,
      TResult
    >
  } else {
    // Config object case
    const config = configOrQuery as LiveQueryCollectionConfig<
      TContext,
      TResult
    > & { utils?: TUtils }
    const options = liveQueryCollectionOptions<TContext, TResult>(config)
    return bridgeToCreateCollection({
      ...options,
      utils: config.utils,
    }) as CollectionForContext<TContext, TResult>
  }
}

/**
 * Bridge function that handles the type compatibility between query2's TResult
 * and core collection's output type without exposing ugly type assertions to users
 */
function bridgeToCreateCollection<
  TResult extends object,
  TUtils extends UtilsRecord = {},
>(
  options: CollectionConfig<TResult> & { utils?: TUtils }
): Collection<TResult, string | number, TUtils> {
  // This is the only place we need a type assertion, hidden from user API
  return createCollection(options as any) as unknown as Collection<
    TResult,
    string | number,
    TUtils
  >
}
