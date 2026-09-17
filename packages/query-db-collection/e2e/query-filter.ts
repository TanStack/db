/**
 * Query-driven sync implementation for Query collection E2E tests
 * Conditional scalar backend: expression parsing is driver wiring, not an
 * independent database oracle. Backend self-tests state literal expectations.
 */

import { getLoadSubsetDemandKey, parseLoadSubsetOptions } from '@tanstack/db'
import type {
  IR,
  LoadSubsetOptions,
  ParsedOrderBy,
  SimpleComparison,
} from '@tanstack/db'

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

function scalar(
  value: unknown,
): string | number | bigint | boolean | null | undefined {
  if (value instanceof Date) value = value.getTime()
  if (
    value === null ||
    value === undefined ||
    typeof value === `string` ||
    typeof value === `boolean` ||
    typeof value === `bigint` ||
    (typeof value === `number` && Number.isFinite(value))
  )
    return value
  throw new Error(`Unsupported Query test-backend scalar`)
}

function validateRequest(options: LoadSubsetOptions): void {
  const unary = new Set([
    `not`,
    `isNull`,
    `isNotNull`,
    `isUndefined`,
    `isNotUndefined`,
    `lower`,
    `upper`,
  ])
  const binary = new Set([
    `eq`,
    `neq`,
    `ne`,
    `notEq`,
    `gt`,
    `gte`,
    `lt`,
    `lte`,
    `in`,
    `inArray`,
    `like`,
    `ilike`,
  ])
  const walk = (expression: IR.BasicExpression, allowList = false): void => {
    if (expression.type === `val`) {
      if (Array.isArray(expression.value)) {
        if (!allowList)
          throw new Error(`Unsupported Query test-backend array operand`)
        for (const value of expression.value) scalar(value)
      } else scalar(expression.value)
      return
    }
    if (expression.type === `ref`) {
      if (expression.path.length === 0)
        throw new Error(`Unsupported Query test-backend empty reference`)
      return
    }
    if (
      !(
        (unary.has(expression.name) && expression.args.length === 1) ||
        (binary.has(expression.name) && expression.args.length === 2) ||
        expression.name === `and` ||
        expression.name === `or`
      )
    )
      throw new Error(
        `Unsupported Query test-backend expression: ${expression.name}`,
      )
    // Walk all branches before evaluating rows, including empty datasets and
    // branches whose truth value would otherwise short-circuit evaluation.
    if (expression.name === `in` || expression.name === `inArray`) {
      const right = expression.args[1]!
      if (right.type !== `val` || !Array.isArray(right.value))
        throw new Error(`Unsupported Query test-backend IN operand`)
      walk(expression.args[0]!)
      walk(right, true)
    } else expression.args.forEach((arg) => walk(arg))
  }
  if (options.where) walk(options.where)
  for (const clause of options.orderBy ?? []) {
    if (clause.expression.type !== `ref` || clause.expression.path.length === 0)
      throw new Error(`Unsupported Query test-backend order expression`)
    const comparison = clause.compareOptions
    if (
      ![`asc`, `desc`].includes(comparison.direction) ||
      ![`first`, `last`].includes(comparison.nulls)
    )
      throw new Error(`Unsupported Query test-backend order options`)
    if (
      `stringSort` in comparison &&
      comparison.stringSort !== undefined &&
      ![`lexical`, `locale`].includes(comparison.stringSort)
    )
      throw new Error(`Unsupported Query test-backend string order`)
    if (`localeOptions` in comparison && comparison.localeOptions) {
      const allowed = new Set([
        `usage`,
        `localeMatcher`,
        `collation`,
        `numeric`,
        `caseFirst`,
        `sensitivity`,
        `ignorePunctuation`,
      ])
      if (
        Object.keys(comparison.localeOptions).some((key) => !allowed.has(key))
      )
        throw new Error(`Unsupported Query test-backend locale option`)
    }
    if (
      comparison.stringSort !== `locale` &&
      ((`locale` in comparison && comparison.locale !== undefined) ||
        (`localeOptions` in comparison &&
          comparison.localeOptions !== undefined))
    )
      throw new Error(`Unsupported Query test-backend lexical locale options`)
    if (comparison.stringSort === `locale`)
      new Intl.Collator(comparison.locale, comparison.localeOptions)
  }
  for (const window of [options.offset, options.limit]) {
    if (window !== undefined && (!Number.isSafeInteger(window) || window < 0))
      throw new Error(`Unsupported Query test-backend window`)
  }
  // This provider uses offset pagination. The public CursorExpressions contract
  // allows it to ignore cursor hints supplied alongside offset.
}

