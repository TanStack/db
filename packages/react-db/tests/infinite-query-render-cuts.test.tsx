/**
 * React's pre-commit cut for `useLiveInfiniteQuery`.
 *
 * React can render a component without committing it: a Suspense render that
 * throws, a StrictMode double render, or a retry after an earlier attempt was
 * discarded. The shared infinite-query suite cannot express that cut, because
 * Vue's setup is its commit. These laws belong to the React driver:
 *
 * - A render that never commits sends no request to an on-demand source,
 *   whether a query callback or a supplied collection reads it, directly or
 *   through a live-query Collection. After the subscription commits, the
 *   source is acquired.
 * - A StrictMode double render requests an on-demand first window once.
 * - When GC has reclaimed an abandoned render's collection, the retry's first
 *   commit is the ready first page, after a fresh mount and after a mounted
 *   component's suspended update.
 * - The hook agrees with `useLiveQuery`: for the same synchronous source, both
 *   commit the same ready rows first.
 *
 * Expectations come from the source rows, page size, and request counts, never
 * from the hook's controller state.
 */
import { StrictMode, Suspense, useLayoutEffect } from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  gt,
} from '@tanstack/db'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveQuery } from '../src/useLiveQuery'
import type { ReactNode } from 'react'

type Row = { id: string; label: string; rank: number }

let sequence = 0
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  // Unmount hooks before cleaning up the sources they read.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function rows(count: number): Array<Row> {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    label: `row-${index + 1}`,
    rank: count - index,
  }))
}

function makeSyncSource(count: number) {
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `infinite-render-cuts-${sequence++}`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      initialData: rows(count),
    }),
  )
  cleanups.push(() => source.cleanup())
  return source
}

// Counts source acquisitions. The load never settles, so only the request
// itself is observed. The live-query Collection over it does not copy its
// source's sync mode.
function makeWrappedOnDemandSource() {
  let loads = 0
  const source = createCollection<Row>({
    id: `infinite-render-cuts-remote-${sequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            loads++
            return new Promise<void>(() => {})
          },
        }
      },
    },
  })
  const intermediate = createLiveQueryCollection({
    query: (q) =>
      q.from({ row: source }).orderBy(({ row }) => row.rank, `desc`),
    startSync: false,
    gcTime: 1,
  })
  cleanups.push(
    () => source.cleanup(),
    () => intermediate.cleanup(),
  )
  return { intermediate, loads: () => loads }
}

type InputForm = `query` | `supplied`

// Reads the wrapped source through a query callback or as the supplied
// collection itself. The start rule must hold for both input forms.
function useWrappedInfiniteQuery(
  intermediate: ReturnType<typeof makeWrappedOnDemandSource>[`intermediate`],
  form: InputForm,
) {
  return useLiveInfiniteQuery(
    form === `supplied`
      ? (intermediate as any)
      : (q: any) =>
          q
            .from({ items: intermediate })
            .orderBy(({ items }: any) => items.rank, `desc`),
    { pageSize: 2 },
  )
}

const inputForms: Array<InputForm> = [`query`, `supplied`]

describe(`on-demand sources before commit`, () => {
  it.each(inputForms)(
    `does not acquire a wrapped on-demand source for a render that never commits (%s input)`,
    async (form) => {
      const { intermediate, loads } = makeWrappedOnDemandSource()
      const never = new Promise<void>(() => {})

      function Abandoned(): ReactNode {
        useWrappedInfiniteQuery(intermediate, form)
        throw never
      }

      const view = render(
        <Suspense fallback={null}>
          <Abandoned />
        </Suspense>,
      )
      cleanups.push(() => view.unmount())
      expect(loads()).toBe(0)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(loads()).toBe(0)
    },
  )

  it.each(inputForms)(
    `acquires a wrapped on-demand source once the subscription commits (%s input)`,
    async (form) => {
      const { intermediate, loads } = makeWrappedOnDemandSource()

      const hook = renderHook(() => useWrappedInfiniteQuery(intermediate, form))
      cleanups.push(() => hook.unmount())

      await waitFor(() => expect(loads()).toBeGreaterThan(0))
    },
  )

  it(`loads an on-demand first page once across a StrictMode double render`, async () => {
    const source = makeInfiniteOnDemandSource(
      { createCollection, BTreeIndex },
      rows(8),
    )
    cleanups.push(() => source.collection.cleanup())

    const hook = renderHook(
      () =>
        useLiveInfiniteQuery(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        ),
      { wrapper: StrictMode },
    )
    cleanups.push(() => hook.unmount())

    await waitFor(() =>
      expect(hook.result.current.data.map((row) => row.id)).toEqual([
        `1`,
        `2`,
        `3`,
      ]),
    )
    // pageSize 3 means the first peek-ahead window is limit 4.
    expect(source.calls.filter((call) => call.limit === 4)).toHaveLength(1)
  })
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

describe(`agreement with useLiveQuery`, () => {
  it(`commits the same ready rows first as useLiveQuery for a synchronous source`, async () => {
    const source = makeSyncSource(10)
    const firstCommit = (
      useResult: () => { status: string; data: Array<Row> },
    ) => {
      const commits: Array<{ status: string; ids: Array<string> }> = []
      const hook = renderHook(() => {
        const result = useResult()
        useLayoutEffect(() => {
          commits.push({
            status: result.status,
            ids: result.data.map((row) => row.id),
          })
        })
        return result
      })
      cleanups.push(() => hook.unmount())
      return commits
    }

    const live = firstCommit(() =>
      useLiveQuery((q) =>
        q.from({ row: source }).orderBy(({ row }) => row.rank, `desc`),
      ),
    )
    const infinite = firstCommit(() =>
      useLiveInfiniteQuery(
        (q) => q.from({ row: source }).orderBy(({ row }) => row.rank, `desc`),
        { pageSize: 20 },
      ),
    )
    await waitFor(() => expect(infinite.length).toBeGreaterThan(0))

    const expected = { status: `ready`, ids: rows(10).map((row) => row.id) }
    expect(live[0]).toEqual(expected)
    expect(infinite[0]).toEqual(expected)
  })
})
