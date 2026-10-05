/**
 * Regression: a collection built by an abandoned pre-commit render may be
 * garbage collected (no subscriber, 50 ms unsubscribed floor) before a later
 * Suspense retry commits. The retry must not bind that cleaned-up collection,
 * or the first committed paint shows an empty cleaned-up result, which is the
 * flash this feature removes.
 */
import { Component, Suspense, useLayoutEffect } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCollection, gt } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import type { ReactNode } from 'react'

type Row = { id: string; rank: number }

let sequence = 0
const collections: Array<{ cleanup: () => Promise<void> }> = []

beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  vi.useRealTimers()
  for (const collection of collections.splice(0).reverse())
    await collection.cleanup()
})

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

it(`shows the ready first page when a Suspense retry follows a GC-collected abandoned render`, async () => {
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `infinite-stale-reuse-${sequence++}`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      initialData: Array.from({ length: 10 }, (_, index) => ({
        id: String(index + 1),
        rank: 10 - index,
      })),
    }),
  )
  collections.push(source)

  let suspend = true
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const commits: Array<{ status: string; len: number }> = []
  let abandonedCollection: { status: string } | undefined
  let retryCollection: { status: string } | undefined

  function Query(): ReactNode {
    const result = useLiveInfiniteQuery(
      (q) =>
        q.from({ items: source }).orderBy(({ items }) => items.rank, `desc`),
      { pageSize: 3 },
    )
    if (suspend) {
      abandonedCollection = result.collection as unknown as { status: string }
      throw gate
    }
    retryCollection = result.collection as unknown as { status: string }
    useLayoutEffect(() => {
      commits.push({ status: result.status, len: result.data.length })
    })
    return null
  }

  render(
    <Boundary>
      <Suspense fallback={null}>
        <Query />
      </Suspense>
    </Boundary>,
  )

  // The abandoned render built the collection with startSync; let the 50 ms
  // unsubscribed GC floor elapse so it is cleaned up before the retry.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })

  suspend = false
  await act(async () => {
    release()
    await vi.advanceTimersByTimeAsync(0)
  })

  // Precondition: the abandoned render's collection was reclaimed by GC.
  expect(abandonedCollection?.status).toBe(`cleaned-up`)
  // The retry must bind a live collection, not the reclaimed one, and its first
  // committed paint must already show the ready first page (no returning flash).
  expect(retryCollection).not.toBe(abandonedCollection)
  expect(commits[0]).toEqual({ status: `ready`, len: 3 })
})

it(`shows the ready first page when a mounted query's suspended update retries after GC`, async () => {
  // A committed component keeps its hook refs across a suspended update. If the
  // retry bound the update's uncommitted collection after GC cleaned it up, it
  // would commit an empty cleaned-up page before recovering.
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `infinite-stale-reuse-${sequence++}`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      initialData: Array.from({ length: 10 }, (_, index) => ({
        id: String(index + 1),
        rank: 10 - index,
      })),
    }),
  )
  collections.push(source)

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
  // Let the suspended update's unsubscribed collection pass the GC floor.
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
  view.unmount()
})
