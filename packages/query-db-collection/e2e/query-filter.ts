/**
 * Query-driven sync implementation for Query collection E2E tests
 * Uses expression helpers to implement proper predicate push-down
 */

import { parseLoadSubsetOptions } from "@tanstack/db"
import type {
  IR,
  LoadSubsetOptions,
  ParsedOrderBy,
  SimpleComparison,
} from "@tanstack/db"

const DEBUG_VERBOSE = process.env.DEBUG_QUERY_PUSH === `1`
const DEBUG_SUMMARY =
  DEBUG_VERBOSE || process.env.DEBUG_QUERY_PUSH_SUMMARY === `1`
const SIMPLE_OPERATORS = new Set([
  `eq`,
  `gt`,
  `gte`,
  `lt`,
  `lte`,
  `in`,
  `isNull`,
  `isUndefined`,
  // NOT-wrapped operators (flattened by extractSimpleComparisons)
  `not_eq`,
  `not_gt`,
  `not_gte`,
  `not_lt`,
  `not_lte`,
  `not_in`,
  `not_isNull`,
  `not_isUndefined`,
])

/**
 * Build a stable TanStack Query key for load subset options
 */
export function buildQueryKey(
  namespace: string,
  options: LoadSubsetOptions | undefined
) {
  return [`e2e`, namespace, serializeLoadSubsetOptions(options)]
}

export function serializeLoadSubsetOptions(
  options: LoadSubsetOptions | undefined
): unknown {
  if (!options) {
    return null
  }

  const result: Record<string, unknown> = {}

  if (options.where) {
    result.where = serializeExpression(options.where)
  }

  if (options.orderBy?.length) {
    result.orderBy = options.orderBy.map((clause) => ({
      expression: serializeExpression(clause.expression),
      direction: clause.compareOptions.direction,
      nulls: clause.compareOptions.nulls,
    }))
  }

  if (options.limit !== undefined) {
    result.limit = options.limit
  }

  return JSON.stringify(Object.keys(result).length === 0 ? null : result)
}

function serializeExpression(expr: IR.BasicExpression | undefined): unknown {
  if (!expr) {
    return null
  }

  switch (expr.type) {
    case `val`:
      return {
        type: `val`,
        value: serializeValue(expr.value),
      }
    case `ref`:
      return {
        type: `ref`,
        path: [...expr.path],
      }
    case `func`:
      return {
        type: `func`,
        name: expr.name,
        args: expr.args.map((arg) => serializeExpression(arg)),
      }
    default:
      return null
  }
}

function serializeValue(value: unknown): unknown {
  if (value === undefined) {
    return { __type: `undefined` }
  }

  if (typeof value === `number`) {
    if (Number.isNaN(value)) {
      return { __type: `nan` }
    }
    if (value === Number.POSITIVE_INFINITY) {
      return { __type: `infinity`, sign: 1 }
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return { __type: `infinity`, sign: -1 }
    }
  }

  if (
    value === null ||
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `boolean`
  ) {
    return value
  }

  if (value instanceof Date) {
    return { __type: `date`, value: value.toJSON() }
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item))
  }

  if (typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        serializeValue(val),
      ])
    )
  }

  return value
}

type Predicate<T> = (item: T) => boolean

function isBasicExpression(
  expr: IR.BasicExpression | null | undefined
): expr is IR.BasicExpression {
  return expr != null
}

/**
 * Apply LoadSubsetOptions to data (filter, sort, limit)
 */
