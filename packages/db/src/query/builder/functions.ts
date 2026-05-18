import { Aggregate, Func } from '../ir'
import { isRefProxy, toExpression } from './ref-proxy.js'
import type { BasicExpression } from '../ir'
import type { RefProxy } from './ref-proxy.js'
import type {
  Context,
  GetRawResult,
  RefLeaf,
  StringifiableScalar,
} from './types.js'
import type { QueryBuilder } from './index.js'

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
type StringLike =
  | StringRef
  | StringRefProxy
  | StringBasicExpression
  | string
  | null
  | undefined

type ComparisonOperand<T> =
  | RefProxy<T>
  | RefLeaf<T>
  | T
  | BasicExpression<T>
  | undefined
  | null
type ComparisonOperandPrimitive<T extends string | number | boolean> =
  | T
  | BasicExpression<T>
  | undefined
  | null

// Helper type for values that can be lowered to expressions.
type ExpressionLike =
  | Aggregate
  | BasicExpression
  | RefProxy<any>
  | RefLeaf<any>
  | string
  | number
  | boolean
  | bigint
  | Date
  | null
  | undefined
  | Array<unknown>

type CaseWhenValue =
  | ExpressionLike
  | QueryBuilder<any>
  | ToArrayWrapper<any>
  | ConcatToArrayWrapper<any>
  | Record<string, any>

type ExtractCaseWhenValue<T> =
  T extends CaseWhenWrapper<infer TResult> ? TResult : T

type CaseWhenResult<
  TValues extends Array<CaseWhenValue>,
  THasDefault extends boolean,
> = TValues[number] extends ExpressionLike
  ? BasicExpression<
      ExtractType<TValues[number]> | (THasDefault extends true ? never : null)
    >
  : CaseWhenWrapper<
      | ExtractCaseWhenValue<TValues[number]>
      | (THasDefault extends true ? never : undefined)
    >

// Helper type to extract the underlying type from various expression types
type ExtractType<T> =
  T extends RefProxy<infer U>
    ? U
    : T extends RefLeaf<infer U>
      ? U
      : T extends BasicExpression<infer U>
        ? U
        : T

// Helper type to determine aggregate return type based on input nullability
type AggregateReturnType<T> =
  ExtractType<T> extends infer U
    ? U extends number | undefined | null | Date | bigint | string
      ? Aggregate<U>
      : Aggregate<number | undefined | null | Date | bigint | string>
    : Aggregate<number | undefined | null | Date | bigint | string>

// Helper type to determine string function return type based on input nullability
type StringFunctionReturnType<T> =
  ExtractType<T> extends infer U
    ? U extends string | undefined | null
      ? BasicExpression<U>
      : BasicExpression<string | undefined | null>
    : BasicExpression<string | undefined | null>

// Helper type to determine numeric function return type based on input nullability
// This handles string, array, and number inputs for functions like length()
type NumericFunctionReturnType<T> =
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
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function eq<T extends string | number | boolean>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>,
): BasicExpression<boolean>
export function eq<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function eq(left: any, right: any): BasicExpression<boolean> {
  return new Func(`eq`, [toExpression(left), toExpression(right)])
}

export function gt<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function gt<T extends string | number>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>,
): BasicExpression<boolean>
export function gt<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function gt(left: any, right: any): BasicExpression<boolean> {
  return new Func(`gt`, [toExpression(left), toExpression(right)])
}

export function gte<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function gte<T extends string | number>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>,
): BasicExpression<boolean>
export function gte<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function gte(left: any, right: any): BasicExpression<boolean> {
  return new Func(`gte`, [toExpression(left), toExpression(right)])
}

export function lt<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function lt<T extends string | number>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>,
): BasicExpression<boolean>
export function lt<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function lt(left: any, right: any): BasicExpression<boolean> {
  return new Func(`lt`, [toExpression(left), toExpression(right)])
}

export function lte<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function lte<T extends string | number>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>,
): BasicExpression<boolean>
export function lte<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function lte(left: any, right: any): BasicExpression<boolean> {
  return new Func(`lte`, [toExpression(left), toExpression(right)])
}

