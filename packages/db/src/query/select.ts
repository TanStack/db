import { map } from "@electric-sql/d2mini"
import {
  evaluateOperandOnNamespacedRow,
  extractValueFromNamespacedRow,
} from "./extractors"
import type { ConditionOperand, Query, SelectCallback } from "./schema"
import type { KeyedStream, NamespacedAndKeyedStream } from "../types"

export function processSelect(
  pipeline: NamespacedAndKeyedStream,
  query: Query,
  mainTableAlias: string,
  inputs: Record<string, KeyedStream>
): KeyedStream {
  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const result: Record<string, unknown> = {}

      // Check if this is a grouped result (has no nested table structure)
      // If it's a grouped result, we need to handle it differently
      const isGroupedResult =
        query.groupBy &&
        Object.keys(namespacedRow).some(
          (namespaceKey) =>
            !Object.keys(inputs).includes(namespaceKey) &&
            typeof namespacedRow[namespaceKey] !== `object`
        )

      if (!query.select) {
        throw new Error(`Cannot process missing SELECT clause`)
      }

      for (const item of query.select) {
        // Handle callback functions
        if (typeof item === `function`) {
          const callback = item as SelectCallback
          const callbackResult = callback(namespacedRow)

          // If the callback returns an object, merge its properties into the result
          if (
            callbackResult &&
            typeof callbackResult === `object` &&
            !Array.isArray(callbackResult)
          ) {
            Object.assign(result, callbackResult)
          } else {
            // If the callback returns a primitive value, we can't merge it
            // This would need a specific key, but since we don't have one, we'll skip it
            // In practice, select callbacks should return objects with keys
            console.warn(
              `SelectCallback returned a non-object value. SelectCallbacks should return objects with key-value pairs.`
            )
          }
          continue
        }

        if (typeof item === `string`) {
          // Handle wildcard select - all columns from all tables
          if ((item as string) === `@*`) {
            // For grouped results, just return the row as is
            if (isGroupedResult) {
              Object.assign(result, namespacedRow)
            } else {
              // Extract all columns from all tables
              Object.assign(
                result,
                extractAllColumnsFromAllTables(namespacedRow)
              )
            }
            continue
          }

          // Handle @table.* syntax - all columns from a specific table
          if (
            (item as string).startsWith(`@`) &&
            (item as string).endsWith(`.*`)
          ) {
            const tableAlias = (item as string).slice(1, -2) // Remove the '@' and '.*' parts

            // For grouped results, check if we have columns from this table
            if (isGroupedResult) {
              // In grouped results, we don't have the nested structure anymore
              // So we can't extract by table. Just continue to the next item.
              continue
            } else {
              // Extract all columns from the specified table
              Object.assign(
                result,
                extractAllColumnsFromTable(namespacedRow, tableAlias)
              )
            }
            continue
          }

          // Handle simple column references like "@table.column" or "@column"
          if ((item as string).startsWith(`@`)) {
            const columnRef = (item as string).substring(1)
            const alias = columnRef

            // For grouped results, check if the column is directly in the row first
            if (isGroupedResult && columnRef in namespacedRow) {
              result[alias] = namespacedRow[columnRef]
            } else {
              // Extract the value from the nested structure
              result[alias] = extractValueFromNamespacedRow(
                namespacedRow,
                columnRef,
                mainTableAlias,
                undefined
              )
            }

            // If the alias contains a dot (table.column),
            // use just the column part as the field name
            if (alias.includes(`.`)) {
              const columnName = alias.split(`.`)[1]
              result[columnName!] = result[alias]
              delete result[alias]
            }
          }
        } else {
          // Handle aliased columns like { alias: "@column_name" }
          for (const [alias, expr] of Object.entries(item)) {
            if (typeof expr === `string` && (expr as string).startsWith(`@`)) {
              const columnRef = (expr as string).substring(1)

              // For grouped results, check if the column is directly in the row first
              if (isGroupedResult && columnRef in namespacedRow) {
                result[alias] = namespacedRow[columnRef]
              } else {
                // Extract the value from the nested structure
                result[alias] = extractValueFromNamespacedRow(
                  namespacedRow,
                  columnRef,
                  mainTableAlias,
                  undefined
                )
              }
            } else if (typeof expr === `object`) {
              // For grouped results, the aggregate results are already in the row
              if (isGroupedResult && alias in namespacedRow) {
                result[alias] = namespacedRow[alias]
              } else if ((expr as { ORDER_INDEX: unknown }).ORDER_INDEX) {
                result[alias] = namespacedRow[mainTableAlias]![alias]
              } else {
                // This might be a function call
                result[alias] = evaluateOperandOnNamespacedRow(
                  namespacedRow,
                  expr as ConditionOperand,
                  mainTableAlias,
                  undefined
                )
              }
            }
          }
        }
      }

      return [key, result] as [string, typeof result]
    })
  )
}

// Helper function to extract all columns from all tables in a nested row
function extractAllColumnsFromAllTables(
  namespacedRow: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Process each table in the nested row
  for (const [tableAlias, tableData] of Object.entries(namespacedRow)) {
    if (tableData && typeof tableData === `object`) {
      // Add all columns from this table to the result
      // If there are column name conflicts, the last table's columns will overwrite previous ones
      Object.assign(
        result,
        extractAllColumnsFromTable(namespacedRow, tableAlias)
      )
    }
  }

  return result
}

// Helper function to extract all columns from a table in a nested row
function extractAllColumnsFromTable(
  namespacedRow: Record<string, unknown>,
  tableAlias: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Get the table data
  const tableData = namespacedRow[tableAlias] as
    | Record<string, unknown>
    | null
    | undefined

  if (!tableData || typeof tableData !== `object`) {
    return result
  }

  // Add all columns from the table to the result
  for (const [columnName, value] of Object.entries(tableData)) {
    result[columnName] = value
  }

  return result
}
