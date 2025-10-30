import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import type { Collection, CollectionStatus } from '@tanstack/db'
import type { QueryCollectionConfig, QueryCollectionUtils } from '@tanstack/query-db-collection'
import type { QueryObserverResult } from '@tanstack/query-core'

export type UseCollectionStatus = CollectionStatus | 'disabled'

/**
 * Result type returned by useCollection
 */
export interface UseCollectionResult<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>
> {
  /** Map of items keyed by their ID */
  state: Map<TKey, T>
  /** Array of items (or single item if singleResult is true) */
  data: T[]
  /** The collection instance */
  collection: Collection<T, TKey, TUtils>
  /** Current status of the collection */
  status: CollectionStatus
  /** True if collection is loading */
  isLoading: boolean
  /** True if collection is ready */
  isReady: boolean
  /** True if collection is idle */
  isIdle: boolean
  /** True if collection is in error state */
  isError: boolean
  /** True if collection has been cleaned up */
  isCleanedUp: boolean
  /** True if collection is enabled (always true for non-nullable returns) */
  isEnabled: true
  /** Collection-specific utility functions */
  utils: TUtils
}

/**
 * Result type when collection might be disabled (null/undefined)
 */
export interface UseCollectionDisabledResult {
  state: undefined
  data: undefined
  collection: undefined
  status: 'disabled'
  isLoading: false
  isReady: false
  isIdle: false
  isError: false
  isCleanedUp: false
  isEnabled: false
  utils: undefined
}

/**
 * Helper to detect if value is a pre-created collection
 */
function isCollection(value: any): value is Collection<any, any, any> {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.subscribeChanges === 'function' &&
    typeof value.startSyncImmediate === 'function' &&
    typeof value.id === 'string'
  )
}

/**
 * Helper to detect if config is a QueryCollectionConfig
 */
function isQueryCollectionConfig(config: any): config is QueryCollectionConfig<any> {
  return (
    config &&
    typeof config === 'object' &&
    'queryClient' in config &&
    'queryKey' in config &&
    'queryFn' in config &&
    'getKey' in config
  )
}

/**
 * A hook that creates and subscribes to a collection with automatic queryFn ref handling.
 *
 * This hook solves the closure capture problem when using dynamic data sources (like
 * useQueries results) in a collection's queryFn. It automatically keeps the queryFn
 * reference fresh while maintaining a stable collection instance.
 *
 * @template T - The type of items in the collection
 * @template TKey - The type of keys (string | number)
 * @template TUtils - The type of collection-specific utilities
 *
 * @param configOrCollection - Either a QueryCollectionConfig or a pre-created Collection
 * @param deps - Array of dependencies that trigger refetch (for QueryCollections)
 *
 * @example
 * // Combining multiple query results
 * const queryResults = useQueries({ queries })
 * const { data, isReady, collection } = useCollection(
 *   queryCollectionOptions({
 *     queryKey: ['combined', 'roles'],
 *     queryFn: async () => queryResults.flatMap(q => q.data ?? []),
 *     queryClient,
 *     getKey: role => role.id
 *   }),
 *   [queryResults] // Refetch when queryResults change
 * )
 *
 * @example
 * // Using a pre-created collection
 * const myCollection = useMemo(() => createCollection(...), [])
 * const { data, isReady } = useCollection(myCollection)
 *
 * @example
 * // With refetch control
 * const { collection } = useCollection(config, [deps])
 * useEffect(() => {
 *   if (shouldRefetch) {
 *     collection.utils.refetch?.()
 *   }
 * }, [shouldRefetch])
 */

// Overload 1: For pre-created collections (always enabled)
export function useCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>
>(
  collection: Collection<T, TKey, TUtils>
): UseCollectionResult<T, TKey, TUtils>

// Overload 2: For QueryCollectionConfig (always enabled)
export function useCollection<
  T extends object,
  TKey extends string | number = string | number
>(
  config: QueryCollectionConfig<T, any, any, any, TKey>,
  deps?: Array<unknown>
): UseCollectionResult<T, TKey, QueryCollectionUtils<T, TKey>>

// Overload 3: For nullable QueryCollectionConfig (can be disabled)
export function useCollection<
  T extends object,
  TKey extends string | number = string | number
>(
  config: QueryCollectionConfig<T, any, any, any, TKey> | null | undefined,
  deps?: Array<unknown>
): UseCollectionResult<T, TKey, QueryCollectionUtils<T, TKey>> | UseCollectionDisabledResult

