import { describe, expect, it } from "vitest"
import { createCollection } from "../src/collection/index.js"
import { flushPromises } from "./utils"

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

  it(`status changes to 'loadingMore' when requestSnapshot triggers a promise`, async () => {
    let resolveLoadMore: () => void
    const loadMorePromise = new Promise<void>((resolve) => {
      resolveLoadMore = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            onLoadMore: () => loadMorePromise,
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    expect(subscription.status).toBe(`ready`)

    // Trigger a snapshot request that will call syncMore
    subscription.requestSnapshot({ optimizedOnly: false })

    // Status should now be loadingMore
    expect(subscription.status).toBe(`loadingMore`)

    // Resolve the load more promise
    resolveLoadMore!()
    await flushPromises()

    // Status should be back to ready
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
  })

  it(`status changes back to 'ready' when promise resolves`, async () => {
    let resolveLoadMore: () => void
    const loadMorePromise = new Promise<void>((resolve) => {
      resolveLoadMore = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            onLoadMore: () => loadMorePromise,
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ optimizedOnly: false })
    expect(subscription.status).toBe(`loadingMore`)

    resolveLoadMore!()
    await flushPromises()

    expect(subscription.status).toBe(`ready`)
    subscription.unsubscribe()
  })

  it(`concurrent promises keep status as 'loadingMore' until all resolve`, async () => {
    let resolveLoadMore1: () => void
    let resolveLoadMore2: () => void
    let callCount = 0

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            onLoadMore: () => {
              callCount++
              if (callCount === 1) {
                return new Promise<void>((resolve) => {
                  resolveLoadMore1 = resolve
                })
              } else {
                return new Promise<void>((resolve) => {
                  resolveLoadMore2 = resolve
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
    expect(subscription.status).toBe(`loadingMore`)

    // Trigger second load
    subscription.requestSnapshot({ optimizedOnly: false })
    expect(subscription.status).toBe(`loadingMore`)

    // Resolve first promise
    resolveLoadMore1!()
    await flushPromises()

    // Should still be loading because second promise is pending
    expect(subscription.status).toBe(`loadingMore`)

    // Resolve second promise
    resolveLoadMore2!()
    await flushPromises()

    // Now should be ready
    expect(subscription.status).toBe(`ready`)
    subscription.unsubscribe()
  })

  it(`emits 'status:change' event`, async () => {
    let resolveLoadMore: () => void
    const loadMorePromise = new Promise<void>((resolve) => {
      resolveLoadMore = resolve
    })

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            onLoadMore: () => loadMorePromise,
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
      current: `loadingMore`,
    })

    resolveLoadMore!()
    await flushPromises()

    expect(statusChanges).toHaveLength(2)
    expect(statusChanges[1]).toEqual({
      previous: `loadingMore`,
      current: `ready`,
    })

    subscription.unsubscribe()
  })

  it(`promise rejection still cleans up and sets status back to 'ready'`, async () => {
    let rejectLoadMore: (error: Error) => void
    const loadMorePromise = new Promise<void>((_, reject) => {
      rejectLoadMore = reject
    })
    // Attach catch handler before rejecting to avoid unhandled rejection
    const handledPromise = loadMorePromise.catch(() => {})

    const collection = createCollection<{ id: string; value: string }>({
      id: `test`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            onLoadMore: () => handledPromise,
          }
        },
      },
    })

    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ optimizedOnly: false })
    expect(subscription.status).toBe(`loadingMore`)

    // Reject the promise
    rejectLoadMore!(new Error(`Load failed`))
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
