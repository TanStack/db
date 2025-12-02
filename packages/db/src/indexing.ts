/**
 * @tanstack/db/indexing - Optional indexing module
 *
 * This module provides indexing capabilities for TanStack DB.
 * Import from this module to enable indexing features.
 *
 * @example
 * ```ts
 * // Option 1: Enable lightweight indexing (equality lookups only)
 * import { enableIndexing } from '@tanstack/db/indexing'
 * enableIndexing()  // Uses MapIndex - supports eq, in
 *
 * // Option 2: Enable full BTree indexing (for ORDER BY optimization on large collections)
 * import { enableBTreeIndexing } from '@tanstack/db/indexing'
 * enableBTreeIndexing()  // Uses BTreeIndex - supports eq, in, gt, gte, lt, lte + sorted iteration
 *
 * // Option 3: Use explicitly per-index (best for tree-shaking)
 * import { BTreeIndex } from '@tanstack/db/indexing'
 * collection.createIndex((row) => row.userId, { indexType: BTreeIndex })
 * ```
 */

import { registerDefaultIndexType } from "./indexes/index-registry.js"

// MapIndex - lightweight, equality-only (no BTree overhead)
export { MapIndex } from "./indexes/map-index.js"
export type { MapIndexOptions } from "./indexes/map-index.js"

// BTreeIndex - full-featured with sorted iteration (for ORDER BY optimization)
export { BTreeIndex } from "./indexes/btree-index.js"
export type { RangeQueryOptions } from "./indexes/btree-index.js"

// Re-export base index types
export { BaseIndex } from "./indexes/base-index.js"
export type {
  IndexInterface,
  IndexConstructor,
  IndexResolver,
  IndexStats,
  IndexOperation,
} from "./indexes/base-index.js"

// Re-export lazy index utilities
export { LazyIndexWrapper, IndexProxy } from "./indexes/lazy-index.js"

// Re-export reverse index
export { ReverseIndex } from "./indexes/reverse-index.js"

// Re-export index options
export type { IndexOptions } from "./indexes/index-options.js"

// Re-export registry functions
export {
  registerDefaultIndexType,
  getDefaultIndexType,
  isIndexingAvailable,
  configureIndexDevMode,
  getIndexDevModeConfig,
  isDevModeEnabled,
  trackQuery,
  clearQueryPatterns,
  getQueryPatterns,
} from "./indexes/index-registry.js"
export type {
  IndexDevModeConfig,
  IndexSuggestion,
} from "./indexes/index-registry.js"

// Re-export index optimization utilities
export {
  optimizeExpressionWithIndexes,
  findIndexForField,
} from "./utils/index-optimization.js"

/**
 * Enable lightweight indexing using MapIndex.
 * Supports equality lookups (eq, in) with minimal bundle size.
 * Call this once at app startup to enable auto-indexing.
 *
 * For ORDER BY optimization on large collections (10k+ items),
 * use `enableBTreeIndexing()` instead.
 *
 * @example
 * ```ts
 * import { enableIndexing } from '@tanstack/db/indexing'
 * enableIndexing()
 * ```
 */
export function enableIndexing(): void {
  // Lazy import to allow tree-shaking if user only uses BTreeIndex
  const { MapIndex } = require(`./indexes/map-index.js`)
  registerDefaultIndexType(MapIndex)
}

/**
 * Enable full BTree indexing for ORDER BY optimization.
 * Supports all operations (eq, in, gt, gte, lt, lte) plus sorted iteration.
 * Only needed when you have large collections (10k+ items) and use ORDER BY with LIMIT.
 *
 * For smaller collections or equality-only queries, use `enableIndexing()` instead.
 *
 * @example
 * ```ts
 * import { enableBTreeIndexing } from '@tanstack/db/indexing'
 * enableBTreeIndexing()
 * ```
 */
export function enableBTreeIndexing(): void {
  // Lazy import to allow tree-shaking if user only uses MapIndex
  const { BTreeIndex } = require(`./indexes/btree-index.js`)
  registerDefaultIndexType(BTreeIndex)
}
