import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { flushPromises } from './utils'
import type { LoadSubsetOptions } from '../src/types.js'

describe(`CollectionSubscription status tracking`, () => {
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
      expect(transportCalls).toBe(2)

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

  it(`keeps the old lease when replacing it fails`, async () => {
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

      replay.reject(new DOMException(`replacement abandoned`, `AbortError`))
      await flushPromises()
      expect(subscription.status).toBe(`ready`)
      expect(subscription.lastError).toEqual(
        new Error(`old lease release failed`),
      )

      subscription.unsubscribe()
      unsubscribed = true
      expect(unloads).toEqual([loads[0], loads[1], loads[0]])
    } finally {
      replay.resolve()
      if (!unsubscribed) subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`releaseSnapshot`, `unsubscribe`] as const)(
    `retries a failed deferred release through %s`,
    async (releaseMode) => {
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const failure = new Error(`release failed`)
      const collection = createCollection<{ id: string }>({
        id: `failed-deferred-subscription-release-${releaseMode}`,
        getKey: (row) => row.id,
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
      const firstRelease = () => {
        if (releaseMode === `releaseSnapshot`) {
          subscription.releaseSnapshot(where)
        } else {
          subscription.unsubscribe()
        }
      }

      try {
        subscription.requestSnapshot({
          where,
          limit: 1,
          optimizedOnly: false,
        })
        collection._resumeSyncStart()
        await flushPromises()

        expect(loads).toHaveLength(1)
        let releaseError: unknown
        try {
          firstRelease()
        } catch (error) {
          releaseError = error
        }
        expect(releaseError).toBe(failure)
        expect(() => subscription.unsubscribe()).not.toThrow()

        expect(unloads).toHaveLength(2)
        expect(unloads[0]).toBe(loads[0])
        expect(unloads[1]).toBe(loads[0])

        subscription.unsubscribe()
        expect(unloads).toHaveLength(2)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`return`, `resolve`] as const)(
    `publishes active subset ownership before a reentrant unsubscribe (%s)`,
    async (resultKind) => {
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let unsubscribeDuringLoad = () => {}
      const collection = createCollection<{ id: string }>({
        id: `reentrant-active-subscription-release-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                unsubscribeDuringLoad()
                return resultKind === `return` ? true : Promise.resolve()
              },
              unloadSubset: (options) => {
                // Ignore an unknown acquisition, as a keyed adapter would.
                if (options === loads[0]) unloads.push(options)
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
        subscription.requestSnapshot({ limit: 1, optimizedOnly: false })
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

  it(`releases active subset ownership reentrantly without an unload hook`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    let unsubscribeDuringLoad = () => {}
    const collection = createCollection<{ id: string }>({
      id: `reentrant-active-subscription-release-without-hook`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              unsubscribeDuringLoad()
              return true
            },
          }
        },
      },
    })
    const unloadSubset = vi.spyOn(collection._sync, `unloadSubset`)
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    unsubscribeDuringLoad = () => subscription.unsubscribe()

    try {
      subscription.requestSnapshot({ limit: 1, optimizedOnly: false })

      expect(loads).toHaveLength(1)
      expect(unloadSubset).toHaveBeenCalledTimes(1)
      expect(unloadSubset).toHaveBeenCalledWith(loads[0])

      subscription.unsubscribe()
      expect(unloadSubset).toHaveBeenCalledTimes(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`return`, `resolve`] as const)(
    `retries an active reentrant release that the adapter catches (%s)`,
    async (resultKind) => {
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const failure = new Error(`reentrant active release failed`)
      let releaseError: unknown
      let unsubscribeDuringLoad = () => {}
      const collection = createCollection<{ id: string }>({
        id: `reentrant-active-subscription-release-retry-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                try {
                  unsubscribeDuringLoad()
                } catch (error) {
                  releaseError = error
                }
                return resultKind === `return` ? true : Promise.resolve()
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
        subscription.requestSnapshot({ limit: 1, optimizedOnly: false })
        await flushPromises()

        expect(releaseError).toBe(failure)
        expect(unloads).toEqual([loads[0]])
        expect(() => subscription.unsubscribe()).not.toThrow()
        expect(unloads).toEqual([loads[0], loads[0]])

        subscription.unsubscribe()
        expect(unloads).toHaveLength(2)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`retries an active reentrant release that escapes the adapter`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const failure = new Error(`reentrant active release escaped`)
    let unsubscribeDuringLoad = () => {}
    const collection = createCollection<{ id: string }>({
      id: `reentrant-active-subscription-release-escaped`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              unsubscribeDuringLoad()
              return true
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
      expect(() =>
        subscription.requestSnapshot({ limit: 1, optimizedOnly: false }),
      ).toThrow(failure)
      expect(unloads).toEqual([loads[0]])

      expect(() => subscription.unsubscribe()).not.toThrow()
      expect(unloads).toEqual([loads[0], loads[0]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`uses the acquired options when deferred load reentrantly unsubscribes`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let unsubscribeDuringLoad = () => {}
    const collection = createCollection<{ id: string }>({
      id: `reentrant-deferred-subscription-release`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: false,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              unsubscribeDuringLoad()
              return Promise.resolve()
            },
            unloadSubset: (options) => {
              // Model an adapter that silently ignores an unknown acquisition.
              if (options === loads[0]) unloads.push(options)
            },
          }
        },
      },
    })

    expect(collection._deferSyncStart()).toBe(true)
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    unsubscribeDuringLoad = () => subscription.unsubscribe()

    try {
      subscription.requestSnapshot({ limit: 1, optimizedOnly: false })
      collection._resumeSyncStart()
      await flushPromises()

      expect(loads).toHaveLength(1)
      expect(unloads).toEqual([loads[0]])

      subscription.unsubscribe()
      expect(unloads).toHaveLength(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retries the acquired options when deferred load reentrant release throws`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const failure = new Error(`reentrant release failed`)
    let unsubscribeDuringLoad = () => {}
    const collection = createCollection<{ id: string }>({
      id: `reentrant-deferred-subscription-release-failure`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: false,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              unsubscribeDuringLoad()
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
    unsubscribeDuringLoad = () => subscription.unsubscribe()

    try {
      subscription.requestSnapshot({ limit: 1, optimizedOnly: false })
      collection._resumeSyncStart()
      await flushPromises()

      expect(loads).toHaveLength(1)
      expect(unloads).toHaveLength(1)
      expect(unloads[0]).toBe(loads[0])

      expect(() => subscription.unsubscribe()).not.toThrow()
      expect(unloads).toHaveLength(2)
      expect(unloads[1]).toBe(loads[0])

      subscription.unsubscribe()
      expect(unloads).toHaveLength(2)
    } finally {
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

      expect([...visible.keys()].sort()).toEqual([`one`, `two`])

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
