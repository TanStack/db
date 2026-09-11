import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { createServerPaginationFixture } from '../../query-db-collection/tests/server-pagination-fixture'

const rows = Array.from({ length: 8 }, (_, id) => ({ id, rank: id }))
const pageCases = [1, 2, 3, 5].flatMap((serverPageSize) =>
  [1, 2, 5].flatMap((pageSize) =>
    [0, 1, 8].map((rowCount) => ({ serverPageSize, pageSize, rowCount })),
  ),
)

describe(`server pagination contract probes`, () => {
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
      const fixture = createServerPaginationFixture({
        rows: sourceRows,
        syncMode: `on-demand`,
        serverPageSize,
      })
      const { result, unmount } = renderHook(() =>
        useLiveInfiniteQuery(
          (q) =>
            q.from({ row: fixture.collection }).orderBy(({ row }) => row.id),
          { pageSize },
        ),
      )
      try {
        await waitFor(() => expect(result.current.isReady).toBe(true))
        for (let size = pageSize; ; size += pageSize) {
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
      } finally {
        unmount()
        await result.current.collection?.cleanup()
        await fixture.collection.cleanup()
        fixture.client.clear()
      }
    },
  )

  it(`retains a tie group across backend and UI page boundaries`, async () => {
    // Already sorted by rank, then id. IDs decrease between groups so an
    // accidental id-first order cannot produce the expected result.
    const sourceRows = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: index + 10, rank: 1 })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: index + 1, rank: 2 })),
    ]
    const fixture = createServerPaginationFixture({
      rows: sourceRows,
      syncMode: `on-demand`,
      serverPageSize: 2,
    })
    const { result, unmount } = renderHook(() =>
      useLiveInfiniteQuery(
        (q) =>
          q
            .from({ row: fixture.collection })
            .orderBy(({ row }) => row.rank)
            .orderBy(({ row }) => row.id),
        { pageSize: 3 },
      ),
    )
    try {
      await waitFor(() => expect(result.current.isReady).toBe(true))
      for (const size of [3, 6, 9]) {
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
    } finally {
      unmount()
      await result.current.collection?.cleanup()
      await fixture.collection.cleanup()
      fixture.client.clear()
    }
  })

  it(`eager page responses remain local data, not an infinite-query transport`, async () => {
    const fixture = createServerPaginationFixture({
      rows,
      syncMode: `eager`,
      cap: 4,
    })
    const { result, unmount } = renderHook(() =>
      useLiveInfiniteQuery(
        (q) => q.from({ row: fixture.collection }).orderBy(({ row }) => row.id),
        { pageSize: 2, initialPageParam: 10 },
      ),
    )
    try {
      await waitFor(() => expect(result.current.isReady).toBe(true))
      expect(result.current.data.map((row) => row.id)).toEqual([0, 1])
      expect(result.current.pageParams).toEqual([10])
      await act(() => result.current.fetchNextPage())
      expect(result.current.data.map((row) => row.id)).toEqual([0, 1, 2, 3])
      expect(result.current.pageParams).toEqual([10, 11])
      expect(result.current.hasNextPage).toBe(false)
      await act(() => result.current.fetchNextPage())
      expect(fixture.requests).toHaveLength(1)
      expect(fixture.requests[0]?.pageParam).toBeUndefined()
    } finally {
      unmount()
      await result.current.collection?.cleanup()
      await fixture.collection.cleanup()
      fixture.client.clear()
    }
  })

  it(`on-demand prefixes grow through Query DB and retain earlier rows`, async () => {
    const fixture = createServerPaginationFixture({
      rows,
      syncMode: `on-demand`,
    })
    const { result, unmount } = renderHook(() =>
      useLiveInfiniteQuery(
        (q) =>
          q
            .from({ row: fixture.collection })
            .orderBy(({ row }) => row.id)
            .orderBy(({ row }) => row.rank),
        { pageSize: 2 },
      ),
    )
    try {
      await waitFor(() => expect(result.current.isReady).toBe(true))
      for (const size of [2, 4, 6, 8]) {
        expect(result.current.data.map((row) => row.id)).toEqual(
          rows.slice(0, size).map((row) => row.id),
        )
        expect(result.current.hasNextPage).toBe(size < rows.length)
        if (size < rows.length) await act(() => result.current.fetchNextPage())
      }
      expect(
        fixture.requests.flatMap((request) =>
          request.subset?.limit === undefined ? [] : [request.subset.limit],
        ),
      ).toEqual([3, 5, 7, 9])
      expect(
        fixture.requests.every((request) => request.pageParam === undefined),
      ).toBe(true)
    } finally {
      unmount()
      await result.current.collection?.cleanup()
      await fixture.collection.cleanup()
      fixture.client.clear()
    }
  })

  // Deliberately nonconforming provider: this is a protocol boundary control,
  // not an oracle accepting truncated responses as successful pagination.
  it(`a capped response can underfill locally while the server still has rows`, async () => {
    const fixture = createServerPaginationFixture({
      rows,
      syncMode: `on-demand`,
      cap: 2,
    })
    const { result, unmount } = renderHook(() =>
      useLiveInfiniteQuery(
        (q) =>
          q
            .from({ row: fixture.collection })
            .orderBy(({ row }) => row.id)
            .orderBy(({ row }) => row.rank),
        { pageSize: 2 },
      ),
    )
    try {
      await waitFor(() => expect(result.current.isReady).toBe(true))
      expect(result.current.data.map((row) => row.id)).toEqual([0, 1])
      expect(rows.length).toBeGreaterThan(result.current.data.length)
      expect(result.current.hasNextPage).toBe(false)
      const requestCount = fixture.requests.length
      await act(() => result.current.fetchNextPage())
      expect(fixture.requests).toHaveLength(requestCount)
    } finally {
      unmount()
      await result.current.collection?.cleanup()
      await fixture.collection.cleanup()
      fixture.client.clear()
    }
  })
})
