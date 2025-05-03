import type { AllowedFunctionName } from "./schema.js"

/**
 * Type for function implementations
 */
type FunctionImplementation = (arg: unknown) => unknown

/**
 * Converts a string to uppercase
 */
function upperFunction(arg: unknown): string {
  if (typeof arg !== `string`) {
    throw new Error(`UPPER function expects a string argument`)
  }
  return arg.toUpperCase()
}

/**
 * Converts a string to lowercase
 */
function lowerFunction(arg: unknown): string {
  if (typeof arg !== `string`) {
    throw new Error(`LOWER function expects a string argument`)
  }
  return arg.toLowerCase()
}

/**
 * Returns the length of a string or array
 */
function lengthFunction(arg: unknown): number {
  if (typeof arg === `string` || Array.isArray(arg)) {
    return arg.length
  }

  throw new Error(`LENGTH function expects a string or array argument`)
}

/**
 * Concatenates multiple strings
 */
function concatFunction(arg: unknown): string {
  if (!Array.isArray(arg)) {
    throw new Error(`CONCAT function expects an array of string arguments`)
  }

  if (arg.length === 0) {
    return ``
  }

  // Check that all arguments are strings
  for (let i = 0; i < arg.length; i++) {
    if (arg[i] !== null && arg[i] !== undefined && typeof arg[i] !== `string`) {
      throw new Error(
        `CONCAT function expects all arguments to be strings, but argument at position ${i} is ${typeof arg[i]}`
      )
    }
  }

  // Concatenate strings, treating null and undefined as empty strings
  return arg
    .map((str) => (str === null || str === undefined ? `` : str))
    .join(``)
}

/**
 * Returns the first non-null, non-undefined value from an array
 */
function coalesceFunction(arg: unknown): unknown {
  if (!Array.isArray(arg)) {
    throw new Error(`COALESCE function expects an array of arguments`)
  }

  if (arg.length === 0) {
    return null
  }

  // Return the first non-null, non-undefined value
  for (const value of arg) {
    if (value !== null && value !== undefined) {
      return value
    }
  }

  // If all values were null or undefined, return null
  return null
}

/**
 * Creates or converts a value to a Date object
 */
function dateFunction(arg: unknown): Date | null {
  // If the argument is already a Date, return it
  if (arg instanceof Date) {
    return arg
  }

  // If the argument is null or undefined, return null
  if (arg === null || arg === undefined) {
    return null
  }

  // Handle string and number conversions
  if (typeof arg === `string` || typeof arg === `number`) {
    const date = new Date(arg)

    // Check if the date is valid
    if (isNaN(date.getTime())) {
      throw new Error(`DATE function could not parse "${arg}" as a valid date`)
    }

    return date
  }

  throw new Error(`DATE function expects a string, number, or Date argument`)
}

/**
 * Extracts a value from a JSON string or object using a path.
 * Similar to PostgreSQL's json_extract_path function.
 *
 * Usage: JSON_EXTRACT([jsonInput, 'path', 'to', 'property'])
 * Example: JSON_EXTRACT(['{"user": {"name": "John"}}', 'user', 'name']) returns "John"
 */
function jsonExtractFunction(arg: unknown): unknown {
  if (!Array.isArray(arg) || arg.length < 1) {
    throw new Error(
      `JSON_EXTRACT function expects an array with at least one element [jsonInput, ...pathElements]`
    )
  }

  const [jsonInput, ...pathElements] = arg

  // Handle null or undefined input
  if (jsonInput === null || jsonInput === undefined) {
    return null
  }

  // Parse JSON if it's a string
  let jsonData: any

  if (typeof jsonInput === `string`) {
    try {
      jsonData = JSON.parse(jsonInput)
    } catch (error) {
      throw new Error(
        `JSON_EXTRACT function could not parse JSON string: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  } else if (typeof jsonInput === `object`) {
    // If already an object, use it directly
    jsonData = jsonInput
  } else {
    throw new Error(
      `JSON_EXTRACT function expects a JSON string or object as the first argument`
    )
  }

  // If no path elements, return the parsed JSON
  if (pathElements.length === 0) {
    return jsonData
  }

  // Navigate through the path elements
  let current = jsonData

  for (let i = 0; i < pathElements.length; i++) {
    const pathElement = pathElements[i]

    // Path elements should be strings
    if (typeof pathElement !== `string`) {
      throw new Error(
        `JSON_EXTRACT function expects path elements to be strings, but element at position ${i + 1} is ${typeof pathElement}`
      )
    }

    // If current node is null or undefined, or not an object, we can't navigate further
    if (
      current === null ||
      current === undefined ||
      typeof current !== `object`
    ) {
      return null
    }

    // Access property
    current = current[pathElement]
  }

  // Return null instead of undefined for consistency
  return current === undefined ? null : current
}

/**
 * Placeholder function for ORDER_INDEX
 * This function doesn't do anything when called directly, as the actual index
 * is provided by the orderBy operator during query execution.
 * The argument can be 'numeric', 'fractional', or any truthy value (defaults to 'numeric')
 */
function orderIndexFunction(arg: unknown): null {
  // This is just a placeholder - the actual index is provided by the orderBy operator
  // The function validates that the argument is one of the expected values
  if (
    arg !== `numeric` &&
    arg !== `fractional` &&
    arg !== true &&
    arg !== `default`
  ) {
    throw new Error(
      `ORDER_INDEX function expects "numeric", "fractional", "default", or true as argument`
    )
  }
  return null
}

/**
 * Map of function names to their implementations
 */
const functionImplementations: Record<
  AllowedFunctionName,
  FunctionImplementation
> = {
  // Map function names to their implementation functions
  DATE: dateFunction,
  JSON_EXTRACT: jsonExtractFunction,
  JSON_EXTRACT_PATH: jsonExtractFunction, // Alias for JSON_EXTRACT
  UPPER: upperFunction,
  LOWER: lowerFunction,
  COALESCE: coalesceFunction,
  CONCAT: concatFunction,
  LENGTH: lengthFunction,
  ORDER_INDEX: orderIndexFunction,
}

/**
 * Evaluates a function call with the given name and arguments
 * @param functionName The name of the function to evaluate
 * @param arg The arguments to pass to the function
 * @returns The result of the function call
 */
export function evaluateFunction(
  functionName: AllowedFunctionName,
  arg: unknown
): unknown {
  const implementation = functionImplementations[functionName] as
    | FunctionImplementation
    | undefined // Double check that the implementation is defined

  if (!implementation) {
    throw new Error(`Unknown function: ${functionName}`)
  }
  return implementation(arg)
}

/**
 * Determines if an object is a function call
 * @param obj The object to check
 * @returns True if the object is a function call, false otherwise
 */
export function isFunctionCall(obj: unknown): boolean {
  if (!obj || typeof obj !== `object`) {
    return false
  }

  const keys = Object.keys(obj)
  if (keys.length !== 1) {
    return false
  }

  const functionName = keys[0] as string

  // Check if the key is one of the allowed function names
  return Object.keys(functionImplementations).includes(functionName)
}

/**
 * Extracts the function name and argument from a function call object.
 */
export function extractFunctionCall(obj: Record<string, unknown>): {
  functionName: AllowedFunctionName
  argument: unknown
} {
  const keys = Object.keys(obj)
  if (keys.length !== 1) {
    throw new Error(`Invalid function call: object must have exactly one key`)
  }

  const functionName = keys[0] as AllowedFunctionName
  if (!Object.keys(functionImplementations).includes(functionName)) {
    throw new Error(`Invalid function name: ${functionName}`)
  }

  return {
    functionName,
    argument: obj[functionName],
  }
}
