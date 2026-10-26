// Ordinary examples of the persisted-readiness contract: concrete restore,
// failure, deadline, and handoff cases asserted against literal values. The
// readiness law and its model are owned by persisted-readiness-oracle.test.ts.
import { describe, expect, it, vi } from 'vitest'
import {
  DbClient,
  PERSISTED_READINESS,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryObserver,
  eq,
  getPersistedReadinessSource,
  waitForPersistedInitialRender,
} from '@tanstack/db'
import { persistedCollectionOptions } from '../src/index.js'
import {
  checkWithCleanup,
  deferred,
  recordingAdapter,
  source,
} from './persisted-readiness-support.js'
import type { Row } from './persisted-readiness-support.js'

describe(`persisted-readiness oracle`, () => {
  for (const rows of [[], [{ id: `one`, value: `restored` }]]) {
    it(`waits for ${rows.length ? `nonempty` : `empty`} local restore without waiting for upstream`, async () => {
      const fixture = recordingAdapter(rows)
      const persisted = source(`local-${rows.length}`, fixture.adapter, true)
      const query = createLiveQueryCollection({
        query: (q) => q.from({ row: persisted }),
      })
      const observer = createLiveQueryObserver(query)
      const observedPersistedStatuses: Array<string> = []
      const unsubscribe = observer.subscribe(() => {
        observedPersistedStatuses.push(observer.getSnapshot().persistedStatus)
      })
      await checkWithCleanup(async () => {
        expect(observer.getSnapshot().persistedStatus).toBe(`loading`)
        expect(observer.getSnapshot().isPersistedReady).toBe(false)

        fixture.load.resolve()
        await vi.waitFor(() => {
          const snapshot = observer.getSnapshot()
          expect(snapshot.persistedStatus).toBe(`ready`)
          expect(snapshot.isPersistedReady).toBe(true)
          expect(snapshot.status).toBe(`loading`)
          expect(snapshot.data).toMatchObject(rows)
        })
        await observer.preloadForInitialRender()
        expect(observer.getSnapshot().data).toMatchObject(rows)
        expect(observedPersistedStatuses).toContain(`ready`)
      }, [
        unsubscribe,
        () => observer.dispose(),
        () => query.cleanup(),
        () => persisted.cleanup(),
      ])
    })
  }

  it(`requires every joined source to opt in and finish its own restore`, async () => {
    const left = recordingAdapter([{ id: `one`, value: `left` }])
    const right = recordingAdapter([{ id: `one`, value: `right` }])
    const sourceA = source(`local-join-left`, left.adapter, true)
    const sourceB = source(`local-join-right`, right.adapter, true)
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ a: sourceA })
          .join({ b: sourceB }, ({ a, b }) => eq(a.id, b.id)),
    })
    const observer = createLiveQueryObserver(query)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      const initialRenderWait = observer.preloadForInitialRender()
      left.load.resolve()
      await vi.waitFor(() => expect(sourceA.has(`one`)).toBe(true))
      expect(observer.getSnapshot().persistedStatus).toBe(`loading`)

      right.load.resolve()
      await initialRenderWait
      expect(observer.getSnapshot().persistedStatus).toBe(`ready`)
      expect(observer.getSnapshot().data).toHaveLength(1)
    }, [
      unsubscribe,
      () => observer.dispose(),
      () => query.cleanup(),
      () => sourceA.cleanup(),
      () => sourceB.cleanup(),
    ])
  })

  it(`follows a live-query source to its underlying persisted Collection`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `local` }])
    const persisted = source(`local-nested`, fixture.adapter, true)
    const inner = createLiveQueryCollection({
      query: (q) => q.from({ row: persisted }),
    })
    const outer = createLiveQueryCollection({
      query: (q) => q.from({ row: inner }),
    })
    const observer = createLiveQueryObserver(outer)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      expect(observer.getSnapshot().persistedStatus).toBe(`loading`)
      fixture.load.resolve()
      await vi.waitFor(() => {
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`)
        expect(observer.getSnapshot().data).toMatchObject([
          { id: `one`, value: `local` },
        ])
      })
    }, [
      unsubscribe,
      () => observer.dispose(),
      () => outer.cleanup(),
      () => inner.cleanup(),
      () => persisted.cleanup(),
    ])
  })

  it(`does not claim persisted readiness when one query source did not opt in`, async () => {
    const left = recordingAdapter([{ id: `one`, value: `left` }])
    const right = recordingAdapter([{ id: `one`, value: `right` }])
    const sourceA = source(`local-mixed-left`, left.adapter, true)
    const sourceB = source(`local-mixed-right`, right.adapter, false)
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ a: sourceA })
          .join({ b: sourceB }, ({ a, b }) => eq(a.id, b.id)),
    })
    const observer = createLiveQueryObserver(query)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      left.load.resolve()
      right.load.resolve()
      await vi.waitFor(() =>
        expect(observer.getSnapshot().data).toHaveLength(1),
      )
      expect(observer.getSnapshot().persistedStatus).toBe(`unavailable`)
      expect(observer.getSnapshot().isPersistedReady).toBe(false)
    }, [
      unsubscribe,
      () => observer.dispose(),
      () => query.cleanup(),
      () => sourceA.cleanup(),
      () => sourceB.cleanup(),
    ])
  })

  it(`reports the exact persisted restore failure without claiming readiness`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `restored` }])
    const persisted = source(`local-failure`, fixture.adapter, true)
    const query = createLiveQueryCollection({
      query: (q) => q.from({ row: persisted }),
    })
    const observer = createLiveQueryObserver(query)
    const unsubscribe = observer.subscribe(() => {})
    const failure = new Error(`local read failed`)
    await checkWithCleanup(async () => {
      fixture.load.reject(failure)
      await vi.waitFor(() => {
        const snapshot = observer.getSnapshot()
        expect(snapshot.persistedStatus).toBe(`error`)
        expect(snapshot.persistedError).toBe(failure)
        expect(snapshot.isPersistedReady).toBe(false)
      })
    }, [
      unsubscribe,
      () => observer.dispose(),
      () => query.cleanup(),
      () => persisted.cleanup(),
    ])
  })

  it(`rejects network-first initial rendering for on-demand persistence`, () => {
    const fixture = recordingAdapter([])
    expect(() =>
      persistedCollectionOptions<Row, string>({
        id: `local-on-demand`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        initialRender: {
          strategy: `network-first`,
          networkTimeoutMs: 100,
        },
        persistence: { adapter: fixture.adapter },
      }),
    ).toThrow(/network-first.*eager/i)
  })

  it(`defaults the network-first fallback deadline to three seconds`, () => {
    const fixture = recordingAdapter([])
    const config = persistedCollectionOptions<Row, string>({
      id: `default-network-deadline`,
      getKey: (row) => row.id,
      persistence: { adapter: fixture.adapter },
      initialRender: { strategy: `network-first` },
    })
    expect(getPersistedReadinessSource(config)?.networkTimeoutMs).toBe(3_000)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    `rejects an invalid network timeout (%s)`,
    (networkTimeoutMs) => {
      const fixture = recordingAdapter([])
      expect(() =>
        persistedCollectionOptions<Row, string>({
          id: `invalid-network-deadline`,
          getKey: (row) => row.id,
          persistence: { adapter: fixture.adapter },
          initialRender: { strategy: `network-first`, networkTimeoutMs },
        }),
      ).toThrow(/networkTimeoutMs/)
    },
  )

  it(`settles a local-only persisted Collection after its eager restore`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `local` }])
    const persisted = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `local-only-ready`,
        getKey: (row) => row.id,
        persistence: { adapter: fixture.adapter },
        initialRender: {
          strategy: `network-first`,
          networkTimeoutMs: 0,
        },
      }),
    )
    const observer = createLiveQueryObserver(persisted)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      expect(observer.getSnapshot().persistedStatus).toBe(`loading`)
      fixture.load.resolve()
      await vi.waitFor(() => {
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`)
        expect(observer.getSnapshot().data).toMatchObject([
          { id: `one`, value: `local` },
        ])
      })
    }, [unsubscribe, () => observer.dispose(), () => persisted.cleanup()])
  })

  it(`does not mistake an SSR seed for local restore and hands off to local rows`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `local` }])
    const persisted = source(`local-ssr`, fixture.adapter, true)
    const query = createLiveQueryCollection({
      query: (q) => q.from({ row: persisted }),
    })
    const client = new DbClient()
    client.hydrate({
      collections: [],
      liveQueries: [
        {
          queryHash: `local-ssr-query`,
          dehydratedAt: 1,
          snapshot: {
            rows: [{ key: `stale`, value: { id: `stale`, value: `server` } }],
          },
        },
      ],
    })
    const observer = createLiveQueryObserver(query, {
      client,
      queryHash: `local-ssr-query`,
      mode: `wholesale`,
    })
    let unsubscribe: (() => void) | undefined
    await checkWithCleanup(async () => {
      expect(observer.getSnapshot()).toMatchObject({
        status: `ready`,
        persistedStatus: `loading`,
        isPersistedReady: false,
        data: [{ id: `stale`, value: `server` }],
      })
      unsubscribe = observer.subscribe(() => {})
      fixture.load.resolve()
      await vi.waitFor(() => {
        const snapshot = observer.getSnapshot()
        expect(snapshot.persistedStatus).toBe(`ready`)
        expect(snapshot.status).toBe(`loading`)
        expect(snapshot.data).toMatchObject([{ id: `one`, value: `local` }])
      })
    }, [
      () => unsubscribe?.(),
      () => observer.dispose(),
      () => query.cleanup(),
      () => persisted.cleanup(),
    ])
  })

  it(`does not publish a stale restore after cleanup and restart`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `local` }])
    fixture.load.resolve()
    const firstRead = deferred<void>()
    const secondRead = deferred<void>()
    const loadResumeSnapshot = fixture.adapter.loadResumeSnapshot
    let baselineReads = 0
    let firstReadReturned = false
    // The obsolete sync run returns a distinct row, so a leaked publication
    // remains observable even after the replacement restore completes.
    fixture.adapter.loadResumeSnapshot = async (id, options) => {
      if (options?.includeRows !== false) {
        const read = ++baselineReads
        await (read === 1 ? firstRead.promise : secondRead.promise)
        const snapshot = await loadResumeSnapshot(id, options)
        if (read === 1) {
          firstReadReturned = true
          return {
            ...snapshot,
            rows: [{ key: `stale`, value: { id: `stale`, value: `obsolete` } }],
          }
        }
        return snapshot
      }
      return loadResumeSnapshot(id, options)
    }
    const persisted = source(`local-restart`, fixture.adapter, true)
    const observer = createLiveQueryObserver(persisted)
    const observedData: Array<unknown> = []
    const unsubscribe = observer.subscribe(() => {
      observedData.push(observer.getSnapshot().data)
    })
    await checkWithCleanup(async () => {
      await vi.waitFor(() => expect(baselineReads).toBe(1))
      await persisted.cleanup()
      persisted.startSyncImmediate()
      firstRead.resolve()
      await vi.waitFor(() => expect(baselineReads).toBe(2))
      await vi.waitFor(() => expect(firstReadReturned).toBe(true))
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(observer.getSnapshot().persistedStatus).toBe(`loading`)
      expect(observer.getSnapshot().data).toEqual([])

      secondRead.resolve()
      await vi.waitFor(() => {
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`)
        expect(persisted.has(`one`)).toBe(true)
      })
      expect(observedData).not.toContainEqual(
        expect.arrayContaining([expect.objectContaining({ id: `stale` })]),
      )
    }, [
      () => firstRead.resolve(),
      () => secondRead.resolve(),
      unsubscribe,
      () => observer.dispose(),
      () => persisted.cleanup(),
    ])
  })

  it(`offers an initial-render fallback without changing preload's Collection readiness boundary`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `local` }])
    const persisted = source(`local-suspense`, fixture.adapter, true)
    const query = createLiveQueryCollection({
      query: (q) => q.from({ row: persisted }),
    })
    const observer = createLiveQueryObserver(query)
    let collectionPreloadSettled = false
    await checkWithCleanup(async () => {
      const collectionPreload = observer.preload()
      void collectionPreload.then(
        () => (collectionPreloadSettled = true),
        () => (collectionPreloadSettled = true),
      )
      const initialRenderWait = observer.preloadForInitialRender()
      fixture.load.resolve()
      await initialRenderWait
      expect(observer.getSnapshot()).toMatchObject({
        status: `loading`,
        persistedStatus: `ready`,
        data: [{ id: `one`, value: `local` }],
      })
      expect(collectionPreloadSettled).toBe(false)
    }, [
      () => observer.dispose(),
      () => query.cleanup(),
      () => persisted.cleanup(),
    ])
  })

  it(`keeps the initial render gated until the network-first deadline`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `persisted` }])
    let markCollectionReady!: () => void
    const persisted = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `network-first-deadline`,
        getKey: (row) => row.id,
        persistence: { adapter: fixture.adapter },
        initialRender: {
          strategy: `network-first`,
          networkTimeoutMs: 100,
        },
        sync: {
          sync: ({ markReady }) => {
            markCollectionReady = markReady
            return {}
          },
        },
      }),
    )
    const observer = createLiveQueryObserver(persisted)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      fixture.load.resolve()
      await vi.waitFor(() =>
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`),
      )

      vi.useFakeTimers()
      try {
        let settled = false
        const initialRender = observer.preloadForInitialRender()
        void initialRender.then(() => {
          settled = true
        })
        await Promise.resolve()
        expect(settled).toBe(false)

        await vi.advanceTimersByTimeAsync(99)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await initialRender
        expect(settled).toBe(true)
        expect(observer.getSnapshot().data).toMatchObject([
          { id: `one`, value: `persisted` },
        ])
        expect(persisted.status).toBe(`loading`)
      } finally {
        vi.useRealTimers()
      }
      markCollectionReady()
      await vi.waitFor(() => expect(persisted.status).toBe(`ready`))
    }, [unsubscribe, () => observer.dispose(), () => persisted.cleanup()])
  })

  it(`uses Collection readiness before the fallback deadline`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `persisted` }])
    let markCollectionReady!: () => void
    const persisted = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `network-first-success`,
        getKey: (row) => row.id,
        persistence: { adapter: fixture.adapter },
        initialRender: {
          strategy: `network-first`,
          networkTimeoutMs: 1_000,
        },
        sync: {
          sync: ({ markReady }) => {
            markCollectionReady = markReady
            return {}
          },
        },
      }),
    )
    const observer = createLiveQueryObserver(persisted)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      fixture.load.resolve()
      await vi.waitFor(() =>
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`),
      )
      let settled = false
      const initialRender = observer.preloadForInitialRender()
      void initialRender.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      markCollectionReady()
      await initialRender
      expect(settled).toBe(true)
      expect(persisted.status).toBe(`ready`)
    }, [unsubscribe, () => observer.dispose(), () => persisted.cleanup()])
  })

  it(`falls back to persisted data as soon as the network fails`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `persisted` }])
    const networkFailure = new Error(`network failed`)
    let markNetworkError!: (error: unknown) => void
    const persisted = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `network-first-failure`,
        getKey: (row) => row.id,
        persistence: { adapter: fixture.adapter },
        initialRender: {
          strategy: `network-first`,
          networkTimeoutMs: 1_000,
        },
        sync: {
          sync: ({ markError }) => {
            markNetworkError = markError
            return {}
          },
        },
      }),
    )
    const observer = createLiveQueryObserver(persisted)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      fixture.load.resolve()
      await vi.waitFor(() =>
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`),
      )
      let settled = false
      const initialRender = observer.preloadForInitialRender()
      void initialRender.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      markNetworkError(networkFailure)
      await initialRender
      expect(settled).toBe(true)
      expect(persisted.status).toBe(`error`)
      expect(observer.getSnapshot().data).toMatchObject([
        { id: `one`, value: `persisted` },
      ])
    }, [unsubscribe, () => observer.dispose(), () => persisted.cleanup()])
  })

  for (const rows of [[], [{ id: `one`, value: `persisted` }]]) {
    for (const failureBeforeRestore of [false, true]) {
      it(`uses a ${rows.length ? `nonempty` : `empty`} restore after a client stream fails ${failureBeforeRestore ? `before` : `after`} restore`, async () => {
        const fixture = recordingAdapter(rows)
        const persisted = source(
          `stream-failure-${rows.length}-${failureBeforeRestore}`,
          fixture.adapter,
          true,
          60_000,
        )
        const query = createLiveQueryCollection({
          query: (q) => q.from({ row: persisted }),
        })
        const client = new DbClient()
        const queryHash = `stream-failure-${rows.length}-${failureBeforeRestore}`
        const stream = deferred<{ rows: Array<never> }>()
        void client
          ._registerLiveQuery(queryHash, stream.promise)
          .catch(() => {})
        const observer = createLiveQueryObserver(query, {
          client,
          queryHash,
          mode: `wholesale`,
        })
        const unsubscribe = observer.subscribe(() => {})
        await checkWithCleanup(async () => {
          let settlement: `pending` | `resolved` | `rejected` = `pending`
          const initialRender = observer.preloadForInitialRender()
          void initialRender.then(
            () => (settlement = `resolved`),
            () => (settlement = `rejected`),
          )
          const rejectStream = async () => {
            stream.reject(new Error(`client stream failed`))
            await stream.promise.catch(() => {})
          }

          if (failureBeforeRestore) {
            await rejectStream()
            expect(settlement).toBe(`pending`)
            fixture.load.resolve()
          } else {
            fixture.load.resolve()
            await vi.waitFor(() =>
              expect(observer.getSnapshot().persistedStatus).toBe(`ready`),
            )
            expect(settlement).toBe(`pending`)
            await rejectStream()
          }

          await initialRender
          expect(settlement).toBe(`resolved`)
          expect(observer.isInitialRenderReady()).toBe(true)
          expect(observer.getSnapshot().data).toMatchObject(rows)
        }, [
          () => fixture.load.resolve(),
          unsubscribe,
          () => observer.dispose(),
          () => query.cleanup(),
          () => persisted.cleanup(),
        ])
      })
    }
  }

  it(`uses a completed restore when the client stream failed before the observer started`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `persisted` }])
    const persisted = source(
      `preexisting-stream-failure`,
      fixture.adapter,
      true,
      60_000,
    )
    const query = createLiveQueryCollection({
      query: (q) => q.from({ row: persisted }),
    })
    const client = new DbClient()
    const queryHash = `preexisting-stream-failure`
    const stream = deferred<{ rows: Array<never> }>()
    const registered = client._registerLiveQuery(queryHash, stream.promise)
    stream.reject(new Error(`client stream failed`))
    await expect(registered).rejects.toThrow(`client stream failed`)

    const observer = createLiveQueryObserver(query, {
      client,
      queryHash,
      mode: `wholesale`,
    })
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      let settled = false
      const initialRender = observer.preloadForInitialRender()
      void initialRender.then(
        () => {
          settled = true
        },
        () => {},
      )
      fixture.load.resolve()
      await vi.waitFor(() =>
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`),
      )
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 1_000 })
      await initialRender
      expect(observer.getSnapshot().data).toMatchObject([
        { id: `one`, value: `persisted` },
      ])
    }, [
      () => fixture.load.resolve(),
      unsubscribe,
      () => observer.dispose(),
      () => query.cleanup(),
      () => persisted.cleanup(),
    ])
  })

  for (const failureMode of [`markError`, `throw`] as const) {
    it(`publishes restored query rows when ${failureMode} precedes the persisted read`, async () => {
      const fixture = recordingAdapter([{ id: `one`, value: `persisted` }])
      const networkFailure = new Error(`network failed before restore`)
      let markNetworkError!: (error: unknown) => void
      let networkSyncStarted = false
      const persisted = createCollection(
        persistedCollectionOptions<Row, string>({
          id: `network-failure-before-restore`,
          getKey: (row) => row.id,
          persistence: { adapter: fixture.adapter },
          initialRender: {
            strategy: `network-first`,
            networkTimeoutMs: 1_000,
          },
          sync: {
            sync: ({ markError }) => {
              networkSyncStarted = true
              if (failureMode === `throw`) throw networkFailure
              markNetworkError = markError
              return {}
            },
          },
        }),
      )
      const query = createLiveQueryCollection({
        query: (q) => q.from({ row: persisted }),
      })
      const observer = createLiveQueryObserver(query)
      const unsubscribe = observer.subscribe(() => {})
      await checkWithCleanup(async () => {
        const initialRenderWait = observer.preloadForInitialRender()
        await vi.waitFor(() => expect(networkSyncStarted).toBe(true))
        if (failureMode === `markError`) markNetworkError(networkFailure)
        expect(observer.getSnapshot()).toMatchObject({
          persistedStatus: `loading`,
          data: [],
        })

        fixture.load.resolve()
        await initialRenderWait
        expect(persisted.has(`one`)).toBe(true)
        expect(observer.getSnapshot()).toMatchObject({
          status: `error`,
          persistedStatus: `ready`,
          data: [{ id: `one`, value: `persisted` }],
        })
      }, [
        () => fixture.load.resolve(),
        unsubscribe,
        () => observer.dispose(),
        () => query.cleanup(),
        () => persisted.cleanup(),
      ])
    })
  }

  it(`does not hide a query failure behind an available persisted source`, async () => {
    const persisted = createCollection<Row>({
      id: `query-failure-is-not-network-failure`,
      getKey: (row) => row.id,
      sync: { sync: () => ({}) },
    })
    Object.defineProperty(persisted.config, PERSISTED_READINESS, {
      value: {
        networkTimeoutMs: 60_000,
        getOrStartNetworkDeadline: () => Date.now() + 60_000,
        getSnapshot: () => ({ status: `ready` }),
        subscribe: () => () => {},
        waitForInitialRender: waitForPersistedInitialRender,
      },
    })
    const failure = new Error(`query failed independently of its source`)
    const preload = vi.spyOn(persisted, `preload`).mockRejectedValue(failure)
    const observer = createLiveQueryObserver(persisted)
    await checkWithCleanup(async () => {
      await expect(observer.preloadForInitialRender()).rejects.toBe(failure)
      expect(observer.isInitialRenderReady()).toBe(false)
    }, [
      () => observer.dispose(),
      () => preload.mockRestore(),
      () => persisted.cleanup(),
    ])
  })

  it(`does not use persisted fallback when a derived query and client stream both fail`, async () => {
    const queryFailure = new Error(`derived query failed`)
    const streamFailure = new Error(`client stream failed`)
    const sourceCollection = createCollection<Row>({
      id: `query-and-stream-failure-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              throw queryFailure
            },
          }
        },
      },
    })
    Object.defineProperty(sourceCollection.config, PERSISTED_READINESS, {
      value: {
        networkTimeoutMs: 60_000,
        getOrStartNetworkDeadline: () => Date.now() + 60_000,
        getSnapshot: () => ({ status: `ready` }),
        subscribe: () => () => {},
        waitForInitialRender: waitForPersistedInitialRender,
      },
    })
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: sourceCollection })
          .where(({ row }) => eq(row.value, `persisted`)),
    })
    const client = new DbClient()
    const queryHash = `query-and-stream-failure`
    const stream = deferred<{ rows: Array<never> }>()
    const observer = createLiveQueryObserver(query, {
      client,
      queryHash,
      mode: `wholesale`,
    })
    await checkWithCleanup(async () => {
      await expect(query.preload()).rejects.toBe(queryFailure)
      expect(sourceCollection.status).toBe(`ready`)
      expect(query.status).toBe(`error`)

      void client._registerLiveQuery(queryHash, stream.promise).catch(() => {})
      const initialRender = observer.preloadForInitialRender()
      stream.reject(streamFailure)
      await expect(initialRender).rejects.toBe(streamFailure)
      expect(observer.isInitialRenderReady()).toBe(false)
    }, [
      () => stream.reject(streamFailure),
      () => observer.dispose(),
      () => query.cleanup(),
      () => sourceCollection.cleanup(),
    ])
  })

  it(`uses the longest network deadline for a joined query`, async () => {
    const left = recordingAdapter([{ id: `one`, value: `left` }])
    const right = recordingAdapter([{ id: `one`, value: `right` }])
    const sourceA = source(`deadline-left`, left.adapter, true, 50)
    const sourceB = source(`deadline-right`, right.adapter, true, 100)
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ a: sourceA })
          .join({ b: sourceB }, ({ a, b }) => eq(a.id, b.id)),
    })
    const observer = createLiveQueryObserver(query)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      left.load.resolve()
      right.load.resolve()
      await vi.waitFor(() =>
        expect(observer.getSnapshot().persistedStatus).toBe(`ready`),
      )
      vi.useFakeTimers()
      try {
        let settled = false
        const initialRender = observer.preloadForInitialRender()
        void initialRender.then(() => {
          settled = true
        })
        await vi.advanceTimersByTimeAsync(50)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(50)
        await initialRender
        expect(observer.getSnapshot().data).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    }, [
      unsubscribe,
      () => observer.dispose(),
      () => query.cleanup(),
      () => sourceA.cleanup(),
      () => sourceB.cleanup(),
    ])
  })

  it(`waits for restore after the deadline instead of rendering incomplete data`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `persisted` }])
    const persisted = source(
      `late-persisted-restore`,
      fixture.adapter,
      true,
      100,
    )
    const observer = createLiveQueryObserver(persisted)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      vi.useFakeTimers()
      try {
        let settled = false
        const initialRender = observer.preloadForInitialRender()
        void initialRender.then(() => {
          settled = true
        })
        await vi.advanceTimersByTimeAsync(100)
        expect(settled).toBe(false)
        expect(observer.getSnapshot().persistedStatus).toBe(`loading`)

        fixture.load.resolve()
        await initialRender
        expect(observer.getSnapshot()).toMatchObject({
          persistedStatus: `ready`,
          data: [{ id: `one`, value: `persisted` }],
        })
      } finally {
        vi.useRealTimers()
      }
    }, [
      () => fixture.load.resolve(),
      unsubscribe,
      () => observer.dispose(),
      () => persisted.cleanup(),
    ])
  })

  it(`rejects an initial-render wait and clears its deadline on disposal`, async () => {
    const fixture = recordingAdapter([])
    const persisted = source(
      `disposed-initial-render`,
      fixture.adapter,
      true,
      100,
    )
    const observer = createLiveQueryObserver(persisted)
    await checkWithCleanup(async () => {
      vi.useFakeTimers()
      try {
        const initialRender = observer.preloadForInitialRender()
        const rejected = expect(initialRender).rejects.toThrow(/disposed/i)
        expect(vi.getTimerCount()).toBeGreaterThan(0)
        observer.dispose()
        await rejected
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    }, [
      () => fixture.load.resolve(),
      () => observer.dispose(),
      () => persisted.cleanup(),
    ])
  })

  it(`keeps the network preload boundary for an unconfigured source`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `persisted` }])
    const persisted = source(`unconfigured-network`, fixture.adapter, false)
    const observer = createLiveQueryObserver(persisted)
    const unsubscribe = observer.subscribe(() => {})
    await checkWithCleanup(async () => {
      fixture.load.resolve()
      await vi.waitFor(() => expect(persisted.has(`one`)).toBe(true))
      let settled = false
      const initialRender = observer.preloadForInitialRender()
      void initialRender.then(
        () => {
          settled = true
        },
        () => {},
      )
      await Promise.resolve()
      expect(observer.getSnapshot().persistedStatus).toBe(`unavailable`)
      expect(settled).toBe(false)
    }, [unsubscribe, () => observer.dispose(), () => persisted.cleanup()])
  })

  it(`waits for a new query to materialize an already restored source`, async () => {
    const fixture = recordingAdapter([{ id: `one`, value: `local` }])
    const persisted = source(`local-already-restored`, fixture.adapter, true)
    const sourceObserver = createLiveQueryObserver(persisted)
    const unsubscribeSource = sourceObserver.subscribe(() => {})
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    let queryObserver: ReturnType<typeof createLiveQueryObserver> | undefined
    await checkWithCleanup(async () => {
      fixture.load.resolve()
      await vi.waitFor(() =>
        expect(sourceObserver.getSnapshot().persistedStatus).toBe(`ready`),
      )
      query = createLiveQueryCollection({
        query: (q) => q.from({ row: persisted }),
      })
      queryObserver = createLiveQueryObserver(query)
      await queryObserver.preloadForInitialRender()
      expect(queryObserver.getSnapshot()).toMatchObject({
        persistedStatus: `ready`,
        data: [{ id: `one`, value: `local` }],
      })
    }, [
      () => queryObserver?.dispose(),
      () => query?.cleanup(),
      unsubscribeSource,
      () => sourceObserver.dispose(),
      () => persisted.cleanup(),
    ])
  })
})
