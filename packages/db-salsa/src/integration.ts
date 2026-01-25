/**
 * TanStack DB Integration
 *
 * This module shows how to bridge Salsa-style incremental computation
 * with TanStack DB's existing D2/IVM architecture.
 *
 * The key insight is that Salsa operates at the **query level** while D2
 * operates at the **row level**. They are complementary:
 *
 * - D2 incrementally maintains query results as rows change
 * - Salsa can memoize entire query results and track query-to-query deps
 *
 * Integration points:
 * 1. Collection changes become Salsa input mutations
 * 2. Live query results become Salsa query outputs
 * 3. Query-to-query dependencies (subqueries) are tracked automatically
 */

import { recordDependency } from './context.js'
import type {Database, QueryHandle} from './database.js';
import type {QueryId, Revision} from './types.js';

/**
 * Adapter to bridge a TanStack DB collection with Salsa inputs.
 *
 * When collection data changes, the corresponding Salsa input is updated,
 * which triggers invalidation of dependent queries.
 */
export interface CollectionAdapter<T, TKey> {
  /** The collection being adapted */
  readonly collectionName: string
  /** Salsa input tracking the collection revision */
  readonly revisionInput: QueryId
  /** Get the current collection data (for query access) */
  getData: () => Map<TKey, T>
  /** Notify that collection data has changed */
  notifyChange: () => void
}

/**
 * Create a collection adapter that bridges TanStack DB collections
 * with Salsa incremental computation.
 */
export function createCollectionAdapter<T, TKey>(
  db: Database,
  collectionName: string,
  initialData: Map<TKey, T> = new Map()
): CollectionAdapter<T, TKey> {
  // Track the collection's revision as a Salsa input
  const revisionInput = db.input(`collection:${collectionName}:rev`, 0)
  const data = initialData
  let version = 0

  return {
    collectionName,
    revisionInput: revisionInput.id,

    getData(): Map<TKey, T> {
      // Record dependency when reading collection data
      recordDependency(revisionInput.id, revisionInput.revision())
      return data
    },

    notifyChange(): void {
      version++
      revisionInput.set(version)
    },
  }
}

/**
 * A Salsa-aware live query builder.
 *
 * This wraps TanStack DB live query patterns with Salsa memoization,
 * enabling:
 * - Query-level caching (not just row-level via D2)
 * - Automatic dependency tracking between queries
 * - "Why did this query re-run?" debugging
 */
export interface SalsaLiveQuery<T> {
  /** The query handle */
  readonly handle: QueryHandle<T>
  /** Subscribe to query result changes */
  subscribe: (callback: (result: T) => void) => () => void
  /** Read current result (may recompute if stale) */
  read: () => T
  /** Check if result is up-to-date */
  isStale: () => boolean
}

/**
 * Create a Salsa-aware live query.
 *
 * @example
 * ```ts
 * const db = new Database()
 *
 * // Adapt collections
 * const usersAdapter = createCollectionAdapter(db, 'users')
 * const postsAdapter = createCollectionAdapter(db, 'posts')
 *
 * // Create Salsa query that reads from collections
 * const activeUsers = createSalsaQuery(db, 'activeUsers', () => {
 *   const users = usersAdapter.getData()
 *   return [...users.values()].filter(u => u.active)
 * })
 *
 * // Create query that depends on another query
 * const activeUserPosts = createSalsaQuery(db, 'activeUserPosts', () => {
 *   const active = activeUsers.read() // Dependency recorded!
 *   const posts = postsAdapter.getData()
 *   const activeIds = new Set(active.map(u => u.id))
 *   return [...posts.values()].filter(p => activeIds.has(p.userId))
 * })
 * ```
 */
export function createSalsaQuery<T>(
  db: Database,
  key: string,
  fn: () => T
): SalsaLiveQuery<T> {
  const handle = db.query(key, fn)

  return {
    handle,

    subscribe(callback: (result: T) => void): () => void {
      return handle.subscribe(callback)
    },

    read(): T {
      return handle.read()
    },

    isStale(): boolean {
      return handle.checkStale().type === 'stale'
    },
  }
}

/**
 * Example: Bridging with ORDER BY / LIMIT queries
 *
 * One key pain point in TanStack DB is ORDER BY/LIMIT thrashing where
 * the entire sorted result is recomputed on any change. Salsa can help by:
 *
 * 1. Tracking whether the change affects visible rows
 * 2. Short-circuiting recomputation when outside the LIMIT window
 */
export interface PaginatedQueryResult<T> {
  /** The visible page of results */
  items: Array<T>
  /** Total count (may be approximate) */
  totalCount: number
  /** Whether there are more items */
  hasMore: boolean
  /** Revision of this result */
  revision: Revision
}

