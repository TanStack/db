import { D2, output } from '@tanstack/db-ivm'
import { transactionScopedScheduler } from '../scheduler.js'
import { getActiveTransaction } from '../transactions.js'
import { compileQuery } from './compiler/index.js'
import {
  normalizeExpressionPaths,
  normalizeOrderByPaths,
} from './compiler/expressions.js'
import { getCollectionBuilder } from './live/collection-registry.js'
import {
  buildQueryFromConfig,
  computeOrderedLoadCursor,
  computeSubscriptionOrderByHints,
  extractCollectionAliases,
  extractCollectionsFromQuery,
  filterDuplicateInserts,
  sendChangesToInput,
  splitUpdates,
  trackBiggestSentValue,
} from './live/utils.js'
import type { RootStreamBuilder } from '@tanstack/db-ivm'
import type { Collection } from '../collection/index.js'
import type { CollectionSubscription } from '../collection/subscription.js'
import type { InitialQueryBuilder, QueryBuilder } from './builder/index.js'
import type { Context } from './builder/types.js'
import type { BasicExpression, QueryIR } from './ir.js'
import type { OrderByOptimizationInfo } from './compiler/order-by.js'
import type { ChangeMessage, KeyedStream, ResultStream } from '../types.js'

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Event types for query result deltas */
export type DeltaType = 'enter' | 'exit' | 'update'

/** Delta event emitted when a row enters, exits, or updates within a query result */
export interface DeltaEvent<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  type: DeltaType
  key: TKey
  /** Current value (new value for enter/update, exiting value for exit) */
  value: TRow
  /** Previous value (for update and exit events) */
  previousValue?: TRow
  metadata?: Record<string, unknown>
}

/** Context passed to effect handlers */
export interface EffectContext {
  /** ID of this effect (auto-generated if not provided) */
  effectId: string
  /** Aborted when effect.dispose() is called */
  signal: AbortSignal
}

/** Query input - can be a builder function or a prebuilt query */
export type EffectQueryInput<TContext extends Context> =
  | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
  | QueryBuilder<TContext>

/** Effect configuration */
export interface EffectConfig<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  /** Optional ID for debugging/tracing */
  id?: string

  /** Query to watch for deltas */
  query: EffectQueryInput<any>

  /** Which delta types to handle */
  on: DeltaType | Array<DeltaType> | 'delta'

  /** Per-row handler (called once per matching delta event) */
  handler?: (
    event: DeltaEvent<TRow, TKey>,
    ctx: EffectContext,
  ) => void | Promise<void>

  /** Per-batch handler (called once per graph run with all matching events) */
  batchHandler?: (
    events: Array<DeltaEvent<TRow, TKey>>,
    ctx: EffectContext,
  ) => void | Promise<void>

  /** Error handler for exceptions thrown by handler/batchHandler */
  onError?: (error: Error, event: DeltaEvent<TRow, TKey>) => void

  /**
   * Skip deltas during initial collection load.
   * Defaults to false (process all deltas including initial sync).
   * Set to true for effects that should only process new changes.
   */
  skipInitial?: boolean
}

