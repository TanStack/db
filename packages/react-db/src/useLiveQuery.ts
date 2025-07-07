import { useRef, useSyncExternalStore } from "react"
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

  // Use refs to cache collection and track dependencies
  const collectionRef = useRef<any>(null)
  const depsRef = useRef<Array<unknown> | null>(null)
  const configRef = useRef<any>(null)

  // Check if we need to create/recreate the collection
  const needsNewCollection =
    !collectionRef.current ||
    (isCollection && configRef.current !== configOrQueryOrCollection) ||
    (!isCollection &&
      (depsRef.current === null ||
        depsRef.current.length !== deps.length ||
        depsRef.current.some((dep, i) => dep !== deps[i])))

  if (needsNewCollection) {
    if (isCollection) {
      // It's already a collection, ensure sync is started for React hooks
      configOrQueryOrCollection.startSyncImmediate()
      collectionRef.current = configOrQueryOrCollection
      configRef.current = configOrQueryOrCollection
    } else {
      // Original logic for creating collections
      // Ensure we always start sync for React hooks
      if (typeof configOrQueryOrCollection === `function`) {
        collectionRef.current = createLiveQueryCollection({
          query: configOrQueryOrCollection,
          startSync: true,
          gcTime: 0, // Live queries created by useLiveQuery are cleaned up immediately
        })
      } else {
        collectionRef.current = createLiveQueryCollection({
          startSync: true,
          gcTime: 0, // Live queries created by useLiveQuery are cleaned up immediately
          ...configOrQueryOrCollection,
        })
      }
      depsRef.current = [...deps]
    }
  }

  // Use refs to track version and memoized snapshot
  const versionRef = useRef(0)
  const snapshotRef = useRef<{
    state: Map<any, any>
    data: Array<any>
    collection: Collection<any, any, any>
    _version: number
  } | null>(null)

  // Reset refs when collection changes
  if (needsNewCollection) {
    versionRef.current = 0
    snapshotRef.current = null
  }

  // Create stable subscribe function using ref
  const subscribeRef = useRef<
    ((onStoreChange: () => void) => () => void) | null
  >(null)
  if (!subscribeRef.current || needsNewCollection) {
    subscribeRef.current = (onStoreChange: () => void) => {
      const unsubscribe = collectionRef.current!.subscribeChanges(() => {
        versionRef.current += 1
        onStoreChange()
      })
      return () => {
        unsubscribe()
      }
    }
  }

  // Create stable getSnapshot function using ref
  const getSnapshotRef = useRef<
    | (() => {
        state: Map<any, any>
        data: Array<any>
        collection: Collection<any, any, any>
      })
    | null
  >(null)
  if (!getSnapshotRef.current || needsNewCollection) {
    getSnapshotRef.current = () => {
      const currentVersion = versionRef.current
      const currentCollection = collectionRef.current!

      // If we don't have a snapshot or the version changed, create a new one
      if (
        !snapshotRef.current ||
        snapshotRef.current._version !== currentVersion
      ) {
        snapshotRef.current = {
          get state() {
            return new Map(currentCollection.entries())
          },
          get data() {
            return Array.from(currentCollection.values())
          },
          collection: currentCollection,
          _version: currentVersion,
        }
      }

      return snapshotRef.current
    }
  }

  // Use useSyncExternalStore to subscribe to collection changes
  const snapshot = useSyncExternalStore(
    subscribeRef.current,
    getSnapshotRef.current
  )

  return {
    state: snapshot.state,
    data: snapshot.data,
    collection: snapshot.collection,
  }
}
