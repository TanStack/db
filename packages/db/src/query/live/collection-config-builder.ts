import { D2, output } from "@tanstack/db-ivm"
import { compileQuery } from "../compiler/index.js"
import { buildQuery, getQueryIR } from "../builder/index.js"
import { CollectionSubscriber } from "./collection-subscriber.js"
import type { RootStreamBuilder } from "@tanstack/db-ivm"
import type { OrderByOptimizationInfo } from "../compiler/order-by.js"
import type { Collection } from "../../collection.js"
import type {
  CollectionConfig,
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

// Global counter for auto-generated collection IDs
let liveQueryCollectionCounter = 0

export class CollectionConfigBuilder<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
> {
  private readonly id: string
  readonly query: QueryIR
  private readonly collections: Record<string, Collection<any, any, any>>

  // WeakMap to store the keys of the results
  // so that we can retrieve them in the getKey function
  private readonly resultKeys = new WeakMap<object, unknown>()

  // WeakMap to store the orderBy index for each result
  private readonly orderByIndices = new WeakMap<object, string>()

  private readonly compare?: (val1: TResult, val2: TResult) => number

  private graphCache: D2 | undefined
  private inputsCache: Record<string, RootStreamBuilder<unknown>> | undefined
  private pipelineCache: ResultStream | undefined
  public collectionWhereClausesCache:
    | Map<string, BasicExpression<boolean>>
    | undefined

  // Map of collection IDs to functions that load keys for that lazy collection
  lazyCollectionsCallbacks: Record<string, LazyCollectionCallbacks> = {}
  // Set of collection IDs that are lazy collections
  readonly lazyCollections = new Set<string>()
  // Set of collection IDs that include an optimizable ORDER BY clause
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo> = {}

  constructor(
    private readonly config: LiveQueryCollectionConfig<TContext, TResult>
  ) {
    // Generate a unique ID if not provided
    this.id = config.id || `live-query-${++liveQueryCollectionCounter}`

    this.query = buildQueryFromConfig(config)
    this.collections = extractCollectionsFromQuery(this.query)

    // Create compare function for ordering if the query has orderBy
    if (this.query.orderBy && this.query.orderBy.length > 0) {
      this.compare = createOrderByComparator<TResult>(this.orderByIndices)
    }

    // Compile the base pipeline once initially
    // This is done to ensure that any errors are thrown immediately and synchronously
    this.compileBasePipeline()
  }

  getConfig(): CollectionConfig<
    TResult,
    string | number,
    never,
    TResult,
    TResult
  > {
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
    }
  }

  // The callback function is called after the graph has run.
  // This gives the callback a chance to load more data if needed,
  // that's used to optimize orderBy operators that set a limit,
  // in order to load some more data if we still don't have enough rows after the pipeline has run.
  // That can happend because even though we load N rows, the pipeline might filter some of these rows out
  // causing the orderBy operator to receive less than N rows or even no rows at all.
  // So this callback would notice that it doesn't have enough rows and load some more.
  // The callback returns a boolean, when it's true it's done loading data and we can mark the collection as ready.
  maybeRunGraph(
    config: Parameters<SyncConfig<TResult, string | number>[`sync`]>[0],
    syncState: FullSyncState,
    callback?: () => boolean
  ) {
    const { begin, commit, markReady } = config

    // We only run the graph if all the collections are ready
    if (
      this.allCollectionsReadyOrInitialCommit() &&
      syncState.subscribedToAllCollections
    ) {
      syncState.graph.run()
      const ready = callback?.() ?? true
      // On the initial run, we may need to do an empty commit to ensure that
      // the collection is initialized
      if (syncState.messagesCount === 0) {
        begin()
        commit()
      }
      // Mark the collection as ready after the first successful run
      if (ready && this.allCollectionsReady()) {
        markReady()
      }
    }
  }

  private getSyncConfig(): SyncConfig<TResult, string | number> {
    return {
      rowUpdateMode: `full`,
      sync: this.syncFn.bind(this),
    }
  }

  private syncFn(
    config: Parameters<SyncConfig<TResult, string | number>[`sync`]>[0]
  ) {
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
      this.collectionWhereClausesCache = undefined

      // Reset lazy collection state
      this.lazyCollections.clear()
      this.optimizableOrderByCollections = {}
      this.lazyCollectionsCallbacks = {}
    }
  }

  private compileBasePipeline() {
    this.graphCache = new D2()
    this.inputsCache = Object.fromEntries(
      Object.entries(this.collections).map(([key]) => [
        key,
        this.graphCache!.newInput<any>(),
      ])
    )

    // Compile the query and get both pipeline and collection WHERE clauses
    const {
      pipeline: pipelineCache,
      collectionWhereClauses: collectionWhereClausesCache,
    } = compileQuery(
      this.query,
      this.inputsCache as Record<string, KeyedStream>,
      this.collections,
      this.lazyCollectionsCallbacks,
      this.lazyCollections,
      this.optimizableOrderByCollections
    )

    this.pipelineCache = pipelineCache
    this.collectionWhereClausesCache = collectionWhereClausesCache
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
    config: Parameters<SyncConfig<TResult, string | number>[`sync`]>[0],
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
    config: Parameters<SyncConfig<TResult, string | number>[`sync`]>[0],
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
      (inserts === deletes && collection.has(key as string | number))
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

  private allCollectionsReady() {
    return Object.values(this.collections).every((collection) =>
      collection.isReady()
    )
  }

  private allCollectionsReadyOrInitialCommit() {
    return Object.values(this.collections).every(
      (collection) =>
        collection.status === `ready` || collection.status === `initialCommit`
    )
  }

  private subscribeToAllCollections(
    config: Parameters<SyncConfig<TResult, string | number>[`sync`]>[0],
    syncState: FullSyncState
  ) {
    const loaders = Object.entries(this.collections).map(
      ([collectionId, collection]) => {
        const collectionSubscriber = new CollectionSubscriber(
          collectionId,
          collection,
          config,
          syncState,
          this
        )
        collectionSubscriber.subscribe()

        const loadMore =
          collectionSubscriber.loadMoreIfNeeded.bind(collectionSubscriber)

        return loadMore
      }
    )

    const loadMoreDataCallback = () => {
      loaders.map((loader) => loader()) // .every((doneLoading) => doneLoading)
      return true
    }

    // Mark the collections as subscribed in the sync state
    syncState.subscribedToAllCollections = true

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
