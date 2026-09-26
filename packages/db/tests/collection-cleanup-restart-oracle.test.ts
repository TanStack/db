import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  createCollection,
  createEffect,
  createLiveQueryCollection,
  eq,
  withCollectionSyncConfigCleanup,
} from '../src'
import { createDeferred } from '../src/deferred'
import type { SyncConfig } from '../src/types'

/**
 * # When does cleanup become observable?
 *
 * Authority comes from the public `Collection.cleanup()` contract and the
 * cleanup and cleanup-start terms in the contributing glossary. Cleanup has
 * two boundaries. Cleanup start synchronously closes restart admission and
 * puts dependent live queries in terminal error while marking dependent Effects
 * disposed. Cleanup settlement publishes `cleaned-up` and settles the public
 * cleanup promise only after adapter cleanup settles. Cleanup start is internal;
 * it is not a Collection status and does not prove that adapter resources have
 * been released.
 *
 * The three-cut history grammar starts with a ready source and either a live
 * query or Effect dependent. It invokes cleanup, holds adapter cleanup, checks
 * the cleanup-start observation, releases the adapter, observes terminal
 * `cleaned-up` publication, and checks the later cleanup-Promise settlement.
 * Adjacent histories re-enter start or preload from abort and
 * release callbacks, request nested cleanup, reject adapter cleanup, throw
 * from cleanup-start observers, or register observers during active cleanup.
 * The late live-query history places the cleaning source before and after a
 * healthy source. Terminal setup must retain no partial source ownership.
 * A repeated-source history also proves one live query enters terminal error
 * once when two lexical aliases depend on the same Collection.
 * If adapter cleanup and local teardown both fail, the aggregate keeps the
 * adapter error primary and the local error as a secondary diagnostic. A lone
 * error keeps its identity.
 *
 * `expectedCleanupBoundary` is a small independent three-cut timeline model. Its
 * `dependent` field combines the live query's terminal error and the Effect's
 * disposed state because both observations mean the dependent can no longer
 * use the discarded sync run. At cleanup start, status retains the prior public
 * value while cleanup remains pending. Terminal publication opens restart
 * admission and changes status to `cleaned-up` while the cleanup Promise remains
 * pending. The Promise settles afterward. The model does not reproduce manager
 * callbacks or adapter machinery. A status listener may restart at terminal
 * publication; adjacent event-restart histories exercise that reentry.
 *
 * The production driver calls the real cleanup, live-query, and Effect entry
 * points. Refinement checks run before releasing the controlled adapter gate
 * and after the cleanup promise settles. Counts, exact errors, status, rows,
 * subscription and observer ownership, and settlement are observed. The alias
 * and late-registration cases are pinned refinements outside the two-checkpoint
 * model. This suite does not establish full demand/replay histories, transport
 * shutdown, persistence-wrapper behavior, or general row-publication laws.
 */

type Row = { id: number; rank: number }
const cleanupError = {
  name: `CollectionStateError`,
  message: expect.stringContaining(`after cleanup() completes`),
}

type CleanupBoundary =
  | `cleanup-start`
  | `terminal-publication`
  | `cleanup-settlement`
type CleanupBoundaryObservation<TStatus extends string> = {
  restartAdmission: `closed` | `open`
  collectionStatus: TStatus | `cleaned-up`
  cleanup: `pending` | `settled`
  dependent: `active` | `terminal`
}

/** Independent three-cut law for observations at each cleanup checkpoint. */
function expectedCleanupBoundary<TStatus extends string>(
  priorStatus: TStatus,
  boundary: CleanupBoundary,
): CleanupBoundaryObservation<TStatus> {
  if (boundary === `cleanup-start`) {
    return {
      restartAdmission: `closed`,
      collectionStatus: priorStatus,
      cleanup: `pending`,
      dependent: `terminal`,
    }
  }
  if (boundary === `terminal-publication`) {
    return {
      restartAdmission: `open`,
      collectionStatus: `cleaned-up`,
      cleanup: `pending`,
      dependent: `terminal`,
    }
  }
  return {
    restartAdmission: `open`,
    collectionStatus: `cleaned-up`,
    cleanup: `settled`,
    dependent: `terminal`,
  }
}

