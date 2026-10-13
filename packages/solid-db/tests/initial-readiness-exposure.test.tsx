/**
 * Initial-query readiness exposure witness.
 *
 * Law (packages/db/src/query/live/ARCHITECTURE.md, law 10): a live query is
 * initially ready when its requests to an on-demand source settle. That
 * source's own Collection readiness does not gate it. This adapter must report
 * readiness at that point, with the rows present, and stay ready after the
 * source becomes ready or changes. Model D in
 * `packages/db/tests/query/includes-temporal-oracle.test.ts` owns the law.
 */
import { describe, expect, it } from 'vitest'
import { render, renderHook, waitFor } from '@solidjs/testing-library'
import { createCollection, eq } from '@tanstack/db'
import { Suspense } from 'solid-js'
import { useLiveQuery } from '../src/useLiveQuery'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

type Post = { id: string; title: string }

/**
 * An on-demand source whose subset load waits for the test to settle it.
 * Rows written before `settle` are visible but not yet settled evidence. The
 * source stays `loading` until `markReady`.
 */
function createLaggingSource(id: string) {
  // Every reader's request waits until `settle`.
  const pendingLoads: Array<() => void> = []
  let controls:
    | {
        write: (type: `insert` | `update`, row: Post) => void
        markReady: () => void
      }
    | undefined
  const collection = createCollection<Post>({
    id,
    getKey: (post) => post.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        controls = {
          write: (type, row) => {
            begin()
            write({ type, value: row })
            commit()
          },
          markReady,
        }
        return {
          loadSubset: () =>
            new Promise<void>((resolve) => {
              pendingLoads.push(resolve)
            }),
        }
      },
    },
  })
  return {
    collection,
    loadStarted: () => pendingLoads.length > 0,
    deliver: (row: Post) => controls!.write(`insert`, row),
    change: (row: Post) => controls!.write(`update`, row),
    settle: () => pendingLoads.splice(0).forEach((resolve) => resolve()),
    markReady: () => controls!.markReady(),
  }
}

describe(`useLiveQuery initial readiness over a lagging on-demand source`, () => {
  it(`releases isReady and Suspense when the subset settles and stays ready`, async () => {
    const source = createLaggingSource(`solid-exposure-lagging`)
    const statusView = renderHook(() =>
      useLiveQuery((q) =>
        q
          .from({ post: source.collection })
          .where(({ post }) => eq(post.id, `p1`)),
      ),
    )
    let cleanupSuspended: (() => Promise<void>) | undefined
    function SuspendedTitle() {
      const query = useLiveQuery((q) =>
        q
          .from({ post: source.collection })
          .where(({ post }) => eq(post.id, `p1`)),
      )
      cleanupSuspended = () => query.collection.cleanup()
      return <div data-testid="title">{query()[0]?.title}</div>
    }
    const view = render(() => (
      <Suspense fallback={<div data-testid="waiting">Waiting</div>}>
        <SuspendedTitle />
      </Suspense>
    ))
    try {
      await waitFor(() => expect(source.loadStarted()).toBe(true))
      source.deliver({ id: `p1`, title: `one` })
      await flush()
      expect(statusView.result.isReady).toBe(false)
      expect(view.getByTestId(`waiting`)).toBeTruthy()

      source.settle()
      await flush()
      expect(source.collection.status).toBe(`loading`)
      expect(statusView.result.isReady).toBe(true)
      expect(statusView.result().map((post) => post.id)).toEqual([`p1`])
      const title = await view.findByTestId(`title`)
      expect(title.textContent).toBe(`one`)

      source.markReady()
      source.change({ id: `p1`, title: `changed` })
      await flush()
      expect(statusView.result.isReady).toBe(true)
      expect(view.getByTestId(`title`).textContent).toBe(`changed`)
      expect(view.queryByTestId(`waiting`)).toBeNull()
    } finally {
      view.unmount()
      statusView.cleanup()
      await statusView.result.collection.cleanup()
      await cleanupSuspended?.()
      await source.collection.cleanup()
    }
  })
})
