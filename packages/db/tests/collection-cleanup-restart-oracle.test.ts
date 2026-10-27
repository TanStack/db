import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  createCollection,
  createEffect,
  createLiveQueryCollection,
  eq,
} from '../src'
import { createDeferred } from '../src/deferred'
import { declareOracle } from './oracle-declaration.js'
import {
  cleanupError,
  completedBoundaryScenarios,
  reentryScenarios,
  withOracleCleanup,
} from './collection-cleanup-restart-support.js'
import type { Row } from './collection-cleanup-restart-support.js'

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
 * The three-cut history grammar starts with a ready or loading source. Selected
 * histories add a live-query or Effect dependent. It invokes cleanup, holds
 * adapter cleanup, checks the cleanup-start observation, releases the adapter,
 * observes terminal `cleaned-up` publication, and checks the later
 * cleanup-Promise settlement.
 * Adjacent histories re-enter start or preload from abort and
 * release callbacks, request nested cleanup, reject adapter cleanup, throw
 * from cleanup-start observers, or register observers during active cleanup.
 * The late live-query history places the cleaning source before and after a
 * healthy source. Terminal setup must retain no partial source ownership.
 * A repeated-source history also proves one live query enters terminal error
 * once when two lexical aliases depend on the same Collection.
 * Errored eager and on-demand source histories clean up the dependent first,
 * then restart both Collections through live-query preload. They check the
 * same live-query object and subscriber after a later source update. These
 * pinned paths sit outside the three-cut model; they do not establish
 * automatic recovery after source-only restart.
 * If adapter cleanup and local teardown both fail, the aggregate keeps the
 * adapter error primary and every local error as an ordered secondary
 * diagnostic. A lone error keeps its identity.
 * No replacement sync run is admitted until terminal publication. Concurrent
 * callers share the cleanup promise. Rejection still finalizes the old run and
 * rejects every waiter. A later ordinary preload starts a new sync run.
 * A subset load still pending at cleanup ends with one `loadingSubset:change`
 * end transition, so no subscriber keeps a load that can no longer settle.
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
 * Ordinary subscriptions and resumption of deferred acquisition obey the same
 * restart admission boundary. Eighteen histories cross loading/ready/error cleanup,
 * eager/on-demand sources, and admission with or without a snapshot or through
 * deferred resumption. Rejection retains no new subscriber or acquisition;
 * explicit admission after cleanup settlement starts the replacement run.
 *
 * The production driver calls the real cleanup, live-query, and Effect entry
 * points. Refinement checks run before releasing the controlled adapter gate
 * and after the cleanup promise settles. Counts, exact errors, status, rows,
 * subscription and observer ownership, and settlement are observed. The alias
 * and late-registration cases are pinned refinements outside the three-cut
 * model. This suite does not establish full demand/replay histories, transport
 * shutdown, persistence-wrapper behavior, or general row-publication laws.
 */

type CleanupBoundary =
  `cleanup-start` | `terminal-publication` | `cleanup-settlement`
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

function expectExactCaseIds(
  actual: ReadonlyArray<{ id: string }>,
  expected: ReadonlyArray<string>,
): void {
  const ids = actual.map(({ id }) => id)
  expect(ids).toEqual(expected)
  expect(new Set(ids).size).toBe(ids.length)
}

declareOracle({
  model: [expectedCleanupBoundary],
  grammar: [reentryScenarios, completedBoundaryScenarios],
})

