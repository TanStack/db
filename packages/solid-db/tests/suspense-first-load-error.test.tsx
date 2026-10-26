/**
 * First-load failure at the error boundary witness.
 *
 * Authority: maintainer decision for this branch, recorded in
 * docs/guides/error-handling.md ("Using Suspense and Error Boundaries"). A
 * failed first load reaches the nearest error boundary as an Error. When the
 * sync adapter's cause is an Error, the boundary receives that exact object.
 * When it is not, such as an HTTP response body, the boundary receives an
 * Error whose message is the problem's message (`health.error.message`) and
 * whose `cause` is the exact value the adapter reported. Solid's own resource
 * wrapper would otherwise turn a non-Error into a generic "Unknown error".
 * The failure can happen while sync starts or after the query has suspended.
 */
import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@solidjs/testing-library'
import { createCollection } from '@tanstack/db'
import { ErrorBoundary, Suspense } from 'solid-js'
import { useLiveQuery } from '../src/useLiveQuery'

type Post = { id: string; title: string }

describe(`useLiveQuery first-load failure at an error boundary`, () => {
  it.each([
    { kind: `an Error`, deferred: false, isError: true },
    { kind: `an Error`, deferred: true, isError: true },
    { kind: `not an Error`, deferred: false, isError: false },
    { kind: `not an Error`, deferred: true, isError: false },
  ])(
    `sends a first-load cause that is $kind as an Error (deferred: $deferred)`,
    async ({ deferred, isError }) => {
      const cause: unknown = isError
        ? new Error(`first load failed`)
        : { status: 500 }
      let fail: ((error: unknown) => void) | undefined
      const source = createCollection<Post>({
        id: `solid-first-load-cause-${isError}-${deferred}`,
        getKey: (post) => post.id,
        sync: {
          sync: (params) => {
            if (deferred) fail = params.fail
            else params.fail(cause)
          },
        },
      })
      const caught: Array<unknown> = []
      function Titles() {
        const query = useLiveQuery((q) => q.from({ post: source }))
        return <div>{query().length} posts</div>
      }
      const view = render(() => (
        <ErrorBoundary
          fallback={(error) => {
            caught.push(error)
            return <div>Boundary caught</div>
          }}
        >
          <Suspense fallback={<div>Loading</div>}>
            <Titles />
          </Suspense>
        </ErrorBoundary>
      ))
      try {
        if (deferred) {
          await waitFor(() => expect(fail).toBeDefined())
          fail!(cause)
        }
        await waitFor(() =>
          expect(view.getByText(`Boundary caught`)).toBeTruthy(),
        )
        expect(source.status).toBe(`error`)
        expect(source.health.error?.cause).toBe(cause)
        const thrown = caught[0]
        if (isError) {
          expect(thrown, `an Error cause is thrown as is`).toBe(cause)
        } else {
          expect(thrown, `a non-Error cause is wrapped`).toBeInstanceOf(Error)
          expect((thrown as Error).message).toBe(source.health.error?.message)
          expect((thrown as Error).cause).toBe(cause)
        }
      } finally {
        view.unmount()
        await source.cleanup()
      }
    },
  )
})
