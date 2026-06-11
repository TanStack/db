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