// Overloads for and() - support 2 or more arguments
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
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
    allArgs.map((arg) => toExpression(arg)),
  )
}

// Overloads for or() - support 2 or more arguments
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
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
    allArgs.map((arg) => toExpression(arg)),
  )
}

export function not(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`not`, [toExpression(value)])
}

// Null/undefined checking functions
export function isUndefined(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isUndefined`, [toExpression(value)])
}

export function isNull(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isNull`, [toExpression(value)])
}

export function inArray(
  value: ExpressionLike,
  array: ExpressionLike,
): BasicExpression<boolean> {
  return new Func(`in`, [toExpression(value), toExpression(array)])
}

export function like(
  left: StringLike,
  right: StringLike,
): BasicExpression<boolean>
export function like(left: any, right: any): BasicExpression<boolean> {
  return new Func(`like`, [toExpression(left), toExpression(right)])
}

export function ilike(
  left: StringLike,
  right: StringLike,
): BasicExpression<boolean> {
  return new Func(`ilike`, [toExpression(left), toExpression(right)])
}

// Functions

export function upper<T extends ExpressionLike>(
  arg: T,
): StringFunctionReturnType<T> {
  return new Func(`upper`, [toExpression(arg)]) as StringFunctionReturnType<T>
}

export function lower<T extends ExpressionLike>(
  arg: T,
): StringFunctionReturnType<T> {
  return new Func(`lower`, [toExpression(arg)]) as StringFunctionReturnType<T>
}

export function length<T extends ExpressionLike>(
  arg: T,
): NumericFunctionReturnType<T> {
  return new Func(`length`, [toExpression(arg)]) as NumericFunctionReturnType<T>
}

export function concat<T extends StringifiableScalar>(
  arg: ToArrayWrapper<T>,
): ConcatToArrayWrapper<T>
export function concat(...args: Array<ExpressionLike>): BasicExpression<string>
export function concat(
  ...args: Array<ExpressionLike | ToArrayWrapper<any>>
): BasicExpression<string> | ConcatToArrayWrapper<any> {
  const toArrayArg = args.find(
    (arg): arg is ToArrayWrapper<any> => arg instanceof ToArrayWrapper,
  )

  if (toArrayArg) {
    if (args.length !== 1) {
      throw new Error(
        `concat(toArray(...)) currently supports only a single toArray(...) argument`,
      )
    }
    return new ConcatToArrayWrapper(toArrayArg.query)
  }

  return new Func(
    `concat`,
    args.map((arg) => toExpression(arg)),
  )
}

// Helper type for coalesce: extracts non-nullish value types from all args
type CoalesceArgTypes<T extends Array<ExpressionLike>> = {
  [K in keyof T]: NonNullable<ExtractType<T[K]>>
}[number]

// Whether any arg in the tuple is statically guaranteed non-null (i.e., does not include null | undefined)
type HasGuaranteedNonNull<T extends Array<ExpressionLike>> = {
  [K in keyof T]: null extends ExtractType<T[K]>
    ? false
    : undefined extends ExtractType<T[K]>
      ? false
      : true
}[number] extends false
  ? false
  : true

// coalesce() return type: union of all non-null arg types; null included unless a guaranteed non-null arg exists
type CoalesceReturnType<T extends Array<ExpressionLike>> =
  HasGuaranteedNonNull<T> extends true
    ? BasicExpression<CoalesceArgTypes<T>>
    : BasicExpression<CoalesceArgTypes<T> | null>

export function coalesce<T extends [ExpressionLike, ...Array<ExpressionLike>]>(
  ...args: T
): CoalesceReturnType<T> {
  return new Func(
    `coalesce`,
    args.map((arg) => toExpression(arg)),
  ) as CoalesceReturnType<T>
}

