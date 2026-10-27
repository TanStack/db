import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { hash } from '../src/hashing/hash'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'

/**
 * Structural hash follows the reachable value graph, not object identity.
 * This is the established structural-value contract recorded in the oracle
 * coverage map: equal acyclic values have equal hashes, reachable cycles
 * reject, and a failed traversal publishes no reusable sibling hashes.
 *
 * A small adjacency list is the model. Kahn's algorithm independently decides
 * whether the root-reachable graph is acyclic. Acyclic sharing is unfolded into
 * equal fresh trees and must hash the same; a reachable cycle must reject on
 * every attempt, while an unreachable cycle is irrelevant. Named witnesses
 * keep rare topology classes present even when random generation misses them.
 * The generated topology claim is limited to plain objects with numeric
 * labels and array edges, at most six nodes and three edges per node. Cycle
 * rejection through other containers is pinned by hash-graph.test.ts, an
 * ordinary test file. This file does not establish collision freedom or
 * complexity limits.
 */

const fixedSeed = 1657019
const graphProperty = `ivm.hash-graph`

// This adjacency list exists only in the model; production receives a rooted
// JavaScript value. Kahn's algorithm checks reachability without using the
// hasher's recursive active-path algorithm. Unreachable cycles do not affect
// the root. The checkpoint is each hash() return or throw.
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

// Grammar: one root and up to five other nodes; each node has zero to three
// ordered edges. Target reduction keeps every edge in range while retaining
// self, backward, duplicate, and disconnected-edge cases. An empty graph or
// an out-of-range target is outside this grammar. Restricting to one node
// loses diamonds and disconnected cycles; one edge per node loses branching
// and duplicates; forward-only targets lose reachable cycles.
const graphArbitrary = fc
  .array(fc.array(fc.nat({ max: 5 }), { maxLength: 3 }), {
    minLength: 1,
    maxLength: 6,
  })
  .map((edges) =>
    edges.map((targets) => targets.map((target) => target % edges.length)),
  )

// Model: the tree that an acyclic graph denotes from `node`. Sharing is
// unfolded into equal but distinct subtrees. Hash identity must depend on
// values, not whether the graph reused an object reference.
function unfoldEdges(edges: Array<Array<number>>, node: number): unknown {
  return {
    value: node,
    children: edges[node]!.map((child) => unfoldEdges(edges, child)),
  }
}

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
  expect(hashValue(nodes[0])).toBe(hashValue(unfoldEdges(edges, 0)))
}

declareOracle({
  check: [expectGraphHash],
  model: [isAcyclic, unfoldEdges],
})

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
  {
    name: `maximum node and edge bounds`,
    edges: [[1, 2, 5], [3], [3], [4], [5], []],
    acyclic: true,
  },
]

describe(`structural hash graph boundary`, () => {
  it.each(graphWitnesses)(`matches the $name witness`, ({ edges, acyclic }) => {
    // These expected categories are specified independently of Kahn's result.
    expect(isAcyclic(edges)).toBe(acyclic)
    expectGraphHash(edges)
  })

  oracleReplayTest(it)(
    `matches reachable graph cycles and shared DAGs (fixed)`,
    () => {
      fc.assert(
        fc.property(graphArbitrary, (edges) => {
          expectGraphHash(edges)
        }),
        { numRuns: oracleRuns(300), seed: fixedSeed },
      )
    },
  )
  oracleReplayTest(it, graphProperty)(
    `matches reachable graph cycles and shared DAGs (random)`,
    () => {
      fc.assert(
        fc.property(graphArbitrary, (edges) => {
          expectGraphHash(edges)
        }),
        oraclePropertyOptions(300, graphProperty),
      )
    },
  )

  it(`rejects cycle acceptance while accepting its acyclic near-neighbor`, () => {
    expect(() => expectGraphHash([[1], [0]], () => 0)).toThrow()
    expectGraphHash([[1], []], () => 0)
    expectGraphHash([[1], [0]])
    expectGraphHash([[1], []])
  })

  it(`replays a cycle-acceptance mismatch at the same checkpoint`, () => {
    const property = fc.property(fc.integer({ min: 1, max: 3 }), (length) => {
      const edges = Array.from({ length: length + 1 }, (_, node) => [
        node === length ? 0 : node + 1,
      ])
      expectGraphHash(edges)
      expectGraphHash(edges, () => 0)
    })
    const failed = fc.check(property, { seed: fixedSeed, numRuns: 1 })
    expect(failed.failed).toBe(true)
    expect(failed.errorInstance).toMatchObject({ name: `AssertionError` })
    if (failed.counterexamplePath === null) {
      throw new Error(`Missing graph replay path`)
    }
    const replay = fc.check(property, {
      seed: failed.seed,
      path: failed.counterexamplePath,
      endOnFailure: true,
    })
    expect(replay.counterexample).toEqual(failed.counterexample)
    expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
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
})