/** Handle returned by createEffect */
export interface Effect {
  /** Dispose the effect. Returns a promise that resolves when in-flight handlers complete. */
  dispose: () => Promise<void>
  /** Whether this effect has been disposed */
  readonly disposed: boolean
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Accumulated changes for a single key within a graph run */
interface EffectChanges<T> {
  deletes: number
  inserts: number
  /** Value from the most recent insert (the new/current value) */
  insertValue?: T
  /** Value from the most recent delete (the previous/old value) */
  deleteValue?: T
}

// ---------------------------------------------------------------------------
// Global Counter
// ---------------------------------------------------------------------------

let effectCounter = 0

// ---------------------------------------------------------------------------
// createEffect
// ---------------------------------------------------------------------------

/**
 * Creates a reactive effect that fires handlers when rows enter, exit, or
 * update within a query result. Effects process deltas only — they do not
 * maintain or require the full materialised query result.
 *
 * @example
 * ```typescript
 * const effect = createEffect({
 *   query: (q) => q.from({ msg: messagesCollection })
 *     .where(({ msg }) => eq(msg.role, 'user')),
 *   on: 'enter',
 *   handler: async (event) => {
 *     await generateResponse(event.value)
 *   },
 * })
 *
 * // Later: stop the effect
 * await effect.dispose()
 * ```
 */
export function createEffect<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(config: EffectConfig<TRow, TKey>): Effect {
  const id = config.id ?? `live-query-effect-${++effectCounter}`

  // Normalise the `on` parameter into a set of delta types
  const deltaTypes = normaliseDeltaTypes(config.on)

  // AbortController for signalling disposal to handlers
  const abortController = new AbortController()

  const ctx: EffectContext = {
    effectId: id,
    signal: abortController.signal,
  }

  // Track in-flight async handler promises so dispose() can await them
  const inFlightHandlers = new Set<Promise<void>>()
  let disposed = false

  // Callback invoked by the pipeline runner with each batch of delta events
  const onBatchProcessed = (events: Array<DeltaEvent<TRow, TKey>>) => {
    if (disposed) return

    // Filter to only the requested delta types
    const filtered = events.filter((e) => deltaTypes.has(e.type))
    if (filtered.length === 0) return

    // Batch handler
    if (config.batchHandler) {
      try {
        const result = config.batchHandler(filtered, ctx)
        if (result instanceof Promise) {
          trackPromise(result, inFlightHandlers)
        }
      } catch (error) {
        // For batch handler errors, report with first event as context
        reportError(error, filtered[0]!, config.onError)
      }
    }

    // Per-row handler
    if (config.handler) {
      for (const event of filtered) {
        if (abortController.signal.aborted) break
        try {
          const result = config.handler(event, ctx)
          if (result instanceof Promise) {
            const tracked = result.catch((error) => {
              reportError(error, event, config.onError)
            })
            trackPromise(tracked, inFlightHandlers)
          }
        } catch (error) {
          reportError(error, event, config.onError)
        }
      }
    }
  }

  // The dispose function is referenced by both the returned Effect object
  // and the onSourceError callback, so we define it first.
  const dispose = async () => {
    if (disposed) return
    disposed = true

    // Abort signal for in-flight handlers
    abortController.abort()

    // Tear down the pipeline (unsubscribe from sources, etc.)
    runner.dispose()

    // Wait for any in-flight async handlers to settle
    if (inFlightHandlers.size > 0) {
      await Promise.allSettled([...inFlightHandlers])
    }
  }

  // Create and start the pipeline
  const runner = new EffectPipelineRunner<TRow, TKey>({
    query: config.query,
    skipInitial: config.skipInitial ?? false,
    onBatchProcessed,
    onSourceError: (error: Error) => {
      if (disposed) return

      console.error(`[Effect '${id}'] ${error.message}. Disposing effect.`)

      // Auto-dispose — the effect can no longer function
      dispose()
    },
  })
  runner.start()

  return {
    dispose,
    get disposed() {
      return disposed
    },
  }
}

// ---------------------------------------------------------------------------
// EffectPipelineRunner
// ---------------------------------------------------------------------------

interface EffectPipelineRunnerConfig<
  TRow extends object,
  TKey extends string | number,
> {
  query: EffectQueryInput<any>
  skipInitial: boolean
  onBatchProcessed: (events: Array<DeltaEvent<TRow, TKey>>) => void
  /** Called when a source collection enters error or cleaned-up state */
  onSourceError: (error: Error) => void
}

/**
 * Internal class that manages a D2 pipeline for effect delta processing.
 *
 * Sets up the IVM graph, subscribes to source collections, runs the graph
 * when changes arrive, and classifies output multiplicities into DeltaEvents.
 *
 * Unlike CollectionConfigBuilder, this does NOT:
 * - Create or write to a collection (no materialisation)
 * - Manage ordering, windowing, or lazy loading
 */
class EffectPipelineRunner<TRow extends object, TKey extends string | number> {
  private readonly query: QueryIR
  private readonly collections: Record<string, Collection<any, any, any>>
  private readonly collectionByAlias: Record<string, Collection<any, any, any>>

