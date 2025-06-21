import { map } from "@electric-sql/d2mini"
import { evaluateExpression } from "./evaluators.js"
import type { Agg, Select } from "../ir.js"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../../types.js"

/**
 * Processes the SELECT clause
 */
export function processSelect(
  pipeline: NamespacedAndKeyedStream,
  selectClause: Select,
  _allInputs: Record<string, KeyedStream>
): KeyedStream {
  return pipeline.pipe(
    map(([key, namespacedRow]) => {
      const result: Record<string, any> = {}

      // Process each selected field
      for (const [alias, expression] of Object.entries(selectClause)) {
        if (expression.type === `agg`) {
          // Handle aggregate functions
          result[alias] = evaluateAggregate(expression, namespacedRow)
        } else {
          // Handle regular expressions
          result[alias] = evaluateExpression(expression, namespacedRow)
        }
      }

      return [key, result] as [string, typeof result]
    })
  )
}

/**
 * Evaluates aggregate functions
 * Note: This is a simplified implementation. In a full implementation,
 * aggregates would be handled during the GROUP BY phase.
 */
function evaluateAggregate(agg: Agg, namespacedRow: NamespacedRow): any {
  // For now, we'll treat aggregates as if they're operating on a single row
  // This is not correct for real aggregation, but serves as a placeholder
  const arg = agg.args[0]
  if (!arg) {
    throw new Error(
      `Aggregate function ${agg.name} requires at least one argument`
    )
  }

  const value = evaluateExpression(arg, namespacedRow)

  switch (agg.name) {
    case `count`:
      // For single row, count is always 1 if value is not null
      return value != null ? 1 : 0

    case `sum`:
    case `avg`:
    case `min`:
    case `max`:
      // For single row, these functions just return the value
      return value

    default:
      throw new Error(`Unknown aggregate function: ${agg.name}`)
  }
}
