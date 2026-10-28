// Ordinary tests moved out of live-query-deferred-acquisition-oracle.test.ts. They keep
// literal expectations for pooled views, DbClient streams, and restarts; the deferred
// acquisition law and its history grammar stay in the oracle file.
import { describe, expect, it, vi } from 'vitest'
import {
  BTreeIndex,
  DbClient,
  collectionOptions,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryObserver,
  eq,
  getLiveQueryHash,
  prepareLiveQueryValue,
} from '../src'
import { Query } from '../src/query/builder/index.js'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import {
  EXPECTED_IDS,
  QUERY_SHAPES,
  ROWS,
  makeLiveQuery,
  makeSource,
  pooledQuery,
  settle,
} from './live-query-deferred-acquisition-support.js'
import type { Row } from './live-query-deferred-acquisition-support.js'
import type { Collection, LiveQueryObserver } from '../src'

let sequence = 0

describe(`pooled live-query deferred acquisition`, () => {
  it.each([
    [`eager-idle`, `no SSR cleanup client`],
    [`eager-running`, `no SSR cleanup client`],
    [`eager-idle`, `an SSR cleanup client`],
    [`eager-running`, `an SSR cleanup client`],
  ] as const)(
    `an observer preload reaches a config-free pooled view from %s with %s`,
    async (state, clientMode) => {
      const { collection: source, counts } = makeSource(state)
      const view = createPooledLiveQuery(pooledQuery(source)(new Query()), {
        gcTime: 0,
      })
      expect(view, `the query is poolable`).toBeDefined()
      const client =
        clientMode === `an SSR cleanup client` ? new DbClient() : undefined
      client?._setSsrServerCleanupEnabled(true)
      let observer: LiveQueryObserver<Row, string | number> | undefined
      let constructionError: unknown
      try {
        observer = createLiveQueryObserver(view as Collection<Row>, {
          client,
          queryHash: `config-free-pooled-view`,
        })
      } catch (error) {
        constructionError = error
      }
      try {
        expect(
          constructionError,
          `observer construction succeeds`,
        ).toBeUndefined()
        if (!observer) throw new Error(`missing observer after construction`)
        // Model: explicit demand starts an idle source once. An already
        // running source needs no second start for the same public rows.
        const startsBefore = counts.starts
        await expect(
          Promise.resolve().then(() => observer.preload()),
          `observer preload succeeds`,
        ).resolves.toBeUndefined()
        await settle()
        expect(counts.starts - startsBefore, `new source starts`).toBe(
          state === `eager-idle` ? 1 : 0,
        )
        expect(observer.getSnapshot().status).toBe(`ready`)
        const rows = observer.getSnapshot().data as ReadonlyArray<Row>
        expect(rows.map((row) => row.id)).toEqual(EXPECTED_IDS.all)
      } finally {
        observer?.dispose()
        await view?.cleanup()
        await source.cleanup({ dependents: true })
        await client?.cleanup()
      }
    },
  )
})

/**
 * A DbClient preload owns the release of every source it prepared. If the
 * first source's sync run throws, that error belongs to the failed query;
 * the later healthy source still gets its release and can serve a direct
 * reader. The model needs only two independent start counts: zero before
 * preload, one for each after release. The public checkpoint is the failed
 * preload followed by readiness of the second source Collection.
 * The failed call has no result to stream. A dehydration request at the
 * synchronous error cut must not publish its pending query promise, even when
 * the caller opts to stream pending queries.
 * A later same-hash preload over a healthy replacement source must publish
 * that source's row; the failed attempt has no result to reuse.
 * The same options can be retried, but the failed source Collection remains
 * in error until explicitly restarted. That retry must report the source error
 * rather than wait on the failed query's former pending stream. A controlled
 * later `fail` crosses the asynchronous failure cut: the pending preload
 * rejects, its stream disappears, and a healthy replacement of the same
 * query hash can publish its own row while the peer source remains ready. A
 * failed stream has no reusable result, so a replacement observer may attach
 * through the same hash before a new preload. Its public snapshot must show
 * the replacement row as ready, with no stale stream error. The active-stream
 * identity rule also applies before that failure: a different same-hash
 * preload rejects while the original stream is pending. A synchronous source
 * throw crosses the same recovery law at a different cut. After the peer source
 * becomes ready, a replacement observer may attach before a new client preload
 * and must read only the replacement row. These fixed histories do not claim
 * all failure schedules or concurrent replacement observers.
 */
