import { useEffect, useMemo, useState } from "react"
import { createLiveQueryCollection } from "@tanstack/db"
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

  const collection = useMemo(
    () => {
      if (isCollection) {
        // It's already a collection, ensure sync is started for React hooks
        configOrQueryOrCollection.startSyncImmediate()
        return configOrQueryOrCollection
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
    isCollection ? [configOrQueryOrCollection] : [...deps]
  )

  // Infer types from the actual collection
  type CollectionType =
    typeof collection extends Collection<infer T, any, any> ? T : never
  type KeyType =
    typeof collection extends Collection<any, infer K, any>
      ? K
      : string | number

  // Use a simple counter to force re-renders when collection changes
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    // Subscribe to changes and force re-render
    const unsubscribe = collection.subscribeChanges(() => {
      forceUpdate((prev) => prev + 1)
    })

    return unsubscribe
  }, [collection])

  return {
    get state(): Map<KeyType, CollectionType> {
      return new Map(collection.entries())
    },
    get data(): Array<CollectionType> {
      return Array.from(collection.values())
    },
    collection,
  }
}
