/** Receiving witness for the shared Convex lazy window law through the actual
 * React infinite-query binding. Page labels, every page, data and lookahead
 * are public observations. This supplies React scheduling, not another
 * pagination algorithm. Other framework bindings remain separate owners. */
import { act, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { expect, it } from 'vitest'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { lazyFixture } from '../../convex-db-collection/tests/lazy-paging-driver'
import {
  copyLazyRows,
  expectedLazyRows,
} from '../../convex-db-collection/tests/lazy-paging-model-oracle'
import { withTestCleanup } from '../../convex-db-collection/tests/helpers'

it.each([1, 2, 3, 4])(
  `receives exact infinite-query pages with provider page size %s`,
  async (pageSize) => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: `r${i}`,
      rank: Math.floor(i / 2),
      text: `row ${i}`,
    }))
    const f = lazyFixture(rows, pageSize)
    const permission = {}
    f.remote.scopes.set(permission, { limit: 3 })
    const trace: Array<string> = []
    const expectedLedger = (pages: number) => {
      const data = expectedLazyRows(rows, { limit: pages * 2 })
      return JSON.stringify({
        data,
        pages: Array.from({ length: pages }, (_, i) =>
          data.slice(i * 2, i * 2 + 2),
        ),
        pageParams: Array.from({ length: pages }, (_, i) => i),
        hasNextPage: rows.length > pages * 2,
      })
    }
    const hook = renderHook(() => {
      const result = useLiveInfiniteQuery(
        (q) =>
          q
            .from({ row: f.source })
            .orderBy(({ row }) => row.rank)
            .orderBy(({ row }) => row.id)
            .select(({ row }) => row),
        { pageSize: 2 },
      )
      // Capture each committed ready tuple, including intermediate fetch commits.
      // Discarded concurrent renders are not public publications.
      useLayoutEffect(() => {
        if (result.isReady)
          trace.push(
            JSON.stringify({
              data: copyLazyRows(result.data),
              pages: result.pages.map(copyLazyRows),
              pageParams: result.pageParams,
              hasNextPage: result.hasNextPage,
            }),
          )
      })
      return result
    })
    await withTestCleanup(
      async () => {
        await act(async () => {
          await f.remote.pump()
        })
        for (let pages = 1; pages <= 4; pages++) {
          if (pages > 1) {
            f.remote.scopes.set(permission, { limit: pages * 2 + 1 })
            await act(async () => {
              const fetching = hook.result.current.fetchNextPage()
              await f.remote.pump()
              await fetching
            })
          }
          const publications = trace.splice(0)
          expect(
            publications,
            `React lazy publication: no ready target tuple`,
          ).toContain(expectedLedger(pages))
          expect(hook.result.current.isReady).toBe(true)
          let advanced = false
          for (const snapshot of publications) {
            if (snapshot === expectedLedger(pages)) advanced = true
            else
              expect(
                snapshot,
                `React lazy publication: torn or stale page ledger`,
              ).toBe(expectedLedger(advanced ? pages : Math.max(1, pages - 1)))
          }
          const expected = expectedLazyRows(rows, { limit: pages * 2 })
          expect(copyLazyRows(hook.result.current.data)).toEqual(expected)
          expect(hook.result.current.pages.map(copyLazyRows)).toEqual(
            Array.from({ length: pages }, (_, i) =>
              expected.slice(i * 2, i * 2 + 2),
            ),
          )
          expect(hook.result.current.pageParams).toEqual(
            Array.from({ length: pages }, (_, i) => i),
          )
          expect(hook.result.current.hasNextPage).toBe(rows.length > pages * 2)
          expect(hook.result.current.isFetchingNextPage).toBe(false)
        }
      },
      () => hook.unmount(),
      () => hook.result.current.collection.cleanup(),
      () => f.source.cleanup(),
    )
  },
)
