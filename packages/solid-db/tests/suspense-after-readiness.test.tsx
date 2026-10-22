/**
 * Suspense after initial-query readiness witness.
 *
 * Law (packages/db/src/query/live/ARCHITECTURE.md, law 16): after a live
 * query's initial-query readiness, a source's sync problem leaves the query's
 * status and rows alone and shows on the source's node. A Suspense boundary
 * therefore keeps showing the rows: it does not fall back, and nothing throws.
 * The shared conformance scenario `sync-errors-after-readiness` checks the
 * same law for the hook without a Suspense boundary.
 */
import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@solidjs/testing-library'
import { createCollection } from '@tanstack/db'
import { Suspense } from 'solid-js'
import { useLiveQuery } from '../src/useLiveQuery'
import type { SyncConfig } from '@tanstack/db'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

type Post = { id: string; title: string }
type SyncParams = Parameters<SyncConfig<Post, string>[`sync`]>[0]

describe(`useLiveQuery under Suspense after readiness`, () => {
  it(`keeps the rows shown when the source reports a problem or stops`, async () => {
    let params: SyncParams | undefined
    const source = createCollection<Post>({
      id: `solid-suspense-after-readiness`,
      getKey: (post) => post.id,
      sync: {
        sync: (next) => {
          params = next
          next.begin()
          next.write({ type: `insert`, value: { id: `p1`, title: `one` } })
          next.commit()
          next.markReady()
        },
      },
    })
    let query: ReturnType<typeof useLiveQuery> | undefined
    function Title() {
      query = useLiveQuery((q) => q.from({ post: source }))
      return <div data-testid="title">{(query() as Array<Post>)[0]?.title}</div>
    }
    const view = render(() => (
      <Suspense fallback={<div data-testid="waiting">Waiting</div>}>
        <Title />
      </Suspense>
    ))
    try {
      const title = await view.findByTestId(`title`)
      expect(title.textContent).toBe(`one`)

      params!.reportError(new Error(`source problem`))
      await flush()
      expect(query!.status).toBe(`ready`)
      expect(source.errors.failureReason?.message).toBe(`source problem`)
      expect(view.queryByTestId(`waiting`)).toBeNull()
      expect(view.getByTestId(`title`).textContent).toBe(`one`)

      params!.fail(new Error(`source gave up`))
      await flush()
      expect(query!.status).toBe(`ready`)
      expect(source.errors.error?.message).toBe(`source gave up`)
      expect(view.queryByTestId(`waiting`)).toBeNull()
      expect(view.getByTestId(`title`).textContent).toBe(`one`)
    } finally {
      view.unmount()
      await waitFor(() => expect(true).toBe(true))
      await query?.collection.cleanup()
      await source.cleanup()
    }
  })
})