/**
 * Build a stable TanStack Query key for load subset options
 */
export function buildQueryKey(
  namespace: string,
  options: LoadSubsetOptions | undefined,
) {
  return [
    `e2e`,
    namespace,
    options === undefined ? undefined : getLoadSubsetDemandKey(options),
  ]
}

type Predicate<T> = (item: T) => boolean

function isBasicExpression(
  expr: IR.BasicExpression | null | undefined,
): expr is IR.BasicExpression {
  return expr != null
}

/**
 * Apply LoadSubsetOptions to data (filter, sort, limit, offset)
 */
export function applyPredicates<T>(
  data: Array<T>,
  options: LoadSubsetOptions | undefined,
): Array<T> {
  if (!options) return data
  validateRequest(options)
  const validateReferences = (expression: IR.BasicExpression, row: T): void => {
    if (expression.type === `ref`) scalar(getFieldValue(row, expression.path))
    if (expression.type === `func`)
      expression.args.forEach((arg) => validateReferences(arg, row))
  }
  for (const row of data) {
    if (options.where) validateReferences(options.where, row)
    for (const clause of options.orderBy ?? [])
      validateReferences(clause.expression, row)
  }

  // Parse options: try simple comparisons first (faster path), fall back to expression evaluation if needed
  // extractSimpleComparisons (called by parseLoadSubsetOptions) intentionally throws for unsupported operators
  // like 'like', 'ilike', 'or', etc. When that happens, we use buildExpressionPredicate instead.
  let filters: Array<SimpleComparison> = []
  let sorts: Array<ParsedOrderBy> = []
  let limit: number | undefined = undefined
  const offset = options.offset ?? 0

  // Check if where clause is simple before trying to parse
  const hasComplexWhere = options.where && !isSimpleExpression(options.where)

  if (!hasComplexWhere) {
    // Simple expression - parse everything at once
    try {
      const parsed = parseLoadSubsetOptions(options)
      filters = parsed.filters
      sorts = parsed.sorts
      limit = parsed.limit
    } catch (error) {
      if (DEBUG_SUMMARY) {
        console.log(
          `[query-filter] parseLoadSubsetOptions failed unexpectedly`,
          error,
        )
      }
      throw error
    }
  } else {
    // Complex expression (like/ilike/or/etc.) - cannot use simple comparisons
    // We'll filter using buildExpressionPredicate which evaluates the full expression tree
    // filters stays empty - this signals buildFilterPredicate to use buildExpressionPredicate instead of buildSimplePredicate
    // Note: Filtering still happens! Just via a different path (expression evaluation vs simple comparisons)

    limit = options.limit

    if (options.orderBy) {
      const orderByParsed = parseLoadSubsetOptions({
        orderBy: options.orderBy,
      })
      sorts = orderByParsed.sorts
    }

    if (DEBUG_SUMMARY) {
      console.log(
        `[query-filter] complex where clause detected, will filter using buildExpressionPredicate`,
      )
    }
  }

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
      offset,
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
    const collators = new Map(
      sorts
        .filter((sort) => sort.stringSort === `locale`)
        .map((sort) => [
          sort,
          new Intl.Collator(sort.locale, sort.localeOptions),
        ]),
    )
    result.sort((a, b) => compareBySorts(a, b, sorts, collators))
    if (DEBUG_SUMMARY) {
      console.log(`[query-filter] after orderBy`, {
        size: result.length,
      })
    }
  }

  // Apply OFFSET and LIMIT
  // For pagination: offset skips rows, limit caps the result
  if (offset > 0 || limit !== undefined) {
    const start = offset
    const end = limit !== undefined ? offset + limit : undefined
    result = result.slice(start, end)
    if (DEBUG_SUMMARY) {
      console.log(`[query-filter] after offset/limit`, {
        size: result.length,
        offset,
        limit,
      })
    }
  }

  return result
}

