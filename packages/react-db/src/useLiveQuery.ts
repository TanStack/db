import { useRef, useSyncExternalStore } from 'react'
import {
  BaseQueryBuilder,
  CollectionImpl,
  UnhashableQueryIRError,
  createLiveQueryCollection,
  deepEquals,
  getStableQueryBuilderHash,
} from '@tanstack/db'
import { useOptionalDbClient } from './DbProvider'
import type {
  Collection,
  CollectionConfigSingleRowOption,
  CollectionOptions,
  CollectionStatus,
  Context,
  DbClient,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
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

type DerivedIdentityProfiler = {
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
  }

function warnDeprecatedDepsArray(): void {
  if (!shouldWarnInDevelopment(`TANSTACK_DB_DISABLE_DEPRECATION_WARNINGS`)) {
    return
  }

  const callsite = getWarningCallsite(4)
  if (warnedDepsCallsites.has(callsite)) {
    return
  }
  warnedDepsCallsites.add(callsite)
  console.warn(
    `[useLiveQuery] The dependency-array form useLiveQuery(query, deps) is deprecated and will be removed in 1.0. Use useLiveQuery({ query }) instead. Provide queryKey only for functional/opaque queries or to avoid deriving identity from structured query IR on render.`,
  )
}

function shouldWarnInDevelopment(disableEnvVar: string): boolean {
  if (typeof process === `undefined`) {
    return true
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

function createInitialQueryBuilder(dbClient: DbClient | undefined) {
  return new BaseQueryBuilder(
    {},
    dbClient
      ? (options: CollectionOptions<any, string | number, any, any>) =>
          dbClient.collection(options as any) as CollectionImpl<
            any,
            string | number,
            any,
            any,
            any
          >
      : undefined,
  ) as InitialQueryBuilder
}

function resolveQueryWithDbClient<TContext extends Context>(
  query: LiveQueryCollectionConfig<TContext>[`query`],
  dbClient: DbClient | undefined,
): LiveQueryCollectionConfig<TContext>[`query`] {
  if (typeof query !== `function`) {
    return query
  }

  const resolvedQuery = (_: InitialQueryBuilder) =>
    query(createInitialQueryBuilder(dbClient))

  return resolvedQuery as LiveQueryCollectionConfig<TContext>[`query`]
}

function resolveConfigWithDbClient<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  dbClient: DbClient | undefined,
): LiveQueryCollectionConfig<TContext> {
  return {
    ...config,
    query: resolveQueryWithDbClient(config.query, dbClient),
  }
}

function getExplicitQueryKey(value: unknown): LiveQueryKey | undefined {
  return value &&
    typeof value === `object` &&
    Array.isArray((value as { queryKey?: unknown }).queryKey)
    ? (value as { queryKey: LiveQueryKey }).queryKey
    : undefined
}

function getDerivedQueryIdentity(
  value: unknown,
  dbClient: DbClient | undefined,
  profiler: DerivedIdentityProfiler,
): Array<unknown> {
  const shouldProfile = shouldWarnInDevelopment(
    `TANSTACK_DB_DISABLE_QUERY_IDENTITY_WARNINGS`,
  )
  const start = shouldProfile ? getCurrentTime() : 0

  let identity: unknown
  try {
    identity = deriveQueryIdentity(value, dbClient)
  } catch (error) {
    if (error instanceof UnhashableQueryIRError) {
      throw new Error(
        `[useLiveQuery] This query cannot derive a stable identity from its structured IR because ${error.reason} at ${error.path}. ` +
          `Provide an explicit queryKey: useLiveQuery({ queryKey: [...], query }).`,
      )
    }

    throw error
  }

  if (shouldProfile) {
    const durationMs = getCurrentTime() - start
    profiler.renderCount += 1
    profiler.totalMs += durationMs
    profiler.maxMs = Math.max(profiler.maxMs, durationMs)
    warnDerivedIdentityHotPath(profiler, durationMs)
  }

  return [`derived`, identity]
}

function deriveQueryIdentity(
  value: unknown,
  dbClient: DbClient | undefined,
): unknown {
  if (typeof value === `function`) {
    const result = value(createInitialQueryBuilder(dbClient))
    return deriveQueryResultIdentity(result, dbClient)
  }

  if (value instanceof CollectionImpl) {
    return [`collection`, value.id]
  }

  if (value instanceof BaseQueryBuilder) {
    return [`query`, getStableQueryBuilderHash(value)]
  }

  if (value && typeof value === `object` && `query` in value) {
    const config = value as LiveQueryCollectionConfig<any>
    return [
      `config`,
      deriveQueryIdentity(
        resolveQueryWithDbClient(config.query, dbClient),
        dbClient,
      ),
    ]
  }

  return [`value`, value]
}

function deriveQueryResultIdentity(
  result: unknown,
  dbClient: DbClient | undefined,
): unknown {
  if (result === undefined || result === null) {
    return [`disabled`]
  }

  return deriveQueryIdentity(result, dbClient)
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
  const dbClient = useOptionalDbClient()
  const resolvedDeps = deps ?? []
  // Check if it's already a collection by checking for specific collection methods
  const isCollection =
    configOrQueryOrCollection &&
    typeof configOrQueryOrCollection === `object` &&
    typeof configOrQueryOrCollection.subscribeChanges === `function` &&
    typeof configOrQueryOrCollection.startSyncImmediate === `function` &&
    typeof configOrQueryOrCollection.id === `string`

  // Use refs to cache collection and track dependencies
  const collectionRef = useRef<Collection<object, string | number, {}> | null>(
    null,
  )
  const depsRef = useRef<Array<unknown> | null>(null)
  const configRef = useRef<unknown>(null)

  // Use refs to track version and memoized snapshot
  const versionRef = useRef(0)
  const snapshotRef = useRef<{
    collection: Collection<object, string | number, {}> | null
    version: number
  } | null>(null)
  const derivedIdentityProfilerRef = useRef<DerivedIdentityProfiler>({
    renderCount: 0,
    totalMs: 0,
    maxMs: 0,
    warned: false,
  })

  const queryKey = !isCollection
    ? getExplicitQueryKey(configOrQueryOrCollection)
    : undefined
  const identityDeps =
    queryKey ??
    (deps !== undefined
      ? resolvedDeps
      : isCollection
        ? []
        : getDerivedQueryIdentity(
            configOrQueryOrCollection,
            dbClient,
            derivedIdentityProfilerRef.current,
          ))

  if (deps !== undefined) {
    warnDeprecatedDepsArray()
  }

  // Check if we need to create/recreate the collection
  const needsNewCollection =
    !collectionRef.current ||
    (isCollection && configRef.current !== configOrQueryOrCollection) ||
    (!isCollection &&
      (depsRef.current === null || !deepEquals(depsRef.current, identityDeps)))

  if (needsNewCollection) {
    if (isCollection) {
      // Warn when passing a collection directly with on-demand sync mode
      // In on-demand mode, data is only loaded when queries with predicates request it
      // Passing the collection directly doesn't provide any predicates, so no data loads
      const syncMode = (
        configOrQueryOrCollection as { config?: { syncMode?: string } }
      ).config?.syncMode
      if (syncMode === `on-demand`) {
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
      // Handle different callback return types
      if (typeof configOrQueryOrCollection === `function`) {
        // Call the function with a query builder to see what it returns
        const queryBuilder = createInitialQueryBuilder(dbClient)
        const result = configOrQueryOrCollection(queryBuilder)

        if (result === undefined || result === null) {
          // Callback returned undefined/null - disabled query
          collectionRef.current = null
        } else if (result instanceof CollectionImpl) {
          // Callback returned a Collection instance - use it directly
          result.startSyncImmediate()
          collectionRef.current = result
        } else if (result instanceof BaseQueryBuilder) {
          // Callback returned QueryBuilder - create live query collection using the original callback
          // (not the result, since the result might be from a different query builder instance)
          collectionRef.current = createLiveQueryCollection({
            query: resolveQueryWithDbClient(
              configOrQueryOrCollection,
              dbClient,
            ),
            startSync: true,
            gcTime: DEFAULT_GC_TIME_MS,
          })
        } else if (result && typeof result === `object`) {
          // Assume it's a LiveQueryCollectionConfig
          const config = {
            startSync: true,
            gcTime: DEFAULT_GC_TIME_MS,
            ...result,
          } as LiveQueryCollectionConfig<any>
          collectionRef.current = createLiveQueryCollection(
            resolveConfigWithDbClient(config, dbClient) as any,
          )
        } else {
          // Unexpected return type
          throw new Error(
            `useLiveQuery callback must return a QueryBuilder, LiveQueryCollectionConfig, Collection, undefined, or null. Got: ${typeof result}`,
          )
        }
        depsRef.current = [...identityDeps]
      } else {
        // Original logic for config objects
        const config = {
          startSync: true,
          gcTime: DEFAULT_GC_TIME_MS,
          ...configOrQueryOrCollection,
        } as LiveQueryCollectionConfig<any>
        collectionRef.current = createLiveQueryCollection(
          resolveConfigWithDbClient(config, dbClient) as any,
        )
        depsRef.current = [...identityDeps]
      }
    }
  }

  // Reset refs when collection changes
  if (needsNewCollection) {
    versionRef.current = 0
    snapshotRef.current = null
  }

  // Create stable subscribe function using ref
  const subscribeRef = useRef<
    ((onStoreChange: () => void) => () => void) | null
  >(null)
  if (!subscribeRef.current || needsNewCollection) {
    subscribeRef.current = (onStoreChange: () => void) => {
      // If no collection, return a no-op unsubscribe function
      if (!collectionRef.current) {
        return () => {}
      }

      const subscription = collectionRef.current.subscribeChanges(() => {
        // Bump version on any change; getSnapshot will rebuild next time
        versionRef.current += 1
        onStoreChange()
      })
      // Collection may be ready and will not receive initial `subscribeChanges()`
      if (collectionRef.current.status === `ready`) {
        versionRef.current += 1
        onStoreChange()
      }
      return () => {
        subscription.unsubscribe()
      }
    }
  }

  // Create stable getSnapshot function using ref
  const getSnapshotRef = useRef<
    | (() => {
        collection: Collection<object, string | number, {}> | null
        version: number
      })
    | null
  >(null)
  if (!getSnapshotRef.current || needsNewCollection) {
    getSnapshotRef.current = () => {
      const currentVersion = versionRef.current
      const currentCollection = collectionRef.current

      // Recreate snapshot object only if version/collection changed
      if (
        !snapshotRef.current ||
        snapshotRef.current.version !== currentVersion ||
        snapshotRef.current.collection !== currentCollection
      ) {
        snapshotRef.current = {
          collection: currentCollection,
          version: currentVersion,
        }
      }

      return snapshotRef.current
    }
  }

  // Use useSyncExternalStore to subscribe to collection changes
  const snapshot = useSyncExternalStore(
    subscribeRef.current,
    getSnapshotRef.current,
  )

  // Track last snapshot (from useSyncExternalStore) and the returned value separately
  const returnedSnapshotRef = useRef<{
    collection: Collection<object, string | number, {}> | null
    version: number
  } | null>(null)
  // Keep implementation return loose to satisfy overload signatures
  const returnedRef = useRef<any>(null)

  // Rebuild returned object only when the snapshot changes (version or collection identity)
  if (
    !returnedSnapshotRef.current ||
    returnedSnapshotRef.current.version !== snapshot.version ||
    returnedSnapshotRef.current.collection !== snapshot.collection
  ) {
    // Handle null collection case (when callback returns undefined/null)
    if (!snapshot.collection) {
      returnedRef.current = {
        state: undefined,
        data: undefined,
        collection: undefined,
        status: `disabled`,
        isLoading: false,
        isReady: true,
        isIdle: false,
        isError: false,
        isCleanedUp: false,
        isEnabled: false,
      }
    } else {
      // Capture a stable view of entries for this snapshot to avoid tearing
      const entries = Array.from(snapshot.collection.entries())
      const config: CollectionConfigSingleRowOption<any, any, any> =
        snapshot.collection.config
      const singleResult = config.singleResult
      let stateCache: Map<string | number, unknown> | null = null
      let dataCache: Array<unknown> | null = null

      returnedRef.current = {
        get state() {
          if (!stateCache) {
            stateCache = new Map(entries)
          }
          return stateCache
        },
        get data() {
          if (!dataCache) {
            dataCache = entries.map(([, value]) => value)
          }
          return singleResult ? dataCache[0] : dataCache
        },
        collection: snapshot.collection,
        status: snapshot.collection.status,
        isLoading: snapshot.collection.status === `loading`,
        isReady: snapshot.collection.status === `ready`,
        isIdle: snapshot.collection.status === `idle`,
        isError: snapshot.collection.status === `error`,
        isCleanedUp: snapshot.collection.status === `cleaned-up`,
        isEnabled: true,
      }
    }

    // Remember the snapshot that produced this returned value
    returnedSnapshotRef.current = snapshot
  }

  return returnedRef.current!
}
