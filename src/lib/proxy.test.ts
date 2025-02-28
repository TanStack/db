import { describe, it, expect } from "vitest"
import {
  createChangeProxy,
  createArrayChangeProxy,
  withChangeTracking,
  withArrayChangeTracking,
} from "./proxy"

describe(`Proxy Library`, () => {
  describe(`createChangeProxy`, () => {
    it(`should track changes to an object`, () => {
      const obj = { name: `John`, age: 30 }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Make changes to the proxy
      proxy.name = `Jane`
      proxy.age = 31

      // Check that the changes are tracked
      expect(getChanges()).toEqual({
        name: `Jane`,
        age: 31,
      })

      // Check that the original object is modified
      expect(obj).toEqual({
        name: `Jane`,
        age: 31,
      })
    })

    it(`should only track properties that actually change`, () => {
      const obj = { name: `John`, age: 30 }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Set a property to the same value
      proxy.name = `John`
      // Change another property
      proxy.age = 31

      // Only the changed property should be tracked
      expect(getChanges()).toEqual({
        age: 31,
      })
    })

    it(`should handle nested property access`, () => {
      const obj = { user: { name: `John`, age: 30 } }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Change a nested property
      proxy.user = { name: `Jane`, age: 31 }

      // The entire user object should be tracked as a change
      expect(getChanges()).toEqual({
        user: { name: `Jane`, age: 31 },
      })
    })
  })

  describe(`createArrayChangeProxy`, () => {
    it(`should track changes to an array of objects`, () => {
      const objs = [
        { id: 1, name: `John` },
        { id: 2, name: `Jane` },
      ]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Make changes to the proxies
      proxies[0].name = `Johnny`
      proxies[1].name = `Janet`

      // Check that the changes are tracked
      expect(getChanges()).toEqual([{ name: `Johnny` }, { name: `Janet` }])

      // Check that the original objects are modified
      expect(objs).toEqual([
        { id: 1, name: `Johnny` },
        { id: 2, name: `Janet` },
      ])
    })
  })

  describe(`withChangeTracking`, () => {
    it(`should track changes made in the callback`, () => {
      const obj = { name: `John`, age: 30 }

      const changes = withChangeTracking(obj, (proxy) => {
        proxy.name = `Jane`
        proxy.age = 31
      })

      // Check that the changes are tracked
      expect(changes).toEqual({
        name: `Jane`,
        age: 31,
      })

      // Check that the original object is modified
      expect(obj).toEqual({
        name: `Jane`,
        age: 31,
      })
    })
  })

  describe(`withArrayChangeTracking`, () => {
    it(`should track changes made to multiple objects in the callback`, () => {
      const objs = [
        { id: 1, name: `John` },
        { id: 2, name: `Jane` },
      ]

      const changes = withArrayChangeTracking(objs, (proxies) => {
        proxies[0].name = `Johnny`
        proxies[1].name = `Janet`
      })

      // Check that the changes are tracked
      expect(changes).toEqual([{ name: `Johnny` }, { name: `Janet` }])

      // Check that the original objects are modified
      expect(objs).toEqual([
        { id: 1, name: `Johnny` },
        { id: 2, name: `Janet` },
      ])
    })

    it(`should handle empty changes`, () => {
      const objs = [
        { id: 1, name: `John` },
        { id: 2, name: `Jane` },
      ]

      const changes = withArrayChangeTracking(objs, () => {
        // No changes made
      })

      // No changes should be tracked
      expect(changes).toEqual([{}, {}])

      // Original objects should remain unchanged
      expect(objs).toEqual([
        { id: 1, name: `John` },
        { id: 2, name: `Jane` },
      ])
    })
  })
})
