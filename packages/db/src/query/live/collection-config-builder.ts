import { D2, output } from '@tanstack/db-ivm'
import { compileQuery } from '../compiler/index.js'
import {
  MissingAliasInputsError,
  SetWindowRequiresOrderByError,
} from '../../errors.js'
import {
  getActivePublicationContext,
  transactionScopedScheduler,
} from '../../scheduler.js'
import { getActiveTransaction } from '../../transactions.js'
import { deepEquals } from '../../utils.js'
import { getLoadSubsetDemandKey } from '../ir-stable-identity.js'
import { isAppliedLoadSubsetOutcome } from '../load-subset-outcome.js'
import { CollectionSubscriber } from './collection-subscriber.js'
import { getCollectionBuilder } from './collection-registry.js'
import { LIVE_QUERY_INTERNAL } from './internal.js'
import { materializeCompilation } from './materialized-pipeline.js'
import { BucketFacadeAdapter } from './bucket-facade-adapter.js'
import {
  buildQueryFromConfig,
  extractCollectionFromSource,
  extractCollectionSources,
  extractCollectionsFromQuery,
} from './utils.js'
import type { LiveQueryInternalUtils } from './internal.js'
import type { WindowOptions } from '../compiler/index.js'
import type { SchedulerContextId } from '../../scheduler.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type { RootStreamBuilder } from '@tanstack/db-ivm'
import type { OrderByOptimizationInfo } from '../compiler/order-by.js'
import type { Collection } from '../../collection/index.js'
import type {
  AppliedLoadSubsetOutcome,
  CollectionConfigSingleRowOption,
  KeyedStream,
  ResultStream,
  StringCollationConfig,
  SyncConfig,
  UtilsRecord,
} from '../../types.js'
import type { Context, GetResult } from '../builder/types.js'
import type { BasicExpression, QueryIR } from '../ir.js'
import type { LazyCollectionCallbacks } from '../compiler/joins.js'
import type {
  Changes,
  FullSyncState,
  LiveQueryCollectionConfig,
  SyncState,
} from './types.js'
import type { AllCollectionEvents } from '../../collection/events.js'

export type LiveQueryCollectionUtils = UtilsRecord & {
  getRunCount: () => number
  /** Most recent subset-load failure observed by this live query. */
  readonly lastSubsetError: unknown | undefined
  /**
   * Sets the offset and limit of an ordered query.
   * Is a no-op if the query is not ordered.
   *
   * @returns `true` if no subset loading was triggered, or `Promise<void>` that resolves when the subset has been loaded
   */
  setWindow: (options: WindowOptions) => true | Promise<void>
  /**
   * Gets the current window (offset and limit) for an ordered query.
   *
   * @returns The current window settings, or `undefined` if the query is not windowed
   */
  getWindow: () => { offset: number; limit: number } | undefined
  [LIVE_QUERY_INTERNAL]: LiveQueryInternalUtils
}

type PendingGraphRun = {
  loadCallbacks: Set<() => boolean>
}

// Global counter for auto-generated collection IDs
let liveQueryCollectionCounter = 0

type SyncMethods<TResult extends object> = Parameters<
  SyncConfig<TResult>[`sync`]
>[0]

