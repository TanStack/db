import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'

/**
 * Mixed-carrier graphs extend the established structural-hash graph law across
 * every recursive container (see hash-graph.property.test.ts and the structural
 * values row in docs/contributing/oracle-coverage.md).
 *
 * Law: a reachable structural cycle rejects each hash attempt; unfolding
 * sharing in an acyclic value graph preserves its hash. The model's abstract
 * graph stores only labels, targets, and carrier names. These are model-only
 * terms: an edge becomes an object field, array slot, Map key/value, Set
 * member, or symbol-keyed field in the production input. Reachability and
 * acyclicity are judged before constructing those values, so a carrier bug
 * cannot be copied into the cycle decision.
 *
 * The grammar has 1-6 nodes, 0-3 ordered outgoing edges per node, labels 0-2,
 * six carriers, and only in-range targets. The root is node 0; disconnected
 * nodes are allowed. Target choice controls self-cycles, longer cycles, and
 * sharing; removing it loses those laws. Carrier choice makes an edge traverse
 * each recursive container; removing one loses that boundary. Labels keep
 * equal and unequal payloads possible. Zero edges permits the isolated root;
 * two edges permit sharing; three edges and six nodes bound fan-out and path
 * length. One node is the lower size margin.
 * A negative or out-of-range target is outside this grammar. Named witnesses
 * reconstruct equal distinct nodes, sharing, a mixed back edge, and its
 * disconnected acyclic neighbor. This oracle does not claim collision freedom,
 * ordering invariance, opaque references, deep/work-limit behavior, or retry
 * atomicity. The public observation is the hash result or thrown error when
 * the real hash entry point returns, compared below with the graph model.
 */

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

const replaySeedText = process.env.TANSTACK_DB_IVM_MIXED_GRAPH_SEED
const replayPath = process.env.TANSTACK_DB_IVM_MIXED_GRAPH_PATH
const replayFault = process.env.TANSTACK_DB_IVM_MIXED_GRAPH_FAULT
if (replayPath !== undefined && replaySeedText === undefined)
  throw new Error(`Mixed graph replay path requires a seed`)
if (replayFault !== undefined && replayFault !== `accept-cycles`)
  throw new Error(`Unknown mixed graph replay fault`)
const replaySeed =
  replaySeedText === undefined ? undefined : Number(replaySeedText)
if (replaySeed !== undefined && !Number.isSafeInteger(replaySeed))
  throw new Error(`Mixed graph replay seed must be an integer`)

const campaigns =
  replaySeed === undefined
    ? [
        { name: `fixed seed 205203`, seed: 205203, path: undefined },
        { name: `random`, seed: undefined, path: undefined },
      ]
    : [{ name: `replay`, seed: replaySeed, path: replayPath }]

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

function mixedGraphProperty(
  hashValue: (value: unknown) => number = hash,
  recordCheck: () => void = () => {},
) {
  let firstFailureLaw: `reachable cycle` | `acyclic unfolding` | undefined
  let firstFailureGraph: Graph | undefined
  return fc.property(graphArbitrary, (graph) => {
    recordCheck()
    const law = isAcyclic(graph) ? `acyclic unfolding` : `reachable cycle`
    try {
      expectMixedGraph(graph, hashValue)
    } catch (cause) {
      if (firstFailureLaw === undefined) {
        firstFailureLaw = law
        firstFailureGraph = graph
      }
      // A shrink in the other topology class is not the original failure.
      if (law !== firstFailureLaw) return
      throw new Error(
        `Mixed graph ${law} failed at the hash call; original graph ${JSON.stringify(firstFailureGraph)}; candidate graph ${JSON.stringify(graph)}`,
        { cause },
      )
    }
  })
}

describe(`mixed-carrier structural graph laws`, () => {
  it.each(carriers)(`rejects a reachable cycle through %s`, (carrier) => {
    const graph: Graph = [{ label: 0, edges: [{ target: 0, carrier }] }]
    expect(isAcyclic(graph)).toBe(false)
    expectMixedGraph(graph)
    expect(() => expectMixedGraph(graph, () => 0)).toThrow()
  })

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

  it(`preserves a shared mixed-carrier DAG when unfolded`, () => {
    const diamond: Graph = [
      {
        label: 0,
        edges: [
          { carrier: `object`, target: 1 },
          { carrier: `array`, target: 2 },
        ],
      },
      { label: 1, edges: [{ carrier: `map-value`, target: 3 }] },
      { label: 2, edges: [{ carrier: `set`, target: 3 }] },
      { label: 2, edges: [] },
    ]
    expect(isAcyclic(diamond)).toBe(true)
    expectMixedGraph(diamond)
    const rejectsAll = (): number => {
      throw new TypeError(`Cannot hash cyclic structural values`)
    }
    expect(() => expectMixedGraph(diamond, rejectsAll)).toThrow()
  })

  for (const campaign of campaigns) {
    it(`matches independent labels and mixed-carrier topology (${campaign.name})`, () => {
      let checked = 0
      // The fault option is a test-only wrong-result control for CLI replay.
      const hashValue = replayFault === `accept-cycles` ? () => 0 : hash
      const property = mixedGraphProperty(hashValue, () => checked++)
      fc.assert(property, {
        numRuns: 150,
        ...(campaign.seed === undefined ? {} : { seed: campaign.seed }),
        ...(campaign.path === undefined ? {} : { path: campaign.path }),
      })
      // A green normal campaign must reach the graph check for every run.
      if (campaign.path === undefined) expect(checked).toBe(150)
      else expect(checked).toBeGreaterThan(0)
    })
  }

  it(`replays a generated cycle-acceptance mismatch at the same law`, () => {
    const acceptsCycles = (): number => 0
    const failed = fc.check(mixedGraphProperty(acceptsCycles), {
      seed: 205203,
      numRuns: 150,
    })
    expect(failed.failed).toBe(true)
    expect(failed.counterexamplePath).not.toBeNull()
    expect(failed.error).toContain(`reachable cycle`)
    if (failed.counterexamplePath === null)
      throw new Error(`Missing mixed graph replay path`)
    const replay = fc.check(mixedGraphProperty(acceptsCycles), {
      seed: failed.seed,
      path: failed.counterexamplePath,
      numRuns: 150,
      endOnFailure: true,
    })
    expect(replay.failed).toBe(true)
    expect(replay.counterexample).toEqual(failed.counterexample)
    expect(replay.error).toContain(`reachable cycle`)
  })

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
