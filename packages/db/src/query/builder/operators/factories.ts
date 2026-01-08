/**
 * Factory generators for creating operator compile functions.
 *
 * These higher-order functions generate compile functions for common operator
 * patterns, reducing duplication across operator implementations.
 *
 * All factories are fully typed - when used with defineOperator, the types flow
 * through from the TArgs parameter to the callback function.
 */

import type { CompiledExpression, EvaluatorFactory } from '../../ir.js'
import type { CompiledArgsFor, TypedEvaluatorFactory } from './define.js'

// ============================================================
// SHARED UTILITIES
// ============================================================

/**
 * Check if a value is null or undefined (UNKNOWN in 3-valued logic).
 * In SQL-like 3-valued logic, comparisons with UNKNOWN values return UNKNOWN.
 */
export function isUnknown(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

// ============================================================
// FACTORY GENERATORS
// ============================================================

/**
 * Creates a typed evaluator factory for binary comparison operators (eq, gt, lt, gte, lte).
 * Handles 3-valued logic automatically - returns null if either operand is null/undefined.
 *
 * @typeParam T - The type of values being compared (default: unknown)
 * @param compare - The comparison function to apply to the two operands
 * @returns A TypedEvaluatorFactory for binary comparison
 *
 * @example
 * ```typescript
 * // Untyped (works with any values)
 * const eqFactory = comparison((a, b) => a === b)
 *
 * // Typed (a and b are numbers)
 * const gtFactory = comparison<number>((a, b) => a > b)
 *
 * // With defineOperator - type flows through from TArgs
 * const gt = defineOperator<boolean, [left: number, right: number]>({
 *   name: 'gt',
 *   compile: comparison((a, b) => a > b) // a, b inferred as number
 * })
 * ```
 */
export function comparison<T = unknown>(
  compare: (a: T, b: T) => boolean,
): TypedEvaluatorFactory<[T, T]> {
  const factory = (
    compiledArgs: CompiledArgsFor<[T, T]>,
  ): CompiledExpression => {
    const [argA, argB] = compiledArgs

    return (data: unknown) => {
      const a = argA(data)
      const b = argB(data)
      if (isUnknown(a) || isUnknown(b)) return null
      return compare(a, b)
    }
  }
  return factory
}

/**
 * Creates an evaluator factory for variadic boolean operators (and, or).
 * Implements proper 3-valued logic with short-circuit evaluation.
 *
 * @param config.shortCircuit - The value that causes early return (false for AND, true for OR)
 * @param config.default - The result if no short-circuit occurs (true for AND, false for OR)
 * @returns An EvaluatorFactory for boolean operations
 *
 * @example
 * ```typescript
 * const andFactory = booleanOp({ shortCircuit: false, default: true })
 * const orFactory = booleanOp({ shortCircuit: true, default: false })
 * ```
 */
export function booleanOp(config: {
  shortCircuit: boolean
  default: boolean
}): EvaluatorFactory {
  return (compiledArgs: Array<CompiledExpression>): CompiledExpression => {
    return (data: unknown) => {
      let hasUnknown = false
      for (const arg of compiledArgs) {
        const result = arg(data)
        if (result === config.shortCircuit) return config.shortCircuit
        if (isUnknown(result)) hasUnknown = true
      }
      return hasUnknown ? null : config.default
    }
  }
}

/**
 * Creates a typed evaluator factory for unary transform operators.
 * Applies a transformation function to a single argument.
 *
 * @typeParam T - The input type (default: unknown)
 * @typeParam R - The output type (default: unknown)
 * @param fn - The transformation function to apply
 * @returns A TypedEvaluatorFactory for unary transforms
 *
 * @example
 * ```typescript
 * // Typed transform
 * const doubleFactory = transform<number, number>((v) => v * 2)
 *
 * // With defineOperator - type flows through from TArgs
 * const double = defineOperator<number, [value: number]>({
 *   name: 'double',
 *   compile: transform((v) => v * 2) // v inferred as number
 * })
 *
 * // String transform
 * const upper = defineOperator<string, [value: string]>({
 *   name: 'upper',
 *   compile: transform((v) => v.toUpperCase()) // v inferred as string
 * })
 * ```
 */
export function transform<T = unknown, R = unknown>(
  fn: (value: T) => R,
): TypedEvaluatorFactory<[T]> {
  const factory = (compiledArgs: CompiledArgsFor<[T]>): CompiledExpression => {
    const [arg] = compiledArgs
    return (data: unknown) => fn(arg(data))
  }
  return factory
}

/**
 * Creates a typed evaluator factory for binary numeric operators (add, subtract, multiply, divide).
 * Applies a numeric operation to two operands, with a default value for null/undefined.
 *
 * @param operation - The numeric operation to apply
 * @param defaultValue - The value to use when an operand is null/undefined (default: 0)
 * @returns A TypedEvaluatorFactory for binary numeric operations
 *
 * @example
 * ```typescript
 * const addFactory = numeric((a, b) => a + b)
 * const divideFactory = numeric((a, b) => b !== 0 ? a / b : null)
 *
 * // With defineOperator
 * const modulo = defineOperator<number, [left: number, right: number]>({
 *   name: 'modulo',
 *   compile: numeric((a, b) => b !== 0 ? a % b : null)
 * })
 * ```
 */
export function numeric(
  operation: (a: number, b: number) => number | null,
  defaultValue: number = 0,
): TypedEvaluatorFactory<[number, number]> {
  const factory = (
    compiledArgs: CompiledArgsFor<[number, number]>,
  ): CompiledExpression => {
    const [argA, argB] = compiledArgs

    return (data: unknown) => {
      // Use type assertion because runtime values may be null/undefined despite type
      const a = (argA(data) as number | null | undefined) ?? defaultValue
      const b = (argB(data) as number | null | undefined) ?? defaultValue
      return operation(a, b)
    }
  }
  return factory
}

/**
 * Creates a typed evaluator factory for pattern matching operators (like, ilike).
 * Handles 3-valued logic - returns null if either value or pattern is null/undefined.
 *
 * @param match - The matching function to apply (value, pattern) => boolean
 * @returns A TypedEvaluatorFactory for pattern matching
 *
 * @example
 * ```typescript
 * const likeFactory = pattern((value, pattern) => evaluateLike(value, pattern, false))
 * const ilikeFactory = pattern((value, pattern) => evaluateLike(value, pattern, true))
 *
 * // With defineOperator
 * const startsWith = defineOperator<boolean, [value: string, prefix: string]>({
 *   name: 'startsWith',
 *   compile: pattern((value, prefix) => value.startsWith(prefix))
 * })
 * ```
 */
export function pattern(
  match: (value: string, pattern: string) => boolean,
): TypedEvaluatorFactory<[string, string]> {
  const factory = (
    compiledArgs: CompiledArgsFor<[string, string]>,
  ): CompiledExpression => {
    const [valueArg, patternArg] = compiledArgs

    return (data: unknown) => {
      const value = valueArg(data)
      const patternVal = patternArg(data)
      if (isUnknown(value) || isUnknown(patternVal)) return null
      return match(value, patternVal)
    }
  }
  return factory
}