export class CollectionConfigBuilder<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
> {
  private readonly id: string
  readonly query: QueryIR
  private readonly collections: Record<string, Collection<any, any, any>>
  private readonly collectionSources: ReturnType<
    typeof extractCollectionSources
  >
  private readonly collectionByAlias: Record<string, Collection<any, any, any>>
  // Populated during compilation with all aliases (including subquery inner aliases)
  private compiledAliasToCollectionId: Record<string, string> = {}

  // WeakMap to store the keys of the results
  // so that we can retrieve them in the getKey function
  private readonly resultKeys = new WeakMap<object, unknown>()

  // WeakMap to store the orderBy index for each result
  private readonly orderByIndices = new WeakMap<object, string>()

  private readonly compare?: (val1: TResult, val2: TResult) => number
  private readonly compareOptions?: StringCollationConfig

  private isGraphRunning = false
  private runCount = 0

  // Current sync session state (set when sync starts, cleared when it stops)
  // Public for testing purposes (CollectionConfigBuilder is internal, not public API)
  public currentSyncConfig:
    | Parameters<SyncConfig<TResult>[`sync`]>[0]
    | undefined
  public currentSyncState: FullSyncState | undefined

  // Error state tracking
  private isInErrorState = false
  private fatalQueryError = false
  private readonly erroredSourceIds = new Set<string>()
  private lastSubsetError: unknown | undefined

  // Reference to the live query collection for error state transitions
  public liveQueryCollection?: Collection<TResult, any, any>

  private windowFn: ((options: WindowOptions) => void) | undefined
  private readonly initialWindow: WindowOptions | undefined
  private currentWindow: WindowOptions | undefined
  private activeWindowOperation:
    | { failed: boolean; error?: unknown }
    | undefined

  private maybeRunGraphFn: (() => void) | undefined

  private readonly sourceDependencies: Record<
    string,
    Array<CollectionConfigBuilder<any, any>>
  > = {}

  private readonly builderDependencies = new Set<
    CollectionConfigBuilder<any, any>
  >()

  // Pending graph runs per scheduler context (e.g., per transaction)
  // The builder manages its own state; the scheduler just orchestrates execution order
  // Only stores callbacks - if sync ends, pending jobs gracefully no-op
  private readonly pendingGraphRuns = new Map<
    SchedulerContextId,
    PendingGraphRun
  >()

  // Unsubscribe function for scheduler's onClear listener
  // Registered when sync starts, unregistered when sync stops
  // Prevents memory leaks by releasing the scheduler's reference to this builder
  private unsubscribeFromSchedulerClears?: () => void

  private graphCache: D2 | undefined
  private inputsCache: Record<string, RootStreamBuilder<unknown>> | undefined
  private pipelineCache: ResultStream | undefined
  public sourceWhereClausesCache:
    | Map<string, BasicExpression<boolean>>
    | undefined
  private bucketFacadesCache:
    | ReturnType<typeof materializeCompilation>[`facades`]
    | undefined

  // Map of opaque source ID to subscription
  readonly subscriptions: Record<string, CollectionSubscription> = {}
  // Map of opaque source ID to demand callbacks for that lazy source
  lazySourcesCallbacks: Record<string, LazyCollectionCallbacks> = {}
  // Set of opaque source IDs that are lazy (don't load initial state)
  readonly lazySources = new Set<string>()
  private readonly activeDemands = new Map<
    string,
    {
      generation: number
      settled: boolean
    }
  >()
  private readonly demandGenerations = new Map<string, number>()
  private readonly latestSubsetOutcomes = new Map<
    string,
    AppliedLoadSubsetOutcome
  >()
  private syncSession = 0
  private lastWindowOutcomes: ReadonlyArray<AppliedLoadSubsetOutcome> = []
  // Map of lexical source IDs to optimizable ORDER BY state
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo> = {}

  constructor(
    private readonly config: LiveQueryCollectionConfig<TContext, TResult>,
  ) {
    // Generate a unique ID if not provided
    this.id = config.id || `live-query-${++liveQueryCollectionCounter}`

    this.query = buildQueryFromConfig({
      query: config.query,
      requireObjectResult: true,
    })
    this.initialWindow = this.query.orderBy?.length
      ? {
          offset: this.query.offset ?? 0,
          limit: this.query.limit ?? Infinity,
        }
      : undefined
    this.collections = extractCollectionsFromQuery(this.query)
    this.collectionSources = extractCollectionSources(this.query)
    this.collectionByAlias = Object.fromEntries(
      this.collectionSources.map(({ alias, collection }) => [
        alias,
        collection,
      ]),
    )

    // Create compare function for ordering if the query has orderBy
    if (this.query.orderBy && this.query.orderBy.length > 0) {
      this.compare = createOrderByComparator<TResult>(this.orderByIndices)
    }

    // Use explicitly provided compareOptions if available, otherwise inherit from FROM collection
    this.compareOptions =
      this.config.defaultStringCollation ??
      extractCollectionFromSource(this.query).compareOptions

    // Compile the base pipeline once initially
    // This is done to ensure that any errors are thrown immediately and synchronously
    this.compileBasePipeline()
  }

  /**
   * Recursively checks if a query or any of its subqueries contains joins
   */
  private hasJoins(query: QueryIR): boolean {
    // Check if this query has joins
    if (query.join && query.join.length > 0) {
      return true
    }

    // Recursively check subqueries in the from clause
    if (query.from.type === `queryRef`) {
      if (this.hasJoins(query.from.query)) {
        return true
      }
    } else if (query.from.type === `unionFrom`) {
      for (const source of query.from.sources) {
        if (source.type === `queryRef` && this.hasJoins(source.query)) {
          return true
        }
      }
    } else if (query.from.type === `unionAll`) {
      for (const branch of query.from.queries) {
        if (this.hasJoins(branch)) {
          return true
        }
      }
    }

    return false
  }

  getConfig(): CollectionConfigSingleRowOption<TResult> & {
    utils: LiveQueryCollectionUtils
  } {
    const builder = this
    return {
      id: this.id,
      getKey:
        this.config.getKey ||
        ((item: any) =>
          (this.resultKeys.get(item) ?? item.$key) as string | number),
      sync: this.getSyncConfig(),
      compare: this.compare,
      defaultStringCollation: this.compareOptions,
      gcTime: this.config.gcTime ?? 5000, // 5 seconds by default for live queries
      schema: this.config.schema,
      onInsert: this.config.onInsert,
      onUpdate: this.config.onUpdate,
      onDelete: this.config.onDelete,
      startSync: this.config.startSync,
      singleResult: this.query.singleResult,
      utils: {
        getRunCount: this.getRunCount.bind(this),
        get lastSubsetError() {
          return builder.lastSubsetError
        },
        setWindow: this.setWindow.bind(this),
        getWindow: this.getWindow.bind(this),
        [LIVE_QUERY_INTERNAL]: {
          getBuilder: () => this,
          hasCustomGetKey: !!this.config.getKey,
          hasJoins: this.hasJoins(this.query),
          hasDistinct: !!this.query.distinct,
          getLatestSubsetOutcomes: () => [
            ...this.latestSubsetOutcomes.values(),
          ],
          getLastWindowOutcomes: () => this.lastWindowOutcomes,
        },
      },
    }
  }

  setWindow(options: WindowOptions): true | Promise<void> {
    if (!this.windowFn) {
      throw new SetWindowRequiresOrderByError()
    }

    const syncSession = this.syncSession
    const loadOperation =
      this.liveQueryCollection?._sync.beginLoadSubsetOperation()
    const previousWindow = this.currentWindow ?? this.initialWindow
    const previousOperation = this.activeWindowOperation
    const operation: { failed: boolean; error?: unknown } = { failed: false }
    this.activeWindowOperation = operation
    try {
      this.windowFn(options)
      this.maybeRunGraphFn?.()
      if (operation.failed) throw operation.error
      this.currentWindow = options
    } catch (error) {
      if (previousWindow) {
        try {
          this.windowFn(previousWindow)
          this.maybeRunGraphFn?.()
        } catch {
          // Recovery is best-effort; preserve the error from the requested
          // window rather than replacing it with a rollback failure.
        }
      }
      loadOperation?.cancel()
      throw error
    } finally {
      this.activeWindowOperation = previousOperation
    }

    const ready = loadOperation?.wait() ?? true
    if (ready === true) {
      this.lastWindowOutcomes = this.resolveWindowOutcomes(
        loadOperation?.getOutcomes() ?? [],
      )
      return true
    }
    void ready.then(
      () => {
        if (
          syncSession !== this.syncSession ||
          this.currentSyncConfig === undefined
        ) {
          return
        }
        this.lastWindowOutcomes = this.resolveWindowOutcomes(
          loadOperation!.getOutcomes(),
        )
      },
      () => {
        // The original promise carries the failure to the caller. This
        // observer only publishes successful operation outcomes.
      },
    )
    return ready
  }

  private resolveWindowOutcomes(
    outcomes: ReadonlyArray<AppliedLoadSubsetOutcome>,
  ): ReadonlyArray<AppliedLoadSubsetOutcome> {
    if (outcomes.length > 0) return outcomes
    if (this.lastWindowOutcomes.length > 0) return this.lastWindowOutcomes
    return [...this.latestSubsetOutcomes.values()]
  }

  getWindow(): { offset: number; limit: number } | undefined {
    // Only return window if this is a windowed query (has orderBy and windowFn)
    const window = this.currentWindow ?? this.initialWindow
    if (!this.windowFn || !window) {
      return undefined
    }
    return {
      offset: window.offset ?? 0,
      limit: window.limit ?? 0,
    }
  }

  /**
   * Resolves a collection alias to its collection ID.
   *
   * Uses a two-tier lookup strategy:
   * 1. First checks compiled aliases (includes subquery inner aliases)
   * 2. Falls back to declared aliases from the query's from/join clauses
   *
   * @param alias - The alias to resolve (e.g., "employee", "manager")
   * @returns The collection ID that the alias references
   * @throws {Error} If the alias is not found in either lookup
   */
  getCollectionIdForAlias(alias: string): string {
    const compiled = this.compiledAliasToCollectionId[alias]
    if (compiled) {
      return compiled
    }
    const collection = this.collectionByAlias[alias]
    if (collection) {
      return collection.id
    }
    throw new Error(`Unknown source alias "${alias}"`)
  }

  isLazySource(sourceId: string): boolean {
    return this.lazySources.has(sourceId)
  }

  beginDemand(planId: string): number {
    const generation = (this.demandGenerations.get(planId) ?? 0) + 1
    this.demandGenerations.set(planId, generation)
    this.activeDemands.set(planId, {
      generation,
      settled: false,
    })
    return generation
  }

  settleDemand(
    planId: string,
    generation: number,
    outcomes: ReadonlyArray<AppliedLoadSubsetOutcome> = [],
    sourceId?: string,
  ): void {
    const demand = this.activeDemands.get(planId)
    if (!demand || demand.generation !== generation || demand.settled) return
    demand.settled = true
    const sourcedOutcomes = outcomes.map((outcome) =>
      sourceId === undefined ? outcome : { ...outcome, sourceId },
    )
    for (const outcome of sourcedOutcomes) this.recordSubsetOutcome(outcome)
    this.maybeRunGraphFn?.()
  }

  failDemand(planId: string, generation: number, error: unknown): void {
    const demand = this.activeDemands.get(planId)
    if (!demand || demand.generation !== generation) return
    this.recordSubsetError(error)
    if (this.activeWindowOperation) {
      this.activeWindowOperation.failed = true
      this.activeWindowOperation.error = error
    }
    const message = error instanceof Error ? error.message : String(error)
    this.transitionToError(
      `Subset demand '${planId}' failed: ${message}`,
      error,
    )
  }

  recordSubsetError(error: unknown, fatalBeforeReady = false): void {
    this.lastSubsetError = error
    if (this.activeWindowOperation) {
      this.activeWindowOperation.failed = true
      this.activeWindowOperation.error = error
    }
    if (fatalBeforeReady) {
      const message = error instanceof Error ? error.message : String(error)
      this.transitionToError(`Initial subset load failed: ${message}`, error)
    }
  }

  trackSubsetLoadPromise(promise: Promise<unknown>, sourceId?: string): void {
    const syncSession = this.syncSession
    const tracked = promise.then((result) => {
      const scoped = scopeLoadSubsetOutcomes(result, sourceId)
      if (
        syncSession !== this.syncSession ||
        this.currentSyncConfig === undefined
      ) {
        return scoped
      }
      const outcomes = Array.isArray(scoped) ? scoped : [scoped]
      for (const outcome of outcomes) {
        if (isAppliedLoadSubsetOutcome(outcome)) {
          this.recordSubsetOutcome(outcome)
        }
      }
      return scoped
    })
    this.liveQueryCollection!._sync.trackLoadPromise(tracked)
  }

  trackRetainedSubsetOutcome(
    outcome: AppliedLoadSubsetOutcome,
    sourceId?: string,
  ): void {
    const scoped = sourceId === undefined ? outcome : { ...outcome, sourceId }
    this.recordSubsetOutcome(scoped)
    this.liveQueryCollection!._sync.trackLoadSubsetOperationOutcome(scoped)
  }

  trackSubsetLoadOperationPromise(
    promise: Promise<unknown>,
    sourceId?: string,
  ): void {
    const tracked = promise.then((result) =>
      scopeLoadSubsetOutcomes(result, sourceId),
    )
    // This observer may be offered when no imperative window operation is
    // active. The original promise owns lifecycle error delivery; do not leave
    // this source-scoping derivative as an unhandled rejection in that case.
    void tracked.catch(() => {})
    this.liveQueryCollection!._sync.trackLoadSubsetOperationPromise(tracked)
  }

  private recordSubsetOutcome(outcome: AppliedLoadSubsetOutcome): void {
    const demandKey = getLoadSubsetDemandKey(outcome.demand)
    const outcomeKey = `${outcome.sourceId ?? ``}\u0000${outcome.collectionId}\u0000${demandKey ?? ``}`
    const previous = this.latestSubsetOutcomes.get(outcomeKey)
    if (!previous || previous.generation < outcome.generation) {
      this.latestSubsetOutcomes.set(outcomeKey, outcome)
    }
  }

  retireDemand(planId: string): void {
    this.activeDemands.delete(planId)
  }

  // The callback function is called after the graph has run.
  // This gives the callback a chance to load more data if needed,
  // that's used to optimize orderBy operators that set a limit,
  // in order to load some more data if we still don't have enough rows after the pipeline has run.
  // That can happen because even though we load N rows, the pipeline might filter some of these rows out
  // causing the orderBy operator to receive less than N rows or even no rows at all.
  // So this callback would notice that it doesn't have enough rows and load some more.
  // The callback returns a boolean, when it's true it's done loading data and we can mark the collection as ready.
  maybeRunGraph(callback?: () => boolean) {
    if (this.isGraphRunning) {
      // no nested runs of the graph
      // which is possible if the `callback`
      // would call `maybeRunGraph` e.g. after it has loaded some more data
      return
    }

    // Should only be called when sync is active
    if (!this.currentSyncConfig || !this.currentSyncState) {
      throw new Error(
        `maybeRunGraph called without active sync session. This should not happen.`,
      )
    }

    this.isGraphRunning = true

    try {
      const { begin, commit } = this.currentSyncConfig
      const syncState = this.currentSyncState

      // Don't run if the live query is in an error state
      if (this.isInErrorState) {
        return
      }

      // Always run the graph if subscribed (eager execution)
      if (syncState.subscribedToAllCollections) {
        let callbackCalled = false
        while (syncState.graph.pendingWork()) {
          syncState.graph.run()
          callback?.()
          callbackCalled = true
        }

        // Publish only after every operator has reached quiescence. A source
        // change can reach sibling materializations in different graph steps;
        // flushing between those steps would expose a mixed root snapshot.
        syncState.flushPendingChanges?.()

        // Ensure the callback runs at least once even when the graph has no pending work.
        // This handles lazy loading scenarios where setWindow() increases the limit or
        // an async loadSubset completes and we need to re-check if more data is needed.
        if (!callbackCalled) {
          callback?.()
        }

        // On the initial run, we may need to do an empty commit to ensure that
        // the collection is initialized
        if (syncState.messagesCount === 0) {
          begin()
          commit()
        }

        // After graph processing completes, check if we should mark ready.
        // This is the canonical place to transition to ready state because:
        // 1. All data has been processed through the graph
        // 2. All source collections have had a chance to send their initial data
        // This prevents marking ready before data is processed (fixes isReady=true with empty data)
        this.updateLiveQueryStatus(this.currentSyncConfig)
      }
    } finally {
      this.isGraphRunning = false
    }
  }

  /**
   * Schedules a graph run with the transaction-scoped scheduler.
   * Ensures each builder runs at most once per transaction, with automatic dependency tracking
   * to run parent queries before child queries. Outside a transaction, runs immediately.
   *
   * Multiple calls during a transaction are coalesced into a single execution.
   * Dependencies are auto-discovered from subscribed live queries, or can be overridden.
   * Load callbacks are combined when entries merge.
   *
   * Uses the current sync session's config and syncState from instance properties.
   *
   * @param callback - Optional callback to load more data if needed (returns true when done)
   * @param options - Optional scheduling configuration
   * @param options.contextId - Transaction ID to group work; defaults to active transaction
   * @param options.jobId - Unique identifier for this job; defaults to this builder instance
   * @param options.sourceId - Source that triggered this schedule; adds its dependencies
   * @param options.dependencies - Explicit dependency list; overrides auto-discovered dependencies
   */
  scheduleGraphRun(
    callback?: () => boolean,
    options?: {
      contextId?: SchedulerContextId
      jobId?: unknown
      sourceId?: string
      dependencies?: Array<CollectionConfigBuilder<any, any>>
    },
  ) {
    const contextId =
      options?.contextId ??
      getActiveTransaction()?.id ??
      getActivePublicationContext()
    // Use the builder instance as the job ID for deduplication. This is memory-safe
    // because the scheduler's context Map is deleted after flushing (no long-term retention).
    const jobId = options?.jobId ?? this
    const dependentBuilders = (() => {
      if (options?.dependencies) {
        return options.dependencies
      }

      const deps = new Set(this.builderDependencies)
      if (options?.sourceId) {
        const sourceDeps = this.sourceDependencies[options.sourceId]
        if (sourceDeps) {
          for (const dep of sourceDeps) {
            deps.add(dep)
          }
        }
      }

      deps.delete(this)

      return Array.from(deps)
    })()

    // Ensure dependent builders are actually scheduled in this context so that
    // dependency edges always point to a real job (or a deduped no-op if already scheduled).
    if (contextId) {
      for (const dep of dependentBuilders) {
        if (typeof dep.scheduleGraphRun === `function`) {
          dep.scheduleGraphRun(undefined, { contextId })
        }
      }
    }

    // We intentionally scope deduplication to the builder instance. Each instance
    // owns caches and compiled pipelines, so sharing work across instances that
    // merely reuse the same string id would execute the wrong builder's graph.

    if (!this.currentSyncConfig || !this.currentSyncState) {
      throw new Error(
        `scheduleGraphRun called without active sync session. This should not happen.`,
      )
    }

    // Manage our own state - get or create pending callbacks for this context
    let pending = contextId ? this.pendingGraphRuns.get(contextId) : undefined
    if (!pending) {
      pending = {
        loadCallbacks: new Set(),
      }
      if (contextId) {
        this.pendingGraphRuns.set(contextId, pending)
      }
    }

    // Add callback if provided (this is what accumulates between schedules)
    if (callback) {
      pending.loadCallbacks.add(callback)
    }

    // Schedule execution (scheduler just orchestrates order, we manage state)
    // For immediate execution (no contextId), pass pending directly since it won't be in the map
    const pendingToPass = contextId ? undefined : pending
    transactionScopedScheduler.schedule({
      contextId,
      jobId,
      dependencies: dependentBuilders,
      run: () => this.executeGraphRun(contextId, pendingToPass),
    })
  }

  /**
   * Clears pending graph run state for a specific context.
   * Called when the scheduler clears a context (e.g., transaction rollback/abort).
   */
  clearPendingGraphRun(contextId: SchedulerContextId): void {
    this.pendingGraphRuns.delete(contextId)
  }

  /**
   * Returns true if this builder has a pending graph run for the given context.
   */
  hasPendingGraphRun(contextId: SchedulerContextId): boolean {
    return this.pendingGraphRuns.has(contextId)
  }

  /**
   * Executes a pending graph run. Called by the scheduler when dependencies are satisfied.
   * Clears the pending state BEFORE execution so that any re-schedules during the run
   * create fresh state and don't interfere with the current execution.
   * Uses instance sync state - if sync has ended, gracefully returns without executing.
   *
   * @param contextId - Optional context ID to look up pending state
   * @param pendingParam - For immediate execution (no context), pending state is passed directly
   */
  private executeGraphRun(
    contextId?: SchedulerContextId,
    pendingParam?: PendingGraphRun,
  ): void {
    // Get pending state: either from parameter (no context) or from map (with context)
    // Remove from map BEFORE checking sync state to prevent leaking entries when sync ends
    // before the transaction flushes (e.g., unsubscribe during in-flight transaction)
    const pending =
      pendingParam ??
      (contextId ? this.pendingGraphRuns.get(contextId) : undefined)
    if (contextId) {
      this.pendingGraphRuns.delete(contextId)
    }

    // If no pending state, nothing to execute (context was cleared)
    if (!pending) {
      return
    }

    // If sync session has ended, don't execute (graph is finalized, subscriptions cleared)
    if (!this.currentSyncConfig || !this.currentSyncState) {
      return
    }

    this.incrementRunCount()

    const combinedLoader = () => {
      let allDone = true
      let firstError: unknown
      pending.loadCallbacks.forEach((loader) => {
        try {
          allDone = loader() && allDone
        } catch (error) {
          allDone = false
          firstError ??= error
        }
      })
      if (firstError) {
        throw firstError
      }
      // Returning false signals that callers should schedule another pass.
      return allDone
    }

    this.maybeRunGraph(combinedLoader)
  }

  private getSyncConfig(): SyncConfig<TResult> {
    return {
      rowUpdateMode: `full`,
      sync: this.syncFn.bind(this),
    }
  }

  incrementRunCount() {
    this.runCount++
  }

  getRunCount() {
    return this.runCount
  }

  private syncFn(config: SyncMethods<TResult>) {
    const syncSession = ++this.syncSession
    // Store reference to the live query collection for error state transitions
    this.liveQueryCollection = config.collection
    // Reset error state from any previous sync session so a restarted sync can become ready again.
    this.isInErrorState = false
    this.fatalQueryError = false
    this.erroredSourceIds.clear()
    this.lastSubsetError = undefined
    this.latestSubsetOutcomes.clear()
    this.lastWindowOutcomes = []
    // Store config and syncState as instance properties for the duration of this sync session
    this.currentSyncConfig = config

    const syncState: SyncState = {
      messagesCount: 0,
      subscribedToAllCollections: false,
      unsubscribeCallbacks: new Set<() => void>(),
    }

    let tornDown = false
    const teardown = () => {
      if (tornDown) return
      tornDown = true
      if (this.syncSession === syncSession) this.syncSession++

      let firstCleanupError: unknown
      for (const unsubscribe of syncState.unsubscribeCallbacks) {
        try {
          unsubscribe()
        } catch (error) {
          firstCleanupError ??= error
        }
      }
      syncState.unsubscribeCallbacks.clear()

      // Clear current sync session state
      this.currentSyncConfig = undefined
      this.currentSyncState = undefined
      this.maybeRunGraphFn = undefined
      this.currentWindow = undefined
      this.isInErrorState = false
      this.fatalQueryError = false
      this.erroredSourceIds.clear()

      // Clear all pending graph runs to prevent memory leaks from in-flight transactions
      // that may flush after the sync session ends
      this.pendingGraphRuns.clear()

      // Reset caches so a fresh graph/pipeline is compiled on next start
      // This avoids reusing a finalized D2 graph across GC restarts
      this.graphCache = undefined
      this.inputsCache = undefined
      this.pipelineCache = undefined
      this.sourceWhereClausesCache = undefined
      this.bucketFacadesCache = undefined

      // Reset lazy source alias state
      this.lazySources.clear()
      this.demandGenerations.clear()
      this.activeDemands.clear()
      this.latestSubsetOutcomes.clear()
      this.lastWindowOutcomes = []
      this.optimizableOrderByCollections = {}
      this.lazySourcesCallbacks = {}

      // Clear subscription references to prevent memory leaks
      // Note: Individual subscriptions are already unsubscribed via unsubscribeCallbacks
      Object.keys(this.subscriptions).forEach(
        (key) => delete this.subscriptions[key],
      )
      this.compiledAliasToCollectionId = {}

      // Unregister from scheduler's onClear listener to prevent memory leaks
      // The scheduler's listener Set would otherwise keep a strong reference to this builder
      this.unsubscribeFromSchedulerClears?.()
      this.unsubscribeFromSchedulerClears = undefined

      if (firstCleanupError !== undefined) throw firstCleanupError
    }

    try {
      // Extend the pipeline such that it applies the incoming changes to the collection
      const fullSyncState = this.extendPipelineWithChangeProcessing(
        config,
        syncState,
      )
      this.currentSyncState = fullSyncState

      // Listen for scheduler context clears to clean up our pending state
      // Re-register on each sync start so the listener is active for the sync session's lifetime
      this.unsubscribeFromSchedulerClears = transactionScopedScheduler.onClear(
        (contextId) => {
          this.clearPendingGraphRun(contextId)
        },
      )

      // Listen for loadingSubset changes on the live query collection BEFORE subscribing.
      // This ensures we don't miss the event if subset loading completes synchronously.
      // When isLoadingSubset becomes false, we may need to mark the collection as ready
      // (if all source collections are already ready but we were waiting for subset load to complete)
      const loadingSubsetUnsubscribe = config.collection.on(
        `loadingSubset:change`,
        (event) => {
          if (!event.isLoadingSubset) {
            // Subset loading finished, check if we can now mark ready
            this.updateLiveQueryStatus(config)
          }
        },
      )
      syncState.unsubscribeCallbacks.add(loadingSubsetUnsubscribe)

      const loadSubsetDataCallbacks = this.subscribeToAllCollections(
        config,
        fullSyncState,
      )

      this.maybeRunGraphFn = () =>
        this.scheduleGraphRun(loadSubsetDataCallbacks)

      // Initial run with callback to load more data if needed
      this.scheduleGraphRun(loadSubsetDataCallbacks)
    } catch (error) {
      try {
        teardown()
      } catch {
        // Preserve the setup failure. It is the error the caller can act on.
      }
      throw error
    }

    return teardown
  }

  /**
   * Compiles the query pipeline with all declared aliases.
   */
  private compileBasePipeline() {
    this.graphCache = new D2()
    this.inputsCache = Object.fromEntries(
      this.collectionSources.map((source) => [
        source.sourceId,
        this.graphCache!.newInput<any>(),
      ]),
    )

    const compilation = compileQuery(
      this.query,
      this.inputsCache as Record<string, KeyedStream>,
      this.collections,
      this.subscriptions,
      this.lazySourcesCallbacks,
      this.lazySources,
      this.optimizableOrderByCollections,
      (windowFn: (options: WindowOptions) => void) => {
        this.windowFn = windowFn
        // `setWindow` mutates the compiled top-K operator, which is replaced
        // whenever a cleaned-up live query compiles a fresh pipeline. Keep the
        // desired window on the builder and replay it into each new operator.
        if (this.currentWindow) {
          windowFn(this.currentWindow)
        }
      },
    )

    const materialized = materializeCompilation(
      compilation,
      this.config.getKey,
      this.hasJoins(this.query),
    )
    this.pipelineCache = materialized.pipeline
    this.sourceWhereClausesCache = compilation.sourceWhereClauses
    this.compiledAliasToCollectionId = compilation.aliasToCollectionId
    this.bucketFacadesCache = materialized.facades

    const missingSources = this.collectionSources
      .map((source) => source.sourceId)
      .filter((sourceId) => !Object.hasOwn(this.inputsCache!, sourceId))
    if (missingSources.length > 0) {
      throw new MissingAliasInputsError(missingSources)
    }
  }

  private maybeCompileBasePipeline() {
    if (!this.graphCache || !this.inputsCache || !this.pipelineCache) {
      this.compileBasePipeline()
    }
    return {
      graph: this.graphCache!,
      inputs: this.inputsCache!,
      pipeline: this.pipelineCache!,
    }
  }

  private extendPipelineWithChangeProcessing(
    config: SyncMethods<TResult>,
    syncState: SyncState,
  ): FullSyncState {
    const { begin, commit } = config
    const { graph, inputs, pipeline } = this.maybeCompileBasePipeline()

    // Accumulator for changes across all output callbacks within a single graph run.
    // This allows us to batch all changes from intermediate join states into a single
    // transaction, avoiding duplicate key errors when joins produce multiple outputs
    // for the same key (e.g., first output with null, then output with joined data).
    let pendingChanges: Map<unknown, Changes<TResult>> = new Map()

    pipeline.pipe(
      output((data) => {
        const messages = data.getInner()
        syncState.messagesCount += messages.length

        // Accumulate changes from this output callback into the pending changes map.
        // Changes for the same key are merged (inserts/deletes are added together).
        messages.reduce(accumulateChanges<TResult>, pendingChanges)
      }),
    )

    const bucketFacades = new BucketFacadeAdapter(
      this.id,
      this.bucketFacadesCache ?? [],
      (count) => {
        syncState.messagesCount += count
      },
    )
    syncState.unsubscribeCallbacks.add(() => bucketFacades.cleanup())

    // Flush pending changes and reset the accumulator.
    // Called at the end of each graph run to commit all accumulated changes.
    syncState.flushPendingChanges = () => {
      const hasParentChanges = pendingChanges.size > 0
      const hasChildChanges = bucketFacades.hasPendingChanges()

      if (!hasParentChanges && !hasChildChanges) {
        return
      }

      let facadePublication:
        | ReturnType<BucketFacadeAdapter[`flush`]>
        | undefined
      let rootPublication:
        | ReturnType<Collection[`_deferPublication`]>
        | undefined
      try {
        facadePublication = bucketFacades.flush()
        rootPublication = hasParentChanges
          ? config.collection._deferPublication()
          : undefined
        const changesToApply: Map<unknown, Changes<TResult>> = new Map(
          [...pendingChanges].map(([key, changes]) => {
            const resolved: Changes<TResult> = {
              ...changes,
              value: bucketFacades.resolve(changes.value),
            }
            if (changes.previousValue !== undefined) {
              resolved.previousValue = bucketFacades.resolve(
                changes.previousValue,
              )
            }
            return [key, resolved]
          }),
        )

        if (hasParentChanges) {
          begin()
          changesToApply.forEach(this.applyChanges.bind(this, config))
          if (hasOrderOnlyMove(changesToApply)) {
            markLayoutChange(config.collection)
          }
          commit()
        }
      } catch (error) {
        pendingChanges = new Map()
        rootPublication?.discard()
        facadePublication?.rollback()
        throw error
      }
      pendingChanges = new Map()

      let publicationError: unknown
      for (const publish of [
        rootPublication?.publish,
        facadePublication.publish,
      ]) {
        if (!publish) continue
        try {
          publish()
        } catch (error) {
          publicationError ??= error
        }
      }
      if (publicationError !== undefined) throw publicationError
    }

    graph.finalize()

    // Extend the sync state with the graph, inputs, and pipeline
    syncState.graph = graph
    syncState.inputs = inputs
    syncState.pipeline = pipeline

    return syncState as FullSyncState
  }

  private applyChanges(
    config: SyncMethods<TResult>,
    changes: {
      deletes: number
      inserts: number
      value: TResult
      orderByIndex: string | undefined
    },
    key: unknown,
  ) {
    const { write, collection } = config
    const { deletes, inserts, value, orderByIndex } = changes

    // Store the key of the result so that we can retrieve it in the
    // getKey function
    this.resultKeys.set(value, key)

    // Store the orderBy index if it exists
    if (orderByIndex !== undefined) {
      this.orderByIndices.set(value, orderByIndex)
    }

    // Simple singular insert.
    if (inserts && deletes === 0) {
      write({
        value,
        type: `insert`,
      })
    } else if (
      // Insert & update(s) (updates are a delete & insert)
      inserts > deletes ||
      // Just update(s) but the item is already in the collection (so
      // was inserted previously).
      (inserts === deletes && collection.has(collection.getKeyFromItem(value)))
    ) {
      write({
        value,
        type: `update`,
      })
      // Only delete is left as an option
    } else if (deletes > 0) {
      write({
        value,
        type: `delete`,
      })
    } else {
      throw new Error(
        `Could not apply changes: ${JSON.stringify(changes)}. This should never happen.`,
      )
    }
  }

  /**
   * Handle status changes from source collections
   */
  private handleSourceStatusChange(
    config: SyncMethods<TResult>,
    sourceId: string,
    collectionId: string,
    event: AllCollectionEvents[`status:change`],
  ) {
    const { status } = event

    // Handle error state - any source collection in error puts live query in error
    if (status === `error`) {
      this.erroredSourceIds.add(sourceId)
      this.setErrorState(
        `Source collection '${collectionId}' entered error state`,
      )
      return
    }

    // Handle manual cleanup - this should not happen due to GC prevention,
    // but could happen if user manually calls cleanup()
    if (status === `cleaned-up`) {
      this.transitionToError(
        `Source collection '${collectionId}' was manually cleaned up while live query '${this.id}' depends on it. ` +
          `Live queries prevent automatic GC, so this was likely a manual cleanup() call.`,
      )
      return
    }

    if (status === `ready`) {
      const recovered = this.erroredSourceIds.delete(sourceId)
      if (
        recovered &&
        !this.fatalQueryError &&
        this.erroredSourceIds.size === 0
      ) {
        this.isInErrorState = false
        this.maybeRunGraphFn?.()
      }
    }

    // Update ready status based on all source collections
    this.updateLiveQueryStatus(config)
  }

  /**
   * Update the live query status based on source collection statuses
   */
  private updateLiveQueryStatus(config: SyncMethods<TResult>) {
    const { markReady } = config

    // Don't update status if already in error
    if (this.isInErrorState) {
      return
    }

    const subscribedToAll = this.currentSyncState?.subscribedToAllCollections
    const allReady = this.allRequiredSourcesReady()
    const allDemandsSettled = [...this.activeDemands.values()].every(
      (demand) => demand.settled,
    )
    const isLoading = this.liveQueryCollection?.isLoadingSubset
    // Mark ready when:
    // 1. All subscriptions are set up (subscribedToAllCollections)
    // 2. All source collections are ready
    // 3. Every active route demand has settled
    // 4. The live query collection is not loading subset data
    // This prevents marking the live query ready before its data is processed
    // (fixes issue where useLiveQuery returns isReady=true with empty data)
    if (subscribedToAll && allReady && allDemandsSettled && !isLoading) {
      markReady()
    }
  }

  /**
   * Transition the live query to error state
   */
  private transitionToError(message: string, error?: unknown) {
    this.fatalQueryError = true
    this.setErrorState(message, error)
  }

  private setErrorState(message: string, error?: unknown) {
    this.isInErrorState = true

    // Log error to console for debugging
    console.error(`[Live Query Error] ${message}`)

    // Transition live query collection to error state
    this.liveQueryCollection?._lifecycle.markError(error ?? new Error(message))
  }

  private allRequiredSourcesReady() {
    return this.collectionSources.every(
      (source) =>
        // Only on-demand sources settle through route demand. Eager
        // loadSubset calls return immediately, so they must reach ready.
        (this.lazySources.has(source.sourceId) &&
          source.collection.config.syncMode === `on-demand`) ||
        source.collection.isReady(),
    )
  }

  /**
   * Creates one subscription per lexical collection source.
   * Each source gets independent filters, even when aliases or collections repeat.
   * Example: `{ employee: col, manager: col }` creates two separate subscriptions.
   */
  private subscribeToAllCollections(
    config: SyncMethods<TResult>,
    syncState: FullSyncState,
  ) {
    if (this.collectionSources.length === 0) {
      throw new Error(
        `Query '${this.id}' has no collection sources. This should not happen; please report.`,
      )
    }

    const loaders = this.collectionSources.map((source) => {
      const { sourceId, alias, collection } = source
      const collectionId = collection.id

      const dependencyBuilder = getCollectionBuilder(collection)
      if (dependencyBuilder && dependencyBuilder !== this) {
        this.sourceDependencies[sourceId] = [dependencyBuilder]
        this.builderDependencies.add(dependencyBuilder)
      } else {
        this.sourceDependencies[sourceId] = []
      }

      // CollectionSubscriber handles the actual subscription to the source collection
      // and feeds data into the D2 graph inputs for this specific alias
      const collectionSubscriber = new CollectionSubscriber(
        sourceId,
        alias,
        collection,
        this,
      )

      // Subscribe to status changes for status flow
      const statusUnsubscribe = collection.on(`status:change`, (event) => {
        this.handleSourceStatusChange(config, sourceId, collectionId, event)
      })
      syncState.unsubscribeCallbacks.add(statusUnsubscribe)

      // The source may have failed before this live query subscribed. Register
      // the listener first, then reconcile that current state so no transition
      // can be missed between observation and subscription.
      if (collection.status === `error`) {
        this.handleSourceStatusChange(config, sourceId, collectionId, {
          type: `status:change`,
          collection,
          status: `error`,
          previousStatus: `error`,
        })
      }

      const subscription = collectionSubscriber.subscribe()
      this.subscriptions[sourceId] = subscription

      const lazyCallbacks = this.lazySourcesCallbacks[sourceId]
      if (lazyCallbacks) {
        lazyCallbacks.setDemand = (plan, keys) =>
          collectionSubscriber.setDemand(subscription, plan, keys)
        for (const plan of lazyCallbacks.plans ?? []) {
          if (plan.initialKeys.size > 0) {
            lazyCallbacks.setDemand(plan, plan.initialKeys)
          }
        }
      }

      // Create a callback for loading more data if needed (used by OrderBy optimization)
      const loadMore = collectionSubscriber.loadMoreIfNeeded.bind(
        collectionSubscriber,
        subscription,
      )

      return loadMore
    })

    // Combine all loaders into a single callback that initiates loading more data
    // from any source that needs it. Returns true once all loaders have been called,
    // but the actual async loading may still be in progress.
    const loadSubsetDataCallbacks = () => {
      loaders.map((loader) => loader())
      return true
    }

    // Mark as subscribed so the graph can start running
    // (graph only runs when all collections are subscribed)
    syncState.subscribedToAllCollections = true

    // Note: We intentionally don't call updateLiveQueryStatus() here.
    // The graph hasn't run yet, so marking ready would be premature.
    // The canonical place to mark ready is after the graph processes data
    // in maybeRunGraph(), which ensures data has been processed first.

    return loadSubsetDataCallbacks
  }
}

