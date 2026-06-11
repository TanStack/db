import { describe, expect, it } from 'vitest'
import { SortedMap } from '../src/SortedMap'

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

  // Test to cover the defaultComparator method (line 32)
  it(`uses defaultComparator correctly when no custom comparator is provided`, () => {
    const map = new SortedMap<string, string>()
    map.set(`c`, `charlie`)
    map.set(`a`, `alpha`)
    map.set(`b`, `bravo`)

    const values = Array.from(map.values())
    expect(values).toEqual([`alpha`, `bravo`, `charlie`])

    // Test with values that would be sorted differently by a custom comparator
    const numericMap = new SortedMap<string, string>()
    numericMap.set(`a`, `10`)
    numericMap.set(`b`, `2`)

    // Default string comparison will put '10' before '2'
    const numericValues = Array.from(numericMap.values())
    expect(numericValues).toEqual([`10`, `2`])
  })

  // Test for keys() method
  it(`provides keys in sorted order`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const keys = Array.from(map.keys())
    expect(keys).toEqual([`a`, `b`, `c`])
  })

  // Test for Symbol.iterator implementation
  it(`supports direct iteration with for...of`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const entries: Array<[string, number]> = []
    for (const entry of map) {
      entries.push(entry)
    }

    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])
  })

  // Test for clear method
  it(`clears all entries`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)

    map.clear()
    expect(map.size).toBe(0)
    expect(Array.from(map.entries())).toEqual([])
  })
})