describe(`DbClient preload releases independent source starts`, () => {
  it(`retire a pending stream after asynchronous source startup failure`, async () => {
    const failure = new Error(`late source startup failure`)
    let failFirst!: () => void
    let firstStarts = 0
    let secondStarts = 0
    const first = collectionOptions(`preload-async-first`, () => ({
      id: `preload-async-first`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: ({ fail }) => {
          firstStarts++
          failFirst = () => fail(failure)
        },
      },
    }))
    const second = collectionOptions(`preload-async-second`, () => ({
      id: `preload-async-second`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          secondStarts++
          markReady()
        },
      },
    }))
    const replacement = createCollection({
      id: `preload-async-first`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `recovered` } })
          commit()
          markReady()
        },
      },
    })
    const secondBranch = () =>
      new Query().from({ second }).select(({ second: row }) => ({ id: row.id }))
    const failedQuery = new Query().unionAll(
      new Query().from({ first }).select(({ first: row }) => ({ id: row.id })),
      secondBranch(),
    )
    const recoveredQuery = new Query().unionAll(
      new Query()
        .from({ first: replacement })
        .select(({ first: row }) => ({ id: row.id })),
      secondBranch(),
    )
    const client = new DbClient()

    try {
      const pending = client.preloadLiveQuery({ query: failedQuery })
      expect([firstStarts, secondStarts]).toEqual([1, 1])
      expect(
        client.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toHaveLength(1)
      // Model: the pending result still belongs to the original sources.
      // The replacement becomes legal only after this stream fails.
      expect(() => client.preloadLiveQuery({ query: recoveredQuery })).toThrow(
        /different source Collections/,
      )
      expect(
        client.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toHaveLength(1)

      failFirst()
      // The live query reports its source's own failure.
      await expect(pending).rejects.toThrow(/late source startup failure/)
      expect(
        client.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toBeUndefined()
      expect(client.collection(second).status).toBe(`ready`)

      // Model: failure retired the first result. The observer's subscription
      // is a new local demand for the healthy replacement, so it may attach
      // and must show that source's row at the settled-read checkpoint.
      const queryHash = getLiveQueryHash({ query: failedQuery })
      expect(getLiveQueryHash({ query: recoveredQuery })).toBe(queryHash)
      const prepared = prepareLiveQueryValue(recoveredQuery, client)
      const view = createLiveQueryCollection({
        query: prepared as typeof recoveredQuery,
        startSync: false,
      })
      const observer = createLiveQueryObserver(view, {
        client,
        queryHash,
        mode: `wholesale`,
      })
      try {
        let unsubscribe!: () => void
        expect(() => {
          unsubscribe = observer.subscribe(() => {})
        }, `replacement observer attaches after the failed stream`).not.toThrow()
        try {
          await observer.preload()
          expect(observer.getSnapshot().data).toEqual([
            expect.objectContaining({ id: `recovered` }),
          ])
          expect(observer.getSnapshot().status).toBe(`ready`)
          expect(observer.getError()).toBeUndefined()
        } finally {
          unsubscribe()
        }
      } finally {
        observer.dispose()
        await view.cleanup()
      }

      await client.preloadLiveQuery({ query: recoveredQuery })
      expect(
        client
          .dehydrate()
          .liveQueries?.[0]?.snapshot?.rows.map(
            ({ value }) => (value as { id: string }).id,
          ),
      ).toEqual([`recovered`])
    } finally {
      await client.cleanup()
      await replacement.cleanup()
    }
  })

  it(`reports source error instead of reusing a failed query stream`, async () => {
    const failure = new Error(`source start failed`)
    let starts = 0
    const source = collectionOptions(`preload-transient-start`, () => ({
      id: `preload-transient-start`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: () => {
          starts++
          throw failure
        },
      },
    }))
    const client = new DbClient()
    const options = {
      query: new Query()
        .from({ item: source })
        .select(({ item }) => ({ id: item.id })),
    }

    try {
      expect(() => client.preloadLiveQuery(options)).toThrow(failure)
      expect(
        client.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toBeUndefined()
      await expect(client.preloadLiveQuery(options)).rejects.toThrow(
        /source start failed/,
      )
      expect(starts).toBe(1)
      expect(
        client.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toBeUndefined()
    } finally {
      await client.cleanup()
    }
  })

  it(`releases a peer source and permits replacement after a synchronous throw`, async () => {
    const failure = new Error(`first source failed`)
    let firstStarts = 0
    let secondStarts = 0
    const first = collectionOptions(`preload-release-first`, () => ({
      id: `preload-release-first`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: () => {
          firstStarts++
          throw failure
        },
      },
    }))
    const second = collectionOptions(`preload-release-second`, () => ({
      id: `preload-release-second`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          secondStarts++
          markReady()
        },
      },
    }))
    const client = new DbClient()
    const query = new Query().unionAll(
      new Query().from({ first }).select(({ first: row }) => ({ id: row.id })),
      new Query()
        .from({ second })
        .select(({ second: row }) => ({ id: row.id })),
    )
    const replacement = createCollection({
      id: `preload-release-first`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `recovered` } })
          commit()
          markReady()
        },
      },
    })
    const recoveredQuery = new Query().unionAll(
      new Query()
        .from({ first: replacement })
        .select(({ first: row }) => ({ id: row.id })),
      new Query()
        .from({ second })
        .select(({ second: row }) => ({ id: row.id })),
    )

    try {
      let thrown: unknown
      try {
        client.preloadLiveQuery({ query })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBe(failure)
      expect(firstStarts).toBe(1)
      expect(secondStarts).toBe(1)
      expect(
        client.dehydrate({ shouldDehydrateLiveQuery: () => true }).liveQueries,
      ).toBeUndefined()
      const healthy = client.collection(second)
      await healthy.preload()
      expect(healthy.status).toBe(`ready`)

      // The synchronous throw left no reusable result. A replacement observer
      // may therefore attach under this hash before another client preload.
      const queryHash = getLiveQueryHash({ query })
      expect(getLiveQueryHash({ query: recoveredQuery })).toBe(queryHash)
      const prepared = prepareLiveQueryValue(recoveredQuery, client)
      const view = createLiveQueryCollection({
        query: prepared as typeof recoveredQuery,
        startSync: false,
      })
      const observer = createLiveQueryObserver(view, {
        client,
        queryHash,
        mode: `wholesale`,
      })
      try {
        let unsubscribe!: () => void
        expect(() => {
          unsubscribe = observer.subscribe(() => {})
        }, `replacement observer attaches after a synchronous throw`).not.toThrow()
        try {
          await observer.preload()
          expect(observer.getSnapshot().data).toEqual([
            expect.objectContaining({ id: `recovered` }),
          ])
          expect(observer.getSnapshot().status).toBe(`ready`)
          expect(observer.getError()).toBeUndefined()
        } finally {
          unsubscribe()
        }
      } finally {
        observer.dispose()
        await view.cleanup()
      }

      await client.preloadLiveQuery({ query: recoveredQuery })
      expect(
        client
          .dehydrate()
          .liveQueries?.[0]?.snapshot?.rows.map(
            ({ value }) => (value as { id: string }).id,
          ),
      ).toEqual([`recovered`])
    } finally {
      await client.cleanup()
      await replacement.cleanup()
    }
  })

  it(`reports a preparation error even if a deferred source also throws`, async () => {
    const preparationFailure = new Error(`second source factory failed`)
    const startFailure = new Error(`first source start failed`)
    let firstStarts = 0
    const first = collectionOptions(`preload-primary-first`, () => ({
      id: `preload-primary-first`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: () => {
          firstStarts++
          throw startFailure
        },
      },
    }))
    const second = collectionOptions(
      `preload-primary-second`,
      (): {
        id: string
        getKey: (row: { id: string }) => string
        sync: { sync: () => void }
      } => {
        throw preparationFailure
      },
    )
    const client = new DbClient()
    const query = new Query().unionAll(
      new Query().from({ first }).select(({ first: row }) => ({ id: row.id })),
      new Query()
        .from({ second })
        .select(({ second: row }) => ({ id: row.id })),
    )

    try {
      expect(() => client.preloadLiveQuery({ query })).toThrow(
        preparationFailure,
      )
      expect(firstStarts).toBe(1)
    } finally {
      await client.cleanup()
    }
  })
})

