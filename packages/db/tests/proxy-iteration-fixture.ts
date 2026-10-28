/**
 * Shared draft-iteration helpers for proxy-iteration-contract-oracle.test.ts
 * and proxy-iteration-contract.test.ts. The native visit order is the model the
 * oracle compares against; `visit` runs one protocol over a draft or native
 * container.
 */
import { expect } from 'vitest'

export type Item = { x: number }

export const protocols = [`values`, `entries`, `iterator`, `forEach`] as const

export type Protocol = (typeof protocols)[number]

export function visit(
  values: Map<unknown, Item> | Set<Item>,
  protocol: Protocol,
  callback: (value: Item) => void,
) {
  switch (protocol) {
    case `forEach`:
      values.forEach(callback)
      break
    case `entries`:
      for (const [, value] of values.entries()) callback(value)
      break
    case `values`:
      for (const value of values.values()) callback(value)
      break
    case `iterator`:
      if (values instanceof Map) for (const [, value] of values) callback(value)
      else for (const value of values) callback(value)
  }
}

export function expectMembers(
  actual: Map<unknown, Item> | Set<Item>,
  expected: Map<unknown, Item> | Set<Item>,
): void {
  expect(actual).toBeInstanceOf(expected instanceof Map ? Map : Set)
  // Preserve Map keys, cardinality and iteration order before checking values.
  // An empty container must not pass a per-member predicate vacuously.
  expect([...actual]).toEqual([...expected])
}
