/**
 * Helper function to determine if an object is a function call with an aggregate function
 */
export function isAggregateFunctionCall(obj: any): boolean {
  if (!obj || typeof obj !== `object`) return false

  const aggregateFunctions = [
    `SUM`,
    `COUNT`,
    `AVG`,
    `MIN`,
    `MAX`,
    `MEDIAN`,
    `MODE`,
  ]
  const keys = Object.keys(obj)

  return keys.length === 1 && aggregateFunctions.includes(keys[0]!)
}

/**
 * Helper function to determine if an object is an ORDER_INDEX function call
 */
export function isOrderIndexFunctionCall(obj: any): boolean {
  if (!obj || typeof obj !== `object`) return false

  const keys = Object.keys(obj)
  return keys.length === 1 && keys[0] === `ORDER_INDEX`
}

/**
 * Type guard to check if a value is comparable (can be used with <, >, <=, >= operators)
 * @param value The value to check
 * @returns True if the value is comparable
 */
export function isComparable(
  value: unknown
): value is number | string | Date | boolean {
  return (
    typeof value === `number` ||
    typeof value === `string` ||
    typeof value === `boolean` ||
    value instanceof Date
  )
}

/**
 * Performs a comparison between two values, ensuring they are of compatible types
 * @param left The left operand
 * @param right The right operand
 * @param operator The comparison operator
 * @returns The result of the comparison
 * @throws Error if the values are not comparable
 */
export function compareValues(
  left: unknown,
  right: unknown,
  operator: `<` | `<=` | `>` | `>=`
): boolean {
  // First check if both values are comparable
  if (!isComparable(left) || !isComparable(right)) {
    throw new Error(
      `Cannot compare non-comparable values: ${typeof left} and ${typeof right}`
    )
  }

  // If they're different types but both are strings or numbers, convert to strings
  if (
    typeof left !== typeof right &&
    (typeof left === `string` || typeof left === `number`) &&
    (typeof right === `string` || typeof right === `number`)
  ) {
    // Convert to strings for comparison (follows JavaScript's coercion rules)
    const leftStr = String(left)
    const rightStr = String(right)

    switch (operator) {
      case `<`:
        return leftStr < rightStr
      case `<=`:
        return leftStr <= rightStr
      case `>`:
        return leftStr > rightStr
      case `>=`:
        return leftStr >= rightStr
    }
  }

  // For Date objects, convert to timestamps
  if (left instanceof Date && right instanceof Date) {
    const leftTime = left.getTime()
    const rightTime = right.getTime()

    switch (operator) {
      case `<`:
        return leftTime < rightTime
      case `<=`:
        return leftTime <= rightTime
      case `>`:
        return leftTime > rightTime
      case `>=`:
        return leftTime >= rightTime
    }
  }

  // For other cases where types match
  if (typeof left === typeof right) {
    switch (operator) {
      case `<`:
        return left < right
      case `<=`:
        return left <= right
      case `>`:
        return left > right
      case `>=`:
        return left >= right
    }
  }

  // If we get here, it means the values are technically comparable but not compatible
  throw new Error(
    `Cannot compare incompatible types: ${typeof left} and ${typeof right}`
  )
}

/**
 * Converts a SQL LIKE pattern to a JavaScript regex pattern
 * @param pattern The SQL LIKE pattern to convert
 * @returns A regex-compatible pattern string
 */
export function convertLikeToRegex(pattern: string): string {
  let finalPattern = ``
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    // Handle escape character
    if (char === `\\` && i + 1 < pattern.length) {
      // Add the next character as a literal (escaped)
      finalPattern += pattern[i + 1]
      i += 2 // Skip both the escape and the escaped character
      continue
    }

    // Handle SQL LIKE special characters
    switch (char) {
      case `%`:
        // % matches any sequence of characters (including empty)
        finalPattern += `.*`
        break
      case `_`:
        // _ matches any single character
        finalPattern += `.`
        break
      // Handle regex special characters
      case `.`:
      case `^`:
      case `$`:
      case `*`:
      case `+`:
      case `?`:
      case `(`:
      case `)`:
      case `[`:
      case `]`:
      case `{`:
      case `}`:
      case `|`:
      case `/`:
        // Escape regex special characters
        finalPattern += `\\` + char
        break
      default:
        // Regular character, just add it
        finalPattern += char
    }

    i++
  }

  return finalPattern
}

/**
 * Helper function to check if a value is in an array, with special handling for various types
 * @param value The value to check for
 * @param array The array to search in
 * @param caseInsensitive Optional flag to enable case-insensitive matching for strings (default: false)
 * @returns True if the value is found in the array
 */
export function isValueInArray(
  value: unknown,
  array: Array<unknown>,
  caseInsensitive: boolean = false
): boolean {
  // Direct inclusion check first (fastest path)
  if (array.includes(value)) {
    return true
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return array.some((item) => item === null || item === undefined)
  }

  // Handle numbers and strings with type coercion
  if (typeof value === `number` || typeof value === `string`) {
    return array.some((item) => {
      // Same type, direct comparison
      if (typeof item === typeof value) {
        if (typeof value === `string` && caseInsensitive) {
          // Case-insensitive comparison for strings (only if explicitly enabled)
          return value.toLowerCase() === (item as string).toLowerCase()
        }
        return item === value
      }

      // Different types, try coercion for number/string
      if (
        (typeof item === `number` || typeof item === `string`) &&
        (typeof value === `number` || typeof value === `string`)
      ) {
        // Convert both to strings for comparison
        return String(item) === String(value)
      }

      return false
    })
  }

  // Handle objects/arrays by comparing stringified versions
  if (typeof value === `object`) {
    const valueStr = JSON.stringify(value)
    return array.some((item) => {
      if (typeof item === `object` && item !== null) {
        return JSON.stringify(item) === valueStr
      }
      return false
    })
  }

  // Fallback
  return false
}