function observeRestartAdmission(start: () => void): `closed` | `open` {
  try {
    start()
    return `open`
  } catch (error) {
    expect(error).toMatchObject(cleanupError)
    return `closed`
  }
}

function observeCleanupSettlement(settled: boolean): `pending` | `settled` {
  return settled ? `settled` : `pending`
}

function observeDependent(active: boolean): `active` | `terminal` {
  return active ? `active` : `terminal`
}

const reentryScenarios = ([`abort`, `release`] as const).flatMap((boundary) =>
  [false, true].flatMap((nestedCleanup) =>
    [1, 2].map((attempts) => ({
      id: `${boundary}:${nestedCleanup ? `nested` : `plain`}:${attempts}`,
      boundary,
      nestedCleanup,
      attempts,
    })),
  ),
)

const completedBoundaryScenarios = ([`event`, `await`] as const).flatMap(
  (boundary) =>
    [false, true].map((liveQuery) => ({
      id: `${boundary}:${liveQuery ? `live-query` : `source`}`,
      boundary,
      liveQuery,
    })),
)

function expectExactCaseIds(
  actual: ReadonlyArray<{ id: string }>,
  expected: ReadonlyArray<string>,
): void {
  const ids = actual.map(({ id }) => id)
  expect(ids).toEqual(expected)
  expect(new Set(ids).size).toBe(ids.length)
}

