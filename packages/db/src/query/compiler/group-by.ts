import {
  filter,
  groupBy,
  groupByOperators,
  map,
  serializeValue,
} from '@tanstack/db-ivm'
import { Func, PropRef, getHavingExpression, isExpressionLike } from '../ir.js'
import {
  AggregateFunctionNotInSelectError,
  NonAggregateExpressionNotInGroupByError,
  UnknownHavingExpressionTypeError,
  UnsupportedAggregateFunctionError,
} from '../../errors.js'
import { compileExpression, toBooleanPredicate } from './evaluators.js'
import type {
  Aggregate,
  BasicExpression,
  GroupBy,
  Having,
  Select,
} from '../ir.js'
import type { NamespacedAndKeyedStream, NamespacedRow } from '../../types.js'

const { sum, count, avg, min, max } = groupByOperators

/**
 * Interface for caching the mapping between GROUP BY expressions and SELECT expressions
 */
interface GroupBySelectMapping {
  selectToGroupByIndex: Map<string, number> // Maps SELECT alias to GROUP BY expression index
  groupByExpressions: Array<any> // The GROUP BY expressions for reference
}

/**
 * Validates that all non-aggregate expressions in SELECT are present in GROUP BY
 * and creates a cached mapping for efficient lookup during processing
 */
function validateAndCreateMapping(
  groupByClause: GroupBy,
  selectClause?: Select,
): GroupBySelectMapping {
  const selectToGroupByIndex = new Map<string, number>()
  const groupByExpressions = [...groupByClause]

  if (!selectClause) {
    return { selectToGroupByIndex, groupByExpressions }
  }

  // Validate each SELECT expression
  for (const [alias, expr] of Object.entries(selectClause)) {
    if (expr.type === `agg` || containsAggregate(expr)) {
      // Aggregate expressions (plain or wrapped) are allowed and don't need to be in GROUP BY
      continue
    }

    // Non-aggregate expression must be in GROUP BY
    const groupIndex = groupByExpressions.findIndex((groupExpr) =>
      expressionsEqual(expr, groupExpr),
    )

    if (groupIndex === -1) {
      throw new NonAggregateExpressionNotInGroupByError(alias)
    }

    // Cache the mapping
    selectToGroupByIndex.set(alias, groupIndex)
  }

  return { selectToGroupByIndex, groupByExpressions }
}

/**
 * Processes the GROUP BY clause with optional HAVING and SELECT
 * Works with the new $selected structure from early SELECT processing
 */
