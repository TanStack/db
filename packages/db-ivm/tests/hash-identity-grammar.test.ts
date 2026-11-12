// A census of the D2 value-identity oracle's grammar. It samples the fixed
// campaign of hash-identity-oracle.property.test.ts (the same seed and run
// count) and checks, against the model alone, that the sample reaches every
// value kind, every mutation, and both verdicts. It runs no production code,
// so it tests the grammar, not the hash.
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleFixedSeed } from '../../db/tests/oracle-config.js'
import {
  canon,
  identity,
  nodes,
  pairArb,
} from './hash-identity-grammar-oracle.js'

const FIXED_SEED = 2026930

describe(`hash identity oracle`, () => {
  // Positive execution witness: the fixed campaign reaches every value kind
  // and every mutation, with both verdicts.
  it(`reaches every kind, mutation, and verdict in the fixed campaign`, () => {
    const sample = fc.sample(
      pairArb,
      oracleFixedSeed(FIXED_SEED, { numRuns: 300 }),
    )
    const kinds = new Set<string>()
    for (const { left } of sample)
      for (const [node] of nodes(left))
        kinds.add(node.k === `ref` ? `ref:${node.kind}` : node.k)
    expect([...kinds].sort()).toEqual(
      [
        `array`,
        `big`,
        `bin`,
        `bool`,
        `date`,
        `map`,
        `null`,
        `num`,
        `obj`,
        `ref:bigbin`,
        `ref:file`,
        `ref:fn`,
        `ref:handle`,
        `regex`,
        `set`,
        `str`,
        `sym`,
        `temporal`,
        `twice`,
        `undef`,
      ].sort(),
    )
    const verdicts = new Map<string, Set<boolean>>()
    for (const pair of sample) {
      const equal = identity(pair.left) === identity(pair.right)
      const seen = verdicts.get(pair.mutation) ?? new Set()
      verdicts.set(pair.mutation, seen.add(equal))
    }
    expect([...verdicts.keys()].sort()).toEqual(
      [
        `header`,
        `hole`,
        `none`,
        `order`,
        `property`,
        `replace`,
        `retype`,
        `split`,
      ].sort(),
    )
    for (const mutation of [`header`, `hole`, `retype`, `replace`, `split`])
      expect(verdicts.get(mutation), mutation).toContain(false)
    expect(verdicts.get(`none`)).toEqual(new Set([true]))

    // Map keys reach non-string primitives, containers, and merged keys.
    const keyKinds = new Set<string>()
    let merged = 0
    for (const { left, right } of sample)
      for (const spec of [left, right])
        for (const [node] of nodes(spec))
          if (node.k === `map`) {
            for (const [key] of node.entries) keyKinds.add(key.k)
            const encoded = canon(node) as [string, Array<unknown>]
            if (encoded[1].length < node.entries.length) merged++
          }
    expect(
      keyKinds.has(`num`) && keyKinds.has(`sym`) && keyKinds.has(`ref`),
    ).toBe(true)
    expect(keyKinds.has(`obj`) || keyKinds.has(`array`)).toBe(true)
    expect(merged).toBeGreaterThan(0)
  })
})
