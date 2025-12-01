import {
  EmptyReferencePathError,
  UnknownExpressionTypeError,
  UnknownFunctionError,
} from "../../errors.js"
import { tryGetOperatorEvaluator } from "./registry.js"
import type { BasicExpression, Func, PropRef } from "../ir.js"
import type { NamespacedRow } from "../../types.js"

// Import all operators to ensure they're registered before any compilation happens
// This ensures auto-registration works correctly
import "../builder/operators/eq.js"
import "../builder/operators/gt.js"
import "../builder/operators/gte.js"
import "../builder/operators/lt.js"
import "../builder/operators/lte.js"
import "../builder/operators/and.js"
import "../builder/operators/or.js"
import "../builder/operators/not.js"
import "../builder/operators/in.js"
import "../builder/operators/like.js"
import "../builder/operators/ilike.js"
import "../builder/operators/upper.js"
import "../builder/operators/lower.js"
import "../builder/operators/length.js"
import "../builder/operators/concat.js"
import "../builder/operators/coalesce.js"
import "../builder/operators/add.js"
import "../builder/operators/subtract.js"
import "../builder/operators/multiply.js"
import "../builder/operators/divide.js"
import "../builder/operators/isNull.js"
import "../builder/operators/isUndefined.js"

/**
 * Converts a 3-valued logic result to a boolean for use in WHERE/HAVING filters.
 * In SQL, UNKNOWN (null) values in WHERE clauses exclude rows, matching false behavior.
 *
 * @param result - The 3-valued logic result: true, false, or null (UNKNOWN)
 * @returns true only if result is explicitly true, false otherwise
 *
 * Truth table:
 * - true → true (include row)
 * - false → false (exclude row)
 * - null (UNKNOWN) → false (exclude row, matching SQL behavior)
 */
export function toBooleanPredicate(result: boolean | null): boolean {
  return result === true
}

/**
 * Compiled expression evaluator function type
 */
export type CompiledExpression = (namespacedRow: NamespacedRow) => any

/**
 * Compiled single-row expression evaluator function type
 */
export type CompiledSingleRowExpression = (item: Record<string, unknown>) => any

/**
 * Compiles an expression into an optimized evaluator function.
 * This eliminates branching during evaluation by pre-compiling the expression structure.
 */
export function compileExpression(
  expr: BasicExpression,
  isSingleRow: boolean = false
): CompiledExpression | CompiledSingleRowExpression {
  const compiledFn = compileExpressionInternal(expr, isSingleRow)
  return compiledFn
}

/**
 * Compiles a single-row expression into an optimized evaluator function.
 */
export function compileSingleRowExpression(
  expr: BasicExpression
): CompiledSingleRowExpression {
  const compiledFn = compileExpressionInternal(expr, true)
  return compiledFn as CompiledSingleRowExpression
}

/**
 * Internal unified expression compiler that handles both namespaced and single-row evaluation
 * Exported for use by operator modules that need to compile their arguments.
 */
export function compileExpressionInternal(
  expr: BasicExpression,
  isSingleRow: boolean
): (data: any) => any {
  switch (expr.type) {
    case `val`: {
      // For constant values, return a function that just returns the value
      const value = expr.value
      return () => value
    }

    case `ref`: {
      // For references, compile based on evaluation mode
      return isSingleRow ? compileSingleRowRef(expr) : compileRef(expr)
    }

    case `func`: {
      // For functions, use the unified compiler
      return compileFunction(expr, isSingleRow)
    }

    default:
      throw new UnknownExpressionTypeError((expr as any).type)
  }
}

/**
 * Compiles a reference expression into an optimized evaluator
 */
function compileRef(ref: PropRef): CompiledExpression {
  const [tableAlias, ...propertyPath] = ref.path

  if (!tableAlias) {
    throw new EmptyReferencePathError()
  }

  // Pre-compile the property path navigation
  if (propertyPath.length === 0) {
    // Simple table reference
    return (namespacedRow) => namespacedRow[tableAlias]
  } else if (propertyPath.length === 1) {
    // Single property access - most common case
    const prop = propertyPath[0]!
    return (namespacedRow) => {
      const tableData = namespacedRow[tableAlias]
      return tableData?.[prop]
    }
  } else {
    // Multiple property navigation
    return (namespacedRow) => {
      const tableData = namespacedRow[tableAlias]
      if (tableData === undefined) {
        return undefined
      }

      let value: any = tableData
      for (const prop of propertyPath) {
        if (value == null) {
          return value
        }
        value = value[prop]
      }
      return value
    }
  }
}

/**
 * Compiles a reference expression for single-row evaluation
 */
function compileSingleRowRef(ref: PropRef): CompiledSingleRowExpression {
  const propertyPath = ref.path

  // This function works for all path lengths including empty path
  return (item) => {
    let value: any = item
    for (const prop of propertyPath) {
      if (value == null) {
        return value
      }
      value = value[prop]
    }
    return value
  }
}

/**
 * Compiles a function expression for both namespaced and single-row evaluation
 */
function compileFunction(func: Func, isSingleRow: boolean): (data: any) => any {
  // Pre-compile all arguments using the appropriate compiler
  const compiledArgs = func.args.map((arg) =>
    compileExpressionInternal(arg, isSingleRow)
  )

  // Try registry first (for migrated operators)
  const evaluatorFactory = tryGetOperatorEvaluator(func.name)
  if (evaluatorFactory) {
    return evaluatorFactory(compiledArgs, isSingleRow)
  }

  // Fall back to switch for non-migrated operators (currently none, but kept for extensibility)
  switch (func.name) {
    default:
      throw new UnknownFunctionError(func.name)
  }
}
