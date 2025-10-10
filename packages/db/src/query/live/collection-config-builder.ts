import { D2, output } from "@tanstack/db-ivm"
import { compileQuery } from "../compiler/index.js"
import { buildQuery, getQueryIR } from "../builder/index.js"
import { MissingAliasInputsError } from "../../errors.js"
import { CollectionSubscriber } from "./collection-subscriber.js"
import type { CollectionSubscription } from "../../collection/subscription.js"
import type { RootStreamBuilder } from "@tanstack/db-ivm"
import type { OrderByOptimizationInfo } from "../compiler/order-by.js"
import type { Collection } from "../../collection/index.js"
import type {
  CollectionConfigSingleRowOption,
  KeyedStream,
  ResultStream,
  SyncConfig,
} from "../../types.js"
import type { Context, GetResult } from "../builder/types.js"
import type { BasicExpression, QueryIR } from "../ir.js"
import type { LazyCollectionCallbacks } from "../compiler/joins.js"
import type {
  Changes,
  FullSyncState,
  LiveQueryCollectionConfig,
  SyncState,
} from "./types.js"
import type { AllCollectionEvents } from "../../collection/events.js"

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

  private isGraphRunning = false

  // Error state tracking
  private isInErrorState = false

  // Reference to the live query collection for error state transitions
  private liveQueryCollection?: Collection<TResult, any, any>

  private graphCache: D2 | undefined
  private inputsCache: Record<string, RootStreamBuilder<unknown>> | undefined
  private pipelineCache: ResultStream | undefined
  public sourceWhereClausesCache:
    | Map<string, BasicExpression<boolean>>
    | undefined

  // Map of source alias to subscription
  readonly subscriptions: Record<string, CollectionSubscription> = {}
  // Map of source aliases to functions that load keys for that lazy source
  lazySourcesCallbacks: Record<string, LazyCollectionCallbacks> = {}
  // Set of source aliases that are lazy (don't load initial state)
  readonly lazySources = new Set<string>()
  // Set of collection IDs that include an optimizable ORDER BY clause
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo> = {}

  constructor(
    private readonly config: LiveQueryCollectionConfig<TContext, TResult>
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

    // Compile the base pipeline once initially
    // This is done to ensure that any errors are thrown immediately and synchronously
    this.compileBasePipeline()
  }

  getConfig(): CollectionConfigSingleRowOption<TResult> {
    return {
      id: this.id,
      getKey:
        this.config.getKey ||
        ((item) => this.resultKeys.get(item) as string | number),
      sync: this.getSyncConfig(),
      compare: this.compare,
      gcTime: this.config.gcTime || 5000, // 5 seconds by default for live queries
      schema: this.config.schema,
      onInsert: this.config.onInsert,
      onUpdate: this.config.onUpdate,
      onDelete: this.config.onDelete,
      startSync: this.config.startSync,
      singleResult: this.query.singleResult,
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
  // The callback returns a boolean, when it's true it's done loading data.
  maybeRunGraph(
    config: SyncMethods<TResult>,
    syncState: FullSyncState,
    callback?: () => boolean
  ) {
    if (this.isGraphRunning) {
      // no nested runs of the graph
      // which is possible if the `callback`
      // would call `maybeRunGraph` e.g. after it has loaded some more data
      return
    }

    this.isGraphRunning = true

    try {
      const { begin, commit } = config

      // Don't run if the live query is in an error state
      if (this.isInErrorState) {
        return
      }

      // Always run the graph if subscribed (eager execution)
      if (syncState.subscribedToAllCollections) {
        while (syncState.graph.pendingWork()) {
          syncState.graph.run()
          callback?.()
        }

        // On the initial run, we may need to do an empty commit to ensure that
        // the collection is initialized
        if (syncState.messagesCount === 0) {
          begin()
          commit()
          // After initial commit, check if we should mark ready
          // (in case all sources were already ready before we subscribed)
          this.updateLiveQueryStatus(config)
        }
      }
    } finally {
      this.isGraphRunning = false
    }
  }

  private getSyncConfig(): SyncConfig<TResult> {
    return {
      rowUpdateMode: `full`,
      sync: this.syncFn.bind(this),
    }
  }

  private syncFn(config: SyncMethods<TResult>) {
    // Store reference to the live query collection for error state transitions
    this.liveQueryCollection = config.collection

    const syncState: SyncState = {
      messagesCount: 0,
      subscribedToAllCollections: false,
      unsubscribeCallbacks: new Set<() => void>(),
    }

    // Extend the pipeline such that it applies the incoming changes to the collection
    const fullSyncState = this.extendPipelineWithChangeProcessing(
      config,
      syncState
    )

    const loadMoreDataCallbacks = this.subscribeToAllCollections(
      config,
      fullSyncState
    )

    // Initial run with callback to load more data if needed
    this.maybeRunGraph(config, fullSyncState, loadMoreDataCallbacks)

    // Return the unsubscribe function
    return () => {
      syncState.unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe())

      // Reset caches so a fresh graph/pipeline is compiled on next start
      // This avoids reusing a finalized D2 graph across GC restarts
      this.graphCache = undefined
      this.inputsCache = undefined
      this.pipelineCache = undefined
      this.sourceWhereClausesCache = undefined

      // Reset lazy source alias state
      this.lazySources.clear()
      this.optimizableOrderByCollections = {}
      this.lazySourcesCallbacks = {}

      // Clear subscription references to prevent memory leaks
      // Note: Individual subscriptions are already unsubscribed via unsubscribeCallbacks
      Object.keys(this.subscriptions).forEach(
        (key) => delete this.subscriptions[key]
      )
      this.compiledAliasToCollectionId = {}
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
      ])
    )

    const compilation = compileQuery(
      this.query,
      this.inputsCache as Record<string, KeyedStream>,
      this.collections,
      this.subscriptions,
      this.lazySourcesCallbacks,
      this.lazySources,
      this.optimizableOrderByCollections
    )

    this.pipelineCache = compilation.pipeline
    this.sourceWhereClausesCache = compilation.sourceWhereClauses
    this.compiledAliasToCollectionId = compilation.aliasToCollectionId

    // Defensive check: verify all compiled aliases have corresponding inputs
    // This should never happen since all aliases come from user declarations,
    // but catch it early if the assumption is violated in the future.
    const missingAliases = Object.keys(this.compiledAliasToCollectionId).filter(
      (alias) => !Object.hasOwn(this.inputsCache!, alias)
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
    syncState: SyncState
  ): FullSyncState {
    const { begin, commit } = config
    const { graph, inputs, pipeline } = this.maybeCompileBasePipeline()

    pipeline.pipe(
      output((data) => {
        const messages = data.getInner()
        syncState.messagesCount += messages.length

        begin()
        messages
          .reduce(
            accumulateChanges<TResult>,
            new Map<unknown, Changes<TResult>>()
          )
          .forEach(this.applyChanges.bind(this, config))
        commit()
      })
    )

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
    key: unknown
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
        `Could not apply changes: ${JSON.stringify(changes)}. This should never happen.`
      )
    }
  }

  /**
   * Handle status changes from source collections
   */
  private handleSourceStatusChange(
    config: SyncMethods<TResult>,
    collectionId: string,
    event: AllCollectionEvents[`status:change`]
  ) {
    const { status } = event

    // Handle error state - any source collection in error puts live query in error
    if (status === `error`) {
      this.transitionToError(
        `Source collection '${collectionId}' entered error state`
      )
      return
    }

    // Handle manual cleanup - this should not happen due to GC prevention,
    // but could happen if user manually calls cleanup()
    if (status === `cleaned-up`) {
      this.transitionToError(
        `Source collection '${collectionId}' was manually cleaned up while live query '${this.id}' depends on it. ` +
          `Live queries prevent automatic GC, so this was likely a manual cleanup() call.`
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

    // Mark ready when all source collections are ready
    if (this.allCollectionsReady()) {
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
      collection.isReady()
    )
  }

  /**
   * Creates per-alias subscriptions enabling self-join support.
   * Each alias gets its own subscription with independent filters, even for the same collection.
   * Example: `{ employee: col, manager: col }` creates two separate subscriptions.
   */
  private subscribeToAllCollections(
    config: SyncMethods<TResult>,
    syncState: FullSyncState
  ) {
    // Use compiled aliases as the source of truth - these include all aliases from the query
    // including those from subqueries, which may not be in collectionByAlias
    const compiledAliases = Object.entries(this.compiledAliasToCollectionId)
    if (compiledAliases.length === 0) {
      throw new Error(
        `Compiler returned no alias metadata for query '${this.id}'. This should not happen; please report.`
      )
    }

    // Create a separate subscription for each alias, enabling self-joins where the same
    // collection can be used multiple times with different filters and subscriptions
    const loaders = compiledAliases.map(([alias, collectionId]) => {
      // Try collectionByAlias first (for declared aliases), fall back to collections (for subquery aliases)
      const collection =
        this.collectionByAlias[alias] ?? this.collections[collectionId]!

      // CollectionSubscriber handles the actual subscription to the source collection
      // and feeds data into the D2 graph inputs for this specific alias
      const collectionSubscriber = new CollectionSubscriber(
        alias,
        collectionId,
        collection,
        config,
        syncState,
        this
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
        subscription
      )

      return loadMore
    })

    // Combine all loaders into a single callback that attempts to load more data
    // from any source that needs it (returns true when done loading)
    const loadMoreDataCallback = () => {
      loaders.map((loader) => loader())
      return true
    }

    // Mark as subscribed so the graph can start running
    // (graph only runs when all collections are subscribed)
    syncState.subscribedToAllCollections = true

    // Initial status check after all subscriptions are set up
    this.updateLiveQueryStatus(config)

    return loadMoreDataCallback
  }
}

function buildQueryFromConfig<TContext extends Context>(
  config: LiveQueryCollectionConfig<any, any>
) {
  // Build the query using the provided query builder function or instance
  if (typeof config.query === `function`) {
    return buildQuery<TContext>(config.query)
  }
  return getQueryIR(config.query)
}

function createOrderByComparator<T extends object>(
  orderByIndices: WeakMap<object, string>
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
  query: any
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
  }

  // Start extraction from the root query
  extractFromQuery(query)

  return collections
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

  function traverse(q?: QueryIR) {
    if (!q) return

    recordAlias(q.from)

    if (q.join) {
      for (const joinClause of q.join) {
        recordAlias(joinClause.from)
      }
    }
  }

  traverse(query)

  return aliasesById
}

function accumulateChanges<T>(
  acc: Map<unknown, Changes<T>>,
  [[key, tupleData], multiplicity]: [
    [unknown, [any, string | undefined]],
    number,
  ]
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
    changes.value = value
    changes.orderByIndex = orderByIndex
  }
  acc.set(key, changes)
  return acc
}
