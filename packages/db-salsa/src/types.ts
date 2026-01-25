/**
 * Salsa-style Incremental Computation Types
 *
 * This module defines the core abstractions for fine-grained dependency tracking
 * and incremental recomputation, inspired by the Salsa framework used in rust-analyzer.
 *
 * Key concepts:
 * - Revision: A monotonically increasing version number tracking database changes
 * - QueryId: Unique identifier for a memoized computation
 * - Deps: The set of dependencies a query read during execution
 * - MemoEntry: A cached computation result with its revision and dependencies
 */

/**
 * A monotonically increasing revision number.
 * Every mutation to an input increments the global revision.
 * Queries can check if their dependencies are stale by comparing revisions.
 */
export type Revision = number & { readonly __brand: 'Revision' }

/**
 * Create a new revision value.
 */
export function revision(n: number): Revision {
  return n as Revision
}

/**
 * The initial revision (before any mutations).
 */
export const INITIAL_REVISION: Revision = revision(0)

/**
 * Unique identifier for a query or input.
 * Format: "type:key" where type is 'input' or 'query' and key is user-provided.
 */
export type QueryId = string & { readonly __brand: 'QueryId' }

/**
 * Create a query identifier.
 */
export function queryId(type: 'input' | 'query', key: string): QueryId {
  return `${type}:${key}` as QueryId
}

/**
 * Extract the type from a query ID.
 */
export function queryIdType(id: QueryId): 'input' | 'query' {
  return id.split(':')[0] as 'input' | 'query'
}

/**
 * Extract the key from a query ID.
 */
export function queryIdKey(id: QueryId): string {
  return id.slice(id.indexOf(':') + 1)
}

/**
 * Dependency edge in the computation graph.
 * Records that a query read from another query/input at a specific revision.
 */
export interface DepEdge {
  /** The query/input that was read */
  readonly id: QueryId
  /** The revision at which it was read */
  readonly atRevision: Revision
}

/**
 * Set of dependencies for a query execution.
 */
export interface Deps {
  /** All dependencies read during this execution */
  readonly edges: ReadonlyArray<DepEdge>
  /** The maximum revision among all dependencies */
  readonly maxRevision: Revision
}

/**
 * Create an empty dependency set.
 */
export function emptyDeps(): Deps {
  return { edges: [], maxRevision: INITIAL_REVISION }
}

/**
 * Add a dependency to a deps set (immutable).
 */
export function addDep(deps: Deps, edge: DepEdge): Deps {
  return {
    edges: [...deps.edges, edge],
    maxRevision:
      edge.atRevision > deps.maxRevision ? edge.atRevision : deps.maxRevision,
  }
}

/**
 * A memoized computation result.
 *
 * @template T The type of the computed value
 */
export interface MemoEntry<T> {
  /** The computed value */
  readonly value: T
  /** The revision at which this was computed */
  readonly computedAtRevision: Revision
  /** Dependencies read during computation */
  readonly deps: Deps
  /** Wall-clock time taken to compute (for profiling) */
  readonly computeTimeMs: number
  /** Number of times this entry has been reused (cache hits) */
  cacheHits: number
}

/**
 * Create a new memo entry.
 */
export function createMemoEntry<T>(
  value: T,
  computedAtRevision: Revision,
  deps: Deps,
  computeTimeMs: number
): MemoEntry<T> {
  return {
    value,
    computedAtRevision,
    deps,
    computeTimeMs,
    cacheHits: 0,
  }
}

/**
 * Input value with revision tracking.
 *
 * @template T The type of the input value
 */
export interface TrackedInput<T> {
  readonly id: QueryId
  value: T
  revision: Revision
}

/**
 * Status of a query's cached result.
 */
export type CacheStatus =
  | { type: 'fresh' }
  | { type: 'stale'; reason: StaleReason }
  | { type: 'missing' }

/**
 * Reason why a cached result is stale.
 */
export interface StaleReason {
  /** The dependency that changed */
  readonly changedDep: QueryId
  /** The revision the dependency was at when cached */
  readonly cachedAtRevision: Revision
  /** The current revision of the dependency */
  readonly currentRevision: Revision
}

/**
 * Callback for when a query is recomputed.
 * Used for debugging and devtools integration.
 */
export interface RecomputeEvent {
  /** The query that was recomputed */
  readonly queryId: QueryId
  /** Why it was recomputed */
  readonly reason: 'initial' | 'stale' | 'forced'
  /** If stale, which dependency changed */
  readonly staleDep?: QueryId
  /** Time taken to recompute */
  readonly computeTimeMs: number
  /** Dependencies discovered during computation */
  readonly deps: Deps
  /** The current revision after computation */
  readonly revision: Revision
}

/**
 * Listener for recompute events.
 */
export type RecomputeListener = (event: RecomputeEvent) => void

/**
 * Options for query execution.
 */
export interface QueryOptions {
  /** Force recomputation even if cached result is fresh */
  readonly force?: boolean
  /** Abort signal for cancellation */
  readonly signal?: AbortSignal
}

/**
 * A handle to a query result that supports staleness checks.
 *
 * @template T The type of the query result
 */
export interface QueryHandle<T> {
  /** The query identifier */
  readonly id: QueryId
  /** Get the current revision of this query's result */
  currentRev: () => Revision
  /** Read the value if it's up-to-date with the given revision */
  readIfUpToDate: (rev: Revision) => T | undefined
  /** Read the current value (may trigger recomputation) */
  read: (options?: QueryOptions) => T
  /** Subscribe to value changes */
  subscribe: (callback: (value: T) => void) => () => void
  /** Check if the current cached value is stale */
  checkStale: () => CacheStatus
}

/**
 * Debug information about the computation graph.
 */
export interface GraphSnapshot {
  /** All registered queries */
  readonly queries: ReadonlyArray<{
    readonly id: QueryId
    readonly deps: Deps
    readonly revision: Revision
    readonly cacheHits: number
    readonly lastComputeTimeMs: number
  }>
  /** All tracked inputs */
  readonly inputs: ReadonlyArray<{
    readonly id: QueryId
    readonly revision: Revision
  }>
  /** Current global revision */
  readonly currentRevision: Revision
  /** Edges in dependency graph (from -> to) */
  readonly edges: ReadonlyArray<{ from: QueryId; to: QueryId }>
}
