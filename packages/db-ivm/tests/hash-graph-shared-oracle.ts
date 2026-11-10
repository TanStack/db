/**
 * A root-reachable cycle rejects on both serial attempts. An acyclic shared
 * graph has the hash of its independently unfolded tree. Kahn's algorithm
 * supplies the topology judgment independently of production's active path.
 * The grammar is bounded to six plain labeled nodes with three array edges.
 */
import { expect } from 'vitest'
import fc from 'fast-check'
import { hash } from '../src/hashing/hash'
import { differs, pass, violation } from '../../db/tests/oracle-property.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'

export function isAcyclic(edges: Array<Array<number>>): boolean {
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

// Grammar: one root and up to five other nodes; each node has zero to three
// ordered edges. Target reduction keeps every edge in range while retaining
// self, backward, duplicate, and disconnected-edge cases. An empty graph or
// an out-of-range target is outside this grammar. Restricting to one node
// loses diamonds and disconnected cycles; one edge per node loses branching
// and duplicates; forward-only targets lose reachable cycles.
// The inverse validates the normalized adjacency language. It lets constructed
// and fixed histories shrink directly; it accepts exactly the existing bounds.
function unmapGraph(value: unknown): Array<Array<number>> {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 6 ||
    value.some(
      (targets) =>
        !Array.isArray(targets) ||
        targets.length > 3 ||
        targets.some(
          (target) =>
            !Number.isInteger(target) || target < 0 || target >= value.length,
        ),
    )
  ) {
    throw new Error(`Not a bounded adjacency list`)
  }
  return value as Array<Array<number>>
}

export const graphArbitrary = fc
  .array(fc.array(fc.nat({ max: 5 }), { maxLength: 3 }), {
    minLength: 1,
    maxLength: 6,
  })
  .map(
    (edges) =>
      edges.map((targets) => targets.map((target) => target % edges.length)),
    unmapGraph,
  )

// Model: the tree that an acyclic graph denotes from `node`. Sharing is
// unfolded into equal but distinct subtrees. Hash identity must depend on
// values, not whether the graph reused an object reference.
export function unfoldEdges(
  edges: Array<Array<number>>,
  node: number,
  offset = 0,
): unknown {
  return {
    value: node + offset,
    children: edges[node]!.map((child) => unfoldEdges(edges, child, offset)),
  }
}

export const graphWitnesses: Array<{
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
  {
    name: `maximum node and edge bounds`,
    edges: [[1, 2, 5], [3], [3], [4], [5], []],
    acyclic: true,
  },
]

export type GraphHistory = { edges: Array<Array<number>>; offset: number }
type Owed = Observation & { law: string }

export function expectedGraph(history: GraphHistory): Array<Owed> {
  return isAcyclic(history.edges)
    ? [
        {
          checkpoint: `acyclic graph and unfolded tree`,
          law: `graph unfolding`,
          value: true,
        },
      ]
    : [1, 2].map((attempt) => ({
        checkpoint: `cycle rejection attempt ${attempt}`,
        law: `cycle rejection`,
        value: true,
      }))
}

// Record each original throw/return boundary separately. Unexpected acyclic
// errors escape, preserving the old distinction between a crash and a mismatch.
export function driveGraph(
  { edges, offset }: GraphHistory,
  observe: (checkpoint: string, value: unknown) => void,
  hashValue: (value: unknown) => number = hash,
): void {
  const nodes = edges.map((_, value) => ({
    value: value + offset,
    children: [] as Array<unknown>,
  }))
  edges.forEach((targets, index) => {
    nodes[index]!.children = targets.map((target) => nodes[target])
  })
  if (!isAcyclic(edges)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let rejects = false
      try {
        hashValue(nodes[0])
      } catch (cause) {
        rejects =
          cause instanceof Error &&
          cause.message.includes(`Cannot hash cyclic structural values`)
      }
      observe(`cycle rejection attempt ${attempt}`, rejects)
    }
  } else {
    observe(
      `acyclic graph and unfolded tree`,
      Object.is(hashValue(nodes[0]), hashValue(unfoldEdges(edges, 0, offset))),
    )
  }
}

export function checkGraph(
  _history: GraphHistory,
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

// The supplemental shrinking/replay controls call the same production driver
// and judgment. Its assertion preserves their original AssertionError protocol.
export function expectGraphHash(
  edges: Array<Array<number>>,
  hashValue: (value: unknown) => number = hash,
): void {
  const history = { edges, offset: 0 }
  const trace: Array<Observation> = []
  driveGraph(
    history,
    (checkpoint, value) => trace.push({ checkpoint, value }),
    hashValue,
  )
  expect(checkGraph(history, trace, expectedGraph(history)).kind).toBe(`pass`)
}
