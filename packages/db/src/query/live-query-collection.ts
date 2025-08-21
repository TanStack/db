import { D2, MultiSet, output } from "@tanstack/db-ivm"
import { createCollection } from "../collection.js"
import { createFilterFunctionFromExpression } from "../change-events.js"
import { compileQuery } from "./compiler/index.js"
import { buildQuery, getQueryIR } from "./builder/index.js"
import { convertToBasicExpression } from "./compiler/expressions.js"
import type { OrderByOptimizationInfo } from "./compiler/order-by.js"
import type { InitialQueryBuilder, QueryBuilder } from "./builder/index.js"
import type { Collection } from "../collection.js"
import type {
  ChangeMessage,
  CollectionConfig,
  KeyedStream,
  ResultStream,
  SyncConfig,
  UtilsRecord,
} from "../types.js"
import type { Context, GetResult } from "./builder/types.js"
import type { MultiSetArray, RootStreamBuilder } from "@tanstack/db-ivm"
import type { BasicExpression, QueryIR } from "./ir.js"
import type { LazyCollectionCallbacks } from "./compiler/joins.js"

// Global counter for auto-generated collection IDs
let liveQueryCollectionCounter = 0

/**
 * Configuration interface for live query collection options
 *
 * @example
 * ```typescript
 * const config: LiveQueryCollectionConfig<any, any> = {
 *   // id is optional - will auto-generate "live-query-1", "live-query-2", etc.
 *   query: (q) => q
 *     .from({ comment: commentsCollection })
 *     .join(
 *       { user: usersCollection },
 *       ({ comment, user }) => eq(comment.user_id, user.id)
 *     )
 *     .where(({ comment }) => eq(comment.active, true))
 *     .select(({ comment, user }) => ({
 *       id: comment.id,
 *       content: comment.content,
 *       authorName: user.name,
 *     })),
 *   // getKey is optional - defaults to using stream key
 *   getKey: (item) => item.id,
 * }
 * ```
 */
export interface LiveQueryCollectionConfig<
  TContext extends Context,
  TResult extends object = GetResult<TContext> & object,
> {
  /**
   * Unique identifier for the collection
   * If not provided, defaults to `live-query-${number}` with auto-incrementing number
   */
  id?: string

  /**
   * Query builder function that defines the live query
   */
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>

  /**
   * Function to extract the key from result items
   * If not provided, defaults to using the key from the D2 stream
   */
  getKey?: (item: TResult) => string | number

  /**
   * Optional schema for validation
   */
  schema?: CollectionConfig<TResult>[`schema`]

  /**
   * Optional mutation handlers
   */
  onInsert?: CollectionConfig<TResult>[`onInsert`]
  onUpdate?: CollectionConfig<TResult>[`onUpdate`]
  onDelete?: CollectionConfig<TResult>[`onDelete`]

  /**
   * Start sync / the query immediately
   */
  startSync?: boolean

  /**
   * GC time for the collection
   */
  gcTime?: number
}

type Changes<T> = {
  deletes: number
  inserts: number
  value: T
  orderByIndex: string | undefined
}

type SyncState = {
  messagesCount: number
  subscribedToAllCollections: boolean
  unsubscribeCallbacks: Set<() => void>

  graph?: D2
  inputs?: Record<string, RootStreamBuilder<unknown>>
  pipeline?: ResultStream
}

type FullSyncState = Required<SyncState>

