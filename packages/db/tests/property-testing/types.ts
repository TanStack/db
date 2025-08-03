import type { Collection } from "../../../src/collection"
import type { QueryIR } from "../../../src/query/ir"

/**
 * Supported data types for property testing
 */
export type SupportedType =
  | `string`
  | `number`
  | `boolean`
  | `null`
  | `object`
  | `array`

/**
 * Column definition for schema generation
 */
export interface ColumnDef {
  name: string
  type: SupportedType
  isPrimaryKey: boolean
  isNullable: boolean
  isJoinable: boolean
}

/**
 * Table definition for schema generation
 */
export interface TableDef {
  name: string
  columns: Array<ColumnDef>
  primaryKey: string
}

/**
 * Generated schema for a test run
 */
export interface TestSchema {
  tables: Array<TableDef>
  joinHints: Array<{
    table1: string
    column1: string
    table2: string
    column2: string
  }>
}

/**
 * Row data for a table
 */
export interface TestRow {
  [columnName: string]: TestValue
}

/**
 * Supported value types for testing
 */
export type TestValue =
  | string
  | number
  | boolean
  | null
  | Record<string, TestValue>
  | Array<TestValue>

/**
 * Mutation operation types
 */
export type MutationType = `insert` | `update` | `delete`

/**
 * Mutation command for property testing
 */
export interface MutationCommand {
  type: MutationType
  table: string
  key?: string | number
  data?: Partial<TestRow>
  changes?: Partial<TestRow>
}

/**
 * Transaction command types
 */
export type TransactionCommand = `begin` | `commit` | `rollback`

/**
 * Query command for property testing
 */
export interface QueryCommand {
  type: `startQuery` | `stopQuery`
  queryId: string
  ast?: QueryIR
  sql?: string
}

/**
 * All possible commands in a test sequence
 */
export type TestCommand =
  | MutationCommand
  | { type: TransactionCommand }
  | QueryCommand

/**
 * Test state maintained during property testing
 */
export interface TestState {
  schema: TestSchema
  collections: Map<string, Collection<TestRow>>
  activeQueries: Map<
    string,
    {
      ast: QueryIR
      sql: string
      unsubscribe: () => void
      snapshot: Array<TestRow>
    }
  >
  currentTransaction: string | null
  sqliteDb: any // better-sqlite3 Database instance
  commandCount: number
  seed: number
}

/**
 * Generator configuration for property testing
 */
export interface GeneratorConfig {
  maxTables: number
  maxColumns: number
  minRows?: number
  maxRows?: number
  maxRowsPerTable: number
  minCommands?: number
  maxCommands: number
  maxQueries: number
  floatTolerance: number
}

/**
 * Default generator configuration
 */
export const DEFAULT_CONFIG: GeneratorConfig = {
  maxTables: 4,
  maxColumns: 8,
  maxRowsPerTable: 2000,
  maxCommands: 40,
  maxQueries: 10,
  floatTolerance: 1e-12,
}

/**
 * Property test result
 */
export interface PropertyTestResult {
  success: boolean
  seed?: number
  commandCount?: number
  failingCommands?: Array<TestCommand>
  error?: Error
  shrunkExample?: Array<TestCommand>
  errors?: Array<string>
  snapshotEquality?: boolean
  incrementalConvergence?: boolean
  transactionVisibility?: boolean
  rowCountSanity?: boolean
  queryResults?: Array<any>
  patchResults?: Array<any>
  transactionResults?: Array<any>
  rowCounts?: Record<string, number>
  featureCoverage?: {
    select: number
    where: number
    join: number
    aggregate: number
    orderBy: number
    groupBy: number
    subquery: number
  }
  complexQueryResults?: Array<any>
  dataTypeResults?: Array<any>
  edgeCaseResults?: Array<any>
}

/**
 * Normalized value for comparison
 */
export interface NormalizedValue {
  type: `string` | `number` | `boolean` | `null` | `object` | `array`
  value: any
  sortKey: string
}

/**
 * SQLite transaction state
 */
export interface SQLiteTransaction {
  savepointId: string
  isActive: boolean
}

/**
 * Query result comparison
 */
export interface QueryComparison {
  tanstackResult: Array<TestRow>
  sqliteResult: Array<TestRow>
  normalized: {
    tanstack: Array<NormalizedValue>
    sqlite: Array<NormalizedValue>
  }
  isEqual: boolean
  differences?: Array<{
    tanstack: NormalizedValue
    sqlite: NormalizedValue
    index: number
  }>
}
