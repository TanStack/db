import { Aggregate, ConditionalSelect, Func, isExpressionLike } from '../ir.js'

/**
 * Returns the first aggregate in a select, having, or orderBy value. It does
 * not enter include subqueries, which compile with their own aggregates.
 * A plain object is a nested select; its fields may use any names.
 */
export function findAggregate(value: unknown): Aggregate | undefined {
  if (value === null || typeof value !== `object`) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const aggregate = findAggregate(item)
      if (aggregate) return aggregate
    }
    return undefined
  }
  if (value instanceof Aggregate) return value
  if (value instanceof Func) return findAggregate(value.args)
  if (value instanceof ConditionalSelect)
    return findAggregate([value.branches, value.defaultValue])
  if (isExpressionLike(value)) return undefined
  return findAggregate(Object.values(value))
}