class CollectionSubscriber<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
> {
  constructor(
    private collectionId: string,
    private collection: Collection,
    private config: Parameters<SyncConfig<TResult>[`sync`]>[0],
    private syncState: FullSyncState,
    private collectionConfigBuilder: CollectionConfigBuilder<TContext, TResult>
  ) {}

  subscribe() {
    const collectionAlias = findCollectionAlias(
      this.collectionId,
      this.collectionConfigBuilder.query
    )
    const whereClause = this.getWhereClauseFromAlias(collectionAlias)

    if (whereClause) {
      // Convert WHERE clause to BasicExpression format for collection subscription
      const whereExpression = convertToBasicExpression(
        whereClause,
        collectionAlias!
      )

      if (whereExpression) {
        // Use index optimization for this collection
        this.subscribeToChanges(whereExpression)
      } else {
        // This should not happen - if we have a whereClause but can't create whereExpression,
        // it indicates a bug in our optimization logic
        throw new Error(
          `Failed to convert WHERE clause to collection filter for collection '${this.collectionId}'. ` +
            `This indicates a bug in the query optimization logic.`
        )
      }
    } else {
      // No WHERE clause for this collection, use regular subscription
      this.subscribeToChanges()
    }
  }

  private subscribeToChanges(whereExpression?: BasicExpression<boolean>) {
    let unsubscribe: () => void
    if (this.collectionConfigBuilder.lazyCollections.has(this.collectionId)) {
      unsubscribe = this.subscribeToMatchingChanges(whereExpression)
    } else if (
      Object.hasOwn(
        this.collectionConfigBuilder.optimizableOrderByCollections,
        this.collectionId
      )
    ) {
      unsubscribe = this.subscribeToOrderedChanges(whereExpression)
    } else {
      unsubscribe = this.subscribeToAllChanges(whereExpression)
    }
    this.syncState.unsubscribeCallbacks.add(unsubscribe)
  }

  private sendChangesToPipeline(
    changes: Iterable<ChangeMessage<any, string | number>>,
    callback?: () => boolean
  ) {
    const input = this.syncState.inputs[this.collectionId]!
    sendChangesToInput(input, changes, this.collection.config.getKey)
    this.collectionConfigBuilder.maybeRunGraph(
      this.config,
      this.syncState,
      callback
    )
  }

  // Wraps the sendChangesToPipeline function
  // in order to turn `update`s into `insert`s
  // for keys that have not been sent to the pipeline yet
  // and filter out deletes for keys that have not been sent
  private sendVisibleChangesToPipeline = (
    changes: Array<ChangeMessage<any, string | number>>,
    loadedInitialState: boolean,
    sentKeys: Set<string | number>
  ) => {
    if (loadedInitialState) {
      // There was no index for the join key
      // so we loaded the initial state
      // so we can safely assume that the pipeline has seen all keys
      return this.sendChangesToPipeline(changes)
    }

    const newChanges = []
    for (const change of changes) {
      let newChange = change
      if (!sentKeys.has(change.key)) {
        if (change.type === `update`) {
          newChange = { ...change, type: `insert` }
        } else if (change.type === `delete`) {
          // filter out deletes for keys that have not been sent
          continue
        }
      }
      newChanges.push(newChange)
    }

    return this.sendChangesToPipeline(newChanges)
  }

  private loadKeys(
    keys: Iterable<string | number>,
    sentKeys: Set<string | number>,
    filterFn: (item: object) => boolean
  ) {
    for (const key of keys) {
      // Only load the key once
      if (sentKeys.has(key)) continue

      const value = this.collection.get(key)
      if (value !== undefined && filterFn(value)) {
        sentKeys.add(key)
        this.sendChangesToPipeline([{ type: `insert`, key, value }])
      }
    }
  }

  private subscribeToAllChanges(
    whereExpression: BasicExpression<boolean> | undefined
  ) {
    const sendChangesToPipeline = this.sendChangesToPipeline.bind(this)
    const unsubscribe = this.collection.subscribeChanges(
      sendChangesToPipeline,
      {
        includeInitialState: true,
        ...(whereExpression ? { whereExpression } : undefined),
      }
    )
    return unsubscribe
  }

  private subscribeToMatchingChanges(
    whereExpression: BasicExpression<boolean> | undefined
  ) {
    let loadedInitialState = false
    const sentKeys = new Set<string | number>()

    const sendVisibleChanges = (
      changes: Array<ChangeMessage<any, string | number>>
    ) => {
      this.sendVisibleChangesToPipeline(changes, loadedInitialState, sentKeys)
    }

    const unsubscribe = this.collection.subscribeChanges(sendVisibleChanges, {
      whereExpression,
    })

    // Create a function that loads keys from the collection
    // into the query pipeline on demand
    const filterFn = whereExpression
      ? createFilterFunctionFromExpression(whereExpression)
      : () => true
    const loadKs = (keys: Set<string | number>) => {
      return this.loadKeys(keys, sentKeys, filterFn)
    }

    // Store the functions to load keys and load initial state in the `lazyCollectionsCallbacks` map
    // This is used by the join operator to dynamically load matching keys from the lazy collection
    // or to get the full initial state of the collection if there's no index for the join key
    this.collectionConfigBuilder.lazyCollectionsCallbacks[this.collectionId] = {
      loadKeys: loadKs,
      loadInitialState: () => {
        // Make sure we only load the initial state once
        if (loadedInitialState) return
        loadedInitialState = true

        const changes = this.collection.currentStateAsChanges({
          whereExpression,
        })
        this.sendChangesToPipeline(changes)
      },
    }
    return unsubscribe
  }

  private subscribeToOrderedChanges(
    whereExpression: BasicExpression<boolean> | undefined
  ) {
    const { offset, limit, comparator } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!

    // Keep track of the keys we've sent
    // and also the biggest value we've sent so far
    const sentValuesInfo: {
      sentKeys: Set<string | number>
      biggest: any
    } = {
      sentKeys: new Set<string | number>(),
      biggest: undefined,
    }

    // Load the first `offset + limit` values from the index
    // i.e. the K items from the collection that fall into the requested range: [offset, offset + limit[
    this.loadNextItems(sentValuesInfo, offset + limit)

    const sendChangesInRange = (
      changes: Iterable<ChangeMessage<any, string | number>>
    ) => {
      // Split live updates into a delete of the old value and an insert of the new value
      // and filter out changes that are bigger than the biggest value we've sent so far
      // because they can't affect the topK
      const splittedChanges = splitUpdates(changes)
      const filteredChanges = filterChangesSmallerOrEqualToMax(
        splittedChanges,
        comparator,
        sentValuesInfo.biggest
      )
      this.sendChangesToPipeline(
        filteredChanges,
        this.loadMoreIfNeeded.bind(this, sentValuesInfo)
      )
    }

    // Subscribe to changes and only send changes that are smaller than the biggest value we've sent so far
    // values that are bigger don't need to be sent because they can't affect the topK
    const unsubscribe = this.collection.subscribeChanges(sendChangesInRange, {
      whereExpression,
    })

    return unsubscribe
  }

  // This function is called by maybeRunGraph
  // after each iteration of the query pipeline
  // to ensure that the orderBy operator has enough data to work with
  private loadMoreIfNeeded(sentValuesInfo: {
    sentKeys: Set<string | number>
    biggest: any
  }) {
    const { dataNeeded } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!

    if (!dataNeeded) {
      // This should never happen because the topK operator should always set the size callback
      // which in turn should lead to the orderBy operator setting the dataNeeded callback
      throw new Error(
        `Missing dataNeeded callback for collection ${this.collectionId}`
      )
    }

    // `dataNeeded` probes the orderBy operator to see if it needs more data
    // if it needs more data, it returns the number of items it needs
    const n = dataNeeded()
    if (n > 0) {
      this.loadNextItems(sentValuesInfo, n)
    }

    // Indicate that we're done loading data if we didn't need to load more data
    return n === 0
  }

  private sendChangesToPipelineWithTracking(
    sentValuesInfo: {
      sentKeys: Set<string | number>
      biggest: any
    },
    changes: Iterable<ChangeMessage<any, string | number>>
  ) {
    const { comparator } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!
    const trackedChanges = trackSentValues(changes, comparator, sentValuesInfo)
    this.sendChangesToPipeline(
      trackedChanges,
      this.loadMoreIfNeeded.bind(this, sentValuesInfo)
    )
  }

  // Loads the next `n` items from the collection
  // starting from the biggest item it has sent
  private loadNextItems(
    sentValuesInfo: {
      sentKeys: Set<string | number>
      biggest: any
    },
    n: number
  ) {
    const { valueExtractorForRawRow, index } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!
    const biggestSentRow = sentValuesInfo.biggest
    const biggestSentValue = biggestSentRow
      ? valueExtractorForRawRow(biggestSentRow)
      : biggestSentRow
    // Take the `n` items after the biggest sent value
    const nextOrderedKeys = index.take(n, biggestSentValue)
    const nextInserts: Array<ChangeMessage<any, string | number>> =
      nextOrderedKeys.map((key) => {
        return { type: `insert`, key, value: this.collection.get(key) }
      })
    this.sendChangesToPipelineWithTracking(sentValuesInfo, nextInserts)
  }

  private getWhereClauseFromAlias(
    collectionAlias: string | undefined
  ): BasicExpression<boolean> | undefined {
    const collectionWhereClausesCache =
      this.collectionConfigBuilder.collectionWhereClausesCache
    if (collectionAlias && collectionWhereClausesCache) {
      return collectionWhereClausesCache.get(collectionAlias)
    }
    return undefined
  }
}

