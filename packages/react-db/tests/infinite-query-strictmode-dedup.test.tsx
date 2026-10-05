/**
 * Regression: a duplicate pre-commit render must not load an on-demand page
 * twice. React StrictMode renders a component twice before committing. Because
 * the hook now starts sync during render (startSync: true), it must reuse one
 * collection across those renders — like useLiveQuery's instance memo — instead
 * of building a new collection per render. A second collection would subscribe
 * the on-demand source again and fetch the same first page a second time.
 */
import { StrictMode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { BTreeIndex, createCollection } from '@tanstack/db'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    label: `row-${index + 1}`,
    rank: count - index,
  }))
}

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

  // pageSize 3 means the first peek-ahead window is limit 4. It must be
  // requested exactly once, even though StrictMode rendered the hook twice.
  const firstPageLoads = source.calls.filter((call) => call.limit === 4).length
  expect(firstPageLoads).toBe(1)
})
