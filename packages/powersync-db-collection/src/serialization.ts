import { ColumnType } from "@powersync/common"
import type { Table } from "@powersync/common"
import type { CustomSQLiteSerializer } from "./definitions"
import type {
  ExtractedTable,
  ExtractedTableColumns,
  MapBaseColumnType,
} from "./helpers"

/**
 * Serializes an object for persistence to a SQLite table, mapping its values to appropriate SQLite types.
 *
 * This function takes an object representing a row, a table schema, and an optional custom serializer map.
 * It returns a new object with values transformed to be compatible with SQLite column types.
 *
 * ## Generics
 * - `TOutput`: The shape of the input object, typically matching the row data.
 * - `TTable`: The table schema, which must match the keys of `TOutput`.
 *
 * ## Parameters
 * - `value`: The object to serialize (row data).
 * - `tableSchema`: The schema describing the SQLite table columns and types.
 * - `customSerializer`: An optional map of custom serialization functions for specific keys.
 *
 * ## Behavior
 * - For each key in `value`, finds the corresponding column in `tableSchema`.
 * - If a custom serializer is provided for a key, it is used to transform the value.
 * - Otherwise, values are mapped according to the column type:
 *   - `TEXT`: Strings are passed through; Dates are converted to ISO strings; other types are JSON-stringified.
 *   - `INTEGER`/`REAL`: Numbers are passed through; booleans are mapped to 1/0; other types are coerced to numbers.
 * - Throws if a column type is unknown or a value cannot be converted.
 *
 * ## Returns
 * - An object with the same keys as `value`, with values transformed for SQLite compatibility.
 *
 * ## Errors
 * - Throws if a key in `value` does not exist in the schema.
 * - Throws if a value cannot be converted to the required SQLite type.
 */
export function serializeForSQLite<
  TOutput extends Record<string, unknown>,
  // The keys should match
  TTable extends Table<MapBaseColumnType<TOutput>> = Table<
    MapBaseColumnType<TOutput>
  >,
>(
  value: TOutput,
  tableSchema: TTable,
  customSerializer: Partial<
    CustomSQLiteSerializer<TOutput, ExtractedTableColumns<TTable>>
  > = {}
): ExtractedTable<TTable> {
  return Object.fromEntries(
    Object.entries(value).map(([key, value]) => {
      // First get the output schema type
      const outputType =
        key == `id`
          ? ColumnType.TEXT
          : tableSchema.columns.find((column) => column.name == key)?.type
      if (!outputType) {
        throw new Error(`Could not find schema for ${key} column.`)
      }

      if (value == null) {
        return [key, value]
      }

      const customTransform = customSerializer[key]
      if (customTransform) {
        return [key, customTransform(value as TOutput[string])]
      }

      // Map to the output
      switch (outputType) {
        case ColumnType.TEXT:
          if (typeof value == `string`) {
            return [key, value]
          } else if (value instanceof Date) {
            return [key, value.toISOString()]
          } else {
            return [key, JSON.stringify(value)]
          }
        case ColumnType.INTEGER:
        case ColumnType.REAL:
          if (typeof value == `number`) {
            return [key, value]
          } else if (typeof value == `boolean`) {
            return [key, value ? 1 : 0]
          } else {
            const numberValue = Number(value)
            if (isNaN(numberValue)) {
              throw new Error(
                `Could not convert ${key}=${value} to a number for SQLite`
              )
            }
            return [key, numberValue]
          }
      }
    })
  )
}
