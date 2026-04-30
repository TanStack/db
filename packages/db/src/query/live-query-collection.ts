import { createCollection } from '../collection/index.js'
import { CollectionConfigBuilder } from './live/collection-config-builder.js'
import {
  getBuilderFromConfig,
  registerCollectionBuilder,
} from './live/collection-registry.js'
import type {
  LiveQueryBuiltInUtils,
  LiveQueryCollectionUtils,
} from './live/collection-config-builder.js'
import type { LiveQueryCollectionConfig } from './live/types.js'
import type {
  ExtractContext,
  InitialQueryBuilder,
  QueryBuilder,
} from './builder/index.js'
import type { Collection } from '../collection/index.js'
import type {
  CollectionConfig,
  CollectionConfigSingleRowOption,
  NonSingleResult,
  SingleResult,
  UtilsRecord,
} from '../types.js'
import type {
  Context,
  RootObjectResultConstraint,
  RootQueryBuilder,
  RootQueryFn,
  RootQueryResult,
} from './builder/types.js'

export type { LiveQueryCollectionUtils } from './live/collection-config-builder.js'

type CollectionConfigForContext<
  TContext extends Context,
  TResult extends object,
  TUtils extends UtilsRecord = {},
> = TContext extends SingleResult
  ? CollectionConfigSingleRowOption<TResult, string | number, never, TUtils> &
      SingleResult
  : CollectionConfigSingleRowOption<TResult, string | number, never, TUtils> &
      NonSingleResult

type CollectionForContext<
  TContext extends Context,
  TResult extends object,
  TUtils extends UtilsRecord = {},
> = TContext extends SingleResult
  ? Collection<TResult, string | number, TUtils> & SingleResult
  : Collection<TResult, string | number, TUtils> & NonSingleResult

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
  TQuery extends QueryBuilder<any>,
  TContext extends Context = ExtractContext<TQuery>,
  TResult extends object = RootQueryResult<TContext>,
>(
  config: LiveQueryCollectionConfig<TContext, TResult> & {
    query: RootQueryFn<TQuery> | RootQueryBuilder<TQuery>
  },
): CollectionConfigForContext<TContext, TResult> & {
  utils: LiveQueryBuiltInUtils
} {
  const collectionConfigBuilder = new CollectionConfigBuilder<
    TContext,
    TResult
  >(config)
  return collectionConfigBuilder.getConfig() as CollectionConfigForContext<
    TContext,
    TResult
  > & { utils: LiveQueryBuiltInUtils }
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
  TQueryFn extends (q: InitialQueryBuilder) => QueryBuilder<any>,
  TQuery extends QueryBuilder<any> = ReturnType<TQueryFn>,
>(
  query: TQueryFn & RootQueryFn<TQuery>,
): CollectionForContext<
  ExtractContext<TQuery>,
  RootQueryResult<ExtractContext<TQuery>>
> & {
  utils: LiveQueryCollectionUtils
}

// Overload 2: Accept full config object with optional utilities
export function createLiveQueryCollection<
  TQuery extends QueryBuilder<any>,
  TContext extends Context = ExtractContext<TQuery>,
  TUtils extends UtilsRecord = {},
>(
  config: LiveQueryCollectionConfig<TContext, RootQueryResult<TContext>> & {
    query: RootQueryFn<TQuery> | RootQueryBuilder<TQuery>
    utils?: TUtils
  },
): CollectionForContext<TContext, RootQueryResult<TContext>> & {
  utils: LiveQueryCollectionUtils & TUtils
}

// Implementation
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = RootQueryResult<TContext>,
  TUtils extends UtilsRecord = {},
>(
  configOrQuery:
    | (LiveQueryCollectionConfig<TContext, TResult> & { utils?: TUtils })
    | ((
        q: InitialQueryBuilder,
      ) => QueryBuilder<TContext> & RootObjectResultConstraint<TContext>),
): CollectionForContext<TContext, TResult> & {
  utils: LiveQueryCollectionUtils & TUtils
} {
  // Determine if the argument is a function (query) or a config object
  if (typeof configOrQuery === `function`) {
    // Simple query function case
    const config: LiveQueryCollectionConfig<TContext, TResult> = {
      query: configOrQuery as (
        q: InitialQueryBuilder,
      ) => QueryBuilder<TContext> & RootObjectResultConstraint<TContext>,
    }
    // The implementation accepts both overload shapes, but TypeScript cannot
    // preserve the overload-specific query-builder inference through this branch.
    const options = liveQueryCollectionOptions(config as any)
    return bridgeToCreateCollection(options) as CollectionForContext<
      TContext,
      TResult
    > & { utils: LiveQueryCollectionUtils & TUtils }
  }

  // Config object case. Same overload implementation limitation as above:
  // the config has already been validated by the public signatures, but the
  // branch loses that precision.
  const config = configOrQuery as LiveQueryCollectionConfig<
    TContext,
    TResult
  > & { utils?: TUtils }
  const options = liveQueryCollectionOptions(config as any)

  // Merge custom utils if provided, preserving the getBuilder() method for dependency tracking
  if (config.utils) {
    options.utils = { ...options.utils, ...config.utils }
  }

  return bridgeToCreateCollection(options) as CollectionForContext<
    TContext,
    TResult
  > & { utils: LiveQueryCollectionUtils & TUtils }
}

/**
 * Bridge function that handles the type compatibility between query2's TResult
 * and core collection's output type without exposing ugly type assertions to users
 */
function bridgeToCreateCollection<TResult extends object>(
  options: CollectionConfig<TResult> & { utils: LiveQueryBuiltInUtils },
): Collection<TResult, string | number, LiveQueryBuiltInUtils> {
  const collection = createCollection(options as any) as unknown as Collection<
    TResult,
    string | number,
    LiveQueryBuiltInUtils
  >

  const builder = getBuilderFromConfig(options)
  if (builder) {
    registerCollectionBuilder(collection, builder)
    // Route the Collection's tracked-source-records public methods through
    // the live-query-local view (the source-records this query is using),
    // not the base-collection refcount manager (which is "consumers of mine").
    // The adapter is stable across sync sessions; the underlying aggregator
    // is replaced each session.
    collection._liveQueryTrackedSourceView = builder.liveQueryTrackedSourceView
  }

  return collection
}
