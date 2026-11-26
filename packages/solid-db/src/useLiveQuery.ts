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
import { createEffect, createMemo, createSignal, from, untrack } from 'solid-js'
import { createRowView } from './row-view'
import type { RowView } from './row-view'
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
 * @returns Accessor that returns the current rows synchronously, with the status flags, `state`, `collection`, and the `loaded` first-data gate
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
 * // Handle loading and error states with boundaries
 * const todosQuery = useLiveQuery((q) => q.from({ todos: todoCollection }))
 *
 * return (
 *   <Errored fallback={(err) => <div>Error: {String(err())}</div>}>
 *     <Loading fallback={<div>Loading...</div>}>
 *       <For each={todosQuery.loaded()}>
 *         {(todo) => <li>{todo.text}</li>}
 *       </For>
 *     </Loading>
 *   </Errored>
 * )
 *
 * @example
 * // Without boundaries: branch on the status flags instead
 * <Switch>
 *   <Match when={todosQuery.isLoadingError || todosQuery.isCrashed}>
 *     <div>Could not load todos</div>
 *   </Match>
 *   <Match when={todosQuery.isLoading}><div>Loading...</div></Match>
 *   <Match when={todosQuery.isReady}>
 *     <For each={todosQuery()}>{(todo) => <li>{todo.text}</li>}</For>
 *   </Match>
 * </Switch>
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): Result<
  InferResultType<TContext>,
  GetResult<TContext>,
  Collection<GetResult<TContext>, string | number, {}>
>

/**
 * Create a live query using a query function that can return `null` or
 * `undefined` to disable the query. The accessor returns no rows, `status` is
 * `disabled`, `isReady` is `true`, and `collection` is `null`.
 * @param queryFn - Query function that defines what data to fetch
 * @returns Accessor that returns the current rows synchronously, with the status flags, `state`, `collection` (`null` while disabled), and the `loaded` first-data gate
 * @example
 * const todosQuery = useLiveQuery((q) =>
 *   enabled() ? q.from({ todos: todosCollection }) : null,
 * )
 */
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
 * @returns Accessor that returns the current rows synchronously, with the status flags, `state`, `collection`, and the `loaded` first-data gate
 * @example
 * const todosQuery = useLiveQuery(() => ({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * }))
 *
 * @example
 * // Handle loading and errors through boundaries
 * const itemsQuery = useLiveQuery(() => ({
 *   query: (q) => q.from({ items: itemCollection })
 * }))
 *
 * return (
 *   <Errored fallback={(err) => <div>Something went wrong: {String(err())}</div>}>
 *     <Loading fallback={<div>Loading...</div>}>
 *       <div>{itemsQuery.loaded().length} items loaded</div>
 *     </Loading>
 *   </Errored>
 * )
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
 * @returns Accessor that returns the current rows synchronously, with the status flags, `state`, `collection`, and the `loaded` first-data gate
 * @example
 * const myLiveQuery = createLiveQueryCollection((q) =>
 *   q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
 * )
 * const todosQuery = useLiveQuery(() => myLiveQuery)
 *
 * @example
 * // Use the collection for mutations
 * const handleToggle = (id: string) => {
 *   todosQuery.collection.update(id, draft => { draft.completed = !draft.completed })
 * }
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

