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
    | { kind: `nested_spread`; targetPath: Array<string>; compiled: (row: NamespacedRow) => any }
    | { kind: `field`; alias: string; compiled: (row: NamespacedRow) => any }

  const ops: Array<Op> = []

  for (const [key, expression] of Object.entries(select)) {
    if (key.startsWith(`__SPREAD_SENTINEL__`)) {
      const rest = key.slice(`__SPREAD_SENTINEL__`.length)
      const splitIndex = rest.indexOf(`__`)
      const tableAlias = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      ops.push({ kind: `spread`, tableAlias })
    } else if (key.startsWith(`__NESTED_SPREAD__`)) {
      // Pattern: __NESTED_SPREAD__path.to.target__123
      const rest = key.slice(`__NESTED_SPREAD__`.length)
      const splitIndex = rest.lastIndexOf(`__`)
      const pathStr = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      const targetPath = pathStr.split(`.`)
      ops.push({
        kind: `nested_spread`,
        targetPath,
        compiled: compileExpression(expression as BasicExpression),
      })
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
        } else if (op.kind === `nested_spread`) {
          const value = op.compiled(namespacedRow)
          if (value && typeof value === `object`) {
            // Ensure target object exists
            let cursor: any = selectResults
            const path = op.targetPath
            // Create all parents except the last segment
            for (let i = 0; i < path.length; i++) {
              const seg = path[i]!
              if (i === path.length - 1) {
                // For the leaf, spread properties into existing or new object
                const dest = (cursor[seg] ??= {})
                if (typeof dest === `object`) {
                  for (const [k, v] of Object.entries(value)) {
                    dest[k] = v
                  }
                } else {
                  // If non-object is present, overwrite with a shallow clone of value
                  cursor[seg] = { ...value }
                }
              } else {
                const next = cursor[seg]
                if (next == null || typeof next !== `object`) {
                  cursor[seg] = {}
                }
                cursor = cursor[seg]
              }
            }
          }
        } else {
          // Support nested alias paths like "meta.author.name"
          const path = op.alias.split(`.`)
          if (path.length === 1) {
            selectResults[op.alias] = op.compiled(namespacedRow)
          } else {
            let cursor: any = selectResults
            for (let i = 0; i < path.length - 1; i++) {
              const seg = path[i]!
              const next = cursor[seg]
              if (next == null || typeof next !== `object`) {
                cursor[seg] = {}
              }
              cursor = cursor[seg]
            }
            cursor[path[path.length - 1]!] = op.compiled(namespacedRow)
          }
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
    | { kind: `nested_spread`; targetPath: Array<string>; compiled: (row: NamespacedRow) => any }
    | { kind: `field`; alias: string; compiled: (row: NamespacedRow) => any }
  const ops: Array<Op> = []

  for (const [key, expression] of Object.entries(select)) {
    if (key.startsWith(`__SPREAD_SENTINEL__`)) {
      const rest = key.slice(`__SPREAD_SENTINEL__`.length)
      const splitIndex = rest.indexOf(`__`)
      const tableAlias = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      ops.push({ kind: `spread`, tableAlias })
    } else if (key.startsWith(`__NESTED_SPREAD__`)) {
      const rest = key.slice(`__NESTED_SPREAD__`.length)
      const splitIndex = rest.lastIndexOf(`__`)
      const pathStr = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      const targetPath = pathStr.split(`.`)
      ops.push({
        kind: `nested_spread`,
        targetPath,
        compiled: compileExpression(expression as BasicExpression),
      })
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
        } else if (op.kind === `nested_spread`) {
          const value = op.compiled(namespacedRow)
          if (value && typeof value === `object`) {
            let cursor: any = result
            const path = op.targetPath
            for (let i = 0; i < path.length; i++) {
              const seg = path[i]!
              if (i === path.length - 1) {
                const dest = (cursor[seg] ??= {})
                if (typeof dest === `object`) {
                  for (const [k, v] of Object.entries(value)) {
                    dest[k] = v
                  }
                } else {
                  cursor[seg] = { ...value }
                }
              } else {
                const next = cursor[seg]
                if (next == null || typeof next !== `object`) {
                  cursor[seg] = {}
                }
                cursor = cursor[seg]
              }
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
