import { describe, expect, it } from "vitest"
import {
  createArrayChangeProxy,
  createChangeProxy,
  withArrayChangeTracking,
  withChangeTracking,
} from "../src/proxy"

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

      // Check that the original object is not modified
      expect(obj).toEqual({
        name: `John`,
        age: 30,
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
      expect(obj.name).toBe(`John`)
      expect(obj.active).toBe(false)
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
      const obj: { name: string; age: number; role?: string } = {
        name: `John`,
        age: 30,
        role: `admin`,
      }
      const { proxy, getChanges } = createChangeProxy(obj)

      delete proxy.role

      expect(getChanges()).toEqual({
        role: undefined,
      })
      expect(obj).toEqual({
        name: `John`,
        age: 30,
        role: `admin`,
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
      // @ts-expect-error ignore for test
      obj.self = obj // Create circular reference

      const { proxy, getChanges } = createChangeProxy(
        obj as Record<string | symbol, any>
      )

      proxy.name = `Jane`

      expect(getChanges()).toEqual({
        name: `Jane`,
      })
      // @ts-expect-error ignore for test
      expect(obj.name).toBe(`John`)
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
      expect(obj.createdAt).toEqual(new Date(`2023-01-01`))
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
      expect(obj.person).toEqual(new Person(`John`, 30))
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
      expect(obj.pattern).toEqual(/test/i)
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
      expect(obj.id).toBe(BigInt(123456789))
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
      expect(obj._name).toBe(`John`)
      expect(obj.name).toBe(`John`)
    })

    // TODO worth it to make this work?
    // it(`should handle symbolic properties`, () => {
    //   const symbolKey = Symbol(`test`)
    //   const obj = {
    //     [symbolKey]: `value`,
    //   }
    //
    //   const { proxy, getChanges } = createChangeProxy(obj)
    //   proxy[symbolKey] = `new value`
    //
    //   const changes = getChanges()
    //   expect(changes[symbolKey]).toBe(`new value`)
    //   expect(obj[symbolKey]).toBe(`new value`)
    // })

    it(`should handle non-enumerable properties`, () => {
      const obj = {}
      Object.defineProperty(obj, `hidden`, {
        value: `original`,
        enumerable: false,
        writable: true,
        configurable: true,
      })

      const { proxy, getChanges } = createChangeProxy(obj)
      // @ts-expect-error ignore for test
      proxy.hidden = `modified`

      expect(getChanges()).toEqual({
        hidden: `modified`,
      })
      // @ts-expect-error ignore for test
      expect(obj.hidden).toBe(`original`)
    })

    // it(`should prevent prototype pollution`, () => {
    //   const obj = { constructor: { prototype: {} } }
    //   const { proxy } = createChangeProxy(obj)
    //
    //   // Attempt to modify Object.prototype through the proxy
    //   // @ts-expect-error ignore for test
    //   proxy.__proto__ = { malicious: true }
    //   // @ts-expect-error ignore for test
    //   proxy.constructor.prototype.malicious = true
    //
    //   // Verify that Object.prototype wasn't polluted
    //   // @ts-expect-error ignore for test
    //   expect({}.malicious).toBeUndefined()
    //   // @ts-expect-error ignore for test
    //   expect(Object.prototype.malicious).toBeUndefined()
    //
    //   // The changes should only affect the proxy's own prototype chain
    //   // @ts-expect-error ignore for test
    //   expect(proxy.__proto__.malicious).toBe(true)
    //   // @ts-expect-error ignore for test
    //   expect(proxy.constructor.prototype.malicious).toBe(true)
    // })
  })

  // describe(`Object.freeze and Object.seal handling`, () => {
  //   it(`should handle Object.freeze correctly`, () => {
  //     const obj = { name: `John`, age: 30 }
  //     const { proxy, getChanges } = createChangeProxy(obj)
  //
  //     // Freeze the proxy
  //     Object.freeze(proxy)
  //
  //     // Attempt to modify the frozen proxy (should throw in strict mode)
  //     let errorThrown = false
  //     let errorMessage = ``
  //     try {
  //       proxy.name = `Jane`
  //     } catch (e) {
  //       // Expected error
  //       errorThrown = true
  //       errorMessage = e instanceof Error ? e.message : String(e)
  //     }
  //
  //     // In strict mode, an error should be thrown
  //     if (errorThrown) {
  //       // Verify the error message contains expected text about the property being read-only
  //       expect(errorMessage).toContain(`read only property`)
  //     }
  //
  //     // Either way, no changes should be tracked
  //     expect(getChanges()).toEqual({})
  //
  //     // Check that the original object is unchanged
  //     expect(obj).toEqual({
  //       name: `John`,
  //       age: 30,
  //     })
  //   })

  // it(`should handle Object.seal correctly`, () => {
  //   const obj = { name: `John`, age: 30 }
  //   const { proxy, getChanges } = createChangeProxy(obj)
  //
  //   // Seal the proxy
  //   Object.seal(proxy)
  //
  //   // Modify existing property (should work)
  //   proxy.name = `Jane`
  //
  //   // Attempt to add a new property (should not work)
  //   let errorThrown = false
  //   let errorMessage = ``
  //   try {
  //     // @ts-expect-error ignore for test
  //     proxy.role = `admin`
  //   } catch (e) {
  //     // Expected error
  //     errorThrown = true
  //     errorMessage = e instanceof Error ? e.message : String(e)
  //   }
  //
  //   // In strict mode, an error should be thrown
  //   if (errorThrown) {
  //     // Verify the error message contains expected text about the object not being extensible
  //     expect(errorMessage).toContain(`object is not extensible`)
  //   }
  //
  //   // Check that only the name change was tracked
  //   expect(getChanges()).toEqual({
  //     name: `Jane`,
  //   })
  //
  //   // Check that the original object has the name change but no new property
  //   expect(obj).toEqual({
  //     name: `Jane`,
  //     age: 30,
  //   })
  //
  //   expect(obj.hasOwnProperty(`role`)).toBe(false)
  // })

  // it(`should handle Object.preventExtensions correctly`, () => {
  //   const obj = { name: `John`, age: 30 }
  //   const { proxy, getChanges } = createChangeProxy(obj)
  //
  //   // Prevent extensions on the proxy
  //   Object.preventExtensions(proxy)
  //
  //   // Modify existing property (should work)
  //   proxy.name = `Jane`
  //
  //   // Attempt to add a new property (should not work)
  //   let errorThrown = false
  //   let errorMessage = ``
  //   try {
  //     // @ts-expect-error ignore for test
  //     proxy.role = `admin`
  //   } catch (e) {
  //     // Expected error
  //     errorThrown = true
  //     errorMessage = e instanceof Error ? e.message : String(e)
  //   }
  //
  //   // In strict mode, an error should be thrown
  //   if (errorThrown) {
  //     // Verify the error message contains expected text about the object not being extensible
  //     expect(errorMessage).toContain(`object is not extensible`)
  //   }
  //
  //   // Check that only the name change was tracked
  //   expect(getChanges()).toEqual({
  //     name: `Jane`,
  //   })
  //
  //   // Check that the original object has the name change but no new property
  //   expect(obj).toEqual({
  //     name: `Jane`,
  //     age: 30,
  //   })
  //
  //   expect(obj.hasOwnProperty(`role`)).toBe(false)
  // })
  // })

  describe(`Enhanced Iterator Method Tracking`, () => {
    it(`should track changes when Map values are modified via iterator`, () => {
      const map = new Map([
        [`key1`, { count: 1 }],
        [`key2`, { count: 2 }],
      ])

      // Wrap the map in an object to track changes to the nested objects
      const obj = { myMap: map }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Get an entry via iterator and modify it
      for (const [key, value] of proxy.myMap.entries()) {
        if (key === `key1`) {
          value.count = 10
        }
      }

      // Verify the original map was not modified
      expect(map.get(`key1`)?.count).toBe(1)

      // Check that the change was tracked correctly
      expect(getChanges()).toEqual({
        myMap: new Map([
          [`key1`, { count: 10 }],
          [`key2`, { count: 2 }],
        ]),
      })
    })

    it(`should track changes when Set object values are modified via iterator`, () => {
      const set = new Set([
        { id: 1, value: `one` },
        { id: 2, value: `two` },
      ])

      // Wrap the set in an object to track changes to the nested objects
      const obj = { mySet: set }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Find and modify an object in the set via iterator
      for (const item of proxy.mySet.values()) {
        if (item.id === 1) {
          item.value = `modified`
        }
      }

      // Verify the original set was not modified
      let found = false
      for (const item of set) {
        if (item.id === 1) {
          expect(item.value).toBe(`one`)
          found = true
        }
      }
      expect(found).toBe(true)

      // Check that the change was tracked correctly
      const changes = getChanges()
      expect(changes.mySet).toBeInstanceOf(Set)
      const changedItems = Array.from(changes.mySet as Set<any>)
      expect(changedItems).toEqual(
        expect.arrayContaining([
          { id: 1, value: `modified` },
          { id: 2, value: `two` },
        ])
      )
    })

    it(`should track changes when Map values are modified via forEach`, () => {
      const map = new Map([
        [`key1`, { count: 1 }],
        [`key2`, { count: 2 }],
      ])

      // Wrap the map in an object to track changes to the nested objects
      const obj = { myMap: map }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Modify values using forEach
      proxy.myMap.forEach((value, key) => {
        if (key === `key2`) {
          value.count = 20
        }
      })

      // Verify the original map was not modified
      expect(map.get(`key2`)?.count).toBe(2)

      // Check that the change was tracked correctly
      expect(getChanges()).toEqual({
        myMap: new Map([
          [`key1`, { count: 1 }],
          [`key2`, { count: 20 }],
        ]),
      })
    })

    it(`should track changes when Set values are modified via forEach`, () => {
      const set = new Set([
        { id: 1, value: `one` },
        { id: 2, value: `two` },
      ])

      // Wrap the set in an object to track changes to the nested objects
      const obj = { mySet: set }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Modify values using forEach
      proxy.mySet.forEach((item) => {
        if (item.id === 2) {
          item.value = `modified two`
        }
      })

      // Verify the original set was not modified
      let found = false
      for (const item of set) {
        if (item.id === 2) {
          expect(item.value).toBe(`two`)
          found = true
        }
      }
      expect(found).toBe(true)

      // Check that the change was tracked correctly
      const changes = getChanges()
      expect(changes.mySet).toBeInstanceOf(Set)
      const changedItems = Array.from(changes.mySet as Set<any>)
      expect(changedItems).toEqual(
        expect.arrayContaining([
          { id: 1, value: `one` },
          { id: 2, value: `modified two` },
        ])
      )
    })

    it(`should handle multiple modifications to the same object via different iterators`, () => {
      const map = new Map([
        [`key1`, { count: 1, name: `test` }],
        [`key2`, { count: 2, name: `test2` }],
      ])
      const obj = { myMap: map }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Modify via entries()
      for (const [key, value] of proxy.myMap.entries()) {
        if (key === `key1`) {
          value.count = 10
        }
      }

      // Modify via values()
      for (const value of proxy.myMap.values()) {
        if (value.name === `test`) {
          value.name = `modified`
        }
      }

      // Verify the original map was not modified.
      expect(map.get(`key1`)).toEqual({ count: 1, name: `test` })

      expect(getChanges()).toEqual({
        myMap: new Map([
          [`key1`, { count: 10, name: `modified` }],
          [`key2`, { count: 2, name: `test2` }],
        ]),
      })
    })

    it(`should handle nested object modifications via iterators`, () => {
      const map = new Map([
        [`user1`, { profile: { name: `Alice`, settings: { theme: `dark` } } }],
        [`user2`, { profile: { name: `Bob`, settings: { theme: `light` } } }],
      ])
      const obj = { myMap: map }
      const { proxy, getChanges } = createChangeProxy(obj)

      for (const [key, user] of proxy.myMap.entries()) {
        if (key === `user1`) {
          user.profile.settings.theme = `auto`
        }
      }

      expect(getChanges()).toEqual({
        myMap: new Map([
          [
            `user1`,
            { profile: { name: `Alice`, settings: { theme: `auto` } } },
          ],
          [`user2`, { profile: { name: `Bob`, settings: { theme: `light` } } }],
        ]),
      })
      expect(map.get(`user1`)?.profile.settings.theme).toBe(`dark`)
    })

    it(`should handle Set modifications with duplicate objects`, () => {
      const obj1 = { id: 1, value: `one` }
      const obj2 = { id: 2, value: `two` }
      const set = new Set([obj1, obj2, obj1]) // obj1 appears twice but Set deduplicates
      const obj = { mySet: set }
      const { proxy, getChanges } = createChangeProxy(obj)

      for (const item of proxy.mySet) {
        if (item.id === 1) {
          item.value = `modified`
        }
      }

      const changes = getChanges()
      expect(changes.mySet).toBeInstanceOf(Set)
      expect(changes.mySet.size).toBe(2)
      const changedItems = Array.from(changes.mySet as Set<any>)
      expect(changedItems).toEqual(
        expect.arrayContaining([
          { id: 1, value: `modified` },
          { id: 2, value: `two` },
        ])
      )
      expect(obj1.value).toBe(`one`) // Original unchanged
    })

    it(`should handle reverting changes made via iterators`, () => {
      const map = new Map([
        [`key1`, { count: 5 }],
        [`key2`, { count: 10 }],
      ])
      const obj = { myMap: map }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Modify via entries()
      for (const [key, value] of proxy.myMap.entries()) {
        if (key === `key1`) {
          value.count = 20 // Change
          value.count = 5 // Revert to original
        }
      }

      // Should have no changes since we reverted
      expect(getChanges()).toEqual({})
    })

    it(`should handle mixed Map and Set nested operations`, () => {
      const data = {
        userGroups: new Map([
          [
            `admins`,
            {
              users: new Set([
                { id: 1, name: `Alice` },
                { id: 2, name: `Bob` },
              ]),
            },
          ],
          [
            `users`,
            {
              users: new Set([{ id: 3, name: `Charlie` }]),
            },
          ],
        ]),
      }
      const { proxy, getChanges } = createChangeProxy(data)

      // Navigate through Map.values() then Set iteration
      for (const group of proxy.userGroups.values()) {
        for (const user of group.users) {
          if (user.name === `Alice`) {
            user.name = `Alice Admin`
          }
        }
      }

      const changes = getChanges()
      expect(changes.userGroups).toBeInstanceOf(Map)
      const adminGroup = changes.userGroups.get(`admins`)
      expect(adminGroup?.users).toBeInstanceOf(Set)
      const users = Array.from(adminGroup?.users as Set<any>)
      expect(users).toEqual(
        expect.arrayContaining([
          { id: 1, name: `Alice Admin` },
          { id: 2, name: `Bob` },
        ])
      )
    })
  })

  describe(`Map and Set Operations`, () => {
    it(`should track Map clear operations`, () => {
      const map = new Map([
        [`key1`, `value1`],
        [`key2`, `value2`],
      ])
      const obj = { myMap: map }
      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.myMap.clear()

      expect(getChanges()).toEqual({
        myMap: new Map(),
      })
      expect(map.size).toBe(2)
    })

    it(`should track Map delete operations`, () => {
      const map = new Map([
        [`key1`, `value1`],
        [`key2`, `value2`],
      ])
      const obj = { myMap: map }
      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.myMap.delete(`key1`)

      expect(getChanges()).toEqual({
        myMap: new Map([[`key2`, `value2`]]),
      })
      expect(map.has(`key1`)).toBe(true)
    })

    it(`should track Map set operations with object keys`, () => {
      const objKey = { id: 1 }
      const map = new Map([[objKey, `value1`]])
      const { proxy, getChanges } = createChangeProxy({ map })

      const newObjKey = { id: 2 }
      proxy.map.set(newObjKey, `value2`)

      const changes = getChanges()
      expect(changes.map.get(newObjKey)).toBe(`value2`)
      expect(map.get(newObjKey)).toBeUndefined()
    })

    it(`should track Set add and delete operations`, () => {
      const set = new Set([1, 2, 3])
      const { proxy, getChanges } = createChangeProxy({ set })

      proxy.set.add(4)
      proxy.set.delete(2)

      expect(getChanges()).toEqual({
        set: new Set([1, 3, 4]),
      })
      expect(set.has(4)).toBe(false)
      expect(set.has(2)).toBe(true)
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
      expect(map.get(`key1`)).toBe(`value1`)
      expect(map.get(`key2`)).toBe(`value2`)
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
      // @ts-expect-error ok possibly undefined
      proxies[0].name = `Johnny`
      // @ts-expect-error ok possibly undefined
      proxies[1].name = `Janet`

      // Check that the changes are tracked
      expect(getChanges()).toEqual([{ name: `Johnny` }, { name: `Janet` }])

      // Check that the original objects are not modified
      expect(objs).toEqual([
        { id: 1, name: `John` },
        { id: 2, name: `Jane` },
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
      expect(obj.items).toEqual([`apple`, `banana`])
    })

    it(`should track array pop() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call pop() method directly
      // @ts-expect-error ok possibly undefined
      proxies[0].items.pop()

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `banana`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([`apple`, `banana`, `cherry`])
    })

    it(`should track array shift() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call shift() method directly
      // @ts-expect-error ok possibly undefined
      proxies[0].items.shift()

      expect(getChanges()).toEqual([
        {
          items: [`banana`, `cherry`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([`apple`, `banana`, `cherry`])
    })

    it(`should track array unshift() operations`, () => {
      const objs = [{ items: [`banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call unshift() method directly
      // @ts-expect-error ok possibly undefined
      proxies[0].items.unshift(`apple`)

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `banana`, `cherry`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([`banana`, `cherry`])
    })

    it(`should track array push() operations`, () => {
      const obj = { items: [`apple`, `banana`] }
      const { proxy, getChanges } = createChangeProxy(obj)

      proxy.items.push(`cherry`)

      expect(getChanges()).toEqual({
        items: [`apple`, `banana`, `cherry`],
      })
      expect(obj.items).toEqual([`apple`, `banana`])
    })

    it(`should track array splice() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`, `date`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call splice() method directly
      // @ts-expect-error ok possibly undefined
      proxies[0].items.splice(1, 2, `blueberry`, `cranberry`)

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `blueberry`, `cranberry`, `date`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([`apple`, `banana`, `cherry`, `date`])
    })

    it(`should track array sort() operations`, () => {
      const objs = [{ items: [`cherry`, `apple`, `banana`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call sort() method directly
      // @ts-expect-error ok possibly undefined
      proxies[0].items.sort()

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `banana`, `cherry`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([`cherry`, `apple`, `banana`])
    })

    it(`should track array reverse() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call reverse() method directly
      // @ts-expect-error ok possibly undefined
      proxies[0].items.reverse()

      expect(getChanges()).toEqual([
        {
          items: [`cherry`, `banana`, `apple`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([`apple`, `banana`, `cherry`])
    })

    it(`should track array fill() operations`, () => {
      const objs = [{ items: [`apple`, `banana`, `cherry`] }]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call fill() method directly
      // @ts-expect-error ok possibly undefined
      proxies[0].items.fill(`orange`, 1, 3)

      expect(getChanges()).toEqual([
        {
          items: [`apple`, `orange`, `orange`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([`apple`, `banana`, `cherry`])
    })

    it(`should track array copyWithin() operations`, () => {
      const objs = [
        { items: [`apple`, `banana`, `cherry`, `date`, `elderberry`] },
      ]
      const { proxies, getChanges } = createArrayChangeProxy(objs)

      // Call copyWithin() method directly - copy elements from index 3-4 to index 0-1
      // @ts-expect-error ok possibly undefined
      proxies[0].items.copyWithin(0, 3, 5)

      expect(getChanges()).toEqual([
        {
          items: [`date`, `elderberry`, `cherry`, `date`, `elderberry`],
        },
      ])
      // @ts-expect-error ok possibly undefined
      expect(objs[0].items).toEqual([
        `apple`,
        `banana`,
        `cherry`,
        `date`,
        `elderberry`,
      ])
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
      // @ts-expect-error ok possibly undefined
      const newMatrix = [...proxies[0].matrix]
      newMatrix[0] = [5, 6]
      // @ts-expect-error ok possibly undefined
      proxies[0].matrix = newMatrix

      expect(getChanges()).toEqual([
        {
          matrix: [
            [5, 6],
            [3, 4],
          ],
        },
      ])
      if (objs[0]) {
        expect(objs[0].matrix).toEqual([
          [1, 2],
          [3, 4],
        ])
      }
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
      // @ts-expect-error ok for test.
      const updatedUser = { ...proxies[0].user }
      updatedUser.hobbies = [...updatedUser.hobbies, `cycling`]
      // @ts-expect-error ok for test.
      proxies[0].user = updatedUser

      expect(getChanges()).toEqual([
        {
          user: {
            name: `John`,
            hobbies: [`reading`, `swimming`, `cycling`],
          },
        },
      ])
      if (objs[0]) {
        expect(objs[0].user.hobbies).toEqual([`reading`, `swimming`])
      }
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

      if (proxies[0]) {
        proxies[0].collections = {
          set: newSet,
          map: newMap,
        }
      }

      expect(getChanges()).toEqual([
        {
          collections: {
            set: newSet,
            map: newMap,
          },
        },
      ])
      if (objs[0]) {
        expect(objs[0].collections.set).toEqual(set)
        expect(objs[0].collections.map).toEqual(map)
      }
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

      // Check that the original object is not modified
      expect(obj).toEqual({
        name: `John`,
        age: 30,
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
        if (proxies[0] && proxies[1]) {
          proxies[0].name = `Johnny`
          proxies[1].name = `Janet`
        }
      })

      // Check that the changes are tracked
      expect(changes).toEqual([{ name: `Johnny` }, { name: `Janet` }])

      // Check that the original objects are modified
      expect(objs).toEqual([
        { id: 1, name: `John` },
        { id: 2, name: `Jane` },
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
      expect(obj.name).toBe(`John`)
    })

    it(`should handle nested proxy access after tracking`, () => {
      const obj = { user: { name: `John`, age: 30 } }
      const changes = withChangeTracking(obj, (proxy) => {
        proxy.user.name = `Jane`
      })

      expect(changes).toEqual({
        user: { name: `Jane`, age: 30 },
      })
      expect(obj.user.name).toBe(`John`)
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

  describe(`Deep Nested Reverts`, () => {
    it(`should correctly detect when a deeply nested property is reverted to original value`, () => {
      const obj = { nested: { count: 10 } }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Make a change to a deep nested property
      proxy.nested.count = 5

      expect(proxy.nested.count).toEqual(5)
      // Verify changes are tracked
      expect(getChanges()).toEqual({
        nested: { count: 5 },
      })

      // Revert back to original value
      proxy.nested.count = 10

      // Verify no changes are reported
      expect(getChanges()).toEqual({})

      // Original object should be unchanged
      expect(obj).toEqual({ nested: { count: 10 } })
    })

    it(`should correctly handle complex nested object reverts`, () => {
      const obj = {
        user: {
          profile: {
            name: `John`,
            settings: {
              theme: `dark`,
              notifications: true,
            },
          },
          stats: {
            visits: 10,
          },
        },
      }

      const { proxy, getChanges } = createChangeProxy(obj)

      // Make changes at different levels
      proxy.user.profile.name = `Jane`
      proxy.user.profile.settings.theme = `light`
      proxy.user.stats.visits = 15

      // Verify all changes are tracked
      expect(getChanges()).toEqual({
        user: {
          profile: {
            name: `Jane`,
            settings: {
              theme: `light`,
              notifications: true,
            },
          },
          stats: {
            visits: 15,
          },
        },
      })

      // Revert changes one by one
      proxy.user.profile.name = `John`

      // Should still show other changes
      expect(Object.keys(getChanges()).length).toBeGreaterThan(0)

      proxy.user.profile.settings.theme = `dark`

      // Should still show other changes
      expect(Object.keys(getChanges()).length).toBeGreaterThan(0)

      // Revert final change
      proxy.user.stats.visits = 10

      // No changes should be reported
      expect(getChanges()).toEqual({})
    })
  })

  describe(`Array Edge Cases`, () => {
    // it(`should track array length changes through truncation`, () => {
    //   const arr = [1, 2, 3, 4, 5]
    //   const { proxy, getChanges } = createChangeProxy({ arr })
    //
    //   proxy.arr.length = 3
    //
    //   expect(getChanges()).toEqual({
    //     arr: [1, 2, 3],
    //   })
    //   expect(arr.length).toBe(3)
    //   expect(arr).toEqual([1, 2, 3, 4, 5])
    // })

    it(`should handle sparse arrays`, () => {
      const arr = [1, 2, 3, 4, 5]
      const { proxy, getChanges } = createChangeProxy({ arr })

      delete proxy.arr[2]

      expect(getChanges()).toEqual({
        // eslint-disable-next-line
        arr: [1, 2, , 4, 5],
      })
      expect(2 in arr).toBe(true)
      expect(arr.length).toBe(5)
    })

    it(`should handle out-of-bounds array assignments`, () => {
      const arr = [1, 2, 3]
      const { proxy, getChanges } = createChangeProxy({ arr })

      proxy.arr[5] = 6

      expect(getChanges()).toEqual({
        arr: [1, 2, 3, undefined, undefined, 6],
      })
      expect(arr.length).toBe(3)
    })
  })

  describe(`Object.defineProperty and Meta Operations`, () => {
    it(`should track changes made through Object.defineProperty`, () => {
      const obj: { name: string; age?: number } = { name: `John` }
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
      expect(obj.age).toBeUndefined()
    })

    // it.only(`should prevent prototype pollution`, () => {
    //   const obj = { constructor: { prototype: {} } }
    //   const { proxy } = createChangeProxy(obj)
    //
    //   // Attempt to modify Object.prototype through the proxy
    //   // @ts-expect-error ignore for test
    //   proxy.__proto__ = { malicious: true }
    //   // @ts-expect-error ignore for test
    //   proxy.constructor.prototype.malicious = true
    //
    //   // Verify that Object.prototype wasn't polluted
    //   // @ts-expect-error ignore for test
    //   expect({}.malicious).toBeUndefined()
    //   // @ts-expect-error ignore for test
    //   expect(Object.prototype.malicious).toBeUndefined()
    //
    //   // The changes should only affect the proxy's own prototype chain
    //   // @ts-expect-error ignore for test
    //   expect(proxy.__proto__.malicious).toBe(true)
    //   // @ts-expect-error ignore for test
    //   expect(proxy.constructor.prototype.malicious).toBe(true)
    // })
  })

  describe(`Optimization Cases`, () => {
    it(`should not track changes when setting to the same value`, () => {
      const obj = { name: `John`, age: 30, scores: [1, 2, 3] }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Set to same primitive value
      proxy.name = `John`
      proxy.age = 30

      // Set to same array value
      proxy.scores = [1, 2, 3]

      // Should have no changes
      expect(getChanges()).toEqual({})
    })

    it(`should not track changes when modifying and reverting`, () => {
      const obj = { name: `John`, nested: { count: 5 } }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Modify and revert primitive
      proxy.name = `Jane`
      proxy.name = `John`

      // Modify and revert nested
      proxy.nested.count = 10
      proxy.nested.count = 5

      // The object shouldn't be mutated.
      expect(obj.name).toEqual(`John`)
      expect(obj.nested.count).toEqual(5)

      // Should have no changes
      expect(getChanges()).toEqual({})
    })

    it(`should efficiently handle repeated changes to the same property`, () => {
      const obj = { count: 0 }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Make many changes to the same property
      for (let i = 0; i < 10000; i++) {
        proxy.count = i
      }

      // Should only track the final change
      expect(getChanges()).toEqual({ count: 9999 })
    })
  })

  describe(`TypedArray Support`, () => {
    it(`should track changes to TypedArrays`, () => {
      const obj = {
        int8: new Int8Array([1, 2, 3]),
        uint8: new Uint8Array([4, 5, 6]),
        float32: new Float32Array([1.1, 2.2, 3.3]),
      }

      const { proxy, getChanges } = createChangeProxy(obj)

      // Modify values
      proxy.int8[0] = 10
      proxy.uint8[1] = 50
      proxy.float32[2] = 33.3

      const changes = getChanges()
      expect(changes.int8[0]).toBe(10)
      expect(changes.uint8[1]).toBe(50)
      expect(changes.float32[2]).toBeCloseTo(33.3)

      // Verify original object was modified
      expect(obj.int8[0]).toBe(1)
      expect(obj.uint8[1]).toBe(5)
      expect(obj.float32[2]).toBeCloseTo(3.3)
    })

    it(`should handle replacing entire TypedArrays`, () => {
      const obj = { data: new Uint8Array([1, 2, 3]) }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Replace entire array
      proxy.data = new Uint8Array([4, 5, 6])

      const changes = getChanges()
      expect(changes.data instanceof Uint8Array).toBe(true)
      expect(Array.from(changes.data)).toEqual([4, 5, 6])

      // Verify original was not modified
      expect(Array.from(obj.data)).toEqual([1, 2, 3])
    })

    it(`should detect when TypedArray values are the same`, () => {
      const obj = { data: new Uint8Array([1, 2, 3]) }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Set to same values
      proxy.data = new Uint8Array([1, 2, 3])

      // Should have no changes
      expect(getChanges()).toEqual({})
    })
  })

  describe(`Shallow Copy Handling`, () => {
    it(`should properly handle Array shallow copies`, () => {
      const obj = { items: [1, 2, 3] }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Replace the array instead of modifying it to ensure changes are tracked
      proxy.items = [1, 2, 3, 4]

      expect(getChanges()).toEqual({
        items: [1, 2, 3, 4],
      })
      expect(obj.items).toEqual([1, 2, 3])
    })

    it(`should properly handle RegExp shallow copies`, () => {
      const obj = { pattern: /test/i }
      const { proxy, getChanges } = createChangeProxy(obj)

      // Replace with a new RegExp to trigger shallow copy
      proxy.pattern = /modified/g

      expect(getChanges()).toEqual({
        pattern: /modified/g,
      })
      expect(obj.pattern).toEqual(/test/i)
      expect(obj.pattern.flags).toBe(`i`)
      expect(obj.pattern.source).toBe(`test`)
    })

    it(`should handle primitive values directly`, () => {
      // Test with a primitive value
      const primitiveObj = { value: 42 }
      const { proxy: primitiveProxy, getChanges: getPrimitiveChanges } =
        createChangeProxy(primitiveObj)

      primitiveProxy.value = 100

      expect(getPrimitiveChanges()).toEqual({
        value: 100,
      })
      expect(primitiveObj.value).toBe(42)
    })

    it(`should handle Date objects correctly`, () => {
      const originalDate = new Date(`2023-01-01T00:00:00Z`)
      const obj = { date: originalDate }
      const { proxy, getChanges } = createChangeProxy(obj)

      const newDate = new Date(`2024-01-01T00:00:00Z`)
      proxy.date = newDate

      expect(getChanges()).toEqual({
        date: newDate,
      })
      expect(obj.date).toEqual(originalDate)
    })
  })
})
