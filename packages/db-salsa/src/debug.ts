/**
 * Debug and Devtools Integration
 *
 * This module provides tools for debugging and visualizing the incremental
 * computation graph. Key features:
 *
 * - "Why did this query re-run?" explanations
 * - Dependency graph visualization (DOT/Graphviz format)
 * - Performance profiling and cache hit statistics
 * - Live graph inspection hooks for devtools
 */

import type {
  Deps,
  GraphSnapshot,
  QueryId,
  RecomputeEvent,
  Revision,
} from './types.js'
import type { Database } from './database.js'

/**
 * Explanation of why a query was recomputed.
 */
export interface RecomputeExplanation {
  /** The query that was recomputed */
  queryId: QueryId
  /** High-level reason */
  reason: 'initial' | 'dependency_changed' | 'forced'
  /** Human-readable explanation */
  explanation: string
  /** If dependency changed, the chain of changes */
  changeChain?: Array<{
    depId: QueryId
    oldRevision: Revision
    newRevision: Revision
  }>
  /** Time spent recomputing */
  computeTimeMs: number
}

/**
 * Performance statistics for the database.
 */
export interface PerformanceStats {
  /** Total number of queries */
  totalQueries: number
  /** Number of queries with cached results */
  cachedQueries: number
  /** Total cache hits across all queries */
  totalCacheHits: number
  /** Total time spent computing (sum of all recomputes) */
  totalComputeTimeMs: number
  /** Average compute time per query */
  avgComputeTimeMs: number
  /** Cache hit rate (0-1) */
  cacheHitRate: number
  /** Queries sorted by compute time (slowest first) */
  slowestQueries: Array<{
    id: QueryId
    computeTimeMs: number
    cacheHits: number
  }>
}

/**
 * Convert a recompute event to a human-readable explanation.
 */
export function explainRecompute(event: RecomputeEvent): RecomputeExplanation {
  let explanation: string
  let changeChain: RecomputeExplanation['changeChain']

  switch (event.reason) {
    case 'initial':
      explanation = `Query "${event.queryId}" was computed for the first time.`
      break
    case 'forced':
      explanation = `Query "${event.queryId}" was forcefully recomputed.`
      break
    case 'stale':
      explanation = event.staleDep
        ? `Query "${event.queryId}" was recomputed because dependency "${event.staleDep}" changed.`
        : `Query "${event.queryId}" was recomputed because one or more dependencies changed.`
      break
  }

  return {
    queryId: event.queryId,
    reason:
      event.reason === 'stale'
        ? 'dependency_changed'
        : event.reason === 'initial'
          ? 'initial'
          : 'forced',
    explanation,
    changeChain,
    computeTimeMs: event.computeTimeMs,
  }
}

/**
 * Generate a DOT (Graphviz) representation of the dependency graph.
 *
 * @param snapshot The graph snapshot to visualize
 * @param options Visualization options
 * @returns DOT format string
 */
export function toDot(
  snapshot: GraphSnapshot,
  options: {
    /** Highlight stale queries in red */
    highlightStale?: boolean
    /** Show revision numbers on nodes */
    showRevisions?: boolean
    /** Show compute times on query nodes */
    showComputeTimes?: boolean
  } = {}
): string {
  const lines: Array<string> = ['digraph SalsaGraph {']
  lines.push('  rankdir=BT;') // Bottom to top (inputs at bottom)
  lines.push('  node [shape=box];')
  lines.push('')

  // Subgraph for inputs
  lines.push('  subgraph cluster_inputs {')
  lines.push('    label="Inputs";')
  lines.push('    style=filled;')
  lines.push('    color=lightgrey;')
  for (const input of snapshot.inputs) {
    const label = options.showRevisions
      ? `${input.id}\\n(rev: ${input.revision})`
      : input.id
    lines.push(`    "${input.id}" [label="${label}", shape=ellipse];`)
  }
  lines.push('  }')
  lines.push('')

  // Subgraph for queries
  lines.push('  subgraph cluster_queries {')
  lines.push('    label="Queries";')
  for (const query of snapshot.queries) {
    let label = query.id
    if (options.showRevisions) {
      label += `\\n(rev: ${query.revision})`
    }
    if (options.showComputeTimes) {
      label += `\\n${query.lastComputeTimeMs.toFixed(2)}ms`
    }
    label += `\\nhits: ${query.cacheHits}`
    lines.push(`    "${query.id}" [label="${label}"];`)
  }
  lines.push('  }')
  lines.push('')

  // Edges
  for (const edge of snapshot.edges) {
    lines.push(`  "${edge.from}" -> "${edge.to}";`)
  }

  lines.push('}')
  return lines.join('\n')
}

/**
 * Calculate performance statistics from a graph snapshot.
 */