  private graph: D2 | undefined
  private inputs: Record<string, RootStreamBuilder<unknown>> | undefined
  private pipeline: ResultStream | undefined
  private sourceWhereClauses: Map<string, BasicExpression<boolean>> | undefined
  private compiledAliasToCollectionId: Record<string, string> = {}

  // Mutable objects passed to compileQuery by reference.
  // The join compiler captures these references and reads them later when
  // the graph runs, so they must be populated before the first graph run.
  private readonly subscriptions: Record<string, CollectionSubscription> = {}
  private readonly lazySourcesCallbacks: Record<string, any> = {}
  private readonly lazySources = new Set<string>()
  // OrderBy optimization info populated by the compiler when limit is present
  private readonly optimizableOrderByCollections: Record<
    string,
    OrderByOptimizationInfo
  > = {}

  // Ordered subscription state for cursor-based loading
  private readonly biggestSentValue = new Map<string, any>()
  private readonly lastLoadRequestKey = new Map<string, string>()
  private pendingOrderedLoadPromise: Promise<void> | undefined

  // Subscription management
  private readonly unsubscribeCallbacks = new Set<() => void>()
  // Duplicate insert prevention per alias
  private readonly sentToD2KeysByAlias = new Map<string, Set<string | number>>()

  // Output accumulator
  private pendingChanges: Map<unknown, EffectChanges<TRow>> = new Map()

  // skipInitial state
  private readonly skipInitial: boolean
  private initialLoadComplete = false

  // Scheduler integration
  private subscribedToAllCollections = false
  private readonly builderDependencies = new Set<unknown>()
  private readonly aliasDependencies: Record<string, Array<unknown>> = {}

  // Reentrance guard
  private isGraphRunning = false
  private disposed = false

  private readonly onBatchProcessed: (
    events: Array<DeltaEvent<TRow, TKey>>,
  ) => void
  private readonly onSourceError: (error: Error) => void

  constructor(config: EffectPipelineRunnerConfig<TRow, TKey>) {
    this.skipInitial = config.skipInitial
    this.onBatchProcessed = config.onBatchProcessed
    this.onSourceError = config.onSourceError

    // Parse query
    this.query = buildQueryFromConfig({ query: config.query })

    // Extract source collections
    this.collections = extractCollectionsFromQuery(this.query)
    const aliasesById = extractCollectionAliases(this.query)

    // Build alias → collection map
    this.collectionByAlias = {}
    for (const [collectionId, aliases] of aliasesById.entries()) {
      const collection = this.collections[collectionId]
      if (!collection) continue
      for (const alias of aliases) {
        this.collectionByAlias[alias] = collection
      }
    }

    // Compile the pipeline
    this.compilePipeline()
  }

  /** Compile the D2 graph and query pipeline */
  private compilePipeline(): void {
    this.graph = new D2()
    this.inputs = Object.fromEntries(
      Object.keys(this.collectionByAlias).map((alias) => [
        alias,
        this.graph!.newInput<any>(),
      ]),
    )

    const compilation = compileQuery(
      this.query,
      this.inputs as Record<string, KeyedStream>,
      this.collections,
      // These mutable objects are captured by reference. The join compiler
      // reads them later when the graph runs, so they must be populated
      // (in start()) before the first graph run.
      this.subscriptions,
      this.lazySourcesCallbacks,
      this.lazySources,
      this.optimizableOrderByCollections,
      () => {}, // setWindowFn (no-op — effects don't paginate)
    )

    this.pipeline = compilation.pipeline
    this.sourceWhereClauses = compilation.sourceWhereClauses
    this.compiledAliasToCollectionId = compilation.aliasToCollectionId

    // Attach the output operator that accumulates changes
    this.pipeline.pipe(
      output((data) => {
        const messages = data.getInner()
        messages.reduce(accumulateEffectChanges<TRow>, this.pendingChanges)
      }),
    )

    this.graph.finalize()
  }

