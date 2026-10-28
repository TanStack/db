// Ordinary structural-hash graph tests: a cycle through each container kind,
// and a completed sibling left uncached when a cycle rejects the root. Both
// compare production with fixed expectations. hash-graph-oracle.property.test.ts
// owns the reachable-graph law and declares its check.
import { describe, expect, it } from 'vitest'
import { hash } from '../src/hashing/hash'

describe(`structural hash graph boundary`, () => {
  it.each([
    `object`,
    `array`,
    `map-key`,
    `map-value`,
    `set`,
    `symbol`,
  ] as const)(`rejects a cycle through %s on every attempt`, (kind) => {
    const record: Record<PropertyKey, unknown> = {}
    const array: Array<unknown> = []
    const map = new Map<unknown, unknown>()
    const set = new Set<unknown>()
    const input =
      kind === `array`
        ? array
        : kind.startsWith(`map`)
          ? map
          : kind === `set`
            ? set
            : record
    if (kind === `object`) record.self = input
    if (kind === `symbol`) record[Symbol(`self`)] = input
    if (kind === `array`) array.push(input)
    if (kind === `map-key`) map.set(input, 1)
    if (kind === `map-value`) map.set(1, input)
    if (kind === `set`) set.add(input)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => hash(input)).toThrow(`Cannot hash cyclic structural values`)
    }
  })

  it(`leaves completed siblings uncached after a cycle rejects the root`, () => {
    let reads = 0
    const sibling = {
      get value() {
        return ++reads
      },
    }
    const root: Record<string, unknown> = { a: sibling }
    root.z = root
    expect(() => hash(root)).toThrow(`Cannot hash cyclic structural values`)
    expect(() => hash(root)).toThrow(`Cannot hash cyclic structural values`)
    expect(reads).toBe(2)
    delete root.z
    expect(hash(root)).toBe(hash({ a: { value: 3 } }))
    expect(reads).toBe(3)
  })
})
