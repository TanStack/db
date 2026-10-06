/**
 * Starting the window collection during render must not leak work or
 * incomplete pages into a render.
 *
 * - An on-demand source wrapped by an intermediate live-query Collection must
 *   not be acquired by a render that never commits. The start gate has to see
 *   through the intermediate Collection to the on-demand source.
 * - A dependency replacement that preserves page depth must not commit a
 *   ready result that holds fewer rows than the retained pages, or that
 *   reports the list as exhausted.
 */
import { Suspense, useLayoutEffect } from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import type { ReactNode } from 'react'

type Row = { id: string; label: string; rank: number }

let sequence = 0
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function rows(count: number): Array<Row> {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    label: `row-${index + 1}`,
    rank: count - index,
  }))
}

function makeWrappedOnDemandSource() {
  // Counts source acquisitions; the load never settles, so only the request
  // itself is observed.
  let loads = 0
  const source = createCollection<Row>({
    id: `infinite-render-start-remote-${sequence++}`,
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

function useWrappedInfiniteQuery(
  intermediate: ReturnType<typeof makeWrappedOnDemandSource>[`intermediate`],
) {
  return useLiveInfiniteQuery(
    (q) =>
      q
        .from({ items: intermediate })
        .orderBy(({ items }) => items.rank, `desc`),
    { pageSize: 2 },
  )
}

it(`does not acquire a wrapped on-demand source for a render that never commits`, async () => {
  const { intermediate, loads } = makeWrappedOnDemandSource()
  const never = new Promise<void>(() => {})

  function Abandoned(): ReactNode {
    useWrappedInfiniteQuery(intermediate)
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
})

it(`acquires a wrapped on-demand source once the subscription commits`, async () => {
  const { intermediate, loads } = makeWrappedOnDemandSource()

  const hook = renderHook(() => useWrappedInfiniteQuery(intermediate))
  cleanups.push(() => hook.unmount())

  await waitFor(() => expect(loads()).toBeGreaterThan(0))
})

it(`keeps retained pages complete in every ready commit after an equal dependency replacement`, async () => {
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `infinite-render-start-${sequence++}`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      initialData: rows(8),
    }),
  )
  cleanups.push(() => source.cleanup())

  const commits: Array<{
    status: string
    ids: Array<string>
    hasNextPage: boolean
  }> = []
  const hook = renderHook(
    ({ filter }: { filter: { minimum: number } }) => {
      const result = useLiveInfiniteQuery(
        (q) =>
          q.from({ items: source }).orderBy(({ items }) => items.rank, `desc`),
        { pageSize: 2 },
        [filter],
      )
      useLayoutEffect(() => {
        commits.push({
          status: result.status,
          ids: result.data.map((row) => row.id),
          hasNextPage: result.hasNextPage,
        })
      })
      return result
    },
    { initialProps: { filter: { minimum: 0 } } },
  )
  cleanups.push(() => hook.unmount())

  await waitFor(() => expect(hook.result.current.status).toBe(`ready`))
  await act(async () => {
    await hook.result.current.fetchNextPage()
  })
  expect(hook.result.current.data.map((row) => row.id)).toEqual([
    `1`,
    `2`,
    `3`,
    `4`,
  ])

  commits.length = 0
  // A new object with equal contents: page depth is preserved.
  act(() => hook.rerender({ filter: { minimum: 0 } }))
  await waitFor(() =>
    expect(hook.result.current.data.map((row) => row.id)).toEqual([
      `1`,
      `2`,
      `3`,
      `4`,
    ]),
  )

  const readyCommits = commits.filter(({ status }) => status === `ready`)
  expect(readyCommits.length).toBeGreaterThan(0)
  for (const commit of readyCommits) {
    expect(commit).toEqual({
      status: `ready`,
      ids: [`1`, `2`, `3`, `4`],
      hasNextPage: true,
    })
  }
})
