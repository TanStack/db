// Re-export all public APIs
// Re-export IR types under their own namespace
// because custom collections need access to the IR types
import * as IR from './query/ir.js'

export * from './collection/index.js'
export * from './SortedMap'
export * from './transactions'
export * from './types'
export * from './proxy'
export * from './query/index.js'
export * from './optimistic-action'
export * from './local-only'
export * from './local-storage'
export * from './errors'
export { deepEquals } from './utils'
export * from './paced-mutations'
export * from './strategies/index.js'

// Virtual properties exports
export {
  type VirtualRowProps,
  type VirtualOrigin,
  type PendingOperationType,
  type WithVirtualProps,
  type WithoutVirtualProps,
  hasVirtualProps,
} from './virtual-props.js'

// Index system exports
export { BaseIndex } from './indexes/base-index.js'
export type {
  IndexInterface,
  IndexConstructor,
  IndexStats,
  IndexOperation,
} from './indexes/base-index.js'
export { type IndexOptions } from './indexes/index-options.js'

// Index implementations
export { BasicIndex } from './indexes/basic-index.js'
export type {
  BasicIndexOptions,
  RangeQueryOptions,
} from './indexes/basic-index.js'
export { BTreeIndex } from './indexes/btree-index.js'
export type { RangeQueryOptions as BTreeRangeQueryOptions } from './indexes/btree-index.js'
export { ReverseIndex } from './indexes/reverse-index.js'

// Index optimization utilities
export {
  optimizeExpressionWithIndexes,
  findIndexForField,
} from './utils/index-optimization.js'

// Dev mode utilities
export {
  configureIndexDevMode,
  isDevModeEnabled,
  getIndexDevModeConfig,
  trackQuery,
  clearQueryPatterns,
  getQueryPatterns,
} from './indexes/index-registry.js'
export type {
  IndexDevModeConfig,
  IndexSuggestion,
} from './indexes/index-registry.js'

// Expression helpers
export * from './query/expression-helpers.js'

// Reactive effects
export {
  createEffect,
  type DeltaEvent,
  type DeltaType,
  type EffectConfig,
  type EffectContext,
  type Effect,
  type EffectQueryInput,
} from './query/effect.js'

// Re-export some stuff explicitly to ensure the type & value is exported
export type { Collection } from './collection/index.js'
export { IR }
export { operators, type OperatorName } from './query/builder/functions.js'
