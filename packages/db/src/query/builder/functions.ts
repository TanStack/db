import { Aggregate, Func } from "../ir"
import { toExpression } from "./ref-proxy.js"
import type { BasicExpression } from "../ir"
import type { RefProxy } from "./ref-proxy.js"

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | RefProxy<any> | any

// Operators

export function eq<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | BasicExpression<T>
): BasicExpression<boolean>
export function eq<T extends string | number | boolean>(
  left: T | BasicExpression<T>,
  right: T | BasicExpression<T>
): BasicExpression<boolean>
export function eq<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function eq(left: any, right: any): BasicExpression<boolean> {
  return new Func(`eq`, [toExpression(left), toExpression(right)])
}

export function gt<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | BasicExpression<T>
): BasicExpression<boolean>
export function gt<T extends string | number>(
  left: T | BasicExpression<T>,
  right: T | BasicExpression<T>
): BasicExpression<boolean>
export function gt<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function gt(left: any, right: any): BasicExpression<boolean> {
  return new Func(`gt`, [toExpression(left), toExpression(right)])
}

export function gte<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | BasicExpression<T>
): BasicExpression<boolean>
export function gte<T extends string | number>(
  left: T | BasicExpression<T>,
  right: T | BasicExpression<T>
): BasicExpression<boolean>
export function gte<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function gte(left: any, right: any): BasicExpression<boolean> {
  return new Func(`gte`, [toExpression(left), toExpression(right)])
}

export function lt<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | BasicExpression<T>
): BasicExpression<boolean>
export function lt<T extends string | number>(
  left: T | BasicExpression<T>,
  right: T | BasicExpression<T>
): BasicExpression<boolean>
export function lt<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function lt(left: any, right: any): BasicExpression<boolean> {
  return new Func(`lt`, [toExpression(left), toExpression(right)])
}

export function lte<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | BasicExpression<T>
): BasicExpression<boolean>
export function lte<T extends string | number>(
  left: T | BasicExpression<T>,
  right: T | BasicExpression<T>
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

export function upper(
  arg:
    | RefProxy<string>
    | RefProxy<string | undefined>
    | RefProxy<string | null>
    | string
    | string | undefined
    | string | null
    | BasicExpression<string>
    | BasicExpression<string | undefined>
    | BasicExpression<string | null>
    | undefined
    | null
): BasicExpression<string | undefined | null> {
  return new Func(`upper`, [toExpression(arg)])
}

export function lower(
  arg:
    | RefProxy<string>
    | RefProxy<string | undefined>
    | RefProxy<string | null>
    | string
    | string | undefined
    | string | null
    | BasicExpression<string>
    | BasicExpression<string | undefined>
    | BasicExpression<string | null>
    | undefined
    | null
): BasicExpression<string | undefined | null> {
  return new Func(`lower`, [toExpression(arg)])
}

export function length(
  arg:
    | RefProxy<string>
    | RefProxy<string | undefined>
    | RefProxy<string | null>
    | RefProxy<Array<any>>
    | RefProxy<Array<any> | undefined>
    | RefProxy<Array<any> | null>
    | string
    | string | undefined
    | string | null
    | Array<any>
    | Array<any> | undefined
    | Array<any> | null
    | BasicExpression<string>
    | BasicExpression<string | undefined>
    | BasicExpression<string | null>
    | BasicExpression<Array<any>>
    | BasicExpression<Array<any> | undefined>
    | BasicExpression<Array<any> | null>
    | undefined
    | null
): BasicExpression<number | undefined | null> {
  return new Func(`length`, [toExpression(arg)])
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

export function add(
  left:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | RefProxy<number | null>
    | number
    | number | undefined
    | number | null
    | BasicExpression<number>
    | BasicExpression<number | undefined>
    | BasicExpression<number | null>
    | undefined
    | null,
  right:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | RefProxy<number | null>
    | number
    | number | undefined
    | number | null
    | BasicExpression<number>
    | BasicExpression<number | undefined>
    | BasicExpression<number | null>
    | undefined
    | null
): BasicExpression<number | undefined | null> {
  return new Func(`add`, [toExpression(left), toExpression(right)])
}

// Aggregates

export function count(arg: ExpressionLike): Aggregate<number> {
  return new Aggregate(`count`, [toExpression(arg)])
}

export function avg(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | RefProxy<number | null>
    | number
    | number | undefined
    | number | null
    | BasicExpression<number>
    | BasicExpression<number | undefined>
    | BasicExpression<number | null>
    | undefined
    | null
): Aggregate<number | undefined | null> {
  return new Aggregate(`avg`, [toExpression(arg)])
}

export function sum(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | RefProxy<number | null>
    | number
    | number | undefined
    | number | null
    | BasicExpression<number>
    | BasicExpression<number | undefined>
    | BasicExpression<number | null>
    | undefined
    | null
): Aggregate<number | undefined | null> {
  return new Aggregate(`sum`, [toExpression(arg)])
}

export function min(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | RefProxy<number | null>
    | number
    | number | undefined
    | number | null
    | BasicExpression<number>
    | BasicExpression<number | undefined>
    | BasicExpression<number | null>
    | undefined
    | null
): Aggregate<number | undefined | null> {
  return new Aggregate(`min`, [toExpression(arg)])
}

export function max(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | RefProxy<number | null>
    | number
    | number | undefined
    | number | null
    | BasicExpression<number>
    | BasicExpression<number | undefined>
    | BasicExpression<number | null>
    | undefined
    | null
): Aggregate<number | undefined | null> {
  return new Aggregate(`max`, [toExpression(arg)])
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