class CollectionConfigBuilder<
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
  readonly lazyCollectionsCallbacks: Record<string, LazyCollectionCallbacks> =
    {}
  // Set of collection IDs that are lazy collections
  readonly lazyCollections = new Set<string>()
  // Set of collection IDs that include an optimizable ORDER BY clause
  readonly optimizableOrderByCollections: Record<
    string,
    OrderByOptimizationInfo
  > = {}

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

  getConfig(): CollectionConfig<TResult> {
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
    config: Parameters<SyncConfig<TResult>[`sync`]>[0],
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

  private getSyncConfig(): SyncConfig<TResult> {
    return {
      rowUpdateMode: `full`,
      sync: this.syncFn.bind(this),
    }
  }

  private syncFn(config: Parameters<SyncConfig<TResult>[`sync`]>[0]) {
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

    this.subscribeToAllCollections(config, fullSyncState)

    // Initial run
    this.maybeRunGraph(config, fullSyncState)

    // Return the unsubscribe function
    return () => {
      syncState.unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe())

      // Reset caches so a fresh graph/pipeline is compiled on next start
      // This avoids reusing a finalized D2 graph across GC restarts
      this.graphCache = undefined
      this.inputsCache = undefined
      this.pipelineCache = undefined
      this.collectionWhereClausesCache = undefined
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
    config: Parameters<SyncConfig<TResult>[`sync`]>[0],
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
    config: Parameters<SyncConfig<TResult>[`sync`]>[0],
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
    config: Parameters<SyncConfig<TResult>[`sync`]>[0],
    syncState: FullSyncState
  ) {
    Object.entries(this.collections).forEach(([collectionId, collection]) => {
      const collectionSubscriber = new CollectionSubscriber(
        collectionId,
        collection,
        config,
        syncState,
        this
      )
      collectionSubscriber.subscribe()
    })

    // Mark the collections as subscribed in the sync state
    syncState.subscribedToAllCollections = true
  }
}

