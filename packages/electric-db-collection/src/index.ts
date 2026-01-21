export {
  electricCollectionOptions,
  isChangeMessage,
  isControlMessage,
  type ElectricCollectionConfig,
  type ElectricCollectionUtils,
  type Txid,
  type AwaitTxIdFn,
} from './electric'

export * from './errors'

// Re-export column mapping utilities from @electric-sql/client for convenience
// These are essential for transforming column names between database format (snake_case)
// and application format (camelCase) in both query results and WHERE clauses
export {
  type ColumnMapper,
  createColumnMapper,
  snakeCamelMapper,
  snakeToCamel,
  camelToSnake,
} from '@electric-sql/client'
