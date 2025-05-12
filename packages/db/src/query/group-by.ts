import { groupBy, groupByOperators, map } from "@electric-sql/d2ts"
import {
  evaluateOperandOnNestedRow,
  extractValueFromNestedRow,
} from "./extractors"
import { isAggregateFunctionCall } from "./utils"
import type { ConditionOperand, FunctionCall, Query } from "./schema"
import type { IStreamBuilder } from "@electric-sql/d2ts"

const { sum, count, avg, min, max, median, mode } = groupByOperators

/**
 * Process the groupBy clause in a D2QL query
 */
export function processGroupBy(
  pipeline: IStreamBuilder<Record<string, unknown>>,
  query: Query,
  mainTableAlias: string
) {
  // Normalize groupBy to an array of column references
  const groupByColumns = Array.isArray(query.groupBy)
    ? query.groupBy
    : [query.groupBy]

  // Create a key extractor function for the groupBy operator
  const keyExtractor = (nestedRow: Record<string, unknown>) => {
    const key: Record<string, unknown> = {}

    // Extract each groupBy column value
    for (const column of groupByColumns) {
      if (typeof column === `string` && (column as string).startsWith(`@`)) {
        const columnRef = (column as string).substring(1)
        const columnName = columnRef.includes(`.`)
          ? columnRef.split(`.`)[1]
          : columnRef

        key[columnName!] = extractValueFromNestedRow(
          nestedRow,
          columnRef,
          mainTableAlias
        )
      }
    }

    return key
  }

  // Create aggregate functions for any aggregated columns in the SELECT clause
  const aggregates: Record<string, any> = {}

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
    pipeline = pipeline.pipe(
      groupBy(keyExtractor, aggregates),
      // Convert KeyValue<string, ResultType> to Record<string, unknown>
      map(([_key, value]) => {
        // After groupBy, the value already contains both the key fields and aggregate results
        // We need to return it as is, not wrapped in a nested structure
        return value as Record<string, unknown>
      })
    )
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
  const valueExtractor = (nestedRow: Record<string, unknown>) => {
    let value: unknown
    if (typeof columnRef === `string` && columnRef.startsWith(`@`)) {
      value = extractValueFromNestedRow(
        nestedRow,
        columnRef.substring(1),
        mainTableAlias
      )
    } else {
      value = evaluateOperandOnNestedRow(
        nestedRow,
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
