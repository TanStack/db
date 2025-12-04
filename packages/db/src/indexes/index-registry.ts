/**
 * Index Dev Mode - Helps developers identify when indexes would improve performance
 *
 * Dev mode suggestions are ON by default in non-production builds.
 */

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
    console.warn(
      `[TanStack DB] Index suggestion for "${suggestion.collectionId}":\n` +
        `  ${suggestion.message}\n` +
        `  Field: ${suggestion.fieldPath.join(`.`)}\n` +
        `  Add index: collection.createIndex((row) => row.${suggestion.fieldPath.join(`.`)})`
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
