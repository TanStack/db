import { QueryClient } from '@tanstack/query-core'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import type { Collection } from '@tanstack/db'

/**
 * # Does Query settlement carry initial-query readiness?
 *
 * ARCHITECTURE.md law 10 makes a settled `loadSubset` the readiness evidence
 * for an on-demand source, and law 7 says a successful load settles only after
 * its rows are visible. These witnesses drive a real QueryClient under a real
 * live query and record the rows visible at the first-ready transition.
 */

type Row = { id: string; group: string }

let sequence = 0

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
}

function rowsAtFirstReady(query: Collection<any, any, any>) {
  const seen: { rows?: Array<unknown> } = {}
  query.onFirstReady(() => {
    seen.rows = query.toArray.map((row: { id: string }) => row.id).sort()
  })
  return seen
}

function groupQuery(source: Collection<Row, string | number, any>) {
  return createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
  )
}

describe(`Query initial readiness follows applied subset settlement`, () => {
  it(`an on-demand query is first ready with its subset rows visible`, async () => {
    const id = `exposure-on-demand-${sequence++}`
    const response = createDeferred<Array<Row>>()
    const source = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient: createQueryClient(),
        queryKey: [id],
        queryFn: () => response.promise,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
      }),
    )
    const query = groupQuery(source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()
    await Promise.resolve()
    expect(query.isReady()).toBe(false)

    response.resolve([
      { id: `1`, group: `a` },
      { id: `2`, group: `a` },
    ])
    await preload
    expect(seen.rows).toEqual([`1`, `2`])
  })

  it(`an empty on-demand result is authoritative absence`, async () => {
    const id = `exposure-empty-${sequence++}`
    const source = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient: createQueryClient(),
        queryKey: [id],
        queryFn: () => Promise.resolve([]),
        getKey: (row) => row.id,
        syncMode: `on-demand`,
      }),
    )
    const query = groupQuery(source)
    await query.preload()
    expect(query.isReady()).toBe(true)
    expect(query.toArray).toEqual([])
  })

  it(`a failed on-demand load errors the query and never readies it`, async () => {
    const id = `exposure-failure-${sequence++}`
    const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const source = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient: createQueryClient(),
        queryKey: [id],
        queryFn: () => Promise.reject(new Error(`query failed`)),
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        retry: false,
      }),
    )
    const query = groupQuery(source)
    const seen = rowsAtFirstReady(query)
    await query.preload().catch(() => {})
    await vi.waitFor(() => expect(query.status).toBe(`error`))
    expect(seen.rows).toBeUndefined()
    loggedError.mockRestore()
  })

  it(`an abandoned on-demand load installs no rows after its abort`, async () => {
    const id = `exposure-abort-${sequence++}`
    const response = createDeferred<Array<Row>>()
    let signal: AbortSignal | undefined
    const source = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient: createQueryClient(),
        queryKey: [id],
        queryFn: (context) => {
          signal = context.signal
          return response.promise
        },
        getKey: (row) => row.id,
        syncMode: `on-demand`,
      }),
    )
    const query = groupQuery(source)
    void query.preload().catch(() => {})
    await vi.waitFor(() => expect(signal).toBeDefined())
    await query.cleanup()
    response.resolve([{ id: `late`, group: `a` }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(source.has(`late`)).toBe(false)
  })

  it(`a source with no syncMode is eager and gates readiness`, async () => {
    const id = `exposure-eager-default-${sequence++}`
    const response = createDeferred<Array<Row>>()
    const source = createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient: createQueryClient(),
        queryKey: [id],
        queryFn: () => response.promise,
        getKey: (row) => row.id,
      }),
    )
    expect(source.config.syncMode).not.toBe(`on-demand`)
    const query = groupQuery(source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(query.isReady()).toBe(false)
    response.resolve([
      { id: `1`, group: `a` },
      { id: `2`, group: `b` },
    ])
    await preload
    expect(seen.rows).toEqual([`1`])
  })
})
