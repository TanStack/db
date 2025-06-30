import { Agg, Func } from "../ir"
import { toExpression } from "./ref-proxy.js"
import type { Expression } from "../ir"
import type { RefProxy } from "./ref-proxy.js"

// Helper type for any expression-like value
type ExpressionLike = Expression | RefProxy<any> | any

// Operators

export function eq<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function eq<T extends string | number | boolean>(
  left: T | Expression<T>,
  right: T | Expression<T>
): Expression<boolean>
export function eq<T>(left: Agg<T>, right: any): Expression<boolean>
export function eq(left: any, right: any): Expression<boolean> {
  return new Func(`eq`, [toExpression(left), toExpression(right)])
}

export function gt<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function gt<T extends string | number>(
  left: T | Expression<T>,
  right: T | Expression<T>
): Expression<boolean>
export function gt<T>(left: Agg<T>, right: any): Expression<boolean>
export function gt(left: any, right: any): Expression<boolean> {
  return new Func(`gt`, [toExpression(left), toExpression(right)])
}

export function gte<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function gte<T extends string | number>(
  left: T | Expression<T>,
  right: T | Expression<T>
): Expression<boolean>
export function gte<T>(left: Agg<T>, right: any): Expression<boolean>
export function gte(left: any, right: any): Expression<boolean> {
  return new Func(`gte`, [toExpression(left), toExpression(right)])
}

export function lt<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function lt<T extends string | number>(
  left: T | Expression<T>,
  right: T | Expression<T>
): Expression<boolean>
export function lt<T>(left: Agg<T>, right: any): Expression<boolean>
export function lt(left: any, right: any): Expression<boolean> {
  return new Func(`lt`, [toExpression(left), toExpression(right)])
}

export function lte<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function lte<T extends string | number>(
  left: T | Expression<T>,
  right: T | Expression<T>
): Expression<boolean>
export function lte<T>(left: Agg<T>, right: any): Expression<boolean>
export function lte(left: any, right: any): Expression<boolean> {
  return new Func(`lte`, [toExpression(left), toExpression(right)])
}

// Overloads for and() - support 2 or more arguments
export function and(
  left: ExpressionLike,
  right: ExpressionLike
): Expression<boolean>
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): Expression<boolean>
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): Expression<boolean> {
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
): Expression<boolean>
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): Expression<boolean>
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): Expression<boolean> {
  const allArgs = [left, right, ...rest]
  return new Func(
    `or`,
    allArgs.map((arg) => toExpression(arg))
  )
}

export function not(value: ExpressionLike): Expression<boolean> {
  return new Func(`not`, [toExpression(value)])
}

export function inArray(
  value: ExpressionLike,
  array: ExpressionLike
): Expression<boolean> {
  return new Func(`in`, [toExpression(value), toExpression(array)])
}

export function like(
  left:
    | RefProxy<string>
    | RefProxy<string | null>
    | RefProxy<string | undefined>
    | string
    | Expression<string>,
  right: string | RefProxy<string> | Expression<string>
): Expression<boolean>
export function like(left: any, right: any): Expression<boolean> {
  return new Func(`like`, [toExpression(left), toExpression(right)])
}

export function ilike(
  left:
    | RefProxy<string>
    | RefProxy<string | null>
    | RefProxy<string | undefined>
    | string
    | Expression<string>,
  right: string | RefProxy<string> | Expression<string>
): Expression<boolean> {
  return new Func(`ilike`, [toExpression(left), toExpression(right)])
}

// Functions

export function upper(
  arg:
    | RefProxy<string>
    | RefProxy<string | undefined>
    | string
    | Expression<string>
): Expression<string> {
  return new Func(`upper`, [toExpression(arg)])
}

export function lower(
  arg:
    | RefProxy<string>
    | RefProxy<string | undefined>
    | string
    | Expression<string>
): Expression<string> {
  return new Func(`lower`, [toExpression(arg)])
}

export function length(
  arg:
    | RefProxy<string>
    | RefProxy<string | undefined>
    | RefProxy<Array<any>>
    | RefProxy<Array<any> | undefined>
    | string
    | Array<any>
    | Expression<string>
    | Expression<Array<any>>
): Expression<number> {
  return new Func(`length`, [toExpression(arg)])
}

export function concat(...args: Array<ExpressionLike>): Expression<string> {
  return new Func(
    `concat`,
    args.map((arg) => toExpression(arg))
  )
}

export function coalesce(...args: Array<ExpressionLike>): Expression<any> {
  return new Func(
    `coalesce`,
    args.map((arg) => toExpression(arg))
  )
}

export function add(
  left:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | number
    | Expression<number>,
  right:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | number
    | Expression<number>
): Expression<number> {
  return new Func(`add`, [toExpression(left), toExpression(right)])
}

// Aggregates

export function count(arg: ExpressionLike): Agg<number> {
  return new Agg(`count`, [toExpression(arg)])
}

export function avg(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | number
    | Expression<number>
): Agg<number> {
  return new Agg(`avg`, [toExpression(arg)])
}

export function sum(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | number
    | Expression<number>
): Agg<number> {
  return new Agg(`sum`, [toExpression(arg)])
}

export function min(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | number
    | Expression<number>
): Agg<number> {
  return new Agg(`min`, [toExpression(arg)])
}

export function max(
  arg:
    | RefProxy<number>
    | RefProxy<number | undefined>
    | number
    | Expression<number>
): Agg<number> {
  return new Agg(`max`, [toExpression(arg)])
}
