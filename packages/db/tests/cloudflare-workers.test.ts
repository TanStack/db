import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection, lazyInitForWorkers } from "../src"
import { localOnlyCollectionOptions } from "../src/local-only"

describe(`Cloudflare Workers compatibility`, () => {
  let originalNavigator: typeof globalThis.navigator

  beforeEach(() => {
    // Save original navigator
    originalNavigator = globalThis.navigator
  })

  afterEach(() => {
    // Restore original navigator
    Object.defineProperty(globalThis, `navigator`, {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  describe(`lazyInitForWorkers`, () => {
    it(`should defer initialization until first access`, () => {
      const factorySpy = vi.fn(() => ({ value: 42, getValue: () => 42 }))

      const lazy = lazyInitForWorkers(factorySpy)

      // Factory should not be called yet
      expect(factorySpy).not.toHaveBeenCalled()

      // Access a property
      expect(lazy.value).toBe(42)

      // Factory should be called once
      expect(factorySpy).toHaveBeenCalledOnce()
    })

    it(`should only initialize once (singleton behavior)`, () => {
      const factorySpy = vi.fn(() => ({ value: 42, increment: () => {} }))

      const lazy = lazyInitForWorkers(factorySpy)

      // Multiple accesses
      lazy.value
      lazy.increment()
      lazy.value

      // Factory should still only be called once
      expect(factorySpy).toHaveBeenCalledOnce()
    })

    it(`should preserve method binding`, () => {
      class Counter {
        count = 0
        increment() {
          this.count++
        }
        getCount() {
          return this.count
        }
      }

      const lazy = lazyInitForWorkers(() => new Counter())

      // Call methods
      lazy.increment()
      lazy.increment()

      // Should work correctly with proper `this` binding
      expect(lazy.getCount()).toBe(2)
      expect(lazy.count).toBe(2)
    })

    it(`should support property writes`, () => {
      const lazy = lazyInitForWorkers(() => ({ value: 0 }))

      lazy.value = 10
      expect(lazy.value).toBe(10)
    })

    it(`should support delete operations`, () => {
      const lazy = lazyInitForWorkers(() => ({
        value: 0,
        extra: 123 as number | undefined,
      }))

      delete (lazy as any).extra
      expect(`extra` in lazy).toBe(false)
    })

    it(`should support has operator`, () => {
      const lazy = lazyInitForWorkers(() => ({ value: 0 }))

      expect(`value` in lazy).toBe(true)
      expect(`nonexistent` in lazy).toBe(false)
    })

    it(`should support ownKeys`, () => {
      const lazy = lazyInitForWorkers(() => ({ a: 1, b: 2 }))

      expect(Object.keys(lazy)).toEqual([`a`, `b`])
    })

    it(`should support getOwnPropertyDescriptor`, () => {
      const lazy = lazyInitForWorkers(() => ({ value: 42 }))

      const descriptor = Object.getOwnPropertyDescriptor(lazy, `value`)
      expect(descriptor).toBeDefined()
      expect(descriptor?.value).toBe(42)
    })

    it(`should support getPrototypeOf`, () => {
      class MyClass {
        value = 42
      }

      const lazy = lazyInitForWorkers(() => new MyClass())

      expect(Object.getPrototypeOf(lazy)).toBe(MyClass.prototype)
    })

    it(`should support getters`, () => {
      class MyClass {
        _value = 42
        get value() {
          return this._value
        }
      }

      const lazy = lazyInitForWorkers(() => new MyClass())

      expect(lazy.value).toBe(42)
    })

    it(`should support getters that call other methods`, () => {
      class MyClass {
        values = [1, 2, 3]
        getValues() {
          return this.values
        }
        get asArray() {
          return Array.from(this.getValues())
        }
      }

      const lazy = lazyInitForWorkers(() => new MyClass())

      expect(lazy.asArray).toEqual([1, 2, 3])
    })
  })

  describe(`createCollection with Cloudflare Workers detection`, () => {
    it(`should use lazy initialization when in Cloudflare Workers`, () => {
      // Mock Cloudflare Workers environment
      Object.defineProperty(globalThis, `navigator`, {
        value: { userAgent: `Cloudflare-Workers` },
        writable: true,
        configurable: true,
      })

      const insertSpy = vi.fn()

      // Create collection
      const collection = createCollection(
        localOnlyCollectionOptions({
          getKey: (item: { id: number }) => item.id,
          onInsert: insertSpy,
        })
      )

      // onInsert should not be called yet (collection not initialized)
      expect(insertSpy).not.toHaveBeenCalled()

      // Access a property to trigger initialization
      const id = collection.id

      // Should now have an ID
      expect(typeof id).toBe(`string`)
    })

    it(`should use normal initialization in non-Cloudflare environments`, () => {
      // Mock non-Cloudflare environment
      Object.defineProperty(globalThis, `navigator`, {
        value: { userAgent: `Mozilla/5.0` },
        writable: true,
        configurable: true,
      })

      // Create collection
      const collection = createCollection(
        localOnlyCollectionOptions({
          getKey: (item: { id: number }) => item.id,
        })
      )

      // Should be initialized immediately
      expect(typeof collection.id).toBe(`string`)
    })

    it(`should work when navigator is undefined`, () => {
      // Mock environment without navigator (e.g., Node.js)
      Object.defineProperty(globalThis, `navigator`, {
        value: undefined,
        writable: true,
        configurable: true,
      })

      // Should not throw
      const collection = createCollection(
        localOnlyCollectionOptions({
          getKey: (item: { id: number }) => item.id,
        })
      )

      expect(typeof collection.id).toBe(`string`)
    })

    it(`should allow normal collection operations with lazy initialization`, async () => {
      // Mock Cloudflare Workers environment
      Object.defineProperty(globalThis, `navigator`, {
        value: { userAgent: `Cloudflare-Workers` },
        writable: true,
        configurable: true,
      })

      type Todo = { id: number; title: string; completed: boolean }

      const collection = createCollection(
        localOnlyCollectionOptions<Todo>({
          getKey: (item) => item.id,
        })
      )

      // Insert items
      const tx1 = collection.insert({
        id: 1,
        title: `Task 1`,
        completed: false,
      })
      const tx2 = collection.insert({ id: 2, title: `Task 2`, completed: true })

      await tx1
      await tx2

      // Query items
      const all = collection.toArray
      expect(all).toHaveLength(2)

      const item = collection.get(1)
      expect(item?.title).toBe(`Task 1`)

      // Update item
      const updateTx = collection.update(1, (draft) => {
        draft.completed = true
      })
      await updateTx

      const updated = collection.get(1)
      expect(updated?.completed).toBe(true)

      // Delete item
      const deleteTx = collection.delete(1)
      await deleteTx

      expect(collection.has(1)).toBe(false)
      expect(collection.size).toBe(1)
    })
  })
})
