import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Component, Suspense } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  mockSyncCollectionOptions,
  resetCleanupQueue,
} from '../../db/tests/utils'
import type { ReactNode } from 'react'

type Person = { id: string; name: string }

const collections: Array<{ cleanup: () => Promise<void> }> = []

function makeSource(id: string) {
  const source = createCollection(
    mockSyncCollectionOptions<Person>({
      id,
      getKey: (p) => p.id,
      initialData: [{ id: `1`, name: `A` }],
    }),
  )
  collections.push(source)
  return source
}

async function advanceTime(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <div>Failed</div> : this.props.children
  }
}

describe(`live queries across uncommitted renders`, () => {
  beforeEach(() => {
    resetCleanupQueue()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    cleanup()
    await advanceTime(100)
    for (const collection of collections.splice(0).reverse()) {
      await collection.cleanup()
    }
    resetCleanupQueue()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

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

    render(
      <Suspense fallback={<div>Loading</div>}>
        <Route />
      </Suspense>,
    )
    expect(source.subscriberCount).toBeGreaterThan(0)

    await advanceTime(100)

    expect(source.subscriberCount).toBe(0)
  })

  it(`releases the source when the render throws after the hook ran`, async () => {
    const source = makeSource(`uncommitted-throw`)
    const renderError = new Error(`render discarded`)
    const logError = console.error.bind(console)
    vi.spyOn(console, `error`).mockImplementation((...args: Array<unknown>) => {
      if (args.includes(renderError)) return
      logError(...args)
    })

    const Thrower = () => {
      useLiveQuery((q) =>
        q.from({ p: source }).select(({ p }) => ({ id: p.id, name: p.name })),
      )
      throw renderError
    }

    const view = render(
      <Boundary>
        <Thrower />
      </Boundary>,
    )
    expect(view.getByText(`Failed`)).toBeDefined()
    expect(source.subscriberCount).toBeGreaterThan(0)

    await advanceTime(100)

    expect(source.subscriberCount).toBe(0)
  })

  it(`keeps a committed query active until unmount`, async () => {
    const source = makeSource(`uncommitted-control`)

    const Ok = () => {
      const { data } = useLiveQuery((q) =>
        q.from({ p: source }).select(({ p }) => ({ id: p.id, name: p.name })),
      )
      return <div>{data.length}</div>
    }

    const { unmount } = render(<Ok />)
    expect(source.subscriberCount).toBeGreaterThan(0)
    await advanceTime(100)
    expect(source.subscriberCount).toBeGreaterThan(0)

    unmount()
    await advanceTime(2)

    expect(source.subscriberCount).toBe(0)
  })

  it(`keeps a suspense preload alive until slow source data arrives`, async () => {
    let completeLoad = () => {}
    const source = createCollection<Person>({
      getKey: (person) => person.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          completeLoad = () => {
            begin()
            write({ type: `insert`, value: { id: `1`, name: `Alice` } })
            commit()
            markReady()
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      gcTime: 1,
      query: (q) => q.from({ person: source }).select(({ person }) => person),
    })
    collections.push(source, live)
    const reclaimed = vi.fn()
    live.on(`status:cleaned-up`, reclaimed)

    const People = () => {
      const { data } = useLiveSuspenseQuery(live)
      return <div>{data.map((person) => person.name).join(`, `)}</div>
    }

    const view = render(
      <Suspense fallback={<div>Loading</div>}>
        <People />
      </Suspense>,
    )
    expect(view.getByText(`Loading`)).toBeDefined()
    expect(source.subscriberCount).toBeGreaterThan(0)

    await advanceTime(150)

    // React can retry an aborted preload and return to loading, hiding an
    // intervening cleanup if we only check the current status.
    expect(reclaimed).not.toHaveBeenCalled()
    expect(live.status).toBe(`loading`)
    expect(source.subscriberCount).toBeGreaterThan(0)
    await act(async () => {
      completeLoad()
      await Promise.resolve()
    })
    expect(view.getByText(`Alice`)).toBeDefined()

    view.unmount()
    await advanceTime(2)
    expect(source.subscriberCount).toBe(0)
  })
})
