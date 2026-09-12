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

function expectGraphHash(
  edges: Array<Array<number>>,
  hashValue: (value: unknown) => number = hash,
): void {
  const nodes = edges.map((_, value) => ({
    value,
    children: [] as Array<unknown>,
  }))
  edges.forEach((targets, index) => {
    nodes[index]!.children = targets.map((target) => nodes[target])
  })
  if (!isAcyclic(edges)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => hashValue(nodes[0])).toThrow(
        `Cannot hash cyclic structural values`,
      )
    }
    return
  }
  // Unfold sharing into equal but distinct subtrees. Hash identity must
  // depend on values, not whether the graph reused an object reference.
  const unfold = (node: number): unknown => ({
    value: node,
    children: edges[node]!.map(unfold),
  })
  expect(hashValue(nodes[0])).toBe(hashValue(unfold(0)))
}

// Named semantic cells run on every campaign; random frequency is not evidence
// that disconnected cycles, repeated references, or duplicate edges were reached.
const graphWitnesses: Array<{
  name: string
  edges: Array<Array<number>>
  acyclic: boolean
}> = [
  { name: `isolated root`, edges: [[]], acyclic: true },
  { name: `root self-cycle`, edges: [[0]], acyclic: false },
  { name: `reachable mutual cycle`, edges: [[1], [0]], acyclic: false },
  { name: `unreachable self-cycle`, edges: [[], [1]], acyclic: true },
  {
    name: `shared acyclic diamond`,
    edges: [[1, 2], [3], [3], []],
    acyclic: true,
  },
  { name: `duplicate acyclic edges`, edges: [[1, 1], []], acyclic: true },
  { name: `duplicate cyclic edges`, edges: [[1, 1], [0]], acyclic: false },
]

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

  it.each(graphWitnesses)(`matches the $name witness`, ({ edges, acyclic }) => {
    // These expected categories are specified independently of Kahn's result.
    expect(isAcyclic(edges)).toBe(acyclic)
    expectGraphHash(edges)
  })

  for (const seed of [1657019, undefined]) {
    it(`matches reachable graph cycles and shared DAGs (${seed ?? `random`})`, () => {
      fc.assert(
        fc.property(graphArbitrary, (edges) => {
          expectGraphHash(edges)
        }),
        { numRuns: 300, ...(seed === undefined ? {} : { seed }) },
      )
    })
  }

  it(`rejects cycle acceptance while accepting its acyclic near-neighbor`, () => {
    expect(() => expectGraphHash([[1], [0]], () => 0)).toThrow()
    expectGraphHash([[1], []], () => 0)
    expectGraphHash([[1], [0]])
    expectGraphHash([[1], []])
  })

  it(`rejects false cycle rejection for unreachable cycles and shared DAGs`, () => {
    const rejectAll = (): number => {
      throw new TypeError(`Cannot hash cyclic structural values`)
    }
    for (const edges of [
      [[], [1]],
      [[1, 2], [3], [3], []],
      [[1, 1], []],
    ]) {
      expect(() => expectGraphHash(edges, rejectAll)).toThrow(
        `Cannot hash cyclic structural values`,
      )
      expectGraphHash(edges)
    }
    expectGraphHash([[0]], rejectAll)
  })

  it(`rejects unequal hashes of a shared DAG and its unfolding`, () => {
    let calls = 0
    expect(() =>
      expectGraphHash([[1, 2], [3], [3], []], () => ++calls),
    ).toThrow()
    expect(calls).toBe(2)
    expectGraphHash([[1, 2], [3], [3], []])
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
