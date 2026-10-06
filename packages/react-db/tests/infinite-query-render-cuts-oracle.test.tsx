/**
 * React's pre-commit cut for `useLiveInfiniteQuery`.
 *
 * React can render a component without committing it: a Suspense render that
 * throws, a StrictMode double render, or a retry after an earlier attempt was
 * discarded. The shared infinite-query suite cannot express that cut, because
 * Vue's setup is its commit. These laws belong to the React driver:
 *
 * - For an on-demand source, the hook does what useLiveQuery does under the
 *   same history: it starts the source during render, so a render that never
 *   commits acquires it as often as useLiveQuery would, and a StrictMode double
 *   render requests the first window once and commits the same first value.
 *   This holds for a query callback and a supplied collection, with the source
 *   read directly or through a live-query Collection. useLiveQuery is the
 *   reference by decision: the two hooks must behave the same.
 * - When GC has reclaimed an abandoned render's collection, the retry's first
 *   commit is the ready first page, after a fresh mount and after a mounted
 *   component's suspended update.
 * - The hook agrees with `useLiveQuery`: for the same synchronous source, both
 *   commit the same ready rows first.
 * - A mounted replacement whose synchronous startup throws delivers that error
 *   to the error boundary, as useLiveQuery does. React retries the render; a
 *   retry that reused the failed render's collection would commit
 *   `status: error` instead.
 *
 * Expectations come from the source rows, page size, request counts, and
 * useLiveQuery under the same history, never from the hook's controller state.
 */
import { Component, StrictMode, Suspense, useLayoutEffect } from 'react'
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

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <div>Rejected: {this.state.error.message}</div>
    ) : (
      this.props.children
    )
  }
}

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

type HookName = `live` | `infinite`
type InputForm = `query` | `supplied`
const PAGE_SIZE = 2

// Counts source acquisitions. The load never settles, so only the request
// itself is observed. A wrapped source sits behind a live-query Collection,
// which does not copy its source's sync mode.
function makeCountingOnDemandSource(wrapped: boolean) {
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
  cleanups.push(() => source.cleanup())
  if (!wrapped) return { target: source as any, loads: () => loads }
  const intermediate = createLiveQueryCollection({
    query: (q) =>
      q.from({ row: source }).orderBy(({ row }) => row.rank, `desc`),
    startSync: false,
    gcTime: 1,
  })
  cleanups.push(() => intermediate.cleanup())
  return { target: intermediate as any, loads: () => loads }
}

// The same read through either hook. A query callback asks useLiveQuery for
// the infinite hook's first window, so both build the same physical query.
function useHookUnderTest(hook: HookName, form: InputForm, target: any) {
  if (form === `supplied`) {
    return hook === `live`
      ? useLiveQuery(target)
      : useLiveInfiniteQuery(target, { pageSize: PAGE_SIZE })
  }
  return hook === `live`
    ? useLiveQuery((q: any) =>
        q
          .from({ items: target })
          .orderBy(({ items }: any) => items.rank, `desc`)
          .limit(PAGE_SIZE + 1),
      )
    : useLiveInfiniteQuery(
        (q: any) =>
          q
            .from({ items: target })
            .orderBy(({ items }: any) => items.rank, `desc`),
        { pageSize: PAGE_SIZE },
      )
}

async function acquisitionsForAbandonedRender(
  hook: HookName,
  form: InputForm,
  wrapped: boolean,
): Promise<number> {
  const { target, loads } = makeCountingOnDemandSource(wrapped)
  const never = new Promise<void>(() => {})
  function Abandoned(): ReactNode {
    useHookUnderTest(hook, form, target)
    throw never
  }
  const view = render(
    <Suspense fallback={null}>
      <Abandoned />
    </Suspense>,
  )
  cleanups.push(() => view.unmount())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return loads()
}

async function firstWindowLoadsForStrictMount(hook: HookName) {
  const source = makeInfiniteOnDemandSource(
    { createCollection, BTreeIndex },
    rows(8),
  )
  cleanups.push(() => source.collection.cleanup())
  const commits: Array<{ status: string; ids: Array<string> }> = []
  const hook_ = renderHook(
    () => {
      const result: any = useHookUnderTest(hook, `query`, source.collection)
      useLayoutEffect(() => {
        commits.push({
          status: result.status,
          ids: result.data.slice(0, PAGE_SIZE).map((row: Row) => row.id),
        })
      })
      return result
    },
    { wrapper: StrictMode },
  )
  cleanups.push(() => hook_.unmount())
  await waitFor(() => expect(commits.length).toBeGreaterThan(0))
  return {
    loads: source.calls.filter((call) => call.limit === PAGE_SIZE + 1).length,
    firstCommit: commits[0],
  }
}

describe(`on-demand sources match useLiveQuery`, () => {
  it.each([
    { form: `query` as const, wrapped: false },
    { form: `query` as const, wrapped: true },
    { form: `supplied` as const, wrapped: true },
  ])(
    `acquires as useLiveQuery does for a render that never commits (%o)`,
    async ({ form, wrapped }) => {
      const reference = await acquisitionsForAbandonedRender(
        `live`,
        form,
        wrapped,
      )
      expect(
        await acquisitionsForAbandonedRender(`infinite`, form, wrapped),
      ).toBe(reference)
    },
  )

  it(`requests the first window and commits the first value as useLiveQuery does across a StrictMode double render`, async () => {
    const reference = await firstWindowLoadsForStrictMount(`live`)
    expect(reference.firstCommit).toEqual({
      status: `ready`,
      ids: [`1`, `2`],
    })
    // React 19 keeps refs across the double render, so both hooks request the
    // first window once. React 18 does not; see the coverage map.
    expect(reference.loads).toBe(1)
    expect(await firstWindowLoadsForStrictMount(`infinite`)).toEqual(reference)
  })

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
