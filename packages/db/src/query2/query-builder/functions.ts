import { Agg, Func } from "../ir"
import { toExpression } from "./ref-proxy.js"
import type { Expression } from "../ir"
import type { RefProxy } from "./ref-proxy.js"

// Helper types for type-safe expressions - cleaned up

// Helper type for string operations
type StringLike<T> =
  T extends RefProxy<string>
    ? RefProxy<string> | string | Expression<string>
    : T extends string
      ? string | Expression<string>
      : Expression<string>

// Helper type for numeric operations
type NumberLike<T> =
  T extends RefProxy<number>
    ? RefProxy<number> | number | Expression<number>
    : T extends number
      ? number | Expression<number>
      : Expression<number>

// Helper type for any expression-like value
type ExpressionLike = Expression | RefProxy<any> | any

// Operators

export function eq(
  left: RefProxy<string>,
  right: string | RefProxy<string> | Expression<string>
): Expression<boolean>
export function eq(
  left: RefProxy<number>,
  right: number | RefProxy<number> | Expression<number>
): Expression<boolean>
export function eq(
  left: RefProxy<boolean>,
  right: boolean | RefProxy<boolean> | Expression<boolean>
): Expression<boolean>
export function eq<T>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function eq(
  left: string,
  right: string | Expression<string>
): Expression<boolean>
export function eq(
  left: number,
  right: number | Expression<number>
): Expression<boolean>
export function eq(
  left: boolean,
  right: boolean | Expression<boolean>
): Expression<boolean>
export function eq(
  left: Expression<string>,
  right: string | Expression<string>
): Expression<boolean>
export function eq(
  left: Expression<number>,
  right: number | Expression<number>
): Expression<boolean>
export function eq(
  left: Expression<boolean>,
  right: boolean | Expression<boolean>
): Expression<boolean>
export function eq(left: any, right: any): Expression<boolean> {
  return new Func(`eq`, [toExpression(left), toExpression(right)])
}

export function gt(
  left: RefProxy<number>,
  right: number | RefProxy<number> | Expression<number>
): Expression<boolean>
export function gt(
  left: RefProxy<string>,
  right: string | RefProxy<string> | Expression<string>
): Expression<boolean>
export function gt<T extends string | number>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function gt(
  left: number,
  right: number | Expression<number>
): Expression<boolean>
export function gt(
  left: string,
  right: string | Expression<string>
): Expression<boolean>
export function gt(
  left: Expression<number>,
  right: Expression<number> | number
): Expression<boolean>
export function gt(
  left: Expression<string>,
  right: Expression<string> | string
): Expression<boolean>
export function gt(
  left: Agg<number>,
  right: number | Expression<number>
): Expression<boolean>
export function gt(
  left: Agg<string>,
  right: string | Expression<string>
): Expression<boolean>
export function gt<T>(left: Agg<T>, right: any): Expression<boolean>
export function gt(left: any, right: any): Expression<boolean> {
  return new Func(`gt`, [toExpression(left), toExpression(right)])
}

export function gte(
  left: RefProxy<number>,
  right: number | RefProxy<number> | Expression<number>
): Expression<boolean>
export function gte(
  left: RefProxy<string>,
  right: string | RefProxy<string> | Expression<string>
): Expression<boolean>
export function gte<T extends string | number>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function gte(
  left: number,
  right: number | Expression<number>
): Expression<boolean>
export function gte(
  left: string,
  right: string | Expression<string>
): Expression<boolean>
export function gte(
  left: Expression<number>,
  right: Expression<number> | number
): Expression<boolean>
export function gte(
  left: Expression<string>,
  right: Expression<string> | string
): Expression<boolean>
export function gte(
  left: Agg<number>,
  right: number | Expression<number>
): Expression<boolean>
export function gte(
  left: Agg<string>,
  right: string | Expression<string>
): Expression<boolean>
export function gte<T>(left: Agg<T>, right: any): Expression<boolean>
export function gte(left: any, right: any): Expression<boolean> {
  return new Func(`gte`, [toExpression(left), toExpression(right)])
}

