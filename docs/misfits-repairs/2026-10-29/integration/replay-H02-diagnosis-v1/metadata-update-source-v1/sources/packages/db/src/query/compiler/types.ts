import type { QueryIR } from '../ir.js'
import type { CompilationResult } from './index.js'

/**
 * Cache for compiled subqueries to avoid duplicate compilation
 */
export type QueryCache = WeakMap<QueryIR, CompilationResult>

/**
 * Lineage from optimized queries back to their user-defined queries.
 *
 * When optimization only copies a query, its user-defined identity remains a
 * valid cache key. When optimization changes the query, compilation must use
 * the optimized IR so pushed predicates are not lost.
 */
export type QueryMapping = WeakMap<QueryIR, QueryIR>

export type WindowOptions = {
  offset?: number
  limit?: number
}
