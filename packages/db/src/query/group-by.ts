import { groupBy, groupByOperators } from "@electric-sql/d2ts"
import {
  evaluateOperandOnNamespacedRow,
  extractValueFromNamespacedRow,
} from "./extractors"
import { isAggregateFunctionCall } from "./utils"
import type { ConditionOperand, FunctionCall, Query } from "./schema"
import type { NamespacedAndKeyedStream } from "../types.js"

const { sum, count, avg, min, max, median, mode } = groupByOperators

/**
 * Process the groupBy clause in a D2QL query
 */
export function processGroupBy(
  pipeline: NamespacedAndKeyedStream,
  query: Query,
  mainTableAlias: string
) {
  // Normalize groupBy to an array of column references
  const groupByColumns = Array.isArray(query.groupBy)
    ? query.groupBy
    : [query.groupBy]

  // Create a key extractor function for the groupBy operator
  const keyExtractor = ([_oldKey, namespacedRow]: [
    string,
    Record<string, unknown>,
  ]) => {
    const key: Record<string, unknown> = {}

    // Extract each groupBy column value
    for (const column of groupByColumns) {
      if (typeof column === `string` && (column as string).startsWith(`@`)) {
        const columnRef = (column as string).substring(1)
        const columnName = columnRef.includes(`.`)
          ? columnRef.split(`.`)[1]
          : columnRef

        key[columnName!] = extractValueFromNamespacedRow(
          namespacedRow,
          columnRef,
          mainTableAlias
        )
      }
    }

    return key
  }

  // Create aggregate functions for any aggregated columns in the SELECT clause
  const aggregates: Record<string, any> = {}

  if (!query.select) {
    throw new Error(`SELECT clause is required for GROUP BY`)
  }

  // Scan the SELECT clause for aggregate functions
  for (const item of query.select) {
    if (typeof item === `object`) {
      for (const [alias, expr] of Object.entries(item)) {
        if (typeof expr === `object` && isAggregateFunctionCall(expr)) {
          // Get the function name (the only key in the object)
          const functionName = Object.keys(expr)[0]
          // Get the column reference or expression to aggregate
          const columnRef = (expr as FunctionCall)[
            functionName as keyof FunctionCall
          ]

          // Add the aggregate function to our aggregates object
          aggregates[alias] = getAggregateFunction(
            functionName!,
            columnRef,
            mainTableAlias
          )
        }
      }
    }
  }

  // Apply the groupBy operator if we have any aggregates
  if (Object.keys(aggregates).length > 0) {
    pipeline = pipeline.pipe(groupBy(keyExtractor, aggregates))
  }

  return pipeline
}

/**
 * Helper function to get an aggregate function based on the function name
 */
export function getAggregateFunction(
  functionName: string,
  columnRef: string | ConditionOperand,
  mainTableAlias: string
) {
  // Create a value extractor function for the column to aggregate
  const valueExtractor = ([_oldKey, namespacedRow]: [
    string,
    Record<string, unknown>,
  ]) => {
    let value: unknown
    if (typeof columnRef === `string` && columnRef.startsWith(`@`)) {
      value = extractValueFromNamespacedRow(
        namespacedRow,
        columnRef.substring(1),
        mainTableAlias
      )
    } else {
      value = evaluateOperandOnNamespacedRow(
        namespacedRow,
        columnRef as ConditionOperand,
        mainTableAlias
      )
    }
    // Ensure we return a number for aggregate functions
    return typeof value === `number` ? value : 0
  }

  // Return the appropriate aggregate function
  switch (functionName.toUpperCase()) {
    case `SUM`:
      return sum(valueExtractor)
    case `COUNT`:
      return count() // count() doesn't need a value extractor
    case `AVG`:
      return avg(valueExtractor)
    case `MIN`:
      return min(valueExtractor)
    case `MAX`:
      return max(valueExtractor)
    case `MEDIAN`:
      return median(valueExtractor)
    case `MODE`:
      return mode(valueExtractor)
    default:
      throw new Error(`Unsupported aggregate function: ${functionName}`)
  }
}
