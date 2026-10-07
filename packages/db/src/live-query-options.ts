import { BaseQueryBuilder } from './query/builder/index.js'
import { isCollection } from './live-query-adapter.js'
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

function createInitialQueryBuilder(
  dbClient: DbClient | undefined,
  deferredCollections: DeferredLiveQueryCollections,
): InitialQueryBuilder {
  return new BaseQueryBuilder(
    {},
    dbClient
      ? (
          options: CollectionOptionsIdentity<
            any,
            string | number,
            any,
            any,
            any
          >,
        ) => {
          const collection = dbClient._materializeCollectionForRender(
            options as CollectionOptions<any, string | number, any, any>,
          ) as CollectionImpl<any, string | number, any, any, any>
          if (collection._deferSyncStart()) deferredCollections.add(collection)
          return collection
        }
      : undefined,
  ) as InitialQueryBuilder
}

export function prepareLiveQueryValue(
  value: unknown,
  dbClient: DbClient | undefined,
  deferredCollections: DeferredLiveQueryCollections,
): unknown {
  if (typeof value === `function`) {
    return prepareLiveQueryValue(
      value(createInitialQueryBuilder(dbClient, deferredCollections)),
      dbClient,
      deferredCollections,
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

    const preparedQuery =
      typeof query === `function`
        ? query(createInitialQueryBuilder(dbClient, deferredCollections))
        : query

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

/**
 * Resolve an adapter's query value to what its observer watches: `null` for a
 * disabled query, an existing Collection with sync started, or a live query.
 * A query builder whose shape a shared partition can serve gets a pooled view
 * instead of its own live-query Collection.
 */
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
      createLiveQueryCollection({ startSync, gcTime, ...config })
    )
  }
  throw new Error(
    devBuild() && process.env.NODE_ENV !== `production` ? `A live query must be a QueryBuilder, LiveQueryCollectionConfig, Collection, undefined, or null. Got: ${typeof value}` : codedMessage(102, { type: typeof value }),
  )
}
