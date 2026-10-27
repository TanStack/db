// Ordinary pooled live query gcTime tests: partition membership, resubscription,
// terminal cleanup, config defaults, and group bookkeeping. Each compares
// production with literal expectations. The release-timing law that the
// generated gcTime cases check is owned by pooled-live-query-gc-oracle.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionImpl, createCollection } from '../../src/collection/index.js'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { Query } from '../../src/query/builder/index.js'
import { createLiveQueryCollection, eq, not } from '../../src/query/index.js'
import { createPooledLiveQuery } from '../../src/query/pooled-live-query.js'
import { resolveLiveQueryValue } from '../../src/live-query-options.js'
import {
  makeSource,
  query,
  releaseTime,
} from './pooled-live-query-gc-support.js'
import type { Row } from './pooled-live-query-gc-support.js'

let serial = 0

describe(`pooled live query gcTime`, () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it(`follows its source again when resubscribed after its partition released`, async () => {
    const run = async (
      build: (source: ReturnType<typeof makeSource>) => any,
    ) => {
      const source = makeSource()
      const observer = createLiveQueryObserver(build(source), {
        mode: `wholesale`,
      })
      observer.subscribe(() => {})()
      await vi.advanceTimersByTimeAsync(50)
      // Hidden past gcTime, as under a hidden React Activity, then shown.
      source.utils.begin()
      source.utils.write({ type: `insert`, value: { id: `b`, g: `x` } })
      source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
      source.utils.commit()
      const stop = observer.subscribe(() => {})
      await vi.advanceTimersByTimeAsync(1)
      source.utils.begin()
      source.utils.write({ type: `insert`, value: { id: `c`, g: `x` } })
      source.utils.commit()
      await vi.advanceTimersByTimeAsync(1)
      const keys = [...observer.getSnapshot().state!.keys()]
      stop()
      return keys
    }
    const compiledKeys = await run((source) =>
      createLiveQueryCollection({
        query: query(source),
        startSync: true,
        gcTime: 1,
      }),
    )
    expect(compiledKeys).toEqual([`b`, `c`])
    expect(
      await run((source) =>
        createPooledLiveQuery(query(source)(new Query()), { gcTime: 1 })!,
      ),
    ).toEqual(compiledKeys)
  })

  it(`seeds a filtered view from its refilled group after a release`, async () => {
    const source = makeSource()
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `b`, g: `x` } })
    source.utils.commit()
    // `not(eq(r.id, 'b'))` is evaluated per view, so this view keeps `a`.
    const view = createPooledLiveQuery(
      query(source)(new Query()).where(({ r }: any) => not(eq(r.id, `b`))),
      { gcTime: 1 },
    )!
    const observer = createLiveQueryObserver(view, { mode: `wholesale` })
    observer.subscribe(() => {})()
    await vi.advanceTimersByTimeAsync(60)
    const stop = observer.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(1)
    expect([...observer.getSnapshot().state!.keys()]).toEqual([`a`])
    source.utils.begin()
    source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
    source.utils.commit()
    await vi.advanceTimersByTimeAsync(1)
    expect([...observer.getSnapshot().state!.keys()]).toEqual([])
    stop()
  })

  it(`shares one partition after a released partition subscribes again`, async () => {
    const source = makeSource()
    const mount = () => {
      const view = createPooledLiveQuery(query(source)(new Query()), {
        gcTime: 1,
      })!
      const observer = createLiveQueryObserver(view, { mode: `wholesale` })
      return { observer, stop: observer.subscribe(() => {}) }
    }
    const first = mount()
    first.stop()
    await vi.advanceTimersByTimeAsync(60)
    // The released partition's view subscribes again, beside a new view.
    const again = first.observer.subscribe(() => {})
    const second = mount()
    // The new view joins the partition that subscribed again.
    expect(source.subscriberCount).toBe(1)
    again()
    await vi.advanceTimersByTimeAsync(60)
    const third = mount()
    expect(source.subscriberCount).toBe(1)
    second.stop()
    third.stop()
  })

  it(`keeps a newer partition when an older one releases again`, async () => {
    const source = makeSource()
    const mount = () => {
      const view = createPooledLiveQuery(query(source)(new Query()), {
        gcTime: 1,
      })!
      const observer = createLiveQueryObserver(view, { mode: `wholesale` })
      return { observer, stop: observer.subscribe(() => {}) }
    }
    const first = mount()
    first.stop()
    await vi.advanceTimersByTimeAsync(60)
    // A new partition takes the key before the old view subscribes again.
    const second = mount()
    first.observer.subscribe(() => {})()
    await vi.advanceTimersByTimeAsync(60)
    const third = mount()
    expect(source.subscriberCount).toBe(1)
    second.stop()
    third.stop()
  })

  it(`turns terminal when source cleanup starts, before it settles`, async () => {
    let release!: () => void
    const source = createCollection<Row, string | number>({
      id: `pooled-gc-${serial++}`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `a`, g: `x` } })
          commit()
          markReady()
          // The adapter's cleanup stays pending until released.
          return () =>
            new Promise<void>((resolve) => {
              release = resolve
            })
        },
      },
    })
    const observe = (view: any) => {
      const observer = createLiveQueryObserver(view, { mode: `wholesale` })
      return { observer, stop: observer.subscribe(() => {}) }
    }
    const pooledView = observe(
      createPooledLiveQuery(query(source)(new Query()), { gcTime: 1 })!,
    )
    const compiledView = observe(
      createLiveQueryCollection({ query: query(source), startSync: true }),
    )
    await vi.advanceTimersByTimeAsync(1)
    const cleanup = source.cleanup()
    await vi.advanceTimersByTimeAsync(1)
    expect(compiledView.observer.getSnapshot().status).toBe(`error`)
    expect(pooledView.observer.getSnapshot().status).toBe(`error`)
    release()
    await cleanup
    pooledView.stop()
    compiledView.stop()
  })

  it(`defaults to a live-query Collection's gcTime when the adapter gives none`, async () => {
    // A pooled view and a compiled one, each on its own source.
    const pooledOnOwn = makeSource()
    const pooledObserver = createLiveQueryObserver(
      resolveLiveQueryValue(query(pooledOnOwn)(new Query())),
      { mode: `wholesale` },
    )
    pooledObserver.subscribe(() => {})()
    const compiledOnOwn = makeSource()
    const compiledObserver = createLiveQueryObserver(
      createLiveQueryCollection({
        query: query(compiledOnOwn),
        startSync: true,
      }),
      { mode: `wholesale` },
    )
    compiledObserver.subscribe(() => {})()
    await vi.advanceTimersByTimeAsync(4_900)
    expect(compiledOnOwn.subscriberCount).toBe(1)
    expect(pooledOnOwn.subscriberCount).toBe(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(compiledOnOwn.subscriberCount).toBe(0)
    expect(pooledOnOwn.subscriberCount).toBe(0)
  })

  it(`pools a query config that names only its query`, () => {
    const source = makeSource()
    const observe = (value: unknown) =>
      createLiveQueryObserver(resolveLiveQueryValue(value, { gcTime: 1 }), {
        mode: `wholesale`,
      }).subscribe(() => {})
    const stops = [
      observe({ query: query(source)(new Query()) }),
      observe({ query: query(source)(new Query()), gcTime: 5 }),
    ]
    expect(source.subscriberCount).toBe(1)
    // An id names a distinct Collection, so that config compiles its own.
    stops.push(observe({ query: query(source)(new Query()), id: `own` }))
    expect(source.subscriberCount).toBe(2)
    for (const stop of stops) stop()
  })

  it(`keeps groups only for values with rows or watchers`, async () => {
    const source = makeSource()
    source.utils.begin()
    for (let n = 0; n < 50; n++) {
      source.utils.write({ type: `insert`, value: { id: `r${n}`, g: `v${n}` } })
    }
    source.utils.commit()
    const view = createPooledLiveQuery(query(source)(new Query()), {
      gcTime: 1,
    })!
    const observer = createLiveQueryObserver(view, { mode: `wholesale` })
    const stop = observer.subscribe(() => {})
    const groups = () =>
      (view as unknown as { partition: { groups: Map<string, unknown> } })
        .partition.groups.size
    // One group per distinct value, plus the watched `x`.
    expect(groups()).toBe(51)
    source.utils.begin()
    for (let n = 0; n < 50; n++) {
      source.utils.write({ type: `delete`, value: { id: `r${n}`, g: `v${n}` } })
    }
    source.utils.commit()
    expect(groups()).toBe(1)
    // The watched group empties and is dropped; new rows recreate it, and
    // the observer still sees them.
    source.utils.begin()
    source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
    source.utils.commit()
    expect(groups()).toBe(1)
    expect(observer.getSnapshot().data).toEqual([])
    stop()
    expect(groups()).toBe(0)
    const again = observer.subscribe(() => {})
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `b`, g: `x` } })
    source.utils.commit()
    expect([...observer.getSnapshot().state!.keys()]).toEqual([`b`])
    again()
  })

  it(`never reuses a dropped group's revision for a detached reader`, () => {
    const source = makeSource()
    const write = (type: `insert` | `delete`, id: string, g: string) => {
      source.utils.begin()
      source.utils.write({ type, value: { id, g } })
      source.utils.commit()
    }
    // A watched `y` view keeps the partition subscribed.
    write(`insert`, `z`, `y`)
    const keepAlive = createLiveQueryObserver(
      createPooledLiveQuery(
        new Query()
          .from({ r: source })
          .where(({ r }: any) => eq(r.g, `y`)) as any,
        { gcTime: 1 },
      ),
      { mode: `wholesale` },
    ).subscribe(() => {})
    // The `x` view is read without subscribing, so it compares revisions.
    const reader = createLiveQueryObserver(
      createPooledLiveQuery(query(source)(new Query()), { gcTime: 1 }),
      { mode: `wholesale` },
    )
    write(`insert`, `b`, `x`)
    const keys = () => [...reader.getSnapshot().state!.keys()]
    expect(keys()).toEqual([`a`, `b`])
    // Emptying the unwatched group drops it; new rows build a new one.
    source.utils.begin()
    source.utils.write({ type: `delete`, value: { id: `a`, g: `x` } })
    source.utils.write({ type: `delete`, value: { id: `b`, g: `x` } })
    source.utils.commit()
    write(`insert`, `c`, `x`)
    write(`insert`, `d`, `x`)
    expect(keys()).toEqual([`c`, `d`])
    keepAlive()
  })

  it(`keeps its public Collection live while observed`, async () => {
    const source = makeSource()
    const view = createPooledLiveQuery(query(source)(new Query()), {
      gcTime: 1,
    })!
    const observer = createLiveQueryObserver(view, { mode: `wholesale` })
    const stop = observer.subscribe(() => {})
    const collection = observer.getSnapshot().collection!
    expect(collection.toArray).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(collection.status).toBe(`ready`)
    expect(collection.toArray).toHaveLength(1)
    stop()
  })

  it(`hands users a Collection that queries accept as a source`, () => {
    const source = makeSource()
    const view = createPooledLiveQuery(query(source)(new Query()), {
      gcTime: 1,
    })!
    const collection = createLiveQueryObserver(view, {
      mode: `wholesale`,
    }).getSnapshot().collection!
    expect(collection).toBeInstanceOf(CollectionImpl)
    const nested = createLiveQueryCollection({
      query: (q) => q.from({ c: collection }),
      startSync: true,
    })
    expect(nested.toArray.map((row) => row.id)).toEqual([`a`])
  })

  it.each([[[5, 120]], [[120, 5]]])(
    `releases with the longest gcTime among a partition's views (%j)`,
    async (gcTimes) => {
      const source = makeSource()
      for (const gcTime of gcTimes) {
        const view = createPooledLiveQuery(query(source)(new Query()), {
          gcTime,
        })!
        createLiveQueryObserver(view, { mode: `wholesale` }).subscribe(
          () => {},
        )()
      }
      expect(await releaseTime(source, 400)).toBe(120)
    },
  )
})
