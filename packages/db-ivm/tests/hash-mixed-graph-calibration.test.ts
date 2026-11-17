import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { hash } from '../src/hashing/hash'
import { oracleRoute } from '../../db/tests/oracle-config.js'
import {
  carriers,
  expectMixedGraph,
  graphArbitrary,
  isAcyclic,
} from './hash-mixed-graph-shared-oracle'
import type { Graph } from './hash-mixed-graph-shared-oracle'

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
    oracleRoute(`calibration`)
    const graph: Graph = [{ label: 0, edges: [{ target: 0, carrier }] }]
    expect(isAcyclic(graph)).toBe(false)
    expectMixedGraph(graph)
    expect(() => expectMixedGraph(graph, () => 0)).toThrow()
  })

  it.each(carriers)(
    `preserves distinct equal nodes and sharing through %s`,
    (carrier) => {
      oracleRoute(`case`)
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
    oracleRoute(`case`)
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
    oracleRoute(`case`)
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

  it(`replays a generated cycle-acceptance mismatch at the same law`, () => {
    oracleRoute(`calibration`)
    const acceptsCycles = (): number => 0
    const failed = fc.check(mixedGraphProperty(acceptsCycles), {
      seed: 205203,
      numRuns: 150,
    })
    expect(failed.failed).toBe(true)
    expect(failed.counterexamplePath).not.toBeNull()
    expect(String(failed.errorInstance)).toContain(`reachable cycle`)
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
    expect(String(replay.errorInstance)).toContain(`reachable cycle`)
  })

  it(`rejects unequal DAG and unfolding output and preserves the witness on replay`, () => {
    oracleRoute(`calibration`)
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
