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
import type {
  ChangeMessage,
  CollectionCursor,
  KeyedStream,
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
      /** Batch-level high-water cursor — the maximum cursor observed across all source changes in this batch. Use for checkpointing via startAfter. */
      cursor?: CollectionCursor
      /** Per-source cursor map. Present when cursor gating (startAfter) is active. */
      cursors?: Record<string, CollectionCursor>
      /** Source alias whose changes triggered this batch. Present when cursor gating is active. */
      triggeringSource?: string
      metadata?: Record<string, unknown>
    }
  | {
      type: 'exit'
      key: TKey
      /** Current value for the exiting row */
      value: TRow
      /** Batch-level high-water cursor — the maximum cursor observed across all source changes in this batch. Use for checkpointing via startAfter. */
      cursor?: CollectionCursor
      /** Per-source cursor map. Present when cursor gating (startAfter) is active. */
      cursors?: Record<string, CollectionCursor>
      /** Source alias whose changes triggered this batch. Present when cursor gating is active. */
      triggeringSource?: string
      metadata?: Record<string, unknown>
    }
  | {
      type: 'update'
      key: TKey
      /** Current value after the update */
      value: TRow
      /** Previous value before the batch */
      previousValue: TRow
      /** Batch-level high-water cursor — the maximum cursor observed across all source changes in this batch. Use for checkpointing via startAfter. */
      cursor?: CollectionCursor
      /** Per-source cursor map. Present when cursor gating (startAfter) is active. */
      cursors?: Record<string, CollectionCursor>
      /** Source alias whose changes triggered this batch. Present when cursor gating is active. */
      triggeringSource?: string
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

  /**
   * Suppress callbacks until the source replay advances past this cursor.
   * Historical changes at or before the cursor still update internal query state.
   *
   * Requires the sync source to provide a monotonic cursor on every
   * `sync.write()` call.
   *
   * - **Scalar value**: applies to the single source alias. Throws for
   *   multi-source (join) effects.
   * - **Record**: maps source aliases to their respective cursors, enabling
   *   independent per-source gating for join queries.
   */
  startAfter?: CollectionCursor | Record<string, CollectionCursor>
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
    startAfter: config.startAfter,
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
  startAfter?: CollectionCursor | Record<string, CollectionCursor>
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

  // Per-alias cursor gating
  private readonly startAfterByAlias: Map<string, CollectionCursor> = new Map()
  private readonly cursorGateOpenByAlias: Map<string, boolean> = new Map()
  private readonly pendingBatchCursorByAlias: Map<string, CollectionCursor> =
    new Map()
  private readonly liveAliasesInBatch: Set<string> = new Set()

  // Scheduler integration
  private subscribedToAllCollections = false
  private readonly builderDependencies = new Set<unknown>()
  private readonly aliasDependencies: Record<string, Array<unknown>> = {}

  // Reentrance guard
  private isGraphRunning = false
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

    // Normalize startAfter into per-alias map
    if (config.startAfter !== undefined) {
      if (typeof config.startAfter === `object`) {
        // Record<string, CollectionCursor> — per-alias cursors
        for (const [alias, cursor] of Object.entries(config.startAfter)) {
          this.startAfterByAlias.set(alias, cursor)
          this.cursorGateOpenByAlias.set(alias, false)
        }
      } else {
        // Scalar — single-source shorthand
        const aliases = Object.keys(this.collectionByAlias)
        if (aliases.length !== 1) {
          throw new Error(
            `A scalar startAfter value is only supported for single-source effects. ` +
              `Use a Record<string, CollectionCursor> to map cursors to source aliases. ` +
              `This effect queries ${aliases.length} collections.`,
          )
        }
        this.startAfterByAlias.set(aliases[0]!, config.startAfter)
        this.cursorGateOpenByAlias.set(aliases[0]!, false)
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
    //
    // We remove each alias from pendingBuffers *before* draining, which
    // switches that alias to direct-processing mode. Any new callbacks that
    // fire during the drain (e.g. from requestLimitedSnapshot) will go
    // through handleSourceChanges directly instead of being lost.
    for (const [alias] of pendingBuffers) {
      const buffer = pendingBuffers.get(alias)!
      pendingBuffers.delete(alias)

      const orderByInfo = this.getOrderByInfoForAlias(alias)

      // Drain all buffered batches. Since we deleted the alias from
      // pendingBuffers above, any new changes arriving during drain go
      // through handleSourceChanges directly (not back into this buffer).
      for (const changes of buffer) {
        if (orderByInfo) {
          this.trackSentValues(alias, changes, orderByInfo.comparator)
          const split = [...splitUpdates(changes)]
          this.recordPendingBatchCursor(alias, split)
          this.sendChangesToD2(alias, split)
        } else {
          this.recordPendingBatchCursor(alias, changes)
          this.sendChangesToD2(alias, changes)
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
  }

  /** Handle incoming changes from a source collection */
  private handleSourceChanges(
    alias: string,
    changes: Array<ChangeMessage<any, string | number>>,
  ): void {
    if (changes.length === 0) {
      return
    }

    // During a graph run, changes arrive from join tap operators (lazy source
    // loads via requestSnapshot). These inherit the root batch's live status
    // and must not affect cursor gates or live-source tracking.
    if (this.isGraphRunning) {
      this.sendChangesToD2(alias, changes)
      return
    }

    // Check per-alias cursor gate
    if (
      this.startAfterByAlias.has(alias) &&
      this.cursorGateOpenByAlias.get(alias) === false
    ) {
      this.handleSourceChangesBeforeCursorGate(alias, changes)
      return
    }

    // Gate is open or alias has no gate — mark as live
    if (this.startAfterByAlias.size > 0) {
      this.liveAliasesInBatch.add(alias)
    }
    this.recordPendingBatchCursor(alias, changes)
    this.sendChangesToD2(alias, changes)
    this.scheduleGraphRun(alias)
  }

  /**
   * Replay before startAfter must still hydrate query state, but callbacks stay
   * muted until we observe a cursor greater than the configured boundary.
   */
  private handleSourceChangesBeforeCursorGate(
    alias: string,
    changes: Array<ChangeMessage<any, string | number>>,
  ): void {
    const startAfter = this.startAfterByAlias.get(alias)!
    let firstLiveIndex: number
    try {
      firstLiveIndex = findFirstChangeAfterCursor(changes, startAfter)
    } catch (error) {
      this.onSourceError(
        error instanceof Error ? error : new Error(String(error)),
      )
      return
    }

    if (firstLiveIndex === -1) {
      this.sendChangesToD2(alias, changes)
      this.scheduleGraphRun(alias)
      return
    }

    if (firstLiveIndex > 0) {
      const replayChanges = changes.slice(0, firstLiveIndex)
      this.sendChangesToD2(alias, replayChanges)
      this.scheduleGraphRun(alias)
    } else if (!getActiveTransaction() && this.graph?.pendingWork()) {
      // Best-effort boundary preservation outside transaction-scoped flushes.
      this.runGraph()
    }

    this.cursorGateOpenByAlias.set(alias, true)
    this.liveAliasesInBatch.add(alias)

    const liveChanges = changes.slice(firstLiveIndex)
    this.recordPendingBatchCursor(alias, liveChanges)
    this.sendChangesToD2(alias, liveChanges)
    this.scheduleGraphRun(alias)
  }

  private recordPendingBatchCursor(
    alias: string,
    changes: Array<ChangeMessage<any, string | number>>,
  ): void {
    for (const change of changes) {
      const { cursor } = change
      if (cursor === undefined) {
        continue
      }
      try {
        const current = this.pendingBatchCursorByAlias.get(alias)
        if (current === undefined) {
          this.pendingBatchCursorByAlias.set(alias, cursor)
        } else {
          const cmp = compareCollectionCursors(cursor, current)
          if (cmp < 0) {
            throw new Error(
              `Cursors within a sync batch must be monotonically ordered. ` +
                `Saw ${String(cursor)} after ${String(current)}.`,
            )
          }
          if (cmp > 0) {
            this.pendingBatchCursorByAlias.set(alias, cursor)
          }
        }
      } catch (error) {
        this.onSourceError(
          error instanceof Error ? error : new Error(String(error)),
        )
        return
      }
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
    if (this.pendingChanges.size === 0) {
      this.pendingBatchCursorByAlias.clear()
      this.liveAliasesInBatch.clear()
      return
    }

    const hasCursorGating = this.startAfterByAlias.size > 0

    // Discard if skipInitial isn't satisfied or no live sources contributed
    if (
      (this.skipInitial && !this.initialLoadComplete) ||
      (hasCursorGating && this.liveAliasesInBatch.size === 0)
    ) {
      this.pendingChanges = new Map()
      this.pendingBatchCursorByAlias.clear()
      this.liveAliasesInBatch.clear()
      return
    }

    // Compute batch-level cursor (max across all per-alias cursors)
    let batchCursor: CollectionCursor | undefined
    for (const cursor of this.pendingBatchCursorByAlias.values()) {
      if (batchCursor === undefined) {
        batchCursor = cursor
      } else {
        try {
          if (compareCollectionCursors(cursor, batchCursor) > 0) {
            batchCursor = cursor
          }
        } catch {
          // Type mismatch across sources — keep the first
          break
        }
      }
    }

    // Build per-source cursor map and triggering source (only for gated effects)
    let cursors: Record<string, CollectionCursor> | undefined
    let triggeringSource: string | undefined
    if (hasCursorGating) {
      if (this.pendingBatchCursorByAlias.size > 0) {
        cursors = Object.fromEntries(this.pendingBatchCursorByAlias)
      }
      if (this.liveAliasesInBatch.size > 0) {
        triggeringSource = this.liveAliasesInBatch.values().next().value
      }
    }

    const events: Array<DeltaEvent<TRow, TKey>> = []

    for (const [key, changes] of this.pendingChanges) {
      const event = classifyDelta<TRow, TKey>(key as TKey, changes)
      if (event) {
        let enriched: DeltaEvent<TRow, TKey> = event
        if (batchCursor !== undefined) {
          enriched = { ...enriched, cursor: batchCursor }
        }
        if (triggeringSource !== undefined) {
          enriched = { ...enriched, triggeringSource }
        }
        if (cursors !== undefined) {
          enriched = { ...enriched, cursors }
        }
        events.push(enriched)
      }
    }

    this.pendingChanges = new Map()
    this.pendingBatchCursorByAlias.clear()
    this.liveAliasesInBatch.clear()

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
      if (!orderByInfo.dataNeeded || !orderByInfo.index) continue

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
    if (this.disposed) return
    this.disposed = true
    this.subscribedToAllCollections = false

    // Immediately unsubscribe from sources and clear cheap state
    this.unsubscribeCallbacks.forEach((fn) => fn())
    this.unsubscribeCallbacks.clear()
    this.sentToD2KeysByAlias.clear()
    this.pendingChanges.clear()
    this.pendingBatchCursorByAlias.clear()
    this.liveAliasesInBatch.clear()
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

    // If the graph is currently running, defer clearing graph/inputs/pipeline
    // until runGraph() completes — otherwise we'd null references mid-loop.
    if (this.isGraphRunning) {
      this.deferredCleanup = true
    } else {
      this.finalCleanup()
    }
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

function findFirstChangeAfterCursor(
  changes: Array<ChangeMessage<any, string | number>>,
  startAfter: CollectionCursor,
): number {
  let anyCursor = false
  let lastCursor: CollectionCursor | undefined
  for (let index = 0; index < changes.length; index++) {
    const cursor = changes[index]!.cursor
    if (cursor === undefined) {
      continue
    }
    if (
      lastCursor !== undefined &&
      compareCollectionCursors(cursor, lastCursor) < 0
    ) {
      throw new Error(
        `Cursors within a sync batch must be monotonically ordered. ` +
          `Saw ${String(cursor)} after ${String(lastCursor)}.`,
      )
    }
    lastCursor = cursor
    anyCursor = true
    if (compareCollectionCursors(cursor, startAfter) > 0) {
      // Walk backwards to include any preceding uncursored changes —
      // they have no position in cursor space and should not be
      // assumed to be replay.
      let liveStart = index
      while (liveStart > 0 && changes[liveStart - 1]!.cursor === undefined) {
        liveStart--
      }
      return liveStart
    }
  }

  // If no change in this batch carries a cursor, treat the entire batch as
  // live — the sync provider has moved past cursor-based replay.
  if (!anyCursor) {
    return 0
  }

  return -1
}

function compareCollectionCursors(
  left: CollectionCursor,
  right: CollectionCursor,
): number {
  if (typeof left !== typeof right) {
    throw new Error(
      `Collection cursors must use a consistent primitive type. Received ${typeof left} and ${typeof right}.`,
    )
  }

  if (left === right) {
    return 0
  }

  return left > right ? 1 : -1
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
    } catch (onErrorError) {
      // Don't let onError errors propagate
      console.error(`[Effect] Error in onError handler:`, onErrorError)
      console.error(`[Effect] Original error:`, normalised)
    }
  } else {
    console.error(`[Effect] Unhandled error in handler:`, normalised)
  }
}
