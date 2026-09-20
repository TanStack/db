import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Component, Suspense } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  mockSyncCollectionOptions,
  resetCleanupQueue,
} from '../../db/tests/utils'
import type { InitialQueryBuilder } from '@tanstack/db'
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

  it(`reuses an asynchronous on-demand preload across the pre-mount suspense retry`, async () => {
    let resolveLoad!: () => void
    let loadSettled = false
    let loadCount = 0
    let deliver = () => {}
    const load = new Promise<void>((resolve) => {
      resolveLoad = resolve
    })
    const never = new Promise<void>(() => {})
    const source = createCollection<Person>({
      id: `uncommitted-async-on-demand`,
      getKey: (person) => person.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          deliver = () => {
            begin()
            write({ type: `insert`, value: { id: `1`, name: `Alice` } })
            commit()
          }
          return {
            loadSubset: () => {
              loadCount++
              return loadSettled ? never : load
            },
          }
        },
      },
    })
    collections.push(source)

    const People = () => {
      const { data } = useLiveSuspenseQuery({
        query: (q) =>
          q.from({ person: source }).where(({ person }) => eq(person.id, `1`)),
      })
      return <div>{data.map((person) => person.name).join(`, `)}</div>
    }

    const view = render(
      <Suspense fallback={<div>Loading</div>}>
        <People />
      </Suspense>,
    )
    expect(view.getByText(`Loading`)).toBeDefined()
    expect(loadCount).toBe(1)

    await act(async () => {
      deliver()
      loadSettled = true
      resolveLoad()
      await Promise.resolve()
    })
    await advanceTime(1)

    expect(view.getByText(`Alice`)).toBeDefined()
    expect(loadCount).toBe(1)
  })

  it(`retains a shared precommit collection until every suspense consumer commits`, async () => {
    let resolveLoad!: () => void
    let releaseSecondRender!: () => void
    let loadSettled = false
    let secondRenderBlocked = true
    let loadCount = 0
    let deliver = () => {}
    const load = new Promise<void>((resolve) => {
      resolveLoad = resolve
    })
    const secondRender = new Promise<void>((resolve) => {
      releaseSecondRender = resolve
    })
    const never = new Promise<void>(() => {})
    const source = createCollection<Person>({
      id: `two-uncommitted-async-on-demand-consumers`,
      getKey: (person) => person.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          deliver = () => {
            begin()
            write({ type: `insert`, value: { id: `1`, name: `Alice` } })
            commit()
          }
          return {
            loadSubset: () => {
              loadCount++
              return loadSettled ? never : load
            },
          }
        },
      },
    })
    collections.push(source)
    const config = {
      query: (q: InitialQueryBuilder) =>
        q.from({ person: source }).where(({ person }) => eq(person.id, `1`)),
    }
    const First = () => {
      const { data } = useLiveSuspenseQuery(config)
      return <div>First: {data[0]?.name}</div>
    }
    const Second = () => {
      const { data } = useLiveSuspenseQuery(config)
      if (secondRenderBlocked) throw secondRender
      return <div>Second: {data[0]?.name}</div>
    }

    const view = render(
      <>
        <Suspense fallback={<div>First loading</div>}>
          <First />
        </Suspense>
        <Suspense fallback={<div>Second loading</div>}>
          <Second />
        </Suspense>
      </>,
    )
    expect(loadCount).toBe(1)

    await act(async () => {
      deliver()
      loadSettled = true
      resolveLoad()
      await Promise.resolve()
    })
    await advanceTime(1)
    expect(view.getByText(`First: Alice`)).toBeDefined()
    expect(view.getByText(`Second loading`)).toBeDefined()

    await act(async () => {
      secondRenderBlocked = false
      releaseSecondRender()
      await Promise.resolve()
    })
    await advanceTime(1)
    expect(view.getByText(`Second: Alice`)).toBeDefined()
    expect(loadCount).toBe(1)
  })

  it(`shares an active suspense collection and retires it after cleanup`, async () => {
    let releaseSecondRender!: () => void
    let secondRenderBlocked = true
    const secondRender = new Promise<void>((resolve) => {
      releaseSecondRender = resolve
    })
    const source = makeSource(`committed-rerender-precommit-ownership`)
    const config = {
      query: (q: InitialQueryBuilder) =>
        q.from({ person: source }).where(({ person }) => eq(person.id, `1`)),
    }
    const liveCollections = new Map<string, object>()
    const People = ({ label, tick = 0 }: { label: string; tick?: number }) => {
      const result = useLiveSuspenseQuery(config)
      liveCollections.set(label, result.collection)
      if (label === `Second` && secondRenderBlocked) throw secondRender
      return (
        <div>
          {label}: {result.data[0]?.name} {tick}
        </div>
      )
    }

    const firstView = render(
      <Suspense fallback={<div>First loading</div>}>
        <People label="First" />
      </Suspense>,
    )
    await advanceTime(1)
    expect(firstView.getByText(`First: A 0`)).toBeDefined()
    const firstCollection = liveCollections.get(`First`)

    const secondView = render(
      <Suspense fallback={<div>Second loading</div>}>
        <People label="Second" />
      </Suspense>,
    )
    expect(secondView.getByText(`Second loading`)).toBeDefined()

    firstView.rerender(
      <Suspense fallback={<div>First loading</div>}>
        <People label="First" tick={1} />
      </Suspense>,
    )
    expect(liveCollections.get(`First`)).toBe(firstCollection)
    await act(async () => {
      secondRenderBlocked = false
      releaseSecondRender()
      await Promise.resolve()
    })
    await advanceTime(1)
    expect(secondView.getByText(`Second: A 0`)).toBeDefined()

    const secondCollection = liveCollections.get(`Second`)
    const thirdView = render(
      <Suspense fallback={<div>Third loading</div>}>
        <People label="Third" />
      </Suspense>,
    )
    await advanceTime(1)

    expect(thirdView.getByText(`Third: A 0`)).toBeDefined()
    expect(liveCollections.get(`Third`)).toBe(secondCollection)

    firstView.unmount()
    secondView.unmount()
    thirdView.unmount()
    await advanceTime(2)

    const fourthView = render(
      <Suspense fallback={<div>Fourth loading</div>}>
        <People label="Fourth" />
      </Suspense>,
    )
    await advanceTime(1)

    expect(fourthView.getByText(`Fourth: A 0`)).toBeDefined()
    expect(liveCollections.get(`Fourth`)).not.toBe(secondCollection)
  })

  it(`does not share precommit queries across distinct source objects with the same id`, async () => {
    const createSource = (name: string) => {
      let resolveLoad!: () => void
      let deliver = () => {}
      let loadCount = 0
      const load = new Promise<void>((resolve) => {
        resolveLoad = resolve
      })
      const source = createCollection<Person>({
        id: `same-source-id`,
        getKey: (person) => person.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            deliver = () => {
              begin()
              write({ type: `insert`, value: { id: name, name } })
              commit()
            }
            return {
              loadSubset: () => {
                loadCount++
                return load
              },
            }
          },
        },
      })
      collections.push(source)
      return {
        source,
        deliver: () => deliver(),
        resolveLoad: () => resolveLoad(),
        getLoadCount: () => loadCount,
      }
    }
    const alice = createSource(`Alice`)
    const bob = createSource(`Bob`)
    const People = ({ source }: { source: typeof alice.source }) => {
      const { data } = useLiveSuspenseQuery((q) =>
        q.from({ person: source }).select(({ person }) => person),
      )
      return <div>{data.map(({ name }) => name).join(`, `)}</div>
    }

    const aliceView = render(
      <Suspense fallback={<div>Alice loading</div>}>
        <People source={alice.source} />
      </Suspense>,
    )
    const bobView = render(
      <Suspense fallback={<div>Bob loading</div>}>
        <People source={bob.source} />
      </Suspense>,
    )
    expect(alice.getLoadCount()).toBe(1)
    expect(bob.getLoadCount()).toBe(1)

    await act(async () => {
      alice.deliver()
      alice.resolveLoad()
      await Promise.resolve()
    })
    await advanceTime(1)
    expect(aliceView.getByText(`Alice`)).toBeDefined()
    expect(bobView.getByText(`Bob loading`)).toBeDefined()

    await act(async () => {
      bob.deliver()
      bob.resolveLoad()
      await Promise.resolve()
    })
    await advanceTime(1)
    expect(bobView.getByText(`Bob`)).toBeDefined()
  })

  it(`releases a rejected precommit query so an error-boundary retry can reload`, async () => {
    let rejectFirst!: (error: Error) => void
    let resolveSecond!: () => void
    let deliverSecond = () => {}
    let loadCount = 0
    const first = new Promise<void>((_, reject) => {
      rejectFirst = reject
    })
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve
    })
    const source = createCollection<Person>({
      id: `rejected-precommit-retry`,
      getKey: (person) => person.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          deliverSecond = () => {
            begin()
            write({ type: `insert`, value: { id: `1`, name: `Recovered` } })
            commit()
          }
          return {
            loadSubset: () => (++loadCount === 1 ? first : second),
          }
        },
      },
    })
    collections.push(source)
    const People = () => {
      const { data } = useLiveSuspenseQuery((q) =>
        q.from({ person: source }).select(({ person }) => person),
      )
      return <div>{data.map(({ name }) => name).join(`, `)}</div>
    }
    const logError = console.error.bind(console)
    vi.spyOn(console, `error`).mockImplementation((...args: Array<unknown>) => {
      if (args.some((arg) => arg instanceof Error)) return
      logError(...args)
    })

    const firstView = render(
      <Boundary>
        <Suspense fallback={<div>Loading</div>}>
          <People />
        </Suspense>
      </Boundary>,
    )
    await act(async () => {
      rejectFirst(new Error(`first load failed`))
      await Promise.resolve()
    })
    await advanceTime(2)
    expect(firstView.getByText(`Failed`)).toBeDefined()
    firstView.unmount()
    await advanceTime(2)

    const secondView = render(
      <Boundary>
        <Suspense fallback={<div>Retry loading</div>}>
          <People />
        </Suspense>
      </Boundary>,
    )
    expect(loadCount).toBe(2)
    await act(async () => {
      deliverSecond()
      resolveSecond()
      await Promise.resolve()
    })
    await advanceTime(1)
    expect(secondView.getByText(`Recovered`)).toBeDefined()
  })

  it(`reclaims a precommit query abandoned before its load settles`, async () => {
    let resolveLoad!: () => void
    let deliver = () => {}
    const load = new Promise<void>((resolve) => {
      resolveLoad = resolve
    })
    const source = createCollection<Person>({
      id: `abandoned-precommit-query`,
      getKey: (person) => person.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          deliver = () => {
            begin()
            write({ type: `insert`, value: { id: `1`, name: `Alice` } })
            commit()
          }
          return { loadSubset: () => load }
        },
      },
    })
    collections.push(source)
    const People = () => {
      useLiveSuspenseQuery((q) => q.from({ person: source }))
      return <div>Ready</div>
    }
    const view = render(
      <Suspense fallback={<div>Loading</div>}>
        <People />
      </Suspense>,
    )
    expect(source.subscriberCount).toBeGreaterThan(0)
    view.unmount()
    await act(async () => {
      deliver()
      resolveLoad()
      await Promise.resolve()
    })
    await advanceTime(100)
    expect(source.subscriberCount).toBe(0)
  })
})