function createOrderByComparator<T extends object>(
  orderByIndices: WeakMap<object, string>,
) {
  return (val1: T, val2: T): number => {
    // Use the orderBy index stored in the WeakMap
    const index1 = orderByIndices.get(val1)
    const index2 = orderByIndices.get(val2)

    // Compare fractional indices lexicographically
    if (index1 && index2) {
      if (index1 < index2) {
        return -1
      } else if (index1 > index2) {
        return 1
      } else {
        return 0
      }
    }

    // Fallback to no ordering if indices are missing
    return 0
  }
}

function accumulateChanges<T>(
  acc: Map<unknown, Changes<T>>,
  [[key, tupleData], multiplicity]: [
    [unknown, [any, string | undefined]],
    number,
  ],
) {
  // All queries now consistently return [value, orderByIndex] format
  // where orderByIndex is undefined for queries without ORDER BY
  const [value, orderByIndex] = tupleData as [T, string | undefined]

  const changes = acc.get(key) || {
    deletes: 0,
    inserts: 0,
    value,
    orderByIndex,
  }
  if (multiplicity < 0) {
    changes.deletes += Math.abs(multiplicity)
    // Remember the retracted (old) value + position so the flush can tell an
    // order-only move apart from a real value change.
    changes.previousValue = value
    changes.previousOrderByIndex = orderByIndex
  } else if (multiplicity > 0) {
    changes.inserts += multiplicity
    // Update value to the latest version for this key
    changes.value = value
    if (orderByIndex !== undefined) {
      changes.orderByIndex = orderByIndex
    }
  }
  acc.set(key, changes)
  return acc
}

