import { ColumnType } from '@powersync/common'
import type { Table } from '@powersync/common'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ExtractedTable } from './helpers'

/**
 * Converts a PowerSync Table instance to a StandardSchemaV1 schema.
 * Creates a schema that validates the structure and types of table records
 * according to the PowerSync table definition.
 *
 * @template TTable - The PowerSync schema-typed Table definition
 * @param table - The PowerSync Table instance to convert
 * @returns A StandardSchemaV1-compatible schema with proper type validation
 *
 * @example
 * ```typescript
 * const usersTable = new Table({
 *   name: column.text,
 *   age: column.integer
 * })
 * ```
 */
export function convertTableToSchema<TTable extends Table>(
  table: TTable,
): StandardSchemaV1<ExtractedTable<TTable>> {
  type TExtracted = ExtractedTable<TTable>
  // Create validate function that checks types according to column definitions
  const validate = (
    value: unknown,
  ):
    | StandardSchemaV1.SuccessResult<TExtracted>
    | StandardSchemaV1.FailureResult => {
    if (typeof value != `object` || value == null) {
      return {
        issues: [
          {
            message: `Value must be an object`,
          },
        ],
      }
    }

    const issues: Array<StandardSchemaV1.Issue> = []

    // Check id field
    if (!(`id` in value) || typeof (value as any).id != `string`) {
      issues.push({
        message: `id field must be a string`,
        path: [`id`],
      })
    }

    // Check each column
    for (const column of table.columns) {
      const val = (value as TExtracted)[column.name as keyof TExtracted]

      if (val == null) {
        continue
      }

      switch (column.type) {
        case ColumnType.TEXT:
          if (typeof val != `string`) {
            issues.push({
              message: `${column.name} must be a string or null`,
              path: [column.name],
            })
          }
          break
        case ColumnType.INTEGER:
        case ColumnType.REAL:
          if (typeof val != `number`) {
            issues.push({
              message: `${column.name} must be a number or null`,
              path: [column.name],
            })
          }
          break
      }
    }

    if (issues.length > 0) {
      return { issues }
    }

    return { value: { ...value } as TExtracted }
  }

  return {
    '~standard': {
      version: 1,
      vendor: `powersync`,
      validate,
      types: {
        input: {} as TExtracted,
        output: {} as TExtracted,
      },
    },
  }
}
