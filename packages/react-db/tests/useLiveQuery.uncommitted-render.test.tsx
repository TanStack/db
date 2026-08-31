import { describe, expect, it } from 'vitest'
import { Component, Suspense } from 'react'
import { render, waitFor } from '@testing-library/react'
import { createCollection } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

/**
 * `useLiveQuery` constructs its live query collection with `startSync: true`
 * from the render body, which subscribes to the source collections
 * immediately. Teardown only runs from the `useSyncExternalStore` subscribe
 * cleanup, which React runs only after a commit.
 *
 * React discards render attempts routinely -- a subtree that suspends, a
 * throw, a time-sliced concurrent render restarted by an interleaved update.
 * Every discarded attempt leaves a fully compiled, fully subscribed query
 * graph attached to the (long-lived) source collection, and nothing ever
 * reclaims it: `startGCTimer()` is only called on the 1 -> 0 subscriber
 * transition, so a collection that never gained a subscriber never arms its
 * timer.
 */

type Person = { id: string; name: string }

const makeSource = (id: string) =>
  createCollection(
    mockSyncCollectionOptions<Person>({
      id,
      getKey: (p) => p.id,
      initialData: [{ id: `1`, name: `A` }],
    }),
  )

// `useLiveQuery` uses gcTime = 1ms, so this is far past due.
const waitPastGcTime = () => new Promise((r) => setTimeout(r, 250))

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

describe(`useLiveQuery in renders that never commit`, () => {
  it(`releases the source when the subtree suspends after the hook ran`, async () => {
    const source = makeSource(`uncommitted-suspend`)
    const neverResolves = new Promise<void>(() => {})

    const Suspender = () => {
      throw neverResolves
    }

    const Route = () => {
      useLiveQuery((q) =>
        q.from({ p: source }).select(({ p }) => ({ id: p.id, name: p.name })),
      )
      return <Suspender />
    }

    const ATTEMPTS = 10
    for (let i = 0; i < ATTEMPTS; i++) {
      render(
        <Suspense fallback={null}>
          <Route />
        </Suspense>,
      )
    }

    await waitPastGcTime()

    console.log(
      `[uncommitted] ${ATTEMPTS} suspended render attempts -> source.subscriberCount =`,
      source.subscriberCount,
    )

    expect(source.subscriberCount).toBe(0)
  })

  it(`releases the source when the render throws after the hook ran`, async () => {
    const source = makeSource(`uncommitted-throw`)

    const Thrower = () => {
      useLiveQuery((q) =>
        q.from({ p: source }).select(({ p }) => ({ id: p.id, name: p.name })),
      )
      throw new Error(`render discarded`)
    }

    const ATTEMPTS = 20
    for (let i = 0; i < ATTEMPTS; i++) {
      render(
        <Boundary>
          <Thrower />
        </Boundary>,
      )
    }

    await waitPastGcTime()

    console.log(
      `[uncommitted] ${ATTEMPTS} throwing render attempts -> source.subscriberCount =`,
      source.subscriberCount,
    )

    expect(source.subscriberCount).toBe(0)
  })

  it(`releases the source after a normal mount and unmount (control)`, async () => {
    const source = makeSource(`uncommitted-control`)

    const Ok = () => {
      const { data } = useLiveQuery((q) =>
        q.from({ p: source }).select(({ p }) => ({ id: p.id, name: p.name })),
      )
      return <div>{data.length}</div>
    }

    const { unmount } = render(<Ok />)
    await waitFor(() => expect(source.subscriberCount).toBeGreaterThan(0))

    unmount()
    await waitPastGcTime()

    expect(source.subscriberCount).toBe(0)
  })
})
