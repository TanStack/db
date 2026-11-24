/**
 * First-load failure at the error boundary witness.
 *
 * Authority: maintainer decision for this branch, recorded in
 * docs/guides/error-handling.md ("Using Suspense and Error Boundaries"). A
 * failed first load reaches the nearest error boundary as an Error. When the
 * sync adapter's cause is an Error, the boundary receives that exact object.
 * When it is not, such as an HTTP response body, the boundary receives an
 * Error whose message is the problem's message (`health.error.message`) and
 * whose `cause` is the exact value the adapter reported. A wrapper that turned
 * a non-Error into a generic "Unknown error" would lose both.
 * The failure can happen while sync starts or after the query has begun
 * waiting. A crash during the first load follows the same rule.
 *
 * Production path: `useLiveQuery` on the Solid 2 host. The gated read
 * `query.loaded()` waits under `<Loading>` and throws at `<Errored>`.
 */
import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@solidjs/testing-library'
import { createCollection } from '@tanstack/db'
import { Errored, Loading } from 'solid-js'
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
        return <div>{query.loaded().length} posts</div>
      }
      const view = render(() => (
        <Errored
          fallback={(err) => {
            caught.push(err())
            return <div>Boundary caught</div>
          }}
        >
          <Loading fallback={<div>Loading</div>}>
            <Titles />
          </Loading>
        </Errored>
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

  // A Collection can fail without reporting a cause. With no problem value to
  // describe, the boundary still receives an Error, and it names the
  // Collection that failed.
  it.each([{ deferred: false }, { deferred: true }])(
    `names the failed Collection when the first load fails without a cause (deferred: $deferred)`,
    async ({ deferred }) => {
      let fail: ((error: unknown) => void) | undefined
      const source = createCollection<Post>({
        id: `solid-first-load-no-cause-${deferred}`,
        getKey: (post) => post.id,
        sync: {
          sync: (params) => {
            if (deferred) fail = params.fail
            else params.fail(undefined)
          },
        },
      })
      const caught: Array<unknown> = []
      // The failing Collection is the query's own. A query derived from it
      // reports core's error about its source as the cause instead.
      function Titles() {
        const query = useLiveQuery(() => source)
        return <div>{query.loaded().length} posts</div>
      }
      const view = render(() => (
        <Errored
          fallback={(err) => {
            caught.push(err())
            return <div>Boundary caught</div>
          }}
        >
          <Loading fallback={<div>Loading</div>}>
            <Titles />
          </Loading>
        </Errored>
      ))
      try {
        if (deferred) {
          await waitFor(() => expect(fail).toBeDefined())
          fail!(undefined)
        }
        await waitFor(() =>
          expect(view.getByText(`Boundary caught`)).toBeTruthy(),
        )
        expect(source.status).toBe(`error`)
        expect(source.health.error?.cause).toBeUndefined()
        const thrown = caught[0]
        expect(
          thrown,
          `a missing cause is named by its Collection`,
        ).toBeInstanceOf(Error)
        expect((thrown as Error).message).toBe(
          `Collection "${source.id}" failed to load`,
        )
        expect((thrown as Error).cause).toBeUndefined()
      } finally {
        view.unmount()
        await source.cleanup()
      }
    },
  )

  // A crash while the query waits for its first load reaches the boundary
  // under the same rule. (The shared conformance cells
  // `crashed-status-during-first-load-*` check that the status is `crashed`.)
  // A sync function that throws crashes the Collection while it starts; a
  // later crash is the one core raises for a broken local store, and the
  // witness raises it the same way.
  it.each([
    { kind: `an Error`, deferred: false, isError: true },
    { kind: `an Error`, deferred: true, isError: true },
    { kind: `not an Error`, deferred: false, isError: false },
    { kind: `not an Error`, deferred: true, isError: false },
  ])(
    `sends a crash cause that is $kind as an Error (deferred: $deferred)`,
    async ({ deferred, isError }) => {
      const cause: unknown = isError
        ? new Error(`local store broke`)
        : { code: `SQLITE_CORRUPT` }
      let started = false
      const source = createCollection<Post>({
        id: `solid-crash-cause-${isError}-${deferred}`,
        getKey: (post) => post.id,
        sync: {
          sync: () => {
            started = true
            if (!deferred) throw cause
          },
        },
      })
      const caught: Array<unknown> = []
      function Titles() {
        const query = useLiveQuery((q) => q.from({ post: source }))
        return <div>{query.loaded().length} posts</div>
      }
      const view = render(() => (
        <Errored
          fallback={(err) => {
            caught.push(err())
            return <div>Boundary caught</div>
          }}
        >
          <Loading fallback={<div>Loading</div>}>
            <Titles />
          </Loading>
        </Errored>
      ))
      try {
        if (deferred) {
          await waitFor(() => expect(started).toBe(true))
          ;(
            source as unknown as {
              _lifecycle: { crash: (error: unknown) => void }
            }
          )._lifecycle.crash(cause)
        }
        await waitFor(() =>
          expect(view.getByText(`Boundary caught`)).toBeTruthy(),
        )
        expect(source.status).toBe(`crashed`)
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
        await source.cleanup().catch(() => undefined)
      }
    },
  )

  // A crash throws at any time, and that includes one that lands in the same
  // tick as the readiness the gate is waiting for: the wait has then settled,
  // and the read that follows must still throw the crash.
  it(`sends a crash that lands together with the readiness the gate awaited`, async () => {
    const cause = new Error(`local store broke as it became ready`)
    let reportReady: (() => void) | undefined
    const source = createCollection<Post>({
      id: `solid-crash-with-readiness`,
      getKey: (post) => post.id,
      sync: {
        sync: (params) => {
          reportReady = params.markReady
        },
      },
    })
    const caught: Array<unknown> = []
    function Titles() {
      const query = useLiveQuery((q) => q.from({ post: source }))
      return <div>{query.loaded().length} posts</div>
    }
    const view = render(() => (
      <Errored
        fallback={(err) => {
          caught.push(err())
          return <div>Boundary caught</div>
        }}
      >
        <Loading fallback={<div>Loading</div>}>
          <Titles />
        </Loading>
      </Errored>
    ))
    try {
      await waitFor(() => expect(reportReady).toBeDefined())
      // Nothing runs between these two calls: the gate's wait settles, and the
      // crash is already there when that wait's continuation resumes.
      reportReady!()
      ;(
        source as unknown as {
          _lifecycle: { crash: (error: unknown) => void }
        }
      )._lifecycle.crash(cause)
      await waitFor(() =>
        expect(view.getByText(`Boundary caught`)).toBeTruthy(),
      )
      expect(source.status).toBe(`crashed`)
      expect(source.health.error?.cause).toBe(cause)
      expect(caught[0], `the crash cause is thrown as is`).toBe(cause)
    } finally {
      view.unmount()
      await source.cleanup().catch(() => undefined)
    }
  })
})
