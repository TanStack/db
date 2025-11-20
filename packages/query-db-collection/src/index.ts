// Import global.d.ts to ensure module augmentation is loaded
import type {} from "./global"

export {
  queryCollectionOptions,
  type QueryCollectionConfig,
  type QueryCollectionUtils,
  type SyncOperation,
} from "./query"

// Export QueryCollectionMeta from global.d.ts (the only source)
export type { QueryCollectionMeta } from "./global"

export * from "./errors"

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
} from "@tanstack/db"
