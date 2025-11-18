import { describe, expect, it } from "vitest"
import { Temporal } from "temporal-polyfill"
import { deepEquals } from "../src/utils"
import { isPromiseLike } from "../src/utils/type-guards"

describe(`deepEquals`, () => {
  describe(`primitives`, () => {
    it(`should handle identical primitives`, () => {
      expect(deepEquals(1, 1)).toBe(true)
      expect(deepEquals(`hello`, `hello`)).toBe(true)
      expect(deepEquals(true, true)).toBe(true)
      expect(deepEquals(null, null)).toBe(true)
      expect(deepEquals(undefined, undefined)).toBe(true)
    })

    it(`should handle different primitives`, () => {
      expect(deepEquals(1, 2)).toBe(false)
      expect(deepEquals(`hello`, `world`)).toBe(false)
      expect(deepEquals(true, false)).toBe(false)
      expect(deepEquals(null, undefined)).toBe(false)
    })

    it(`should handle different types`, () => {
      expect(deepEquals(1, `1`)).toBe(false)
      expect(deepEquals(0, false)).toBe(false)
      expect(deepEquals(null, 0)).toBe(false)
    })
  })

  describe(`arrays`, () => {
    it(`should handle identical arrays`, () => {
      expect(deepEquals([], [])).toBe(true)
      expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(deepEquals([1, [2, 3]], [1, [2, 3]])).toBe(true)
    })

    it(`should handle different arrays`, () => {
      expect(deepEquals([1, 2, 3], [1, 2, 4])).toBe(false)
      expect(deepEquals([1, 2, 3], [1, 2])).toBe(false)
      expect(deepEquals([1, [2, 3]], [1, [2, 4]])).toBe(false)
    })

    it(`should handle circular references in arrays`, () => {
      const a: Array<any> = [1, 2]
      a.push(a)
      const b: Array<any> = [1, 2]
      b.push(b)

      expect(deepEquals(a, b)).toBe(true)
    })
  })

  describe(`objects`, () => {
    it(`should handle identical objects`, () => {
      expect(deepEquals({}, {})).toBe(true)
      expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
      expect(deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true) // property order doesn't matter
      expect(deepEquals({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
    })

    it(`should handle different objects`, () => {
      expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false)
      expect(deepEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false)
      expect(deepEquals({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    })

    it(`should handle circular references in objects`, () => {
      const a: any = { x: 1 }
      a.self = a
      const b: any = { x: 1 }
      b.self = b

      expect(deepEquals(a, b)).toBe(true)
    })
  })

  describe(`Date objects`, () => {
    it(`should handle identical dates`, () => {
      const date1 = new Date(`2023-01-01T00:00:00Z`)
      const date2 = new Date(`2023-01-01T00:00:00Z`)
      expect(deepEquals(date1, date2)).toBe(true)
    })

    it(`should handle different dates`, () => {
      const date1 = new Date(`2023-01-01T00:00:00Z`)
      const date2 = new Date(`2023-01-02T00:00:00Z`)
      expect(deepEquals(date1, date2)).toBe(false)
    })

    it(`should handle date vs non-date`, () => {
      const date = new Date(`2023-01-01T00:00:00Z`)
      expect(deepEquals(date, `2023-01-01T00:00:00Z`)).toBe(false)
      expect(deepEquals(date, date.getTime())).toBe(false)
    })
  })

  describe(`RegExp objects`, () => {
    it(`should handle identical regexes`, () => {
      expect(deepEquals(/abc/g, /abc/g)).toBe(true)
      expect(deepEquals(/test/i, /test/i)).toBe(true)
    })

    it(`should handle different regexes`, () => {
      expect(deepEquals(/abc/g, /abc/i)).toBe(false)
      expect(deepEquals(/abc/g, /def/g)).toBe(false)
    })

    it(`should handle regex vs non-regex`, () => {
      expect(deepEquals(/abc/g, `abc`)).toBe(false)
    })
  })

  describe(`Map objects`, () => {
    it(`should handle identical maps`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      expect(deepEquals(map1, map2)).toBe(true)
    })

    it(`should handle maps with different order`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([
        [`b`, 2],
        [`a`, 1],
      ])
      expect(deepEquals(map1, map2)).toBe(true)
    })

    it(`should handle different maps`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([
        [`a`, 1],
        [`b`, 3],
      ])
      expect(deepEquals(map1, map2)).toBe(false)
    })

    it(`should handle maps with different sizes`, () => {
      const map1 = new Map([
        [`a`, 1],
        [`b`, 2],
      ])
      const map2 = new Map([[`a`, 1]])
      expect(deepEquals(map1, map2)).toBe(false)
    })

    it(`should handle nested objects in maps`, () => {
      const map1 = new Map([
        [`a`, { x: 1 }],
        [`b`, { y: 2 }],
      ])
      const map2 = new Map([
        [`a`, { x: 1 }],
        [`b`, { y: 2 }],
      ])
      expect(deepEquals(map1, map2)).toBe(true)
    })

    it(`should handle circular references in maps`, () => {
      const map1 = new Map()
      map1.set(`self`, map1)
      const map2 = new Map()
      map2.set(`self`, map2)

      expect(deepEquals(map1, map2)).toBe(true)
    })
  })

  describe(`Set objects`, () => {
    it(`should handle identical sets with primitives`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2, 3])
      expect(deepEquals(set1, set2)).toBe(true)
    })

    it(`should handle sets with different order`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([3, 1, 2])
      expect(deepEquals(set1, set2)).toBe(true)
    })

    it(`should handle different sets`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2, 4])
      expect(deepEquals(set1, set2)).toBe(false)
    })

    it(`should handle sets with different sizes`, () => {
      const set1 = new Set([1, 2, 3])
      const set2 = new Set([1, 2])
      expect(deepEquals(set1, set2)).toBe(false)
    })

    it(`should handle sets with objects (simplified comparison)`, () => {
      const set1 = new Set([{ a: 1 }, { b: 2 }])
      const set2 = new Set([{ a: 1 }, { b: 2 }])
      // Note: Set comparison for objects is simplified and may not work for all cases
      expect(deepEquals(set1, set2)).toBe(true)
    })

    it(`should handle circular references in sets`, () => {
      const set1 = new Set()
      set1.add(set1)
      const set2 = new Set()
      set2.add(set2)

      expect(deepEquals(set1, set2)).toBe(true)
    })
  })

  describe(`TypedArrays`, () => {
    it(`should handle identical Uint8Arrays`, () => {
      const arr1 = new Uint8Array([1, 2, 3, 4])
      const arr2 = new Uint8Array([1, 2, 3, 4])
      expect(deepEquals(arr1, arr2)).toBe(true)
    })

    it(`should handle different Uint8Arrays`, () => {
      const arr1 = new Uint8Array([1, 2, 3, 4])
      const arr2 = new Uint8Array([1, 2, 3, 5])
      expect(deepEquals(arr1, arr2)).toBe(false)
    })

    it(`should handle arrays with different lengths`, () => {
      const arr1 = new Uint8Array([1, 2, 3])
      const arr2 = new Uint8Array([1, 2])
      expect(deepEquals(arr1, arr2)).toBe(false)
    })

    it(`should handle different TypedArray types`, () => {
      const arr1 = new Uint8Array([1, 2, 3])
      const arr2 = new Int8Array([1, 2, 3])
      // Different types should be handled by the typeof check
      expect(deepEquals(arr1, arr2)).toBe(true) // Both are typed arrays with same values
    })

    it(`should handle Float32Arrays`, () => {
      const arr1 = new Float32Array([1.1, 2.2, 3.3])
      const arr2 = new Float32Array([1.1, 2.2, 3.3])
      expect(deepEquals(arr1, arr2)).toBe(true)
    })
  })

  describe(`Temporal objects (if available)`, () => {
    it(`should handle Temporal.PlainDate objects`, () => {
      const date1 = new Temporal.PlainDate(2023, 1, 1)
      const date2 = new Temporal.PlainDate(2023, 1, 1)
      const date3 = new Temporal.PlainDate(2023, 1, 2)

      expect(deepEquals(date1, date2)).toBe(true)
      expect(deepEquals(date1, date3)).toBe(false)
    })

    it(`should handle Temporal.Duration objects`, () => {
      const duration1 = Temporal.Duration.from(`PT1H30M`)
      const duration2 = Temporal.Duration.from(`PT1H30M`)
      const duration3 = Temporal.Duration.from(`PT2H30M`)

      expect(deepEquals(duration1, duration2)).toBe(true)
      expect(deepEquals(duration1, duration3)).toBe(false)
    })

    it(`should handle different Temporal types`, () => {
      const date = new Temporal.PlainDate(2023, 1, 1)
      const duration = Temporal.Duration.from(`PT1H30M`)
      expect(deepEquals(date, duration)).toBe(false)
    })
  })

  describe(`mixed complex cases`, () => {
    it(`should handle complex nested structures`, () => {
      const obj1 = {
        array: [1, 2, { nested: true }],
        map: new Map([[`key`, `value`]]),
        set: new Set([1, 2, 3]),
        date: new Date(`2023-01-01`),
        regex: /test/gi,
        typedArray: new Uint8Array([1, 2, 3]),
      }

      const obj2 = {
        array: [1, 2, { nested: true }],
        map: new Map([[`key`, `value`]]),
        set: new Set([1, 2, 3]),
        date: new Date(`2023-01-01`),
        regex: /test/gi,
        typedArray: new Uint8Array([1, 2, 3]),
      }

      expect(deepEquals(obj1, obj2)).toBe(true)
    })

    it(`should handle complex nested structures with differences`, () => {
      const obj1 = {
        array: [1, 2, { nested: true }],
        map: new Map([[`key`, `value`]]),
        date: new Date(`2023-01-01`),
      }

      const obj2 = {
        array: [1, 2, { nested: false }], // difference here
        map: new Map([[`key`, `value`]]),
        date: new Date(`2023-01-01`),
      }

      expect(deepEquals(obj1, obj2)).toBe(false)
    })
  })

  describe(`edge cases`, () => {
    it(`should handle null and undefined`, () => {
      expect(deepEquals(null, null)).toBe(true)
      expect(deepEquals(undefined, undefined)).toBe(true)
      expect(deepEquals(null, undefined)).toBe(false)
      expect(deepEquals(null, 0)).toBe(false)
      expect(deepEquals(undefined, ``)).toBe(false)
    })

    it(`should handle empty structures`, () => {
      expect(deepEquals({}, {})).toBe(true)
      expect(deepEquals([], [])).toBe(true)
      expect(deepEquals(new Map(), new Map())).toBe(true)
      expect(deepEquals(new Set(), new Set())).toBe(true)
    })

    it(`should handle mixed types`, () => {
      expect(deepEquals([], {})).toBe(false)
      expect(deepEquals(new Map(), new Set())).toBe(false)
      expect(deepEquals(new Date(), /regex/)).toBe(false)
    })
  })
})

