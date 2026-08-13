import { ReactiveMap } from '@solid-primitives/map'
import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  createLiveQueryObserver,
  isCollection,
  isSingleResultCollection,
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
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  LiveQuerySnapshot,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

export type UseLiveQueryStatus = CollectionStatus | `disabled`

const RECONCILE_KEY = `$key` as const

type AnyCollection = Collection<any, any, any>

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

// Wholesale observer mode: the observer delivers wake-up notifies; Solid's
// keyed reconcile handles the per-field diff. Collection-level optimistic
// transactions flow through the change stream and reconcile naturally.
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
        return null
      }
    },
    { name: `TanstackDBCollectionMemo` },
  )

  // Lazily synced — populated on first `.state` read, then kept in sync
  // from subsequent observer snapshots.
  const state = new ReactiveMap<string | number, any>()
  let stateAccessed = false
  let stateSyncedCollection: AnyCollection | null = null

  const [data, setData] = createStore<Array<any>>([], {
    name: `TanstackDBData`,
  })

  // ownedWrite lets setStatus be called from the split-effect's apply phase.
  const [status, setStatus] = createSignal<UseLiveQueryStatus>(
    () => collection() ? collection()!.status : (`disabled` as const),
    {
      name: `TanstackDBStatus`,
      ownedWrite: true,
    },
  )

  // Single-result collections expose data[0]; wrap in a 1-element array
  // for uniform keyed reconciliation.
  const snapshotToRows = (
    snapshot: LiveQuerySnapshot<any, any>,
  ): Array<any> => {
    const snapshotData = snapshot.data
    if (snapshotData === undefined) return []
    if (Array.isArray(snapshotData)) return snapshotData
    return [snapshotData]
  }

  const applySnapshot = (
    snapshot: LiveQuerySnapshot<any, any>,
    currentCollection: AnyCollection,
  ) => {
    setData(reconcile(snapshotToRows(snapshot), RECONCILE_KEY))
    setStatus(snapshot.status)
    if (stateAccessed) {
      state.clear()
      if (snapshot.state) {
        for (const [key, value] of snapshot.state) {
          state.set(key, value)
        }
      }
      stateSyncedCollection = currentCollection
    }
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

  // Split render effect owns the observer lifecycle per collection. Wholesale
  // mode delivers nothing during subscribe, so the initial snapshot is pulled
  // synchronously after attach.
  createRenderEffect(
    () => collection(),
    (currentCollection) => {
      if (!currentCollection) {
        if (collectionError) {
          setStatus(`error` as const)
        } else {
          setStatus(`disabled` as const)
        }
        stateSyncedCollection = null
        if (stateAccessed) state.clear()
        setData(reconcile([], RECONCILE_KEY))
        return
      }

      collectionError = null

      const observer = createLiveQueryObserver(currentCollection, {
        mode: `wholesale`,
      })

      const sync = () => {
        applySnapshot(observer.getSnapshot(), currentCollection)
      }

      const unsubscribe = observer.subscribe(sync)

      // Wholesale delivers nothing during subscribe — seed synchronously.
      sync()

      let cancelled = false

      // Observer already handles status:change; this captures the error
      // object itself for getData() to re-throw.
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
    if (isSingleResultCollection(currentCollection)) {
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
          state.clear()
          for (const [key, value] of currentCollection.entries() as IterableIterator<[any, any]>) {
            state.set(key, value)
          }
          stateSyncedCollection = currentCollection
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
