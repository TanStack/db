import { beforeEach, describe, expect, it, vi } from 'vitest'

// Import after mocks are set up
import { AppState } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { ReactNativeOnlineDetector } from '../src/connectivity/ReactNativeOnlineDetector'

// Mock the react-native module
vi.mock(`react-native`, () => {
  const listeners: Array<(state: string) => void> = []
  return {
    AppState: {
      addEventListener: vi.fn(
        (event: string, callback: (state: string) => void) => {
          if (event === `change`) {
            listeners.push(callback)
          }
          return {
            remove: vi.fn(() => {
              const index = listeners.indexOf(callback)
              if (index > -1) {
                listeners.splice(index, 1)
              }
            }),
          }
        },
      ),
      // Expose for testing
      __listeners: listeners,
      __triggerChange: (state: string) => {
        for (const listener of listeners) {
          listener(state)
        }
      },
    },
  }
})

// Mock the @react-native-community/netinfo module
vi.mock(`@react-native-community/netinfo`, () => {
  const listeners: Array<
    (state: {
      isConnected: boolean
      isInternetReachable: boolean | null
    }) => void
  > = []
  return {
    default: {
      addEventListener: vi.fn(
        (
          callback: (state: {
            isConnected: boolean
            isInternetReachable: boolean | null
          }) => void,
        ) => {
          listeners.push(callback)
          return () => {
            const index = listeners.indexOf(callback)
            if (index > -1) {
              listeners.splice(index, 1)
            }
          }
        },
      ),
      // Expose for testing
      __listeners: listeners,
      __triggerState: (state: {
        isConnected: boolean
        isInternetReachable: boolean | null
      }) => {
        for (const listener of listeners) {
          listener(state)
        }
      },
    },
  }
})

describe(`ReactNativeOnlineDetector`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear internal listener arrays
    ;(AppState as any).__listeners.length = 0
    ;(NetInfo as any).__listeners.length = 0
  })

  describe(`initialization`, () => {
    it(`should subscribe to NetInfo on construction`, () => {
      const detector = new ReactNativeOnlineDetector()

      expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1)
      expect(NetInfo.addEventListener).toHaveBeenCalledWith(
        expect.any(Function),
      )

      detector.dispose()
    })

    it(`should subscribe to AppState on construction`, () => {
      const detector = new ReactNativeOnlineDetector()

      expect(AppState.addEventListener).toHaveBeenCalledTimes(1)
      expect(AppState.addEventListener).toHaveBeenCalledWith(
        `change`,
        expect.any(Function),
      )

      detector.dispose()
    })
  })

  describe(`network connectivity changes`, () => {
    it(`should notify subscribers when transitioning from offline to online`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // First, simulate offline state
      ;(NetInfo as any).__triggerState({
        isConnected: false,
        isInternetReachable: false,
      })

      expect(callback).not.toHaveBeenCalled()

      // Now simulate coming online
      ;(NetInfo as any).__triggerState({
        isConnected: true,
        isInternetReachable: true,
      })

      expect(callback).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should not notify when already online and staying online`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // Simulate online state (detector starts assuming online)
      ;(NetInfo as any).__triggerState({
        isConnected: true,
        isInternetReachable: true,
      })

      // Should not trigger since we were already considered online
      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })

    it(`should treat isInternetReachable null as potentially reachable`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // First go offline
      ;(NetInfo as any).__triggerState({
        isConnected: false,
        isInternetReachable: false,
      })

      // Now come online with null isInternetReachable (unknown)
      ;(NetInfo as any).__triggerState({
        isConnected: true,
        isInternetReachable: null,
      })

      expect(callback).toHaveBeenCalledTimes(1)

      detector.dispose()
    })
  })

  describe(`app state changes`, () => {
    it(`should notify subscribers when app becomes active`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // Simulate app becoming active (foregrounded)
      ;(AppState as any).__triggerChange(`active`)

      expect(callback).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should not notify when app goes to background`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // Simulate app going to background
      ;(AppState as any).__triggerChange(`background`)

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })

    it(`should not notify when app becomes inactive`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // Simulate app becoming inactive
      ;(AppState as any).__triggerChange(`inactive`)

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })
  })

  describe(`subscription management`, () => {
    it(`should support multiple subscribers`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      detector.subscribe(callback1)
      detector.subscribe(callback2)

      detector.notifyOnline()

      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should allow unsubscribing`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      const unsubscribe = detector.subscribe(callback)
      unsubscribe()

      detector.notifyOnline()

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })

    it(`should handle notifyOnline() manual trigger`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      detector.notifyOnline()
      detector.notifyOnline()

      expect(callback).toHaveBeenCalledTimes(2)

      detector.dispose()
    })
  })

  describe(`disposal`, () => {
    it(`should unsubscribe from all native events on dispose`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)
      detector.dispose()

      // NetInfo and AppState listeners should be cleared
      expect((NetInfo as any).__listeners.length).toBe(0)
      expect((AppState as any).__listeners.length).toBe(0)
    })

    it(`should not notify after dispose`, () => {
      const detector = new ReactNativeOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)
      detector.dispose()

      // Try to trigger events - should not notify
      detector.notifyOnline()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe(`error handling`, () => {
    it(`should catch and warn on listener errors without stopping other listeners`, () => {
      const detector = new ReactNativeOnlineDetector()
      const consoleWarnSpy = vi
        .spyOn(console, `warn`)
        .mockImplementation(() => {})
      const errorCallback = vi.fn(() => {
        throw new Error(`Test error`)
      })
      const successCallback = vi.fn()

      detector.subscribe(errorCallback)
      detector.subscribe(successCallback)

      detector.notifyOnline()

      expect(errorCallback).toHaveBeenCalledTimes(1)
      expect(successCallback).toHaveBeenCalledTimes(1)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `ReactNativeOnlineDetector listener error:`,
        expect.any(Error),
      )

      consoleWarnSpy.mockRestore()
      detector.dispose()
    })
  })
})
