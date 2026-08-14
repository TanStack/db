'use client'

import { useRef, useSyncExternalStore } from 'react'
import {
  BaseQueryBuilder,
  UnhashableQueryIRError,
  createLiveQueryCollection,
  createLiveQueryObserver,
  deepEquals,
  getPreparedLiveQueryIdentity,
  getStableValueHash,
  isCollection,
  prepareLiveQueryValue,
} from '@tanstack/db'
import { useOptionalDbClient } from './DbProvider'
import { setLiveQueryResultInfo } from './live-query-internals'
import type {
  Collection,
  CollectionImpl,
  CollectionStatus,
  Context,
  DbClient,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  LiveQueryObserver,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

const DEFAULT_GC_TIME_MS = 1 // Live queries created by useLiveQuery are cleaned up immediately (0 disables GC)
const DERIVED_IDENTITY_SINGLE_RENDER_WARN_MS = 16
const DERIVED_IDENTITY_RENDER_COUNT_WARN_THRESHOLD = 10
const DERIVED_IDENTITY_TOTAL_WARN_MS = 50
const warnedDepsCallsites = new Set<string>()
const warnedDerivedIdentityCallsites = new Set<string>()
const warnedUnhashableIdentityCallsites = new Set<string>()
const unpreparedQueryValue = Symbol(`unpreparedQueryValue`)

export type DerivedIdentityProfiler = {
  renderCount: number
  totalMs: number
  maxMs: number
  warned: boolean
}

export type UseLiveQueryStatus = CollectionStatus | `disabled`
export type LiveQueryKey = ReadonlyArray<unknown>
export type UseLiveQueryConfig<TContext extends Context> =
  LiveQueryCollectionConfig<TContext> & {
    /**
     * Explicit identity for queries that contain opaque functional variants or
     * are hot enough that deriving identity from structured IR is too expensive.
     * Structured queries should omit this so DB can derive identity directly.
     */
    queryKey?: LiveQueryKey
    /** Override the nearest DbProvider for this query. */
    client?: DbClient
  }

export function warnDeprecatedDepsArray(
  hookName: `useLiveQuery` | `useLiveInfiniteQuery` = `useLiveQuery`,
): void {
  if (!shouldWarnInDevelopment(`TANSTACK_DB_DISABLE_DEPRECATION_WARNINGS`)) {
    return
  }

  const callsite = getWarningCallsite(4)
  if (warnedDepsCallsites.has(callsite)) {
    return
  }
  warnedDepsCallsites.add(callsite)
  const replacement =
    hookName === `useLiveQuery`
      ? `useLiveQuery({ query })`
      : `useLiveInfiniteQuery(query, { queryKey })`
  console.warn(
    `[${hookName}] The dependency-array form is deprecated and will be removed in 1.0. Use ${replacement} instead. Provide queryKey only for functional/opaque queries or to avoid deriving identity from structured query IR on render.`,
  )
}

function shouldWarnInDevelopment(disableEnvVar: string): boolean {
  if (typeof process === `undefined`) {
    return false
  }

  return (
    process.env.NODE_ENV !== `production` && process.env[disableEnvVar] !== `1`
  )
}

function getCurrentTime(): number {
  return typeof performance !== `undefined` &&
    typeof performance.now === `function`
    ? performance.now()
    : Date.now()
}

function getWarningCallsite(stackIndex: number): string {
  const stack = new Error().stack ?? `unknown`
  return stack.split(`\n`)[stackIndex]?.trim() ?? stack
}

function warnDerivedIdentityHotPath(
  profiler: DerivedIdentityProfiler,
  durationMs: number,
): void {
  if (
    profiler.warned ||
    !shouldWarnInDevelopment(`TANSTACK_DB_DISABLE_QUERY_IDENTITY_WARNINGS`)
  ) {
    return
  }

  const isSlowSingleRender =
    durationMs >= DERIVED_IDENTITY_SINGLE_RENDER_WARN_MS
  const isHotRenderPath =
    profiler.renderCount >= DERIVED_IDENTITY_RENDER_COUNT_WARN_THRESHOLD &&
    profiler.totalMs >= DERIVED_IDENTITY_TOTAL_WARN_MS

  if (!isSlowSingleRender && !isHotRenderPath) {
    return
  }

  const callsite = getWarningCallsite(5)
  if (warnedDerivedIdentityCallsites.has(callsite)) {
    profiler.warned = true
    return
  }

  warnedDerivedIdentityCallsites.add(callsite)
  profiler.warned = true

  const reason = isSlowSingleRender
    ? `one render took ${durationMs.toFixed(1)}ms`
    : `${profiler.renderCount} renders took ${profiler.totalMs.toFixed(1)}ms`

  console.warn(
    `[useLiveQuery] Deriving live query identity from structured query IR is running on a hot render path (${reason}, max ${profiler.maxMs.toFixed(1)}ms). ` +
      `Provide an explicit queryKey to skip rebuilding and hashing the IR on every render: useLiveQuery({ queryKey: [...], query }).`,
  )
}

function getExplicitQueryKey(value: unknown): LiveQueryKey | undefined {
  return value &&
    typeof value === `object` &&
    Array.isArray((value as { queryKey?: unknown }).queryKey)
    ? (value as { queryKey: LiveQueryKey }).queryKey
    : undefined
}

function getExplicitDbClient(value: unknown): DbClient | undefined {
  return value &&
    typeof value === `object` &&
    `client` in value &&
    (value as { client?: unknown }).client !== undefined
    ? (value as { client: DbClient }).client
    : undefined
}

export function prepareQueryValue(
  value: unknown,
  dbClient: DbClient | undefined,
  deferredCollections: Set<CollectionImpl<any, string | number, any, any, any>>,
): unknown {
  return prepareLiveQueryValue(value, dbClient, deferredCollections)
}

type DerivedQueryPreparation =
  | {
      status: `hashable`
      value: unknown
      identityDeps: Array<unknown>
    }
  | {
      status: `unhashable`
      value: unknown
      error: UnhashableQueryIRError
    }

export function prepareDerivedQuery(
  value: unknown,
  dbClient: DbClient | undefined,
  profiler: DerivedIdentityProfiler,
  deferredCollections: Set<CollectionImpl<any, string | number, any, any, any>>,
): DerivedQueryPreparation {
  const shouldProfile = shouldWarnInDevelopment(
    `TANSTACK_DB_DISABLE_QUERY_IDENTITY_WARNINGS`,
  )
  const start = shouldProfile ? getCurrentTime() : 0
  const preparedValue = prepareQueryValue(value, dbClient, deferredCollections)

  try {
    const identity = getPreparedLiveQueryIdentity(preparedValue)
    return {
      status: `hashable`,
      value: preparedValue,
      identityDeps: [`derived`, identity],
    }
  } catch (error) {
    if (error instanceof UnhashableQueryIRError) {
      return { status: `unhashable`, value: preparedValue, error }
    }

    throw error
  } finally {
    if (shouldProfile) {
      const durationMs = getCurrentTime() - start
      profiler.renderCount += 1
      profiler.totalMs += durationMs
      profiler.maxMs = Math.max(profiler.maxMs, durationMs)
      warnDerivedIdentityHotPath(profiler, durationMs)
    }
  }
}

export function warnUnhashableDerivedIdentity(
  error: UnhashableQueryIRError,
): void {
  if (!shouldWarnInDevelopment(`TANSTACK_DB_DISABLE_QUERY_IDENTITY_WARNINGS`)) {
    return
  }

  const callsite = getWarningCallsite(4)
  if (warnedUnhashableIdentityCallsites.has(callsite)) {
    return
  }
  warnedUnhashableIdentityCallsites.add(callsite)

  console.warn(
    `[useLiveQuery] This query cannot derive a stable identity because ${error.reason} at ${error.path}. ` +
      `It will keep the legacy mount-stable behavior for now. Add queryKey: [...] to make captured values reactive. ` +
      `Unhashable queries without queryKey will throw in 1.0.`,
  )
}

function createCollectionFromPreparedQuery(value: unknown) {
  if (value === undefined || value === null) {
    return null
  }

  if (isCollection(value)) {
    value.startSyncImmediate()
    return value
  }

  if (value instanceof BaseQueryBuilder) {
    return createLiveQueryCollection({
      query: value,
      startSync: true,
      gcTime: DEFAULT_GC_TIME_MS,
    })
  }

  if (typeof value === `object`) {
    return createLiveQueryCollection({
      startSync: true,
      gcTime: DEFAULT_GC_TIME_MS,
      ...(value as LiveQueryCollectionConfig<any>),
    })
  }

  throw new Error(
    `useLiveQuery callback must return a QueryBuilder, LiveQueryCollectionConfig, Collection, undefined, or null. Got: ${typeof value}`,
  )
}

/**
 * Create a live query using a query function.
 * @param queryFn - Query function that defines what data to fetch
 * @param deps - Deprecated array of dependencies that trigger query re-execution when changed
 * @returns Object with reactive data, state, and status information
 * @example
 * // Prefer config object syntax
 * const { data, isLoading } = useLiveQuery({
 *   query: (q) =>
 *     q.from({ todos: todosCollection })
 *      .where(({ todos }) => eq(todos.completed, false))
 *      .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * })
 *
 *  @example
 * // Single result query
 * const { data } = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => eq(todos.id, 1))
 *          .findOne()
 * })
 *
 * @example
 * // Structured captured values are included in derived query identity
 * const { data, state } = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority)),
 * })
 *
 * @example
 * // Join pattern
 * const { data } = useLiveQuery({
 *   query: (q) =>
 *     q.from({ issues: issueCollection })
 *      .join({ persons: personCollection }, ({ issues, persons }) =>
 *        eq(issues.userId, persons.id)
 *      )
 *      .select(({ issues, persons }) => ({
 *        id: issues.id,
 *        title: issues.title,
 *        userName: persons.name
 *      }))
 * })
 *
 * @example
 * // Handle loading and error states
 * const { data, isLoading, isError, status } = useLiveQuery({
 *   query: (q) => q.from({ todos: todoCollection })
 * })
 *
 * if (isLoading) return <div>Loading...</div>
 * if (isError) return <div>Error: {status}</div>
 *
 * return (
 *   <ul>
 *     {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
 *   </ul>
 * )
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus // Can't be disabled if always returns QueryBuilder
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true if always returns QueryBuilder
}

// Overload 2: Accept query function that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
  deps?: Array<unknown>,
): {
  state: Map<string | number, GetResult<TContext>> | undefined
  data: InferResultType<TContext> | undefined
  collection: Collection<GetResult<TContext>, string | number, {}> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

// Overload 3: Accept query function that can return LiveQueryCollectionConfig
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => LiveQueryCollectionConfig<TContext> | undefined | null,
  deps?: Array<unknown>,
): {
  state: Map<string | number, GetResult<TContext>> | undefined
  data: InferResultType<TContext> | undefined
  collection: Collection<GetResult<TContext>, string | number, {}> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

// Overload 4: Accept query function that can return Collection
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => Collection<TResult, TKey, TUtils> | undefined | null,
  deps?: Array<unknown>,
): {
  state: Map<TKey, TResult> | undefined
  data: Array<TResult> | undefined
  collection: Collection<TResult, TKey, TUtils> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

// Overload 5: Accept query function that can return all types
export function useLiveQuery<
  TContext extends Context,
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  queryFn: (
    q: InitialQueryBuilder,
  ) =>
    | QueryBuilder<TContext>
    | LiveQueryCollectionConfig<TContext>
    | Collection<TResult, TKey, TUtils>
    | undefined
    | null,
  deps?: Array<unknown>,
): {
  state:
    | Map<string | number, GetResult<TContext>>
    | Map<TKey, TResult>
    | undefined
  data: InferResultType<TContext> | Array<TResult> | undefined
  collection:
    | Collection<GetResult<TContext>, string | number, {}>
    | Collection<TResult, TKey, TUtils>
    | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @param deps - Deprecated array of dependencies that trigger query re-execution when changed
 * @returns Object with reactive data, state, and status information
 * @example
 * // Basic config object usage
 * const { data, status } = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * })
 *
 * @example
 * // With query builder and options
 * const queryBuilder = new Query()
 *   .from({ persons: collection })
 *   .where(({ persons }) => gt(persons.age, 30))
 *   .select(({ persons }) => ({ id: persons.id, name: persons.name }))
 *
 * const { data, isReady } = useLiveQuery({
 *   query: queryBuilder,
 * })
 *
 * @example
 * // Handle all states uniformly
 * const { data, isLoading, isReady, isError } = useLiveQuery({
 *   query: (q) => q.from({ items: itemCollection })
 * })
 *
 * if (isLoading) return <div>Loading...</div>
 * if (isError) return <div>Something went wrong</div>
 * if (!isReady) return <div>Preparing...</div>
 *
 * return <div>{data.length} items loaded</div>
 */
// Overload 6: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: UseLiveQueryConfig<TContext>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus // Can't be disabled for config objects
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true for config objects
}

