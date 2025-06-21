import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { createCollection } from "../collection.js"
import { compileQuery } from "./compiler/index.js"
import { buildQuery } from "./query-builder/index.js"
import type {
  InitialQueryBuilder,
  QueryBuilder,
} from "./query-builder/index.js"
import type { Collection } from "../collection.js"
import type {
  ChangeMessage,
  CollectionConfig,
  KeyedStream,
  SyncConfig,
  UtilsRecord,
} from "../types.js"
import type { Context, GetResult } from "./query-builder/types.js"
import type {
  IStreamBuilder,
  MultiSetArray,
  RootStreamBuilder,
} from "@electric-sql/d2mini"

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
  query: (q: InitialQueryBuilder) => QueryBuilder<TContext>

  /**
   * Function to extract the key from result items
   * If not provided, defaults to using the key from the D2 stream
   */
  getKey?: (item: TResult & { _key?: string | number }) => string | number

  /**
   * Optional schema for validation
   */
  schema?: CollectionConfig<TResult & { _key?: string | number }>[`schema`]

  /**
   * Optional mutation handlers
   */
  onInsert?: CollectionConfig<TResult & { _key?: string | number }>[`onInsert`]
  onUpdate?: CollectionConfig<TResult & { _key?: string | number }>[`onUpdate`]
  onDelete?: CollectionConfig<TResult & { _key?: string | number }>[`onDelete`]
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
  TResult extends object = GetResult<TContext> & object,
  TUtils extends UtilsRecord = {},
>(
  config: LiveQueryCollectionConfig<TContext, TResult>
): CollectionConfig<TResult & { _key?: string | number }> & { utils?: TUtils } {
  // Generate a unique ID if not provided
  const id = config.id || `live-query-${++liveQueryCollectionCounter}`

  // Build the query using the provided query builder function
  const query = buildQuery(config.query)

  // Create the sync configuration
  const sync: SyncConfig<TResult & { _key?: string | number }> = {
    sync: ({ begin, write, commit }) => {
      // Extract collections from the query
      const collections = extractCollectionsFromQuery(query)

      // Create D2 graph and inputs
      const graph = new D2()
      const inputs = Object.fromEntries(
        Object.entries(collections).map(([key]) => [key, graph.newInput<any>()])
      )

      // Compile the query to a D2 pipeline
      const pipeline = compileQuery<IStreamBuilder<[unknown, TResult]>>(
        query,
        inputs as Record<string, KeyedStream>
      )

      // Process output and send to collection
      pipeline.pipe(
        output((data) => {
          begin()
          data
            .getInner()
            .reduce((acc, [[key, value], multiplicity]) => {
              const changes = acc.get(key) || {
                deletes: 0,
                inserts: 0,
                value,
              }
              if (multiplicity < 0) {
                changes.deletes += Math.abs(multiplicity)
              } else if (multiplicity > 0) {
                changes.inserts += multiplicity
                changes.value = value
              }
              acc.set(key, changes)
              return acc
            }, new Map<unknown, { deletes: number; inserts: number; value: TResult }>())
            .forEach((changes, rawKey) => {
              const { deletes, inserts, value } = changes
              const valueWithKey = { ...value, _key: rawKey } as TResult & {
                _key: string | number
              }

              if (inserts && !deletes) {
                write({
                  value: valueWithKey,
                  type: `insert`,
                })
              } else if (inserts >= deletes) {
                write({
                  value: valueWithKey,
                  type: `update`,
                })
              } else if (deletes > 0) {
                write({
                  value: valueWithKey,
                  type: `delete`,
                })
              }
            })
          commit()
        })
      )

      // Finalize the graph
      graph.finalize()

      // Set up data flow from input collections to the compiled query
      Object.entries(collections).forEach(([collectionId, collection]) => {
        const input = inputs[collectionId]!

        // Send initial state
        sendChangesToInput(
          input,
          collection.currentStateAsChanges(),
          collection.config.getKey
        )
        graph.run()

        // Subscribe to changes
        collection.subscribeChanges((changes: Array<ChangeMessage>) => {
          sendChangesToInput(input, changes, collection.config.getKey)
          graph.run()
        })
      })
    },
  }

  // Return collection configuration
  return {
    id,
    getKey: config.getKey || ((item) => item._key as string | number),
    sync,
    schema: config.schema,
    onInsert: config.onInsert,
    onUpdate: config.onUpdate,
    onDelete: config.onDelete,
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
  TResult extends object = GetResult<TContext> & object,
>(
  query: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): Collection<TResult & { _key?: string | number }, string | number, {}>

// Overload 2: Accept full config object with optional utilities
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext> & object,
  TUtils extends UtilsRecord = {},
>(
  config: LiveQueryCollectionConfig<TContext, TResult> & { utils?: TUtils }
): Collection<TResult & { _key?: string | number }, string | number, TUtils>

// Implementation
export function createLiveQueryCollection<
  TContext extends Context,
  TResult extends object = GetResult<TContext> & object,
  TUtils extends UtilsRecord = {},
>(
  configOrQuery:
    | (LiveQueryCollectionConfig<TContext, TResult> & { utils?: TUtils })
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
): Collection<TResult & { _key?: string | number }, string | number, TUtils> {
  // Determine if the argument is a function (query) or a config object
  if (typeof configOrQuery === `function`) {
    // Simple query function case
    const config: LiveQueryCollectionConfig<TContext, TResult> = {
      query: configOrQuery,
    }
    const options = liveQueryCollectionOptions<TContext, TResult>(config)

    return createCollection({
      ...options,
    }) as Collection<
      TResult & { _key?: string | number },
      string | number,
      TUtils
    >
  } else {
    // Config object case
    const config = configOrQuery as LiveQueryCollectionConfig<
      TContext,
      TResult
    > & { utils?: TUtils }
    const options = liveQueryCollectionOptions<TContext, TResult, TUtils>(
      config
    )

    return createCollection({
      ...options,
      utils: config.utils,
    })
  }
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
function extractCollectionsFromQuery(query: any): Record<string, any> {
  const collections: Record<string, any> = {}

  // Extract from FROM clause
  if (query.from && query.from.type === `collectionRef`) {
    collections[query.from.collection.id] = query.from.collection
  }

  // Extract from JOIN clauses
  if (query.join && Array.isArray(query.join)) {
    for (const joinClause of query.join) {
      if (joinClause.from && joinClause.from.type === `collectionRef`) {
        collections[joinClause.from.collection.id] = joinClause.from.collection
      }
    }
  }

  return collections
}
