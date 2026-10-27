// Ordinary React tests for render cuts: a mounted replacement's startup error and
// a collection reclaimed by GC before a Suspense retry. The render-cut laws are owned
// by infinite-query-render-cuts-oracle.test.tsx.
import { Suspense, useLayoutEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gt } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveQuery } from '../src/useLiveQuery'
import {
  ErrorBoundary,
  PAGE_SIZE,
  cleanups,
  makeSyncSource,
} from './infinite-query-render-cuts-support'
import type { ReactNode } from 'react'

afterEach(async () => {
  // Unmount hooks before cleaning up the sources they read.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe(`on-demand sources match useLiveQuery`, () => {
  it.each([`live`, `infinite`] as const)(
    `delivers a mounted replacement's startup error to the error boundary (%s)`,
    async (hook) => {
      const source = makeSyncSource(4)
      const failure = new Error(`replacement failed to start`)
      const commits: Array<{ fail: boolean; status: string }> = []
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      function View({ fail }: { fail: boolean }): ReactNode {
        const query = (q: any) =>
          q
            .from({ items: source })
            .fn.where(() => {
              if (fail) throw failure
              return true
            })
            .orderBy(({ items }: any) => items.rank, `desc`)
        const result: any =
          hook === `live`
            ? useLiveQuery((q: any) => query(q).limit(PAGE_SIZE + 1), [fail])
            : useLiveInfiniteQuery(query, {
                pageSize: PAGE_SIZE,
                queryKey: [`startup-error`, fail],
              })
        useLayoutEffect(() => {
          commits.push({ fail, status: result.status })
        })
        return null
      }
      try {
        const view = render(
          <ErrorBoundary>
            <View fail={false} />
          </ErrorBoundary>,
        )
        cleanups.push(() => view.unmount())
        await waitFor(() =>
          expect(commits.at(-1)).toEqual({ fail: false, status: `ready` }),
        )
        await act(async () => {
          view.rerender(
            <ErrorBoundary>
              <View fail={true} />
            </ErrorBoundary>,
          )
        })
        // The error reaches the boundary; the replacement never commits.
        expect(
          view.getByText(`Rejected: replacement failed to start`),
        ).toBeDefined()
        expect(commits.filter((commit) => commit.fail)).toEqual([])
      } finally {
        consoleError.mockRestore()
      }
    },
  )
})

describe(`retries after GC`, () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it(`shows the ready first page when a Suspense retry follows a GC-collected abandoned render`, async () => {
    const source = makeSyncSource(10)
    let suspend = true
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const commits: Array<{ status: string; ids: Array<string> }> = []
    let abandonedCollection: { status: string } | undefined
    let retryCollection: { status: string } | undefined

    function Query(): ReactNode {
      const result = useLiveInfiniteQuery(
        (q) =>
          q.from({ items: source }).orderBy(({ items }) => items.rank, `desc`),
        { pageSize: 3 },
      )
      if (suspend) {
        abandonedCollection = result.collection as unknown as {
          status: string
        }
        throw gate
      }
      retryCollection = result.collection as unknown as { status: string }
      useLayoutEffect(() => {
        commits.push({
          status: result.status,
          ids: result.data.map((row) => row.id),
        })
      })
      return null
    }

    const view = render(
      <Suspense fallback={null}>
        <Query />
      </Suspense>,
    )
    cleanups.push(() => view.unmount())
    // Let the 50 ms unsubscribed GC floor reclaim the abandoned collection.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    suspend = false
    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(abandonedCollection?.status).toBe(`cleaned-up`)
    expect(retryCollection).not.toBe(abandonedCollection)
    expect(commits[0]).toEqual({ status: `ready`, ids: [`1`, `2`, `3`] })
  })

  it(`shows the ready first page when a mounted query's suspended update retries after GC`, async () => {
    // A committed component keeps its hook refs across a suspended update. A
    // retry that bound the update's collection after GC cleaned it up would
    // commit an empty cleaned-up page before recovering.
    const source = makeSyncSource(10)
    let suspend = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const commits: Array<{
      minimum: number
      status: string
      ranks: Array<number>
    }> = []

    function Query({ minimum }: { minimum: number }): ReactNode {
      const result = useLiveInfiniteQuery(
        (q) =>
          q
            .from({ items: source })
            .where(({ items }) => gt(items.rank, minimum))
            .orderBy(({ items }) => items.rank, `desc`),
        { pageSize: 3 },
        [minimum],
      )
      useLayoutEffect(() => {
        commits.push({
          minimum,
          status: result.status,
          ranks: result.data.map((row) => row.rank),
        })
      })
      if (suspend) throw gate
      return null
    }

    const view = render(
      <Suspense fallback={null}>
        <Query minimum={0} />
      </Suspense>,
    )
    cleanups.push(() => view.unmount())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    suspend = true
    await act(async () => {
      view.rerender(
        <Suspense fallback={null}>
          <Query minimum={5} />
        </Suspense>,
      )
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    suspend = false
    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(commits.find((commit) => commit.minimum === 5)).toEqual({
      minimum: 5,
      status: `ready`,
      ranks: [10, 9, 8],
    })
  })
})
