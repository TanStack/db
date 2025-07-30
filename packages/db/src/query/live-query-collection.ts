import { D2, MultiSet, output } from "@tanstack/db-ivm"
import { createCollection } from "../collection.js"
import { compileQuery } from "./compiler/index.js"
import { buildQuery, getQueryIR } from "./builder/index.js"
import { convertToBasicExpression } from "./compiler/expressions.js"
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
import type { BasicExpression } from "./ir.js"

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
  // Generate a unique ID if not provided
  const id = config.id || `live-query-${++liveQueryCollectionCounter}`

  // Build the query using the provided query builder function or instance
  const query =
    typeof config.query === `function`
      ? buildQuery<TContext>(config.query)
      : getQueryIR(config.query)

  // WeakMap to store the keys of the results so that we can retreve them in the
  // getKey function
  const resultKeys = new WeakMap<object, unknown>()

  // WeakMap to store the orderBy index for each result
  const orderByIndices = new WeakMap<object, string>()

  // Create compare function for ordering if the query has orderBy
  const compare =
    query.orderBy && query.orderBy.length > 0
      ? (val1: TResult, val2: TResult): number => {
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
      : undefined

  const collections = extractCollectionsFromQuery(query)

  const allCollectionsReady = () => {
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
    } = compileQuery(query, inputsCache as Record<string, KeyedStream>))
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

      const maybeRunGraph = () => {
        // We only run the graph if all the collections are ready
        if (allCollectionsReady()) {
          graph.run()
          // On the initial run, we may need to do an empty commit to ensure that
          // the collection is initialized
          if (messagesCount === 0) {
            begin()
            commit()
          }
          // Mark the collection as ready after the first successful run
          markReady()
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

        if (whereClause) {
          // Convert WHERE clause to BasicExpression format for collection subscription
          const whereExpression = convertToBasicExpression(
            whereClause,
            collectionAlias!
          )

          if (whereExpression) {
            // Use index optimization for this collection
            const subscription = collection.subscribeChanges(
              (changes) => {
                sendChangesToInput(input, changes, collection.config.getKey)
                maybeRunGraph()
              },
              {
                includeInitialState: true,
                whereExpression: whereExpression,
              }
            )
            unsubscribeCallbacks.add(subscription)
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
          const subscription = collection.subscribeChanges(
            (changes) => {
              sendChangesToInput(input, changes, collection.config.getKey)
              maybeRunGraph()
            },
            { includeInitialState: true }
          )
          unsubscribeCallbacks.add(subscription)
        }
      })

      // Initial run
      maybeRunGraph()

      // Return the unsubscribe function
      return () => {
        unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe())
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
  changes: Array<ChangeMessage>,
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
