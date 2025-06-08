import {
  map,
  orderBy,
  orderByWithFractionalIndex,
  orderByWithIndex,
} from "@electric-sql/d2ts"
import { evaluateOperandOnNamespacedRow } from "./extractors"
import { isOrderIndexFunctionCall } from "./utils"
import type { ConditionOperand, Query } from "./schema"
import type {
  KeyedNamespacedRow,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../types"

export function processOrderBy(
  resultPipeline: NamespacedAndKeyedStream,
  query: Query,
  mainTableAlias: string
) {
  // Check if any column in the SELECT clause is an ORDER_INDEX function call
  let hasOrderIndexColumn = false
  let orderIndexType: `numeric` | `fractional` = `numeric`
  let orderIndexAlias = ``

  // Scan the SELECT clause for ORDER_INDEX functions
  for (const item of query.select) {
    if (typeof item === `object`) {
      for (const [alias, expr] of Object.entries(item)) {
        if (typeof expr === `object` && isOrderIndexFunctionCall(expr)) {
          hasOrderIndexColumn = true
          orderIndexAlias = alias
          orderIndexType = getOrderIndexType(expr)
          break
        }
      }
    }
    if (hasOrderIndexColumn) break
  }

  // Normalize orderBy to an array of objects
  const orderByItems: Array<{
    operand: ConditionOperand
    direction: `asc` | `desc`
  }> = []

  if (typeof query.orderBy === `string`) {
    // Handle string format: '@column'
    orderByItems.push({
      operand: query.orderBy,
      direction: `asc`,
    })
  } else if (Array.isArray(query.orderBy)) {
    // Handle array format: ['@column1', { '@column2': 'desc' }]
    for (const item of query.orderBy) {
      if (typeof item === `string`) {
        orderByItems.push({
          operand: item,
          direction: `asc`,
        })
      } else if (typeof item === `object`) {
        for (const [column, direction] of Object.entries(item)) {
          orderByItems.push({
            operand: column,
            direction: direction as `asc` | `desc`,
          })
        }
      }
    }
  } else if (typeof query.orderBy === `object`) {
    // Handle object format: { '@column': 'desc' }
    for (const [column, direction] of Object.entries(query.orderBy)) {
      orderByItems.push({
        operand: column,
        direction: direction as `asc` | `desc`,
      })
    }
  }

  // Create a value extractor function for the orderBy operator
  // const valueExtractor = ([key, namespacedRow]: [
  const valueExtractor = (namespacedRow: NamespacedRow) => {
    // For multiple orderBy columns, create a composite key
    if (orderByItems.length > 1) {
      return orderByItems.map((item) => {
        const val = evaluateOperandOnNamespacedRow(
          namespacedRow,
          item.operand,
          mainTableAlias
        )

        // Reverse the value for 'desc' ordering
        return item.direction === `desc` && typeof val === `number`
          ? -val
          : item.direction === `desc` && typeof val === `string`
            ? String.fromCharCode(
                ...[...val].map((c) => 0xffff - c.charCodeAt(0))
              )
            : val
      })
    } else if (orderByItems.length === 1) {
      // For a single orderBy column, use the value directly
      const item = orderByItems[0]
      const val = evaluateOperandOnNamespacedRow(
        namespacedRow,
        item!.operand,
        mainTableAlias
      )

      // Reverse the value for 'desc' ordering
      return item!.direction === `desc` && typeof val === `number`
        ? -val
        : item!.direction === `desc` && typeof val === `string`
          ? String.fromCharCode(
              ...[...val].map((c) => 0xffff - c.charCodeAt(0))
            )
          : val
    }

    // Default case - no ordering
    return null
  }

  const comparator = (a: unknown, b: unknown): number => {
    // if a and b are both numbers compare them directly
    if (typeof a === `number` && typeof b === `number`) {
      return a - b
    }
    // if a and b are both strings, compare them lexicographically
    if (typeof a === `string` && typeof b === `string`) {
      return a.localeCompare(b)
    }
    // if a and b are both booleans, compare them
    if (typeof a === `boolean` && typeof b === `boolean`) {
      return a === b ? 0 : a ? 1 : -1
    }
    // if a and b are both dates, compare them
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime()
    }
    // if a and b are both null, return 0
    if (a === null || b === null) {
      return 0
    }

    // if a and b are both arrays, compare them element by element
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        // Get the values from the array
        const aVal = a[i]
        const bVal = b[i]

        // Compare the values
        let result: number

        if (typeof aVal === `boolean` && typeof bVal === `boolean`) {
          // Special handling for booleans - false comes before true
          result = aVal === bVal ? 0 : aVal ? 1 : -1
        } else if (typeof aVal === `number` && typeof bVal === `number`) {
          // Numeric comparison
          result = aVal - bVal
        } else if (typeof aVal === `string` && typeof bVal === `string`) {
          // String comparison
          result = aVal.localeCompare(bVal)
        } else {
          // Default comparison using the general comparator
          result = comparator(aVal, bVal)
        }

        if (result !== 0) {
          return result
        }
      }
      // All elements are equal up to the minimum length
      return a.length - b.length
    }
    // if a and b are both null/undefined, return 0
    if (a == null && b == null) {
      return 0
    }
    // Fallback to string comparison for all other cases
    return (a as any).toString().localeCompare((b as any).toString())
  }

  // Apply the appropriate orderBy operator based on whether an ORDER_INDEX column is requested
  if (hasOrderIndexColumn) {
    if (orderIndexType === `numeric`) {
      // Use orderByWithIndex for numeric indices
      resultPipeline = resultPipeline.pipe(
        orderByWithIndex(valueExtractor, {
          limit: query.limit,
          offset: query.offset,
          comparator,
        }),
        map(([key, [value, index]]) => {
          // Add the index to the result
          // We add this to the main table alias for now
          // TODO: re are going to need to refactor the whole order by pipeline
          const result = {
            ...(value as Record<string, unknown>),
            [mainTableAlias]: {
              ...value[mainTableAlias],
              [orderIndexAlias]: index,
            },
          }
          return [key, result] as KeyedNamespacedRow
        })
      )
    } else {
      // Use orderByWithFractionalIndex for fractional indices
      resultPipeline = resultPipeline.pipe(
        orderByWithFractionalIndex(valueExtractor, {
          limit: query.limit,
          offset: query.offset,
          comparator,
        }),
        map(([key, [value, index]]) => {
          // Add the index to the result
          // We add this to the main table alias for now
          // TODO: re are going to need to refactor the whole order by pipeline
          const result = {
            ...(value as Record<string, unknown>),
            [mainTableAlias]: {
              ...value[mainTableAlias],
              [orderIndexAlias]: index,
            },
          }
          return [key, result] as KeyedNamespacedRow
        })
      )
    }
  } else {
    // Use regular orderBy if no index column is requested and but a keyBy is requested
    resultPipeline = resultPipeline.pipe(
      orderBy(valueExtractor, {
        limit: query.limit,
        offset: query.offset,
        comparator,
      })
    )
  }

  return resultPipeline
}

// Helper function to extract the ORDER_INDEX type from a function call
function getOrderIndexType(obj: any): `numeric` | `fractional` {
  if (!isOrderIndexFunctionCall(obj)) {
    throw new Error(`Not an ORDER_INDEX function call`)
  }

  const arg = obj[`ORDER_INDEX`]
  if (arg === `numeric` || arg === true || arg === `default`) {
    return `numeric`
  } else if (arg === `fractional`) {
    return `fractional`
  } else {
    throw new Error(`Invalid ORDER_INDEX type: ` + arg)
  }
}
