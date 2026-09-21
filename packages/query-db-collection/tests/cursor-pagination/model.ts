export type Row = { id: number; rank: number; group: number }
export type Scope = { group: number | undefined; descending: boolean }
export type Window = { offset: number; limit: number | undefined }

/**
 * # What is an opaque cursor window?
 *
 * An exact ordered request is a slice of the whole filtered relation. Numeric
 * rank then ID is the declared total order in this bounded domain. Backend
 * pages, cursor tokens, Query caches, promises, retries, and publication do not
 * enter the value model. Their separate drivers must refine this answer.
 */
export function expectedRows(
  source: ReadonlyArray<Row>,
  scope: Scope,
  window: Window,
): Array<Row> {
  const direction = scope.descending ? -1 : 1
  return source
    .filter((row) => scope.group === undefined || row.group === scope.group)
    .sort((a, b) => direction * (a.rank - b.rank || a.id - b.id))
    .slice(
      window.offset,
      window.limit === undefined ? undefined : window.offset + window.limit,
    )
    .map((row) => ({ ...row }))
}

export function expectedWindow(
  source: ReadonlyArray<Row>,
  scope: Scope,
  n: number,
) {
  const all = expectedRows(source, scope, { offset: 0, limit: undefined })
  return { rows: all.slice(0, n), hasNextPage: all.length > n }
}
