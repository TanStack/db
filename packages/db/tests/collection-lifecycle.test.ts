import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { CleanupQueue } from '../src/collection/cleanup-queue.js'
import { InvalidCollectionStatusTransitionError } from '../src/errors.js'
import {
  getActivePublicationContext,
  transactionScopedScheduler,
  withPublicationContext,
} from '../src/scheduler.js'

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

    scheduleSpy = vi
      .spyOn(CleanupQueue.prototype, 'schedule')
      .mockImplementation(() => {})
    cancelSpy = vi
      .spyOn(CleanupQueue.prototype, 'cancel')
      .mockImplementation(() => {})
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
        expect(scheduleSpy).toHaveBeenCalledWith(
          expect.any(Object),
          1000,
          expect.any(Function),
        )
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
      expect(scheduleSpy).toHaveBeenCalledWith(
        expect.any(Object),
        5000,
        expect.any(Function),
      )
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
      expect(scheduleSpy).toHaveBeenCalledWith(
        expect.any(Object),
        300000,
        expect.any(Function),
      )
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

    it(`freezes first-ready callback membership before delivery`, async () => {
      let markReadyCallback: (() => void) | undefined
      const calls: Array<string> = []
      const collection = createCollection<{ id: string; name: string }>({
        id: `first-ready-membership-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {})
      let removeLater = () => {}

      collection.onFirstReady(() => {
        calls.push(`first`)
        removeLater()
        collection.onFirstReady(() => calls.push(`nested`))
      })
      removeLater = collection.onFirstReady(() => calls.push(`later`))

      try {
        markReadyCallback!()

        expect(calls).toEqual([`first`, `nested`, `later`])

        collection.onFirstReady(() => calls.push(`after`))
        expect(calls).toEqual([`first`, `nested`, `later`, `after`])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    })

    it.each([
      {
        from: `ready`,
        expectedStatus: `ready`,
        expectedFirstReadyCalls: 1,
        expectedDependentReadyEvents: 1,
        invalid: false,
      },
      {
        from: `error`,
        expectedStatus: `ready`,
        expectedFirstReadyCalls: 1,
        expectedDependentReadyEvents: 2,
        invalid: false,
      },
      {
        from: `idle`,
        expectedStatus: `idle`,
        expectedFirstReadyCalls: 0,
        expectedDependentReadyEvents: 0,
        invalid: true,
      },
      {
        from: `cleaned-up`,
        expectedStatus: `cleaned-up`,
        expectedFirstReadyCalls: 0,
        expectedDependentReadyEvents: 0,
        invalid: true,
      },
    ] as const)(
      `defines the $from -> ready transition`,
      async ({
        from,
        expectedStatus,
        expectedFirstReadyCalls,
        expectedDependentReadyEvents,
        invalid,
      }) => {
        const syncFailure = new Error(`sync failed before recovery`)
        let firstReadyCalls = 0
        const collection = createCollection<{ id: string; name: string }>({
          id: `mark-ready-from-${from}`,
          getKey: (item) => item.id,
          startSync: false,
          sync: { sync: () => {} },
        })
        const readyEvent = vi.spyOn(collection._changes, `emitEmptyReadyEvent`)
        collection.onFirstReady(() => {
          firstReadyCalls++
        })

        if (from === `ready` || from === `error`) {
          collection._lifecycle.setStatus(`loading`)
          collection._lifecycle.markReady()
        }
        if (from === `error`) {
          collection._lifecycle.markError(syncFailure)
          expect(collection._lifecycle.getSyncError()).toBe(syncFailure)
        } else if (from === `cleaned-up`) {
          collection._lifecycle.setStatus(`cleaned-up`)
        }
        expect(collection.status).toBe(from)

        let didThrow = false
        let thrown: unknown
        try {
          collection._lifecycle.markReady()
        } catch (error) {
          didThrow = true
          thrown = error
        }

        expect(didThrow).toBe(invalid)
        if (invalid) {
          expect(thrown).toBeInstanceOf(InvalidCollectionStatusTransitionError)
        }
        expect(collection.status).toBe(expectedStatus)
        expect(firstReadyCalls).toBe(expectedFirstReadyCalls)
        expect(readyEvent).toHaveBeenCalledTimes(expectedDependentReadyEvents)
        expect(collection._lifecycle.getSyncError()).toBeUndefined()

        await collection.cleanup()
      },
    )

    it(`does not resume ready effects after a status listener cleans up`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `ready-listener-cleanup-test`,
        getKey: (item) => item.id,
        startSync: false,
        sync: { sync: () => {} },
      })
      const readyEvent = vi.spyOn(collection._changes, `emitEmptyReadyEvent`)
      const firstReadyStatuses: Array<string> = []
      collection.onFirstReady(() => {
        firstReadyStatuses.push(collection.status)
      })
      collection.on(`status:ready`, () => {
        void collection.cleanup()
      })
      collection._lifecycle.setStatus(`loading`)

      collection._lifecycle.markReady()

      expect(collection.status).toBe(`cleaned-up`)
      expect(collection._lifecycle.hasBeenReady).toBe(false)
      expect(firstReadyStatuses).toEqual([`ready`])
      expect(readyEvent).not.toHaveBeenCalled()

      const laterFirstReady = vi.fn()
      const removeLater = collection.onFirstReady(laterFirstReady)
      expect(laterFirstReady).not.toHaveBeenCalled()
      removeLater()
    })

    it(`starts a fresh first-ready cycle after cleanup of a failed ready effect`, async () => {
      const readyCallbacks: Array<() => void> = []
      const firstFailure = new Error(`first ready cycle failed exactly`)
      const trace: Array<string> = []
      const collection = createCollection<{ id: string; name: string }>({
        id: `ready-effect-restart-test`,
        getKey: (item) => item.id,
        startSync: false,
        sync: {
          sync: ({ markReady }) => {
            readyCallbacks.push(markReady)
          },
        },
      })
      const readyEvent = vi.spyOn(collection._changes, `emitEmptyReadyEvent`)
      collection.onFirstReady(() => {
        trace.push(`first failure:${collection.status}`)
        throw firstFailure
      })
      collection.onFirstReady(() => {
        trace.push(`first later:${collection.status}`)
      })
      const firstPreload = collection.preload()

      let thrown: unknown
      try {
        readyCallbacks[0]!()
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBe(firstFailure)
      await expect(firstPreload).resolves.toBeUndefined()
      expect(trace).toEqual([`first failure:ready`, `first later:ready`])
      expect(readyEvent).toHaveBeenCalledOnce()

      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection._lifecycle.hasBeenReady).toBe(false)

      collection.onFirstReady(() => {
        trace.push(`second:${collection.status}`)
      })
      expect(trace).toEqual([`first failure:ready`, `first later:ready`])

      const secondPreload = collection.preload()
      expect(secondPreload).not.toBe(firstPreload)
      expect(readyCallbacks).toHaveLength(2)
      readyCallbacks[1]!()
      await expect(secondPreload).resolves.toBeUndefined()

      expect(trace).toEqual([
        `first failure:ready`,
        `first later:ready`,
        `second:ready`,
      ])
      expect(readyEvent).toHaveBeenCalledTimes(2)

      await collection.cleanup()
    })

    it(`attempts every first-ready effect before rethrowing the first failure`, async () => {
      let markReadyCallback: (() => void) | undefined
      const readyBatches: Array<Array<unknown>> = []
      const readyTrace: Array<string> = []
      const laterFailure = new Error(`later first-ready failure`)
      const laterCallback = vi.fn(() => {
        readyTrace.push(`later:${collection.status}`)
        throw laterFailure
      })
      let preloadSettled = false

      const collection = createCollection<{ id: string; name: string }>({
        id: `first-ready-failure-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady as () => void
          },
        },
      })
      const subscription = collection.subscribeChanges((batch) => {
        readyTrace.push(`dependent:${collection.status}`)
        readyBatches.push(batch)
      })
      collection.onFirstReady(() => {
        readyTrace.push(`first:${collection.status}`)
        throw undefined
      })
      collection.onFirstReady(laterCallback)
      void collection.preload().then(() => {
        preloadSettled = true
      })

      try {
        let didThrow = false
        let thrown: unknown
        try {
          markReadyCallback!()
        } catch (error) {
          didThrow = true
          thrown = error
        }
        await Promise.resolve()

        expect(didThrow).toBe(true)
        expect(thrown).toBeUndefined()
        expect(laterCallback).toHaveBeenCalledOnce()
        expect(preloadSettled).toBe(true)
        expect(readyBatches).toEqual([[]])
        expect(readyTrace).toEqual([
          `first:ready`,
          `later:ready`,
          `dependent:ready`,
        ])
        expect(collection.status).toBe(`ready`)

        expect(() => markReadyCallback!()).not.toThrow()
        expect(laterCallback).toHaveBeenCalledOnce()
        expect(readyBatches).toEqual([[]])
        expect(readyTrace).toEqual([
          `first:ready`,
          `later:ready`,
          `dependent:ready`,
        ])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`does not classify synchronous first-ready callback failures as sync failures`, async () => {
      const laterFailure = new Error(`later synchronous first-ready failure`)
      const callbackTrace: Array<string> = []
      let syncContinued = false

      const collection = createCollection<{ id: string; name: string }>({
        id: `synchronous-first-ready-failure-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            syncContinued = true
          },
        },
      })
      collection.onFirstReady(() => {
        callbackTrace.push(`first`)
        throw undefined
      })
      collection.onFirstReady(() => {
        callbackTrace.push(`later`)
        throw laterFailure
      })

      try {
        let didThrow = false
        let thrown: unknown
        try {
          collection._sync.startSync()
        } catch (error) {
          didThrow = true
          thrown = error
        }

        expect(didThrow).toBe(true)
        expect(thrown).toBeUndefined()
        expect(syncContinued).toBe(true)
        expect(callbackTrace).toEqual([`first`, `later`])
        expect(collection.status).toBe(`ready`)
        await expect(collection.preload()).resolves.toBeUndefined()
      } finally {
        await collection.cleanup()
      }
    })

    it(`rejects a pending preload when the adapter fails after marking ready`, async () => {
      const adapterFailure = new Error(`adapter failed after ready`)
      const collection = createCollection<{ id: string; name: string }>({
        id: `ready-then-adapter-failure-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            throw adapterFailure
          },
        },
      })
      collection.onFirstReady(() => {
        throw undefined
      })

      try {
        await expect(collection.preload()).rejects.toBe(adapterFailure)
        expect(collection.status).toBe(`error`)
      } finally {
        await collection.cleanup()
      }
    })

    it(`ends the synchronous sync-entry boundary after an adapter failure`, async () => {
      const adapterFailure = new Error(`adapter entry failed`)
      let markReadyCallback: (() => void) | undefined
      const collection = createCollection<{ id: string; name: string }>({
        id: `failed-sync-entry-boundary-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
            throw adapterFailure
          },
        },
      })
      collection.onFirstReady(() => {
        throw undefined
      })

      try {
        expect(() => collection._sync.startSync()).toThrow(adapterFailure)
        expect(collection.status).toBe(`error`)

        let didThrow = false
        let thrown: unknown
        try {
          markReadyCallback!()
        } catch (error) {
          didThrow = true
          thrown = error
        }

        expect(didThrow).toBe(true)
        expect(thrown).toBeUndefined()
        expect(collection.status).toBe(`ready`)
      } finally {
        await collection.cleanup()
      }
    })

    it(`attempts every dependent ready listener before rethrowing`, async () => {
      let markReadyCallback: (() => void) | undefined
      const firstFailure = new Error(`first dependent failed`)
      const firstBatches: Array<Array<unknown>> = []
      const secondBatches: Array<Array<unknown>> = []
      const collection = createCollection<{ id: string; name: string }>({
        id: `dependent-ready-failure-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady as () => void
          },
        },
      })
      const first = collection.subscribeChanges((batch) => {
        firstBatches.push(batch)
        throw firstFailure
      })
      const second = collection.subscribeChanges((batch) => {
        secondBatches.push(batch)
      })

      try {
        let thrown: unknown
        try {
          markReadyCallback!()
        } catch (error) {
          thrown = error
        }

        expect(thrown).toBe(firstFailure)
        expect(firstBatches).toEqual([[]])
        expect(secondBatches).toEqual([[]])
        expect(collection.status).toBe(`ready`)
      } finally {
        first.unsubscribe()
        second.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`flushes work queued by a ready listener when a sibling throws`, async () => {
      let markReadyCallback: (() => void) | undefined
      const firstFailure = new Error(`dependent failed after sibling queued`)
      const scheduledJob = vi.fn()
      const collection = createCollection<{ id: string; name: string }>({
        id: `dependent-ready-scheduler-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
          },
        },
      })
      const first = collection.subscribeChanges(() => {
        const contextId = getActivePublicationContext()
        expect(contextId).toBeDefined()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: scheduledJob,
          run: scheduledJob,
        })
      })
      const second = collection.subscribeChanges(() => {
        throw firstFailure
      })

      try {
        expect(() => markReadyCallback!()).toThrow(firstFailure)
        expect(scheduledJob).toHaveBeenCalledOnce()
        expect(collection.status).toBe(`ready`)
      } finally {
        first.unsubscribe()
        second.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`flushes ready work before rethrowing at an outer publication boundary`, async () => {
      let markReadyCallback: (() => void) | undefined
      const listenerFailure = new Error(`nested dependent failed`)
      const scheduledJob = vi.fn()
      const collection = createCollection<{ id: string; name: string }>({
        id: `nested-dependent-ready-scheduler-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
          },
        },
      })
      const first = collection.subscribeChanges(() => {
        const contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: scheduledJob,
          run: scheduledJob,
        })
      })
      const second = collection.subscribeChanges(() => {
        throw listenerFailure
      })

      try {
        expect(() =>
          withPublicationContext(() => markReadyCallback!()),
        ).toThrow(listenerFailure)
        expect(scheduledJob).toHaveBeenCalledOnce()
        expect(collection.status).toBe(`ready`)
      } finally {
        first.unsubscribe()
        second.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`preserves a falsy ready failure through a nested publication`, async () => {
      let markReadyCallback: (() => void) | undefined
      const scheduledJob = vi.fn()
      const collection = createCollection<{ id: string; name: string }>({
        id: `nested-falsy-ready-failure-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
          },
        },
      })
      const first = collection.subscribeChanges(() => {
        const contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: scheduledJob,
          run: scheduledJob,
        })
      })
      const second = collection.subscribeChanges(() => {
        throw undefined
      })

      try {
        let didThrow = false
        let thrown: unknown
        try {
          withPublicationContext(() => markReadyCallback!())
        } catch (error) {
          didThrow = true
          thrown = error
        }

        expect(didThrow).toBe(true)
        expect(thrown).toBeUndefined()
        expect(scheduledJob).toHaveBeenCalledOnce()
      } finally {
        first.unsubscribe()
        second.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`surfaces a ready graph failure after running its job`, async () => {
      let markReadyCallback: (() => void) | undefined
      const graphFailure = new Error(`ready graph failed`)
      const scheduledJob = vi.fn(() => {
        throw graphFailure
      })
      const collection = createCollection<{ id: string; name: string }>({
        id: `dependent-ready-graph-failure-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {
        const contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: scheduledJob,
          run: scheduledJob,
        })
      })

      try {
        expect(() => markReadyCallback!()).toThrow(graphFailure)
        expect(scheduledJob).toHaveBeenCalledOnce()
        expect(collection.status).toBe(`ready`)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`keeps the ready listener failure when its queued graph job also fails`, async () => {
      let markReadyCallback: (() => void) | undefined
      const listenerFailure = new Error(`ready listener failed first`)
      const graphFailure = new Error(`ready graph also failed`)
      const scheduledJob = vi.fn(() => {
        throw graphFailure
      })
      const collection = createCollection<{ id: string; name: string }>({
        id: `dependent-ready-failure-priority-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
          },
        },
      })
      const first = collection.subscribeChanges(() => {
        const contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: scheduledJob,
          run: scheduledJob,
        })
      })
      const second = collection.subscribeChanges(() => {
        throw listenerFailure
      })

      try {
        expect(() => markReadyCallback!()).toThrow(listenerFailure)
        expect(scheduledJob).toHaveBeenCalledOnce()
        expect(collection.status).toBe(`ready`)
      } finally {
        first.unsubscribe()
        second.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`resolves a pending preload after a ready callback failure alone`, async () => {
      let syncContinued = false
      const collection = createCollection<{ id: string; name: string }>({
        id: `ready-callback-preload-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            syncContinued = true
          },
        },
      })
      collection.onFirstReady(() => {
        throw undefined
      })

      try {
        await expect(collection.preload()).resolves.toBeUndefined()
        expect(syncContinued).toBe(true)
        expect(collection.status).toBe(`ready`)
      } finally {
        await collection.cleanup()
      }
    })

    it(`delivers ready to the subscription snapshot when one listener unsubscribes another`, async () => {
      let markReadyCallback: (() => void) | undefined
      const calls: Array<string> = []
      const collection = createCollection<{ id: string; name: string }>({
        id: `dependent-ready-membership-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady
          },
        },
      })
      const first = collection.subscribeChanges(() => {
        calls.push(`first`)
        second.unsubscribe()
      })
      const second = collection.subscribeChanges(() => {
        calls.push(`second`)
      })

      try {
        markReadyCallback!()
        expect(calls).toEqual([`first`, `second`])
      } finally {
        first.unsubscribe()
        second.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`excludes a dependent added during ready delivery until the next batch`, async () => {
      let beginCallback: (() => void) | undefined
      let writeCallback:
        | ((message: {
            type: `insert`
            value: { id: string; name: string }
          }) => void)
        | undefined
      let commitCallback: (() => void) | undefined
      let markReadyCallback: (() => void) | undefined
      let added: { unsubscribe: () => void } | undefined
      const calls: Array<string> = []
      const collection = createCollection<{ id: string; name: string }>({
        id: `dependent-ready-addition-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            beginCallback = begin
            writeCallback = write
            commitCallback = () => {
              commit()
            }
            markReadyCallback = markReady
          },
        },
      })
      const first = collection.subscribeChanges(() => {
        calls.push(`first`)
        added ??= collection.subscribeChanges(() => calls.push(`added`))
      })
      const second = collection.subscribeChanges(() => calls.push(`second`))

      try {
        markReadyCallback!()
        expect(calls).toEqual([`first`, `second`])

        beginCallback!()
        writeCallback!({
          type: `insert`,
          value: { id: `one`, name: `One` },
        })
        commitCallback!()
        expect(calls).toEqual([`first`, `second`, `first`, `second`, `added`])
      } finally {
        first.unsubscribe()
        second.unsubscribe()
        added?.unsubscribe()
        await collection.cleanup()
      }
    })

    it(`notifies a dependent added during the first-ready fan-out`, async () => {
      let markReadyCallback: (() => void) | undefined
      let dependent: { unsubscribe: () => void } | undefined
      const readyBatches: Array<Array<unknown>> = []
      const collection = createCollection<{ id: string; name: string }>({
        id: `nested-dependent-ready-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReadyCallback = markReady as () => void
          },
        },
      })
      collection.onFirstReady(() => {
        dependent = collection.subscribeChanges((batch) => {
          readyBatches.push(batch)
        })
      })
      const preload = collection.preload()

      try {
        markReadyCallback!()
        await preload
        expect(readyBatches).toEqual([[]])
      } finally {
        dependent?.unsubscribe()
        await collection.cleanup()
      }
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