/**
 * Creates live query collection options for use with createCollection
 *
 * @example
 * ```typescript
 * const options = liveQueryCollectionOptions({
 *   // id is optional - will auto-generate if not provided
 *   query: (q) => q
 *     .from({ post: postsCollection })
 *     .where(({ post }) => eq(post.published, true))
 *     .select(({ post }) => ({
 *       id: post.id,
 *       title: post.title,
 *       content: post.content,
 *     })),
 *   // getKey is optional - will use stream key if not provided
 * })
 *
 * const collection = createCollection(options)
 * ```
 *
 * @param config - Configuration options for the live query collection
 * @returns Collection options that can be passed to createCollection
 */
export function liveQueryCollectionOptions<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
>(
  config: LiveQueryCollectionConfig<TContext, TResult>
): CollectionConfig<TResult> {
  /*
  // Generate a unique ID if not provided
  const id = config.id || `live-query-${++liveQueryCollectionCounter}`

  // Build the query
  const query = buildQueryFromConfig(config)

  // WeakMap to store the keys of the results
  // so that we can retrieve them in the getKey function
  const resultKeys = new WeakMap<object, unknown>()

  // WeakMap to store the orderBy index for each result
  const orderByIndices = new WeakMap<object, string>()

  // Create compare function for ordering if the query has orderBy
  const compare =
    query.orderBy && query.orderBy.length > 0
      ? createOrderByComparator<TResult>(orderByIndices)
      : undefined

  const collections = extractCollectionsFromQuery(query)

  const allCollectionsReady = () => {
    return Object.values(collections).every((collection) =>
      collection.isReady()
    )
  }

  const allCollectionsReadyOrInitialCommit = () => {
    return Object.values(collections).every(
      (collection) =>
        collection.status === `ready` || collection.status === `initialCommit`
    )
  }

  let graphCache: D2 | undefined
  let inputsCache: Record<string, RootStreamBuilder<unknown>> | undefined
  let pipelineCache: ResultStream | undefined
  let collectionWhereClausesCache:
    | Map<string, BasicExpression<boolean>>
    | undefined

  // Map of collection IDs to functions that load keys for that lazy collection
  const lazyCollectionsCallbacks: Record<string, LazyCollectionCallbacks> = {}
  // Set of collection IDs that are lazy collections
  const lazyCollections = new Set<string>()
  // Set of collection IDs that include an optimizable ORDER BY clause
  const optimizableOrderByCollections: Record<string, OrderByOptimizationInfo> =
    {}

  const compileBasePipeline = () => {
    graphCache = new D2()
    inputsCache = Object.fromEntries(
      Object.entries(collections).map(([key]) => [
        key,
        graphCache!.newInput<any>(),
      ])
    )

    // Compile the query and get both pipeline and collection WHERE clauses
    ;({
      pipeline: pipelineCache,
      collectionWhereClauses: collectionWhereClausesCache,
    } = compileQuery(
      query,
      inputsCache as Record<string, KeyedStream>,
      collections,
      lazyCollectionsCallbacks,
      lazyCollections,
      optimizableOrderByCollections
    ))
  }

  const maybeCompileBasePipeline = () => {
    if (!graphCache || !inputsCache || !pipelineCache) {
      compileBasePipeline()
    }
    return {
      graph: graphCache!,
      inputs: inputsCache!,
      pipeline: pipelineCache!,
    }
  }

  // Compile the base pipeline once initially
  // This is done to ensure that any errors are thrown immediately and synchronously
  compileBasePipeline()

  // Create the sync configuration
  const sync: SyncConfig<TResult> = {
    rowUpdateMode: `full`,
    sync: ({ begin, write, commit, markReady, collection: theCollection }) => {
      const { graph, inputs, pipeline } = maybeCompileBasePipeline()
      let messagesCount = 0
      pipeline.pipe(
        output((data) => {
          const messages = data.getInner()
          messagesCount += messages.length

          begin()
          messages
            .reduce((acc, [[key, tupleData], multiplicity]) => {
              // All queries now consistently return [value, orderByIndex] format
              // where orderByIndex is undefined for queries without ORDER BY
              const [value, orderByIndex] = tupleData as [
                TResult,
                string | undefined,
              ]

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
            }, new Map<unknown, { deletes: number; inserts: number; value: TResult; orderByIndex: string | undefined }>())
            .forEach((changes, rawKey) => {
              const { deletes, inserts, value, orderByIndex } = changes

              // Store the key of the result so that we can retrieve it in the
              // getKey function
              resultKeys.set(value, rawKey)

              // Store the orderBy index if it exists
              if (orderByIndex !== undefined) {
                orderByIndices.set(value, orderByIndex)
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
                (inserts === deletes &&
                  theCollection.has(rawKey as string | number))
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
                  `This should never happen ${JSON.stringify(changes)}`
                )
              }
            })
          commit()
        })
      )

      graph.finalize()

      let subscribedToAllCollections = false

      // The callback function is called after the graph has run.
      // This gives the callback a chance to load more data if needed,
      // that's used to optimize orderBy operators that set a limit,
      // in order to load some more data if we still don't have enough rows after the pipeline has run.
      // That can happend because even though we load N rows, the pipeline might filter some of these rows out
      // causing the orderBy operator to receive less than N rows or even no rows at all.
      // So this callback would notice that it doesn't have enough rows and load some more.
      // The callback returns a boolean, when it's true it's done loading data and we can mark the collection as ready.
      const maybeRunGraph = (callback?: () => boolean) => {
        // We only run the graph if all the collections are ready
        if (
          allCollectionsReadyOrInitialCommit() &&
          subscribedToAllCollections
        ) {
          graph.run()
          const ready = callback?.() ?? true
          // On the initial run, we may need to do an empty commit to ensure that
          // the collection is initialized
          if (messagesCount === 0) {
            begin()
            commit()
          }
          // Mark the collection as ready after the first successful run
          if (ready && allCollectionsReady()) {
            markReady()
          }
        }
      }

      // Unsubscribe callbacks
      const unsubscribeCallbacks = new Set<() => void>()

      // Subscribe to all collections, using WHERE clause optimization when available
      Object.entries(collections).forEach(([collectionId, collection]) => {
        const input = inputs[collectionId]!
        const collectionAlias = findCollectionAlias(collectionId, query)
        const whereClause =
          collectionAlias && collectionWhereClausesCache
            ? collectionWhereClausesCache.get(collectionAlias)
            : undefined

        const sendChangesToPipeline = (
          changes: Iterable<ChangeMessage<any, string | number>>,
          callback?: () => boolean
        ) => {
          sendChangesToInput(input, changes, collection.config.getKey)
          maybeRunGraph(callback)
        }

        // Wraps the sendChangesToPipeline function
        // in order to turn `update`s into `insert`s
        // for keys that have not been sent to the pipeline yet
        // and filter out deletes for keys that have not been sent
        const sendVisibleChangesToPipeline = (
          changes: Array<ChangeMessage<any, string | number>>,
          loadedInitialState: boolean,
          sentKeys: Set<string | number>
        ) => {
          if (loadedInitialState) {
            // There was no index for the join key
            // so we loaded the initial state
            // so we can safely assume that the pipeline has seen all keys
            return sendChangesToPipeline(changes)
          }

          const newChanges = []
          for (const change of changes) {
            let newChange = change
            if (!sentKeys.has(change.key)) {
              if (change.type === `update`) {
                newChange = { ...change, type: `insert` }
              } else if (change.type === `delete`) {
                // filter out deletes for keys that have not been sent
                continue
              }
            }
            newChanges.push(newChange)
          }

          return sendChangesToPipeline(newChanges)
        }

        const loadKeys = (
          keys: Iterable<string | number>,
          sentKeys: Set<string | number>,
          filterFn: (item: object) => boolean
        ) => {
          for (const key of keys) {
            // Only load the key once
            if (sentKeys.has(key)) continue

            const value = collection.get(key)
            if (value !== undefined && filterFn(value)) {
              sentKeys.add(key)
              sendChangesToPipeline([{ type: `insert`, key, value }])
            }
          }
        }

        const subscribeToAllChanges = (
          whereExpression: BasicExpression<boolean> | undefined
        ) => {
          const unsubscribe = collection.subscribeChanges(
            sendChangesToPipeline,
            {
              includeInitialState: true,
              ...(whereExpression ? { whereExpression } : undefined),
            }
          )
          return unsubscribe
        }

        // Subscribes to all changes but without the initial state
        // such that we can load keys from the initial state on demand
        // based on the matching keys from the main collection in the join
        const subscribeToMatchingChanges = (
          whereExpression: BasicExpression<boolean> | undefined
        ) => {
          let loadedInitialState = false
          const sentKeys = new Set<string | number>()

          const sendVisibleChanges = (
            changes: Array<ChangeMessage<any, string | number>>
          ) => {
            sendVisibleChangesToPipeline(changes, loadedInitialState, sentKeys)
          }

          const unsubscribe = collection.subscribeChanges(sendVisibleChanges, {
            whereExpression,
          })

          // Create a function that loads keys from the collection
          // into the query pipeline on demand
          const filterFn = whereExpression
            ? createFilterFunctionFromExpression(whereExpression)
            : () => true
          const loadKs = (keys: Set<string | number>) => {
            return loadKeys(keys, sentKeys, filterFn)
          }

          // Store the functions to load keys and load initial state in the `lazyCollectionsCallbacks` map
          // This is used by the join operator to dynamically load matching keys from the lazy collection
          // or to get the full initial state of the collection if there's no index for the join key
          lazyCollectionsCallbacks[collectionId] = {
            loadKeys: loadKs,
            loadInitialState: () => {
              // Make sure we only load the initial state once
              if (loadedInitialState) return
              loadedInitialState = true

              const changes = collection.currentStateAsChanges({
                whereExpression,
              })
              sendChangesToPipeline(changes)
            },
          }
          return unsubscribe
        }

        const subscribeToOrderedChanges = (
          whereExpression: BasicExpression<boolean> | undefined
        ) => {
          const {
            offset,
            limit,
            comparator,
            index,
            dataNeeded,
            valueExtractorForRawRow,
          } = optimizableOrderByCollections[collectionId]!

          if (!dataNeeded) {
            // This should never happen because the topK operator should always set the size callback
            // which in turn should lead to the orderBy operator setting the dataNeeded callback
            throw new Error(
              `Missing dataNeeded callback for collection ${collectionId}`
            )
          }

          // This function is called by maybeRunGraph
          // after each iteration of the query pipeline
          // to ensure that the orderBy operator has enough data to work with
          const loadMoreIfNeeded = () => {
            // `dataNeeded` probes the orderBy operator to see if it needs more data
            // if it needs more data, it returns the number of items it needs
            const n = dataNeeded()
            if (n > 0) {
              loadNextItems(n)
            }

            // Indicate that we're done loading data if we didn't need to load more data
            return n === 0
          }

          // Keep track of the keys we've sent
          // and also the biggest value we've sent so far
          const sentValuesInfo: {
            sentKeys: Set<string | number>
            biggest: any
          } = {
            sentKeys: new Set<string | number>(),
            biggest: undefined,
          }

          const sendChangesToPipelineWithTracking = (
            changes: Iterable<ChangeMessage<any, string | number>>
          ) => {
            const trackedChanges = trackSentValues(
              changes,
              comparator,
              sentValuesInfo
            )
            sendChangesToPipeline(trackedChanges, loadMoreIfNeeded)
          }

          // Loads the next `n` items from the collection
          // starting from the biggest item it has sent
          const loadNextItems = (n: number) => {
            const biggestSentRow = sentValuesInfo.biggest
            const biggestSentValue = biggestSentRow
              ? valueExtractorForRawRow(biggestSentRow)
              : biggestSentRow
            // Take the `n` items after the biggest sent value
            const nextOrderedKeys = index.take(n, biggestSentValue)
            const nextInserts: Array<ChangeMessage<any, string | number>> =
              nextOrderedKeys.map((key) => {
                return { type: `insert`, key, value: collection.get(key) }
              })
            sendChangesToPipelineWithTracking(nextInserts)
          }

          // Load the first `offset + limit` values from the index
          // i.e. the K items from the collection that fall into the requested range: [offset, offset + limit[
          loadNextItems(offset + limit)

          const sendChangesInRange = (
            changes: Iterable<ChangeMessage<any, string | number>>
          ) => {
            // Split live updates into a delete of the old value and an insert of the new value
            // and filter out changes that are bigger than the biggest value we've sent so far
            // because they can't affect the topK
            const splittedChanges = splitUpdates(changes)
            const filteredChanges = filterChangesSmallerOrEqualToMax(
              splittedChanges,
              comparator,
              sentValuesInfo.biggest
            )
            sendChangesToPipeline(filteredChanges, loadMoreIfNeeded)
          }

          // Subscribe to changes and only send changes that are smaller than the biggest value we've sent so far
          // values that are bigger don't need to be sent because they can't affect the topK
          const unsubscribe = collection.subscribeChanges(sendChangesInRange, {
            whereExpression,
          })

          return unsubscribe
        }

        const subscribeToChanges = (
          whereExpression?: BasicExpression<boolean>
        ) => {
          let unsubscribe: () => void
          if (lazyCollections.has(collectionId)) {
            unsubscribe = subscribeToMatchingChanges(whereExpression)
          } else if (
            Object.hasOwn(optimizableOrderByCollections, collectionId)
          ) {
            unsubscribe = subscribeToOrderedChanges(whereExpression)
          } else {
            unsubscribe = subscribeToAllChanges(whereExpression)
          }
          unsubscribeCallbacks.add(unsubscribe)
        }

        if (whereClause) {
          // Convert WHERE clause to BasicExpression format for collection subscription
          const whereExpression = convertToBasicExpression(
            whereClause,
            collectionAlias!
          )

          if (whereExpression) {
            // Use index optimization for this collection
            subscribeToChanges(whereExpression)
          } else {
            // This should not happen - if we have a whereClause but can't create whereExpression,
            // it indicates a bug in our optimization logic
            throw new Error(
              `Failed to convert WHERE clause to collection filter for collection '${collectionId}'. ` +
                `This indicates a bug in the query optimization logic.`
            )
          }
        } else {
          // No WHERE clause for this collection, use regular subscription
          subscribeToChanges()
        }
      })

      subscribedToAllCollections = true

      // Initial run
      maybeRunGraph()

      // Return the unsubscribe function
      return () => {
        unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe())

        // Reset caches so a fresh graph/pipeline is compiled on next start
        // This avoids reusing a finalized D2 graph across GC restarts
        graphCache = undefined
        inputsCache = undefined
        pipelineCache = undefined
        collectionWhereClausesCache = undefined
      }
    },
  }

  // Return collection configuration
  return {
    id,
    getKey:
      config.getKey || ((item) => resultKeys.get(item) as string | number),
    sync,
    compare,
    gcTime: config.gcTime || 5000, // 5 seconds by default for live queries
    schema: config.schema,
    onInsert: config.onInsert,
    onUpdate: config.onUpdate,
    onDelete: config.onDelete,
    startSync: config.startSync,
  }
  */
  const collectionConfigBuilder = new CollectionConfigBuilder<
    TContext,
    TResult
  >(config)
  return collectionConfigBuilder.getConfig()
}

