/**
 * Salsa-style Database
 *
 * The Database is the central coordinator for incremental computation.
 * It manages:
 * - Tracked inputs (base data that can change)
 * - Memoized queries (derived computations)
 * - Revision tracking (for invalidation)
 * - Dependency graph (for selective recomputation)
 *
 * Design follows Salsa's model:
 * - Inputs are the only things that can be mutated
 * - Queries are pure functions of inputs and other queries
 * - Changing an input increments the revision and invalidates dependents
 * - Queries are recomputed lazily on next read
 */

import {
  
  
  
  INITIAL_REVISION,
  
  
  
  
  
  
  
  
  createMemoEntry,
  queryId,
  revision
} from './types.js'
import {
  getQueryCallStack,
  recordDependency,
  withContext,
  wouldCycle,
} from './context.js'
import type {CacheStatus, Deps, GraphSnapshot, MemoEntry, QueryHandle, QueryId, QueryOptions, RecomputeEvent, RecomputeListener, Revision, TrackedInput} from './types.js';


/**
 * Configuration for the Salsa database.
 */
export interface DatabaseConfig {
  /** Enable debug logging */
  debug?: boolean
  /** Maximum number of memo entries to keep (LRU eviction) */
  maxMemoEntries?: number
}

/**
 * A query function that computes a value.
 */
export type QueryFn<T> = () => T

/**
 * Definition of a memoized query.
 */
interface QueryDefinition<T> {
  readonly id: QueryId
  readonly fn: QueryFn<T>
  memo: MemoEntry<T> | undefined
  subscribers: Set<(value: T) => void>
}

/**
 * The Salsa-style incremental computation database.
 */
export class Database {
  /** Current global revision */
  #revision: Revision = INITIAL_REVISION

  /** All tracked inputs */
  readonly #inputs = new Map<QueryId, TrackedInput<unknown>>()

  /** All registered queries */
  readonly #queries = new Map<QueryId, QueryDefinition<unknown>>()

  /** Reverse dependency index: input/query -> queries that depend on it */
  readonly #dependents = new Map<QueryId, Set<QueryId>>()

  /** Recompute event listeners */
  readonly #listeners = new Set<RecomputeListener>()

  /** Configuration */
  readonly #config: DatabaseConfig

  constructor(config: DatabaseConfig = {}) {
    this.#config = config
  }

  /**
   * Get the current global revision.
   */
  get currentRevision(): Revision {
    return this.#revision
  }

  /**
   * Increment the revision and return the new value.
   */
  #nextRevision(): Revision {
    this.#revision = revision(this.#revision + 1)
    return this.#revision
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Inputs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a tracked input.
   *
   * @param key Unique key for this input
   * @param initialValue Initial value
   * @returns A handle to read and mutate the input
   */
  input<T>(key: string, initialValue: T): InputHandle<T> {
    const id = queryId('input', key)

    if (this.#inputs.has(id)) {
      throw new Error(`Input "${key}" already exists`)
    }

    const input: TrackedInput<T> = {
      id,
      value: initialValue,
      revision: this.#revision,
    }

    this.#inputs.set(id, input as TrackedInput<unknown>)

    return new InputHandle(this, id)
  }

  /**
   * Get an input's current value and revision.
   * Records a dependency if called within a query context.
   */
  getInput<T>(id: QueryId): { value: T; revision: Revision } {
    const input = this.#inputs.get(id) as TrackedInput<T> | undefined
    if (!input) {
      throw new Error(`Input "${id}" not found`)
    }

    // Record dependency in current execution context
    recordDependency(id, input.revision)

    return { value: input.value, revision: input.revision }
  }

