'use client'

import { useRef, useSyncExternalStore } from 'react'
import {
  UnhashableQueryIRError,
  createLiveQueryObserver,
  deepEquals,
  getPreparedLiveQueryIdentity,
  getStableValueHash,
  isCollection,
  prepareLiveQueryValue,
  resolveLiveQueryValue,
} from '@tanstack/db'
import { useOptionalDbClient } from './DbProvider'
import { setLiveQueryResultInfo } from './live-query-internals'
import { shouldWarnInDevelopment } from './development'
import {
  claimSourceIds,
  createSourceIdBindings,
  getPreparedSources,
  getSourceObjectToken,
  resumeSyncStarts,
} from './source-id-bindings'
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
  LiveQueryPersistedStatus,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

const DEFAULT_GC_TIME_MS = 1 // Live queries created by useLiveQuery are cleaned up immediately (0 disables GC)
// Suspense renders can be abandoned before React subscribes. Keep their
// collection briefly so a nearby retry can commit without starting over.
const DEFAULT_SUSPENSE_GC_TIME_MS = 5000
const DERIVED_IDENTITY_SINGLE_RENDER_WARN_MS = 16
const DERIVED_IDENTITY_RENDER_COUNT_WARN_THRESHOLD = 10
const DERIVED_IDENTITY_TOTAL_WARN_MS = 50
const warnedDerivedIdentityCallsites = new Set<string>()
const unpreparedQueryValue = Symbol(`unpreparedQueryValue`)

type SuspenseCollection = Collection<object, string | number, {}>
type SuspenseCollectionEntry = {
  collection: SuspenseCollection
  removeStatusListeners: () => void
}

const unscopedSuspenseCollections = new Map<string, SuspenseCollectionEntry>()
const suspenseCollectionsByClient = new WeakMap<
  DbClient,
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
  if (sourceIds.length === 0) return queryHash
  return `${sourceIds.join(`,`)}:${queryHash}`
}

function getSuspenseCollections(
  client: DbClient | undefined,
): Map<string, SuspenseCollectionEntry> {
  if (!client) return unscopedSuspenseCollections
  let collections = suspenseCollectionsByClient.get(client)
  if (!collections) {
    collections = new Map()
    suspenseCollectionsByClient.set(client, collections)
  }
  return collections
}

function releaseSuspenseCollection(
  collections: Map<string, SuspenseCollectionEntry>,
  queryHash: string,
  collection: SuspenseCollection,
): void {
  const entry = collections.get(queryHash)
  if (entry?.collection !== collection) return
  collections.delete(queryHash)
  entry.removeStatusListeners()
}

export type DerivedIdentityProfiler = {
  renderCount: number
  totalMs: number
  maxMs: number
  warned: boolean
}

export type UseLiveQueryStatus = CollectionStatus | `disabled`
export type LiveQueryKey = ReadonlyArray<unknown>
type UseLiveQueryConfigOptions<TContext extends Context> = Omit<
  LiveQueryCollectionConfig<TContext>,
  `query`
> & {
  /**
   * Explicit identity for queries that contain opaque functional variants or
   * are hot enough that deriving identity from structured IR is too expensive.
   * Structured queries should omit this so DB can derive identity directly.
   */
  queryKey?: LiveQueryKey
  /** Override the nearest DbProvider for this query. */
  client?: DbClient
}

type ConfiguredQueryBuilder<TContext extends Context> = Extract<
  LiveQueryCollectionConfig<TContext>[`query`],
  QueryBuilder<TContext>
>

export type UseLiveQueryConfig<TContext extends Context> =
  UseLiveQueryConfigOptions<TContext> &
    Pick<LiveQueryCollectionConfig<TContext>, `query`>

export type ConditionalUseLiveQueryConfig<TContext extends Context> =
  UseLiveQueryConfigOptions<TContext> & {
    query:
      | ConfiguredQueryBuilder<TContext>
      | ((
          q: InitialQueryBuilder,
        ) => ConfiguredQueryBuilder<TContext> | undefined | null)
  }

function getCurrentTime(): number {
  return typeof performance !== `undefined` &&
    typeof performance.now === `function`
    ? performance.now()
    : Date.now()
}

