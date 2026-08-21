import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { flushPromises } from './utils'

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

  it(`releases a subset acquired before loadSubset throws`, async () => {
    const failure = new Error(`subset failed after acquisition`)
    let acquiredOptions: unknown
    const unloadedOptions: Array<unknown> = []
    const collection = createCollection<{ id: string }>({
      id: `partial-subset-acquisition`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              acquiredOptions = options
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

    expect(unloadedOptions).toEqual([acquiredOptions])
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
    expect(unloadCount).toBe(1)
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
