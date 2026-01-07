/**
 * Shared types for operator modules
 * These helper types preserve nullability information in return types
 */

import type { Aggregate, BasicExpression } from '../../ir.js'
import type { RefProxy } from '../ref-proxy.js'
import type { RefLeaf } from '../types.js'

// String-like types
type StringRef =
  | RefLeaf<string>
  | RefLeaf<string | null>
  | RefLeaf<string | undefined>
type StringRefProxy =
  | RefProxy<string>
  | RefProxy<string | null>
  | RefProxy<string | undefined>
type StringBasicExpression =
  | BasicExpression<string>
  | BasicExpression<string | null>
  | BasicExpression<string | undefined>
export type StringLike =
  | StringRef
  | StringRefProxy
  | StringBasicExpression
  | string
  | null
  | undefined

// Comparison operand types
export type ComparisonOperand<T> =
  | RefProxy<T>
  | RefLeaf<T>
  | T
  | BasicExpression<T>
  | undefined
  | null
export type ComparisonOperandPrimitive<T extends string | number | boolean> =
  | T
  | BasicExpression<T>
  | undefined
  | null

// Helper type for any expression-like value
export type ExpressionLike =
  | BasicExpression
  | RefProxy<any>
  | RefLeaf<any>
  | any

// Helper type to extract the underlying type from various expression types
export type ExtractType<T> =
  T extends RefProxy<infer U>
    ? U
    : T extends RefLeaf<infer U>
      ? U
      : T extends BasicExpression<infer U>
        ? U
        : T

// Helper type to determine aggregate return type based on input nullability
export type AggregateReturnType<T> =
  ExtractType<T> extends infer U
    ? U extends number | undefined | null | Date | bigint
      ? Aggregate<U>
      : Aggregate<number | undefined | null | Date | bigint>
    : Aggregate<number | undefined | null | Date | bigint>

// Helper type to determine string function return type based on input nullability
export type StringFunctionReturnType<T> =
  ExtractType<T> extends infer U
    ? U extends string | undefined | null
      ? BasicExpression<U>
      : BasicExpression<string | undefined | null>
    : BasicExpression<string | undefined | null>

// Helper type to determine numeric function return type based on input nullability
// This handles string, array, and number inputs for functions like length()
export type NumericFunctionReturnType<T> =
  ExtractType<T> extends infer U
    ? U extends string | Array<any> | undefined | null | number
      ? BasicExpression<MapToNumber<U>>
      : BasicExpression<number | undefined | null>
    : BasicExpression<number | undefined | null>

// Transform string/array types to number while preserving nullability
type MapToNumber<T> = T extends string | Array<any>
  ? number
  : T extends undefined
    ? undefined
    : T extends null
      ? null
      : T

// Helper type for binary numeric operations (combines nullability of both operands)
export type BinaryNumericReturnType<T1, T2> =
  ExtractType<T1> extends infer U1
    ? ExtractType<T2> extends infer U2
      ? U1 extends number
        ? U2 extends number
          ? BasicExpression<number>
          : U2 extends number | undefined
            ? BasicExpression<number | undefined>
            : U2 extends number | null
              ? BasicExpression<number | null>
              : BasicExpression<number | undefined | null>
        : U1 extends number | undefined
          ? U2 extends number
            ? BasicExpression<number | undefined>
            : U2 extends number | undefined
              ? BasicExpression<number | undefined>
              : BasicExpression<number | undefined | null>
          : U1 extends number | null
            ? U2 extends number
              ? BasicExpression<number | null>
              : BasicExpression<number | undefined | null>
            : BasicExpression<number | undefined | null>
      : BasicExpression<number | undefined | null>
    : BasicExpression<number | undefined | null>