  /**
   * Set an input's value. Increments the global revision if the value changed.
   */
  setInput<T>(id: QueryId, value: T): void {
    const input = this.#inputs.get(id) as TrackedInput<T> | undefined
    if (!input) {
      throw new Error(`Input "${id}" not found`)
    }

    // Only update if value actually changed
    if (!Object.is(input.value, value)) {
      const newRev = this.#nextRevision()
      input.value = value
      input.revision = newRev

      // Mark all dependent queries as potentially stale
      this.#invalidateDependents(id)

      if (this.#config.debug) {
        console.log(`[salsa] Input "${id}" changed to revision ${newRev}`)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Queries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a memoized query.
   *
   * @param key Unique key for this query
   * @param fn The computation function
   * @returns A handle to read the query result
   */
  query<T>(key: string, fn: QueryFn<T>): QueryHandle<T> {
    const id = queryId('query', key)

    if (this.#queries.has(id)) {
      throw new Error(`Query "${key}" already exists`)
    }

    const definition: QueryDefinition<T> = {
      id,
      fn,
      memo: undefined,
      subscribers: new Set(),
    }

    this.#queries.set(id, definition as QueryDefinition<unknown>)

    return new QueryHandleImpl(this, id)
  }

  /**
   * Execute a query, using memoization when possible.
   */
  executeQuery<T>(id: QueryId, options: QueryOptions = {}): T {
    const definition = this.#queries.get(id) as QueryDefinition<T> | undefined
    if (!definition) {
      throw new Error(`Query "${id}" not found`)
    }

    // Check for cycles
    if (wouldCycle(id)) {
      const stack = getQueryCallStack()
      throw new Error(
        `Cycle detected in query "${id}". Call stack: ${stack.join(' -> ')}`
      )
    }

    // Check if we can use cached result
    const hadMemo = !!definition.memo
    let staleDepId: QueryId | undefined

    if (!options.force && definition.memo) {
      const status = this.#checkMemoStatus(definition.memo)
      if (status.type === 'fresh') {
        definition.memo.cacheHits++
        if (this.#config.debug) {
          console.log(`[salsa] Cache hit for "${id}"`)
        }
        // Record dependency in parent context (if any)
        recordDependency(id, definition.memo.computedAtRevision)
        return definition.memo.value
      }

      if (status.type === 'stale') {
        staleDepId = status.reason.changedDep
        if (this.#config.debug) {
          console.log(
            `[salsa] Cache stale for "${id}" due to "${status.reason.changedDep}"`
          )
        }
      }
    }

    // Execute the query in a tracked context
    const { result, context } = withContext(id, () => definition.fn())
    const computeTimeMs = performance.now() - context.startTime

    // Store the result
    const deps = context.deps
    definition.memo = createMemoEntry(result, this.#revision, deps, computeTimeMs)

    // Update reverse dependency index
    this.#updateDependents(id, deps)

    // Record dependency in parent context (if any)
    recordDependency(id, this.#revision)

    // Determine reason for recomputation
    const reason = options.force ? 'forced' : hadMemo ? 'stale' : 'initial'

    // Emit recompute event
    this.#emitRecomputeEvent({
      queryId: id,
      reason,
      staleDep: staleDepId,
      computeTimeMs,
      deps,
      revision: this.#revision,
    })

    // Notify subscribers
    for (const callback of definition.subscribers) {
      callback(result)
    }

    return result
  }

  /**
   * Get a query's current revision (if memoized).
   */
  getQueryRevision(id: QueryId): Revision | undefined {
    const definition = this.#queries.get(id)
    return definition?.memo?.computedAtRevision
  }

  /**
   * Read a query's value if it's still up-to-date with the given revision.
   * Returns undefined if the query needs recomputation.
   */
  readQueryIfUpToDate<T>(id: QueryId, rev: Revision): T | undefined {
    const definition = this.#queries.get(id) as QueryDefinition<T> | undefined
    if (!definition?.memo) {
      return undefined
    }

    const status = this.#checkMemoStatus(definition.memo)
    if (status.type === 'fresh' && definition.memo.computedAtRevision >= rev) {
      definition.memo.cacheHits++
      return definition.memo.value
    }

    return undefined
  }

  /**
   * Check the cache status of a query.
   */
  checkQueryCacheStatus(id: QueryId): CacheStatus {
    const definition = this.#queries.get(id)
    if (!definition?.memo) {
      return { type: 'missing' }
    }
    return this.#checkMemoStatus(definition.memo)
  }

  /**
   * Subscribe to query value changes.
   */
  subscribeToQuery<T>(id: QueryId, callback: (value: T) => void): () => void {
    const definition = this.#queries.get(id) as QueryDefinition<T> | undefined
    if (!definition) {
      throw new Error(`Query "${id}" not found`)
    }

    definition.subscribers.add(callback)

    return () => {
      definition.subscribers.delete(callback)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Invalidation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if a memoized result is still fresh.
   * For query dependencies, recursively verifies their freshness.
   */
  #checkMemoStatus(
    memo: MemoEntry<unknown>,
    visited: Set<QueryId> = new Set()
  ): CacheStatus {
    // Check each dependency
    for (const edge of memo.deps.edges) {
      // Check if it's an input
      const input = this.#inputs.get(edge.id)
      if (input) {
        if (input.revision > edge.atRevision) {
          return {
            type: 'stale',
            reason: {
              changedDep: edge.id,
              cachedAtRevision: edge.atRevision,
              currentRevision: input.revision,
            },
          }
        }
        continue
      }

      // It's a query dependency - recursively check if it's fresh
      const queryDep = this.#queries.get(edge.id)
      if (!queryDep) {
        // Query was removed? Consider stale
        return {
          type: 'stale',
          reason: {
            changedDep: edge.id,
            cachedAtRevision: edge.atRevision,
            currentRevision: revision(-1),
          },
        }
      }

      // Prevent infinite recursion
      if (visited.has(edge.id)) {
        continue
      }
      visited.add(edge.id)

      // If query dependency has no memo, we need to recompute
      if (!queryDep.memo) {
        return {
          type: 'stale',
          reason: {
            changedDep: edge.id,
            cachedAtRevision: edge.atRevision,
            currentRevision: revision(-1),
          },
        }
      }

      // Recursively check if the query dependency is fresh
      const depStatus = this.#checkMemoStatus(queryDep.memo, visited)
      if (depStatus.type === 'stale') {
        // Our dependency is stale, so we're stale too
        return {
          type: 'stale',
          reason: {
            changedDep: edge.id,
            cachedAtRevision: edge.atRevision,
            currentRevision: queryDep.memo.computedAtRevision,
          },
        }
      }

      // Query dependency is fresh, check if its revision changed since we cached
      if (queryDep.memo.computedAtRevision > edge.atRevision) {
        return {
          type: 'stale',
          reason: {
            changedDep: edge.id,
            cachedAtRevision: edge.atRevision,
            currentRevision: queryDep.memo.computedAtRevision,
          },
        }
      }
    }

    return { type: 'fresh' }
  }

  /**
   * Mark all queries that depend on the given input/query as potentially stale.
   */
  #invalidateDependents(id: QueryId): void {
    const dependents = this.#dependents.get(id)
    if (!dependents) return

    for (const dependentId of dependents) {
      const query = this.#queries.get(dependentId)
      if (query?.memo) {
        // The query's memo is now potentially stale
        // (we don't delete it - let the check happen on next read)
        if (this.#config.debug) {
          console.log(`[salsa] Query "${dependentId}" invalidated due to "${id}"`)
        }
      }

      // Recursively invalidate dependents of dependents
      this.#invalidateDependents(dependentId)
    }
  }

  /**
   * Update the reverse dependency index for a query.
   */
  #updateDependents(qId: QueryId, deps: Deps): void {
    // Remove old reverse deps
    for (const [, dependents] of this.#dependents) {
      dependents.delete(qId)
    }

    // Add new reverse deps
    for (const edge of deps.edges) {
      let dependents = this.#dependents.get(edge.id)
      if (!dependents) {
        dependents = new Set()
        this.#dependents.set(edge.id, dependents)
      }
      dependents.add(qId)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Debug / Devtools
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a listener for recompute events.
   */
  onRecompute(listener: RecomputeListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Emit a recompute event to all listeners.
   */
  #emitRecomputeEvent(event: RecomputeEvent): void {
    for (const listener of this.#listeners) {
      listener(event)
    }
  }

  /**
   * Get a snapshot of the current dependency graph.
   * Useful for devtools visualization.
   */
  getGraphSnapshot(): GraphSnapshot {
    const queries: GraphSnapshot['queries'] = []
    const inputs: GraphSnapshot['inputs'] = []
    const edges: GraphSnapshot['edges'] = []

    for (const [id, input] of this.#inputs) {
      inputs.push({
        id,
        revision: input.revision,
      })
    }

    for (const [id, query] of this.#queries) {
      if (query.memo) {
        queries.push({
          id,
          deps: query.memo.deps,
          revision: query.memo.computedAtRevision,
          cacheHits: query.memo.cacheHits,
          lastComputeTimeMs: query.memo.computeTimeMs,
        })

        for (const edge of query.memo.deps.edges) {
          edges.push({ from: id, to: edge.id })
        }
      }
    }

    return {
      queries,
      inputs,
      currentRevision: this.#revision,
      edges,
    }
  }

  /**
   * Force recomputation of all queries (for testing/debugging).
   */
  recomputeAll(): void {
    for (const id of this.#queries.keys()) {
      this.executeQuery(id, { force: true })
    }
  }

  /**
   * Clear all memoized results (for testing/debugging).
   */
  clearMemos(): void {
    for (const query of this.#queries.values()) {
      query.memo = undefined
    }
  }
}

/**
 * Handle for reading and mutating a tracked input.
 */
export class InputHandle<T> {
  readonly #db: Database
  readonly #id: QueryId

  constructor(db: Database, id: QueryId) {
    this.#db = db
    this.#id = id
  }

  get id(): QueryId {
    return this.#id
  }

  /**
   * Read the input's current value.
   * Records a dependency if called within a query context.
   */
  get(): T {
    return this.#db.getInput<T>(this.#id).value
  }

  /**
   * Set the input's value.
   */
  set(value: T): void {
    this.#db.setInput(this.#id, value)
  }

  /**
   * Get the input's current revision.
   */
  revision(): Revision {
    return this.#db.getInput<T>(this.#id).revision
  }
}

/**
 * Implementation of QueryHandle.
 */
class QueryHandleImpl<T> implements QueryHandle<T> {
  readonly #db: Database
  readonly #id: QueryId

  constructor(db: Database, id: QueryId) {
    this.#db = db
    this.#id = id
  }

  get id(): QueryId {
    return this.#id
  }

  currentRev(): Revision {
    return this.#db.getQueryRevision(this.#id) ?? INITIAL_REVISION
  }

  readIfUpToDate(rev: Revision): T | undefined {
    return this.#db.readQueryIfUpToDate<T>(this.#id, rev)
  }

  read(options?: QueryOptions): T {
    return this.#db.executeQuery<T>(this.#id, options)
  }

  subscribe(callback: (value: T) => void): () => void {
    return this.#db.subscribeToQuery<T>(this.#id, callback)
  }

  checkStale(): CacheStatus {
    return this.#db.checkQueryCacheStatus(this.#id)
  }
}
