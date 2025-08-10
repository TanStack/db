import { map } from "@tanstack/db-ivm"
import { PropRef, Value as ValClass, isExpressionLike } from "../ir.js"
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
    | {
        kind: `merge`
        targetPath: Array<string>
        source: (row: NamespacedRow) => any
      }
    | { kind: `field`; alias: string; compiled: (row: NamespacedRow) => any }

  const ops: Array<Op> = []

  function addFromObject(prefixPath: Array<string>, obj: any) {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith(`__SPREAD_SENTINEL__`)) {
        const rest = key.slice(`__SPREAD_SENTINEL__`.length)
        const splitIndex = rest.lastIndexOf(`__`)
        const pathStr = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
        const isRefExpr =
          value &&
          typeof value === `object` &&
          `type` in (value as any) &&
          (value as any).type === `ref`
        if (pathStr.includes(`.`) || isRefExpr) {
          // Merge into the current destination (prefixPath) from the referenced source path
          const targetPath = [...prefixPath]
          const expr = isRefExpr
            ? (value as BasicExpression)
            : (new PropRef(pathStr.split(`.`)) as BasicExpression)
          const compiled = compileExpression(expr)
          ops.push({ kind: `merge`, targetPath, source: compiled })
        } else {
          // Table-level: pathStr is the alias; merge from namespaced row at the current prefix
          const tableAlias = pathStr
          const targetPath = [...prefixPath]
          ops.push({
            kind: `merge`,
            targetPath,
            source: (row) => (row as any)[tableAlias],
          })
        }
        continue
      }

      const expression = value as any
      if (
        expression &&
        typeof expression === `object` &&
        !isExpressionLike(expression)
      ) {
        // Nested selection object
        addFromObject([...prefixPath, key], expression)
        continue
      }

      if (isAggregateExpression(expression)) {
        // Placeholder for group-by processing later
        ops.push({
          kind: `field`,
          alias: [...prefixPath, key].join(`.`),
          compiled: () => null,
        })
      } else {
        if (expression === undefined || !isExpressionLike(expression)) {
          ops.push({
            kind: `field`,
            alias: [...prefixPath, key].join(`.`),
            compiled: () => expression,
          })
          continue
        }
        // If the expression is a Value wrapper, embed the literal to avoid re-compilation mishaps
        if (expression instanceof ValClass) {
          const val = expression.value
          ops.push({
            kind: `field`,
            alias: [...prefixPath, key].join(`.`),
            compiled: () => val,
          })
        } else {
          ops.push({
            kind: `field`,
            alias: [...prefixPath, key].join(`.`),
            compiled: compileExpression(expression as BasicExpression),
          })
        }
      }
    }
  }

  addFromObject([], select)

  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const selectResults: Record<string, any> = {}

      for (const op of ops) {
        if (op.kind === `merge`) {
          const value = op.source(namespacedRow)
          if (value && typeof value === `object`) {
            // Ensure target object exists
            let cursor: any = selectResults
            const path = op.targetPath
            if (path.length === 0) {
              // Top-level merge
              for (const [k, v] of Object.entries(value)) {
                selectResults[k] = v
              }
            } else {
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

      // Recursively unwrap any Value expressions that might have leaked through
      function unwrapVals(input: any): any {
        if (input instanceof ValClass) return input.value
        if (Array.isArray(input)) return input.map(unwrapVals)
        if (input && typeof input === `object`) {
          const out: Record<string, any> = {}
          for (const [k, v] of Object.entries(input)) {
            out[k] = unwrapVals(v)
          }
          return out
        }
        return input
      }
      const normalizedResults = unwrapVals(selectResults)

      // Return the namespaced row with __select_results added
      return [
        key,
        {
          ...namespacedRow,
          __select_results: normalizedResults,
        },
      ] as [
        string,
        typeof namespacedRow & { __select_results: typeof normalizedResults },
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
    | {
        kind: `merge`
        targetPath: Array<string>
        source: (row: NamespacedRow) => any
      }
    | { kind: `field`; alias: string; compiled: (row: NamespacedRow) => any }
  const ops: Array<Op> = []

  function addFromObject(prefixPath: Array<string>, obj: any) {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith(`__SPREAD_SENTINEL__`)) {
        const rest = key.slice(`__SPREAD_SENTINEL__`.length)
        const splitIndex = rest.lastIndexOf(`__`)
        const pathStr = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
        const isRefExpr =
          value &&
          typeof value === `object` &&
          `type` in (value as any) &&
          (value as any).type === `ref`
        if (pathStr.includes(`.`) || isRefExpr) {
          const targetPath = [...prefixPath]
          const expr = isRefExpr
            ? (value as BasicExpression)
            : (new PropRef(pathStr.split(`.`)) as BasicExpression)
          const compiled = compileExpression(expr)
          ops.push({ kind: `merge`, targetPath, source: compiled })
        } else {
          const tableAlias = pathStr
          const targetPath = [...prefixPath]
          ops.push({
            kind: `merge`,
            targetPath,
            source: (row) => (row as any)[tableAlias],
          })
        }
        continue
      }

      const expression = value as any
      if (
        expression &&
        typeof expression === `object` &&
        !isExpressionLike(expression)
      ) {
        addFromObject([...prefixPath, key], expression)
        continue
      }

      if (isAggregateExpression(expression)) {
        throw new Error(
          `Aggregate expressions in SELECT clause should be handled by GROUP BY processing`
        )
      }
      ops.push({
        kind: `field`,
        alias: [...prefixPath, key].join(`.`),
        compiled: compileExpression(expression as BasicExpression),
      })
    }
  }

  addFromObject([], select)

  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const result: Record<string, any> = {}
      for (const op of ops) {
        if (op.kind === `merge`) {
          const value = op.source(namespacedRow)
          if (value && typeof value === `object`) {
            let cursor: any = result
            const path = op.targetPath
            if (path.length === 0) {
              for (const [k, v] of Object.entries(value)) {
                result[k] = v
              }
            } else {
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
