import type { Row, Scope } from './model.js'

export type Page<T> = { rows: Array<T>; nextCursor: string | null }
export type FetchPage<T> = (
  cursor: string | undefined,
  signal?: AbortSignal,
) => Promise<Page<T>>

let nextSequence = 0

/** Backend token table is private to the fixture; the pager cannot decode it. */
export function createBackend(
  source: ReadonlyArray<Row>,
  scope: Scope,
  pageSize: number,
  emptyFirst = false,
) {
  const sequence = ++nextSequence
  const rows: Array<Row> = []
  // Separate formulation from the model's filter/sort/slice. The backend's
  // trusted job is to expose one stable relation in opaque, finite pages.
  for (const row of source) {
    if (scope.group !== undefined && row.group !== scope.group) continue
    const position = rows.findIndex((other) => {
      const before =
        row.rank < other.rank || (row.rank === other.rank && row.id < other.id)
      return scope.descending ? !before : before
    })
    rows.splice(position < 0 ? rows.length : position, 0, { ...row })
  }
  const tokens = new Map<string, number>()
  let serial = 0
  const calls: Array<string | undefined> = []
  const token = (offset: number): string => {
    const value = `opaque-${sequence}-${++serial}-${Math.imul(serial, 2654435761) >>> 0}`
    tokens.set(value, offset)
    return value
  }
  const fetchPage: FetchPage<Row> = (cursor, signal) => {
    signal?.throwIfAborted()
    calls.push(cursor)
    if (emptyFirst && cursor === undefined) {
      return Promise.resolve({ rows: [], nextCursor: token(0) })
    }
    const offset = cursor === undefined ? 0 : tokens.get(cursor)
    if (offset === undefined) throw new Error(`Foreign or invented cursor`)
    const page = rows.slice(offset, offset + pageSize)
    const end = offset + page.length
    return Promise.resolve({
      rows: page.map((row) => ({ ...row })),
      nextCursor: end < rows.length ? token(end) : null,
    })
  }
  return { fetchPage, calls }
}