export function processGroupBy(
  pipeline: NamespacedAndKeyedStream,
  groupByClause: GroupBy,
  havingClauses?: Array<Having>,
  selectClause?: Select,
  fnHavingClauses?: Array<(row: any) => any>,
): NamespacedAndKeyedStream {
  // Handle empty GROUP BY (single-group aggregation)
  if (groupByClause.length === 0) {
    // For single-group aggregation, create a single group with all data
    const aggregates: Record<string, any> = {}

    // Expressions that wrap aggregates (e.g. coalesce(count(...), 0)).
    // Keys are the original SELECT aliases; values are pre-compiled evaluators
    // over the transformed (aggregate-free) expression.
    const wrappedAggExprs: Record<string, (data: any) => any> = {}
    const aggCounter = { value: 0 }

    if (selectClause) {
      // Scan the SELECT clause for aggregate functions
      for (const [alias, expr] of Object.entries(selectClause)) {
        if (expr.type === `agg`) {
          aggregates[alias] = getAggregateFunction(expr)
        } else if (containsAggregate(expr)) {
          const { transformed, extracted } = extractAndReplaceAggregates(
            expr as BasicExpression | Aggregate,
            aggCounter,
          )
          for (const [syntheticAlias, aggExpr] of Object.entries(extracted)) {
            aggregates[syntheticAlias] = getAggregateFunction(aggExpr)
          }
          wrappedAggExprs[alias] = compileExpression(transformed)
        }
      }
    }

    // Use a constant key for single group
    const keyExtractor = () => ({ __singleGroup: true })

    // Apply the groupBy operator with single group
    pipeline = pipeline.pipe(
      groupBy(keyExtractor, aggregates),
    ) as NamespacedAndKeyedStream

    // Update $selected to include aggregate values
    pipeline = pipeline.pipe(
      map(([, aggregatedRow]) => {
        // Start with the existing $selected from early SELECT processing
        const selectResults = (aggregatedRow as any).$selected || {}
        const finalResults: Record<string, any> = { ...selectResults }

        if (selectClause) {
          // First pass: populate plain aggregate results and synthetic aliases
          for (const [alias, expr] of Object.entries(selectClause)) {
            if (expr.type === `agg`) {
              finalResults[alias] = aggregatedRow[alias]
            }
          }
          // Add synthetic aggregate values so wrapped expressions can reference them
          for (const key of Object.keys(aggregatedRow)) {
            if (key.startsWith(`__agg_`)) {
              finalResults[key] = aggregatedRow[key]
            }
          }
          // Second pass: evaluate wrapped-aggregate expressions
          for (const [alias, evaluator] of Object.entries(wrappedAggExprs)) {
            finalResults[alias] = evaluator({ $selected: finalResults })
          }
          // Clean up synthetic keys so they don't leak onto result rows
          for (const key of Object.keys(finalResults)) {
            if (key.startsWith(`__agg_`)) delete finalResults[key]
          }
        }

        // Use a single key for the result and update $selected
        return [
          `single_group`,
          {
            ...aggregatedRow,
            $selected: finalResults,
          },
        ] as [unknown, Record<string, any>]
      }),
    )

    // Apply HAVING clauses if present
    if (havingClauses && havingClauses.length > 0) {
      for (const havingClause of havingClauses) {
        const havingExpression = getHavingExpression(havingClause)
        const transformedHavingClause = replaceAggregatesByRefs(
          havingExpression,
          selectClause || {},
          `$selected`,
        )
        const compiledHaving = compileExpression(transformedHavingClause)

        pipeline = pipeline.pipe(
          filter(([, row]) => {
            // Create a namespaced row structure for HAVING evaluation
            const namespacedRow = { $selected: (row as any).$selected }
            return toBooleanPredicate(compiledHaving(namespacedRow))
          }),
        )
      }
    }

    // Apply functional HAVING clauses if present
    if (fnHavingClauses && fnHavingClauses.length > 0) {
      for (const fnHaving of fnHavingClauses) {
        pipeline = pipeline.pipe(
          filter(([, row]) => {
            // Create a namespaced row structure for functional HAVING evaluation
            const namespacedRow = { $selected: (row as any).$selected }
            return toBooleanPredicate(fnHaving(namespacedRow))
          }),
        )
      }
    }

    return pipeline
  }

  // Multi-group aggregation logic...
  // Validate and create mapping for non-aggregate expressions in SELECT
  const mapping = validateAndCreateMapping(groupByClause, selectClause)

  // Pre-compile groupBy expressions
  const compiledGroupByExpressions = groupByClause.map((e) =>
    compileExpression(e),
  )

  // Create a key extractor function using simple __key_X format
  const keyExtractor = ([, row]: [
    string,
    NamespacedRow & { $selected?: any },
  ]) => {
    // Use the original namespaced row for GROUP BY expressions, not $selected
    const namespacedRow = { ...row }
    delete (namespacedRow as any).$selected

    const key: Record<string, unknown> = {}

    // Use simple __key_X format for each groupBy expression
    for (let i = 0; i < groupByClause.length; i++) {
      const compiledExpr = compiledGroupByExpressions[i]!
      const value = compiledExpr(namespacedRow)
      key[`__key_${i}`] = value
    }

    return key
  }

  // Create aggregate functions for any aggregated columns in the SELECT clause
  const aggregates: Record<string, any> = {}
  const wrappedAggExprs: Record<string, (data: any) => any> = {}
  const aggCounter = { value: 0 }

  if (selectClause) {
    // Scan the SELECT clause for aggregate functions
    for (const [alias, expr] of Object.entries(selectClause)) {
      if (expr.type === `agg`) {
        aggregates[alias] = getAggregateFunction(expr)
      } else if (containsAggregate(expr)) {
        const { transformed, extracted } = extractAndReplaceAggregates(
          expr as BasicExpression | Aggregate,
          aggCounter,
        )
        for (const [syntheticAlias, aggExpr] of Object.entries(extracted)) {
          aggregates[syntheticAlias] = getAggregateFunction(aggExpr)
        }
        wrappedAggExprs[alias] = compileExpression(transformed)
      }
    }
  }

  // Apply the groupBy operator
  pipeline = pipeline.pipe(groupBy(keyExtractor, aggregates))

  // Update $selected to handle GROUP BY results
  pipeline = pipeline.pipe(
    map(([, aggregatedRow]) => {
      // Start with the existing $selected from early SELECT processing
      const selectResults = (aggregatedRow as any).$selected || {}
      const finalResults: Record<string, any> = {}

      if (selectClause) {
        // First pass: populate group keys, plain aggregates, and synthetic aliases
        for (const [alias, expr] of Object.entries(selectClause)) {
          if (expr.type === `agg`) {
            finalResults[alias] = aggregatedRow[alias]
          } else if (!wrappedAggExprs[alias]) {
            // Use cached mapping to get the corresponding __key_X for non-aggregates
            const groupIndex = mapping.selectToGroupByIndex.get(alias)
            if (groupIndex !== undefined) {
              finalResults[alias] = aggregatedRow[`__key_${groupIndex}`]
            } else {
              // Fallback to original SELECT results
              finalResults[alias] = selectResults[alias]
            }
          }
        }
        // Add synthetic aggregate values so wrapped expressions can reference them
        for (const key of Object.keys(aggregatedRow)) {
          if (key.startsWith(`__agg_`)) {
            finalResults[key] = aggregatedRow[key]
          }
        }
        // Second pass: evaluate wrapped-aggregate expressions
        for (const [alias, evaluator] of Object.entries(wrappedAggExprs)) {
          finalResults[alias] = evaluator({ $selected: finalResults })
        }
        // Clean up synthetic keys so they don't leak onto result rows
        for (const key of Object.keys(finalResults)) {
          if (key.startsWith(`__agg_`)) delete finalResults[key]
        }
      } else {
        // No SELECT clause - just use the group keys
        for (let i = 0; i < groupByClause.length; i++) {
          finalResults[`__key_${i}`] = aggregatedRow[`__key_${i}`]
        }
      }

      // Generate a simple key for the live collection using group values
      let finalKey: unknown
      if (groupByClause.length === 1) {
        finalKey = aggregatedRow[`__key_0`]
      } else {
        const keyParts: Array<unknown> = []
        for (let i = 0; i < groupByClause.length; i++) {
          keyParts.push(aggregatedRow[`__key_${i}`])
        }
        finalKey = serializeValue(keyParts)
      }

      return [
        finalKey,
        {
          ...aggregatedRow,
          $selected: finalResults,
        },
      ] as [unknown, Record<string, any>]
    }),
  )

  // Apply HAVING clauses if present
  if (havingClauses && havingClauses.length > 0) {
    for (const havingClause of havingClauses) {
      const havingExpression = getHavingExpression(havingClause)
      const transformedHavingClause = replaceAggregatesByRefs(
        havingExpression,
        selectClause || {},
      )
      const compiledHaving = compileExpression(transformedHavingClause)

      pipeline = pipeline.pipe(
        filter(([, row]) => {
          // Create a namespaced row structure for HAVING evaluation
          const namespacedRow = { $selected: (row as any).$selected }
          return compiledHaving(namespacedRow)
        }),
      )
    }
  }

  // Apply functional HAVING clauses if present
  if (fnHavingClauses && fnHavingClauses.length > 0) {
    for (const fnHaving of fnHavingClauses) {
      pipeline = pipeline.pipe(
        filter(([, row]) => {
          // Create a namespaced row structure for functional HAVING evaluation
          const namespacedRow = { $selected: (row as any).$selected }
          return toBooleanPredicate(fnHaving(namespacedRow))
        }),
      )
    }
  }

  return pipeline
}

