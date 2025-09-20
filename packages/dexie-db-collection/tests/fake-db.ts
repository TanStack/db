// Provide an IndexedDB implementation for Node-based tests using fake-indexeddb
// This uses the documented public API rather than internal paths.
import { IDBKeyRange } from "fake-indexeddb"
import "fake-indexeddb/auto"

// Ensure IDBKeyRange is available on the global scope for libraries
if (typeof (globalThis as any).IDBKeyRange === `undefined`) {
  ;(globalThis as any).IDBKeyRange = IDBKeyRange
}

// Some jsdom environments may not expose structuredClone. If missing, provide
// a minimal polyfill so fake-indexeddb won't break. For full fidelity use
// `core-js/stable/structured-clone` if you need full compatibility.
if (typeof (globalThis as any).structuredClone === `undefined`) {
  // Minimal shallow structured clone fallback for tests.
  ;(globalThis as any).structuredClone = (v: unknown) =>
    JSON.parse(JSON.stringify(v))
}

export {}

// Simple in-process BroadcastChannel polyfill for Node tests.
// Many environments (Node + jsdom) don't provide BroadcastChannel; Dexie
// drivers rely on it to communicate changes across instances/tabs. This
// polyfill routes messages to other channels within the same process.
if (typeof (globalThis as any).BroadcastChannel === `undefined`) {
  type Handler = (ev: MessageEvent) => void
  const channels = new Map<string, Set<Handler>>()

  class PolyBroadcastChannel {
    name: string
    onmessage: ((ev: MessageEvent) => void) | null = null
    constructor(name: string) {
      this.name = name
      if (!channels.has(name)) channels.set(name, new Set())
    }
    postMessage(msg: any) {
      const set = channels.get(this.name)
      if (!set) return
      for (const h of Array.from(set)) {
        try {
          // Call via setTimeout to mimic async delivery
          setTimeout(() => h({ data: msg } as MessageEvent), 0)
        } catch {
          // ignore
        }
      }
      // Also deliver to `onmessage` handler if assigned (some libs use this)
      try {
        if (typeof (this as any).onmessage === `function`) {
          setTimeout(
            () => (this as any).onmessage({ data: msg } as MessageEvent),
            0
          )
        }
      } catch {
        // ignore
      }
    }
    addEventListener(_type: string, fn: Handler) {
      const set = channels.get(this.name)!
      set.add(fn)
      // Ensure `onmessage` exists so consumers can assign to it
      if (!(this as any).onmessage) (this as any).onmessage = null
    }
    removeEventListener(_type: string, fn: Handler) {
      const set = channels.get(this.name)
      set?.delete(fn)
    }
    close() {
      channels.delete(this.name)
    }
  }

  ;(globalThis as any).BroadcastChannel = PolyBroadcastChannel
}