  /** Subscribe to source collections and start processing */
  start(): void {
    // Use compiled aliases as the source of truth
    const compiledAliases = Object.entries(this.compiledAliasToCollectionId)
    if (compiledAliases.length === 0) {
      // Nothing to subscribe to
      return
    }

    // When not skipping initial, we always process events immediately
    if (!this.skipInitial) {
      this.initialLoadComplete = true
    }

    // We need to defer initial data processing until ALL subscriptions are
    // created, because join pipelines look up subscriptions by alias during
    // the graph run. If we run the graph while some aliases are still missing,
    // the join tap operator will throw.
    //
    // Strategy: subscribe to each collection but buffer incoming changes.
    // After all subscriptions are in place, flush the buffers and switch to
    // direct processing mode.

    const pendingBuffers = new Map<
      string,
      Array<Array<ChangeMessage<any, string | number>>>
    >()

    for (const [alias, collectionId] of compiledAliases) {
      const collection =
        this.collectionByAlias[alias] ?? this.collections[collectionId]!

      // Initialise per-alias duplicate tracking
      this.sentToD2KeysByAlias.set(alias, new Set())

      // Discover dependencies: if source collection is itself a live query
      // collection, its builder must run first during transaction flushes.
      const dependencyBuilder = getCollectionBuilder(collection)
      if (dependencyBuilder) {
        this.aliasDependencies[alias] = [dependencyBuilder]
        this.builderDependencies.add(dependencyBuilder)
      } else {
        this.aliasDependencies[alias] = []
      }

      // Get where clause for this alias (for predicate push-down)
      const whereClause = this.sourceWhereClauses?.get(alias)
      const whereExpression = whereClause
        ? normalizeExpressionPaths(whereClause, alias)
        : undefined

      // Initialise buffer for this alias
      const buffer: Array<Array<ChangeMessage<any, string | number>>> = []
      pendingBuffers.set(alias, buffer)

      // Lazy aliases (marked by the join compiler) should NOT load initial state
      // eagerly — the join tap operator will load exactly the rows it needs on demand.
      // For on-demand collections, eager loading would trigger a full server fetch
      // for data that should be lazily loaded based on join keys.
      const isLazy = this.lazySources.has(alias)

      // Check if this alias has orderBy optimization (cursor-based loading)
      const orderByInfo = this.getOrderByInfoForAlias(alias)

      // Build the change callback — for ordered aliases, split updates into
      // delete+insert and track the biggest sent value for cursor positioning.
      const changeCallback = orderByInfo
        ? (changes: Array<ChangeMessage<any, string | number>>) => {
            if (pendingBuffers.has(alias)) {
              pendingBuffers.get(alias)!.push(changes)
            } else {
              this.trackSentValues(alias, changes, orderByInfo.comparator)
              const split = [...splitUpdates(changes)]
              this.handleSourceChanges(alias, split)
            }
          }
        : (changes: Array<ChangeMessage<any, string | number>>) => {
            if (pendingBuffers.has(alias)) {
              pendingBuffers.get(alias)!.push(changes)
            } else {
              this.handleSourceChanges(alias, changes)
            }
          }

      // Determine subscription options based on ordered vs unordered path
      const subscriptionOptions = this.buildSubscriptionOptions(
        alias,
        isLazy,
        orderByInfo,
        whereExpression,
      )

      // Subscribe to source changes
      const subscription = collection.subscribeChanges(
        changeCallback,
        subscriptionOptions,
      )

      // Store subscription immediately so the join compiler can find it
      this.subscriptions[alias] = subscription

      // For ordered aliases with an index, trigger the initial limited snapshot.
      // This loads only the top N rows rather than the entire collection.
      if (orderByInfo) {
        this.requestInitialOrderedSnapshot(alias, orderByInfo, subscription)
      }

      this.unsubscribeCallbacks.add(() => {
        subscription.unsubscribe()
        delete this.subscriptions[alias]
      })

      // Listen for status changes on source collections
      const statusUnsubscribe = collection.on(`status:change`, (event) => {
        if (this.disposed) return

        const { status } = event

        // Source entered error state — effect can no longer function
        if (status === `error`) {
          this.onSourceError(
            new Error(
              `Source collection '${collectionId}' entered error state`,
            ),
          )
          return
        }

        // Source was manually cleaned up — effect can no longer function
        if (status === `cleaned-up`) {
          this.onSourceError(
            new Error(
              `Source collection '${collectionId}' was cleaned up while effect depends on it`,
            ),
          )
          return
        }

        // Track source readiness for skipInitial
        if (
          this.skipInitial &&
          !this.initialLoadComplete &&
          this.checkAllCollectionsReady()
        ) {
          this.initialLoadComplete = true
        }
      })
      this.unsubscribeCallbacks.add(statusUnsubscribe)
    }

    // Mark as subscribed so the graph can start running
    this.subscribedToAllCollections = true

    // All subscriptions are now in place. Flush buffered changes by sending
    // data to D2 inputs first (without running the graph), then run the graph
    // once. This prevents intermediate join states from producing duplicates.
    for (const [alias, buffer] of pendingBuffers) {
      for (const changes of buffer) {
        this.sendChangesToD2(alias, changes)
      }
    }
    pendingBuffers.clear()

    // Initial graph run to process any synchronously-available data.
    // For skipInitial, this run's output is discarded (initialLoadComplete is still false).
    this.runGraph()

    // After the initial graph run, if all sources are ready,
    // mark initial load as complete so future events are processed.
    if (this.skipInitial && !this.initialLoadComplete) {
      if (this.checkAllCollectionsReady()) {
        this.initialLoadComplete = true
      }
    }
  }

