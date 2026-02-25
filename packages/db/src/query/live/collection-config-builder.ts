import { D2, output } from '@tanstack/db-ivm'
import { compileQuery } from '../compiler/index.js'
import { createCollection } from '../../collection/index.js'
import { IncludesSubquery } from '../ir.js'
import { buildQuery, getQueryIR } from '../builder/index.js'
import {
  MissingAliasInputsError,
  SetWindowRequiresOrderByError,
} from '../../errors.js'
import { transactionScopedScheduler } from '../../scheduler.js'
import { getActiveTransaction } from '../../transactions.js'
import { CollectionSubscriber } from './collection-subscriber.js'
import { getCollectionBuilder } from './collection-registry.js'
import { LIVE_QUERY_INTERNAL } from './internal.js'
import type { LiveQueryInternalUtils } from './internal.js'
import type {
  IncludesCompilationResult,
  WindowOptions,
} from '../compiler/index.js'
import type { SchedulerContextId } from '../../scheduler.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type { RootStreamBuilder } from '@tanstack/db-ivm'
import type { OrderByOptimizationInfo } from '../compiler/order-by.js'
import type { Collection } from '../../collection/index.js'
import type {
  CollectionConfigSingleRowOption,
  KeyedStream,
  ResultStream,
  StringCollationConfig,
  SyncConfig,
  UtilsRecord,
} from '../../types.js'
import type { Context, GetResult } from '../builder/types.js'
import type { BasicExpression, PropRef, QueryIR } from '../ir.js'
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

  // Reference to the live query collection for error state transitions
  public liveQueryCollection?: Collection<TResult, any, any>

  private windowFn: ((options: WindowOptions) => void) | undefined
  private currentWindow: WindowOptions | undefined

  private maybeRunGraphFn: (() => void) | undefined

  private readonly aliasDependencies: Record<
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
  private includesCache: Array<IncludesCompilationResult> | undefined

  // Map of source alias to subscription
  readonly subscriptions: Record<string, CollectionSubscription> = {}
  // Map of source aliases to functions that load keys for that lazy source
  lazySourcesCallbacks: Record<string, LazyCollectionCallbacks> = {}
  // Set of source aliases that are lazy (don't load initial state)
  readonly lazySources = new Set<string>()
  // Set of collection IDs that include an optimizable ORDER BY clause
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo> = {}

  constructor(
    private readonly config: LiveQueryCollectionConfig<TContext, TResult>,
  ) {
    // Generate a unique ID if not provided
    this.id = config.id || `live-query-${++liveQueryCollectionCounter}`

    this.query = buildQueryFromConfig(config)
    this.collections = extractCollectionsFromQuery(this.query)
    const collectionAliasesById = extractCollectionAliases(this.query)

    // Build a reverse lookup map from alias to collection instance.
    // This enables self-join support where the same collection can be referenced
    // multiple times with different aliases (e.g., { employee: col, manager: col })
    this.collectionByAlias = {}
    for (const [collectionId, aliases] of collectionAliasesById.entries()) {
      const collection = this.collections[collectionId]
      if (!collection) continue
      for (const alias of aliases) {
        this.collectionByAlias[alias] = collection
      }
    }

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
    }

    return false
  }

  getConfig(): CollectionConfigSingleRowOption<TResult> & {
    utils: LiveQueryCollectionUtils
  } {
    return {
      id: this.id,
      getKey:
        this.config.getKey ||
        ((item) => this.resultKeys.get(item) as string | number),
      sync: this.getSyncConfig(),
      compare: this.compare,
      defaultStringCollation: this.compareOptions,
      gcTime: this.config.gcTime || 5000, // 5 seconds by default for live queries
      schema: this.config.schema,
      onInsert: this.config.onInsert,
      onUpdate: this.config.onUpdate,
      onDelete: this.config.onDelete,
      startSync: this.config.startSync,
      singleResult: this.query.singleResult,
      utils: {
        getRunCount: this.getRunCount.bind(this),
        setWindow: this.setWindow.bind(this),
        getWindow: this.getWindow.bind(this),
        [LIVE_QUERY_INTERNAL]: {
          getBuilder: () => this,
          hasCustomGetKey: !!this.config.getKey,
          hasJoins: this.hasJoins(this.query),
          hasDistinct: !!this.query.distinct,
        },
      },
    }
  }

  setWindow(options: WindowOptions): true | Promise<void> {
    if (!this.windowFn) {
      throw new SetWindowRequiresOrderByError()
    }

    this.currentWindow = options
    this.windowFn(options)
    this.maybeRunGraphFn?.()

    // Check if loading a subset was triggered
    if (this.liveQueryCollection?.isLoadingSubset) {
      // Loading was triggered, return a promise that resolves when it completes
      return new Promise<void>((resolve) => {
        const unsubscribe = this.liveQueryCollection!.on(
          `loadingSubset:change`,
          (event) => {
            if (!event.isLoadingSubset) {
              unsubscribe()
              resolve()
            }
          },
        )
      })
    }

    // No loading was triggered
    return true
  }

  getWindow(): { offset: number; limit: number } | undefined {
    // Only return window if this is a windowed query (has orderBy and windowFn)
    if (!this.windowFn || !this.currentWindow) {
      return undefined
    }
    return {
      offset: this.currentWindow.offset ?? 0,
      limit: this.currentWindow.limit ?? 0,
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

  isLazyAlias(alias: string): boolean {
    return this.lazySources.has(alias)
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
          // Flush accumulated changes after each graph step to commit them as one transaction.
          // This ensures intermediate join states (like null on one side) don't cause
          // duplicate key errors when the full join result arrives in the same step.
          syncState.flushPendingChanges?.()
          callback?.()
          callbackCalled = true
        }

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
   * @param options.alias - Source alias that triggered this schedule; adds alias-specific dependencies
   * @param options.dependencies - Explicit dependency list; overrides auto-discovered dependencies
   */
  scheduleGraphRun(
    callback?: () => boolean,
    options?: {
      contextId?: SchedulerContextId
      jobId?: unknown
      alias?: string
      dependencies?: Array<CollectionConfigBuilder<any, any>>
    },
  ) {
    const contextId = options?.contextId ?? getActiveTransaction()?.id
    // Use the builder instance as the job ID for deduplication. This is memory-safe
    // because the scheduler's context Map is deleted after flushing (no long-term retention).
    const jobId = options?.jobId ?? this
    const dependentBuilders = (() => {
      if (options?.dependencies) {
        return options.dependencies
      }

      const deps = new Set(this.builderDependencies)
      if (options?.alias) {
        const aliasDeps = this.aliasDependencies[options.alias]
        if (aliasDeps) {
          for (const dep of aliasDeps) {
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
    // Store reference to the live query collection for error state transitions
    this.liveQueryCollection = config.collection
    // Store config and syncState as instance properties for the duration of this sync session
    this.currentSyncConfig = config

    const syncState: SyncState = {
      messagesCount: 0,
      subscribedToAllCollections: false,
      unsubscribeCallbacks: new Set<() => void>(),
    }

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

    this.maybeRunGraphFn = () => this.scheduleGraphRun(loadSubsetDataCallbacks)

    // Initial run with callback to load more data if needed
    this.scheduleGraphRun(loadSubsetDataCallbacks)

    // Return the unsubscribe function
    return () => {
      syncState.unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe())

      // Clear current sync session state
      this.currentSyncConfig = undefined
      this.currentSyncState = undefined

      // Clear all pending graph runs to prevent memory leaks from in-flight transactions
      // that may flush after the sync session ends
      this.pendingGraphRuns.clear()

      // Reset caches so a fresh graph/pipeline is compiled on next start
      // This avoids reusing a finalized D2 graph across GC restarts
      this.graphCache = undefined
      this.inputsCache = undefined
      this.pipelineCache = undefined
      this.sourceWhereClausesCache = undefined
      this.includesCache = undefined

      // Reset lazy source alias state
      this.lazySources.clear()
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
    }
  }

  /**
   * Compiles the query pipeline with all declared aliases.
   */
  private compileBasePipeline() {
    this.graphCache = new D2()
    this.inputsCache = Object.fromEntries(
      Object.keys(this.collectionByAlias).map((alias) => [
        alias,
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
      },
    )

    this.pipelineCache = compilation.pipeline
    this.sourceWhereClausesCache = compilation.sourceWhereClauses
    this.compiledAliasToCollectionId = compilation.aliasToCollectionId
    this.includesCache = compilation.includes

    // Defensive check: verify all compiled aliases have corresponding inputs
    // This should never happen since all aliases come from user declarations,
    // but catch it early if the assumption is violated in the future.
    const missingAliases = Object.keys(this.compiledAliasToCollectionId).filter(
      (alias) => !Object.hasOwn(this.inputsCache!, alias),
    )
    if (missingAliases.length > 0) {
      throw new MissingAliasInputsError(missingAliases)
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

    // Set up includes output routing and child collection lifecycle
    const includesState = this.setupIncludesOutput(
      this.includesCache,
      syncState,
    )

    // Flush pending changes and reset the accumulator.
    // Called at the end of each graph run to commit all accumulated changes.
    syncState.flushPendingChanges = () => {
      const hasParentChanges = pendingChanges.size > 0
      const hasChildChanges = hasPendingIncludesChanges(includesState)

      if (!hasParentChanges && !hasChildChanges) {
        return
      }

      let changesToApply = pendingChanges

      // When a custom getKey is provided, multiple D2 internal keys may map
      // to the same user-visible key. Re-accumulate by custom key so that a
      // retract + insert for the same logical row merges into an UPDATE
      // instead of a separate DELETE and INSERT that can race.
      if (this.config.getKey) {
        const merged = new Map<unknown, Changes<TResult>>()
        for (const [, changes] of pendingChanges) {
          const customKey = this.config.getKey(changes.value)
          const existing = merged.get(customKey)
          if (existing) {
            existing.inserts += changes.inserts
            existing.deletes += changes.deletes
            // Keep the value from the insert side (the new value)
            if (changes.inserts > 0) {
              existing.value = changes.value
              if (changes.orderByIndex !== undefined) {
                existing.orderByIndex = changes.orderByIndex
              }
            }
          } else {
            merged.set(customKey, { ...changes })
          }
        }
        changesToApply = merged
      }

      // 1. Flush parent changes
      if (hasParentChanges) {
        begin()
        changesToApply.forEach(this.applyChanges.bind(this, config))
        commit()
      }
      pendingChanges = new Map()

      // 2. Process includes: create/dispose child Collections, route child changes
      flushIncludesState(
        includesState,
        config.collection,
        this.id,
        hasParentChanges ? changesToApply : null,
      )
    }

    graph.finalize()

    // Extend the sync state with the graph, inputs, and pipeline
    syncState.graph = graph
    syncState.inputs = inputs
    syncState.pipeline = pipeline

    return syncState as FullSyncState
  }

  /**
   * Sets up output callbacks for includes child pipelines.
   * Each includes entry gets its own output callback that accumulates child changes,
   * and a child registry that maps correlation key → child Collection.
   */
  private setupIncludesOutput(
    includesEntries: Array<IncludesCompilationResult> | undefined,
    syncState: SyncState,
  ): Array<IncludesOutputState> {
    if (!includesEntries || includesEntries.length === 0) {
      return []
    }

    return includesEntries.map((entry) => {
      const state: IncludesOutputState = {
        fieldName: entry.fieldName,
        correlationField: entry.correlationField,
        childCorrelationField: entry.childCorrelationField,
        hasOrderBy: entry.hasOrderBy,
        childRegistry: new Map(),
        pendingChildChanges: new Map(),
        correlationToParentKeys: new Map(),
      }

      // Attach output callback on the child pipeline
      entry.pipeline.pipe(
        output((data) => {
          const messages = data.getInner()
          syncState.messagesCount += messages.length

          for (const [[childKey, tupleData], multiplicity] of messages) {
            const [childResult, _orderByIndex, correlationKey] =
              tupleData as unknown as [any, string | undefined, unknown]

            // Accumulate by [correlationKey, childKey]
            let byChild = state.pendingChildChanges.get(correlationKey)
            if (!byChild) {
              byChild = new Map()
              state.pendingChildChanges.set(correlationKey, byChild)
            }

            const existing = byChild.get(childKey) || {
              deletes: 0,
              inserts: 0,
              value: childResult,
              orderByIndex: _orderByIndex,
            }

            if (multiplicity < 0) {
              existing.deletes += Math.abs(multiplicity)
            } else if (multiplicity > 0) {
              existing.inserts += multiplicity
              existing.value = childResult
            }

            byChild.set(childKey, existing)
          }
        }),
      )

      // Set up shared buffers for nested includes (e.g., comments inside issues)
      if (entry.childCompilationResult.includes) {
        state.nestedSetups = setupNestedPipelines(
          entry.childCompilationResult.includes,
          syncState,
        )
        state.nestedRoutingIndex = new Map()
        state.nestedRoutingReverseIndex = new Map()
      }

      return state
    })
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
    collectionId: string,
    event: AllCollectionEvents[`status:change`],
  ) {
    const { status } = event

    // Handle error state - any source collection in error puts live query in error
    if (status === `error`) {
      this.transitionToError(
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
    const allReady = this.allCollectionsReady()
    const isLoading = this.liveQueryCollection?.isLoadingSubset
    // Mark ready when:
    // 1. All subscriptions are set up (subscribedToAllCollections)
    // 2. All source collections are ready
    // 3. The live query collection is not loading subset data
    // This prevents marking the live query ready before its data is processed
    // (fixes issue where useLiveQuery returns isReady=true with empty data)
    if (subscribedToAll && allReady && !isLoading) {
      markReady()
    }
  }

  /**
   * Transition the live query to error state
   */
  private transitionToError(message: string) {
    this.isInErrorState = true

    // Log error to console for debugging
    console.error(`[Live Query Error] ${message}`)

    // Transition live query collection to error state
    this.liveQueryCollection?._lifecycle.setStatus(`error`)
  }

  private allCollectionsReady() {
    return Object.values(this.collections).every((collection) =>
      collection.isReady(),
    )
  }

  /**
   * Creates per-alias subscriptions enabling self-join support.
   * Each alias gets its own subscription with independent filters, even for the same collection.
   * Example: `{ employee: col, manager: col }` creates two separate subscriptions.
   */
  private subscribeToAllCollections(
    config: SyncMethods<TResult>,
    syncState: FullSyncState,
  ) {
    // Use compiled aliases as the source of truth - these include all aliases from the query
    // including those from subqueries, which may not be in collectionByAlias
    const compiledAliases = Object.entries(this.compiledAliasToCollectionId)
    if (compiledAliases.length === 0) {
      throw new Error(
        `Compiler returned no alias metadata for query '${this.id}'. This should not happen; please report.`,
      )
    }

    // Create a separate subscription for each alias, enabling self-joins where the same
    // collection can be used multiple times with different filters and subscriptions
    const loaders = compiledAliases.map(([alias, collectionId]) => {
      // Try collectionByAlias first (for declared aliases), fall back to collections (for subquery aliases)
      const collection =
        this.collectionByAlias[alias] ?? this.collections[collectionId]!

      const dependencyBuilder = getCollectionBuilder(collection)
      if (dependencyBuilder && dependencyBuilder !== this) {
        this.aliasDependencies[alias] = [dependencyBuilder]
        this.builderDependencies.add(dependencyBuilder)
      } else {
        this.aliasDependencies[alias] = []
      }

      // CollectionSubscriber handles the actual subscription to the source collection
      // and feeds data into the D2 graph inputs for this specific alias
      const collectionSubscriber = new CollectionSubscriber(
        alias,
        collectionId,
        collection,
        this,
      )

      // Subscribe to status changes for status flow
      const statusUnsubscribe = collection.on(`status:change`, (event) => {
        this.handleSourceStatusChange(config, collectionId, event)
      })
      syncState.unsubscribeCallbacks.add(statusUnsubscribe)

      const subscription = collectionSubscriber.subscribe()
      // Store subscription by alias (not collection ID) to support lazy loading
      // which needs to look up subscriptions by their query alias
      this.subscriptions[alias] = subscription

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

function buildQueryFromConfig<TContext extends Context>(
  config: LiveQueryCollectionConfig<any, any>,
) {
  // Build the query using the provided query builder function or instance
  if (typeof config.query === `function`) {
    return buildQuery<TContext>(config.query)
  }
  return getQueryIR(config.query)
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

/**
 * Helper function to extract collections from a compiled query
 * Traverses the query IR to find all collection references
 * Maps collections by their ID (not alias) as expected by the compiler
 */
function extractCollectionsFromQuery(
  query: any,
): Record<string, Collection<any, any, any>> {
  const collections: Record<string, any> = {}

  // Helper function to recursively extract collections from a query or source
  function extractFromSource(source: any) {
    if (source.type === `collectionRef`) {
      collections[source.collection.id] = source.collection
    } else if (source.type === `queryRef`) {
      // Recursively extract from subquery
      extractFromQuery(source.query)
    }
  }

  // Helper function to recursively extract collections from a query
  function extractFromQuery(q: any) {
    // Extract from FROM clause
    if (q.from) {
      extractFromSource(q.from)
    }

    // Extract from JOIN clauses
    if (q.join && Array.isArray(q.join)) {
      for (const joinClause of q.join) {
        if (joinClause.from) {
          extractFromSource(joinClause.from)
        }
      }
    }

    // Extract from SELECT (for IncludesSubquery)
    if (q.select) {
      extractFromSelect(q.select)
    }
  }

  function extractFromSelect(select: any) {
    for (const [key, value] of Object.entries(select)) {
      if (typeof key === `string` && key.startsWith(`__SPREAD_SENTINEL__`)) {
        continue
      }
      if (value instanceof IncludesSubquery) {
        extractFromQuery(value.query)
      } else if (isNestedSelectObject(value)) {
        extractFromSelect(value)
      }
    }
  }

  // Start extraction from the root query
  extractFromQuery(query)

  return collections
}

/**
 * Helper function to extract the collection that is referenced in the query's FROM clause.
 * The FROM clause may refer directly to a collection or indirectly to a subquery.
 */
function extractCollectionFromSource(query: any): Collection<any, any, any> {
  const from = query.from

  if (from.type === `collectionRef`) {
    return from.collection
  } else if (from.type === `queryRef`) {
    // Recursively extract from subquery
    return extractCollectionFromSource(from.query)
  }

  throw new Error(
    `Failed to extract collection. Invalid FROM clause: ${JSON.stringify(query)}`,
  )
}

/**
 * Extracts all aliases used for each collection across the entire query tree.
 *
 * Traverses the QueryIR recursively to build a map from collection ID to all aliases
 * that reference that collection. This is essential for self-join support, where the
 * same collection may be referenced multiple times with different aliases.
 *
 * For example, given a query like:
 * ```ts
 * q.from({ employee: employeesCollection })
 *   .join({ manager: employeesCollection }, ({ employee, manager }) =>
 *     eq(employee.managerId, manager.id)
 *   )
 * ```
 *
 * This function would return:
 * ```
 * Map { "employees" => Set { "employee", "manager" } }
 * ```
 *
 * @param query - The query IR to extract aliases from
 * @returns A map from collection ID to the set of all aliases referencing that collection
 */
function extractCollectionAliases(query: QueryIR): Map<string, Set<string>> {
  const aliasesById = new Map<string, Set<string>>()

  function recordAlias(source: any) {
    if (!source) return

    if (source.type === `collectionRef`) {
      const { id } = source.collection
      const existing = aliasesById.get(id)
      if (existing) {
        existing.add(source.alias)
      } else {
        aliasesById.set(id, new Set([source.alias]))
      }
    } else if (source.type === `queryRef`) {
      traverse(source.query)
    }
  }

  function traverseSelect(select: any) {
    for (const [key, value] of Object.entries(select)) {
      if (typeof key === `string` && key.startsWith(`__SPREAD_SENTINEL__`)) {
        continue
      }
      if (value instanceof IncludesSubquery) {
        traverse(value.query)
      } else if (isNestedSelectObject(value)) {
        traverseSelect(value)
      }
    }
  }

  function traverse(q?: QueryIR) {
    if (!q) return

    recordAlias(q.from)

    if (q.join) {
      for (const joinClause of q.join) {
        recordAlias(joinClause.from)
      }
    }

    if (q.select) {
      traverseSelect(q.select)
    }
  }

  traverse(query)

  return aliasesById
}

/**
 * Check if a value is a nested select object (plain object, not an expression)
 */
function isNestedSelectObject(obj: any): boolean {
  if (obj === null || typeof obj !== `object`) return false
  if (obj instanceof IncludesSubquery) return false
  // Expression-like objects have a .type property
  if (`type` in obj && typeof obj.type === `string`) return false
  // Ref proxies from spread operations
  if (obj.__refProxy) return false
  return true
}

/**
 * Shared buffer setup for a single nested includes level.
 * Pipeline output writes into the buffer; during flush the buffer is drained
 * into per-entry states via the routing index.
 */
type NestedIncludesSetup = {
  compilationResult: IncludesCompilationResult
  /** Shared buffer: nestedCorrelationKey → Map<childKey, Changes> */
  buffer: Map<unknown, Map<unknown, Changes<any>>>
  /** For 3+ levels of nesting */
  nestedSetups?: Array<NestedIncludesSetup>
}

/**
 * State tracked per includes entry for output routing and child lifecycle
 */
type IncludesOutputState = {
  fieldName: string
  correlationField: PropRef
  childCorrelationField: PropRef
  /** Whether the child query has an ORDER BY clause */
  hasOrderBy: boolean
  /** Maps correlation key value → child Collection entry */
  childRegistry: Map<unknown, ChildCollectionEntry>
  /** Pending child changes: correlationKey → Map<childKey, Changes> */
  pendingChildChanges: Map<unknown, Map<unknown, Changes<any>>>
  /** Reverse index: correlation key → Set of parent collection keys */
  correlationToParentKeys: Map<unknown, Set<unknown>>
  /** Shared nested pipeline setups (one per nested includes level) */
  nestedSetups?: Array<NestedIncludesSetup>
  /** nestedCorrelationKey → parentCorrelationKey */
  nestedRoutingIndex?: Map<unknown, unknown>
  /** parentCorrelationKey → Set<nestedCorrelationKeys> */
  nestedRoutingReverseIndex?: Map<unknown, Set<unknown>>
}

type ChildCollectionEntry = {
  collection: Collection<any, any, any>
  syncMethods: SyncMethods<any> | null
  resultKeys: WeakMap<object, unknown>
  orderByIndices: WeakMap<object, string> | null
  /** Per-entry nested includes states (one per nested includes level) */
  includesStates?: Array<IncludesOutputState>
}

/**
 * Sets up shared buffers for nested includes pipelines.
 * Instead of writing directly into a single shared IncludesOutputState,
 * each nested pipeline writes into a buffer that is later drained per-entry.
 */
function setupNestedPipelines(
  includes: Array<IncludesCompilationResult>,
  syncState: SyncState,
): Array<NestedIncludesSetup> {
  return includes.map((entry) => {
    const buffer: Map<unknown, Map<unknown, Changes<any>>> = new Map()

    // Attach output callback that writes into the shared buffer
    entry.pipeline.pipe(
      output((data) => {
        const messages = data.getInner()
        syncState.messagesCount += messages.length

        for (const [[childKey, tupleData], multiplicity] of messages) {
          const [childResult, _orderByIndex, correlationKey] =
            tupleData as unknown as [any, string | undefined, unknown]

          let byChild = buffer.get(correlationKey)
          if (!byChild) {
            byChild = new Map()
            buffer.set(correlationKey, byChild)
          }

          const existing = byChild.get(childKey) || {
            deletes: 0,
            inserts: 0,
            value: childResult,
            orderByIndex: _orderByIndex,
          }

          if (multiplicity < 0) {
            existing.deletes += Math.abs(multiplicity)
          } else if (multiplicity > 0) {
            existing.inserts += multiplicity
            existing.value = childResult
          }

          byChild.set(childKey, existing)
        }
      }),
    )

    const setup: NestedIncludesSetup = {
      compilationResult: entry,
      buffer,
    }

    // Recursively set up deeper levels
    if (entry.childCompilationResult.includes) {
      setup.nestedSetups = setupNestedPipelines(
        entry.childCompilationResult.includes,
        syncState,
      )
    }

    return setup
  })
}

/**
 * Creates fresh per-entry IncludesOutputState array from NestedIncludesSetup array.
 * Each entry gets its own isolated state for nested includes.
 */
function createPerEntryIncludesStates(
  setups: Array<NestedIncludesSetup>,
): Array<IncludesOutputState> {
  return setups.map((setup) => {
    const state: IncludesOutputState = {
      fieldName: setup.compilationResult.fieldName,
      correlationField: setup.compilationResult.correlationField,
      childCorrelationField: setup.compilationResult.childCorrelationField,
      hasOrderBy: setup.compilationResult.hasOrderBy,
      childRegistry: new Map(),
      pendingChildChanges: new Map(),
      correlationToParentKeys: new Map(),
    }

    if (setup.nestedSetups) {
      state.nestedSetups = setup.nestedSetups
      state.nestedRoutingIndex = new Map()
      state.nestedRoutingReverseIndex = new Map()
    }

    return state
  })
}

/**
 * Drains shared buffers into per-entry states using the routing index.
 * Returns the set of parent correlation keys that had changes routed to them.
 */
function drainNestedBuffers(
  state: IncludesOutputState,
): Set<unknown> {
  const dirtyCorrelationKeys = new Set<unknown>()

  if (!state.nestedSetups) return dirtyCorrelationKeys

  for (let i = 0; i < state.nestedSetups.length; i++) {
    const setup = state.nestedSetups[i]!
    const toDelete: Array<unknown> = []

    for (const [nestedCorrelationKey, childChanges] of setup.buffer) {
      const parentCorrelationKey = state.nestedRoutingIndex!.get(nestedCorrelationKey)
      if (parentCorrelationKey === undefined) {
        // Unroutable — parent not yet seen; keep in buffer
        continue
      }

      const entry = state.childRegistry.get(parentCorrelationKey)
      if (!entry || !entry.includesStates) {
        continue
      }

      // Route changes into this entry's per-entry state at position i
      const entryState = entry.includesStates[i]!
      for (const [childKey, changes] of childChanges) {
        let byChild = entryState.pendingChildChanges.get(nestedCorrelationKey)
        if (!byChild) {
          byChild = new Map()
          entryState.pendingChildChanges.set(nestedCorrelationKey, byChild)
        }
        const existing = byChild.get(childKey)
        if (existing) {
          existing.inserts += changes.inserts
          existing.deletes += changes.deletes
          if (changes.inserts > 0) {
            existing.value = changes.value
            if (changes.orderByIndex !== undefined) {
              existing.orderByIndex = changes.orderByIndex
            }
          }
        } else {
          byChild.set(childKey, { ...changes })
        }
      }

      dirtyCorrelationKeys.add(parentCorrelationKey)
      toDelete.push(nestedCorrelationKey)
    }

    for (const key of toDelete) {
      setup.buffer.delete(key)
    }
  }

  return dirtyCorrelationKeys
}

/**
 * Updates the routing index after processing child changes.
 * Maps nested correlation keys to parent correlation keys so that
 * grandchild changes can be routed to the correct per-entry state.
 */
function updateRoutingIndex(
  state: IncludesOutputState,
  correlationKey: unknown,
  childChanges: Map<unknown, Changes<any>>,
): void {
  if (!state.nestedSetups) return

  for (const setup of state.nestedSetups) {
    const nestedFieldPath = setup.compilationResult.correlationField.path.slice(1)

    for (const [, change] of childChanges) {
      if (change.inserts > 0) {
        // Extract nested correlation key from child result
        let nestedCorrelationKey: unknown = change.value
        for (const segment of nestedFieldPath) {
          if (nestedCorrelationKey == null) break
          nestedCorrelationKey = (nestedCorrelationKey as any)[segment]
        }

        if (nestedCorrelationKey != null) {
          state.nestedRoutingIndex!.set(nestedCorrelationKey, correlationKey)
          let reverseSet = state.nestedRoutingReverseIndex!.get(correlationKey)
          if (!reverseSet) {
            reverseSet = new Set()
            state.nestedRoutingReverseIndex!.set(correlationKey, reverseSet)
          }
          reverseSet.add(nestedCorrelationKey)
        }
      } else if (change.deletes > 0 && change.inserts === 0) {
        // Remove from routing index
        let nestedCorrelationKey: unknown = change.value
        for (const segment of nestedFieldPath) {
          if (nestedCorrelationKey == null) break
          nestedCorrelationKey = (nestedCorrelationKey as any)[segment]
        }

        if (nestedCorrelationKey != null) {
          state.nestedRoutingIndex!.delete(nestedCorrelationKey)
          const reverseSet = state.nestedRoutingReverseIndex!.get(correlationKey)
          if (reverseSet) {
            reverseSet.delete(nestedCorrelationKey)
            if (reverseSet.size === 0) {
              state.nestedRoutingReverseIndex!.delete(correlationKey)
            }
          }
        }
      }
    }
  }
}

/**
 * Cleans routing index entries when a parent is deleted.
 * Uses the reverse index to find and remove all nested routing entries.
 */
function cleanRoutingIndexOnDelete(
  state: IncludesOutputState,
  correlationKey: unknown,
): void {
  if (!state.nestedRoutingReverseIndex) return

  const nestedKeys = state.nestedRoutingReverseIndex.get(correlationKey)
  if (nestedKeys) {
    for (const nestedKey of nestedKeys) {
      state.nestedRoutingIndex!.delete(nestedKey)
    }
    state.nestedRoutingReverseIndex.delete(correlationKey)
  }
}

/**
 * Recursively checks whether any nested buffer has pending changes.
 */
function hasNestedBufferChanges(
  setups: Array<NestedIncludesSetup>,
): boolean {
  for (const setup of setups) {
    if (setup.buffer.size > 0) return true
    if (setup.nestedSetups && hasNestedBufferChanges(setup.nestedSetups)) return true
  }
  return false
}

/**
 * Creates a child Collection entry for includes subqueries.
 * The child Collection is a full-fledged Collection instance that starts syncing immediately.
 */
function createChildCollectionEntry(
  parentId: string,
  fieldName: string,
  correlationKey: unknown,
  hasOrderBy: boolean,
  nestedSetups?: Array<NestedIncludesSetup>,
): ChildCollectionEntry {
  const resultKeys = new WeakMap<object, unknown>()
  const orderByIndices = hasOrderBy ? new WeakMap<object, string>() : null
  let syncMethods: SyncMethods<any> | null = null

  const compare = orderByIndices
    ? createOrderByComparator(orderByIndices)
    : undefined

  const collection = createCollection<any, string | number>({
    id: `${parentId}-${fieldName}-${String(correlationKey)}`,
    getKey: (item: any) => resultKeys.get(item) as string | number,
    compare,
    sync: {
      rowUpdateMode: `full`,
      sync: (methods) => {
        syncMethods = methods
        return () => {
          syncMethods = null
        }
      },
    },
    startSync: true,
  })

  const entry: ChildCollectionEntry = {
    collection,
    get syncMethods() {
      return syncMethods
    },
    resultKeys,
    orderByIndices,
  }

  if (nestedSetups) {
    entry.includesStates = createPerEntryIncludesStates(nestedSetups)
  }

  return entry
}

/**
 * Flushes includes state using a bottom-up per-entry approach.
 * Five phases ensure correct ordering:
 *   1. Parent INSERTs — create child entries with per-entry nested states
 *   2. Child changes — apply to child Collections, update routing index
 *   3. Drain nested buffers — route buffered grandchild changes to per-entry states
 *   4. Flush per-entry states — recursively flush nested includes on each entry
 *   5. Parent DELETEs — clean up child entries and routing index
 */
function flushIncludesState(
  includesState: Array<IncludesOutputState>,
  parentCollection: Collection<any, any, any>,
  parentId: string,
  parentChanges: Map<unknown, Changes<any>> | null,
): void {
  for (const state of includesState) {
    // Phase 1: Parent INSERTs — ensure a child Collection exists for every parent
    if (parentChanges) {
      const fieldPath = state.correlationField.path.slice(1) // remove alias prefix
      for (const [parentKey, changes] of parentChanges) {
        if (changes.inserts > 0) {
          const parentResult = changes.value
          // Extract the correlation key value from the parent result
          let correlationKey: unknown = parentResult
          for (const segment of fieldPath) {
            if (correlationKey == null) break
            correlationKey = (correlationKey as any)[segment]
          }

          if (correlationKey != null) {
            // Ensure child Collection exists for this correlation key
            if (!state.childRegistry.has(correlationKey)) {
              const entry = createChildCollectionEntry(
                parentId,
                state.fieldName,
                correlationKey,
                state.hasOrderBy,
                state.nestedSetups,
              )
              state.childRegistry.set(correlationKey, entry)
            }
            // Update reverse index: correlation key → parent keys
            let parentKeys = state.correlationToParentKeys.get(correlationKey)
            if (!parentKeys) {
              parentKeys = new Set()
              state.correlationToParentKeys.set(correlationKey, parentKeys)
            }
            parentKeys.add(parentKey)

            // Attach child Collection to the parent result
            parentResult[state.fieldName] =
              state.childRegistry.get(correlationKey)!.collection
          }
        }
      }
    }

    // Phase 2: Child changes — apply to child Collections
    // Track which entries had child changes and capture their childChanges maps
    const entriesWithChildChanges = new Map<unknown, { entry: ChildCollectionEntry; childChanges: Map<unknown, Changes<any>> }>()

    if (state.pendingChildChanges.size > 0) {
      for (const [correlationKey, childChanges] of state.pendingChildChanges) {
        // Ensure child Collection exists for this correlation key
        let entry = state.childRegistry.get(correlationKey)
        if (!entry) {
          entry = createChildCollectionEntry(
            parentId,
            state.fieldName,
            correlationKey,
            state.hasOrderBy,
            state.nestedSetups,
          )
          state.childRegistry.set(correlationKey, entry)
        }

        // Attach the child Collection to ANY parent that has this correlation key
        attachChildCollectionToParent(
          parentCollection,
          state.fieldName,
          correlationKey,
          state.correlationToParentKeys,
          entry.collection,
        )

        // Apply child changes to the child Collection
        if (entry.syncMethods) {
          entry.syncMethods.begin()
          for (const [childKey, change] of childChanges) {
            entry.resultKeys.set(change.value, childKey)
            if (entry.orderByIndices && change.orderByIndex !== undefined) {
              entry.orderByIndices.set(change.value, change.orderByIndex)
            }
            if (change.inserts > 0 && change.deletes === 0) {
              entry.syncMethods.write({ value: change.value, type: `insert` })
            } else if (
              change.inserts > change.deletes ||
              (change.inserts === change.deletes &&
                entry.syncMethods.collection.has(
                  entry.syncMethods.collection.getKeyFromItem(change.value),
                ))
            ) {
              entry.syncMethods.write({ value: change.value, type: `update` })
            } else if (change.deletes > 0) {
              entry.syncMethods.write({ value: change.value, type: `delete` })
            }
          }
          entry.syncMethods.commit()
        }

        // Update routing index for nested includes
        updateRoutingIndex(state, correlationKey, childChanges)

        entriesWithChildChanges.set(correlationKey, { entry, childChanges })
      }
      state.pendingChildChanges.clear()
    }

    // Phase 3: Drain nested buffers — route buffered grandchild changes to per-entry states
    const dirtyFromBuffers = drainNestedBuffers(state)

    // Phase 4: Flush per-entry states
    // First: entries that had child changes in Phase 2
    for (const [, { entry, childChanges }] of entriesWithChildChanges) {
      if (entry.includesStates) {
        flushIncludesState(
          entry.includesStates,
          entry.collection,
          entry.collection.id,
          childChanges,
        )
      }
    }
    // Then: entries that only had buffer-routed changes (no child changes at this level)
    for (const correlationKey of dirtyFromBuffers) {
      if (entriesWithChildChanges.has(correlationKey)) continue
      const entry = state.childRegistry.get(correlationKey)
      if (entry?.includesStates) {
        flushIncludesState(
          entry.includesStates,
          entry.collection,
          entry.collection.id,
          null,
        )
      }
    }

    // Phase 5: Parent DELETEs — dispose child Collections and clean up
    if (parentChanges) {
      const fieldPath = state.correlationField.path.slice(1)
      for (const [parentKey, changes] of parentChanges) {
        if (changes.deletes > 0 && changes.inserts === 0) {
          let correlationKey: unknown = changes.value
          for (const segment of fieldPath) {
            if (correlationKey == null) break
            correlationKey = (correlationKey as any)[segment]
          }
          if (correlationKey != null) {
            cleanRoutingIndexOnDelete(state, correlationKey)
            state.childRegistry.delete(correlationKey)
            // Clean up reverse index
            const parentKeys = state.correlationToParentKeys.get(correlationKey)
            if (parentKeys) {
              parentKeys.delete(parentKey)
              if (parentKeys.size === 0) {
                state.correlationToParentKeys.delete(correlationKey)
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Checks whether any includes state has pending changes that need to be flushed.
 * Checks direct pending child changes and shared nested buffers.
 */
function hasPendingIncludesChanges(
  states: Array<IncludesOutputState>,
): boolean {
  for (const state of states) {
    if (state.pendingChildChanges.size > 0) return true
    if (state.nestedSetups && hasNestedBufferChanges(state.nestedSetups)) return true
  }
  return false
}

/**
 * Attaches a child Collection to parent rows that match a given correlation key.
 * Uses the reverse index to look up parent keys directly instead of scanning.
 */
function attachChildCollectionToParent(
  parentCollection: Collection<any, any, any>,
  fieldName: string,
  correlationKey: unknown,
  correlationToParentKeys: Map<unknown, Set<unknown>>,
  childCollection: Collection<any, any, any>,
): void {
  const parentKeys = correlationToParentKeys.get(correlationKey)
  if (!parentKeys) return

  for (const parentKey of parentKeys) {
    const item = parentCollection.get(parentKey as any)
    if (item) {
      item[fieldName] = childCollection
    }
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
