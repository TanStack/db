/**
 * @tanstack/db/indexing - Optional indexing module
 *
 * This module provides indexing capabilities for TanStack DB.
 * Import from this module to enable indexing features.
 *
 * @example
 * ```ts
 * // Option 1: Register globally for auto-indexing support
 * import { registerDefaultIndexType, BTreeIndex } from '@tanstack/db/indexing'
 * registerDefaultIndexType(BTreeIndex)
 *
 * // Option 2: Use explicitly per-index (best for tree-shaking)
 * import { BTreeIndex } from '@tanstack/db/indexing'
 * collection.createIndex((row) => row.userId, { indexType: BTreeIndex })
 * ```
 */

// Re-export BTreeIndex and related utilities
// Convenience function to enable indexing with one call
import { BTreeIndex } from "./indexes/btree-index.js"
import { registerDefaultIndexType } from "./indexes/index-registry.js"

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
 * Enable indexing by registering BTreeIndex as the default.
 * Call this once at app startup to enable auto-indexing.
 *
 * @example
 * ```ts
 * import { enableIndexing } from '@tanstack/db/indexing'
 * enableIndexing()
 * ```
 */
export function enableIndexing(): void {
  registerDefaultIndexType(BTreeIndex)
}
