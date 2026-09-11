import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions } from './utils.js'

/**
 * A live query collection created with `startSync: true` subscribes to its
 * source collections at construction time. `startGCTimer()` is only ever
 * called from `removeSubscriber()` on the 1 -> 0 transition, so a collection
 * that never gains a subscriber never arms its GC timer and is never cleaned
 * up -- no matter how small `gcTime` is.
 *
 * This is exactly the state left behind by a React render attempt that is
 * discarded before commit: `useLiveQuery` constructs the collection with
 * `startSync: true` in the render body, and the only teardown path runs from
 * the `useSyncExternalStore` subscribe cleanup, which never happens.
 */

type Person = { id: string; name: string; active: boolean }

const GC_TIME_MS = 1

const makeSource = (id: string) =>
  createCollection(
    mockSyncCollectionOptions<Person>({
      id,
      getKey: (p) => p.id,
      initialData: [
        { id: `1`, name: `Alice`, active: true },
        { id: `2`, name: `Bob`, active: false },
      ],
    }),
  )

const makeOrphan = (source: ReturnType<typeof makeSource>, id: string) =>
  createLiveQueryCollection({
    id,
    // Same two options `useLiveQuery` passes from its render body.
    startSync: true,
    gcTime: GC_TIME_MS,
    query: (q) =>
      q
        .from({ p: source })
        .select(({ p }) => ({ id: p.id, name: p.name, active: p.active })),
  })

// Well past gcTime, plus room for the CleanupQueue's batching microtask.
const waitPastGcTime = () => new Promise((r) => setTimeout(r, 100))

const writeToSource = (
  source: ReturnType<typeof makeSource>,
  person: Person,
) => {
  source.utils.begin()
  source.utils.write({ type: `insert`, value: person })
  source.utils.commit()
}

describe(`live query collections that never gain a subscriber`, () => {
  it(`is cleaned up after gcTime even though nothing ever subscribed`, async () => {
    const source = makeSource(`gc-single-source`)
    expect(source.subscriberCount).toBe(0)

    const orphan = makeOrphan(source, `gc-single-orphan`)

    // Construction started sync, which subscribed to the source.
    expect(source.subscriberCount).toBe(1)

    await waitPastGcTime()

    // Nothing ever subscribed to `orphan`, so it is unreachable from user code
    // the moment the caller drops its reference. After gcTime it should have
    // released the source.
    expect(orphan.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)
  })

  it(`releases the source when every orphan's gcTime has elapsed`, async () => {
    const source = makeSource(`gc-many-source`)
    const N = 200

    const counts: Array<number> = []
    for (let i = 0; i < N; i++) {
      makeOrphan(source, `gc-many-orphan-${i}`)
      counts.push(source.subscriberCount)
    }

    // Strictly monotonic: every construction adds a subscription, none is
    // ever removed.
    expect(counts[0]).toBe(1)
    expect(counts[N - 1]).toBe(N)

    await waitPastGcTime()

    console.log(
      `[orphan-gc] after ${N} never-subscribed constructions + ${GC_TIME_MS}ms gcTime: source.subscriberCount =`,
      source.subscriberCount,
    )

    expect(source.subscriberCount).toBe(0)
  })

  it(`stops reprocessing source changes once gcTime has elapsed`, async () => {
    const N = 200

    const bare = makeSource(`gc-cost-bare-source`)
    const loaded = makeSource(`gc-cost-loaded-source`)
    for (let i = 0; i < N; i++) {
      makeOrphan(loaded, `gc-cost-orphan-${i}`)
    }

    await waitPastGcTime()

    const time = (source: ReturnType<typeof makeSource>, tag: string) => {
      const start = performance.now()
      for (let i = 0; i < 50; i++) {
        writeToSource(source, { id: `w${i}`, name: `W${i}`, active: true })
      }
      const ms = performance.now() - start

      console.log(`[orphan-gc] 50 source writes (${tag}): ${ms.toFixed(2)}ms`)
      return ms
    }

    const bareMs = time(bare, `no orphans`)
    const loadedMs = time(loaded, `${N} orphans, all past gcTime`)

    console.log(
      `[orphan-gc] write cost multiplier with ${N} orphans:`,
      (loadedMs / Math.max(bareMs, 0.001)).toFixed(1) + `x`,
    )

    // Orphans that were never subscribed to should have been reclaimed, so a
    // write should cost about the same either way.
    expect(loadedMs).toBeLessThan(bareMs * 5 + 5)
  })

  it(`retains no heap once gcTime has elapsed`, async () => {
    const source = makeSource(`gc-heap-source`)
    const N = 1000

    const forceGc = (globalThis as { gc?: () => void }).gc
    forceGc?.()
    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < N; i++) {
      makeOrphan(source, `gc-heap-orphan-${i}`)
    }

    await waitPastGcTime()
    forceGc?.()
    const after = process.memoryUsage().heapUsed

    const retained = after - before

    console.log(
      `[orphan-gc] ${N} never-subscribed live queries retained ${(retained / 1024 / 1024).toFixed(1)} MB` +
        ` (${Math.round(retained / N / 1024)} KB each), forced GC: ${forceGc ? `yes` : `unavailable`},` +
        ` source.subscriberCount = ${source.subscriberCount}`,
    )

    expect(source.subscriberCount).toBe(0)
    // Whatever the exact per-graph size, nothing should survive. Only
    // meaningful when the heap can actually be collected first, so run this
    // file under `NODE_OPTIONS=--expose-gc` for the byte assertion.
    if (forceGc) {
      expect(retained).toBeLessThan(N * 1024)
    }
  })

  it(`is cleaned up when a subscriber does attach and then detach (control)`, async () => {
    const source = makeSource(`gc-control-source`)
    const live = makeOrphan(source, `gc-control-live`)

    const subscription = live.subscribeChanges(() => {})
    expect(live.subscriberCount).toBe(1)

    subscription.unsubscribe()
    await waitPastGcTime()

    expect(live.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)
  })
})
