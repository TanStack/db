import { useRef, useSyncExternalStore } from "react"
import { createLiveQueryCollection } from "@tanstack/db"
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"

/**
 * Create a live query using a query function
 * @param queryFn - Query function that defines what data to fetch
 * @param deps - Array of dependencies that trigger query re-execution when changed
 * @returns Object with reactive data, state, and status information
 * @example
 * // Basic query with object syntax
 * const { data, isLoading } = useLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 *    .where(({ todos }) => eq(todos.completed, false))
 *    .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * )
 *
 * @example
 * // With dependencies that trigger re-execution
 * const { data, state } = useLiveQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority)),
 *   [minPriority] // Re-run when minPriority changes
 * )
 *
 * @example
 * // Join pattern
 * const { data } = useLiveQuery((q) =>
 *   q.from({ issues: issueCollection })
 *    .join({ persons: personCollection }, ({ issues, persons }) =>
 *      eq(issues.userId, persons.id)
 *    )
 *    .select(({ issues, persons }) => ({
 *      id: issues.id,
 *      title: issues.title,
 *      userName: persons.name
 *    }))
 * )
 *
 * @example
 * // Handle loading and error states
 * const { data, isLoading, isError, status } = useLiveQuery((q) =>
 *   q.from({ todos: todoCollection })
 * )
 *
 * if (isLoading) return <div>Loading...</div>
 * if (isError) return <div>Error: {status}</div>
 *
 * return (
 *   <ul>
 *     {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
 *   </ul>
 * )
 */
// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: Array<GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @param deps - Array of dependencies that trigger query re-execution when changed
 * @returns Object with reactive data, state, and status information
 * @example
 * // Basic config object usage
 * const { data, status } = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * })
 *
 * @example
 * // With query builder and options
 * const queryBuilder = new Query()
 *   .from({ persons: collection })
 *   .where(({ persons }) => gt(persons.age, 30))
 *   .select(({ persons }) => ({ id: persons.id, name: persons.name }))
 *
 * const { data, isReady } = useLiveQuery({ query: queryBuilder })
 *
 * @example
 * // Handle all states uniformly
 * const { data, isLoading, isReady, isError } = useLiveQuery({
 *   query: (q) => q.from({ items: itemCollection })
 * })
 *
 * if (isLoading) return <div>Loading...</div>
 * if (isError) return <div>Something went wrong</div>
 * if (!isReady) return <div>Preparing...</div>
 *
 * return <div>{data.length} items loaded</div>
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: Array<GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

/**
 * Subscribe to an existing live query collection
 * @param liveQueryCollection - Pre-created live query collection to subscribe to
 * @returns Object with reactive data, state, and status information
 * @example
 * // Using pre-created live query collection
 * const myLiveQuery = createLiveQueryCollection((q) =>
 *   q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
 * )
 * const { data, collection } = useLiveQuery(myLiveQuery)
 *
 * @example
 * // Access collection methods directly
 * const { data, collection, isReady } = useLiveQuery(existingCollection)
 *
 * // Use collection for mutations
 * const handleToggle = (id) => {
 *   collection.update(id, draft => { draft.completed = !draft.completed })
 * }
 *
 * @example
 * // Handle states consistently
 * const { data, isLoading, isError } = useLiveQuery(sharedCollection)
 *
 * if (isLoading) return <div>Loading...</div>
 * if (isError) return <div>Error loading data</div>
 *
 * return <div>{data.map(item => <Item key={item.id} {...item} />)}</div>
 */
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
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
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
    status: snapshot.collection.status,
    isLoading:
      snapshot.collection.status === `loading` ||
      snapshot.collection.status === `initialCommit`,
    isReady: snapshot.collection.status === `ready`,
    isIdle: snapshot.collection.status === `idle`,
    isError: snapshot.collection.status === `error`,
    isCleanedUp: snapshot.collection.status === `cleaned-up`,
  }
}