/**
 * Returns the value for the first matching condition, similar to SQL
 * `CASE WHEN`.
 *
 * Arguments are evaluated as condition/value pairs followed by an optional
 * default value. Scalar branch values return a query expression and can be used
 * in expression contexts like `select`, `where`, `orderBy`, `groupBy`,
 * `having`, and equality join operands. If no scalar branch matches and no
 * default is provided, the result is `null`.
 *
 * When a branch value is a projection object, `caseWhen` becomes a select-only
 * projection value. Projection branches can include nested fields, ref spreads,
 * and includes. If no projection branch matches and no default is provided, the
 * result is `undefined`.
 *
 * @example
 * ```ts
 * caseWhen(gt(user.age, 18), `adult`, `minor`)
 * ```
 *
 * @example
 * ```ts
 * caseWhen(
 *   gt(user.age, 65),
 *   `senior`,
 *   gt(user.age, 18),
 *   `adult`,
 *   `minor`,
 * )
 * ```
 *
 * @example
 * ```ts
 * caseWhen(gt(user.age, 18), {
 *   ...user,
 *   posts: q
 *     .from({ post: postsCollection })
 *     .where(({ post }) => eq(post.userId, user.id)),
 * })
 * ```
 */
export function caseWhen<C1 extends ExpressionLike, V1 extends CaseWhenValue>(
  condition1: C1,
  value1: V1,
): CaseWhenResult<[V1], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  defaultValue: D,
): CaseWhenResult<[V1, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
): CaseWhenResult<[V1, V2], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  defaultValue: D,
): CaseWhenResult<[V1, V2, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
): CaseWhenResult<[V1, V2, V3], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
): CaseWhenResult<[V1, V2, V3, V4], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, V4, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
): CaseWhenResult<[V1, V2, V3, V4, V5], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, V4, V5, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
  C8 extends ExpressionLike,
  V8 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
  condition8: C8,
  value8: V8,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7, V8], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
  C8 extends ExpressionLike,
  V8 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
  condition8: C8,
  value8: V8,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7, V8, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
  C8 extends ExpressionLike,
  V8 extends CaseWhenValue,
  C9 extends ExpressionLike,
  V9 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
  condition8: C8,
  value8: V8,
  condition9: C9,
  value9: V9,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7, V8, V9], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
  C8 extends ExpressionLike,
  V8 extends CaseWhenValue,
  C9 extends ExpressionLike,
  V9 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
  condition8: C8,
  value8: V8,
  condition9: C9,
  value9: V9,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7, V8, V9, D], true>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
  C8 extends ExpressionLike,
  V8 extends CaseWhenValue,
  C9 extends ExpressionLike,
  V9 extends CaseWhenValue,
  C10 extends ExpressionLike,
  V10 extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
  condition8: C8,
  value8: V8,
  condition9: C9,
  value9: V9,
  condition10: C10,
  value10: V10,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7, V8, V9, V10], false>
export function caseWhen<
  C1 extends ExpressionLike,
  V1 extends CaseWhenValue,
  C2 extends ExpressionLike,
  V2 extends CaseWhenValue,
  C3 extends ExpressionLike,
  V3 extends CaseWhenValue,
  C4 extends ExpressionLike,
  V4 extends CaseWhenValue,
  C5 extends ExpressionLike,
  V5 extends CaseWhenValue,
  C6 extends ExpressionLike,
  V6 extends CaseWhenValue,
  C7 extends ExpressionLike,
  V7 extends CaseWhenValue,
  C8 extends ExpressionLike,
  V8 extends CaseWhenValue,
  C9 extends ExpressionLike,
  V9 extends CaseWhenValue,
  C10 extends ExpressionLike,
  V10 extends CaseWhenValue,
  D extends CaseWhenValue,
