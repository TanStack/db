/**
 * Expression Helpers for Query Collections
 *
 * These utilities help parse LoadSubsetOptions (where, orderBy, limit) from TanStack DB
 * into formats suitable for your API backend. They provide a generic way to traverse
 * expression trees without having to implement your own parser.
 *
 * @example
 * ```typescript
 * import { parseWhereExpression, parseOrderByExpression } from '@tanstack/query-db-collection'
 *
 * queryFn: async (ctx) => {
 *   const { limit, where, orderBy } = ctx.meta?.loadSubsetOptions ?? {}
 *
 *   // Convert expression tree to filters
 *   const filters = parseWhereExpression(where, {
 *     eq: (field, value) => ({ [field]: value }),
 *     lt: (field, value) => ({ [`${field}_lt`]: value }),
 *     and: (filters) => Object.assign({}, ...filters)
 *   })
 *
 *   // Extract sort information
 *   const sort = parseOrderByExpression(orderBy)
 *
 *   return api.getProducts({ ...filters, sort, limit })
 * }
 * ```
 */

import type { BasicExpression, OrderBy } from "@tanstack/db"

/**
 * Represents a simple field path extracted from an expression
 */
export type FieldPath = Array<string>

/**
 * Represents a simple comparison operation
 */
export interface SimpleComparison {
  field: FieldPath
  operator: string
  value: any
}

/**
 * Options for customizing how WHERE expressions are parsed
 */
export interface ParseWhereOptions<T = any> {
  /**
   * Handler functions for different operators.
   * Each handler receives the parsed field path(s) and value(s) and returns your custom format.
   *
   * Common operators:
   * - eq: equality (=)
   * - gt: greater than (>)
   * - gte: greater than or equal (>=)
   * - lt: less than (<)
   * - lte: less than or equal (<=)
   * - and: logical AND
   * - or: logical OR
   * - in: IN clause
   */
  handlers: {
    [operator: string]: (...args: Array<any>) => T
  }
  /**
   * Optional handler for when an unknown operator is encountered.
   * If not provided, unknown operators throw an error.
   */
  onUnknownOperator?: (operator: string, args: Array<any>) => T
}

/**
 * Result of parsing an ORDER BY expression
 */
export interface ParsedOrderBy {
  field: FieldPath
  direction: `asc` | `desc`
  nulls?: `first` | `last`
}

/**
 * Extracts the field path from a PropRef expression.
 * Returns null for non-ref expressions.
 *
 * @param expr - The expression to extract from
 * @returns The field path array, or null
 *
 * @example
 * ```typescript
 * const field = extractFieldPath(someExpression)
 * // Returns: ['product', 'category']
 * ```
 */
export function extractFieldPath(expr: BasicExpression): FieldPath | null {
  if (expr.type === `ref`) {
    return expr.path
  }
  return null
}

/**
 * Extracts the value from a Value expression.
 * Returns undefined for non-value expressions.
 *
 * @param expr - The expression to extract from
 * @returns The extracted value
 *
 * @example
 * ```typescript
 * const val = extractValue(someExpression)
 * // Returns: 'electronics'
 * ```
 */
export function extractValue(expr: BasicExpression): any {
  if (expr.type === `val`) {
    return expr.value
  }
  return undefined
}

/**
 * Generic expression tree walker that visits each node in the expression.
 * Useful for implementing custom parsing logic.
 *
 * @param expr - The expression to walk
 * @param visitor - Visitor function called for each node
 *
 * @example
 * ```typescript
 * walkExpression(whereExpr, (node) => {
 *   if (node.type === 'func' && node.name === 'eq') {
 *     console.log('Found equality comparison')
 *   }
 * })
 * ```
 */
export function walkExpression(
  expr: BasicExpression | undefined | null,
  visitor: (expr: BasicExpression) => void
): void {
  if (!expr) return

  visitor(expr)

  if (expr.type === `func`) {
    expr.args.forEach((arg) => walkExpression(arg, visitor))
  }
}

/**
 * Parses a WHERE expression into a custom format using provided handlers.
 *
 * This is the main helper for converting TanStack DB where clauses into your API's filter format.
 * You provide handlers for each operator, and this function traverses the expression tree
 * and calls the appropriate handlers.
 *
 * @param expr - The WHERE expression to parse
 * @param options - Configuration with handler functions for each operator
 * @returns The parsed result in your custom format
 *
 * @example
 * ```typescript
 * // REST API with query parameters
 * const filters = parseWhereExpression(where, {
 *   handlers: {
 *     eq: (field, value) => ({ [field.join('.')]: value }),
 *     lt: (field, value) => ({ [`${field.join('.')}_lt`]: value }),
 *     gt: (field, value) => ({ [`${field.join('.')}_gt`]: value }),
 *     and: (...filters) => Object.assign({}, ...filters),
 *     or: (...filters) => ({ $or: filters })
 *   }
 * })
 * // Returns: { category: 'electronics', price_lt: 100 }
 * ```
 *
 * @example
 * ```typescript
 * // GraphQL where clause
 * const where = parseWhereExpression(whereExpr, {
 *   handlers: {
 *     eq: (field, value) => ({ [field.join('_')]: { _eq: value } }),
 *     lt: (field, value) => ({ [field.join('_')]: { _lt: value } }),
 *     and: (...filters) => ({ _and: filters })
 *   }
 * })
 * ```
 */
