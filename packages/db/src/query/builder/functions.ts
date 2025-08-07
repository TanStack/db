import { Aggregate, Func } from "../ir"
import { toExpression } from "./ref-proxy.js"
import type { BasicExpression } from "../ir"
import type { RefProxy } from "./ref-proxy.js"
import type { Ref } from "./types.js"

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | RefProxy<any> | Ref<any> | any

// Helper type to extract the underlying type from various expression types
type ExtractType<T> = 
  T extends RefProxy<infer U> ? U
  : T extends Ref<infer U> ? U
  : T extends BasicExpression<infer U> ? U
  : T extends undefined ? undefined
  : T extends null ? null
  : T

// Helper type to determine aggregate return type based on input nullability
type AggregateReturnType<T> = ExtractType<T> extends infer U
  ? U extends number | undefined | null
    ? Aggregate<U>
    : U extends number
      ? Aggregate<number>
      : Aggregate<number | undefined | null>
  : Aggregate<number | undefined | null>

// Helper type to determine string function return type based on input nullability
type StringFunctionReturnType<T> = ExtractType<T> extends infer U
  ? U extends string | undefined | null
    ? BasicExpression<U>
    : U extends string
      ? BasicExpression<string>
      : BasicExpression<string | undefined | null>
  : BasicExpression<string | undefined | null>

// Helper type to determine numeric function return type based on input nullability  
// This handles string, array, and number inputs for functions like length()
type NumericFunctionReturnType<T> = ExtractType<T> extends infer U
  ? U extends string
    ? BasicExpression<number>
    : U extends string | undefined
      ? BasicExpression<number | undefined>
    : U extends string | null
      ? BasicExpression<number | null>
    : U extends string | undefined | null
      ? BasicExpression<number | undefined | null>
    : U extends Array<any>
      ? BasicExpression<number>
    : U extends Array<any> | undefined
      ? BasicExpression<number | undefined>
    : U extends Array<any> | null
      ? BasicExpression<number | null>
    : U extends Array<any> | undefined | null
      ? BasicExpression<number | undefined | null>
    : U extends number | undefined | null
      ? BasicExpression<U>
    : U extends number
      ? BasicExpression<number>
      : BasicExpression<number | undefined | null>
  : BasicExpression<number | undefined | null>

// Helper type for binary numeric operations (combines nullability of both operands)
type BinaryNumericReturnType<T1, T2> = 
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

// Operators

