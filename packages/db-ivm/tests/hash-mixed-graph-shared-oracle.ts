/**
 * Mixed-carrier graphs extend the established structural-hash graph law across
 * every recursive container (see hash-graph-oracle.property.test.ts and the structural
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

import fc from 'fast-check'
import { expect } from 'vitest'
import { hash } from '../src/hashing/hash'
import { differs, pass, violation } from '../../db/tests/oracle-property.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'

export type Carrier =
  `object` | `array` | `map-key` | `map-value` | `set` | `symbol`
export type Edge = Readonly<{ target: number; carrier: Carrier }>
export type Node = Readonly<{ label: number; edges: ReadonlyArray<Edge> }>
export type Graph = ReadonlyArray<Node>

export const carriers: Array<Carrier> = [
  `object`,
  `array`,
  `map-key`,
  `map-value`,
  `set`,
  `symbol`,
]
// The inverse accepts exactly the old normalized bounded graph language.
// It lets fixed and constructed histories shrink without narrowing carriers.
function unmapGraph(
  value: unknown,
): Array<{ label: number; edges: Array<Edge> }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6)
    throw new Error(`Not a bounded mixed graph`)
  const length = value.length
  for (const node of value as Array<unknown>) {
    if (
      typeof node !== `object` ||
      node === null ||
      !(`label` in node) ||
      !Number.isInteger(node.label) ||
      Number(node.label) < 0 ||
      Number(node.label) > 2 ||
      !(`edges` in node) ||
      !Array.isArray(node.edges) ||
      node.edges.length > 3
    )
      throw new Error(`Not a bounded mixed graph node`)
    for (const edge of node.edges as Array<unknown>)
      if (
        typeof edge !== `object` ||
        edge === null ||
        !(`target` in edge) ||
        !Number.isInteger(edge.target) ||
        Number(edge.target) < 0 ||
        Number(edge.target) >= length ||
        !(`carrier` in edge) ||
        !carriers.includes(edge.carrier as Carrier)
      )
        throw new Error(`Not a bounded mixed graph edge`)
  }
  return (value as Graph).map((node) => ({
    label: node.label,
    edges: node.edges.map((edge) => ({ ...edge })),
  }))
}

export const graphArbitrary = fc
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
    unmapGraph,
  )

// Reachable indegrees are a topology authority, not the hasher's recursion
// stack. Payloads and carrier allocation never enter this decision.
export function isAcyclic(graph: Graph): boolean {
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

// Model: the value that an acyclic graph denotes from node `id`. Sharing is
// unfolded into distinct equal values, and each edge keeps its carrier.
export function unfoldGraph(graph: Graph, id: number, symbol: symbol): unknown {
  return {
    label: graph[id]!.label,
    edges: graph[id]!.edges.map((edge) =>
      carry(edge.carrier, unfoldGraph(graph, edge.target, symbol), symbol),
    ),
  }
}

// Topology supplies the owed hash-call results before any production value
// is allocated. The public checkpoints are each serial return or throw.
type Owed = Observation & { law: string }
export function expectedMixedGraph(graph: Graph): Array<Owed> {
  return isAcyclic(graph)
    ? [
        {
          checkpoint: `acyclic graph and unfolded tree`,
          law: `acyclic unfolding`,
          value: true,
        },
      ]
    : [1, 2].map((attempt) => ({
        checkpoint: `cycle rejection attempt ${attempt}`,
        law: `reachable cycle`,
        value: true,
      }))
}

// Each one-entry carrier keeps edges distinct when sharing is unfolded.
// Unexpected acyclic exceptions escape; cycle rejection retains the original
// required error-message check on each of the two attempts.
export function driveMixedGraph(
  graph: Graph,
  observe: (checkpoint: string, value: unknown) => void,
  hashValue: (value: unknown) => number = hash,
): void {
  const symbol = Symbol(`edge`)
  const nodes = graph.map((node) => ({
    label: node.label,
    edges: [] as Array<unknown>,
  }))
  graph.forEach((node, index) => {
    nodes[index]!.edges = node.edges.map((edge) =>
      carry(edge.carrier, nodes[edge.target], symbol),
    )
  })
  if (!isAcyclic(graph)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let rejected = false
      try {
        hashValue(nodes[0])
      } catch (cause) {
        rejected =
          cause instanceof Error &&
          cause.message.includes(`Cannot hash cyclic structural values`)
      }
      observe(`cycle rejection attempt ${attempt}`, rejected)
    }
  } else {
    observe(
      `acyclic graph and unfolded tree`,
      Object.is(hashValue(nodes[0]), hashValue(unfoldGraph(graph, 0, symbol))),
    )
  }
}

// Compare recorded semantics before missing results. Each real checkpoint is
// unique; completeness never points at an earlier observed result.
export function checkMixedGraph(
  _graph: Graph,
  trace: ReadonlyArray<Observation>,
  expected: Array<Owed>,
): Verdict {
  let at = 0
  for (const actual of trace) {
    if (actual.checkpoint === `reach`) continue
    const owed = expected[at++]
    if (!owed)
      return violation(
        actual.checkpoint,
        `an extra graph result was observed`,
        `graph sequence`,
      )
    const mismatch = differs(actual.checkpoint, owed.law, actual, {
      checkpoint: owed.checkpoint,
      value: owed.value,
    })
    if (mismatch) return mismatch
  }
  return at === expected.length
    ? pass
    : violation(
        expected[at]!.checkpoint,
        `the graph result was not observed`,
        expected[at]!.law,
      )
}

// Ordinary shrinking and topology calibrations replay the same production
// driver and comparison, retaining their AssertionError protocol.
export function expectMixedGraph(
  graph: Graph,
  hashValue: (value: unknown) => number = hash,
): void {
  const trace: Array<Observation> = []
  driveMixedGraph(
    graph,
    (checkpoint, value) => trace.push({ checkpoint, value }),
    hashValue,
  )
  expect(checkMixedGraph(graph, trace, expectedMixedGraph(graph)).kind).toBe(
    `pass`,
  )
}
