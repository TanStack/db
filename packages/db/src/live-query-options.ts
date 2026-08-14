import { BaseQueryBuilder } from './query/builder/index.js'
import { isCollection } from './live-query-adapter.js'
import {
  getStableQueryBuilderHash,
  getStableValueHash,
} from './query/ir-stable-identity.js'
import type { CollectionImpl } from './collection/index.js'
import type { CollectionOptionsIdentity } from './collection-options.js'
import type { CollectionOptions, DbClient } from './client.js'
import type {
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
} from './query/index.js'

export type LiveQueryKey = ReadonlyArray<unknown>

export type LiveQueryOptions = LiveQueryCollectionConfig<any> & {
  queryKey?: LiveQueryKey
}

export type DeferredLiveQueryCollections = Set<
  CollectionImpl<any, string | number, any, any, any>
>

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
    } = value as LiveQueryCollectionConfig<any> & {
      queryKey?: LiveQueryKey
      client?: DbClient
    }

    return {
      ...config,
      query:
        typeof query === `function`
          ? query(createInitialQueryBuilder(dbClient, deferredCollections))
          : query,
    }
  }

  return value
}

export function getPreparedLiveQueryIdentity(value: unknown): unknown {
  if (isCollection(value)) return [`collection`, value.id]
  if (value instanceof BaseQueryBuilder) {
    return [`query`, getStableQueryBuilderHash(value)]
  }
  if (value && typeof value === `object` && `query` in value) {
    const config = value as LiveQueryCollectionConfig<any>
    return [
      `config`,
      getPreparedLiveQueryIdentity(config.query),
      [`getKey`, config.getKey],
      [`schema`, config.schema],
      [`singleResult`, config.singleResult === true],
      [`defaultStringCollation`, config.defaultStringCollation],
    ]
  }
  if (value === undefined || value === null) return [`disabled`]
  return [`value`, value]
}

export function getLiveQueryHash(
  preparedValue: unknown,
  queryKey?: LiveQueryKey,
): string {
  const identity = queryKey
    ? [`queryKey`, queryKey]
    : isCollection(preparedValue)
      ? [`collection`, preparedValue.id]
      : [`derived`, getPreparedLiveQueryIdentity(preparedValue)]

  return getStableValueHash(identity, `queryKey`)
}