/**
 * Creates a live query collection directly
 *
 * @example
 * ```typescript
 * // Minimal usage - just pass a query function
 * const activeUsers = createLiveQueryCollection(
 *   (q) => q
 *     .from({ user: usersCollection })
 *     .where(({ user }) => eq(user.active, true))
 *     .select(({ user }) => ({ id: user.id, name: user.name }))
 * )
 *
 * // Full configuration with custom options
 * const searchResults = createLiveQueryCollection({
 *   id: "search-results", // Custom ID (auto-generated if omitted)
 *   query: (q) => q
 *     .from({ post: postsCollection })
 *     .where(({ post }) => like(post.title, `%${searchTerm}%`))
 *     .select(({ post }) => ({
 *       id: post.id,
 *       title: post.title,
 *       excerpt: post.excerpt,
 *     })),
 *   getKey: (item) => item.id, // Custom key function (uses stream key if omitted)
 *   utils: {
 *     updateSearchTerm: (newTerm: string) => {
 *       // Custom utility functions
 *     }
 *   }
 * })
 * ```
 */

// Overload 1: Accept just the query function
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
>(
  query: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): Collection<TResult, string | number, {}>

// Overload 2: Accept full config object with optional utilities
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
  TUtils extends UtilsRecord = {},
>(
  config: LiveQueryCollectionConfig<TContext, TResult> & { utils?: TUtils }
): Collection<TResult, string | number, TUtils>