describe(`Collection cleanup admission oracle`, () => {
  it(`calibrates every declared bounded-product cell exactly once`, () => {
    expectExactCaseIds(reentryScenarios, [
      `abort:plain:1`,
      `abort:plain:2`,
      `abort:nested:1`,
      `abort:nested:2`,
      `release:plain:1`,
      `release:plain:2`,
      `release:nested:1`,
      `release:nested:2`,
    ])
    expectExactCaseIds(completedBoundaryScenarios, [
      `event:source`,
      `event:live-query`,
      `await:source`,
      `await:live-query`,
    ])
  })

  it(`waits for source cleanup before publishing the restart boundary`, async () => {
    const cleanupGate = createDeferred<void>()
    let starts = 0
    let cleanups = 0
    let sourceCleanupSettled = false
    const statuses: Array<string> = []
    const settlementOrder: Array<string> = []
    let publicCleanupSettled = false
    let atTerminalPublication:
      | Pick<
          CleanupBoundaryObservation<`ready`>,
          `collectionStatus` | `cleanup`
        >
      | undefined
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return {
            cleanup: () => {
              cleanups++
              return cleanupGate.promise.then(() => {
                sourceCleanupSettled = true
                settlementOrder.push(`adapter-cleanup-settled`)
              })
            },
          }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      statuses.push(status)
      if (status === `cleaned-up`) {
        atTerminalPublication = {
          collectionStatus: status,
          cleanup: observeCleanupSettlement(publicCleanupSettled),
        }
        settlementOrder.push(`cleaned-up-event`)
      }
    })

    try {
      await collection.preload()
      statuses.length = 0

      const firstCleanup = collection.cleanup()
      const concurrentCleanup = collection.cleanup()
      void firstCleanup.then(() => {
        publicCleanupSettled = true
        settlementOrder.push(`public-cleanup-promise-continuation`)
      })

      const atCleanupStart = expectedCleanupBoundary(`ready`, `cleanup-start`)
      expect(sourceCleanupSettled).toBe(false)
      expect(collection.status).toBe(atCleanupStart.collectionStatus)
      expect(statuses).toEqual([])
      expect(cleanups).toBe(1)
      expect(concurrentCleanup).toBe(firstCleanup)
      expect(
        observeRestartAdmission(() => collection.startSyncImmediate()),
      ).toBe(atCleanupStart.restartAdmission)

      cleanupGate.resolve()
      await Promise.all([firstCleanup, concurrentCleanup])

      const atCleanupSettlement = expectedCleanupBoundary(
        `ready`,
        `cleanup-settlement`,
      )
      expect(sourceCleanupSettled).toBe(true)
      const terminalPublication = expectedCleanupBoundary(
        `ready`,
        `terminal-publication`,
      )
      expect(atTerminalPublication).toEqual({
        collectionStatus: terminalPublication.collectionStatus,
        cleanup: terminalPublication.cleanup,
      })
      expect(collection.status).toBe(atCleanupSettlement.collectionStatus)
      expect(statuses).toEqual([`cleaned-up`])
      expect(settlementOrder).toEqual([
        `adapter-cleanup-settled`,
        `cleaned-up-event`,
        `public-cleanup-promise-continuation`,
      ])

      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(cleanups).toBe(1)

      expect(
        observeRestartAdmission(() => collection.startSyncImmediate()),
      ).toBe(atCleanupSettlement.restartAdmission)
      expect(starts).toBe(2)
      expect(collection.status).toBe(`ready`)
    } finally {
      cleanupGate.resolve()
      off()
      await collection.cleanup()
    }
  })

  it(`rejects dependent preload when cleanup starts before terminal settlement`, async () => {
    const cleanupGate = createDeferred<void>()
    const loadGate = createDeferred<void>()
    const loadEntered = createDeferred<void>()
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loadEntered.resolve()
              return loadGate.promise
            },
            cleanup: () => cleanupGate.promise,
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) => q.from({ row: source }))
    const message =
      `Source collection '${source.id}' was manually cleaned up while live query '${live.id}' depends on it. ` +
      `Live queries prevent automatic GC, so this was likely a manual cleanup() call.`
    const reports = vi.spyOn(console, `error`).mockImplementation(() => {})
    const preload = live.preload().then(
      () => ({ status: `fulfilled` as const }),
      (error: unknown) => ({ status: `rejected` as const, error }),
    )

    try {
      await loadEntered.promise
      let cleanupSettled = false
      const cleanup = source.cleanup().then(() => {
        cleanupSettled = true
      })

      const atCleanupStart = expectedCleanupBoundary(`ready`, `cleanup-start`)
      expect(source.status).toBe(atCleanupStart.collectionStatus)
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupStart.cleanup,
      )
      expect(observeDependent(live.status !== `error`)).toBe(
        atCleanupStart.dependent,
      )
      expect(await preload).toMatchObject({
        status: `rejected`,
        error: { message },
      })

      cleanupGate.resolve()
      await cleanup
      expect(source.status).toBe(`cleaned-up`)
      expect(reports.mock.calls).toEqual([[`[Live Query Error] ${message}`]])
    } finally {
      cleanupGate.resolve()
      loadGate.resolve()
      reports.mockRestore()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it(`puts a live query in terminal error once when one source has two aliases`, async () => {
    const cleanupGate = createDeferred<void>()
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, rank: 1 } })
          commit()
          markReady()
          return { cleanup: () => cleanupGate.promise }
        },
      },
    })
    source.createIndex((row) => row.id, { indexType: BasicIndex })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ left: source })
        .join(
          { right: source },
          ({ left, right }) => eq(left.id, right.id),
          `inner`,
        ),
    )
    const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

    try {
      await live.preload()

      const cleanup = source.cleanup()

      expect(live.status).toBe(`error`)
      expect(reports).toHaveBeenCalledTimes(1)

      cleanupGate.resolve()
      await cleanup
    } finally {
      cleanupGate.resolve()
      reports.mockRestore()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it(`disposes a dependent Effect when cleanup starts before terminal settlement`, async () => {
    const cleanupGate = createDeferred<void>()
    const handlerGate = createDeferred<void>()
    const handlerEntered = createDeferred<void>()
    const sourceErrors: Array<Error> = []
    let adapterCleanupStarted = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, rank: 1 } })
          commit()
          markReady()
          return {
            cleanup: () => {
              adapterCleanupStarted++
              return cleanupGate.promise
            },
          }
        },
      },
    })
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      onEnter: () => {
        handlerEntered.resolve()
        return handlerGate.promise
      },
      onSourceError: (error) => sourceErrors.push(error),
    })

    try {
      await handlerEntered.promise
      expect(effect.disposed).toBe(false)
      expect(source.subscriberCount).toBe(1)

      let cleanupSettled = false
      const cleanup = source.cleanup().then(() => {
        cleanupSettled = true
      })
      const atCleanupStart = expectedCleanupBoundary(`ready`, `cleanup-start`)

      expect(adapterCleanupStarted).toBe(1)
      expect(source.status).toBe(atCleanupStart.collectionStatus)
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupStart.cleanup,
      )
      expect(observeDependent(!effect.disposed)).toBe(atCleanupStart.dependent)
      expect(source.subscriberCount).toBe(0)
      expect(sourceErrors).toEqual([
        expect.objectContaining({
          message: `Source collection '${source.id}' was cleaned up while effect depends on it`,
        }),
      ])
      let effectDisposalSettled = false
      const effectDisposal = effect.dispose().then(() => {
        effectDisposalSettled = true
      })
      expect(effectDisposalSettled).toBe(false)

      handlerGate.resolve()
      await effectDisposal
      expect(effectDisposalSettled).toBe(true)
      expect(cleanupSettled).toBe(false)

      cleanupGate.resolve()
      await cleanup
      const atCleanupSettlement = expectedCleanupBoundary(
        `ready`,
        `cleanup-settlement`,
      )

      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupSettlement.cleanup,
      )
      expect(source.status).toBe(atCleanupSettlement.collectionStatus)
      expect(observeDependent(!effect.disposed)).toBe(
        atCleanupSettlement.dependent,
      )
      expect(sourceErrors).toHaveLength(1)
    } finally {
      cleanupGate.resolve()
      handlerGate.resolve()
      await effect.dispose()
      await source.cleanup()
    }
  })

  it(`continues teardown when a cleanup-start observer throws`, async () => {
    const cleanupGate = createDeferred<void>()
    const observerError = new Error(`cleanup-start observer failed exactly`)
    let starts = 0
    let adapterCleanupStarted = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return {
            cleanup: () => {
              adapterCleanupStarted++
              return cleanupGate.promise
            },
          }
        },
      },
    })
    const off = source._onCleanupStart(() => {
      throw observerError
    })

    try {
      await source.preload()
      const cleanupOutcome = source.cleanup().then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(adapterCleanupStarted).toBe(1)
      expect(source.status).toBe(`ready`)

      cleanupGate.resolve()
      expect(await cleanupOutcome).toBe(observerError)
      expect(source.status).toBe(`cleaned-up`)

      off()
      source.startSyncImmediate()
      expect(starts).toBe(2)
      expect(source.status).toBe(`ready`)
    } finally {
      off()
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
    }
  })

  it(`keeps adapter cleanup failure primary when cleanup-start observer also fails`, async () => {
    const cleanupGate = createDeferred<void>()
    const observerError = new Error(`cleanup-start observer failed exactly`)
    const adapterError = new Error(`adapter cleanup failed exactly`)
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            cleanup: () =>
              cleanupGate.promise.then(() => {
                throw adapterError
              }),
          }
        },
      },
    })
    const off = source._onCleanupStart(() => {
      throw observerError
    })

    try {
      await source.preload()
      const cleanup = source.cleanup()

      expect(source.status).toBe(`ready`)
      cleanupGate.resolve()
      const failure = await cleanup.catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(AggregateError)
      const aggregate = failure as AggregateError
      expect(aggregate.cause).toMatchObject({
        name: `SyncCleanupError`,
        cause: adapterError,
      })
      expect(aggregate.errors).toEqual([aggregate.cause, observerError])
      expect(source.status).toBe(`cleaned-up`)
    } finally {
      off()
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
    }
  })

  it(`releases an Effect cleanup-start observer registered during active cleanup`, async () => {
    const cleanupGate = createDeferred<void>()
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { cleanup: () => cleanupGate.promise }
        },
      },
    })
    const registerCleanupStart = source._onCleanupStart.bind(source)
    let activeCleanupStartObservers = 0
    source._onCleanupStart = (callback) => {
      activeCleanupStartObservers++
      const unsubscribe = registerCleanupStart(callback)
      let active = true
      return () => {
        if (!active) return
        active = false
        activeCleanupStartObservers--
        unsubscribe()
      }
    }

    let effect: ReturnType<typeof createEffect> | undefined
    try {
      await source.preload()
      const cleanup = source.cleanup()

      effect = createEffect({
        query: (q) => q.from({ row: source }),
        onBatch: () => {},
        onSourceError: () => {},
      })

      expect(effect.disposed).toBe(true)
      expect(source.subscriberCount).toBe(0)
      expect(activeCleanupStartObservers).toBe(0)

      cleanupGate.resolve()
      await cleanup
    } finally {
      cleanupGate.resolve()
      await effect?.dispose()
      await source.cleanup()
    }
  })

  it.each([`first`, `second`] as const)(
    `does not acquire live-query source subscriptions during active cleanup: %s source`,
    async (cleaningPosition) => {
      const cleanupGate = createDeferred<void>()
      const cleaningSource = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { cleanup: () => cleanupGate.promise }
          },
        },
      })
      const healthySource = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      })
      cleaningSource.createIndex((row) => row.id, { indexType: BasicIndex })
      healthySource.createIndex((row) => row.id, { indexType: BasicIndex })
      let live: ReturnType<typeof createLiveQueryCollection> | undefined
      const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

      try {
        await cleaningSource.preload()
        const cleaning = cleaningSource.cleanup()
        expect(cleaningSource.status).toBe(`ready`)

        const firstSource =
          cleaningPosition === `first` ? cleaningSource : healthySource
        const secondSource =
          cleaningPosition === `second` ? cleaningSource : healthySource
        live = createLiveQueryCollection((q) =>
          q
            .from({ first: firstSource })
            .join(
              { second: secondSource },
              ({ first, second }) => eq(first.id, second.id),
              `inner`,
            ),
        )
        const message =
          `Source collection '${cleaningSource.id}' was manually cleaned up while live query '${live.id}' depends on it. ` +
          `Live queries prevent automatic GC, so this was likely a manual cleanup() call.`

        await expect(live.preload()).rejects.toThrow(message)

        expect(live.status).toBe(`error`)
        expect({
          cleaning: cleaningSource.subscriberCount,
          healthy: healthySource.subscriberCount,
        }).toEqual({ cleaning: 0, healthy: 0 })
        expect(reports.mock.calls).toEqual([[`[Live Query Error] ${message}`]])

        cleanupGate.resolve()
        await cleaning
      } finally {
        cleanupGate.resolve()
        reports.mockRestore()
        await live?.cleanup()
        await cleaningSource.cleanup()
        await healthySource.cleanup()
      }
    },
  )

  it(`does not retain a late cleanup-start observer that throws`, async () => {
    const cleanupGate = createDeferred<void>()
    const observerError = new Error(
      `late cleanup-start observer failed exactly`,
    )
    let observerCalls = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { cleanup: () => cleanupGate.promise }
        },
      },
    })

    try {
      await source.preload()
      const firstCleanup = source.cleanup()

      expect(() =>
        source._onCleanupStart(() => {
          observerCalls++
          throw observerError
        }),
      ).toThrow(observerError)

      cleanupGate.resolve()
      await firstCleanup
      source.startSyncImmediate()
      await expect(source.cleanup()).resolves.toBeUndefined()
      expect(observerCalls).toBe(1)
    } finally {
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
    }
  })

  it(`notifies one observer once per cleanup boundary until it unsubscribes`, async () => {
    let starts = 0
    let observerCalls = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
        },
      },
    })
    const off = source._onCleanupStart(() => {
      observerCalls++
    })

    try {
      await source.preload()
      const firstCleanup = source.cleanup()
      expect(observerCalls).toBe(1)
      await firstCleanup

      source.startSyncImmediate()
      const secondCleanup = source.cleanup()
      expect(observerCalls).toBe(2)
      await secondCleanup

      off()
      source.startSyncImmediate()
      await source.cleanup()
      expect({ starts, observerCalls }).toEqual({ starts: 3, observerCalls: 2 })
    } finally {
      off()
      await source.cleanup()
    }
  })

  it(`does not revive a terminal live query when its source restarts`, async () => {
    let starts = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          starts++
          begin()
          write({ type: `insert`, value: { id: 1, rank: starts } })
          commit()
          markReady()
        },
      },
    })
    const live = createLiveQueryCollection((q) => q.from({ row: source }))
    const publications: Array<unknown> = []
    const subscription = live.subscribeChanges((changes) => {
      publications.push(changes)
    })
    const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

    try {
      await live.preload()
      expect(live.get(1)?.rank).toBe(1)
      publications.length = 0

      await source.cleanup()
      expect(live.status).toBe(`error`)

      source.startSyncImmediate()
      expect(source.status).toBe(`ready`)
      expect(starts).toBe(2)
      expect(live.status).toBe(`error`)
      expect(live.get(1)?.rank).toBe(1)
      expect(publications).toEqual([])
      expect(reports).toHaveBeenCalledTimes(1)
    } finally {
      subscription.unsubscribe()
      reports.mockRestore()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it(`treats an incidental contextual-void return as synchronous cleanup`, async () => {
    let starts = 0
    const released: Array<number> = []
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return () => released.push(starts)
        },
      },
    })

    try {
      await collection.preload()

      const cleanup = collection.cleanup()

      expect(released).toEqual([1])
      expect(collection.status).toBe(`cleaned-up`)
      collection.startSyncImmediate()
      expect(starts).toBe(2)
      await cleanup
    } finally {
      await collection.cleanup()
    }
  })

  it(`shares one retirement promise when cleanup finishes synchronously`, async () => {
    let adapterCleanups = 0
    let localCleanups = 0
    const sync = withCollectionSyncConfigCleanup(
      {
        sync: ({ markReady }) => {
          markReady()
          return () => {
            adapterCleanups++
          }
        },
      } satisfies SyncConfig<Row, number>,
      () => {
        localCleanups++
      },
    )
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync,
    })

    try {
      await collection.preload()
      const first = collection.cleanup()
      const concurrent = collection.cleanup()

      expect({
        samePromise: concurrent === first,
        adapterCleanups,
        localCleanups,
      }).toEqual({
        samePromise: true,
        adapterCleanups: 1,
        localCleanups: 1,
      })
      await first
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      await collection.cleanup()
    }
  })

  it(`lets a terminal listener clean a replacement sync run separately`, async () => {
    let starts = 0
    let adapterCleanups = 0
    let armed = false
    let replacementCleanup: Promise<void> | undefined
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return () => {
            adapterCleanups++
          }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      if (armed && status === `cleaned-up`) {
        armed = false
        collection.startSyncImmediate()
        replacementCleanup = collection.cleanup()
      }
    })

    try {
      await collection.preload()
      armed = true
      const firstCleanup = collection.cleanup()

      expect(replacementCleanup).toBeDefined()
      expect(replacementCleanup).not.toBe(firstCleanup)
      await Promise.all([firstCleanup, replacementCleanup!])
      expect(starts).toBe(2)
      expect(adapterCleanups).toBe(2)
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      armed = false
      off()
      await collection.cleanup()
    }
  })

  it(`awaits a runtime Promise from cleanup typed to return void`, async () => {
    const cleanupGate = createDeferred<void>()
    let cleanupCalls = 0
    const cleanup: () => void = () => {
      cleanupCalls++
      return cleanupGate.promise
    }
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return cleanup
        },
      },
    })

    try {
      await collection.preload()

      const retirement = collection.cleanup()

      expect(cleanupCalls).toBe(1)
      expect(collection.status).toBe(`ready`)
      expect(() => collection.startSyncImmediate()).toThrowError(
        expect.objectContaining(cleanupError),
      )

      cleanupGate.resolve()
      await retirement
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      cleanupGate.resolve()
      await collection.cleanup()
    }
  })

  it(`finishes teardown once and rejects every waiter when source cleanup rejects`, async () => {
    const cleanupGate = createDeferred<void>()
    const sourceError = new Error(`source cleanup failed exactly`)
    let starts = 0
    let cleanups = 0
    const statuses: Array<string> = []
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return {
            cleanup: () => {
              cleanups++
              return cleanups === 1
                ? cleanupGate.promise.then(() => Promise.reject(sourceError))
                : undefined
            },
          }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      statuses.push(status)
    })

    try {
      await collection.preload()
      statuses.length = 0
      const firstCleanup = collection.cleanup()
      const concurrentCleanup = collection.cleanup()
      const firstOutcome = firstCleanup.catch((error: unknown) => error)
      const concurrentOutcome = concurrentCleanup.catch(
        (error: unknown) => error,
      )

      expect(collection.status).toBe(`ready`)
      expect(cleanups).toBe(1)
      expect(concurrentCleanup).toBe(firstCleanup)
      cleanupGate.resolve()

      const [firstError, concurrentError] = await Promise.all([
        firstOutcome,
        concurrentOutcome,
      ])
      expect(concurrentError).toBe(firstError)
      expect(firstError).toMatchObject({
        name: `SyncCleanupError`,
        cause: sourceError,
      })
      expect(collection.status).toBe(`cleaned-up`)
      expect(statuses).toEqual([`cleaned-up`])
      expect(cleanups).toBe(1)

      // Rejection ends the old sync run. A later run is allowed, and a
      // repeated cleanup does not retry the failed callback from that run.
      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(cleanups).toBe(1)
      collection.startSyncImmediate()
      expect(starts).toBe(2)
      expect(collection.status).toBe(`ready`)
    } finally {
      cleanupGate.resolve()
      off()
      await collection.cleanup()
    }
  })

  it.each([`throw`, `reject`] as const)(
    `keeps adapter cleanup failure primary when local teardown also fails: %s`,
    async (outcome) => {
      const cleanupGate = createDeferred<void>()
      const adapterFailure = new Error(`adapter cleanup failed exactly`)
      const localFailure = new Error(`local teardown failed exactly`)
      const sync = withCollectionSyncConfigCleanup(
        {
          sync: ({ markReady }) => {
            markReady()
            return () => {
              if (outcome === `throw`) throw adapterFailure
              return cleanupGate.promise.then(() => {
                throw adapterFailure
              })
            }
          },
        } satisfies SyncConfig<Row, number>,
        () => {
          throw localFailure
        },
      )
      const collection = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync,
      })

      try {
        await collection.preload()
        const cleanup = collection.cleanup()
        cleanupGate.resolve()
        const failure = await cleanup.catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(AggregateError)
        const aggregate = failure as AggregateError
        expect(aggregate.cause).toMatchObject({
          name: `SyncCleanupError`,
          cause: adapterFailure,
        })
        expect(aggregate.errors).toEqual([aggregate.cause, localFailure])
        expect(collection.status).toBe(`cleaned-up`)
      } finally {
        cleanupGate.resolve()
        await collection.cleanup().catch(() => undefined)
      }
    },
  )

  it.each(reentryScenarios)(
    `rejects restart without creating replacement ownership: %j`,
    async ({ boundary, nestedCleanup, attempts }) => {
      let ops!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      let loads = 0
      let releases = 0
      let armed = false
      const errors: Array<unknown> = []
      const cleanups: Array<Promise<void>> = []
      const reenter = () => {
        if (!armed) return
        armed = false
        for (let i = 0; i < attempts; i++) {
          if (nestedCleanup) cleanups.push(live.cleanup())
          try {
            live.startSyncImmediate()
            errors.push(undefined)
          } catch (error) {
            errors.push(error)
          }
        }
      }
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (methods) => {
            ops = methods
            methods.begin()
            methods.write({ type: `insert`, value: { id: 1, rank: 1 } })
            methods.commit()
            methods.markReady()
            return {
              loadSubset: ({ signal }) => {
                loads++
                signal?.addEventListener(`abort`, () => {
                  if (boundary === `abort`) reenter()
                })
                return true
              },
              unloadSubset: () => {
                releases++
                if (boundary === `release`) reenter()
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) => q.from({ row: source }))
      try {
        await live.preload()
        armed = true
        await live.cleanup()
        await Promise.all(cleanups)
        expect(armed).toBe(false)
        expect(errors).toHaveLength(attempts)
        for (const error of errors) expect(error).toMatchObject(cleanupError)
        expect(loads).toBe(1)
        expect(releases).toBe(1)
        expect(source.subscriberCount).toBe(0)
        expect(live.status).toBe(`cleaned-up`)

        // The rejected calls must not poison a later, ordinary restart.
        await live.preload()
        expect(loads).toBe(2)
        expect(source.subscriberCount).toBe(1)
        ops.begin()
        ops.write({ type: `update`, value: { id: 1, rank: 2 } })
        ops.commit()
        expect(live.status).toBe(`ready`)
        expect(live.get(1)?.rank).toBe(2)
      } finally {
        armed = false
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it.each([`start`, `preload`] as const)(
    `rejects %s from adapter cleanup but allows another collection to start`,
    async (method) => {
      let starts = 0
      let armed = false
      let observed: Promise<unknown> | undefined
      const peer = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      })
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            starts++
            begin()
            write({ type: `insert`, value: { id: 1, rank: starts } })
            commit()
            markReady()
            return () => {
              if (!armed) return
              armed = false
              void source.cleanup()
              try {
                const result =
                  method === `start`
                    ? source.startSyncImmediate()
                    : source.preload()
                observed = Promise.resolve(result).then(
                  () => undefined,
                  (error: unknown) => error,
                )
              } catch (error) {
                observed = Promise.resolve(error)
              }
              peer.startSyncImmediate()
            }
          },
        },
      })
      try {
        await source.preload()
        armed = true
        await source.cleanup()
        expect(await observed).toMatchObject(cleanupError)
        expect(starts).toBe(1)
        expect(peer.status).toBe(`ready`)
        await source.preload()
        expect(starts).toBe(2)
        expect(source.get(1)?.rank).toBe(2)
      } finally {
        armed = false
        await source.cleanup()
        await peer.cleanup()
      }
    },
  )

  it.each(completedBoundaryScenarios)(
    `admits restart at the completed cleanup boundary: %j`,
    async ({ boundary, liveQuery }) => {
      let starts = 0
      let armed = false
      let ops!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: {
          sync: (methods) => {
            ops = methods
            const { begin, write, commit, markReady } = methods
            starts++
            begin()
            write({ type: `insert`, value: { id: 1, rank: starts } })
            commit()
            markReady()
          },
        },
      })
      const collection = liveQuery
        ? createLiveQueryCollection((q) => q.from({ row: source }))
        : source
      const off = collection.on(`status:change`, ({ status }) => {
        if (armed && boundary === `event` && status === `cleaned-up`) {
          armed = false
          collection.startSyncImmediate()
        }
      })
      try {
        await collection.preload()
        armed = true
        await collection.cleanup()
        if (boundary === `await`) collection.startSyncImmediate()
        expect(starts).toBe(liveQuery ? 1 : 2)
        expect(collection.status).toBe(`ready`)
        expect(collection.get(1)?.rank).toBe(liveQuery ? 1 : 2)
        ops.begin()
        ops.write({ type: `update`, value: { id: 1, rank: 3 } })
        ops.commit()
        expect(collection.get(1)?.rank).toBe(3)
      } finally {
        armed = false
        off()
        if (liveQuery) await collection.cleanup()
        await source.cleanup()
      }
    },
  )
})
