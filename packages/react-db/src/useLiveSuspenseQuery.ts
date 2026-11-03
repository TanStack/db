'use client'

import { useRef } from 'react'
import {
  getSourceObjectToken,
  getStableValueHash,
  rejectLiveQueryInput,
  toBoundaryError,
} from '@tanstack/db'
import { useLiveQueryImpl } from './useLiveQuery'
import { getPreparedSources } from './source-id-bindings'
import type { UseLiveQueryConfig } from './useLiveQuery'
import type {
  Collection,
  Context,
  DbClient,
  GetResult,
  HealthNode,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryObserver,
  LiveQuerySnapshot,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

type SuspenseCollection = Collection<object, string | number, {}>
type SuspenseCollectionEntry = {
  collection: SuspenseCollection
  windowOwner: object
  owner?: SuspenseBinding
  observer?: LiveQueryObserver<object, string | number>
  release: () => void
}

// Retry resources and first-load errors use the same scope without a DbClient.
const unscopedClient = {}
const suspenseCollectionsByClient = new WeakMap<
  object,
  Map<string, SuspenseCollectionEntry>
>()
function getSourceQualifiedSuspenseKey(
  preparedValue: unknown,
  queryHash: string,
  client: DbClient | undefined,
): string {
  const sourceIds = getPreparedSources(
    preparedValue,
    client,
    `useLiveSuspenseQuery`,
  ).map(getSourceObjectToken)
  const {
    query: _query,
    pool: _pool,
    ...options
  } = (preparedValue as { query?: unknown } | null | undefined)?.query
    ? (preparedValue as Record<string, unknown>)
    : {}
  // Local output options qualify pending retry adoption; query identity binds
  // mounted options. Object/function declarations compare by exact runtime reference.
  options.autoIndex ??= `off`
  for (const key in options) {
    const value = options[key]
    if (value === undefined) delete options[key]
    else if (
      value &&
      (typeof value === `object` || typeof value === `function`)
    )
      options[key] = getSourceObjectToken(value)
  }
  return getStableValueHash([sourceIds, options, queryHash])
}

/** Uncommitted retries may adopt work; successful outputs have one owner. */
export class SuspenseBinding {
  private entry?: SuspenseCollectionEntry
  private seed?: LiveQuerySnapshot<object, string | number>
  private seedObserver?: LiveQueryObserver<object, string | number>
  collection?: Collection<any, any, any>
  promise?: Promise<void>
  ready = false

  get needsOwnCollection(): boolean {
    return this.entry !== undefined && this.entry.owner !== this
  }

  resolve(
    input: unknown,
    hash: string,
    client: DbClient | undefined,
    compile: (owned: boolean, windowOwner: object) => SuspenseCollection | null,
  ): SuspenseCollection | null {
    const scope = client ?? unscopedClient
    let cache = suspenseCollectionsByClient.get(scope)
    if (!cache) {
      cache = new Map()
      suspenseCollectionsByClient.set(scope, cache)
    }
    const key = getSourceQualifiedSuspenseKey(input, hash, client)
    const owned = this.entry?.owner === this
    const cached = owned ? undefined : cache.get(key)
    if (cached) return (this.entry = cached).collection

    // A new attempt gets a fresh resolver token. Adoption retains that token;
    // another attempt must not overwrite the adopted Collection's plan.
    const windowOwner = owned ? this.entry!.windowOwner : {}
    const collection = compile(owned, windowOwner)
    if (owned && collection === this.entry!.collection) return collection
    this.seed = undefined
    if (collection && this.entry?.collection !== collection) {
      const release = () => {
        if (cache.get(key) === entry) cache.delete(key)
        removeStatusListener()
      }
      const entry = { collection, windowOwner, release }
      this.entry = entry
      cache.set(key, entry)
      const removeStatusListener = collection.on(
        `status:change`,
        ({ status }) => {
          if (status === `cleaned-up`) release()
          // Preserve failures through React's immediate retry.
          else if (status === `error` || status === `crashed`)
            setTimeout(release, 0)
        },
      )
    }
    return collection
  }

  // The first successful candidate may keep the preload. Other candidates get
  // private outputs seeded from its completed snapshot. Keep the retry entry
  // available until commit, since React can discard a successful candidate.
  forkReady(
    observer: LiveQueryObserver<object, string | number>,
    compile: (owned: boolean, windowOwner: object) => SuspenseCollection | null,
  ): SuspenseCollection | undefined {
    if (!this.entry || this.entry.owner === this) return
    const resource = (this.entry.observer ??= observer)
    const snapshot =
      typeof window === `undefined`
        ? resource.getServerSnapshot(true)
        : resource.getSnapshot()
    if (!snapshot.isReady) return
    if (!this.entry.owner) {
      this.entry.owner = this
      return
    }
    const windowOwner = {}
    const collection = compile(false, windowOwner)
    if (!collection) return
    this.seed = { ...snapshot, collection }
    this.seedObserver = resource
    this.entry = {
      collection,
      windowOwner,
      owner: this,
      release: this.entry.release,
    }
    return collection
  }

  read(snapshot: LiveQuerySnapshot<object, string | number>) {
    if (snapshot.isReady || snapshot.isLoadingError || snapshot.isCrashed) {
      // A copied ready view is provisional until this output's first load.
      // Its failure must end both the seed and the hook's ready latch.
      if (this.seed && snapshot.isLoadingError) this.ready = false
      this.seed = undefined
      this.seedObserver = undefined
    }
    // Keep source health current while the private output acquires its first
    // subset. Its seed rows stay fixed: the successful peer may move its page.
    const source = this.seedObserver?.getSnapshot()
    if (
      this.seed &&
      source?.isReady &&
      (source.health !== this.seed.health ||
        source.isSyncError !== this.seed.isSyncError)
    ) {
      this.seed = {
        ...this.seed,
        health: source.health,
        isSyncError: source.isSyncError,
      }
    }
    return this.seed ?? snapshot
  }

  claim(): (() => void) | undefined {
    // Capture this render's entry: React can replay an older commit's effect
    // after a replacement suspends. That effect must release only its entry.
    return this.entry?.release
  }
}

// React can discard a render that suspends, including its refs. Keep the
// initial-render failure across retries, scoped by client because streamed
// preloads of the same collection can fail independently.
const initialRenderErrors = new WeakMap<
  Collection<any, any, any>,
  WeakMap<object, { error: unknown; clientQuery?: object }>
>()

function clearInitialRenderError(
  collection: Collection<any, any, any>,
  client: DbClient | undefined,
) {
  initialRenderErrors.get(collection)?.delete(client ?? unscopedClient)
}

function rememberInitialRenderError(
  collection: Collection<any, any, any>,
  client: DbClient | undefined,
  error: unknown,
  clientQuery?: object,
) {
  if (collection.status === `cleaned-up`) return
  let entry = initialRenderErrors.get(collection)
  if (!entry) {
    entry = new WeakMap()
    collection.once(`status:cleaned-up`, () => {
      initialRenderErrors.delete(collection)
    })
    initialRenderErrors.set(collection, entry)
  }
  entry.set(client ?? unscopedClient, { error, clientQuery })
}

/**
 * Create a live query with React Suspense support
 * @param queryFn - Query function that defines what data to fetch
 * @returns Object with reactive data and state - data is guaranteed to be defined
 * @throws Promise when data is loading (caught by Suspense boundary)
 * @throws Error when the first load fails or the Collection crashes (caught by
 * an Error boundary): the cause itself when it is an Error, otherwise an Error
 * with the problem's message (`health.error.message`) whose `cause` is the
 * value the sync adapter reported
 * @example
 * // Basic usage with Suspense
 * function TodoList() {
 *   const { data } = useLiveSuspenseQuery({
 *     query: (q) =>
 *       q.from({ todos: todosCollection })
 *        .where(({ todos }) => eq(todos.completed, false))
 *        .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 *   })
 *
 *   return (
 *     <ul>
 *       {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
 *     </ul>
 *   )
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       <TodoList />
 *     </Suspense>
 *   )
 * }
 *
 * @example
 * // Single result query
 * const { data } = useLiveSuspenseQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => eq(todos.id, 1))
 *          .findOne()
 * )
 * // data is guaranteed to be the single item (or undefined if not found)
 *
 * @example
 * // Structured captured values are included in derived query identity and trigger re-suspension
 * const { data } = useLiveSuspenseQuery({
 *   query: (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority)),
 * })
 *
 * @example
 * // With Error boundary
 * function App() {
 *   return (
 *     <ErrorBoundary fallback={<div>Error loading data</div>}>
 *       <Suspense fallback={<div>Loading...</div>}>
 *         <TodoList />
 *       </Suspense>
 *     </ErrorBoundary>
 *   )
 * }
 *
 * @remarks
 * **Important:** This hook does NOT support disabled queries (returning undefined/null).
 * Following TanStack Query's useSuspenseQuery design, the query callback must always
 * return a valid query, collection, or config object.
 *
 * ❌ **This will cause a type error:**
 * ```ts
 * useLiveSuspenseQuery(
 *   (q) => userId ? q.from({ users }) : undefined  // ❌ Error!
 * )
 * ```
 *
 * ✅ **Use conditional rendering instead:**
 * ```ts
 * function Profile({ userId }: { userId: string }) {
 *   const { data } = useLiveSuspenseQuery({
 *     query: (q) => q.from({ users }).where(({ users }) => eq(users.id, userId)),
 *   })
 *   return <div>{data.name}</div>
 * }
 *
 * // In parent component:
 * {userId ? <Profile userId={userId} /> : <div>No user</div>}
 * ```
 *
 * ✅ **For optional inputs, conditionally render a component with complete query inputs:**
 * ```ts
 * {userId ? <Profile userId={userId} /> : <div>No user</div>}
 * ```
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  health: HealthNode | undefined
}

// Overload 2: Accept config object
export function useLiveSuspenseQuery<TContext extends Context>(
  config: UseLiveQueryConfig<TContext>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  health: HealthNode | undefined
}

// Overload 4: Accept pre-created live query collection
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult,
): {
  state: Map<TKey, TResult>
  data: Array<TResult>
  collection: Collection<TResult, TKey, TUtils>
  health: HealthNode | undefined
}

// Overload 5: Accept pre-created live query collection with singleResult: true
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult,
): {
  state: Map<TKey, TResult>
  data: TResult | undefined
  collection: Collection<TResult, TKey, TUtils> & SingleResult
  health: HealthNode | undefined
}

// Implementation - uses useLiveQuery internally and adds Suspense logic
export function useLiveSuspenseQuery(configOrQueryOrCollection: any) {
  const bindingRef = useRef<SuspenseBinding | null>(null)
  const binding = (bindingRef.current ??= new SuspenseBinding())

  // Use useLiveQuery to handle collection management and reactivity
  const { result, client, queryHash, observer, deferredCollections } =
    useLiveQueryImpl(configOrQueryOrCollection, binding)

  if (!result.isEnabled) {
    // Suspense queries cannot be disabled - this matches TanStack Query's useSuspenseQuery behavior
    throw new Error(
      `useLiveSuspenseQuery does not support disabled queries (callback returned undefined/null). ` +
        `The Suspense pattern requires data to always be defined (T, not T | undefined). ` +
        `Solutions: ` +
        `1) Use conditional rendering - don't render the component until the condition is met. ` +
        `2) Use useLiveQuery instead, which supports disabled queries with the 'isEnabled' flag.`,
    )
  }

  // An enabled observer snapshot always has its Collection.
  const collection = result.collection!

  // The render boundary: an error thrown before this render commits releases
  // the sync starts it deferred. A thrown promise suspends; its preload owns
  // those starts.
  try {
    // Reset promise and ready state when query identity changes
    if (binding.collection !== collection) {
      binding.promise = undefined
      binding.collection = collection
      binding.ready = false
    }

    // SUSPENSE LOGIC: Throw promise or error based on collection status

    const collectionStatus = collection.status

    // Track when we reach ready state
    if (result.isReady) {
      binding.ready = true
      binding.promise = undefined
      clearInitialRenderError(collection, client)
    }

    const observerError = observer.getError()
    // A client request can reject with undefined, which getError() cannot
    // distinguish from no error. The request status preserves that distinction.
    const clientQuery =
      client && queryHash ? client._getLiveQuery(queryHash) : undefined
    if (
      !binding.ready &&
      (observerError !== undefined || clientQuery?.status === `error`)
    ) {
      throw observerError === undefined ? clientQuery?.error : observerError
    }

    const initialRenderError = initialRenderErrors
      .get(collection)
      ?.get(client ?? unscopedClient)
    // A replacement client query must not inherit the prior request's error.
    if (
      initialRenderError?.clientQuery !== undefined &&
      initialRenderError.clientQuery !== clientQuery
    ) {
      clearInitialRenderError(collection, client)
    } else if (initialRenderError && !binding.ready) {
      throw toBoundaryError(initialRenderError.error)
    }

    // A failed first load throws only before the first ready; later sync
    // problems surface in `health` with the data kept (as in TanStack Query).
    // A crash throws at any time: the Collection can no longer serve reads.
    if (
      collectionStatus === `crashed` ||
      (collectionStatus === `error` && !binding.ready)
    ) {
      throw toBoundaryError(collection.health.error?.cause)
    }

    if (
      !binding.ready &&
      (result.isLoading ||
        result.isIdle ||
        result.isLoadingError ||
        result.isCrashed)
    ) {
      // Create or reuse promise for current collection
      if (!binding.promise) {
        let active = true
        const stopWatchingCleanup = collection.once(`status:cleaned-up`, () => {
          active = false
        })
        let preload: Promise<void>
        try {
          preload = observer.preload()
        } catch (error) {
          stopWatchingCleanup()
          throw error
        }
        const preloadClientQuery =
          client && queryHash ? client._getLiveQuery(queryHash) : undefined
        binding.promise = preload
          .catch((error: unknown) => {
            const latestClientQuery =
              client && queryHash ? client._getLiveQuery(queryHash) : undefined
            if (active && latestClientQuery === preloadClientQuery)
              rememberInitialRenderError(
                collection,
                client,
                error,
                preloadClientQuery,
              )
            throw error
          })
          .finally(stopWatchingCleanup)
      }
      // React Suspense catches this promise and retries after preload settles.
      throw binding.promise
    }

    // Return data without status/loading flags (handled by Suspense/ErrorBoundary)
    // If error after success, return last known good state (stale data)
    return {
      state: result.state,
      data: result.data,
      collection,
      health: result.health,
    }
  } catch (error) {
    if (error instanceof Promise) throw error
    binding.promise = undefined
    return rejectLiveQueryInput(deferredCollections, error)
  }
}