export function getPerformanceStats(snapshot: GraphSnapshot): PerformanceStats {
  const totalQueries = snapshot.queries.length
  const cachedQueries = snapshot.queries.filter((q) => q.cacheHits > 0).length
  const totalCacheHits = snapshot.queries.reduce((sum, q) => sum + q.cacheHits, 0)
  const totalComputeTimeMs = snapshot.queries.reduce(
    (sum, q) => sum + q.lastComputeTimeMs,
    0
  )
  const avgComputeTimeMs = totalQueries > 0 ? totalComputeTimeMs / totalQueries : 0
  const totalExecutions = totalCacheHits + totalQueries
  const cacheHitRate = totalExecutions > 0 ? totalCacheHits / totalExecutions : 0

  const slowestQueries = [...snapshot.queries]
    .sort((a, b) => b.lastComputeTimeMs - a.lastComputeTimeMs)
    .slice(0, 10)
    .map((q) => ({
      id: q.id,
      computeTimeMs: q.lastComputeTimeMs,
      cacheHits: q.cacheHits,
    }))

  return {
    totalQueries,
    cachedQueries,
    totalCacheHits,
    totalComputeTimeMs,
    avgComputeTimeMs,
    cacheHitRate,
    slowestQueries,
  }
}

/**
 * Create a debug logger that tracks all recompute events.
 */
export function createDebugLogger(db: Database): {
  events: Array<RecomputeEvent>
  explanations: Array<RecomputeExplanation>
  unsubscribe: () => void
  clear: () => void
  getStats: () => PerformanceStats
} {
  const events: Array<RecomputeEvent> = []
  const explanations: Array<RecomputeExplanation> = []

  const unsubscribe = db.onRecompute((event) => {
    events.push(event)
    explanations.push(explainRecompute(event))
  })

  return {
    events,
    explanations,
    unsubscribe,
    clear: () => {
      events.length = 0
      explanations.length = 0
    },
    getStats: () => getPerformanceStats(db.getGraphSnapshot()),
  }
}

/**
 * Format a dependency chain for logging.
 */
export function formatDeps(deps: Deps): string {
  if (deps.edges.length === 0) {
    return '(no dependencies)'
  }

  return deps.edges.map((e) => `${e.id}@${e.atRevision}`).join(' -> ')
}

/**
 * Console-friendly table of query stats.
 */
export function printQueryStats(snapshot: GraphSnapshot): void {
  console.table(
    snapshot.queries.map((q) => ({
      Query: q.id,
      Revision: q.revision,
      'Cache Hits': q.cacheHits,
      'Compute Time (ms)': q.lastComputeTimeMs.toFixed(2),
      Dependencies: q.deps.edges.length,
    }))
  )
}

/**
 * Find the root cause of a recomputation by tracing dependencies.
 */
export function traceRecomputeRoot(
  db: Database,
  queryId: QueryId
): Array<{ queryId: QueryId; reason: string }> {
  const snapshot = db.getGraphSnapshot()
  const trace: Array<{ queryId: QueryId; reason: string }> = []
  const visited = new Set<QueryId>()

  function visit(id: QueryId): void {
    if (visited.has(id)) return
    visited.add(id)

    // Check if it's an input
    const input = snapshot.inputs.find((i) => i.id === id)
    if (input) {
      trace.push({ queryId: id, reason: `Input changed at revision ${input.revision}` })
      return
    }

    // Find query
    const query = snapshot.queries.find((q) => q.id === id)
    if (!query) return

    // Check each dependency
    for (const edge of query.deps.edges) {
      const depInput = snapshot.inputs.find((i) => i.id === edge.id)
      if (depInput && depInput.revision > edge.atRevision) {
        trace.push({
          queryId: id,
          reason: `Dependency "${edge.id}" changed from rev ${edge.atRevision} to ${depInput.revision}`,
        })
        visit(edge.id)
      }

      const depQuery = snapshot.queries.find((q) => q.id === edge.id)
      if (depQuery && depQuery.revision > edge.atRevision) {
        trace.push({
          queryId: id,
          reason: `Dependency "${edge.id}" changed from rev ${edge.atRevision} to ${depQuery.revision}`,
        })
        visit(edge.id)
      }
    }
  }

  visit(queryId)
  return trace
}

/**
 * Devtools hook interface for browser devtools integration.
 */
export interface DevtoolsHook {
  /** Get current graph state */
  getGraph: () => GraphSnapshot
  /** Get performance stats */
  getStats: () => PerformanceStats
  /** Subscribe to graph updates */
  subscribe: (callback: () => void) => () => void
  /** Force recompute a specific query */
  recompute: (queryId: QueryId) => void
  /** Get explanation for last recompute */
  getLastRecomputeExplanation: (queryId: QueryId) => RecomputeExplanation | undefined
}

/**
 * Create a devtools hook for browser integration.
 */
export function createDevtoolsHook(db: Database): DevtoolsHook {
  const subscribers = new Set<() => void>()
  const lastExplanations = new Map<QueryId, RecomputeExplanation>()

  db.onRecompute((event) => {
    lastExplanations.set(event.queryId, explainRecompute(event))
    for (const callback of subscribers) {
      callback()
    }
  })

  return {
    getGraph: () => db.getGraphSnapshot(),
    getStats: () => getPerformanceStats(db.getGraphSnapshot()),
    subscribe: (callback) => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    recompute: (queryId) => {
      db.executeQuery(queryId, { force: true })
    },
    getLastRecomputeExplanation: (queryId) => lastExplanations.get(queryId),
  }
}

/**
 * Install devtools hook on window (for browser environments).
 */
export function installDevtools(db: Database, name = '__TANSTACK_SALSA__'): void {
  if (typeof window !== 'undefined') {
    ;(window as Record<string, unknown>)[name] = createDevtoolsHook(db)
  }
}