describe(`isPromiseLike`, () => {
  it(`should return true for native Promises`, () => {
    const promise = Promise.resolve(42)
    expect(isPromiseLike(promise)).toBe(true)
  })

  it(`should return true for objects with a then method`, () => {
    const thenable = {
      then: (onFulfilled?: any, _onRejected?: any) => {
        onFulfilled?.(42)
      },
    }
    expect(isPromiseLike(thenable)).toBe(true)
  })

  it(`should return true for functions with a then method`, () => {
    const thenableFunction: any = function () {}
    thenableFunction.then = (onFulfilled?: any) => {
      onFulfilled?.(42)
    }
    expect(isPromiseLike(thenableFunction)).toBe(true)
  })

  it(`should return false for null`, () => {
    expect(isPromiseLike(null)).toBe(false)
  })

  it(`should return false for undefined`, () => {
    expect(isPromiseLike(undefined)).toBe(false)
  })

  it(`should return false for primitives`, () => {
    expect(isPromiseLike(42)).toBe(false)
    expect(isPromiseLike(`string`)).toBe(false)
    expect(isPromiseLike(true)).toBe(false)
    expect(isPromiseLike(false)).toBe(false)
  })

  it(`should return false for objects without a then method`, () => {
    expect(isPromiseLike({})).toBe(false)
    expect(isPromiseLike({ value: 42 })).toBe(false)
    expect(isPromiseLike([])).toBe(false)
    expect(isPromiseLike(new Map())).toBe(false)
  })

  it(`should return false for objects with a non-function then property`, () => {
    const obj = { then: 42 }
    expect(isPromiseLike(obj)).toBe(false)
  })

  it(`should return false for functions without a then method`, () => {
    const fn = () => 42
    expect(isPromiseLike(fn)).toBe(false)
  })

  it(`should handle async functions (which return promises)`, () => {
    const asyncFn = () => Promise.resolve(42)
    const result = asyncFn()
    expect(isPromiseLike(result)).toBe(true)
  })
})
