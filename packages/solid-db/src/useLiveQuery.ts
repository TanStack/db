import { ReactiveMap } from '@solid-primitives/map'
import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  createLiveQueryObserver,
  isCollection,
} from '@tanstack/db'
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { Accessor } from 'solid-js'
import type {
  ChangeMessage,
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
  WithVirtualProps,
} from '@tanstack/db'

const RECONCILE_KEY = { key: `$key` } as const

const RECONCILE_DEEP = { merge: true } as const

type AnyCollection = Collection<any, any, any>
type AnyChange = ChangeMessage<any, string | number>

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
 *     <Match when={todosQuery.isError}>
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
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

// Overload 1b: Accept query function that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
): Accessor<InferResultType<TContext>> & {
  /**
   * @deprecated use function result instead
   * query.data -> query()
   */
  data: InferResultType<TContext>
  state: ReactiveMap<string | number, GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}> | null
  status: CollectionStatus | `disabled`
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

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
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

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
 *    <Match when={sharedQuery.isError}>
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
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

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
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

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

        return createLiveQueryCollection({
          query: configOrQueryOrCollection,
          startSync: true,
        })
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

      return createLiveQueryCollection({
        ...innerCollection,
        startSync: true,
      })
    },
    undefined,
    { name: `TanstackDBCollectionMemo` },
  )

  // Reactive state that gets updated granularly through change events
  const state = new ReactiveMap<string | number, any>()

  // Reactive data array that maintains sorted order
  const [data, setData] = createStore<Array<any>>([], {
    name: `TanstackDBData`,
  })

  const rowIndex = new Map<string | number, number>()
  const syncRows: Array<any> = []

  // The collection currently reflected by `data`.
  let syncedCollection: AnyCollection | null = null

  // `.state` is maintained lazily and can lag behind `data` until accessed.
  let stateSyncedCollection: AnyCollection | null = null
  let stateAccessed = false

  // The row currently exposed by findOne-style queries.
  let singleRowKey: string | number | undefined

  // Read the collection config once at call sites that need single-row behavior.
  const isSingleResult = (currentCollection: AnyCollection) => {
    const config = currentCollection.config
    return 'singleResult' in config && config.singleResult === true
  }

  // Patch an existing store row instead of replacing the array. This keeps
  // Solid's per-field subscriptions alive for rows that did not change.
  const patchStoreRow = (index: number, row: WithVirtualProps<any>) => {
    if (index >= data.length) return false

    setData(index, reconcile(row, RECONCILE_DEEP))
    return true
  }

  // Public `.state` is lazy. Most consumers only use the accessor result, so we
  // avoid maintaining a second reactive map until `.state` is actually read.
  const syncStateFromCollection = (currentCollection: AnyCollection) => {
    state.clear()
    for (const value of currentCollection.values()) {
      state.set(value.$key, value)
    }
    stateSyncedCollection = currentCollection
  }

  // Track collection status reactively
  const [status, setStatus] = createSignal(
    collection() ? collection()!.status : (`disabled` as const),
    {
      name: `TanstackDBStatus`,
    },
  )

  // Sync the ordered result array from the collection, reusing scratch storage.
  const syncDataFromCollection = (
    currentCollection: AnyCollection,
    stateTarget = stateAccessed ? state : undefined,
  ) => {
    syncedCollection = currentCollection

    // Unsorted result collections keep stable positions by key; sorted queries
    // may move rows, so they always resync instead of using rowIndex patches.
    const shouldTrackIndex = currentCollection.config.compare === undefined
    if (shouldTrackIndex) rowIndex.clear()

    stateTarget?.clear()

    if (isSingleResult(currentCollection)) {
      const value = currentCollection.values().next().value
      if (!value) {
        singleRowKey = undefined
        syncRows.length = 0
        if (stateTarget) stateSyncedCollection = currentCollection
        setData(reconcile(syncRows, RECONCILE_KEY))
        return
      }

      const row = value
      singleRowKey = row.$key
      if (stateTarget) {
        stateTarget.set(row.$key, row)
        stateSyncedCollection = currentCollection
      }
      syncRows[0] = row
      syncRows.length = 1
      setData(reconcile(syncRows, RECONCILE_KEY))
      return
    }

    syncRows.length = 0

    let index = 0
    for (const value of currentCollection.values()) {
      const row = value
      syncRows[index] = row
      if (shouldTrackIndex) rowIndex.set(row.$key, index)
      if (stateTarget) stateTarget.set(row.$key, row)
      index++
    }
    syncRows.length = index
    if (stateTarget) stateSyncedCollection = currentCollection

    setData(reconcile(syncRows, RECONCILE_KEY))
  }

  const syncDataOnlyFromCollection = (currentCollection: AnyCollection) => {
    // Used after `.state` has already been incrementally updated while `data`
    // still needs an authoritative rebuild for ordering/membership.
    syncDataFromCollection(currentCollection, undefined)
  }

  // Fast path for update-only batches. Inserts/deletes or sorted queries can
  // change membership/order, so those fall back to a collection resync.
  const patchArrayChanges = (
    currentCollection: AnyCollection,
    changes: Array<AnyChange>,
  ) => {
    let needsResync = false

    for (const change of changes) {
      if (change.type !== `update`) {
        // Inserts/deletes can change membership; update `.state` while we are
        // here, then rebuild `data` once after the loop.
        needsResync = true
        if (stateAccessed) {
          if (change.type === `delete`) {
            state.delete(change.key)
          } else {
            state.set(change.key, change.value)
          }
        }
        continue
      }

      const row = change.value

      if (stateAccessed) state.set(change.key, row)

      // Once a batch needs a resync, avoid doing wasted row-level patches for
      // later updates in the same batch.
      if (needsResync) continue

      const index = rowIndex.get(change.key)
      if (index === undefined || !patchStoreRow(index, row)) {
        needsResync = true
      }
    }

    if (needsResync) {
      syncDataOnlyFromCollection(currentCollection)
    }

    return !needsResync
  }

  const patchSingleResultChanges = (
    currentCollection: AnyCollection,
    changes: Array<AnyChange>,
  ) => {
    let needsResync = false

    for (const change of changes) {
      if (change.type !== `update`) {
        // Non-update changes can replace/remove the single result; update the
        // lazy state map now and rebuild `data` after this pass.
        needsResync = true
        if (stateAccessed) {
          if (change.type === `delete`) {
            state.delete(change.key)
          } else {
            state.set(change.key, change.value)
          }
        }
        continue
      }

      // Updates for non-matching rows do not affect the exposed single result.
      if (change.key !== singleRowKey) continue

      const row = change.value
      if (stateAccessed) state.set(change.key, row)

      // If the batch already needs a resync, defer the visible update to the
      // final rebuild so ordering/membership stays authoritative.
      if (!needsResync) setData(0, reconcile(row))
    }

    if (needsResync) {
      syncDataOnlyFromCollection(currentCollection)
    }

    return !needsResync
  }

  // Generation guard for the resource's async continuations: Solid discards a
  // superseded fetch's *return value*, but the writes below are side effects
  // into hook-scoped state and would still run — resurrecting rows/status from
  // a collection that has already been replaced.
  let resourceGeneration = 0

  const [getDataResource] = createResource(
    collection,
    async (currentCollection) => {
      const generation = ++resourceGeneration
      setStatus(currentCollection.status)
      try {
        await currentCollection.toArrayWhenReady()
      } catch (error) {
        if (generation === resourceGeneration) setStatus(`error`)
        throw error
      }
      if (generation !== resourceGeneration) {
        return data
      }
      if (syncedCollection !== currentCollection) {
        syncDataFromCollection(currentCollection)
      }
      setStatus(currentCollection.status)
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
      syncedCollection = null
      stateSyncedCollection = null
      singleRowKey = undefined
      rowIndex.clear()
      if (stateAccessed) state.clear()
      syncRows.length = 0
      setData(reconcile(syncRows, RECONCILE_KEY))
      return
    }
    const singleResult = isSingleResult(currentCollection)
    const canPatchUpdates = currentCollection.config.compare === undefined
    // The shared observer owns the subscription, the ready-race, and status;
    // Solid materializes the delivered deltas into the keyed store, patching
    // rows granularly when membership and order cannot change.
    const observer = createLiveQueryObserver(currentCollection)
    const unsubscribe = observer.subscribe(
      (changes: Array<ChangeMessage<any>> | undefined) => {
        batch(() => {
          if (syncedCollection !== currentCollection) {
            // The observer replays the initial state on attach, which can win
            // the race against the resource. Do one authoritative sync instead
            // of patching stale row indices from the previous collection.
            syncDataFromCollection(currentCollection)
          } else if (changes !== undefined && canPatchUpdates) {
            if (singleResult) {
              patchSingleResultChanges(currentCollection, changes)
            } else {
              patchArrayChanges(currentCollection, changes)
            }
          } else {
            // Synthetic status notifies carry no change set, and sorted
            // queries can reorder rows on any delta; both need a full resync.
            syncDataFromCollection(currentCollection)
          }

          // Update status ref on every change
          setStatus(observer.getSnapshot().status)
        })
      },
    )

    onCleanup(() => {
      unsubscribe()
      observer.dispose()
    })
  })

  // We have to remove getters from the resource function so we wrap it
  function getData() {
    const currentCollection = collection()
    if (currentCollection && isSingleResult(currentCollection)) {
      // Force resource tracking so Suspense works before the collection is ready.
      if (status() !== `ready`) getDataResource()
      return data[0]
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
        return collection()
      },
    },
    state: {
      get() {
        stateAccessed = true
        const currentCollection = collection()
        if (!currentCollection) {
          if (stateSyncedCollection !== null) {
            state.clear()
            stateSyncedCollection = null
          }
        } else if (stateSyncedCollection !== currentCollection) {
          syncStateFromCollection(currentCollection)
        }
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
