import { BaseQueryBuilder } from './query/builder/index.js'
import { collectSourceRefs, requireCollectionSource } from './query/ir.js'
import { isCollection } from './live-query-primitives.js'
import {
  DEFAULT_GC_TIME_MS,
  UNSUBSCRIBED_GC_FLOOR_MS,
} from './collection/lifecycle.js'
import { createLiveQueryCollection } from './query/live-query-collection.js'
import {
  createPooledLiveQuery,
  getPooledQueryIdentity,
} from './query/pooled-live-query.js'
import {
  getStableQueryBuilderHash,
  getStableValueHash,
} from './query/ir-stable-identity.js'
import { getStringCollationIdentity } from './query/runtime-reference-identity.js'
import { codedMessage, devBuild } from './error-message.js'
import type { Collection, CollectionImpl } from './collection/index.js'
import type { CollectionOptionsIdentity } from './collection-options.js'
import type { CollectionOptions, DbClient } from './client.js'
import type {
  Context,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from './query/index.js'

export type LiveQueryKey = ReadonlyArray<unknown>

export type LiveQueryOptions = LiveQueryCollectionConfig<any> & {
  queryKey?: LiveQueryKey
}

export type DeferredLiveQueryCollections = Set<
  CollectionImpl<any, string | number, any, any, any>
>

/**
 * Release the sync starts a rejected query input deferred, then rethrow its
 * rejection. A framework hook calls this around its own render work, so a
 * query the hook rejects leaves no source deferred and a later reader can
 * start it. A render that throws after the hook returns, such as in a sibling
 * hook, is not a rejection of this input: like any render that never commits,
 * it releases its deferral through `releaseDeferredOnReclaim` when garbage
 * collection reclaims its live query. As for a
 * `DbClient` preload, the rejection wins over a source whose resumed start
 * fails; that source records its own failure.
 */
export function rejectLiveQueryInput(
  collections: DeferredLiveQueryCollections | undefined,
  rejection: unknown,
): never {
  try {
    if (collections) resumeDeferredLiveQueryCollections(collections)
  } catch {
    // Report the rejection, not a later start failure.
  }
  throw rejection
}

/**
 * Release a render's deferred sync starts when the live query it built is
 * reclaimed. A render that commits releases them first, when it subscribes.
 * A render that never commits, because a sibling threw or it suspended, leaves
 * its live query unsubscribed until garbage collection cleans it up; that
 * cleanup releases the starts, so a direct reader's demand, made before or
 * after, then starts the sources. A live query that garbage collection never
 * reclaims, because its config disables GC or does not start its sync,
 * releases after the unsubscribed GC floor instead. Releases only the starts
 * deferred so far, not ones a later render of the same hook defers. Pass only
 * a live query the render built, and call the returned function when the
 * render commits, so a committed hook keeps no listener, timer, or copied
 * sources.
 */
export function releaseDeferredOnReclaim(
  liveQuery: Pick<Collection<any, any, any>, `once` | `config` | `status`>,
  deferredCollections: DeferredLiveQueryCollections,
): (() => void) | undefined {
  if (deferredCollections.size === 0) return undefined
  const pending: DeferredLiveQueryCollections = new Set(deferredCollections)
  const release = () => {
    try {
      resumeDeferredLiveQueryCollections(pending)
    } catch {
      // A source whose resumed start fails records its own failure.
    }
  }
  // The lifecycle's own rule: GC reclaims only a started collection with a
  // finite, positive gcTime.
  const gcTime = liveQuery.config.gcTime ?? DEFAULT_GC_TIME_MS
  if (gcTime > 0 && Number.isFinite(gcTime) && liveQuery.status !== `idle`) {
    return liveQuery.once(`status:cleaned-up`, release)
  }
  const timer = setTimeout(release, UNSUBSCRIBED_GC_FLOOR_MS)
  return () => clearTimeout(timer)
}

/** Release every deferred source, then report the first startup failure. */
export function resumeDeferredLiveQueryCollections(
  collections: DeferredLiveQueryCollections,
): void {
  const pending = Array.from(collections)
  collections.clear()
  let firstFailure: { error: unknown } | undefined
  for (const collection of pending) {
    try {
      collection._resumeSyncStart()
    } catch (error) {
      firstFailure ??= { error }
    }
  }
  if (firstFailure) throw firstFailure.error
}

type PreparedLiveQueryConfigInput = Omit<
  LiveQueryCollectionConfig<Context>,
  `query`
> & {
  query:
    | QueryBuilder<Context>
    | ((q: InitialQueryBuilder) => QueryBuilder<Context> | undefined | null)
  queryKey?: LiveQueryKey
  client?: DbClient
}

function createInitialQueryBuilder(): InitialQueryBuilder {
  // Query construction does not materialize descriptor Collections.
  return new BaseQueryBuilder() as InitialQueryBuilder
}

function createCollectionResolver(
  dbClient: DbClient | undefined,
  deferredCollections?: DeferredLiveQueryCollections,
) {
  if (!dbClient) return undefined
  return (
    options: CollectionOptionsIdentity<any, string | number, any, any, any>,
  ): CollectionImpl<any, string | number, any, any, any> => {
    if (!deferredCollections) {
      return dbClient.collection(
        options as CollectionOptions<any, string | number, any, any>,
      ) as CollectionImpl<any, string | number, any, any, any>
    }
    const collection = dbClient._materializeCollectionForRender(
      options as CollectionOptions<any, string | number, any, any>,
    ) as CollectionImpl<any, string | number, any, any, any>
    if (collection._deferSyncStart()) deferredCollections.add(collection)
    return collection
  }
}

export function prepareLiveQueryValue(
  value: unknown,
  dbClient: DbClient | undefined,
  deferredCollections?: DeferredLiveQueryCollections,
): unknown {
  if (typeof value === `function`) {
    return prepareLiveQueryValue(
      value(createInitialQueryBuilder()),
      dbClient,
      deferredCollections,
    )
  }

  if (value instanceof BaseQueryBuilder) {
    return value._bindCollectionSources(
      createCollectionResolver(dbClient, deferredCollections),
    )
  }

  if (
    value &&
    typeof value === `object` &&
    !isCollection(value) &&
    !(value instanceof BaseQueryBuilder) &&
    `query` in value
  ) {
    const {
      query,
      queryKey: _queryKey,
      client: _client,
      ...config
    } = value as PreparedLiveQueryConfigInput

    const preparedQuery = prepareLiveQueryValue(
      query,
      dbClient,
      deferredCollections,
    )

    if (preparedQuery === undefined || preparedQuery === null) {
      return preparedQuery
    }

    return {
      ...config,
      query: preparedQuery,
    }
  }

  return value
}

/** Concrete source objects in query-position order for a prepared value. */
export function getPreparedLiveQuerySources(
  value: unknown,
  onUnboundDescriptor?: (alias: string) => never,
): Array<Collection> {
  if (isCollection(value)) return [value]
  const query =
    value instanceof BaseQueryBuilder
      ? value
      : value && typeof value === `object` && `query` in value
        ? value.query
        : value
  if (query instanceof BaseQueryBuilder) {
    return collectSourceRefs(query._getQuery()).map((source) =>
      source.type === `descriptorRef`
        ? onUnboundDescriptor
          ? onUnboundDescriptor(source.alias)
          : requireCollectionSource(source)
        : source.collection,
    )
  }
  return isCollection(query) ? [query] : []
}

export function getPreparedLiveQueryIdentity(value: unknown): unknown {
  if (isCollection(value)) return [`collection`, value.id]
  if (value instanceof BaseQueryBuilder) {
    // A pooled query's fields and literals identify its rows without
    // canonicalizing its whole IR on every render.
    const pooled = getPooledQueryIdentity(value)
    return pooled === undefined
      ? [`query`, getStableQueryBuilderHash(value)]
      : [`pooled`, pooled]
  }
  if (value && typeof value === `object` && `query` in value) {
    const config = value as LiveQueryCollectionConfig<any>
    return [
      `config`,
      getPreparedLiveQueryIdentity(config.query),
      [`getKey`, config.getKey],
      [`schema`, config.schema],
      [`singleResult`, config.singleResult === true],
      [
        `defaultStringCollation`,
        getStringCollationIdentity(config.defaultStringCollation),
      ],
    ]
  }
  if (value === undefined || value === null) return [`disabled`]
  return [`value`, value]
}

export function getLiveQueryHash(
  preparedValue: unknown,
  queryKey?: LiveQueryKey,
): string {
  const identity = queryKey?.length
    ? [`queryKey`, queryKey]
    : isCollection(preparedValue)
      ? [`collection`, preparedValue.id]
      : [`derived`, getPreparedLiveQueryIdentity(preparedValue)]

  return getStableValueHash(identity, `queryKey`)
}

// A config that names only its query and lifetime describes the same live
// query as its builder. Any other option shapes its Collection, so compiles.
function poolConfig(
  config: LiveQueryCollectionConfig<any>,
  gcTime: number | undefined,
): Collection<any, any, any> | undefined {
  if (
    !(config.query instanceof BaseQueryBuilder) ||
    !Object.keys(config).every((key) => key === `query` || key === `gcTime`)
  ) {
    return undefined
  }
  return createPooledLiveQuery(config.query, {
    gcTime: config.gcTime ?? gcTime,
  })
}

/**
 * Resolve an adapter's query value to what its observer watches: `null` for a
 * disabled query, an existing Collection with sync started, or a live query.
 * A query builder whose shape a shared partition can serve gets a pooled view
 * instead of its own live-query Collection.
 */
export function resolveLiveQueryValue(
  value: unknown,
  {
    gcTime,
    pool = true,
    startSync = true,
  }: { gcTime?: number; pool?: boolean; startSync?: boolean } = {},
): Collection<any, any, any> | null {
  if (value === undefined || value === null) return null
  if (isCollection(value)) {
    value.startSyncImmediate()
    return value
  }
  if (value instanceof BaseQueryBuilder) {
    return (
      (pool ? createPooledLiveQuery(value, { gcTime }) : undefined) ??
      createLiveQueryCollection({ query: value, startSync, gcTime })
    )
  }
  if (typeof value === `object`) {
    const config = value as LiveQueryCollectionConfig<any>
    return (
      (pool ? poolConfig(config, gcTime) : undefined) ??
      createLiveQueryCollection({
        ...config,
        startSync: config.startSync ?? startSync,
        gcTime: config.gcTime ?? gcTime,
      })
    )
  }
  throw new Error(
    devBuild() && process.env.NODE_ENV !== `production`
      ? `A live query must be a QueryBuilder, LiveQueryCollectionConfig, Collection, undefined, or null. Got: ${typeof value}`
      : codedMessage(102, { type: typeof value }),
  )
}
