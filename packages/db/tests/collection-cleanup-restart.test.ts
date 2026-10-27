// Ordinary tests moved out of collection-cleanup-restart-oracle.test.ts. They
// keep literal expectations for cleanup, restart, and observer behavior; the
// three-cut laws and the grammar calibration stay in the oracle file.
import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  withCollectionSyncConfigCleanup,
} from '../src'
import { createDeferred } from '../src/deferred'
import {
  cleanupError,
  completedBoundaryScenarios,
  reentryScenarios,
  withOracleCleanup,
} from './collection-cleanup-restart-support.js'
import type { SyncConfig } from '../src/types'
import type { Row } from './collection-cleanup-restart-support.js'

describe(`Collection cleanup oracle calibration`, () => {
  it(`retains a primary mismatch and every teardown failure`, async () => {
    const primary = new Error(`oracle mismatch`)
    const firstCleanup = new Error(`first cleanup failed`)
    const secondCleanup = new Error(`second cleanup failed`)
    const attempts: Array<string> = []

    const failure = await withOracleCleanup(() => {
      throw primary
    }, [
      () => {
        attempts.push(`first`)
        throw firstCleanup
      },
      () => {
        attempts.push(`second`)
        return Promise.reject(secondCleanup)
      },
    ]).catch((error: unknown) => error)

    expect(attempts).toEqual([`first`, `second`])
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).toMatchObject({
      cause: primary,
      errors: [primary, firstCleanup, secondCleanup],
    })
  })
})