describe(`a subscriber that outlives cleanup`, () => {
  // A surviving subscriber that itself defers is not a request for data: an
  // unsubscribed outer live query keeps its deferring subscription to the
  // inner one across the inner one's cleanup.
  it(`on-demand-idle: a surviving deferring subscriber does not resume a restart`, async () => {
    const { collection: source, counts } = makeSource(`on-demand-idle`)
    const { outer, collections } = makeLiveQuery(source, `window`, 2)
    const inner = collections[1]!
    try {
      outer.startSyncImmediate()
      await settle()
      // Drive internal teardown, which bypasses cleanup admission.
      await inner._lifecycle.cleanup()
      inner.startSyncImmediate()
      await settle()
      expect(counts.starts, `source sync-run starts`).toBe(0)
      expect(counts.acquisitions, `acquisition attempts`).toBe(0)
    } finally {
      for (const collection of collections) await collection.cleanup()
      await source.cleanup()
    }
  })
})

/**
 * ## A source whose start throws on resumption
 *
 * The first subscriber or preload resumes every deferred source subscription.
 * One source's start can throw synchronously. That failure is reported, as a
 * rejected preload, but it does not keep the other sources deferred: each is
 * resumed before the first error surfaces. `preload()` keeps its promise
 * contract and never throws.
 */
