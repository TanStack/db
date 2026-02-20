import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Network } from '@capacitor/network'
import { CapacitorOnlineDetector } from '../src/connectivity/CapacitorOnlineDetector'

type NetworkStatusCallback = (status: { connected: boolean; connectionType: string }) => void

const networkListeners: Array<NetworkStatusCallback> = []
const mockRemove = vi.fn()

vi.mock(`@capacitor/network`, () => ({
  Network: {
    addListener: vi.fn(
      (_event: string, callback: NetworkStatusCallback) => {
        networkListeners.push(callback)
        const handle = {
          remove: vi.fn(() => {
            const index = networkListeners.indexOf(callback)
            if (index > -1) {
              networkListeners.splice(index, 1)
            }
            mockRemove()
            return Promise.resolve()
          }),
        }
        return Promise.resolve(handle)
      },
    ),
    removeAllListeners: vi.fn(() => Promise.resolve()),
  },
}))

function triggerNetworkChange(status: { connected: boolean; connectionType: string }): void {
  for (const listener of networkListeners) {
    listener(status)
  }
}

describe(`CapacitorOnlineDetector`, () => {
  let originalDocument: typeof globalThis.document
  let documentEventListeners: Map<string, Set<EventListener>>

  beforeEach(() => {
    vi.clearAllMocks()
    networkListeners.length = 0

    originalDocument = globalThis.document
    documentEventListeners = new Map()

    Object.defineProperty(globalThis, `document`, {
      value: {
        visibilityState: `hidden`,
        addEventListener: vi.fn((event: string, handler: EventListener) => {
          if (!documentEventListeners.has(event)) {
            documentEventListeners.set(event, new Set())
          }
          documentEventListeners.get(event)!.add(handler)
        }),
        removeEventListener: vi.fn(
          (event: string, handler: EventListener) => {
            documentEventListeners.get(event)?.delete(handler)
          },
        ),
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, `document`, {
      value: originalDocument,
      writable: true,
      configurable: true,
    })
  })

  describe(`initialization`, () => {
    it(`should subscribe to Network on construction`, () => {
      const detector = new CapacitorOnlineDetector()

      expect(Network.addListener).toHaveBeenCalledTimes(1)
      expect(Network.addListener).toHaveBeenCalledWith(
        `networkStatusChange`,
        expect.any(Function),
      )

      detector.dispose()
    })

    it(`should subscribe to visibilitychange on construction`, () => {
      const detector = new CapacitorOnlineDetector()

      expect(document.addEventListener).toHaveBeenCalledWith(
        `visibilitychange`,
        expect.any(Function),
      )

      detector.dispose()
    })
  })

  describe(`network connectivity changes`, () => {
    it(`should notify subscribers when transitioning from offline to online`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      triggerNetworkChange({ connected: false, connectionType: `none` })
      expect(callback).not.toHaveBeenCalled()

      triggerNetworkChange({ connected: true, connectionType: `wifi` })
      expect(callback).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should not notify when already online and staying online`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      triggerNetworkChange({ connected: true, connectionType: `wifi` })

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })

    it(`should not notify when going from online to offline`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      triggerNetworkChange({ connected: false, connectionType: `none` })

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })

    it(`should notify again on repeated offline-to-online transitions`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      triggerNetworkChange({ connected: false, connectionType: `none` })
      triggerNetworkChange({ connected: true, connectionType: `cellular` })
      expect(callback).toHaveBeenCalledTimes(1)

      triggerNetworkChange({ connected: false, connectionType: `none` })
      triggerNetworkChange({ connected: true, connectionType: `wifi` })
      expect(callback).toHaveBeenCalledTimes(2)

      detector.dispose()
    })
  })

  describe(`visibility changes`, () => {
    it(`should notify subscribers when visibility changes to visible`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      ;(globalThis.document as any).visibilityState = `visible`
      const handlers = documentEventListeners.get(`visibilitychange`)
      for (const handler of handlers!) {
        handler(new Event(`visibilitychange`))
      }

      expect(callback).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should not notify when visibility changes to hidden`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      ;(globalThis.document as any).visibilityState = `hidden`
      const handlers = documentEventListeners.get(`visibilitychange`)
      for (const handler of handlers!) {
        handler(new Event(`visibilitychange`))
      }

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })
  })

  describe(`subscription management`, () => {
    it(`should support multiple subscribers`, () => {
      const detector = new CapacitorOnlineDetector()
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
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      const unsubscribe = detector.subscribe(callback)
      unsubscribe()

      detector.notifyOnline()

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })

    it(`should handle notifyOnline() manual trigger`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      detector.notifyOnline()
      detector.notifyOnline()

      expect(callback).toHaveBeenCalledTimes(2)

      detector.dispose()
    })

    it(`should stop listening when all subscribers unsubscribe`, async () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      const unsubscribe = detector.subscribe(callback)

      await vi.waitFor(() => {
        expect(networkListeners.length).toBe(1)
      })

      unsubscribe()

      await vi.waitFor(() => {
        expect(mockRemove).toHaveBeenCalled()
      })

      expect(document.removeEventListener).toHaveBeenCalledWith(
        `visibilitychange`,
        expect.any(Function),
      )
    })
  })

  describe(`disposal`, () => {
    it(`should remove network listener on dispose`, async () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      await vi.waitFor(() => {
        expect(networkListeners.length).toBe(1)
      })

      detector.dispose()

      await vi.waitFor(() => {
        expect(mockRemove).toHaveBeenCalled()
      })
    })

    it(`should remove visibilitychange listener on dispose`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)
      detector.dispose()

      expect(document.removeEventListener).toHaveBeenCalledWith(
        `visibilitychange`,
        expect.any(Function),
      )
    })

    it(`should not notify after dispose`, () => {
      const detector = new CapacitorOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)
      detector.dispose()

      detector.notifyOnline()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe(`error handling`, () => {
    it(`should catch and warn on listener errors without stopping other listeners`, () => {
      const detector = new CapacitorOnlineDetector()
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
        `CapacitorOnlineDetector listener error:`,
        expect.any(Error),
      )

      consoleWarnSpy.mockRestore()
      detector.dispose()
    })
  })
})
