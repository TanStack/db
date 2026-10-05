import { DiffTriggerOperation } from '@powersync/common'
import type { ExtractColumnValueType, Table } from '@powersync/common'

/**
 * All PowerSync table records include a UUID `id` column.
 */
export type PowerSyncRecord = {
  id: string
  [key: string]: unknown
}

/**
 * Utility type: If T includes null, also allow undefined (to support optional fields in insert/update operations).
 * PowerSync records are typically typed as `string | null`, where insert
 * and update operations may also allow not specifying a value at all (optional).
 */
type WithUndefinedIfNull<T> = null extends T ? T | undefined : T
type OptionalIfUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? K : never]?: T[K]
} & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K]
}

/**
 * Provides the base column types for a table. This excludes the `id` column.
 */
export type ExtractedTableColumns<TTable extends Table> =
  TTable extends Table<infer Columns>
    ? {
        [K in keyof Columns]: ExtractColumnValueType<Columns[K]>
      }
    : never
/**
 * Utility type that extracts the typed structure of a table based on its column definitions.
 * Maps each column to its corresponding TypeScript type using ExtractColumnValueType.
 *
 * @template TTable - The PowerSync table definition
 * @example
 * ```typescript
 * const table = new Table({
 *   name: column.text,
 *   age: column.integer
 * })
 * type TableType = ExtractedTable<typeof table>
 * // Results in: { id: string, name: string | null, age: number | null }
 * ```
 */
export type ExtractedTable<TTable extends Table> =
  ExtractedTableColumns<TTable> & {
    id: string
  }

export type OptionalExtractedTable<TTable extends Table> = OptionalIfUndefined<{
  [K in keyof ExtractedTableColumns<TTable>]: WithUndefinedIfNull<
    ExtractedTableColumns<TTable>[K]
  >
}> & {
  id: string
}

/**
 * Maps the schema of TTable to a type which
 * requires the keys be equal, but the values can have any value type.
 */
export type AnyTableColumnType<TTable extends Table> = {
  [K in keyof ExtractedTableColumns<TTable>]: unknown
} & { id: string }

export function asPowerSyncRecord(record: any): PowerSyncRecord {
  if (typeof record.id !== `string`) {
    throw new Error(`Record must have a string id field`)
  }
  return record as PowerSyncRecord
}

/**
 * Maps {@link DiffTriggerOperation} to TanstackDB operations
 */
export function mapOperation(operation: DiffTriggerOperation) {
  switch (operation) {
    case DiffTriggerOperation.INSERT:
      return `insert`
    case DiffTriggerOperation.UPDATE:
      return `update`
    case DiffTriggerOperation.DELETE:
      return `delete`
  }
}

/**
 * Maps TanstackDB operations to  {@link DiffTriggerOperation}
 */
export function mapOperationToPowerSync(operation: string) {
  switch (operation) {
    case `insert`:
      return DiffTriggerOperation.INSERT
    case `update`:
      return DiffTriggerOperation.UPDATE
    case `delete`:
      return DiffTriggerOperation.DELETE
    default:
      throw new Error(`Unknown operation ${operation} received`)
  }
}