/**
 * Helper function to check if two expressions are equal
 */
function expressionsEqual(expr1: any, expr2: any): boolean {
  if (!expr1 || !expr2) return false
  if (expr1.type !== expr2.type) return false

  switch (expr1.type) {
    case `ref`:
      // Compare paths as arrays
      if (!expr1.path || !expr2.path) return false
      if (expr1.path.length !== expr2.path.length) return false
      return expr1.path.every(
        (segment: string, i: number) => segment === expr2.path[i],
      )
    case `val`:
      return expr1.value === expr2.value
    case `func`:
      return (
        expr1.name === expr2.name &&
        expr1.args?.length === expr2.args?.length &&
        (expr1.args || []).every((arg: any, i: number) =>
          expressionsEqual(arg, expr2.args[i]),
        )
      )
    case `agg`:
      return (
        expr1.name === expr2.name &&
        expr1.args?.length === expr2.args?.length &&
        (expr1.args || []).every((arg: any, i: number) =>
          expressionsEqual(arg, expr2.args[i]),
        )
      )
    default:
      return false
  }
}

/**
 * Helper function to get an aggregate function based on the Agg expression
 */
function getAggregateFunction(aggExpr: Aggregate) {
  // Pre-compile the value extractor expression
  const compiledExpr = compileExpression(aggExpr.args[0]!)

  // Create a value extractor function for the expression to aggregate
  const valueExtractor = ([, namespacedRow]: [string, NamespacedRow]) => {
    const value = compiledExpr(namespacedRow)
    // Ensure we return a number for numeric aggregate functions
    if (typeof value === `number`) {
      return value
    }
    return value != null ? Number(value) : 0
  }

  // Create a value extractor function for min/max that preserves comparable types
  const valueExtractorForMinMax = ([, namespacedRow]: [
    string,
    NamespacedRow,
  ]) => {
    const value = compiledExpr(namespacedRow)
    // Preserve strings, numbers, Dates, and bigints for comparison
    if (
      typeof value === `number` ||
      typeof value === `string` ||
      typeof value === `bigint` ||
      value instanceof Date
    ) {
      return value
    }
    return value != null ? Number(value) : 0
  }

  // Create a raw value extractor function for the expression to aggregate
  const rawValueExtractor = ([, namespacedRow]: [string, NamespacedRow]) => {
    return compiledExpr(namespacedRow)
  }

  // Return the appropriate aggregate function
  switch (aggExpr.name.toLowerCase()) {
    case `sum`:
      return sum(valueExtractor)
    case `count`:
      return count(rawValueExtractor)
    case `avg`:
      return avg(valueExtractor)
    case `min`:
      return min(valueExtractorForMinMax)
    case `max`:
      return max(valueExtractorForMinMax)
    default:
      throw new UnsupportedAggregateFunctionError(aggExpr.name)
  }
}