// Overload 7: Accept config object with legacy deps
export function useLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus // Can't be disabled for config objects
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true for config objects
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
 * const { data, collection } = useLiveQuery(myLiveQuery)
 *
 * @example
 * // Access collection methods directly
 * const { data, collection, isReady } = useLiveQuery(existingCollection)
 *
 * // Use collection for mutations
 * const handleToggle = (id) => {
 *   collection.update(id, draft => { draft.completed = !draft.completed })
 * }
 *
 * @example
 * // Handle states consistently
 * const { data, isLoading, isError } = useLiveQuery(sharedCollection)
 *
 * if (isLoading) return <div>Loading...</div>
 * if (isError) return <div>Error loading data</div>
 *
 * return <div>{data.map(item => <Item key={item.id} {...item} />)}</div>
 */
// Overload 8: Accept pre-created live query collection
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult,
): {
  state: Map<TKey, TResult>
  data: Array<TResult>
  collection: Collection<TResult, TKey, TUtils>
  status: CollectionStatus // Can't be disabled for pre-created live query collections
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true for pre-created live query collections
}

// Overload 9: Accept pre-created live query collection with singleResult: true
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult,
): {
  state: Map<TKey, TResult>
  data: TResult | undefined
  collection: Collection<TResult, TKey, TUtils> & SingleResult
  status: CollectionStatus // Can't be disabled for pre-created live query collections
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true for pre-created live query collections
}

