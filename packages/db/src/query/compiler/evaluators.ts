import {
  EmptyReferencePathError,
  UnknownExpressionTypeError,
  UnknownFunctionError,
} from '../../errors.js'
import {
  areValuesEqual,
  isUnorderable,
  normalizeValue,
} from '../../utils/comparison.js'
import type { BasicExpression, Func, PropRef } from '../ir.js'
import type { NamespacedRow } from '../../types.js'

/**
 * Helper function to check if a value is null or undefined (represents UNKNOWN in 3-valued logic)
 */
function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

/**
 * Equality that follows PostgreSQL float semantics for `NaN`/invalid Dates:
 * such values are equal to one another and unequal to anything else. For all
 * other values it defers to {@link areValuesEqual}. Operands must not be
 * null/undefined (callers handle UNKNOWN first).
 */
function valuesEqual(a: any, b: any): boolean {
  if (isUnorderable(a) || isUnorderable(b)) {
    return isUnorderable(a) && isUnorderable(b)
  }
  return areValuesEqual(a, b)
}

function toDateValue(value: any): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === `string` || typeof value === `number`) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function evaluateStrftime(format: string, date: Date): string {
  if (format === `%Y-%m-%d`) {
    return date.toISOString().slice(0, 10)
  }

  if (format === `%Y-%m-%dT%H:%M:%fZ`) {
    return date.toISOString()
  }

  return date.toISOString()
}

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
 * Cache of compiled evaluators keyed by an exact structural serialization of
 * the expression IR. Live queries are frequently created with structurally
 * identical expressions (components re-mounting the same query shape, or
 * benchmarks re-hydrating): reusing the evaluator closure keeps its engine
 * type feedback warm across creations instead of re-tiering per instance.
 * The key is exact (not a lossy hash), so collisions are impossible; entries
 * are evicted FIFO beyond a cap, and expressions that don't serialize to a
 * reasonable key are compiled uncached.
 */
const expressionCache = new Map<
  string,
  CompiledExpression | CompiledSingleRowExpression
>()
const EXPRESSION_CACHE_MAX_ENTRIES = 512
const EXPRESSION_CACHE_MAX_KEY_LENGTH = 2048

function serializeExpressionForCache(expr: BasicExpression): string | null {
  switch (expr.type) {
    case `ref`:
      return `r:${(expr).path.join(`.`)}`
    case `val`: {
      const value = (expr as { value: unknown }).value
      switch (typeof value) {
        case `number`:
        case `boolean`:
        case `bigint`:
          return `v:${typeof value}:${String(value)}`
        case `string`:
          return `v:s:${JSON.stringify(value)}`
        case `undefined`:
          return `v:u`
        case `object`: {
          if (value === null) return `v:z`
          if (Array.isArray(value)) {
            // Common for inArray: cache when all members are simple primitives
            const parts: Array<string> = []
            for (const item of value) {
              const t = typeof item
              if (t === `number` || t === `boolean` || t === `bigint`) {
                parts.push(`${t}:${String(item)}`)
              } else if (t === `string`) {
                parts.push(`s:${JSON.stringify(item)}`)
              } else if (item === null) {
                parts.push(`z`)
              } else {
                return null
              }
            }
            return `v:a:[${parts.join(`,`)}]`
          }
          return null
        }
        default:
          return null
      }
    }
    case `func`: {
      const func = expr
      const argKeys: Array<string> = []
      for (const arg of func.args) {
        const argKey = serializeExpressionForCache(arg)
        if (argKey === null) return null
        argKeys.push(argKey)
      }
      return `f:${func.name}(${argKeys.join(`,`)})`
    }
    default:
      return null
  }
}