export function applyPredicates<T>(
  data: Array<T>,
  options: LoadSubsetOptions | undefined
): Array<T> {
  if (!options) return data

  const { filters, sorts, limit } = parseLoadSubsetOptions(options)
  if (DEBUG_SUMMARY) {
    const { limit: rawLimit, where, orderBy } = options
    const analysis = analyzeExpression(where)
    console.log(`[query-filter] loadSubsetOptions`, {
      hasWhere: Boolean(where),
      whereType: where?.type,
      whereName: where?.type === `func` ? (where as IR.Func).name : undefined,
      expressionSummary: analysis,
      hasOrderBy: Boolean(orderBy),
      limit: rawLimit,
      filtersCount: filters.length,
      sortsCount: sorts.length,
      initialSize: data.length,
    })
  }

  let result = [...data]

  // Apply WHERE filtering
  const predicate = buildFilterPredicate<T>(options.where, filters)
  if (predicate) {
    result = result.filter(predicate)
    if (DEBUG_SUMMARY) {
      console.log(`[query-filter] after where`, {
        size: result.length,
      })
    }
  }

  // Apply ORDER BY
  if (sorts.length > 0) {
    result.sort((a, b) => compareBySorts(a, b, sorts))
    if (DEBUG_SUMMARY) {
      console.log(`[query-filter] after orderBy`, {
        size: result.length,
      })
    }
  }

  // Apply LIMIT
  // Note: offset is NOT applied here - it's handled by the live query windowing layer
  // The limit passed here already accounts for offset (e.g., offset(20).limit(10) -> limit: 30)
  if (limit !== undefined) {
    result = result.slice(0, limit)
    if (DEBUG_SUMMARY) {
      console.log(`[query-filter] after limit`, {
        size: result.length,
        limit,
      })
    }
  }

  return result
}

/**
 * Build a predicate function from expression tree
 */
function buildFilterPredicate<T>(
  where: IR.BasicExpression<boolean> | undefined,
  filters: Array<SimpleComparison>
): Predicate<T> | undefined {
  if (!where) {
    return undefined
  }

  if (filters.length > 0 && isSimpleExpression(where)) {
    return buildSimplePredicate<T>(filters)
  }

  try {
    return buildExpressionPredicate<T>(where)
  } catch (error) {
    if (DEBUG_SUMMARY) {
      console.warn(`[query-filter] failed to build expression predicate`, error)
    }
    return undefined
  }
}

function buildSimplePredicate<T>(
  filters: Array<SimpleComparison>
): Predicate<T> {
  return (item: T) =>
    filters.every((comparison) => evaluateSimpleComparison(comparison, item))
}

function evaluateSimpleComparison<T>(
  comparison: SimpleComparison,
  item: T
): boolean {
  const actualValue = getFieldValue(item, comparison.field)
  const expectedValue = comparison.value

  switch (comparison.operator) {
    case `eq`:
      return actualValue === expectedValue
    case `gt`:
      return actualValue > expectedValue
    case `gte`:
      return actualValue >= expectedValue
    case `lt`:
      return actualValue < expectedValue
    case `lte`:
      return actualValue <= expectedValue
    case `in`:
      return Array.isArray(expectedValue)
        ? expectedValue.includes(actualValue)
        : false
    case `isNull`:
      return actualValue === null
    case `isUndefined`:
      return actualValue === undefined
    // NOT-wrapped operators (flattened)
    case `not_eq`:
      return actualValue !== expectedValue
    case `not_gt`:
      return !(actualValue > expectedValue)
    case `not_gte`:
      return !(actualValue >= expectedValue)
    case `not_lt`:
      return !(actualValue < expectedValue)
    case `not_lte`:
      return !(actualValue <= expectedValue)
    case `not_in`:
      return Array.isArray(expectedValue)
        ? !expectedValue.includes(actualValue)
        : true
    case `not_isNull`:
      return actualValue !== null
    case `not_isUndefined`:
      return actualValue !== undefined
    default:
      throw new Error(
        `Unsupported simple comparison operator: ${comparison.operator}`
      )
  }
}

function isSimpleExpression(expr: IR.BasicExpression): boolean {
  if (expr.type !== `func`) {
    return false
  }

  if (expr.name === `and`) {
    return expr.args.every(
      (arg): arg is IR.BasicExpression =>
        Boolean(arg) && arg.type === `func` && isSimpleExpression(arg)
    )
  }

  // Handle NOT wrapping simple expressions
  if (expr.name === `not`) {
    const [arg] = expr.args
    if (!arg || arg.type !== `func`) {
      return false
    }
    // NOT can wrap comparison operators or null checks
    return isSimpleExpression(arg)
  }

  if (!SIMPLE_OPERATORS.has(expr.name)) {
    return false
  }

  // Null/undefined checks take a single ref argument
  if (expr.name === `isNull` || expr.name === `isUndefined`) {
    const [fieldArg] = expr.args
    return fieldArg?.type === `ref`
  }

  // Comparison operators take ref and val arguments
  const [leftArg, rightArg] = expr.args
  return leftArg?.type === `ref` && rightArg?.type === `val`
}

function buildExpressionPredicate<T>(
  expr: IR.BasicExpression<boolean>
): Predicate<T> {
  return (item: T) => Boolean(evaluateExpression(expr, item))
}

