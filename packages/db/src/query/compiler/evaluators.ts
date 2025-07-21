import {
  EmptyReferencePathError,
  UnknownExpressionTypeError,
  UnknownFunctionError,
} from "../../errors.js"
import type { BasicExpression, Func, PropRef } from "../ir.js"
import type { NamespacedRow } from "../../types.js"

/**
 * Compiled expression evaluator function type
 */
export type CompiledExpression = (namespacedRow: NamespacedRow) => any

/**
 * Compiles an expression into an optimized evaluator function.
 * This eliminates branching during evaluation by pre-compiling the expression structure.
 */
export function compileExpression(expr: BasicExpression): CompiledExpression {
  switch (expr.type) {
    case `val`: {
      // For constant values, return a function that just returns the value
      const value = expr.value
      return () => value
    }

    case `ref`: {
      // For references, pre-compile the property path navigation
      return compileRef(expr)
    }

    case `func`: {
      // For functions, pre-compile the function and its arguments
      return compileFunction(expr)
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
 * Compiles a function expression into an optimized evaluator
 */
function compileFunction(func: Func): CompiledExpression {
  // Pre-compile all arguments
  const compiledArgs = func.args.map(compileExpression)

  switch (func.name) {
    // Comparison operators
    case `eq`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return a === b
      }
    }
    case `gt`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return a > b
      }
    }
    case `gte`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return a >= b
      }
    }
    case `lt`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return a < b
      }
    }
    case `lte`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return a <= b
      }
    }

    // Boolean operators
    case `and`:
      return (namespacedRow) => {
        for (const compiledArg of compiledArgs) {
          if (!compiledArg(namespacedRow)) {
            return false
          }
        }
        return true
      }
    case `or`:
      return (namespacedRow) => {
        for (const compiledArg of compiledArgs) {
          if (compiledArg(namespacedRow)) {
            return true
          }
        }
        return false
      }
    case `not`: {
      const arg = compiledArgs[0]!
      return (namespacedRow) => !arg(namespacedRow)
    }

    // Array operators
    case `in`: {
      const valueEvaluator = compiledArgs[0]!
      const arrayEvaluator = compiledArgs[1]!
      return (namespacedRow) => {
        const value = valueEvaluator(namespacedRow)
        const array = arrayEvaluator(namespacedRow)
        if (!Array.isArray(array)) {
          return false
        }
        return array.includes(value)
      }
    }

    // String operators
    case `like`: {
      const valueEvaluator = compiledArgs[0]!
      const patternEvaluator = compiledArgs[1]!
      return (namespacedRow) => {
        const value = valueEvaluator(namespacedRow)
        const pattern = patternEvaluator(namespacedRow)
        return evaluateLike(value, pattern, false)
      }
    }
    case `ilike`: {
      const valueEvaluator = compiledArgs[0]!
      const patternEvaluator = compiledArgs[1]!
      return (namespacedRow) => {
        const value = valueEvaluator(namespacedRow)
        const pattern = patternEvaluator(namespacedRow)
        return evaluateLike(value, pattern, true)
      }
    }

    // String functions
    case `upper`: {
      const arg = compiledArgs[0]!
      return (namespacedRow) => {
        const value = arg(namespacedRow)
        return typeof value === `string` ? value.toUpperCase() : value
      }
    }
    case `lower`: {
      const arg = compiledArgs[0]!
      return (namespacedRow) => {
        const value = arg(namespacedRow)
        return typeof value === `string` ? value.toLowerCase() : value
      }
    }
    case `length`: {
      const arg = compiledArgs[0]!
      return (namespacedRow) => {
        const value = arg(namespacedRow)
        if (typeof value === `string`) {
          return value.length
        }
        if (Array.isArray(value)) {
          return value.length
        }
        return 0
      }
    }
    case `concat`:
      return (namespacedRow) => {
        return compiledArgs
          .map((evaluator) => {
            const arg = evaluator(namespacedRow)
            try {
              return String(arg ?? ``)
            } catch {
              try {
                return JSON.stringify(arg) || ``
              } catch {
                return `[object]`
              }
            }
          })
          .join(``)
      }
    case `coalesce`:
      return (namespacedRow) => {
        for (const evaluator of compiledArgs) {
          const value = evaluator(namespacedRow)
          if (value !== null && value !== undefined) {
            return value
          }
        }
        return null
      }

    // Math functions
    case `add`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return (a ?? 0) + (b ?? 0)
      }
    }
    case `subtract`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return (a ?? 0) - (b ?? 0)
      }
    }
    case `multiply`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        return (a ?? 0) * (b ?? 0)
      }
    }
    case `divide`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (namespacedRow) => {
        const a = argA(namespacedRow)
        const b = argB(namespacedRow)
        const divisor = b ?? 0
        return divisor !== 0 ? (a ?? 0) / divisor : null
      }
    }

    default:
      throw new UnknownFunctionError(func.name)
  }
}

/**
 * Evaluates LIKE/ILIKE patterns
 */
function evaluateLike(
  value: any,
  pattern: any,
  caseInsensitive: boolean
): boolean {
  if (typeof value !== `string` || typeof pattern !== `string`) {
    return false
  }

  const searchValue = caseInsensitive ? value.toLowerCase() : value
  const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern

  // Convert SQL LIKE pattern to regex
  // First escape all regex special chars except % and _
  let regexPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)

  // Then convert SQL wildcards to regex
  regexPattern = regexPattern.replace(/%/g, `.*`) // % matches any sequence
  regexPattern = regexPattern.replace(/_/g, `.`) // _ matches any single char

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(searchValue)
}
