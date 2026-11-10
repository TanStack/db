import { filter, join as joinOperator, map } from '@tanstack/db-ivm'
import type { KeyedStream } from '../../types.js'

const PARENT_ROUTE_CROSS_KEY = `__tanstack_parent_route_cross__`

export function crossJoinParentRoutes(
  input: KeyedStream,
  parentKeyStream: KeyedStream,
  assemble: (
    rowKey: unknown,
    row: unknown,
    correlationKey: unknown,
    parentContext: unknown,
  ) => [unknown, unknown],
): KeyedStream {
  // Recursive sources need their route before a correlation field is always
  // available. The constant key intentionally creates one copy of each input
  // row per active route; callers filter those copies once the field is visible.
  const rows: any = input.pipe(
    map(([rowKey, row]) => [PARENT_ROUTE_CROSS_KEY, [rowKey, row]]),
  )
  const routes: any = parentKeyStream.pipe(
    map(([correlationKey, parentContext]) => [
      PARENT_ROUTE_CROSS_KEY,
      [correlationKey, parentContext],
    ]),
  )

  return rows.pipe(
    joinOperator(routes, `inner`),
    filter(([, [rowSide, routeSide]]: any) =>
      Boolean(rowSide != null && routeSide != null),
    ),
    map(([, [rowSide, routeSide]]: any) => {
      const [rowKey, row] = rowSide
      const [correlationKey, parentContext] = routeSide
      return assemble(rowKey, row, correlationKey, parentContext)
    }),
  ) as KeyedStream
}
