import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { LiveQueryWindowControllerDisposedError } from '../src/errors.js'
import { createLiveQueryWindowController } from '../src/live-query-window-controller.js'
import { mockSyncCollectionOptions } from './utils.js'

interface Row {
  id: string
  n: number
}

const ROWS: Array<Row> = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), n }))

let seq = 0
function makeSource(initialData: Array<Row> = ROWS) {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `window-ctrl-${seq++}`,
      getKey: (r) => r.id,
      initialData,
    }),
  )
}

/** Ordered live query with page 1's peek-ahead window baked in, as the React adapter builds it. */
function makeOrderedLiveQuery(
  source: ReturnType<typeof makeSource>,
  pageSize: number,
) {
  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ r: source })
        .orderBy(({ r }) => r.n, `asc`)
        .limit(pageSize + 1)
        .offset(0)
        .select(({ r }) => ({ id: r.id, n: r.n })),
    startSync: true,
    gcTime: 1,
  })
}

const flush = () => new Promise((r) => setTimeout(r, 0))

const ids = (snap: { data: ReadonlyArray<any> }) => snap.data.map((r) => r.id)

describe(`createLiveQueryWindowController`, () => {
  it(`exposes the first page with a peek-ahead hasNextPage`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    controller.subscribe(() => {})
    await lq.preload()
    await flush()

    const snap = controller.getSnapshot()
    expect(ids(snap)).toEqual([`1`, `2`])
    expect(snap.pages.map((p) => p.map((r) => r.id))).toEqual([[`1`, `2`]])
    expect(snap.pageParams).toEqual([0])
    expect(snap.hasNextPage).toBe(true)
    expect(snap.isFetchingNextPage).toBe(false)
    controller.dispose()
  })

  it(`loads further pages via fetchNextPage until the source is exhausted`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    controller.subscribe(() => {})
    await lq.preload()
    await flush()

    controller.fetchNextPage()
    await flush()
    let snap = controller.getSnapshot()
    expect(ids(snap)).toEqual([`1`, `2`, `3`, `4`])
    expect(snap.pages.map((p) => p.map((r) => r.id))).toEqual([
      [`1`, `2`],
      [`3`, `4`],
    ])
    expect(snap.pageParams).toEqual([0, 1])
    expect(snap.hasNextPage).toBe(true)

    controller.fetchNextPage()
    await flush()
    snap = controller.getSnapshot()
    // 5 rows total; the 3rd page is a partial page and there is no peek row.
    expect(ids(snap)).toEqual([`1`, `2`, `3`, `4`, `5`])
    expect(snap.pages.map((p) => p.map((r) => r.id))).toEqual([
      [`1`, `2`],
      [`3`, `4`],
      [`5`],
    ])
    expect(snap.hasNextPage).toBe(false)
    controller.dispose()
  })

  it(`fetchNextPage is a no-op when there is no next page`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 10) // pageSize > row count
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 10,
    })
    controller.subscribe(() => {})
    await lq.preload()
    await flush()
    expect(controller.getSnapshot().hasNextPage).toBe(false)

    controller.fetchNextPage()
    await flush()
    expect(ids(controller.getSnapshot())).toEqual([`1`, `2`, `3`, `4`, `5`])
    expect(controller.getSnapshot().pages).toHaveLength(1)
    controller.dispose()
  })

  it(`represents an empty enabled query as one empty page`, async () => {
    const lq = makeOrderedLiveQuery(makeSource([]), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    controller.subscribe(() => {})
    await lq.preload()

    const snapshot = controller.getSnapshot()
    expect(snapshot.isEnabled).toBe(true)
    expect(snapshot.data).toEqual([])
    expect(snapshot.pages).toEqual([[]])
    expect(snapshot.hasNextPage).toBe(false)
    controller.dispose()
  })

  it(`uses the default page size when pageSize is zero`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 0,
    })
    controller.subscribe(() => {})
    await lq.preload()

    const snapshot = controller.getSnapshot()
    expect(ids(snapshot)).toEqual([`1`, `2`, `3`, `4`, `5`])
    expect(snapshot.pages).toHaveLength(1)
    expect(snapshot.hasNextPage).toBe(false)
    controller.dispose()
  })

  it(`reset returns to the first page`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    controller.subscribe(() => {})
    await lq.preload()
    await flush()

    controller.fetchNextPage()
    await flush()
    expect(controller.getSnapshot().pages).toHaveLength(2)

    controller.reset()
    await flush()
    const snap = controller.getSnapshot()
    expect(ids(snap)).toEqual([`1`, `2`])
    expect(snap.pages).toHaveLength(1)
    controller.dispose()
  })

  it(`notifies subscribers on data changes and page changes`, async () => {
    const source = makeSource()
    const lq = makeOrderedLiveQuery(source, 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    let notifications = 0
    controller.subscribe(() => notifications++)
    await lq.preload()
    await flush()

    notifications = 0
    controller.fetchNextPage()
    await flush()
    expect(notifications).toBeGreaterThan(0)
    controller.dispose()
  })

  it(`retries a window that throws synchronously`, () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const setWindow = vi
      .spyOn(lq.utils, `setWindow`)
      .mockImplementationOnce(() => {
        throw new Error(`window failed`)
      })
      .mockReturnValue(true)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })

    expect(() => controller.subscribe(() => {})).toThrow(`window failed`)
    const unsubscribe = controller.subscribe(() => {})

    expect(setWindow).toHaveBeenCalledTimes(2)
    unsubscribe()
    controller.dispose()
  })

  it(`keeps the committed page retryable when a window load rejects`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    controller.subscribe(() => {})
    await lq.preload()
    await flush()
    expect(controller.getSnapshot().hasNextPage).toBe(true)

    const failure = new Error(`load failed`)
    vi.spyOn(lq.utils, `setWindow`).mockRejectedValueOnce(failure)

    await expect(Promise.resolve(controller.fetchNextPage())).rejects.toThrow(
      `load failed`,
    )

    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().hasNextPage).toBe(true)
    expect((controller.getSnapshot() as { error?: unknown }).error).toBe(
      failure,
    )

    await controller.fetchNextPage()
    expect(controller.getSnapshot().pages).toHaveLength(2)
    controller.dispose()
  })

  it(`publishes one coherent loading snapshot and one settled snapshot`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    const snapshots: Array<{ pages: number; fetching: boolean }> = []
    controller.subscribe(() => {
      const snapshot = controller.getSnapshot()
      snapshots.push({
        pages: snapshot.pages.length,
        fetching: snapshot.isFetchingNextPage,
      })
    })
    await lq.preload()
    await flush()
    snapshots.length = 0

    let resolveWindow!: () => void
    vi.spyOn(lq.utils, `setWindow`).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWindow = resolve
      }),
    )

    const fetch = Promise.resolve(controller.fetchNextPage())
    expect(snapshots).toEqual([{ pages: 1, fetching: true }])

    resolveWindow()
    await fetch
    expect(snapshots).toEqual([
      { pages: 1, fetching: true },
      { pages: 2, fetching: false },
    ])
    controller.dispose()
  })

  it(`reset supersedes an in-flight page expansion`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    controller.subscribe(() => {})
    await lq.preload()

    let resolveExpansion!: () => void
    const setWindow = vi
      .spyOn(lq.utils, `setWindow`)
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveExpansion = resolve
        }),
      )
      .mockReturnValueOnce(true)

    const expansion = controller.fetchNextPage()
    expect(controller.getSnapshot().isFetchingNextPage).toBe(true)

    await controller.reset()
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().isFetchingNextPage).toBe(false)
    expect(setWindow).toHaveBeenNthCalledWith(1, { offset: 0, limit: 5 })
    expect(setWindow).toHaveBeenNthCalledWith(2, { offset: 0, limit: 3 })

    resolveExpansion()
    await expansion
    expect(controller.getSnapshot().pages).toHaveLength(1)
    controller.dispose()
  })

  it(`replays the desired window after collection cleanup`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    const unsubscribe = controller.subscribe(() => {})
    await lq.preload()

    await controller.fetchNextPage()
    await flush()
    expect(ids(controller.getSnapshot())).toEqual([`1`, `2`, `3`, `4`])

    unsubscribe()
    await lq.cleanup()

    controller.subscribe(() => {})
    await lq.preload()
    await flush()

    expect(ids(controller.getSnapshot())).toEqual([`1`, `2`, `3`, `4`])
    expect(controller.getSnapshot().hasNextPage).toBe(true)
    controller.dispose()
  })

  it(`establishes the desired window before preload`, async () => {
    const source = makeSource()
    const lq = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ r: source })
          .orderBy(({ r }) => r.n, `asc`)
          .limit(2)
          .select(({ r }) => ({ id: r.id, n: r.n })),
      gcTime: 1,
    })
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })

    await controller.preload()

    expect(controller.getSnapshot().hasNextPage).toBe(true)
    expect(lq.utils.getWindow()).toEqual({ offset: 0, limit: 3 })
    controller.dispose()
  })

  it(`coordinates the physical window across multiple controllers`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const larger = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    const smaller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 1,
    })

    larger.subscribe(() => {})
    smaller.subscribe(() => {})
    await lq.preload()
    await flush()

    expect(lq.utils.getWindow()).toEqual({ offset: 0, limit: 3 })
    expect(ids(larger.getSnapshot())).toEqual([`1`, `2`])
    expect(larger.getSnapshot().hasNextPage).toBe(true)

    await larger.fetchNextPage()
    expect(lq.utils.getWindow()).toEqual({ offset: 0, limit: 5 })

    await smaller.fetchNextPage()
    expect(lq.utils.getWindow()).toEqual({ offset: 0, limit: 5 })

    larger.dispose()
    expect(lq.utils.getWindow()).toEqual({ offset: 0, limit: 3 })
    smaller.dispose()
  })

  it(`ignores a failed attachment superseded by a new lease`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    await lq.preload()

    let rejectFirst!: (error: Error) => void
    vi.spyOn(lq.utils, `setWindow`)
      .mockReturnValueOnce(
        new Promise<void>((_, reject) => {
          rejectFirst = reject
        }),
      )
      .mockReturnValue(true)

    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    const unsubscribe = controller.subscribe(() => {})
    unsubscribe()
    controller.subscribe(() => {})

    rejectFirst(new Error(`stale attachment failed`))
    await flush()

    expect(controller.getSnapshot().isError).toBe(false)
    expect(controller.getSnapshot().error).toBeUndefined()
    controller.dispose()
  })

  it(`does not notify synchronously while subscribing by default`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    await lq.preload()
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    let subscribing = true
    let notifiedWhileSubscribing = false

    const unsubscribe = controller.subscribe(() => {
      if (subscribing) notifiedWhileSubscribing = true
    })
    subscribing = false

    expect(notifiedWhileSubscribing).toBe(false)
    unsubscribe()
    controller.dispose()
  })

  it(`keeps duplicate callback subscriptions independent`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    let notifications = 0
    const listener = () => notifications++
    const unsubscribeFirst = controller.subscribe(listener)
    const unsubscribeSecond = controller.subscribe(listener)
    await lq.preload()
    await flush()

    notifications = 0
    unsubscribeFirst()
    controller.fetchNextPage()
    await flush()

    expect(notifications).toBeGreaterThan(0)
    unsubscribeSecond()
    controller.dispose()
  })

  it(`does not deliver an in-flight notification to a late subscriber`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    let publishing = false
    let lateNotifications = 0
    let unsubscribeLate: (() => void) | undefined
    const unsubscribeFirst = controller.subscribe(() => {
      if (publishing && !unsubscribeLate) {
        unsubscribeLate = controller.subscribe(() => lateNotifications++)
      }
    })
    await lq.preload()
    await flush()
    vi.spyOn(lq.utils, `setWindow`).mockReturnValue(true)

    publishing = true
    controller.fetchNextPage()
    publishing = false

    expect(lateNotifications).toBe(0)
    unsubscribeLate?.()
    unsubscribeFirst()
    controller.dispose()
  })

  it(`rejects every subscription after disposal`, () => {
    const controller = createLiveQueryWindowController<Row, string>(
      makeOrderedLiveQuery(makeSource(), 2) as any,
      { pageSize: 2 },
    )
    controller.dispose()

    expect(() => controller.subscribe(() => {})).toThrow(
      LiveQueryWindowControllerDisposedError,
    )
    expect(() => controller.subscribe(() => {})).toThrow(
      LiveQueryWindowControllerDisposedError,
    )
  })

  it(`releases subscriptions when disposed by a listener`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })

    controller.subscribe(() => controller.dispose())
    await lq.preload()
    await controller.fetchNextPage()

    expect(lq.subscriberCount).toBe(0)
  })

  it(`stops an in-flight publication when a listener disposes`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    let publishing = false
    let secondListenerNotifications = 0
    controller.subscribe(() => {
      if (publishing) controller.dispose()
    })
    controller.subscribe(() => {
      if (publishing) secondListenerNotifications++
    })
    await lq.preload()
    await flush()
    vi.spyOn(lq.utils, `setWindow`).mockReturnValue(true)

    publishing = true
    controller.fetchNextPage()
    publishing = false

    expect(secondListenerNotifications).toBe(0)
  })

  it(`skips a listener unsubscribed during an in-flight publication`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    let publishing = false
    let secondListenerNotifications = 0
    let unsubscribeSecond = () => {}
    controller.subscribe(() => {
      if (publishing) unsubscribeSecond()
    })
    unsubscribeSecond = controller.subscribe(() => {
      if (publishing) secondListenerNotifications++
    })
    await lq.preload()
    await flush()
    vi.spyOn(lq.utils, `setWindow`).mockReturnValue(true)

    publishing = true
    await controller.fetchNextPage()
    publishing = false

    expect(secondListenerNotifications).toBe(0)
    controller.dispose()
  })

  it(`returns a stable snapshot identity when nothing changed`, async () => {
    const lq = makeOrderedLiveQuery(makeSource(), 2)
    const controller = createLiveQueryWindowController<Row, string>(lq as any, {
      pageSize: 2,
    })
    controller.subscribe(() => {})
    await lq.preload()
    await flush()
    expect(controller.getSnapshot()).toBe(controller.getSnapshot())
    controller.dispose()
  })

  it(`represents a disabled controller (null collection)`, () => {
    const controller = createLiveQueryWindowController<Row, string>(null)
    const snap = controller.getSnapshot()
    expect(snap.isEnabled).toBe(false)
    expect(snap.data).toEqual([])
    expect(snap.hasNextPage).toBe(false)
    expect(snap.pages).toEqual([])
    controller.dispose()
  })
})
