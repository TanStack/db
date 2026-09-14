import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'

// Kahn's algorithm checks the reachable graph without using the hasher's
// recursive active-path algorithm. Unreachable cycles do not affect the root.
function isAcyclic(edges: Array<Array<number>>): boolean {
  const reachable = new Set([0])
  for (const node of reachable) {
    for (const target of edges[node]!) reachable.add(target)
  }
  const incoming = new Map([...reachable].map((node) => [node, 0]))
  for (const node of reachable) {
    for (const target of edges[node]!) {
      incoming.set(target, incoming.get(target)! + 1)
    }
  }
  const ready = [...reachable].filter((node) => incoming.get(node) === 0)
  for (const node of ready) {
    for (const target of edges[node]!) {
      const remaining = incoming.get(target)! - 1
      incoming.set(target, remaining)
      if (remaining === 0) ready.push(target)
    }
  }
  return ready.length === reachable.size
}

const graphArbitrary = fc
  .array(fc.array(fc.nat({ max: 5 }), { maxLength: 3 }), {
    minLength: 1,
    maxLength: 6,
  })
  .map((edges) =>
    edges.map((targets) => targets.map((target) => target % edges.length)),
  )

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

  for (const seed of [1657019, undefined]) {
    it(`matches reachable graph cycles and shared DAGs (${seed ?? `random`})`, () => {
      fc.assert(
        fc.property(graphArbitrary, (edges) => {
          const nodes = edges.map((_, value) => ({
            value,
            children: [] as Array<unknown>,
          }))
          edges.forEach((targets, index) => {
            nodes[index]!.children = targets.map((target) => nodes[target])
          })
          if (!isAcyclic(edges)) {
            expect(() => hash(nodes[0])).toThrow(
              `Cannot hash cyclic structural values`,
            )
            expect(() => hash(nodes[0])).toThrow(
              `Cannot hash cyclic structural values`,
            )
            return
          }
          // Unfold sharing into equal but distinct subtrees. Hash identity must
          // depend on values, not whether the graph reused an object reference.
          const unfold = (node: number): unknown => ({
            value: node,
            children: edges[node]!.map(unfold),
          })
          expect(hash(nodes[0])).toBe(hash(unfold(0)))
        }),
        { numRuns: 300, ...(seed === undefined ? {} : { seed }) },
      )
    })
  }

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
