import {
  BaseQueryBuilder,
  CollectionImpl,
  createLiveQueryCollection,
} from "@tanstack/db"
import type {
  Collection,
  CollectionStatus,
  Context,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"

const DEFAULT_GC_TIME_MS = 1

export type LiveQueryStatus = CollectionStatus | `disabled`

/**
 * Subscription callback for live query changes
 */
export type ChangeCallback<TData> = (params: {
  data: TData
  state: Map<string | number, any>
  status: LiveQueryStatus
  isLoading: boolean
  isReady: boolean
  isError: boolean
  isIdle: boolean
  isCleanedUp: boolean
}) => void

/**
 * Live query instance for vanilla JavaScript
 */
export interface LiveQuery<TData = any> {
  /** Current data array or single result */
  data: TData
  /** Current state map */
  state: Map<string | number, any>
  /** Current status */
  status: LiveQueryStatus
  /** Is the query currently loading */
  isLoading: boolean
  /** Is the query ready with data */
  isReady: boolean
  /** Is the query in error state */
  isError: boolean
  /** Is the query idle */
  isIdle: boolean
  /** Is the query cleaned up */
  isCleanedUp: boolean
  /** Is the query enabled */
  isEnabled: boolean
  /** The underlying collection instance */
  collection: Collection<any, string | number, any> | undefined
  /** Subscribe to changes */
  subscribe: (callback: ChangeCallback<TData>) => () => void
  /** Clean up and destroy the query */
  destroy: () => void
}

/**
 * Create a live query for vanilla JavaScript / HTML applications
 *
 * Unlike React's useLiveQuery which uses hooks and automatic re-rendering,
 * this returns a LiveQuery object that you manually subscribe to for changes.
 *
 * @param queryFn - Query function that defines what data to fetch
 * @returns LiveQuery object with data, state, and subscription methods
 *
 * @example
 * // Basic query
 * const todosQuery = createLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 *    .where(({ todos }) => eq(todos.completed, false))
 *    .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * )
 *
 * // Subscribe to changes
 * const unsubscribe = todosQuery.subscribe(({ data, isLoading }) => {
 *   if (isLoading) {
 *     document.getElementById('todos').innerHTML = 'Loading...'
 *     return
 *   }
 *
 *   document.getElementById('todos').innerHTML = data
 *     .map(todo => `<li>${todo.text}</li>`)
 *     .join('')
 * })
 *
 * // Access current state at any time
 * console.log(todosQuery.data)
 * console.log(todosQuery.isReady)
 *
 * // Clean up when done
 * unsubscribe()
 * todosQuery.destroy()
 *
 * @example
 * // With join
 * const issuesQuery = createLiveQuery((q) =>
 *   q.from({ issues: issueCollection })
 *    .join({ persons: personCollection }, ({ issues, persons }) =>
 *      eq(issues.userId, persons.id)
 *    )
 *    .select(({ issues, persons }) => ({
 *      id: issues.id,
 *      title: issues.title,
 *      userName: persons.name
 *    }))
 * )
 *
 * @example
 * // Conditional queries
 * let activeFilter = 'all'
 * const getQuery = () => createLiveQuery((q) => {
 *   const query = q.from({ todos: todosCollection })
 *
 *   if (activeFilter === 'active') {
 *     return query.where(({ todos }) => eq(todos.completed, false))
 *   } else if (activeFilter === 'completed') {
 *     return query.where(({ todos }) => eq(todos.completed, true))
 *   }
 *
 *   return query
 * })
 */
export function createLiveQuery<TContext extends Context>(
  queryFn:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | LiveQueryCollectionConfig<TContext>
    | Collection<any, string | number, any>,
  options?: { gcTime?: number }
): LiveQuery<InferResultType<TContext>>

export function createLiveQuery<TContext extends Context>(
  queryFn:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext> | undefined | null)
    | LiveQueryCollectionConfig<TContext>
    | Collection<any, string | number, any>,
  options?: { gcTime?: number }
): LiveQuery<InferResultType<TContext> | undefined>

export function createLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  queryFn:
    | ((
        q: InitialQueryBuilder
      ) => Collection<TResult, TKey, TUtils> | undefined | null)
    | Collection<TResult, TKey, TUtils>,
  options?: { gcTime?: number }
): LiveQuery<Array<TResult> | undefined>

