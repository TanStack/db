import { map } from "@tanstack/db-ivm"
import { compileExpression } from "./evaluators.js"
import type { Aggregate, BasicExpression, Select } from "../ir.js"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../../types.js"

/**
 * Processes the SELECT clause and places results in __select_results
 * while preserving the original namespaced row for ORDER BY access
 */
export function processSelectToResults(
  pipeline: NamespacedAndKeyedStream,
  select: Select,
  _allInputs: Record<string, KeyedStream>
): NamespacedAndKeyedStream {
  // Pre-compile all select expressions
  const compiledSelect: Array<{
    alias: string
    compiledExpression: (row: NamespacedRow) => any
  }> = []
  const spreadAliases: Array<string> = []

  for (const [alias, expression] of Object.entries(select)) {
    if (alias.startsWith(`__SPREAD_SENTINEL__`)) {
      // Extract the table alias from the sentinel key
      const tableAlias = alias.replace(`__SPREAD_SENTINEL__`, ``)
      spreadAliases.push(tableAlias)
    } else {
      if (isAggregateExpression(expression)) {
        // For aggregates, we'll store the expression info for GROUP BY processing
        // but still compile a placeholder that will be replaced later
        compiledSelect.push({
          alias,
          compiledExpression: () => null, // Placeholder - will be handled by GROUP BY
        })
      } else {
        compiledSelect.push({
          alias,
          compiledExpression: compileExpression(expression as BasicExpression),
        })
      }
    }
  }

  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const selectResults: Record<string, any> = {}

      // First pass: spread table data for any spread sentinels
      for (const tableAlias of spreadAliases) {
        const tableData = namespacedRow[tableAlias]
        if (tableData && typeof tableData === `object`) {
          // Spread the table data into the result, but don't overwrite explicit fields
          for (const [fieldName, fieldValue] of Object.entries(tableData)) {
            if (!(fieldName in selectResults)) {
              selectResults[fieldName] = fieldValue
            }
          }
        }
      }

      // Second pass: evaluate all compiled select expressions (non-aggregates)
      for (const { alias, compiledExpression } of compiledSelect) {
        selectResults[alias] = compiledExpression(namespacedRow)
      }

      // Return the namespaced row with __select_results added
      return [
        key,
        {
          ...namespacedRow,
          __select_results: selectResults,
        },
      ] as [
        string,
        typeof namespacedRow & { __select_results: typeof selectResults },
      ]
    })
  )
}

/**
 * Processes the SELECT clause (legacy function - kept for compatibility)
 */
export function processSelect(
  pipeline: NamespacedAndKeyedStream,
  select: Select,
  _allInputs: Record<string, KeyedStream>
): KeyedStream {
  // Pre-compile all select expressions
  const compiledSelect: Array<{
    alias: string
    compiledExpression: (row: NamespacedRow) => any
  }> = []
  const spreadAliases: Array<string> = []

  for (const [alias, expression] of Object.entries(select)) {
    if (alias.startsWith(`__SPREAD_SENTINEL__`)) {
      // Extract the table alias from the sentinel key
      const tableAlias = alias.replace(`__SPREAD_SENTINEL__`, ``)
      spreadAliases.push(tableAlias)
    } else {
      if (isAggregateExpression(expression)) {
        // Aggregates should be handled by GROUP BY processing, not here
        throw new Error(
          `Aggregate expressions in SELECT clause should be handled by GROUP BY processing`
        )
      }
      compiledSelect.push({
        alias,
        compiledExpression: compileExpression(expression as BasicExpression),
      })
    }
  }

  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const result: Record<string, any> = {}

      // First pass: spread table data for any spread sentinels
      for (const tableAlias of spreadAliases) {
        const tableData = namespacedRow[tableAlias]
        if (tableData && typeof tableData === `object`) {
          // Spread the table data into the result, but don't overwrite explicit fields
          for (const [fieldName, fieldValue] of Object.entries(tableData)) {
            if (!(fieldName in result)) {
              result[fieldName] = fieldValue
            }
          }
        }
      }

      // Second pass: evaluate all compiled select expressions
      for (const { alias, compiledExpression } of compiledSelect) {
        result[alias] = compiledExpression(namespacedRow)
      }

      return [key, result] as [string, typeof result]
    })
  )
}

/**
 * Helper function to check if an expression is an aggregate
 */
function isAggregateExpression(
  expr: BasicExpression | Aggregate
): expr is Aggregate {
  return expr.type === `agg`
}

/**
 * Processes a single argument in a function context
 */
export function processArgument(
  arg: BasicExpression | Aggregate,
  namespacedRow: NamespacedRow
): any {
  if (isAggregateExpression(arg)) {
    throw new Error(
      `Aggregate expressions are not supported in this context. Use GROUP BY clause for aggregates.`
    )
  }

  // Pre-compile the expression and evaluate immediately
  const compiledExpression = compileExpression(arg)
  const value = compiledExpression(namespacedRow)

  return value
}
