import { useRef, useSyncExternalStore } from "react"
import {
  BaseQueryBuilder,
  CollectionImpl,
  createLiveQueryCollection,
} from "@tanstack/db"
import type {
  Collection,
  CollectionConfigSingleRowOption,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from "@tanstack/db"

const DEFAULT_GC_TIME_MS = 1 // Live queries created by useLiveSuspenseQuery are cleaned up immediately (0 disables GC)

/**
 * Create a live query with React Suspense support
 * @param queryFn - Query function that defines what data to fetch
 * @param deps - Array of dependencies that trigger query re-execution when changed
 * @returns Object with reactive data and state - data is guaranteed to be defined
 * @throws Promise when data is loading (caught by Suspense boundary)
 * @throws Error when collection fails (caught by Error boundary)
 * @example
 * // Basic usage with Suspense
 * function TodoList() {
 *   const { data } = useLiveSuspenseQuery((q) =>
 *     q.from({ todos: todosCollection })
 *      .where(({ todos }) => eq(todos.completed, false))
 *      .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 *   )
 *
 *   return (
 *     <ul>
 *       {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
 *     </ul>
 *   )
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       <TodoList />
 *     </Suspense>
 *   )
 * }
 *
 * @example
 * // Single result query
 * const { data } = useLiveSuspenseQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => eq(todos.id, 1))
 *          .findOne()
 * )
 * // data is guaranteed to be the single item (or undefined if not found)
 *
 * @example
 * // With dependencies that trigger re-suspension
 * const { data } = useLiveSuspenseQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority)),
 *   [minPriority] // Re-suspends when minPriority changes
 * )
 *
 * @example
 * // With Error boundary
 * function App() {
 *   return (
 *     <ErrorBoundary fallback={<div>Error loading data</div>}>
 *       <Suspense fallback={<div>Loading...</div>}>
 *         <TodoList />
 *       </Suspense>
 *     </ErrorBoundary>
 *   )
 * }
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 2: Accept config object
export function useLiveSuspenseQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 3: Accept pre-created live query collection
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult
): {
  state: Map<TKey, TResult>
  data: Array<TResult>
  collection: Collection<TResult, TKey, TUtils>
}

// Overload 4: Accept pre-created live query collection with singleResult: true
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult
): {
  state: Map<TKey, TResult>
  data: TResult | undefined
  collection: Collection<TResult, TKey, TUtils> & SingleResult
}

// Implementation - uses function overloads to infer the actual collection type
export function useLiveSuspenseQuery(
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
  const collectionRef = useRef<Collection<object, string | number, {}> | null>(
    null
  )
  const depsRef = useRef<Array<unknown> | null>(null)
  const configRef = useRef<unknown>(null)
  const promiseRef = useRef<Promise<void> | null>(null)

  // Use refs to track version and memoized snapshot
  const versionRef = useRef(0)
  const snapshotRef = useRef<{
    collection: Collection<object, string | number, {}>
    version: number
  } | null>(null)

  // Check if we need to create/recreate the collection
  const needsNewCollection =
    !collectionRef.current ||
    (isCollection && configRef.current !== configOrQueryOrCollection) ||
    (!isCollection &&
      (depsRef.current === null ||
        depsRef.current.length !== deps.length ||
        depsRef.current.some((dep, i) => dep !== deps[i])))

  if (needsNewCollection) {
    // Reset promise for new collection
    promiseRef.current = null

    if (isCollection) {
      // It's already a collection, ensure sync is started for React hooks
      configOrQueryOrCollection.startSyncImmediate()
      collectionRef.current = configOrQueryOrCollection
      configRef.current = configOrQueryOrCollection
    } else {
      // Handle different callback return types
      if (typeof configOrQueryOrCollection === `function`) {
        // Call the function with a query builder to see what it returns
        const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
        const result = configOrQueryOrCollection(queryBuilder)

        if (result === undefined || result === null) {
          // Suspense queries cannot be disabled - throw error
          throw new Error(
            `useLiveSuspenseQuery does not support returning undefined/null from query function. Use useLiveQuery instead for conditional queries.`
          )
        } else if (result instanceof CollectionImpl) {
          // Callback returned a Collection instance - use it directly
          result.startSyncImmediate()
          collectionRef.current = result
        } else if (result instanceof BaseQueryBuilder) {
          // Callback returned QueryBuilder - create live query collection using the original callback
          collectionRef.current = createLiveQueryCollection({
            query: configOrQueryOrCollection,
            startSync: true,
            gcTime: DEFAULT_GC_TIME_MS,
          })
        } else if (result && typeof result === `object`) {
          // Assume it's a LiveQueryCollectionConfig
          collectionRef.current = createLiveQueryCollection({
            startSync: true,
            gcTime: DEFAULT_GC_TIME_MS,
            ...result,
          })
        } else {
          // Unexpected return type
          throw new Error(
            `useLiveSuspenseQuery callback must return a QueryBuilder, LiveQueryCollectionConfig, or Collection. Got: ${typeof result}`
          )
        }
        depsRef.current = [...deps]
      } else {
        // Config object
        collectionRef.current = createLiveQueryCollection({
          startSync: true,
          gcTime: DEFAULT_GC_TIME_MS,
          ...configOrQueryOrCollection,
        })
        depsRef.current = [...deps]
      }
    }
  }

  // Reset refs when collection changes
  if (needsNewCollection) {
    versionRef.current = 0
    snapshotRef.current = null
  }

  const collection = collectionRef.current!

  // SUSPENSE LOGIC: Throw promise or error based on collection status
  if (collection.status === `error`) {
    // Clear promise and throw error to Error Boundary
    promiseRef.current = null
    throw new Error(`Collection "${collection.id}" failed to load`)
  }

  if (collection.status === `loading` || collection.status === `idle`) {
    // Create or reuse promise
    if (!promiseRef.current) {
      promiseRef.current = collection.preload()
    }
    // THROW PROMISE - React Suspense catches this (React 18+ compatible)
    throw promiseRef.current
  }

  // Collection is ready - clear promise
  if (collection.status === `ready`) {
    promiseRef.current = null
  }

  // Create stable subscribe function using ref
  const subscribeRef = useRef<
    ((onStoreChange: () => void) => () => void) | null
  >(null)
  if (!subscribeRef.current || needsNewCollection) {
    subscribeRef.current = (onStoreChange: () => void) => {
      const subscription = collection.subscribeChanges(() => {
        // Bump version on any change; getSnapshot will rebuild next time
        versionRef.current += 1
        onStoreChange()
      })
      // Collection is ready, trigger initial snapshot
      if (collection.status === `ready`) {
        versionRef.current += 1
        onStoreChange()
      }
      return () => {
        subscription.unsubscribe()
      }
    }
  }

  // Create stable getSnapshot function using ref
  const getSnapshotRef = useRef<
    | (() => {
        collection: Collection<object, string | number, {}>
        version: number
      })
    | null
  >(null)
  if (!getSnapshotRef.current || needsNewCollection) {
    getSnapshotRef.current = () => {
      const currentVersion = versionRef.current
      const currentCollection = collection

      // Recreate snapshot object only if version/collection changed
      if (
        !snapshotRef.current ||
        snapshotRef.current.version !== currentVersion ||
        snapshotRef.current.collection !== currentCollection
      ) {
        snapshotRef.current = {
          collection: currentCollection,
          version: currentVersion,
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

  // Track last snapshot (from useSyncExternalStore) and the returned value separately
  const returnedSnapshotRef = useRef<{
    collection: Collection<object, string | number, {}>
    version: number
  } | null>(null)
  // Keep implementation return loose to satisfy overload signatures
  const returnedRef = useRef<any>(null)

  // Rebuild returned object only when the snapshot changes (version or collection identity)
  if (
    !returnedSnapshotRef.current ||
    returnedSnapshotRef.current.version !== snapshot.version ||
    returnedSnapshotRef.current.collection !== snapshot.collection
  ) {
    // Capture a stable view of entries for this snapshot to avoid tearing
    const entries = Array.from(snapshot.collection.entries())
    const config: CollectionConfigSingleRowOption<any, any, any> =
      snapshot.collection.config
    const singleResult = config.singleResult
    let stateCache: Map<string | number, unknown> | null = null
    let dataCache: Array<unknown> | null = null

    returnedRef.current = {
      get state() {
        if (!stateCache) {
          stateCache = new Map(entries)
        }
        return stateCache
      },
      get data() {
        if (!dataCache) {
          dataCache = entries.map(([, value]) => value)
        }
        return singleResult ? dataCache[0] : dataCache
      },
      collection: snapshot.collection,
    }

    // Remember the snapshot that produced this returned value
    returnedSnapshotRef.current = snapshot
  }

  return returnedRef.current!
}