// Implementation
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
  TUtils extends UtilsRecord = {},
>(
  configOrQuery:
    | (LiveQueryCollectionConfig<TContext, TResult> & { utils?: TUtils })
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
): Collection<TResult, string | number, TUtils> {
  // Determine if the argument is a function (query) or a config object
  if (typeof configOrQuery === `function`) {
    // Simple query function case
    const config: LiveQueryCollectionConfig<TContext, TResult> = {
      query: configOrQuery as (
        q: InitialQueryBuilder
      ) => QueryBuilder<TContext>,
    }
    const options = liveQueryCollectionOptions<TContext, TResult>(config)
    return bridgeToCreateCollection(options)
  } else {
    // Config object case
    const config = configOrQuery as LiveQueryCollectionConfig<
      TContext,
      TResult
    > & { utils?: TUtils }
    const options = liveQueryCollectionOptions<TContext, TResult>(config)
    return bridgeToCreateCollection({
      ...options,
      utils: config.utils,
    })
  }
}

/**
 * Bridge function that handles the type compatibility between query2's TResult
 * and core collection's ResolveType without exposing ugly type assertions to users
 */
function bridgeToCreateCollection<
  TResult extends object,
  TUtils extends UtilsRecord = {},
>(
  options: CollectionConfig<TResult> & { utils?: TUtils }
): Collection<TResult, string | number, TUtils> {
  // This is the only place we need a type assertion, hidden from user API
  return createCollection(options as any) as unknown as Collection<
    TResult,
    string | number,
    TUtils
  >
}