// Implementation - use function overloads to infer the actual collection type
export function useLiveQuery(
  configOrQueryOrCollection: any,
  deps?: Array<unknown>,
) {
  const contextDbClient = useOptionalDbClient()
  // Check if it's already a collection
  const inputIsCollection = isCollection(configOrQueryOrCollection)
  const dbClient = inputIsCollection
    ? contextDbClient
    : (getExplicitDbClient(configOrQueryOrCollection) ?? contextDbClient)
  const resolvedDeps = deps ?? []

  // Use refs to cache collection and track dependencies
  const collectionRef = useRef<Collection<object, string | number, {}> | null>(
    null,
  )
  const depsRef = useRef<Array<unknown> | null>(null)
  const configRef = useRef<unknown>(null)
  const clientRef = useRef(dbClient)
  const legacyUnhashableIdentityRef = useRef<Array<unknown>>([
    `legacy-unhashable`,
  ])

  const derivedIdentityProfilerRef = useRef<DerivedIdentityProfiler>({
    renderCount: 0,
    totalMs: 0,
    maxMs: 0,
    warned: false,
  })
  const deferredCollectionsRef = useRef(
    new Set<CollectionImpl<any, string | number, any, any, any>>(),
  )
  const observerRef = useRef<LiveQueryObserver<object, string | number> | null>(
    null,
  )

  const queryKey = !inputIsCollection
    ? getExplicitQueryKey(configOrQueryOrCollection)
    : undefined
  let preparedQueryValue: unknown | typeof unpreparedQueryValue =
    unpreparedQueryValue
  let identityDeps: ReadonlyArray<unknown>
  let streamIdentity: unknown = undefined
  let identityError: UnhashableQueryIRError | undefined

  if (queryKey) {
    identityDeps = queryKey
    streamIdentity = [`queryKey`, queryKey]
  } else if (deps !== undefined) {
    identityDeps = resolvedDeps
    streamIdentity = [`deps`, resolvedDeps]
  } else if (inputIsCollection) {
    identityDeps = []
    streamIdentity = [`collection`, configOrQueryOrCollection.id]
  } else {
    const preparation = prepareDerivedQuery(
      configOrQueryOrCollection,
      dbClient,
      derivedIdentityProfilerRef.current,
      deferredCollectionsRef.current,
    )
    preparedQueryValue = preparation.value
    if (preparation.status === `hashable`) {
      identityDeps = preparation.identityDeps
      streamIdentity = preparation.identityDeps
    } else {
      warnUnhashableDerivedIdentity(preparation.error)
      identityDeps = legacyUnhashableIdentityRef.current
      identityError = preparation.error
    }
  }

  let queryHash: string | undefined
  if (streamIdentity !== undefined) {
    try {
      queryHash = getStableValueHash(streamIdentity, `queryKey`)
    } catch (error) {
      if (error instanceof UnhashableQueryIRError) {
        if (queryKey !== undefined) throw error
        identityError = error
      } else {
        throw error
      }
    }
  }

  if (deps !== undefined) {
    warnDeprecatedDepsArray()
  }

  const identityChanged =
    depsRef.current === null ||
    (deps !== undefined
      ? depsRef.current.length !== identityDeps.length ||
        depsRef.current.some((dep, index) => dep !== identityDeps[index])
      : !deepEquals(depsRef.current, identityDeps))

  // Check if we need to create/recreate the collection
  const needsNewCollection =
    !collectionRef.current ||
    (inputIsCollection && configRef.current !== configOrQueryOrCollection) ||
    (!inputIsCollection && (clientRef.current !== dbClient || identityChanged))

  const resumeDeferredCollections = () => {
    for (const collection of deferredCollectionsRef.current) {
      collection._resumeSyncStart()
    }
    deferredCollectionsRef.current.clear()
  }

  if (needsNewCollection) {
    if (inputIsCollection) {
      // Warn when passing a collection directly with on-demand sync mode
      // In on-demand mode, data is only loaded when queries with predicates request it
      // Passing the collection directly doesn't provide any predicates, so no data loads
      const syncMode = (
        configOrQueryOrCollection as { config?: { syncMode?: string } }
      ).config?.syncMode
      if (
        syncMode === `on-demand` &&
        shouldWarnInDevelopment(`TANSTACK_DB_DISABLE_QUERY_IDENTITY_WARNINGS`)
      ) {
        console.warn(
          `[useLiveQuery] Warning: Passing a collection with syncMode "on-demand" directly to useLiveQuery ` +
            `will not load any data. In on-demand mode, data is only loaded when queries with predicates request it.\n\n` +
            `Instead, use a query builder function:\n` +
            `  const { data } = useLiveQuery({ query: (q) => q.from({ c: myCollection }).select(({ c }) => c) })\n\n` +
            `Or switch to syncMode "eager" if you want all data to sync automatically.`,
        )
      }
      // It's already a collection, ensure sync is started for React hooks
      configOrQueryOrCollection.startSyncImmediate()
      collectionRef.current = configOrQueryOrCollection
      configRef.current = configOrQueryOrCollection
    } else {
      if (preparedQueryValue === unpreparedQueryValue) {
        preparedQueryValue = prepareQueryValue(
          configOrQueryOrCollection,
          dbClient,
          deferredCollectionsRef.current,
        )
      }
      collectionRef.current = createCollectionFromPreparedQuery(
        preparedQueryValue,
      ) as Collection<object, string | number, {}>
      configRef.current = configOrQueryOrCollection
      depsRef.current = [...identityDeps]
    }
    clientRef.current = dbClient
  }

  // Recreate the observer when the underlying collection changes. The observer
  // is not disposed explicitly here or on unmount: `useSyncExternalStore`
  // unsubscribes it when the subscribe changes or the component unmounts, which
  // detaches the collection subscription; the observer is then GC'd. (An unmount
  // effect that disposed it would misfire under StrictMode/offscreen effect
  // replay, leaving a disposed observer in the ref.)
  if (needsNewCollection) {
    // Defer the initial notify: useSyncExternalStore must not be notified
    // synchronously during subscribe.
    // Wholesale mode: React re-reads getSnapshot() on notify, keeps the
    // hook's pre-observer loading policy, and — because wholesale delivers
    // nothing synchronously during subscribe — never notifies
    // useSyncExternalStore inside its own subscribe call.
    observerRef.current = createLiveQueryObserver(collectionRef.current, {
      mode: `wholesale`,
      client: dbClient,
      queryHash,
      onPreload: resumeDeferredCollections,
    })
  }
  const observer = observerRef.current!

  // Stable subscribe bound to the current observer; the observer owns the
  // subscription, ready-race, and disposal.
  const subscribeRef = useRef<
    ((onStoreChange: () => void) => () => void) | null
  >(null)
  if (!subscribeRef.current || needsNewCollection) {
    subscribeRef.current = (onStoreChange: () => void) => {
      const unsubscribe = observer.subscribe(() => onStoreChange())
      resumeDeferredCollections()
      return unsubscribe
    }
  }

  const returned = useSyncExternalStore(
    subscribeRef.current,
    () => observer.getSnapshot(),
    () => observer.getServerSnapshot(),
  )
  setLiveQueryResultInfo(returned, {
    client: dbClient,
    queryHash,
    identityError,
    observer,
  })
  return returned as any
}