describe(`a source whose start throws on resumption`, () => {
  it(`a retried preload resumes a source whose first start failed`, async () => {
    let attempts = 0
    let loads = 0
    const flaky = createCollection<Row>({
      id: `deferred-acquisition-flaky-${sequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      gcTime: 0,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          if (++attempts === 1) throw new Error(`transient start failure`)
          markReady()
          return {
            loadSubset: () => {
              loads++
              begin()
              for (const row of ROWS) write({ type: `insert`, value: row })
              commit()
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      query: (q) => q.from({ row: flaky }).orderBy(({ row }) => row.rank),
      gcTime: 0,
    })
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      live.startSyncImmediate()
      await expect(live.preload(), `the first preload fails`).rejects.toThrow(
        `transient start failure`,
      )
      // The failed start puts the source and its live query in error, so the
      // supported recovery is cleanup and a new sync run, not a retry in place.
      expect(live.status).toBe(`crashed`)
      await live.cleanup()
      await flaky.cleanup()
      // A new preload after cleanup starts a new sync run and must resume.
      await live.preload()
      await settle()
      expect(attempts, `the source started again`).toBe(2)
      expect(loads, `the retry loaded the source`).toBeGreaterThan(0)
      expect(live.status).toBe(`ready`)
    } finally {
      consoleError.mockRestore()
      await live.cleanup()
      await flaky.cleanup()
    }
  })

  it(`rejects the preload and still resumes the other source`, async () => {
    const failing = createCollection<Row>({
      id: `deferred-acquisition-throwing-${sequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      gcTime: 0,
      sync: {
        sync: () => {
          throw new Error(`source start failed`)
        },
      },
    })
    const { collection: healthy, counts } = makeSource(`on-demand-idle`)
    const live = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ a: failing })
          .join({ b: healthy }, ({ a, b }) => eq(a.id, b.id)),
      gcTime: 0,
    })
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      live.startSyncImmediate()
      let pending: Promise<void> | undefined
      expect(() => {
        pending = live.preload()
      }, `preload returns a promise`).not.toThrow()
      await expect(pending, `the preload rejects`).rejects.toThrow(
        `source start failed`,
      )
      await settle()
      expect(counts.starts, `the other source was resumed`).toBe(1)
    } finally {
      consoleError.mockRestore()
      await live.cleanup()
      await healthy.cleanup()
      await failing.cleanup()
    }
  })
})
/**
 * ## A preload answered by a DbClient stream
 *
 * During SSR streaming, a DbClient may already hold a pending or settled
 * stream for a query. The observer's preload then returns that stream instead
 * of preloading the live-query Collection. It is still a request for the
 * Collection's data, so it counts as a preload: deferred acquisition resumes
 * and the idle source Collection starts its sync run. This includes a source
 * left deferred by a render: that render does not own the preload's demand.
 */
