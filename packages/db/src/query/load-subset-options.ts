import { Func, PropRef, Value } from './ir.js'
import type { BasicExpression } from './ir.js'
import type { LoadSubsetOptions } from '../types.js'

/** Clone request state before retaining it across an asynchronous boundary. */
export function cloneLoadSubsetOptions(
  options: LoadSubsetOptions,
): LoadSubsetOptions {
  return {
    ...options,
    where: options.where
      ? cloneBasicExpression(options.where, `predicate`)
      : undefined,
    orderBy: options.orderBy?.map((clause) => ({
      ...clause,
      expression: cloneBasicExpression(clause.expression),
      compareOptions: { ...clause.compareOptions },
    })),
    cursor: options.cursor
      ? {
          ...options.cursor,
          whereFrom: cloneBasicExpression(
            options.cursor.whereFrom,
            `predicate`,
          ),
          whereCurrent: cloneBasicExpression(
            options.cursor.whereCurrent,
            `predicate`,
          ),
        }
      : undefined,
  }
}

/** Snapshot data demand without retaining request ownership objects. */
export function snapshotLoadSubsetDemand(
  options: LoadSubsetOptions,
): LoadSubsetOptions {
  const {
    signal: _signal,
    subscription: _subscription,
    ...demand
  } = cloneLoadSubsetOptions(options)
  return demand
}

type ExpressionCloneContext = `exact` | `predicate` | `comparison`

function cloneBasicExpression<T>(
  expression: BasicExpression<T>,
  context: ExpressionCloneContext = `exact`,
): BasicExpression<T> {
  switch (expression.type) {
    case `ref`:
      return new PropRef<T>([...expression.path])
    case `val`:
      return new Value<T>(
        context === `comparison`
          ? snapshotComparisonValue(expression.value)
          : expression.value,
      )
    case `func`:
      return new Func<T>(
        expression.name,
        expression.args.map((arg, index) => {
          if (
            context === `predicate` &&
            expression.name === `in` &&
            index === 1 &&
            arg.type === `val` &&
            Array.isArray(arg.value)
          ) {
            return new Value(
              arg.value.map((value) => snapshotComparisonValue(value)),
            )
          }

          const argumentContext =
            context === `predicate` && isComparisonFunction(expression.name)
              ? `comparison`
              : context
          return cloneBasicExpression(arg, argumentContext)
        }),
      )
  }
}

function isComparisonFunction(name: string): boolean {
  return (
    name === `eq` ||
    name === `gt` ||
    name === `gte` ||
    name === `lt` ||
    name === `lte`
  )
}

function snapshotComparisonValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }

  if (typeof Buffer !== `undefined` && value instanceof Buffer) {
    return Buffer.from(value) as T
  }

  if (value instanceof Uint8Array) {
    return value.slice() as T
  }

  // Other objects use reference equality in predicate identity and comparison.
  return value
}
