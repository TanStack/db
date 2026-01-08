/**
 * Public API for defining custom operators and aggregates.
 *
 * These functions provide a clean interface for users to create their own
 * operators and aggregates without needing to understand the internal IR structure.
 */

import { Aggregate, Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type {
  AggregateConfig,
  AggregateFactory,
  BasicExpression,
  CompiledExpression,
  EvaluatorFactory,
} from '../../ir.js'
import type { RefProxy } from '../ref-proxy.js'
import type { RefLeaf } from '../types.js'

// ============================================================
// EXPRESSION ARGUMENT TYPES
// ============================================================

/**
 * Represents an argument that can be passed to a custom operator.
 * It can be either:
 * - A literal value of type T
 * - A ref proxy (e.g., `items.value` in a query)
 * - An expression that evaluates to T
 *
 * @example
 * ```typescript
 * // When you define: defineOperator<boolean, [value: number, min: number, max: number]>
 * // The operator accepts:
 * between(10, 20, 30)           // literal values
 * between(items.value, 20, 30)  // ref proxy + literals
 * between(add(a, b), 20, 30)    // nested expression + literals
 * ```
 */
export type ExpressionArg<T> =
  | T
  | RefProxy<T>
  | RefLeaf<T>
  | BasicExpression<T>
  | Func<T>

/**
 * Maps a tuple of types to a tuple of ExpressionArg types.
 * Preserves named tuple labels for better IDE experience.
 */
export type ExpressionArgs<T extends Array<unknown>> = {
  [K in keyof T]: ExpressionArg<T[K]>
}

// ============================================================
// TYPED COMPILED EXPRESSION TYPES
// ============================================================

/**
 * A compiled expression that returns a specific type T.
 * This is the typed version of CompiledExpression.
 * Uses `any` for data to maintain compatibility with CompiledExpression.
 */
export type TypedCompiledExpression<T> = (data: any) => T

/**
 * Maps a tuple of types to a tuple of typed compiled expressions.
 * Preserves named tuple labels from TArgs.
 *
 * @example
 * ```typescript
 * // If TArgs = [value: number, min: number, max: number]
 * // Then CompiledArgsFor<TArgs> = [
 * //   value: TypedCompiledExpression<number>,
 * //   min: TypedCompiledExpression<number>,
 * //   max: TypedCompiledExpression<number>
 * // ]
 * ```
 */
export type CompiledArgsFor<TArgs extends Array<unknown>> = {
  [K in keyof TArgs]: TypedCompiledExpression<TArgs[K]>
}

/**
 * A typed evaluator factory that receives typed compiled args.
 * This provides full type safety from operator definition to evaluation.
 *
 * Note: This type is structurally a subtype of EvaluatorFactory when TArgs
 * is a tuple of types that extends Array<any>. The factory helpers cast
 * their return type for compatibility.
 */
export type TypedEvaluatorFactory<TArgs extends Array<unknown>> = (
  compiledArgs: CompiledArgsFor<TArgs>,
  isSingleRow: boolean,
) => CompiledExpression

// ============================================================
// OPERATOR CONFIG
// ============================================================

/**
 * Configuration for defining a custom operator.
 *
 * @typeParam TArgs - A tuple of argument types (can be named tuple)
 */
export interface OperatorConfig<TArgs extends Array<unknown> = Array<unknown>> {
  /** The name of the operator (used for debugging/serialization) */
  name: string
  /**
   * The compile function that creates the runtime evaluator.
   * Called once during query compilation to produce the per-row evaluator.
   *
   * You can use:
   * - A fully typed compile function: `([a, b, c]) => (data) => ...` with TArgs
   * - Factory helpers: `comparison()`, `transform()`, `numeric()`, `pattern()`
   */
  compile: TypedEvaluatorFactory<TArgs>
}

/**
 * Configuration for defining a custom aggregate.
 */
export interface AggregateDefinition {
  /** The name of the aggregate (used for debugging/serialization) */
  name: string
  /** The factory function from @tanstack/db-ivm that creates the aggregate */
  factory: AggregateFactory
  /**
   * How to transform the input value before aggregation:
   * - 'numeric': Coerce to number (for sum, avg)
   * - 'numericOrDate': Allow numbers or Date objects (for min, max)
   * - 'raw': Pass through unchanged (for count, collect)
   */
  valueTransform: AggregateConfig[`valueTransform`]
}

// ============================================================
// DEFINE OPERATOR
// ============================================================

/**
 * Define a custom operator for use in TanStack DB queries.
 *
 * This function creates a builder function that generates Func IR nodes
 * with your custom compile function. The compile function is called once
 * during query compilation to produce the per-row evaluator.
 *
 * @typeParam TReturn - The return type of the operator (default: `unknown`)
 * @typeParam TArgs - A tuple of argument types, supports named tuples (default: `unknown[]`)
 * @param config - The operator configuration
 * @returns A function that creates Func nodes when called with arguments
 *
 * @example
 * ```typescript
 * import { defineOperator, isUnknown } from '@tanstack/db'
 *
 * // Define a fully typed "between" operator with named tuple args
 * const between = defineOperator<boolean, [value: number, min: number, max: number]>({
 *   name: 'between',
 *   compile: ([value, min, max]) => (data) => {
 *     // value, min, max are all typed as TypedCompiledExpression<number>
 *     const v = value(data)
 *     if (isUnknown(v)) return null
 *     return v >= min(data) && v <= max(data)
 *   }
 * })
 *
 * // In queries, accepts ref proxies AND literals
 * query.where(({ user }) => between(user.age, 18, 65))
 * ```
 *
 * @example
 * ```typescript
 * // Using typed factory helpers
 * import { comparison, transform } from '@tanstack/db'
 *
 * const notEquals = defineOperator<boolean, [a: unknown, b: unknown]>({
 *   name: 'notEquals',
 *   compile: comparison((a, b) => a !== b)
 * })
 *
 * const double = defineOperator<number, [value: number]>({
 *   name: 'double',
 *   compile: transform((v) => v * 2)
 * })
 * ```
 */
export function defineOperator<
  TReturn = unknown,
  TArgs extends Array<unknown> = Array<unknown>,
>(
  config: OperatorConfig<TArgs>,
): (...args: ExpressionArgs<TArgs>) => Func<TReturn> {
  const { name, compile } = config
  return (...args: ExpressionArgs<TArgs>): Func<TReturn> =>
    // Cast is safe because TypedEvaluatorFactory is compatible with EvaluatorFactory
    new Func(name, args.map(toExpression), compile as EvaluatorFactory)
}

// ============================================================
// DEFINE AGGREGATE
// ============================================================

/**
 * Define a custom aggregate function for use in TanStack DB queries.
 *
 * This function creates a builder function that generates Aggregate IR nodes
 * with your custom configuration. The aggregate uses the IVM aggregate pattern
 * with preMap, reduce, and optional postMap phases.
 *
 * @typeParam TReturn - The return type of the aggregate (default: `unknown`)
 * @typeParam TArg - The semantic type of the argument (default: `unknown`)
 * @param config - The aggregate configuration
 * @returns A function that creates Aggregate nodes when called with an argument
 *
 * @example
 * ```typescript
 * import { defineAggregate } from '@tanstack/db'
 *
 * // Define a typed "product" aggregate that multiplies all values
 * const product = defineAggregate<number, number>({
 *   name: 'product',
 *   factory: (valueExtractor) => ({
 *     preMap: valueExtractor,
 *     reduce: (values) => {
 *       let result = 1
 *       for (const [value, multiplicity] of values) {
 *         for (let i = 0; i < multiplicity; i++) {
 *           result *= value
 *         }
 *       }
 *       return result
 *     }
 *   }),
 *   valueTransform: 'numeric'
 * })
 *
 * // product accepts: number | RefLeaf<number> | BasicExpression<number> | ...
 * query
 *   .from({ items: itemsCollection })
 *   .groupBy(({ items }) => items.category)
 *   .select(({ items }) => ({
 *     category: items.category,
 *     priceProduct: product(items.price)
 *   }))
 * ```
 */
export function defineAggregate<TReturn = unknown, TArg = unknown>(
  config: AggregateDefinition,
): (arg: ExpressionArg<TArg>) => Aggregate<TReturn> {
  const { name, factory, valueTransform } = config
  const aggregateConfig: AggregateConfig = { factory, valueTransform }
  return (arg: ExpressionArg<TArg>): Aggregate<TReturn> =>
    new Aggregate(name, [toExpression(arg)], aggregateConfig)
}
