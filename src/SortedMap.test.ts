import { describe, expect, it } from "vitest"
import { SortedMap } from "./SortedMap"

describe(`SortedMap`, () => {
  it(`maintains sorted order by values`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([1, 2, 3])
  })

  it(`works with custom comparator`, () => {
    // Create a map that sorts numbers in descending order
    const map = new SortedMap<string, number>((a, b) => b - a)
    map.set(`a`, 1)
    map.set(`c`, 3)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([3, 2, 1])
  })

  it(`correctly handles updates`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 3)
    map.set(`a`, 2) // update existing key

    expect(map.size).toBe(2)
    expect(map.get(`a`)).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([2, 3])
  })

  it(`correctly handles deletions`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)
    map.set(`c`, 3)

    map.delete(`b`)
    expect(map.size).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([1, 3])
  })

  it(`implements iteration methods correctly`, () => {
    const map = new SortedMap<string, number>()
    map.set(`b`, 2)
    map.set(`a`, 1)
    map.set(`c`, 3)

    // Test entries()
    const entries = Array.from(map.entries())
    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])

    // Test values()
    const values = Array.from(map.values())
    expect(values).toEqual([1, 2, 3])

    // Test forEach
    const forEachResults: Array<number> = []
    map.forEach((value) => forEachResults.push(value))
    expect(forEachResults).toEqual([1, 2, 3])
  })
})
