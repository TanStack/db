import {
  batch,
  createEffect,
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
 * @returns Accessor that returns data with Suspense support, with state and status infomation as properties
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
 *     <Match when={todosQuery.isLoading}>
 *       <div>Loading...</div>
 *     </Match>
 *     <Match when={todosQuery.isError}>
 *       <div>Error: {todosQuery.status()}</div>
 *     </Match>
 *     <Match when={todosQuery.isReady}>
 *       <For each={todosQuery()}>
 *         {(todo) => <li key={todo.id}>{todo.text}</li>}
 *       </For>
 *     </Match>
 *   </Switch>
 * )
 *
 * @example
 * // Use Suspense boundaries
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todoCollection })
 * )
 *
 * return (
 *   <Suspense fallback={<div>Loading...</div>}>
 *     <For each={todosQuery()}>
 *       {(todo) => <li key={todo.id}>{todo.text}</li>}
 *     </For>
 *   </Suspense>
 * )
 */
// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): Accessor<Array<GetResult<TContext>>> & {
  state: ReactiveMap<string | number, GetResult<TContext>>
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
 * @returns Accessor that returns data with Suspense support, with state and status infomation as properties
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
 *   <Switch fallback={<div>{itemsQuery().length} items loaded</div>}>
 *     <Match when={itemsQuery.isLoading}>
 *       <div>Loading...</div>
 *     </Match>
 *     <Match when={itemsQuery.isError}>
 *       <div>Something went wrong</div>
 *     </Match>
 *     <Match when={!itemsQuery.isReady}>
 *       <div>Preparing...</div>
 *     </Match>
 *   </Switch>
 * )
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: Accessor<LiveQueryCollectionConfig<TContext>>
): Accessor<Array<GetResult<TContext>>> & {
  state: ReactiveMap<string | number, GetResult<TContext>>
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
 * @returns Accessor that returns data with Suspense support, with state and status infomation as properties
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
 *   existingQuery.collection.update(id, draft => { draft.completed = !draft.completed })
 * }
 *
 * @example
 * // Handle states consistently
 * const sharedQuery = useLiveQuery(() => sharedCollection)
 *
 * return (
 *  <Switch fallback={<div><For each={sharedQuery()}>{(item) => <Item key={item.id} {...item} />}</For></div>}>
 *    <Match when={sharedQuery.isLoading}>
 *      <div>Loading...</div>
 *    </Match>
 *    <Match when={sharedQuery.isError}>
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
): Accessor<Array<TResult>> & {
  state: ReactiveMap<TKey, TResult>
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

  const [getDataResource] = createResource(
    () => ({ currentCollection: collection() }),
    async ({ currentCollection }) => {
      setStatus(currentCollection.status)
      await currentCollection.toArrayWhenReady()
      // Initialize state with current collection data
      batch(() => {
        state.clear()
        for (const [key, value] of currentCollection.entries()) {
          state.set(key, value)
        }
        syncDataFromCollection(currentCollection)
        setStatus(currentCollection.status)
      })
      return data
    },
    {
      name: `TanstackDBData`,
      deferStream: false,
      initialValue: data,
    }
  )

  createEffect(() => {
    const currentCollection = collection()
    const subscription = currentCollection.subscribeChanges(
      // Changes is fine grained, so does not work great with an array
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

          syncDataFromCollection(currentCollection)

          // Update status ref on every change
          setStatus(currentCollection.status)
        })
      },
      {
        includeInitialState: true,
      }
    )

    onCleanup(() => {
      subscription.unsubscribe()
    })
  })

  // We have to remove getters from the resource function so we wrap it
  function getData() {
    return getDataResource()
  }

  Object.defineProperties(getData, {
    status: {
      get() {
        return status()
      },
    },
    collection: {
      get() {
        return collection()
      },
    },
    state: {
      get() {
        return state
      },
    },
    isLoading: {
      get() {
        return status() === `loading`
      },
    },
    isReady: {
      get() {
        return status() === `ready`
      },
    },
    isIdle: {
      get() {
        return status() === `idle`
      },
    },
    isError: {
      get() {
        return status() === `error`
      },
    },
    isCleanedUp: {
      get() {
        return status() === `cleaned-up`
      },
    },
  })
  return getData
}
