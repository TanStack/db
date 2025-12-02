/**
 * Index Registry - Allows optional and custom indexing
 *
 * This module provides a way to register index types at runtime,
 * enabling:
 * - Tree-shaking of BTree implementation when indexing isn't used
 * - MapIndex for lightweight equality lookups (eq, in)
 * - BTreeIndex for full-featured indexing with sorted iteration
 * - Custom index implementations (register your own index type)
 * - Per-collection or global index configuration
 *
 * Dev mode suggestions are ON by default in non-production builds
 * to help developers identify when indexes would improve performance.
 */

import type { IndexConstructor } from "./base-index"

// Global registry for default index type
let defaultIndexType: IndexConstructor<any> | null = null

// Dev mode detection settings - ON by default in non-production
let devModeConfig: IndexDevModeConfig = {
  enabled: true,
  collectionSizeThreshold: 1000,
  slowQueryThresholdMs: 10,
  onSuggestion: null,
}

export interface IndexDevModeConfig {
  /** Enable dev mode index suggestions */
  enabled: boolean
  /** Suggest indexes when collection has more than this many items */
  collectionSizeThreshold: number
  /** Suggest indexes when queries take longer than this (ms) */
  slowQueryThresholdMs: number
  /** Custom handler for index suggestions */
  onSuggestion: ((suggestion: IndexSuggestion) => void) | null
}

export interface IndexSuggestion {
  type: `collection-size` | `slow-query` | `frequent-field`
  collectionId: string
  fieldPath: Array<string>
  message: string
  collectionSize?: number
  queryTimeMs?: number
  queryCount?: number
}

// Track query patterns for dev mode
const queryPatterns = new Map<
  string,
  {
    fieldPath: Array<string>
    queryCount: number
    totalTimeMs: number
    avgTimeMs: number
  }
>()

/**
 * Register a default index type to be used when no explicit type is provided.
 * This allows BTreeIndex to be tree-shaken when not used.
 *
 * @example
 * ```ts
 * import { registerDefaultIndexType, BTreeIndex } from '@tanstack/db/indexing'
 * registerDefaultIndexType(BTreeIndex)
 * ```
 */
export function registerDefaultIndexType(
  indexType: IndexConstructor<any>
): void {
  defaultIndexType = indexType
}

/**
 * Get the registered default index type, or null if none registered.
 */
export function getDefaultIndexType(): IndexConstructor<any> | null {
  return defaultIndexType
}

/**
 * Check if indexing is available (a default index type has been registered)
 */
export function isIndexingAvailable(): boolean {
  return defaultIndexType !== null
}

/**
 * Configure dev mode for index suggestions
 */
export function configureIndexDevMode(
  config: Partial<IndexDevModeConfig>
): void {
  devModeConfig = { ...devModeConfig, ...config }
}

/**
 * Get current dev mode configuration
 */
export function getIndexDevModeConfig(): IndexDevModeConfig {
  return devModeConfig
}

/**
 * Check if dev mode is enabled
 */
export function isDevModeEnabled(): boolean {
  return devModeConfig.enabled && process.env.NODE_ENV !== `production`
}

/**
 * Emit an index suggestion (dev mode only)
 */
export function emitIndexSuggestion(suggestion: IndexSuggestion): void {
  if (!isDevModeEnabled()) return

  if (devModeConfig.onSuggestion) {
    devModeConfig.onSuggestion(suggestion)
  } else {
    // Default: log to console with helpful formatting
    const indexTypeHint = defaultIndexType
      ? ``
      : `\n  First, enable indexing: import { enableIndexing } from '@tanstack/db/indexing'; enableIndexing()`
    console.warn(
      `[TanStack DB] Index suggestion for "${suggestion.collectionId}":\n` +
        `  ${suggestion.message}\n` +
        `  Field: ${suggestion.fieldPath.join(`.`)}` +
        indexTypeHint +
        `\n  Add index: collection.createIndex((row) => row.${suggestion.fieldPath.join(`.`)})`
    )
  }
}

/**
 * Track a query for dev mode analysis
 */
export function trackQuery(
  collectionId: string,
  fieldPath: Array<string>,
  executionTimeMs: number
): void {
  if (!isDevModeEnabled()) return

  const key = `${collectionId}:${fieldPath.join(`.`)}`
  const existing = queryPatterns.get(key)

  if (existing) {
    existing.queryCount++
    existing.totalTimeMs += executionTimeMs
    existing.avgTimeMs = existing.totalTimeMs / existing.queryCount
  } else {
    queryPatterns.set(key, {
      fieldPath,
      queryCount: 1,
      totalTimeMs: executionTimeMs,
      avgTimeMs: executionTimeMs,
    })
  }

  // Check if we should suggest an index
  const pattern = queryPatterns.get(key)!
  if (pattern.avgTimeMs > devModeConfig.slowQueryThresholdMs) {
    emitIndexSuggestion({
      type: `slow-query`,
      collectionId,
      fieldPath,
      message: `Queries on "${fieldPath.join(`.`)}" are slow (avg ${pattern.avgTimeMs.toFixed(1)}ms). Consider adding an index.`,
      queryTimeMs: pattern.avgTimeMs,
      queryCount: pattern.queryCount,
    })
  }
}

/**
 * Check collection size and suggest index if needed (dev mode)
 */
export function checkCollectionSizeForIndex(
  collectionId: string,
  collectionSize: number,
  fieldPath: Array<string>
): void {
  if (!isDevModeEnabled()) return

  if (collectionSize > devModeConfig.collectionSizeThreshold) {
    emitIndexSuggestion({
      type: `collection-size`,
      collectionId,
      fieldPath,
      message: `Collection has ${collectionSize} items. Queries on "${fieldPath.join(`.`)}" may benefit from an index.`,
      collectionSize,
    })
  }
}

/**
 * Clear query pattern tracking (useful for tests)
 */
export function clearQueryPatterns(): void {
  queryPatterns.clear()
}

/**
 * Get query patterns (useful for debugging/testing)
 */
export function getQueryPatterns(): Map<
  string,
  {
    fieldPath: Array<string>
    queryCount: number
    totalTimeMs: number
    avgTimeMs: number
  }
> {
  return new Map(queryPatterns)
}