// Implementation
export function createLiveQuery(
  configOrQueryOrCollection: any,
  options: { gcTime?: number } = {}
): LiveQuery {
  const gcTime = options.gcTime ?? DEFAULT_GC_TIME_MS

  // Check if it's already a collection
  const isCollection =
    configOrQueryOrCollection &&
    typeof configOrQueryOrCollection === `object` &&
    typeof configOrQueryOrCollection.subscribeChanges === `function` &&
    typeof configOrQueryOrCollection.startSyncImmediate === `function` &&
    typeof configOrQueryOrCollection.id === `string`

  let collection: Collection<object, string | number, {}> | null = null

  if (isCollection) {
    // It's already a collection
    configOrQueryOrCollection.startSyncImmediate()
    collection = configOrQueryOrCollection
  } else if (typeof configOrQueryOrCollection === `function`) {
    // Call the function with a query builder to see what it returns
    const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
    const result = configOrQueryOrCollection(queryBuilder)

    if (result === undefined || result === null) {
      // Callback returned undefined/null - disabled query
      collection = null
    } else if (result instanceof CollectionImpl) {
      // Callback returned a Collection instance
      result.startSyncImmediate()
      collection = result
    } else if (result instanceof BaseQueryBuilder) {
      // Callback returned QueryBuilder - create live query collection
      collection = createLiveQueryCollection({
        query: configOrQueryOrCollection,
        startSync: true,
        gcTime,
      })
    } else if (result && typeof result === `object`) {
      // Assume it's a LiveQueryCollectionConfig
      collection = createLiveQueryCollection({
        startSync: true,
        gcTime,
        ...result,
      })
    } else {
      throw new Error(
        `createLiveQuery callback must return a QueryBuilder, LiveQueryCollectionConfig, Collection, undefined, or null. Got: ${typeof result}`
      )
    }
  } else {
    // Config object
    collection = createLiveQueryCollection({
      startSync: true,
      gcTime,
      ...configOrQueryOrCollection,
    })
  }

  // Track subscriptions
  const subscriptions = new Set<ChangeCallback<any>>()
  let collectionSubscription: { unsubscribe: () => void } | null = null

  // Notify all subscribers
  const notify = () => {
    const snapshot = getSnapshot()
    subscriptions.forEach((callback) => {
      callback(snapshot)
    })
  }

  // Get current snapshot
  const getSnapshot = () => {
    if (!collection) {
      return {
        data: undefined,
        state: new Map() as Map<string | number, any>,
        status: `disabled` as const,
        isLoading: false,
        isReady: false,
        isError: false,
        isIdle: false,
        isCleanedUp: false,
      }
    }

    const entries = Array.from(collection.entries()) as Array<
      [string | number, any]
    >
    const config: any = collection.config
    const singleResult = config.singleResult
    const data = singleResult
      ? entries.map(([, value]) => value)[0]
      : entries.map(([, value]) => value)

    return {
      data,
      state: new Map(entries),
      status: collection.status,
      isLoading: collection.status === `loading`,
      isReady: collection.status === `ready`,
      isError: collection.status === `error`,
      isIdle: collection.status === `idle`,
      isCleanedUp: collection.status === `cleaned-up`,
    }
  }

  // Setup collection subscription
  if (collection) {
    collectionSubscription = collection.subscribeChanges(() => {
      notify()
    })

    // Notify initially if collection is ready
    if (collection.status === `ready`) {
      // Defer to next tick to allow subscribers to be added
      setTimeout(notify, 0)
    }
  }

  // Create the live query object
  const liveQuery: LiveQuery = {
    get data() {
      return getSnapshot().data
    },
    get state() {
      return getSnapshot().state
    },
    get status() {
      return getSnapshot().status
    },
    get isLoading() {
      return getSnapshot().isLoading
    },
    get isReady() {
      return getSnapshot().isReady
    },
    get isError() {
      return getSnapshot().isError
    },
    get isIdle() {
      return getSnapshot().isIdle
    },
    get isCleanedUp() {
      return getSnapshot().isCleanedUp
    },
    get isEnabled() {
      return collection !== null
    },
    get collection() {
      return collection || undefined
    },
    subscribe(callback: ChangeCallback<any>) {
      subscriptions.add(callback)

      // Call immediately with current state
      callback(getSnapshot())

      // Return unsubscribe function
      return () => {
        subscriptions.delete(callback)
      }
    },
    destroy() {
      // Unsubscribe from collection
      if (collectionSubscription) {
        collectionSubscription.unsubscribe()
        collectionSubscription = null
      }

      // Clear all subscriptions
      subscriptions.clear()

      // Note: We don't destroy the collection itself as it might be shared
      // The collection will be garbage collected based on its gcTime setting
    },
  }

  return liveQuery
}