// Implementation
export function useCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>
>(
  configOrCollection: QueryCollectionConfig<T, any, any, any, TKey> | Collection<T, TKey, TUtils> | null | undefined,
  deps: Array<unknown> = []
): UseCollectionResult<T, TKey, TUtils> | UseCollectionDisabledResult {

  // Handle disabled case
  if (configOrCollection === null || configOrCollection === undefined) {
    return {
      state: undefined,
      data: undefined,
      collection: undefined,
      status: 'disabled',
      isLoading: false,
      isReady: false,
      isIdle: false,
      isError: false,
      isCleanedUp: false,
      isEnabled: false,
      utils: undefined,
    }
  }

  const isPreCreatedCollection = isCollection(configOrCollection)

  // Store config in ref for query collections (updates every render)
  const configRef = useRef<QueryCollectionConfig<T, any, any, any, TKey>>()
  if (!isPreCreatedCollection && isQueryCollectionConfig(configOrCollection)) {
    configRef.current = configOrCollection
  }

  // Track collection instance
  const collectionRef = useRef<Collection<T, TKey, TUtils> | null>(null)

  // Track dependencies for query collections
  const depsRef = useRef<Array<unknown> | null>(null)

  // Track version for subscription
  const versionRef = useRef(0)

  // Determine if we need to create/recreate the collection
  const needsNewCollection =
    !collectionRef.current ||
    (isPreCreatedCollection && collectionRef.current !== configOrCollection) ||
    (!isPreCreatedCollection &&
      (depsRef.current === null ||
        depsRef.current.length !== deps.length ||
        depsRef.current.some((dep, i) => dep !== deps[i])))

  // Create or update collection
  if (needsNewCollection) {
    if (isPreCreatedCollection) {
      // Use pre-created collection
      configOrCollection.startSyncImmediate()
      collectionRef.current = configOrCollection as Collection<T, TKey, TUtils>
    } else if (isQueryCollectionConfig(configOrCollection)) {
      // Create query collection with wrapper queryFn that reads from ref
      const config = configOrCollection
      const wrappedConfig = {
        ...config,
        // Wrapper queryFn always reads from ref to get latest closure variables
        queryFn: async (context: any) => {
          if (!configRef.current) {
            throw new Error('useCollection: configRef.current is undefined')
          }
          return configRef.current.queryFn(context)
        },
        // Start sync immediately
        startSync: true,
      }

      collectionRef.current = createCollection(
        queryCollectionOptions(wrappedConfig)
      ) as Collection<T, TKey, TUtils>
    } else {
      throw new Error('useCollection: Invalid input type. Must be a Collection or QueryCollectionConfig.')
    }

    // Update deps tracking
    depsRef.current = [...deps]

    // Reset version
    versionRef.current = 0
  }

  const collection = collectionRef.current!

  // Subscribe to collection changes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!collection) return () => {}

      const subscription = collection.subscribeChanges(() => {
        versionRef.current += 1
        onStoreChange()
      })

      // Handle already-ready collections
      if (collection.status === 'ready') {
        versionRef.current += 1
        onStoreChange()
      }

      return () => {
        subscription.unsubscribe()
      }
    },
    [collection]
  )

  const getSnapshot = useCallback(() => {
    return {
      collection,
      version: versionRef.current,
    }
  }, [collection])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  // Watch dependencies and trigger refetch for query collections
  const depsHash = JSON.stringify(deps)
  const prevDepsHashRef = useRef(depsHash)

  useEffect(() => {
    // Skip on first render
    if (prevDepsHashRef.current === depsHash) {
      prevDepsHashRef.current = depsHash
      return
    }

    prevDepsHashRef.current = depsHash

    // Only refetch if collection has a refetch utility (QueryCollections)
    const utils = collection.utils as any
    if (utils && typeof utils.refetch === 'function') {
      utils.refetch().catch((error: Error) => {
        console.error('useCollection: refetch failed', error)
      })
    }
  }, [depsHash, collection])

  // Build return object
  const entries = Array.from(collection.entries())
  const state = new Map(entries)
  const data = entries.map(([, value]) => value)
  const status = collection.status

  return {
    state,
    data,
    collection,
    status,
    isLoading: status === 'loading',
    isReady: status === 'ready',
    isIdle: status === 'idle',
    isError: status === 'error',
    isCleanedUp: status === 'cleaned-up',
    isEnabled: true,
    utils: collection.utils,
  }
}
