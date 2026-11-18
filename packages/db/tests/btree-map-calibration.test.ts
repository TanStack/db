// Fast-check shrinking and replay calibration of the shared Map checker.
// These controls keep their original seeds, budgets and counterexamples.
import { expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { BTree } from '../src/utils/btree.js'
import { oracleRoute } from './oracle-config.js'
import {
  applyAction,
  expectPair,
  expectRefinement,
  mapHistoryProperty,
} from './btree-map-oracle.js'
import type { Payload, ReferenceModel } from './btree-map-oracle.js'

it(`replays a shrunk Map mismatch with the reported seed and path`, () => {
  oracleRoute(`calibration`)
  // A scanner that drops every row keeps the initial empty cut green. The
  // first retained put fails at the public scan checkpoint.
  const wrongScan = vi
    .spyOn(BTree.prototype, `forRange`)
    .mockImplementation(() => {})
  try {
    const failed = fc.check(mapHistoryProperty, {
      seed: 20260930,
      numRuns: 100,
    })
    expect(failed.failed).toBe(true)
    expect(String(failed.errorInstance)).toMatch(/expected/)
    if (failed.counterexamplePath === null)
      throw new Error(`Missing Map mismatch replay path`)
    const replay = fc.check(mapHistoryProperty, {
      seed: failed.seed,
      path: failed.counterexamplePath,
      numRuns: 1,
    })
    expect(replay.failed).toBe(true)
    expect(String(replay.errorInstance)).toMatch(/expected/)
    expect(replay.counterexample).toEqual(failed.counterexample)
  } finally {
    wrongScan.mockRestore()
  }
})

it(`shrinks and replays a wrong neighbor payload without losing its pair key`, () => {
  oracleRoute(`calibration`)
  const property = fc.property(
    fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }),
    (values) => {
      const tree = new BTree<number, Payload>((a, b) => a - b, 4)
      const model: ReferenceModel = new Map()
      values.forEach((v, key) =>
        applyAction(tree, model, { type: `put`, key, v }),
      )
      expectRefinement(tree, model, -1)
      // This pair keeps the expected key but has a wrong payload. The former
      // key-only law accepted it.
      const wrongPair: [number, Payload] = [0, { v: values[0]! + 1 }]
      expect(wrongPair[0]).toBe(0)
      expectPair(wrongPair, 0, model)
    },
  )
  const failed = fc.check(property, { seed: 303102, numRuns: 1 })
  expect(failed.failed).toBe(true)
  expect(String(failed.errorInstance)).toMatch(/expected/)
  expect(failed.counterexample?.[0].length).toBeGreaterThan(0)
  if (failed.counterexamplePath === null)
    throw new Error(`Missing calibration replay path`)
  const replay = fc.check(property, {
    seed: failed.seed,
    path: failed.counterexamplePath,
    numRuns: 1,
    endOnFailure: true,
  })
  expect(replay.failed).toBe(true)
  expect(String(replay.errorInstance)).toMatch(/expected/)
  expect(replay.counterexample).toEqual(failed.counterexample)
})
