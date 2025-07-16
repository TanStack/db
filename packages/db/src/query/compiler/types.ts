import type { QueryIR } from "../ir.js"
import type { ResultStream } from "../../types.js"

/**
 * Cache for compiled subqueries to avoid duplicate compilation
 */
export type QueryCache = WeakMap<QueryIR, ResultStream>

/**
 * Mapping from optimized queries back to their original queries for caching
 */
export type QueryMapping = WeakMap<QueryIR, QueryIR>