/**
 * Decide whether a flush contains an order-only move.
 *
 * An "order-only move" — a row updated in place whose `orderByIndex` moved but
 * whose projected value is deep-equal to before — is swallowed by the value-diff
 * and needs an explicit layout notification. The collection coalesces that
 * signal with any ordinary row publication per subscriber.
 */
function hasOrderOnlyMove<T>(
  changesToApply: Map<unknown, Changes<T>>,
): boolean {
  for (const changes of changesToApply.values()) {
    const isUpdate = changes.inserts > 0 && changes.deletes > 0
    if (
      isUpdate &&
      changes.previousValue !== undefined &&
      deepEquals(changes.previousValue, changes.value) &&
      changes.orderByIndex !== changes.previousOrderByIndex
    ) {
      return true
    }
  }
  return false
}

/** Mark the collection's next commit as layout-changing. */
function markLayoutChange(collection: { _markLayoutChange: () => void }): void {
  collection._markLayoutChange()
}

function scopeLoadSubsetOutcomes(result: unknown, sourceId?: string): unknown {
  if (sourceId === undefined) return result
  if (isAppliedLoadSubsetOutcome(result)) return { ...result, sourceId }
  if (Array.isArray(result)) {
    return result.map((item) =>
      isAppliedLoadSubsetOutcome(item) ? { ...item, sourceId } : item,
    )
  }
  return result
}
