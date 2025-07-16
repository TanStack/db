import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection.js"

// Mock setTimeout and clearTimeout for testing GC behavior
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout

describe(`Collection Lifecycle Management`, () => {
  let mockSetTimeout: ReturnType<typeof vi.fn>
  let mockClearTimeout: ReturnType<typeof vi.fn>
  let timeoutCallbacks: Map<number, () => void>
  let timeoutId = 1

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

    global.setTimeout = mockSetTimeout as any
    global.clearTimeout = mockClearTimeout as any
  })

  afterEach(() => {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
    vi.clearAllMocks()
  })

  const triggerTimeout = (id: number) => {
    const callback = timeoutCallbacks.get(id)
    if (callback) {
      callback()
      timeoutCallbacks.delete(id)
    }
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

      const unsubscribe = collection.subscribeChanges(() => {})

      expect(collection.status).toBe(`loading`)

      if (beginCallback && commitCallback) {
        beginCallback()
        commitCallback()
      }

      expect(collection.status).toBe(`ready`)

      unsubscribe()

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
      expect((collection as any).activeSubscribersCount).toBe(0)

      // Subscribe to changes
      const unsubscribe1 = collection.subscribeChanges(() => {})
      expect((collection as any).activeSubscribersCount).toBe(1)

      const unsubscribe2 = collection.subscribeChanges(() => {})
      expect((collection as any).activeSubscribersCount).toBe(2)

      // Unsubscribe
      unsubscribe1()
      expect((collection as any).activeSubscribersCount).toBe(1)

      unsubscribe2()
      expect((collection as any).activeSubscribersCount).toBe(0)
    })

    it(`should track key-specific subscribers`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `key-subscriber-test`,
        getKey: (item) => item.id,
        sync: {
          sync: () => {},
        },
      })

      const unsubscribe1 = collection.subscribeChangesKey(`key1`, () => {})
      const unsubscribe2 = collection.subscribeChangesKey(`key2`, () => {})
      const unsubscribe3 = collection.subscribeChangesKey(`key1`, () => {})

      expect((collection as any).activeSubscribersCount).toBe(3)

      unsubscribe1()
      expect((collection as any).activeSubscribersCount).toBe(2)

      unsubscribe2()
      unsubscribe3()
      expect((collection as any).activeSubscribersCount).toBe(0)
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

      const unsubscribe = collection.subscribeChanges(() => {})

      // Should not have GC timer while there are subscribers
      expect(mockSetTimeout).not.toHaveBeenCalled()

      unsubscribe()

      // Should start GC timer when last subscriber is removed
      expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 5000)
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

      const unsubscribe1 = collection.subscribeChanges(() => {})
      unsubscribe1()

      expect(mockSetTimeout).toHaveBeenCalledTimes(1)
      const timerId = mockSetTimeout.mock.results[0]?.value

      // Add new subscriber should cancel GC timer
      const unsubscribe2 = collection.subscribeChanges(() => {})
      expect(mockClearTimeout).toHaveBeenCalledWith(timerId)

      unsubscribe2()
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

      const unsubscribe = collection.subscribeChanges(() => {})
      unsubscribe()

      expect(collection.status).toBe(`loading`) // or "ready"

      // Trigger GC timeout
      const timerId = mockSetTimeout.mock.results[0]?.value
      if (timerId) {
        triggerTimeout(timerId)
      }

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

      const unsubscribe = collection.subscribeChanges(() => {})
      unsubscribe()

      // Should use default 5 minutes (300000ms)
      expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 300000)
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

      const unsubscribe = collection.subscribeChanges(() => {})

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

      unsubscribe()
    })
  })
})
