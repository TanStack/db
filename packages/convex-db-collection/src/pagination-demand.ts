import type { IR, LoadSubsetOptions } from '@tanstack/db'
import type { ConvexQueryOrder } from './paginated-options'

/** Whether a contiguous, complete provider prefix establishes this exact
 * request. No Convex cursor is decoded and no unseen suffix is consulted. */
export function paginationDemand<TRow>(
  request: LoadSubsetOptions,
  order: ConvexQueryOrder<TRow>,
): (rows: ReadonlyArray<TRow>, exhausted: boolean) => boolean {
  const unsupported = (): never => {
    throw new TypeError(
      `Convex on-demand paging requires the declared numeric query order and supports only its prefix, boundary tie and continuation requests.`,
    )
  }
  const { limit, offset = 0, where, cursor, orderBy } = request
  for (const count of [limit, offset]) {
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
      throw new RangeError(
        `Convex subset offset and limit must be nonnegative safe integers.`,
      )
  }
  const leading = orderBy?.[0]
  if (
    leading &&
    (leading.expression.type !== `ref` ||
      leading.expression.path.length !== 1 ||
      leading.expression.path[0] !== order.field ||
      leading.compareOptions.direction !== order.direction)
  )
    unsupported()
  const comparison = (
    expression: IR.BasicExpression<boolean>,
    name: string,
  ): number => {
    if (
      expression.type !== `func` ||
      expression.name !== name ||
      expression.args.length !== 2
    )
      return unsupported()
    const [field, value] = expression.args
    if (
      field?.type !== `ref` ||
      field.path.length !== 1 ||
      field.path[0] !== order.field ||
      value?.type !== `val` ||
      typeof value.value !== `number` ||
      !Number.isFinite(value.value)
    )
      return unsupported()
    return value.value
  }
  const direction = order.direction === `asc` ? 1 : -1
  // Main where is a scoped tie (emitted by core separately), never a general
  // filter translated into a Convex query. Cursor expressions stay separate.
  const equal = where === undefined ? undefined : comparison(where, `eq`)
  let after: number | undefined
  if (cursor) {
    const boundary = comparison(cursor.whereFrom, direction === 1 ? `gt` : `lt`)
    if (comparison(cursor.whereCurrent, `eq`) !== boundary) unsupported()
    // Core permits offset encoding instead of cursor encoding. A provided
    // absolute offset takes precedence; cursor-only callers keep their scope.
    if (request.offset === undefined) after = boundary
  }
  return (rows, exhausted) => {
    if (limit === 0) return true
    let count = 0
    let boundary: number | undefined
    let last: number | undefined
    for (const row of rows) {
      const value = row[order.field]
      if (typeof value !== `number` || !Number.isFinite(value))
        return unsupported()
      if (last !== undefined && direction * (value - last) < 0)
        return unsupported()
      last = value
      if (equal !== undefined && direction * (value - equal) > 0) return true
      if (
        (equal === undefined || value === equal) &&
        (after === undefined || direction * (value - after) > 0)
      ) {
        count++
        if (limit !== undefined && count === offset + limit) boundary = value
      }
      if (boundary !== undefined && direction * (value - boundary) > 0)
        return true
    }
    return exhausted
  }
}