/**
 * Transforms expressions to replace aggregate functions with references to computed values.
 *
 * For aggregate expressions, finds matching aggregates in the SELECT clause and replaces them
 * with PropRef([resultAlias, alias]) to reference the computed aggregate value.
 *
 * Ref expressions (table columns and $selected fields) and value expressions are passed through unchanged.
 * Function expressions are recursively transformed.
 *
 * @param havingExpr - The expression to transform (can be aggregate, ref, func, or val)
 * @param selectClause - The SELECT clause containing aliases and aggregate definitions
 * @param resultAlias - The namespace alias for SELECT results (default: '$selected')
 * @returns A transformed BasicExpression that references computed values instead of raw expressions
 */
export function replaceAggregatesByRefs(
  havingExpr: BasicExpression | Aggregate,
  selectClause: Select,
  resultAlias: string = `$selected`,
): BasicExpression {
  switch (havingExpr.type) {
    case `agg`: {
      const aggExpr = havingExpr
      // Find matching aggregate in SELECT clause
      for (const [alias, selectExpr] of Object.entries(selectClause)) {
        if (selectExpr.type === `agg` && aggregatesEqual(aggExpr, selectExpr)) {
          // Replace with a reference to the computed aggregate
          return new PropRef([resultAlias, alias])
        }
      }
      // If no matching aggregate found in SELECT, throw error
      throw new AggregateFunctionNotInSelectError(aggExpr.name)
    }

    case `func`: {
      const funcExpr = havingExpr
      // Transform function arguments recursively
      const transformedArgs = funcExpr.args.map(
        (arg: BasicExpression | Aggregate) =>
          replaceAggregatesByRefs(arg, selectClause),
      )
      return new Func(funcExpr.name, transformedArgs)
    }

    case `ref`:
      // Ref expressions are passed through unchanged - they reference either:
      // - $selected fields (which are already in the correct namespace)
      // - Table column references (which remain valid)
      return havingExpr as BasicExpression

    case `val`:
      // Return as-is
      return havingExpr as BasicExpression

    default:
      throw new UnknownHavingExpressionTypeError((havingExpr as any).type)
  }
}