  /** Handle incoming changes from a source collection */
  private handleSourceChanges(
    alias: string,
    changes: Array<ChangeMessage<any, string | number>>,
  ): void {
    this.sendChangesToD2(alias, changes)
    this.scheduleGraphRun(alias)
  }

  /**
   * Schedule a graph run via the transaction-scoped scheduler.
   *
   * When called within a transaction, the run is deferred until the
   * transaction flushes, coalescing multiple changes into a single graph
   * execution. Without a transaction, the graph runs immediately.
   *
   * Dependencies are discovered from source collections that are themselves
   * live query collections, ensuring parent queries run before effects.
   */
  private scheduleGraphRun(alias?: string): void {
    const contextId = getActiveTransaction()?.id

    // Collect dependencies for this schedule call
    const deps = new Set(this.builderDependencies)
    if (alias) {
      const aliasDeps = this.aliasDependencies[alias]
      if (aliasDeps) {
        for (const dep of aliasDeps) {
          deps.add(dep)
        }
      }
    }

    // Ensure dependent builders are scheduled in this context so that
    // dependency edges always point to a real job.
    if (contextId) {
      for (const dep of deps) {
        if (
          typeof dep === `object` &&
          dep !== null &&
          `scheduleGraphRun` in dep &&
          typeof (dep as any).scheduleGraphRun === `function`
        ) {
          ;(dep as any).scheduleGraphRun(undefined, { contextId })
        }
      }
    }

    transactionScopedScheduler.schedule({
      contextId,
      jobId: this,
      dependencies: deps,
      run: () => this.executeScheduledGraphRun(),
    })
  }

