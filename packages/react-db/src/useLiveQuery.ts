import { useEffect, useMemo, useState } from "react"
import { BaseQueryBuilder, createLiveQueryCollection } from "@tanstack/db"
import type {
  Collection,
  Context,
  GetResult,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"

// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: Array<GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: Array<GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 3: Accept pre-created live query collection
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils>
): {
  state: Map<TKey, TResult>
  data: Array<TResult>
  collection: Collection<TResult, TKey, TUtils>
}

// Overload 4: Accept a predefined QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryBuilder: QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: Array<GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Implementation - use function overloads to infer the actual collection type
export function useLiveQuery(
  configOrQueryOrCollection: any,
  deps: Array<unknown> = []
) {
  // Check if it's already a collection by checking for specific collection methods
  const isCollection =
    configOrQueryOrCollection &&
    typeof configOrQueryOrCollection === `object` &&
    typeof configOrQueryOrCollection.subscribeChanges === `function` &&
    typeof configOrQueryOrCollection.startSyncImmediate === `function` &&
    typeof configOrQueryOrCollection.id === `string`

  // Check if it's a QueryBuilder instance
  const isQueryBuilder = configOrQueryOrCollection instanceof BaseQueryBuilder

  const collection = useMemo(
    () => {
      if (isCollection) {
        // It's already a collection, ensure sync is started for React hooks
        configOrQueryOrCollection.startSyncImmediate()
        return configOrQueryOrCollection
      }

      if (isQueryBuilder) {
        // It's a predefined QueryBuilder, create a live query collection from it
        const queryBuilderCollection = createLiveQueryCollection(
          configOrQueryOrCollection as QueryBuilder<any>
        )
        queryBuilderCollection.startSyncImmediate()
        return queryBuilderCollection
      }

      // Original logic for creating collections
      // Ensure we always start sync for React hooks
      if (typeof configOrQueryOrCollection === `function`) {
        return createLiveQueryCollection({
          query: configOrQueryOrCollection,
          startSync: true,
        })
      } else {
        return createLiveQueryCollection({
          ...configOrQueryOrCollection,
          startSync: true,
        })
      }
    },
    isCollection
      ? [configOrQueryOrCollection]
      : isQueryBuilder
        ? [configOrQueryOrCollection, ...deps]
        : [...deps]
  )

  // Infer types from the actual collection
  type CollectionType =
    typeof collection extends Collection<infer T, any, any> ? T : never
  type KeyType =
    typeof collection extends Collection<any, infer K, any>
      ? K
      : string | number

  const [state, setState] = useState<Map<KeyType, CollectionType>>(
    () => new Map(collection.entries())
  )
  const [data, setData] = useState<Array<CollectionType>>(() =>
    Array.from(collection.values())
  )

  useEffect(() => {
    // Update initial state in case collection has data
    setState(new Map(collection.entries()))
    setData(Array.from(collection.values()))

    // Subscribe to changes and update state
    const unsubscribe = collection.subscribeChanges(() => {
      setState(new Map(collection.entries()))
      setData(Array.from(collection.values()))
    })

    return unsubscribe
  }, [collection])

  return {
    state,
    data,
    collection: collection,
  }
}
