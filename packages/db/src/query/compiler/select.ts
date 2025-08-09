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
  // Build ordered operations to preserve authoring order (spreads and fields)
  type Op =
    | { kind: `spread`; tableAlias: string }
    | { kind: `field`; alias: string; compiled: (row: NamespacedRow) => any }

  const ops: Array<Op> = []

  for (const [key, expression] of Object.entries(select)) {
    if (key.startsWith(`__SPREAD_SENTINEL__`)) {
      const rest = key.slice(`__SPREAD_SENTINEL__`.length)
      // Support optional order suffix: __SPREAD_SENTINEL__alias__123
      const splitIndex = rest.indexOf(`__`)
      const tableAlias = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      ops.push({ kind: `spread`, tableAlias })
    } else {
      if (isAggregateExpression(expression)) {
        // Placeholder for group-by processing later
        ops.push({ kind: `field`, alias: key, compiled: () => null })
      } else {
        ops.push({
          kind: `field`,
          alias: key,
          compiled: compileExpression(expression as BasicExpression),
        })
      }
    }
  }

  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const selectResults: Record<string, any> = {}

      for (const op of ops) {
        if (op.kind === `spread`) {
          const tableData = (namespacedRow as any)[op.tableAlias]
          if (tableData && typeof tableData === `object`) {
            for (const [fieldName, fieldValue] of Object.entries(tableData)) {
              // Last-wins semantics: always overwrite
              selectResults[fieldName] = fieldValue
            }
          }
        } else {
          selectResults[op.alias] = op.compiled(namespacedRow)
        }
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
  type Op =
    | { kind: `spread`; tableAlias: string }
    | { kind: `field`; alias: string; compiled: (row: NamespacedRow) => any }
  const ops: Array<Op> = []

  for (const [key, expression] of Object.entries(select)) {
    if (key.startsWith(`__SPREAD_SENTINEL__`)) {
      const rest = key.slice(`__SPREAD_SENTINEL__`.length)
      const splitIndex = rest.indexOf(`__`)
      const tableAlias = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      ops.push({ kind: `spread`, tableAlias })
    } else {
      if (isAggregateExpression(expression)) {
        throw new Error(
          `Aggregate expressions in SELECT clause should be handled by GROUP BY processing`
        )
      }
      ops.push({
        kind: `field`,
        alias: key,
        compiled: compileExpression(expression as BasicExpression),
      })
    }
  }

  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const result: Record<string, any> = {}
      for (const op of ops) {
        if (op.kind === `spread`) {
          const tableData = (namespacedRow as any)[op.tableAlias]
          if (tableData && typeof tableData === `object`) {
            for (const [fieldName, fieldValue] of Object.entries(tableData)) {
              result[fieldName] = fieldValue
            }
          }
        } else {
          result[op.alias] = op.compiled(namespacedRow)
        }
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