  /**
   * Called by the scheduler when dependencies are satisfied.
   * Checks that the effect is still active before running.
   */
  private executeScheduledGraphRun(): void {
    if (this.disposed || !this.subscribedToAllCollections) return
    this.runGraph()
  }

  /**
   * Send changes to the D2 input for the given alias.
   * Returns the number of multiset entries sent.
   */
  private sendChangesToD2(
    alias: string,
    changes: Array<ChangeMessage<any, string | number>>,
  ): number {
    if (this.disposed || !this.inputs || !this.graph) return 0

    const input = this.inputs[alias]
    if (!input) return 0

    const collection = this.collectionByAlias[alias]
    if (!collection) return 0

    // Filter duplicates per alias
    const sentKeys = this.sentToD2KeysByAlias.get(alias)!
    const filtered = filterDuplicateInserts(changes, sentKeys)

    return sendChangesToInput(input, filtered, collection.config.getKey)
  }

  /** Run the D2 graph and flush accumulated output */
  private runGraph(): void {
    if (this.isGraphRunning || this.disposed || !this.graph) return

    this.isGraphRunning = true
    try {
      while (this.graph.pendingWork()) {
        this.graph.run()
        this.flushPendingChanges()
        // After each step, check if ordered queries need more data.
        // loadMoreIfNeeded may send data to D2 inputs (via requestLimitedSnapshot),
        // causing pendingWork() to return true for the next iteration.
        this.loadMoreIfNeeded()
      }
    } finally {
      this.isGraphRunning = false
    }
  }

  /** Classify accumulated changes into DeltaEvents and invoke the callback */
  private flushPendingChanges(): void {
    if (this.pendingChanges.size === 0) return

    // If skipInitial and initial load isn't complete yet, discard
    if (this.skipInitial && !this.initialLoadComplete) {
      this.pendingChanges = new Map()
      return
    }

    const events: Array<DeltaEvent<TRow, TKey>> = []

    for (const [key, changes] of this.pendingChanges) {
      const event = classifyDelta<TRow, TKey>(key as TKey, changes)
      if (event) {
        events.push(event)
      }
    }

    this.pendingChanges = new Map()

    if (events.length > 0) {
      this.onBatchProcessed(events)
    }
  }

  /** Check if all source collections are in the ready state */
  private checkAllCollectionsReady(): boolean {
    return Object.values(this.collections).every((collection) =>
      collection.isReady(),
    )
  }

  /**
   * Build subscription options for an alias based on whether it uses ordered
   * loading, is lazy, or should pass orderBy/limit hints.
   */
  private buildSubscriptionOptions(
    alias: string,
    isLazy: boolean,
    orderByInfo: OrderByOptimizationInfo | undefined,
    whereExpression: BasicExpression<boolean> | undefined,
  ): {
    includeInitialState?: boolean
    whereExpression?: BasicExpression<boolean>
    orderBy?: any
    limit?: number
  } {
    // Ordered aliases don't use includeInitialState — initial data is loaded
    // via requestLimitedSnapshot/requestSnapshot after subscription setup.
    if (orderByInfo) {
      return { whereExpression }
    }

    const includeInitialState = !isLazy

    // For unordered subscriptions, pass orderBy/limit hints so on-demand
    // collections can optimise server-side fetching.
    const hints = computeSubscriptionOrderByHints(this.query, alias)

    return {
      includeInitialState,
      whereExpression,
      ...(hints.orderBy ? { orderBy: hints.orderBy } : {}),
      ...(hints.limit !== undefined ? { limit: hints.limit } : {}),
    }
  }

