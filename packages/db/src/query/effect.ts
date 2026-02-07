import { D2, output } from '@tanstack/db-ivm'
import { transactionScopedScheduler } from '../scheduler.js'
import { getActiveTransaction } from '../transactions.js'
import { compileQuery } from './compiler/index.js'
import { normalizeExpressionPaths } from './compiler/expressions.js'
import { getCollectionBuilder } from './live/collection-registry.js'
import {
  buildQueryFromConfig,
  extractCollectionAliases,
  extractCollectionsFromQuery,
  sendChangesToInput,
} from './live/utils.js'
import type { RootStreamBuilder } from '@tanstack/db-ivm'
import type { Collection } from '../collection/index.js'
import type { CollectionSubscription } from '../collection/subscription.js'
import type { InitialQueryBuilder, QueryBuilder } from './builder/index.js'
import type { Context } from './builder/types.js'
import type { BasicExpression, QueryIR } from './ir.js'
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

  // Create and start the pipeline
  const runner = new EffectPipelineRunner<TRow, TKey>({
    query: config.query,
    skipInitial: config.skipInitial ?? false,
    onBatchProcessed,
  })
  runner.start()

  return {
    async dispose() {
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
    },
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
class EffectPipelineRunner<
  TRow extends object,
  TKey extends string | number,
> {
  private readonly query: QueryIR
  private readonly collections: Record<string, Collection<any, any, any>>
  private readonly collectionByAlias: Record<
    string,
    Collection<any, any, any>
  >

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

  // Subscription management
  private readonly unsubscribeCallbacks = new Set<() => void>()
  // Duplicate insert prevention per alias
  private readonly sentToD2KeysByAlias = new Map<
    string,
    Set<string | number>
  >()

  // Output accumulator
  private pendingChanges: Map<unknown, EffectChanges<TRow>> = new Map()

  // skipInitial state
  private readonly skipInitial: boolean
  private initialLoadComplete = false

  // Scheduler integration
  private subscribedToAllCollections = false
  private readonly builderDependencies = new Set<unknown>()
  private readonly aliasDependencies: Record<string, Array<unknown>> = {}
  private unsubscribeFromSchedulerClears?: () => void

  // Reentrance guard
  private isGraphRunning = false
  private disposed = false

  private readonly onBatchProcessed: (
    events: Array<DeltaEvent<TRow, TKey>>,
  ) => void

  constructor(config: EffectPipelineRunnerConfig<TRow, TKey>) {
    this.skipInitial = config.skipInitial
    this.onBatchProcessed = config.onBatchProcessed

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
      {}, // optimizableOrderByCollections (not needed for effects)
      () => {}, // setWindowFn (no-op — effects don't support windowing)
    )

    this.pipeline = compilation.pipeline
    this.sourceWhereClauses = compilation.sourceWhereClauses
    this.compiledAliasToCollectionId = compilation.aliasToCollectionId

    // Attach the output operator that accumulates changes
    this.pipeline.pipe(
      output((data) => {
        const messages = data.getInner()
        messages.reduce(
          accumulateEffectChanges<TRow>,
          this.pendingChanges,
        )
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

    // Listen for scheduler context clears to prevent memory leaks
    // from in-flight transactions that are aborted/rolled back.
    this.unsubscribeFromSchedulerClears = transactionScopedScheduler.onClear(
      () => {
        // No pending state to clear for effects (unlike CollectionConfigBuilder
        // which accumulates load callbacks). The scheduler handles its own cleanup.
      },
    )

    // We need to defer initial data processing until ALL subscriptions are
    // created, because join pipelines look up subscriptions by alias during
    // the graph run. If we run the graph while some aliases are still missing,
    // the join tap operator will throw.
    //
    // Strategy: subscribe to each collection but buffer incoming changes.
    // After all subscriptions are in place, flush the buffers and switch to
    // direct processing mode.

    const pendingBuffers = new Map<string, Array<Array<ChangeMessage<any, string | number>>>>()

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

      // Subscribe to source changes — buffer during setup, process directly after
      const subscription = collection.subscribeChanges(
        (changes: Array<ChangeMessage<any, string | number>>) => {
          if (pendingBuffers.has(alias)) {
            // Still setting up subscriptions — buffer changes
            pendingBuffers.get(alias)!.push(changes)
          } else {
            // All subscriptions ready — process directly
            this.handleSourceChanges(alias, changes)
          }
        },
        {
          includeInitialState: true,
          whereExpression,
        },
      )

      // Store subscription immediately so the join compiler can find it
      this.subscriptions[alias] = subscription

      this.unsubscribeCallbacks.add(() => {
        subscription.unsubscribe()
        delete this.subscriptions[alias]
      })

      // Track source readiness for skipInitial
      if (this.skipInitial) {
        const statusUnsubscribe = collection.on(`status:change`, () => {
          if (!this.initialLoadComplete && this.checkAllCollectionsReady()) {
            this.initialLoadComplete = true
          }
        })
        this.unsubscribeCallbacks.add(statusUnsubscribe)
      }
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

    return sendChangesToInput(
      input,
      filtered,
      collection.config.getKey,
    )
  }

  /** Run the D2 graph and flush accumulated output */
  private runGraph(): void {
    if (this.isGraphRunning || this.disposed || !this.graph) return

    this.isGraphRunning = true
    try {
      while (this.graph.pendingWork()) {
        this.graph.run()
        this.flushPendingChanges()
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

    // Unregister from scheduler's onClear listener to prevent memory leaks
    this.unsubscribeFromSchedulerClears?.()
    this.unsubscribeFromSchedulerClears = undefined

    // Clear mutable objects
    for (const key of Object.keys(this.lazySourcesCallbacks)) {
      delete this.lazySourcesCallbacks[key]
    }
    for (const key of Object.keys(this.aliasDependencies)) {
      delete this.aliasDependencies[key]
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
function classifyDelta<
  TRow extends object,
  TKey extends string | number,
>(
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
    return { type: `exit`, key, value: deleteValue!, previousValue: deleteValue }
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

/**
 * Filter changes to prevent duplicate inserts to the D2 pipeline.
 * Maintains D2 multiplicity at 1 for visible items so that deletes
 * properly reduce multiplicity to 0.
 */
function filterDuplicateInserts(
  changes: Array<ChangeMessage<any, string | number>>,
  sentKeys: Set<string | number>,
): Array<ChangeMessage<any, string | number>> {
  const filtered: Array<ChangeMessage<any, string | number>> = []
  for (const change of changes) {
    if (change.type === `insert`) {
      if (sentKeys.has(change.key)) {
        continue // Skip duplicate
      }
      sentKeys.add(change.key)
    } else if (change.type === `delete`) {
      sentKeys.delete(change.key)
    }
    filtered.push(change)
  }
  return filtered
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
  const normalised =
    error instanceof Error ? error : new Error(String(error))
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