/**
 * Checks whether an expression contains an aggregate anywhere in its tree.
 * Returns true for a top-level Aggregate, or a Func whose args (recursively)
 * contain an Aggregate. Safely returns false for nested Select objects.
 */
export function containsAggregate(
  expr: BasicExpression | Aggregate | Select,
): boolean {
  if (!isExpressionLike(expr)) {
    return false
  }
  if (expr.type === `agg`) {
    return true
  }
  if (expr.type === `func`) {
    return expr.args.some((arg: BasicExpression | Aggregate) =>
      containsAggregate(arg),
    )
  }
  return false
}

/**
 * Walks an expression tree containing nested aggregates.
 * Each Aggregate node is extracted, assigned a synthetic alias (__agg_N),
 * and replaced with PropRef(["$selected", "__agg_N"]) so the wrapper
 * expression can be compiled as a pure BasicExpression after groupBy
 * populates the synthetic values.
 */
function extractAndReplaceAggregates(
  expr: BasicExpression | Aggregate,
  counter: { value: number },
): {
  transformed: BasicExpression
  extracted: Record<string, Aggregate>
} {
  if (expr.type === `agg`) {
    const alias = `__agg_${counter.value++}`
    return {
      transformed: new PropRef([`$selected`, alias]),
      extracted: { [alias]: expr },
    }
  }

  if (expr.type === `func`) {
    const allExtracted: Record<string, Aggregate> = {}
    const newArgs = expr.args.map((arg: BasicExpression | Aggregate) => {
      const result = extractAndReplaceAggregates(arg, counter)
      Object.assign(allExtracted, result.extracted)
      return result.transformed
    })
    return {
      transformed: new Func(expr.name, newArgs),
      extracted: allExtracted,
    }
  }

  // ref / val – pass through unchanged
  return { transformed: expr as BasicExpression, extracted: {} }
}

/**
 * Checks if two aggregate expressions are equal
 */
function aggregatesEqual(agg1: Aggregate, agg2: Aggregate): boolean {
  return (
    agg1.name === agg2.name &&
    agg1.args.length === agg2.args.length &&
    agg1.args.every((arg, i) => expressionsEqual(arg, agg2.args[i]))
  )
}