export function parseWhereExpression<T = any>(
  expr: BasicExpression<boolean> | undefined | null,
  options: ParseWhereOptions<T>
): T | null {
  if (!expr) return null

  const { handlers, onUnknownOperator } = options

  // Handle value expressions
  if (expr.type === `val`) {
    return expr.value as unknown as T
  }

  // Handle property references
  if (expr.type === `ref`) {
    return expr.path as unknown as T
  }

  // Handle function expressions
  if (expr.type === `func`) {
    const { name, args } = expr
    const handler = handlers[name]

    if (!handler) {
      if (onUnknownOperator) {
        return onUnknownOperator(name, args)
      }
      throw new Error(
        `No handler provided for operator: ${name}. Available handlers: ${Object.keys(handlers).join(`, `)}`
      )
    }

    // Parse arguments recursively
    const parsedArgs = args.map((arg) => {
      // For refs, extract the field path
      if (arg.type === `ref`) {
        return arg.path
      }
      // For values, extract the value
      if (arg.type === `val`) {
        return arg.value
      }
      // For nested functions, recurse
      if (arg.type === `func`) {
        return parseWhereExpression(arg, options)
      }
      return arg
    })

    return handler(...parsedArgs)
  }

  return null
}

/**
 * Parses an ORDER BY expression into a simple array of sort specifications.
 *
 * @param orderBy - The ORDER BY expression array
 * @returns Array of parsed order by specifications
 *
 * @example
 * ```typescript
 * const sorts = parseOrderByExpression(orderBy)
 * // Returns: [
 * //   { field: ['category'], direction: 'asc', nulls: 'last' },
 * //   { field: ['price'], direction: 'desc', nulls: 'last' }
 * // ]
 * ```
 */
export function parseOrderByExpression(
  orderBy: OrderBy | undefined | null
): Array<ParsedOrderBy> {
  if (!orderBy || orderBy.length === 0) {
    return []
  }

  return orderBy.map((clause) => {
    const field = extractFieldPath(clause.expression)

    if (!field) {
      throw new Error(
        `ORDER BY expression must be a field reference, got: ${clause.expression.type}`
      )
    }

    return {
      field,
      direction: clause.compareOptions.direction,
      nulls: clause.compareOptions.nulls,
    }
  })
}

/**
 * Extracts all simple comparisons from a WHERE expression.
 * This is useful for simple APIs that only support basic filters.
 *
 * Note: This only works for simple AND-ed conditions. Complex OR/nested conditions
 * will require using parseWhereExpression with custom handlers.
 *
 * @param expr - The WHERE expression to parse
 * @returns Array of simple comparisons
 *
 * @example
 * ```typescript
 * const comparisons = extractSimpleComparisons(where)
 * // Returns: [
 * //   { field: ['category'], operator: 'eq', value: 'electronics' },
 * //   { field: ['price'], operator: 'lt', value: 100 }
 * // ]
 * ```
 */
export function extractSimpleComparisons(
  expr: BasicExpression<boolean> | undefined | null
): Array<SimpleComparison> {
  if (!expr) return []

  const comparisons: Array<SimpleComparison> = []

  function extract(e: BasicExpression): void {
    if (e.type === `func`) {
      // Handle AND - recurse into both sides
      if (e.name === `and`) {
        e.args.forEach((arg) => extract(arg as BasicExpression))
        return
      }

      // Handle comparison operators
      const comparisonOps = [`eq`, `gt`, `gte`, `lt`, `lte`, `in`]
      if (comparisonOps.includes(e.name)) {
        const [leftArg, rightArg] = e.args

        // Extract field and value
        const field = leftArg?.type === `ref` ? leftArg.path : null
        const value = rightArg?.type === `val` ? rightArg.value : null

        if (field && value !== undefined) {
          comparisons.push({
            field,
            operator: e.name,
            value,
          })
        }
      }
    }
  }

  extract(expr)
  return comparisons
}

/**
 * Convenience function to get all LoadSubsetOptions in a pre-parsed format.
 * Good starting point for simple use cases.
 *
 * @param options - The LoadSubsetOptions from ctx.meta
 * @returns Pre-parsed filters, sorts, and limit
 *
 * @example
 * ```typescript
 * queryFn: async (ctx) => {
 *   const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
 *
 *   // Convert to your API format
 *   return api.getProducts({
 *     ...Object.fromEntries(
 *       parsed.filters.map(f => [`${f.field.join('.')}_${f.operator}`, f.value])
 *     ),
 *     sort: parsed.sorts.map(s => `${s.field.join('.')}:${s.direction}`).join(','),
 *     limit: parsed.limit
 *   })
 * }
 * ```
 */
export function parseLoadSubsetOptions(
  options:
    | {
        where?: BasicExpression<boolean>
        orderBy?: OrderBy
        limit?: number
      }
    | undefined
    | null
): {
  filters: Array<SimpleComparison>
  sorts: Array<ParsedOrderBy>
  limit?: number
} {
  if (!options) {
    return { filters: [], sorts: [] }
  }

  return {
    filters: extractSimpleComparisons(options.where),
    sorts: parseOrderByExpression(options.orderBy),
    limit: options.limit,
  }
}