export function lt(
  left: RefProxy<number>,
  right: number | RefProxy<number> | Expression<number>
): Expression<boolean>
export function lt(
  left: RefProxy<string>,
  right: string | RefProxy<string> | Expression<string>
): Expression<boolean>
export function lt<T extends string | number>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function lt(
  left: number,
  right: number | Expression<number>
): Expression<boolean>
export function lt(
  left: string,
  right: string | Expression<string>
): Expression<boolean>
export function lt(
  left: Expression<number>,
  right: Expression<number> | number
): Expression<boolean>
export function lt(
  left: Expression<string>,
  right: Expression<string> | string
): Expression<boolean>
export function lt(
  left: Agg<number>,
  right: number | Expression<number>
): Expression<boolean>
export function lt(
  left: Agg<string>,
  right: string | Expression<string>
): Expression<boolean>
export function lt<T>(left: Agg<T>, right: any): Expression<boolean>
export function lt(left: any, right: any): Expression<boolean> {
  return new Func(`lt`, [toExpression(left), toExpression(right)])
}

export function lte(
  left: RefProxy<number>,
  right: number | RefProxy<number> | Expression<number>
): Expression<boolean>
export function lte(
  left: RefProxy<string>,
  right: string | RefProxy<string> | Expression<string>
): Expression<boolean>
export function lte<T extends string | number>(
  left: RefProxy<T>,
  right: T | RefProxy<T> | Expression<T>
): Expression<boolean>
export function lte(
  left: number,
  right: number | Expression<number>
): Expression<boolean>
export function lte(
  left: string,
  right: string | Expression<string>
): Expression<boolean>
export function lte(
  left: Expression<number>,
  right: Expression<number> | number
): Expression<boolean>
export function lte(
  left: Expression<string>,
  right: Expression<string> | string
): Expression<boolean>
export function lte(
  left: Agg<number>,
  right: number | Expression<number>
): Expression<boolean>
export function lte(
  left: Agg<string>,
  right: string | Expression<string>
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

export function isIn(
  value: ExpressionLike,
  array: ExpressionLike
): Expression<boolean> {
  return new Func(`in`, [toExpression(value), toExpression(array)])
}

// Export as 'in' for the examples in README
export { isIn as in }

export function like<T extends RefProxy<string> | string>(
  left: T,
  right: StringLike<T>
): Expression<boolean>
export function like<T extends RefProxy<string | null>>(
  left: T,
  right: string | Expression<string>
): Expression<boolean>
export function like(
  left: Expression<string>,
  right: string | Expression<string>
): Expression<boolean>
export function like(left: any, right: any): Expression<boolean> {
  return new Func(`like`, [toExpression(left), toExpression(right)])
}

export function ilike<T extends RefProxy<string> | string>(
  left: T,
  right: StringLike<T>
): Expression<boolean> {
  return new Func(`ilike`, [toExpression(left), toExpression(right)])
}

// Functions

export function upper(
  arg: RefProxy<string> | string | Expression<string>
): Expression<string> {
  return new Func(`upper`, [toExpression(arg)])
}

export function lower(
  arg: RefProxy<string> | string | Expression<string>
): Expression<string> {
  return new Func(`lower`, [toExpression(arg)])
}

export function length(
  arg: RefProxy<string> | string | Expression<string>
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

export function add<T extends RefProxy<number> | number>(
  left: T,
  right: NumberLike<T>
): Expression<number>
export function add(
  left: Expression<number>,
  right: Expression<number> | number
): Expression<number>
export function add(left: any, right: any): Expression<number> {
  return new Func(`add`, [toExpression(left), toExpression(right)])
}

// Aggregates

export function count(arg: ExpressionLike): Agg<number> {
  return new Agg(`count`, [toExpression(arg)])
}

export function avg(
  arg: RefProxy<number> | number | Expression<number>
): Agg<number> {
  return new Agg(`avg`, [toExpression(arg)])
}

export function sum(
  arg: RefProxy<number> | number | Expression<number>
): Agg<number> {
  return new Agg(`sum`, [toExpression(arg)])
}

export function min<T>(arg: T | Expression<T>): Agg<T> {
  return new Agg(`min`, [toExpression(arg)])
}

export function max<T>(arg: T | Expression<T>): Agg<T> {
  return new Agg(`max`, [toExpression(arg)])
}
