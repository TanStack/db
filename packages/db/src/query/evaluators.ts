import { evaluateOperandOnNamespacedRow } from "./extractors.js"
import { compareValues, convertLikeToRegex, isValueInArray } from "./utils.js"
import type {
  Comparator,
  Condition,
  ConditionOperand,
  LogicalOperator,
  SimpleCondition,
} from "./schema.js"
import type { NamespacedRow } from "../types.js"

/**
 * Evaluates a condition against a nested row structure
 */
export function evaluateConditionOnNamespacedRow(
  namespacedRow: NamespacedRow,
  condition: Condition,
  mainTableAlias?: string,
  joinedTableAlias?: string
): boolean {
  // Handle simple conditions with exactly 3 elements
  if (condition.length === 3 && !Array.isArray(condition[0])) {
    const [left, comparator, right] = condition as SimpleCondition
    return evaluateSimpleConditionOnNamespacedRow(
      namespacedRow,
      left,
      comparator,
      right,
      mainTableAlias,
      joinedTableAlias
    )
  }

  // Handle flat composite conditions (multiple conditions in a single array)
  if (
    condition.length > 3 &&
    !Array.isArray(condition[0]) &&
    typeof condition[1] === `string` &&
    ![`and`, `or`].includes(condition[1] as string)
  ) {
    // Start with the first condition (first 3 elements)
    let result = evaluateSimpleConditionOnNamespacedRow(
      namespacedRow,
      condition[0],
      condition[1] as Comparator,
      condition[2],
      mainTableAlias,
      joinedTableAlias
    )

    // Process the rest in groups: logical operator, then 3 elements for each condition
    for (let i = 3; i < condition.length; i += 4) {
      const logicalOp = condition[i] as LogicalOperator

      // Make sure we have a complete condition to evaluate
      if (i + 3 <= condition.length) {
        const nextResult = evaluateSimpleConditionOnNamespacedRow(
          namespacedRow,
          condition[i + 1],
          condition[i + 2] as Comparator,
          condition[i + 3],
          mainTableAlias,
          joinedTableAlias
        )

        // Apply the logical operator
        if (logicalOp === `and`) {
          result = result && nextResult
        } else {
          // logicalOp === `or`
          result = result || nextResult
        }
      }
    }

    return result
  }

  // Handle nested composite conditions where the first element is an array
  if (condition.length > 0 && Array.isArray(condition[0])) {
    // Start with the first condition
    let result = evaluateConditionOnNamespacedRow(
      namespacedRow,
      condition[0] as Condition,
      mainTableAlias,
      joinedTableAlias
    )

    // Process the rest of the conditions and logical operators in pairs
    for (let i = 1; i < condition.length; i += 2) {
      if (i + 1 >= condition.length) break // Make sure we have a pair

      const operator = condition[i] as LogicalOperator
      const nextCondition = condition[i + 1] as Condition

      // Apply the logical operator
      if (operator === `and`) {
        result =
          result &&
          evaluateConditionOnNamespacedRow(
            namespacedRow,
            nextCondition,
            mainTableAlias,
            joinedTableAlias
          )
      } else {
        // logicalOp === `or`
        result =
          result ||
          evaluateConditionOnNamespacedRow(
            namespacedRow,
            nextCondition,
            mainTableAlias,
            joinedTableAlias
          )
      }
    }

    return result
  }

  // Fallback - this should not happen with valid conditions
  return true
}

/**
 * Evaluates a simple condition against a nested row structure
 */
export function evaluateSimpleConditionOnNamespacedRow(
  namespacedRow: Record<string, unknown>,
  left: ConditionOperand,
  comparator: Comparator,
  right: ConditionOperand,
  mainTableAlias?: string,
  joinedTableAlias?: string
): boolean {
  const leftValue = evaluateOperandOnNamespacedRow(
    namespacedRow,
    left,
    mainTableAlias,
    joinedTableAlias
  )

  const rightValue = evaluateOperandOnNamespacedRow(
    namespacedRow,
    right,
    mainTableAlias,
    joinedTableAlias
  )

  // The rest of the function remains the same as evaluateSimpleCondition
  switch (comparator) {
    case `=`:
      return leftValue === rightValue
    case `!=`:
      return leftValue !== rightValue
    case `<`:
      return compareValues(leftValue, rightValue, `<`)
    case `<=`:
      return compareValues(leftValue, rightValue, `<=`)
    case `>`:
      return compareValues(leftValue, rightValue, `>`)
    case `>=`:
      return compareValues(leftValue, rightValue, `>=`)
    case `like`:
    case `not like`:
      if (typeof leftValue === `string` && typeof rightValue === `string`) {
        // Convert SQL LIKE pattern to proper regex pattern
        const pattern = convertLikeToRegex(rightValue)
        const matches = new RegExp(`^${pattern}$`, `i`).test(leftValue)
        return comparator === `like` ? matches : !matches
      }
      return comparator === `like` ? false : true
    case `in`:
      // If right value is not an array, we can't do an IN operation
      if (!Array.isArray(rightValue)) {
        return false
      }

      // For empty arrays, nothing is contained in them
      if (rightValue.length === 0) {
        return false
      }

      // Handle array-to-array comparison (check if any element in leftValue exists in rightValue)
      if (Array.isArray(leftValue)) {
        return leftValue.some((item) => isValueInArray(item, rightValue))
      }

      // Handle single value comparison
      return isValueInArray(leftValue, rightValue)

    case `not in`:
      // If right value is not an array, everything is "not in" it
      if (!Array.isArray(rightValue)) {
        return true
      }

      // For empty arrays, everything is "not in" them
      if (rightValue.length === 0) {
        return true
      }

      // Handle array-to-array comparison (check if no element in leftValue exists in rightValue)
      if (Array.isArray(leftValue)) {
        return !leftValue.some((item) => isValueInArray(item, rightValue))
      }

      // Handle single value comparison
      return !isValueInArray(leftValue, rightValue)

    case `is`:
      return leftValue === rightValue
    case `is not`:
      // Properly handle null/undefined checks
      if (rightValue === null) {
        return leftValue !== null && leftValue !== undefined
      }
      return leftValue !== rightValue
    default:
      return false
  }
}
