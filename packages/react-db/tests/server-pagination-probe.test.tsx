import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import {
  QueryClient,
  createServerPaginationFixture,
} from '../../query-db-collection/tests/server-pagination-fixture'
import { Func, PropRef, Value } from '../../db/src/query/ir'
import type { ServerRow } from '../../query-db-collection/tests/server-pagination-fixture'
import type { LoadSubsetOptions } from '@tanstack/db'

const rows = Array.from({ length: 8 }, (_, id) => ({ id, rank: id }))
const pageCases = [1, 2, 3, 5].flatMap((serverPageSize) =>
  [1, 2, 5].flatMap((pageSize) =>
    [0, 1, 8].map((rowCount) => ({ serverPageSize, pageSize, rowCount })),
  ),
)

type ServerFixture = ReturnType<typeof createServerPaginationFixture>
type PageSnapshot = {
  data: ReadonlyArray<ServerRow>
  pages: ReadonlyArray<ReadonlyArray<ServerRow>>
  pageParams: ReadonlyArray<number>
}

function expectPageContents(
  snapshot: PageSnapshot,
  sourceRows: ReadonlyArray<ServerRow>,
  pageSize: number,
  committedPages: number,
  initialPageParam = 0,
): void {
  // Compare both fixture fields without sorting or using actual page lengths
  // to construct the expected partition. Virtual metadata is not this law.
  const contents = (page: ReadonlyArray<ServerRow>) =>
    page.map(({ id, rank }) => ({ id, rank }))
  expect(contents(snapshot.data)).toEqual(
    sourceRows.slice(0, pageSize * committedPages),
  )
  expect(snapshot.pages.map(contents)).toEqual(
    Array.from({ length: committedPages }, (_, index) =>
      sourceRows.slice(index * pageSize, (index + 1) * pageSize),
    ),
  )
  expect(snapshot.pageParams).toEqual(
    Array.from(
      { length: committedPages },
      (_, index) => initialPageParam + index,
    ),
  )
}

type ProbeCollection = { cleanup: () => Promise<void> }
type MountedProbe = {
  unmount: () => void
  result: { current: { collection?: ProbeCollection } }
}

async function withServerFixture(
  options: Parameters<typeof createServerPaginationFixture>[0],
  run: (
    fixture: ServerFixture,
    mount: <T extends MountedProbe>(create: () => T) => T,
  ) => void | Promise<void>,
): Promise<void> {
  let fixture: ServerFixture | undefined
  let mounted: MountedProbe | undefined
  let failed = false
  let primaryError: unknown
  try {
    fixture = createServerPaginationFixture(options)
    await run(fixture, (create) => {
      const hook = create()
      mounted = hook
      return hook
    })
  } catch (error) {
    failed = true
    primaryError = error
  }
  const cleanupErrors: Array<unknown> = []
  let live: ProbeCollection | undefined
  try {
    // Capture the query handle before unmount changes its subscription state.
    live = mounted?.result.current.collection
  } catch (error) {
    cleanupErrors.push(error)
  }
  for (const cleanup of [
    () => mounted?.unmount(),
    () => live?.cleanup(),
    () => fixture?.collection.cleanup(),
    () => fixture?.client.clear(),
  ]) {
    try {
      await cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length) {
    if (failed) {
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        `Server pagination probe and cleanup failed`,
        { cause: primaryError },
      )
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0]
    throw new AggregateError(cleanupErrors, `Server pagination cleanup failed`)
  }
  if (failed) throw primaryError
}

