import { describe, expect, it } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  withCollectionSyncConfigCleanup,
} from '../src'
import { createDeferred } from '../src/deferred'
import type { SyncConfig } from '../src/types'

/**
 * Cleanup is a closed admission interval, not merely a final status value.
 *
 * Authority comes from the public `Collection.cleanup()` contract and the
 * cleanup term in the contributing glossary. This suite refines core
 * cleanup/restart admission; it does not establish full demand/replay
 * histories, provider transport shutdown, persistence-wrapper behavior, or
 * general row-publication laws.
 *
 * The history enters cleanup, re-enters start/preload from abort or release
 * callbacks, and may request nested cleanup. The model admits no replacement
 * owner until adapter cleanup settles and the terminal status publishes: every
 * earlier reentrant start must fail, the original load and release occur once,
 * and subscriber count reaches zero. A status listener may restart from that
 * terminal event before the public cleanup promise settles; awaiting cleanup
 * is the ordinary external restart boundary. Concurrent callers share the
 * promise. The observable cuts are the active run, retirement pending,
 * terminal publication, public retirement Promise settlement, and replacement
 * run. Rejection still finalizes the old run once, then rejects every waiter.
 * If adapter cleanup and local teardown both fail, the aggregate keeps the
 * adapter error primary and the local error as a secondary diagnostic. A lone
 * error keeps its identity. A later ordinary preload is a new generation and
 * must work.
 *
 * Counts, errors, status, rows, and ownership are all observed. Checking only
 * `cleaned-up` would miss leaked or duplicated physical resources.
 */

type Row = { id: number; rank: number }
const cleanupError = {
  name: `CollectionStateError`,
  message: expect.stringContaining(`after cleanup() completes`),
}

const cleanupAdmissionAxes = {
  boundary: [`abort`, `release`] as const,
  nestedCleanup: [false, true] as const,
  attempts: [1, 2] as const,
}

const cleanupAdmissionGrammar = cleanupAdmissionAxes.boundary.flatMap(
  (boundary) =>
    cleanupAdmissionAxes.nestedCleanup.flatMap((nestedCleanup) =>
      cleanupAdmissionAxes.attempts.map((attempts) => ({
        boundary,
        nestedCleanup,
        attempts,
      })),
    ),
)

async function withOracleCleanup<T>(
  body: () => T | Promise<T>,
  cleanups: Array<() => void | Promise<unknown>>,
): Promise<T> {
  let value: T | undefined
  const failures: Array<unknown> = []
  try {
    value = await body()
  } catch (error) {
    failures.push(error)
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `Cleanup oracle and teardown failed`, {
      cause: failures[0],
    })
  }
  return value as T
}

describe(`Collection cleanup oracle calibration`, () => {
  it(`enumerates every declared cleanup admission cell exactly once`, () => {
    const expectedCells =
      cleanupAdmissionAxes.boundary.length *
      cleanupAdmissionAxes.nestedCleanup.length *
      cleanupAdmissionAxes.attempts.length
    const keys = cleanupAdmissionGrammar.map(
      ({ boundary, nestedCleanup, attempts }) =>
        `${boundary}:${nestedCleanup}:${attempts}`,
    )

    expect(expectedCells).toBe(8)
    expect(cleanupAdmissionGrammar).toHaveLength(expectedCells)
    expect(new Set(keys)).toHaveLength(expectedCells)
    for (const key of keys) {
      expect(keys.filter((candidate) => candidate === key)).toHaveLength(1)
    }
  })

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

  it(`waits for source cleanup before publishing the restart boundary`, async () => {
    const cleanupGate = createDeferred<void>()
    let starts = 0
    let cleanups = 0
    let sourceCleanupSettled = false
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
        settlementOrder.push(`cleaned-up-event`)
      }
    })

    try {
      await collection.preload()
      statuses.length = 0

      const firstCleanup = collection.cleanup()
      const concurrentCleanup = collection.cleanup()
      void firstCleanup.then(() => {
        settlementOrder.push(`public-cleanup-promise-continuation`)
      })

      expect(sourceCleanupSettled).toBe(false)
      expect(collection.status).toBe(`ready`)
      expect(statuses).toEqual([])
      expect(cleanups).toBe(1)
      expect(concurrentCleanup).toBe(firstCleanup)
      expect(() => collection.startSyncImmediate()).toThrowError(
        expect.objectContaining(cleanupError),
      )

      cleanupGate.resolve()
      await Promise.all([firstCleanup, concurrentCleanup])

      expect(sourceCleanupSettled).toBe(true)
      expect(collection.status).toBe(`cleaned-up`)
      expect(statuses).toEqual([`cleaned-up`])
      expect(settlementOrder).toEqual([
        `adapter-cleanup-settled`,
        `cleaned-up-event`,
        `public-cleanup-promise-continuation`,
      ])

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

  it.each(cleanupAdmissionGrammar)(
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

  it.each(
    ([`event`, `await`] as const).flatMap((boundary) =>
      [false, true].map((liveQuery) => ({ boundary, liveQuery })),
    ),
  )(
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
