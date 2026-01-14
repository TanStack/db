/**
 * @tanstack/db/indexing - Optional indexing module
 *
 * This module provides indexing capabilities for TanStack DB.
 * Import from this module to enable indexing features.
 *
 * @example
 * ```ts
 * import { BasicIndex } from '@tanstack/db/indexing'
 *
 * // Option 1: Set default index type on collection (for auto-indexing)
 * const collection = createCollection({
 *   defaultIndexType: BasicIndex,
 *   autoIndex: 'eager',
 *   // ...
 * })
 *
 * // Option 2: Create explicit indexes (best for tree-shaking)
 * collection.createIndex((row) => row.userId, { indexType: BasicIndex })
 *
 * // Option 3: Use BTreeIndex for ORDER BY optimization on large collections (10k+)
 * import { BTreeIndex } from '@tanstack/db/indexing'
 * collection.createIndex((row) => row.createdAt, { indexType: BTreeIndex })
 * ```
 */

// BasicIndex - Map + sorted Array, good balance of features and size
export { ReadOptimizedIndex as BasicIndex } from './indexes/read-optimized-index.js'
export type {
  ReadOptimizedIndexOptions as BasicIndexOptions,
  RangeQueryOptions,
} from './indexes/read-optimized-index.js'

// BTreeIndex - full-featured with efficient sorted iteration (for ORDER BY optimization)
export { WriteOptimizedIndex as BTreeIndex } from './indexes/write-optimized-index.js'
export type { RangeQueryOptions as BTreeRangeQueryOptions } from './indexes/write-optimized-index.js'

// Re-export base index types
export { BaseIndex } from './indexes/base-index.js'
export type {
  IndexInterface,
  IndexConstructor,
  IndexStats,
  IndexOperation,
} from './indexes/base-index.js'

// Re-export reverse index
export { ReverseIndex } from './indexes/reverse-index.js'

// Re-export index options
export type { IndexOptions } from './indexes/index-options.js'

// Re-export dev mode utilities
export {
  configureIndexDevMode,
  getIndexDevModeConfig,
  isDevModeEnabled,
  trackQuery,
  clearQueryPatterns,
  getQueryPatterns,
} from './indexes/index-registry.js'
export type {
  IndexDevModeConfig,
  IndexSuggestion,
} from './indexes/index-registry.js'

// Re-export index optimization utilities
export {
  optimizeExpressionWithIndexes,
  findIndexForField,
} from './utils/index-optimization.js'
