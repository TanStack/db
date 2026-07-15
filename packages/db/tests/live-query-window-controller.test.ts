import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createLiveQueryWindowController } from '../src/live-query-window-controller.js'
import { mockSyncCollectionOptions } from './utils.js'

interface Row {
  id: string
  n: number
}

const ROWS: Array<Row> = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), n }))

let seq = 0
function makeSource() {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `window-ctrl-${seq++}`,
      getKey: (r) => r.id,
      initialData: ROWS,
    }),
  )
}

/** Ordered live query with page 1's peek-ahead window baked in, as the React adapter builds it. */
function makeOrderedLiveQuery(source: ReturnType<typeof makeSource>, pageSize: number) {
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