  /**
   * Request the initial ordered snapshot for an alias.
   * Uses requestLimitedSnapshot (index-based cursor) or requestSnapshot
   * (full load with limit) depending on whether an index is available.
   */
  private requestInitialOrderedSnapshot(
    alias: string,
    orderByInfo: OrderByOptimizationInfo,
    subscription: CollectionSubscription,
  ): void {
    const { orderBy, offset, limit, index } = orderByInfo
    const normalizedOrderBy = normalizeOrderByPaths(orderBy, alias)

    if (index) {
      subscription.setOrderByIndex(index)
      subscription.requestLimitedSnapshot({
        limit: offset + limit,
        orderBy: normalizedOrderBy,
        trackLoadSubsetPromise: false,
      })
    } else {
      subscription.requestSnapshot({
        orderBy: normalizedOrderBy,
        limit: offset + limit,
        trackLoadSubsetPromise: false,
      })
    }
  }

  /**
   * Get orderBy optimization info for a given alias.
   * Returns undefined if no optimization exists for this alias.
   */
  private getOrderByInfoForAlias(
    alias: string,
  ): OrderByOptimizationInfo | undefined {
    // optimizableOrderByCollections is keyed by collection ID
    const collectionId = this.compiledAliasToCollectionId[alias]
    if (!collectionId) return undefined

    const info = this.optimizableOrderByCollections[collectionId]
    if (info && info.alias === alias) {
      return info
    }
    return undefined
  }

  /**
   * After each graph run step, check if any ordered query's topK operator
   * needs more data. If so, load more rows via requestLimitedSnapshot.
   */
  private loadMoreIfNeeded(): void {
    for (const [, orderByInfo] of Object.entries(
      this.optimizableOrderByCollections,
    )) {
      if (!orderByInfo.dataNeeded) continue

      if (this.pendingOrderedLoadPromise) {
        // Wait for in-flight loads to complete before requesting more
        continue
      }

      const n = orderByInfo.dataNeeded()
      if (n > 0) {
        this.loadNextItems(orderByInfo, n)
      }
    }
  }

  /**
   * Load n more items from the source collection, starting from the cursor
   * position (the biggest value sent so far).
   */
  private loadNextItems(orderByInfo: OrderByOptimizationInfo, n: number): void {
    const { alias } = orderByInfo
    const subscription = this.subscriptions[alias]
    if (!subscription) return

    const cursor = computeOrderedLoadCursor(
      orderByInfo,
      this.biggestSentValue.get(alias),
      this.lastLoadRequestKey.get(alias),
      alias,
      n,
    )
    if (!cursor) return // Duplicate request — skip

    this.lastLoadRequestKey.set(alias, cursor.loadRequestKey)

    subscription.requestLimitedSnapshot({
      orderBy: cursor.normalizedOrderBy,
      limit: n,
      minValues: cursor.minValues,
      trackLoadSubsetPromise: false,
      onLoadSubsetResult: (loadResult: Promise<void> | true) => {
        // Track in-flight load to prevent redundant concurrent requests
        if (loadResult instanceof Promise) {
          this.pendingOrderedLoadPromise = loadResult
          loadResult.finally(() => {
            if (this.pendingOrderedLoadPromise === loadResult) {
              this.pendingOrderedLoadPromise = undefined
            }
          })
        }
      },
    })
  }

  /**
   * Track the biggest value sent for a given ordered alias.
   * Used for cursor-based pagination in loadNextItems.
   */
  private trackSentValues(
    alias: string,
    changes: Array<ChangeMessage<any, string | number>>,
    comparator: (a: any, b: any) => number,
  ): void {
    const sentKeys = this.sentToD2KeysByAlias.get(alias) ?? new Set()
    const result = trackBiggestSentValue(
      changes,
      this.biggestSentValue.get(alias),
      sentKeys,
      comparator,
    )
    this.biggestSentValue.set(alias, result.biggest)
    if (result.shouldResetLoadKey) {
      this.lastLoadRequestKey.delete(alias)
    }
  }

