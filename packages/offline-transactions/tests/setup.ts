import { vi } from "vitest"

// Mock browser APIs that might not be available in test environment
Object.defineProperty(global, `crypto`, {
  value: {
    randomUUID: () => Math.random().toString(36).substring(2, 15),
  },
})

Object.defineProperty(global, `navigator`, {
  value: {
    onLine: true,
    locks: {
      request: vi.fn().mockResolvedValue(false),
    },
  },
})

Object.defineProperty(global, `BroadcastChannel`, {
  value: vi.fn().mockImplementation(() => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(),
  })),
})

Object.defineProperty(global, `indexedDB`, {
  value: {
    open: vi.fn().mockReturnValue({
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
      result: null,
      error: new Error(`IndexedDB not available in test environment`),
    }),
  },
})

Object.defineProperty(global, `localStorage`, {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    key: vi.fn(),
    length: 0,
  },
})

Object.defineProperty(global, `document`, {
  value: {
    visibilityState: `visible`,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
})

Object.defineProperty(global, `window`, {
  value: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
  },
})
