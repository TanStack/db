// Export QueryCollectionMeta from global.ts
// This ensures the module augmentation in global.ts is processed by TypeScript
export type { QueryCollectionMeta } from "./global"

export {
  queryCollectionOptions,
  type QueryCollectionConfig,
  type QueryCollectionUtils,
  type SyncOperation,
} from "./query"

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
