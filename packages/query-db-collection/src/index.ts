export {
  queryCollectionOptions,
  type QueryCollectionConfig,
  type QueryCollectionFunctionContext,
  type QueryCollectionMeta,
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
