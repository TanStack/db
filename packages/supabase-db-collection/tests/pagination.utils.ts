import { vi } from 'vitest'

type Row = Record<string, number | string | boolean>

const COMPARATORS: Record<string, (a: number, b: number) => boolean> = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  eq: (a, b) => a === b,
}

// Parses `in.(1,2,3)`'s value half (`(1,2,3)`) into its member list. Numeric
// ids are all the split-chunk tests need, so members are compared as numbers.
function parseInList(value: string): Array<number> {
  const inner = value.replace(/^\(/, '').replace(/\)$/, '')
  return inner === '' ? [] : inner.split(',').map(Number)
}

/**
 * A mock `fetch` that serves a fixture like PostgREST would for the read paths
 * the pagination adapter emits: single-column `order`, `limit`, `offset`, and
 * `col=op.value` scalar filters (`gt`/`gte`/`lt`/`lte`/`eq`/`in`). Non-GET
 * requests echo their body back so inserts/updates parse.
 *
 * `cap` simulates PostgREST's `db-max-rows`: no response ever returns more than
 * `cap` rows, even when a larger `limit` is requested, while the Content-Range
 * count still reports the true total — exactly the condition the paging loop
 * exists to handle.
 */
export function makePaginatingFetch(
  fixture: Array<Row>,
  { cap }: { cap?: number } = {},
) {
  const columns = Object.keys(fixture[0] ?? {})
  return vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      return Promise.resolve(json(body))
    }

    const params = new URL(String(input)).searchParams
    let rows = [...fixture]

    for (const column of columns) {
      for (const raw of params.getAll(column)) {
        const [op = '', value = ''] = raw.split(/\.(.*)/s)
        if (op === 'in') {
          const members = new Set(parseInList(value))
          rows = rows.filter((r) => members.has(Number(r[column])))
          continue
        }
        const compare = COMPARATORS[op]
        if (compare) {
          const target = Number(value)
          rows = rows.filter((r) => compare(Number(r[column]), target))
        }
      }
    }

    const order = params.get('order')
    if (order) {
      const [column = '', direction] = (order.split(',')[0] ?? '').split('.')
      const sign = direction === 'desc' ? -1 : 1
      rows.sort((a, b) => (Number(a[column]) - Number(b[column])) * sign)
    }

    // The total matching set before paging — what PostgREST reports in the
    // Content-Range header when `count=exact` is requested.
    const total = rows.length
    const offset = params.get('offset') ? Number(params.get('offset')) : 0
    const limit = params.get('limit')
    const requested = limit === null ? undefined : offset + Number(limit)
    const upperBound =
      cap === undefined
        ? requested
        : Math.min(requested ?? offset + cap, offset + cap)
    rows = rows.slice(offset, upperBound)
    const end = offset + rows.length - 1
    const contentRange = rows.length
      ? `${offset}-${end}/${total}`
      : `*/${total}`
    return Promise.resolve(json(rows, contentRange))
  })
}

function json(body: unknown, contentRange?: string): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (contentRange !== undefined) {
    headers['content-range'] = contentRange
  }
  return new Response(JSON.stringify(body), { status: 200, headers })
}

/**
 * The decoded query strings of every GET the mock captured, in order, with the
 * leading `?` stripped (e.g. `select=*&order=id.asc&limit=2&id=gt.3`).
 */
export function getSearches(
  mockFetch: ReturnType<typeof makePaginatingFetch>,
): Array<string> {
  return mockFetch.mock.calls
    .filter((call) => (call[1]?.method ?? 'GET') === 'GET')
    .map((call) =>
      decodeURIComponent(new URL(String(call[0])).search).replace(/^\?/, ''),
    )
}

/**
 * The rendered (percent-encoded) URL of every GET the mock captured, in
 * order — what actually crosses the wire, and so what a request-line budget
 * is measured against.
 */
export function getRawUrls(
  mockFetch: ReturnType<typeof makePaginatingFetch>,
): Array<string> {
  return mockFetch.mock.calls
    .filter((call) => (call[1]?.method ?? 'GET') === 'GET')
    .map((call) => String(call[0]))
}
