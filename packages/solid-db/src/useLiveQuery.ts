import { ReactiveMap } from '@solid-primitives/map'
import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  createLiveQueryObserver,
  isCollection,
} from '@tanstack/db'
import {
  createMemo,
  createRenderEffect,
  createSignal,
  createStore,
  reconcile,
} from 'solid-js'
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

export type UseLiveQueryStatus = CollectionStatus | `disabled`

const RECONCILE_KEY = `$key` as const

// null key = positional/deep merge (v2 equivalent of v1's { merge: true })
const RECONCILE_DEEP = null

type AnyCollection = Collection<any, any, any>
type AnyChange = ChangeMessage<any, string | number>

/**
 * Create a live query using a query function
 * @param queryFn - Query function that defines what data to fetch
 * @returns Accessor that returns data with Loading boundary support, with state and status information as properties
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
 * // Use Loading boundaries
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todoCollection })
 * )
 *
 * return (
 *   <Loading fallback={<div>Loading...</div>}>
 *     <For each={todosQuery()}>
 *       {(todo) => <li key={todo.id}>{todo.text}</li>}
 *     </For>
 *   </Loading>
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
 * @returns Accessor that returns data with Loading boundary support, with state and status information as properties
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
 * @returns Accessor that returns data with Loading boundary support, with state and status information as properties
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
  let collectionError: unknown = null

  const collection = createMemo(
    () => {
      collectionError = null
      try {
        if (configOrQueryOrCollection.length === 1) {
          const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
          const result = configOrQueryOrCollection(queryBuilder)

          if (result === undefined || result === null) {
            return null
          }

          return createLiveQueryCollection({
            query: configOrQueryOrCollection,
            startSync: true,
          })
        }

        const innerCollection = configOrQueryOrCollection()

        if (innerCollection === undefined || innerCollection === null) {
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
      } catch (error) {
        collectionError = error
        setStatus(`error` as const)
        return null
      }
    },
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

  const isSingleResult = (currentCollection: AnyCollection) => {
    const config = currentCollection.config
    return 'singleResult' in config && config.singleResult === true
  }

  // Patch an existing store row instead of replacing the array. This keeps
  // Solid's per-field subscriptions alive for rows that did not change.
  const patchStoreRow = (index: number, row: WithVirtualProps<any>) => {
    if (index >= data.length) return false

    setData(s => { reconcile(row, RECONCILE_DEEP)(s[index]) })
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
  const [status, setStatus] = createSignal<UseLiveQueryStatus>(
    () => collection() ? collection()!.status : (`disabled` as const),
    {
      name: `TanstackDBStatus`,
      ownedWrite: true,
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

      if (!needsResync) setData(s => { reconcile(row, RECONCILE_DEEP)(s[0]) })
    }

    if (needsResync) {
      syncDataOnlyFromCollection(currentCollection)
    }

    return !needsResync
  }

  // Async memo for Loading: awaits collection readiness. Reading this
  // when pending throws NotReadyError (caught by <Loading>); reading when
  // the collection errored throws the error (caught by <Errored>).
  const readiness = createMemo(async () => {
    const col = collection()
    if (!col) return null
    if (col.isReady()) return col
    await new Promise<void>((resolve) => {
      col.onFirstReady(resolve)
    })
    return col
  })

  // Solid 2.0 split render effect: compute tracks the collection memo; apply
  // runs during the render queue (not deferred like createEffect) so data is
  // available synchronously. Reactive reads in apply are untracked by design.
  createRenderEffect(
    () => collection(),
    (currentCollection) => {
      if (!currentCollection) {
        if (!collectionError) setStatus(`disabled` as const)
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
      collectionError = null
      const canPatchUpdates = currentCollection.config.compare === undefined
      // The shared observer owns the subscription, the ready-race, and status;
      // Solid materializes the delivered deltas into the keyed store, patching
      // rows granularly when membership and order cannot change.
      const observer = createLiveQueryObserver(currentCollection)
      const unsubscribe = observer.subscribe(
        (changes: Array<ChangeMessage<any>> | undefined) => {
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
        },
      )
      // An already-ready empty collection produces no initial row batch. Bring
      // ordered data and status in line synchronously instead of waiting for the
      // resource continuation to correct the previous collection's rows.
      syncDataFromCollection(currentCollection)
      setStatus(observer.getSnapshot().status)

      let cancelled = false

      const offStatusError = currentCollection.on(`status:error`, () => {
        if (cancelled) return
        setStatus(`error` as const)
      })

      currentCollection.toArrayWhenReady().catch((error: unknown) => {
        if (cancelled) return
        collectionError = error
        setStatus(`error` as const)
      })

      return () => {
        cancelled = true
        offStatusError()
        unsubscribe()
        observer.dispose()
      }
    },
  )

  function getData() {
    if (collectionError) throw collectionError

    const s = status()
    if (s === 'error') throw collectionError ?? new Error('Collection sync error')

    const currentCollection = collection()
    if (!currentCollection) {
      return data
    }
    if (s !== `ready`) readiness()
    if (isSingleResult(currentCollection)) {
      return data[0]
    }
    return data
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
