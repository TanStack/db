import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions } from './utils.js'

/**
 * Sync can start before any subscriber exists — `startSync: true`, `preload()`
 * and `startSyncImmediate()` all do it. These cover the guarantees around
 * reclaiming those collections, in particular the ones that keep a collection
 * whose subscriber is still on its way from being torn down underneath it.
 */

type Person = { id: string; name: string }

const makeSource = (id: string) =>
  createCollection(
    mockSyncCollectionOptions<Person>({
      id,
      getKey: (p) => p.id,
      initialData: [
        { id: `1`, name: `Alice` },
        { id: `2`, name: `Bob` },
      ],
    }),
  )

const makeLiveQuery = (
  source: ReturnType<typeof makeSource>,
  id: string,
  gcTime = 1,
) =>
  createLiveQueryCollection({
    id,
    startSync: true,
    gcTime,
    query: (q) =>
      q.from({ p: source }).select(({ p }) => ({ id: p.id, name: p.name })),
  })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe(`collections that start syncing without a subscriber`, () => {
  it(`survives longer than its gcTime, so a subscriber still on its way can attach`, async () => {
    const source = makeSource(`grace-source`)
    const live = makeLiveQuery(source, `grace-live`)

    // `gcTime` is 1ms. Frameworks build the collection while rendering and
    // subscribe when that render commits, so reclaiming it on `gcTime` alone
    // would race the commit.
    await wait(15)

    expect(live.status).not.toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(1)
  })

  it(`cancels the pending reclamation once a subscriber attaches`, async () => {
    const source = makeSource(`cancel-source`)
    const live = makeLiveQuery(source, `cancel-live`)

    const subscription = live.subscribeChanges(() => {})

    await wait(100)

    expect(live.status).toBe(`ready`)
    expect(live.size).toBe(2)
    expect(source.subscriberCount).toBe(1)

    subscription.unsubscribe()
  })

  it(`still reclaims on gcTime when the last subscriber leaves`, async () => {
    const source = makeSource(`unmount-source`)
    const live = makeLiveQuery(source, `unmount-live`)

    const subscription = live.subscribeChanges(() => {})
    subscription.unsubscribe()

    // The grace period covers the gap before the first subscriber only. Once
    // one has come and gone, teardown runs on `gcTime` — 1ms here, which is
    // what adapters rely on to release a query as its component unmounts.
    await wait(20)

    expect(live.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)
  })

  it(`restarts sync when a subscriber attaches after reclamation`, async () => {
    const source = makeSource(`restart-source`)
    const live = makeLiveQuery(source, `restart-live`)

    await wait(100)
    expect(live.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)

    live.subscribeChanges(() => {})

    expect(live.status).not.toBe(`cleaned-up`)
    expect(live.size).toBe(2)
    expect(source.subscriberCount).toBe(1)
  })

  it(`leaves collections alone when gcTime disables GC`, async () => {
    const source = makeSource(`disabled-source`)
    const live = makeLiveQuery(source, `disabled-live`, 0)

    await wait(100)

    expect(live.status).toBe(`ready`)
    expect(source.subscriberCount).toBe(1)
  })

  it(`reclaims a collection warmed by preload that nothing goes on to use`, async () => {
    const source = makeSource(`preload-source`)
    const live = createLiveQueryCollection({
      id: `preload-live`,
      gcTime: 1,
      query: (q) => q.from({ p: source }).select(({ p }) => ({ id: p.id })),
    })

    await live.preload()
    expect(source.subscriberCount).toBe(1)

    await wait(100)

    expect(live.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)
  })
})
