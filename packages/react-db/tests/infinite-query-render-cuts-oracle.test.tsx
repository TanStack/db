/**
 * React's pre-commit cut for `useLiveInfiniteQuery`.
 *
 * React can render a component without committing it: a Suspense render that
 * throws, a StrictMode double render, or a retry after an earlier attempt was
 * discarded. The shared infinite-query suite cannot express that cut, because
 * Vue's setup is its commit. These laws belong to the React driver:
 *
 * - A live-query Collection starts no provider work before it has a
 *   subscriber or a preload. A render that never commits therefore starts no
 *   acquisition attempt on an on-demand source, whether a query callback or a
 *   supplied collection reads it, directly or through a live-query Collection.
 *   A StrictMode double render requests the first window once, after commit,
 *   and its first commit is a loading, unpublished window. The hook matches
 *   useLiveQuery under the same history in every case.
 * - When GC has reclaimed an abandoned render's collection, the retry's first
 *   commit is the ready first page, after a fresh mount and after a mounted
 *   component's suspended update.
 * - The hook agrees with `useLiveQuery`: for the same synchronous source, both
 *   commit the same ready rows first.
 * - A collection kept from an abandoned render is reused only while it can
 *   still serve the query. When its source restarts after cleanup, that
 *   collection is in terminal error, so selecting its query again shows the
 *   restarted source's rows, ready, as useLiveQuery does.
 * - A mounted replacement whose synchronous startup throws delivers that error
 *   to the error boundary, as useLiveQuery does. React retries the render; a
 *   retry that reused the failed render's collection would commit
 *   `status: error` instead.
 *
 * Expectations come from the source rows, page size, request counts, and
 * useLiveQuery under the same history, never from the hook's controller state.
 */
import { StrictMode, Suspense, useLayoutEffect } from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveQuery } from '../src/useLiveQuery'
import {
  PAGE_SIZE,
  cleanups,
  makeSyncSource,
  nextSequence,
  rows,
} from './infinite-query-render-cuts-support'
import type { Row } from './infinite-query-render-cuts-support'
import type { ReactNode } from 'react'

afterEach(async () => {
  // Unmount hooks before cleaning up the sources they read.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

type HookName = `live` | `infinite`
type InputForm = `query` | `supplied`

// Counts source acquisitions. The load never settles, so only the request
// itself is observed. A wrapped source sits behind a live-query Collection,
// which does not copy its source's sync mode.
function makeCountingOnDemandSource(wrapped: boolean) {
  let loads = 0
  const source = createCollection<Row>({
    id: `infinite-render-cuts-remote-${nextSequence()}`,
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

// The law: a render that never commits starts no acquisition, and the infinite
// hook starts the same acquisitions as useLiveQuery under the same history.
async function checkAbandonedRenderAcquisitions(
  form: InputForm,
  wrapped: boolean,
): Promise<void> {
  const reference = await acquisitionsForAbandonedRender(`live`, form, wrapped)
  expect(reference).toBe(0)
  expect(await acquisitionsForAbandonedRender(`infinite`, form, wrapped)).toBe(
    reference,
  )
}

declareOracle({ check: [checkAbandonedRenderAcquisitions] })

describe(`on-demand sources match useLiveQuery`, () => {
  it.each([
    { form: `query` as const, wrapped: false },
    { form: `query` as const, wrapped: true },
    { form: `supplied` as const, wrapped: true },
  ])(
    `starts no acquisition attempt for a render that never commits, as useLiveQuery does (%o)`,
    async ({ form, wrapped }) => {
      await checkAbandonedRenderAcquisitions(form, wrapped)
    },
  )

  it(`requests the first window and commits the first value as useLiveQuery does across a StrictMode double render`, async () => {
    const reference = await firstWindowLoadsForStrictMount(`live`)
    // No provider work before commit: the on-demand window is unpublished.
    expect(reference.firstCommit).toEqual({ status: `loading`, ids: [] })
    // React 19 keeps refs across the double render, so both hooks request the
    // first window once, after commit. React 18 does not; see the coverage map.
    expect(reference.loads).toBe(1)
    expect(await firstWindowLoadsForStrictMount(`infinite`)).toEqual(reference)
  })
})

// The law: with a synchronous source, the first commit is ready and shows every
// row in source order. This model gives that commit for `count` rows.
function expectedReadyFirstCommit(count: number): {
  status: string
  ids: Array<string>
} {
  return { status: `ready`, ids: rows(count).map((row) => row.id) }
}

declareOracle({ model: [expectedReadyFirstCommit] })

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

    const expected = expectedReadyFirstCommit(10)
    expect(live[0]).toEqual(expected)
    expect(infinite[0]).toEqual(expected)
  })
})