function getWarningCallsite(stackIndex: number): string {
  const stack = new Error().stack ?? `unknown`
  const lines = stack.split(`\n`)
  const userFrame = lines
    .slice(1)
    .find(
      (line) =>
        !line.includes(`useLiveQuery.ts`) &&
        !line.includes(`useLiveSuspenseQuery.ts`) &&
        !line.includes(`useLiveInfiniteQuery.ts`),
    )
  return userFrame?.trim() ?? lines[stackIndex]?.trim() ?? stack
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

type DerivedQueryPreparation = {
  value: unknown
  identityDeps: Array<unknown>
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
    return { value: preparedValue, identityDeps: [`derived`, identity] }
  } catch (error) {
    if (error instanceof UnhashableQueryIRError)
      throw new Error(
        `Cannot derive a stable live query identity because ${error.reason} appears at ${error.path}. Provide a serializable queryKey.`,
        { cause: error },
      )
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

/**
 * Create a live query using a query function.
 * @param queryFn - Query function that defines what data to fetch
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
 * // Return undefined or null to disable a query
 * const { data, isEnabled } = useLiveQuery({
 *   query: (q) => {
 *     if (!userId) return undefined
 *     return q.from({ todos: todosCollection })
 *             .where(({ todos }) => eq(todos.userId, userId))
 *   },
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
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus // Can't be disabled if always returns QueryBuilder
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
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
): {
  state: Map<string | number, GetResult<TContext>> | undefined
  data: InferResultType<TContext> | undefined
  collection: Collection<GetResult<TContext>, string | number, {}> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
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
): {
  state: Map<string | number, GetResult<TContext>> | undefined
  data: InferResultType<TContext> | undefined
  collection: Collection<GetResult<TContext>, string | number, {}> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
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
): {
  state: Map<TKey, TResult> | undefined
  data: Array<TResult> | undefined
  collection: Collection<TResult, TKey, TUtils> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
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
): {
  state:
    Map<string | number, GetResult<TContext>> | Map<TKey, TResult> | undefined
  data: InferResultType<TContext> | Array<TResult> | undefined
  collection:
    | Collection<GetResult<TContext>, string | number, {}>
    | Collection<TResult, TKey, TUtils>
    | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
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
  status: CollectionStatus // Can't be disabled when query always returns a builder
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true when query always returns a builder
}

// Overload 7: Accept config object with a query that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  config: ConditionalUseLiveQueryConfig<TContext>,
): {
  state: Map<string | number, GetResult<TContext>> | undefined
  data: InferResultType<TContext> | undefined
  collection: Collection<GetResult<TContext>, string | number, {}> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
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
// Overload 10: Accept pre-created live query collection
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
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true for pre-created live query collections
}

// Overload 10: Accept pre-created live query collection with singleResult: true
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
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true // Always true for pre-created live query collections
}

// Implementation - use function overloads to infer the actual collection type
export function useLiveQuery(configOrQueryOrCollection: any) {
  return useLiveQueryImpl(configOrQueryOrCollection)
}

/** @internal Shared implementation for the Suspense wrapper. */
export function useLiveQueryForSuspense(configOrQueryOrCollection: any) {
  return useLiveQueryImpl(configOrQueryOrCollection, true)
}

// What one hook instance keeps across renders. It lives in a single ref
// slot, so a render neither looks up nor allocates more.
function createHookInstance(dbClient: DbClient | undefined) {
  return {
    collection: null as Collection<object, string | number, {}> | null,
    identityDeps: null as Array<unknown> | null,
    config: null as unknown,
    client: dbClient,
    derivedIdentityProfiler: {
      renderCount: 0,
      totalMs: 0,
      maxMs: 0,
      warned: false,
    } as DerivedIdentityProfiler,
    deferredCollections: new Set<
      CollectionImpl<any, string | number, any, any, any>
    >(),
    sourceIds: createSourceIdBindings(),
    observer: null as LiveQueryObserver<object, string | number> | null,
    queryHash: undefined as string | undefined,
    suspenseKey: undefined as string | undefined,
    subscribe: null as ((onStoreChange: () => void) => () => void) | null,
  }
}

function useLiveQueryImpl(configOrQueryOrCollection: any, forSuspense = false) {
  const contextDbClient = useOptionalDbClient()
  // Check if it's already a collection
  const inputIsCollection = isCollection(configOrQueryOrCollection)
  const dbClient = inputIsCollection
    ? contextDbClient
    : (getExplicitDbClient(configOrQueryOrCollection) ?? contextDbClient)

  const instanceRef = useRef<ReturnType<typeof createHookInstance> | null>(null)
  const instance = (instanceRef.current ??= createHookInstance(dbClient))
  const resumeDeferredCollections = () =>
    resumeSyncStarts(instance.deferredCollections)

  const queryKey = !inputIsCollection
    ? getExplicitQueryKey(configOrQueryOrCollection)
    : undefined
  let preparedQueryValue: unknown | typeof unpreparedQueryValue =
    unpreparedQueryValue
  let identityDeps: ReadonlyArray<unknown>
  let streamIdentity: unknown = undefined

  let queryHash: string
  try {
    if (queryKey) {
      identityDeps = queryKey
      streamIdentity = [`queryKey`, queryKey]
    } else if (inputIsCollection) {
      identityDeps = []
      streamIdentity = [`collection`, configOrQueryOrCollection.id]
    } else {
      const preparation = prepareDerivedQuery(
        configOrQueryOrCollection,
        dbClient,
        instance.derivedIdentityProfiler,
        instance.deferredCollections,
      )
      preparedQueryValue = preparation.value
      identityDeps = preparation.identityDeps
      streamIdentity = preparation.identityDeps
    }

    queryHash = getStableValueHash(streamIdentity, `queryKey`)

    if (queryKey === undefined && preparedQueryValue !== unpreparedQueryValue) {
      claimSourceIds(
        instance.sourceIds,
        preparedQueryValue,
        dbClient,
        `useLiveQuery`,
        resumeDeferredCollections,
      )
    }
  } catch (error) {
    resumeDeferredCollections()
    throw error
  }

  const canReuseSuspenseKey =
    forSuspense &&
    !inputIsCollection &&
    instance.collection !== null &&
    instance.client === dbClient &&
    instance.queryHash === queryHash &&
    instance.suspenseKey !== undefined

  if (
    forSuspense &&
    !inputIsCollection &&
    !canReuseSuspenseKey &&
    preparedQueryValue === unpreparedQueryValue
  ) {
    preparedQueryValue = prepareQueryValue(
      configOrQueryOrCollection,
      dbClient,
      instance.deferredCollections,
    )
  }

  const suspenseKey =
    forSuspense && !inputIsCollection
      ? canReuseSuspenseKey
        ? instance.suspenseKey!
        : getSourceQualifiedSuspenseKey(preparedQueryValue, queryHash, dbClient)
      : queryHash

  const suspenseCollections =
    forSuspense && !inputIsCollection
      ? getSuspenseCollections(dbClient)
      : undefined
  const suspenseEntry = suspenseCollections?.get(suspenseKey)
  const suspenseCollection = suspenseEntry?.collection

  const identityChanged =
    instance.identityDeps === null ||
    !deepEquals(instance.identityDeps, identityDeps)

  // Check if we need to create/recreate the collection
  const needsNewCollection =
    !instance.collection ||
    (inputIsCollection && instance.config !== configOrQueryOrCollection) ||
    (!inputIsCollection && (instance.client !== dbClient || identityChanged))

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
      instance.collection = configOrQueryOrCollection
      instance.config = configOrQueryOrCollection
    } else {
      if (suspenseCollection) {
        instance.collection = suspenseCollection
      } else {
        if (preparedQueryValue === unpreparedQueryValue) {
          preparedQueryValue = prepareQueryValue(
            configOrQueryOrCollection,
            dbClient,
            instance.deferredCollections,
          )
        }
        if (!dbClient) {
          getPreparedSources(preparedQueryValue, dbClient, `useLiveQuery`)
        }
        instance.collection = resolveLiveQueryValue(preparedQueryValue, {
          gcTime: forSuspense
            ? DEFAULT_SUSPENSE_GC_TIME_MS
            : DEFAULT_GC_TIME_MS,
          // Hydration and Suspense key the live-query Collection by identity.
          pool: !forSuspense && !dbClient,
          // Without a DbClient, Suspense starts it through a preload below.
          startSync: !forSuspense || dbClient !== undefined,
        }) as SuspenseCollection | null
        if (suspenseCollections && suspenseKey && instance.collection) {
          const collection = instance.collection
          const removeCleanupListener = collection.on(`status:cleaned-up`, () =>
            releaseSuspenseCollection(
              suspenseCollections,
              suspenseKey,
              collection,
            ),
          )
          const removeErrorListener = collection.on(`status:error`, () => {
            // Keep the failed collection through React's immediate retry so
            // the hook can throw its actual load error to an ErrorBoundary.
            // Retire it afterward so a later boundary reset starts fresh.
            setTimeout(
              () =>
                releaseSuspenseCollection(
                  suspenseCollections,
                  suspenseKey,
                  collection,
                ),
              0,
            )
          })
          const entry: SuspenseCollectionEntry = {
            collection,
            removeStatusListeners: () => {
              removeCleanupListener()
              removeErrorListener()
            },
          }
          suspenseCollections.set(suspenseKey, entry)
        }
      }
      instance.config = configOrQueryOrCollection
      instance.identityDeps = [...identityDeps]
    }
    instance.client = dbClient
    instance.queryHash = queryHash
    instance.suspenseKey = suspenseKey
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
    instance.observer = createLiveQueryObserver(instance.collection, {
      mode: `wholesale`,
      client: dbClient,
      queryHash: instance.queryHash,
      onPreload: resumeDeferredCollections,
    })
  }
  const observer = instance.observer!
  // A Suspense render asks for its data. Preloading starts the sync run, so a
  // source that already holds the rows makes it ready before the snapshot is
  // read instead of suspending once. useLiveSuspenseQuery surfaces failures.
  // A DbClient defers source starts past render and owns its streamed query.
  if (
    forSuspense &&
    !dbClient &&
    (instance.collection?.status === `idle` ||
      instance.collection?.status === `cleaned-up`)
  ) {
    observer.preloadForInitialRender().catch(() => {})
  }

  // Stable subscribe bound to the current observer; the observer owns the
  // subscription, ready-race, and disposal.
  if (!instance.subscribe || needsNewCollection) {
    instance.subscribe = (onStoreChange: () => void) => {
      const unsubscribe = observer.subscribe(onStoreChange)
      resumeDeferredCollections()
      return unsubscribe
    }
  }

  const returned = useSyncExternalStore(
    instance.subscribe,
    () => observer.getSnapshot(),
    () => observer.getServerSnapshot(),
  )
  // Only useLiveSuspenseQuery reads this, and it costs a define per render.
  if (forSuspense) {
    setLiveQueryResultInfo(returned, {
      client: dbClient,
      queryHash,
      observer,
    })
  }
  return returned as any
}
