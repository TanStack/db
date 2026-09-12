import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'

type Carrier = `object` | `array` | `map-key` | `map-value` | `set` | `symbol`
type Edge = Readonly<{ target: number; carrier: Carrier }>
type Node = Readonly<{ label: number; edges: ReadonlyArray<Edge> }>
type Graph = ReadonlyArray<Node>

const carriers: Array<Carrier> = [
  `object`,
  `array`,
  `map-key`,
  `map-value`,
  `set`,
  `symbol`,
]
const graphArbitrary = fc
  .array(
    fc.record({
      label: fc.integer({ min: 0, max: 2 }),
      edges: fc.array(
        fc.record({
          target: fc.nat({ max: 5 }),
          carrier: fc.constantFrom(...carriers),
        }),
        { maxLength: 3 },
      ),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .map(
    (nodes): Graph =>
      nodes.map((node) =>
        Object.freeze({
          label: node.label,
          edges: Object.freeze(
            node.edges.map((edge) =>
              Object.freeze({ ...edge, target: edge.target % nodes.length }),
            ),
          ),
        }),
      ),
  )

// Reachable indegrees are a topology authority, not the hasher's recursion
// stack. Payloads and carrier allocation never enter this decision.
function isAcyclic(graph: Graph): boolean {
  const reachable = new Set([0])
  for (const node of reachable)
    for (const edge of graph[node]!.edges) reachable.add(edge.target)
  const incoming = new Map([...reachable].map((node) => [node, 0]))
  for (const node of reachable)
    for (const edge of graph[node]!.edges)
      incoming.set(edge.target, incoming.get(edge.target)! + 1)
  const ready = [...reachable].filter((node) => incoming.get(node) === 0)
  for (const node of ready)
    for (const edge of graph[node]!.edges) {
      const remaining = incoming.get(edge.target)! - 1
      incoming.set(edge.target, remaining)
      if (remaining === 0) ready.push(edge.target)
    }
  return ready.length === reachable.size
}

function carry(carrier: Carrier, target: unknown, symbol: symbol): unknown {
  switch (carrier) {
    case `object`:
      return { target }
    case `array`:
      return [target]
    case `map-key`:
      return new Map([[target, 0]])
    case `map-value`:
      return new Map([[0, target]])
    case `set`:
      return new Set([target])
    case `symbol`:
      return { [symbol]: target }
  }
}

function expectMixedGraph(
  graph: Graph,
  hashValue: (value: unknown) => number = hash,
): void {
  const symbol = Symbol(`edge`)
  const nodes = graph.map((node) => ({
    label: node.label,
    edges: [] as Array<unknown>,
  }))
  graph.forEach((node, index) => {
    // Each edge owns a one-entry carrier. Set/Map cannot deduplicate two
    // semantic edges when sharing is unfolded into distinct equal objects.
    nodes[index]!.edges = node.edges.map((edge) =>
      carry(edge.carrier, nodes[edge.target], symbol),
    )
  })
  if (!isAcyclic(graph)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => hashValue(nodes[0])).toThrow(
        `Cannot hash cyclic structural values`,
      )
    }
    return
  }
  const unfold = (id: number): unknown => ({
    label: graph[id]!.label,
    edges: graph[id]!.edges.map((edge) =>
      carry(edge.carrier, unfold(edge.target), symbol),
    ),
  })
  expect(hashValue(nodes[0])).toBe(hashValue(unfold(0)))
}

describe(`mixed-carrier structural graph laws`, () => {
  it.each(carriers)(
    `preserves distinct equal nodes and sharing through %s`,
    (carrier) => {
      const distinct: Graph = [
        {
          label: 0,
          edges: [
            { target: 1, carrier },
            { target: 2, carrier },
          ],
        },
        { label: 1, edges: [] },
        { label: 1, edges: [] },
      ]
      expect(distinct[1]).not.toBe(distinct[2])
      expect(distinct[1]).toEqual(distinct[2])
      expectMixedGraph(distinct)
      expectMixedGraph([
        {
          ...distinct[0]!,
          edges: [
            { target: 1, carrier },
            { target: 1, carrier },
          ],
        },
        ...distinct.slice(1),
      ])
    },
  )

  it(`distinguishes a mixed-container back edge from its disconnected near-neighbor`, () => {
    const cycle: Graph = [
      { label: 0, edges: [{ carrier: `map-key`, target: 1 }] },
      { label: 0, edges: [{ carrier: `set`, target: 2 }] },
      { label: 0, edges: [{ carrier: `symbol`, target: 0 }] },
    ]
    const disconnected: Graph = [{ label: 0, edges: [] }, ...cycle.slice(1)]
    expect(isAcyclic(cycle)).toBe(false)
    expect(isAcyclic(disconnected)).toBe(true)
    expectMixedGraph(cycle)
    expectMixedGraph(disconnected)
    expect(() => expectMixedGraph(cycle, () => 0)).toThrow()
    expectMixedGraph(disconnected, () => 0)
  })

  for (const seed of [205203, fc.sample(fc.integer(), 1)[0]!]) {
    it(`matches independent labels and mixed-carrier topology (${seed})`, () => {
      fc.assert(
        fc.property(graphArbitrary, (graph) => expectMixedGraph(graph)),
        { numRuns: 150, seed },
      )
    })
  }

  it(`rejects unequal DAG and unfolding output and preserves the witness on replay`, () => {
    const property = fc.property(fc.integer({ min: 0, max: 2 }), (label) => {
      const graph: Graph = [
        {
          label,
          edges: [
            { target: 1, carrier: `map-value` },
            { target: 1, carrier: `map-value` },
          ],
        },
        { label, edges: [] },
      ]
      expectMixedGraph(graph)
      let calls = 0
      expectMixedGraph(graph, () => ++calls)
    })
    const failed = fc.check(property, { seed: 205203, numRuns: 1 })
    expect(failed.failed).toBe(true)
    expect(failed.numShrinks).toBeGreaterThan(0)
    expect(failed.counterexamplePath).toBe(`0:0`)
    expect(failed.errorInstance).toMatchObject({ name: `AssertionError` })
    if (failed.counterexamplePath === null)
      throw new Error(`Missing graph replay path`)
    const replay = fc.check(property, {
      seed: failed.seed,
      path: failed.counterexamplePath,
      endOnFailure: true,
    })
    expect(replay.counterexample).toEqual(failed.counterexample)
    expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
  })
})
