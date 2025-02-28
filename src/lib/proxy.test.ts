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

    it(`should track when object properties are changed`, () => {
      const obj = { name: `John`, age: 30, active: false }
      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.name = `Jane`
      proxy.active = true

      expect(getChanges()).toEqual({
        name: `Jane`,
        active: true,
      })
      expect(obj.name).toBe(`Jane`)
      expect(obj.active).toBe(true)
    })

    it(`should track changes to properties within nested objects`, () => {
      const obj = {
        user: {
          name: `John`,
          contact: {
            email: `john@example.com`,
            phone: `123-456-7890`,
          },
        },
      }
      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.user.contact = {
        email: `john.doe@example.com`,
        phone: `123-456-7890`,
      }

      expect(getChanges()).toEqual({
        user: {
          name: `John`,
          contact: {
            email: `john.doe@example.com`,
            phone: `123-456-7890`,
          },
        },
      })
    })

    it(`should track when properties are deleted from objects`, () => {
      const obj = { name: `John`, age: 30, role: `admin` }
      const { proxy, getChanges } = createChangeProxy(obj)

      delete proxy.role

      expect(getChanges()).toEqual({
        role: undefined,
      })
      expect(obj).toEqual({
        name: `John`,
        age: 30,
      })
    })

    it(`should not track properties when values remain the same`, () => {
      const obj = { name: `John`, age: 30, active: true }
      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.name = `John`
      proxy.age = 30
      proxy.active = true

      expect(getChanges()).toEqual({})
      expect(obj).toEqual({ name: `John`, age: 30, active: true })
    })

    it(`should properly handle objects with circular references`, () => {
      const obj: unknown = { name: `John`, age: 30 }
      obj.self = obj // Create circular reference

      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.name = `Jane`

      expect(getChanges()).toEqual({
        name: `Jane`,
      })
      expect(obj.name).toBe(`Jane`)
    })

    it(`should properly handle Date object mutations`, () => {
      const obj = {
        name: `John`,
        createdAt: new Date(`2023-01-01`),
      }
      const { proxy, getChanges } = createChangeProxy(obj)

      const newDate = new Date(`2023-02-01`)
      proxy.createdAt = newDate

      expect(getChanges()).toEqual({
        createdAt: newDate,
      })
      expect(obj.createdAt).toEqual(newDate)
    })

    it(`should track changes to custom class properties`, () => {
      class Person {
        name: string
        age: number

        constructor(name: string, age: number) {
          this.name = name
          this.age = age
        }
      }

      const obj = {
        person: new Person(`John`, 30),
      }

      const { proxy, getChanges } = createChangeProxy(obj)
      proxy.person = new Person(`Jane`, 25)

      expect(getChanges()).toEqual({
        person: new Person(`Jane`, 25),
      })
      expect(obj.person).toEqual(new Person(`Jane`, 25))
    })

    it(`should track changes in deeply nested object structures`, () => {
      const obj = {
        company: {
          department: {
            team: {
              lead: {
                name: `John`,
                role: `Team Lead`,
              },
              members: [`Alice`, `Bob`],
            },
          },
        },
      }

      const { proxy, getChanges } = createChangeProxy(obj)

      // Access the nested property through the proxy chain
      const companyProxy = proxy.company
      const departmentProxy = companyProxy.department
      const teamProxy = departmentProxy.team
      const leadProxy = teamProxy.lead
      leadProxy.name = `Jane`

      expect(getChanges()).toEqual({
        company: {
          department: {
            team: {
              lead: {
                name: `Jane`,
                role: `Team Lead`,
              },
              members: [`Alice`, `Bob`],
            },
          },
        },
      })
    })

    it(`should handle regular expression mutations`, () => {
      const obj = {
        pattern: /test/i,
      }

      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.pattern = /new-pattern/g

      expect(getChanges()).toEqual({
        pattern: /new-pattern/g,
      })
      expect(obj.pattern).toEqual(/new-pattern/g)
    })

    it(`should properly track BigInt type values`, () => {
      const obj = {
        id: BigInt(123456789),
      }

      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.id = BigInt(987654321)

      expect(getChanges()).toEqual({
        id: BigInt(987654321),
      })
      expect(obj.id).toBe(BigInt(987654321))
    })

    it(`should handle complex objects with multiple special types`, () => {
      const obj = {
        id: BigInt(123),
        pattern: /test/,
        date: new Date(`2023-01-01`),
      }

      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.id = BigInt(456)
      proxy.pattern = /updated/
      proxy.date = new Date(`2023-06-01`)

      expect(getChanges()).toEqual({
        id: BigInt(456),
        pattern: /updated/,
        date: new Date(`2023-06-01`),
      })
    })

    it(`should handle property descriptors with getters and setters`, () => {
      const obj = {
        _name: `John`,
        get name() {
          return this._name
        },
        set name(value) {
          this._name = value
        },
      }

      const { proxy, getChanges } = createChangeProxy(obj)
      proxy.name = `Jane`

      expect(getChanges()).toEqual({
        name: `Jane`,
      })
      expect(obj._name).toBe(`Jane`)
      expect(obj.name).toBe(`Jane`)
    })

    it(`should handle symbolic properties`, () => {
      const symbolKey = Symbol(`test`)
      const obj = {
        [symbolKey]: `value`,
      }

      const { proxy, getChanges } = createChangeProxy(obj)
      proxy[symbolKey] = `new value`

      const changes = getChanges()
      expect(changes[symbolKey]).toBe(`new value`)
      expect(obj[symbolKey]).toBe(`new value`)
    })

    it(`should handle non-enumerable properties`, () => {
      const obj = {}
      Object.defineProperty(obj, `hidden`, {
        value: `original`,
        enumerable: false,
        writable: true,
        configurable: true,
      })

      const { proxy, getChanges } = createChangeProxy(obj)
      proxy.hidden = `modified`

      expect(getChanges()).toEqual({
        hidden: `modified`,
      })
      expect(obj.hidden).toBe(`modified`)
    })

    it(`should prevent prototype pollution`, () => {
      const obj = { constructor: { prototype: {} } }
      const { proxy } = createChangeProxy(obj)

      // Attempt to modify Object.prototype through the proxy
      proxy.__proto__ = { malicious: true }
      proxy.constructor.prototype.malicious = true

      // Verify that Object.prototype wasn't polluted
      expect({}.malicious).toBeUndefined()
      expect(Object.prototype.malicious).toBeUndefined()

      // The changes should only affect the proxy's own prototype chain
      expect(proxy.__proto__.malicious).toBe(true)
      expect(proxy.constructor.prototype.malicious).toBe(true)
    })
  })

  describe(`Map and Set Operations`, () => {
    it(`should track Map clear operations`, () => {
      const map = new Map([
        [`key1`, `value1`],
        [`key2`, `value2`],
      ])
      const { proxy, getChanges } = createChangeProxy({ map })

      proxy.map.clear()

      expect(getChanges()).toEqual({
        map: new Map(),
      })
      expect(map.size).toBe(0)
    })

    it(`should track Map delete operations`, () => {
      const map = new Map([
        [`key1`, `value1`],
        [`key2`, `value2`],
      ])
      const { proxy, getChanges } = createChangeProxy({ map })

      proxy.map.delete(`key1`)

      expect(getChanges()).toEqual({
        map: new Map([[`key2`, `value2`]]),
      })
      expect(map.has(`key1`)).toBe(false)
    })

    it(`should track Map set operations with object keys`, () => {
      const objKey = { id: 1 }
      const map = new Map([[objKey, `value1`]])
      const { proxy, getChanges } = createChangeProxy({ map })

      const newObjKey = { id: 2 }
      proxy.map.set(newObjKey, `value2`)

      const changes = getChanges()
      expect(changes.map.get(newObjKey)).toBe(`value2`)
      expect(map.get(newObjKey)).toBe(`value2`)
    })

    it(`should track Set add and delete operations`, () => {
      const set = new Set([1, 2, 3])
      const { proxy, getChanges } = createChangeProxy({ set })

      proxy.set.add(4)
      proxy.set.delete(2)

      expect(getChanges()).toEqual({
        set: new Set([1, 3, 4]),
      })
      expect(set.has(4)).toBe(true)
      expect(set.has(2)).toBe(false)
    })

    it(`should handle iteration over collections during modification`, () => {
      const map = new Map([
        [`key1`, `value1`],
        [`key2`, `value2`],
      ])
      const { proxy, getChanges } = createChangeProxy({ map })

      // Modify during iteration
      for (const [key] of proxy.map) {
        proxy.map.set(key, `modified`)
      }

      expect(getChanges()).toEqual({
        map: new Map([
          [`key1`, `modified`],
          [`key2`, `modified`],
        ]),
      })
      expect(map.get(`key1`)).toBe(`modified`)
      expect(map.get(`key2`)).toBe(`modified`)
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

    it(`should track when items are added to arrays`, () => {
      const obj = {
        items: [`apple`, `banana`],
      }
      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.items = [...obj.items, `cherry`]

      expect(getChanges()).toEqual({
        items: [`apple`, `banana`, `cherry`],
      })
      expect(obj.items).toEqual([`apple`, `banana`, `cherry`])
    })

    it(`should track array pop() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Create a new array without the last element
      proxies[0].items = proxies[0].items.slice(0, -1)

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `banana`],
        },
      ])
      expect(objs[0].items).toEqual([`apple`, `banana`])
    })

    it(`should track array shift() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Create a new array without the first element
      proxies[0].items = proxies[0].items.slice(1)

      expect(getChanges()).toEqual([
        {
          items: [`banana`, `cherry`],
        },
      ])
      expect(objs[0].items).toEqual([`banana`, `cherry`])
    })

    it(`should track array unshift() operations`, () => {
      const objs = [{ items: [`banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Create a new array with an element added at the beginning
      proxies[0].items = [`apple`, ...proxies[0].items]

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `banana`, `cherry`],
        },
      ])
      expect(objs[0].items).toEqual([`apple`, `banana`, `cherry`])
    })

    it(`should track array splice() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`, `date`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Create a new array with elements replaced in the middle
      const newItems = [...proxies[0].items]
      newItems.splice(1, 2, `blueberry`, `cranberry`)
      proxies[0].items = newItems

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `blueberry`, `cranberry`, `date`],
        },
      ])
      expect(objs[0].items).toEqual([`apple`, `blueberry`, `cranberry`, `date`])
    })

    it(`should track array sort() operations`, () => {
      const objs = [{ items: [`cherry`, `apple`, `banana`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Create a new sorted array
      proxies[0].items = [...proxies[0].items].sort()

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `banana`, `cherry`],
        },
      ])
      expect(objs[0].items).toEqual([`apple`, `banana`, `cherry`])
    })

    it(`should track changes in multi-dimensional arrays`, () => {
      const objs = [
        {
          matrix: [
            [1, 2],
            [3, 4],
          ],
        },
      ]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Update a nested array
      const newMatrix = [...proxies[0].matrix]
      newMatrix[0] = [5, 6]
      proxies[0].matrix = newMatrix

      expect(getChanges()).toEqual([
        {
          matrix: [
            [5, 6],
            [3, 4],
          ],
        },
      ])
      expect(objs[0].matrix).toEqual([
        [5, 6],
        [3, 4],
      ])
    })

    it(`should handle objects containing arrays as properties`, () => {
      const objs = [
        {
          user: {
            name: `John`,
            hobbies: [`reading`, `swimming`],
          },
        },
      ]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Update the array within the nested object
      const updatedUser = { ...proxies[0].user }
      updatedUser.hobbies = [...updatedUser.hobbies, `cycling`]
      proxies[0].user = updatedUser

      expect(getChanges()).toEqual([
        {
          user: {
            name: `John`,
            hobbies: [`reading`, `swimming`, `cycling`],
          },
        },
      ])
      expect(objs[0].user.hobbies).toEqual([`reading`, `swimming`, `cycling`])
    })

    it(`should handle Set and Map objects`, () => {
      const set = new Set([1, 2, 3])
      const map = new Map([
        [`key1`, `value1`],
        [`key2`, `value2`],
      ])

      const objs = [
        {
          collections: {
            set,
            map,
          },
        },
      ]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Create new collections with modifications
      const newSet = new Set([...set, 4])
      const newMap = new Map([...map, [`key3`, `value3`]])

      proxies[0].collections = {
        set: newSet,
        map: newMap,
      }

      expect(getChanges()).toEqual([
        {
          collections: {
            set: newSet,
            map: newMap,
          },
        },
      ])
      expect(objs[0].collections.set).toEqual(newSet)
      expect(objs[0].collections.map).toEqual(newMap)
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

  describe(`Proxy revocation and cleanup`, () => {
    it(`should handle accessing proxies after tracking function completes`, () => {
      const obj = { name: `John`, age: 30 }
      const changes = withChangeTracking(obj, (proxy) => {
        proxy.name = `Jane`
      })

      expect(changes).toEqual({ name: `Jane` })
      expect(obj.name).toBe(`Jane`)
    })

    it(`should handle nested proxy access after tracking`, () => {
      const obj = { user: { name: `John`, age: 30 } }
      const changes = withChangeTracking(obj, (proxy) => {
        proxy.user.name = `Jane`
      })

      expect(changes).toEqual({
        user: { name: `Jane`, age: 30 },
      })
      expect(obj.user.name).toBe(`Jane`)
    })
  })

  describe(`Advanced Proxy Change Detection`, () => {
    describe(`Structural Sharing and Equality Detection`, () => {
      it(`should return the original object when changes are reverted`, () => {
        const obj = { name: `John`, age: 30 }
        const { proxy, getChanges } = createChangeProxy(obj)

        // Make changes
        proxy.name = `Jane`
        // Revert changes
        proxy.name = `John`

        // No changes should be tracked
        expect(getChanges()).toEqual({})
      })

      it(`should handle Maps that have items added and then removed`, () => {
        const map = new Map([[`key1`, `value1`]])
        const obj = { myMap: map }
        const { proxy, getChanges } = createChangeProxy(obj)

        // Create a new map with an added item
        const modifiedMap = new Map(map)
        modifiedMap.set(`key2`, `value2`)
        proxy.myMap = modifiedMap

        // Create a new map that's identical to the original
        const revertedMap = new Map([[`key1`, `value1`]])
        proxy.myMap = revertedMap

        // No changes should be tracked since final state matches initial state
        expect(getChanges()).toEqual({})
      })

      it(`should handle restoring original references to nested objects`, () => {
        const nestedObj = { value: 42 }
        const obj = { nested: nestedObj, other: `data` }
        const { proxy, getChanges } = createChangeProxy(obj)

        // Replace with different object
        proxy.nested = { value: 100 }

        // Restore original reference
        proxy.nested = nestedObj

        // No changes should be tracked for nested
        expect(getChanges()).toEqual({})
      })
    })
  })

  describe(`Array Edge Cases`, () => {
    it(`should track array length changes through truncation`, () => {
      const arr = [1, 2, 3, 4, 5]
      const { proxy, getChanges } = createChangeProxy({ arr })

      proxy.arr.length = 3

      expect(getChanges()).toEqual({
        arr: [1, 2, 3],
      })
      expect(arr.length).toBe(3)
      expect(arr).toEqual([1, 2, 3])
    })

    it(`should track array length changes through extension`, () => {
      const arr = [1, 2, 3]
      const { proxy, getChanges } = createChangeProxy({ arr })

      proxy.arr.length = 5

      expect(getChanges()).toEqual({
        arr: [1, 2, 3, undefined, undefined],
      })
      expect(arr.length).toBe(5)
      expect(arr[3]).toBe(undefined)
      expect(arr[4]).toBe(undefined)
    })

    it(`should handle sparse arrays`, () => {
      const arr = [1, 2, 3, 4, 5]
      const { proxy, getChanges } = createChangeProxy({ arr })

      delete proxy.arr[2]

      expect(getChanges()).toEqual({
        // eslint-disable-next-line
        arr: [1, 2, , 4, 5],
      })
      expect(2 in arr).toBe(false)
      expect(arr.length).toBe(5)
    })

    it(`should handle out-of-bounds array assignments`, () => {
      const arr = [1, 2, 3]
      const { proxy, getChanges } = createChangeProxy({ arr })

      proxy.arr[5] = 6

      expect(getChanges()).toEqual({
        arr: [1, 2, 3, undefined, undefined, 6],
      })
      expect(arr.length).toBe(6)
      expect(arr[5]).toBe(6)
    })
  })

  describe(`Object.defineProperty and Meta Operations`, () => {
    it(`should track changes made through Object.defineProperty`, () => {
      const obj = { name: `John` }
      const { proxy, getChanges } = createChangeProxy(obj)

      Object.defineProperty(proxy, `age`, {
        value: 30,
        writable: true,
        enumerable: true,
        configurable: true,
      })

      expect(getChanges()).toEqual({
        age: 30,
      })
      expect(obj.age).toBe(30)
    })

    it(`should handle Object.setPrototypeOf`, () => {
      const obj = { name: `John` }
      const proto = {
        greet() {
          return `Hello, ${this.name}!`
        },
      }
      const { proxy, getChanges } = createChangeProxy(obj)

      Object.setPrototypeOf(proxy, proto)

      expect(proxy.greet()).toBe(`Hello, John!`)
      // The prototype change itself isn't tracked, but any changes to
      // properties from the new prototype chain will be
      expect(getChanges()).toEqual({})
    })

    it(`should prevent prototype pollution`, () => {
      const obj = { constructor: { prototype: {} } }
      const { proxy } = createChangeProxy(obj)

      // Attempt to modify Object.prototype through the proxy
      proxy.__proto__ = { malicious: true }
      proxy.constructor.prototype.malicious = true

      // Verify that Object.prototype wasn't polluted
      expect({}.malicious).toBeUndefined()
      expect(Object.prototype.malicious).toBeUndefined()

      // The changes should only affect the proxy's own prototype chain
      expect(proxy.__proto__.malicious).toBe(true)
      expect(proxy.constructor.prototype.malicious).toBe(true)
    })
  })
})
