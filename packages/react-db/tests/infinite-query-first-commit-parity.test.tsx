/**
 * Contract (oracle): for a synchronously loaded source, the first committed
 * render of `useLiveInfiniteQuery` must already show the ready rows, with no
 * intervening empty `idle` commit. The independent expectation is `useLiveQuery`
 * observed against the identical synchronous data: it publishes rows on its
 * first commit, so the sibling infinite hook must do the same. The two hooks
 * must agree so an app shows no flash of empty content on mount.
 *
 * See https://github.com/TanStack/db/issues/2023 for the original report.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'

interface Row {
  id: string
  rank: number
}

let sequence = 0
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  // Reverse order: unmount hooks before cleaning up the source they depend on.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function makeSyncSource(count: number) {
  const collection = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `infinite-first-commit-parity-${sequence++}`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      initialData: Array.from({ length: count }, (_, index) => ({
        id: String(index + 1),
        rank: count - index,
      })),
    }),
  )
  cleanups.push(() => collection.cleanup())
  return collection
}

// A commit's public shape, reduced to what the issue reports.
type Commit = { status: string; ids: Array<string> }

it(`publishes rows on the first commit for a synchronously loaded source, matching useLiveQuery`, async () => {
  const source = makeSyncSource(10)

  const liveCommits: Array<Commit> = []
  const live = renderHook(() => {
    const result = useLiveQuery((q) =>
      q.from({ row: source }).orderBy(({ row }) => row.rank, `desc`),
    )
    useLayoutEffect(() => {
      liveCommits.push({
        status: result.status,
        ids: result.data.map((row) => row.id),
      })
    })
    return result
  })
  cleanups.push(() => live.unmount())
  await waitFor(() => expect(live.result.current.status).toBe(`ready`))

  const infiniteCommits: Array<Commit> = []
  const infinite = renderHook(() => {
    const result = useLiveInfiniteQuery(
      (q) => q.from({ row: source }).orderBy(({ row }) => row.rank, `desc`),
      { pageSize: 20 },
    )
    useLayoutEffect(() => {
      infiniteCommits.push({
        status: result.status,
        ids: result.data.map((row) => row.id),
      })
    })
    return result
  })
  cleanups.push(() => infinite.unmount())
  await waitFor(() => expect(infinite.result.current.status).toBe(`ready`))

  const expectedIds = Array.from({ length: 10 }, (_, index) => String(index + 1))

  // Independent oracle: useLiveQuery shows data on its first commit.
  expect(liveCommits[0]).toEqual({ status: `ready`, ids: expectedIds })

  // The sibling infinite hook must match: no empty idle commit first.
  expect(infiniteCommits[0]).toEqual({ status: `ready`, ids: expectedIds })
})
