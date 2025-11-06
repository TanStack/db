import { useComputed, useSignal, useSignalEffect } from "@preact/signals"
import { useMemo, useRef } from "preact/hooks"
import { CollectionImpl, createLiveQueryCollection } from "@tanstack/db"
import type { Signal } from "@preact/signals"
import type {
  ChangeMessage,
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
 * @returns Object with reactive data, state, and status information
 * @example
 * // Basic query with object syntax
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 *    .where(({ todos }) => eq(todos.completed, false))
 *    .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * )
 *
 * @example
 * // With dependencies that trigger re-execution
 * const todosQuery = useLiveQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority.value)),
 * )
 *
 * @example
 * // Join pattern
 * const personIssues = useLiveQuery((q) =>
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
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todoCollection })
 * )
 *
 * return (
 *   <>
 *     {todosQuery.isLoading.value && <div>Loading...</div>}
 *     {todosQuery.isError.value && <div>Error: {todosQuery.status.value}</div>}
 *     {todosQuery.isReady.value && (
 *       <ul>
 *         {todosQuery.data.value.map(todo => <li key={todo.id}>{todo.text}</li>)}
 *       </ul>
 *     )}
 *   </>
 * )
 */
// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): {
  state: Signal<Map<string | number, GetResult<TContext>>>
  data: Signal<Array<GetResult<TContext>>>
  collection: Signal<Collection<GetResult<TContext>, string | number, {}>>
  status: Signal<CollectionStatus>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @returns Object with reactive data, state, and status information
 * @example
 * // Basic config object usage
 * const todosQuery = useLiveQuery({
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
 * const personsQuery = useLiveQuery({ query: queryBuilder })
 *
 * @example
 * // Handle all states uniformly
 * const itemsQuery = useLiveQuery({
 *   query: (q) => q.from({ items: itemCollection })
 * })
 *
 * return (
 *   <>
 *     {itemsQuery.isLoading.value && <div>Loading...</div>}
 *     {itemsQuery.isError.value && <div>Something went wrong</div>}
 *     {!itemsQuery.isReady.value && <div>Preparing...</div>}
 *     {itemsQuery.isReady.value && <div>{itemsQuery.data.value.length} items loaded</div>}
 *   </>
 * )
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>
): {
  state: Signal<Map<string | number, GetResult<TContext>>>
  data: Signal<Array<GetResult<TContext>>>
  collection: Signal<Collection<GetResult<TContext>, string | number, {}>>
  status: Signal<CollectionStatus>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
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
 * const todosQuery = useLiveQuery(myLiveQuery)
 *
 * @example
 * // Access collection methods directly
 * const existingQuery = useLiveQuery(existingCollection)
 *
 * // Use collection for mutations
 * const handleToggle = (id) => {
 *   existingQuery.collection.value.update(id, draft => { draft.completed = !draft.completed })
 * }
 *
 * @example
 * // Handle states consistently
 * const sharedQuery = useLiveQuery(sharedCollection)
 *
 * return (
 *   <>
 *     {sharedQuery.isLoading.value && <div>Loading...</div>}
 *     {sharedQuery.isError.value && <div>Error loading data</div>}
 *     {sharedQuery.isReady.value && (
 *       <div>{sharedQuery.data.value.map(item => <Item key={item.id} {...item} />)}</div>
 *     )}
 *   </>
 * )
 */
// Overload 3: Accept pre-created live query collection
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils>
): {
  state: Signal<Map<TKey, TResult>>
  data: Signal<Array<TResult>>
  collection: Signal<Collection<TResult, TKey, TUtils>>
  status: Signal<CollectionStatus>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}

// Implementation - use function overloads to infer the actual collection type
export function useLiveQuery(configOrQueryOrCollection: any) {
  // Determine if it's a function (query), config object, or pre-created collection
  const isFunction = typeof configOrQueryOrCollection === `function`
  const isCollection =
    configOrQueryOrCollection instanceof CollectionImpl ||
    (configOrQueryOrCollection &&
      typeof configOrQueryOrCollection.subscribeChanges === `function`)

  // Create or reference the collection using useMemo for stability
  const collection = useMemo(() => {
    if (isCollection) {
      // It's already a collection
      const coll = configOrQueryOrCollection as Collection
      coll.startSyncImmediate()
      return coll
    } else if (isFunction) {
      // It's a query function
      return createLiveQueryCollection({
        query: configOrQueryOrCollection,
        startSync: true,
      })
    } else {
      // It's a config object
      return createLiveQueryCollection({
        ...configOrQueryOrCollection,
        startSync: true,
      })
    }
  }, [configOrQueryOrCollection])

  // Create signals for reactive state
  const state = useSignal<Map<string | number, any>>(new Map())
  const data = useSignal<Array<any>>([])
  const status = useSignal<CollectionStatus>(collection.status)

  // Create computed signals for status flags
  const isLoading = useComputed(() => status.value === `loading`)
  const isReady = useComputed(() => status.value === `ready`)
  const isIdle = useComputed(() => status.value === `idle`)
  const isError = useComputed(() => status.value === `error`)
  const isCleanedUp = useComputed(() => status.value === `cleaned-up`)

  // Track subscription for cleanup
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)

  // Subscribe to collection changes using useSignalEffect
  useSignalEffect(() => {
    // Clean up previous subscription if any
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
    }

    // Update status
    status.value = collection.status

    // Initialize state with current collection data
    const newState = new Map<string | number, any>()
    for (const [key, value] of collection.entries()) {
      newState.set(key, value)
    }
    state.value = newState

    // Subscribe to collection changes
    subscriptionRef.current = collection.subscribeChanges(
      (changes: Array<ChangeMessage<any>>) => {
        // Create a new Map to trigger reactivity
        const updatedState = new Map(state.value)

        // Apply each change
        for (const change of changes) {
          switch (change.type) {
            case `insert`:
            case `update`:
              updatedState.set(change.key, change.value)
              break
            case `delete`:
              updatedState.delete(change.key)
              break
          }
        }

        // Update state signal
        state.value = updatedState

        // Update data array to maintain order from collection
        data.value = Array.from(collection.values())

        // Update status
        status.value = collection.status
      },
      {
        includeInitialState: true,
      }
    )

    // Cleanup function
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  })

  // Create a stable signal reference for the collection
  const collectionSignal = useSignal(collection)

  return {
    state,
    data,
    collection: collectionSignal,
    status,
    isLoading,
    isReady,
    isIdle,
    isError,
    isCleanedUp,
  }
}