/**
 * Build a predicate function from expression tree
 *
 * Two paths:
 * 1. Simple expressions (eq, gt, etc.) with parsed filters -> buildSimplePredicate (faster)
 * 2. Complex expressions (like, ilike, or, etc.) or empty filters -> buildExpressionPredicate (full expression evaluation)
 */
function buildFilterPredicate<T>(
  where: IR.BasicExpression<boolean> | undefined,
  filters: Array<SimpleComparison>,
): Predicate<T> | undefined {
  if (!where) {
    return undefined
  }

  // Use simple predicate if we have parsed filters (fast path for eq, gt, etc.)
  if (filters.length > 0 && isSimpleExpression(where)) {
    return buildSimplePredicate<T>(filters)
  }

  // Otherwise, use expression predicate (handles like, ilike, or, etc.)
  // This still filters! It just evaluates the expression tree directly instead of using parsed comparisons
  try {
    return buildExpressionPredicate<T>(where)
  } catch (error) {
    if (DEBUG_SUMMARY) {
      console.warn(`[query-filter] failed to build expression predicate`, error)
    }
    throw error
  }
}

function buildSimplePredicate<T>(
  filters: Array<SimpleComparison>,
): Predicate<T> {
  return (item: T) =>
    filters.every((comparison) => evaluateSimpleComparison(comparison, item))
}

function evaluateSimpleComparison<T>(
  comparison: SimpleComparison,
  item: T,
): boolean {
  const actualValue = getFieldValue(item, comparison.field)
  const expectedValue = comparison.value

  const negated = comparison.operator.startsWith(`not_`)
  const operator = negated ? comparison.operator.slice(4) : comparison.operator
  const result = evaluateFunction(operator, [actualValue, expectedValue])
  return (negated ? evaluateFunction(`not`, [result]) : result) === true
}

