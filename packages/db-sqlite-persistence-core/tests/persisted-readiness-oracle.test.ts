import {
  BTreeIndex,
  DbClient,
  PERSISTED_READINESS,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryObserver,
  eq,
  getPersistedReadinessSource,
  liveQueryCollectionOptions,
  waitForPersistedInitialRender,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { persistedCollectionOptions } from '../src/index.js'
import type { SyncConfig } from '@tanstack/db'
import type { PersistedTx, PersistenceAdapter } from '../src/index.js'

type Row = { id: string; value: string }
type ModelOutcome = `loading` | `ready` | `error`
type ModelSource = {
  optedIn: boolean
  outcome: ModelOutcome
  error: unknown
}

function expectedPersistedSnapshot(sources: ReadonlyArray<ModelSource>) {
  if (sources.some((entry) => !entry.optedIn)) {
    return { status: `unavailable`, error: undefined }
  }
  const failed = sources.find((entry) => entry.outcome === `error`)
  if (failed) return { status: `error`, error: failed.error }
  return {
    status: sources.some((entry) => entry.outcome === `loading`)
      ? `loading`
      : `ready`,
    error: undefined,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function recordingAdapter(rows: ReadonlyArray<Row>) {
  const load = deferred<void>()
  const adapter: PersistenceAdapter = {
    loadSubset: async () => {
      await load.promise
      return rows.map((value) => ({ key: value.id, value }))
    },
    loadResumeSnapshot: async (_id, options) => {
      if (options?.includeRows !== false) await load.promise
      return {
        rows:
          options?.includeRows === false
            ? []
            : rows.map((value) => ({ key: value.id, value })),
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }
    },
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  return { adapter, load }
}

function source(
  id: string,
  adapter: PersistenceAdapter,
  optIn: boolean,
  networkTimeoutMs = 0,
) {
  return createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence: { adapter },
      ...(optIn
        ? {
            initialRender: {
              strategy: `network-first` as const,
              networkTimeoutMs,
            },
          }
        : {}),
      // Upstream never declares Collection readiness. Local restore is a
      // separately observable boundary even while this stays loading.
      sync: { sync: () => ({}) },
    }),
  )
}

async function checkWithCleanup(
  check: () => Promise<void> | void,
  cleanups: ReadonlyArray<() => Promise<unknown> | unknown>,
): Promise<void> {
  let hasPrimaryFailure = false
  let primaryFailure: unknown
  try {
    await check()
  } catch (error) {
    hasPrimaryFailure = true
    primaryFailure = error
  }

  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (hasPrimaryFailure) {
    if (cleanupFailures.length) {
      throw new AggregateError(
        [primaryFailure, ...cleanupFailures],
        `Persisted-readiness check and cleanup both failed`,
        { cause: primaryFailure },
      )
    }
    throw primaryFailure
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  if (cleanupFailures.length > 1) {
    throw new AggregateError(
      cleanupFailures,
      `Persisted-readiness cleanup failed`,
    )
  }
}

/**
 * # When may a query render its restored data?
 *
 * The independent status rule is an all-source conjunction: a query is persisted-ready
 * only after every eager persisted source opted in and successfully completed
 * its restore in the current sync run. A source that opts out makes the
 * query unavailable for this signal. A failed restore reports that exact
 * failure. Neither an empty persisted database nor a pending network source
 * changes the rule. Initial rendering prefers upstream-signaled Collection
 * readiness until the longest opted-in source deadline, then permits only
 * completed restoration.
 * Network failure permits earlier fallback without stopping sync. A failed
 * client query stream is a network failure; a derived-query failure is not.
 * If the stream failure precedes restore, the fallback must include the
 * restored query rows. An empty restore is complete data, not missing data.
 * The production driver holds each adapter's persisted read and
 * observes the real persisted wrapper, Collection, live query, and observer.
 *
 * Checkpoints are before persisted reads settle and after each controlled
 * settlement. The row assertion prevents a status-only false green; the empty
 * case prevents inferring readiness from row count. The SSR handoff and
 * framework scheduling paths have separate focused witnesses below and in
 * their packages. This owner does not claim native SQLite, replacement client
 * records during the wait, or arbitrary provider/network histories.
 *
 * Audit: ORC-001/002 use the approved all-source rule and the independent
 * expectedPersistedSnapshot model. ORC-003/005 are the finite outcome grammar,
 * controlled persistence driver, and public snapshot checks. ORC-004/007/008
 * do not apply: the 36-case product is enumerated, not generated or stateful.
 * ORC-006: the pre-implementation observer lacked persistedStatus and
 * preloadForInitialRender; the deadline test also failed against the immediate
 * persisted-ready race. Before the early-error repair, the held-read witness
 * resolved initial rendering with an empty live query despite a durable row.
 * Before the client-stream repair, the four stream-failure cases rejected the
 * initial-render wait instead of exposing the completed persisted result.
 * A preexisting failed stream also left a fresh observer waiting for the
 * deadline after restore. The observer-start witness rejects that design.
 * An any-one-ready answer fails the joined half-ready checkpoint. A
 * nonempty-rows answer fails the empty-restore checkpoint. The combined
 * derived-query/client-stream failure rejects false local fallback. ORC-009 maps model
 * outcome `ready` to completed persisted restore; it is not Collection status.
 * ORC-010 preserves a primary mismatch and distinct cleanup failures through
 * checkWithCleanup. ORC-011 has no named shared-fault hypothesis requiring
 * another model formulation. ORC-012 records the bounded contract, driver,
 * wrong-answer checks, and uncovered histories here and in the coverage map.
 * It does not claim all network histories.
 * ORC-013: the joined half-ready snapshot rejects any-one-ready; the empty
 * restore rejects row-count readiness; the 99/100-ms deadline and 50/100-ms
 * joined deadlines reject early fallback; the restart witness rejects stale
 * public rows while the replacement read is held. ORC-014 does not apply to a
 * real-provider claim: this oracle explicitly ends at its controlled adapter.
 */
describe(`persisted-readiness oracle`, () => {
  it(`preserves a failed checkpoint and a secondary cleanup failure`, async () => {
    const mismatch = new Error(`wrong persisted status`)
    const cleanupFailure = new Error(`cleanup failed`)
    await expect(
      checkWithCleanup(() => {
        throw mismatch
      }, [
        () => {
          throw cleanupFailure
        },
      ]),
    ).rejects.toMatchObject({
      cause: mismatch,
      errors: [mismatch, cleanupFailure],
    })
  })

  it(`refines the finite two-source readiness model`, async () => {
    const outcomes: ReadonlyArray<ModelOutcome> = [`loading`, `ready`, `error`]
    let caseId = 0
    // Grammar: each source independently opts in or out and has one of the
    // three local outcomes. No network transition is needed to judge this
    // observer-level projection; real persistence histories are below.
    for (const leftOptedIn of [false, true]) {
      for (const rightOptedIn of [false, true]) {
        for (const leftOutcome of outcomes) {
          for (const rightOutcome of outcomes) {
            const id = caseId++
            const leftError = new Error(`left-${id}`)
            const rightError = new Error(`right-${id}`)
            const left = createCollection<Row>({
              id: `local-model-left-${id}`,
              getKey: (row) => row.id,
              sync: { sync: () => ({}) },
            })
            const right = createCollection<Row>({
              id: `local-model-right-${id}`,
              getKey: (row) => row.id,
              sync: { sync: () => ({}) },
            })
            if (leftOptedIn) {
              Object.defineProperty(left.config, PERSISTED_READINESS, {
                value: {
                  networkTimeoutMs: 0,
                  getOrStartNetworkDeadline: () => Date.now(),
                  getSnapshot: () =>
                    leftOutcome === `error`
                      ? { status: `error`, error: leftError }
                      : { status: leftOutcome },
                  subscribe: () => () => {},
                  waitForInitialRender: waitForPersistedInitialRender,
                },
              })
            }
            if (rightOptedIn) {
              Object.defineProperty(right.config, PERSISTED_READINESS, {
                value: {
                  networkTimeoutMs: 0,
                  getOrStartNetworkDeadline: () => Date.now(),
                  getSnapshot: () =>
                    rightOutcome === `error`
                      ? { status: `error`, error: rightError }
                      : { status: rightOutcome },
                  subscribe: () => () => {},
                  waitForInitialRender: waitForPersistedInitialRender,
                },
              })
            }
            const query = createLiveQueryCollection({
              query: (q) =>
                q
                  .from({ left })
                  .join({ right }, ({ left: a, right: b }) => eq(a.id, b.id)),
            })
            const observer = createLiveQueryObserver(query)
            await checkWithCleanup(() => {
              const expected = expectedPersistedSnapshot([
                {
                  optedIn: leftOptedIn,
                  outcome: leftOutcome,
                  error: leftError,
                },
                {
                  optedIn: rightOptedIn,
                  outcome: rightOutcome,
                  error: rightError,
                },
              ])
              expect(observer.getSnapshot(), `case ${id}`).toMatchObject({
                persistedStatus: expected.status,
                isPersistedReady: expected.status === `ready`,
                persistedError: expected.error,
              })
            }, [
              () => observer.dispose(),
              () => query.cleanup(),
              () => left.cleanup(),
              () => right.cleanup(),
            ])
          }
        }
      }
    }
    expect(caseId).toBe(36)
  })

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

  // The finite conjunction above has no transitions. This legal history gives
  // source A two sync runs while source B completes once. A's old restore cannot
  // satisfy the current-run conjunct after cleanup. The model needs only each
  // source's current restore outcome; it does not copy the wrapper's generations.
  // A fresh live query is created after restart because cleanup terminates the
  // old query. Its public snapshot and initial-render wait are the checkpoints.
  it(`waits for a restarted source after the other joined source restores`, async () => {
    const left = recordingAdapter([{ id: `one`, value: `left` }])
    const right = recordingAdapter([{ id: `one`, value: `right` }])
    left.load.resolve()
    const secondLeftRead = deferred<void>()
    const loadResumeSnapshot = left.adapter.loadResumeSnapshot
    let leftReads = 0
    left.adapter.loadResumeSnapshot = async (id, options) => {
      if (options?.includeRows !== false && ++leftReads === 2) {
        await secondLeftRead.promise
      }
      return loadResumeSnapshot(id, options)
    }
    const sourceA = source(`joined-restart-left`, left.adapter, true)
    const sourceB = source(`joined-restart-right`, right.adapter, true)
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    let observer: ReturnType<typeof createLiveQueryObserver> | undefined
    let unsubscribe: (() => void) | undefined
    await checkWithCleanup(async () => {
      sourceA.startSyncImmediate()
      sourceB.startSyncImmediate()
      await vi.waitFor(() => expect(leftReads).toBe(1))
      await vi.waitFor(() => expect(sourceA.has(`one`)).toBe(true))

      await sourceA.cleanup()
      sourceA.startSyncImmediate()
      await vi.waitFor(() => expect(leftReads).toBe(2))
      right.load.resolve()
      await vi.waitFor(() => expect(sourceB.has(`one`)).toBe(true))

      query = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ a: sourceA })
            .join({ b: sourceB }, ({ a, b }) => eq(a.id, b.id)),
      })
      observer = createLiveQueryObserver(query)
      unsubscribe = observer.subscribe(() => {})
      const model = [
        { optedIn: true, outcome: `loading` as ModelOutcome, error: undefined },
        { optedIn: true, outcome: `ready` as ModelOutcome, error: undefined },
      ]
      expect(observer.getSnapshot().persistedStatus).toBe(
        expectedPersistedSnapshot(model).status,
      )
      let initialRenderSettled = false
      const initialRenderWait = observer.preloadForInitialRender().then(() => {
        initialRenderSettled = true
      })
      await Promise.resolve()
      expect(initialRenderSettled).toBe(false)

      secondLeftRead.resolve()
      model[0]!.outcome = `ready`
      await initialRenderWait
      expect(observer.getSnapshot()).toMatchObject({
        persistedStatus: expectedPersistedSnapshot(model).status,
        data: [
          { a: { id: `one`, value: `left` }, b: { id: `one`, value: `right` } },
        ],
      })
    }, [
      () => secondLeftRead.resolve(),
      () => unsubscribe?.(),
      () => observer?.dispose(),
      () => query?.cleanup(),
      () => sourceA.cleanup(),
      () => sourceB.cleanup(),
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

/**
 * A persisted live-query Collection certifies its own completed result. Its
 * source Collections can have pending on-demand work without invalidating that
 * restored result. Authority: the completed query snapshot proposal in
 * query/live/ARCHITECTURE.md. This is a new opt-in law, not default publication.
 *
 * The independent model selects the previous completed result until every
 * current source and acquisition completes; only then does a full relational
 * recomputation replace it. A source error never makes partial rows complete.
 * The finite grammar crosses empty/nonempty restored and refreshed results,
 * a new unconfirmed database, both source-completion orders, and failure.
 * Removing any axis loses respectively the empty-result, cold-cache, last
 * participant, or error-retention boundary. Provider writes precede acquisition
 * fulfillment. Fulfilling a request before its applied rows is not legal.
 *
 * The unordered driver compares rows in key order and preserves every publication
 * boundary. A later-demand grammar also checks convergence after initial readiness.
 * This driver uses the real persisted wrapper, live-query engine and observer
 * with a controlled adapter. It does not claim native SQLite, browser scheduling,
 * arbitrary query rewrites, or persistent identity of Collection-valued includes.
 */
type SnapshotRow = Row & { joined?: string }
type SnapshotHistory = {
  restored: Array<SnapshotRow>
  confirmed: boolean
  final: Array<Row>
  removeParent: boolean
  cacheWindow: number
  parentFirst: boolean
  fail: boolean | `query`
  receiver?: `derived` | `peer`
  optimistic?: boolean
  later?: boolean
}

// Before successful coverage, the stored result wins as a whole. After it,
// compute the selected LEFT join directly from the two source arrays.
function expectedCompletedSnapshot(
  history: SnapshotHistory,
  completed: boolean,
  optimistic = history.optimistic ?? false,
  laterCompleted = false,
) {
  const rows = completed
    ? history.removeParent
      ? []
      : [
          {
            id: `parent`,
            value: `fresh`,
            joined: optimistic
              ? `optimistic`
              : history.final.find((row) => row.id === `parent`)?.value,
          },
        ]
    : history.restored
  return laterCompleted
    ? [...rows, { id: `later`, value: `new parent`, joined: `new child` }]
    : rows
}

async function observeCompletedSnapshot(history: SnapshotHistory) {
  type Controls = Parameters<SyncConfig<Row>[`sync`]>[0]
  let parentSync: Controls | undefined
  let childSync: Controls | undefined
  const acquisition = deferred<void>()
  let currentAcquisition = acquisition
  const mutation = deferred<void>()
  let rollback: (() => void) | undefined
  let acquired = 0
  const parents = createCollection<Row>({
    id: `snapshot-parents`,
    getKey: (row) => row.id,
    sync: {
      sync(params) {
        parentSync = params
      },
    },
  })
  const children = createCollection<Row>({
    id: `snapshot-children`,
    onUpdate: () => mutation.promise,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync(params) {
        childSync = params
        params.markReady()
        return {
          loadSubset() {
            acquired++
            return currentAcquisition.promise
          },
        }
      },
    },
  })
  children.createIndex((row) => row.id, { indexType: BTreeIndex })
  const committed: Array<PersistedTx> = []
  const restored = recordingAdapter(history.restored)
  restored.adapter.applyCommittedTx = (_id, tx) => {
    committed.push(tx)
    return Promise.resolve()
  }
  const originalResume = restored.adapter.loadResumeSnapshot
  restored.adapter.loadResumeSnapshot = async (...args) => ({
    ...(await originalResume(...args)),
    collectionMetadata: history.confirmed
      ? [
          {
            key: `live-query:confirmed`,
            value: { version: 1, offset: history.cacheWindow, limit: null },
          },
        ]
      : [],
  })
  const options = liveQueryCollectionOptions({
    id: `completed-snapshot`,
    snapshotPublication: `complete`,
    getKey: (row: SnapshotRow) => row.id,
    query: (q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.id, child.id),
        )
        .select(({ parent, child }) => ({
          id: parent.id,
          value: parent.value,
          joined: child.value,
        })),
  })
  const result = createCollection(
    persistedCollectionOptions({
      ...options,
      syncMode: `eager`,
      persistence: { adapter: restored.adapter },
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
    }),
  )
  const derived = history.receiver
    ? createLiveQueryCollection({
        query: (q) =>
          history.receiver === `peer`
            ? q
                .from({ saved: result })
                .leftJoin({ peer: parents }, ({ saved, peer }) =>
                  eq(saved.id, peer.id),
                )
                .select(({ saved }) => saved)
            : q.from({ saved: result }).select(({ saved }) => saved),
      })
    : undefined
  const received = derived ?? result
  const observer = derived
    ? createLiveQueryObserver(derived)
    : createLiveQueryObserver(result)
  const read = () =>
    [...received.values()]
      .map(({ id, value, joined }) => ({
        id,
        value,
        joined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  const publications: Array<Array<SnapshotRow>> = []
  const unsubscribe = observer.subscribe((changes) => {
    if (changes?.length) publications.push(read())
  })
  const expected = (
    complete: boolean,
    optimistic = history.optimistic ?? false,
    laterCompleted = false,
  ) =>
    expectedCompletedSnapshot(
      history,
      complete,
      optimistic,
      laterCompleted,
    ).map(({ id, value, joined }) => ({ id, value, joined }))
  await checkWithCleanup(async () => {
    restored.load.resolve()
    await vi.waitFor(() => expect(parentSync).toBeDefined())
    await vi.waitFor(() => expect(read()).toEqual(expected(false)))
    await vi.waitFor(() =>
      expect(
        getPersistedReadinessSource(result.config)!.getSnapshot().status,
      ).toBe(`ready`),
    )
    expect(observer.getSnapshot().isPersistedReady).toBe(
      history.receiver !== `peer` &&
        history.confirmed &&
        history.cacheWindow === 0,
    )
    expect(result.isReady()).toBe(false)
    parentSync!.begin()
    parentSync!.write({
      type: `insert`,
      value: { id: `parent`, value: `fresh` },
    })
    parentSync!.commit()
    await vi.waitFor(() => expect(acquired).toBeGreaterThan(0))
    childSync!.begin()
    childSync!.write({
      type: `insert`,
      value: { id: `parent`, value: `partial` },
    })
    childSync!.commit()
    expect(read()).toEqual(expected(false))
    const checkpoint = publications.length
    if (history.fail) {
      const failure = new Error(`source failed`)
      if (history.fail === `query`) acquisition.reject(failure)
      else parentSync!.markError(failure)
      await vi.waitFor(() => expect(result.status).toBe(`error`))
      expect(read()).toEqual(expected(false))
      let outcome: unknown = `pending`
      void observer.preloadForInitialRender().then(
        () => {
          outcome = `resolved`
        },
        () => {
          outcome = `rejected`
        },
      )
      const canFallback =
        history.fail !== `query` &&
        history.receiver !== `peer` &&
        history.confirmed &&
        history.cacheWindow === 0
      await vi.waitFor(() =>
        expect(outcome).toBe(canFallback ? `resolved` : `rejected`),
      )
      return
    }
    if (history.optimistic) {
      const transaction = children.update(`parent`, (draft) => {
        draft.value = `optimistic`
      })
      void transaction.isPersisted.promise.catch(() => {})
      rollback = () => transaction.rollback()
      expect(read()).toEqual(expected(false))
    }
    if (history.removeParent) {
      parentSync!.begin()
      parentSync!.truncate({ markReady: false })
      parentSync!.commit()
    }
    if (history.parentFirst) parentSync!.markReady()
    childSync!.begin()
    childSync!.truncate({ markReady: false })
    for (const value of history.final)
      childSync!.write({ type: `insert`, value })
    childSync!.commit()
    expect(read()).toEqual(
      expected(history.removeParent && history.parentFirst),
    )
    acquisition.resolve()
    await Promise.resolve()
    if (!history.parentFirst) {
      expect(read()).toEqual(expected(false))
      parentSync!.markReady()
    }
    await result.preload()
    expect(read()).toEqual(expected(true))
    const replacement = committed.find((tx) => tx.truncate)
    if (!replacement)
      throw new Error(`No atomic replacement reached persistence`)
    expect(
      replacement.mutations
        .map((change) => change.value)
        .map(({ id, value, joined }) => ({ id, value, joined })),
    ).toEqual(expected(true))
    expect(replacement.collectionMetadataMutations).toContainEqual({
      type: `set`,
      key: `live-query:confirmed`,
      value: { version: 1, offset: 0, limit: null },
    })
    // Every observed changed result is the complete replacement, never a mixture.
    for (const rows of publications.slice(checkpoint))
      expect(rows).toEqual(expected(true))
    expect(observer.getSnapshot().isPersistedReady).toBe(
      history.receiver !== `peer`,
    )
    if (rollback) {
      rollback()
      await vi.waitFor(() => expect(read()).toEqual(expected(true, false)))
    }
    if (history.later) {
      currentAcquisition = deferred<void>()
      const previous = expected(true, false)
      const laterCheckpoint = publications.length
      const before = acquired
      parentSync!.begin()
      parentSync!.write({
        type: `insert`,
        value: { id: `later`, value: `new parent` },
      })
      parentSync!.commit()
      await vi.waitFor(() => expect(acquired).toBeGreaterThan(before))
      expect(read()).toEqual(previous)
      childSync!.begin()
      childSync!.write({
        type: `insert`,
        value: { id: `later`, value: `new child` },
      })
      await childSync!.commit()
      expect(children.get(`later`)!.value).toBe(`new child`)
      // This task boundary drains the controlled adapter's resolved local work;
      // the provider acquisition remains explicitly held throughout it.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(read()).toEqual(previous)
      currentAcquisition.resolve()
      const completed = expected(true, false, true).sort((a, b) =>
        a.id.localeCompare(b.id),
      )
      await vi.waitFor(() => expect(read()).toEqual(completed))
      for (const rows of publications.slice(laterCheckpoint))
        expect(rows).toEqual(completed)
    }
  }, [
    () => {
      acquisition.resolve()
      currentAcquisition.resolve()
      mutation.resolve()
      unsubscribe()
      observer.dispose()
    },
    () => derived?.cleanup(),
    () => result.cleanup(),
    () => parents.cleanup(),
    () => children.cleanup(),
  ])
}

describe(`persisted completed initial snapshots`, () => {
  for (const restored of [
    [],
    [{ id: `old`, value: `cached`, joined: `saved` }],
  ]) {
    for (const confirmed of [false, true]) {
      for (const final of [[], [{ id: `parent`, value: `validated` }]]) {
        for (const parentFirst of [false, true]) {
          for (const fail of [false, true]) {
            for (const removeParent of [false, true]) {
              for (const cacheWindow of [0, 1]) {
                const history = {
                  restored,
                  confirmed,
                  final,
                  parentFirst,
                  fail,
                  removeParent,
                  cacheWindow,
                }
                it(`retains one completed result: ${JSON.stringify(history)}`, async () => {
                  await observeCompletedSnapshot(history)
                })
              }
            }
          }
        }
      }
    }
  }
})

// A second bounded grammar reaches the same law through a derived observer,
// through a direct peer sharing a source, and through an optimistic source edit.
// The peer must still satisfy its independent restore obligation. Rollback after
// completion follows ordinary live updates rather than re-entering the hold.
describe(`completed snapshot receiving paths`, () => {
  for (const receiver of [undefined, `derived`, `peer`] as const) {
    for (const fail of [false, true, `query`] as const) {
      for (const final of [[], [{ id: `parent`, value: `validated` }]]) {
        const history: SnapshotHistory = {
          restored: [{ id: `parent`, value: `cached`, joined: `saved` }],
          confirmed: true,
          final,
          parentFirst: false,
          fail,
          removeParent: false,
          cacheWindow: 0,
          receiver,
        }
        it(`observes the same completed result: ${JSON.stringify(history)}`, async () => {
          await observeCompletedSnapshot(history)
        })
      }
    }
  }
  for (const final of [[], [{ id: `parent`, value: `validated` }]]) {
    const history: SnapshotHistory = {
      restored: [{ id: `parent`, value: `cached`, joined: `saved` }],
      confirmed: true,
      final,
      parentFirst: false,
      fail: false,
      removeParent: false,
      cacheWindow: 0,
      optimistic: true,
    }
    it(`holds an edit until completion and observes its rollback: ${JSON.stringify(history)}`, async () => {
      await observeCompletedSnapshot(history)
    })
  }
})

describe(`completed snapshots after first readiness`, () => {
  for (const final of [[], [{ id: `parent`, value: `validated` }]]) {
    const history: SnapshotHistory = {
      restored: [{ id: `parent`, value: `cached`, joined: `saved` }],
      confirmed: true,
      final,
      parentFirst: false,
      fail: false,
      removeParent: false,
      cacheWindow: 0,
      later: true,
    }
    it(`retains its completed view while later demand is pending: ${JSON.stringify(history)}`, async () => {
      await observeCompletedSnapshot(history)
    })
  }
})