export function eq<T>(
  left: RefProxy<T> | Ref<T> | undefined | null,
  right: T | RefProxy<T> | Ref<T> | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function eq<T extends string | number | boolean>(
  left: T | BasicExpression<T> | undefined | null,
  right: T | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function eq<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function eq(left: any, right: any): BasicExpression<boolean> {
  return new Func(`eq`, [toExpression(left), toExpression(right)])
}

export function gt<T>(
  left: RefProxy<T> | Ref<T> | undefined | null,
  right: T | RefProxy<T> | Ref<T> | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function gt<T extends string | number>(
  left: T | BasicExpression<T> | undefined | null,
  right: T | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function gt<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function gt(left: any, right: any): BasicExpression<boolean> {
  return new Func(`gt`, [toExpression(left), toExpression(right)])
}

export function gte<T>(
  left: RefProxy<T> | Ref<T> | undefined | null,
  right: T | RefProxy<T> | Ref<T> | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function gte<T extends string | number>(
  left: T | BasicExpression<T> | undefined | null,
  right: T | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function gte<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function gte(left: any, right: any): BasicExpression<boolean> {
  return new Func(`gte`, [toExpression(left), toExpression(right)])
}

export function lt<T>(
  left: RefProxy<T> | Ref<T> | undefined | null,
  right: T | RefProxy<T> | Ref<T> | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function lt<T extends string | number>(
  left: T | BasicExpression<T> | undefined | null,
  right: T | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function lt<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function lt(left: any, right: any): BasicExpression<boolean> {
  return new Func(`lt`, [toExpression(left), toExpression(right)])
}

export function lte<T>(
  left: RefProxy<T> | Ref<T> | undefined | null,
  right: T | RefProxy<T> | Ref<T> | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function lte<T extends string | number>(
  left: T | BasicExpression<T> | undefined | null,
  right: T | BasicExpression<T> | undefined | null
): BasicExpression<boolean>
export function lte<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function lte(left: any, right: any): BasicExpression<boolean> {
  return new Func(`lte`, [toExpression(left), toExpression(right)])
}

// Overloads for and() - support 2 or more arguments
export function and(
  left: ExpressionLike,
  right: ExpressionLike
): BasicExpression<boolean>
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean>
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean> {
  const allArgs = [left, right, ...rest]
  return new Func(
    `and`,
    allArgs.map((arg) => toExpression(arg))
  )
}

// Overloads for or() - support 2 or more arguments
export function or(
  left: ExpressionLike,
  right: ExpressionLike
): BasicExpression<boolean>
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean>
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean> {
  const allArgs = [left, right, ...rest]
  return new Func(
    `or`,
    allArgs.map((arg) => toExpression(arg))
  )
}

export function not(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`not`, [toExpression(value)])
}

// Null/undefined checking functions
export function isUndefined(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isUndefined`, [toExpression(value)])
}

export function isNotUndefined(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isNotUndefined`, [toExpression(value)])
}

export function isNull(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isNull`, [toExpression(value)])
}

export function isNotNull(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isNotNull`, [toExpression(value)])
}

export function inArray(
  value: ExpressionLike,
  array: ExpressionLike
): BasicExpression<boolean> {
  return new Func(`in`, [toExpression(value), toExpression(array)])
}

export function like(
  left:
    | RefProxy<string>
    | RefProxy<string | null>
    | RefProxy<string | undefined>
    | string
    | string | null
    | string | undefined
    | BasicExpression<string>
    | BasicExpression<string | null>
    | BasicExpression<string | undefined>
    | null
    | undefined,
  right:
    | string
    | string | null
    | string | undefined
    | RefProxy<string>
    | RefProxy<string | null>
    | RefProxy<string | undefined>
    | BasicExpression<string>
    | BasicExpression<string | null>
    | BasicExpression<string | undefined>
    | null
    | undefined
): BasicExpression<boolean>
export function like(left: any, right: any): BasicExpression<boolean> {
  return new Func(`like`, [toExpression(left), toExpression(right)])
}

export function ilike(
  left:
    | RefProxy<string>
    | RefProxy<string | null>
    | RefProxy<string | undefined>
    | string
    | string | null
    | string | undefined
    | BasicExpression<string>
    | BasicExpression<string | null>
    | BasicExpression<string | undefined>
    | null
    | undefined,
  right:
    | string
    | string | null
    | string | undefined
    | RefProxy<string>
    | RefProxy<string | null>
    | RefProxy<string | undefined>
    | BasicExpression<string>
    | BasicExpression<string | null>
    | BasicExpression<string | undefined>
    | null
    | undefined
): BasicExpression<boolean> {
  return new Func(`ilike`, [toExpression(left), toExpression(right)])
}

// Functions

export function upper<T extends ExpressionLike>(arg: T): StringFunctionReturnType<T> {
  return new Func(`upper`, [toExpression(arg)]) as StringFunctionReturnType<T>
}

export function lower<T extends ExpressionLike>(arg: T): StringFunctionReturnType<T> {
  return new Func(`lower`, [toExpression(arg)]) as StringFunctionReturnType<T>
}

export function length<T extends ExpressionLike>(arg: T): NumericFunctionReturnType<T> {
  return new Func(`length`, [toExpression(arg)]) as NumericFunctionReturnType<T>
}

export function concat(
  ...args: Array<ExpressionLike>
): BasicExpression<string> {
  return new Func(
    `concat`,
    args.map((arg) => toExpression(arg))
  )
}

export function coalesce(...args: Array<ExpressionLike>): BasicExpression<any> {
  return new Func(
    `coalesce`,
    args.map((arg) => toExpression(arg))
  )
}

export function add<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2
): BinaryNumericReturnType<T1, T2> {
  return new Func(`add`, [toExpression(left), toExpression(right)]) as BinaryNumericReturnType<T1, T2>
}

// Aggregates

export function count(arg: ExpressionLike): Aggregate<number> {
  return new Aggregate(`count`, [toExpression(arg)])
}

export function avg<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(`avg`, [toExpression(arg)]) as AggregateReturnType<T>
}

export function sum<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(`sum`, [toExpression(arg)]) as AggregateReturnType<T>
}

export function min<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(`min`, [toExpression(arg)]) as AggregateReturnType<T>
}

export function max<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(`max`, [toExpression(arg)]) as AggregateReturnType<T>
}

/**
 * List of comparison function names that can be used with indexes
 */
export const comparisonFunctions = [
  `eq`,
  `gt`,
  `gte`,
  `lt`,
  `lte`,
  `in`,
  `like`,
  `ilike`,
] as const