/**
 * Helper function to send changes to a D2 input stream
 */
function sendChangesToInput(
  input: RootStreamBuilder<unknown>,
  changes: Iterable<ChangeMessage>,
  getKey: (item: ChangeMessage[`value`]) => any
) {
  const multiSetArray: MultiSetArray<unknown> = []
  for (const change of changes) {
    const key = getKey(change.value)
    if (change.type === `insert`) {
      multiSetArray.push([[key, change.value], 1])
    } else if (change.type === `update`) {
      multiSetArray.push([[key, change.previousValue], -1])
      multiSetArray.push([[key, change.value], 1])
    } else {
      // change.type === `delete`
      multiSetArray.push([[key, change.value], -1])
    }
  }
  input.sendData(new MultiSet(multiSetArray))
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
 * Converts WHERE expressions from the query IR into a BasicExpression for subscribeChanges
 *
 * @param whereExpressions Array of WHERE expressions to convert
 * @param tableAlias The table alias used in the expressions
 * @returns A BasicExpression that can be used with the collection's index system
 */

/**
 * Finds the alias for a collection ID in the query
 */
function findCollectionAlias(
  collectionId: string,
  query: any
): string | undefined {
  // Check FROM clause
  if (
    query.from?.type === `collectionRef` &&
    query.from.collection?.id === collectionId
  ) {
    return query.from.alias
  }

  // Check JOIN clauses
  if (query.join) {
    for (const joinClause of query.join) {
      if (
        joinClause.from?.type === `collectionRef` &&
        joinClause.from.collection?.id === collectionId
      ) {
        return joinClause.from.alias
      }
    }
  }

  return undefined
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

function* trackSentValues(
  changes: Iterable<ChangeMessage<any, string | number>>,
  comparator: (a: any, b: any) => number,
  tracker: { sentKeys: Set<string | number>; biggest: any }
) {
  for (const change of changes) {
    tracker.sentKeys.add(change.key)

    if (!tracker.biggest) {
      tracker.biggest = change.value
    } else if (comparator(tracker.biggest, change.value) < 0) {
      tracker.biggest = change.value
    }

    yield change
  }
}

/** Splits updates into a delete of the old value and an insert of the new value */
function* splitUpdates<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (change.type === `update`) {
      yield { type: `delete`, key: change.key, value: change.previousValue! }
      yield { type: `insert`, key: change.key, value: change.value }
    } else {
      yield change
    }
  }
}

function* filterChanges<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
  f: (change: ChangeMessage<T, TKey>) => boolean
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (f(change)) {
      yield change
    }
  }
}

/**
 * Filters changes to only include those that are smaller than the provided max value
 * @param changes - Iterable of changes to filter
 * @param comparator - Comparator function to use for filtering
 * @param maxValue - Range to filter changes within (range boundaries are exclusive)
 * @returns Iterable of changes that fall within the range
 */
function* filterChangesSmallerOrEqualToMax<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
  comparator: (a: any, b: any) => number,
  maxValue: any
): Generator<ChangeMessage<T, TKey>> {
  yield* filterChanges(changes, (change) => {
    return !maxValue || comparator(change.value, maxValue) <= 0
  })
}
