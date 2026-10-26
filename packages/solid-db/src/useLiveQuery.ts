import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js'
import { ReactiveMap } from '@solid-primitives/map'
import {
  BaseQueryBuilder,
  createLiveQueryObserver,
  getPublicCollection,
  isCollection,
  isSingleResultCollection,
  resolveLiveQueryValue,
  toBoundaryError,
} from '@tanstack/db'
import { createStore, reconcile } from 'solid-js/store'
import type { Accessor } from 'solid-js'
import type {
  ChangeMessage,
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  HealthNode,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  LiveQueryObserver,
  LiveQueryStatusFlags,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

const DEFAULT_GC_TIME_MS = 1

type InferConditionalResultType<TContext extends Context> =
  TContext extends SingleResult
    ? InferResultType<TContext> | []
    : InferResultType<TContext>

/** Status and error fields every `useLiveQuery` result has. */
type UseLiveQueryFlags = LiveQueryStatusFlags & {
  /** The data is shown, and a sync problem or failed request is in `health`. */
  isSyncError: boolean
  health: HealthNode | undefined
}

/**
 * Create a live query using a query function
 * @param queryFn - Query function that defines what data to fetch
 * @returns Accessor that returns data with Suspense support, with state and status information as properties
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
 *     <Match when={todosQuery.isLoadingError}>
 *       <div>Error: {todosQuery.status}</div>
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

// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): Accessor<InferResultType<TContext>> & {
  /**
   * @deprecated use function result instead
   * query.data -> query()
   */
  data: InferResultType<TContext>
  state: ReactiveMap<string | number, GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus
} & UseLiveQueryFlags

// Overload 1b: Accept query function that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
): Accessor<InferConditionalResultType<TContext>> & {
  /**
   * @deprecated use function result instead
   * query.data -> query()
   */
  data: InferConditionalResultType<TContext>
  state: ReactiveMap<string | number, GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}> | null
  status: CollectionStatus | `disabled`
} & UseLiveQueryFlags

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @returns Accessor that returns data with Suspense support, with state and status information as properties
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
 *     <Match when={itemsQuery.isLoadingError}>
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
  config: Accessor<LiveQueryCollectionConfig<TContext>>,
): Accessor<InferResultType<TContext>> & {
  /**
   * @deprecated use function result instead
   * query.data -> query()
   */
  data: InferResultType<TContext>
  state: ReactiveMap<string | number, GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus
} & UseLiveQueryFlags

/**
 * Subscribe to an existing live query collection
 * @param liveQueryCollection - Pre-created live query collection to subscribe to
 * @returns Accessor that returns data with Suspense support, with state and status information as properties
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
 *    <Match when={sharedQuery.isLoadingError}>
 *      <div>Error loading data</div>
 *    </Match>
 *  </Switch>
 * )
 */
// Overload 3: Accept pre-created live query collection (non-single result)
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Accessor<
    Collection<TResult, TKey, TUtils> & NonSingleResult
  >,
): Accessor<Array<TResult>> & {
  /**
   * @deprecated use function result instead
   * query.data -> query()
   */
  data: Array<TResult>
  state: ReactiveMap<TKey, TResult>
  collection: Collection<TResult, TKey, TUtils>
  status: CollectionStatus
} & UseLiveQueryFlags

// Overload 3b: Accept pre-created live query collection with singleResult: true
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Accessor<
    Collection<TResult, TKey, TUtils> & SingleResult
  >,
): Accessor<TResult | undefined> & {
  /**
   * @deprecated use function result instead
   * query.data -> query()
   */
  data: TResult | undefined
  state: ReactiveMap<TKey, TResult>
  collection: Collection<TResult, TKey, TUtils> & SingleResult
  status: CollectionStatus
} & UseLiveQueryFlags