describe(`preload answered by a DbClient stream`, () => {
  it.each(
    ([`pending`, `success`] as const).flatMap((stream) =>
      (
        [
          `eager-idle`,
          `eager-render-deferred`,
          `on-demand-idle`,
          `on-demand-render-deferred`,
        ] as const
      ).map((state) => ({ stream, state })),
    ),
  )(
    `a $stream stream still resumes $state acquisition`,
    async ({ stream, state }) => {
      const { collection: source, counts } = makeSource(state)
      const { outer } = makeLiveQuery(source, `all`, 1)
      const client = new DbClient()
      const queryHash = `deferred-acquisition-stream-${stream}`
      const registered = client._registerLiveQuery(
        queryHash,
        stream === `pending`
          ? new Promise<never>(() => {})
          : Promise.resolve(undefined as never),
      )
      if (stream === `success`) await registered
      const observer = createLiveQueryObserver(outer, { client, queryHash })
      try {
        outer.startSyncImmediate()
        await settle()
        expect(counts.starts, `before the preload`).toBe(0)
        void observer.preload()
        await settle()
        expect(counts.starts, `after the preload`).toBe(1)
        expect(counts.acquisitions > 0).toBe(state.startsWith(`on-demand`))
        expect(outer.toArray.map((row) => row.id)).toEqual(EXPECTED_IDS.all)
      } finally {
        observer.dispose()
        await outer.cleanup()
        await source.cleanup()
      }
    },
  )
})

/**
 * ## A subscriber that outlives cleanup
 *
 * Cleanup ends a live-query Collection's sync run but keeps its subscriptions.
 * A subscriber that survives is still a subscriber in the next sync run, so a
 * restarted live-query Collection acquires for it at once instead of
 * deferring until another subscriber or preload arrives. The finite command
 * histories above unsubscribe before cleanup. This block pins the history: subscribe,
 * clean up while subscribed, restart, then settle.
 */
describe(`a subscriber that outlives cleanup`, () => {
  for (const state of [
    `eager-idle`,
    `on-demand-idle`,
    `on-demand-running`,
  ] as const) {
    for (const shape of QUERY_SHAPES) {
      it(`${state}, ${shape}: the restarted live query serves its subscriber`, async () => {
        const { collection: source, counts } = makeSource(state)
        const { outer } = makeLiveQuery(source, shape, 1)
        const subscription = outer.subscribeChanges(() => {}, {
          includeInitialState: true,
        })
        try {
          await settle()
          expect(outer.status, `before cleanup`).toBe(`ready`)
          await outer.cleanup()
          const before = counts.acquisitions
          outer.startSyncImmediate()
          await settle()
          if (state.startsWith(`on-demand`)) {
            expect(
              counts.acquisitions - before,
              `the restart acquires for the surviving subscriber`,
            ).toBeGreaterThan(0)
          }
          expect(outer.status, `after restart`).toBe(`ready`)
          expect(outer.toArray.map((row) => row.id)).toEqual(
            EXPECTED_IDS[shape],
          )
        } finally {
          subscription.unsubscribe()
          await outer.cleanup()
          await source.cleanup()
        }
      })
    }
  }
})

/**
 * ## Reads that wait for readiness
 *
 * `toArrayWhenReady()` and `stateWhenReady()` ask for a Collection's data:
 * when it holds no rows they preload it. They are requests for data in either
 * branch, so they count as a preload. A deferring live-query Collection that
 * already shows its source's local rows returns those rows at once and resumes
 * acquisition for the rest.
 */
