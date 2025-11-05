import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection/index.js"
import type { Collection } from "../src/collection/index.js"

describe(`Collection Events System`, () => {
  let collection: Collection
  let mockSync: any

  beforeEach(() => {
    mockSync = vi.fn()
    collection = createCollection({
      id: `test-collection`,
      getKey: (item: any) => item.id,
      sync: {
        sync: mockSync,
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe(`Status Change Events`, () => {
    it(`should emit status:change and specific status events`, () => {
      const statusChangeListener = vi.fn()
      const statusLoadingListener = vi.fn()

      collection.on(`status:change`, statusChangeListener)
      collection.on(`status:loading`, statusLoadingListener)

      collection.startSyncImmediate()

      expect(statusChangeListener).toHaveBeenCalledWith({
        type: `status:change`,
        collection,
        previousStatus: `idle`,
        status: `loading`,
      })

      expect(statusLoadingListener).toHaveBeenCalledWith({
        type: `status:loading`,
        collection,
        previousStatus: `idle`,
        status: `loading`,
      })
    })
  })

  describe(`Subscriber Count Change Events`, () => {
    it(`should emit subscribers:change when subscriber count changes`, () => {
      const subscribersChangeListener = vi.fn()
      collection.on(`subscribers:change`, subscribersChangeListener)

      const subscription = collection.subscribeChanges(() => {})

      expect(subscribersChangeListener).toHaveBeenCalledWith({
        type: `subscribers:change`,
        collection,
        previousSubscriberCount: 0,
        subscriberCount: 1,
      })

      subscription.unsubscribe()
    })
  })

  describe(`Event Subscription Management`, () => {
    it(`should support on(), once(), and off() methods`, () => {
      const listener = vi.fn()

      // Test on() returns unsubscribe function
      const unsubscribe = collection.on(`status:change`, listener)
      expect(typeof unsubscribe).toBe(`function`)

      // Test once() auto-unsubscribes after first call
      const onceListener = vi.fn()
      collection.once(`status:change`, onceListener)

      collection.startSyncImmediate()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(onceListener).toHaveBeenCalledTimes(1)

      // Second call should not trigger once listener
      collection.startSyncImmediate()
      expect(onceListener).toHaveBeenCalledTimes(1)

      // Test off() removes listener
      collection.off(`status:change`, listener)
      collection.startSyncImmediate()
      expect(listener).toHaveBeenCalledTimes(1) // Still only called once

      unsubscribe()
    })
  })

  describe(`Event Structure`, () => {
    it(`should emit events with correct structure`, () => {
      const statusListener = vi.fn()
      const subscribersListener = vi.fn()

      collection.on(`status:change`, statusListener)
      collection.on(`subscribers:change`, subscribersListener)

      collection.startSyncImmediate()
      const subscription = collection.subscribeChanges(() => {})

      expect(statusListener.mock.calls[0]?.[0]).toMatchObject({
        type: `status:change`,
        collection,
        previousStatus: expect.any(String),
        status: expect.any(String),
      })

      expect(subscribersListener.mock.calls[0]?.[0]).toMatchObject({
        type: `subscribers:change`,
        collection,
        previousSubscriberCount: expect.any(Number),
        subscriberCount: expect.any(Number),
      })

      subscription.unsubscribe()
    })
  })

  describe(`waitFor Method`, () => {
    it(`should resolve when event is emitted without timeout`, async () => {
      const waitPromise = collection.waitFor(`status:change`)

      // Trigger the event
      collection.startSyncImmediate()

      const event = await waitPromise

      expect(event).toMatchObject({
        type: `status:change`,
        collection,
        previousStatus: `idle`,
        status: `loading`,
      })
    })

    it(`should reject when timeout is reached`, async () => {
      vi.useFakeTimers()

      const waitPromise = collection.waitFor(`status:change`, 1000)

      // Fast-forward time beyond the timeout
      vi.advanceTimersByTime(1001)

      await expect(waitPromise).rejects.toThrow(
        `Timeout waiting for event status:change`
      )

      vi.useRealTimers()
    })
  })
})