function analyzeExpression(expr: IR.BasicExpression | undefined):
  | {
      hasIsNull: boolean
      hasIsUndefined: boolean
      hasEqNull: boolean
      rootName?: string
    }
  | undefined {
  if (!expr) return undefined

  const summary = {
    hasIsNull: false,
    hasIsUndefined: false,
    hasEqNull: false,
    rootName: expr.type === `func` ? expr.name : undefined,
  }

  function walk(node: IR.BasicExpression): void {
    if (node.type === `func`) {
      if (node.name === `isNull`) summary.hasIsNull = true
      if (node.name === `isUndefined`) summary.hasIsUndefined = true

      if (node.name === `eq`) {
        const right = node.args[1]
        if (right?.type === `val` && right.value === null) {
          summary.hasEqNull = true
        }
      }

      node.args.filter(isBasicExpression).forEach((child) => walk(child))
    }
  }

  walk(expr)
  return summary
}

function evaluateExpression<T>(expr: IR.BasicExpression, item: T): any {
  switch (expr.type) {
    case `val`:
      return expr.value
    case `ref`:
      return getFieldValue(item, expr.path)
    case `func`: {
      const args = expr.args.map((arg) => evaluateExpression(arg, item))
      return evaluateFunction(expr.name, args)
    }
    default:
      return undefined
  }
}

function evaluateFunction(name: string, args: Array<any>): any {
  if (DEBUG_VERBOSE) {
    console.log(`[query-filter] operator=${name}`, args)
  }
  switch (name) {
    case `eq`:
      return args[0] === args[1]
    case `neq`:
    case `ne`:
    case `notEq`:
      return args[0] !== args[1]
    case `gt`:
      return args[0] > args[1]
    case `gte`:
      return args[0] >= args[1]
    case `lt`:
      return args[0] < args[1]
    case `lte`:
      return args[0] <= args[1]
    case `and`:
      return args.every(Boolean)
    case `or`:
      return args.some(Boolean)
    case `not`:
      return !args[0]
    case `in`:
    case `inArray`:
      return Array.isArray(args[1]) ? args[1].includes(args[0]) : false
    case `isNull`:
      return args[0] === null
    case `isNotNull`:
      return args[0] !== null
    case `isUndefined`:
      return args[0] === undefined
    case `isNotUndefined`:
      return args[0] !== undefined
    default:
      throw new Error(`Unsupported predicate operator: ${name}`)
  }
}

function compareBySorts<T>(a: T, b: T, sorts: Array<ParsedOrderBy>): number {
  for (const sort of sorts) {
    const aVal = getFieldValue(a, sort.field)
    const bVal = getFieldValue(b, sort.field)

    const result = compareValues(aVal, bVal, sort.direction, sort.nulls)
    if (result !== 0) {
      return result
    }
  }

  return 0
}

function compareValues(
  a: any,
  b: any,
  direction: `asc` | `desc`,
  nulls?: `first` | `last`
): number {
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined

  if (aNull || bNull) {
    if (aNull && bNull) return 0
    if (nulls === `first`) {
      return aNull ? -1 : 1
    }
    if (nulls === `last`) {
      return aNull ? 1 : -1
    }
    // Default SQL behavior: treat nulls as lowest for ASC, highest for DESC
    if (direction === `asc`) {
      return aNull ? -1 : 1
    }
    return aNull ? 1 : -1
  }

  if (a < b) return direction === `asc` ? -1 : 1
  if (a > b) return direction === `asc` ? 1 : -1
  return 0
}

/**
 * Get nested field value from object
 */
function getFieldValue(obj: any, fieldPath: Array<string | number>): any {
  if (fieldPath.length === 0) {
    return undefined
  }

  let path = fieldPath

  if (
    path.length > 0 &&
    obj &&
    typeof path[0] === `string` &&
    !(path[0] in obj)
  ) {
    path = path.slice(1)
  }

  if (path.length === 0) {
    if (DEBUG_VERBOSE) {
      console.log(`[query-filter] getFieldValue alias`, fieldPath, `->`, obj)
    }
    return obj
  }

  const value = path.reduce((current, key) => current?.[key], obj)

  if (DEBUG_VERBOSE) {
    console.log(`[query-filter] getFieldValue`, fieldPath, `->`, value)
  }

  return value
}
