import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DefaultOnlineDetector,
  WebOnlineDetector,
} from '../src/connectivity/OnlineDetector'

describe(`WebOnlineDetector`, () => {
  describe(`browser event handling`, () => {
    let originalWindow: typeof globalThis.window
    let originalDocument: typeof globalThis.document
    let windowEventListeners: Map<string, Set<EventListener>>
    let documentEventListeners: Map<string, Set<EventListener>>

    beforeEach(() => {
      // Store originals
      originalWindow = globalThis.window
      originalDocument = globalThis.document

      // Create maps to track event listeners
      windowEventListeners = new Map()
      documentEventListeners = new Map()

      // Mock window with event listener tracking
      Object.defineProperty(globalThis, `window`, {
        value: {
          addEventListener: vi.fn((event: string, handler: EventListener) => {
            if (!windowEventListeners.has(event)) {
              windowEventListeners.set(event, new Set())
            }
            windowEventListeners.get(event)!.add(handler)
          }),
          removeEventListener: vi.fn(
            (event: string, handler: EventListener) => {
              windowEventListeners.get(event)?.delete(handler)
            },
          ),
        },
        writable: true,
        configurable: true,
      })

      // Mock document with event listener tracking
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
      // Restore originals
      Object.defineProperty(globalThis, `window`, {
        value: originalWindow,
        writable: true,
        configurable: true,
      })
      Object.defineProperty(globalThis, `document`, {
        value: originalDocument,
        writable: true,
        configurable: true,
      })
    })

    it(`should notify subscribers when online event fires`, () => {
      const detector = new WebOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // Simulate the online event
      const onlineHandlers = windowEventListeners.get(`online`)
      expect(onlineHandlers).toBeDefined()
      expect(onlineHandlers!.size).toBe(1)

      // Fire the online event
      for (const handler of onlineHandlers!) {
        handler(new Event(`online`))
      }

      expect(callback).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should notify subscribers when visibility changes to visible`, () => {
      const detector = new WebOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // Simulate visibility change to visible
      ;(globalThis.document as any).visibilityState = `visible`

      const visibilityHandlers = documentEventListeners.get(`visibilitychange`)
      expect(visibilityHandlers).toBeDefined()
      expect(visibilityHandlers!.size).toBe(1)

      // Fire the visibilitychange event
      for (const handler of visibilityHandlers!) {
        handler(new Event(`visibilitychange`))
      }

      expect(callback).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should not notify when visibility changes to hidden`, () => {
      const detector = new WebOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)

      // Keep visibility as hidden
      ;(globalThis.document as any).visibilityState = `hidden`

      const visibilityHandlers = documentEventListeners.get(`visibilitychange`)

      // Fire the visibilitychange event
      for (const handler of visibilityHandlers!) {
        handler(new Event(`visibilitychange`))
      }

      expect(callback).not.toHaveBeenCalled()

      detector.dispose()
    })

    it(`should unsubscribe from events on dispose`, () => {
      const detector = new WebOnlineDetector()
      const callback = vi.fn()

      detector.subscribe(callback)
      detector.dispose()

      expect(window.removeEventListener).toHaveBeenCalledWith(
        `online`,
        expect.any(Function),
      )
      expect(document.removeEventListener).toHaveBeenCalledWith(
        `visibilitychange`,
        expect.any(Function),
      )
    })

    it(`should support multiple subscribers`, () => {
      const detector = new WebOnlineDetector()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      detector.subscribe(callback1)
      detector.subscribe(callback2)

      detector.notifyOnline()

      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)

      detector.dispose()
    })

    it(`should stop listening when all subscribers unsubscribe`, () => {
      const detector = new WebOnlineDetector()
      const callback = vi.fn()

      const unsubscribe = detector.subscribe(callback)
      unsubscribe()

      expect(window.removeEventListener).toHaveBeenCalledWith(
        `online`,
        expect.any(Function),
      )
    })
  })
})

describe(`DefaultOnlineDetector (backwards compatibility alias)`, () => {
  it(`should be the same as WebOnlineDetector`, () => {
    expect(DefaultOnlineDetector).toBe(WebOnlineDetector)
  })
})