  /** Tear down subscriptions and clear state */
  dispose(): void {
    this.disposed = true
    this.subscribedToAllCollections = false
    this.unsubscribeCallbacks.forEach((fn) => fn())
    this.unsubscribeCallbacks.clear()
    this.sentToD2KeysByAlias.clear()
    this.pendingChanges.clear()
    this.lazySources.clear()
    this.builderDependencies.clear()
    this.biggestSentValue.clear()
    this.lastLoadRequestKey.clear()
    this.pendingOrderedLoadPromise = undefined

    // Clear mutable objects
    for (const key of Object.keys(this.lazySourcesCallbacks)) {
      delete this.lazySourcesCallbacks[key]
    }
    for (const key of Object.keys(this.aliasDependencies)) {
      delete this.aliasDependencies[key]
    }
    for (const key of Object.keys(this.optimizableOrderByCollections)) {
      delete this.optimizableOrderByCollections[key]
    }

    // Clear graph references
    this.graph = undefined
    this.inputs = undefined
    this.pipeline = undefined
    this.sourceWhereClauses = undefined
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise the `on` config value into a Set of DeltaTypes */
function normaliseDeltaTypes(
  on: DeltaType | Array<DeltaType> | 'delta',
): Set<DeltaType> {
  if (on === `delta`) {
    return new Set<DeltaType>([`enter`, `exit`, `update`])
  }
  if (Array.isArray(on)) {
    return new Set<DeltaType>(on)
  }
  return new Set<DeltaType>([on])
}

/**
 * Accumulate D2 output multiplicities into per-key effect changes.
 * Tracks both insert values (new) and delete values (old) separately
 * so that update and exit events can include previousValue.
 */
function accumulateEffectChanges<T>(
  acc: Map<unknown, EffectChanges<T>>,
  [[key, tupleData], multiplicity]: [
    [unknown, [any, string | undefined]],
    number,
  ],
): Map<unknown, EffectChanges<T>> {
  const [value] = tupleData as [T, string | undefined]

  const changes: EffectChanges<T> = acc.get(key) || {
    deletes: 0,
    inserts: 0,
  }

  if (multiplicity < 0) {
    changes.deletes += Math.abs(multiplicity)
    changes.deleteValue = value
  } else if (multiplicity > 0) {
    changes.inserts += multiplicity
    changes.insertValue = value
  }

  acc.set(key, changes)
  return acc
}

/** Classify accumulated per-key changes into a DeltaEvent */
function classifyDelta<TRow extends object, TKey extends string | number>(
  key: TKey,
  changes: EffectChanges<TRow>,
): DeltaEvent<TRow, TKey> | undefined {
  const { inserts, deletes, insertValue, deleteValue } = changes

  if (inserts > 0 && deletes === 0) {
    // Row entered the query result
    return { type: `enter`, key, value: insertValue! }
  }

  if (deletes > 0 && inserts === 0) {
    // Row exited the query result
    return {
      type: `exit`,
      key,
      value: deleteValue!,
      previousValue: deleteValue,
    }
  }

  if (inserts > 0 && deletes > 0) {
    // Row updated within the query result
    return {
      type: `update`,
      key,
      value: insertValue!,
      previousValue: deleteValue,
    }
  }

  // inserts === 0 && deletes === 0 — no net change (should not happen)
  return undefined
}

/** Track a promise in the in-flight set, automatically removing on settlement */
function trackPromise(
  promise: Promise<void>,
  inFlightHandlers: Set<Promise<void>>,
): void {
  inFlightHandlers.add(promise)
  promise.finally(() => {
    inFlightHandlers.delete(promise)
  })
}

/** Report an error to the onError callback or console */
function reportError<TRow extends object, TKey extends string | number>(
  error: unknown,
  event: DeltaEvent<TRow, TKey>,
  onError?: (error: Error, event: DeltaEvent<TRow, TKey>) => void,
): void {
  const normalised = error instanceof Error ? error : new Error(String(error))
  if (onError) {
    try {
      onError(normalised, event)
    } catch {
      // Don't let onError errors propagate
      console.error(`[Effect] Error in onError handler:`, normalised)
    }
  } else {
    console.error(`[Effect] Unhandled error in handler:`, normalised)
  }
}
