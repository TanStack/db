import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { oracleRoute } from '../../db/tests/oracle-config.js'
import {
  expectGraphHash,
  graphWitnesses,
  isAcyclic,
} from './hash-graph-shared-oracle'

const fixedSeed = 1657019

describe(`structural hash graph calibration`, () => {
  it.each(graphWitnesses)(`matches the $name witness`, ({ edges, acyclic }) => {
    oracleRoute(`case`)
    // These expected categories are specified independently of Kahn's result.
    expect(isAcyclic(edges)).toBe(acyclic)
    expectGraphHash(edges)
  })
  it(`rejects cycle acceptance while accepting its acyclic near-neighbor`, () => {
    oracleRoute(`calibration`)
    expect(() => expectGraphHash([[1], [0]], () => 0)).toThrow()
    expectGraphHash([[1], []], () => 0)
    expectGraphHash([[1], [0]])
    expectGraphHash([[1], []])
  })

  it(`replays a cycle-acceptance mismatch at the same checkpoint`, () => {
    oracleRoute(`calibration`)
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
    oracleRoute(`calibration`)
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
    oracleRoute(`calibration`)
    let calls = 0
    expect(() =>
      expectGraphHash([[1, 2], [3], [3], []], () => ++calls),
    ).toThrow()
    expect(calls).toBe(2)
    expectGraphHash([[1, 2], [3], [3], []])
  })
})
