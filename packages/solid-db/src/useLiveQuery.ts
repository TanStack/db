import { ReactiveMap } from '@solid-primitives/map'
import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  createLiveQueryObserver,
  isCollection,
  isSingleResultCollection,
} from '@tanstack/db'
import { createEffect, createMemo, createProjection, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  LiveQueryPersistedStatus,
  LiveQuerySnapshot,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

export type UseLiveQueryStatus = CollectionStatus | `disabled`

type AnySnapshot = LiveQuerySnapshot<any, any>

type InferConditionalResultType<TContext extends Context> =
  TContext extends SingleResult
    ? InferResultType<TContext> | []
    : InferResultType<TContext>

/**
 * Create a live query using a query function
 * @param queryFn - Query function that defines what data to fetch
 * @returns Accessor that returns the current rows synchronously; gate rendering on `readiness` inside `<Loading>` for suspense
 * @example
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 *    .where(({ todos }) => eq(todos.completed, false))
 *    .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * )
 *
 * <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
 *
 * @example
 * // Opt-in suspense: read `readiness` inside <Loading> to gate on first data
 * <Loading fallback={<div>Loading...</div>}>
 *   {todosQuery.readiness() && (
 *     <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
 *   )}
 * </Loading>
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): Accessor<InferResultType<TContext>> & {
  state: ReactiveMap<string | number, GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: UseLiveQueryStatus
  isReady: boolean
  isError: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  readiness: Accessor<Collection<GetResult<TContext>, string | number, {}>>
}

// Overload 1b: Accept query function that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
): Accessor<InferConditionalResultType<TContext>> & {
  state: ReactiveMap<string | number, GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}> | null
  status: UseLiveQueryStatus
  isReady: boolean
  isError: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  readiness: Accessor<
    Collection<GetResult<TContext>, string | number, {}> | null
  >
}

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @returns Accessor that returns the current rows synchronously, with state, collection, status, and persisted-readiness properties
 * @example
 * const todosQuery = useLiveQuery(() => ({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * }))
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: Accessor<LiveQueryCollectionConfig<TContext>>,
): Accessor<InferResultType<TContext>> & {
  state: ReactiveMap<string | number, GetResult<TContext>>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: UseLiveQueryStatus
  isReady: boolean
  isError: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  readiness: Accessor<Collection<GetResult<TContext>, string | number, {}>>
}

/**
 * Subscribe to an existing live query collection
 * @param liveQueryCollection - Pre-created live query collection to subscribe to
 * @returns Accessor that returns the current rows synchronously, with state, collection, status, and persisted-readiness properties
 * @example
 * const myLiveQuery = createLiveQueryCollection((q) =>
 *   q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
 * )
 * const todosQuery = useLiveQuery(() => myLiveQuery)
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
  state: ReactiveMap<TKey, TResult>
  collection: Collection<TResult, TKey, TUtils>
  status: UseLiveQueryStatus
  isReady: boolean
  isError: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  readiness: Accessor<Collection<TResult, TKey, TUtils>>
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
  state: ReactiveMap<TKey, TResult>
  collection: Collection<TResult, TKey, TUtils> & SingleResult
  status: UseLiveQueryStatus
  isReady: boolean
  isError: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  readiness: Accessor<Collection<TResult, TKey, TUtils>>
}

// The observer owns the subscription and publishes stable snapshots; Solid
// state stays fully derived from the latest snapshot. The snapshot signal is
// written from observer notifies (outside any owned scope) and seeded once
// from the effect's apply phase, which is why it opts into `ownedWrite`.
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

  const [snapshot, setSnapshot] = createSignal<AnySnapshot | null>(null, {
    name: `TanstackDBSnapshot`,
    // Seeded from the effect's apply phase — an owned scope where this
    // intentional internal write is only legal with the opt-in.
    ownedWrite: true,
  })

  const status = createMemo<UseLiveQueryStatus>(
    () => {
      const currentSnapshot = snapshot()
      if (currentSnapshot) return currentSnapshot.status
      return collectionError ? `error` : `disabled`
    },
    { name: `TanstackDBStatus` },
  )

  // One stable store node per logical row, keyed by the live Collection's
  // RESULT keys — the rule from #1825. A row's public $key belongs to an
  // upstream collection and is not necessarily unique in a derived result
  // (e.g. two unionAll branches publishing the same $key). Identities are
  // stamped at derive time as `<epoch>:<result key>`, where the epoch bumps
  // on collection replacement: overlapping keys from different collections
  // are different entities. The registry persists across derives (the
  // matcher re-keys existing nodes) and is a WeakMap so superseded rows
  // drop out with GC.
  const rowIdentities = new WeakMap<object, string>()
  let identityCollection: unknown
  let identityEpoch = 0
  const data = createProjection(
    () => {
      const currentSnapshot = snapshot()
      const entries = currentSnapshot?.state
      if (currentSnapshot?.collection !== identityCollection) {
        identityCollection = currentSnapshot?.collection
        identityEpoch++
      }
      if (!entries) return []
      const rows: Array<any> = []
      for (const [key, row] of entries) {
        rowIdentities.set(row, `${identityEpoch}:${String(key)}`)
        rows.push(row)
      }
      return rows
    },
    [],
    { key: (row: any) => rowIdentities.get(row), name: `TanstackDBData` },
  )

  // Granular keyed state, synced incrementally per snapshot so only changed
  // keys notify. The ReactiveMap's trigger signals opt into owned writes, so
  // syncing from the effect is legal.
  const state = new ReactiveMap<string | number, any>()
  let stateSyncedSnapshot: AnySnapshot | null | undefined

  const syncState = (currentSnapshot: AnySnapshot | null) => {
    if (stateSyncedSnapshot === currentSnapshot) return
    stateSyncedSnapshot = currentSnapshot
    const next = currentSnapshot?.state
    if (!next) {
      state.clear()
      return
    }
    for (const [key, value] of next) {
      if (state.get(key) !== value) state.set(key, value)
    }
    const staleKeys: Array<string | number> = []
    for (const key of state.keys()) {
      if (!next.has(key)) staleKeys.push(key)
    }
    for (const key of staleKeys) state.delete(key)
  }

  // Opt-in render gate. Reading `readiness` while the initial render is in
  // flight throws NotReadyError for a <Loading> boundary to catch. It settles
  // at network readiness or a permitted persisted fallback — the same gate
  // the React adapter's suspense hook uses — so persisted data can reveal
  // content before the network answers.
  const readiness = createMemo(async () => {
    const col = collection()
    if (!col) return null
    if (col.isReady()) return col
    const observer = createLiveQueryObserver(col)
    try {
      await observer.preloadForInitialRender()
    } finally {
      observer.dispose()
    }
    return col
  })

  // The effect's apply phase owns the observer lifecycle per collection.
  // Wholesale mode delivers nothing during subscribe, so the initial
  // snapshot is pulled synchronously after attach.
  createEffect(
    () => collection(),
    (currentCollection) => {
      if (!currentCollection) {
        setSnapshot(null)
        syncState(null)
        return
      }

      const observer = createLiveQueryObserver(currentCollection, {
        mode: `wholesale`,
      })

      const sync = () => {
        const currentSnapshot = observer.getSnapshot()
        setSnapshot(currentSnapshot)
        syncState(currentSnapshot)
      }

      const unsubscribe = observer.subscribe(sync)

      // Wholesale delivers nothing during subscribe — seed synchronously.
      sync()

      // Capture the sync error object for getData() to re-throw; the error
      // STATUS itself arrives through the observer's status notifications.
      // The guard drops rejections from a collection this effect has already
      // torn down, so a superseded query cannot poison its replacement.
      let active = true
      currentCollection.toArrayWhenReady().catch((error: unknown) => {
        if (active) collectionError = error
      })

      return () => {
        active = false
        unsubscribe()
        observer.dispose()
      }
    },
    { name: `TanstackDBObserver` },
  )

  // Data reads never suspend: rows synced before readiness render
  // immediately (progressive sync, on-demand loading). Only the error path
  // throws, for an <Errored> boundary.
  function getData() {
    if (collectionError) throw collectionError

    const s = status()
    if (s === 'error') throw collectionError ?? new Error('Collection sync error')

    const currentCollection = collection()
    if (!currentCollection) {
      return data
    }
    if (isSingleResultCollection(currentCollection)) {
      return data[0]
    }
    return data
  }

  Object.defineProperties(getData, {
    collection: {
      get() {
        return collection()
      },
    },
    state: {
      get() {
        syncState(snapshot())
        return state
      },
    },
    status: {
      get() {
        return status()
      },
    },
    isReady: {
      get() {
        const currentSnapshot = snapshot()
        return currentSnapshot
          ? currentSnapshot.isReady
          : status() === `disabled`
      },
    },
    isError: {
      get() {
        return status() === `error`
      },
    },
    persistedStatus: {
      get() {
        return snapshot()?.persistedStatus ?? `unavailable`
      },
    },
    isPersistedReady: {
      get() {
        return snapshot()?.isPersistedReady ?? false
      },
    },
    persistedError: {
      get() {
        return snapshot()?.persistedError
      },
    },
    readiness: {
      get() {
        return readiness
      },
    },
  })
  return getData
}
