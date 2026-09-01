import { D2, output } from '@tanstack/db-ivm'
import {
  getActivePublicationContext,
  transactionScopedScheduler,
} from '../scheduler.js'
import { getActiveTransaction } from '../transactions.js'
import { compileQuery } from './compiler/index.js'
import {
  normalizeExpressionPaths,
  normalizeOrderByPaths,
} from './compiler/expressions.js'
import { getCollectionBuilder } from './live/collection-registry.js'
import { SubsetDemandController } from './live/subset-demand-controller.js'
import {
  buildQueryFromConfig,
  computeOrderedLoadCursor,
  computeSubscriptionOrderByHints,
  extractCollectionSources,
  extractCollectionsFromQuery,
  reconcileChangesForD2,
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
import type {
  LazyCollectionCallbacks,
  LazyDemandPlan,
} from './compiler/joins.js'
import type {
  AppliedLoadSubsetOutcome,
  ChangeMessage,
  KeyedStream,
  LoadSubsetRequestResult,
  ResultStream,
} from '../types.js'

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Event types for query result deltas */
export type DeltaType = 'enter' | 'exit' | 'update'

/** Delta event emitted when a row enters, exits, or updates within a query result */
export type DeltaEvent<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> =
  | {
      type: 'enter'
      key: TKey
      /** Current value for the entering row */
      value: TRow
      metadata?: Record<string, unknown>
    }
  | {
      type: 'exit'
      key: TKey
      /** Current value for the exiting row */
      value: TRow
      metadata?: Record<string, unknown>
    }
  | {
      type: 'update'
      key: TKey
      /** Current value after the update */
      value: TRow
      /** Previous value before the batch */
      previousValue: TRow
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

type EffectEventHandler<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = (event: DeltaEvent<TRow, TKey>, ctx: EffectContext) => void | Promise<void>

type EffectBatchHandler<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = (
  events: Array<DeltaEvent<TRow, TKey>>,
  ctx: EffectContext,
) => void | Promise<void>

/** Effect configuration */
export interface EffectConfig<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  /** Optional ID for debugging/tracing */
  id?: string

  /** Query to watch for deltas */
  query: EffectQueryInput<any>

  /** Called once for each row entering the query result */
  onEnter?: EffectEventHandler<TRow, TKey>

  /** Called once for each row updating within the query result */
  onUpdate?: EffectEventHandler<TRow, TKey>

  /** Called once for each row exiting the query result */
  onExit?: EffectEventHandler<TRow, TKey>

  /** Called once per graph run with all delta events from that batch */
  onBatch?: EffectBatchHandler<TRow, TKey>

  /** Error handler for exceptions thrown by effect callbacks */
  onError?: (error: Error, event: DeltaEvent<TRow, TKey>) => void

  /**
   * Called when a source collection enters an error or cleaned-up state.
   * The effect is automatically disposed after this callback fires.
   * If not provided, the error is logged to console.error.
   */
  onSourceError?: (error: Error) => void

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
  /** Value from the latest insert (the newest/current value) */
  insertValue?: T
  /** Value from the first delete (the oldest/previous value before the batch) */
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
 *   onEnter: async (event) => {
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
    if (events.length === 0) return

    // Batch handler
    if (config.onBatch) {
      try {
        const result = config.onBatch(events, ctx)
        if (result instanceof Promise) {
          const tracked = result.catch((error) => {
            reportError(error, events[0]!, config.onError)
          })
          trackPromise(tracked, inFlightHandlers)
        }
      } catch (error) {
        // For batch handler errors, report with first event as context
        reportError(error, events[0]!, config.onError)
      }
    }

    for (const event of events) {
      if (abortController.signal.aborted) break

      const handler = getHandlerForEvent(event, config)
      if (!handler) continue

      try {
        const result = handler(event, ctx)
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

  // The dispose function is referenced by both the returned Effect object
  // and the onSourceError callback, so we define it first.
  let disposalPromise: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    if (disposalPromise) return disposalPromise
    disposed = true

    // Abort signal for in-flight handlers
    abortController.abort()

    const attempt = (async () => {
      // Tear down the pipeline (unsubscribe from sources, etc.)
      let cleanupFailure: { error: unknown } | undefined
      try {
        runner.dispose()
      } catch (error) {
        cleanupFailure = { error }
      }

      // Wait for any in-flight async handlers to settle
      if (inFlightHandlers.size > 0) {
        await Promise.allSettled([...inFlightHandlers])
      }

      if (cleanupFailure) throw cleanupFailure.error
    })()
    disposalPromise = attempt
    void attempt.catch(() => {
      if (disposalPromise === attempt) disposalPromise = undefined
    })
    return attempt
  }

  // Create and start the pipeline
  const runner = new EffectPipelineRunner<TRow, TKey>({
    query: config.query,
    skipInitial: config.skipInitial ?? false,
    onBatchProcessed,
    onSourceError: (error: Error) => {
      if (disposed) return

      if (config.onSourceError) {
        try {
          config.onSourceError(error)
        } catch (callbackError) {
          console.error(
            `[Effect '${id}'] onSourceError callback threw:`,
            callbackError,
          )
        }
      } else {
        console.error(`[Effect '${id}'] ${error.message}. Disposing effect.`)
      }

      // Auto-dispose — the effect can no longer function
      void dispose().catch((cleanupError) => {
        console.error(
          `[Effect '${id}'] failed to dispose after a source error:`,
          cleanupError,
        )
      })
    },
  })
  try {
    runner.start()
  } catch (error) {
    try {
      runner.dispose()
    } catch (cleanupError) {
      console.error(
        `[Effect '${id}'] failed to dispose after a startup error:`,
        cleanupError,
      )
    }
    throw error
  }

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
 * Unlike CollectionConfigBuilder, this does not publish results to a
 * Collection.
 */
class EffectPipelineRunner<TRow extends object, TKey extends string | number> {
  private readonly query: QueryIR
  private readonly collections: Record<string, Collection<any, any, any>>
  private readonly collectionSources: ReturnType<
    typeof extractCollectionSources
  >

  private graph: D2 | undefined
  private inputs: Record<string, RootStreamBuilder<unknown>> | undefined
  private pipeline: ResultStream | undefined
  private sourceWhereClauses: Map<string, BasicExpression<boolean>> | undefined

  // Mutable objects passed to compileQuery by reference.
  // The join compiler captures these references and reads them later when
  // the graph runs, so they must be populated before the first graph run.
  private readonly subscriptions: Record<string, CollectionSubscription> = {}
  private readonly lazySourcesCallbacks: Record<
    string,
    LazyCollectionCallbacks
  > = {}
  private readonly lazySources = new Set<string>()
  private readonly demand = new SubsetDemandController()
  // OrderBy optimization info populated by the compiler when limit is present
  private readonly optimizableOrderByCollections: Record<
    string,
    OrderByOptimizationInfo
  > = {}

  // Ordered subscription state for cursor-based loading
  private readonly biggestSentValue = new Map<string, any>()
  private readonly lastLoadRequestKey = new Map<string, string>()
  private pendingOrderedLoadPromise:
    | Promise<AppliedLoadSubsetOutcome>
    | undefined

  // Subscription management
  private readonly unsubscribeCallbacks = new Set<() => void>()
  // Exact D2 contributions per lexical source
  private readonly sentToD2RowsBySource = new Map<
    string,
    Map<string | number, Record<string, unknown>>
  >()

  // Output accumulator
  private pendingChanges: Map<unknown, EffectChanges<TRow>> = new Map()

  // skipInitial state
  private readonly skipInitial: boolean
  private initialLoadComplete = false

  // Scheduler integration
  private subscribedToAllCollections = false
  private readonly builderDependencies = new Set<unknown>()
  private readonly sourceDependencies: Record<string, Array<unknown>> = {}

  // Reentrance guard
  private isGraphRunning = false
  private starting = false
  private disposed = false
  // When dispose() is called mid-graph-run, defer heavy cleanup until the run completes
  private deferredCleanup = false

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
    this.collectionSources = extractCollectionSources(this.query)

    // Compile the pipeline
    this.compilePipeline()
  }

  /** Compile the D2 graph and query pipeline */
  private compilePipeline(): void {
    this.graph = new D2()
    this.inputs = Object.fromEntries(
      this.collectionSources.map((source) => [
        source.sourceId,
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

    // Attach the output operator that accumulates changes
    this.pipeline.pipe(
      output((data) => {
        const messages = data.getInner()
        messages.reduce(accumulateEffectChanges<TRow>, this.pendingChanges)
      }),
    )

    this.graph.finalize()
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  /** Subscribe to source collections and start processing */
  start(): void {
    this.starting = true
    if (this.collectionSources.length === 0) {
      // Nothing to subscribe to
      this.starting = false
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

    for (const source of this.collectionSources) {
      if (this.isDisposed()) {
        this.starting = false
        return
      }

      const { sourceId, alias, collection } = source
      const collectionId = collection.id

      this.sentToD2RowsBySource.set(sourceId, new Map())

      // Discover dependencies: if source collection is itself a live query
      // collection, its builder must run first during transaction flushes.
      const dependencyBuilder = getCollectionBuilder(collection)
      if (dependencyBuilder) {
        this.sourceDependencies[sourceId] = [dependencyBuilder]
        this.builderDependencies.add(dependencyBuilder)
      } else {
        this.sourceDependencies[sourceId] = []
      }

      // Get where clause for this alias (for predicate push-down)
      const whereClause = this.sourceWhereClauses?.get(sourceId)
      const whereExpression = whereClause
        ? normalizeExpressionPaths(whereClause, alias)
        : undefined

      // Initialise buffer for this alias
      const buffer: Array<Array<ChangeMessage<any, string | number>>> = []
      pendingBuffers.set(sourceId, buffer)

      // Lazy aliases (marked by the join compiler) should NOT load initial state
      // eagerly — the join tap operator will load exactly the rows it needs on demand.
      // For on-demand collections, eager loading would trigger a full server fetch
      // for data that should be lazily loaded based on join keys.
      const isLazy = this.lazySources.has(sourceId)

      // Check if this alias has orderBy optimization (cursor-based loading)
      const orderByInfo = this.getOrderByInfoForSource(sourceId)

      // Build the change callback — for ordered aliases, split updates into
      // delete+insert and track the biggest sent value for cursor positioning.
      const changeCallback = orderByInfo
        ? (changes: Array<ChangeMessage<any, string | number>>) => {
            if (pendingBuffers.has(sourceId)) {
              pendingBuffers.get(sourceId)!.push(changes)
            } else {
              this.trackSentValues(sourceId, changes, orderByInfo.comparator)
              if (this.subscriptions[sourceId]?.requiresOrderedPrefixRefresh) {
                this.lastLoadRequestKey.delete(sourceId)
              }
              const split = [...splitUpdates(changes)]
              this.handleSourceChanges(sourceId, split)
            }
          }
        : (changes: Array<ChangeMessage<any, string | number>>) => {
            if (pendingBuffers.has(sourceId)) {
              pendingBuffers.get(sourceId)!.push(changes)
            } else {
              this.handleSourceChanges(sourceId, changes)
            }
          }

      // Subscribe to source changes
      const subscription = collection.subscribeChanges(changeCallback, {
        ...this.buildSubscriptionOptions(
          alias,
          isLazy,
          orderByInfo,
          whereExpression,
        ),
        onLoadSubsetError: ({ error }) => {
          this.onSourceError(normaliseError(error))
        },
      })

      // Store subscription immediately so the join compiler can find it
      this.subscriptions[sourceId] = subscription

      const unsubscribe = () => {
        subscription.unsubscribe()
        delete this.subscriptions[sourceId]
      }

      // subscribeChanges can synchronously report a source error and dispose
      // the runner before returning the subscription.
      if (this.isDisposed()) {
        unsubscribe()
        this.starting = false
        return
      }

      // Own the subscription before any ordered snapshot or lazy demand can
      // throw. A partially started effect has no handle for its caller to
      // dispose, so start() must be able to release every acquired source.
      this.unsubscribeCallbacks.add(unsubscribe)

      const lazyCallbacks = this.lazySourcesCallbacks[sourceId]
      if (lazyCallbacks) {
        lazyCallbacks.setDemand = (plan: LazyDemandPlan, keys: Set<unknown>) =>
          this.setDemand(subscription, plan, keys)
        for (const plan of lazyCallbacks.plans ?? []) {
          if (plan.initialKeys.size > 0) {
            lazyCallbacks.setDemand(plan, plan.initialKeys)
          }
        }
      }

      // For ordered aliases with an index, trigger the initial limited snapshot.
      // This loads only the top N rows rather than the entire collection.
      if (orderByInfo) {
        this.requestInitialOrderedSnapshot(alias, orderByInfo, subscription)
      }

      if (orderByInfo) {
        const truncateUnsubscribe = collection.on(`truncate`, () => {
          this.lastLoadRequestKey.delete(sourceId)
          this.biggestSentValue.delete(sourceId)
          this.pendingOrderedLoadPromise = undefined
        })
        this.unsubscribeCallbacks.add(truncateUnsubscribe)
      }

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
    //
    // We remove each alias from pendingBuffers *before* draining, which
    // switches that alias to direct-processing mode. Any new callbacks that
    // fire during the drain (e.g. from requestLimitedSnapshot) will go
    // through handleSourceChanges directly instead of being lost.
    for (const [sourceId] of pendingBuffers) {
      const buffer = pendingBuffers.get(sourceId)!
      pendingBuffers.delete(sourceId)
      const orderByInfo = this.getOrderByInfoForSource(sourceId)

      // Drain all buffered batches. Since we deleted the alias from
      // pendingBuffers above, any new changes arriving during drain go
      // through handleSourceChanges directly (not back into this buffer).
      for (const changes of buffer) {
        if (orderByInfo) {
          this.trackSentValues(sourceId, changes, orderByInfo.comparator)
          if (this.subscriptions[sourceId]?.requiresOrderedPrefixRefresh) {
            this.lastLoadRequestKey.delete(sourceId)
          }
          const split = [...splitUpdates(changes)]
          this.sendChangesToD2(sourceId, split)
        } else {
          this.sendChangesToD2(sourceId, changes)
        }
      }
    }

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
    this.starting = false
  }

  /** Handle incoming changes from a source collection */
  private handleSourceChanges(
    sourceId: string,
    changes: Array<ChangeMessage<any, string | number>>,
  ): void {
    this.sendChangesToD2(sourceId, changes)
    this.scheduleGraphRun(sourceId)
  }

  private setDemand(
    subscription: CollectionSubscription,
    plan: LazyDemandPlan,
    keys: Set<unknown>,
  ): void {
    const errorVersion = subscription.lastErrorVersion
    let update
    try {
      update = this.demand.setDemand(subscription, plan, keys)
    } catch (error) {
      // The subscription error event already reports adapter failures and
      // disposes this effect. Do not let that query-local failure escape the
      // source commit, but keep unrelated graph errors visible.
      if (
        subscription.lastErrorVersion === errorVersion ||
        !Object.is(subscription.lastError, error)
      ) {
        throw error
      }
      if (this.starting) throw error
      return
    }
    if (update.releaseFailure) {
      this.onSourceError(normaliseError(update.releaseFailure.error))
      return
    }
    if (update.ready instanceof Promise) {
      // Each segment reports its own failure through the subscription. Consume
      // the aggregate rejection so Promise.all does not create a second,
      // detached error channel.
      void update.ready.then(undefined, () => {})
    }
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
  private scheduleGraphRun(sourceId?: string): void {
    const contextId =
      getActiveTransaction()?.id ?? getActivePublicationContext()

    // Collect dependencies for this schedule call
    const deps = new Set(this.builderDependencies)
    if (sourceId) {
      const sourceDeps = this.sourceDependencies[sourceId]
      if (sourceDeps) {
        for (const dep of sourceDeps) {
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
   * Send changes to the D2 input for the given lexical source.
   * Returns the number of multiset entries sent.
   */
  private sendChangesToD2(
    sourceId: string,
    changes: Array<ChangeMessage<any, string | number>>,
  ): number {
    if (this.disposed || !this.inputs || !this.graph) return 0

    const input = this.inputs[sourceId]
    if (!input) return 0

    const sentRows = this.sentToD2RowsBySource.get(sourceId)!
    const reconciled = reconcileChangesForD2(changes, sentRows)

    return sendChangesToInput(input, reconciled)
  }

  /**
   * Run the D2 graph until quiescence, then emit accumulated events once.
   *
   * All output across the entire while-loop is accumulated into a single
   * batch so that users see one `onBatchProcessed` invocation per scheduler
   * run, even when ordered loading causes multiple graph steps.
   */
  private runGraph(): void {
    if (this.isGraphRunning || this.disposed || !this.graph) return

    this.isGraphRunning = true
    try {
      while (this.graph.pendingWork()) {
        this.graph.run()
        // A handler (via onBatchProcessed) or source error callback may have
        // called dispose() during graph.run(). Stop early to avoid operating
        // on stale state. TS narrows disposed to false from the guard above
        // but it can change during graph.run() via callbacks.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.disposed) break
        // After each step, check if ordered queries need more data.
        // loadMoreIfNeeded may send data to D2 inputs (via requestLimitedSnapshot),
        // causing pendingWork() to return true for the next iteration.
        this.loadMoreIfNeeded()
      }
      // Emit all accumulated events once the graph reaches quiescence
      this.flushPendingChanges()
    } finally {
      this.isGraphRunning = false
      // If dispose() was called during this graph run, it deferred the heavy
      // cleanup (clearing graph/inputs/pipeline) to avoid nulling references
      // mid-loop. Complete that cleanup now.
      if (this.deferredCleanup) {
        this.deferredCleanup = false
        this.finalCleanup()
      }
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
    // Ordered aliases explicitly disable initial state — data is loaded
    // via requestLimitedSnapshot/requestSnapshot after subscription setup.
    if (orderByInfo) {
      return { includeInitialState: false, whereExpression }
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
   * Uses requestLimitedSnapshot (index-based cursor) or an unbounded
   * requestSnapshot depending on whether an index is available.
   */
  private requestInitialOrderedSnapshot(
    alias: string,
    orderByInfo: OrderByOptimizationInfo,
    subscription: CollectionSubscription,
  ): void {
    const { orderBy, offset, limit, index } = orderByInfo
    const normalizedOrderBy = normalizeOrderByPaths(orderBy, alias)

    if (limit === 0) return

    if (index) {
      subscription.setOrderByIndex(index, orderByInfo.expandSourceOrderTies)
      subscription.requestLimitedSnapshot({
        limit: offset + limit,
        orderBy: normalizedOrderBy,
        trackLoadSubsetPromise: false,
        onLoadSubsetResult: (result) =>
          this.trackOrderedLoad(result, orderByInfo.sourceId),
      })
    } else {
      // Without an index there is no sound cursor continuation. Load the full
      // ordered source so later relational operators cannot underfill top-K.
      subscription.requestSnapshot({
        orderBy: normalizedOrderBy,
        trackLoadSubsetPromise: false,
      })
    }
  }

  /** Get orderBy optimization info for one lexical source. */
  private getOrderByInfoForSource(
    sourceId: string,
  ): OrderByOptimizationInfo | undefined {
    const info = this.optimizableOrderByCollections[sourceId]
    if (info?.sourceId === sourceId) {
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
      if (!orderByInfo.dataNeeded || !orderByInfo.index) continue
      if (orderByInfo.limit === 0) continue
      const subscription = this.subscriptions[orderByInfo.sourceId]
      if (!subscription) continue
      subscription.ensureOrderedWindowSize(
        orderByInfo.offset + orderByInfo.limit,
      )
      const missingResultRows = orderByInfo.dataNeeded()
      if (
        (!orderByInfo.refillFromResultDeficit || missingResultRows === 0) &&
        subscription.hasOrderedCoverageForActiveWindow
      ) {
        continue
      }

      if (this.pendingOrderedLoadPromise) {
        // Wait for in-flight loads to complete before requesting more
        continue
      }

      if (orderByInfo.refillFromResultDeficit && missingResultRows > 0) {
        subscription.ensureOrderedWindowSize(
          subscription.orderedRetainedWindowSize + missingResultRows,
        )
      }
      if (subscription.hasOrderedCoverageForActiveWindow) {
        continue
      }

      const n = Math.max(missingResultRows, subscription.orderedRowsNeeded)
      this.loadNextItems(orderByInfo, Math.max(1, n))
    }
  }

  private trackOrderedLoad(
    result: LoadSubsetRequestResult,
    sourceId: string,
  ): void {
    const continueAfterFulfillment = () => {
      if (this.disposed) return
      if (this.subscriptions[sourceId]?.requiresOrderedPrefixRefresh) {
        this.lastLoadRequestKey.delete(sourceId)
      }
      this.loadMoreIfNeeded()
    }
    if (!(result instanceof Promise)) {
      // A synchronous truncate replay notifies this observer before replay
      // setup completes. Continue on the next microtask so every replacement
      // demand is registered before the consumer asks for another page.
      queueMicrotask(continueAfterFulfillment)
      return
    }
    this.pendingOrderedLoadPromise = result
    const finish = () => {
      if (this.pendingOrderedLoadPromise === result) {
        this.pendingOrderedLoadPromise = undefined
      }
    }
    void result.then(() => {
      finish()
      continueAfterFulfillment()
    }, finish)
  }

  /**
   * Load n more items from the source collection, starting from the cursor
   * position (the biggest value sent so far).
   */
  private loadNextItems(orderByInfo: OrderByOptimizationInfo, n: number): void {
    const { alias, sourceId } = orderByInfo
    const source = this.collectionSources.find(
      (candidate) => candidate.sourceId === sourceId,
    )
    if (!source) return
    const subscription = this.subscriptions[sourceId]
    if (!subscription) return

    const cursor = computeOrderedLoadCursor(
      orderByInfo,
      subscription.orderedBoundaryRow,
      this.lastLoadRequestKey.get(sourceId),
      alias,
      n,
      subscription.orderedRetainedWindowSize,
      subscription.orderedBoundaryKey,
    )
    if (!cursor) return // Duplicate request — skip

    this.lastLoadRequestKey.set(sourceId, cursor.loadRequestKey)

    const errorVersion = subscription.lastErrorVersion
    try {
      subscription.requestLimitedSnapshot({
        orderBy: cursor.normalizedOrderBy,
        limit: n,
        minValues: cursor.minValues,
        trackLoadSubsetPromise: false,
        onLoadSubsetResult: (loadResult: LoadSubsetRequestResult) =>
          this.trackOrderedLoad(loadResult, sourceId),
      })
    } catch (error) {
      if (
        subscription.lastErrorVersion === errorVersion ||
        !Object.is(subscription.lastError, error)
      ) {
        throw error
      }
      // subscribeChanges already routed the error through onSourceError. Do
      // not let an automatic refill fail the source transaction that exposed
      // the missing row.
      if (this.lastLoadRequestKey.get(sourceId) === cursor.loadRequestKey) {
        this.lastLoadRequestKey.delete(sourceId)
      }
    }
  }

  /**
   * Track the biggest value sent for a given ordered alias.
   * Used for cursor-based pagination in loadNextItems.
   */
  private trackSentValues(
    sourceId: string,
    changes: Array<ChangeMessage<any, string | number>>,
    comparator: (a: any, b: any) => number,
  ): void {
    const sentRows = this.sentToD2RowsBySource.get(sourceId) ?? new Map()
    const result = trackBiggestSentValue(
      changes,
      this.biggestSentValue.get(sourceId),
      sentRows,
      comparator,
    )
    this.biggestSentValue.set(sourceId, result.biggest)
    if (result.shouldResetLoadKey) {
      this.lastLoadRequestKey.delete(sourceId)
    }
  }

  /** Tear down subscriptions and clear state */
  dispose(): void {
    if (this.disposed && this.unsubscribeCallbacks.size === 0) return
    this.disposed = true
    this.subscribedToAllCollections = false

    // Immediately unsubscribe from every source, even if one release fails.
    let firstCleanupFailure: { error: unknown } | undefined
    for (const unsubscribe of this.unsubscribeCallbacks) {
      try {
        unsubscribe()
        this.unsubscribeCallbacks.delete(unsubscribe)
      } catch (error) {
        firstCleanupFailure ??= { error }
      }
    }
    this.sentToD2RowsBySource.clear()
    this.pendingChanges.clear()
    this.lazySources.clear()
    this.demand.clear()
    this.builderDependencies.clear()
    this.biggestSentValue.clear()
    this.lastLoadRequestKey.clear()
    this.pendingOrderedLoadPromise = undefined

    // Clear mutable objects
    for (const key of Object.keys(this.lazySourcesCallbacks)) {
      delete this.lazySourcesCallbacks[key]
    }
    for (const key of Object.keys(this.sourceDependencies)) {
      delete this.sourceDependencies[key]
    }
    for (const key of Object.keys(this.optimizableOrderByCollections)) {
      delete this.optimizableOrderByCollections[key]
    }

    // If the graph is currently running, defer clearing graph/inputs/pipeline
    // until runGraph() completes — otherwise we'd null references mid-loop.
    if (this.isGraphRunning) {
      this.deferredCleanup = true
    } else {
      this.finalCleanup()
    }

    if (firstCleanupFailure) throw firstCleanupFailure.error
  }

  /** Clear graph references — called after graph run completes or immediately from dispose */
  private finalCleanup(): void {
    this.graph = undefined
    this.inputs = undefined
    this.pipeline = undefined
    this.sourceWhereClauses = undefined
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHandlerForEvent<TRow extends object, TKey extends string | number>(
  event: DeltaEvent<TRow, TKey>,
  config: EffectConfig<TRow, TKey>,
): EffectEventHandler<TRow, TKey> | undefined {
  switch (event.type) {
    case `enter`:
      return config.onEnter
    case `exit`:
      return config.onExit
    case `update`:
      return config.onUpdate
  }
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
    // Keep only the first delete value — this is the pre-batch state
    changes.deleteValue ??= value
  } else if (multiplicity > 0) {
    changes.inserts += multiplicity
    // Always overwrite with the latest insert — this is the post-batch state
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
    // Row exited the query result — value is the exiting value,
    // previousValue is omitted (it would be identical to value)
    return { type: `exit`, key, value: deleteValue! }
  }

  if (inserts > 0 && deletes > 0) {
    // Row updated within the query result
    return {
      type: `update`,
      key,
      value: insertValue!,
      previousValue: deleteValue!,
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
  const finish = () => {
    inFlightHandlers.delete(promise)
  }
  void promise.then(finish, finish)
}

/** Report an error to the onError callback or console */
function reportError<TRow extends object, TKey extends string | number>(
  error: unknown,
  event: DeltaEvent<TRow, TKey>,
  onError?: (error: Error, event: DeltaEvent<TRow, TKey>) => void,
): void {
  const normalised = normaliseError(error)
  if (onError) {
    try {
      onError(normalised, event)
    } catch (onErrorError) {
      // Don't let onError errors propagate
      console.error(`[Effect] Error in onError handler:`, onErrorError)
      console.error(`[Effect] Original error:`, normalised)
    }
  } else {
    console.error(`[Effect] Unhandled error in handler:`, normalised)
  }
}

function normaliseError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
