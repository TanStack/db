/**
 * Generators and assertion helpers shared by the deepEquals oracle and its
 * ordinary tests: the utilsProperty registration, arbitrary value shapes, and
 * the equality, ring, and distinct-type checks. The law lives in
 * utils-oracle.property.test.ts.
 */
import { expect } from 'vitest'
import { deepEquals } from '../src/utils'

export const edgeCarriers = [`object`, `array`, `map`, `symbol`] as const

export type EdgeCarrier = (typeof edgeCarriers)[number]

export type EqualityNode = { value: number; next?: unknown }

// Construct corresponding rings, not an implementation of deep equality.
// Every node is reachable; replacing one numeric payload must be observable.
// Map keys/symbol keys are shared tokens, while all structural nodes are fresh.
export function equalityRing(
  cells: ReadonlyArray<{ value: number; carrier: EdgeCarrier }>,
  keys: ReadonlyArray<symbol>,
): EqualityNode {
  const nodes: Array<EqualityNode> = cells.map(({ value }) => ({ value }))
  for (const [index, cell] of cells.entries()) {
    const target = nodes[(index + 1) % nodes.length]!
    switch (cell.carrier) {
      case `object`:
        nodes[index]!.next = { target }
        break
      case `array`:
        nodes[index]!.next = [target]
        break
      case `map`:
        nodes[index]!.next = new Map([[keys[index]!, target]])
        break
      case `symbol`:
        nodes[index]!.next = { [keys[index]!]: target }
        break
    }
  }
  return nodes[0]!
}

export function expectEqualityPair(
  a: unknown,
  b: unknown,
  expected: boolean,
  equal: (a: unknown, b: unknown) => boolean = deepEquals,
): void {
  expect(equal(a, b), `forward equality`).toBe(expected)
  expect(equal(b, a), `reverse equality`).toBe(expected)
}

export function expectCopyAndChanged(
  original: unknown,
  copy: unknown,
  changed: unknown,
  equal: (a: unknown, b: unknown) => boolean = deepEquals,
): void {
  expectEqualityPair(original, copy, true, equal)
  expectEqualityPair(original, changed, false, equal)
}

export function expectRingLaw(
  cells: ReadonlyArray<{ value: number; carrier: EdgeCarrier }>,
  equal: (a: unknown, b: unknown) => boolean = deepEquals,
): void {
  expect(cells.length).toBeGreaterThan(0)
  const keys = cells.map((_, index) => Symbol(`edge-${index}`))
  const original = equalityRing(cells, keys)
  const copy = equalityRing(cells, keys)
  expect(original).not.toBe(copy)
  expectEqualityPair(original, copy, true, equal)
  // Check every reachable payload, including nodes past a mixed-container edge.
  for (let changed = 0; changed < cells.length; changed++) {
    const different = equalityRing(
      cells.map((cell, index) => ({
        ...cell,
        value: cell.value + (index === changed ? 1 : 0),
      })),
      keys,
    )
    expectEqualityPair(original, different, false, equal)
  }
}

export function assertExtraProperty(
  {
    original,
    key,
    value,
  }: {
    original: Record<string, number>
    key: string
    value: number
  },
  equal: (a: unknown, b: unknown) => boolean,
): void {
  expect(key in original).toBe(false)
  const extended = { ...original, [key]: value }
  expect(Object.keys(extended)).toHaveLength(Object.keys(original).length + 1)
  expect(equal(original, { ...original }), `property copy must be equal`).toBe(
    true,
  )
  expect(equal(original, extended), `extra property must be unequal`).toBe(
    false,
  )
  expect(equal(extended, original), `extra property must be unequal`).toBe(
    false,
  )
}

export function assertDistinctTypes(
  a: unknown,
  b: unknown,
  equal: (a: unknown, b: unknown) => boolean,
): void {
  expect(equal(a, b), `distinct types must be unequal (forward)`).toBe(false)
  expect(equal(b, a), `distinct types must be unequal (reverse)`).toBe(false)
}