/**
 * Subscribe to an existing single-result live query collection (one built
 * with `findOne`). The accessor returns one row, or `undefined` until there is
 * one.
 * @param liveQueryCollection - Pre-created single-result live query collection to subscribe to
 * @returns Accessor that returns the current row synchronously (`undefined` when there is none), with the status flags, `state`, `collection`, and the `loaded` first-data gate
 * @example
 * const userQuery = useLiveQuery(() => currentUserQuery)
 *
 * return <Show when={userQuery()}>{(user) => <div>{user().name}</div>}</Show>
 */
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
  // A result row's view, beside the key it is in the result by.
  type RowEntry = { key: string | number; row: RowView<object> }
  let observer: ReturnType<typeof createLiveQueryObserver> | undefined

  // `from` turns the observer into a memo: every value below is then derived,
  // never relayed through an effect, so rows and status are consistent at
  // every cut of a flush. The source emits during `subscribe`, so the first
  // read is served without a loading frame, and it closes when the collection
  // is replaced or the owner disposed.
  const snapshot = createMemo(
    () => {
      const current = collection()
      return from<AnySnapshot>((next) => {
        const attached = createLiveQueryObserver(current, {
          mode: `wholesale`,
        })
        observer = attached
        const publish = () => next(attached.getSnapshot())
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
        // `from` closes a superseded source ahead of the pass that replaces
        // it, and otherwise on owner disposal, so the closing observer is
        // still the current one here.
        return () => {
          observer = undefined
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
  const rowsByKey = new Map<string | number, RowEntry>()
  let rowsCollection: unknown
  // The row views of the last publication, in its order.
  let ordered: Array<RowEntry> = []
  // The public keyed view. Created by the first read of `state`, from the
  // rows then current, and kept with them after: a query nobody reads
  // through it never pays for a write per row per publication.
  let keyed: ReactiveMap<string | number, any> | undefined
  const keyedRows = (): ReactiveMap<string | number, any> =>
    (keyed ??= new ReactiveMap(untrack(() => snapshot().state ?? [])))

  // Resolves each row of one snapshot to its view, in result order.
  const resolveRows = (current: AnySnapshot): Array<object> => {
    if (current.collection !== rowsCollection) {
      rowsCollection = current.collection
      rowsByKey.clear()
      ordered = []
      keyed?.clear()
    }
    // A disabled query has no rows.
    const state = current.state
    const rows: Array<object> = new Array(state?.size ?? 0)
    const next: Array<RowEntry> = new Array(rows.length)
    // A publication usually keeps the order: each row is the one the last
    // publication had at its index, and no key is looked up.
    let aligned = true
    let index = 0
    for (const [key, value] of state ?? []) {
      let entry = aligned ? ordered[index] : undefined
      if (entry === undefined || entry.key !== key) {
        aligned = false
        entry = rowsByKey.get(key)
        if (entry === undefined) {
          entry = { key, row: createRowView(value) }
          rowsByKey.set(key, entry)
        }
      }
      entry.row.update(value)
      next[index] = entry
      rows[index] = entry.row.value
      index++
      if (keyed !== undefined && keyed.get(key) !== value) keyed.set(key, value)
    }
    // Every current key is in the map, so a row left only if the map holds
    // more of them than the publication lists.
    if (rowsByKey.size !== index) {
      const present = new Set(state?.keys())
      for (const key of rowsByKey.keys())
        if (!present.has(key)) rowsByKey.delete(key)
      if (keyed !== undefined)
        for (const key of keyed.keys()) if (!present.has(key)) keyed.delete(key)
    }
    ordered = next
    return rows
  }

  const seeded = untrack(() => resolveRows(snapshot()))
  // The rows in result order, and the one signal a reader of the array
  // follows. A row view keeps its identity while its key is in the result,
  // so a slot comes to hold another row only when membership or order
  // changed. That alone turns the signal, and a publication that changed
  // values only leaves every reader of the array asleep: the rows they read
  // notify them themselves.
  const slots: Array<object> = [...seeded]
  const [layout, relayout] = createSignal(0, {
    name: `TanstackDBRows`,
    equals: false,
  })
  const data = new Proxy(slots, {
    get(target, key) {
      layout()
      return Reflect.get(target, key)
    },
    // An enumeration reads the array's keys, not its slots: it follows too.
    ownKeys(target) {
      layout()
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor(target, key) {
      layout()
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    // The Collection orders the rows: the array is read, not written.
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    preventExtensions: () => false,
  })
  createEffect(
    () => snapshot(),
    (current) => {
      const rows = resolveRows(current)
      let moved = rows.length !== slots.length
      for (let index = 0; !moved && index < rows.length; index++)
        moved = rows[index] !== slots[index]
      if (!moved) return
      slots.length = 0
      for (const row of rows) slots.push(row)
      // The value is nothing; the write is.
      relayout(0)
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
  // It is only ever raised for a Collection: a query without one is disabled,
  // and a disabled query is ready and never failed.
  const throwFailure = (current: Collection<any, any, any>) => {
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
    const current = collection()
    if (inputError !== undefined) throw inputError
    if (current && failed()) throwFailure(current)
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
        return keyedRows()
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
