import { QueryClient } from '@tanstack/query-core'
import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { createLiveQueryWindowController } from '../../db/src/live-query-window-controller.js'
import { createCursorPager, queryCollectionOptions } from '../src/index.js'
import { createBackend } from './cursor-pagination/backend.js'
import { expectedWindow } from './cursor-pagination/model.js'
import type { Row, Scope } from './cursor-pagination/model.js'

/** Real QueryClient -> QueryCollection -> graph -> shared window controller.
 * The fixture endpoint supports prefix and rank-equality tie requests. Other
 * predicates and cursor expressions reject rather than silently dropping IR.
 * Each tie filter has its own opaque backend sequence, just like the prefix.
 */
function createFixture(
  rows: Array<Row>,
  scope: Scope,
  backendSize: number,
  holdFirst = false,
) {
  const backend = { calls: [] as Array<string | undefined> }
  const gate = createDeferred<void>()
  let received = 0
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  const makePager = (rank?: number) => {
    const makeBackend = () =>
      createBackend(
        rank === undefined ? rows : rows.filter((row) => row.rank === rank),
        scope,
        backendSize,
      )
    let transport = makeBackend()
    return createCursorPager({
      queryClient: client,
      queryKey: [`cursor-experiment`, scope, `opaque-pages`, rank ?? null],
      fetchPage: async (cursor, signal) => {
        if (cursor === undefined) transport = makeBackend()
        if (rank === undefined) backend.calls.push(cursor)
        const page = await transport.fetchPage(cursor, signal)
        if (++received === 1 && holdFirst) await gate.promise
        return page
      },
    })
  }
  const pager = makePager()
  const ties = new Map<number, ReturnType<typeof makePager>>()
  const requests: Array<{ offset: number; limit: number | undefined }> = []
  const direction = scope.descending ? `desc` : `asc`
  const source = createCollection(
    queryCollectionOptions<Row>({
      queryClient: client,
      queryKey: [`cursor-experiment`, scope],
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      getKey: (row) => row.id,
      queryFn: async (ctx) => {
        const options = ctx.meta?.loadSubsetOptions
        let reader = pager
        const where = options?.where
        if (where !== undefined) {
          if (
            where.type !== `func` ||
            where.name !== `eq` ||
            where.args.length !== 2 ||
            where.args[0]?.type !== `ref` ||
            where.args[0].path.length !== 1 ||
            where.args[0].path[0] !== `rank` ||
            where.args[1]?.type !== `val` ||
            typeof where.args[1].value !== `number`
          ) {
            throw new Error(`Unsupported fixture predicate`)
          }
          const rank = where.args[1].value
          let tie = ties.get(rank)
          if (!tie) {
            tie = makePager(rank)
            ties.set(rank, tie)
          }
          reader = tie
        }
        expect(
          options?.cursor,
          `fixture uses offset requests, not IR cursors`,
        ).toBeUndefined()
        if (options?.orderBy) {
          expect(options.orderBy).toMatchObject([
            { expression: { path: [`rank`] }, compareOptions: { direction } },
            { expression: { path: [`id`] }, compareOptions: { direction } },
          ])
        }
        const window = { offset: options?.offset ?? 0, limit: options?.limit }
        requests.push(window)
        return reader.read(window, ctx.signal)
      },
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.rank, direction)
      .orderBy(({ row }) => row.id, direction)
      .limit(1),
  )
  return {
    backend,
    gate,
    requests,
    live,
    source,
    refresh: () =>
      client.invalidateQueries(
        { queryKey: [`cursor-experiment`, scope] },
        { throwOnError: true },
      ),
    received: () => received,
    async cleanup() {
      gate.resolve()
      await live.cleanup()
      await source.cleanup()
      client.clear()
    },
  }
}

const matrix = [0, 1, 9, 20].flatMap((count) =>
  [2, 5].flatMap((backendSize) =>
    [3, 7].flatMap((pageSize) =>
      [false, true].map((descending) => ({
        count,
        backendSize,
        pageSize,
        descending,
      })),
    ),
  ),
)

// This oracle checks all user row fields and their order. Virtual Collection
// fields ($key/$origin/etc.) are outside the cursor adapter's responsibility.
const observeRows = (rows: ReadonlyArray<Row>) =>
  rows.map(({ id, rank, group }) => ({ id, rank, group }))

describe(`cursor adapter through production pagination`, () => {
  it.each(
    [false, true].flatMap((descending) =>
      [2, 5].map((backendSize) => ({ descending, backendSize })),
    ),
  )(
    `refreshes changed backend rows before growing the window $descending/$backendSize`,
    async ({ descending, backendSize }) => {
      const rows = Array.from({ length: 3 }, (_, id) => ({
        id,
        rank: 0,
        group: 0,
      }))
      const scope = { group: undefined, descending }
      const fixture = createFixture(rows, scope, backendSize)
      const controller = createLiveQueryWindowController(fixture.live, {
        pageSize: 3,
      })
      const stop = controller.subscribe(() => {})
      try {
        await controller.preload()
        expect(observeRows(controller.getSnapshot().data)).toEqual(
          expectedWindow(rows, scope, 3).rows,
        )
        expect(controller.getSnapshot().hasNextPage).toBe(false)
        for (const count of [9, 2, 0, 7]) {
          const previous = observeRows(controller.getSnapshot().data)
          const calls = fixture.backend.calls.length
          rows.splice(
            0,
            rows.length,
            ...Array.from({ length: count }, (_, id) => ({
              id,
              rank: Math.floor(id / 6),
              group: count,
            })),
          )
          // Refreshing only the outer row query still allows its fresh page
          // cache. Prefix invalidation is the explicit two-cache refresh path.
          await fixture.source.utils.refetch({ throwOnError: true })
          expect(observeRows(controller.getSnapshot().data)).toEqual(previous)
          expect(fixture.backend.calls).toHaveLength(calls)
          await fixture.refresh()
          const expected = expectedWindow(rows, scope, 3)
          await vi.waitFor(() => {
            expect(observeRows(controller.getSnapshot().data)).toEqual(
              expected.rows,
            )
            expect(controller.getSnapshot().hasNextPage).toBe(
              expected.hasNextPage,
            )
          })
        }
        await controller.fetchNextPage()
        expect(observeRows(controller.getSnapshot().data)).toEqual(
          expectedWindow(rows, scope, 6).rows,
        )
        expect(controller.getSnapshot().hasNextPage).toBe(true)
      } finally {
        stop()
        controller.dispose()
        await fixture.cleanup()
      }
    },
  )

  it.each(matrix)(
    `publishes exact pages and exhaustion $count/$backendSize/$pageSize/$descending`,
    async ({ count, backendSize, pageSize, descending }) => {
      const rows = Array.from({ length: count }, (_, id) => ({
        id,
        rank: Math.floor(id / 6),
        group: id % 2,
      }))
      const scope = { group: undefined, descending }
      const fixture = createFixture(rows, scope, backendSize)
      const controller = createLiveQueryWindowController(fixture.live, {
        pageSize,
      })
      const publications: Array<{
        rows: Array<Row>
        pages: number
        more: boolean
        ready: boolean
      }> = []
      const unsubscribe = controller.subscribe(() => {
        const snapshot = controller.getSnapshot()
        publications.push({
          rows: observeRows(snapshot.data),
          pages: snapshot.pageParams.length,
          more: snapshot.hasNextPage,
          ready: snapshot.isReady,
        })
      })
      try {
        await controller.preload()
        for (let page = 1; page <= Math.ceil(count / pageSize) + 1; page++) {
          const expected = expectedWindow(rows, scope, page * pageSize)
          const snapshot = controller.getSnapshot()
          expect(observeRows(snapshot.data)).toEqual(expected.rows)
          expect(snapshot.hasNextPage).toBe(expected.hasNextPage)
          expect(observeRows(snapshot.pages.flat())).toEqual(expected.rows)
          if (!expected.hasNextPage) break
          await controller.fetchNextPage()
        }
        expect(publications.length).toBeGreaterThan(0)
        expect(publications.some((published) => published.ready)).toBe(true)
        for (const published of publications) {
          if (published.ready) {
            const expected = expectedWindow(
              rows,
              scope,
              published.pages * pageSize,
            )
            expect(published.rows).toEqual(expected.rows)
            expect(published.more).toBe(expected.hasNextPage)
          }
        }
        expect(fixture.requests.length).toBeGreaterThan(0)
        expect(fixture.requests[0]?.limit).toBe(pageSize + 1)
        expect(fixture.backend.calls).toHaveLength(
          Math.max(1, Math.ceil(count / backendSize)),
        )
      } finally {
        unsubscribe()
        controller.dispose()
        await fixture.cleanup()
      }
    },
  )

  it(`holds real response delivery and preserves a shallower peer after deep exhaustion`, async () => {
    const rows = Array.from({ length: 9 }, (_, id) => ({
      id,
      rank: Math.floor(id / 6),
      group: 0,
    }))
    const scope = { group: undefined, descending: false }
    const fixture = createFixture(rows, scope, 2, true)
    const shallow = createLiveQueryWindowController(fixture.live, {
      pageSize: 3,
    })
    const deep = createLiveQueryWindowController(fixture.live, { pageSize: 10 })
    const publications: Array<Array<number>> = []
    const stopShallow = shallow.subscribe(() =>
      publications.push(shallow.getSnapshot().data.map((row) => row.id)),
    )
    const stopDeep = deep.subscribe(() => {})
    let settled = 0
    const pending = Promise.allSettled(
      [shallow.preload(), deep.preload()].map((promise) =>
        promise.then(() => {
          settled++
        }),
      ),
    )
    try {
      await vi.waitFor(() => expect(fixture.received()).toBe(1))
      expect(settled).toBe(0)
      expect(shallow.getSnapshot().data).toEqual([])
      expect(publications.every((batch) => batch.length === 0)).toBe(true)
      fixture.gate.resolve()
      expect((await pending).map((result) => result.status)).toEqual([
        `fulfilled`,
        `fulfilled`,
      ])
      expect(shallow.getSnapshot().hasNextPage).toBe(true)
      expect(deep.getSnapshot().hasNextPage).toBe(false)
      stopDeep()
      deep.dispose()
      await shallow.preload()
      expect(observeRows(shallow.getSnapshot().data)).toEqual(rows.slice(0, 3))
      expect(shallow.getSnapshot().hasNextPage).toBe(true)
      await shallow.fetchNextPage()
      expect(observeRows(shallow.getSnapshot().data)).toEqual(rows.slice(0, 6))
      expect(fixture.backend.calls).toHaveLength(5)
    } finally {
      fixture.gate.resolve()
      await pending
      stopShallow()
      stopDeep()
      shallow.dispose()
      deep.dispose()
      await fixture.cleanup()
    }
  })
})
