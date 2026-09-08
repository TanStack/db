import { describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index.js'
import { CollectionSubscription } from '../src/collection/subscription.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { flushPromises } from './utils'
import type { LoadSubsetOptions } from '../src/types.js'

describe(`CollectionSubscription status tracking`, () => {
  it.each([
    { terms: 2, values: [0, 0] },
    { terms: 2, values: [0] },
    { terms: 1, values: [0, 0] },
  ])(
    `rejects a $terms-term composite cursor before delivery or acquisition`,
    async ({ terms, values }) => {
      const load = vi.fn(() => true as const)
      const unload = vi.fn()
      const delivery = vi.fn()
      const observer = vi.fn()
      const collection = createCollection<{ id: string; rank: number }>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: `row`, rank: 1 } })
            commit()
            markReady()
            return { loadSubset: load, unloadSubset: unload }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const subscription = collection.subscribeChanges(delivery, {
        includeInitialState: false,
      })
      subscription.setOrderByIndex(index)
      const orderBy = Array.from({ length: terms }, () => ({
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc` as const, nulls: `first` as const },
      }))
      try {
        expect(() =>
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            minValues: values,
            onLoadSubsetResult: observer,
          }),
        ).toThrow(`Only single-column cursors are supported`)
        expect(delivery).not.toHaveBeenCalled()
        expect(load).not.toHaveBeenCalled()
        expect(observer).not.toHaveBeenCalled()
        expect(subscription.status).toBe(`ready`)
        // A rejected input must not consume local sent keys or an acquisition slot.
        subscription.requestLimitedSnapshot({
          orderBy: orderBy.slice(0, 1),
          limit: 1,
          minValues: [0],
        })
        expect(delivery).toHaveBeenCalledTimes(1)
        expect(load).toHaveBeenCalledTimes(1)
        expect(load.mock.calls[0]).toBeDefined()
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
      expect(unload).toHaveBeenCalledTimes(1)
    },
  )

  it(`subscription starts with status 'ready'`, () => {
    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {})

    expect(subscription.status).toBe(`ready`)
    subscription.unsubscribe()
  })

  it(`status changes to 'loadingSubset' when requestSnapshot triggers a promise`, async () => {
    let resolveLoadSubset: () => void
    const loadSubsetPromise = new Promise<void>((resolve) => {
      resolveLoadSubset = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => loadSubsetPromise,
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    expect(subscription.status).toBe(`ready`)

    // Trigger a snapshot request that will call loadSubset
    subscription.requestSnapshot({ optimizedOnly: false })

    // Status should now be loadingSubset
    expect(subscription.status).toBe(`loadingSubset`)

    // Resolve the load more promise
    resolveLoadSubset!()
    await flushPromises()

    // Status should be back to ready
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
  })

  it(`status changes back to 'ready' when promise resolves`, async () => {
    let resolveLoadSubset: () => void
    const loadSubsetPromise = new Promise<void>((resolve) => {
      resolveLoadSubset = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => loadSubsetPromise,
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ optimizedOnly: false })
    expect(subscription.status).toBe(`loadingSubset`)

    resolveLoadSubset!()
    await flushPromises()

    expect(subscription.status).toBe(`ready`)
    subscription.unsubscribe()
  })

  it(`concurrent promises keep status as 'loadingSubset' until all resolve`, async () => {
    let resolveLoadSubset1: () => void
    let resolveLoadSubset2: () => void
    let callCount = 0

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              callCount++
              if (callCount === 1) {
                return new Promise<void>((resolve) => {
                  resolveLoadSubset1 = resolve
                })
              } else {
                return new Promise<void>((resolve) => {
                  resolveLoadSubset2 = resolve
                })
              }
            },
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    // Trigger first load
    subscription.requestSnapshot({ optimizedOnly: false })
    expect(subscription.status).toBe(`loadingSubset`)

    // Trigger second load
    subscription.requestSnapshot({ optimizedOnly: false })
    expect(subscription.status).toBe(`loadingSubset`)

    // Resolve first promise
    resolveLoadSubset1!()
    await flushPromises()

    // Should still be loading because second promise is pending
    expect(subscription.status).toBe(`loadingSubset`)

    // Resolve second promise
    resolveLoadSubset2!()
    await flushPromises()

    // Now should be ready
    expect(subscription.status).toBe(`ready`)
    subscription.unsubscribe()
  })

  it(`emits 'status:change' event`, async () => {
    let resolveLoadSubset: () => void
    const loadSubsetPromise = new Promise<void>((resolve) => {
      resolveLoadSubset = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => loadSubsetPromise,
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    const statusChanges: Array<{ previous: string; current: string }> = []

    subscription.on(`status:change`, (event) => {
      statusChanges.push({
        previous: event.previousStatus,
        current: event.status,
      })
    })

    subscription.requestSnapshot({ optimizedOnly: false })
    await flushPromises()

    expect(statusChanges).toHaveLength(1)
    expect(statusChanges[0]).toEqual({
      previous: `ready`,
      current: `loadingSubset`,
    })

    resolveLoadSubset!()
    await flushPromises()

    expect(statusChanges).toHaveLength(2)
    expect(statusChanges[1]).toEqual({
      previous: `loadingSubset`,
      current: `ready`,
    })

    subscription.unsubscribe()
  })

  it.each(
    ([`generic`, `specific`] as const).flatMap((eventKind) =>
      ([`clean`, `throw`] as const).map((releaseKind) => ({
        eventKind,
        releaseKind,
      })),
    ),
  )(
    `stops status delivery when a $eventKind loading listener unsubscribes with $releaseKind cleanup`,
    async ({ eventKind, releaseKind }) => {
      const pending = createDeferred<void>()
      const releaseFailure = new Error(`release failed during status callback`)
      const deferredMicrotasks: Array<VoidFunction> = []
      const queueMicrotaskSpy = vi
        .spyOn(globalThis, `queueMicrotask`)
        .mockImplementation((callback) => deferredMicrotasks.push(callback))
      const collection = createCollection<{ id: string }>({
        id: `unsubscribe-during-${eventKind}-loading-status-${releaseKind}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => pending.promise,
              unloadSubset: () => {
                if (releaseKind === `throw`) throw releaseFailure
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const eventsAfterTeardown: Array<string> = []
      let teardownStarted = false
      const unsubscribeOnLoading = () => {
        teardownStarted = true
        subscription.unsubscribe()
      }
      const recordAfterTeardown = (event: { status: string }) => {
        if (teardownStarted) eventsAfterTeardown.push(event.status)
      }

      if (eventKind === `generic`) {
        subscription.on(`status:change`, ({ status }) => {
          if (status === `loadingSubset`) unsubscribeOnLoading()
        })
        subscription.on(`status:change`, recordAfterTeardown)
      } else {
        subscription.on(`status:loadingSubset`, unsubscribeOnLoading)
        subscription.on(`status:loadingSubset`, recordAfterTeardown)
        subscription.on(`status:change`, recordAfterTeardown)
      }

      try {
        subscription.requestSnapshot({ optimizedOnly: false })
        expect(eventsAfterTeardown).toEqual([])
        expect(collection.subscriberCount).toBe(0)
        expect(deferredMicrotasks).toHaveLength(releaseKind === `throw` ? 1 : 0)
        if (releaseKind === `throw`) {
          expect(() => deferredMicrotasks[0]!()).toThrow(releaseFailure)
        }

        pending.resolve()
        await flushPromises()
        expect(eventsAfterTeardown).toEqual([])
      } finally {
        queueMicrotaskSpy.mockRestore()
        await collection.cleanup()
      }
    },
  )

  it(`unsubscribes once when an unsubscribed listener reenters`, async () => {
    const deferredMicrotasks: Array<VoidFunction> = []
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, `queueMicrotask`)
      .mockImplementation((callback) => deferredMicrotasks.push(callback))
    const collection = createCollection<{ id: string }>({
      id: `reentrant-unsubscribed-event`,
      getKey: ({ id }) => id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let events = 0
    subscription.on(`unsubscribed`, () => {
      events++
      if (events === 1) subscription.unsubscribe()
    })

    try {
      subscription.unsubscribe()

      expect(events).toBe(1)
      expect(collection.subscriberCount).toBe(0)
      expect(deferredMicrotasks).toEqual([])
    } finally {
      queueMicrotaskSpy.mockRestore()
      await collection.cleanup()
    }
  })

  it(`promise rejection still cleans up and sets status back to 'ready'`, async () => {
    let rejectLoadSubset: (error: Error) => void
    const loadSubsetPromise = new Promise<void>((_, reject) => {
      rejectLoadSubset = reject
    })
    // Attach catch handler before rejecting to avoid unhandled rejection
    const handledPromise = loadSubsetPromise.catch(() => {})

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => handledPromise,
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ optimizedOnly: false })
    expect(subscription.status).toBe(`loadingSubset`)

    // Reject the promise
    rejectLoadSubset!(new Error(`Load failed`))
    await flushPromises()

    // Status should still be back to ready
    expect(subscription.status).toBe(`ready`)
    subscription.unsubscribe()
  })

  it(`records the last rejected subset load without hiding ready data`, async () => {
    const error = new Error(`incremental subset failed`)
    const collection = createCollection<{ id: string; value: string }>({
      id: `subset-error-recording`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: { id: `cached`, value: `available` },
          })
          commit()
          markReady()
          return {
            loadSubset: () => Promise.reject(error),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const failures: Array<unknown> = []
    subscription.on(`loadSubset:error`, (event) => failures.push(event.error))

    subscription.requestSnapshot({ optimizedOnly: false })
    await flushPromises()

    expect(subscription.status).toBe(`ready`)
    expect(collection.get(`cached`)).toMatchObject({ value: `available` })
    expect(subscription.lastError).toBe(error)
    expect(failures).toEqual([error])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`records a synchronously thrown subset failure`, async () => {
    const error = new Error(`synchronous subset failure`)
    const collection = createCollection<{ id: string }>({
      id: `synchronous-subset-error`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              throw error
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const failures: Array<unknown> = []
    subscription.on(`loadSubset:error`, (event) => failures.push(event.error))

    expect(() =>
      subscription.requestSnapshot({ optimizedOnly: false }),
    ).toThrow(error)
    expect(subscription.lastError).toBe(error)
    expect(failures).toEqual([error])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`does not unload a subset when loadSubset throws before acquisition`, async () => {
    const failure = new Error(`subset failed before acquisition`)
    const unloadedOptions: Array<unknown> = []
    const collection = createCollection<{ id: string }>({
      id: `failed-subset-acquisition`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              throw failure
            },
            unloadSubset: (options) => unloadedOptions.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    expect(() =>
      subscription.requestSnapshot({ optimizedOnly: false }),
    ).toThrow(failure)
    subscription.unsubscribe()

    expect(unloadedOptions).toEqual([])
    await collection.cleanup()
  })

  it(`releases a subset when its load-result observer throws`, async () => {
    const failure = new Error(`load-result observer failed`)
    let acquiredOptions: unknown
    const unloadedOptions: Array<unknown> = []
    const collection = createCollection<{ id: string }>({
      id: `subset-observer-failure`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              acquiredOptions = options
              return true
            },
            unloadSubset: (options) => unloadedOptions.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    expect(() =>
      subscription.requestSnapshot({
        optimizedOnly: false,
        onLoadSubsetResult: () => {
          throw failure
        },
      }),
    ).toThrow(failure)
    subscription.unsubscribe()

    expect(unloadedOptions).toEqual([acquiredOptions])
    await collection.cleanup()
  })

  it.each([
    { position: `failed-first`, nestedCleanup: `clean` },
    { position: `failed-first`, nestedCleanup: `throw` },
    { position: `failed-last`, nestedCleanup: `clean` },
    { position: `failed-last`, nestedCleanup: `throw` },
  ] as const)(
    `re-finds the $position demand after reentrant $nestedCleanup cleanup`,
    async ({ position, nestedCleanup }) => {
      const primaryFailure = new Error(`request failed after acquisition`)
      const cleanupFailure = new Error(`nested cleanup failed`)
      const loaded: Array<LoadSubsetOptions> = []
      const unloaded: Array<LoadSubsetOptions> = []
      const reported: Array<unknown> = []
      let caughtCleanup: unknown
      const collection = createCollection<{ id: string }>({
        id: `reentrant-primary-release-${position}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loaded.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloaded.push(options)
                if (
                  nestedCleanup === `throw` &&
                  options === loaded[0] &&
                  unloaded.filter((entry) => entry === loaded[0]).length === 1
                ) {
                  throw cleanupFailure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const firstWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`first`),
      ])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`second`),
      ])
      let releaseFirst:
        | ((primaryFailure?: { error: unknown }) => void)
        | undefined
      let releaseSecond:
        | ((primaryFailure?: { error: unknown }) => void)
        | undefined

      subscription.requestSnapshot({
        where: firstWhere,
        onLoadSubsetResult: (_result, _options, release) => {
          releaseFirst = release
        },
      })
      subscription.requestSnapshot({
        where: secondWhere,
        onLoadSubsetResult: (_result, _options, release) => {
          releaseSecond = release
        },
      })
      subscription.on(`loadSubset:error`, ({ error }) => {
        reported.push(error)
        try {
          subscription.releaseSnapshot(firstWhere)
        } catch (cleanupError) {
          caughtCleanup = cleanupError
        }
      })

      if (position === `failed-first`) {
        releaseFirst!({ error: primaryFailure })
        expect(unloaded).toEqual([loaded[0]])
      } else {
        releaseSecond!({ error: primaryFailure })
        expect(unloaded).toEqual([loaded[0], loaded[1]])
      }
      expect(subscription.lastError).toBe(primaryFailure)
      expect(reported).toEqual([primaryFailure])
      expect(caughtCleanup).toBe(
        nestedCleanup === `throw` ? cleanupFailure : undefined,
      )

      subscription.unsubscribe()
      expect(unloaded).toEqual([loaded[0], loaded[1]])
      expect(subscription.lastError).toBe(primaryFailure)
      expect(reported).toEqual([primaryFailure])
      await collection.cleanup()
    },
  )

  it.each([`releaseSnapshot`, `unsubscribe`] as const)(
    `attempts a failed exact release only once through %s`,
    async (releaseMode) => {
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const failure = new Error(`release failed`)
      const collection = createCollection<{ id: string }>({
        id: `failed-exact-release-${releaseMode}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: false,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return Promise.resolve()
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (unloads.length === 1) throw failure
              },
            }
          },
        },
      })
      expect(collection._deferSyncStart()).toBe(true)
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const where = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`requested`),
      ])

      try {
        subscription.requestSnapshot({
          where,
          limit: 1,
          optimizedOnly: false,
        })
        collection._resumeSyncStart()
        await flushPromises()

        expect(loads).toHaveLength(1)
        const firstRelease = () =>
          releaseMode === `releaseSnapshot`
            ? subscription.releaseSnapshot(where)
            : subscription.unsubscribe()
        expect(firstRelease).toThrow(failure)
        expect(() => subscription.unsubscribe()).not.toThrow()
        expect(unloads).toEqual([loads[0]])

        subscription.unsubscribe()
        expect(unloads).toHaveLength(1)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`before`, `after`] as const).flatMap((throwAt) =>
      [false, true].map((reenter) => ({ throwAt, reenter })),
    ),
  )(
    `bounds throwing adapter cleanup at $throwAt release, reentry=$reenter`,
    async ({ throwAt, reenter }) => {
      const failure = new Error(`adapter cleanup failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const externalLeases = new Set<LoadSubsetOptions>()
      let dispose = () => {}
      const collection = createCollection<{ id: string }>({
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                externalLeases.add(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (options === loads[0]) {
                  if (reenter) dispose()
                  if (throwAt === `before`) throw failure
                  externalLeases.delete(options)
                  throw failure
                }
                externalLeases.delete(options)
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      dispose = () => subscription.unsubscribe()
      try {
        subscription.requestSnapshot({ where: new Value(true) })
        subscription.requestSnapshot({ where: new Value(false) })
        expect(dispose).toThrow(failure)
        expect(dispose).not.toThrow()
        expect(unloads).toEqual(loads)
        expect(loads).toHaveLength(2)
        expect(loads.every(({ signal }) => signal?.aborted)).toBe(true)
        expect(collection.subscriberCount).toBe(0)
        expect(subscription.lastError).toBe(failure)
        // Intentional support boundary: core cannot repair an adapter that throws
        // before freeing its resource, nor safely repeat a possibly completed release.
        expect([...externalLeases]).toEqual(
          throwAt === `before` ? [loads[0]] : [],
        )
      } finally {
        dispose()
        await collection.cleanup()
      }
    },
  )

  it(`preserves a primary error across reentrant teardown failure`, async () => {
    const primaryFailure = new Error(`request failed after acquisition`)
    const cleanupFailure = new Error(`teardown failed`)
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const reported: Array<unknown> = []
    let releaseFailedDemand:
      | ((primaryFailure?: { error: unknown }) => void)
      | undefined
    let cleanupAttempts = 0
    let caughtCleanup: unknown
    const collection = createCollection<{ id: string }>({
      id: `primary-error-reentrant-teardown`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[0] && cleanupAttempts++ === 0) {
                throw cleanupFailure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where: new Value(true) })
    subscription.requestSnapshot({
      where: new Value(false),
      onLoadSubsetResult: (_result, _options, release) => {
        releaseFailedDemand = release
      },
    })
    subscription.on(`loadSubset:error`, ({ error }) => {
      reported.push(error)
      if (error !== primaryFailure) return
      try {
        subscription.unsubscribe()
      } catch (cleanupError) {
        caughtCleanup = cleanupError
      }
    })

    releaseFailedDemand!({ error: primaryFailure })

    expect(caughtCleanup).toBe(cleanupFailure)
    expect(reported).toEqual([primaryFailure])
    expect(subscription.lastError).toBe(primaryFailure)
    expect(unloads).toEqual([loads[0], loads[1]])

    subscription.unsubscribe()
    expect(unloads).toEqual([loads[0], loads[1]])
    expect(subscription.lastError).toBe(primaryFailure)
    await collection.cleanup()
  })

  it.each([`sync`, `async`, `replay`] as const)(
    `preserves a %s adapter error across reentrant teardown failure`,
    async (failureMode) => {
      const primaryFailure = new Error(`${failureMode} load failed`)
      const cleanupFailure = new Error(`teardown failed`)
      const victimWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`victim`),
      ])
      const failedWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`failed`),
      ])
      const loads: Array<LoadSubsetOptions> = []
      const reported: Array<unknown> = []
      let truncateSource = () => {}
      let cleanupAttempts = 0
      let caughtCleanup: unknown
      let deliveringPrimary = false
      const collection = createCollection<{ id: string }>({
        id: `primary-${failureMode}-reentrant-teardown`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, commit, markReady, truncate }) => {
            truncateSource = () => {
              begin()
              truncate()
              commit()
            }
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                const shouldFail =
                  failureMode === `replay`
                    ? loads.length === 4
                    : loads.length === 2
                if (!shouldFail) return true
                if (failureMode === `sync`) throw primaryFailure
                return Promise.reject(primaryFailure)
              },
              unloadSubset: () => {
                if (deliveringPrimary && cleanupAttempts++ === 0) {
                  throw cleanupFailure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => {
        reported.push(error)
        if (error !== primaryFailure) return
        deliveringPrimary = true
        try {
          subscription.releaseSnapshot(victimWhere)
        } catch (cleanupError) {
          caughtCleanup = cleanupError
        } finally {
          deliveringPrimary = false
        }
      })

      try {
        subscription.requestSnapshot({ where: victimWhere })
        if (failureMode === `replay`) {
          subscription.requestSnapshot({ where: failedWhere })
          truncateSource()
        } else {
          const request = () =>
            subscription.requestSnapshot({ where: failedWhere })
          if (failureMode === `sync`) {
            expect(request).toThrow(primaryFailure)
          } else {
            request()
          }
        }
        await flushPromises()

        expect(caughtCleanup).toBe(cleanupFailure)
        expect(reported).toEqual([primaryFailure])
        expect(subscription.lastError).toBe(primaryFailure)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`does not unload a synchronous acquisition that never started`, async () => {
    const failure = new Error(`load failed before acquisition`)
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`failed`)])
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<{ id: string }>({
      id: `reentrant-failed-start-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              throw failure
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.on(`loadSubset:error`, ({ error }) => {
      if (error === failure) subscription.releaseSnapshot(where)
    })

    try {
      expect(() => subscription.requestSnapshot({ where })).toThrow(failure)
      expect(unloads).toEqual([])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not replay a logically retired demand after its unload fails`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const releaseError = new Error(`release failed`)
    let allowUnload = false
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const collection = createCollection<{ id: string }>({
      id: `failed-release-is-not-replayed`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return Promise.resolve()
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (!allowUnload && options === loads[0]) throw releaseError
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`first`)])
    const secondWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`second`),
    ])

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      await flushPromises()

      expect(() => subscription.releaseSnapshot(firstWhere)).toThrow(
        releaseError,
      )

      begin()
      truncate()
      commit()
      await flushPromises()

      // The release attempt retired the demand, even though the adapter threw.
      // It must not join later replays or be released a second time.
      expect(loads).toHaveLength(3)
      expect(loads[2]?.where).toBe(secondWhere)
    } finally {
      allowUnload = true
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retires pending status per demand even when physical cleanup fails`, async () => {
    const firstLoad = createDeferred<void>()
    const secondLoad = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const releaseError = new Error(`release failed`)
    let firstReleaseAttempts = 0
    const collection = createCollection<{ id: string }>({
      id: `retired-pending-status-and-cleanup-debt`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? firstLoad.promise : secondLoad.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[0] && ++firstReleaseAttempts < 3) {
                throw releaseError
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`first`)])
    const secondWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`second`),
    ])

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      expect(subscription.status).toBe(`loadingSubset`)

      expect(() => subscription.releaseSnapshot(firstWhere)).toThrow(
        releaseError,
      )
      expect(subscription.status).toBe(`loadingSubset`)

      secondLoad.resolve()
      await flushPromises()
      expect(subscription.status).toBe(`ready`)

      expect(() => subscription.unsubscribe()).not.toThrow()
      expect(() => subscription.unsubscribe()).not.toThrow()
      expect(unloads).toEqual([loads[0], loads[1]])
    } finally {
      firstLoad.resolve()
      secondLoad.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`attempts both leases once when throwing cleanup reenters teardown`, async () => {
    const releaseFailure = new Error(`release failed`)
    const duplicateFailure = new Error(`duplicate release`)
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const attempts = new Map<LoadSubsetOptions, number>()
    const collection = createCollection<{ id: string }>({
      id: `reentrant-cleanup-debt-retirement`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              const attempt = (attempts.get(options) ?? 0) + 1
              attempts.set(options, attempt)
              if (attempt > 1) throw duplicateFailure
              if (options === loads[0]) {
                subscription.unsubscribe()
              }
              throw releaseFailure
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`first`)])
    const secondWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`second`),
    ])

    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: secondWhere })
      expect(() => subscription.releaseSnapshot(firstWhere)).toThrow(
        releaseFailure,
      )
      expect(() => subscription.releaseSnapshot(secondWhere)).not.toThrow()
      expect(() => subscription.unsubscribe()).not.toThrow()
      expect(unloads).toEqual([loads[0], loads[1]])
      expect(collection.subscriberCount).toBe(0)

      subscription.unsubscribe()
      expect(unloads).toHaveLength(2)
    } finally {
      try {
        subscription.unsubscribe()
      } catch {
        // Keep cleanup available after a red assertion.
      }
      await collection.cleanup()
    }
  })

  it.each([`sync`, `async`] as const)(
    `reopens a failed %s replay only after its last logical demand retires`,
    async (failureMode) => {
      const failure = new Error(`replay failed`)
      let begin!: () => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      let replayStarts = 0
      let replaySuccesses = 0
      const collection = createCollection<{ id: string }>({
        id: `failed-replay-logical-demand-cardinality-${failureMode}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                loadCount += 1
                if (loadCount <= 2) return true
                if (failureMode === `sync`) throw failure
                return Promise.reject(failure)
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
        truncateReplayPublication: {
          start: () => {
            replayStarts += 1
          },
          succeed: () => {
            replaySuccesses += 1
          },
        },
      })
      const firstWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`first`),
      ])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`second`),
      ])

      try {
        subscription.requestSnapshot({
          where: firstWhere,
          optimizedOnly: false,
        })
        subscription.requestSnapshot({
          where: secondWhere,
          optimizedOnly: false,
        })

        begin()
        truncate()
        commit()
        await flushPromises()
        expect(loadCount).toBe(4)
        expect(replayStarts).toBe(1)
        expect(replaySuccesses).toBe(0)

        subscription.releaseSnapshot(firstWhere)
        expect(replaySuccesses).toBe(0)

        subscription.releaseSnapshot(secondWhere)
        expect(replaySuccesses).toBe(1)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`attempts the exact in-flight replay release once`, async () => {
    const replay = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const failure = new Error(`replay release failed`)
    let failed = false
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const collection = createCollection<{ id: string }>({
      id: `failed-replay-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? Promise.resolve() : replay.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[1] && !failed) {
                failed = true
                throw failure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      await flushPromises()
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loads).toHaveLength(2)
      expect(() => subscription.unsubscribe()).toThrow(failure)
      expect(() => subscription.unsubscribe()).not.toThrow()
      expect(unloads.filter((options) => options === loads[0])).toEqual([
        loads[0],
      ])
      expect(unloads.filter((options) => options === loads[1])).toEqual([
        loads[1],
      ])
    } finally {
      replay.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each(
    ([`direct`, `deferred`] as const).flatMap((start) =>
      ([`return`, `resolve`] as const).map((result) => ({
        name: `${start} ${result}`,
        start,
        result,
      })),
    ),
  )(
    `publishes ownership before a reentrant unsubscribe: $name`,
    async ({ start, result }) => {
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let unsubscribeDuringLoad = () => {}
      const collection = createCollection<{ id: string }>({
        id: `reentrant-ownership-${start}-${result}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: start === `direct`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                unsubscribeDuringLoad()
                return result === `return` ? true : Promise.resolve()
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      if (start === `deferred`) expect(collection._deferSyncStart()).toBe(true)
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      unsubscribeDuringLoad = () => subscription.unsubscribe()

      try {
        subscription.requestSnapshot({ limit: 1, optimizedOnly: false })
        if (start === `deferred`) collection._resumeSyncStart()
        await flushPromises()

        expect(loads).toHaveLength(1)
        expect(unloads).toEqual([loads[0]])
        subscription.unsubscribe()
        expect(unloads).toHaveLength(1)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`does not register a subscription closed during its automatic snapshot`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const onChange = vi.fn()
    let writeAfterUnsubscribe = () => {}
    const collection = createCollection<{ id: string }>({
      id: `closed-during-automatic-snapshot`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          writeAfterUnsubscribe = () => {
            begin()
            write({ type: `insert`, value: { id: `later` } })
            commit()
          }
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (!(options.subscription instanceof CollectionSubscription)) {
                throw new Error(`automatic snapshot requires its subscription`)
              }
              options.subscription.unsubscribe()
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(onChange, {
      includeInitialState: true,
    })

    expect(loads).toHaveLength(1)
    expect(unloads).toEqual(loads)
    expect(collection.subscriberCount).toBe(0)
    writeAfterUnsubscribe()
    expect(onChange).not.toHaveBeenCalled()

    subscription.unsubscribe()
    expect(unloads).toHaveLength(1)
    await collection.cleanup()
  })

  it(`does not deliver a direct snapshot after adapter work unsubscribes`, async () => {
    type Row = { id: string; rank: number }
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const callbacks: Array<Array<string>> = []
    let unsubscribeDuringLoad = () => {}
    const collection = createCollection<Row>({
      id: `direct-snapshot-reentrant-unsubscribe`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `row`, rank: 1 } })
          commit()
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              unsubscribeDuringLoad()
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges((changes) => {
      callbacks.push(changes.map(({ value }) => value.id))
    })
    unsubscribeDuringLoad = () => subscription.unsubscribe()

    try {
      subscription.requestSnapshot({ optimizedOnly: false })

      expect(callbacks).toEqual([])
      expect(loads).toHaveLength(1)
      expect(unloads).toEqual([loads[0]])

      subscription.requestSnapshot({ optimizedOnly: false })
      expect(callbacks).toEqual([])
      expect(loads).toHaveLength(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not continue a direct snapshot after its result hook unsubscribes`, async () => {
    type Row = { id: string }
    const callbacks: Array<Array<string>> = []
    const collection = createCollection<Row>({
      id: `direct-result-hook-unsubscribe`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `row` } })
          commit()
          markReady()
          return { loadSubset: () => true }
        },
      },
    })
    const subscription = collection.subscribeChanges((changes) => {
      callbacks.push(changes.map(({ value }) => value.id))
    })

    try {
      subscription.requestSnapshot({
        optimizedOnly: false,
        onLoadSubsetResult: () => subscription.unsubscribe(),
      })

      expect(callbacks).toEqual([])
      expect(subscription.status).toBe(`ready`)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not continue an unoptimized snapshot after its hook unsubscribes`, async () => {
    type Row = { id: string }
    const callbacks: Array<Array<string>> = []
    const collection = createCollection<Row>({
      id: `direct-unoptimized-hook-unsubscribe`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `row` } })
          commit()
          markReady()
          return { loadSubset: () => true }
        },
      },
    })
    const subscription = collection.subscribeChanges((changes) => {
      callbacks.push(changes.map(({ value }) => value.id))
    })

    try {
      subscription.requestSnapshot({
        where: new Func(`eq`, [new PropRef([`id`]), new Value(`row`)]),
        onUnoptimized: () => subscription.unsubscribe(),
      })

      expect(callbacks).toEqual([])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not start limited adapter work after local delivery unsubscribes`, async () => {
    type Row = { id: string; rank: number }
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `limited-snapshot-reentrant-unsubscribe`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `row`, rank: 1 } })
          commit()
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const subscription: CollectionSubscription = collection.subscribeChanges(
      () => subscription.unsubscribe(),
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
        limit: 1,
      })

      expect(loads).toEqual([])
      expect(unloads).toEqual([])

      subscription.requestLimitedSnapshot({
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
        limit: 1,
      })
      expect(loads).toEqual([])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not observe limited adapter work after it unsubscribes`, async () => {
    type Row = { id: string; rank: number }
    const pending = createDeferred<void>()
    let resultCallbacks = 0
    const collection = createCollection<Row>({
      id: `limited-adapter-unsubscribe`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              subscription.unsubscribe()
              return pending.promise
            },
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const subscription: CollectionSubscription = collection.subscribeChanges(
      () => {},
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
        limit: 1,
        onLoadSubsetResult: () => resultCallbacks++,
      })

      expect(resultCallbacks).toBe(0)
      expect(subscription.status).toBe(`ready`)
    } finally {
      pending.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not release one acquisition twice during nested unsubscribe`, async () => {
    const unloads: Array<LoadSubsetOptions> = []
    let reentered = false
    const collection = createCollection<{ id: string }>({
      id: `nested-unsubscribe-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: (options) => {
              unloads.push(options)
              if (!reentered) {
                reentered = true
                subscription.unsubscribe()
              }
            },
          }
        },
      },
    })
    const subscription: CollectionSubscription = collection.subscribeChanges(
      () => {},
      {
        includeInitialState: false,
      },
    )

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      subscription.unsubscribe()

      expect(unloads).toHaveLength(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each(
    ([false, true] as const).flatMap((adapterCatches) =>
      ([`return`, `resolve`] as const).map((result) => ({
        name: `${adapterCatches ? `caught` : `escaped`} ${result}`,
        adapterCatches,
        result,
      })),
    ),
  )(
    `attempts a deferred failed release once after adapter startup: $name`,
    async ({ adapterCatches, result }) => {
      const failure = new Error(`reentrant release failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let observedReleaseError: unknown
      let unsubscribeDuringLoad = () => {}
      const collection = createCollection<{ id: string }>({
        id: `reentrant-release-${adapterCatches}-${result}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (adapterCatches) {
                  try {
                    unsubscribeDuringLoad()
                  } catch (error) {
                    observedReleaseError = error
                  }
                } else {
                  unsubscribeDuringLoad()
                }
                return result === `return` ? true : Promise.resolve()
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (unloads.length === 1) throw failure
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      unsubscribeDuringLoad = () => subscription.unsubscribe()

      try {
        const request = () =>
          subscription.requestSnapshot({ limit: 1, optimizedOnly: false })
        expect(request).toThrow(failure)
        expect(observedReleaseError).toBeUndefined()
        await flushPromises()

        expect(unloads).toEqual([loads[0]])
        expect(() => subscription.unsubscribe()).not.toThrow()
        expect(unloads).toEqual([loads[0]])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`releases each acquisition once when synchronous replay drops its demand`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`requested`)])
    let replay = () => {}
    let releaseDuringReplay = () => {}
    const collection = createCollection<{ id: string }>({
      id: `synchronous-replay-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, commit, markReady, truncate }) => {
          replay = () => {
            begin()
            truncate()
            commit()
          }
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 2) releaseDuringReplay()
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    releaseDuringReplay = () => subscription.releaseSnapshot(where)

    try {
      subscription.requestSnapshot({ where, optimizedOnly: false })
      replay()
      await flushPromises()

      expect(loads).toHaveLength(2)
      expect(unloads.map((options) => loads.indexOf(options)).sort()).toEqual([
        0, 1,
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`reports a rejected subset replay after truncate`, async () => {
    const error = new Error(`truncate replay failed`)
    let truncateSource: () => void = () => {
      throw new Error(`source has not started`)
    }
    let loadCount = 0
    const collection = createCollection<{ id: string }>({
      id: `truncate-subset-error`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, commit, markReady, truncate }) => {
          markReady()
          truncateSource = () => {
            begin()
            truncate()
            commit()
          }
          return {
            loadSubset: () => {
              loadCount++
              return loadCount === 1 ? Promise.resolve() : Promise.reject(error)
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const failures: Array<unknown> = []
    subscription.on(`loadSubset:error`, (event) => failures.push(event.error))

    subscription.requestSnapshot({ optimizedOnly: false })
    await flushPromises()
    truncateSource()
    await flushPromises()

    expect(subscription.status).toBe(`ready`)
    expect(subscription.lastError).toBe(error)
    expect(failures).toEqual([error])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`waits for every logical demand that shares one replay promise`, async () => {
    type Row = { id: string; value: number }
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    let transportCalls = 0
    const dedupe = new DeduplicatedLoadSubset({
      loadSubset: () => {
        transportCalls++
        if (transportCalls === 1) {
          begin()
          write({ type: `insert`, value: { id: `one`, value: 1 } })
          commit()
          return Promise.resolve()
        }
        return replay.promise
      },
    })
    const collection = createCollection<Row>({
      id: `shared-replay-promise`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: dedupe.loadSubset,
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, Row>()
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else visible.set(change.key, change.value)
        }
      },
      { includeInitialState: false },
    )
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])

    try {
      subscription.requestSnapshot({ where })
      await flushPromises()
      subscription.requestSnapshot({ where })
      expect(transportCalls).toBe(1)
      expect(
        [...visible.values()].map(({ id, value }) => ({ id, value })),
      ).toEqual([{ id: `one`, value: 1 }])

      dedupe.reset()
      begin()
      truncate()
      commit()
      await flushPromises()
      // Replay creates a fresh abortable acquisition for each logical demand,
      // even when the adapter happens to return the same promise for both.
      expect(transportCalls).toBe(3)

      subscription.releaseSnapshot(where)
      const failure = new Error(`shared replay failed`)
      replay.reject(failure)
      await flushPromises()

      expect(subscription.lastError).toBe(failure)
      expect(
        [...visible.values()].map(({ id, value }) => ({ id, value })),
      ).toEqual([{ id: `one`, value: 1 }])
    } finally {
      replay.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps replacement ownership when retiring the old lease fails`, async () => {
    const replay = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let truncate!: () => void
    let begin!: () => void
    let commit!: () => void
    const collection = createCollection<{ id: string }>({
      id: `failed-replay-lease-replacement`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? true : replay.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[0] && unloads.length === 1) {
                throw new Error(`old lease release failed`)
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let unsubscribed = false

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loads).toHaveLength(2)
      expect(subscription.status).toBe(`loadingSubset`)
      expect(loads[1]?.signal?.aborted).toBe(true)
      expect(unloads).toEqual([loads[0]])

      replay.reject(new DOMException(`replacement abandoned`, `AbortError`))
      await flushPromises()
      expect(subscription.status).toBe(`ready`)
      expect(subscription.lastError).toEqual(
        new Error(`old lease release failed`),
      )

      subscription.unsubscribe()
      unsubscribed = true
      expect(unloads).toEqual([loads[0], loads[1]])
    } finally {
      replay.resolve()
      if (!unsubscribed) subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not become ready while replay setup still has a surviving demand`, async () => {
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const firstReplay = createDeferred<void>()
    const statusEvents: Array<{ status: string; loadCount: number }> = []
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const collection = createCollection<{ id: string }>({
      id: `replay-setup-readiness`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              return loadCount > 2 && options.where === firstWhere
                ? firstReplay.promise
                : true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let releaseFirstReplay = false
    subscription.on(`status:change`, ({ status }) => {
      statusEvents.push({ status, loadCount })
      if (releaseFirstReplay && status === `loadingSubset`) {
        releaseFirstReplay = false
        subscription.releaseSnapshot(firstWhere)
      }
    })

    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: secondWhere })
      releaseFirstReplay = true
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loadCount).toBe(3)
      expect(subscription.status).toBe(`ready`)
      expect(statusEvents).toEqual([
        { status: `loadingSubset`, loadCount: 2 },
        { status: `ready`, loadCount: 3 },
      ])
    } finally {
      firstReplay.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not publish a pending replay after collection cleanup`, async () => {
    type Row = { id: string; version: number }
    const replay = createDeferred<void>()
    const visible = new Map<string | number, Row>()
    const statusEvents: Array<string> = []
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const collection = createCollection<Row>({
      id: `cleanup-pending-replay`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => {
              const version = ++loadCount
              begin()
              write({ type: `insert`, value: { id: `row`, version } })
              commit()
              return version === 1 ? true : replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else visible.set(change.key, change.value)
        }
      },
      { includeInitialState: false },
    )
    subscription.on(`status:change`, ({ status }) => {
      statusEvents.push(status)
    })

    try {
      subscription.requestSnapshot()
      expect(visible.get(`row`)?.version).toBe(1)
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

      await collection.cleanup()
      const eventsAfterCleanup = [...statusEvents]
      replay.resolve()
      await flushPromises()

      expect(visible.get(`row`)?.version).toBe(1)
      expect(statusEvents).toEqual(eventsAfterCleanup)
    } finally {
      replay.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retains a subset after a synchronous truncate replay failure`, async () => {
    const error = new Error(`synchronous truncate replay failed`)
    let truncateSource: () => void = () => {
      throw new Error(`source has not started`)
    }
    let loadCount = 0
    let unloadCount = 0
    const collection = createCollection<{ id: string }>({
      id: `synchronous-truncate-subset-error`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, commit, markReady, truncate }) => {
          markReady()
          truncateSource = () => {
            begin()
            truncate()
            commit()
          }
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 2) throw error
              return true
            },
            unloadSubset: () => {
              unloadCount++
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ optimizedOnly: false })
    truncateSource()
    await flushPromises()
    truncateSource()
    await flushPromises()

    expect(loadCount).toBe(3)
    expect(subscription.lastError).toBe(error)

    subscription.unsubscribe()
    // The initial load and the later successful replay each acquired a lease.
    expect(unloadCount).toBe(2)
    await collection.cleanup()
  })

  it.each([`throw`, `reject`] as const)(
    `keeps the last published snapshot when truncate replay fails ($0)`,
    async (delivery) => {
      type Row = { id: string }
      const error = new Error(`truncate replay failed before replacement`)
      let begin!: () => void
      let write!: (message: { type: `insert`; value: Row }) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      let failReplay = true
      const collection = createCollection<Row>({
        id: `truncate-replay-preserves-snapshot`,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: () => {
                loadCount++
                if (loadCount > 1 && failReplay) {
                  if (delivery === `throw`) throw error
                  return Promise.reject(error)
                }
                begin()
                write({ type: `insert`, value: { id: `one` } })
                commit()
                return true
              },
            }
          },
        },
      })
      const visible = new Map<string | number, Row>()
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else visible.set(change.key, change.value)
          }
        },
        { includeInitialState: false },
      )

      subscription.requestSnapshot({ optimizedOnly: false })
      expect([...visible.keys()]).toEqual([`one`])

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(subscription.lastError).toBe(error)
      expect([...visible.keys()]).toEqual([`one`])

      begin()
      write({ type: `insert`, value: { id: `two` } })
      commit()
      await flushPromises()

      // Ordinary source changes do not establish a complete replacement.
      // Keep the last coherent generation until a later replay succeeds.
      expect([...visible.keys()]).toEqual([`one`])

      failReplay = false
      begin()
      truncate()
      commit()
      await flushPromises()

      expect([...visible.keys()]).toEqual([`one`])

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`publishes one coherent snapshot after overlapping truncate replays`, async () => {
    type Row = { id: string }
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const resolveReplays: Array<() => void> = []
    const collection = createCollection<Row>({
      id: `overlapping-truncate-replays`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `old` } })
                commit()
                return true
              }
              if (loadCount === 3) {
                begin()
                write({ type: `insert`, value: { id: `new` } })
                commit()
              }
              return new Promise<void>((resolve) =>
                resolveReplays.push(resolve),
              )
            },
          }
        },
      },
    })
    const visible = new Map<string | number, Row>()
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else visible.set(change.key, change.value)
        }
      },
      { includeInitialState: false },
    )

    subscription.requestSnapshot({ optimizedOnly: false })
    expect([...visible.keys()]).toEqual([`old`])

    begin()
    truncate()
    commit()
    await flushPromises()

    begin()
    truncate()
    commit()
    await flushPromises()

    resolveReplays[1]!()
    await flushPromises()
    expect([...visible.keys()]).toEqual([`old`])

    resolveReplays[0]!()
    await flushPromises()
    expect([...visible.keys()]).toEqual([`new`])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`does not become ready between reentrant truncate replacements`, async () => {
    type Row = { id: string; version: number }
    const replays = [createDeferred<void>(), createDeferred<void>()]
    const statusEvents: Array<string> = []
    const visible = new Map<string | number, Row>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    let startedNestedReplay = false
    const collection = createCollection<Row>({
      id: `reentrant-truncate-ready-barrier`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: () => {
              const version = ++loadCount
              begin()
              write({ type: `insert`, value: { id: `row`, version } })
              commit()
              return version === 1 ? true : replays[version - 2]!.promise
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else visible.set(change.key, change.value)
        }
        if (visible.get(`row`)?.version === 2 && !startedNestedReplay) {
          startedNestedReplay = true
          begin()
          truncate()
          commit()
        }
      },
      { includeInitialState: false },
    )
    subscription.on(`status:change`, ({ status }) => {
      statusEvents.push(status)
    })

    try {
      subscription.requestSnapshot()
      expect(visible.get(`row`)?.version).toBe(1)

      begin()
      truncate()
      commit()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

      replays[0]!.resolve()
      await flushPromises()
      expect(loadCount).toBe(3)
      expect(visible.get(`row`)?.version).toBe(2)
      expect(subscription.status).toBe(`loadingSubset`)
      expect(statusEvents).toEqual([`loadingSubset`])

      replays[1]!.resolve()
      await flushPromises()
      expect(visible.get(`row`)?.version).toBe(3)
      expect(subscription.status).toBe(`ready`)
      expect(statusEvents).toEqual([`loadingSubset`, `ready`])
    } finally {
      for (const replay of replays) replay.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`scopes a subset failure to the subscription that requested it`, async () => {
    const error = new Error(`first subscription failed`)
    let loadCount = 0
    const collection = createCollection<{ id: string }>({
      id: `scoped-subset-error`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loadCount++
              return loadCount === 1 ? Promise.reject(error) : Promise.resolve()
            },
          }
        },
      },
    })
    const failing = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const healthy = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    failing.requestSnapshot({ optimizedOnly: false })
    healthy.requestSnapshot({ optimizedOnly: false })
    await flushPromises()

    expect(collection.status).toBe(`ready`)
    expect(failing.lastError).toBe(error)
    expect(healthy.lastError).toBeUndefined()

    failing.unsubscribe()
    healthy.unsubscribe()
    await collection.cleanup()
  })

  it(`does not report an aborted subset request as a failure`, async () => {
    const cancellation = new Error(`obsolete subset request`)
    cancellation.name = `AbortError`
    const collection = createCollection<{ id: string }>({
      id: `aborted-subset-request`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: ({ signal }) =>
              new Promise<void>((_resolve, reject) => {
                signal?.addEventListener(`abort`, () => reject(cancellation), {
                  once: true,
                })
              }),
          }
        },
      },
    })
    const controller = new AbortController()
    const failures: Array<unknown> = []
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.on(`loadSubset:error`, (event) => failures.push(event.error))

    subscription.requestSnapshot({
      optimizedOnly: false,
      signal: controller.signal,
    })
    controller.abort()
    await flushPromises()

    expect(subscription.status).toBe(`ready`)
    expect(subscription.lastError).toBeUndefined()
    expect(failures).toEqual([])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it.each([
    [`Temporal`, Temporal.PlainDate.from(`2026-08-24`)],
    [
      `opaque class`,
      new (class Sortable {
        valueOf() {
          return 24
        }
      })(),
    ],
  ])(
    `passes a %s range operand through to the adapter`,
    async (_name, operand) => {
      let received: LoadSubsetOptions | undefined
      const collection = createCollection<{ id: string }>({
        id: `range-operand-subset`,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                received = options
                return true
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const where = new Func(`gt`, [new PropRef([`value`]), new Value(operand)])

      expect(() =>
        subscription.requestSnapshot({ where, optimizedOnly: false }),
      ).not.toThrow()
      expect(((received?.where as Func).args[1] as Value).value).toBe(operand)

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`unsubscribe clears event listeners`, () => {
    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    let eventCount = 0
    subscription.on(`status:change`, () => {
      eventCount++
    })

    subscription.unsubscribe()

    // After unsubscribe, listeners should be cleared
    // We can't easily verify this without accessing private members,
    // but we can at least verify unsubscribe doesn't throw
    expect(eventCount).toBe(0)
  })
})
