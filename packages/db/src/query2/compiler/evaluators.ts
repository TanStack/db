import type { Expression, Func, Ref } from "../ir.js"
import type { NamespacedRow } from "../../types.js"

/**
 * Evaluates an expression against a namespaced row structure
 */
export function evaluateExpression(
  expr: Expression,
  namespacedRow: NamespacedRow
): any {
  switch (expr.type) {
    case `val`:
      return expr.value
    case `ref`:
      return evaluateRef(expr, namespacedRow)
    case `func`:
      return evaluateFunction(expr, namespacedRow)
    default:
      throw new Error(`Unknown expression type: ${(expr as any).type}`)
  }
}

/**
 * Evaluates a reference expression
 */
function evaluateRef(ref: Ref, namespacedRow: NamespacedRow): any {
  const [tableAlias, ...propertyPath] = ref.path

  if (!tableAlias) {
    throw new Error(`Reference path cannot be empty`)
  }

  const tableData = namespacedRow[tableAlias]
  if (tableData === undefined) {
    return undefined
  }

  // Navigate through the property path
  let value: any = tableData
  for (const prop of propertyPath) {
    if (value == null) {
      return value
    }
    value = value[prop]
  }

  return value
}

/**
 * Evaluates a function expression
 */
function evaluateFunction(func: Func, namespacedRow: NamespacedRow): any {
  const args = func.args.map((arg) => evaluateExpression(arg, namespacedRow))

  switch (func.name) {
    // Comparison operators
    case `eq`:
      return args[0] === args[1]
    case `gt`:
      return compareValues(args[0], args[1]) > 0
    case `gte`:
      return compareValues(args[0], args[1]) >= 0
    case `lt`:
      return compareValues(args[0], args[1]) < 0
    case `lte`:
      return compareValues(args[0], args[1]) <= 0

    // Boolean operators
    case `and`:
      return args.every((arg) => Boolean(arg))
    case `or`:
      return args.some((arg) => Boolean(arg))
    case `not`:
      return !args[0]

    // Array operators
    case `in`: {
      const value = args[0]
      const array = args[1]
      if (!Array.isArray(array)) {
        return false
      }
      return array.includes(value)
    }

    // String operators
    case `like`:
      return evaluateLike(args[0], args[1], false)
    case `ilike`:
      return evaluateLike(args[0], args[1], true)

    // String functions
    case `upper`:
      return typeof args[0] === `string` ? args[0].toUpperCase() : args[0]
    case `lower`:
      return typeof args[0] === `string` ? args[0].toLowerCase() : args[0]
    case `length`:
      return typeof args[0] === `string` ? args[0].length : 0
    case `concat`:
      // Concatenate all arguments directly
      return args
        .map((arg) => {
          try {
            return String(arg ?? ``)
          } catch {
            // If String conversion fails, try JSON.stringify as fallback
            try {
              return JSON.stringify(arg) || ``
            } catch {
              return `[object]`
            }
          }
        })
        .join(``)
    case `coalesce`:
      // Return the first non-null, non-undefined argument
      return args.find((arg) => arg !== null && arg !== undefined) ?? null

    // Math functions
    case `add`:
      return (args[0] ?? 0) + (args[1] ?? 0)
    case `subtract`:
      return (args[0] ?? 0) - (args[1] ?? 0)
    case `multiply`:
      return (args[0] ?? 0) * (args[1] ?? 0)
    case `divide`: {
      const divisor = args[1] ?? 0
      return divisor !== 0 ? (args[0] ?? 0) / divisor : null
    }

    default:
      throw new Error(`Unknown function: ${func.name}`)
  }
}

/**
 * Compares two values for ordering
 */
function compareValues(a: any, b: any): number {
  // Handle null/undefined
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  // Handle same types with safe type checking
  try {
    // Be extra safe about type checking - avoid accessing typeof on complex objects
    let typeA: string
    let typeB: string

    try {
      typeA = typeof a
      typeB = typeof b
    } catch {
      // If typeof fails, treat as objects and convert to strings
      const strA = String(a)
      const strB = String(b)
      return strA.localeCompare(strB)
    }

    if (typeA === typeB) {
      if (typeA === `string`) {
        // Be defensive about string comparison
        try {
          return String(a).localeCompare(String(b))
        } catch {
          return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
        }
      }
      if (typeA === `number`) {
        return Number(a) - Number(b)
      }
      if (typeA === `boolean`) {
        const boolA = Boolean(a)
        const boolB = Boolean(b)
        return boolA === boolB ? 0 : boolA ? 1 : -1
      }
      if (a instanceof Date && b instanceof Date) {
        return a.getTime() - b.getTime()
      }
    }

    // Convert to strings for comparison if types differ or are complex
    const strA = String(a)
    const strB = String(b)
    return strA.localeCompare(strB)
  } catch {
    // If anything fails, try basic comparison
    try {
      const strA = String(a)
      const strB = String(b)
      if (strA < strB) return -1
      if (strA > strB) return 1
      return 0
    } catch {
      // Final fallback - treat as equal
      return 0
    }
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