function compileWithCache(
  expr: BasicExpression,
  isSingleRow: boolean,
): CompiledExpression | CompiledSingleRowExpression {
  const structuralKey = serializeExpressionForCache(expr)
  if (
    structuralKey === null ||
    structuralKey.length > EXPRESSION_CACHE_MAX_KEY_LENGTH
  ) {
    return compileExpressionInternal(expr, isSingleRow)
  }
  const cacheKey = (isSingleRow ? `1|` : `0|`) + structuralKey
  const cached = expressionCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const compiled = compileExpressionInternal(expr, isSingleRow)
  if (expressionCache.size >= EXPRESSION_CACHE_MAX_ENTRIES) {
    // FIFO eviction: drop the oldest entry
    const oldest = expressionCache.keys().next()
    if (!oldest.done) {
      expressionCache.delete(oldest.value)
    }
  }
  expressionCache.set(cacheKey, compiled)
  return compiled
}

/**
 * Compiles an expression into an optimized evaluator function.
 * This eliminates branching during evaluation by pre-compiling the expression structure.
 */
export function compileExpression(
  expr: BasicExpression,
  isSingleRow: boolean = false,
): CompiledExpression | CompiledSingleRowExpression {
  return compileWithCache(expr, isSingleRow)
}

/**
 * Compiles a single-row expression into an optimized evaluator function.
 */
export function compileSingleRowExpression(
  expr: BasicExpression,
): CompiledSingleRowExpression {
  return compileWithCache(expr, true) as CompiledSingleRowExpression
}

/**
 * Internal unified expression compiler that handles both namespaced and single-row evaluation
 */