// Implementation - use function overloads to infer the actual collection type
export function useLiveQuery(
  configOrQueryOrCollection: (queryFn?: any) => any,
) {
  const collection = createMemo(
    () => {
      if (configOrQueryOrCollection.length === 1) {
        // This is a query function - check if it returns null/undefined
        const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
        const result = configOrQueryOrCollection(queryBuilder)

        if (result === undefined || result === null) {
          // Disabled query - return null
          return null
        }

        return resolveLiveQueryValue(result, { gcTime: DEFAULT_GC_TIME_MS })
      }

      const innerCollection = configOrQueryOrCollection()

      if (innerCollection === undefined || innerCollection === null) {
        // Disabled query - return null
        return null
      }

      if (isCollection(innerCollection)) {
        innerCollection.startSyncImmediate()
        return innerCollection as Collection
      }

      return resolveLiveQueryValue(innerCollection, {
        gcTime: DEFAULT_GC_TIME_MS,
      })
    },
    undefined,
    { name: `TanstackDBCollectionMemo` },
  )

  // Reactive state that gets updated granularly through change events
  const state = new ReactiveMap<string | number, any>()

  // Keep the live Collection's result keys private while preserving one stable
  // Solid store per logical row. A row's public $key can belong to an upstream
  // Collection and is therefore not necessarily unique in this result.
  const rowsByKey = new Map<
    string | number,
    { value: any; update: (value: any) => void }
  >()
  let rowsCollection: Collection<any, any, any> | undefined
  const [data, setData] = createStore<Array<any>>([], {
    name: `TanstackDBData`,
  })

  // Track collection status reactively
  const [status, setStatus] = createSignal(
    collection() ? collection()!.status : (`disabled` as const),
    {
      name: `TanstackDBStatus`,
    },
  )
  const [health, setHealth] = createSignal<HealthNode | undefined>(undefined)

  // Helper to sync data array from collection in correct order
  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>,
  ) => {
    const nextRows: Array<any> = []
    const retainedKeys = new Set<string | number>()

    for (const [key, value] of currentCollection.entries()) {
      retainedKeys.add(key)

      const existing = rowsByKey.get(key)
      if (existing) {
        existing.update(value)
        nextRows.push(existing.value)
      } else {
        const [row, setRow] = createStore(value)
        rowsByKey.set(key, {
          value: row,
          update: (nextValue) => setRow(reconcile(nextValue, { key: null })),
        })
        nextRows.push(row)
      }
    }

    for (const key of rowsByKey.keys()) {
      if (!retainedKeys.has(key)) rowsByKey.delete(key)
    }

    setData((previous) => reconcile(nextRows, { key: null })(previous))
  }

  // Generation guard for the resource's async continuations: Solid discards a
  // superseded fetch's *return value*, but the writes below are side effects
  // into hook-scoped state and would still run — resurrecting rows/status from
  // a collection that has already been replaced.
  let resourceGeneration = 0
  let localWait:
    | {
        observer: LiveQueryObserver<any, any>
        collection: Collection<any, any, any>
        ready: boolean
      }
    | undefined
  let subscribedCollection: Collection<any, any, any> | undefined
  const releaseLocalWait = () => {
    localWait?.observer.dispose()
    localWait = undefined
  }
  onCleanup(() => {
    resourceGeneration++
    releaseLocalWait()
  })

  const [getDataResource] = createResource(
    () => ({ currentCollection: collection() }),
    async ({ currentCollection }) => {
      const generation = ++resourceGeneration
      releaseLocalWait()
      if (!currentCollection) {
        return []
      }
      setStatus(currentCollection.status)
      setHealth(currentCollection.health)
      try {
        const observer = createLiveQueryObserver(currentCollection)
        localWait = {
          observer,
          collection: currentCollection,
          ready: false,
        }
        try {
          await observer.preload()
        } catch (error) {
          if (generation === resourceGeneration) releaseLocalWait()
          throw error
        }
        if (generation !== resourceGeneration) return data
        localWait.ready = true
        // `preload` waits for readiness but does not itself
        // retain the Collection after it settles. Hold one observer
        // subscription across Solid's ready-before-commit Suspense gap.
        observer.subscribe(() => {})
        // Solid disposes a provisional effect only after the resource settles
        // and Suspense re-evaluates the branch. Check on the next turn: a real
        // commit still owns the Collection, while a suspended branch keeps the
        // preload observer until its later commit or root cleanup.
        setTimeout(() => {
          if (
            localWait?.observer === observer &&
            subscribedCollection === currentCollection
          ) {
            releaseLocalWait()
          }
        }, 0)
      } catch (error) {
        if (generation !== resourceGeneration) return data
        // A crashed Collection also rejects preload; keep its crash visible.
        setStatus(currentCollection.status === `crashed` ? `crashed` : `error`)
        throw toBoundaryError(error)
      }
      if (generation !== resourceGeneration) {
        return data
      }
      // Initialize state with current collection data
      batch(() => {
        state.clear()
        for (const [key, value] of currentCollection.entries()) {
          state.set(key, value)
        }
        syncDataFromCollection(currentCollection)
        setStatus(currentCollection.status)
        setHealth(currentCollection.health)
      })
      return data
    },
    {
      name: `TanstackDBData`,
      deferStream: false,
      initialValue: data,
    },
  )

  createEffect(() => {
    const currentCollection = collection()
    if (!currentCollection) {
      setStatus(`disabled` as const)
      setHealth(undefined)
      state.clear()
      rowsByKey.clear()
      rowsCollection = undefined
      setData([])
      return
    }

    if (rowsCollection !== currentCollection) {
      rowsByKey.clear()
      rowsCollection = currentCollection
    }

    // The shared observer owns subscription, the ready-race, and status; Solid
    // materializes into its keyed ReactiveMap (granular) + reconciled store.
    const observer = createLiveQueryObserver(currentCollection)
    // Clear any keys carried over from a previous collection before the new
    // observer re-seeds via `includeInitialState` (which only inserts current
    // rows, never deletes stale ones). Without this, switching collections
    // leaves the dropped keys in `state` until the async resource reconciles.
    state.clear()
    const unsubscribe = observer.subscribe(
      (changes: Array<ChangeMessage<any>> | undefined) => {
        batch(() => {
          if (changes) {
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
          } else {
            // Cleanup and other status-only publications carry no row deltas.
            // Rebuild the keyed view so it cannot diverge from ordered data.
            state.clear()
            for (const [key, value] of observer.getSnapshot().state ?? []) {
              state.set(key, value)
            }
          }
          syncDataFromCollection(currentCollection)
          const snapshot = observer.getSnapshot()
          setStatus(snapshot.status)
          setHealth(snapshot.health)
        })
      },
    )
    subscribedCollection = currentCollection
    if (localWait?.ready && localWait.collection === currentCollection) {
      releaseLocalWait()
    }
    // An already-ready empty collection produces no initial row batch. Bring
    // ordered data and status in line synchronously instead of waiting for the
    // resource continuation to correct the previous collection's rows.
    batch(() => {
      syncDataFromCollection(currentCollection)
      const snapshot = observer.getSnapshot()
      setStatus(snapshot.status)
      setHealth(snapshot.health)
    })

    onCleanup(() => {
      if (subscribedCollection === currentCollection) {
        subscribedCollection = undefined
      }
      unsubscribe()
      observer.dispose()
    })
  })

  // We have to remove getters from the resource function so we wrap it
  function getData() {
    const currentCollection = collection()
    if (currentCollection) {
      if (isSingleResultCollection(currentCollection)) {
        // Force resource tracking so Suspense works
        getDataResource()
        return data[0]
      }
    }
    return getDataResource()
  }

  Object.defineProperties(getData, {
    data: {
      get() {
        return getData()
      },
    },
    status: {
      get() {
        return status()
      },
    },
    collection: {
      get() {
        return getPublicCollection(collection())
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
        return status() === `ready` || status() === `disabled`
      },
    },
    isIdle: {
      get() {
        return status() === `idle`
      },
    },
    isLoadingError: {
      get() {
        return status() === `error`
      },
    },
    isCrashed: {
      get() {
        return status() === `crashed`
      },
    },
    isCleanedUp: {
      get() {
        return status() === `cleaned-up`
      },
    },
    isSyncError: {
      get() {
        return status() === `ready` && health()?.hasErrors === true
      },
    },
    health: {
      get() {
        return health()
      },
    },
  })
  return getData
}