describe(`Collection cleanup admission oracle`, () => {
  // Logical demand is distinct from a request to start a sync run. Cleanup
  // rejects the latter, including resumption, while a deferred subscription
  // may retain demand without starting even a live-query Collection's run.
  // Idle and cleaned-up sources distinguish this law from checking only ready
  // Collections. The callback is the synchronous cleanup-start observation cut.
  it.each(
    ([`plain`, `live-query`] as const).flatMap((kind) =>
      ([`idle`, `ready`, `cleaned-up`] as const).map((priorStatus) => ({
        kind,
        priorStatus,
      })),
    ),
  )(
    `retains deferred demand during $priorStatus $kind cleanup`,
    async ({ kind, priorStatus }) => {
      let starts = 0
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
          },
        },
      })
      const live = createLiveQueryCollection({
        query: (q) => q.from({ row: source }),
        gcTime: 0,
      })
      const collection = kind === `plain` ? source : live
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let reached = false
      if (priorStatus === `ready`) {
        source.startSyncImmediate()
        collection.startSyncImmediate()
      } else if (priorStatus === `cleaned-up`) {
        await collection.cleanup()
      }
      const before = starts
      const stop = collection._onCleanupStart(() => {
        reached = true
        expect(() => collection.subscribeChanges(() => {})).toThrow(
          expect.objectContaining(cleanupError),
        )
        subscription = collection.subscribeChanges(() => {}, {
          deferAcquisition: true,
          includeInitialState: true,
        })
        expect(subscription.isDeferringAcquisition()).toBe(true)
        expect(() => subscription!.resumeDeferredAcquisition()).toThrow(
          expect.objectContaining(cleanupError),
        )
        expect(collection.subscriberCount).toBe(0)
        expect(starts).toBe(before)
      })
      await withOracleCleanup(async () => {
        await collection.cleanup()
        expect(reached).toBe(true)
        expect(subscription).toBeDefined()
        expect(starts).toBe(before)
        stop()
        subscription!.resumeDeferredAcquisition()
        for (let turn = 0; turn < 10; turn++) await Promise.resolve()
        expect(collection.status).toBe(`ready`)
        expect(collection.subscriberCount).toBe(1)
      }, [
        stop,
        () => subscription?.unsubscribe(),
        () => live.cleanup(),
        () => source.cleanup(),
      ])
    },
  )

  // Promise ownership changes only when a replacement run actually starts.
  // A validation failure or a still-deferred start cannot create a second
  // retirement. Successful admission is the neighboring case: its new run
  // must have a distinct cleanup promise even before the old one settles.
  it.each([
    `none`,
    `deferred-start`,
    `listener-failure`,
    `subscribe`,
    `resume`,
    `preload`,
  ] as const)(
    `preserves retirement identity through %s admission`,
    async (admission) => {
      let starts = 0
      let cleanups = 0
      const collection = createCollection<Row, number>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
            return () => {
              cleanups++
            }
          },
        },
      })
      collection.startSyncImmediate()
      const first = collection.cleanup()
      const failure = new Error(`demand failed before replacement startup`)
      let stop = () => {}
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let preload: Promise<void> | undefined
      await withOracleCleanup(async () => {
        if (admission === `listener-failure`) {
          stop = collection[`_changes`].onFirstSubscriberOrPreload(() => {
            throw failure
          })
          expect(() => collection.subscribeChanges(() => {})).toThrow(failure)
        } else if (admission === `deferred-start`) {
          collection._deferSyncStart()
          collection.startSyncImmediate()
        } else if (admission === `subscribe`) {
          subscription = collection.subscribeChanges(() => {})
        } else if (admission === `resume`) {
          subscription = collection.subscribeChanges(() => {}, {
            deferAcquisition: true,
          })
          subscription.resumeDeferredAcquisition()
        } else if (admission === `preload`) preload = collection.preload()
        const replacement = [`subscribe`, `resume`, `preload`].includes(
          admission,
        )
        const second = collection.cleanup()
        expect(second === first).toBe(!replacement)
        expect(starts).toBe(replacement ? 2 : 1)
        expect(cleanups).toBe(starts)
        await Promise.all([first, second, preload])
      }, [
        () => stop(),
        () => subscription?.unsubscribe(),
        () => collection.cleanup(),
      ])
    },
  )
  it(`awaits a structural thenable returned from contextual-void cleanup`, async () => {
    const cleanupGate = createDeferred<void>()
    let cleanupCalls = 0
    const thenable = {
      then: cleanupGate.promise.then.bind(cleanupGate.promise),
    }
    const cleanup: () => void = () => {
      cleanupCalls++
      return thenable
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

    await withOracleCleanup(async () => {
      await collection.preload()
      let settled = false
      const retirement = collection.cleanup().then(() => {
        settled = true
      })

      expect(cleanupCalls).toBe(1)
      expect(collection.status).toBe(`ready`)
      expect(() => collection.startSyncImmediate()).toThrowError(
        expect.objectContaining(cleanupError),
      )
      await Promise.resolve()
      expect(settled).toBe(false)

      cleanupGate.resolve()
      await retirement
      expect(collection.status).toBe(`cleaned-up`)
    }, [() => cleanupGate.resolve(), () => collection.cleanup()])
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

  it(`retains every cleanup-start observer failure after adapter cleanup rejects`, async () => {
    const cleanupGate = createDeferred<void>()
    const firstObserverError = new Error(
      `first cleanup-start observer failed exactly`,
    )
    const secondObserverError = new Error(
      `second cleanup-start observer failed exactly`,
    )
    const adapterError = new Error(`adapter cleanup failed exactly`)
    const observerCalls: Array<string> = []
    let starts = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
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
    const offFirst = source._onCleanupStart(() => {
      observerCalls.push(`first`)
      throw firstObserverError
    })
    const offSecond = source._onCleanupStart(() => {
      observerCalls.push(`second`)
      throw secondObserverError
    })

    try {
      await source.preload()
      const cleanup = source.cleanup()

      expect(observerCalls).toEqual([`first`, `second`])
      expect(source.status).toBe(`ready`)
      cleanupGate.resolve()
      const failure = await cleanup.catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(AggregateError)
      const aggregate = failure as AggregateError
      expect(aggregate.cause).toMatchObject({
        name: `SyncCleanupError`,
        cause: adapterError,
      })
      expect(aggregate.errors).toEqual([
        aggregate.cause,
        firstObserverError,
        secondObserverError,
      ])
      expect(source.status).toBe(`cleaned-up`)

      offFirst()
      offSecond()
      source.startSyncImmediate()
      expect(starts).toBe(2)
      expect(source.status).toBe(`ready`)
    } finally {
      offFirst()
      offSecond()
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
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

  it.each([`eager`, `on-demand`] as const)(
    `recovers an errored %s source and dependent live query through their own restarts`,
    async (syncMode) => {
      let sourceSync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      let starts = 0
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode,
        sync: {
          sync: (methods) => {
            sourceSync = methods
            starts++
            const writeRow = () => {
              methods.begin()
              methods.write({ type: `insert`, value: { id: 1, rank: starts } })
              methods.commit()
            }
            if (syncMode === `eager`) writeRow()
            methods.markReady()
            if (syncMode === `on-demand`) {
              return {
                loadSubset: () => {
                  writeRow()
                  return true
                },
                unloadSubset: () => {},
              }
            }
            return undefined
          },
        },
      })
      const live = createLiveQueryCollection((q) => q.from({ row: source }))
      const observedRanks: Array<number | undefined> = []
      const subscription = live.subscribeChanges(() => {
        observedRanks.push(live.get(1)?.rank)
      })
      const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

      try {
        await live.preload()
        expect(live.get(1)?.rank).toBe(1)

        sourceSync.markError(new Error(`source sync failed`))
        expect(source.status).toBe(`error`)
        expect(live.status).toBe(`error`)

        await live.cleanup()
        await source.cleanup()
        await live.preload()

        expect(starts).toBe(2)
        expect(source.status).toBe(`ready`)
        expect(live.status).toBe(`ready`)
        expect(live.get(1)?.rank).toBe(2)

        observedRanks.length = 0
        sourceSync.begin()
        sourceSync.write({ type: `update`, value: { id: 1, rank: 3 } })
        sourceSync.commit()
        expect(live.get(1)?.rank).toBe(3)
        expect(observedRanks).toEqual([3])
      } finally {
        subscription.unsubscribe()
        reports.mockRestore()
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

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
    const settlementOrder: Array<string> = []
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
                ? cleanupGate.promise.then(() => {
                    settlementOrder.push(`adapter-cleanup-rejected`)
                    throw sourceError
                  })
                : undefined
            },
          }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      statuses.push(status)
      if (status === `cleaned-up`) {
        settlementOrder.push(`cleaned-up-event`)
      }
    })

    try {
      await collection.preload()
      statuses.length = 0
      const firstCleanup = collection.cleanup()
      const concurrentCleanup = collection.cleanup()
      void firstCleanup.catch(() => {
        settlementOrder.push(`public-cleanup-rejection-continuation`)
      })
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
      expect(settlementOrder).toEqual([
        `adapter-cleanup-rejected`,
        `cleaned-up-event`,
        `public-cleanup-rejection-continuation`,
      ])
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

  it(`ends a pending subset load with one end transition at cleanup`, async () => {
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: () => new Promise<void>(() => {}) }
        },
      },
    })
    const transitions: Array<{
      isLoadingSubset: boolean
      previousIsLoadingSubset: boolean
      loadingSubsetTransition: string
    }> = []
    collection.on(`loadingSubset:change`, (event) => {
      transitions.push({
        isLoadingSubset: event.isLoadingSubset,
        previousIsLoadingSubset: event.previousIsLoadingSubset,
        loadingSubsetTransition: event.loadingSubsetTransition,
      })
    })

    void collection._sync.loadSubset({})
    await Promise.resolve()
    expect(collection.isLoadingSubset).toBe(true)

    await collection.cleanup()

    expect(transitions).toEqual([
      {
        isLoadingSubset: true,
        previousIsLoadingSubset: false,
        loadingSubsetTransition: `start`,
      },
      {
        isLoadingSubset: false,
        previousIsLoadingSubset: true,
        loadingSubsetTransition: `end`,
      },
    ])
    expect(collection.isLoadingSubset).toBe(false)
  })
})