describe(`Collection cleanup admission oracle`, () => {
  // These paths share the three-cut model above. The held adapter promise
  // reaches cleanup start without confusing the retained public status with
  // permission to start another sync run. No automatic retry is requested.
  const subscriberAdmissionCases = (
    [`loading`, `ready`, `error`] as const
  ).flatMap((priorStatus) =>
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      ([`subscribe`, `snapshot`, `resume`] as const).map((admission) => ({
        priorStatus,
        syncMode,
        admission,
      })),
    ),
  )

  it.each(subscriberAdmissionCases)(
    `closes $admission admission during $priorStatus $syncMode cleanup`,
    async ({ priorStatus, syncMode, admission }) => {
      const cleanupGate = createDeferred<void>()
      let starts = 0
      let acquisitions = 0
      let callbackCount = 0
      const subscriberCounts: Array<number> = []
      const rows = new Map<number, Row>()
      let publish = () => {}
      const collection = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode,
        sync: {
          sync: ({ begin, write, commit, markReady, markError }) => {
            starts++
            publish = () => {
              begin()
              write({ type: `insert`, value: { id: 1, rank: starts } })
              commit()
            }
            if (priorStatus === `ready` || starts > 1) markReady()
            if (priorStatus === `error` && starts === 1) {
              markError(new Error(`initial source error`))
            }
            return {
              cleanup: () => cleanupGate.promise,
              loadSubset: () => {
                acquisitions++
                return true
              },
            }
          },
        },
      })
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      const subscribe = () => {
        subscription = collection.subscribeChanges(
          (changes) => {
            callbackCount++
            for (const change of changes) {
              if (change.type === `delete`) rows.delete(change.key)
              else {
                const { id, rank } = change.value
                rows.set(change.key, { id, rank })
              }
            }
          },
          {
            includeInitialState: admission !== `subscribe`,
            deferAcquisition: admission === `resume`,
          },
        )
      }
      const admit = () => {
        if (admission === `resume`) subscription!.resumeDeferredAcquisition()
        else subscribe()
      }
      const off = collection.on(`subscribers:change`, ({ subscriberCount }) => {
        subscriberCounts.push(subscriberCount)
      })

      await withOracleCleanup(async () => {
        collection.startSyncImmediate()
        const cleanup = collection.cleanup()
        // A deferring subscription starts no source work and may keep its
        // logical demand. Only its attempted resumption must be rejected.
        if (admission === `resume`) subscribe()
        // Deferred admission may report its local snapshot. The rejected
        // resumption must add no callback to that already-observed prefix.
        const callbacksBeforeAdmission = callbackCount
        const atStart = expectedCleanupBoundary(priorStatus, `cleanup-start`)
        expect(collection.status).toBe(atStart.collectionStatus)
        expect(observeRestartAdmission(admit)).toBe(atStart.restartAdmission)
        expect(collection.subscriberCount).toBe(0)
        expect(subscriberCounts).toEqual([])
        expect(callbackCount).toBe(callbacksBeforeAdmission)
        expect(acquisitions).toBe(0)
        expect(starts).toBe(1)
        if (admission === `resume`) {
          expect(subscription!.isDeferringAcquisition()).toBe(true)
        }

        cleanupGate.resolve()
        await cleanup
        const settled = expectedCleanupBoundary(
          priorStatus,
          `cleanup-settlement`,
        )
        expect(collection.status).toBe(settled.collectionStatus)
        expect(starts).toBe(1)
        expect(collection.subscriberCount).toBe(0)
        expect(callbackCount).toBe(callbacksBeforeAdmission)
        expect(observeRestartAdmission(admit)).toBe(settled.restartAdmission)
        expect(collection.subscriberCount).toBe(1)
        expect(starts).toBe(2)
        publish()
        expect([...rows.values()]).toEqual([{ id: 1, rank: 2 }])
      }, [
        () => cleanupGate.resolve(),
        () => subscription?.unsubscribe(),
        off,
        () => collection.cleanup(),
      ])
    },
  )

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

  it(`retains loading status at cleanup start, then admits restart`, async () => {
    const cleanupGate = createDeferred<void>()
    const statuses: Array<string> = []
    let starts = 0
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          if (starts > 1) markReady()
          return { cleanup: () => cleanupGate.promise }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      statuses.push(status)
    })

    try {
      collection.startSyncImmediate()
      expect(collection.status).toBe(`loading`)
      statuses.length = 0

      let cleanupSettled = false
      const cleanup = collection.cleanup().then(() => {
        cleanupSettled = true
      })
      const atCleanupStart = expectedCleanupBoundary(`loading`, `cleanup-start`)

      // A rule that forces ready at cleanup start fails at this held cut.
      expect(collection.status).toBe(atCleanupStart.collectionStatus)
      expect(statuses).toEqual([])
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupStart.cleanup,
      )
      expect(
        observeRestartAdmission(() => collection.startSyncImmediate()),
      ).toBe(atCleanupStart.restartAdmission)

      cleanupGate.resolve()
      await cleanup
      const atCleanupSettlement = expectedCleanupBoundary(
        `loading`,
        `cleanup-settlement`,
      )
      expect(collection.status).toBe(atCleanupSettlement.collectionStatus)
      expect(statuses).toEqual([`cleaned-up`])
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupSettlement.cleanup,
      )

      collection.startSyncImmediate()
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

  const lateEffectCases = ([`loading`, `ready`, `error`] as const).flatMap(
    (priorStatus) =>
      ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
        ([`first`, `second`] as const).map((cleaningPosition) => ({
          priorStatus,
          syncMode,
          cleaningPosition,
        })),
      ),
  )

  // Effects must retire at cleanup start, including when construction reaches
  // a source whose adapter cleanup is already pending. The same boundary model
  // requires a terminal dependent without partial subscription ownership.
  it.each(lateEffectCases)(
    `releases a late Effect during $priorStatus $syncMode cleanup of its $cleaningPosition source`,
    async ({ priorStatus, syncMode, cleaningPosition }) => {
      const cleanupGate = createDeferred<void>()
      let starts = 0
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode,
        sync: {
          sync: ({ markReady, markError }) => {
            starts++
            if (priorStatus === `ready` || starts > 1) markReady()
            if (priorStatus === `error` && starts === 1) {
              markError(new Error(`initial source error`))
            }
            return {
              cleanup: () => cleanupGate.promise,
              loadSubset: () => true,
            }
          },
        },
      })
      const healthySource = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      })
      source.createIndex((row) => row.id, { indexType: BasicIndex })
      healthySource.createIndex((row) => row.id, { indexType: BasicIndex })
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

      const firstSource = cleaningPosition === `first` ? source : healthySource
      const secondSource =
        cleaningPosition === `second` ? source : healthySource
      const errors: Array<string> = []
      let batches = 0
      const create = () =>
        createEffect({
          query: (q) =>
            q
              .from({ first: firstSource })
              .join(
                { second: secondSource },
                ({ first, second }) => eq(first.id, second.id),
                `inner`,
              ),
          onBatch: () => {
            batches++
          },
          onSourceError: (error) => {
            errors.push(error.message)
          },
        })
      let effect: ReturnType<typeof createEffect> | undefined
      await withOracleCleanup(async () => {
        source.startSyncImmediate()
        const cleanup = source.cleanup()
        effect = create()
        const atStart = expectedCleanupBoundary(priorStatus, `cleanup-start`)
        expect(observeDependent(!effect.disposed)).toBe(atStart.dependent)
        expect(source.status).toBe(atStart.collectionStatus)
        expect(source.subscriberCount).toBe(0)
        expect(healthySource.subscriberCount).toBe(0)
        expect(activeCleanupStartObservers).toBe(0)
        expect(batches).toBe(0)
        expect(errors).toEqual([
          `Source collection '${source.id}' was cleaned up while effect depends on it`,
        ])

        cleanupGate.resolve()
        await cleanup
        expect(effect.disposed).toBe(true)
        expect(source.subscriberCount).toBe(0)
        expect(healthySource.subscriberCount).toBe(0)
        // A later, explicit Effect construction is allowed. The retired Effect
        // stays disposed; neither cleanup settlement nor restart revives it.
        effect = create()
        expect(effect.disposed).toBe(false)
        expect(source.subscriberCount).toBe(1)
        expect(healthySource.subscriberCount).toBe(1)
        expect(activeCleanupStartObservers).toBeGreaterThan(0)
        expect(errors).toHaveLength(1)
      }, [
        () => cleanupGate.resolve(),
        () => effect?.dispose(),
        () => source.cleanup(),
        () => healthySource.cleanup(),
      ])
      expect(activeCleanupStartObservers).toBe(0)
    },
  )
})