function compileExpressionInternal(
  expr: BasicExpression,
  isSingleRow: boolean,
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
  const [namespace, ...propertyPath] = ref.path

  if (!namespace) {
    throw new EmptyReferencePathError()
  }

  // Handle $selected namespace - references SELECT result fields
  if (namespace === `$selected`) {
    // Access $selected directly
    if (propertyPath.length === 0) {
      // Just $selected - return entire $selected object
      return (namespacedRow) => (namespacedRow as any).$selected
    } else if (propertyPath.length === 1) {
      // Single property access - most common case
      const prop = propertyPath[0]!
      return (namespacedRow) => {
        const selectResults = (namespacedRow as any).$selected
        return selectResults?.[prop]
      }
    } else {
      // Multiple property navigation (nested SELECT fields)
      return (namespacedRow) => {
        const selectResults = (namespacedRow as any).$selected
        if (selectResults === undefined) {
          return undefined
        }

        let value: any = selectResults
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

  // Handle table alias namespace (existing logic)
  const tableAlias = namespace

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
    compileExpressionInternal(arg, isSingleRow),
  )

  switch (func.name) {
    // Comparison operators
    case `eq`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const rawA = argA(data)
        const rawB = argB(data)
        // Fast paths for same-type primitives, which need no normalization
        const typeA = typeof rawA
        if (typeA === typeof rawB) {
          if (typeA === `string` || typeA === `boolean` || typeA === `bigint`) {
            return rawA === rawB
          }
          if (typeA === `number`) {
            return (
              rawA === rawB || (Number.isNaN(rawA) && Number.isNaN(rawB))
            )
          }
        }
        const a = normalizeValue(rawA)
        const b = normalizeValue(rawB)
        // In 3-valued logic, any comparison with null/undefined returns UNKNOWN
        if (isUnknown(a) || isUnknown(b)) {
          return null
        }
        // NaN/invalid Dates are equal to one another (PostgreSQL semantics);
        // otherwise use areValuesEqual for proper Uint8Array/Buffer comparison
        return valuesEqual(a, b)
      }
    }
    case `gt`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        // In 3-valued logic, any comparison with null/undefined returns UNKNOWN
        if (isUnknown(a) || isUnknown(b)) {
          return null
        }
        // NaN/invalid Dates sort greater than every other value, and are equal
        // to one another (PostgreSQL semantics)
        if (isUnorderable(a) || isUnorderable(b)) {
          return isUnorderable(a) && !isUnorderable(b)
        }
        return a > b
      }
    }
    case `gte`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        // In 3-valued logic, any comparison with null/undefined returns UNKNOWN
        if (isUnknown(a) || isUnknown(b)) {
          return null
        }
        if (isUnorderable(a) || isUnorderable(b)) {
          return isUnorderable(a)
        }
        return a >= b
      }
    }
    case `lt`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        // In 3-valued logic, any comparison with null/undefined returns UNKNOWN
        if (isUnknown(a) || isUnknown(b)) {
          return null
        }
        if (isUnorderable(a) || isUnorderable(b)) {
          return isUnorderable(b) && !isUnorderable(a)
        }
        return a < b
      }
    }
    case `lte`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        // In 3-valued logic, any comparison with null/undefined returns UNKNOWN
        if (isUnknown(a) || isUnknown(b)) {
          return null
        }
        if (isUnorderable(a) || isUnorderable(b)) {
          return isUnorderable(b)
        }
        return a <= b
      }
    }

    // Boolean operators
    case `and`:
      return (data) => {
        // 3-valued logic for AND:
        // - false AND anything = false (short-circuit)
        // - null AND false = false
        // - null AND anything (except false) = null
        // - anything (except false) AND null = null
        // - true AND true = true
        let hasUnknown = false
        for (const compiledArg of compiledArgs) {
          const result = compiledArg(data)
          if (result === false) {
            return false
          }
          if (isUnknown(result)) {
            hasUnknown = true
          }
        }
        // If we got here, no operand was false
        // If any operand was null, return null (UNKNOWN)
        if (hasUnknown) {
          return null
        }

        return true
      }
    case `or`:
      return (data) => {
        // 3-valued logic for OR:
        // - true OR anything = true (short-circuit)
        // - null OR anything (except true) = null
        // - false OR false = false
        let hasUnknown = false
        for (const compiledArg of compiledArgs) {
          const result = compiledArg(data)
          if (result === true) {
            return true
          }
          if (isUnknown(result)) {
            hasUnknown = true
          }
        }
        // If we got here, no operand was true
        // If any operand was null, return null (UNKNOWN)
        if (hasUnknown) {
          return null
        }

        return false
      }
    case `not`: {
      const arg = compiledArgs[0]!
      return (data) => {
        // 3-valued logic for NOT:
        // - NOT null = null
        // - NOT true = false
        // - NOT false = true
        const result = arg(data)
        if (isUnknown(result)) {
          return null
        }
        return !result
      }
    }

    // Array operators
    case `in`: {
      const valueEvaluator = compiledArgs[0]!
      const arrayEvaluator = compiledArgs[1]!

      // Fast path: a constant array of simple primitives can be probed with a
      // Set instead of a linear scan with deep equality per element.
      const arrayArg = func.args[1]
      if (arrayArg?.type === `val` && Array.isArray(arrayArg.value)) {
        const values = arrayArg.value
        const allSimple = values.every((item: any) => {
          const t = typeof item
          return (
            (t === `string` ||
              t === `boolean` ||
              t === `bigint` ||
              (t === `number` && !Number.isNaN(item))) &&
            item !== null
          )
        })
        if (allSimple) {
          const set = new Set(values)
          return (data) => {
            const value = normalizeValue(valueEvaluator(data))
            // In 3-valued logic, if the value is null/undefined, return UNKNOWN
            if (isUnknown(value)) {
              return null
            }
            return set.has(value)
          }
        }
      }

      return (data) => {
        const value = normalizeValue(valueEvaluator(data))
        const array = arrayEvaluator(data)
        // In 3-valued logic, if the value is null/undefined, return UNKNOWN
        if (isUnknown(value)) {
          return null
        }
        if (!Array.isArray(array)) {
          return false
        }
        return array.some((item) => valuesEqual(normalizeValue(item), value))
      }
    }

    // String operators
    case `like`: {
      const valueEvaluator = compiledArgs[0]!
      const patternEvaluator = compiledArgs[1]!
      return (data) => {
        const value = valueEvaluator(data)
        const pattern = patternEvaluator(data)
        // In 3-valued logic, if value or pattern is null/undefined, return UNKNOWN
        if (isUnknown(value) || isUnknown(pattern)) {
          return null
        }
        return evaluateLike(value, pattern, false)
      }
    }
    case `ilike`: {
      const valueEvaluator = compiledArgs[0]!
      const patternEvaluator = compiledArgs[1]!
      return (data) => {
        const value = valueEvaluator(data)
        const pattern = patternEvaluator(data)
        // In 3-valued logic, if value or pattern is null/undefined, return UNKNOWN
        if (isUnknown(value) || isUnknown(pattern)) {
          return null
        }
        return evaluateLike(value, pattern, true)
      }
    }

    // String functions
    case `upper`: {
      const arg = compiledArgs[0]!
      return (data) => {
        const value = arg(data)
        return typeof value === `string` ? value.toUpperCase() : value
      }
    }
    case `lower`: {
      const arg = compiledArgs[0]!
      return (data) => {
        const value = arg(data)
        return typeof value === `string` ? value.toLowerCase() : value
      }
    }
    case `length`: {
      const arg = compiledArgs[0]!
      return (data) => {
        const value = arg(data)
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
      return (data) => {
        return compiledArgs
          .map((evaluator) => {
            const arg = evaluator(data)
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
      return (data) => {
        for (const evaluator of compiledArgs) {
          const value = evaluator(data)
          if (value !== null && value !== undefined) {
            return value
          }
        }
        return null
      }
    case `caseWhen`: {
      const hasDefaultValue = compiledArgs.length % 2 === 1
      const pairCount = Math.floor(compiledArgs.length / 2)

      if (compiledArgs.length < 2) {
        throw new Error(`caseWhen() requires at least two arguments`)
      }

      return (data) => {
        for (let i = 0; i < pairCount; i++) {
          const condition = compiledArgs[i * 2]!
          if (isCaseWhenConditionTrue(condition(data))) {
            const value = compiledArgs[i * 2 + 1]!
            return value(data)
          }
        }

        if (hasDefaultValue) {
          return compiledArgs[compiledArgs.length - 1]!(data)
        }

        return null
      }
    }

    // Math functions
    case `add`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        return (a ?? 0) + (b ?? 0)
      }
    }
    case `subtract`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        return (a ?? 0) - (b ?? 0)
      }
    }
    case `multiply`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        return (a ?? 0) * (b ?? 0)
      }
    }
    case `divide`: {
      const argA = compiledArgs[0]!
      const argB = compiledArgs[1]!
      return (data) => {
        const a = argA(data)
        const b = argB(data)
        const divisor = b ?? 0
        return divisor !== 0 ? (a ?? 0) / divisor : null
      }
    }
    case `date`: {
      const arg = compiledArgs[0]!
      return (data) => {
        const value = arg(data)
        const dateValue = toDateValue(value)
        return dateValue ? dateValue.toISOString().slice(0, 10) : null
      }
    }
    case `datetime`: {
      const arg = compiledArgs[0]!
      return (data) => {
        const value = arg(data)
        const dateValue = toDateValue(value)
        return dateValue ? dateValue.toISOString() : null
      }
    }
    case `strftime`: {
      const formatArg = compiledArgs[0]!
      const sourceArg = compiledArgs[1]!
      return (data) => {
        const format = formatArg(data)
        if (typeof format !== `string`) {
          return null
        }
        const sourceValue = sourceArg(data)
        const dateValue = toDateValue(sourceValue)
        if (!dateValue) {
          return null
        }
        return evaluateStrftime(format, dateValue)
      }
    }

    // Null/undefined checking functions
    case `isUndefined`: {
      const arg = compiledArgs[0]!
      return (data) => {
        const value = arg(data)
        return value === undefined
      }
    }
    case `isNull`: {
      const arg = compiledArgs[0]!
      return (data) => {
        const value = arg(data)
        return value === null
      }
    }

    default:
      throw new UnknownFunctionError(func.name)
  }
}

export function isCaseWhenConditionTrue(value: any): boolean {
  if (value == null || value === false) {
    return false
  }

  if (value === true) {
    return true
  }

  if (typeof value === `number`) {
    return value !== 0 && !Number.isNaN(value)
  }

  if (typeof value === `bigint`) {
    return value !== 0n
  }

  return Boolean(value)
}

/**
 * Evaluates LIKE/ILIKE patterns
 */
function evaluateLike(
  value: any,
  pattern: any,
  caseInsensitive: boolean,
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

  // 's' (dotAll flag) makes '.' match all characters including line terminations
  const regex = new RegExp(`^${regexPattern}$`, 's')
  return regex.test(searchValue)
}
