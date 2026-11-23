import { ReactiveMap } from '@solid-primitives/map'
import {
  createLiveQueryObserver,
  getPublicCollection,
  isCollection,
  isSingleResultCollection,
  prepareLiveQueryValue,
  resolveLiveQueryValue,
  toBoundaryError,
} from '@tanstack/db'
import { createEffect, createMemo, createStore, from, untrack } from 'solid-js'
import { createRowStore } from './store-materialization'
import type { Accessor } from 'solid-js'
import type {
  Collection,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryHookConfig,
  LiveQuerySnapshot,
  LiveQueryStatusFlags,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

const DEFAULT_GC_TIME_MS = 1

// The snapshot's status surface, exposed one property per flag.
const FLAG_KEYS = [
  `status`,
  `isLoading`,
  `isReady`,
  `isIdle`,
  `isLoadingError`,
  `isCrashed`,
  `isCleanedUp`,
  `isSyncError`,
  `health`,
] as const
type FlagKey = (typeof FLAG_KEYS)[number]

type InferConditionalResultType<TContext extends Context> =
  TContext extends SingleResult
    ? InferResultType<TContext> | []
    : InferResultType<TContext>

/**
 * What every `useLiveQuery` accessor carries beside the rows: `query()`
 * returns the rows, and the properties below describe them.
 */
type Result<TRows, TRow, TCollection> = Accessor<TRows> & {
  /** Keyed rows, by the live query's result key. */
  state: ReactiveMap<string | number, TRow>
  /** The live query backing this result (its pooled public view, if pooled). */
  collection: TCollection
  status: LiveQuerySnapshot<any, any>[`status`]
  /**
   * The rows once the first load has settled. Reading it before that throws
   * `NotReadyError`, so call it under `<Loading>`:
   *
   * ```tsx
   * <Loading fallback={<Spinner />}>
   *   <For each={query.loaded()}>{(row) => <Row row={row} />}</For>
   * </Loading>
   * ```
   */
  loaded: Accessor<TRows>
} & LiveQueryStatusFlags

/**
 * Create a live query using a query function
 * @param queryFn - Query function that defines what data to fetch
 * @returns Accessor that returns the current rows synchronously; gate rendering on `loaded()` inside `<Loading>` for a first-data boundary
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
 * // Opt-in gate: `loaded()` participates in <Loading> and returns the rows
 * <Loading fallback={<div>Loading...</div>}>
 *   <For each={todosQuery.loaded()}>{(todo) => <li>{todo.text}</li>}</For>
 * </Loading>
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): Result<
  InferResultType<TContext>,
  GetResult<TContext>,
  Collection<GetResult<TContext>, string | number, {}>
>

// Overload 1b: Accept query function that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
): Result<
  InferConditionalResultType<TContext>,
  GetResult<TContext>,
  Collection<GetResult<TContext>, string | number, {}> | null
>

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @returns Accessor that returns the current rows synchronously, with state, collection, status, and readiness properties
 * @example
 * const todosQuery = useLiveQuery(() => ({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * }))
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: Accessor<LiveQueryHookConfig<TContext>>,
): Result<
  InferResultType<TContext>,
  GetResult<TContext>,
  Collection<GetResult<TContext>, string | number, {}>
>

/**
 * Subscribe to an existing live query collection
 * @param liveQueryCollection - Pre-created live query collection to subscribe to
 * @returns Accessor that returns the current rows synchronously, with state, collection, status, and readiness properties
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
): Result<Array<TResult>, TResult, Collection<TResult, TKey, TUtils>>

// Overload 3b: Accept pre-created live query collection with singleResult: true
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Accessor<
    Collection<TResult, TKey, TUtils> & SingleResult
  >,
): Result<
  TResult | undefined,
  TResult,
  Collection<TResult, TKey, TUtils> & SingleResult
>

// The observer owns the subscription and the snapshot; every value below is
// derived from the snapshot, so rows and status agree at every cut.
// The overloads are the public contract. The parameter is `any` because an
// implementation signature must be assignable to every overload's parameter
// in both directions, and a query function, a config accessor and a
// collection accessor share no other type.
export function useLiveQuery(
  configOrQueryOrCollection: (queryFn?: any) => any,
) {
  let inputError: unknown
  let previousCollection: ReturnType<typeof resolveLiveQueryValue> = null
  const resolveNext = (value: unknown) =>
    (previousCollection = resolveLiveQueryValue(value, {
      gcTime: DEFAULT_GC_TIME_MS,
      previousCollection,
      windowOwner: resolveNext,
    }))
  const collection = createMemo(
    () => {
      const value =
        configOrQueryOrCollection.length === 1
          ? configOrQueryOrCollection
          : configOrQueryOrCollection()
      // Query-input reads define binding dependencies. Compilation can drain
      // source rows synchronously; those reads belong to the result instead.
      // An invalid input is the caller's error: a computation must not throw
      // it (the runtime wraps it and later updates are lost), so keep it and
      // throw it from the accessor.
      inputError = undefined
      try {
        const prepared = prepareLiveQueryValue(value, undefined)
        return untrack(() => {
          if (isCollection(prepared)) {
            previousCollection = null
            return prepared as Collection
          }
          return resolveNext(prepared)
        })
      } catch (error) {
        inputError = error
        return null
      }
    },
    { name: `TanstackDBCollection`, sync: true },
  )

  type AnySnapshot = LiveQuerySnapshot<any, any>
  type RowStore = ReturnType<typeof createRowStore>
  let observer: ReturnType<typeof createLiveQueryObserver> | undefined

  // `from` turns the observer into a memo: every value below is then derived,
  // never relayed through an effect, so rows and status are consistent at
  // every cut of a flush. The source emits during `subscribe`, so the first
  // read is served without a loading frame, and it closes when the collection
  // is replaced or the owner disposed.
  const snapshot = createMemo(
    () => {
      const current = collection()
      return from<AnySnapshot>((next, error) => {
        const attached = createLiveQueryObserver(current, {
          mode: `wholesale`,
        })
        observer = attached
        const publish = () => {
          try {
            next(attached.getSnapshot())
          } catch (cause) {
            error(cause)
          }
        }
        // A source that throws while it starts crashes its Collection, and
        // core rethrows that from `subscribe`. The crash is the query's to
        // report: the snapshot shows it and the accessor throws it as an
        // Error, so it must not become this memo's own error.
        let unsubscribe = () => {}
        try {
          unsubscribe = attached.subscribe(publish)
        } catch {
          // Reported through the snapshot's status.
        }
        publish()
        return () => {
          if (observer === attached) observer = undefined
          unsubscribe()
          attached.dispose()
        }
      })
    },
    { name: `TanstackDBSnapshot` },
  )

  // One scalar memo per flag, so a flag's readers re-run only when that flag
  // changes; a row update must not wake a component reading `isReady`.
  const flag = <K extends FlagKey>(key: K) =>
    createMemo(() => snapshot()[key], {
      name: `TanstackDB.${key}`,
      sync: true,
    })
  const flags = {
    status: flag(`status`),
    isLoading: flag(`isLoading`),
    isReady: flag(`isReady`),
    isIdle: flag(`isIdle`),
    isLoadingError: flag(`isLoadingError`),
    isCrashed: flag(`isCrashed`),
    isCleanedUp: flag(`isCleanedUp`),
    isSyncError: flag(`isSyncError`),
    health: flag(`health`),
  }
  // One stable row store per logical row, keyed by the live Collection's
  // RESULT keys — the rule from #1825. A row's public $key belongs to an
  // upstream Collection and is not necessarily unique in a derived result
  // (e.g. two unionAll branches publishing the same $key). Rows are dropped
  // when their collection is replaced, so an overlapping key of a new
  // collection is a different row.
  const rowsByKey = new Map<string | number, RowStore>()
  let rowsCollection: unknown
  const state = new ReactiveMap<string | number, any>()

  // Resolves each row of one snapshot to its row store, in result order. The
  // keyed map changes with them, so `state` can never hold rows that
  // `query()` does not.
  const resolveRows = (current: AnySnapshot): Array<object> => {
    if (current.collection !== rowsCollection) {
      rowsCollection = current.collection
      rowsByKey.clear()
      state.clear()
    }
    const rows: Array<object> = []
    const retained = new Set<string | number>()
    // A disabled query has no state; iterate nothing then.
    const entries: Iterable<[string | number, object]> = current.state ?? []
    for (const [key, value] of entries) {
      retained.add(key)
      let row = rowsByKey.get(key)
      if (!row) {
        row = createRowStore(value)
        rowsByKey.set(key, row)
      } else row.update(value)
      rows.push(row.value)
      if (state.get(key) !== value) state.set(key, value)
    }
    for (const key of rowsByKey.keys())
      if (!retained.has(key)) rowsByKey.delete(key)
    for (const key of state.keys()) if (!retained.has(key)) state.delete(key)
    return rows
  }

  // Solid 2 forbids a store write inside an owner's scope, and an effect's
  // first run happens there when the owner is a component. Creating a store
  // with its first value is the one write that scope allows, so the rows are
  // seeded at creation and the effect only applies later snapshots.
  const [data, setData] = createStore(
    untrack(() => resolveRows(snapshot())),
    {
      name: `TanstackDBData`,
    },
  )
  createEffect(
    () => snapshot(),
    (current) => {
      const rows = resolveRows(current)
      setData((draft) => {
        for (let index = 0; index < rows.length; index++)
          draft[index] = rows[index]!
        draft.length = rows.length
      })
    },
    { name: `TanstackDBRows`, defer: true },
  )

  const readyOnce = new WeakSet<object>()

  // The gate is the React suspense adapter's rule: a failed first load throws
  // only before the first ready, and later sync problems surface in `health`
  // with the data kept. A crash throws at any time: the Collection can no
  // longer serve reads. `query()` tracks only this scalar memo besides the
  // rows, so a publication that changes neither leaves its readers asleep.
  const failed = createMemo(
    () => {
      const current = snapshot()
      const live = collection()
      if (live && current.isReady) readyOnce.add(live)
      return (
        current.isCrashed ||
        (current.isLoadingError && !!live && !readyOnce.has(live))
      )
    },
    { name: `TanstackDB.failed`, sync: true },
  )

  // A crash, or a failed first load, reaches an <Errored> boundary as an
  // Error: the cause itself when it is an Error, else an Error wrapping it.
  const throwFailure = (current: Collection<any, any, any> | null) => {
    if (!current) return
    const cause = observer?.getError() ?? current.health.error?.cause
    // Collections do not always record a cause; name the failed query.
    throw cause === undefined
      ? new Error(`Collection "${current.id}" failed to load`)
      : toBoundaryError(cause)
  }

  // Opt-in render gate. Reading `loaded` while the first load is in flight
  // throws NotReadyError for a <Loading> boundary to catch. Eager, not lazy:
  // a lazily autodisposed memo freezes at its last commit once unobserved,
  // which would hide revalidation from isPending() readers.
  const readiness = createMemo(async () => {
    const current = collection()
    if (!current || snapshot().isReady) return
    const preload = createLiveQueryObserver(current)
    try {
      await preload.preload()
    } catch (error) {
      // The preload's rejection may be opaque (a client request can reject
      // with undefined); the Collection's own cause names the failure.
      if (untrack(failed)) throwFailure(current)
      throw error
    } finally {
      preload.dispose()
    }
    // Past the `await` nothing is tracked: these are one-time reads.
    if (untrack(failed)) throwFailure(current)
  })

  function getData() {
    collection()
    if (inputError !== undefined) throw inputError
    if (failed()) throwFailure(collection())
    const current = collection()
    return current && isSingleResultCollection(current) ? data[0] : data
  }

  function gatedData() {
    readiness()
    return getData()
  }

  return Object.defineProperties(getData, {
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
    loaded: {
      get() {
        return gatedData
      },
    },
    ...Object.fromEntries(
      FLAG_KEYS.map((key) => [
        key,
        {
          get() {
            return (flags[key] as Accessor<unknown>)()
          },
        },
      ]),
    ),
  }) as Result<never, never, never>
}
