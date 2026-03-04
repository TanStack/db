import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { CleanupQueue } from '../src/collection/cleanup-queue.js'

// Mock setTimeout and clearTimeout for testing GC behavior
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout

describe(`Collection Lifecycle Management`, () => {
  let mockSetTimeout: ReturnType<typeof vi.fn>
  let mockClearTimeout: ReturnType<typeof vi.fn>
  let timeoutCallbacks: Map<number, () => void>
  let timeoutId = 1
  let scheduleSpy: ReturnType<typeof vi.spyOn>
  let cancelSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    timeoutCallbacks = new Map()
    timeoutId = 1

    mockSetTimeout = vi.fn((callback: () => void, _delay: number) => {
      const id = timeoutId++
      timeoutCallbacks.set(id, callback)
      return id
    })

    mockClearTimeout = vi.fn((id: number) => {
      timeoutCallbacks.delete(id)
    })

    // Mock requestIdleCallback - in tests, it falls back to setTimeout
    // which we're already mocking, so the idle callback will be triggered
    // through our mockSetTimeout

    global.setTimeout = mockSetTimeout as any
    global.clearTimeout = mockClearTimeout as any

    scheduleSpy = vi.spyOn(CleanupQueue.prototype, 'schedule').mockImplementation(() => {})
    cancelSpy = vi.spyOn(CleanupQueue.prototype, 'cancel').mockImplementation(() => {})
  })

  afterEach(() => {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
    vi.clearAllMocks()
    CleanupQueue.resetInstance()
  })

  const triggerAllTimeouts = () => {
    const callbacks = Array.from(timeoutCallbacks.entries())
    callbacks.forEach(([id, callback]) => {
      callback()
      timeoutCallbacks.delete(id)
    })
  }

  describe(`Collection Status Tracking`, () => {
    it(`should start with idle status and transition to ready after first commit when startSync is false`, () => {
      let beginCallback: (() => void) | undefined
      let commitCallback: (() => void) | undefined

      const collection = createCollection<{ id: string; name: string }>({
        id: `status-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            beginCallback = begin as () => void
            commitCallback = () => {
              commit()
              markReady()
            }
          },
        },
      })

      expect(collection.status).toBe(`idle`)

      collection.preload()

      if (beginCallback && commitCallback) {
        beginCallback()
        commitCallback()
      }

      expect(collection.status).toBe(`ready`)
    })

    it(`should start with loading status and transition to ready after first commit when startSync is true`, () => {
      let beginCallback: (() => void) | undefined
      let commitCallback: (() => void) | undefined

      const collection = createCollection<{ id: string; name: string }>({
        id: `status-test`,
        getKey: (item) => item.id,
        startSync: true,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            beginCallback = begin as () => void
            commitCallback = () => {
              commit()
              markReady()
            }
          },
        },
      })

      // Should start in loading state since sync starts immediately
      expect(collection.status).toBe(`loading`)

      // Trigger first commit (begin then commit)
      if (beginCallback && commitCallback) {
        beginCallback()
        commitCallback()
      }

      expect(collection.status).toBe(`ready`)
    })

    it(`should transition to cleaned-up status after cleanup`, async () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `cleanup-status-test`,
        getKey: (item) => item.id,
        sync: {
          sync: () => {},
        },
      })

      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)
    })

    it(`should transition when subscribing to changes`, () => {
      let beginCallback: (() => void) | undefined
      let commitCallback: (() => void) | undefined

      const collection = createCollection<{ id: string; name: string }>({
        id: `subscribe-test`,
        getKey: (item) => item.id,
        gcTime: 0,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            beginCallback = begin as () => void
            commitCallback = () => {
              commit()
              markReady()
            }
          },
        },
      })

      expect(collection.status).toBe(`idle`)

      const subscription = collection.subscribeChanges(() => {})

      expect(collection.status).toBe(`loading`)

      if (beginCallback && commitCallback) {
        beginCallback()
        commitCallback()
      }

      expect(collection.status).toBe(`ready`)

      subscription.unsubscribe()

      expect(collection.status).toBe(`ready`)
    })

    it(`should restart sync when accessing cleaned-up collection`, async () => {
      let syncCallCount = 0

      const collection = createCollection<{ id: string; name: string }>({
        id: `restart-test`,
        getKey: (item) => item.id,
        startSync: false, // Test lazy loading behavior
        sync: {
          sync: ({ begin, commit, markReady }) => {
            begin()
            commit()
            markReady()
            syncCallCount++
          },
        },
      })

      expect(syncCallCount).toBe(0) // no sync yet

      await collection.preload()

      expect(syncCallCount).toBe(1) // sync called when subscribing

      await collection.cleanup()

      expect(collection.status).toBe(`cleaned-up`)

      await collection.preload()

      expect(syncCallCount).toBe(2)
      expect(collection.status).toBe(`ready`) // Sync completes immediately in this test
    })
  })

  describe(`Subscriber Management`, () => {
    it(`should track active subscribers correctly`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `subscriber-test`,
        getKey: (item) => item.id,
        sync: {
          sync: () => {},
        },
      })

      // No subscribers initially
      expect(collection.subscriberCount).toBe(0)

      // Subscribe to changes
      const subscription1 = collection.subscribeChanges(() => {})
      expect(collection.subscriberCount).toBe(1)

      const subscription2 = collection.subscribeChanges(() => {})
      expect(collection.subscriberCount).toBe(2)

      // Unsubscribe
      subscription1.unsubscribe()
      expect(collection.subscriberCount).toBe(1)

      subscription2.unsubscribe()
      expect(collection.subscriberCount).toBe(0)
    })

    it(`should handle rapid subscribe/unsubscribe correctly`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `rapid-sub-test`,
        getKey: (item) => item.id,
        gcTime: 1000, // Short GC time for testing
        sync: {
          sync: () => {},
        },
      })

      // Subscribe and immediately unsubscribe multiple times
      for (let i = 0; i < 5; i++) {
        const subscription = collection.subscribeChanges(() => {})
        expect(collection.subscriberCount).toBe(1)
        subscription.unsubscribe()
        expect(collection.subscriberCount).toBe(0)

        // Should start GC timer each time
        expect(scheduleSpy).toHaveBeenCalledWith(expect.any(Object), 1000, expect.any(Function))
      }

      expect(scheduleSpy).toHaveBeenCalledTimes(5)
    })
  })

  describe(`Garbage Collection`, () => {
    it(`should start GC timer when last subscriber is removed`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `gc-timer-test`,
        getKey: (item) => item.id,
        gcTime: 5000, // 5 seconds
        sync: {
          sync: () => {},
        },
      })

      const subscription = collection.subscribeChanges(() => {})

      // Should not have GC timer while there are subscribers
      expect(scheduleSpy).not.toHaveBeenCalled()

      subscription.unsubscribe()

      // Should start GC timer when last subscriber is removed
      expect(scheduleSpy).toHaveBeenCalledWith(expect.any(Object), 5000, expect.any(Function))
    })

    it(`should cancel GC timer when new subscriber is added`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `gc-cancel-test`,
        getKey: (item) => item.id,
        gcTime: 5000,
        sync: {
          sync: () => {},
        },
      })

      const subscription1 = collection.subscribeChanges(() => {})
      subscription1.unsubscribe()

      expect(scheduleSpy).toHaveBeenCalledTimes(1)

      // Add new subscriber should cancel GC timer
      const subscription2 = collection.subscribeChanges(() => {})
      expect(cancelSpy).toHaveBeenCalledWith(expect.any(Object))

      subscription2.unsubscribe()
    })

    it(`should cleanup collection when GC timer fires`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `gc-cleanup-test`,
        getKey: (item) => item.id,
        gcTime: 1000,
        sync: {
          sync: () => {},
        },
      })

      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()

      expect(collection.status).toBe(`loading`)

      // Trigger GC timeout - this will schedule the idle cleanup
      const gcCallback = scheduleSpy.mock.calls[0]?.[2] as
        | (() => void)
        | undefined
      if (gcCallback) {
        gcCallback()
      }

      // Now trigger all remaining timeouts to handle the idle callback
      // (which is implemented via setTimeout in our polyfill)
      triggerAllTimeouts()

      expect(collection.status).toBe(`cleaned-up`)
    })

    it(`should use default GC time when not specified`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `default-gc-test`,
        getKey: (item) => item.id,
        sync: {
          sync: () => {},
        },
      })

      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()

      // Should use default 5 minutes (300000ms)
      expect(scheduleSpy).toHaveBeenCalledWith(expect.any(Object), 300000, expect.any(Function))
    })

    it(`should disable GC when gcTime is 0`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `disabled-gc-test`,
        getKey: (item) => item.id,
        gcTime: 0, // Disabled GC
        sync: {
          sync: () => {},
        },
      })

      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()

      // Should not start any timer when GC is disabled
      expect(scheduleSpy).not.toHaveBeenCalled()
      expect(collection.status).not.toBe(`cleaned-up`)
    })

    it(`should disable GC when gcTime is Infinity`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `infinity-gc-test`,
        getKey: (item) => item.id,
        gcTime: Infinity, // Disabled GC via Infinity
        sync: {
          sync: () => {},
        },
      })

      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()

      // Should not start any timer when gcTime is Infinity
      // Note: Without this fix, setTimeout(fn, Infinity) would coerce to 0,
      // causing immediate GC instead of never collecting
      expect(scheduleSpy).not.toHaveBeenCalled()
      expect(collection.status).not.toBe(`cleaned-up`)
    })
  })

  describe(`Manual Preload and Cleanup`, () => {
    it(`should resolve preload immediately if already ready`, async () => {
      let beginCallback: (() => void) | undefined
      let commitCallback: (() => void) | undefined

      const collection = createCollection<{ id: string; name: string }>({
        id: `preload-ready-test`,
        getKey: (item) => item.id,
        startSync: true,
        sync: {
          sync: ({ begin, commit, markReady }) => {
            beginCallback = begin as () => void
            commitCallback = () => {
              commit()
              markReady()
            }
          },
        },
      })

      // Make collection ready
      if (beginCallback && commitCallback) {
        beginCallback()
        commitCallback()
      }

      // Preload should resolve immediately
      const startTime = Date.now()
      await collection.preload()
      const endTime = Date.now()

      expect(endTime - startTime).toBeLessThan(50) // Should be nearly instant
    })

    it(`should share preload promise for concurrent calls`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `concurrent-preload-test`,
        getKey: (item) => item.id,
        sync: {
          sync: () => {},
        },
      })

      const promise1 = collection.preload()
      const promise2 = collection.preload()

      expect(promise1).toBe(promise2) // Should be the same promise
    })

    it(`should cleanup collection manually`, async () => {
      let cleanupCalled = false

      const collection = createCollection<{ id: string; name: string }>({
        id: `manual-cleanup-test`,
        getKey: (item) => item.id,
        startSync: true,
        sync: {
          sync: () => {
            return () => {
              cleanupCalled = true
            }
          },
        },
      })

      expect(collection.status).toBe(`loading`)

      await collection.cleanup()

      expect(collection.status).toBe(`cleaned-up`)
      expect(cleanupCalled).toBe(true)
    })
  })

  describe(`Lifecycle Events`, () => {
    it(`should call onFirstReady callbacks`, () => {
      let markReadyCallback: (() => void) | undefined
      const callbacks: Array<() => void> = []

      const collection = createCollection<{ id: string; name: string }>({
        id: `first-ready-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady as () => void
          },
        },
      })

      const subscription = collection.subscribeChanges(() => {})

      // Register callbacks
      collection.onFirstReady(() => callbacks.push(() => `callback1`))
      collection.onFirstReady(() => callbacks.push(() => `callback2`))

      expect(callbacks).toHaveLength(0)

      // Trigger first ready
      if (markReadyCallback) {
        markReadyCallback()
      }

      expect(callbacks).toHaveLength(2)

      // Subsequent markReady calls should not trigger callbacks
      if (markReadyCallback) {
        markReadyCallback()
      }
      expect(callbacks).toHaveLength(2)

      subscription.unsubscribe()
    })

    it(`should fire status:change event with 'cleaned-up' status before clearing event handlers`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `cleanup-event-test`,
        getKey: (item) => item.id,
        gcTime: 1000,
        sync: {
          sync: () => {},
        },
      })

      // Track status changes
      const statusChanges: Array<{ status: string; previousStatus: string }> =
        []

      // Add event listener for status changes
      collection.on(`status:change`, ({ status, previousStatus }) => {
        statusChanges.push({ status, previousStatus })
      })

      // Subscribe and unsubscribe to trigger GC
      const subscription = collection.subscribeChanges(() => {})
      subscription.unsubscribe()

      expect(statusChanges).toHaveLength(1)
      expect(statusChanges[0]).toEqual({
        status: `loading`,
        previousStatus: `idle`,
      })

      // Trigger GC timeout to schedule cleanup
      const gcCallback = scheduleSpy.mock.calls[0]?.[2] as
        | (() => void)
        | undefined
      if (gcCallback) {
        gcCallback()
      }

      // Trigger all remaining timeouts to handle the idle callback
      triggerAllTimeouts()

      // Verify that the listener received the 'cleaned-up' status change event
      expect(statusChanges).toHaveLength(2)
      expect(statusChanges[1]).toEqual({
        status: `cleaned-up`,
        previousStatus: `loading`,
      })
      expect(collection.status).toBe(`cleaned-up`)
    })
  })
})
