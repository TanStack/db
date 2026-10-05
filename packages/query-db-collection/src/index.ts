// Export QueryCollectionMeta from global.ts
// This ensures the module augmentation in global.ts is processed by TypeScript
export type { QueryCollectionMeta } from './global'

export {
  queryCollectionOptions,
  type QueryCollectionConfig,
  type QueryCollectionUtils,
  type SyncOperation,
} from './query'

export * from './errors'

export { createCursorPager } from './cursor-pagination'
export type {
  CursorPage,
  CursorPager,
  CursorPagerOptions,
} from './cursor-pagination'

// Re-export expression helpers from @tanstack/db
export {
  parseWhereExpression,
  parseOrderByExpression,
  extractSimpleComparisons,
  parseLoadSubsetOptions,
  extractFieldPath,
  extractValue,
  walkExpression,
  type FieldPath,
  type SimpleComparison,
  type ParseWhereOptions,
  type ParsedOrderBy,
} from '@tanstack/db'