>(
  condition1: C1,
  value1: V1,
  condition2: C2,
  value2: V2,
  condition3: C3,
  value3: V3,
  condition4: C4,
  value4: V4,
  condition5: C5,
  value5: V5,
  condition6: C6,
  value6: V6,
  condition7: C7,
  value7: V7,
  condition8: C8,
  value8: V8,
  condition9: C9,
  value9: V9,
  condition10: C10,
  value10: V10,
  defaultValue: D,
): CaseWhenResult<[V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, D], true>
export function caseWhen(...args: Array<CaseWhenValue>): any {
  if (args.length < 2) {
    throw new Error(`caseWhen() requires at least two arguments`)
  }

  const pairCount = Math.floor(args.length / 2)
  for (let i = 0; i < pairCount; i++) {
    const condition = args[i * 2]
    if (!isConditionValue(condition)) {
      throw new Error(`caseWhen() conditions must be expression-like values`)
    }
  }

  if (caseWhenHasOnlyExpressionValues(args)) {
    return new Func(
      `caseWhen`,
      args.map((arg) => toExpression(arg)),
    )
  }

  return new CaseWhenWrapper(args)
}

export function add<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2,
): BinaryNumericReturnType<T1, T2> {
  return new Func(`add`, [
    toExpression(left),
    toExpression(right),
  ]) as BinaryNumericReturnType<T1, T2>
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

/**
 * All supported operator names in TanStack DB expressions
 */
export const operators = [
  // Comparison operators
  `eq`,
  `gt`,
  `gte`,
  `lt`,
  `lte`,
  `in`,
  `like`,
  `ilike`,
  // Logical operators
  `and`,
  `or`,
  `not`,
  // Null checking
  `isNull`,
  `isUndefined`,
  // String functions
  `upper`,
  `lower`,
  `length`,
  `concat`,
  // Numeric functions
  `add`,
  // Utility functions
  `coalesce`,
  `caseWhen`,
  // Aggregate functions
  `count`,
  `avg`,
  `sum`,
  `min`,
  `max`,
] as const

export type OperatorName = (typeof operators)[number]

export class ToArrayWrapper<_T = unknown> {
  readonly __brand = `ToArrayWrapper` as const
  declare readonly _type: `toArray`
  declare readonly _result: _T
  constructor(public readonly query: QueryBuilder<any>) {}
}

export class ConcatToArrayWrapper<_T = unknown> {
  readonly __brand = `ConcatToArrayWrapper` as const
  declare readonly _type: `concatToArray`
  declare readonly _result: _T
  constructor(public readonly query: QueryBuilder<any>) {}
}

export class CaseWhenWrapper<_T = any> {
  readonly __brand = `CaseWhenWrapper` as const
  declare readonly _type: `caseWhen`
  readonly _result?: _T
  constructor(public readonly args: Array<CaseWhenValue>) {}
}

export function toArray<TContext extends Context>(
  query: QueryBuilder<TContext>,
): ToArrayWrapper<GetRawResult<TContext>> {
  return new ToArrayWrapper(query)
}

function caseWhenHasOnlyExpressionValues(args: Array<CaseWhenValue>): boolean {
  const valueIndexes = getCaseWhenValueIndexes(args.length)
  return valueIndexes.every((index) => isExpressionValue(args[index]))
}

function getCaseWhenValueIndexes(argCount: number): Array<number> {
  const valueIndexes: Array<number> = []
  const hasDefaultValue = argCount % 2 === 1
  const pairCount = Math.floor(argCount / 2)

  for (let i = 0; i < pairCount; i++) {
    valueIndexes.push(i * 2 + 1)
  }

  if (hasDefaultValue) {
    valueIndexes.push(argCount - 1)
  }

  return valueIndexes
}

function isExpressionValue(value: CaseWhenValue | undefined): boolean {
  if (isRefProxy(value)) return true
  if (value instanceof Aggregate || value instanceof Func) return true
  if (value == null) return true
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `boolean` ||
    typeof value === `bigint`
  ) {
    return true
  }
  if (value instanceof Date || Array.isArray(value)) return true
  if (typeof value === `object` && `type` in value) {
    return (
      value.type === `agg` ||
      value.type === `func` ||
      value.type === `ref` ||
      value.type === `val`
    )
  }
  return false
}

function isConditionValue(value: CaseWhenValue | undefined): boolean {
  return isExpressionValue(value) && !Array.isArray(value)
}
