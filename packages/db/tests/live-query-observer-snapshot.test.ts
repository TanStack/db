// Ordinary regressions for live-query observer snapshots around SSR capture
// and client preloads: an unchanged server revision keeps its identity, a
// loading capture does not answer an explicit preload, a pending stream keeps
// its promise, and transport streaming is opt-in. The point-in-time law for
// retained snapshots belongs to live-query-observer-snapshot-oracle.property.test.ts.
import { expect, it, vi } from 'vitest'
import { DbClient, collectionOptions } from '../src/client.js'
import { getLiveQueryHash } from '../src/live-query-options.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { Query, createLiveQueryCollection } from '../src/query/index.js'

type Row = { id: string; version: number }

// Work probe: an unchanged prepared server revision needs one admission walk,
// and checking row presence must not materialize its lazy keyed view.
it(`reuses server admission without building the lazy state Map`, async () => {
  const client = new DbClient()
  const source = client.collection(
    collectionOptions(`server-work`, () =>
      localOnlyCollectionOptions<Row, string>({
        id: `server-work`,
        getKey: (row) => row.id,
        initialData: [{ id: `a`, version: 1 }],
      }),
    ),
  )
  await source.preload()
  const query = new Query().from({ row: source }).orderBy(({ row }) => row.id)
  const collection = createLiveQueryCollection({ query })
  await collection.preload()
  const observer = createLiveQueryObserver(collection, {
    client,
    queryHash: getLiveQueryHash({ query }),
  })
  const walk = vi.spyOn(client, `_hasSsrCollectionSnapshot`)
  const snapshot = observer.getSnapshot()
  const state = vi.spyOn(snapshot, `state`, `get`)
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    const first = observer.getServerSnapshot()
    for (let i = 0; i < 10; i++)
      expect(observer.getServerSnapshot()).toBe(first)
    expect(
      walk.mock.calls.length,
      `admit an unchanged revision once`,
    ).toBeLessThanOrEqual(1)
    expect(
      state,
      `row-presence check keeps keyed materialization lazy`,
    ).not.toHaveBeenCalled()
  } finally {
    vi.stubGlobal(`window`, browserWindow)
    observer.dispose()
    await collection.cleanup()
    await client.cleanup()
  }
})

// Capturing a loading SSR view must not answer a later explicit data preload.
// The real source controls readiness; server capture owns only the initial view.
it(`keeps explicit preload pending after a loading server capture`, async () => {
  let ready = () => {}
  const client = new DbClient()
  const descriptor = collectionOptions(`capture-preload`, () => ({
    id: `capture-preload`,
    getKey: (row: Row) => row.id,
    sync: {
      sync: ({ markReady }) => {
        ready = markReady
      },
    },
  }))
  const source = client.collection(descriptor)
  const query = new Query().from({ row: source })
  const collection = createLiveQueryCollection({ query })
  const observer = createLiveQueryObserver(collection, {
    client,
    queryHash: getLiveQueryHash({ query }),
  })
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    expect(observer.getServerSnapshot().isReady).toBe(false)
    let settled = false
    const preload = client.preloadLiveQuery({ query }).then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled, `an initial view is not completed data demand`).toBe(false)
    ready()
    await preload
    expect(settled).toBe(true)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
    observer.dispose()
    await collection.cleanup()
    await client.cleanup()
  }
})

// A pending stream owns one result promise. Capturing its initial loading view
// must not replace that promise when another preload requests the same data.
it(`retains a pending stream after capturing its loading view`, async () => {
  let ready = () => {}
  const client = new DbClient()
  const descriptor = collectionOptions(`pending-capture`, () => ({
    id: `pending-capture`,
    getKey: (row: Row) => row.id,
    sync: {
      sync: ({ markReady }) => {
        ready = markReady
      },
    },
  }))
  const query = new Query().from({ row: descriptor })
  const hash = getLiveQueryHash({ query })
  const preload = client.preloadLiveQuery({ query })
  const original = client.dehydrate({ shouldDehydrateLiveQuery: () => true })
    .liveQueries![0]!.promise
  const source = client.collection(descriptor)
  const collection = createLiveQueryCollection({
    query: new Query().from({ row: source }),
  })
  const observer = createLiveQueryObserver(collection, {
    client,
    queryHash: hash,
  })
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    expect(observer.getServerSnapshot().isReady).toBe(false)
    const peer = client.preloadLiveQuery({ query })
    expect(
      client.dehydrate({ shouldDehydrateLiveQuery: () => true })
        .liveQueries![0]!.promise,
      `initial capture cannot replace the established stream`,
    ).toBe(original)
    ready()
    await Promise.all([preload, peer])
  } finally {
    ready()
    vi.stubGlobal(`window`, browserWindow)
    observer.dispose()
    await collection.cleanup()
    await client.cleanup()
  }
})

// Non-streaming transport remains JSON-compatible. Capturing an initial view
// does not opt its route into promise streaming; opted-in streaming still keeps
// the pending result promise beside the initial snapshot.
it.each([false, true])(
  `captures a pending initial view with streaming=%s`,
  async (streaming) => {
    const client = new DbClient()
    client._setSsrStreamingEnabled(streaming)
    const descriptor = collectionOptions(`pending-json`, () => ({
      id: `pending-json`,
      getKey: (row: Row) => row.id,
      sync: { sync: () => {} },
    }))
    const query = new Query().from({ row: descriptor })
    void client.preloadLiveQuery({ query }).catch(() => {})
    const source = client.collection(descriptor)
    const collection = createLiveQueryCollection({
      query: new Query().from({ row: source }),
    })
    const observer = createLiveQueryObserver(collection, {
      client,
      queryHash: getLiveQueryHash({ query }),
    })
    const browserWindow = globalThis.window
    vi.stubGlobal(`window`, undefined)
    try {
      observer.getServerSnapshot()
      const transported = client.dehydrate().liveQueries![0]!
      expect(transported.snapshot?.status).toBe(`loading`)
      expect(
        transported.promise instanceof Promise,
        `only requested streaming carries a promise`,
      ).toBe(streaming)
    } finally {
      vi.stubGlobal(`window`, browserWindow)
      observer.dispose()
      await collection.cleanup()
      await client.cleanup()
    }
  },
)
