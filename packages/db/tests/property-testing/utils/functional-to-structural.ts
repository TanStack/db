import { Aggregate, PropRef, Value } from "../../../src/query/ir"
import type { BasicExpression, QueryIR } from "../../../src/query/ir"

/**
 * Converts functional expressions to structural expressions for SQL translation
 * This is a simplified parser that handles common patterns
 */
export function convertFunctionalToStructural(queryIR: QueryIR): QueryIR {
  const converted: QueryIR = { ...queryIR }

  // Convert fnSelect to select
  if (queryIR.fnSelect && !queryIR.select) {
    converted.select = parseSelectFunction(queryIR.fnSelect)
    delete converted.fnSelect
  }

  // Convert fnWhere to where
  if (queryIR.fnWhere && queryIR.fnWhere.length > 0 && !queryIR.where) {
    converted.where = queryIR.fnWhere
      .map(parseWhereFunction)
      .filter(Boolean) as Array<BasicExpression<boolean>>
    delete converted.fnWhere
  }

  // Convert fnHaving to having
  if (queryIR.fnHaving && queryIR.fnHaving.length > 0 && !queryIR.having) {
    converted.having = queryIR.fnHaving
      .map(parseHavingFunction)
      .filter(Boolean) as Array<BasicExpression<boolean>>
    delete converted.fnHaving
  }

  return converted
}

/**
 * Parse a select function to extract structural expressions
 * This is a simplified parser that handles basic patterns
 */
function parseSelectFunction(
  fnSelect: (row: any) => any
): Record<string, BasicExpression> {
  // For now, we'll create a simple mapping based on common patterns
  // In a real implementation, this would need to parse the function body

  // Try to infer the structure by calling the function with a mock row
  const mockRow = createMockRow()

  try {
    const result = fnSelect(mockRow)

    if (typeof result === `object` && result !== null) {
      const select: Record<string, BasicExpression> = {}

      for (const [key, value] of Object.entries(result)) {
        if (typeof value === `string` && value.includes(`.`)) {
          // Assume it's a column reference like "table.column"
          const path = value.split(`.`)
          select[key] = new PropRef(path)
        } else if (
          typeof value === `string` &&
          [`count`, `sum`, `avg`, `min`, `max`].includes(value)
        ) {
          // Assume it's an aggregate
          select[key] = new Aggregate(value, [])
        } else {
          // Assume it's a literal value
          select[key] = new Value(value)
        }
      }

      return select
    }
  } catch (error) {
    // If parsing fails, create a fallback
    console.warn(`Failed to parse select function, using fallback:`, error)
  }

  // Fallback: create a simple select all
  return {
    "*": new PropRef([`*`]),
  }
}

/**
 * Parse a where function to extract structural expressions
 */
function parseWhereFunction(
  fnWhere: (row: any) => any
): BasicExpression<boolean> | null {
  // Try to infer the structure by calling the function with a mock row
  const mockRow = createMockRow()

  try {
    const result = fnWhere(mockRow)

    // If it's a boolean literal, convert to a simple expression
    if (typeof result === `boolean`) {
      return new Value(result)
    }

    // For now, return null to indicate we can't parse this
    // In a real implementation, this would need to parse the function body
    return null
  } catch (error) {
    console.warn(`Failed to parse where function:`, error)
    return null
  }
}

/**
 * Parse a having function to extract structural expressions
 */
function parseHavingFunction(
  fnHaving: (row: any) => any
): BasicExpression<boolean> | null {
  // Same logic as where function
  return parseWhereFunction(fnHaving)
}

/**
 * Create a mock row for function parsing
 */
function createMockRow(): any {
  return {
    __refProxy: true,
    __path: [],
    __type: undefined,
    // Add some common table aliases
    table_: {
      __refProxy: true,
      __path: [`table_`],
      __type: undefined,
      // Add some common column names
      id: { __refProxy: true, __path: [`table_`, `id`], __type: undefined },
      name: { __refProxy: true, __path: [`table_`, `name`], __type: undefined },
      value: {
        __refProxy: true,
        __path: [`table_`, `value`],
        __type: undefined,
      },
    },
  }
}
