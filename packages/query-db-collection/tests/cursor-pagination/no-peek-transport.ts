import { createBackend } from './backend.js'
import { createCursorPager } from './pager.js'
import type { Row, Scope } from './model.js'
import type { PrefixPublication } from './no-peek.js'

/** Endpoint fixture derives continuation from opaque pages and retained tails,
 * never from the full-relation oracle or the window controller. */
export function createFactTransport(
  rows: Array<Row>,
  size: number,
  scope: Scope,
) {
  const backend = createBackend(rows, scope, size)
  let fetched = 0
  let remaining = true
  const pager = createCursorPager(async (cursor, signal) => {
    const page = await backend.fetchPage(cursor, signal)
    fetched += page.rows.length
    remaining = page.nextCursor !== null
    return page
  })
  const requests: Array<number> = []
  const read = async (limit: number): Promise<PrefixPublication> => {
    requests.push(limit)
    const result = await pager.read({ offset: 0, limit })
    const stamp = {}
    return {
      rows: result,
      requested: limit,
      stamp,
      transparent: true,
      fact: {
        stamp,
        end: result.length,
        hasMore: fetched > result.length || remaining,
      },
    }
  }
  return { read, requests, backend }
}
