import type { BasicExpression } from '../src/query/ir.js'

function compareReferenceValues(left: unknown, right: unknown): number {
  if (left === right) return 0
  // Query order cursors use nulls-first ordering. Treat null as the least
  // value so adapters can evaluate the same cursor boundary independently.
  if (left === null) return -1
  if (right === null) return 1
  if (typeof left === `number` && typeof right === `number`) {
    return left < right ? -1 : 1
  }
  if (typeof left === `string` && typeof right === `string`) {
    return left < right ? -1 : 1
  }
  throw new Error(`reference comparison requires like-typed numbers or strings`)
}

/** Evaluate the BasicExpression subset used by test-only reference models. */
export function evaluateReferenceExpression(
  expression: BasicExpression,
  row: object,
): unknown {
  if (expression.type === `val`) return expression.value
  if (expression.type === `ref`) {
    let value: unknown = row
    for (const segment of expression.path) {
      if (typeof value !== `object` || value === null) return undefined
      value = (value as Record<string, unknown>)[segment]
    }
    return value
  }

  const args = expression.args.map((argument) =>
    evaluateReferenceExpression(argument, row),
  )
  switch (expression.name) {
    case `and`:
      return args.every(Boolean)
    case `or`:
      return args.some(Boolean)
    case `not`:
      return !args[0]
    case `eq`:
      return args[0] === args[1]
    case `gt`:
      return compareReferenceValues(args[0], args[1]) > 0
    case `gte`:
      return compareReferenceValues(args[0], args[1]) >= 0
    case `lt`:
      return compareReferenceValues(args[0], args[1]) < 0
    case `lte`:
      return compareReferenceValues(args[0], args[1]) <= 0
    case `in`:
      if (!Array.isArray(args[1])) throw new Error(`IN requires an array`)
      return args[1].includes(args[0])
    default:
      throw new Error(`unsupported reference expression: ${expression.name}`)
  }
}
