import { evaluateFunction, isFunctionCall } from "./functions.js"
import type { AllowedFunctionName, ConditionOperand } from "./schema.js"

/**
 * Extracts a value from a nested row structure
 * @param namespacedRow The nested row structure
 * @param columnRef The column reference (may include table.column format)
 * @param mainTableAlias The main table alias to check first for columns without table reference
 * @param joinedTableAlias The joined table alias to check second for columns without table reference
 * @returns The extracted value or undefined if not found
 */
export function extractValueFromNamespacedRow(
  namespacedRow: Record<string, unknown>,
  columnRef: string,
  mainTableAlias?: string,
  joinedTableAlias?: string
): unknown {
  // Check if it's a table.column reference
  if (columnRef.includes(`.`)) {
    const [tableAlias, colName] = columnRef.split(`.`) as [string, string]

    // Get the table data
    const tableData = namespacedRow[tableAlias] as
      | Record<string, unknown>
      | null
      | undefined

    if (!tableData) {
      return null
    }

    // Return the column value from that table
    const value = tableData[colName]
    return value
  } else {
    // If no table is specified, first try to find in the main table if provided
    if (mainTableAlias && namespacedRow[mainTableAlias]) {
      const mainTableData = namespacedRow[mainTableAlias] as Record<
        string,
        unknown
      >
      if (typeof mainTableData === `object` && columnRef in mainTableData) {
        return mainTableData[columnRef]
      }
    }

    // Then try the joined table if provided
    if (joinedTableAlias && namespacedRow[joinedTableAlias]) {
      const joinedTableData = namespacedRow[joinedTableAlias] as Record<
        string,
        unknown
      >
      if (typeof joinedTableData === `object` && columnRef in joinedTableData) {
        return joinedTableData[columnRef]
      }
    }

    // If not found in main or joined table, try to find the column in any table
    for (const [_tableAlias, tableData] of Object.entries(namespacedRow)) {
      if (
        tableData &&
        typeof tableData === `object` &&
        columnRef in (tableData as Record<string, unknown>)
      ) {
        return (tableData as Record<string, unknown>)[columnRef]
      }
    }
    return undefined
  }
}

/**
 * Evaluates an operand against a nested row structure
 */
export function evaluateOperandOnNamespacedRow(
  namespacedRow: Record<string, unknown>,
  operand: ConditionOperand,
  mainTableAlias?: string,
  joinedTableAlias?: string
): unknown {
  // Handle column references
  if (typeof operand === `string` && operand.startsWith(`@`)) {
    const columnRef = operand.substring(1)
    return extractValueFromNamespacedRow(
      namespacedRow,
      columnRef,
      mainTableAlias,
      joinedTableAlias
    )
  }

  // Handle explicit column references
  if (operand && typeof operand === `object` && `col` in operand) {
    const colRef = (operand as { col: unknown }).col

    if (typeof colRef === `string`) {
      // First try to extract from nested row structure
      const nestedValue = extractValueFromNamespacedRow(
        namespacedRow,
        colRef,
        mainTableAlias,
        joinedTableAlias
      )

      // If not found in nested structure, check if it's a direct property of the row
      // This is important for HAVING clauses that reference aggregated values
      if (nestedValue === undefined && colRef in namespacedRow) {
        return namespacedRow[colRef]
      }

      return nestedValue
    }

    return undefined
  }

  // Handle function calls
  if (operand && typeof operand === `object` && isFunctionCall(operand)) {
    // Get the function name (the only key in the object)
    const functionName = Object.keys(operand)[0] as AllowedFunctionName
    // Get the arguments using type assertion with specific function name
    const args = (operand as any)[functionName]

    // If the arguments are a reference or another expression, evaluate them first
    const evaluatedArgs = Array.isArray(args)
      ? args.map((arg) =>
          evaluateOperandOnNamespacedRow(
            namespacedRow,
            arg as ConditionOperand,
            mainTableAlias,
            joinedTableAlias
          )
        )
      : evaluateOperandOnNamespacedRow(
          namespacedRow,
          args as ConditionOperand,
          mainTableAlias,
          joinedTableAlias
        )

    // Call the function with the evaluated arguments
    return evaluateFunction(
      functionName,
      evaluatedArgs as ConditionOperand | Array<ConditionOperand>
    )
  }

  // Handle explicit literals
  if (operand && typeof operand === `object` && `value` in operand) {
    return (operand as { value: unknown }).value
  }

  // Handle literal values
  return operand
}

/**
 * Extracts a join key value from a row based on the operand
 * @param row The data row (not nested)
 * @param operand The operand to extract the key from
 * @param defaultTableAlias The default table alias
 * @returns The extracted key value
 */
export function extractJoinKey<T extends Record<string, unknown>>(
  row: T,
  operand: ConditionOperand,
  defaultTableAlias?: string
): unknown {
  let keyValue: unknown

  // Handle column references (e.g., "@orders.id" or "@id")
  if (typeof operand === `string` && operand.startsWith(`@`)) {
    const columnRef = operand.substring(1)

    // If it contains a dot, extract the table and column
    if (columnRef.includes(`.`)) {
      const [tableAlias, colName] = columnRef.split(`.`) as [string, string]
      // If this is referencing the current table, extract from row directly
      if (tableAlias === defaultTableAlias) {
        keyValue = row[colName]
      } else {
        // This might be a column from another table, return undefined
        keyValue = undefined
      }
    } else {
      // No table specified, look directly in the row
      keyValue = row[columnRef]
    }
  } else if (operand && typeof operand === `object` && `col` in operand) {
    // Handle explicit column references like { col: "orders.id" } or { col: "id" }
    const colRef = (operand as { col: unknown }).col

    if (typeof colRef === `string`) {
      if (colRef.includes(`.`)) {
        const [tableAlias, colName] = colRef.split(`.`) as [string, string]
        // If this is referencing the current table, extract from row directly
        if (tableAlias === defaultTableAlias) {
          keyValue = row[colName]
        } else {
          // This might be a column from another table, return undefined
          keyValue = undefined
        }
      } else {
        // No table specified, look directly in the row
        keyValue = row[colRef]
      }
    }
  } else {
    // Handle literals or other types
    keyValue = operand
  }

  return keyValue
}
