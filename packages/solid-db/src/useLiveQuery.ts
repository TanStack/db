import {
  batch,
  createComputed,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js"
import { ReactiveMap } from "@solid-primitives/map"
import { CollectionImpl, createLiveQueryCollection } from "@tanstack/db"
import { createStore, reconcile } from "solid-js/store"
import type { Accessor } from "solid-js"
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
 *          .where(({ todos }) => gt(todos.priority, minPriority())),
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
 *   <Switch>
 *     <Match when={todosQuery.isLoading()}>
 *       <div>Loading...</div>
 *     </Match>
 *     <Match when={todosQuery.isError()}>
 *       <div>Error: {todosQuery.status()}</div>
 *     </Match>
 *     <Match when={todosQuery.isReady()}>
 *       <For each={todosQuery.data()}>
 *         {(todo) => <li key={todo.id}>{todo.text}</li>}
 *       </For>
 *     </Match>
 *   </Switch>
 * )
 */
// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): {
  state: ReactiveMap<string | number, GetResult<TContext>>
  data: Array<GetResult<TContext>>
  collection: Accessor<Collection<GetResult<TContext>, string | number, {}>>
  status: Accessor<CollectionStatus>
  isLoading: Accessor<boolean>
  isReady: Accessor<boolean>
  isIdle: Accessor<boolean>
  isError: Accessor<boolean>
  isCleanedUp: Accessor<boolean>
}

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @returns Object with reactive data, state, and status information
 * @example
 * // Basic config object usage
 * const todosQuery = useLiveQuery(() => ({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * }))
 *
 * @example
 * // With query builder and options
 * const queryBuilder = new Query()
 *   .from({ persons: collection })
 *   .where(({ persons }) => gt(persons.age, 30))
 *   .select(({ persons }) => ({ id: persons.id, name: persons.name }))
 *
 * const personsQuery = useLiveQuery(() => ({ query: queryBuilder }))
 *
 * @example
 * // Handle all states uniformly
 * const itemsQuery = useLiveQuery(() => ({
 *   query: (q) => q.from({ items: itemCollection })
 * }))
 *
 * return (
 *   <Switch fallback={<div>{itemsQuery.data.length} items loaded</div>}>
 *     <Match when={itemsQuery.isLoading()}>
 *       <div>Loading...</div>
 *     </Match>
 *     <Match when={itemsQuery.isError()}>
 *       <div>Something went wrong</div>
 *     </Match>
 *     <Match when={!itemsQuery.isReady()}>
 *       <div>Preparing...</div>
 *     </Match>
 *   </Switch>
 * )
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: Accessor<LiveQueryCollectionConfig<TContext>>
): {
  state: ReactiveMap<string | number, GetResult<TContext>>
  data: Array<GetResult<TContext>>
  collection: Accessor<Collection<GetResult<TContext>, string | number, {}>>
  status: Accessor<CollectionStatus>
  isLoading: Accessor<boolean>
  isReady: Accessor<boolean>
  isIdle: Accessor<boolean>
  isError: Accessor<boolean>
  isCleanedUp: Accessor<boolean>
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
 * const todosQuery = useLiveQuery(() => myLiveQuery)
 *
 * @example
 * // Access collection methods directly
 * const existingQuery = useLiveQuery(() => existingCollection)
 *
 * // Use collection for mutations
 * const handleToggle = (id) => {
 *   existingQuery.collection().update(id, draft => { draft.completed = !draft.completed })
 * }
 *
 * @example
 * // Handle states consistently
 * const sharedQuery = useLiveQuery(() => sharedCollection)
 *
 * return (
 *  <Switch fallback={<div><For each={sharedQuery.data()}>{(item) => <Item key={item.id} {...item} />}</For></div>}>
 *    <Match when={sharedQuery.isLoading()}>
 *      <div>Loading...</div>
 *    </Match>
 *    <Match when={sharedQuery.isError()}>
 *      <div>Error loading data</div>
 *    </Match>
 *  </Switch>
 * )
 */
// Overload 3: Accept pre-created live query collection
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Accessor<Collection<TResult, TKey, TUtils>>
): {
  state: ReactiveMap<TKey, TResult>
  data: Array<TResult>
  collection: Accessor<Collection<TResult, TKey, TUtils>>
  status: Accessor<CollectionStatus>
  isLoading: Accessor<boolean>
  isReady: Accessor<boolean>
  isIdle: Accessor<boolean>
  isError: Accessor<boolean>
  isCleanedUp: Accessor<boolean>
}

// Implementation - use function overloads to infer the actual collection type
export function useLiveQuery(
  configOrQueryOrCollection: (queryFn?: any) => any
) {
  const collection = createMemo(
    () => {
      if (configOrQueryOrCollection.length === 1) {
        return createLiveQueryCollection({
          query: configOrQueryOrCollection,
          startSync: true,
        })
      }

      const innerCollection = configOrQueryOrCollection()
      if (innerCollection instanceof CollectionImpl) {
        innerCollection.startSyncImmediate()
        return innerCollection as Collection
      }

      return createLiveQueryCollection({
        ...innerCollection,
        startSync: true,
      })
    },
    undefined,
    { name: `TanstackDBCollectionMemo` }
  )

  // Reactive state that gets updated granularly through change events
  const state = new ReactiveMap<string | number, any>()

  // Reactive data array that maintains sorted order
  const [data, setData] = createStore<Array<any>>([], {
    name: `TanstackDBData`,
  })

  // Track collection status reactively
  const [status, setStatus] = createSignal(collection().status, {
    name: `TanstackDBStatus`,
  })

  // Helper to sync data array from collection in correct order
  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>
  ) => {
    setData((prev) =>
      reconcile(Array.from(currentCollection.values()))(prev).filter(Boolean)
    )
  }

  // Track current unsubscribe function
  let currentUnsubscribe: (() => void) | null = null

  createComputed(
    () => {
      const currentCollection = collection()

      // Update status ref whenever the effect runs
      setStatus(currentCollection.status)

      // Initialize state with current collection data
      state.clear()
      for (const [key, value] of currentCollection.entries()) {
        state.set(key, value)
      }

      // Initialize data array in correct order
      syncDataFromCollection(currentCollection)

      // Subscribe to collection changes with granular updates
      currentUnsubscribe = currentCollection.subscribeChanges(
        (changes: Array<ChangeMessage<any>>) => {
          // Apply each change individually to the reactive state
          batch(() => {
            for (const change of changes) {
              switch (change.type) {
                case `insert`:
                case `update`:
                  state.set(change.key, change.value)
                  break
                case `delete`:
                  state.delete(change.key)
                  break
              }
            }
          })

          // Update the data array to maintain sorted order
          syncDataFromCollection(currentCollection)

          // Update status ref on every change
          setStatus(currentCollection.status)
        }
      )

      // Preload collection data if not already started
      if (currentCollection.status === `idle`) {
        createResource(() => currentCollection.preload())
      }

      // Cleanup when computed is invalidated
      onCleanup(() => {
        if (currentUnsubscribe) {
          currentUnsubscribe()
          currentUnsubscribe = null
        }
      })
    },
    undefined,
    { name: `TanstackDBSyncComputed` }
  )

  return {
    state,
    data,
    collection,
    status,
    isLoading: () => status() === `loading` || status() === `initialCommit`,
    isReady: () => status() === `ready`,
    isIdle: () => status() === `idle`,
    isError: () => status() === `error`,
    isCleanedUp: () => status() === `cleaned-up`,
  }
}
