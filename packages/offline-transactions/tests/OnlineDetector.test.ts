import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DefaultOnlineDetector } from '../src/connectivity/OnlineDetector'

describe(`DefaultOnlineDetector`, () => {
  describe(`React Native compatibility`, () => {
    let originalWindow: typeof globalThis.window
    let originalDocument: typeof globalThis.document

    beforeEach(() => {
      // Store originals
      originalWindow = globalThis.window
      originalDocument = globalThis.document
    })

    afterEach(() => {
      // Restore originals
      Object.defineProperty(globalThis, `window`, { value: originalWindow, writable: true })
      Object.defineProperty(globalThis, `document`, { value: originalDocument, writable: true })
    })

    it(`should not throw when window exists but addEventListener is undefined (issue #1013)`, () => {
      // Simulate React Native environment where window exists but addEventListener is not available
      Object.defineProperty(globalThis, `window`, {
        value: {
          // window exists but addEventListener is not defined
          setTimeout: global.setTimeout,
          clearTimeout: global.clearTimeout,
        },
        writable: true,
      })

      Object.defineProperty(globalThis, `document`, {
        value: undefined,
        writable: true,
      })

      // This should NOT throw - the detector should gracefully handle missing addEventListener
      expect(() => {
        const detector = new DefaultOnlineDetector()
        detector.dispose()
      }).not.toThrow()
    })

    it(`should not throw when document exists but addEventListener is undefined`, () => {
      // Simulate environment where document exists but has no addEventListener
      Object.defineProperty(globalThis, `window`, {
        value: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
      })

      Object.defineProperty(globalThis, `document`, {
        value: {
          visibilityState: `visible`,
          // document exists but addEventListener is not defined
        },
        writable: true,
      })

      // This should NOT throw
      expect(() => {
        const detector = new DefaultOnlineDetector()
        detector.dispose()
      }).not.toThrow()
    })

    it(`should still function when subscription is called in limited environment`, () => {
      Object.defineProperty(globalThis, `window`, {
        value: {
          // No addEventListener
        },
        writable: true,
      })

      Object.defineProperty(globalThis, `document`, {
        value: undefined,
        writable: true,
      })

      const detector = new DefaultOnlineDetector()
      const callback = vi.fn()

      // Should be able to subscribe without throwing
      const unsubscribe = detector.subscribe(callback)
      expect(typeof unsubscribe).toBe(`function`)

      // Manual notification should still work
      detector.notifyOnline()
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      detector.dispose()
    })
  })
})