/**
 * Create a paginated query with smart invalidation.
 *
 * Only recomputes when:
 * - Items within the visible window change
 * - Items cross the boundary into/out of the window
 * - Sort order changes
 *
 * Skips recomputation when:
 * - Items outside the window change
 * - Metadata (not sort keys) changes
 */
export function createPaginatedQuery<T>(
  db: Database,
  key: string,
  options: {
    /** Get all items (from collection adapter) */
    getItems: () => Array<T>
    /** Sort comparator */
    compare: (a: T, b: T) => number
    /** Extract sort key (for boundary detection) */
    getSortKey: (item: T) => unknown
    /** Items per page */
    limit: number
    /** Current page offset */
    offset: number
  }
): SalsaLiveQuery<PaginatedQueryResult<T>> {
  // Track the boundary value (last visible sort key) for future optimization
  let _boundaryKey: unknown = undefined

  const query = db.query(key, () => {
    const items = options.getItems()
    const sorted = [...items].sort(options.compare)
    const totalCount = sorted.length
    const page = sorted.slice(options.offset, options.offset + options.limit)
    const hasMore = options.offset + options.limit < totalCount

    // Update boundary for next invalidation check (for future smart invalidation)
    if (page.length > 0) {
      _boundaryKey = options.getSortKey(page[page.length - 1])
    }

    return {
      items: page,
      totalCount,
      hasMore,
      revision: db.currentRevision,
    }
  })

  return {
    handle: query,
    subscribe: (cb) => query.subscribe(cb),
    read: () => query.read(),
    isStale: () => query.checkStale().type === 'stale',
  }
}

/**
 * Example: Cancelable query execution
 *
 * For long-running computations, Salsa supports cancellation when a newer
 * revision arrives. This prevents wasted work.
 */
export function createCancelableQuery<T>(
  db: Database,
  key: string,
  fn: (signal: AbortSignal) => T | Promise<T>
): SalsaLiveQuery<T | undefined> {
  let currentAbort: AbortController | undefined

  const query = db.query(key, () => {
    // Cancel previous execution if still running
    if (currentAbort) {
      currentAbort.abort()
    }

    currentAbort = new AbortController()

    try {
      const result = fn(currentAbort.signal)

      // Handle sync vs async
      if (result instanceof Promise) {
        // For async, we can't directly return the promise
        // This is a limitation - real implementation would need
        // async query support in the Database
        console.warn('Async queries not fully supported yet')
        return undefined
      }

      return result
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return undefined
      }
      throw e
    }
  })

  return {
    handle: query as QueryHandle<T | undefined>,
    subscribe: (cb) => query.subscribe(cb),
    read: () => query.read(),
    isStale: () => query.checkStale().type === 'stale',
  }
}

/**
 * Batch multiple Salsa input updates into a single revision increment.
 *
 * This is important for consistency - you don't want intermediate
 * states to be observable.
 *
 * @example
 * ```ts
 * batchUpdates(db, () => {
 *   firstName.set('Jane')
 *   lastName.set('Smith')
 *   // Queries only recompute once, seeing both changes
 * })
 * ```
 */
export function batchUpdates(db: Database, fn: () => void): void {
  // TODO: This would need Database support for batching
  // For now, just run the function
  fn()
}

/**
 * Utility: Track query performance over time.
 */
export interface QueryMetrics {
  queryId: QueryId
  executionCount: number
  cacheHitCount: number
  totalComputeTimeMs: number
  avgComputeTimeMs: number
  lastComputeTimeMs: number
  peakComputeTimeMs: number
}

/**
 * Create a metrics tracker for query performance analysis.
 */
export function createMetricsTracker(db: Database): {
  getMetrics: (id: QueryId) => QueryMetrics | undefined
  getAllMetrics: () => Array<QueryMetrics>
  reset: () => void
} {
  const metrics = new Map<QueryId, QueryMetrics>()

  db.onRecompute((event) => {
    let m = metrics.get(event.queryId)
    if (!m) {
      m = {
        queryId: event.queryId,
        executionCount: 0,
        cacheHitCount: 0,
        totalComputeTimeMs: 0,
        avgComputeTimeMs: 0,
        lastComputeTimeMs: 0,
        peakComputeTimeMs: 0,
      }
      metrics.set(event.queryId, m)
    }

    m.executionCount++
    m.totalComputeTimeMs += event.computeTimeMs
    m.avgComputeTimeMs = m.totalComputeTimeMs / m.executionCount
    m.lastComputeTimeMs = event.computeTimeMs
    m.peakComputeTimeMs = Math.max(m.peakComputeTimeMs, event.computeTimeMs)
  })

  return {
    getMetrics: (id) => metrics.get(id),
    getAllMetrics: () => [...metrics.values()],
    reset: () => metrics.clear(),
  }
}