describe(`server pagination contract probes`, () => {
  const boundaryRows = [
    { id: 4, rank: 1 },
    { id: 7, rank: 1 },
    { id: 2, rank: 3 },
    { id: 9, rank: 4 },
  ]
  const rankOrder = () => [
    {
      expression: new PropRef([`rank`]),
      compareOptions: { direction: `asc` as const, nulls: `last` as const },
    },
  ]
  const comparison = (name: string, field: `id` | `rank`, value: number) =>
    new Func<boolean>(name, [new PropRef([field]), new Value(value)])
  const validRequests: Array<{
    name: string
    subset: LoadSubsetOptions | undefined
    expected: Array<ServerRow>
  }> = [
    { name: `full source`, subset: undefined, expected: boundaryRows },
    { name: `unwindowed`, subset: {}, expected: boundaryRows },
    {
      name: `unlimited tie`,
      subset: { where: comparison(`eq`, `rank`, 1) },
      expected: boundaryRows.slice(0, 2),
    },
    {
      name: `leading rank order`,
      subset: { orderBy: rankOrder(), limit: 3 },
      expected: boundaryRows.slice(0, 3),
    },
    {
      name: `full rank/id order`,
      subset: {
        orderBy: [
          ...rankOrder(),
          {
            expression: new PropRef([`id`]),
            compareOptions: {
              direction: `asc`,
              nulls: `first`,
              stringSort: `lexical`,
            },
          },
        ],
        offset: 1,
        limit: 2,
      },
      expected: boundaryRows.slice(1, 3),
    },
    {
      name: `zero limit`,
      subset: { orderBy: rankOrder(), limit: 0 },
      expected: [],
    },
    {
      name: `false predicate`,
      subset: { where: new Value(false) },
      expected: [],
    },
    {
      name: `empty membership`,
      subset: { where: new Func(`in`, [new PropRef([`id`]), new Value([])]) },
      expected: [],
    },
    {
      name: `all Boolean branches`,
      subset: {
        where: new Func(`and`, [
          new Func(`or`, [
            comparison(`eq`, `id`, 4),
            new Func(`in`, [new PropRef([`id`]), new Value([7, 2])]),
          ]),
          new Func(`not`, [comparison(`eq`, `rank`, 3)]),
        ]),
      },
      expected: boundaryRows.slice(0, 2),
    },
    {
      name: `greater`,
      subset: { where: comparison(`gt`, `rank`, 1) },
      expected: boundaryRows.slice(2),
    },
    {
      name: `greater equal`,
      subset: { where: comparison(`gte`, `rank`, 3) },
      expected: boundaryRows.slice(2),
    },
    {
      name: `less`,
      subset: { where: comparison(`lt`, `rank`, 3) },
      expected: boundaryRows.slice(0, 2),
    },
    {
      name: `less equal`,
      subset: { where: comparison(`lte`, `rank`, 1) },
      expected: boundaryRows.slice(0, 2),
    },
    {
      name: `offset ignores separately validated cursor`,
      subset: {
        orderBy: rankOrder(),
        offset: 1,
        limit: 2,
        cursor: {
          whereFrom: comparison(`gt`, `rank`, 3),
          whereCurrent: comparison(`eq`, `rank`, 3),
          lastKey: 2,
        },
      },
      expected: boundaryRows.slice(1, 3),
    },
  ]
  it.each(validRequests)(
    `serves the finite numeric boundary: $name`,
    async ({ subset, expected }) => {
      await withServerFixture(
        {
          rows: boundaryRows,
          syncMode: `on-demand`,
          order: [`rank`, `id`],
          serverPageSize: 2,
        },
        async (fixture) => {
          expect(await fixture.fetchRows(subset)).toEqual(expected)
          expect(fixture.requests).toHaveLength(1)
        },
      )
    },
  )

  const unsupported = new Func(`unsupported`, [])
  const malformedRequests: Array<{ name: string; subset: unknown }> = [
    { name: `missing finite order`, subset: { limit: 2 } },
    {
      name: `wrong first field`,
      subset: {
        orderBy: [{ ...rankOrder()[0], expression: new PropRef([`id`]) }],
        limit: 2,
      },
    },
    {
      name: `reversed direction`,
      subset: {
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction: `desc`, nulls: `last` },
          },
        ],
      },
    },
    {
      name: `constant order`,
      subset: { orderBy: [{ ...rankOrder()[0], expression: new Value(1) }] },
    },
    { name: `empty order`, subset: { orderBy: [] } },
    { name: `negative offset`, subset: { offset: -1 } },
    { name: `fractional offset`, subset: { offset: 0.5 } },
    { name: `infinite limit`, subset: { limit: Infinity } },
    { name: `NaN limit`, subset: { limit: NaN } },
    { name: `unknown option`, subset: { extra: true } },
    {
      name: `unknown comparison option`,
      subset: {
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction: `asc`, nulls: `last`, custom: true },
          },
        ],
      },
    },
    {
      name: `unsupported locale payload`,
      subset: {
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: {
              direction: `asc`,
              nulls: `last`,
              stringSort: `locale`,
              locale: `en`,
            },
          },
        ],
      },
    },
    {
      name: `hidden false branch`,
      subset: { where: new Func(`and`, [new Value(false), unsupported]) },
    },
    {
      name: `hidden true branch`,
      subset: { where: new Func(`or`, [new Value(true), unsupported]) },
    },
    {
      name: `wrong arity`,
      subset: { where: new Func(`eq`, [new PropRef([`rank`])]) },
    },
    {
      name: `nonfinite membership`,
      subset: {
        where: new Func(`in`, [
          new PropRef([`rank`]),
          new Value([1, Infinity]),
        ]),
      },
    },
    {
      name: `wrong reference path`,
      subset: {
        where: new Func(`eq`, [new PropRef([`row`, `rank`]), new Value(1)]),
      },
    },
    { name: `numeric predicate`, subset: { where: new Value(1) } },
    {
      name: `hidden cursor branch`,
      subset: {
        cursor: {
          whereFrom: new Func(`or`, [new Value(true), unsupported]),
          whereCurrent: comparison(`eq`, `rank`, 1),
        },
      },
    },
  ]
  for (const empty of [false, true]) {
    it.each(malformedRequests)(
      `rejects the whole request before filtering, empty=${empty}: $name`,
      async ({ subset }) => {
        await withServerFixture(
          {
            rows: empty ? [] : boundaryRows,
            syncMode: `on-demand`,
            order: [`rank`, `id`],
          },
          async (fixture) => {
            await expect(
              fixture.fetchRows(subset as LoadSubsetOptions),
            ).rejects.toThrow(`Unsupported server pagination request`)
            expect(fixture.requests).toEqual([])
            expect(fixture.serverPages).toEqual([])
          },
        )
      },
    )
  }

  it(`detaches static requests before awaiting endpoint pages but keeps resource handles live`, async () => {
    await withServerFixture(
      {
        rows: boundaryRows,
        syncMode: `on-demand`,
        order: [`rank`, `id`],
        serverPageSize: 1,
      },
      async (fixture) => {
        const members = [4, 7, 2, 9]
        const ref = new PropRef([`rank`])
        const order = {
          expression: ref,
          compareOptions: {
            direction: `asc` as `asc` | `desc`,
            nulls: `last` as const,
            stringSort: `locale` as const,
          },
        }
        const from = new Value(3)
        const abort = new AbortController()
        // The guarded source owns this subscription even if a later check throws.
        const subscription = fixture.collection.subscribeChanges(() => {})
        const entryStatus = subscription.status
        const subset: LoadSubsetOptions = {
          where: new Func(`in`, [new PropRef([`id`]), new Value(members)]),
          orderBy: [order],
          offset: 1,
          limit: 2,
          cursor: {
            whereFrom: new Func(`gt`, [new PropRef([`rank`]), from]),
            whereCurrent: comparison(`eq`, `rank`, 3),
            lastKey: 2,
          },
          signal: abort.signal,
          subscription,
        }
        const pending = fixture.fetchRows(subset)
        void pending.catch(() => undefined)
        members[0] = 99
        ref.path[0] = `id`
        order.compareOptions.direction = `desc`
        from.value = 99
        subset.offset = 0
        subset.limit = 0
        abort.abort()
        subscription.unsubscribe()
        expect(await pending).toEqual(boundaryRows.slice(1, 3))
        const captured = fixture.requests.find(
          (request) => request.subset?.signal === abort.signal,
        )!
        expect(captured.subset?.where).toEqual(
          new Func(`in`, [new PropRef([`id`]), new Value([4, 7, 2, 9])]),
        )
        expect(captured.subset?.orderBy).toEqual([
          {
            expression: new PropRef([`rank`]),
            compareOptions: {
              direction: `asc`,
              nulls: `last`,
              stringSort: `locale`,
            },
          },
        ])
        expect(captured.subset?.cursor).toEqual({
          whereFrom: comparison(`gt`, `rank`, 3),
          whereCurrent: comparison(`eq`, `rank`, 3),
          lastKey: 2,
        })
        expect(captured.subset?.offset).toBe(1)
        expect(captured.subset?.limit).toBe(2)
        expect(captured.subset?.signal).toBe(abort.signal)
        expect(captured.signalAborted).toBe(false)
        expect(captured.subset?.signal?.aborted).toBe(true)
        expect(Object.isFrozen(abort.signal)).toBe(false)
        expect(captured.subset?.subscription).toBe(subscription)
        expect(captured.subscriptionStatus).toBe(entryStatus)
        expect(captured.subset?.subscription?.status).toBe(subscription.status)
        expect(Object.isFrozen(subscription)).toBe(false)
      },
    )
  })

  for (const cleanupFails of [false, true]) {
    it(`clears the client on fixture construction failure, cleanup fails=${cleanupFails}`, () => {
      const primary = undefined
      const secondary = new Error(`client clear failed after disposal`)
      const clear = QueryClient.prototype.clear
      let cleared = 0
      const spy = vi
        .spyOn(QueryClient.prototype, `clear`)
        .mockImplementation(function (this: QueryClient) {
          clear.call(this)
          cleared++
          if (cleanupFails) throw secondary
        })
      let failed = false
      let caught: unknown
      try {
        try {
          createServerPaginationFixture({
            rows,
            get syncMode(): `eager` {
              throw primary
            },
          })
        } catch (error) {
          failed = true
          caught = error
        }
        expect(failed).toBe(true)
        expect(cleared).toBe(1)
        if (cleanupFails) {
          expect(caught).toBeInstanceOf(AggregateError)
          expect(Object.hasOwn(caught as AggregateError, `cause`)).toBe(true)
          expect((caught as AggregateError).cause).toBe(primary)
          expect((caught as AggregateError).errors).toEqual([
            primary,
            secondary,
          ])
          expect((caught as AggregateError).errors[1]).toBe(secondary)
        } else expect(caught).toBe(primary)
      } finally {
        spy.mockRestore()
      }
    })
  }

  it(`cleans the source and client when React mount throws before returning a handle`, async () => {
    const failure = new Error(`React mount failed`)
    let owned: ServerFixture | undefined
    let cleared = 0
    const error = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      await expect(
        withServerFixture(
          { rows, syncMode: `on-demand`, order: [`id`] },
          (fixture, mount) => {
            owned = fixture
            const clear = fixture.client.clear.bind(fixture.client)
            fixture.client.clear = () => {
              cleared++
              clear()
            }
            mount(() =>
              renderHook(() => {
                throw failure
              }),
            )
          },
        ),
      ).rejects.toBe(failure)
      expect(owned?.collection.status).toBe(`cleaned-up`)
      expect(owned?.collection.subscriberCount).toBe(0)
      expect(owned?.client.getQueryCache().getAll()).toEqual([])
      expect(cleared).toBe(1)
    } finally {
      error.mockRestore()
    }
  })

  for (const cleanupFails of [false, true]) {
    it(`retains a body failure and attempts every resource cleanup, cleanup fails=${cleanupFails}`, async () => {
      const failure = new Error(`Pagination body failed`)
      const cleanupFailures = [
        new Error(`Unmount failed after disposal`),
        new Error(`Query cleanup failed after disposal`),
        new Error(`Source cleanup failed after disposal`),
        new Error(`Client clear failed after disposal`),
      ]
      const cleaned: Array<string> = []
      let owned: ServerFixture | undefined
      let live: (ProbeCollection & { readonly status: string }) | undefined
      let caught: unknown
      try {
        await withServerFixture(
          { rows, syncMode: `on-demand`, order: [`id`] },
          async (fixture, mount) => {
            owned = fixture
            const hook = mount(() =>
              renderHook(() =>
                useLiveInfiniteQuery(
                  (q) =>
                    q
                      .from({ row: fixture.collection })
                      .orderBy(({ row }) => row.id),
                  { pageSize: 2 },
                ),
              ),
            )
            await waitFor(() => expect(hook.result.current.isReady).toBe(true))
            live = hook.result.current.collection
            if (!live) throw new Error(`Missing mounted query Collection`)
            const unmount = hook.unmount
            hook.unmount = () => {
              unmount()
              cleaned.push(`hook`)
              if (cleanupFails) throw cleanupFailures[0]
            }
            const cleanLive = live.cleanup.bind(live)
            live.cleanup = async () => {
              await cleanLive()
              cleaned.push(`query`)
              if (cleanupFails) throw cleanupFailures[1]
            }
            const cleanSource = fixture.collection.cleanup.bind(
              fixture.collection,
            )
            fixture.collection.cleanup = async () => {
              await cleanSource()
              cleaned.push(`source`)
              if (cleanupFails) throw cleanupFailures[2]
            }
            const clear = fixture.client.clear.bind(fixture.client)
            fixture.client.clear = () => {
              clear()
              cleaned.push(`client`)
              if (cleanupFails) throw cleanupFailures[3]
            }
            throw failure
          },
        )
      } catch (error) {
        caught = error
      }
      if (cleanupFails) {
        expect(caught).toBeInstanceOf(AggregateError)
        const compound = caught as AggregateError
        expect(compound.cause).toBe(failure)
        expect(compound.errors).toHaveLength(5)
        for (const [index, expected] of [
          failure,
          ...cleanupFailures,
        ].entries()) {
          expect(compound.errors[index]).toBe(expected)
        }
      } else {
        expect(caught).toBe(failure)
      }
      expect(cleaned).toEqual([`hook`, `query`, `source`, `client`])
      expect(live?.status).toBe(`cleaned-up`)
      expect(owned?.collection.status).toBe(`cleaned-up`)
      expect(owned?.collection.subscriberCount).toBe(0)
      expect(owned?.client.getQueryCache().getAll()).toEqual([])
    })
  }

  it(`rejects a server-page callback before constructing a query`, () => {
    const queryFn = vi.fn(() => {
      throw new Error(`query must not be constructed`)
    })
    const config = { pageSize: 2, getNextPageParam: () => 1 }
    const error = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      expect(() =>
        renderHook(() => useLiveInfiniteQuery(queryFn, config)),
      ).toThrow(`getNextPageParam is not supported`)
      expect(queryFn).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  it.each(pageCases)(
    `drains server pages of $serverPageSize for UI pages of $pageSize over $rowCount rows`,
    async ({ serverPageSize, pageSize, rowCount }) => {
      const sourceRows = rows.slice(0, rowCount)
      await withServerFixture(
        {
          rows: sourceRows,
          syncMode: `on-demand`,
          order: [`id`],
          serverPageSize,
        },
        async (fixture, mount) => {
          const { result } = mount(() =>
            renderHook(() =>
              useLiveInfiniteQuery(
                (q) =>
                  q
                    .from({ row: fixture.collection })
                    .orderBy(({ row }) => row.id),
                { pageSize },
              ),
            ),
          )
          await waitFor(() => expect(result.current.isReady).toBe(true))
          for (let size = pageSize; ; size += pageSize) {
            expectPageContents(
              result.current,
              sourceRows,
              pageSize,
              size / pageSize,
            )
            expect(result.current.data.map((row) => row.id)).toEqual(
              sourceRows.slice(0, size).map((row) => row.id),
            )
            expect(result.current.hasNextPage).toBe(size < rowCount)
            if (size >= rowCount) break
            await act(() => result.current.fetchNextPage())
          }
          if (rowCount > serverPageSize)
            expect(fixture.serverPages.length).toBeGreaterThan(1)
          if (rowCount > pageSize + 1) {
            expect(
              fixture.requests.some(
                (request) => (request.subset?.offset ?? 0) > 0,
              ),
            ).toBe(true)
          }
        },
      )
    },
  )

  it(`retains a tie group across backend and UI page boundaries`, async () => {
    // Already sorted by rank, then id. IDs decrease between groups so an
    // accidental id-first order cannot produce the expected result.
    const sourceRows = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: index + 10, rank: 1 })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: index + 1, rank: 2 })),
    ]
    await withServerFixture(
      {
        rows: sourceRows,
        syncMode: `on-demand`,
        order: [`rank`, `id`],
        serverPageSize: 2,
      },
      async (fixture, mount) => {
        const { result } = mount(() =>
          renderHook(() =>
            useLiveInfiniteQuery(
              (q) =>
                q
                  .from({ row: fixture.collection })
                  .orderBy(({ row }) => row.rank)
                  .orderBy(({ row }) => row.id),
              { pageSize: 3 },
            ),
          ),
        )
        await waitFor(() => expect(result.current.isReady).toBe(true))
        for (const size of [3, 6, 9]) {
          expectPageContents(result.current, sourceRows, 3, size / 3)
          expect(result.current.data.map((row) => row.id)).toEqual(
            sourceRows.slice(0, size).map((row) => row.id),
          )
          expect(result.current.hasNextPage).toBe(size < sourceRows.length)
          if (size < sourceRows.length)
            await act(() => result.current.fetchNextPage())
        }
        expect(new Set(fixture.serverPages)).toEqual(new Set([0, 1, 2, 3, 4]))
        const requestCount = fixture.requests.length
        await act(() => result.current.fetchNextPage())
        expect(fixture.requests).toHaveLength(requestCount)
        expectPageContents(result.current, sourceRows, 3, 3)
      },
    )
  })

  it(`eager page responses remain local data, not an infinite-query transport`, async () => {
    await withServerFixture(
      {
        rows,
        syncMode: `eager`,
        cap: 4,
      },
      async (fixture, mount) => {
        const { result } = mount(() =>
          renderHook(() =>
            useLiveInfiniteQuery(
              (q) =>
                q
                  .from({ row: fixture.collection })
                  .orderBy(({ row }) => row.id),
              { pageSize: 2, initialPageParam: 10 },
            ),
          ),
        )
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current.data.map((row) => row.id)).toEqual([0, 1])
        expect(result.current.pageParams).toEqual([10])
        expectPageContents(result.current, rows.slice(0, 4), 2, 1, 10)
        await act(() => result.current.fetchNextPage())
        expect(result.current.data.map((row) => row.id)).toEqual([0, 1, 2, 3])
        expect(result.current.pageParams).toEqual([10, 11])
        expectPageContents(result.current, rows.slice(0, 4), 2, 2, 10)
        expect(result.current.hasNextPage).toBe(false)
        await act(() => result.current.fetchNextPage())
        expect(fixture.requests).toHaveLength(1)
        expect(fixture.requests[0]?.pageParam).toBeUndefined()
        expectPageContents(result.current, rows.slice(0, 4), 2, 2, 10)
      },
    )
  })

  it(`on-demand prefixes grow through Query DB and retain earlier rows`, async () => {
    await withServerFixture(
      {
        rows,
        syncMode: `on-demand`,
        order: [`id`, `rank`],
      },
      async (fixture, mount) => {
        const { result } = mount(() =>
          renderHook(() =>
            useLiveInfiniteQuery(
              (q) =>
                q
                  .from({ row: fixture.collection })
                  .orderBy(({ row }) => row.id)
                  .orderBy(({ row }) => row.rank),
              { pageSize: 2 },
            ),
          ),
        )
        await waitFor(() => expect(result.current.isReady).toBe(true))
        for (const size of [2, 4, 6, 8]) {
          expectPageContents(result.current, rows, 2, size / 2)
          expect(result.current.data.map((row) => row.id)).toEqual(
            rows.slice(0, size).map((row) => row.id),
          )
          expect(result.current.hasNextPage).toBe(size < rows.length)
          if (size < rows.length)
            await act(() => result.current.fetchNextPage())
        }
        expect(
          fixture.requests.flatMap((request) =>
            request.subset?.limit === undefined ? [] : [request.subset.limit],
          ),
        ).toEqual([3, 5, 7, 9])
        expect(
          fixture.requests.every((request) => request.pageParam === undefined),
        ).toBe(true)
      },
    )
  })

  // Deliberately nonconforming provider: this is a protocol boundary control,
  // not an oracle accepting truncated responses as successful pagination.
  it(`a capped response can underfill locally while the server still has rows`, async () => {
    await withServerFixture(
      {
        rows,
        syncMode: `on-demand`,
        order: [`id`, `rank`],
        cap: 2,
      },
      async (fixture, mount) => {
        const { result } = mount(() =>
          renderHook(() =>
            useLiveInfiniteQuery(
              (q) =>
                q
                  .from({ row: fixture.collection })
                  .orderBy(({ row }) => row.id)
                  .orderBy(({ row }) => row.rank),
              { pageSize: 2 },
            ),
          ),
        )
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current.data.map((row) => row.id)).toEqual([0, 1])
        expect(rows.length).toBeGreaterThan(result.current.data.length)
        expectPageContents(result.current, rows.slice(0, 2), 2, 1)
        expect(result.current.hasNextPage).toBe(false)
        const requestCount = fixture.requests.length
        await act(() => result.current.fetchNextPage())
        expect(fixture.requests).toHaveLength(requestCount)
        expectPageContents(result.current, rows.slice(0, 2), 2, 1)
      },
    )
  })
})