describe(`reads that wait for readiness`, () => {
  for (const read of [`toArrayWhenReady`, `stateWhenReady`] as const) {
    it(`${read} resumes a deferring live query that already shows local rows`, async () => {
      const { collection: source, counts } = makeSource(`on-demand-holding`)
      const { outer } = makeLiveQuery(source, `all`, 1)
      try {
        outer.startSyncImmediate()
        await settle()
        expect(outer.toArray.length, `local rows before the read`).toBe(3)
        expect(counts.acquisitions, `no request before the read`).toBe(0)
        await outer[read]()
        await settle()
        expect(counts.acquisitions, `the read requests data`).toBeGreaterThan(0)
        expect(outer.status).toBe(`ready`)
      } finally {
        await outer.cleanup()
        await source.cleanup()
      }
    })
  }
})

/**
 * ## A deferring live query is not a subscriber of its sources
 *
 * Adapters read a source Collection's `subscriberCount` and
 * `subscribers:change` as a request for live data: Query Collection
 * resubscribes its observers, which can refetch. A live-query Collection that
 * defers asks for no data, so it does not count there. It still keeps its
 * source Collections from garbage collection, because it reads their rows.
 * Its first subscriber or preload makes it count.
 */
describe(`a deferring live query is not a subscriber of its sources`, () => {
  for (const state of [`eager-running`, `on-demand-running`] as const) {
    it(`${state}: counts only once a subscriber asks for data`, async () => {
      const { collection: source } = makeSource(state)
      const { outer } = makeLiveQuery(source, `all`, 1)
      const counts: Array<number> = []
      const stop = source.on(`subscribers:change`, ({ subscriberCount }) =>
        counts.push(subscriberCount),
      )
      let subscription: { unsubscribe: () => void } | undefined
      try {
        outer.startSyncImmediate()
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(source.subscriberCount, `while deferring`).toBe(0)
        expect(counts, `no change event while deferring`).toEqual([])
        expect(source.status, `kept from garbage collection`).not.toBe(
          `cleaned-up`,
        )
        subscription = outer.subscribeChanges(() => {})
        await settle()
        expect(source.subscriberCount, `after the first subscriber`).toBe(1)
        expect(counts).toEqual([1])
        subscription.unsubscribe()
        subscription = undefined
        await settle()
        expect(
          counts.at(-1),
          `the live query keeps its claim until cleanup`,
        ).toBe(1)
      } finally {
        stop()
        subscription?.unsubscribe()
        await outer.cleanup()
        await source.cleanup()
      }
    })
  }
})

/**
 * ## A request that arrives while a source subscription is created
 *
 * A live-query Collection decides that a source subscription defers when it
 * creates it. Creating it can run user code: subscribing to an inner
 * live-query Collection starts that Collection, whose status handlers run
 * before the outer subscription returns. If such a handler preloads or
 * subscribes to the outer live query, the request arrives after the decision
 * but before the outer one listens for it. It still resumes the source.
 */
describe(`a request that arrives while a source subscription is created`, () => {
  for (const request of [`preload`, `subscribe`] as const) {
    it(`an inner status handler that ${request}s the outer live query resumes it`, async () => {
      const { collection: source, counts } = makeSource(`on-demand-idle`)
      const { outer, collections } = makeLiveQuery(source, `window`, 2)
      const inner = collections[1]!
      let subscription: { unsubscribe: () => void } | undefined
      let requested = false
      const stop = inner.on(`status:change`, () => {
        if (requested) return
        requested = true
        if (request === `preload`) void outer.preload()
        else subscription = outer.subscribeChanges(() => {})
      })
      try {
        outer.startSyncImmediate()
        await settle()
        expect(requested, `the handler ran`).toBe(true)
        expect(counts.acquisitions, `acquisition attempts`).toBeGreaterThan(0)
        expect(outer.status).toBe(`ready`)
        expect(outer.toArray.map((row) => row.id)).toEqual(EXPECTED_IDS.window)
      } finally {
        stop()
        subscription?.unsubscribe()
        for (const collection of collections) await collection.cleanup()
        await source.cleanup()
      }
    })
  }
})