function isSimpleExpression(expr: IR.BasicExpression): boolean {
  if (expr.type !== `func`) {
    return false
  }

  if (expr.name === `and`) {
    return expr.args.every(
      (arg): arg is IR.BasicExpression =>
        Boolean(arg) && arg.type === `func` && isSimpleExpression(arg),
    )
  }

  // Handle NOT wrapping simple expressions
  if (expr.name === `not`) {
    const [arg] = expr.args
    if (!arg || arg.type !== `func`) {
      return false
    }
    // NOT can wrap comparison operators or null checks
    return arg.name !== `and` && arg.name !== `not` && isSimpleExpression(arg)
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
  return (
    leftArg?.type === `ref` &&
    rightArg?.type === `val` &&
    rightArg.value !== undefined
  )
}

function buildExpressionPredicate<T>(
  expr: IR.BasicExpression<boolean>,
): Predicate<T> {
  return (item: T) => evaluateExpression(expr, item) === true
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
  if (
    [`and`, `or`, `not`].includes(name) &&
    args.some((value) => value != null && typeof value !== `boolean`)
  )
    throw new Error(`Unsupported Query test-backend boolean operand`)
  if ([`eq`, `neq`, `ne`, `notEq`, `gt`, `gte`, `lt`, `lte`].includes(name)) {
    const left = scalar(args[0])
    const right = scalar(args[1])
    if (left == null || right == null) return null
    if (name === `eq`) return left === right
    if ([`neq`, `ne`, `notEq`].includes(name)) return left !== right
    if (typeof left !== typeof right)
      throw new Error(`Unsupported Query test-backend mixed comparison`)
    if (name === `gt`) return left > right
    if (name === `gte`) return left >= right
    if (name === `lt`) return left < right
    return left <= right
  }
  switch (name) {
    case `and`:
      return args.includes(false)
        ? false
        : args.some((value) => value == null)
          ? null
          : true
    case `or`:
      return args.includes(true)
        ? true
        : args.some((value) => value == null)
          ? null
          : false
    case `not`:
      return args[0] == null ? null : !args[0]
    case `in`:
    case `inArray`: {
      const value = scalar(args[0])
      if (value == null) return null
      if (!Array.isArray(args[1]))
        throw new Error(`Unsupported Query test-backend IN operand`)
      return args[1].some((entry) => scalar(entry) === value)
    }
    case `isNull`:
      return args[0] === null
    case `isNotNull`:
      return args[0] !== null
    case `isUndefined`:
      return args[0] === undefined
    case `isNotUndefined`:
      return args[0] !== undefined
    case `like`:
      return evaluateLike(args[0], args[1], false)
    case `ilike`:
      return evaluateLike(args[0], args[1], true)
    case `lower`:
      if (args[0] != null && typeof args[0] !== `string`)
        throw new Error(`Unsupported Query test-backend string operand`)
      return typeof args[0] === `string` ? args[0].toLowerCase() : args[0]
    case `upper`:
      if (args[0] != null && typeof args[0] !== `string`)
        throw new Error(`Unsupported Query test-backend string operand`)
      return typeof args[0] === `string` ? args[0].toUpperCase() : args[0]
    default:
      throw new Error(`Unsupported predicate operator: ${name}`)
  }
}

/**
 * Evaluates LIKE/ILIKE patterns
 * Converts SQL LIKE pattern to regex for JavaScript matching
 * Returns null for 3-valued logic (UNKNOWN) when value or pattern is null/undefined
 */
function evaluateLike(
  value: any,
  pattern: any,
  caseInsensitive: boolean,
): boolean | null {
  // In 3-valued logic, if value or pattern is null/undefined, return UNKNOWN (null)
  if (
    value === null ||
    value === undefined ||
    pattern === null ||
    pattern === undefined
  ) {
    return null
  }

  if (typeof value !== `string` || typeof pattern !== `string`) {
    throw new Error(`Unsupported Query test-backend LIKE operand`)
  }

  const searchValue = caseInsensitive ? value.toLowerCase() : value
  const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern

  // Convert SQL LIKE pattern to regex
  // First escape all regex special chars except % and _
  let regexPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)

  // Then convert SQL wildcards to regex
  regexPattern = regexPattern.replace(/%/g, `.*`) // % matches any sequence
  regexPattern = regexPattern.replace(/_/g, `.`) // _ matches any single char

  const regex = new RegExp(`^${regexPattern}$`, 's')
  return regex.test(searchValue)
}

function compareBySorts<T>(
  a: T,
  b: T,
  sorts: Array<ParsedOrderBy>,
  collators: Map<ParsedOrderBy, Intl.Collator>,
): number {
  for (const sort of sorts) {
    const aVal = getFieldValue(a, sort.field)
    const bVal = getFieldValue(b, sort.field)

    const collator = collators.get(sort)
    const result =
      collator && typeof aVal === `string` && typeof bVal === `string`
        ? collator.compare(aVal, bVal) * (sort.direction === `asc` ? 1 : -1)
        : compareValues(aVal, bVal, sort.direction, sort.nulls)
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
  nulls?: `first` | `last`,
): number {
  a = scalar(a)
  b = scalar(b)
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

  if (typeof a !== typeof b)
    throw new Error(`Unsupported Query test-backend mixed order`)
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

  const value = fieldPath.reduce((current, key) => current?.[key], obj)

  if (DEBUG_VERBOSE) {
    console.log(`[query-filter] getFieldValue`, fieldPath, `->`, value)
  }

  return value
}
